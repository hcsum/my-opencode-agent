---
domain: dailyblogzz.com
aliases: [dailyblogzz, DailyBlogzz]
updated: 2026-06-16
---
## 平台特征
- 开放注册的免费 Web2.0/WordPress 站群，博客建在子域名 `<name>.dailyblogzz.com`。
- 文章正文里的外链可直接 dofollow：公开文章页上的用户外链 `rel` 为空，已在 `everlandcc.dailyblogzz.com` live post 上验证。
- 旧账号/旧子站可能被站点直接封禁；被封后公开页会显示 `Account has been disabled due to a violation of Terms of Service.`，登录时会返回 `Account temporarily suspended`。

## 有效模式
- 注册页：`https://dailyblogzz.com/register`。字段只有 blog name、email、password。
- 初次点 `Register & Create` 后才会要求验证码；当前不是 Google iframe，而是站点自制的 `SecureImg` 图片点选验证码。
- 登录后后台入口是 `https://dailyblogzz.com/Dashboard`。
- 发文必须走后台真实 `https://dailyblogzz.com/new-post` 链接；不要猜 `post-new.php` 之类的传统 WP 路径。
- 编辑器是经典 WordPress + TinyMCE，可通过 `tinyMCE.get("content").setContent(...)` 写入正文，再 `tinyMCE.triggerSave()`。

## 已知陷阱
- 注册页文案会写 `SecureImg reCAPTCHA I'm not a robot`，但实际控件不是标准 Google reCAPTCHA，自动化时可能需要手动触发/由用户接手点选。
- 旧的 `declutteryourhome.dailyblogzz.com` 已被封，不要假设历史账号还能复用。
