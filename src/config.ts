import path from "node:path";

import dotenv from "dotenv";

import type { AppConfig } from "./types.js";

dotenv.config();

function required(name: string): string {
  const value = process.env[name]?.trim();
  if (!value) {
    throw new Error(`Missing required environment variable: ${name}`);
  }
  return value;
}

function parseChatId(raw: string): number {
  const parsed = Number(raw);
  if (!Number.isInteger(parsed)) {
    throw new Error("TELEGRAM_ALLOWED_CHAT_ID must be an integer");
  }
  return parsed;
}

export function loadConfig(): AppConfig {
  return {
    telegramBotToken: required("TELEGRAM_BOT_TOKEN"),
    telegramAllowedChatId: parseChatId(required("TELEGRAM_ALLOWED_CHAT_ID")),
    opencodeBaseUrl: required("OPENCODE_BASE_URL"),
    opencodeServerUsername:
      process.env.OPENCODE_SERVER_USERNAME?.trim() || undefined,
    opencodeServerPassword:
      process.env.OPENCODE_SERVER_PASSWORD?.trim() || undefined,
    gmailModel: process.env.GMAIL_MODEL?.trim() || undefined,
    telegramSessionTitle:
      process.env.TELEGRAM_SESSION_TITLE?.trim() || "Telegram Andy",
    stateFile:
      process.env.STATE_FILE?.trim() || path.join(".data", "state.json"),
    gmailTo: process.env.GMAIL_TO?.trim() || undefined,
    gmailPollIntervalMs: Number(process.env.GMAIL_POLL_INTERVAL_MS) || 10000,
    gmailProxy: process.env.GMAIL_PROXY?.trim() || undefined,
  };
}
