import type { Config } from "@opencode-ai/sdk";

/**
 * OpenCode server config injected in code at spawn time (passed to
 * createOpencodeServer, which hands it to `opencode serve` via
 * OPENCODE_CONFIG_CONTENT). opencode deep-merges this over the project/global
 * opencode.json, so we only declare what must live in code — custom providers
 * whose secrets can't be checked in.
 *
 * Keeping this in TypeScript (instead of .opencode/opencode.json) lets us read
 * keys from the environment and avoid committing credentials.
 */
export function buildServerConfig(env: NodeJS.ProcessEnv = process.env): Config {
  const config: Config = {};

  const packyApiKey = env.PACKYAPI_API_KEY?.trim();
  if (packyApiKey) {
    config.provider = {
      ...(config.provider ?? {}),
      "packyapi-usage": {
        npm: "@ai-sdk/openai",
        name: "PackyApi-Codex-Usage-Based",
        options: {
          baseURL: "https://www.packyapi.com/v1",
          apiKey: packyApiKey,
          store: false,
          setCacheKey: true,
        },
        models: {
          "gpt-5.2": { name: "gpt-5.2" },
          "gpt-5.2-codex": { name: "gpt-5.2-codex" },
          "gpt-5.3-codex": { name: "gpt-5.3-codex" },
          "gpt-5.4": { name: "gpt-5.4" },
          "gpt-5.4-mini": { name: "gpt-5.4-mini" },
        },
      },
    };
  }

  return config;
}
