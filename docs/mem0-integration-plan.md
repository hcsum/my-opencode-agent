# mem0 集成方案：Pikachu 的自动记忆层

> 状态：已实现，仍在收紧规则。
>
> 这份文档只记录真正影响后续维护的东西：当前实现、为什么这么做、已知妥协、不要再走的岔路。
>
> 作用域：只替换 `.opencode/plugin/memory.ts` 这一层自动记忆。`notes/knowledge/`、`todos.md`、`user.md`、`credentials/` 等都不归这里管。

## 目标

要解决两个问题：

1. 老的 markdown memory 会把任务过程、一次性修正、助手自己的话写进去，垃圾很多。
2. 老方案把整个 `MEMORY.md` 常驻注入上下文，记忆越多，上下文越肿。

当前方案优先解决：

- 召回按需检索，不再全量注入。
- 自动记忆仍保留，但尽量收紧，只记少数耐久事实。

不追求的目标：

- 现在不做“完美 memory 架构”。
- 现在不做 file-truth 重构。
- 现在不做 silent background prompt 复用主会话 OAuth。

## 现状一句话

当前实现是：

- `session.idle` / `session.deleted` / 显式 `记住` 触发
- 读取该 session 自上次 watermark 之后的新消息
- 拼成 transcript
- 调 `mem.add(... infer:true)`
- 让 mem0 的 LLM 决定要不要记、记成什么
- 再加一层我们自己的 gate 和确定性清理，尽量删掉脏 memory

所以这不是“原文切块索引”，也不是“文件 truth layer”。
它本质上仍然是 **LLM-extracted memory**，只是现在靠规则把它往保守方向压。

## 这次定下来的路线

先不推翻当前架构，继续走 mem0 这条线，但只做两类改进：

1. 收紧 extraction 规则。
2. 收紧 compaction 规则，并加确定性兜底。

不做的事：

1. 不改成 `infer:false` 存原文。
原因：那样 mem0 基本只剩 vector store 包装层，价值不大，而且要自己补 worth-saving 判定。

2. 不改成“文件为 truth，Qdrant 为索引”的大重构。
原因：方向更稳，但现在成本偏大，先把现有自动记忆收敛到可用。

3. 不尝试从 OpenCode 当前主会话里偷偷再发一轮背景 prompt。
原因：当前主对话走的是 OpenAI OAuth，不是 API key。插件侧没有干净、稳定、可维护的 sidecar 复用路径。继续硬挖，九成会变成 agent 自身配置折腾。

## 为什么不直接改成原文存储

我们讨论过一轮，结论是：

- `infer:false` 可以直接存原文，这点 mem0 源码明确支持。
- 但一旦这样做，“值不值得记”和“到底记哪段原文”都要自己解决。
- 如果这两件事也自己做，mem0 就只剩 embedding + vector CRUD + 一点 metadata 封装，护城河不深。

所以当前阶段的取舍是：

- 还保留 LLM 参与“是否值得记”和“如何措辞”。
- 但不再假设它写出来的东西天然可信。
- 规则层和写入后清理层必须拦它。

## 当前架构

| 关注点 | 当前选择 |
|---|---|
| 向量库 | Qdrant，collection `pikachu_memory` |
| embeddings | Gemini `gemini-embedding-001`，1536 维 |
| 抽取模型 | Gemini `gemini-2.5-flash-lite` 默认，可被 `MEM0_LLM_MODEL` 覆盖 |
| 认证 | 只用 `GOOGLE_API_KEY`，不依赖主会话的 OpenAI OAuth |
| 历史库 | mem0 自带 SQLite history 关闭 |
| 召回方式 | `search_memories` 工具，pull-based |
| 真正 store of record | 仍是 mem0/Qdrant，不是 notes 文件 |

## 触发与写入

### 单一写入器

只有一个写入入口：`.opencode/plugin/mem0-memory.ts` 里的 `extract(sessionID)`。

它做的事：

1. 读当前 session 的消息历史。
2. 根据该 session 的 watermark 只取未处理的新消息。
3. 拼成 transcript。
4. 调 `runExtraction()`。
5. `runExtraction()` 里再调 `mem.add(... infer:true)`。

这套设计的核心目的是避免双写竞争。

### 触发条件

当前会触发 memory write check 的时机只有三个：

1. `session.idle`
默认 debounce `60s`。

2. 用户消息包含 `记住 / remember`
不是直接写一条 memory，而是把同一个 extractor 提前触发，默认 debounce `5s`，并把这批标成 `source:"explicit"`。

3. `session.deleted`
session 删除时立刻 flush 一次。

### 重要限制

memory write check 是 **严格按 session** 做的：

- timer 按 `sessionID`
- pending explicit 标记按 `sessionID`
- watermark 也按 `sessionID`

但最终 memory pool 不是按 session 隔离的，而是按 `user_id` 共享。`sessionId` 只作为 provenance 写进 metadata。

### 关闭 TUI 的后果

这套不是“每轮都强制检查”。

如果用户刚聊完就直接关掉 TUI / 干掉进程：

- 还没等到 `session.idle`
- 也没走到 `session.deleted`

那这次 session 很可能根本不会触发 memory write check。

这是当前设计的真实限制，不是假设。

## 读取与召回

读取完全是 pull-based：

- 模型需要时自己调用 `search_memories`
- 底层是 `mem.search(query, { user_id })`
- 默认 top-k 5

不会把整个 memory 库自动塞回每次对话。

这点是当前方案明确优于老 `MEMORY.md` 常驻注入的地方。

## 为什么不用 `runId`

曾经踩过坑：把 session 级别的 id 当 `runId` 传给 mem0，会导致 dedup 只在单个 session 内生效。

结果就是：

- 同一个事实跨 session 看不到彼此
- 相同意思的记忆会重复积累

所以当前固定用：

- `userId` 作为全局池的主 scope
- `sessionId` 只写 metadata

这是已验证过的决定，不要回退。

## 质量控制：现在靠什么防脏写

### 1. Extraction gate

外部 gate 文件在 `.opencode/memory/EXTRACTION_GATE.md`。

它做的事不是替换 mem0 的默认 prompt，而是追加 `customInstructions` 去强行压低 recall。

当前 gate 的硬要求：

1. 只允许四类：`user` / `feedback` / `project` / `reference`
2. 一条 memory 只能表达一个事实
3. 默认宁可不记，也不要多记
4. 正常 coding / research / ops session，正确输出通常应该是空

当前 gate 明确禁止：

- assistant 的建议、计划、确认语
- 当前任务过程
- 一次性交付总结
- 带日期的事件回顾
- 系统/debug 状态
- recalled memory 再次入库
- 多句大总结

### 2. Assistant-attribution prune

mem0 会偶尔把助手自己的话写成 memory，并带 `attributedTo: "assistant"`。

这类东西不值得让 LLM 再判断，直接 deterministic 删：

- 走 Qdrant filtered delete
- 在 snapshot 前清一次

### 3. 写入后坏 memory 拦截

这层是最近新加的，原因很简单：

- 只靠 prompt 不够
- 再轻量的 Gemini 也会一本正经地把过程材料写成“像事实的话”

所以现在 `runExtraction()` 在 `mem.add()` 之后会检查返回结果；如果命中这些模式，就立刻删掉：

- `User asked/instructed/requested/...`
- `Assistant planned/checked/fixed/...`
- `The deliverable/report/summary/task ... was ...`
- 带 `2026-xx-xx` 这种日期化事件总结
- `Qdrant / token / OAuth / snapshot / watermark / debounce` 这类系统状态
- 过长或超过两句的 summary

这层不是优雅设计，但很值钱，因为它是确定性止损。

## 当前妥协

### 妥协 1：仍然让 LLM 写最终 memory 文本

这不是最稳的设计。

更稳的是：

- LLM 只做 worth-saving 判定
- 或只指出 span
- 最终存原文 / 文件事实

但当前没走这条，是为了少动架构。

代价就是：

- 真相层仍然容易被 summary 漂移污染
- 只能靠 gate + post-filter + compaction 去补救

### 妥协 2：继续把 Qdrant 当主存储

这也不是最稳的设计。

我们已经明确知道，`Claude Code` / `OpenClaw native memory` 那种“文件 truth + 派生索引”更容易审计、更容易纠错。

但当前没切过去，因为：

- 自动 remember 这条链已经跑通
- 先把写脏率降下来更现实
- 大重构会把问题从“memory 质量”转移成“新架构实现”

### 妥协 3：compaction 仍然用 LLM

这层天生危险，因为 compaction 很容易从“去重”滑向“改写现实”。

当前只能通过 prompt 明确压住：

- 只允许 atomic fact 级别 rewrite / merge
- 不允许揉成人物画像
- 不允许写时间线
- 不允许加解释、原因、背景

也就是说：

- 现在 compaction 只能做保守维护
- 不能当知识整理器用

## 为什么轻量 Gemini 还够用

这里用 lite 模型的原则很明确：

- 它适合当保守门卫
- 不适合当自由写作者

当前我们只让它做：

- worth-saving 判断
- 短 memory 改写
- 保守 compaction

不让它做：

- 大段开放式总结
- 多事实融合
- 高自由度人格画像生成

在这个约束下，`gemini-2.5-flash-lite` 基本够用。
如果以后还继续写脏，先改规则，不要先怪模型档位。

## compaction：当前实现和边界

当前 compaction 不是 mem0 原生能力，而是外接 maintenance pass。

### 触发

- 每 `20` 次新增后
- 或每 `24h`
- store 少于 `10` 条就不跑

### 做法

1. `getAll({ user_id })`
2. 把全库列成编号文本
3. 单次 Gemini 调用拿回操作数组
4. 应用 `merge / delete / rewrite / flag`
5. 强制 snapshot

### 硬边界

1. 这是 whole-store pass，成本线性增长。
2. 进程重启会丢计数器。
3. 本地临时 TUI 不要指望 compaction 稳定触发。
4. 它只能做“保守清理”，不能做“智能总结”。

### 现阶段为什么不重做

讨论过 semantic clustering 之类更正统的做法，但当前 store 规模还小，先不值得。

## 为什么没走 OpenClaw / Claude 风格的方案

不是因为那条路不好，恰恰相反，是因为那条路更稳。

结论已经明确：

- `Claude Code`：文件 truth layer，更容易人工维护
- `OpenClaw native memory`：文件 / transcript 为源，再建 FTS + vector index
- 这两种都比“LLM summary 直接进 vector store”更稳

但当前不切，是因为现在优先级不是“设计最优 memory 系统”，而是“别让现有自动记忆继续写垃圾”。

## 明确不要再争的几个点

1. 不要再把 `runId` 带回来。
2. 不要再把 recalled memory 重新喂回 extraction。
3. 不要指望“更强的大模型”自动解决脏写，社区经验正相反。
4. 不要把 compaction 当总结器用。
5. 不要为了复用 OpenAI OAuth 去折腾主会话背景 prompt。

## 后续如果继续迭代，优先级顺序

1. 先观察新规则下是否还出现 `User instructed ...` / `The deliverable was ...` 这类垃圾。
2. 如果还有，继续加 deterministic filter，不先换架构。
3. 如果规则已经很重还不稳，再考虑改成：
   - LLM 只做 worth-saving / span picking
   - 最终存原文或文件事实
4. 真要重构，再上 file-truth + vector-index。

## 相关文件

- `.opencode/plugin/mem0-memory.ts`
  触发、抽取调度、snapshot、compaction、search tool。

- `.opencode/lib/mem0-extract.ts`
  session watermark、fresh message slicing、真正的 `mem.add()` 调用、写入后坏 memory 清理。

- `.opencode/lib/mem0-client.ts`
  mem0 实例初始化、Gemini 配置、gate 注入。

- `.opencode/memory/EXTRACTION_GATE.md`
  低召回 gate，当前最重要的规则文件。

## 最后一句

当前系统的本质没有变：它还是 `LLM-extracted memory`。现在做的一切，只是在把这套东西往“少写、短写、别自作聪明”上拧。只要还没换 truth layer，就别对它抱“绝对可信”的幻想。
