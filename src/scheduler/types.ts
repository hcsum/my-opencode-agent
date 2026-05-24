export type ScheduledTaskKind = "cron" | "once";

export type ScheduledTaskStatus = "idle" | "running" | "success" | "error";

export interface ScheduledTaskBase {
  id: string;
  timezone: string;
  prompt: string;
  summary: string;
  enabled: boolean;
  createdAt: string;
  nextRunAt: string | null;
  lastRunAt: string | null;
  runCount: number;
  lastStatus: ScheduledTaskStatus;
  lastError: string | null;
}

export interface ScheduledCronTask extends ScheduledTaskBase {
  kind: "cron";
  cronExpr: string;
  runAt?: undefined;
}

export interface ScheduledOnceTask extends ScheduledTaskBase {
  kind: "once";
  runAt: string;
  cronExpr?: undefined;
}

export type ScheduledTask = ScheduledCronTask | ScheduledOnceTask;

export interface CreateTaskInput {
  kind: ScheduledTaskKind;
  cronExpr?: string;
  runAt?: string;
  timezone?: string;
  prompt: string;
  summary: string;
}

export interface ScheduledResultPayload {
  taskId: string;
  summary: string;
  fireTime: string;
  body: string;
  isError: boolean;
}
