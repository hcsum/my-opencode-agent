export interface TurnInput {
  text: string;
  senderName: string;
  chatTitle?: string;
  timestamp: Date;
  sessionKey?: string;
}

export interface AgentSession {
  healthcheck(): Promise<void>;
  sendTurn(channel: string, input: TurnInput): Promise<string>;
}
