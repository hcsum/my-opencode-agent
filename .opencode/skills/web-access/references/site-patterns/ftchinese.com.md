---
domain: ftchinese.com
aliases: [FT中文网, Financial Times Chinese, FT Chinese]
updated: 2026-06-08
---
## 平台特征
- 用户已不再订阅 FT 中文网，**不需要也不要尝试登录**。登录不会解锁付费内容；账号现为非付费状态，即使页面残留 `我的账户 / 登出` 导航，付费文章仍然是锁住的。
- 只读「免费文章」：标题处没有锁图标、且不带「高端专享 / 付费会员」标记的文章。免费文章可拿到完整正文；付费文章只能拿到开头几段。
- 文章 URL 形如 `/story/00xxxxxxxxx` 或 `/interactive/2xxxxx`。**免费与付费共用同样的 URL 形态，无法从 URL 判断是否免费**，必须看页面标记。
- 付费分两档但对当前用户无区别，都是打不开：`standard`（标准会员）与 `vip`（高端会员/高端专享）。

## 有效模式
- **在列表/首页判断免费**：文章标题链接是 `<a class="item-headline-link ...">`。
  - `class="item-headline-link"`（无 `locked`）→ 免费，可读全文。
  - `class="item-headline-link standard locked"` 或 `... vip locked` → 付费，跳过。`locked` 类对应标题上的锁图标，`vip` 即「高端专享」。
  - 批量筛免费链接：`[...document.querySelectorAll('a.item-headline-link:not(.locked)')].map(a=>({href:a.href,txt:a.textContent.trim()}))`。
- **在文章页判断免费**：打开文章后检查是否存在付费墙容器
  `document.querySelector('.subscribe-lock-container, .lock-block, .lock-content')`。
  - 存在 → 付费墙，正文被截断（通常只剩 ~3 段、几百字，并出现「成为付费会员，阅读FT独家内容」「订阅以继续探索完整内容」）。
  - 不存在 → 免费，正文完整（正文容器 `.story-body` / `#story-body`，文末通常是作者简介与责编邮箱）。
- 验证「拿到全文」的判据：无 `.subscribe-lock-container`，且 `.story-body` 段落数十段、字数上千；而非仅凭文章页能打开。

## 已知陷阱
- 不要再走旧的登录流程（`/login`、`notes/credentials/ft.md`、`#identifier/#password` 表单）。当前用户无订阅，登录解决不了付费墙，纯属浪费 token。发现时间：2026-06-08。
- 「文章页能打开」不等于「拿到全文」。付费文章同一页里展示前几段 + 付费墙，正文被截断到几百字。判断免费要看 `.subscribe-lock-container` 是否存在，不是看页面是否 200。发现时间：2026-06-08。
- 页面可能残留 `我的账户 / 登出` 等已登录导航，但这不代表能读付费内容——账号是非付费态。别把「看起来已登录」当成「能解锁」。发现时间：2026-06-08。
- 不能从 URL（`/story/...`、`/interactive/...`）推断是否免费；免费和付费混用同一 URL 形态，必须依赖 `locked` 类或付费墙容器判断。发现时间：2026-06-08。
