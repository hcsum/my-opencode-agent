export interface AppConfig {
  telegramBotToken: string;
  telegramAllowedChatId: number;
  opencodeBaseUrl: string;
  opencodeServerUsername?: string;
  opencodeServerPassword?: string;
  telegramSessionTitle: string;
  stateFile: string;
  gmailTo?: string;
  gmailPollIntervalMs: number;
}

export type WorkflowJobKind = "ingest" | "query" | "lint";

export type WorkflowJobStatus =
  | "pending"
  | "running"
  | "completed"
  | "failed";

export interface WorkflowCommand {
  kind: WorkflowJobKind;
  target: string;
  rawText: string;
  resolvedTarget?: string;
}

export interface PersistedState {
  sessionId?: string;
  sessions?: Record<string, string>;
  updatedAt?: string;
}

export interface QueueJob<T> {
  label: string;
  run: () => Promise<T>;
  resolve: (value: T | PromiseLike<T>) => void;
  reject: (reason?: unknown) => void;
}
