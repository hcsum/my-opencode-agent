import { createOpencodeClient } from "@opencode-ai/sdk";

import type { AppConfig, PersistedState } from "./types.js";
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
    providerID?: string;
    modelID?: string;
  };
}

export interface TurnInput {
  text: string;
  senderName: string;
  chatTitle?: string;
  timestamp: Date;
  sessionKey?: string;
  sessionTitle?: string;
}

const CHANNEL_SESSION_TITLES: Record<string, string> = {
  telegram: "Telegram Andy",
  gmail: "Gmail Andy",
};

const HARDCODED_MODEL = {
  providerID: "openai",
  modelID: "gpt-5.4",
} as const;

export class OpencodeSession {
  private readonly client;
  private readonly stateStore: StateStore;
  private readonly sessionPromises = new Map<string, Promise<string>>();
  private stateCache?: PersistedState;

  constructor(private readonly config: AppConfig) {
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

    const response = await this.unwrap<PromptResponse>(
      this.client.session.prompt({
        path: { id: sessionId },
        body: {
          model: HARDCODED_MODEL,
          parts: [{ type: "text", text: body }],
        },
      }),
    );

    if (response.info?.error) {
      throw new Error(extractErrorMessage(response.info.error));
    }
    logUsedModel(response.info);

    return extractText(response.parts) || "No response text returned.";
  }

  private async getOrCreateSessionId(
    channel: string,
    input: TurnInput,
  ): Promise<string> {
    const sessionKey = input.sessionKey || channel;
    let promise = this.sessionPromises.get(sessionKey);
    if (!promise) {
      promise = this.loadOrCreateSessionId(channel, input, sessionKey);
      this.sessionPromises.set(sessionKey, promise);
    }
    return promise;
  }

  private async loadOrCreateSessionId(
    channel: string,
    input: TurnInput,
    sessionKey: string,
  ): Promise<string> {
    const state = await this.loadState();

    const sessions = state.sessions || {};
    if (sessions[sessionKey]) {
      console.log(
        `[opencode] reusing ${sessionKey} session ${sessions[sessionKey]}`,
      );
      return sessions[sessionKey];
    }

    if (channel === "telegram" && state.sessionId) {
      sessions[sessionKey] = state.sessionId;
      await this.saveState({ ...state, sessions });
      console.log(
        `[opencode] migrated legacy session ${state.sessionId} to ${sessionKey}`,
      );
      return state.sessionId;
    }

    const title =
      input.sessionTitle ||
      (channel === "telegram"
        ? this.config.telegramSessionTitle
        : CHANNEL_SESSION_TITLES[channel] || `${channel} Andy`);

    const session = await this.unwrap<SessionRecord>(
      this.client.session.create({
        body: { title },
      }),
    );

    sessions[sessionKey] = session.id;
    await this.saveState({ ...state, sessions });
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

function buildPromptBody(
  channel: string,
  input: TurnInput,
): string {
  const label = channel.charAt(0).toUpperCase() + channel.slice(1);
  const lines = [
    `${label} message`,
    `Sender: ${input.senderName}`,
    `Chat: ${input.chatTitle || "Direct chat"}`,
    `Timestamp: ${input.timestamp.toISOString()}`,
    "",
    input.text.trim(),
  ];

  return lines.join("\n");
}

function extractText(parts: PromptPart[] | undefined): string {
  if (!parts || parts.length === 0) return "";

  const text = parts
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

  return text;
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
  if (
    typeof error === "object" &&
    error !== null &&
    "message" in error &&
    typeof error.message === "string"
  ) {
    return error.message;
  }
  return "OpenCode request failed";
}

function logUsedModel(
  info: PromptResponse["info"] | undefined,
): void {
  const provider = info?.providerID?.trim();
  const model = info?.modelID?.trim();
  if (!provider || !model) {
    console.log("[opencode] model used: unknown (provider/model not returned)");
    return;
  }
  console.log(`[opencode] model used: ${provider}/${model}`);
}
