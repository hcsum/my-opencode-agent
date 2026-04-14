#!/usr/bin/env npx tsx

import {
  closeBackgroundTab,
  evalInTab,
  getTabInfo,
  openBackgroundTab,
  runScript,
  ScriptResult,
} from "./lib/browser.js";
import { EXTRACT_SEARCH_RESULTS_JS } from "./lib/extractors.js";

interface SearchResult {
  title: string;
  url: string;
  preview: string;
}

interface SearchInput {
  action: "search";
  query: string;
}

interface OpenInput {
  action: "open";
  query: string;
  index: number;
}

interface ReadInput {
  action: "read";
  url: string;
}

interface MessagesInput {
  action: "messages";
  query: string;
  group?: string;
  maxLoads?: number;
}

interface MessageRecord {
  author: string;
  date: string;
  body: string;
  replyTo?: string;
}

type Input = SearchInput | OpenInput | ReadInput | MessagesInput;

const INITIAL_PAGE_SETTLE_MS = 4000;
const POLL_INTERVAL_MS = 2000;
const SEARCH_WAIT_TIMEOUT_MS = 30000;
const ARTICLE_WAIT_TIMEOUT_MS = 25000;
const MESSAGES_WAIT_TIMEOUT_MS = 25000;
const CLOSE_LINGER_MS = 8000;
const DEFAULT_MESSAGES_GROUP = "哥飞的朋友们 7 群";
const DEFAULT_MAX_MESSAGE_LOADS = 5;

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function waitForSearchPage(targetId: string): Promise<void> {
  await evalInTab(targetId, "document.body.innerText.slice(0, 100)");
  await sleep(INITIAL_PAGE_SETTLE_MS);

  const deadline = Date.now() + SEARCH_WAIT_TIMEOUT_MS;

  while (Date.now() < deadline) {
    const info = await getTabInfo(targetId);
    const state = await evalInTab<{
      text: string;
      resultCount: number;
    }>(
      targetId,
      `(() => {
        const text = (document.body.innerText || "").slice(0, 4000);
        const resultCount = Array.from(document.querySelectorAll("a[href]")).filter((a) => {
          const href = a.href || "";
          return href.includes("/topic/") || href.includes("/experience/") || href.includes("/tutorial/");
        }).length;
        return { text, resultCount };
      })()`,
    );

    const text = state.text.toLowerCase();
    const hasCfChallenge =
      text.includes("cloudflare") ||
      text.includes("checking your browser") ||
      text.includes("verify you are human") ||
      text.includes("attention required");

    if (info.ready === "complete" && !hasCfChallenge && state.resultCount > 0) {
      return;
    }

    await sleep(POLL_INTERVAL_MS);
  }
}

async function waitForArticlePage(targetId: string): Promise<void> {
  await evalInTab(targetId, "document.body.innerText.slice(0, 100)");
  await sleep(INITIAL_PAGE_SETTLE_MS);

  const deadline = Date.now() + ARTICLE_WAIT_TIMEOUT_MS;

  while (Date.now() < deadline) {
    const info = await getTabInfo(targetId);
    const state = await evalInTab<{
      text: string;
      hasTitle: boolean;
      bodyLength: number;
    }>(
      targetId,
      `(() => {
        const text = (document.body.innerText || "").slice(0, 4000);
        const bodyEl = document.querySelector("article") || document.querySelector("main") || document.querySelector("[class*='content']") || document.querySelector("[class*='prose']") || document.querySelector("#content") || document.querySelector(".content");
        const body = bodyEl ? (bodyEl.textContent || "") : (document.body.innerText || "");
        return {
          text,
          hasTitle: Boolean(document.querySelector("h1") || document.querySelector("h2")),
          bodyLength: body.trim().length,
        };
      })()`,
    );

    const text = state.text.toLowerCase();
    const hasCfChallenge =
      text.includes("cloudflare") ||
      text.includes("checking your browser") ||
      text.includes("verify you are human") ||
      text.includes("attention required");

    if (info.ready === "complete" && !hasCfChallenge && state.hasTitle && state.bodyLength > 200) {
      return;
    }

    await sleep(POLL_INTERVAL_MS);
  }
}

async function waitForMessagesPage(targetId: string): Promise<void> {
  await evalInTab(targetId, "document.body.innerText.slice(0, 100)");
  await sleep(INITIAL_PAGE_SETTLE_MS);

  const deadline = Date.now() + MESSAGES_WAIT_TIMEOUT_MS;

  while (Date.now() < deadline) {
    const info = await getTabInfo(targetId);
    const state = await evalInTab<{
      text: string;
      hasSearchInput: boolean;
      hasGroupList: boolean;
    }>(
      targetId,
      `(() => {
        const text = (document.body.innerText || "").slice(0, 4000);
        const hasSearchInput = Boolean(
          Array.from(document.querySelectorAll("input")).find((el) =>
            (el.getAttribute("placeholder") || "").includes("搜索"),
          ),
        );
        const hasGroupList = text.includes("群聊列表") && text.includes("哥飞的朋友们");
        return { text, hasSearchInput, hasGroupList };
      })()`,
    );

    const text = state.text.toLowerCase();
    const hasCfChallenge =
      text.includes("cloudflare") ||
      text.includes("checking your browser") ||
      text.includes("verify you are human") ||
      text.includes("attention required");

    if (info.ready === "complete" && !hasCfChallenge && state.hasSearchInput && state.hasGroupList) {
      return;
    }

    await sleep(POLL_INTERVAL_MS);
  }
}

async function selectMessagesGroup(targetId: string, groupName: string): Promise<boolean> {
  const result = await evalInTab<{ clicked: boolean }>(
    targetId,
    `(() => {
      const trim = (text) => (text || "").trim();
      const heading = Array.from(document.querySelectorAll("h3")).find((el) =>
        trim(el.textContent).includes(${JSON.stringify(groupName)}),
      );
      const row = heading ? heading.closest("div.cursor-pointer") : null;
      if (!row) return { clicked: false };
      row.click();
      return { clicked: true };
    })()`,
  );

  if (result.clicked) {
    await sleep(2000);
  }

  return result.clicked;
}

async function setMessagesSearchQuery(targetId: string, query: string): Promise<boolean> {
  const result = await evalInTab<{ found: boolean }>(
    targetId,
    `(() => {
      const input = Array.from(document.querySelectorAll("input")).find((el) =>
        (el.getAttribute("placeholder") || "").includes("搜索消息/昵称"),
      );
      if (!input) return { found: false };
      const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, "value")?.set;
      if (!setter) return { found: false };
      setter.call(input, ${JSON.stringify(query)});
      input.focus();
      input.dispatchEvent(new InputEvent("input", { bubbles: true, data: ${JSON.stringify(query)}, inputType: "insertText" }));
      input.dispatchEvent(new Event("change", { bubbles: true }));
      return { found: true };
    })()`,
  );

  if (result.found) {
    await sleep(800);
  }

  return result.found;
}

async function extractVisibleMessages(targetId: string): Promise<{
  group: string;
  paneText: string;
  loadAction: string | null;
}> {
  const expression = `(() => { const trim = (text) => (text || "").trim(); const boxes = Array.from(document.querySelectorAll("div")); const pane = boxes.find((el) => { const style = getComputedStyle(el); return style.overflowY === "auto" && el.scrollHeight > el.clientHeight + 50 && (el.innerText || "").includes("查看更多历史消息"); }); const paneText = trim(pane ? pane.innerText : document.body.innerText); const loadButton = Array.from(document.querySelectorAll("button")).find((btn) => { const text = trim(btn.textContent); return text.includes("加载更多消息") || text.includes("查看更多历史消息"); }); return { group: ${JSON.stringify(DEFAULT_MESSAGES_GROUP)}, paneText, loadAction: loadButton ? trim(loadButton.textContent) : null }; })()`;
  return evalInTab(targetId, expression);
}

async function extractVisibleMessagesWithRetry(targetId: string): Promise<{
  group: string;
  paneText: string;
  loadAction: string | null;
}> {
  let lastError: unknown;

  for (let attempt = 0; attempt < 4; attempt++) {
    try {
      return await extractVisibleMessages(targetId);
    } catch (error) {
      lastError = error;
      await sleep(1200);
    }
  }

  throw lastError instanceof Error ? lastError : new Error(String(lastError));
}

function parseMessagesFromPaneText(paneText: string): MessageRecord[] {
  const text = paneText.replace(/\r/g, "").trim();
  const matches = Array.from(text.matchAll(/(?:^|\n)([^\n]+)\n(\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2})\d*\n\n([\s\S]*?)(?=\n[^\n]+\n\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}\d*\n\n|$)/g));

  return matches
    .map((match) => {
      const author = (match[1] || "").trim();
      const date = (match[2] || "").trim();
      const rawBody = (match[3] || "").trim();
      const parts = rawBody.split(/\n\n+/).map((part) => part.trim()).filter(Boolean);
      return {
        author,
        date,
        body: parts[0] || "",
        replyTo: parts.slice(1).join("\n\n") || "",
      };
    })
    .filter((message) => message.author || message.body);
}

async function scrollMessagesPaneToBottom(targetId: string): Promise<boolean> {
  const result = await evalInTab<{ found: boolean }>(
    targetId,
    `(() => {
      const boxes = Array.from(document.querySelectorAll("div"));
      const pane = boxes.find((el) => {
        const style = getComputedStyle(el);
        return style.overflowY === "auto" && el.scrollHeight > el.clientHeight + 50 && (el.innerText || "").includes("查看更多历史消息");
      });
      if (!pane) return { found: false };
      pane.scrollTop = pane.scrollHeight;
      pane.dispatchEvent(new Event("scroll", { bubbles: true }));
      return { found: true };
    })()`,
  );

  if (result.found) {
    await sleep(1000);
  }

  return result.found;
}

async function clickMessagesLoadButton(targetId: string): Promise<string | null> {
  const result = await evalInTab<{ clicked: boolean; action: string | null }>(
    targetId,
    `(() => {
      const trim = (text) => (text || "").trim();
      const buttons = Array.from(document.querySelectorAll("button"));
      const button =
        buttons.find((btn) => trim(btn.textContent).includes("加载更多消息")) ||
        buttons.find((btn) => trim(btn.textContent).includes("查看更多历史消息"));
      if (!button) return { clicked: false, action: null };
      const action = trim(button.textContent);
      button.click();
      return { clicked: true, action };
    })()`,
  );

  if (result.clicked) {
    await sleep(2500);
  }

  return result.action;
}

function dedupeMessages(messages: MessageRecord[]): MessageRecord[] {
  const seen = new Set<string>();
  const out: MessageRecord[] = [];

  for (const message of messages) {
    const key = `${message.author}\u0000${message.date}\u0000${message.body}\u0000${message.replyTo || ""}`;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(message);
  }

  return out;
}

function filterMessages(messages: MessageRecord[], query: string): MessageRecord[] {
  const q = query.trim();
  if (!q) return [];

  const lowered = q.toLowerCase();
  const exactAuthorMatches = messages.filter((message) => {
    const author = (message.author || "").trim();
    return author === q || author.toLowerCase() === lowered;
  });

  if (exactAuthorMatches.length > 0) {
    return exactAuthorMatches;
  }

  return messages.filter((message) => {
    const haystacks = [message.author, message.body, message.replyTo || ""];
    return haystacks.some((value) => {
      if (!value) return false;
      if (value.includes(q)) return true;
      return value.toLowerCase().includes(lowered);
    });
  });
}

async function browseMessages(
  query: string,
  group = DEFAULT_MESSAGES_GROUP,
  maxLoads = DEFAULT_MAX_MESSAGE_LOADS,
): Promise<ScriptResult> {
  const targetId = await openBackgroundTab("https://new.web.cafe/messages");
  let step = "open messages";

  try {
    step = "wait for messages page";
    await waitForMessagesPage(targetId);

    step = `select group ${group}`;
    const selected = await selectMessagesGroup(targetId, group);
    if (!selected) {
      return {
        success: false,
        message: `Could not select group: ${group}`,
        data: { query, group },
      };
    }

    step = "set search query";
    await setMessagesSearchQuery(targetId, query);

    let loadedMessages: MessageRecord[] = [];
    let finalGroup = group;
    let loadsAttempted = 0;
    let lastCount = 0;

    for (let i = 0; i <= Math.max(0, Math.min(maxLoads, DEFAULT_MAX_MESSAGE_LOADS)); i++) {
      step = `extract messages snapshot ${i + 1}`;
      const snapshot = await extractVisibleMessagesWithRetry(targetId);
      const snapshotMessages = parseMessagesFromPaneText(snapshot.paneText);
      loadedMessages = dedupeMessages([...loadedMessages, ...snapshotMessages]);
      finalGroup = snapshot.group || finalGroup;

      if (i === Math.max(0, Math.min(maxLoads, DEFAULT_MAX_MESSAGE_LOADS))) {
        break;
      }

      step = `scroll messages pane ${i + 1}`;
      await scrollMessagesPaneToBottom(targetId);
      step = `click load button ${i + 1}`;
      const action = await clickMessagesLoadButton(targetId);
      if (!action) {
        break;
      }

      loadsAttempted += 1;
      step = `extract messages after load ${i + 1}`;
      const after = await extractVisibleMessagesWithRetry(targetId);
      const afterMessages = parseMessagesFromPaneText(after.paneText);
      const nextCount = dedupeMessages([...loadedMessages, ...afterMessages]).length;
      loadedMessages = dedupeMessages([...loadedMessages, ...afterMessages]);

      if (nextCount <= lastCount && action.includes("查看更多历史消息") === false) {
        break;
      }

      lastCount = nextCount;
    }

    const matched = filterMessages(loadedMessages, query);

    if (matched.length === 0) {
      return {
        success: true,
        message: query.trim()
          ? `No messages matched "${query}" in ${finalGroup}. Returning loaded chat context for summary.`
          : `Loaded chat context from ${finalGroup}.`,
        data: {
          group: finalGroup,
          query,
          matchedCount: 0,
          loadsAttempted,
          loadedCount: loadedMessages.length,
          messages: loadedMessages.slice(-30),
        },
      };
    }

    return {
      success: true,
      message: `Found ${matched.length} matching messages in ${finalGroup}`,
      data: {
        group: finalGroup,
        query,
        matchedCount: matched.length,
        loadsAttempted,
        loadedCount: loadedMessages.length,
        messages: matched.slice(0, 50),
      },
    };
  } catch (e) {
    return {
      success: false,
      message: `Messages browse failed at step "${step}": ${e instanceof Error ? e.message : String(e)}`,
      data: { query, group },
    };
  } finally {
    if (targetId) {
      await sleep(CLOSE_LINGER_MS);
      await closeBackgroundTab(targetId);
    }
  }
}

async function searchArticles(query: string): Promise<ScriptResult> {
  if (!query || query.trim().length === 0) {
    return { success: false, message: "Search query cannot be empty" };
  }

  const targetId = await openBackgroundTab(
    `https://new.web.cafe/search?q=${encodeURIComponent(query)}`,
  );

  try {
    await waitForSearchPage(targetId);

    const results = await evalInTab<SearchResult[]>(
      targetId,
      EXTRACT_SEARCH_RESULTS_JS,
    );

    if (results.length === 0) {
      return {
        success: false,
        message: `No results found for "${query}"`,
        data: { query },
      };
    }

    return {
      success: true,
      message: `Found ${results.length} results for "${query}"`,
      data: { results, query },
    };
  } catch (e) {
    return {
      success: false,
      message: `Search failed: ${e instanceof Error ? e.message : String(e)}`,
      data: { query },
    };
  } finally {
    if (targetId) {
      await sleep(CLOSE_LINGER_MS);
      await closeBackgroundTab(targetId);
    }
  }
}

async function openResult(
  query: string,
  index: number,
): Promise<ScriptResult> {
  if (!query || query.trim().length === 0) {
    return { success: false, message: "Search query cannot be empty" };
  }

  if (typeof index !== "number" || index < 0) {
    return { success: false, message: "Invalid result index" };
  }

  const targetId = await openBackgroundTab(
    `https://new.web.cafe/search?q=${encodeURIComponent(query)}`,
  );

  try {
    await waitForSearchPage(targetId);

    const results = await evalInTab<SearchResult[]>(
      targetId,
      EXTRACT_SEARCH_RESULTS_JS,
    );

    if (index >= results.length) {
      return {
        success: false,
        message: `Index ${index} out of range (found ${results.length} results)`,
        data: { query, index, total: results.length },
      };
    }

    const result = results[index];

    const clickJs = `
      (function() {
        var els = Array.from(document.querySelectorAll("a[href*='/topic/']"));
        var el = els.find(function(a) {
          return a.textContent && a.textContent.includes(${JSON.stringify(
            result.title.slice(0, 20),
          )});
        });
        if (el) {
          el.click();
          return { clicked: true, href: el.href };
        }
        return { clicked: false };
      })()
    `;

    const clickResult = await evalInTab<{ clicked: boolean; href?: string }>(
      targetId,
      clickJs,
    );

    await sleep(INITIAL_PAGE_SETTLE_MS);

    const newTargets = await evalInTab<
      Array<{ targetId: string; url: string; title: string }>
    >(targetId, "JSON.stringify([{ targetId: '', url: window.location.href, title: document.title }])");

    const openedUrl = newTargets?.[0]?.url || result.url;
    const clicked = clickResult.clicked === true;

    return {
      success: true,
      message: clicked
        ? `Opened result ${index}: ${result.title}`
        : `Result ${index} found (click skipped): ${result.title}. Use read action with the URL directly.`,
      data: {
        title: result.title,
        url: result.url,
        openedUrl,
        preview: result.preview,
        index,
        total: results.length,
        clicked,
      },
    };
  } catch (e) {
    return {
      success: false,
      message: `Open failed: ${e instanceof Error ? e.message : String(e)}`,
      data: { query, index },
    };
  } finally {
    if (targetId) {
      await sleep(CLOSE_LINGER_MS);
      await closeBackgroundTab(targetId);
    }
  }
}

async function readArticle(url: string): Promise<ScriptResult> {
  if (!url || !url.includes("web.cafe")) {
    return { success: false, message: "Invalid Web.Cafe URL" };
  }

  const targetId = await openBackgroundTab(url);

  try {
    await waitForArticlePage(targetId);

    const detail = await evalInTab<{
      title: string;
      author: string;
      date: string;
      tags: string[];
      body: string;
      url: string;
    }>(targetId, `
      (function() {
        function trimText(text) {
          return (text || "").trim();
        }
        var titleEl = document.querySelector("h1") || document.querySelector("h2");
        var title = titleEl ? trimText(titleEl.textContent) : "";
        var author = "";
        var imgWithAlt = document.querySelector("img[alt]");
        if (imgWithAlt) {
          var alt = imgWithAlt.getAttribute("alt") || "";
          if (alt && alt.trim()) author = alt.trim();
        }
        if (!author) {
          var authorEl = document.querySelector("[class*='author']") || document.querySelector("[class*='Avatar']");
          if (authorEl) author = trimText(authorEl.textContent);
        }
        var date = "";
        var timeEl = document.querySelector("time");
        if (timeEl) {
          var dt = timeEl.getAttribute("datetime") || timeEl.textContent || "";
          if (dt) {
            var match = dt.match(/\\d{4}-\\d{2}-\\d{2}/);
            if (match) date = match[0];
            else if (dt.length === 10) date = dt;
          }
        }
        if (!date) {
          var dateMatch = document.body.innerText.match(/\\d{4}-\\d{2}-\\d{2}/);
          if (dateMatch) date = dateMatch[0];
        }
        var tags = [];
        var tagSelectors = ["[class*='tag'] a", "[class*='label'] a", "nav a[href*='/label/']"];
        for (var s = 0; s < tagSelectors.length; s++) {
          var tagEls = document.querySelectorAll(tagSelectors[s]);
          for (var j = 0; j < tagEls.length; j++) {
            var t = trimText(tagEls[j].textContent);
            if (t && t.length < 20 && t.length > 1 && !t.match(/^\\d+$/) && !t.includes("收藏")) {
              if (!tags.includes(t)) tags.push(t);
            }
          }
          if (tags.length > 0) break;
        }
        var bodyEl = document.querySelector("article") || document.querySelector("main") || document.querySelector("[class*='content']") || document.querySelector("[class*='prose']") || document.querySelector("#content") || document.querySelector(".content");
        var body = "";
        if (bodyEl) {
          body = trimText(bodyEl.textContent);
        } else {
          body = trimText(document.body.innerText);
        }
        if (body.length > 2000 && title) {
          var titleIdx = body.indexOf(title);
          if (titleIdx >= 0) {
            var afterTitle = body.substring(titleIdx + title.length);
            var cutoff = afterTitle.match(/^(全 部|帖 子|经 验|教 程|标 签|比 赛|群 聊|创建新帖子|我的帖子)/m);
            if (cutoff && cutoff.index) {
              body = trimText(afterTitle.substring(0, cutoff.index));
            } else {
              body = trimText(afterTitle.substring(0, 5000));
            }
          }
        }
        if (!body || body.length < 50) {
          body = trimText(document.body.innerText).substring(0, 3000);
        }
        return { title: title, author: author, date: date, tags: tags, body: body, url: window.location.href };
      })()
    `);

    if (!detail.body || detail.body.length < 50) {
      return {
        success: false,
        message: "Could not extract article content",
        data: { url },
      };
    }

    return {
      success: true,
      message: `Article: ${detail.title}`,
      data: {
        title: detail.title,
        author: detail.author,
        date: detail.date,
        tags: detail.tags,
        body: detail.body,
        url: detail.url,
      },
    };
  } catch (e) {
    return {
      success: false,
      message: `Read failed: ${e instanceof Error ? e.message : String(e)}`,
      data: { url },
    };
  } finally {
    if (targetId) {
      await sleep(CLOSE_LINGER_MS);
      await closeBackgroundTab(targetId);
    }
  }
}

async function handleBrowse(input: Input): Promise<ScriptResult> {
  switch (input.action) {
    case "search":
      return searchArticles(input.query);

    case "open":
      return openResult(input.query, input.index);

    case "read":
      return readArticle(input.url);

    case "messages":
      return browseMessages(
        input.query,
        input.group || DEFAULT_MESSAGES_GROUP,
        input.maxLoads ?? DEFAULT_MAX_MESSAGE_LOADS,
      );

    default:
      return {
        success: false,
        message: `Unknown action: ${(input as Input).action}. Use "search", "open", "read", or "messages".`,
      };
  }
}

runScript<Input>(handleBrowse);
