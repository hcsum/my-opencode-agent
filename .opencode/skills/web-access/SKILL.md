---
name: web-access
description: Full web access with browser CDP, dynamic pages, and login state. Use for real browsing, logged-in sites, and dynamic pages.
---

# web-access

## 前置检查

在需要真实浏览器前，先运行：

```bash
bash .opencode/skills/web-access/scripts/check-deps.sh
```

这个脚本会：

- 检查 Node.js
- 检查 Chrome remote debugging 是否可连
- 检查本地 CDP proxy 是否已就绪
- 如果 proxy 未运行则自动启动

### 浏览器配置

web-access 不会自动抢占用户的日常浏览器。首次使用或检测不到浏览器时，需要用户先选择一个浏览器实例，然后由 agent 直接执行启动命令。

关键是让带 `remote debugging` 的浏览器实例保持运行，不是让启动它的终端窗口必须一直开着。

- 前台启动时，终端会一直占着，直到浏览器退出
- 后台启动时，命令可以立刻返回，但浏览器实例仍需继续运行
- 只要浏览器实例还活着，agent 就能继续连接它的调试端口

### 两种浏览器模式

web-access 支持两种模式，**不会同时使用两个浏览器**：

#### Dedicated Browser（默认）

给 web-access 专门用的浏览器，推荐 **Brave**，使用 home 目录下的持久 profile 与主力浏览器隔离。

**端口策略**：固定端口 `9222`，稳定可预测。

**启动命令（macOS）**：
```bash
open -na "Brave Browser" --args \
  --remote-debugging-port=9222 \
  --user-data-dir=~/.web-access/brave-profile
```

**Linux / Windows**：
```bash
# 直接执行浏览器可执行文件并追加参数
/path/to/brave --remote-debugging-port=9222 --user-data-dir=~/.web-access/brave-profile
```

如果 `~/.web-access/brave-profile` 已存在，会复用这个 home 目录下的持久 profile 的登录态和设置。

agent 默认使用此模式，不需要用户指定；除非用户明确要求主力浏览器，否则都应优先连接这个 home 目录下的持久 profile。

#### User Browser（需明确要求）

用户的日常主力浏览器，如 Chrome。agent 使用浏览器已有的登录态。

**端口策略**：通过 `DevToolsActivePort` 文件动态发现端口（不固定）。

**设置步骤**：
1. 打开 Chrome
2. 地址栏输入 `chrome://inspect/#remote-debugging`
3. 勾选 **"Allow remote debugging for this browser instance"**
4. 页面会显示 `Server running at: 127.0.0.1:<端口>`

**使用方式**：用户必须明确说"主力浏览器"、"用 Chrome"、"user browser"，agent 才会切换到此模式。

agent 切换时执行：
```bash
BROWSER_MODE=user bash .opencode/skills/web-access/scripts/check-deps.sh
```

### check-deps.sh 参数

```bash
check-deps.sh --browser dedicated  # 默认：专用浏览器模式（Brave，home 目录持久 profile，固定端口）
check-deps.sh --browser user       # 用户浏览器模式（Chrome，DevToolsActivePort）
check-deps.sh                      # 等同于 dedicated
```

### 模式切换规则

| 用户说... | 模式 | 说明 |
|-----------|------|------|
| （没说） | `dedicated` | 默认，使用 home 目录持久 profile 的专用浏览器 |
| "主力浏览器"、"Chrome"、"user browser" | `user` | Chrome 动态端口 |
| "Brave"、"专用浏览器" | `dedicated` | Brave 固定端口，使用 home 目录持久 profile |
| "换浏览器"、"换个浏览器" | 询问 | 让用户选择 |

### 启动验证

agent 启动浏览器后，等待 3 秒再验证：

```bash
sleep 3 && bash .opencode/skills/web-access/scripts/check-deps.sh
```

## 浏览哲学

像人一样思考，围绕目标做判断，不机械执行步骤。

- 先定义成功标准
- 选最可能直达目标的入口
- 每一步根据结果调整策略
- 达成目标后停止，不做多余操作

## 工具选择

| 场景                                                           | 工具                  |
| -------------------------------------------------------------- | --------------------- |
| URL 已知，需要原始 HTML 源码（meta、JSON-LD 等结构化字段）       | **curl**               |
| 非公开内容，或已知静态层无效的平台（小红书、微信公众号等）        | **CDP 浏览器**         |
| 需要登录态、交互操作，或需要像人一样在浏览器内自由导航探索         | **CDP 浏览器**         |

**注意**：如果 WebSearch、WebFetch 等 headless 工具被网站的 anti-bot 机制拦截（如返回 403、验证码、空白内容等），应立即停止尝试并切换到 CDP 浏览器，不要反复重试。

## CDP 使用方式

通过 `bash` 调 `curl` 请求本地 proxy：`http://localhost:3456`

## 基础信息

- 地址：`http://localhost:3456`
- 启动：`node ~/.claude/skills/web-access/scripts/cdp-proxy.mjs &`
- 启动后持续运行，不建议主动停止（重启需 Chrome 重新授权）
- 强制停止：`pkill -f cdp-proxy.mjs`

## API 端点

### GET /health

健康检查，返回连接状态。

```bash
curl -s http://localhost:3456/health
```

可用端点：

- `GET /targets`
- `GET /new?url=...`
- `GET /close?target=ID`
- `GET /navigate?target=ID&url=...`
- `GET /back?target=ID`
- `GET /info?target=ID`
- `POST /eval?target=ID`
- `POST /click?target=ID`
- `POST /clickAt?target=ID`
- `POST /setFiles?target=ID`
- `GET /scroll?target=ID&y=3000`
- `GET /scroll?target=ID&direction=bottom`
- `GET /screenshot?target=ID&file=/tmp/shot.png`

### GET /targets

列出所有已打开的页面 tab。返回数组，每项含 `targetId`、`title`、`url`。

```bash
curl -s http://localhost:3456/targets
```

### GET /new?url=URL

创建新后台 tab，自动等待页面加载完成。返回 `{ targetId }`.

```bash
curl -s "http://localhost:3456/new?url=https://example.com"
```

### GET /close?target=ID

关闭指定 tab。

```bash
curl -s "http://localhost:3456/close?target=TARGET_ID"
```

### GET /navigate?target=ID&url=URL

在已有 tab 中导航到新 URL，自动等待加载。

```bash
curl -s "http://localhost:3456/navigate?target=ID&url=https://example.com"
```

### GET /back?target=ID

后退一页。

```bash
curl -s "http://localhost:3456/back?target=ID"
```

### GET /info?target=ID

获取页面基础信息（title、url、readyState）。

```bash
curl -s "http://localhost:3456/info?target=ID"
```

### POST /eval?target=ID

执行 JavaScript 表达式，POST body 为 JS 代码。

```bash
curl -s -X POST "http://localhost:3456/eval?target=ID" -d 'document.title'
```

### POST /click?target=ID

JS 层面点击（`el.click()`），POST body 为 CSS 选择器。自动 scrollIntoView 后点击。简单快速，覆盖大多数场景。

```bash
curl -s -X POST "http://localhost:3456/click?target=ID" -d 'button.submit'
```

### POST /clickAt?target=ID

CDP 浏览器级真实鼠标点击（`Input.dispatchMouseEvent`），POST body 为 CSS 选择器。先获取元素坐标，再模拟鼠标按下/释放。算真实用户手势，能触发文件对话框、绕过部分反自动化检测。

```bash
curl -s -X POST "http://localhost:3456/clickAt?target=ID" -d 'button.upload'
```

### POST /setFiles?target=ID

给 file input 设置本地文件路径（`DOM.setFileInputFiles`），完全绕过文件对话框。POST body 为 JSON。

```bash
curl -s -X POST "http://localhost:3456/setFiles?target=ID" -d '{"selector":"input[type=file]","files":["/path/to/file1.png","/path/to/file2.png"]}'
```

### GET /scroll?target=ID&y=3000&direction=down

滚动页面。`direction` 可选 `down`（默认）、`up`、`top`、`bottom`。滚动后自动等待 800ms 供懒加载触发。

```bash
curl -s "http://localhost:3456/scroll?target=ID&y=3000"
curl -s "http://localhost:3456/scroll?target=ID&direction=bottom"
```

### GET /screenshot?target=ID&file=/tmp/shot.png

截图。指定 `file` 参数保存到本地文件；不指定则返回图片二进制。可选 `format=jpeg`。

```bash
curl -s "http://localhost:3456/screenshot?target=ID&file=/tmp/shot.png"
```

## /eval 使用提示

- POST body 为任意 JS 表达式，返回 `{ value }` 或 `{ error }`
- 支持 `awaitPromise`：可以写 async 表达式
- 返回值必须是可序列化的（字符串、数字、对象），DOM 节点不能直接返回，需要提取属性
- 提取大量数据时用 `JSON.stringify()` 包裹，确保返回字符串
- 根据页面实际 DOM 结构编写选择器，不要套用固定模板

## 页面操作原则

- 默认只操作自己创建的后台 tab
- 不主动干扰用户现有 tab
- 结束后关闭自己创建的 tab
- 若内容拿不到，再判断是否需要用户先登录站点

## 并行调研：子 Agent 分治策略

任务包含多个彼此独立的调研目标时，优先考虑把它们拆给子 agent 并行执行，而不是由主 agent 串行处理。

- 适合分治：目标互不依赖、每个子任务都足够重、需要 CDP 浏览器或较长交互流程
- 不适合分治：任务有前后依赖、只是简单单页查询、几次搜索或抓取就能完成
- 写子 agent prompt 时只描述目标，不要过度规定步骤，避免把子 agent 锚定到错误工具
- 并行 CDP 操作默认共享同一个浏览器实例和 proxy，但每个子 agent 必须只操作自己创建的 tab，并在结束后关闭

## 媒体资源提取

判断内容在图片里时，必须先用 `/eval` 判断图片在页面中的位置、所在容器、是否是当前可见帧，以及它和相邻文字、按钮、卡片的关系，再决定取哪张图。

在确认目标图片后，再用 `/eval` 从 DOM 直接拿图片 URL，再定向读取，比全页截图精准得多。

## 技术事实

- 页面中存在大量已加载但未展示的内容，轮播中非当前帧的图片、折叠区块的文字、懒加载占位元素等，都可能已经存在于 DOM 中但对用户不可见。以数据结构、属性和节点关系为单位思考，可以直接触达这些内容。
- DOM 中存在选择器不可跨越的边界，例如 Shadow DOM 的 `shadowRoot`、iframe 的 `contentDocument`。`/eval` 递归遍历可以一次穿透这些层级，适合快速了解未知页面的完整结构。
- `/scroll` 到底部会触发懒加载，使未进入视口的图片完成加载。提取图片 URL 前若未滚动，部分图片可能尚未加载。
- 拿到媒体资源 URL 后，公开资源可直接下载到本地再读取；只有必须依赖登录态的资源，才优先考虑在浏览器内 `navigate` 加 `screenshot`。
- 短时间内密集打开大量页面，例如批量 `/new`，可能触发网站的反爬风控。
- 平台返回的“内容不存在”“页面不见了”等提示不一定反映真实状态，也可能是访问方式的问题，例如 URL 缺失必要参数或触发反爬，而不是内容本身真的不存在。
- 某些网站会主动探测本机常见调试端口，用来判断当前浏览器是否开启了自动化调试
- proxy 已拦截页面对当前 CDP 调试端口的本地请求，降低这类前端探测直接命中的概率
- 这个拦截只针对当前调试端口的 `127.0.0.1` 和 `localhost` 请求，不影响普通网页访问

## 错误处理

| 错误 | 原因 | 解决 |
|------|------|------|
| `Chrome 未开启远程调试端口` | Chrome 未开启远程调试 | 提示用户打开 `chrome://inspect/#remote-debugging` 并勾选 Allow |
| `attach 失败` | targetId 无效或 tab 已关闭 | 用 `/targets` 获取最新列表 |
| `CDP 命令超时` | 页面长时间未响应 | 重试或检查 tab 状态 |
| `端口已被占用` | 另一个 proxy 已在运行 | 已有实例可直接复用 |

## 登录判断

先尝试获取目标内容。只有在明确判断登录能解决问题时，才让用户去浏览器完成登录。

## 任务结束

任务结束后关闭自己创建的 tab：

```bash
curl -s "http://localhost:3456/close?target=TARGET_ID"
```
