export interface AppConfig {
  telegramBotToken: string;
  telegramAllowedChatId: number;
  channels: string[];
  codexApiKey?: string;
  codexBaseUrl?: string;
  codexPathOverride?: string;
  codexApprovalPolicy?: "never" | "on-request" | "on-failure" | "untrusted";
  codexSandboxMode?: "read-only" | "workspace-write" | "danger-full-access";
  codexReasoningEffort?: "minimal" | "low" | "medium" | "high" | "xhigh";
  codexNetworkAccessEnabled?: boolean;
  codexAdditionalDirectories: string[];
  stateFile: string;
  gmailTo?: string;
  gmailPollIntervalMs: number;
  gmailProxy?: string;
}

export interface PersistedState {
  sessions?: Record<string, string>; // sessionKey -> codex thread id
  updatedAt?: string;
}

export interface QueueJob<T> {
  label: string;
  run: () => Promise<T>;
  resolve: (value: T | PromiseLike<T>) => void;
  reject: (reason?: unknown) => void;
}
