---
domain: xiaohongshu.com
aliases: [小红书, Xiaohongshu, RED]
updated: 2026-05-03
---
## 平台特征
- 公开内容可通过登录态网页直接访问；本次在 dedicated Brave 已登录状态下可稳定读取搜索结果页和笔记详情页正文。
- 搜索结果页和笔记详情页都能从 `document.body.innerText` 中直接提取出标题、作者、正文和部分评论文本。
- 页面上会同时存在真实可交互元素和被注入的隐藏镜像元素（本次在搜索框和搜索图标都观察到重复节点），需要优先定位可见节点。

## 有效模式
- 首页/发现页：`https://www.xiaohongshu.com/explore`
- 搜索入口：页面顶部可见输入框是 `#search-input`；可见搜索按钮是 `.search-icon[data-v-57548470]`。
- 仅给 `input.search-input` 赋值不够稳定，因为页面里有重复的隐藏输入框；优先操作 `#search-input`。
- 搜索提交后会跳到：`https://www.xiaohongshu.com/search_result?keyword=<URL-encoded keyword>&source=web_explore_feed`，有时还会带 `type=51`。
- 搜索结果列表里的笔记标题链接选择器可用 `a.title`；其 `href` 常先指向 `/search_result/<noteId>?xsec_token=...`。
- 打开结果链接后会落到真实详情页：`https://www.xiaohongshu.com/explore/<noteId>?xsec_token=...`。
- 直接在详情页 `document.body.innerText` 里可读到：作者名、标题、正文、"猜你想搜"、日期、评论数量，以及前若干条评论。

## 已知陷阱
- 仅对搜索输入框派发 Enter 事件不一定会真正跳转，点击可见搜索按钮更稳定。发现时间：2026-05-03。
- 页面中隐藏镜像节点会误导选择器，例如 `input.search-input` 和 `.search-icon` 都可能同时匹配到不可见节点；需要结合可见坐标或更具体选择器。发现时间：2026-05-03。
- 搜索结果页里的链接 `href` 是 `/search_result/<noteId>`，不要把它误判成最终详情页路径；新开后会重定向到 `/explore/<noteId>`。发现时间：2026-05-03。
- 搜索结果与详情页正文前部会混入站点公共页脚和提示文案，抽取正文时要跳过备案信息等噪声。发现时间：2026-05-03。
