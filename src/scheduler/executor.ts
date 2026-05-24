import type { GmailRunRequest, RuntimeCallbacks } from "../opencode-runtime.js";
import type { OpencodeSession } from "../opencode.js";
import type { SerialQueue } from "../queue.js";
import type { AppConfig } from "../types.js";
import type { ScheduledTask } from "./types.js";

export interface ExecutorDeps {
  config: AppConfig;
  opencode: OpencodeSession;
  queue: SerialQueue;
}

export interface ExecutorCallbacks {
  onSuccess(text: string): void;
  onFailure(error: string): void;
}

export class ScheduledTaskExecutor {
  constructor(private readonly deps: ExecutorDeps) {}

  // Dispatch a scheduled task into the OpencodeRuntime via the same serial queue
  // the inbound Gmail bridge uses. The promise resolves once the prompt has been
  // dispatched; success/failure flows through the callbacks below.
  async dispatch(
    task: ScheduledTask,
    fireTime: string,
    callbacks: ExecutorCallbacks,
  ): Promise<void> {
    const request = this.buildSyntheticRequest(task, fireTime);
    const runtimeCallbacks = this.buildRuntimeCallbacks(callbacks);

    await this.deps.queue.enqueue(`scheduled ${task.id}`, async () => {
      await this.deps.opencode.startGmailRun(request, runtimeCallbacks);
    });
  }

  private buildSyntheticRequest(
    task: ScheduledTask,
    fireTime: string,
  ): GmailRunRequest {
    const senderEmail = this.deps.config.gmailTo || "scheduler@localhost";
    return {
      threadId: `scheduled-task:${task.id}:${fireTime}`,
      messageId: `scheduled-task:${task.id}:${fireTime}`,
      senderEmail,
      senderName: "Scheduler",
      subject: task.summary,
      rfcMessageId: "",
      textBody: task.prompt,
      timestamp: new Date(fireTime),
      sessionKey: `scheduled-task:${task.id}`,
      sessionTitle: `Scheduled: ${task.summary}`,
    };
  }

  private buildRuntimeCallbacks(
    callbacks: ExecutorCallbacks,
  ): RuntimeCallbacks {
    return {
      onComplete: async (text) => {
        callbacks.onSuccess(text);
      },
      onFailed: async (error) => {
        callbacks.onFailure(error);
      },
      // Scheduled runs have no live conversation to drive interactive flow.
      // Surface the situation as a failure so the user gets a result email.
      onPermission: async () => {
        callbacks.onFailure(
          "Scheduled run aborted: required interactive permission approval, which is not available for scheduled tasks.",
        );
      },
      onQuestion: async () => {
        callbacks.onFailure(
          "Scheduled run aborted: required a follow-up question, which is not available for scheduled tasks.",
        );
      },
    };
  }
}
