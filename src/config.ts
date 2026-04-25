import os from "node:os";
import path from "node:path";

import dotenv from "dotenv";

import type { AgentBackend, AppConfig } from "./types.js";

dotenv.config();

function parseChatId(raw: string): number {
  const parsed = Number(raw);
  if (!Number.isInteger(parsed)) {
    throw new Error("TELEGRAM_ALLOWED_CHAT_ID must be an integer");
  }
  return parsed;
}

function parseBoolean(raw: string | undefined): boolean | undefined {
  if (!raw) return undefined;
  const normalized = raw.trim().toLowerCase();
  if (["1", "true", "yes", "on"].includes(normalized)) return true;
  if (["0", "false", "no", "off"].includes(normalized)) return false;
  throw new Error(
    "Invalid boolean value. Use one of: 1/0, true/false, yes/no, on/off",
  );
}

function parseChannels(raw: string | undefined): string[] {
  if (!raw) return ["telegram", "gmail"];
  const channels = raw
    .split(",")
    .map((value) => value.trim().toLowerCase())
    .filter(Boolean);
  return channels.length ? channels : ["telegram", "gmail"];
}

function parseAdditionalDirectories(raw: string | undefined): string[] {
  if (raw?.trim()) {
    return dedupe(
      raw
        .split(",")
        .map((value) => value.trim())
        .filter(Boolean),
    );
  }

  const home = os.homedir();
  return dedupe([home, path.join(home, ".web-access"), path.join(home, ".gmail-mcp")]);
}

function dedupe(values: string[]): string[] {
  return Array.from(new Set(values));
}

function parseAgentBackend(raw: string | undefined): AgentBackend {
  const value = (raw || "codex").trim().toLowerCase();
  if (value === "codex" || value === "opencode") {
    return value;
  }
  throw new Error("AGENT_BACKEND must be codex or opencode");
}

export function loadConfig(): AppConfig {
  const telegramBotToken =
    process.env.TELEGRAM_BOT_TOKEN?.trim() || "123456:replace-me";
  const telegramAllowedChatId = process.env.TELEGRAM_ALLOWED_CHAT_ID?.trim()
    ? parseChatId(process.env.TELEGRAM_ALLOWED_CHAT_ID)
    : 0;
  const agentBackend = parseAgentBackend(process.env.AGENT_BACKEND);

  return {
    agentBackend,
    agentDefaultModel:
      process.env.AGENT_DEFAULT_MODEL?.trim() || "gpt-5.4",
    agentTurnTimeoutMs: Number(process.env.AGENT_TURN_TIMEOUT_MS) || 180000,
    telegramBotToken,
    telegramAllowedChatId,
    channels: parseChannels(process.env.CHANNELS),
    codexApiKey:
      process.env.CODEX_API_KEY?.trim() ||
      process.env.OPENAI_API_KEY?.trim() ||
      undefined,
    codexBaseUrl:
      process.env.CODEX_BASE_URL?.trim() ||
      process.env.OPENAI_BASE_URL?.trim() ||
      undefined,
    codexPathOverride: process.env.CODEX_PATH?.trim() || undefined,
    codexApprovalPolicy:
      (process.env.CODEX_APPROVAL_POLICY?.trim().toLowerCase() as
        | "never"
        | "on-request"
        | "on-failure"
        | "untrusted"
        | undefined) || "never",
    codexSandboxMode:
      (process.env.CODEX_SANDBOX_MODE?.trim().toLowerCase() as
        | "read-only"
        | "workspace-write"
        | "danger-full-access"
        | undefined) || "workspace-write",
    codexReasoningEffort:
      (process.env.CODEX_REASONING_EFFORT?.trim().toLowerCase() as
        | "minimal"
        | "low"
        | "medium"
        | "high"
        | "xhigh"
        | undefined) || undefined,
    codexNetworkAccessEnabled: parseBoolean(process.env.CODEX_NETWORK_ACCESS),
    codexAdditionalDirectories: parseAdditionalDirectories(
      process.env.CODEX_ADDITIONAL_DIRS,
    ),
    opencodeBaseUrl: process.env.OPENCODE_BASE_URL?.trim() || undefined,
    opencodeServerUsername:
      process.env.OPENCODE_SERVER_USERNAME?.trim() || undefined,
    opencodeServerPassword:
      process.env.OPENCODE_SERVER_PASSWORD?.trim() || undefined,
    stateFile:
      process.env.STATE_FILE?.trim() || path.join(".data", "state.json"),
    gmailTo: process.env.GMAIL_TO?.trim() || undefined,
    gmailPollIntervalMs: Number(process.env.GMAIL_POLL_INTERVAL_MS) || 10000,
    gmailProxy: process.env.GMAIL_PROXY?.trim() || undefined,
  };
}
