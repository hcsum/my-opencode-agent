---
domain: blogs.fr
aliases: [Blogs.fr, Dataxy]
updated: 2026-06-02
---
## 平台特征
- 法国免费博客平台 (édité par Dataxy)，DR ~62。博客建在子域名 `<identifiant>.blogs.fr`。
- 博客正文里的外链是 **dofollow**（`rel` 为空，已在 restaurant-marocain.blogs.fr / villas-de-houlgate.blogs.fr 上验证）。适合做 dofollow 外链。
- 注册页 `https://www.blogs.fr/inscription.php`（链接文字 "Créez votre blog"），从泰国/普通 IP 可访问，不像 blog4ever 那样 IP 封锁。
- 注册后需要邮箱激活：跳到 `activation.php`，平台发激活邮件到注册邮箱，用户点链接才激活博客。

## 有效模式
- 注册表单字段：`login`（=博客子域名+登录名）、`email1`/`email2`、`sexe`(select)、`nom`、`prenom`、`jour`/`mois`/`annee`、`postal`、`ville`(select)、`pays`、`activite`(select)、`motive`(select)、`mdp1`/`mdp2`、`accept`(checkbox)、`code`(图形验证码)。
- **页面上有两个 `name=login` 输入**：左侧"Accès membre"登录框 + 右侧 inscription 的博客名框。要填 inscription 那个：用 `document.querySelector('[name=email1]').form` 锁定表单，再取该 form 内的 `input[name=login]`。
- `ville` 下拉依赖 `postal`：postal 输入框 `onkeyup="check_cp(this.form)"`。程序化填值后 dispatch input/change **不会**触发，需手动 `check_cp(form)`，约 1-2s 后 ville 自动选中对应城市（如 75001 → "Paris 01"）。
- 验证码图 `code_secu.php?w=<token>`，约 130x45px，字符清晰，截图即可肉眼读，不必硬刚。
- 提交按钮文字 "OK, je m'inscris"。成功跳 `activation.php`，失败回 `inscription.php?a=i` 并在字段旁显示红色 alert。
- 已注册账号的具体凭据见 `notes/my-backlinks.csv` 的 blogs.fr 行（不在此文件存密码）。

## 已知陷阱
- **密码规则：3-16 个字符，只能字母+数字，不能有符号**（"!"会被拒："Votre mot de passe n'est pas valide"）。
- 提交失败重渲染后，密码和 postal/ville 会被清空，必须重填；验证码也会刷新成新的，要重新读图。
