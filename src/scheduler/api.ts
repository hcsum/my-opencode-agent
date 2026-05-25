import { randomUUID } from "node:crypto";
import http from "node:http";

import {
  computeNextCronRunAt,
  computeNextRunAt,
  minimumGapMinutes,
  parseCronExpression,
  validateTimezone,
} from "./cron.js";
import { SchedulerRuntime } from "./runtime.js";
import {
  countTasks,
  deleteTask,
  getTask,
  insertTask,
  listAllTasks,
  setEnabled,
  setNextRunAt,
} from "./store.js";
import type { ScheduledTask } from "./types.js";
import type { AppConfig } from "../types.js";

export interface ApiDeps {
  config: AppConfig;
  runtime: SchedulerRuntime;
}

export class SchedulerApi {
  private server?: http.Server;

  constructor(private readonly deps: ApiDeps) {}

  async start(): Promise<void> {
    if (this.server) return;
    const port = this.deps.config.schedulerApiPort;

    this.server = http.createServer((req, res) => {
      this.handleRequest(req, res).catch((error) => {
        console.error("[scheduler-api] handler crashed", error);
        if (!res.headersSent) res.writeHead(500);
        res.end(JSON.stringify({ error: "internal error" }));
      });
    });

    await new Promise<void>((resolve, reject) => {
      this.server!.once("error", reject);
      this.server!.listen(port, "127.0.0.1", () => {
        this.server!.off("error", reject);
        resolve();
      });
    });

    console.log(`[scheduler-api] listening on 127.0.0.1:${port}`);
  }

  async stop(): Promise<void> {
    if (!this.server) return;
    await new Promise<void>((resolve, reject) => {
      this.server!.close((err) => (err ? reject(err) : resolve()));
    });
    this.server = undefined;
  }

  private async handleRequest(
    req: http.IncomingMessage,
    res: http.ServerResponse,
  ): Promise<void> {
    const url = req.url || "";
    if (!url.startsWith("/scheduler/")) {
      res.writeHead(404).end();
      return;
    }

    if (req.method !== "POST" && req.method !== "GET") {
      res.writeHead(405).end();
      return;
    }

    const op = url.slice("/scheduler/".length).split("?")[0];
    const body = req.method === "POST" ? await readJson(req) : {};

    try {
      const result = await this.dispatch(op, body);
      res.writeHead(200, { "content-type": "application/json" });
      res.end(JSON.stringify(result));
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      res.writeHead(400, { "content-type": "application/json" });
      res.end(JSON.stringify({ error: message }));
    }
  }

  private async dispatch(op: string, body: Record<string, unknown>): Promise<unknown> {
    switch (op) {
      case "create":
        return this.create(body);
      case "list":
        return { tasks: listAllTasks().map(serializeTask) };
      case "delete":
        return this.delete(body);
      case "pause":
        return this.setEnabledOp(body, false);
      case "resume":
        return this.setEnabledOp(body, true);
      case "run_now":
        return this.runNow(body);
      default:
        throw new Error(`unknown scheduler op: ${op}`);
    }
  }

  private create(body: Record<string, unknown>): unknown {
    const kind = body.kind;
    if (kind !== "cron" && kind !== "once") {
      throw new Error("kind must be 'cron' or 'once'");
    }

    const prompt = requireString(body, "prompt");
    const summary = requireString(body, "summary");
    const timezone = stringOr(body, "timezone", this.deps.config.userTimezone);
    validateTimezone(timezone);

    if (countTasks() >= this.deps.config.schedulerMaxTasks) {
      throw new Error(
        `scheduler at capacity (${this.deps.config.schedulerMaxTasks} tasks). delete one before creating another`,
      );
    }

    const id = randomUUID();
    let nextRunAt: string | null;

    if (kind === "cron") {
      const cronExpr = requireString(body, "cron");
      parseCronExpression(cronExpr); // throws on bad input
      const gap = minimumGapMinutes(cronExpr, timezone);
      if (gap < this.deps.config.schedulerMinIntervalMinutes) {
        throw new Error(
          `cron interval ${gap}m is below minimum ${this.deps.config.schedulerMinIntervalMinutes}m`,
        );
      }
      nextRunAt = computeNextCronRunAt(cronExpr, timezone);
      insertTask({
        id,
        kind,
        cronExpr,
        timezone,
        prompt,
        summary,
        nextRunAt,
      });
    } else {
      const runAt = requireString(body, "runAt");
      const runAtMs = parseRunAtWithTimezoneOffset(runAt);
      if (Number.isNaN(runAtMs)) throw new Error(`runAt is not a valid ISO timestamp: ${runAt}`);
      if (runAtMs <= Date.now()) throw new Error(`runAt must be in the future: ${runAt}`);
      nextRunAt = new Date(runAtMs).toISOString();
      insertTask({
        id,
        kind,
        runAt: nextRunAt,
        timezone,
        prompt,
        summary,
        nextRunAt,
      });
    }

    this.deps.runtime.refreshTimerFor(id);
    return { id, nextRunAt, summary };
  }

  private delete(body: Record<string, unknown>): unknown {
    const id = requireString(body, "id");
    const ok = deleteTask(id);
    this.deps.runtime.refreshTimerFor(id);
    return { ok };
  }

  private setEnabledOp(body: Record<string, unknown>, enabled: boolean): unknown {
    const id = requireString(body, "id");
    const task = getTask(id);
    if (!task) throw new Error(`task not found: ${id}`);
    setEnabled(id, enabled);

    if (enabled && task.kind === "cron") {
      // Recompute next run from now, since the prior nextRunAt may be stale.
      const next = computeNextCronRunAt(task.cronExpr, task.timezone);
      setNextRunAt(id, next);
    } else if (enabled && task.kind === "once") {
      const next = computeNextRunAt(task);
      setNextRunAt(id, next);
    }

    this.deps.runtime.refreshTimerFor(id);
    const refreshed = getTask(id);
    return { ok: true, enabled, nextRunAt: refreshed?.nextRunAt ?? null };
  }

  private runNow(body: Record<string, unknown>): unknown {
    const id = requireString(body, "id");
    const ok = this.deps.runtime.fireNow(id);
    if (!ok) throw new Error(`task ${id} not found or already running`);
    return { ok: true };
  }
}

function serializeTask(task: ScheduledTask) {
  const common = {
    id: task.id,
    kind: task.kind,
    timezone: task.timezone,
    prompt: task.prompt,
    summary: task.summary,
    enabled: task.enabled,
    createdAt: task.createdAt,
    nextRunAt: task.nextRunAt,
    lastRunAt: task.lastRunAt,
    runCount: task.runCount,
    lastStatus: task.lastStatus,
    lastError: task.lastError,
  };
  return task.kind === "cron"
    ? { ...common, cron: task.cronExpr }
    : { ...common, runAt: task.runAt };
}

function requireString(body: Record<string, unknown>, key: string): string {
  const value = body[key];
  if (typeof value !== "string" || !value.trim()) {
    throw new Error(`${key} is required`);
  }
  return value.trim();
}

function stringOr(
  body: Record<string, unknown>,
  key: string,
  fallback: string,
): string {
  const value = body[key];
  return typeof value === "string" && value.trim() ? value.trim() : fallback;
}

async function readJson(req: http.IncomingMessage): Promise<Record<string, unknown>> {
  const chunks: Buffer[] = [];
  for await (const chunk of req) chunks.push(chunk as Buffer);
  if (chunks.length === 0) return {};
  try {
    const parsed = JSON.parse(Buffer.concat(chunks).toString("utf8"));
    if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
      return parsed as Record<string, unknown>;
    }
    throw new Error("body must be a JSON object");
  } catch (error) {
    throw new Error(
      error instanceof Error ? `invalid JSON body: ${error.message}` : "invalid JSON body",
    );
  }
}

function parseRunAtWithTimezoneOffset(runAt: string): number {
  if (!/(Z|[+-]\d{2}:\d{2})$/i.test(runAt)) {
    throw new Error(
      `runAt must include a timezone offset or Z suffix: ${runAt}`,
    );
  }
  return Date.parse(runAt);
}
