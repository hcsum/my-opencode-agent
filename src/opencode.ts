import { createOpencodeClient } from "@opencode-ai/sdk";

import type { AppConfig, PersistedState } from "./types.js";
import { StateStore } from "./state.js";

interface PromptPart {
  type?: string;
  text?: string;
  [key: string]: unknown;
}

interface AssistantMessageInfo {
  id: string;
  role: string;
  sessionID: string;
  parentID?: string;
  finish?: string;
  time?: {
    created?: number;
    completed?: number;
  };
  error?: unknown;
}

interface PermissionRequest {
  id: string;
  type: string;
  pattern?: string | string[];
  sessionID: string;
  messageID: string;
  title: string;
  time?: {
    created?: number;
  };
}

interface SessionMessageListEntry {
  info: AssistantMessageInfo;
  parts?: PromptPart[];
}

interface OutcomeTracker {
  latestAssistantMessageId?: string;
  latestAssistantCreatedAt?: number;
  expectedMessageId?: string;
}

interface StreamEventPayload {
  type: string;
  properties: Record<string, unknown>;
}

interface ToolPartEvent {
  type: "tool";
  tool: string;
  state: {
    status: "pending" | "running" | "completed" | "error";
    title?: string;
    error?: string;
  };
}

interface TextPartEvent {
  type: "text";
  text: string;
  metadata?: {
    openai?: {
      phase?: string;
    };
  };
}

export type PermissionResponse = "once" | "always" | "reject";

const OPENCODE_COMPLETION_POLL_MS = 3000;

export type TurnOutcome =
  | {
      kind: "completed";
      text: string;
    }
  | {
      kind: "permission";
      permission: {
        sessionId: string;
        permissionId: string;
        messageId: string;
        title: string;
        type: string;
        pattern: string;
      };
    };

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
  sessionDirectory?: string;
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

  async sendTurnWithApproval(
    channel: string,
    input: TurnInput,
  ): Promise<TurnOutcome> {
    const sessionId = await this.getOrCreateSessionId(channel, input);
    const body = buildPromptBody(channel, input);

    return this.waitForOutcome(sessionId, async () => {
      await this.ensureSuccess(
        this.client.session.promptAsync({
          path: { id: sessionId },
          body: {
            model: HARDCODED_MODEL,
            parts: [{ type: "text", text: body }],
          },
        }),
      );
    });
  }

  async resolvePermission(
    sessionId: string,
    permissionId: string,
    messageId: string,
    response: PermissionResponse,
  ): Promise<TurnOutcome> {
    return this.waitForOutcome(
      sessionId,
      async () => {
        await this.ensureSuccess(
          this.client.postSessionIdPermissionsPermissionId({
            path: {
              id: sessionId,
              permissionID: permissionId,
            },
            body: { response },
          }),
        );
      },
      messageId,
    );
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
        query: input.sessionDirectory
          ? { directory: input.sessionDirectory }
          : undefined,
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

  private async waitForOutcome(
    sessionId: string,
    trigger: () => Promise<void>,
    expectedMessageId?: string,
  ): Promise<TurnOutcome> {
    const controller = new AbortController();
    const stream = await this.client.event.subscribe({ signal: controller.signal });
    const tracker: OutcomeTracker = { expectedMessageId };
    const loggedToolStates = new Map<string, string>();
    const loggedTextParts = new Set<string>();
    const startedAt = Date.now();
    let lastPolledAt = startedAt;

    try {
      await trigger();

      for await (const rawEvent of stream.stream) {
        if (Date.now() - lastPolledAt >= OPENCODE_COMPLETION_POLL_MS) {
          const polled = await this.pollForCompletedOutcome(
            sessionId,
            tracker,
            startedAt,
          );
          lastPolledAt = Date.now();
          if (polled) return polled;
        }

        const payload = rawEvent as unknown as StreamEventPayload;

        if (payload.type === "permission.updated") {
          const permission = payload.properties as unknown as PermissionRequest;
          if (permission.sessionID !== sessionId) continue;
          if (!isRelevantPermission(permission, tracker, startedAt)) {
            continue;
          }

          return {
            kind: "permission",
            permission: {
              sessionId: permission.sessionID,
              permissionId: permission.id,
              messageId: permission.messageID,
              title: permission.title,
              type: permission.type,
              pattern: normalizePattern(permission.pattern),
            },
          };
        }

        if (payload.type === "message.updated") {
          const info = (payload.properties as { info?: AssistantMessageInfo }).info;
          if (!info || info.role !== "assistant" || info.sessionID !== sessionId) {
            continue;
          }

          if (!isRelevantAssistantMessage(info, tracker, startedAt)) continue;

          updateOutcomeTracker(tracker, info);
          if (!info.time?.completed && !info.error) continue;
          if (!isTerminalAssistantMessage(info)) continue;

          return this.readAssistantMessage(sessionId, info.id);
        }

        if (payload.type === "message.part.updated") {
          const part = (payload.properties as { part?: unknown }).part;
          if (!part || typeof part !== "object") continue;

          const sessionPart = part as {
            sessionID?: string;
            messageID?: string;
            time?: { start?: number };
          };
          if (sessionPart.sessionID !== sessionId) continue;
          if (!isRelevantPart(sessionPart, tracker, startedAt)) continue;

          this.logProgressPart(
            part as ToolPartEvent | TextPartEvent,
            loggedToolStates,
            loggedTextParts,
          );
          continue;
        }

        if (payload.type === "session.error") {
          const properties = payload.properties as {
            sessionID?: string;
            error?: unknown;
          };
          if (properties.sessionID && properties.sessionID !== sessionId) continue;
          throw new Error(extractErrorMessage(properties.error));
        }
      }

      const finalPolled = await this.pollForCompletedOutcome(
        sessionId,
        tracker,
        startedAt,
      );
      if (finalPolled) return finalPolled;

      throw new Error("OpenCode event stream ended before the session completed");
    } finally {
      controller.abort();
    }
  }

  private logProgressPart(
    part: ToolPartEvent | TextPartEvent,
    loggedToolStates: Map<string, string>,
    loggedTextParts: Set<string>,
  ): void {
    if (part.type === "tool") {
      const label = part.state.title?.trim() || part.tool;
      const nextState = part.state.status;
      const key = `${part.tool}:${label}`;

      if (loggedToolStates.get(key) === nextState) return;
      loggedToolStates.set(key, nextState);

      if (nextState === "running") {
        console.log(`[opencode] tool running: ${label}`);
        return;
      }

      if (nextState === "completed") {
        console.log(`[opencode] tool completed: ${label}`);
        return;
      }

      if (nextState === "error") {
        console.log(
          `[opencode] tool failed: ${label}${part.state.error ? ` - ${part.state.error}` : ""}`,
        );
      }
      return;
    }

    if (part.type !== "text") return;
    if (part.metadata?.openai?.phase !== "commentary") return;

    const text = part.text.trim();
    if (!text || loggedTextParts.has(text)) return;
    loggedTextParts.add(text);
    console.log(`[opencode] ${text}`);
  }

  private async readAssistantMessage(
    sessionId: string,
    messageId: string,
  ): Promise<TurnOutcome> {
    const response = await this.unwrap<{
      info: AssistantMessageInfo;
      parts?: PromptPart[];
    }>(
      this.client.session.message({
        path: {
          id: sessionId,
          messageID: messageId,
        },
      }),
    );

    if (response.info.error) {
      throw new Error(extractErrorMessage(response.info.error));
    }

    return {
      kind: "completed",
      text: extractText(response.parts) || "No response text returned.",
    };
  }

  private async pollForCompletedOutcome(
    sessionId: string,
    tracker: OutcomeTracker,
    startedAt: number,
  ): Promise<TurnOutcome | undefined> {
    const status = await this.unwrap<Record<string, { type?: string }>>(
      this.client.session.status(),
    );

    const sessionStatus = status[sessionId]?.type;
    if (sessionStatus && sessionStatus !== "idle") {
      return undefined;
    }

    const messages = await this.unwrapMessages(
      this.client.session.messages({
        path: { id: sessionId },
      }),
    );

    const latestAssistant = findLatestCompletedAssistantMessage(
      messages,
      tracker,
      startedAt,
    );

    if (!latestAssistant) return undefined;

    return this.readAssistantMessage(sessionId, latestAssistant.info.id);
  }

  private async unwrapMessages(
    promise: Promise<ApiResult<unknown>>,
  ): Promise<SessionMessageListEntry[]> {
    const data = await this.unwrap<unknown>(promise);

    if (Array.isArray(data)) {
      return data as SessionMessageListEntry[];
    }

    if (
      data &&
      typeof data === "object" &&
      "info" in data &&
      Array.isArray((data as { info: unknown }).info)
    ) {
      return (data as { info: SessionMessageListEntry[] }).info;
    }

    return [];
  }

  private async unwrap<T>(promise: Promise<ApiResult<T>>): Promise<T> {
    const result = await this.ensureSuccess(promise);
    if (result.data === undefined) {
      throw new Error("OpenCode request returned no data");
    }
    return result.data;
  }

  private async ensureSuccess<T>(promise: Promise<ApiResult<T>>): Promise<ApiResult<T>> {
    const result = await promise;
    if (result.error) {
      throw new Error(extractErrorMessage(result.error));
    }
    return result;
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

function normalizePattern(pattern: string | string[] | undefined): string {
  if (!pattern) return "";
  return Array.isArray(pattern) ? pattern.join(", ") : pattern;
}

function findLatestCompletedAssistantMessage(
  messages: SessionMessageListEntry[],
  tracker: OutcomeTracker,
  startedAt: number,
): SessionMessageListEntry | undefined {
  const candidates = messages.filter((entry) => {
    const info = entry.info;
    if (info.role !== "assistant") return false;
    if (!isRelevantAssistantMessage(info, tracker, startedAt)) return false;
    return Boolean(info.time?.completed || info.error);
  });

  const terminalCandidates = candidates.filter((entry) =>
    isTerminalAssistantMessage(entry.info),
  );

  const pool = terminalCandidates.length ? terminalCandidates : candidates;

  return pool.sort((a, b) => {
    const aTime = a.info.time?.completed || a.info.time?.created || 0;
    const bTime = b.info.time?.completed || b.info.time?.created || 0;
    return bTime - aTime;
  })[0];
}

function isTerminalAssistantMessage(info: AssistantMessageInfo): boolean {
  if (info.error) return true;
  return info.finish === "stop";
}

function isRelevantPermission(
  permission: PermissionRequest,
  tracker: OutcomeTracker,
  startedAt: number,
): boolean {
  if (typeof permission.time?.created === "number" && permission.time.created < startedAt) {
    return false;
  }

  if (tracker.expectedMessageId && permission.messageID === tracker.expectedMessageId) {
    return true;
  }

  if (tracker.latestAssistantMessageId && permission.messageID === tracker.latestAssistantMessageId) {
    return true;
  }

  return !tracker.expectedMessageId;
}

function isRelevantAssistantMessage(
  info: AssistantMessageInfo,
  tracker: OutcomeTracker,
  startedAt: number,
): boolean {
  if (typeof info.time?.created === "number" && info.time.created < startedAt) {
    return false;
  }

  if (tracker.expectedMessageId && info.id === tracker.expectedMessageId) {
    return true;
  }

  if (
    tracker.latestAssistantCreatedAt !== undefined &&
    typeof info.time?.created === "number" &&
    info.time.created + 1 < tracker.latestAssistantCreatedAt
  ) {
    return false;
  }

  return true;
}

function isRelevantPart(
  part: { messageID?: string; time?: { start?: number } },
  tracker: OutcomeTracker,
  startedAt: number,
): boolean {
  if (typeof part.time?.start === "number" && part.time.start < startedAt) {
    return false;
  }

  if (tracker.latestAssistantMessageId && part.messageID === tracker.latestAssistantMessageId) {
    return true;
  }

  if (tracker.expectedMessageId && part.messageID === tracker.expectedMessageId) {
    return true;
  }

  return tracker.latestAssistantMessageId === undefined && tracker.expectedMessageId === undefined;
}

function updateOutcomeTracker(
  tracker: OutcomeTracker,
  info: AssistantMessageInfo,
): void {
  const createdAt = info.time?.created;
  if (typeof createdAt !== "number") {
    tracker.latestAssistantMessageId = info.id;
    return;
  }

  if (
    tracker.latestAssistantCreatedAt === undefined ||
    createdAt >= tracker.latestAssistantCreatedAt
  ) {
    tracker.latestAssistantCreatedAt = createdAt;
    tracker.latestAssistantMessageId = info.id;
  }
}
