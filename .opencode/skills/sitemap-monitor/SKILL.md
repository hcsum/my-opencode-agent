---
name: sitemap-monitor
description: 拉取并对比网站的sitemap，记录新增页面 slug。
---

## 用途

当用户要持续跟踪站点新增页面时，使用这个 skill。

## 入口脚本

`scripts/sitemap-monitor.ts`

## 运行方式

`npx tsx .opencode/skills/sitemap-monitor/scripts/sitemap-monitor.ts [--target site=https://example.com/sitemap.xml]`

