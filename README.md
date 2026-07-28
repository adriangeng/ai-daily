# AI HOT 日报 · 云端自动流水线 🦞

每天北京时间 06:00，GitHub Actions 自动：

1. 拉取 [AI HOT](https://aihot.virxact.com) 当日日报 + 12 只 AI 概念股行情（腾讯自选股接口）
2. 生成桌面版 / 手机版 HTML 仪表盘
3. 发布到 GitHub Pages（固定网址，手机收藏一次即可）
4. 通过 PushPlus / Server酱 推送简报到个人微信

## 固定网址

- 手机版（默认首页）：`https://adriangeng.github.io/ai-daily/`
- 桌面版：`https://adriangeng.github.io/ai-daily/ai_daily_latest.html`

## 微信推送配置

仓库 Settings → Secrets and variables → Actions → New repository secret：

- Name: `PUSH_CONFIG_JSON`
- Value: `{"channel":"pushplus","token":"你的token"}` 或 `{"channel":"serverchan","token":"SCTxxxx"}`

不配置该 Secret 时跳过推送，其余流程照常。

## 手动触发

Actions → AI HOT Daily → Run workflow
