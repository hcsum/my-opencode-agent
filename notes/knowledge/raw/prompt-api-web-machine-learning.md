# Prompt API (Web Machine Learning)

**来源：** W3C Web Machine Learning Community Group
**规范：** https://webmachinelearning.github.io/prompt-api/
**版本：** Draft Community Group Report, 2026年4月10日
**编辑：** Reilly Grant (Google)

---

## 概述

Prompt API 赋予网页直接提示浏览器内置语言模型的能力。提供统一的 JavaScript API，抽象底层模型细节（如模板化或 tokenization）。

**核心优势：**
- 本地处理敏感数据
- 支持离线使用
- 模型共享
- 相比云端或自备模型方案成本更低

---

## 核心 API

### LanguageModel 类

```javascript
interface LanguageModel : EventTarget {
  static Promise<LanguageModel> create(optional LanguageModelCreateOptions options = {});
  static Promise<Availability> availability(optional LanguageModelCreateCoreOptions options = {});

  Promise<DOMString> prompt(LanguageModelPrompt input, optional LanguageModelPromptOptions options = {});
  ReadableStream promptStreaming(LanguageModelPrompt input, optional LanguageModelPromptOptions options = {});
  Promise<undefined> append(LanguageModelPrompt input, optional LanguageModelAppendOptions options = {});

  Promise<double> measureContextUsage(LanguageModelPrompt input, optional LanguageModelPromptOptions options = {});
  readonly attribute double contextUsage;
  readonly attribute unrestricted double contextWindow;

  attribute EventHandler oncontextoverflow;

  Promise<LanguageModel> clone(optional LanguageModelCloneOptions options = {});
};
```

### 消息类型

```javascript
enum LanguageModelMessageRole { "system", "user", "assistant" };
enum LanguageModelMessageType { "text", "image", "audio", "tool-call", "tool-response" };

dictionary LanguageModelMessage {
  required LanguageModelMessageRole role;
  required (DOMString or sequence<LanguageModelMessageContent>) content;
  boolean prefix = false;
};

dictionary LanguageModelMessageContent {
  required LanguageModelMessageType type;
  required LanguageModelMessageValue value;
};
```

### 工具调用支持

```javascript
dictionary LanguageModelTool {
  required DOMString name;
  required DOMString description;
  required object inputSchema;
  required LanguageModelToolFunction execute;
};
```

---

## 可用性状态

| 状态 | 含义 |
| :--- | :--- |
| **available** | 立即可用 |
| **downloading** | 正在下载中 |
| **downloadable** | 可下载（尚未开始） |
| **unavailable** | 不可用 |

---

## 关键特性

### 1. 多模态支持
- **文本** (text)
- **图像** (image) - 通过 ImageBitmapSource
- **音频** (audio) - 通过 AudioBuffer
- **工具调用** (tool-call / tool-response)

### 2. 流式生成
- `promptStreaming()` 返回 ReadableStream
- 支持逐块(chunk)接收生成结果

### 3. 上下文管理
- `contextUsage` / `contextWindow` 跟踪上下文使用情况
- `oncontextoverflow` 事件处理上下文溢出
- `measureContextUsage()` 预估输入占用

### 4. 模型参数（实验性）
- **topK**: 采样时的 top-k 限制
- **temperature**: 生成随机性控制

### 5. 约束与引导
- `responseConstraint`: 约束输出格式（如 JSON schema）
- `expectedInputs` / `expectedOutputs`: 预期的输入/输出类型和语言

---

## 创建选项

```javascript
dictionary LanguageModelCreateOptions : LanguageModelCreateCoreOptions {
  AbortSignal signal;
  CreateMonitorCallback monitor;
  sequence<LanguageModelMessage> initialPrompts;
};

dictionary LanguageModelCreateCoreOptions {
  unrestricted double topK;
  unrestricted double temperature;
  sequence<LanguageModelExpected> expectedInputs;
  sequence<LanguageModelExpected> expectedOutputs;
  sequence<LanguageModelTool> tools;
};
```

---

## 隐私与安全

- 属于 Writing Assistance APIs 家族的一部分
- 共享基础设施的隐私和安全考虑
- 实现需遵循 Writing Assistance APIs 规范中的隐私和安全指导
- 本地处理减少数据外传风险

---

## 状态

- **非 W3C 标准**：由 Community Group 发布，不在 W3C 标准轨道上
- **草案阶段**：API 可能继续演进
- **相关规范：** [Writing Assistance APIs](https://webmachinelearning.github.io/writing-assistance-apis/)

---

## 示例用例

1. **文本生成**：文章摘要、翻译、内容创作
2. **多模态处理**：图像描述、音频转录
3. **工具增强**：模型调用外部工具（如搜索、计算）
4. **本地 AI**：离线场景下的智能助手

---

## 参考

- **规范地址：** https://webmachinelearning.github.io/prompt-api/
- **GitHub Issues：** https://github.com/webmachinelearning/prompt-api/issues/
- **相关 API：** Writing Assistance APIs (翻译、摘要、改写等)
