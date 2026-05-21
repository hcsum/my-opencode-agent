import type {
  AssistantMessage,
  Message,
  Part,
  PermissionRequest,
  QuestionInfo,
} from "@opencode-ai/sdk/v2/client";
import type { OpencodeClient } from "@opencode-ai/sdk/v2/client";

import {
  clearPendingPermission,
  clearPendingQuestion,
  getThreadRun,
  type PendingQuestionRecord,
  type ThreadRunRecord,
  updateThreadRunStatus,
  upsertPendingPermission,
  upsertPendingQuestion,
  upsertThreadRun,
} from "./db.js";
import type { AppConfig, QuestionPrompt, ThreadRunStatus } from "./types.js";

const RUN_TIMEOUT_MS = 8 * 60 * 1000;
const POLL_INTERVAL_MS = 3000;
const STREAM_IDLE_TIMEOUT_MS = 45000;

export type PermissionResponse = "once" | "always" | "reject";

export interface GmailRunRequest {
  threadId: string;
  messageId: string;
  senderEmail: string;
  senderName: string;
  subject: string;
  rfcMessageId: string;
  textBody: string;
  timestamp: Date;
  sessionKey: string;
  sessionTitle: string;
}

export interface RuntimePermissionRequest {
  threadId: string;
  sessionId: string;
  permissionId: string;
  messageId: string;
  title: string;
  type: string;
  pattern: string;
}

export interface RuntimeQuestionRequest {
  threadId: string;
  sessionId: string;
  questionId: string;
  messageId: string;
  questions: QuestionPrompt[];
}

export interface RuntimeCallbacks {
  onPermission(request: RuntimePermissionRequest): Promise<void>;
  onQuestion(request: RuntimeQuestionRequest): Promise<void>;
  onComplete(text: string): Promise<void>;
  onFailed(error: string): Promise<void>;
}

export interface RuntimeSessionManager {
  getOrCreateSessionId(request: {
    channel: string;
    sessionKey: string;
    sessionTitle: string;
    sessionDirectory?: string;
  }): Promise<string>;
  invalidateSession(sessionKey: string): Promise<void>;
}

interface ActiveRun {
  threadId: string;
  sessionKey: string;
  sessionId: string;
  startedAtMs: number;
  updatedAtMs: number;
  callbacks: RuntimeCallbacks;
  status: ThreadRunStatus;
  latestAssistantMessageId?: string;
  latestAssistantCreatedAt?: number;
  finalizing: boolean;
  meta: ThreadRunRecord;
}

interface StreamEventPayload {
  type: string;
  properties: Record<string, unknown>;
}

interface ToolPartEvent {
  type: "tool";
  tool: string;
  state?: {
    status?: "pending" | "running" | "completed" | "error";
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

export class OpencodeRuntime {
  private readonly activeRuns = new Map<string, ActiveRun>();
  private readonly sessionToThread = new Map<string, string>();
  private pollTimer: ReturnType<typeof setInterval> | null = null;
  private streamWatchdog: ReturnType<typeof setInterval> | null = null;
  private streamAbort?: AbortController;
  private streamLoopStarted = false;
  private lastEventAt = Date.now();

  constructor(
    private readonly client: OpencodeClient,
    private readonly config: AppConfig,
    private readonly sessionManager: RuntimeSessionManager,
  ) {}

  async startRun(
    request: GmailRunRequest,
    callbacks: RuntimeCallbacks,
  ): Promise<{ started: boolean; status: ThreadRunStatus }> {
    const existing = this.activeRuns.get(request.threadId) || this.restoreActiveRun(request.threadId, callbacks);
    if (existing && isActiveStatus(existing.status)) {
      existing.callbacks = callbacks;
      return { started: false, status: existing.status };
    }

    const startedAtMs = Date.now();
    const sessionId = await this.getFreshSessionId(request);
    const meta: ThreadRunRecord = {
      threadId: request.threadId,
      sessionKey: request.sessionKey,
      sessionId,
      gmailMessageId: request.messageId,
      senderEmail: request.senderEmail,
      senderName: request.senderName,
      subject: request.subject,
      rfcMessageId: request.rfcMessageId,
      lastUserText: request.textBody,
      status: "running",
      lastError: "",
      startedAtMs,
      updatedAtMs: startedAtMs,
    };

    upsertThreadRun(meta);
    const run = this.installRun(meta, callbacks);
    this.ensureBackgroundLoops();

    try {
        await this.ensureSuccess(
        this.client.session.promptAsync({
          sessionID: sessionId,
          ...(this.config.opencodeModel ? { model: this.config.opencodeModel } : {}),
          parts: [{ type: "text", text: request.textBody }],
        }),
      );
    } catch (error) {
      this.removeRun(request.threadId);
      updateThreadRunStatus({
        threadId: request.threadId,
        status: "failed",
        lastError: extractErrorMessage(error),
      });
      throw error;
    }

    return { started: true, status: "running" };
  }

  async resumeRun(threadId: string, callbacks: RuntimeCallbacks): Promise<boolean> {
    const existing = this.activeRuns.get(threadId);
    if (existing) {
      existing.callbacks = callbacks;
      return true;
    }

    const restored = this.restoreActiveRun(threadId, callbacks);
    if (!restored) return false;
    this.ensureBackgroundLoops();
    return true;
  }

  hasActiveRun(threadId: string): boolean {
    const current = this.activeRuns.get(threadId);
    if (current) {
      return isActiveStatus(current.status);
    }

    const persisted = getThreadRun(threadId);
    return Boolean(persisted && isActiveStatus(persisted.status));
  }

  async replyPermission(
    threadId: string,
    permissionId: string,
    response: PermissionResponse,
    callbacks: RuntimeCallbacks,
  ): Promise<void> {
    const run = await this.requireRun(threadId, callbacks);
    await this.ensureSuccess(
      this.client.permission.reply({
        requestID: permissionId,
        reply: response,
      }),
    );
    clearPendingPermission(threadId);
    this.resumeRunClock(run);
    this.updateRunState(run, "running");
  }

  async replyQuestion(
    threadId: string,
    questionId: string,
    answers: string[][],
    callbacks: RuntimeCallbacks,
  ): Promise<void> {
    const run = await this.requireRun(threadId, callbacks);
    await this.ensureSuccess(
      this.client.question.reply({
        requestID: questionId,
        answers,
      }),
    );
    clearPendingQuestion(threadId);
    this.resumeRunClock(run);
    this.updateRunState(run, "running");
  }

  // Reset the timeout baseline when the model resumes work after a human pause.
  // Without this, time spent waiting on the user counts against RUN_TIMEOUT_MS,
  // so a long approval forces an immediate fail on the very next poll.
  private resumeRunClock(run: ActiveRun): void {
    const now = Date.now();
    run.startedAtMs = now;
    run.meta = { ...run.meta, startedAtMs: now };
  }

  private restoreActiveRun(
    threadId: string,
    callbacks: RuntimeCallbacks,
  ): ActiveRun | undefined {
    const persisted = getThreadRun(threadId);
    if (!persisted || !isActiveStatus(persisted.status)) {
      return undefined;
    }

    return this.installRun(persisted, callbacks);
  }

  private installRun(meta: ThreadRunRecord, callbacks: RuntimeCallbacks): ActiveRun {
    const run: ActiveRun = {
      threadId: meta.threadId,
      sessionKey: meta.sessionKey,
      sessionId: meta.sessionId,
      startedAtMs: meta.startedAtMs,
      updatedAtMs: meta.updatedAtMs,
      callbacks,
      status: meta.status,
      finalizing: false,
      meta,
    };

    this.activeRuns.set(meta.threadId, run);
    this.sessionToThread.set(meta.sessionId, meta.threadId);
    return run;
  }

  private removeRun(threadId: string): void {
    const run = this.activeRuns.get(threadId);
    if (!run) return;
    this.sessionToThread.delete(run.sessionId);
    this.activeRuns.delete(threadId);
  }

  private updateRunState(
    run: ActiveRun,
    status: ThreadRunStatus,
    lastError = "",
  ): void {
    run.status = status;
    run.updatedAtMs = Date.now();
    run.meta = {
      ...run.meta,
      status,
      lastError,
      updatedAtMs: run.updatedAtMs,
    };
    upsertThreadRun(run.meta);
  }

  private ensureBackgroundLoops(): void {
    if (!this.pollTimer) {
      this.pollTimer = setInterval(() => {
        void this.pollActiveRuns();
      }, POLL_INTERVAL_MS);
    }

    if (!this.streamWatchdog) {
      this.streamWatchdog = setInterval(() => {
        if (this.activeRuns.size === 0) return;
        if (Date.now() - this.lastEventAt < STREAM_IDLE_TIMEOUT_MS) return;
        console.warn("[opencode-runtime] event stream idle; reconnecting");
        this.streamAbort?.abort();
      }, 5000);
    }

    if (!this.streamLoopStarted) {
      this.streamLoopStarted = true;
      void this.streamLoop();
    }
  }

  private async streamLoop(): Promise<void> {
    while (true) {
      const controller = new AbortController();
      this.streamAbort = controller;

      try {
        const stream = await this.client.event.subscribe(undefined, {
          signal: controller.signal,
        });

        // Reset on reconnect — otherwise the watchdog aborts again on its next 5s tick.
        this.lastEventAt = Date.now();

        for await (const rawEvent of stream.stream) {
          this.lastEventAt = Date.now();
          await this.handleEvent(rawEvent as unknown as StreamEventPayload);
        }
      } catch (error) {
        if (controller.signal.aborted) {
          continue;
        }
        console.error("[opencode-runtime] event stream failed", error);
      }

      await sleep(1000);
    }
  }

  private async handleEvent(event: StreamEventPayload): Promise<void> {
    if (event.type === "permission.asked") {
      await this.handlePermissionEvent(event.properties as unknown as PermissionRequest);
      return;
    }

    if (event.type === "question.asked") {
      await this.handleQuestionEvent(
        event.properties as unknown as {
          id: string;
          sessionID: string;
          tool?: { messageID?: string };
          questions: QuestionInfo[];
        },
      );
      return;
    }

    if (event.type === "message.updated") {
      const props = event.properties as { sessionID: string; info: Message };
      if (props.info.role !== "assistant") return;
      const threadId = this.sessionToThread.get(props.sessionID);
      if (!threadId) return;
      const run = this.activeRuns.get(threadId);
      if (!run) return;
      this.trackAssistant(run, props.info as AssistantMessage);
      await this.maybeFinalizeAssistant(run, props.info as AssistantMessage);
      return;
    }

    if (event.type === "message.part.updated") {
      const props = event.properties as { sessionID: string; part: Part };
      const threadId = this.sessionToThread.get(props.sessionID);
      if (!threadId) return;
      this.logProgressPart(props.part as unknown as ToolPartEvent | TextPartEvent);
      return;
    }

    if (event.type === "session.error") {
      const props = event.properties as { sessionID?: string; error?: unknown };
      if (!props.sessionID) return;
      const threadId = this.sessionToThread.get(props.sessionID);
      if (!threadId) return;
      await this.failRun(threadId, extractErrorMessage(props.error));
    }
  }

  private async handlePermissionEvent(permission: PermissionRequest): Promise<void> {
    const threadId = this.sessionToThread.get(permission.sessionID);
    if (!threadId) return;

    const run = this.activeRuns.get(threadId);
    if (!run) return;

    const request: RuntimePermissionRequest = {
      threadId,
      sessionId: permission.sessionID,
      permissionId: permission.id,
      messageId: permission.tool?.messageID || run.latestAssistantMessageId || "",
      title: buildPermissionTitle(permission),
      type: permission.permission,
      pattern: permission.patterns.join(", "),
    };

    upsertPendingPermission(request);
    this.updateRunState(run, "waiting_permission");
    await run.callbacks.onPermission(request);
  }

  private async handleQuestionEvent(event: {
    id: string;
    sessionID: string;
    tool?: { messageID?: string };
    questions: QuestionInfo[];
  }): Promise<void> {
    const threadId = this.sessionToThread.get(event.sessionID);
    if (!threadId) return;

    const run = this.activeRuns.get(threadId);
    if (!run) return;

    const request: RuntimeQuestionRequest = {
      threadId,
      sessionId: event.sessionID,
      questionId: event.id,
      messageId: event.tool?.messageID || run.latestAssistantMessageId || "",
      questions: event.questions.map((item) => ({
        question: item.question,
        header: item.header,
        options: item.options,
        multiple: item.multiple,
        custom: item.custom,
      })),
    };

    const persisted: PendingQuestionRecord = {
      threadId,
      sessionId: request.sessionId,
      questionId: request.questionId,
      messageId: request.messageId,
      questions: request.questions,
    };

    upsertPendingQuestion(persisted);
    this.updateRunState(run, "waiting_question");
    await run.callbacks.onQuestion(request);
  }

  private async pollActiveRuns(): Promise<void> {
    if (this.activeRuns.size === 0) return;

    const statusMap = await this.unwrap<Record<string, { type: string }>>(
      this.client.session.status(),
    ).catch((error) => {
      console.error("[opencode-runtime] status poll failed", error);
      return undefined;
    });

    for (const run of this.activeRuns.values()) {
      // Skip timeout while waiting on the user — human approval routinely exceeds RUN_TIMEOUT_MS.
      if (run.status === "waiting_permission" || run.status === "waiting_question") {
        continue;
      }

      if (Date.now() - run.startedAtMs > RUN_TIMEOUT_MS) {
        await this.failRun(
          run.threadId,
          `OpenCode run timed out after ${RUN_TIMEOUT_MS / 60000} minutes`,
        );
        continue;
      }

      const sessionStatus = statusMap?.[run.sessionId]?.type;
      if (sessionStatus === "busy") {
        continue;
      }

      await this.checkMessages(run);
    }
  }

  private async checkMessages(run: ActiveRun): Promise<void> {
    const messages = await this.unwrap<Array<{ info: Message; parts: Part[] }>>(
      this.client.session.messages({ sessionID: run.sessionId }),
    ).catch((error) => {
      void this.handleRecoverableRunError(run, error);
      return undefined;
    });

    if (!messages) return;

    const latest = findLatestCompletedAssistantMessage(messages, run.startedAtMs);
    if (!latest) return;

    this.trackAssistant(run, latest.info);
    await this.completeRun(run, collectMessageText(latest.parts), latest.info.error);
  }

  private trackAssistant(run: ActiveRun, info: AssistantMessage): void {
    const createdAt = info.time.created;
    if (
      run.latestAssistantCreatedAt === undefined ||
      createdAt >= run.latestAssistantCreatedAt
    ) {
      run.latestAssistantCreatedAt = createdAt;
      run.latestAssistantMessageId = info.id;
    }
  }

  private async maybeFinalizeAssistant(
    run: ActiveRun,
    info: AssistantMessage,
  ): Promise<void> {
    if (!isTerminalAssistantMessage(info)) return;
    const response = await this.unwrap<{ info: Message; parts: Part[] }>(
      this.client.session.message({
        sessionID: run.sessionId,
        messageID: info.id,
      }),
    ).catch((error) => {
      void this.handleRecoverableRunError(run, error);
      return undefined;
    });

    if (!response || response.info.role !== "assistant") return;
    await this.completeRun(run, collectMessageText(response.parts), response.info.error);
  }

  private async completeRun(
    run: ActiveRun,
    text: string,
    error?: unknown,
  ): Promise<void> {
    if (run.finalizing) return;
    run.finalizing = true;

    const isError = Boolean(error);
    const errorMessage = error ? extractErrorMessage(error) : "";
    const finalText = text.trim() || "No response text returned.";

    try {
      if (isError) {
        await run.callbacks.onFailed(errorMessage);
      } else {
        await run.callbacks.onComplete(finalText);
      }
    } catch (callbackErr) {
      // Leave the run in activeRuns so the poll loop retries delivery.
      // Re-enter is gated on the next checkMessages tick finding the same terminal message.
      run.finalizing = false;
      console.error(
        `[opencode-runtime] terminal callback failed for thread ${run.threadId}; will retry`,
        callbackErr,
      );
      return;
    }

    clearPendingPermission(run.threadId);
    clearPendingQuestion(run.threadId);
    this.updateRunState(run, isError ? "failed" : "completed", errorMessage);
    this.removeRun(run.threadId);
  }

  private async failRun(threadId: string, message: string): Promise<void> {
    const run = this.activeRuns.get(threadId);
    if (!run) return;
    await this.completeRun(run, "", new Error(message));
  }

  private async handleRecoverableRunError(
    run: ActiveRun,
    error: unknown,
  ): Promise<void> {
    if (isSessionNotFound(error)) {
      await this.sessionManager.invalidateSession(run.sessionKey);
    }
    await this.failRun(run.threadId, extractErrorMessage(error));
  }

  private async requireRun(
    threadId: string,
    callbacks: RuntimeCallbacks,
  ): Promise<ActiveRun> {
    const run = this.activeRuns.get(threadId) || this.restoreActiveRun(threadId, callbacks);
    if (!run) {
      throw new Error(`No active run for thread ${threadId}`);
    }
    run.callbacks = callbacks;
    this.ensureBackgroundLoops();
    return run;
  }

  private async getFreshSessionId(request: GmailRunRequest): Promise<string> {
    try {
      return await this.sessionManager.getOrCreateSessionId({
        channel: "gmail",
        sessionKey: request.sessionKey,
        sessionTitle: request.sessionTitle,
      });
    } catch (error) {
      if (!isSessionNotFound(error)) throw error;
      await this.sessionManager.invalidateSession(request.sessionKey);
      return this.sessionManager.getOrCreateSessionId({
        channel: "gmail",
        sessionKey: request.sessionKey,
        sessionTitle: request.sessionTitle,
      });
    }
  }

  private logProgressPart(part: ToolPartEvent | TextPartEvent): void {
    if (part.type === "tool") {
      const label = part.state?.title?.trim() || part.tool;
      const state = part.state?.status;
      if (state === "running") {
        console.log(`[opencode] tool running: ${label}`);
      } else if (state === "completed") {
        console.log(`[opencode] tool completed: ${label}`);
      } else if (state === "error") {
        console.log(
          `[opencode] tool failed: ${label}${part.state?.error ? ` - ${part.state.error}` : ""}`,
        );
      }
      return;
    }

    if (part.metadata?.openai?.phase !== "commentary") return;
    const text = part.text.trim();
    if (!text) return;
    console.log(`[opencode] ${text}`);
  }

  private async unwrap<T>(promise: Promise<{ data?: T; error?: unknown }>): Promise<T> {
    const result = await this.ensureSuccess(promise);
    if (result.data === undefined) {
      throw new Error("OpenCode request returned no data");
    }
    return result.data;
  }

  private async ensureSuccess<T>(promise: Promise<{ data?: T; error?: unknown }>): Promise<{
    data?: T;
    error?: unknown;
  }> {
    const result = await promise;
    if (result.error) {
      throw new Error(extractErrorMessage(result.error));
    }
    return result;
  }
}

function collectMessageText(parts: Part[]): string {
  return parts
    .filter(
      (part): part is Extract<Part, { type: "text" }> =>
        part.type === "text" && typeof part.text === "string" && !part.ignored,
    )
    .map((part) => part.text)
    .join("")
    .trim();
}

function findLatestCompletedAssistantMessage(
  messages: Array<{ info: Message; parts: Part[] }>,
  startedAtMs: number,
): { info: AssistantMessage; parts: Part[] } | undefined {
  const candidates = messages.filter((entry) => {
    if (entry.info.role !== "assistant") return false;
    if (entry.info.time.created < startedAtMs) return false;
    return isTerminalAssistantMessage(entry.info);
  }) as Array<{ info: AssistantMessage; parts: Part[] }>;

  if (candidates.length === 0) return undefined;

  return candidates.sort((a, b) => {
    const aTime = a.info.time.completed || a.info.time.created;
    const bTime = b.info.time.completed || b.info.time.created;
    return bTime - aTime;
  })[0];
}

function buildPermissionTitle(permission: PermissionRequest): string {
  const metadataTitle = permission.metadata?.title;
  return typeof metadataTitle === "string" && metadataTitle.trim()
    ? metadataTitle.trim()
    : permission.permission;
}

// AI SDK finish reasons that mean "this turn is done; don't expect more."
// "tool-calls" means the model wants another turn after tool results — not terminal.
// Anything outside this set (e.g. a future reason we don't recognize) falls through
// to the run timeout rather than risk a premature finalize.
const TERMINAL_FINISH_REASONS = new Set([
  "stop",
  "length",
  "content-filter",
  "error",
  "other",
  "unknown",
]);

function isTerminalAssistantMessage(info: AssistantMessage): boolean {
  if (info.error) return true;
  if (!info.time.completed) return false;
  return info.finish !== undefined && TERMINAL_FINISH_REASONS.has(info.finish);
}

function isSessionNotFound(err: unknown): boolean {
  return err instanceof Error && err.message.includes("Session not found");
}

function extractErrorMessage(error: unknown): string {
  if (!error) return "OpenCode request failed";
  if (typeof error === "string") return error;
  if (error instanceof Error && error.message.trim()) return error.message;
  if (typeof error === "object" && error !== null) {
    const record = error as Record<string, unknown>;
    if (typeof record.message === "string") return record.message;
    const data = record.data;
    if (typeof data === "object" && data !== null) {
      const dataRecord = data as Record<string, unknown>;
      if (typeof dataRecord.message === "string") return dataRecord.message;
    }
  }
  return "OpenCode request failed";
}

function isActiveStatus(status: ThreadRunStatus): boolean {
  return (
    status === "running" ||
    status === "waiting_permission" ||
    status === "waiting_question"
  );
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
