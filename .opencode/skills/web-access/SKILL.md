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

#### 交互选择流程

当 check-deps.sh 报告 `browser: not connected` 时，必须先询问用户要用哪一个浏览器，等用户明确选择后，再由 agent 直接执行对应启动命令。给用户选择：

支持的浏览器：任意 Chromium 内核浏览器（Brave、Chrome、Chrome Canary、Edge、Chromium）

展示给用户这个提示：

检测不到浏览器。请选择一个 Chromium 浏览器，可以选择主力浏览器，好处是延用登录状态，但每次开启cdp交互可能需要弹窗确认debug授权。也可以选择自己不常用的浏览器，好处是可以开一个独立profile，这样不会触发debug授权。

根据用户选择，agent 执行对应命令：

**选择 1（Brave）**：
```bash
open -na "Brave Browser" --args \
  --remote-debugging-port=9222 \
  --user-data-dir=/tmp/brave-web-access
```

**选择 2（Chrome）**：
```bash
open -na "Google Chrome" --args \
  --remote-debugging-port=9222 \
  --user-data-dir=/tmp/chrome-web-access
```

**选择 3（Edge）**：
```bash
open -na "Microsoft Edge" --args \
  --remote-debugging-port=9222 \
  --user-data-dir=/tmp/edge-web-access
```

**选择 4（Chrome Canary）**：
```bash
open -na "Google Chrome Canary" --args \
  --remote-debugging-port=9222 \
  --user-data-dir=/tmp/chrome-canary-web-access
```

**选择 5（Chromium）**：
```bash
open -na "Chromium" --args \
  --remote-debugging-port=9222 \
  --user-data-dir=/tmp/chromium-web-access
```

> Linux 和 Windows 没有 `open -na`，应改为直接执行浏览器可执行文件并追加同样的 `--remote-debugging-port` 与 `--user-data-dir` 参数。

agent 启动浏览器后，先等待 3 秒，再重新运行 `check-deps.sh` 验证，避免浏览器尚未完成启动时过早检查。

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
| 搜索摘要或关键词结果，发现信息来源                               | **WebSearch**          |
| URL 已知，需要从页面提取特定信息（由 LLM 提取，返回处理后结果）  | **WebFetch**（拉取网页内容） |
| URL 已知，需要原始 HTML 源码（meta、JSON-LD 等结构化字段）       | **curl**               |
| 非公开内容，或已知静态层无效的平台（小红书、微信公众号等）        | **CDP 浏览器**         |
| 需要登录态、交互操作，或需要像人一样在浏览器内自由导航探索         | **CDP 浏览器**         |

**注意**：如果 WebSearch、WebFetch 等 headless 工具被网站的 anti-bot 机制拦截（如返回 403、验证码、空白内容等），应立即停止尝试并切换到 CDP 浏览器，不要反复重试。

## CDP 使用方式

通过 `bash` 调 `curl` 请求本地 proxy：`http://127.0.0.1:3456`

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

示例：

```bash
curl -s "http://127.0.0.1:3456/new?url=https://example.com"
curl -s -X POST "http://127.0.0.1:3456/eval?target=TARGET_ID" -d 'document.title'
curl -s "http://127.0.0.1:3456/close?target=TARGET_ID"
```

## /eval 规则

POST body 必须是原始 JavaScript 表达式或 IIFE，不要额外包外层引号。

- 正确：`document.title`
- 正确：`document.body.innerText.slice(0, 2000)`
- 正确：`(() => document.body.innerText.slice(0, 2000))()`
- 错误：`"document.title"`

如果返回值等于你传入的源码字符串，优先检查是否误加了外层引号。

## 页面操作原则

- 默认只操作自己创建的后台 tab
- 不主动干扰用户现有 tab
- 结束后关闭自己创建的 tab
- 若内容拿不到，再判断是否需要用户先登录站点

## 登录判断

先尝试获取目标内容。只有在明确判断登录能解决问题时，才让用户去浏览器完成登录。

## 任务结束

任务结束后关闭自己创建的 tab：

```bash
curl -s "http://127.0.0.1:3456/close?target=TARGET_ID"
```
