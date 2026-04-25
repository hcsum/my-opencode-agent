import type { AppConfig } from "./types.js";
import type { AgentSession } from "./session.js";
import { CodexSession } from "./codex.js";
import { OpencodeSession } from "./opencode.js";

export function createAgentSession(config: AppConfig): AgentSession {
  if (config.agentBackend === "opencode") {
    return new OpencodeSession(config);
  }
  return new CodexSession(config);
}
