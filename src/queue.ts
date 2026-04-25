export class SerialQueue {
  private readonly jobs: Array<() => Promise<void>> = [];
  private running = false;

  get size(): number {
    return this.jobs.length;
  }

  enqueue<T>(label: string, run: () => Promise<T>): Promise<T> {
    return new Promise<T>((resolve, reject) => {
      this.jobs.push(async () => {
        const queuedAfterStart = this.jobs.length - 1;
        try {
          console.log(
            `[queue] start ${label}; remaining=${Math.max(queuedAfterStart, 0)}`,
          );
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
