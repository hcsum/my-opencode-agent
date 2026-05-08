# OpenCode Tech Stack Notes

> From codebase exploration of `/Users/sum/Codes/opencode`

## TUI 技术栈

opencode 的终端 UI 使用以下技术构建：

- **SolidJS** (`solid-js`) - 响应式 UI 框架
- **OpenTUI** (`@opentui/core`, `@opentui/solid`) - 终端 UI 渲染引擎（类似 Ink 的终端组件库）
- **opentui-spinner** - 终端加载动画
- **Bun** - 运行时（带 `--conditions=browser` 条件编译来启用 SolidJS）
- **Effect v4** - 业务逻辑和状态管理框架

启动命令：`bun run --cwd packages/opencode --conditions=browser src/index.ts`

本质上是用 SolidJS + OpenTUI 在终端中渲染组件化 UI，而不是传统的 CLI 库（如 blessed/ink）。

---

## Effect v4 的架构角色

Effect v4 在此仓库中扮演的是**应用框架**，而非工具库。整个应用架构建立在它之上。

### 使用的包

| 包 | 用途 |
|---|---|
| `packages/opencode` | 核心应用，292 处导入，50+ 个 Effect Service |
| `packages/core` | 共享核心库（被 opencode 依赖） |
| `packages/plugin` | 插件系统，定义 tool 时使用 Effect |

其余包（app、web、desktop、console、sdk、slack、enterprise 等）**不使用** Effect。

### 核心解决的问题

#### 1. 依赖注入（DI）
约 50 个服务通过 `Context.Service` + `Layer` 构建依赖图。每个服务声明依赖（`yield* Dep.Service`），Layer 自动按拓扑排序构建，编译器确保所有依赖被满足。`AppRuntime` 使用 `ManagedRuntime.make(AppLayer, { memoMap })` 将全部 ~45 个服务合并为一个 Layer 图。

```ts
// 服务定义模式
export class Service extends Context.Service<Service, Interface>()("@opencode/Foo") {}
export const layer = Layer.effect(Service, Effect.gen(function* () { ... }))
export const defaultLayer = layer.pipe(Layer.provide(Dep.defaultLayer))
export * as Foo from "."
```

#### 2. 多项目实例隔离
`InstanceState` 基于 `ScopedCache` 实现按目录键控的状态隔离。同时打开两个项目目录时，各自拥有独立的 Config、Bus、LSP、MCP 等状态，且自动清理资源。约 30 个服务使用 InstanceState。

#### 3. 资源生命周期管理
`Scope` + `Effect.addFinalizer` + `Effect.acquireRelease` 统一管理 native watcher、PTY 进程、PubSub 等资源的创建与销毁。

#### 4. 并发控制与状态机
`SynchronizedRef` 做 CAS 状态转换、`Deferred` 做异步等待/通知、`PubSub` 做事件总线、`Fiber` 管理后台任务。例如 Runner 用 220 行 Effect 实现了完整的 LLM 调用排队/取消状态机（Idle → Running → Shell → ShellThenRun）。

#### 5. 类型安全错误处理
`Schema.TaggedErrorClass` 定义领域错误（PermissionDenied、AuthError 等 13 种），调用方用 `Effect.catchTag` 精确匹配。使用方式：`yield* new DeniedError({...})` 直接在 gen 函数中抛出。

#### 6. 零成本可观测性
`Effect.fn("Session.get")` 自动添加 tracing span，集成 OpenTelemetry，不需要手动埋点。

#### 7. Schema 作为唯一真相源
Effect Schema 定义数据模型，通过 `zod()` 辅助函数派生 Zod schema 给 Hono HTTP 验证层使用。

### 关键文件路径

| 文件 | 作用 |
|---|---|
| `src/effect/app-runtime.ts` | 全局 ManagedRuntime，合并 ~45 个服务 |
| `src/effect/bootstrap-runtime.ts` | 启动阶段的子集运行时 |
| `src/effect/instance-state.ts` | 每目录实例隔离（ScopedCache） |
| `src/effect/instance-ref.ts` | Context.Reference 传递 Instance 上下文 |
| `src/effect/bridge.ts` | Effect 与非 Effect 代码的桥接 |
| `src/effect/runner.ts` | 并发状态机（LLM 调用排队/取消） |
