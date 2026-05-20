---
name: summarization
description: Produce analyst-style summaries for articles, essays, reports, opinion pieces, policies, and other long-form content. Use this by default whenever the user asks to summarize or analyze source material, including plain requests like "summarize this", unless they explicitly ask for brevity with cues like brief, TL;DR, short recap, bullet digest, or one-paragraph summary.
---

Use this skill to turn source material into an analyst-style explanation rather than a compressed abstract.

## Goal

- Capture what the piece is really arguing, not just what it mentions.
- Preserve the logic of the argument, including causes, evidence, and proposed solutions.
- Surface the author's stance, assumptions, worldview, and implied subtext.
- Add enough real-world context to make the summary useful without drowning it in detail.
- Stay faithful to the source while clearly separating facts from interpretation.

## When To Use

Use this skill when the user wants any of the following:

- a deep summary rather than a short recap
- a breakdown of an article's logic or argument
- analysis of the author's position, framing, or hidden assumptions
- explanation of why a topic matters in the bigger picture
- an output that sounds like a commentator, analyst, or researcher

Common cues include:

- "summarize this, but not too briefly"
- "analyze this article"
- "what is the author really saying?"
- "explain the logic behind this piece"
- "give me the subtext"

Default rule: if the input is long-form source material and the user asks to summarize it, use this skill unless they clearly ask for a brief recap.

If the user only wants a quick recap, headline summary, or bullet digest, do not use this skill.

## Instructions

1. Start by identifying the source's central thesis in your own words. Avoid rephrasing the title or lead sentence unless they truly capture the argument.
2. Reconstruct the main logic chain:
   - what problem the author thinks exists
   - why the author thinks it exists
   - how the author supports that claim
   - what evidence, examples, or data matter most
   - what action, change, or conclusion the author wants
3. Distinguish clearly between:
   - factual claims presented by the source
   - the author's interpretation of those facts
   - your own contextual explanation added for clarity
4. Analyze the author's frame:
   - what perspective they are writing from
   - what economic, political, business, or cultural logic they rely on
   - what assumptions are doing hidden work in the argument
5. Explain the larger context when it materially improves understanding. Connect the piece to current events, structural tensions, incentives, policy debates, market conditions, or institutional conflicts.
6. Surface the subtext. Say what the article strongly implies, fears, or is trying to push, even if it does not state it directly.
7. End with a short evaluative wrap-up that explains:
   - what the article is really worried about
   - what it is really trying to move the reader toward
   - what it may be overlooking, underplaying, or taking for granted

## Style

- Prefer explanation over compression.
- Sound like someone who understood the argument and is now translating it for an intelligent reader.
- Do not mechanically follow the source's paragraph order.
- Do not pad the answer with every example from the text; keep the most decision-useful ones.
- Do not quote long passages unless the user explicitly asks for quotations.
- Do not flatten disagreement or uncertainty when the source is making contestable claims.
- If the source is opinionated, preserve that stance instead of laundering it into fake neutrality.

## Output

- Default to a flowing analytical summary in sections or short paragraphs.
- Use structure when it helps clarity, but do not force a rigid template if the user wants a natural writeup.
- Unless the user asks for brevity, err on the side of fuller explanation.
- If the source is weak, biased, or thinly argued, say so directly and explain why.

## Source Handling

- If the user provides the full text, work from that text.
- If the user provides only a URL or asks you to fetch the source, load `web-access` before doing any network work.
- Respect source limitations and avoid reproducing copyrighted text beyond what is necessary for analysis.
