import { Codex, type Thread, type ThreadOptions } from "@openai/codex-sdk";

import type { AppConfig, PersistedState } from "./types.js";
import type { AgentSession, TurnInput } from "./session.js";
import { getBackendSessionMap, setBackendSessionMap } from "./session-state.js";
import { StateStore } from "./state.js";

export class CodexSession implements AgentSession {
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
    const thread = await this.getOrCreateThread(sessionKey);
    const turn = await thread.run(prompt);
    await this.persistThreadId(sessionKey, thread);
    return turn.finalResponse.trim() || "No response text returned.";
  }

  private async getOrCreateThread(sessionKey: string): Promise<Thread> {
    let promise = this.threadPromises.get(sessionKey);
    if (!promise) {
      promise = this.loadOrCreateThread(sessionKey);
      this.threadPromises.set(sessionKey, promise);
    }
    return promise;
  }

  private async loadOrCreateThread(sessionKey: string): Promise<Thread> {
    const state = await this.loadState();
    const sessions = getBackendSessionMap(state, "codex");
    const threadId = sessions[sessionKey];
    const options = buildThreadOptions(this.config);

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
    const sessions = getBackendSessionMap(state, "codex");
    if (sessions[sessionKey] === threadId) return;

    sessions[sessionKey] = threadId;
    await this.saveState(setBackendSessionMap(state, "codex", sessions));
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

function buildThreadOptions(config: AppConfig): ThreadOptions {
  return {
    model: config.agentDefaultModel,
    workingDirectory: process.cwd(),
    approvalPolicy: config.codexApprovalPolicy,
    sandboxMode: config.codexSandboxMode,
    ...(config.codexReasoningEffort
      ? { modelReasoningEffort: config.codexReasoningEffort }
      : {}),
    ...(config.codexNetworkAccessEnabled !== undefined
      ? { networkAccessEnabled: config.codexNetworkAccessEnabled }
      : {}),
    ...(config.codexAdditionalDirectories.length
      ? { additionalDirectories: config.codexAdditionalDirectories }
      : {}),
  };
}
