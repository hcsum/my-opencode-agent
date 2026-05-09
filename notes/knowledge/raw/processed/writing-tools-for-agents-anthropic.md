# Writing effective tools for agents - with agents

- Source: https://www.anthropic.com/engineering/writing-tools-for-agents
- Publisher: Anthropic Engineering
- Published: 2025-09-11

## Core idea

Agents are only as effective as the tools they are given. Tool design for agents should not be treated like traditional API or function design for deterministic software. Instead, tools should be built, evaluated, and iteratively improved around how non-deterministic agents actually plan, call tools, consume context, and recover from ambiguity.

## What the article covers

The article focuses on three practical workflows:

1. Build and locally test quick tool prototypes.
2. Create realistic evaluations to measure how well agents use those tools.
3. Use Claude to analyze transcripts and improve tool implementations, descriptions, and schemas.

It then distills several principles for writing effective agent tools:

1. Choose the right tools to implement.
2. Namespace tools clearly.
3. Return meaningful context.
4. Optimize responses for token efficiency.
5. Prompt-engineer tool descriptions and specs.

## Main notes

### 1. Tools are contracts between deterministic systems and non-deterministic agents

Traditional software assumes repeatable behavior from the caller. Agents do not behave that way. Given the same request, an agent may choose different strategies, ask clarifying questions, use a tool correctly, use it incorrectly, or skip it entirely. Because of this, tools for agents must be designed around usability for the model, not just correctness at the API layer.

### 2. Start with a prototype and test it directly

Anthropic recommends building a rough version of the tool first, then connecting it locally through MCP, Claude Code, Claude Desktop, or direct API calls. Early hands-on testing helps reveal whether the tool feels natural for the model to use.

Practical suggestions from the article:

- Give Claude the relevant SDK and API documentation when asking it to help build tools.
- Prefer LLM-friendly docs such as `llms.txt` when available.
- Test the tool yourself before trying to optimize it.
- Collect real user prompts to understand the workflows the tool should support.

### 3. Evaluations should be realistic and outcome-verifiable

The article argues that strong tool evaluation tasks should look like real work, not toy sandbox exercises. Good tasks often require multiple tool calls and combining information across systems.

Examples of stronger tasks:

- Schedule a meeting, attach prior notes, and reserve a room.
- Investigate whether a customer billing issue affected other customers.
- Prepare a retention offer after understanding why a customer wants to cancel.

Examples of weaker tasks:

- Schedule a meeting with one email address.
- Search logs for a single keyword.
- Find one cancellation request by ID.

The verifier can be simple or complex, but it should not be so strict that it rejects valid answers for formatting differences alone.

### 4. Run evaluations programmatically and collect more than accuracy

Anthropic recommends a simple agent loop per task, where the model alternates between reasoning and tool calls until it finishes. In evaluation runs, useful metrics include:

- Task accuracy
- Tool runtime
- Number of tool calls
- Token usage
- Tool errors

These metrics help uncover patterns such as redundant tool usage, poor parameter choices, or unclear tool descriptions.

### 5. Use agent transcripts to improve the tools themselves

One of the most useful practices described is feeding evaluation transcripts back into Claude Code so Claude can analyze failure patterns and refactor the tool layer. Anthropic says much of the advice in the article came from repeatedly optimizing internal tools this way.

Important guardrail: use held-out test sets so improvements do not merely overfit the evaluation set.

## Principles for effective agent tools

### 1. Choose tools that match how agents should solve tasks

More tools are not automatically better. A weak pattern is to wrap every low-level API endpoint as a separate tool even when that forces the model to do too much context-heavy coordination itself.

The article recommends building higher-leverage tools that match meaningful workflows. Examples:

- Prefer `search_contacts` or `message_contact` over a raw `list_contacts` tool.
- Prefer `schedule_event` over separate tools like `list_users`, `list_events`, and `create_event`.
- Prefer `search_logs` over `read_logs` if the agent usually needs only relevant lines plus context.
- Prefer `get_customer_context` over multiple fragmented customer lookup tools.

The key idea is to offload multi-step deterministic work into the tool so the agent spends less context budget on intermediate data.

### 2. Namespace tools clearly

When an agent sees many tools across many MCP servers, overlap and ambiguity can cause poor choices. Namespacing tools by service or resource can help. The article notes that prefix-based vs suffix-based naming can have measurable differences depending on the model, so naming should be evaluated empirically rather than assumed.

### 3. Return meaningful context, not noisy raw fields

Tool outputs should prefer high-signal fields that directly help downstream reasoning. For example, `name`, `image_url`, or `file_type` are often more useful than opaque identifiers or low-level metadata.

Anthropic also notes that models handle natural-language identifiers better than cryptic UUID-like values. If technical identifiers are still needed for follow-up tool calls, a `response_format` parameter such as `concise` vs `detailed` can balance readability and operational usefulness.

### 4. Optimize for token efficiency

Large tool outputs can waste context and reduce agent quality. Suggested controls include:

- Pagination
- Range selection
- Filtering
- Truncation with good defaults

If a response is truncated, the tool should say so clearly and steer the model toward better follow-up behavior, such as narrowing filters or using pagination. Likewise, errors should be actionable and specific instead of returning opaque tracebacks.

### 5. Prompt-engineer tool descriptions and schemas

Tool descriptions are part of the model's working context, so small wording improvements can meaningfully change behavior. The article recommends:

- Explain tools the way you would to a new teammate.
- Make implicit domain knowledge explicit.
- Use strict and unambiguous parameter names, such as `user_id` instead of `user`.
- Measure every description change with evaluation rather than guessing.

Anthropic highlights that even small refinements to tool descriptions reduced error rates and improved benchmark performance.

## Practical takeaways

If you are building tools for agents, the article's practical message is:

1. Do not start from API completeness.
2. Start from real workflows the agent must accomplish.
3. Build a small prototype.
4. Evaluate it on realistic tasks.
5. Study transcripts and metrics.
6. Iteratively refine the tool surface, output shape, and descriptions.

The strongest idea in the article is that tool quality is empirical. Instead of debating abstractions, you should measure how the agent actually behaves and then use the agent itself to help improve the tool layer.

## Notable references mentioned in the article

- Model Context Protocol (MCP)
- Anthropic tool evaluation cookbook
- Interleaved thinking in Claude
- Anthropic Developer Guide for tool definitions
- MCP tool annotations

## Short takeaway

Good agent tools are not thin wrappers over existing APIs. They are carefully scoped, context-efficient interfaces that make the right workflows easy for the model to execute, and they should be improved through repeated evaluation on realistic tasks.
