# Pikachu Agent Memory — 设计与演进

> 状态：**已停用（2026-06-26）**。整套实现保留在代码里，但默认全关、agent 不可见：
> - 自动抽取（auto-write）默认关 → `MEMORY_EXTRACT_ENABLED=1` 才开（两 runtime 都在 `extract()` / hook `main()` 处 gate）。
> - 召回工具 `search_memories` 默认不注册（opencode）→ `MEMORY_RECALL_ENABLED=1` 才暴露。
> - agent-facing 文档已移除：`AGENTS.md` 的 Memory 段、`opencode.json` instructions 里的 `PROTOCOL.md`、`notes/` 的 `memory/` 审计文件夹都已删。
>
> 下文描述的是停用前的**完整设计**，作为重启时的参考；要恢复就翻上面两个 env flag。Claude Code 侧的 `.mcp.json` mem0 MCP 仍在（尚未摘）。
>
> 状态（历史）：已实现，仍在收紧规则。最后大改 2026-06-24。
>
> 这是 agent 自动记忆层的**单一设计文档**（合并了早期的 file-based 设计稿与 mem0 集成方案）。它记录：当前实现、为什么这么做、一路上的取舍与踩坑、已知缺口、不要再走的岔路。
>
> 作用域：**只覆盖关于「用户」的自动长期记忆这一层**（`.opencode/plugin/mem0-memory.ts` + `.opencode/lib/mem0-*.ts`）。`notes/knowledge/`（llm-wiki，世界知识）、`todos.md`、`user.md`、`credentials/` 都不归这里管，边界见 §4 与 §9。

---

## 0. 一句话定位

一套 **LLM-extracted、pull-based** 的长期记忆：记的是关于**用户本人和怎么跟他协作**的耐久事实；存储用自托管 mem0/Qdrant；但「记什么」由我们自己 own 的一道低召回 gate 判定，mem0 被压成纯 vector store。设计的全部张力可以归一句话——**自动捕获（要省事）和真相质量（要干净）天然对立**，本文档大半在记我们怎么在这条线上做取舍。

---

## 1. 当前架构

| 关注点 | 当前选择 |
|---|---|
| 向量库 | Qdrant（Docker），collection `pikachu_memory`，数据留在本机 / VPS |
| embeddings | Gemini `gemini-embedding-001`，1536 维（`embeddingDims` 显式 pin，省一次探测调用） |
| 判定 / 抽取模型 | Gemini `gemini-2.5-flash-lite`（可被 `MEM0_LLM_MODEL` 覆盖） |
| 认证 | 只用 `GOOGLE_API_KEY`（embeddings + 抽取同一把 key），不碰主会话的 OpenAI OAuth |
| mem0 自带 SQLite history | 关闭（`disableHistory:true`）——Qdrant + SNAPSHOT 就是审计面，避免 repo 里多一个 `memory.db` |
| 召回 | `search_memories` 工具，pull-based，默认 top-k 5 |
| store of record | mem0 / Qdrant，**不是** notes 文件（snapshot 只是派生审计） |
| 抽取归属 | **Plan A：我们自己 own**（`mem.add(infer:false)`），mem0 的 `infer:true` 抽取器从不被调用 |

**容错是第一原则**：记忆永远不能弄垮一个 turn。没 key → `getMemory()` 返回 null，记忆静默降级；judge 出错 / 网络错 / 解析失败 → 返回 `[]`（什么都不写）；Claude hook 永远 `exit 0`。坏的一次抽取宁可漏记，绝不阻塞或污染。

### 1.1 双 runtime，单一共享 store

同一个 Qdrant store（按 `user_id` 共享）被两个 runtime 写读：

- **OpenCode 插件**（`mem0-memory.ts`）：长驻进程，挂 `session.idle` / `session.deleted` / `chat.message` hook，并 own snapshot + compaction 维护（因为维护的 churn 计数器是内存态，只有长驻进程能持有）。
- **Claude Code Stop-hook**（`mem0-claude-hook.ts`）：每个 turn 结束 fork 一个新进程，把 transcript 喂同一套抽取逻辑；**不**跑 snapshot/compaction（一次性进程没有长期 churn 状态）。召回侧对应 `mem0-claude-mcp.ts` 这个 stdio MCP server（在 repo 根的 `.mcp.json` 注册）。

两边都复用 `mem0-extract.ts`（抽取行为）和 `mem0-client.ts`（store），所以行为不会漂移；一边写的记忆另一边能召回。

### 1.2 端到端数据流

```
捕获（写）
  session.idle / session.deleted / "记住" 关键词
    └─ debounce 后 extract(sessionID)
         └─ 读 watermark 之后的新消息 → 拼 transcript
              └─ mem.search(transcript) 取 top-12 邻近记忆作去重上下文
                   └─ judge(transcript, existing)   ← Gemini temp0，gate 作 system prompt
                        └─ 决策 [{action, core, text}]
                             └─ 结构兜底 + core 精确去重 → mem.add(infer:false)
                                  └─ 推进 watermark

召回（读）—— pull-based
  模型按 PROTOCOL.md 主动调 search_memories(query)
    └─ mem.search(query, {user_id}) → top-k 事实
       （什么都不自动注入；不问就什么都看不到）

维护（异步，仅 OpenCode 长驻进程）
  churn / interval 触发
    ├─ pruneAssistantAttributed（确定性 Qdrant filtered-delete）
    ├─ snapshot → notes/memory/SNAPSHOT.<agent>.md（审计）
    └─ compaction（Gemini 保守 pass：delete/rewrite/flag）
```

---

## 2. 捕获：Plan A — 我们自己 own 抽取

### 2.1 单一写入器 + 触发条件

只有一个写入入口：插件里的 `extract(sessionID)` → `runExtraction()`。所有触发最终都汇到这一个 writer，**避免双写竞争**。触发时机只有三个：

1. **`session.idle`** — 默认 debounce `60s`（用户停下来 ≈ 本轮告一段落才抽，不是每个 turn 都调 LLM）。
2. **用户消息含 `记住 / remember`** — 不单独写一条，而是把**同一个** extractor 提前触发（debounce `5s`），并把这批标 `source:"explicit"`。单写入器、单 watermark → 一条消息只被处理一次（早期 explicit/idle 双写竞争的教训）。
3. **`session.deleted`** — 立刻 flush 一次。

按 session 的只有 timer / pending-explicit 标记 / watermark；最终记忆池**不按 session 隔离**，而是按 `user_id` 共享，`sessionId` 仅作 provenance 写进 metadata。

> **真实限制（不是假设）**：这套不是「每轮强制检查」。用户刚聊完就直接关 TUI / kill 进程——还没等到 `session.idle`、也没走到 `session.deleted`——这次 session 很可能根本不触发 memory write。watermark 保证下次 resume 能补抽，但当次会漏。

### 2.2 judge：把「抽取 + 门卫」收进一次 LLM 调用

核心改动（Plan A）：**不再调 mem0 的 `infer:true` 高召回抽取器**。改为 `mem0-judge.ts` 里一次 Gemini 调用（`temperature:0`，决策确定、可复现），system prompt = `EXTRACTION_GATE.md` + 一段 OUTPUT CONTRACT，输入是 transcript + 已存的邻近记忆（去重上下文）。它直接吐结构化决策：

```
{action:"ADD",    core:"<原子裸事实，去重 key>", text:"<自包含富版，实际入库>"}
{action:"UPDATE", id:"<已存记忆 id>", core, text}
```

决策以 `infer:false` 落库——mem0 不再二次判断，junk 根本不会被写出来再删。这是相对「先写后删」的关键收益：**抽取和 gate 塌缩进同一次调用，没有第二次 LLM call，没有 write-then-delete**。

### 2.3 两段式 enrich + 去重锚到 core

「值不值得记」（精度敏感）和「让事实自包含」（召回敏感）拆成两件事，互不污染：

- `core` = 原子裸事实，**只做去重 key**；
- `text` = 加了「主语 + 适用条件」scope 的自包含版，**实际存储 / 展示**。

写路径（`mem0-extract.ts`）用 `factKey = hash(core)` 去重、把 `core` 一并写进 metadata、fallback scan 也比 `core`。于是同一事实的不同 enriched 措辞会在确定性去重层撞重，不再各存一份。注意这只拓宽了**确定性（exact-on-core）**去重；语义近重仍只由 LLM 兜（judge 写时看 top-`DEDUP_SEARCH_LIMIT≈12` 条 + compaction 周期全库扫）。**没有确定性的语义去重，是有意为之**——「这两条是不是同一个事实」本就不该是 regex 的活。

### 2.4 写入后的确定性兜底（薄）

`mem.add()` 前还有一道 `shouldRejectStoredMemory`：**纯结构守卫**——空 / >220 字符 / >2 句直接丢。它**不**做主题判断（那是 judge 的活）。

> 演进注记：这层早期是一串关键词黑名单（`User asked/...`、`Qdrant/token/...` 等正则）。后来删掉了，因为它既**误杀**（把含 "qdrant"/"api" 的正经 infra 事实、含 `2025-11-29` 的签证到期日一并丢掉），又是维护负担。主题判断收归 judge，正则只留长度/句数这种不会误判的结构守卫。

---

## 3. 判定边界：`EXTRACTION_GATE.md`

这是当前**最重要的规则文件**，作为 judge 的 system prompt 注入。结构是「一个总闸 + 归因规则 + 四类白名单 + 一串硬删 + 形式规则」：

- **THE GATE（总闸）**：剥掉当前任务和具体产物，「这个事实下个月、在另一个任务里还成立且有用吗？」只能靠指着今天的交付物复述的 → DROP。
- **WHO SAID IT（按 speaking turn 归因，不按句意）**：关于用户的 claim（偏好/想要/兴趣/决定）必须有 **user turn** 证据；assistant 转写的「User wants X」DROP。**例外**：客观操作 `reference`（命令/host/依赖/how-to，assistant debug 时发现的）无论谁说都 KEEP——它是关于系统的客观事实，不是关于用户的主张。
- **TRUTH, NOT OPEN LOOPS（与谁说无关，含用户自己）**：「想做/track/monitor/follow up X」是开环任务，归 todos.md，DROP——即使用户自己说。
- **四类白名单**：`user`（他是谁/稳定偏好）/ `feedback`（默认协作方式）/ `project`（outlive 当前任务的目标或约束）/ `reference`（可复用的外部指针/操作事实）。
- **RESEARCH → wiki**：外部产品/市场/SERP/题材的研究发现归 llm-wiki，不进 user memory；只有用户基于研究做的**决定**（user turn）可过。
- **SELF-CONTAINED（形式）**：存的事实要能脱离对话独立读懂，只加主语 + 适用条件，禁止 rationale/history/why。一条 memory = 一个事实，最短忠实措辞。
- **HARD DROPS**：assistant 的建议/计划/确认语、任务过程、一次性交付总结、带日期的事件回顾、系统/debug 瞬时状态、recalled memory 再入库（防 feedback loop）、多句大总结。

---

## 4. 召回：pull-based

读取完全 pull-based：模型按 `PROTOCOL.md`（经 `opencode.json` 的 `instructions` 常驻 context）的指示，在需要时主动调 `search_memories` → `mem.search(query, {user_id})` → 默认 top-k 5。**不把整库自动塞回每次对话。**

这点是当前方案明确优于早期「整个 `MEMORY.md` 常驻注入」的地方：旧方式上下文成本随记忆条数 **O(n)** 增长，pull-based 是 O(1) 固定成本 + 命中项。代价见 §6 的取舍（重新引入了 blind-spot，靠 PROTOCOL 强约束「拿不准就搜」来缓解）。

---

## 5. 维护：snapshot / prune / compaction

三层，确定性的在前，LLM 的在后、且被严格压住：

1. **`pruneAssistantAttributed`（确定性）**：mem0 偶尔把助手自己的话写成 `attributedTo:"assistant"` 的记忆；直接走 Qdrant filtered-delete 删掉，不劳 LLM，snapshot 前清一次。
2. **snapshot（审计）**：从 `getAll()` 在 churn(5) / interval(12h) 重建 `notes/memory/SNAPSHOT.<agent>.md`，让 store 可 grep、notes repo 的 sync 能 diff。**按 agent 命名**：local 与 VPS 共享 notes git 但各有独立 Qdrant store，单一共享文件会被两边覆写成不同内容 → sync 时常态冲突；按 `MEM0_AGENT_ID` 命名后各写各的。
3. **compaction（LLM，保守）**：外接 maintenance pass（非 mem0 原生）。churn(20) / 24h 触发、少于 10 条不跑、超 80k 字符跳过。把全库列成编号文本喂一次 Gemini，只应用 `delete / rewrite / flag`；**`merge` 被硬禁**——即使模型吐 merge，执行层也忽略并打日志。无法判定的矛盾走 `flag` → 落 `CONFLICTS.<agent>.md` 给用户裁决，绝不靠猜删一边。

compaction 天生危险，因为它极易从「去重」滑向「改写现实」。当前策略下它本质是「清扫垃圾 + 轻微改写」，**不是知识整理器**。

---

## 6. 关键决策与取舍（give-and-take）

这一节是这套系统真正的「设计」所在——每条都是一次有代价的选择。

**① 召回：eager 全量注入 → pull-based 检索。**
早期 clone Claude Code，把 `MEMORY.md` 索引每会话 eager 注入。好处是**隐式召回**（不用用户重提，模型自动套用已记偏好）天然在场；代价是 O(n) 上下文。换 mem0 后改 pull-based，省了 O(n)，但重新引入 **blind-spot**（模型得先意识到「这儿可能有记忆」才会搜）。取舍：拿可控的 blind-spot（靠 PROTOCOL「拿不准就搜」+ 语义检索质量缓解）换掉不可控的上下文膨胀。规模小的时候这是对的；真到隐式召回掉太多，升级方向是 hook 自动对每条用户消息检索并注入命中项，而不是退回全量注入。

**② 抽取：用 mem0 的 → 自己 own（Plan A）。**
mem0 的 `infer:true` 抽取器为最大 recall 调优，社区审计（issue #4573）实测 97.8% 是 junk，而 OSS 上**没法调低 recall**（`custom_instructions` 只能 append，能全量 override 的字段在 #4805 被删）。曾经的决定是「不改成 `infer:false`，怕 mem0 退化成纯 vector 包装层、还得自己补 worth-saving 判定」。后来**推翻了这个决定**：既然规则层和写后清理层本来就在自己手里，不如索性 own 整个抽取——一次 gated 调用直接出决策，junk 不落库。代价是抽取质量的责任全在自己；收益是完全的控制权 + 解耦于 mem0 的 prompt 版本。

**③ gate：精度 vs 召回。**
太严会丢真正可复用的事实（infra 操作、稳定偏好），太松就记 junk——两边都是失败。用一个总闸统一裁决：「下个月、换个任务还成立且有用吗？」不靠关键词黑名单（会误杀），靠语义判断。

**④ 角色归因——一个反复出现的 bug 类。**
assistant 在整理 todo / 做调研时写的「User wants X」被当成用户事实抽走，是和已 merge 的 **mem0 PR #5643 同一类 bug**（抽取前角色信息丢失，assistant 的话被洗成 user fact）。对策是 gate 的 WHO SAID IT：按 speaking turn 归因，不按句意。这条规则单独就切掉了一大半噪音（含整段调研发现，因为它们都在 assistant turn 里）。

**⑤ 原子 vs 富上下文。**
「一条一个事实、最短」让事实可去重、不啰嗦；但太短会丢掉让它可复用的 scope（`Browserbase works fully with Semrush` 脱离当时对话没法用）。两段式 enrich 化解：先选原子 `core`，再补有界 scope 成 `text`；去重锚 `core`，所以补 context 不破坏去重。

**⑥ 去重：确定性 vs 语义。**
确定性层只做 exact-on-core（窄但绝对可靠）；语义近重交给 LLM（judge 看 top-12 + compaction 全库扫），**不做确定性语义去重**。这是有意的——语义同一性是概率判断，硬塞进 regex 只会既漏又误。

**⑦ 轻量模型当门卫，不当作家。**
`gemini-2.5-flash-lite` 适合做保守判定（worth-saving、短改写、保守 compaction），不适合开放式总结 / 多事实融合 / 人格画像。社区经验明确：**换更强的大模型不会降 junk，只会让 junk 更通顺**（#4573）。所以还出脏先改规则，别先怪模型档位。

**⑧ Qdrant-as-truth vs file-truth（已知次优，暂不切）。**
明知 Claude Code 那种「文件 truth + 派生索引」更易审计、易纠错。当前不切，因为优先级是「先把写脏率降下来」，而不是「设计最优 memory 系统」；大重构会把问题从「memory 质量」转移成「新架构实现」。这是清醒的妥协，不是没看见。

---

## 7. 演进（the journey）

| 阶段 | 时间 | 形态 | 为什么离开上一阶段 |
|---|---|---|---|
| **P0 文件式 MVP** | 06-05/06 | clone Claude Code：每条事实一个 markdown + `MEMORY.md` 索引 eager 注入 + 模型驱动写 + idle 后台抽取 | 召回 O(n) 膨胀、存储是 flat file 无语义排序 |
| **P1 接入 mem0/Qdrant** | 06-15/16 | 语义向量召回；召回翻成 pull-based `search_memories`，杀掉全量注入 | 解决 O(n)；但抽取仍是 mem0 `infer:true` 高召回 |
| **P2 mem0 抽取 + gate(append)** | 06-19/21 | gate 文件作 `customInstructions` 追加压 recall + 写后正则清理 | append 压不动弥散在整 prompt 里的高 recall（#4573）；正则清理误杀又难维护 |
| **P3 Plan A：own 抽取** | 06-21/22 | 自己的 judge（temp0）出决策，`infer:false` 落库，mem0 退成 storage | 自家 pipeline 仍 over-recall：角色归因泄漏、研究灌库、开环当事实、改写重复、缺上下文 |
| **P4 gate + 两段式 enrich** | 06-24 | WHO SAID IT / TRUTH-not-open-loop / RESEARCH→wiki / SELF-CONTAINED + `core`/`text` 去重锚 core | 当前 |

P4 落地时做了一次性清库：74 → 14 条（噪音含一批从「设计这套记忆系统」的对话里被抓出来的 meta、以及一条与中文默认冲突的 `English-only responses` 错误事实）。

---

## 8. 同类实现对照（定位）

| | 召回 | 捕获 | 存储 | 登录 |
|---|---|---|---|---|
| supermemory | 语义检索（首条消息注入 top-N） | 仅关键词触发，**无后台抽取**（不喊就不记） | 云端 SaaS | 需要 |
| Codex CLI | AGENTS.md 分层拼接 + 会话 resume | **无自动抽取**（人工 curate AGENTS.md） | 本地文件 + SQLite | 否 |
| Claude Code | 索引常驻 + 按需展开 | 模型按协议顺手写 markdown | 本地文件 | 否 |
| **本设计** | pull-based 语义检索 | **后台抽取（真 auto）+ 关键词提前触发**，过 gate | 本地 mem0/Qdrant | 否（仅 Gemini key） |

吸收的点：supermemory 的关键词强制触发 → 我们的 explicit 机制；Codex 的注入字节预算思想、清晰分层（curated 指令 / 会话历史 / 知识）→ 印证 memory / wiki / AGENTS.md 的边界。我们的差异化：捕获比两者都更自动（真 auto），代价是噪音风险，故全部精力花在 gate 上。

> 上游 OSS 角度（同一条线沉淀出的贡献）：mem0 PR **#5643**（role-attribution，已 merge）、issue **#5730**（v3 additive prompt over-recall，OSS 无法调低）、审计 issue **#4573**（97.8% junk，维护者承认 extraction permissiveness 是 ongoing 问题）、**#4805**（删掉全量 override 的那个 commit）。

---

## 9. 边界（与 wiki / user.md / AGENTS.md）

| | `notes/knowledge/`（llm-wiki） | 本记忆层 | `notes/user.md` | `AGENTS.md` |
|---|---|---|---|---|
| 内容 | 世界/主题知识、ingest 的外部来源 | 关于**用户**和**怎么协作**的耐久事实 | Mentor 综合出的用户画像（人类可读） | 静态、长期的 agent 行为准则 |
| 维护 | llm-wiki skill（显式） | 抽取自动 + 用户显式「记住」 | Mentor 维护，记忆层**不碰** | 仅用户明确要求时 |
| 判定 | 「关于某主题的知识吗」 | 「关于用户/协作的事实吗」 | 用户的权威档案 | 「要永久改 agent 行为吗」 |

一条 feedback 反复出现、稳定成准则 → 可人工「升级」进 AGENTS.md。

---

## 10. 已知缺口 / 不要再争的点

**已知缺口：**
1. judge 的 UPDATE 分支只更新 `text`，不刷新该条的 `core` metadata（边缘，影响小）。
2. compaction 是 whole-store 单 pass，成本线性；超 `COMPACT_MAX_CHARS` 跳过。规模大了要做 clustering / batched，不是单 pass。
3. 存量 legacy 条目无 `core` 字段，按 `text` 回退去重；新规则只管往后。
4. 关 TUI 太快会漏当次抽取（§2.1），靠 watermark 下次补。
5. `opencode.json` 的路径与插件常量有 main↔notes 耦合（早期 `instructions` 硬编码 notes 路径的遗留，现已收敛到 PROTOCOL+pull，但路径来源仍可再集中）。

**不要再争（已验证的决定）：**
1. 不要把 `runId` 带回来——session 级 id 当 runId 会让 dedup 只在单 session 内生效，跨 session 重复积累。固定 `userId` 作全局池、`sessionId` 只进 metadata。
2. 不要把 recalled memory 重新喂回 extraction（feedback loop，会把每条无限复制）。
3. 不要指望「更强的大模型」自动解决脏写——社区经验正相反（#4573）。
4. 不要把 compaction 当总结器用；`merge` 永远是 no-op。
5. 不要为复用主会话 OpenAI OAuth 去折腾背景 prompt——没有干净 sidecar 路径，九成会沦为 agent 自身配置折腾。

**后续迭代优先级：** 先观察新 gate 下是否还出 `User instructed...` / `The deliverable was...` 这类垃圾 → 还有就继续加确定性 filter，不先换架构 → 规则已经很重还不稳，再考虑「LLM 只做 worth-saving / span picking，最终存原文」→ 真要重构，才上 file-truth + vector-index。

---

## 11. 相关文件

- `.opencode/plugin/mem0-memory.ts` — 触发调度、`search_memories` 工具、snapshot、compaction、assistant-prune。
- `.opencode/lib/mem0-extract.ts` — watermark、fresh-message slicing、写路径（去重 + `mem.add(infer:false)`）、结构守卫。
- `.opencode/lib/mem0-judge.ts` — judge（Gemini temp0）、OUTPUT CONTRACT、`{core,text}` 决策。
- `.opencode/lib/mem0-client.ts` — mem0 实例（Qdrant + Gemini 配置）。
- `.opencode/lib/mem0-claude-hook.ts` / `mem0-claude-mcp.ts` — Claude Code runtime 的写 hook / 读 MCP（共享同一 store）。
- `.opencode/memory/EXTRACTION_GATE.md` — 低召回 gate（judge 的 system prompt），最重要的规则文件。
- `.opencode/memory/PROTOCOL.md` — 给模型看的召回/写入协议（常驻 context）。

## 最后一句

这套系统的本质没变：它仍是 `LLM-extracted memory`。所有工作都是把它往「少写、短写、别自作聪明」上拧。只要还没换 truth layer，就别对它抱「绝对可信」的幻想——gate、prune、compaction 三层都是为了在这个前提下把它压到可用。
