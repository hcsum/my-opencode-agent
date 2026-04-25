import { createOpencodeClient } from "@opencode-ai/sdk";

import type { AppConfig, PersistedState } from "./types.js";
import type { AgentSession, TurnInput } from "./session.js";
import { getBackendSessionMap, setBackendSessionMap } from "./session-state.js";
import { StateStore } from "./state.js";

interface PromptPart {
  type?: string;
  text?: string;
  [key: string]: unknown;
}

interface SessionRecord {
  id: string;
}

interface ApiResult<T> {
  data?: T;
  error?: unknown;
}

interface PromptResponse {
  parts?: PromptPart[];
  info?: {
    error?: unknown;
  };
}

interface ModelRef {
  providerID: string;
  modelID: string;
}

export class OpencodeSession implements AgentSession {
  private readonly client;
  private readonly stateStore: StateStore;
  private readonly sessionPromises = new Map<string, Promise<string>>();
  private stateCache?: PersistedState;

  constructor(private readonly config: AppConfig) {
    if (!config.opencodeBaseUrl) {
      throw new Error(
        "Missing OPENCODE_BASE_URL for AGENT_BACKEND=opencode",
      );
    }

    this.client = createOpencodeClient({
      baseUrl: config.opencodeBaseUrl,
      fetch: this.buildFetch(),
    });
    this.stateStore = new StateStore(config.stateFile);
  }

  async healthcheck(): Promise<void> {
    const sessions = await this.unwrap<Array<SessionRecord>>(
      this.client.session.list(),
    );
    console.log(`[opencode] connected; visibleSessions=${sessions.length}`);
  }

  async sendTurn(channel: string, input: TurnInput): Promise<string> {
    const sessionId = await this.getOrCreateSessionId(channel, input);
    const body = buildPromptBody(channel, input);

    const response = await withTimeout(
      this.unwrap<PromptResponse>(
        this.client.session.prompt({
          path: { id: sessionId },
          body: {
            model: resolveOpencodeModel(this.config.agentDefaultModel),
            parts: [{ type: "text", text: body }],
          },
        }),
      ),
      this.config.agentTurnTimeoutMs,
      `OpenCode prompt timed out after ${this.config.agentTurnTimeoutMs}ms (session=${sessionId})`,
    );

    if (response.info?.error) {
      throw new Error(extractErrorMessage(response.info.error));
    }

    return extractText(response.parts) || "No response text returned.";
  }

  private async getOrCreateSessionId(
    channel: string,
    input: TurnInput,
  ): Promise<string> {
    const sessionKey = input.sessionKey || channel;
    let promise = this.sessionPromises.get(sessionKey);
    if (!promise) {
      promise = this.loadOrCreateSessionId(channel, sessionKey);
      this.sessionPromises.set(sessionKey, promise);
    }
    return promise;
  }

  private async loadOrCreateSessionId(
    channel: string,
    sessionKey: string,
  ): Promise<string> {
    const state = await this.loadState();
    const sessions = getBackendSessionMap(state, "opencode");

    if (sessions[sessionKey]) {
      console.log(
        `[opencode] reusing ${sessionKey} session ${sessions[sessionKey]}`,
      );
      return sessions[sessionKey];
    }

    const title = channel === "telegram" ? "Telegram Andy" : "Gmail Andy";
    const session = await this.unwrap<SessionRecord>(
      this.client.session.create({
        body: { title },
      }),
    );

    sessions[sessionKey] = session.id;
    await this.saveState(setBackendSessionMap(state, "opencode", sessions));
    console.log(`[opencode] created ${sessionKey} session ${session.id}`);
    return session.id;
  }

  private async loadState(): Promise<PersistedState> {
    if (!this.stateCache) {
      this.stateCache = await this.stateStore.load();
    }
    return this.stateCache;
  }

  private async saveState(state: PersistedState): Promise<void> {
    this.stateCache = state;
    await this.stateStore.save(state);
  }

  private async unwrap<T>(promise: Promise<ApiResult<T>>): Promise<T> {
    const result = await promise;
    if (result.error) {
      throw new Error(extractErrorMessage(result.error));
    }
    if (result.data === undefined) {
      throw new Error("OpenCode request returned no data");
    }
    return result.data;
  }

  private buildFetch(): (request: Request) => ReturnType<typeof fetch> {
    const authHeader = buildBasicAuthHeader(
      this.config.opencodeServerUsername,
      this.config.opencodeServerPassword,
    );

    return async (request) => {
      const headers = new Headers(request.headers);
      if (authHeader) {
        headers.set("authorization", authHeader);
      }

      return fetch(
        new Request(request, {
          headers,
        }),
      );
    };
  }
}

function buildPromptBody(channel: string, input: TurnInput): string {
  const label = channel.charAt(0).toUpperCase() + channel.slice(1);
  return [
    `${label} message`,
    `Sender: ${input.senderName}`,
    `Chat: ${input.chatTitle || "Direct chat"}`,
    `Timestamp: ${input.timestamp.toISOString()}`,
    "",
    input.text.trim(),
  ].join("\n");
}

function extractText(parts: PromptPart[] | undefined): string {
  if (!parts || parts.length === 0) return "";

  return parts
    .map((part) => {
      if (part.type === "text" && typeof part.text === "string") {
        return part.text;
      }
      if (typeof part.text === "string") {
        return part.text;
      }
      return "";
    })
    .filter(Boolean)
    .join("\n")
    .trim();
}

function buildBasicAuthHeader(
  username?: string,
  password?: string,
): string | undefined {
  if (!password) return undefined;
  const resolvedUser = username || "opencode";
  const encoded = Buffer.from(`${resolvedUser}:${password}`).toString("base64");
  return `Basic ${encoded}`;
}

function extractErrorMessage(error: unknown): string {
  if (!error) return "OpenCode request failed";
  if (typeof error === "string") return error;
  if (typeof error === "object" && error !== null) {
    const directMessage = readString(error, "message");
    if (directMessage) return directMessage;

    const nestedError = readObject(error, "error");
    if (nestedError) {
      const nestedMessage = readString(nestedError, "message");
      if (nestedMessage) return nestedMessage;
    }

    const cause = readObject(error, "cause");
    if (cause) {
      const causeMessage = readString(cause, "message");
      if (causeMessage) return causeMessage;
    }

    const compact = stringifyCompact(error);
    if (compact) return compact;
  }
  return "OpenCode request failed";
}

function readObject(
  source: unknown,
  key: string,
): Record<string, unknown> | undefined {
  if (typeof source !== "object" || source === null) return undefined;
  const value = (source as Record<string, unknown>)[key];
  if (typeof value === "object" && value !== null) {
    return value as Record<string, unknown>;
  }
  return undefined;
}

function readString(source: unknown, key: string): string | undefined {
  if (typeof source !== "object" || source === null) return undefined;
  const value = (source as Record<string, unknown>)[key];
  return typeof value === "string" && value.trim() ? value : undefined;
}

function stringifyCompact(value: unknown): string | undefined {
  try {
    return JSON.stringify(value);
  } catch {
    return undefined;
  }
}

async function withTimeout<T>(
  promise: Promise<T>,
  timeoutMs: number,
  message: string,
): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      promise,
      new Promise<T>((_, reject) => {
        timer = setTimeout(() => reject(new Error(message)), timeoutMs);
      }),
    ]);
  } finally {
    if (timer) clearTimeout(timer);
  }
}

function resolveOpencodeModel(raw: string): ModelRef {
  const value = raw.trim();
  if (!value) {
    return { providerID: "openai", modelID: "gpt-5.4" };
  }

  const [providerID, modelID] = value.includes("/")
    ? value.split("/", 2)
    : ["openai", value];

  if (!providerID || !modelID) {
    throw new Error(
      `Invalid AGENT_DEFAULT_MODEL for OpenCode: ${raw}. Expected modelID or providerID/modelID.`,
    );
  }

  return { providerID, modelID };
}
