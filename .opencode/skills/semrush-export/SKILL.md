---
name: semrush-export
description: 在 Semrush 页面导出关键词 CSV（按域名、数据库、Volume/KD 过滤）。
---

## 用途

当用户要从 Semrush 导出关键词数据时，使用这个 skill。

## 入口脚本

`scripts/semrush-export.ts`

## 运行方式

`npx tsx .opencode/skills/semrush-export/scripts/semrush-export.ts <domain> [--db us] [--min-volume 1000] [--max-kd 40]`

## 结果

导出的 CSV 会被保存到 `notes/keywords/`。
