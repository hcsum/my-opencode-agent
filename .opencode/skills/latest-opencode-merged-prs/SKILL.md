---
name: latest-opencode-merged-prs
description: Get the latest merged pull requests from the official OpenCode repo (`anomalyco/opencode`) and explain what they changed. Use this whenever the user asks what the latest merged PRs of OpenCode do, wants recent merge summaries, or asks for upstream PR activity in the official repo.
---

Use this skill to inspect recent merged PRs in the official OpenCode repository and summarize the user-visible or developer-relevant changes.

## Goal

- Identify the official upstream repo as `anomalyco/opencode`.
- Fetch the newest merged PRs, not local fork PRs.
- Explain what each PR changed in plain language.
- Prefer PR descriptions, commit titles, and linked issues over guessing from the title alone.

## Instructions

1. Load `web-access` before doing any network work.
2. Use the merged PR listing page for the official repo:

```text
https://github.com/anomalyco/opencode/pulls?q=is%3Apr+is%3Amerged
```

3. Read the list page first to identify the newest merged PRs and their numbers, titles, authors, and merge dates.
4. Unless the user specifies a count, inspect the latest 5 merged PRs.
5. Open each selected PR detail page and extract the most reliable explanation of what changed from, in order of preference:
   - the PR summary/body
   - explicit validation or testing notes
   - commit titles when the summary is thin
   - linked issue context when the purpose is otherwise unclear
6. Summarize what each PR does in concise plain language. Distinguish between:
   - user-visible behavior changes
   - internal refactors
   - test-only updates
   - provider/model compatibility fixes
7. If GitHub fails to render part of the page, still use the available title, merge date, comments, and commit list instead of stopping early.
8. If the user asks for “latest merged PRs” without naming a repo and the surrounding context is OpenCode, assume they mean `anomalyco/opencode`.
9. Do not use the current workspace remote to infer upstream; this skill is specifically for the official OpenCode repo.

## Output

- Lead with one sentence describing the overall theme of the latest merges if there is one.
- Then list each PR with:
  - PR number and title
  - merge date
  - a 1-2 sentence explanation of what it does
  - the PR URL on its own line
- If a PR is mostly a test or refactor, say that explicitly.

## Notes

- The official repo is `anomalyco/opencode`, not user forks such as `my-opencode-agent`.
- GitHub's merged PR list page usually exposes enough metadata to choose the newest PRs even when some sidebar widgets fail to load.
- If the user asks what a PR “does”, translate maintainer wording into practical impact rather than repeating the title verbatim.
