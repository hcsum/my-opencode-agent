# AI Agent 文件查找与路径指定最佳实践

来源：
- [Cursor: Best practices for coding with agents](https://cursor.com/blog/agent-best-practices)（Lee Robinson, 2026-01-09）
- [Anthropic: Writing effective tools for AI agents](https://www.anthropic.com/engineering/writing-tools-for-agents)（Ken Aizawa 等）
- [AI Hero: A Complete Guide To AGENTS.md](https://www.aihero.dev/a-complete-guide-to-agents-md)（Matt Pocock）

---

## 核心结论

**不要在配置文件里硬编码文件路径。** 路径变更极快，一旦过时，agent 会自信地去错误的地方找文件 过时信息会主动"毒害" agent 的上下文。正确做法是描述项目的能力和整体结构，让 agent 在执行时自己搜索定位。

---

## 一、Cursor Agent 最佳实践（Agent Harness 三大组件）

### Agent Harness = Instructions + Tools + Model

- **Instructions**：系统 prompt 和规则，驱动 agent 行为
- **Tools**：文件编辑、代码库搜索、终端执行等
- **Model**：根据任务选择模型

不同模型对同一 prompt 响应不同，Cursor 会针对每个前沿模型调优 instructions 和 tools。

### 上下文管理

- **让 agent 自己找上下文**：不需要在 prompt 里手动标注每个文件。Cursor agent 有 grep 和语义搜索工具，能按需拉取上下文。
  - 你说"认证流程"，它就能找到相关文件
  - 你知道确切文件就标注它；不知道就让 agent 找
  - 包含不相关的文件反而会干扰 agent
- **@Branch 工具**：给 agent 提供当前分支的上下文
- **@Past Chats**：新对话时引用历史聊天，而非复制粘贴整段对话

### 开始前先做计划（Plan Mode）

- 按 `Shift+Tab` 开启 Plan Mode：agent 先研究代码库找到相关文件、问澄清问题、创建包含文件路径和代码引用的详细计划，等你确认后再动手
- 计划保存到 `.cursor/plans/` 便于恢复和团队共享
- 方向错了就回退计划重来，比一直修更高效

### 何时开新对话

**开新对话**：换了任务/功能、agent 变糊涂、完成了某个逻辑单元
**继续对话**：在迭代同一功能、需要早期上下文、在调试刚构建的东西

### Rules（静态上下文，`.cursor/rules/`）

Rules 是每个对话开始时 agent 都会看到的持久化指令。
- 包含：构建/检查命令、遵循的模式、指向典型示例的指针
- **引用文件而非复制内容**：防止规则随代码变旧
- **避免**：复制整个 style guide（用 linter）、记录每个可能的命令、为罕见边缘情况加指令
- 从简单开始，只有在 agent 反复犯同一个错时才加规则

### Skills（动态能力，`SKILL.md`）

Skills 在 agent 判断相关时才按需加载，不浪费上下文。
- 自定义命令：用 `/` 触发的工作流
- Hooks：在 agent 动作前后运行的脚本
- 领域知识：特定任务的指令

### 长时间运行循环示例

通过 `.cursor/hooks.json` 配置 stop hook，agent 可以自动迭代直到测试通过或达到最大次数。

### 并行运行 Agent

- Cursor 支持通过 git worktree 让多个 agent 在隔离的代码树中并行工作
- 多模型同时尝试同一问题，选最佳结果，尤其对难题有效

### Debug Mode

生成多个假设、用日志插桩、收集运行时数据、分析实际行为、精确定位根因后修复。适合可复现但找不到原因的 bug。

---

## 二、Anthropic：如何给 Agent 写有效工具

### 工具是两种系统的契约

传统软件是确定性系统之间的契约（`getWeather("NYC")` 每次以完全相同方式获取天气）。

工具是确定性系统与非确定性 agent 之间的新契约。需要从根本上重新思考为 agent 写软件的方式。

### 构建工具的迭代流程

1. **快速搭建原型** → 本地测试
2. **运行评估**（生成大量真实任务prompt-Response对）
3. **分析结果**，让 agent 帮忙改进
4. **重复**直到工具在真实任务上表现强劲

评估任务要强（需要多个工具调用，可能数十个），避免过于简单的沙盒环境。

### 原则一：选择正确的工具

- **更多工具 ≠ 更好结果**。常见错误：仅包装现有 API 端点，不考虑 agent 的"可用性"。
- Agent 的 context 有限（token 上限），而计算机内存便宜且充足。
  - 错误示范：返回所有联系人让 agent 逐个 token 读取
  - 正确做法：提供 `search_contacts` 或 `message_contact` 工具，跳到相关页面
- 合并多功能为单一工具：
  - ❌ `list_users` + `list_events` + `create_event`
  - ✅ `schedule_event`（查找可用性并安排日程）
  - ❌ `read_logs`
  - ✅ `search_logs`（只返回相关日志行和上下文）
  - ❌ `get_customer_by_id` + `list_transactions` + `list_notes`
  - ✅ `get_customer_context`（一次性编译客户所有近期相关信息）

### 原则二：工具命名空间（Namespacing）

- 大量 MCP 服务器和工具时，用前缀区分边界：
  - 按服务：`asana_search`, `jira_search`
  - 按资源：`asana_projects_search`, `asana_users_search`
- 前后缀选择对不同 LLM 效果不同，用评估来确定

### 原则三：返回有意义的上下文

- **优先返回高信号信息，避免底层技术标识**（uuid、mime_type、256px_image_url）
- 字段名用 `name`、`image_url`、`file_type` 而非 `uuid_256`
- Agent 处理自然语言名称比处理加密 UUID 好得多
- 把 UUID 转换为可读语言（或 0 索引 ID）显著减少幻觉、提高检索精度
- 提供 `ResponseFormat` enum（`detailed` / `concise`）让 agent 控制响应详细程度
- 响应结构（XML/JSON/Markdown）对评估性能有影响，与训练数据匹配的格式效果更好

### 原则四：优化 token 效率

- 实现分页、范围选择、过滤、截断，配合合理的默认参数
- Claude Code 默认限制工具响应 25000 tokens
- 截断时要给出引导指令："使用过滤器或分页"
- 错误响应要给出具体可操作的改进建议，而非 opaque 错误码或堆栈跟踪

### 原则五：Prompt Engineering 工具描述

- 想象如何向新员工描述你的工具
- 明确期望的输入输出，用严格数据模型强制执行
- 参数命名要无歧义：不要用 `user`，用 `user_id`
- 即使是工具描述的小改进也能带来显著效果
- Claude Sonnet 3.5 在 SWE-bench Verified 上达到最先进性能，正是因为精确改进了工具描述，大幅降低了错误率

---

## 三、AI Hero：AGENTS.md 完整指南

### 什么是 AGENTS.md

AGENTS.md 是 checkin 到 Git 的 markdown 文件，位于对话历史顶部（系统 prompt 下方），是 agent base 指令和实际代码库之间的配置层。

两种内容：
- **个人范围**：提交风格偏好、喜欢的代码模式
- **项目范围**：项目做什么、用什么包管理器、架构决策

### 大文件的问题

自然反馈循环：agent 做了一件不喜欢的事 → 加规则阻止 → 重复数百次 → 文件变成"泥球"。

另一个问题：自动生成的 AGENTS.md（从初始化脚本），用大量"对大多数场景有用"的内容淹没文件，优先考虑全面性而非克制。

### Instruction Budget

前沿思维 LLM 能合理遵循约 150-200 条指令。AGENTS.md 每个 token 每次请求都会加载，不管是否相关：
- 小而专注的 AGENTS.md → 更多 token 用于具体任务的指令
- 大而臃肿的 AGENTS.md → 用于实际工作的 token 更少，agent 困惑
- 不相关的指令 → token 浪费 + agent 分心 = 性能下降

**理想 AGENTS.md 应该尽可能小。**

### 过时文档会毒害上下文

文档很快过时。人类开发者对过时文档有内置怀疑心，但 AI agent 每请求都读文档，过时信息会积极毒害上下文。

**在文档里写文件系统结构尤其危险**：路径经常变，一旦文件重命名或移动，agent 会自信地去错误的地方找。

→ **不要记录结构，描述能力**。给 agent 关于"哪里可能有东西"和项目整体形状的提示。 让 agent 在计划时生成自己的即时文档。

### 精简 AGENTS.md

考虑绝对最小值：
- 一句话项目描述（作为基于角色的 prompt）
- 包管理器（如果不是 npm）
- 非标准构建/typecheck 命令

就是这样，其他一切都放到别处。

### 一句话项目描述

给 agent 关于项目上下文的单句话，锚定每个决定。

示例：`This is a React component library for accessible data visualization.`

### 包管理器说明

如果用 pnpm 而非 npm，明确告知：`This project uses pnpm workspaces.`

### 使用渐进披露（Progressive Disclosure）

不要把一切都塞进 AGENTS.md，而是给出 agent 现在需要的最小信息，然后指向其他资源。Agent 擅长导航文档层次结构。

### 移动语言特定规则到单独文件

```
# Root AGENTS.md:
For TypeScript conventions, see docs/TYPESCRIPT.md
```

好处：
- TypeScript 规则只在 agent 写 TypeScript 时加载
- 其他任务（CSS调试、依赖管理）不浪费 token
- 文件保持专注，跨模型可移植

### 嵌套渐进披露

docs/TYPESCRIPT.md 可以引用 docs/TESTING.md，创建可发现的资源树：
```
docs/
├── TYPESCRIPT.md → references TESTING.md
├── TESTING.md → references specific test runners
└── BUILD.md → references esbuild configuration
```

### AGENTS.md 在 Monorepo 中的用法

不限于根目录一个文件，可以放在子目录中并与根级别合并：
