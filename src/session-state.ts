import type { AgentBackend, PersistedState } from "./types.js";

export function getBackendSessionMap(
  state: PersistedState,
  backend: AgentBackend,
): Record<string, string> {
  if (!state.backendSessions) {
    if (backend === "codex" && state.sessions) {
      return { ...state.sessions };
    }
    return {};
  }

  return { ...(state.backendSessions[backend] || {}) };
}

export function setBackendSessionMap(
  state: PersistedState,
  backend: AgentBackend,
  sessions: Record<string, string>,
): PersistedState {
  const backendSessions: PersistedState["backendSessions"] = {
    codex: {},
    opencode: {},
    ...(state.backendSessions || {}),
    [backend]: sessions,
  };

  return {
    ...state,
    backendSessions,
    ...(backend === "codex" ? { sessions } : {}),
  };
}
