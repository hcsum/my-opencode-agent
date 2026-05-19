export interface AppConfig {
  opencodeBaseUrl: string;
  opencodeServerUsername?: string;
  opencodeServerPassword?: string;
  stateFile: string;
  gmailTo?: string;
  gmailPollIntervalMs: number;
  gmailNewerThan: string;
  opencodeModel?: { providerID: string; modelID: string };
}

export type WorkflowJobKind = "ingest" | "query" | "lint";

export type ThreadRunStatus =
  | "running"
  | "waiting_permission"
  | "waiting_question"
  | "completed"
  | "failed";

export interface QuestionOption {
  label: string;
  description: string;
}

export interface QuestionPrompt {
  question: string;
  header: string;
  options: QuestionOption[];
  multiple?: boolean;
  custom?: boolean;
}

export type IngestLanguageMode = "source-original-wiki-zh" | "all-zh" | "preserve-language";

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
  ingestLanguageMode?: IngestLanguageMode;
}

export interface PersistedState {
  sessions?: Record<string, string>;
  updatedAt?: string;
}

export interface QueueJob<T> {
  label: string;
  run: () => Promise<T>;
  resolve: (value: T | PromiseLike<T>) => void;
  reject: (reason?: unknown) => void;
}
