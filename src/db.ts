import fs from "node:fs";
import path from "node:path";

import BetterSqlite3 from "better-sqlite3";

const DB_DIR = ".data";
const DB_PATH = path.join(DB_DIR, "gmail.db");

let db: BetterSqlite3.Database;

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

export function markProcessed(
  gmailMessageId: string,
  threadId: string,
  subject: string,
  sender: string,
): void {
  db.prepare(
    "INSERT OR IGNORE INTO processed_messages (gmail_message_id, thread_id, subject, sender) VALUES (?, ?, ?, ?)",
  ).run(gmailMessageId, threadId, subject, sender);
}

function createSchema(): void {
  db.exec(`
    CREATE TABLE IF NOT EXISTS processed_messages (
      gmail_message_id TEXT PRIMARY KEY,
      thread_id TEXT NOT NULL,
      subject TEXT NOT NULL DEFAULT '',
      sender TEXT NOT NULL DEFAULT '',
      processed_at TEXT NOT NULL DEFAULT (datetime('now'))
    )
  `);
}
