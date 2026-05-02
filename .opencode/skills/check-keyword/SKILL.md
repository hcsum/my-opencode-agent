---
name: check-keyword
description: Check the SEO potential of a keyword by gathering data from various tools and sources, and summarize the findings in a structured format.
---

## Objective

Fill `./notes/my-keywords.csv` for a given keyword. Check the csv headers for the required fields and fill in the information where applicable. NEVER delete or modify existing entries for other keywords, only append new row or update entries for the current keyword. Respect the existing format and columns in the CSV file.

## Tools to use

- Semrush: see search volume, keyword difficulty, CPC, related keywords etc.
- Ahrefs: check keyword difficulty for cross-checking with Semrush
- Google trends: see trends and related queries
- Search on X: sentiment analysis and community insights, pain points, use cases, etc.
- Search on Reddit: sentiment analysis and community insights, pain points, use cases, etc.
- Inspect SERP: understand search intent and competition

## Notes

- When writing CSV fields, always preserve the exact column count and use proper CSV escaping: if a field contains a comma, double quote, or newline, wrap the entire field in double quotes and escape inner double quotes by doubling them.

