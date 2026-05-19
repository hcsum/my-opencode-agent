import fs from "node:fs";
import path from "node:path";

import BetterSqlite3 from "better-sqlite3";

import type {
  QuestionPrompt,
  ThreadRunStatus,
  WorkflowJobKind,
  WorkflowJobStatus,
} from "./types.js";

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

export interface PendingQuestionRecord {
  threadId: string;
  sessionId: string;
  questionId: string;
  messageId: string;
  questions: QuestionPrompt[];
}

export interface ThreadRunRecord {
  threadId: string;
  sessionKey: string;
  sessionId: string;
  gmailMessageId: string;
  senderEmail: string;
  senderName: string;
  subject: string;
  rfcMessageId: string;
  lastUserText: string;
  status: ThreadRunStatus;
  lastError: string;
  startedAtMs: number;
  updatedAtMs: number;
}

export function initDatabase(): void {
  fs.mkdirSync(DB_DIR, { recursive: true });
  db = new BetterSqlite3(DB_PATH);
  db.pragma("journal_mode = WAL");
  createSchema();
  runMigrations();
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

export function getPendingQuestion(
  threadId: string,
): PendingQuestionRecord | undefined {
  const row = db
    .prepare(
      `SELECT
         thread_id,
         session_id,
         question_id,
         message_id,
         questions_json
       FROM pending_questions
       WHERE thread_id = ?`,
    )
    .get(threadId) as
    | {
        thread_id: string;
        session_id: string;
        question_id: string;
        message_id: string;
        questions_json: string;
      }
    | undefined;

  if (!row) return undefined;

  return {
    threadId: row.thread_id,
    sessionId: row.session_id,
    questionId: row.question_id,
    messageId: row.message_id,
    questions: parseQuestions(row.questions_json),
  };
}

export function upsertPendingQuestion(question: PendingQuestionRecord): void {
  db.prepare(
    `INSERT INTO pending_questions (
       thread_id,
       session_id,
       question_id,
       message_id,
       questions_json,
       updated_at
     ) VALUES (?, ?, ?, ?, ?, datetime('now'))
     ON CONFLICT(thread_id) DO UPDATE SET
       session_id = excluded.session_id,
       question_id = excluded.question_id,
       message_id = excluded.message_id,
       questions_json = excluded.questions_json,
       updated_at = datetime('now')`,
  ).run(
    question.threadId,
    question.sessionId,
    question.questionId,
    question.messageId,
    JSON.stringify(question.questions),
  );
}

export function clearPendingQuestion(threadId: string): void {
  db.prepare("DELETE FROM pending_questions WHERE thread_id = ?").run(threadId);
}

export function getThreadRun(threadId: string): ThreadRunRecord | undefined {
  const row = db
    .prepare(
      `SELECT
         thread_id,
         session_key,
         session_id,
         gmail_message_id,
         sender_email,
         sender_name,
         subject,
         rfc_message_id,
         last_user_text,
         status,
         last_error,
         started_at_ms,
         updated_at_ms
       FROM thread_runs
       WHERE thread_id = ?`,
    )
    .get(threadId) as ThreadRunRow | undefined;

  return row ? mapThreadRunRow(row) : undefined;
}

export function listActiveThreadRuns(): ThreadRunRecord[] {
  const rows = db
    .prepare(
      `SELECT
         thread_id,
         session_key,
         session_id,
         gmail_message_id,
         sender_email,
         sender_name,
         subject,
         rfc_message_id,
         last_user_text,
         status,
         last_error,
         started_at_ms,
         updated_at_ms
       FROM thread_runs
       WHERE status IN ('running', 'waiting_permission', 'waiting_question')
       ORDER BY updated_at_ms ASC`,
    )
    .all() as ThreadRunRow[];

  return rows.map(mapThreadRunRow);
}

export function upsertThreadRun(run: ThreadRunRecord): void {
  db.prepare(
    `INSERT INTO thread_runs (
       thread_id,
       session_key,
       session_id,
       gmail_message_id,
       sender_email,
       sender_name,
       subject,
       rfc_message_id,
       last_user_text,
       status,
       last_error,
       started_at_ms,
       updated_at_ms
     ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
     ON CONFLICT(thread_id) DO UPDATE SET
       session_key = excluded.session_key,
       session_id = excluded.session_id,
       gmail_message_id = excluded.gmail_message_id,
       sender_email = excluded.sender_email,
       sender_name = excluded.sender_name,
       subject = excluded.subject,
       rfc_message_id = excluded.rfc_message_id,
       last_user_text = excluded.last_user_text,
       status = excluded.status,
       last_error = excluded.last_error,
       started_at_ms = excluded.started_at_ms,
       updated_at_ms = excluded.updated_at_ms`,
  ).run(
    run.threadId,
    run.sessionKey,
    run.sessionId,
    run.gmailMessageId,
    run.senderEmail,
    run.senderName,
    run.subject,
    run.rfcMessageId,
    run.lastUserText,
    run.status,
    run.lastError,
    run.startedAtMs,
    run.updatedAtMs,
  );
}

export function updateThreadRunStatus(params: {
  threadId: string;
  status: ThreadRunStatus;
  lastError?: string;
  updatedAtMs?: number;
}): void {
  db.prepare(
    `UPDATE thread_runs
     SET status = ?, last_error = ?, updated_at_ms = ?
     WHERE thread_id = ?`,
  ).run(
    params.status,
    params.lastError || "",
    params.updatedAtMs || Date.now(),
    params.threadId,
  );
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

export function incrementThreadFailures(threadId: string): number {
  db.prepare(`
    INSERT INTO thread_failures (thread_id, failure_count)
    VALUES (?, 1)
    ON CONFLICT(thread_id) DO UPDATE SET
      failure_count = failure_count + 1,
      last_failed_at = datetime('now')
  `).run(threadId);
  const row = db
    .prepare("SELECT failure_count FROM thread_failures WHERE thread_id = ?")
    .get(threadId) as { failure_count: number };
  return row.failure_count;
}

export function resetThreadFailures(threadId: string): void {
  db.prepare("DELETE FROM thread_failures WHERE thread_id = ?").run(threadId);
}

interface ThreadRunRow {
  thread_id: string;
  session_key: string;
  session_id: string;
  gmail_message_id: string;
  sender_email: string;
  sender_name: string;
  subject: string;
  rfc_message_id: string;
  last_user_text: string;
  status: ThreadRunStatus;
  last_error: string;
  started_at_ms: number;
  updated_at_ms: number;
}

function mapThreadRunRow(row: ThreadRunRow): ThreadRunRecord {
  return {
    threadId: row.thread_id,
    sessionKey: row.session_key,
    sessionId: row.session_id,
    gmailMessageId: row.gmail_message_id,
    senderEmail: row.sender_email,
    senderName: row.sender_name,
    subject: row.subject,
    rfcMessageId: row.rfc_message_id,
    lastUserText: row.last_user_text,
    status: row.status,
    lastError: row.last_error,
    startedAtMs: row.started_at_ms,
    updatedAtMs: row.updated_at_ms,
  };
}

function parseQuestions(raw: string): QuestionPrompt[] {
  try {
    const parsed = JSON.parse(raw) as unknown;
    return Array.isArray(parsed) ? (parsed as QuestionPrompt[]) : [];
  } catch {
    return [];
  }
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
    );

    CREATE TABLE IF NOT EXISTS pending_questions (
      thread_id TEXT PRIMARY KEY,
      session_id TEXT NOT NULL,
      question_id TEXT NOT NULL,
      message_id TEXT NOT NULL DEFAULT '',
      questions_json TEXT NOT NULL DEFAULT '[]',
      updated_at TEXT NOT NULL DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS thread_runs (
      thread_id TEXT PRIMARY KEY,
      session_key TEXT NOT NULL,
      session_id TEXT NOT NULL,
      gmail_message_id TEXT NOT NULL DEFAULT '',
      sender_email TEXT NOT NULL DEFAULT '',
      sender_name TEXT NOT NULL DEFAULT '',
      subject TEXT NOT NULL DEFAULT '',
      rfc_message_id TEXT NOT NULL DEFAULT '',
      last_user_text TEXT NOT NULL DEFAULT '',
      status TEXT NOT NULL,
      last_error TEXT NOT NULL DEFAULT '',
      started_at_ms INTEGER NOT NULL DEFAULT 0,
      updated_at_ms INTEGER NOT NULL DEFAULT 0
    );

    CREATE TABLE IF NOT EXISTS thread_failures (
      thread_id TEXT PRIMARY KEY,
      failure_count INTEGER NOT NULL DEFAULT 0,
      last_failed_at TEXT NOT NULL DEFAULT (datetime('now'))
    )
  `);
}

function runMigrations(): void {
  // Backfill columns on prod DBs that pre-date these fields.
  ensureColumn("pending_permissions", "title", "title TEXT NOT NULL DEFAULT ''");
  ensureColumn("pending_permissions", "type", "type TEXT NOT NULL DEFAULT ''");
  ensureColumn("pending_permissions", "pattern", "pattern TEXT NOT NULL DEFAULT ''");
  ensureColumn("pending_permissions", "updated_at", "updated_at TEXT NOT NULL DEFAULT (datetime('now'))");
}

function ensureColumn(table: string, column: string, definition: string): void {
  const rows = db
    .prepare(`PRAGMA table_info(${table})`)
    .all() as Array<{ name: string }>;

  if (rows.some((row) => row.name === column)) {
    return;
  }

  db.exec(`ALTER TABLE ${table} ADD COLUMN ${definition}`);
}
