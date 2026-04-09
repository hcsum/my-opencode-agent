#!/usr/bin/env npx tsx

import {
  closeBackgroundTab,
  evalInTab,
  openBackgroundTab,
  runScript,
  ScriptResult,
  scrollTab,
} from "../lib/browser.js";

interface ReadHomeInput {
  limit?: number;
}

interface FeedItem {
  author: string;
  text: string;
  url: string;
  time: string;
}

function isPromotedText(text: string): boolean {
  const normalized = text.toLowerCase();
  return normalized.includes("promoted") || normalized.includes("推广");
}

function clampLimit(input?: number): number {
  if (!Number.isFinite(input)) return 40;
  const n = Math.floor(Number(input));
  if (n < 5) return 5;
  if (n > 60) return 60;
  return n;
}

function toMessage(items: FeedItem[]): string {
  const lines: string[] = [];
  lines.push(`Fetched ${items.length} posts from X home feed.`);
  lines.push("Use these posts to summarize themes and highlights:");
  lines.push("");

  for (let i = 0; i < items.length; i += 1) {
    const item = items[i];
    lines.push(`${i + 1}. @${item.author}`);
    lines.push(`text: ${item.text}`);
    if (item.url) lines.push(`url: ${item.url}`);
    if (item.time) lines.push(`time: ${item.time}`);
    lines.push("");
  }

  return lines.join("\n").trim();
}

async function readHomeFeed(input: ReadHomeInput): Promise<ScriptResult> {
  const limit = clampLimit(input.limit);

  let targetId: string | null = null;
  try {
    targetId = await openBackgroundTab("https://x.com/home");

    const isLoginPage = await evalInTab<boolean>(
      targetId,
      `Boolean(document.querySelector('input[autocomplete="username"]'))`,
    );
    if (isLoginPage) {
      return {
        success: false,
        message: "X is not logged in in your current Chrome session.",
      };
    }

    const blocked = await evalInTab<boolean>(
      targetId,
      `(() => {
        const text = (document.body?.innerText || '').toLowerCase();
        return text.includes('something went wrong') ||
          text.includes('try reloading') ||
          text.includes('suspicious activity');
      })()`,
    );
    if (blocked) {
      return {
        success: false,
        message: "X showed a block or challenge page for automated access.",
      };
    }

    const items: FeedItem[] = [];
    const seen = new Set<string>();

    for (let step = 0; step < 10 && items.length < limit; step += 1) {
      const batch = await evalInTab<FeedItem[]>(
        targetId,
        `(() => {
          const out = [];
          const cards = Array.from(document.querySelectorAll('article[data-testid="tweet"]'));

          for (const card of cards) {
            const cardText = (card.textContent || '').trim();
            if (cardText && (${isPromotedText.toString()})(cardText)) continue;

            const text = Array.from(card.querySelectorAll('[data-testid="tweetText"]'))
              .map((el) => (el.textContent || '').trim())
              .join(' ')
              .trim();

            if (!text) continue;

            const statusLink = card.querySelector('a[href*="/status/"]');
            const url = statusLink?.href || '';

            let author = '';
            if (url) {
              const match = url.match(/x\\.com\\/([^/]+)\\/status\\//i);
              author = match?.[1] || '';
            }
            if (!author) {
              const profileLink = card.querySelector('a[href^="/"][role="link"]');
              const href = profileLink?.getAttribute('href') || '';
              const match = href.match(/^\\/([^/]+)$/);
              author = match?.[1] || 'unknown';
            }

            const timeEl = card.querySelector('time');
            const time = timeEl?.getAttribute('datetime') || '';

            out.push({ author, text, url, time });
          }

          return out;
        })()`,
      );

      for (const row of batch) {
        const key = `${row.url}|${row.text.slice(0, 120)}`;
        if (!seen.has(key)) {
          seen.add(key);
          items.push(row);
          if (items.length >= limit) break;
        }
      }

      if (items.length >= limit) break;
      await scrollTab(targetId, { y: 1800, direction: "down" });
    }

    if (items.length === 0) {
      return {
        success: false,
        message: "No feed posts found. X may be blocking or the feed is empty.",
      };
    }

    return {
      success: true,
      message: toMessage(items.slice(0, limit)),
      data: {
        count: Math.min(items.length, limit),
      },
    };
  } finally {
    if (targetId) await closeBackgroundTab(targetId);
  }
}

runScript<ReadHomeInput>(readHomeFeed);
