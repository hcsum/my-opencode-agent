# Source: notes/writing-tools-for-agents-anthropic.md

## Metadata

- Source path: `notes/writing-tools-for-agents-anthropic.md`
- Source type: local markdown note summarizing an external article
- Original article: https://www.anthropic.com/engineering/writing-tools-for-agents
- Publisher: Anthropic Engineering
- Published: 2025-09-11
- Focus: how to design, evaluate, and iteratively improve tools for LLM agents

## Source Summary

This source distills Anthropic's guidance on writing effective tools for agents. Its main claim is that agent tools should be optimized for how non-deterministic models actually plan, call tools, consume context, and recover from ambiguity, rather than for API completeness alone. The source centers on a workflow of quick prototyping, realistic evaluation, transcript review, and iterative improvement.

## Key Structures Preserved From Source

### Three practical workflows

1. Build and locally test quick tool prototypes.
2. Create realistic evaluations that measure how well agents use those tools.
3. Use Claude to inspect transcripts and improve tool implementations, descriptions, and schemas.

### Tool-design frame

- Tools are contracts between deterministic systems and non-deterministic agents.
- Usability for the model matters as much as API correctness.
- Real workflows should shape the tool surface more than endpoint completeness.

### Evaluation requirements

- Good tasks should resemble real work rather than toy sandbox exercises.
- Strong tasks often require multiple tool calls and cross-system reasoning.
- Verifiers should be outcome-aware without being brittle about harmless formatting differences.
- Recommended metrics include accuracy, runtime, number of tool calls, token usage, and tool errors.

### Transcript-driven improvement loop

- Feed evaluation transcripts back into the agent to diagnose failure patterns.
- Improve tool implementations, output shape, descriptions, and schemas based on observed behavior.
- Use held-out test sets to avoid overfitting changes to the evaluation set.

## Principles Preserved From Source

### 1. Choose tools that match agent workflows

- Prefer higher-leverage workflow tools over thin wrappers around low-level endpoints.
- Move deterministic multi-step work into the tool when possible.

### 2. Namespace tools clearly

- Tool overlap across servers can confuse model choice.
- Prefix vs suffix naming should be evaluated empirically rather than assumed.

### 3. Return meaningful context

- Prefer high-signal fields that support downstream reasoning.
- Natural-language identifiers are easier for models than opaque IDs.
- If technical IDs are required, a response-format switch can balance readability and operability.

### 4. Optimize for token efficiency

- Use pagination, filtering, truncation, and range selection.
- Make truncation explicit and steer the model toward better follow-up actions.
- Prefer actionable errors over opaque tracebacks.

### 5. Prompt-engineer tool descriptions and schemas

- Tool descriptions are part of the model's working context.
- Explain tools as if onboarding a new teammate.
- Make domain assumptions explicit and parameter names unambiguous.
- Measure description changes with evaluations.

## Reusable Rules

- Start from real agent tasks, not API surface completeness.
- Validate tool quality empirically through evaluation and transcript analysis.
- Reduce the agent's context burden by embedding deterministic coordination inside the tool.
- Treat tool names, output fields, and descriptions as model-facing interface design.

## Risks And Limits Noted In Source

- Naming conventions that work for one model may not transfer cleanly to another.
- Tool improvements can overfit a benchmark if changes are not checked on held-out tasks.
- Overly strict verifiers can misclassify valid task completion as failure.

## Related Wiki Pages

- [[concepts/agent-tool-design-and-evaluation.md]]
