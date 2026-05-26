import type {
  PublicEventPublisher,
  PublicTaskContext,
} from "./public-activity.js";

export class SerialQueue {
  private readonly jobs: Array<() => Promise<void>> = [];
  private running = false;

  constructor(private readonly publicActivity?: PublicEventPublisher) {}

  get size(): number {
    return this.jobs.length;
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
    }
  }
}
