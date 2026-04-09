export interface Article {
  title: string;
  url: string;
  author: string;
  date: string;
  tags: string[];
}

export interface ArticleDetail {
  title: string;
  author: string;
  date: string;
  tags: string[];
  body: string;
  url: string;
}

function trimText(text: string | null | undefined): string {
  return (text || "").trim();
}

function extractDate(dateStr: string): string {
  if (!dateStr) return "";
  const d = new Date(dateStr);
  if (isNaN(d.getTime())) return dateStr;
  return d.toISOString().split("T")[0];
}

export function extractArticleList(): Article[] {
  const cards = Array.from(
    document.querySelectorAll<HTMLElement>(
      "div.border.border-gray-300.dark\\:border-gray-600.bg-white.dark\\:bg-gray-800",
    ),
  );

  const articles: Article[] = [];

  for (const card of cards) {
    const titleEl = card.querySelector<HTMLElement>("p.line-clamp-2");
    const title = trimText(titleEl?.textContent);

    if (!title || title === "Home" || title.includes("教 程") || title.includes("挖掘需求")) {
      continue;
    }

    const authorEl = card.querySelector<HTMLElement>(
      "div.gap-x-2.text-sm.leading-6.text-gray-500 img",
    );
    const author =
      authorEl?.getAttribute("alt")?.trim() ||
      trimText(
        card
          .querySelector<HTMLElement>(
            "div.gap-x-2.text-sm.leading-6.text-gray-500",
          )
          ?.nextElementSibling?.querySelector("span")?.textContent,
      );

    const dateEl = card.querySelector<HTMLElement>(
      "div.gap-x-2.text-sm.leading-6.text-gray-500",
    );
    const dateMatch = dateEl?.textContent?.match(/\d{4}-\d{2}-\d{2}/);
    const date = dateMatch ? dateMatch[0] : "";

    const tagEls = Array.from(
      card.querySelectorAll<HTMLElement>(
        "div.gap-x-2.text-sm.leading-6.text-gray-500 a, div.gap-x-2.text-sm.leading-6.text-gray-500 span",
      ),
    );
    const tags = tagEls
      .map((el) => trimText(el.textContent))
      .filter((t) => t.length > 0 && t.length < 30);

    const titleLink = card.querySelector<HTMLAnchorElement>(
      "a[href*='/tutorial/detail/'], a[href*='/experience/detail/'], a[href*='/post/']",
    );
    const url = titleLink?.href || "";

    if (url && title) {
      articles.push({ title, url, author, date, tags });
    }
  }

  return articles;
}

export function extractSearchResults(): Article[] {
  return extractArticleList();
}

export function extractArticleDetail(): ArticleDetail {
  const titleEl = document.querySelector<HTMLElement>(
    "h1.text-3xl, h1.text-2xl, h1[class*='text-']",
  );
  const title = trimText(titleEl?.textContent);

  const authorEl = document.querySelector<HTMLElement>(
    "div.text-sm.leading-6.text-gray-500 img",
  );
  const author =
    authorEl?.getAttribute("alt")?.trim() ||
    trimText(
      document
        .querySelector<HTMLElement>("div.text-sm.leading-6.text-gray-500")
        ?.nextElementSibling?.querySelector("span")?.textContent,
    );

  const dateEl = document.querySelector<HTMLElement>("time");
  const date = dateEl?.getAttribute("datetime")?.split("T")[0] || "";

  const tagContainer = document.querySelector<HTMLElement>(
    "div.flex.gap-2.flex-wrap, div.flex.gap-x-2",
  );
  const tagEls = tagContainer
    ? Array.from(tagContainer.querySelectorAll<HTMLElement>("a, span"))
    : [];
  const tags = tagEls
    .map((el) => trimText(el.textContent))
    .filter((t) => t.length > 0 && t.length < 50);

  const bodyEl = document.querySelector<HTMLElement>(
    "div[class*='prose'], div[class*='markdown'], main, article",
  );
  const body = trimText(bodyEl?.textContent) || "";

  const url = window.location.href;

  return { title, author, date, tags, body, url };
}