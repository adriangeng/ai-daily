// push_notify.js —— 把当日 AI HOT 日报简报推送到个人微信（Server酱 / PushPlus）
// 用法：node push_notify.js <公网shareLink>
// 通道配置：同目录 .push_config.json，例如
//   { "channel":"serverchan", "token":"SCTxxxxxxxx" }
//   { "channel":"pushplus",   "token":"xxxxxxxx" }
// 个人微信即可收，无需企业微信。token 不写进代码/记忆。

const fs = require('fs');
const path = require('path');
const ROOT = __dirname;
const shareLink = process.argv[2] || '';

const cfgPath = path.join(ROOT, '.push_config.json');
if (!fs.existsSync(cfgPath)) {
  console.log('[push] 未配置 .push_config.json，跳过推送。参考 .push_config.example.json（去 server酱 或 pushplus 拿 token 填入）。');
  process.exit(0);
}
const cfg = JSON.parse(fs.readFileSync(cfgPath, 'utf8'));
const channel = (cfg.channel || 'serverchan').toLowerCase();
const token = cfg.token;
if (!token || token.indexOf('在此') >= 0) {
  console.error('[push] .push_config.json 的 token 未填写');
  process.exit(1);
}

const sumPath = path.join(ROOT, 'ai_daily_summary.json');
if (!fs.existsSync(sumPath)) {
  console.error('[push] 找不到 ai_daily_summary.json，先跑 build.js');
  process.exit(1);
}
const sum = JSON.parse(fs.readFileSync(sumPath, 'utf8'));

const up = (q) => q.change >= 0;
const sign = (q) => (up(q) ? '+' : '');
const stocks = sum.stocks
  .map((q) => `- ${q.name}（${q.mkt}） ${q.currency}${q.price.toFixed(2)} ${sign(q)}${q.changePct.toFixed(2)}%`)
  .join('\n');
const secLine = sum.sectionStats.map((s) => `${s.label} ${s.count}`).join(' ｜ ');
const link = shareLink || '（未提供公网链接，请在本地打开 ai_daily_latest.html）';
const title = `🦞 AI HOT 日报 · ${sum.date}`;

(async () => {
  let url, body;
  if (channel === 'pushplus') {
    url = 'https://www.pushplus.plus/send';
    const content =
      `<h3>${title}</h3>` +
      `<p>总条数 <b>${sum.total}</b> ｜ ${secLine}</p>` +
      `<p><b>AI 概念股（${sum.stocks.length} 只）</b></p>` +
      `<pre>${stocks}</pre>` +
      `<p><a href="${link}">📱 点开看今日完整日报</a></p>` +
      `<p style="color:#999">数据来源 ${sum.source} · 红涨绿跌 · 仅供参考</p>`;
    body = JSON.stringify({ token, title, content, template: 'html', channel: 'wechat' });
  } else {
    url = `https://sctapi.ftqq.com/${token}.send`;
    const desp =
      `> 总条数 **${sum.total}** ｜ ${secLine}\n\n` +
      `**AI 概念股（${sum.stocks.length} 只）**\n${stocks}\n\n` +
      `[📱 点开看今日完整日报](${link})\n` +
      `> 数据来源 ${sum.source} · 红涨绿跌 · 仅供参考`;
    body = JSON.stringify({ title, desp });
  }
  try {
    const r = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body,
    });
    const j = await r.json();
    console.log('[push]', channel, 'response:', JSON.stringify(j));
    const ok = channel === 'pushplus' ? j.code === 200 : (j.code === 0 || j.errcode === 0);
    if (!ok) process.exit(1);
  } catch (e) {
    console.error('[push] 请求失败:', e.message);
    process.exit(1);
  }
})();
