import { getDatabase } from "../db.js";
import type {
  ScheduledTask,
  ScheduledTaskKind,
  ScheduledTaskStatus,
} from "./types.js";

interface ScheduledTaskRow {
  id: string;
  kind: ScheduledTaskKind;
  cron_expr: string | null;
  run_at: string | null;
  timezone: string;
  prompt: string;
  summary: string;
  enabled: number;
  created_at: string;
  next_run_at: string | null;
  last_run_at: string | null;
  run_count: number;
  last_status: ScheduledTaskStatus;
  last_error: string | null;
}

function mapRow(row: ScheduledTaskRow): ScheduledTask {
  const base = {
    id: row.id,
    timezone: row.timezone,
    prompt: row.prompt,
    summary: row.summary,
    enabled: row.enabled === 1,
    createdAt: row.created_at,
    nextRunAt: row.next_run_at,
    lastRunAt: row.last_run_at,
    runCount: row.run_count,
    lastStatus: row.last_status,
    lastError: row.last_error,
  };

  if (row.kind === "cron") {
    if (!row.cron_expr) {
      throw new Error(`Scheduled task ${row.id} is kind=cron but has no cron_expr`);
    }
    return { ...base, kind: "cron", cronExpr: row.cron_expr };
  }

  if (!row.run_at) {
    throw new Error(`Scheduled task ${row.id} is kind=once but has no run_at`);
  }
  return { ...base, kind: "once", runAt: row.run_at };
}

export function listAllTasks(): ScheduledTask[] {
  const rows = getDatabase()
    .prepare(
      `SELECT id, kind, cron_expr, run_at, timezone, prompt, summary, enabled,
              created_at, next_run_at, last_run_at, run_count, last_status, last_error
         FROM scheduled_tasks
         ORDER BY created_at ASC`,
    )
    .all() as ScheduledTaskRow[];
  return rows.map(mapRow);
}

export function listEnabledTasks(): ScheduledTask[] {
  return listAllTasks().filter((task) => task.enabled);
}

export function getTask(id: string): ScheduledTask | undefined {
  const row = getDatabase()
    .prepare(
      `SELECT id, kind, cron_expr, run_at, timezone, prompt, summary, enabled,
              created_at, next_run_at, last_run_at, run_count, last_status, last_error
         FROM scheduled_tasks
         WHERE id = ?`,
    )
    .get(id) as ScheduledTaskRow | undefined;
  return row ? mapRow(row) : undefined;
}

export function countTasks(): number {
  const row = getDatabase()
    .prepare("SELECT COUNT(*) AS n FROM scheduled_tasks")
    .get() as { n: number };
  return row.n;
}

export interface InsertTaskInput {
  id: string;
  kind: ScheduledTaskKind;
  cronExpr?: string | null;
  runAt?: string | null;
  timezone: string;
  prompt: string;
  summary: string;
  nextRunAt: string | null;
}

export function insertTask(input: InsertTaskInput): void {
  getDatabase()
    .prepare(
      `INSERT INTO scheduled_tasks (
         id, kind, cron_expr, run_at, timezone, prompt, summary, enabled,
         created_at, next_run_at, last_run_at, run_count, last_status, last_error
       ) VALUES (?, ?, ?, ?, ?, ?, ?, 1, datetime('now'), ?, NULL, 0, 'idle', NULL)`,
    )
    .run(
      input.id,
      input.kind,
      input.cronExpr ?? null,
      input.runAt ?? null,
      input.timezone,
      input.prompt,
      input.summary,
      input.nextRunAt,
    );
}

export function deleteTask(id: string): boolean {
  const res = getDatabase()
    .prepare("DELETE FROM scheduled_tasks WHERE id = ?")
    .run(id);
  return res.changes > 0;
}

export function setEnabled(id: string, enabled: boolean): void {
  getDatabase()
    .prepare("UPDATE scheduled_tasks SET enabled = ? WHERE id = ?")
    .run(enabled ? 1 : 0, id);
}

export function setNextRunAt(id: string, nextRunAt: string | null): void {
  getDatabase()
    .prepare("UPDATE scheduled_tasks SET next_run_at = ? WHERE id = ?")
    .run(nextRunAt, id);
}

export function markRunning(id: string, fireTime: string): void {
  getDatabase()
    .prepare(
      `UPDATE scheduled_tasks
         SET last_status = 'running',
             last_run_at = ?,
             run_count = run_count + 1,
             last_error = NULL
       WHERE id = ?`,
    )
    .run(fireTime, id);
}

export function markSuccess(id: string, nextRunAt: string | null): void {
  getDatabase()
    .prepare(
      `UPDATE scheduled_tasks
         SET last_status = 'success',
             last_error = NULL,
             next_run_at = ?
       WHERE id = ?`,
    )
    .run(nextRunAt, id);
}

export function markError(
  id: string,
  errorMessage: string,
  nextRunAt: string | null,
): void {
  getDatabase()
    .prepare(
      `UPDATE scheduled_tasks
         SET last_status = 'error',
             last_error = ?,
             next_run_at = ?
       WHERE id = ?`,
    )
    .run(errorMessage, nextRunAt, id);
}

export interface ReportHistoryEntry {
  fireTime: string;
  summary: string;
  body: string;
}

// How many past outputs to retain per task. The executor replays the last 2
// into each fire (see PRIOR_REPORT_COUNT), so only those need to be kept; older
// rows are pruned on every successful run.
const REPORT_HISTORY_KEEP_PER_TASK = 2;

// Persist a successful scheduled run's final output so a later fire of the same
// task can be handed its own recent history (see executor.composePrompt). Old
// rows beyond the retention window are pruned in the same transaction.
export function recordReportHistory(input: {
  taskId: string;
  fireTime: string;
  summary: string;
  body: string;
}): void {
  const db = getDatabase();
  const insert = db.prepare(
    `INSERT INTO scheduled_report_history (task_id, fire_time, summary, body)
       VALUES (?, ?, ?, ?)`,
  );
  const prune = db.prepare(
    `DELETE FROM scheduled_report_history
       WHERE task_id = ?
         AND id NOT IN (
           SELECT id FROM scheduled_report_history
             WHERE task_id = ?
             ORDER BY id DESC
             LIMIT ?
         )`,
  );
  db.transaction(() => {
    insert.run(input.taskId, input.fireTime, input.summary, input.body);
    prune.run(input.taskId, input.taskId, REPORT_HISTORY_KEEP_PER_TASK);
  })();
}

// Most recent outputs for a task, returned oldest-first so they can be replayed
// to the model in chronological order.
export function getRecentReports(
  taskId: string,
  limit: number,
): ReportHistoryEntry[] {
  if (limit <= 0) return [];
  const rows = getDatabase()
    .prepare(
      `SELECT fire_time, summary, body
         FROM scheduled_report_history
         WHERE task_id = ?
         ORDER BY id DESC
         LIMIT ?`,
    )
    .all(taskId, limit) as Array<{
    fire_time: string;
    summary: string;
    body: string;
  }>;
  return rows
    .map((row) => ({
      fireTime: row.fire_time,
      summary: row.summary,
      body: row.body,
    }))
    .reverse();
}

// Boot-time recovery: any task left in 'running' was interrupted by a crash.
export function reapInterruptedRuns(): void {
  getDatabase()
    .prepare(
      `UPDATE scheduled_tasks
         SET last_status = 'error',
             last_error = 'Interrupted by bridge restart'
       WHERE last_status = 'running'`,
    )
    .run();
}
