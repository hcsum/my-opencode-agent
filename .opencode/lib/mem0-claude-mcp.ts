#!/usr/bin/env -S npx tsx
/**
 * stdio MCP server exposing the shared mem0 store to the Claude Code runtime.
 *
 * This is the Claude-Code-side counterpart of the `search_memories` tool in the
 * OpenCode plugin (.opencode/plugin/mem0-memory.ts). Both reuse the SAME store
 * (getMemory() → Qdrant + Gemini, keyed by user_id), so memory written from
 * either runtime is recalled by the other.
 *
 * Recall stays PULL-BASED: nothing is auto-injected into Claude's context; the
 * model calls `search_memories` when prior user context would help.
 *
 * Registered for Claude Code via the project `.mcp.json` at the repo root.
 */
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";

import { getMemory, USER_ID } from "./mem0-client";

const server = new McpServer({ name: "mem0-memory", version: "1.0.0" });

server.registerTool(
  "search_memories",
  {
    description:
      "Search long-term memory about the user — their preferences, identity, ongoing projects, and how to work with them. Call this at the start of a task when prior user context would help; memory is NOT auto-loaded, so you only see it if you ask. Returns the most relevant remembered facts.",
    inputSchema: {
      query: z.string().describe("what to recall, in natural language"),
      limit: z.number().optional().describe("max facts to return (default 5)"),
    },
  },
  async ({ query, limit }) => {
    const mem = getMemory();
    if (!mem) return { content: [{ type: "text", text: "(memory unavailable)" }] };
    try {
      const r = await mem.search(query, {
        filters: { user_id: USER_ID },
        topK: limit ?? 5,
      });
      const hits = (r.results ?? []).map((m) => `- ${m.memory}`);
      return {
        content: [{ type: "text", text: hits.length ? hits.join("\n") : "(no relevant memory)" }],
      };
    } catch (err) {
      return { content: [{ type: "text", text: `(memory search unavailable: ${String(err)})` }] };
    }
  },
);

async function main() {
  const transport = new StdioServerTransport();
  await server.connect(transport);
}

main();
