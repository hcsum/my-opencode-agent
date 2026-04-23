import { Codex, type Thread, type ThreadOptions } from "@openai/codex-sdk";

import type { AppConfig, PersistedState } from "./types.js";
import { StateStore } from "./state.js";

export interface TurnInput {
  text: string;
  senderName: string;
  chatTitle?: string;
  timestamp: Date;
  sessionKey?: string;
}

export class CodexSession {
  private readonly client: Codex;
  private readonly stateStore: StateStore;
  private readonly threadPromises = new Map<string, Promise<Thread>>();
  private stateCache?: PersistedState;

  constructor(private readonly config: AppConfig) {
    this.client = new Codex({
      ...(config.codexApiKey ? { apiKey: config.codexApiKey } : {}),
      ...(config.codexBaseUrl ? { baseUrl: config.codexBaseUrl } : {}),
      ...(config.codexPathOverride
        ? { codexPathOverride: config.codexPathOverride }
        : {}),
    });
    this.stateStore = new StateStore(config.stateFile);
  }

  async healthcheck(): Promise<void> {
    console.log("[codex] session client ready");
  }

  async sendTurn(channel: string, input: TurnInput): Promise<string> {
    const sessionKey = input.sessionKey || channel;
    const prompt = buildPromptBody(channel, input);

    try {
      const thread = await this.getOrCreateThread(channel, sessionKey);
      const turn = await thread.run(prompt);
      await this.persistThreadId(sessionKey, thread);
      return turn.finalResponse.trim() || "No response text returned.";
    } catch (error) {
      if (!shouldRetryWithoutModel(error, channel, this.config.gmailModel)) {
        throw error;
      }

      console.warn(
        `[codex] gmail model "${this.config.gmailModel}" not supported in this auth context; retrying without GMAIL_MODEL`,
      );

      const fallbackThread = await this.getOrCreateThread(
        channel,
        sessionKey,
        true,
      );
      const turn = await fallbackThread.run(prompt);
      await this.persistThreadId(sessionKey, fallbackThread);
      return turn.finalResponse.trim() || "No response text returned.";
    }
  }

  private async getOrCreateThread(
    channel: string,
    sessionKey: string,
    disableGmailModel = false,
  ): Promise<Thread> {
    const threadKey = getThreadMapKey(sessionKey, disableGmailModel);
    let promise = this.threadPromises.get(threadKey);
    if (!promise) {
      promise = this.loadOrCreateThread(channel, sessionKey, disableGmailModel);
      this.threadPromises.set(threadKey, promise);
    }
    return promise;
  }

  private async loadOrCreateThread(
    channel: string,
    sessionKey: string,
    disableGmailModel: boolean,
  ): Promise<Thread> {
    const state = await this.loadState();
    const threadId = state.sessions?.[sessionKey];
    const options = buildThreadOptions(this.config, channel, disableGmailModel);

    if (threadId) {
      console.log(`[codex] resuming ${sessionKey} thread ${threadId}`);
      return this.client.resumeThread(threadId, options);
    }

    console.log(`[codex] starting new ${sessionKey} thread`);
    return this.client.startThread(options);
  }

  private async persistThreadId(sessionKey: string, thread: Thread): Promise<void> {
    const threadId = thread.id;
    if (!threadId) return;

    const state = await this.loadState();
    const sessions = state.sessions || {};
    if (sessions[sessionKey] === threadId) return;

    sessions[sessionKey] = threadId;
    await this.saveState({ ...state, sessions });
    console.log(`[codex] persisted ${sessionKey} thread ${threadId}`);
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

function buildThreadOptions(
  config: AppConfig,
  channel: string,
  disableGmailModel: boolean,
): ThreadOptions {
  return {
    workingDirectory: process.cwd(),
    approvalPolicy: config.codexApprovalPolicy,
    sandboxMode: config.codexSandboxMode,
    ...(config.codexReasoningEffort
      ? { modelReasoningEffort: config.codexReasoningEffort }
      : {}),
    ...(config.codexNetworkAccessEnabled !== undefined
      ? { networkAccessEnabled: config.codexNetworkAccessEnabled }
      : {}),
    ...(channel === "gmail" && !disableGmailModel && config.gmailModel
      ? { model: config.gmailModel }
      : {}),
  };
}

function shouldRetryWithoutModel(
  error: unknown,
  channel: string,
  configuredModel: string | undefined,
): boolean {
  if (channel !== "gmail" || !configuredModel) return false;
  const message = extractErrorMessage(error).toLowerCase();
  return (
    message.includes("model is not supported") &&
    message.includes("chatgpt account")
  );
}

function extractErrorMessage(error: unknown): string {
  if (error instanceof Error) return error.message;
  if (typeof error === "string") return error;
  return "";
}

function getThreadMapKey(sessionKey: string, disableGmailModel: boolean): string {
  return disableGmailModel ? `${sessionKey}|no-model` : sessionKey;
}
