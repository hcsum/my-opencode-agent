import type {
  PublicEventPublisher,
  PublicTaskContext,
} from "./public-activity.js";

export class SerialQueue {
  private readonly jobs: Array<() => Promise<void>> = [];
  private running = false;
  private idleWaiters: Array<() => void> = [];

  constructor(private readonly publicActivity?: PublicEventPublisher) {}

  get size(): number {
    return this.jobs.length;
  }

  // True when nothing is executing and nothing is queued. Each in-flight job
  // (Gmail or scheduler) holds the queue open via lease.wait() until the
  // underlying OpenCode run actually completes, so an idle queue means every
  // dispatched LLM run has finished — the signal graceful shutdown waits on.
  get isIdle(): boolean {
    return !this.running && this.jobs.length === 0;
  }

  // Resolves the next time the queue reaches an idle state (immediately if it
  // already is). Used by the shutdown path to let the current task finish.
  whenIdle(): Promise<void> {
    if (this.isIdle) return Promise.resolve();
    return new Promise<void>((resolve) => {
      this.idleWaiters.push(resolve);
    });
  }

  enqueue<T>(
    label: string,
    run: () => Promise<T>,
    publicTask?: PublicTaskContext,
  ): Promise<T> {
    if (publicTask) {
      this.publicActivity?.emit({ type: "task_queued", task: publicTask });
    }

    return new Promise<T>((resolve, reject) => {
      this.jobs.push(async () => {
        try {
          console.log(
            `[queue] start ${label}; remaining=${this.jobs.length - 1}`,
          );
          if (publicTask) {
            this.publicActivity?.emit({ type: "task_started", task: publicTask });
          }
          const result = await run();
          resolve(result);
          console.log(`[queue] done ${label}; remaining=${this.jobs.length}`);
        } catch (error) {
          reject(error);
          console.error(`[queue] failed ${label}`, error);
        }
      });
      this.drain().catch((error) => {
        console.error("[queue] drain failed", error);
      });
    });
  }

  private async drain(): Promise<void> {
    if (this.running) return;
    this.running = true;

    try {
      while (this.jobs.length > 0) {
        const job = this.jobs.shift();
        if (!job) continue;
        await job();
      }
    } finally {
      this.running = false;
      if (this.jobs.length === 0 && this.idleWaiters.length > 0) {
        const waiters = this.idleWaiters;
        this.idleWaiters = [];
        for (const resolve of waiters) resolve();
      }
    }
  }
}
