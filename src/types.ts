export interface AppConfig {
  telegramBotToken: string;
  telegramAllowedChatId: number;
  opencodeBaseUrl: string;
  opencodeServerUsername?: string;
  opencodeServerPassword?: string;
  gmailModel?: string;
  telegramSessionTitle: string;
  stateFile: string;
  gmailTo?: string;
  gmailPollIntervalMs: number;
  gmailProxy?: string;
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
