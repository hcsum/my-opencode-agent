import { Telegraf } from "telegraf";

import type { AppConfig } from "./types.js";
import { SerialQueue } from "./queue.js";
import type { AgentSession } from "./session.js";

export class TelegramBridge {
  private readonly bot: Telegraf;

  constructor(
    private readonly config: AppConfig,
    private readonly session: AgentSession,
    private readonly queue: SerialQueue,
  ) {
    this.bot = new Telegraf(config.telegramBotToken);
    this.registerHandlers();
  }

  async launch(): Promise<void> {
    await this.bot.launch();
    console.log(
      `[telegram] bot running; allowedChat=${this.config.telegramAllowedChatId}`,
    );

    const shutdown = async (signal: string) => {
      console.log(`[app] shutting down on ${signal}`);
      await this.bot.stop(signal);
      process.exit(0);
    };

    process.once("SIGINT", () => {
      void shutdown("SIGINT");
    });
    process.once("SIGTERM", () => {
      void shutdown("SIGTERM");
    });
  }

  private registerHandlers(): void {
    this.bot.on("message", async (ctx) => {
      const chatId = ctx.chat.id;
      if (chatId !== this.config.telegramAllowedChatId) {
        console.warn(`[telegram] ignored chat ${chatId}`);
        return;
      }

      const text = getIncomingText(ctx.message);
      if (!text) {
        await ctx.reply("Text messages only for now.");
        return;
      }

      const senderName = formatSenderName(ctx.message.from);
      const label = `chat=${chatId} from=${senderName}`;
      console.log(`[telegram] enqueue ${label}; queued=${this.queue.size}`);

      try {
        const result = await this.queue.enqueue(label, async () => {
          const startedAt = Date.now();
          const response = await this.session.sendTurn("telegram", {
            text,
            senderName,
            chatTitle: "title" in ctx.chat ? ctx.chat.title : undefined,
            timestamp: new Date(
              (ctx.message.date ?? Math.floor(Date.now() / 1000)) * 1000,
            ),
          });
          console.log(
            `[telegram] completed ${label} in ${Date.now() - startedAt}ms`,
          );
          return response;
        });

        for (const chunk of splitTelegramMessage(result)) {
          await ctx.reply(chunk, {
            link_preview_options: { is_disabled: true },
          });
        }
      } catch (error) {
        console.error("[telegram] failed turn", error);
        await ctx.reply("Andy hit an error. Check service logs.");
      }
    });
  }
}

function getIncomingText(message: unknown): string | undefined {
  if (!message || typeof message !== "object") return undefined;
  const maybeText = (message as { text?: unknown }).text;
  return typeof maybeText === "string" && maybeText.trim()
    ? maybeText
    : undefined;
}

function formatSenderName(
  from:
    | { username?: string; first_name?: string; last_name?: string }
    | undefined,
): string {
  if (!from) return "Unknown";
  if (from.username) return `@${from.username}`;
  const fullName = [from.first_name, from.last_name]
    .filter(Boolean)
    .join(" ")
    .trim();
  return fullName || "Unknown";
}

function splitTelegramMessage(text: string): string[] {
  const maxLength = 4000;
  if (text.length <= maxLength) return [text];

  const chunks: string[] = [];
  let remaining = text;

  while (remaining.length > maxLength) {
    const slice = remaining.slice(0, maxLength);
    const lastBreak = Math.max(slice.lastIndexOf("\n"), slice.lastIndexOf(" "));
    const splitIndex = lastBreak > maxLength * 0.6 ? lastBreak : maxLength;
    chunks.push(remaining.slice(0, splitIndex).trim());
    remaining = remaining.slice(splitIndex).trim();
  }

  if (remaining) chunks.push(remaining);
  return chunks;
}
