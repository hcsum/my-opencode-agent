---
name: backlink-execution
description: Execute live backlink placements from an existing target CSV. Use when the user asks to do backlink building, build backlinks, work through a backlink candidates CSV, register or submit a target site, create live listings/posts/profiles/comments, or handle real submission flows on target sites. Only use this after targets already exist in CSV. Not for competitor export parsing, candidate generation, or `doable` triage; use `backlink-prospecting` for that.
---

Build real backlink placements from an existing target list. This skill owns execution, not prospecting.

## Goal

- Turn each target into either a live placement or a clearly logged blocker.
- Keep the tracking CSV accurate after every target, not in a batch at the end.
- Avoid wasting time on dead sites, broken flows, mailbox gates, captchas, and high-friction form fields.

## Before You Start

- Confirm which tracking file drives the run: usually `notes/projects/backlink-master.csv`, sometimes a project-specific candidates CSV.
- Read `notes/projects/my-projects.md` before filling forms so you use the right project URL, description, category, logo, and anchor direction.
- Check the target row's `example_source` first. If it is present, inspect that example to understand how the backlink was actually obtained on that site before attempting your own placement.
- If `example_source` is empty, first determine the site's real link path yourself: article body, comment author URL, profile, listing, forum signature, or something else. Do not jump straight into registration or submission before you know which surface can actually produce the backlink.

## Execution Rules

- Work one target at a time.
- Prefer the smallest viable placement that gets the link live: profile, listing, comment, simple post, then heavier article workflows only when needed.
- Treat "how do links come out of this site?" as a required preflight question, not an optional curiosity.
- Every article or post must use genuinely unique content. Do not reuse the same copy across Web2.0 or blog platforms.
- If one account or site property can legitimately host placements for multiple user projects, reuse it instead of forcing separate accounts. In shared-account cases, prefer a generic username, display name, and blog/profile identity rather than one tied to a single project domain.
- Fill the straightforward fields yourself: username, title, URL, short description, obvious category, logo upload, simple bio, and other low-ambiguity inputs.
- For complex submission forms, do the straightforward prep yourself and leave difficult, ambiguous, or high-friction fields for the user to complete.
- Do not guess through unclear editorial or business-detail fields just to finish the form.

## Stop And Hand Off

- If progress depends on checking email for signup, activation, verification, or password reset, stop and ask the user to do that step. Do not attempt mailbox handling yourself.
- If you see captcha or other anti-bot measures, stop and hand that step to the user instead of repeatedly trying to brute-force it.
- If the UI is hard to navigate, stop and inform the user instead of burning time on trial-and-error clicking.
- If a form requires payment, phone or SMS verification, subjective business details you cannot verify, or another high-friction final step, fill what is obvious and hand the rest to the user.
- When handing a step to the user, be precise about what page you reached, what you already filled, and the exact next action they need to take.

## Inaccessible Targets

- If the site is inaccessible, the submission path is dead, or the flow is clearly broken, mark it in the tracking CSV immediately and move on to the next target.
- Use **four statuses** — pick the tightest fit:
  - `done` — live placement confirmed
  - `parked` — blocked on a temporary/manual step (email verify, user completes form, awaiting moderation result); will unblock
  - `hard` — submission path exists but requires user interaction to complete (captcha hand-off, hidden form needs click trigger, Blogger popup, reCAPTCHA v2); doable next run with user present
  - `no` — permanently not actionable: dead site, login-only, paid wall, auto-generated page, web2.0 blog cluster, truly no submission surface
- Always record the reason in `note` so the next run does not rediscover the same blocker from scratch.

## Known Platform Families

Before attempting a site, check if it belongs to a known family — saves the entire "how do links come out of this site?" preflight.

**Web2.0 free blog family** (blogrelation, madmouseblog, luwebs, iyublog, thezenweb, blogsmine, activoblog, bloggadores, azzablog, aboutyoublog):
- Registration: Blog Name + Email + Password + SecureImg reCAPTCHA (hand CAPTCHA to user)
- Auto-login after signup, no email confirmation needed
- New post at `https://<platform>.com/new-post`; TinyMCE injection via `tinymce.get("content").setContent(html)`; publish via `#publish` click
- All article-body links are dofollow (verified)
- One shared account hosts all projects on the platform (2 posts per platform)
- thezenweb differs: CKEditor, `/new` route, KeyCAPTCHA drag-puzzle
- Full CDP automation pattern: `web-access` site-patterns → `web2-blog-family.md`

**Blogger-hosted sites** (any site powered by Blogger/blogspot):
- Comment frame (`blogger.com/comment/frame/...`) requires Closure-framework isTrusted clicks — CDP synthetic events are blocked
- Publish also fails from standalone frame URL due to missing blog referrer and CDP-driven reCAPTCHA penalty
- Comment author links are nofollow — low SEO value regardless
- Mark `no` immediately; do not attempt even with user present

**AI tool directories** (topai.tools, saashub.com, aidirectori.es, aitoolhunt.com):
- Most charge $47–$229 for listing; mark `no` immediately on payment wall
- Auto-generated profile pages are not real placements — skip
- substack.com is the notable exception: free, dofollow, AS=86 (medium effort — needs email verify + newsletter setup)

## CSV Discipline

- Update the tracking CSV after each target attempt.
- For `notes/projects/backlink-master.csv`, write the live placement URL into the relevant project column when successful.
- Record useful execution detail in `note`: account name, whether the link is dofollow or nofollow, moderation status, expiry risk, and any required follow-up.
- Never postpone CSV updates until the end of the run.

## Output

- Report each target as `done`, `parked`, `hard`, or `no`.
- Include the live placement URL when available.
- Include any user hand-off step that is still blocking progress.
