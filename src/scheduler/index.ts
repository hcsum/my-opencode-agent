import { SchedulerApi } from "./api.js";
import { ScheduledTaskExecutor } from "./executor.js";
import { SchedulerRuntime } from "./runtime.js";
import type { GmailBridge } from "../gmail.js";
import type { OpencodeSession } from "../opencode.js";
import type { SerialQueue } from "../queue.js";
import type { AppConfig } from "../types.js";

export interface SchedulerDeps {
  config: AppConfig;
  opencode: OpencodeSession;
  queue: SerialQueue;
  bridge: GmailBridge;
}

export interface Scheduler {
  stop(): Promise<void>;
}

export async function launchScheduler(deps: SchedulerDeps): Promise<Scheduler> {
  const executor = new ScheduledTaskExecutor({
    config: deps.config,
    opencode: deps.opencode,
    queue: deps.queue,
  });

  const runtime = new SchedulerRuntime({ executor, bridge: deps.bridge });
  runtime.start();

  const api = new SchedulerApi({ config: deps.config, runtime });
  await api.start();

  return {
    async stop() {
      await api.stop();
      await runtime.stop();
    },
  };
}

export type { ScheduledTask, ScheduledResultPayload } from "./types.js";
