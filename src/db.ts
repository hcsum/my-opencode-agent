import fs from "node:fs";
import path from "node:path";

import BetterSqlite3 from "better-sqlite3";

import type { WorkflowJobKind, WorkflowJobStatus } from "./types.js";

const DB_DIR = ".data";
const DB_PATH = path.join(DB_DIR, "gmail.db");
const CLAIM_TTL_MS = 15 * 60 * 1000;

let db: BetterSqlite3.Database;

export interface PendingPermissionRecord {
  threadId: string;
  sessionId: string;
  permissionId: string;
  messageId: string;
  title: string;
  type: string;
  pattern: string;
}

export function initDatabase(): void {
  fs.mkdirSync(DB_DIR, { recursive: true });
  db = new BetterSqlite3(DB_PATH);
  db.pragma("journal_mode = WAL");
  createSchema();
}

export function isProcessed(gmailMessageId: string): boolean {
  const row = db
    .prepare("SELECT 1 FROM processed_messages WHERE gmail_message_id = ?")
    .get(gmailMessageId);
  return !!row;
}

export function tryClaimMessage(gmailMessageId: string): boolean {
  const now = Date.now();
  db.prepare("DELETE FROM message_claims WHERE claimed_at_ms < ?").run(
    now - CLAIM_TTL_MS,
  );

  const result = db
    .prepare(
      "INSERT OR IGNORE INTO message_claims (gmail_message_id, claimed_at_ms) VALUES (?, ?)",
    )
    .run(gmailMessageId, now);

  return result.changes > 0;
}

export function releaseClaim(gmailMessageId: string): void {
  db.prepare("DELETE FROM message_claims WHERE gmail_message_id = ?").run(
    gmailMessageId,
  );
}

export function markProcessed(
  gmailMessageId: string,
  threadId: string,
  subject: string,
  sender: string,
): void {
  db.prepare(
    "INSERT OR IGNORE INTO processed_messages (gmail_message_id, thread_id, subject, sender) VALUES (?, ?, ?, ?)",
  ).run(gmailMessageId, threadId, subject, sender);

  releaseClaim(gmailMessageId);
}

export function getPendingPermission(
  threadId: string,
): PendingPermissionRecord | undefined {
  const row = db
    .prepare(
      `SELECT
         thread_id,
         session_id,
         permission_id,
         message_id,
         title,
         type,
         pattern
       FROM pending_permissions
       WHERE thread_id = ?`,
    )
    .get(threadId) as
    | {
        thread_id: string;
        session_id: string;
        permission_id: string;
        message_id: string;
        title: string;
        type: string;
        pattern: string;
      }
    | undefined;

  if (!row) return undefined;

  return {
    threadId: row.thread_id,
    sessionId: row.session_id,
    permissionId: row.permission_id,
    messageId: row.message_id,
    title: row.title,
    type: row.type,
    pattern: row.pattern,
  };
}

export function upsertPendingPermission(
  permission: PendingPermissionRecord,
): void {
  db.prepare(
    `INSERT INTO pending_permissions (
       thread_id,
       session_id,
       permission_id,
       message_id,
       title,
       type,
       pattern,
       updated_at
     ) VALUES (?, ?, ?, ?, ?, ?, ?, datetime('now'))
     ON CONFLICT(thread_id) DO UPDATE SET
       session_id = excluded.session_id,
       permission_id = excluded.permission_id,
       message_id = excluded.message_id,
       title = excluded.title,
       type = excluded.type,
       pattern = excluded.pattern,
       updated_at = datetime('now')`,
  ).run(
    permission.threadId,
    permission.sessionId,
    permission.permissionId,
    permission.messageId,
    permission.title,
    permission.type,
    permission.pattern,
  );
}

export function clearPendingPermission(threadId: string): void {
  db.prepare("DELETE FROM pending_permissions WHERE thread_id = ?").run(threadId);
}

export function createWorkflowJob(params: {
  kind: WorkflowJobKind;
  sourceChannel: string;
  sourceSession: string;
  triggerText: string;
  target: string;
}): number {
  const result = db
    .prepare(
      `INSERT INTO workflow_jobs (
        kind,
        source_channel,
        source_session,
        trigger_text,
        target,
        status
      ) VALUES (?, ?, ?, ?, ?, 'pending')`,
    )
    .run(
      params.kind,
      params.sourceChannel,
      params.sourceSession,
      params.triggerText,
      params.target,
    );

  return Number(result.lastInsertRowid);
}

export function updateWorkflowJobStatus(params: {
  id: number;
  status: WorkflowJobStatus;
  error?: string;
  resultSummary?: string;
}): void {
  const nowExpr = "datetime('now')";

  if (params.status === "running") {
    db.prepare(
      `UPDATE workflow_jobs
       SET status = ?, started_at = ${nowExpr}, error = NULL
       WHERE id = ?`,
    ).run(params.status, params.id);
    return;
  }

  if (params.status === "completed") {
    db.prepare(
      `UPDATE workflow_jobs
       SET status = ?, finished_at = ${nowExpr}, result_summary = ?, error = NULL
       WHERE id = ?`,
    ).run(params.status, params.resultSummary || "", params.id);
    return;
  }

  if (params.status === "failed") {
    db.prepare(
      `UPDATE workflow_jobs
       SET status = ?, finished_at = ${nowExpr}, error = ?
       WHERE id = ?`,
    ).run(params.status, params.error || "Unknown workflow failure", params.id);
    return;
  }

  db.prepare("UPDATE workflow_jobs SET status = ? WHERE id = ?").run(
    params.status,
    params.id,
  );
}

function createSchema(): void {
  db.exec(`
    CREATE TABLE IF NOT EXISTS processed_messages (
      gmail_message_id TEXT PRIMARY KEY,
      thread_id TEXT NOT NULL,
      subject TEXT NOT NULL DEFAULT '',
      sender TEXT NOT NULL DEFAULT '',
      processed_at TEXT NOT NULL DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS message_claims (
      gmail_message_id TEXT PRIMARY KEY,
      claimed_at_ms INTEGER NOT NULL
    );

    CREATE TABLE IF NOT EXISTS workflow_jobs (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      kind TEXT NOT NULL,
      source_channel TEXT NOT NULL,
      source_session TEXT NOT NULL,
      trigger_text TEXT NOT NULL,
      target TEXT NOT NULL DEFAULT '',
      status TEXT NOT NULL,
      result_summary TEXT NOT NULL DEFAULT '',
      error TEXT NOT NULL DEFAULT '',
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      started_at TEXT,
      finished_at TEXT
    );

    CREATE TABLE IF NOT EXISTS pending_permissions (
      thread_id TEXT PRIMARY KEY,
      session_id TEXT NOT NULL,
      permission_id TEXT NOT NULL,
      message_id TEXT NOT NULL,
      title TEXT NOT NULL DEFAULT '',
      type TEXT NOT NULL DEFAULT '',
      pattern TEXT NOT NULL DEFAULT '',
      updated_at TEXT NOT NULL DEFAULT (datetime('now'))
    )
  `);
}
