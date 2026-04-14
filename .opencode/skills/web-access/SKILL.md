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

#### 交互选择流程

当 check-deps.sh 报告 `browser: not connected` 时，必须先做两步确认，再由 agent 执行启动命令：

1. 先确认用户要用哪一个浏览器
2. 再确认要用默认 profile，还是独立 profile

给用户选择浏览器：

支持的浏览器：任意 Chromium 内核浏览器（Brave、Chrome、Chrome Canary、Edge、Chromium）

如果用户选择独立 profile，再检查所选浏览器对应的 `/tmp` web-access profile 是否已经存在：

- `Brave` -> `/tmp/brave-web-access`
- `Chrome` -> `/tmp/chrome-web-access`
- `Edge` -> `/tmp/edge-web-access`
- `Chrome Canary` -> `/tmp/chrome-canary-web-access`
- `Chromium` -> `/tmp/chromium-web-access`

如果对应目录已存在，直接复用同一个 `--user-data-dir` 路径启动，避免新建空 profile，尽量保留已有登录态。

只有在对应 `/tmp` profile 不存在时，才按默认路径新建一个新的 profile。

独立 profile 的约定是固定放在 `/tmp` 下，不要改用别的临时命名路径，避免下次找不到同一套状态。

展示给用户这个提示：

检测不到浏览器。请选择一个 Chromium 浏览器，可以选择主力浏览器，好处是延用登录状态，但每次开启cdp交互可能需要弹窗确认debug授权。也可以选择自己不常用的浏览器，好处是可以开一个独立profile，这样不会触发debug授权。

在用户选完浏览器后，再补问一句：使用默认 profile，还是独立 profile？

- 默认 profile：尽量复用该浏览器当前已有的登录态、扩展和日常环境，但可能触发 debug 授权确认
- 独立 profile：固定使用 `/tmp` 下的 web-access profile，和日常环境隔离，更适合长期给 agent 用，也更不容易反复弹授权

根据用户选择，agent 执行对应命令：

**选择 1（Brave）**：
```bash
open -na "Brave Browser" --args \
  --remote-debugging-port=9222
```

如果用户为 `Brave` 选择独立 profile，则改为：

```bash
open -na "Brave Browser" --args \
  --remote-debugging-port=9222 \
  --user-data-dir=/tmp/brave-web-access
```

**选择 2（Chrome）**：
```bash
open -na "Google Chrome" --args \
  --remote-debugging-port=9222
```

如果用户为 `Chrome` 选择独立 profile，则改为：

```bash
open -na "Google Chrome" --args \
  --remote-debugging-port=9222 \
  --user-data-dir=/tmp/chrome-web-access
```

**选择 3（Edge）**：
```bash
open -na "Microsoft Edge" --args \
  --remote-debugging-port=9222
```

如果用户为 `Edge` 选择独立 profile，则改为：

```bash
open -na "Microsoft Edge" --args \
  --remote-debugging-port=9222 \
  --user-data-dir=/tmp/edge-web-access
```

**选择 4（Chrome Canary）**：
```bash
open -na "Google Chrome Canary" --args \
  --remote-debugging-port=9222
```

如果用户为 `Chrome Canary` 选择独立 profile，则改为：

```bash
open -na "Google Chrome Canary" --args \
  --remote-debugging-port=9222 \
  --user-data-dir=/tmp/chrome-canary-web-access
```

**选择 5（Chromium）**：
```bash
open -na "Chromium" --args \
  --remote-debugging-port=9222
```

如果用户为 `Chromium` 选择独立 profile，则改为：

```bash
open -na "Chromium" --args \
  --remote-debugging-port=9222 \
  --user-data-dir=/tmp/chromium-web-access
```

> Linux 和 Windows 没有 `open -na`，应改为直接执行浏览器可执行文件并追加同样的 `--remote-debugging-port` 与 `--user-data-dir` 参数。

agent 启动浏览器后，先等待 3 秒，再重新运行 `check-deps.sh` 验证，避免浏览器尚未完成启动时过早检查。

这里的要求是浏览器实例继续运行即可；如果使用后台启动方式，启动命令所在的终端不需要一直保持打开。

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
