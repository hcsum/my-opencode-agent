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
  };
}

export interface TurnInput {
  text: string;
  senderName: string;
  chatTitle?: string;
  timestamp: Date;
}

const CHANNEL_SESSION_TITLES: Record<string, string> = {
  telegram: "Telegram Andy",
  gmail: "Gmail Andy",
};

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
    const sessionId = await this.getOrCreateSessionId(channel);
    const body = buildPromptBody(channel, input);
    const model = resolveChannelModel(this.config, channel);

    const response = await this.unwrap<PromptResponse>(
      this.client.session.prompt({
        path: { id: sessionId },
        body: {
          ...(model ? { model } : {}),
          parts: [{ type: "text", text: body }],
        },
      }),
    );

    if (response.info?.error) {
      throw new Error(extractErrorMessage(response.info.error));
    }

    return extractText(response.parts) || "No response text returned.";
  }

  private async getOrCreateSessionId(channel: string): Promise<string> {
    let promise = this.sessionPromises.get(channel);
    if (!promise) {
      promise = this.loadOrCreateSessionId(channel);
      this.sessionPromises.set(channel, promise);
    }
    return promise;
  }

  private async loadOrCreateSessionId(channel: string): Promise<string> {
    const state = await this.loadState();

    const sessions = state.sessions || {};
    if (sessions[channel]) {
      console.log(
        `[opencode] reusing ${channel} session ${sessions[channel]}`,
      );
      return sessions[channel];
    }

    if (channel === "telegram" && state.sessionId) {
      sessions[channel] = state.sessionId;
      await this.saveState({ ...state, sessions });
      console.log(
        `[opencode] migrated legacy session ${state.sessionId} to ${channel}`,
      );
      return state.sessionId;
    }

    const title =
      channel === "telegram"
        ? this.config.telegramSessionTitle
        : CHANNEL_SESSION_TITLES[channel] || `${channel} Andy`;

    const session = await this.unwrap<SessionRecord>(
      this.client.session.create({
        body: { title },
      }),
    );

    sessions[channel] = session.id;
    await this.saveState({ ...state, sessions });
    console.log(`[opencode] created ${channel} session ${session.id}`);
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

function resolveChannelModel(
  config: AppConfig,
  channel: string,
): { providerID: string; modelID: string } | undefined {
  const raw = channel === "gmail" ? config.gmailModel : undefined;
  if (!raw) return undefined;

  const [providerID, modelID] = raw.split("/");
  if (!providerID || !modelID) {
    throw new Error(`Invalid model override for channel ${channel}: ${raw}`);
  }

  return { providerID, modelID };
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
