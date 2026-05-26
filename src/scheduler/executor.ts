import type { ExecutionSlot } from "../execution-slot.js";
import type { GmailRunRequest, RuntimeCallbacks } from "../opencode-runtime.js";
import type { OpencodeSession } from "../opencode.js";
import {
  buildPublicTaskContext,
  type PublicEventPublisher,
} from "../public-activity.js";
import type { SerialQueue } from "../queue.js";
import type { AppConfig } from "../types.js";
import type { ScheduledTask } from "./types.js";

export interface ExecutorDeps {
  config: AppConfig;
  opencode: OpencodeSession;
  queue: SerialQueue;
  publicActivity: PublicEventPublisher;
  executionSlot: ExecutionSlot;
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
    const lease = this.deps.executionSlot.begin(request.threadId);
    const runtimeCallbacks = this.buildRuntimeCallbacks(callbacks, lease.release);
    const publicTask = buildPublicTaskContext({
      activityKey: `scheduled:${task.id}`,
      source: "scheduler",
      summary: task.summary,
      textBody: task.prompt,
    });

    this.deps.publicActivity.emit({
      type: "scheduled_report_started",
      task: publicTask,
    });

    await this.deps.queue.enqueue(`scheduled ${task.id}`, async () => {
      try {
        const started = await this.deps.opencode.startGmailRun(request, runtimeCallbacks);
        if (!started.started || started.status !== "running") {
          lease.release();
        }
        await lease.wait();
      } catch (error) {
        lease.release();
        throw error;
      }
    }, publicTask);
  }

  private buildSyntheticRequest(
    task: ScheduledTask,
    fireTime: string,
  ): GmailRunRequest {
    const senderEmail =
      this.deps.config.userEmail ||
      this.deps.config.agentInboxEmail ||
      this.deps.config.gmailTo ||
      "scheduler@localhost";
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
      publicTask: buildPublicTaskContext({
        activityKey: `scheduled:${task.id}`,
        source: "scheduler",
        summary: task.summary,
        textBody: task.prompt,
      }),
    };
  }

  private buildRuntimeCallbacks(
    callbacks: ExecutorCallbacks,
    releaseExecution: () => void,
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
        releaseExecution();
        callbacks.onFailure(
          "Scheduled run aborted: required interactive permission approval, which is not available for scheduled tasks.",
        );
      },
      onQuestion: async () => {
        releaseExecution();
        callbacks.onFailure(
          "Scheduled run aborted: required a follow-up question, which is not available for scheduled tasks.",
        );
      },
      onTerminal: async () => {
        releaseExecution();
      },
    };
  }
}
