# Agent Memory 设计文档

> 目标：给 **OpenCode 客户端交互会话**（`pnpm opencode` / `opencode` 跑在本 repo 上）加一套持久记忆，让agent能自动记住对话里值得长期保留的事情，并在后续会话需要时召回。
>
> 设计原则：**模仿 Claude Code 的 memory，但做得更简单**。单用户，文件式 + git，不上向量库/图数据库/外部服务。
>
> 范围：本设计**只覆盖 OpenCode 交互客户端路径**。Gmail bridge 路径暂不处理（同一套记忆文件未来可被它复用，但不在本期目标内）。

状态：MVP 已落地。初稿 2026-06-05，落地后更新 2026-06-06（见 §10）。

---

## 1. 我们在抄什么：Claude Code memory 的真实机制

先把被模仿对象拆清楚，避免抄错。Claude Code 的 memory 不是向量检索系统，而是 **「文件 + 协议」**：

1. **存储**：一个 memory 目录，**每条事实一个 markdown 文件**，带 frontmatter：
   ```markdown
   ---
   name: <kebab-case-slug>
   description: <一行摘要，用于召回时判断相关性>
   metadata:
     type: user | feedback | project | reference
   ---
   <事实正文；feedback/project 追加 **Why:** 和 **How to apply:** 行；用 [[name]] 互链>
   ```
2. **索引**：一个 `MEMORY.md`，每条记忆一行（`- [Title](file.md) — hook`）。**每个会话开始时把整个 MEMORY.md 注入 context**。正文不全注入——只有索引行看起来相关时，模型才用 read 工具展开对应文件。
3. **召回（read）**：靠「索引常驻 context + 按需展开正文」。没有 embedding，没有打分，靠模型读索引判断相关性。
4. **捕获（write）**：**模型驱动**。system prompt 里写了一套 memory 协议（何时记、记什么类型、格式、去重、写完更新 MEMORY.md 索引），模型在对话过程中自己决定调用 Write 工具落盘。没有独立的「会话结束后 extraction LLM pass」——捕获就是模型在对话里顺手写文件。
5. **分类法**：`user`（用户是谁/偏好）、`feedback`（怎么干活的纠正与确认，带 why）、`project`（在做的事/约束）、`reference`（外部资源指针）。
6. **维护**：写前先查有没有已覆盖的文件 → 更新而非新建；发现错的就删。

**关键洞察**：Claude Code 的「memory tool」本质就是「模型按协议写 markdown 文件」+「索引每次注入」。所以在 OpenCode 上我们**不需要发明新机制**，只要找到两个挂载点：(a) 每会话注入索引，(b) 给模型一套写文件的协议。两者 OpenCode 都原生支持。

---

## 2. OpenCode 提供的扩展点（已核实）

核实自 `node_modules/@opencode-ai/sdk` 与 `.opencode/node_modules/@opencode-ai/plugin@1.4.8` 的类型定义，以及现有 `.opencode/plugin/scheduler.ts`。

### 2.1 召回挂载点

- **`config.instructions?: string[]`**（SDK 配置，注释原文 "Additional instruction files or patterns to include"）。声明的文件/glob 会在**每个 session 启动时加载进 context**。
  → **这就是零代码的索引注入**：把 `notes/memory/MEMORY.md` 加入 `instructions`，等价于 Claude Code 每会话注入 MEMORY.md。
- **`experimental.chat.system.transform(input, output: { system: string[] })`**（plugin hook）：每轮可改写 system prompt 数组。
  → 升级路径：想做「自动把相关记忆正文也注进去」而不只靠模型展开时，用这个 hook 动态拼接。MVP 不需要。

### 2.2 捕获挂载点

- **模型 + 现有 `write`/`edit` 工具**：模型按协议直接写 `notes/memory/*.md`。无需新工具。
- **`tool: { ... }`**（plugin hook，scheduler 已在用）：可选注册 `memory_save` / `memory_search` 自定义工具，让意图更显式、便于约束格式。属于「锦上添花」，非必需。
- **`event(input: { event })`**（plugin hook）：能收到 OpenCode 全量事件（含 `session.idle` 等）。
  → 升级路径：想做「会话结束后异步抽取」时，监听 idle 事件触发一次后台抽取 pass。**MVP 不做**（见 §6）。

### 2.3 现成范式

`.opencode/plugin/scheduler.ts` 已演示：plugin 是 `async (input) => Hooks` 函数，返回对象里挂 `tool` / hook。新增记忆能力可以走同一个 plugin 文件或新开一个，列进 `.opencode/opencode.json` 的 `plugin` 数组。

---

## 3. 设计

### 3.1 记忆存哪里

`notes/memory/`，理由：

- `notes/` 是独立 git repo，已有 push 自动化 → 记忆天然持久化、可同步、可在容器/多机间共享。
- 与现有 `notes/knowledge/`（llm-wiki）同级，结构一致、心智负担低。
- 人类可读、可手改、git 可审计 diff —— 命中「文件式 + git」选型。

```
notes/memory/
  MEMORY.md            # 索引：每条记忆一行，会话启动自动注入
  user-*.md            # type: user
  feedback-*.md        # type: feedback
  project-*.md         # type: project
  reference-*.md       # type: reference
```

文件名用 `name` slug；前缀只是肉眼分组，非强制。

### 3.2 文件格式

沿用 §1 的 frontmatter schema（直接复用 Claude Code 的，因为已被验证好用，且用户已熟悉）。`MEMORY.md` 每行格式：

```
- [Title](file.md) — 一句钩子，让模型判断相关性
```

### 3.3 召回机制（read path）

**MVP = 纯 `instructions` 注入**：

1. `.opencode/opencode.json` 设 `"instructions": [".opencode/memory/PROTOCOL.md", "notes/memory/MEMORY.md"]`（协议在 main repo、索引在 notes；见 §10.1）。
2. 每个 OpenCode 会话启动 → MEMORY.md 索引 + 写入协议一并进 context。
3. 模型遇到相关话题 → 用 read 工具展开对应记忆文件正文。

无代码、无服务、无 embedding。等记忆条数多到「索引太长 / 模型挑不准」再考虑 §6 的语义召回升级。

### 3.4 捕获机制（write path）—— 目标：真 auto

> 设计目标修订（2026-06-06）：用户要的是**真 auto write**——不喊关键词、也不靠模型边干活边自觉记。
> 评估过四种触发机制后，结论：只有**后台抽取**能可靠做到真 auto。参考实现 `opencode-supermemory` 的捕获实质只是「关键词正则 → 强制模型调存储工具」，**没有**后台抽取，所以「不喊就不记」。我们要做得比它更进一步。

**四种触发机制对照**（确定性从低到高）：

| 机制 | 做法 | 是否真 auto | 成本 | 采用 |
|---|---|---|---|---|
| 1 显式 remember | 用户说「记住」，模型落盘 | 否（手动） | 0 | —（被 4 取代） |
| 2 模型对话内 checklist | PROTOCOL 锚定 checklist，模型自觉写 | 半（靠模型自觉，不稳） | 0 | ❌ 砍掉（有 3 后冗余） |
| 3 后台抽取 | `session.idle` 防抖后抽取新消息 | **是** | 每轮对话约一次便宜 LLM 调用 | ✅ 主力 |
| 4 关键词提前触发 | `chat.message` 正则拦截 → 提前触发同一 extractor | 即时补充 | 0 | ✅ 即时补充 |

**采用方案 = 3（主力）+ 4（即时补充）：**

#### 主力：debounced `session.idle` 后台抽取器

一个 plugin 挂 `event` hook 监听 `session.idle`（每个 turn 结束都会触发）：

```
session.idle 触发
  └─ 重置防抖定时器（约 60s）
       └─ 定时器烧到（用户 ~60s 无新输入 = 本轮对话告一段落）
            └─ 跑一次后台抽取
```

抽取步骤：
1. 读「上次水位线（messageID）之后的新消息」——增量，不重读整段。
2. 连同当前 `MEMORY.md` 索引一起，喂给一个**便宜模型**，按 `PROTOCOL.md` 标准问：「这段对话里有没有值得长期记的 user/feedback/project 事实？已知的别重复。」
3. 模型吐出结构化 `{action: add|update, type, name, description, body}`。
4. 落盘到 `notes/memory/*.md` + 更新 `MEMORY.md` 索引，推进水位线。

设计要点（解决成本/重复/延迟）：
- **防抖 = 一轮对话只抽一次**：`session.idle` 每 turn 都触发，但定时器每次被重置，只在用户真正停下来时才烧到——不是每个 turn 都调 LLM。
- **增量水位线**：每次只看新消息，token 有界。水位线存 `.data/memory-extract-watermark.json`，key 为 sessionID。
- **后台异步**：在对话关键路径之外跑，用户不等待。
- **喂索引做去重**：模型知道哪些已记，不重复刷；name 撞车时走 update 而非新建。
- **调用便宜模型的方式**：plugin 持有 `ctx.client`（OpencodeClient）→ `client.session.create()` 开临时 headless session、用小模型 `prompt()` 跑抽取、读结果、删除 session。**复用 OpenCode 已配置的 provider，无需额外 API key。**
- **噪音控制**：抽取质量取决于 PROTOCOL 里「什么值得记」的标准写得够严，否则会记噪音——靠 prompt 调严。

#### 即时补充：关键词提前触发

后台抽取有 ~1 分钟延迟。对「我现在就要记住这个」的场景，同一 plugin 挂 `chat.message` hook：
- 正则匹配 `记住 / 记一下 / remember / save this / don't forget`（可配置，先剥代码块再匹配，借鉴 supermemory）。
- 命中 → 不单独写库；而是把同一个 extractor 提前触发，默认 short debounce `~5s`，并把该批次标成 `source:"explicit"`。

| 场景 | 机制 | 延迟 |
|---|---|---|
| 你明确要记某事 | 4 关键词提前触发 | 短延迟（默认 ~5s） |
| 你没说，但聊出了值得记的偏好/事实 | 3 后台抽取 | ~1 分钟（对话停下后） |

#### PROTOCOL.md 的角色

`.opencode/memory/PROTOCOL.md`（main repo，由 `instructions` 加载，常驻 context）描述：四种 type、frontmatter 格式、查重更新而非新建、写完更新 `MEMORY.md` 索引、`[[name]]` 互链、不碰 `notes/user.md`、以及「什么值得记 / 什么是噪音」的判定标准。**后台抽取器和关键词提前触发共用这同一套标准**。

### 3.5 与 llm-wiki / AGENTS.md 的边界（重要）

| | `notes/knowledge/`（llm-wiki） | `notes/memory/`（本设计） | `AGENTS.md` |
|---|---|---|---|
| 内容 | 世界/主题知识、ingest 的外部来源、wiki 结论 | 关于**用户**和**怎么干活**：偏好、被纠正的规则、在做的项目、外部资源指针 | 静态、长期、人工维护的 agent 行为准则 |
| 读写节奏 | 显式 ingest / query，读多写少 | 对话中自动累积、会修正、会过期 | 几乎不变，只在用户要改持久行为时动 |
| 谁维护 | llm-wiki skill | memory 协议（模型自动 + 用户显式） | 仅用户明确要求时（CLAUDE.md 已有此约束） |
| 判定 | 「这是关于某主题的知识吗」→ wiki | 「这是关于用户/协作方式的事实吗」→ memory | 「这是要永久改变 agent 行为的规则吗」→ AGENTS.md |

边界规则：
- 一条 feedback 反复出现、稳定成准则 → 可从 memory「升级」进 AGENTS.md（人工确认）。
- memory 不碰 `notes/user.md`（CLAUDE.md 已规定：除非用户明确要求才改 user.md）。memory 是 agent 自己的笔记层，user.md 是用户权威档案。

---

## 4. 要落地的改动清单（file-by-file）

MVP（最小可用，决策已锁定见 §7）：

1. **`notes/memory/MEMORY.md`** — 新建索引（带表头注释说明每行格式）。
2. **`.opencode/memory/PROTOCOL.md`**（main repo） — 写入协议 + 「什么值得记/什么是噪音」判定标准（移植 Claude Code 协议文本，按本 repo 调整：数据路径 `notes/memory/`、四种 type、frontmatter、查重更新、索引维护、`[[name]]` 互链、不碰 `notes/user.md`）。单独成文以保持 AGENTS.md 精简；协议作为 feature spec 留在 main repo（见 §10.1）。
3. **种子记忆** — 预置已知事实（`user-email.md`），即时验证 `instructions` 注入 + 召回，同时让目录入 git。（注：早期另有 `reference-notes-layout.md`，因与 `notes/CLAUDE.md` 重复、有 drift 风险，已于 2026-06-06 删除。）
4. **`.opencode/opencode.json`** — `instructions` 设 `[".opencode/memory/PROTOCOL.md", "notes/memory/MEMORY.md"]`。
5. **`AGENTS.md`** — 仅加一行短指针（"长期记忆见 `notes/memory/`，写入规则见 PROTOCOL.md"），协议正文不进 AGENTS.md。
6. **`.opencode/plugin/memory.ts`** — 捕获 plugin（真 auto 的核心，见 §3.4）：
   - `event` hook：监听 `session.idle`，防抖后跑后台抽取（增量读新消息 → headless 便宜模型抽取 → 落盘合并 → 推进水位线）。
   - `event` hook：监听 `session.deleted`，在会话销毁前 best-effort flush 一次抽取，减少防抖窗口里的漏记。
   - `chat.message` hook：正则拦截记忆关键词 → 注入强制存储指令（即时补充）。
   - maintenance：定时 + churn 双触发 compaction；每次维护都重建 `MEMORY.md`，并在需要时合并重复项、prune 已过期/被完全覆盖的记忆、把 unresolved contradictions 写进 `_CONFLICTS.md`。
   - 列进 `.opencode/opencode.json` 的 `plugin` 数组（与现有 `./plugin/scheduler.ts` 并列）。
7. **`.data/memory-extract-watermark.json`** — 每 session 的抽取水位线（gitignore，运行时产物）。
8. **`.data/memory-compact-state.json`** — compaction 的 churn / last-attempt / last-compacted 状态（gitignore，运行时产物）。
9. **`notes/memory/_CONFLICTS.md`** — unresolved contradiction 列表；存在时索引会显示提醒。

Phase-2（不在 MVP，验证后再评估）：

- **自定义 `memory_save`/`memory_search` 工具** — 把写入格式和索引更新固化进代码（减少模型手写 frontmatter 出错）。
- **`experimental.chat.system.transform` hook** — 记忆变多时按当前对话动态注入 top-N 相关记忆正文，而不只注入索引（语义召回升级）。
- **importance 评分 / recency 衰减 / 自动遗忘**。

---

## 5. MVP 数据流（端到端）

```
会话启动
  └─ OpenCode 读 instructions → MEMORY.md 索引 + PROTOCOL 进 context

对话进行中
  ├─ 召回：模型见索引行相关 → read 展开 notes/memory/xxx.md 正文
  └─ 即时捕获（机制 4）：用户说「记住」→ chat.message 正则命中
           → 注入强制指令 → 模型当场 write + 更新索引

对话停下 ~60s（机制 3，真 auto 主力）
  └─ session.idle 防抖烧到 → 后台抽取器
           → 读水位线之后的新消息（增量）
           → headless 便宜模型按 PROTOCOL 抽取，喂索引去重
           → 落盘新增/更新 notes/memory/*.md + 更新索引
           → 推进水位线

会话结束
  └─ notes git 自动同步（已有 push 自动化）→ 记忆持久化、跨机可用
```

---

## 6. 暂不做（明确划出 MVP 边界）

- **语义/向量召回**：sqlite-vec / embedding。MVP 召回靠索引注入 + 按需展开；等记忆条数大到索引召回不准时再加，届时可复用 `experimental.chat.system.transform` 注入相关正文。
- **importance 评分 / recency 衰减 / 自动遗忘**：MVP 靠抽取器「查重更新」+ 人工维护。规模化后再引入打分与过期策略。
- **多用户 scope**：单用户，不需要。
- **Gmail bridge 复用**：同一套 `notes/memory/` 文件未来可被 bridge 读取，但本期不接线。

> 注：后台异步抽取（`session.idle`）原本列在此处的 phase-2，2026-06-06 因「真 auto」目标**提到了 MVP**（见 §3.4 / §4.6）。

---

## 7. 决策（锁定于 2026-06-05，触发策略于 2026-06-06 修订）

1. **召回**：OpenCode 原生 `config.instructions` 注入 `MEMORY.md` 索引 + `PROTOCOL.md`（省 token），记忆正文按需 read 展开——不一次性塞全部正文。零代码、不依赖 experimental hook。
2. **协议位置**：单独成文 `.opencode/memory/PROTOCOL.md`（main repo——协议是 feature spec，归 main；见 §10.1），由 `instructions` 一并加载，AGENTS.md 只留短指针。
3. **种子记忆**：MVP **预置几条**已知事实，即时验证注入 + 召回链路。
4. **捕获触发（修订）**：目标是**真 auto write**。采用 **机制 3（debounced `session.idle` 后台抽取）为主力 + 机制 4（关键词提前触发同一 extractor）为即时补充**，砍掉机制 2（模型对话内自觉，不可靠且被 3 取代）。后台抽取从原 phase-2 提到 MVP。实现细节见 §3.4。
5. **后台抽取调模型**：复用 OpenCode 已配置 provider，经 `ctx.client` 开 headless 临时 session 跑便宜模型，不引入额外 API key；增量水位线控成本，喂索引做去重。

---

## 8. 风险

- `experimental.chat.*` 是 experimental，API 可能变。但 MVP 召回走的是稳定的 `config.instructions`，**不依赖任何 experimental hook**；捕获用的 `event` / `chat.message` 也是稳定 hook（scheduler 已在用同类）。风险可控。
- **后台抽取记噪音**：真 auto 的代价是模型会把无关闲聊也记下来。缓解：PROTOCOL 里「什么值得记/什么是噪音」标准要写严；抽取器喂索引去重；MVP 期人工抽查 `notes/memory/` diff。这是我们比 supermemory/Codex 走得更远（它们不做后台抽取）所换来的主要风险。
- **抽取延迟/丢失**：防抖期间进程退出 → 该轮未抽取。缓解：也在 `session.deleted` / 退出时 flush 一次；水位线保证下次 resume 能补抽。
- 记忆与 AGENTS.md/wiki 内容漂移/重复 → §3.5 边界规则 + 定期人工 review。
- **索引膨胀**：MEMORY.md 随记忆增长而变大、每会话都注入 → 借鉴 Codex 的 `project_doc_max_bytes`，给注入设字节上限 + 超限截断/告警（见 §9）。

---

## 9. 参考实现对照与借鉴（supermemory / Codex）

调研了两个真实实现，确认我们的方向并吸收了几点：

### 9.1 `opencode-supermemory`（OpenCode plugin，云端 SaaS）
- 架构与我们同构（plugin + context 注入 + 工具），但记忆存 **Supermemory 云端**，故**必须登录/API key**，数据上云、依赖其服务。
- 召回：首条消息时**语义检索** top-N 相关记忆注入（带相似度 %），比我们的「整索引注入」更省 token、更准——这是我们 phase-2 语义召回的目标形态。
- 捕获：**只有关键词触发**（`chat.message` 正则命中 → 注入 `[MEMORY TRIGGER DETECTED]` 强制指令让模型调 `add`）。**没有后台抽取**，「不喊就不记」。
- **借鉴**：关键词强制存的做法 → 已吸收为我们的机制 4（§3.4 即时补充）。

### 9.2 Codex CLI（`codex-rs`，OpenAI）
- 真·记忆机制：**AGENTS.md 分层指令**（root→cwd 沿途所有 AGENTS.md 拼接，不越过 project root；全局 `~/.codex/AGENTS.md`；本地覆盖 `AGENTS.override.md` 优先级更高）+ **会话持久化**（rollout / SQLite state-db / `codex resume`）+ **goals**（线程目标）+ **compaction**。
- **关键：Codex 没有自动对话记忆抽取**。durable memory = 人工维护的 AGENTS.md + 会话 resume 重放。比 supermemory 更保守。
- **借鉴**：
  1. **字节预算**：Codex 用 `project_doc_max_bytes` 给注入的指令设硬上限，超限**截断 + 告警**。→ 我们给 MEMORY.md 索引注入加同款上限，防止索引膨胀吃 context（已记入 §8）。
  2. **本地覆盖层**：`AGENTS.override.md`（gitignored、优先级高）的模式 → 可选地支持一个**本地不同步的记忆层**（机器特定、不进 notes git）。phase-2 备选，MVP 不做。
  3. **层次清晰分离**：Codex 把「curated 指令 / 会话历史 / goals」干净分层 → 印证我们 §3.5 的 memory / wiki / AGENTS.md 边界。

### 9.3 我们的定位
| | 召回 | 捕获 | 存储 | 登录 |
|---|---|---|---|---|
| supermemory | 语义检索 | 关键词触发 | 云端 | 需要 |
| Codex | AGENTS.md 拼接 + resume | **无自动抽取**（人工 curate） | 本地文件 + SQLite | 否 |
| **本设计** | 索引注入 + 按需展开 | **机制 3 后台抽取（真 auto）+ 机制 4 关键词** | 本地 `notes/` git | 否 |

→ 我们在「召回」上比 Codex 强、比 supermemory 简单；在「捕获」上比两者都更自动（真 auto），代价是噪音风险（§8）。存储/隐私上与 Codex 一致（本地、无登录），优于 supermemory。

---

## 10. 落地后的决策与已知缺口（2026-06-06）

实现后补记几条决策，纠正前文与现状的偏差，并把已知缺口列成 backlog（现在不动，later 一起修）。

### 10.1 PROTOCOL.md 位置更正（覆盖 §3.3 / §4 / §7）

前文写 `instructions` 同时加载 `notes/memory/PROTOCOL.md`，**已过时**。最终落点：

| 角色 | 文件 | 所属 repo | 原因 |
|---|---|---|---|
| 记忆**数据**（索引 + 每条 fact） | `notes/memory/MEMORY.md` + `notes/memory/*.md` | **notes** | 数据要持久化/同步/跨机 |
| 记忆**协议/spec** | `.opencode/memory/PROTOCOL.md` | **main** | 行为/规范是代码，随 feature 版本化 |
| 记忆**捕获代码** | `.opencode/plugin/memory.ts` | **main** | 同上 |

现状 `.opencode/opencode.json`：
```json
"instructions": [".opencode/memory/PROTOCOL.md", "notes/memory/MEMORY.md"]
```
即「数据归 notes / feature 归 main」的拆分（见 `feedback_notes_vs_mainrepo_split`）。

### 10.2 召回为何保持 eager 全索引（不改 agent-grep）

被问到「索引也别进 context，让 agent 按需 grep」。**否决**，理由是 **blind-spot 问题**：

> agent 必须先意识到「这里可能有相关记忆」才会去搜；但它意识不到——因为那条记忆不在视野里。

这会把 recall 劣化为只对**显式召回**（"我邮箱是啥"）有效，而对**隐式召回**（主动套用已记的偏好/规则，不需用户重提）几乎失效——而隐式召回正是 memory 最值钱的部分。这也是 Claude Code / OpenCode 都选 eager load 的原因：eager 才保证「知识在场」。

关键认知：**我们已是最优拆分**——索引层 eager（廉价、保召回），正文层 lazy（按需 read）。把索引层也 lazy 是「省最便宜的、赔最贵的」。

### 10.3 增长路径：hook 自动注入，不是 agent grep

索引随条数**线性增长**，但增长的是廉价索引层（每条一行 ~15–25 tokens，几百条才几 k）。短中期无感，但**单调增长、无自动回收**。真到肉疼时：

| 方案 | 固定成本 | 隐式召回 | 取舍 |
|---|---|---|---|
| A. 现状 eager 全索引 | 线性（廉价） | ✅ | 采用 |
| B. agent 按需 grep | ~0 | ❌ 易漏 | **否决**（blind-spot） |
| C. hook 自动注入命中项 | ~0 固定 + 命中项 | ✅ 自动 | **增长后的升级方向** |

C：在 `memory.ts` 已有的 `chat.message` hook 里，对每条用户消息自动 grep memory，只注入命中条目。recall 仍自动，agent 不需「想起来去搜」。代价是匹配质量（关键词 vs 语义）。**等到了阈值再做。**

### 10.4 Maintenance 状态与剩余缺口

现状已不是“只抽取、不打扫”：

- **Layer A（确定性）**：每次抽取/compaction 后都从 frontmatter 重建 `MEMORY.md`，索引不再是手工可漂移状态。
- **Layer B（LLM compaction）**：现在同时有 **churn 触发**（写入累计到阈值后尽快整理）和 **periodic 触发**（按 wall-clock 间隔至少扫一遍）。compaction 可 merge duplicates、prune 明确过期/被完全覆盖的项，并把 unresolved contradictions 落到 `notes/memory/_CONFLICTS.md`，同时在 `MEMORY.md` 加提醒。
- **state**：运行时把 `churn`、`lastAttemptedAt`、`lastCompactedAt` 落到 `.data/memory-compact-state.json`，避免每个 idle 都重复打一遍 compaction。

剩余缺口：

1. **单次全量 compaction 有 size ceiling**：当前实现把全库一次性喂给小模型；超 `MAX_COMPACT_CHARS` 会跳过并等待下一个周期。后续需要做 clustering / batched compaction，而不是单 pass。
2. **解 main↔notes 路径耦合**：`opencode.json` 的 `instructions` 硬编码了 `notes/memory/MEMORY.md`（main repo committed 文件伸进 notes repo 内部布局），且该路径与 plugin 里的 `MEMORY_SUBDIR = "notes/memory"` **重复**。干净解法：把 recall 注入从 opencode.json 挪进 plugin（启动时读 `MEMORY.md` 经 system-prompt hook 注入），从 `instructions` 删掉该 notes 路径，路径来源走 env/const。效果：notes 路径从两处收敛到一处且可配置。代价：recall 从「零代码原生 instructions」变成「plugin 注入」。
3. **EXTRACT_SYSTEM / COMPACT_SYSTEM 与 PROTOCOL.md 去重**：`memory.ts` 里的 prompt 与 `PROTOCOL.md` 内容重叠（分类、高门槛、去重/保守规则），有 drift 风险。改为运行时读 `PROTOCOL.md` 作单一来源。
