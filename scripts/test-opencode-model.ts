import { createOpencodeClient } from "@opencode-ai/sdk";

type ModelOverride =
  | undefined
  | {
      providerID: string;
      modelID: string;
    };

type ApiResult<T> = {
  data?: T;
  error?: unknown;
};

type SessionRecord = { id: string };
type PromptPart = { type?: string; text?: string };
type PromptResponse = {
  info?: {
    providerID?: string;
    modelID?: string;
    error?: unknown;
  };
  parts?: PromptPart[];
};

const baseUrl = process.env.OPENCODE_BASE_URL || "http://127.0.0.1:4096";
const authHeader = buildBasicAuthHeader(
  process.env.OPENCODE_SERVER_USERNAME,
  process.env.OPENCODE_SERVER_PASSWORD,
);

const client = createOpencodeClient({
  baseUrl,
  fetch: async (request) => {
    const headers = new Headers(request.headers);
    if (authHeader) headers.set("authorization", authHeader);
    return fetch(new Request(request, { headers }));
  },
});

const cases: Array<{ name: string; model: ModelOverride }> = [
  { name: "auto(default from serve)", model: undefined },
  {
    name: "explicit packyapi-usage/gpt-5.4",
    model: { providerID: "packyapi-usage", modelID: "gpt-5.4" },
  },
  {
    name: "explicit openai/gpt-5.4",
    model: { providerID: "openai", modelID: "gpt-5.4" },
  },
];

async function main(): Promise<void> {
  console.log(`[check] OPENCODE_BASE_URL=${baseUrl}`);
  console.log(`[check] auth=${authHeader ? "basic-auth enabled" : "none"}`);

  for (const testCase of cases) {
    await runCase(testCase.name, testCase.model);
  }
}

async function runCase(name: string, model: ModelOverride): Promise<void> {
  console.log(`\n=== ${name} ===`);
  let sessionId = "";

  try {
    const created = await unwrap<SessionRecord>(
      client.session.create({
        body: { title: `model-check ${new Date().toISOString()}` },
      }),
    );
    sessionId = created.id;
    console.log(`[ok] created session=${sessionId}`);

    const result = await unwrap<PromptResponse>(
      client.session.prompt({
        path: { id: sessionId },
        body: {
          model,
          parts: [{ type: "text", text: "say ok" }],
        },
      }),
    );

    if (result.info?.error) {
      console.log("[fail] prompt info.error:");
      console.log(formatError(result.info.error));
      return;
    }

    const usedProvider = result.info?.providerID || "unknown-provider";
    const usedModel = result.info?.modelID || "unknown-model";
    const text = extractText(result.parts);

    console.log(`[ok] used=${usedProvider}/${usedModel}`);
    console.log(`[ok] text=${JSON.stringify(text)}`);
  } catch (error) {
    console.log("[fail] request error:");
    console.log(formatError(error));
  }
}

async function unwrap<T>(promise: Promise<ApiResult<T>>): Promise<T> {
  const result = await promise;
  if (result.error) {
    throw result.error;
  }
  if (result.data === undefined) {
    throw new Error("OpenCode request returned no data");
  }
  return result.data;
}

function extractText(parts: PromptPart[] | undefined): string {
  if (!parts?.length) return "";
  return parts
    .map((p) => (typeof p.text === "string" ? p.text : ""))
    .filter(Boolean)
    .join("\n")
    .trim();
}

function buildBasicAuthHeader(
  username?: string,
  password?: string,
): string | undefined {
  const user = username?.trim() || "opencode";
  const pass = password?.trim();
  if (!pass) return undefined;
  return `Basic ${Buffer.from(`${user}:${pass}`).toString("base64")}`;
}

function formatError(error: unknown): string {
  try {
    return JSON.stringify(error, null, 2);
  } catch {
    return String(error);
  }
}

void main().catch((error) => {
  console.error("[fatal]", formatError(error));
  process.exit(1);
});
