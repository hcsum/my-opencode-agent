// Hand-written 5-field POSIX cron parser + matcher, timezone-aware via Intl.
// Ported from opencode-telegram-bot/src/scheduled-task/next-run.ts — no external deps.

import type { ScheduledTask } from "./types.js";

const MINUTE_MS = 60_000;
const MAX_SEARCH_MINUTES = 60 * 24 * 366 * 2;

const MONTH_ALIASES: Record<string, number> = {
  jan: 1, feb: 2, mar: 3, apr: 4, may: 5, jun: 6,
  jul: 7, aug: 8, sep: 9, oct: 10, nov: 11, dec: 12,
};

const WEEKDAY_ALIASES: Record<string, number> = {
  sun: 0, mon: 1, tue: 2, wed: 3, thu: 4, fri: 5, sat: 6,
};

interface CronFieldMatcher {
  wildcard: boolean;
  values: Set<number>;
}

interface ParsedCronExpression {
  minute: CronFieldMatcher;
  hour: CronFieldMatcher;
  dayOfMonth: CronFieldMatcher;
  month: CronFieldMatcher;
  dayOfWeek: CronFieldMatcher;
}

interface ZonedDateParts {
  year: number;
  month: number;
  day: number;
  hour: number;
  minute: number;
  weekday: number;
}

const zonedFormatterCache = new Map<string, Intl.DateTimeFormat>();

function getZonedFormatter(timezone: string): Intl.DateTimeFormat {
  const cached = zonedFormatterCache.get(timezone);
  if (cached) return cached;

  const formatter = new Intl.DateTimeFormat("en-US", {
    timeZone: timezone,
    year: "numeric",
    month: "numeric",
    day: "numeric",
    hour: "numeric",
    minute: "numeric",
    weekday: "short",
    hour12: false,
    hourCycle: "h23",
  });

  zonedFormatterCache.set(timezone, formatter);
  return formatter;
}

function normalizeWeekday(value: number): number {
  return value === 7 ? 0 : value;
}

function parseFieldValue(
  rawValue: string,
  min: number,
  max: number,
  aliases?: Record<string, number>,
): number {
  const normalized = rawValue.trim().toLowerCase();
  if (aliases && normalized in aliases) return aliases[normalized];

  const parsed = Number.parseInt(normalized, 10);
  if (!Number.isInteger(parsed) || parsed < min || parsed > max) {
    throw new Error(`Invalid cron field value: ${rawValue}`);
  }
  return parsed;
}

function expandFieldBase(
  base: string,
  min: number,
  max: number,
  aliases?: Record<string, number>,
): number[] {
  if (base === "*") {
    return Array.from({ length: max - min + 1 }, (_, index) => min + index);
  }

  if (base.includes("-")) {
    const [startRaw, endRaw] = base.split("-");
    const start = parseFieldValue(startRaw, min, max, aliases);
    const end = parseFieldValue(endRaw, min, max, aliases);
    if (start > end) throw new Error(`Invalid cron field range: ${base}`);
    return Array.from({ length: end - start + 1 }, (_, index) => start + index);
  }

  return [parseFieldValue(base, min, max, aliases)];
}

function expandFieldToken(
  token: string,
  min: number,
  max: number,
  aliases?: Record<string, number>,
): number[] {
  const [baseRaw, stepRaw] = token.split("/");
  const baseValues = expandFieldBase(baseRaw, min, max, aliases);

  if (stepRaw === undefined) return baseValues;

  const step = Number.parseInt(stepRaw, 10);
  if (!Number.isInteger(step) || step <= 0) {
    throw new Error(`Invalid cron field step: ${token}`);
  }

  return baseValues.filter((value, index) => {
    if (baseRaw === "*") return (value - min) % step === 0;
    return index % step === 0;
  });
}

function parseCronField(
  field: string,
  min: number,
  max: number,
  aliases?: Record<string, number>,
  normalize?: (value: number) => number,
): CronFieldMatcher {
  const normalizedField = field.trim().toLowerCase();
  const values = new Set<number>();

  for (const token of normalizedField.split(",")) {
    const trimmedToken = token.trim();
    if (!trimmedToken) throw new Error(`Invalid cron field: ${field}`);
    for (const value of expandFieldToken(trimmedToken, min, max, aliases)) {
      values.add(normalize ? normalize(value) : value);
    }
  }

  return { wildcard: normalizedField === "*", values };
}

export function parseCronExpression(cron: string): ParsedCronExpression {
  const parts = cron.trim().split(/\s+/);
  if (parts.length !== 5) {
    throw new Error(`Unsupported cron expression: ${cron}`);
  }

  return {
    minute: parseCronField(parts[0], 0, 59),
    hour: parseCronField(parts[1], 0, 23),
    dayOfMonth: parseCronField(parts[2], 1, 31),
    month: parseCronField(parts[3], 1, 12, MONTH_ALIASES),
    dayOfWeek: parseCronField(parts[4], 0, 7, WEEKDAY_ALIASES, normalizeWeekday),
  };
}

function getZonedDateParts(date: Date, timezone: string): ZonedDateParts {
  const parts = getZonedFormatter(timezone).formatToParts(date);

  const year = Number(parts.find((p) => p.type === "year")?.value);
  const month = Number(parts.find((p) => p.type === "month")?.value);
  const day = Number(parts.find((p) => p.type === "day")?.value);
  const hour = Number(parts.find((p) => p.type === "hour")?.value);
  const minute = Number(parts.find((p) => p.type === "minute")?.value);
  const weekdayName = parts
    .find((p) => p.type === "weekday")
    ?.value?.toLowerCase()
    .slice(0, 3);

  if (
    !Number.isInteger(year) ||
    !Number.isInteger(month) ||
    !Number.isInteger(day) ||
    !Number.isInteger(hour) ||
    !Number.isInteger(minute) ||
    !weekdayName ||
    !(weekdayName in WEEKDAY_ALIASES)
  ) {
    throw new Error(`Failed to resolve zoned date parts for timezone: ${timezone}`);
  }

  return { year, month, day, hour, minute, weekday: WEEKDAY_ALIASES[weekdayName] };
}

function matchesCron(expression: ParsedCronExpression, date: Date, timezone: string): boolean {
  const parts = getZonedDateParts(date, timezone);
  const minuteMatch = expression.minute.values.has(parts.minute);
  const hourMatch = expression.hour.values.has(parts.hour);
  const monthMatch = expression.month.values.has(parts.month);
  const dayOfMonthMatch = expression.dayOfMonth.values.has(parts.day);
  const dayOfWeekMatch = expression.dayOfWeek.values.has(parts.weekday);

  // Vixie cron semantics: if both day fields are restricted, OR them.
  let dayMatch: boolean;
  if (expression.dayOfMonth.wildcard && expression.dayOfWeek.wildcard) {
    dayMatch = true;
  } else if (expression.dayOfMonth.wildcard) {
    dayMatch = dayOfWeekMatch;
  } else if (expression.dayOfWeek.wildcard) {
    dayMatch = dayOfMonthMatch;
  } else {
    dayMatch = dayOfMonthMatch || dayOfWeekMatch;
  }

  return minuteMatch && hourMatch && monthMatch && dayMatch;
}

export function isTaskDue(task: ScheduledTask, now: Date = new Date()): boolean {
  if (!task.nextRunAt) return false;
  const ms = Date.parse(task.nextRunAt);
  if (Number.isNaN(ms)) return false;
  return ms <= now.getTime();
}

export function computeNextCronRunAt(
  cron: string,
  timezone: string,
  fromDate: Date = new Date(),
): string {
  const expression = parseCronExpression(cron);
  let candidateMs = Math.floor(fromDate.getTime() / MINUTE_MS) * MINUTE_MS + MINUTE_MS;

  for (let attempt = 0; attempt < MAX_SEARCH_MINUTES; attempt++) {
    const candidate = new Date(candidateMs);
    if (matchesCron(expression, candidate, timezone)) {
      return candidate.toISOString();
    }
    candidateMs += MINUTE_MS;
  }

  throw new Error(`Unable to compute next cron run for expression: ${cron}`);
}

export function computeNextRunAt(
  task: ScheduledTask,
  fromDate: Date = new Date(),
): string | null {
  if (task.kind === "once") {
    const ms = Date.parse(task.runAt);
    if (Number.isNaN(ms) || ms <= fromDate.getTime()) return null;
    return new Date(ms).toISOString();
  }
  return computeNextCronRunAt(task.cronExpr, task.timezone, fromDate);
}

export function validateTimezone(tz: string): void {
  try {
    new Intl.DateTimeFormat("en-US", { timeZone: tz });
  } catch {
    throw new Error(`Invalid IANA timezone: ${tz}`);
  }
}

// Returns the smallest gap (in minutes) between two consecutive cron fires.
// Used to enforce a minimum interval at creation time.
export function minimumGapMinutes(cron: string, timezone: string): number {
  const first = computeNextCronRunAt(cron, timezone);
  const second = computeNextCronRunAt(cron, timezone, new Date(Date.parse(first)));
  return Math.round((Date.parse(second) - Date.parse(first)) / MINUTE_MS);
}
