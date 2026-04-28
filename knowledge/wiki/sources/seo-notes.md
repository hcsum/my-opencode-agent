# Source: notes/seo-notes.md

## Metadata

- Source path: `notes/seo-notes.md`
- Source type: local markdown note
- Focus: SEO tool-site keyword research, site launch, backlink acquisition, and display-ad direction

## Source Summary

This source is a practical SEO handbook for tool-style sites. It defines a keyword discovery workflow, two core evaluation formulas (`KDRoi` and `KGR`), a five-step keyword decision framework, launch sequencing for new sites, backlink acquisition and qualification rules, and a portfolio view of display-ad site directions.

## Key Structures Preserved From Source

### Keyword discovery inputs

- Root-word expansion via Semrush with filters: `KD < 30`, `CPC >= $0.1`, `Volume 200-10000`, then sort by `KDRoi`.
- Sitemap monitoring of strong sites to detect newly added pages and extract emerging keywords.
- Loop from keyword to ranking sites to each site's organic keyword set, with emphasis on second- and third-layer expansions.
- Additional inputs: competitor referring domains, Stripe inbound-domain reverse lookup, Chrome Web Store reviews, user request boards, and Toolify trending/revenue lists.

### Core formulas and thresholds

- `KDRoi = (search volume x CPC) / KD`
- CPC below `$0.1` is treated as not worth pursuing.
- `KGR = allintitle results / monthly search volume`
- `KGR < 0.25` is treated as usually low competition; `0.25-1` requires more SERP inspection; `> 1` suggests heavy supply.
- The source includes a heuristic backlink estimate from KD:

```text
backlinks ~= (-89.32 x KD) / (-100.62 + KD)
```

### Five-step keyword decision framework

1. Delete false opportunities first: brand terms, IP-risk terms, giant-dominated SERPs, and isolated single-page terms.
2. Check SERP intent before tool metrics.
3. Use Semrush/Ahrefs volume, KD, CPC, Google Trends, KGR, and KD for relative sorting.
4. Inspect front-page competition shape, especially weak mobile experience and backlink/traffic mismatch.
5. Only proceed when intent is clean, the term can expand into a cluster, soft targets exist in SERP, trend is still alive, and monetization is plausible.

### Launch and on-page operating rules

- Register domain and launch quickly with homepage plus 1-2 internal pages.
- The first week after GSC submission is treated as a key exposure window.
- Add a few backlinks and new internal pages daily during the early window.
- One keyword maps to one page to avoid cannibalization.
- A three-layer page loop is recommended: functional page, landing page, result page.
- SSR is preferred over pure SPA for ranking.
- Multilingual pages should use separate URLs and proper `hreflang`; do not rely on JS-only language switching.

### Backlink rules and acquisition

- High-quality backlinks are judged by DR, search traffic, keyword rankings, low outbound-domain count, and strong inbound-domain count.
- Relevance is prioritized over raw quantity.
- Root-domain count is treated as more important than total link count.
- Each landing page should earn its own backlinks.
- Backlink execution is split into manual, semi-automated, and automated layers.
- The source records a WordPress comment-link bypass tactic, but explicitly notes high fragility and platform-version limits.

### 12-week loop and display-ad direction

- Weekly loop: choose keywords, publish pages, build backlinks, review outcomes.
- Review metrics: indexing, impressions, rankings, conversions.
- Long-term display-ad priority in the source: multilingual content tool sites first, small-game keyword-cluster sites second, trend-chasing fast sites as tactical only, evergreen micro-tools as a supporting direction.
- Suggested allocation: `70%` main lane, `20%` second engine, `10%` tactical fast tests.

## Reusable Decision Rules

- Intent fit beats low KD.
- SERP composition beats tool scores.
- Cluster expansion potential determines whether a site has long-term surface area.
- Monetization path must be clear before execution.
- Long-term growth comes from keyword clusters and page matrices, not isolated single-page bets.

## Risks And Limits Noted In Source

- KD and backlink estimates are only heuristics and must be adjusted for link quality and domain strength.
- Some tactics are only suitable for weaker niches and should not be treated as a universal playbook.
- WordPress comment-link tactics may stop working as platform behavior changes.
- Trend sites are explicitly framed as tactical, not a core long-term asset.

## Related Wiki Pages

- [[concepts/seo-tool-site-playbook.md]]
