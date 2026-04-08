export interface AppConfig {
  telegramBotToken: string;
  telegramAllowedChatId: number;
  opencodeBaseUrl: string;
  opencodeServerUsername?: string;
  opencodeServerPassword?: string;
  telegramSessionTitle: string;
  stateFile: string;
}

export interface PersistedState {
  sessionId?: string;
  updatedAt?: string;
}

export interface QueueJob<T> {
  label: string;
  run: () => Promise<T>;
  resolve: (value: T | PromiseLike<T>) => void;
  reject: (reason?: unknown) => void;
}
