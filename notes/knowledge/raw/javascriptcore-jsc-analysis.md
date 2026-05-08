# JavaScriptCore (JSC) 技术分析与安全研究

**来源：** CyberArk 威胁研究博客
**文章：** The Mysterious Realm of JavaScriptCore
**发布日期：** 2021年3月16日
**作者：** Assaf Sion

---

## 概述

JavaScriptCore (JSC) 是 **WebKit 内置的 JavaScript 引擎**，被 Safari、Mail、App Store 等众多 macOS/iOS 应用使用。与 C 等编译型语言直接运行原生代码不同，JS 由虚拟机执行，处理器再运行虚拟机代码。

**关键区别：**
- C 代码：编译 → 原生代码 → 处理器执行（快速）
- JS 代码：JSC 虚拟机 → 字节码 → 处理器执行（较慢但更灵活、更安全）

---

## 指令处理流程

JS 代码在 JSC 中经历三个阶段：

### 1. 词法分析 (Lexing)
- 文件：`parser/Lexer.cpp`
- 将脚本拆分为 token

### 2. 解析 (Parsing)
- 文件：`parser/JSParser.cpp`
- 构建抽象语法树 (AST)
- 每个节点代表一个表达式（如 "a + b" 的树结构）

### 3. LLInt（低层解释器）
- 将 AST 编译为字节码
- 例如：`add loc3, loc1, loc2, OperandTypes(126, 126)`

---

## 四级执行架构（Tiering）

JSC 通过 **"执行计数器"** 动态升降级指令：

| 层级 | 名称 | 升级阈值 | 说明 |
| :--- | :--- | :--- | :--- |
| 1 | **LLInt** | 默认 | 解释执行字节码 |
| 2 | **Baseline JIT** | 500 点 | 模板式 JIT，将字节码转为原生代码 |
| 3 | **DFG JIT** | 1,000 点 | 基于数据流图 (IR) 进行复杂优化，可推测类型 |
| 4 | **FTL JIT** | 100,000 点 | 激进优化，重用 DFG 结果并添加更多优化 |

### 关键机制

**JIT (Just-In-Time) 编译：**
- 运行时编译高频指令为原生代码
- 减少虚拟机解释开销
- 通过 profiling 决定哪些指令需要 JIT

**OSRExit：**
- 当优化推测失败（如类型猜错），JSC 降级到更低层级
- 保证正确性但牺牲性能

---

## 副作用建模（Side Effects）

**定义：** JS 操作如果修改了其本地环境之外的变量状态，即产生副作用。

### 经典示例

对象拼接时触发 `toString` 转换：

```javascript
let myObj = {
  'toString': function(){
    print("side-effect here");
    return "myX";
  }
};
let a = "Hello " + myObj  // 触发 toString，执行任意代码
```

### DFG 优化：冗余消除

- **目标：** 消除冗余的类型检查守卫
- **依赖：** 准确知道哪些操作会产生副作用
- **机制：** `DFGAbstractInterpreterInlines.h` 中的 `executeEffects` 函数通过巨大 switch-case 建模每个操作
- **关键函数：** `clobberWorld()` - 表示该操作可能产生副作用

---

## 漏洞案例研究

### InstanceOf 漏洞

**问题：** `instanceOf` 操作未正确建模副作用

**根因：**
- `operationDefaultHasInstance` 获取对象原型时无守卫检查
- 攻击者可通过 Proxy 对象替换 `getPrototypeOf`
- 注入任意代码作为副作用

**后果：**
- 破坏类型假设
- 导致 **类型混淆 (Type Confusion)**
- 实现 **地址泄露 (addrof)** 和 **伪造对象 (fakeobj)** 原语

**修复：** 在 `executeEffects` 中添加 `clobberWorld()` 调用

---

## CodeQL 自动化漏洞发现

作者开发定制的 **CodeQL 查询** 自动发现"不良副作用建模"漏洞：

### 检测逻辑

1. 某操作在 `executeEffects` 的 case 中 **未调用 `clobberWorld`**
2. 但该操作的实际实现 **确实会产生副作用**（如通过 Proxy 触发）

### 核心实现

**ClobberWorldCall 类：**
- 提取 `executeEffects` 中调用 `clobberWorld` 的操作码
- 分析严格/宽松类型约束

**DfgOperation 类：**
- 将操作码链接到实际操作实现
- 追踪 `callOperation` 或 `compileOperation` 调用

**数据流分析：**
```
操作参数 → 转换为 JSObject → 调用 ProxyObject 上的同名函数
```

### 发现成果

- **InstanceOf 漏洞**（已知）
- **operationCreateThis 漏洞**（CVE-2018-4233）— Samuel Groß 在 Pwn2Own 2018 利用
- 两个漏洞均可导致 **RCE（远程代码执行）**

### 开源查询

- **GitHub：** https://github.com/assafsion/javascriptcore-bad-side-effect-modeling

---

## 参考资源

- **WebKit 源码：** https://github.com/WebKit/WebKit
- **Phrack 文章：** http://www.phrack.org/issues/70/3.html (JSC 漏洞原语)
- **CodeQL 文档：** https://semmle.com/codeql
