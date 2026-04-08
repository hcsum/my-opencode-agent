import http from "node:http";

import { config } from "./config.js";

export interface ScriptResult {
  success: boolean;
  message: string;
  data?: unknown;
}

export async function readInput<T>(): Promise<T> {
  return new Promise((resolve, reject) => {
    let data = "";
    process.stdin.setEncoding("utf8");
    process.stdin.on("data", (chunk) => {
      data += chunk;
    });
    process.stdin.on("end", () => {
      try {
        resolve(JSON.parse(data));
      } catch (err) {
        reject(new Error(`Invalid JSON input: ${String(err)}`));
      }
    });
    process.stdin.on("error", reject);
  });
}

export function writeResult(result: ScriptResult): void {
  console.log(JSON.stringify(result));
}

function parseJson(text: string): unknown {
  try {
    return JSON.parse(text);
  } catch {
    return text;
  }
}

export async function callProxy<T = unknown>(input: {
  method: "GET" | "POST";
  endpoint: string;
  query?: Record<string, string | number | boolean | undefined>;
  body?: string;
}): Promise<T> {
  const url = new URL(input.endpoint, config.proxyBaseUrl);
  for (const [key, value] of Object.entries(input.query || {})) {
    if (value == null) continue;
    url.searchParams.set(key, String(value));
  }

  return new Promise<T>((resolve, reject) => {
    const req = http.request(
      url,
      {
        method: input.method,
        timeout: config.timeouts.proxyRequest,
        headers: input.body
          ? {
              "Content-Type": "text/plain",
              "Content-Length": Buffer.byteLength(input.body),
            }
          : undefined,
      },
      (res) => {
        let data = "";
        res.on("data", (chunk) => {
          data += chunk.toString();
        });
        res.on("end", () => {
          const parsed = parseJson(data) as Record<string, unknown>;
          if ((res.statusCode || 500) >= 400) {
            const message =
              typeof parsed?.error === "string"
                ? parsed.error
                : data.trim() ||
                  `Proxy request failed with status ${String(res.statusCode)}`;
            reject(new Error(`${message}\n${config.webAccessHint}`));
            return;
          }
          resolve(parsed as T);
        });
      },
    );

    req.on("timeout", () => {
      req.destroy(new Error("Proxy request timed out"));
    });
    req.on("error", () => reject(new Error(config.webAccessHint)));

    if (input.body) req.write(input.body);
    req.end();
  });
}

export async function openBackgroundTab(url: string): Promise<string> {
  const result = await callProxy<{ targetId?: string }>({
    method: "GET",
    endpoint: "/new",
    query: { url },
  });

  if (!result.targetId) {
    throw new Error("Proxy did not return a targetId");
  }

  return result.targetId;
}

export async function closeBackgroundTab(targetId: string): Promise<void> {
  await callProxy({
    method: "GET",
    endpoint: "/close",
    query: { target: targetId },
  });
}

export async function evalInTab<T = unknown>(
  targetId: string,
  expression: string,
): Promise<T> {
  const result = await callProxy<{ value?: T }>({
    method: "POST",
    endpoint: "/eval",
    query: { target: targetId },
    body: expression,
  });

  return result.value as T;
}

export async function scrollTab(
  targetId: string,
  input: { y?: number; direction?: "down" | "up" | "top" | "bottom" },
): Promise<void> {
  await callProxy({
    method: "GET",
    endpoint: "/scroll",
    query: {
      target: targetId,
      y: input.y,
      direction: input.direction,
    },
  });
}

export async function runScript<T>(
  handler: (input: T) => Promise<ScriptResult>,
): Promise<void> {
  try {
    const input = await readInput<T>();
    const result = await handler(input);
    writeResult(result);
  } catch (err) {
    writeResult({
      success: false,
      message: `Script execution failed: ${err instanceof Error ? err.message : String(err)}`,
    });
    process.exit(1);
  }
}
