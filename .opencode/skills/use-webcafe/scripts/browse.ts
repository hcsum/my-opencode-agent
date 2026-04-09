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

type Input = SearchInput | OpenInput | ReadInput;

const INITIAL_PAGE_SETTLE_MS = 4000;
const POLL_INTERVAL_MS = 2000;
const SEARCH_WAIT_TIMEOUT_MS = 30000;
const ARTICLE_WAIT_TIMEOUT_MS = 25000;
const CLOSE_LINGER_MS = 8000;

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

    default:
      return {
        success: false,
        message: `Unknown action: ${(input as Input).action}. Use "search", "open", or "read".`,
      };
  }
}

runScript<Input>(handleBrowse);
