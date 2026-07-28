// notify.js —— 增强版微信推送（新建文件，不修改原 push_notify.js 四件套）
// 用法：node notify.js <shareLink>
// 读取 ai_daily_summary.json + 可选 ai_daily_enriched.json（AI 点评，由 enrich.js 生成）
const fs = require('fs');
const path = require('path');
const ROOT = __dirname;
const shareLink = process.argv[2] || '';

const cfgPath = path.join(ROOT, '.push_config.json');
if (!fs.existsSync(cfgPath)) {
  console.log('[notify] 未配置 .push_config.json，跳过推送');
  process.exit(0);
}
const cfg = JSON.parse(fs.readFileSync(cfgPath, 'utf8'));
const channel = (cfg.channel || 'serverchan').toLowerCase();
const token = cfg.token;
if (!token || token.indexOf('在此') >= 0) {
  console.error('[notify] .push_config.json 的 token 未填写');
  process.exit(1);
}

const sumPath = path.join(ROOT, 'ai_daily_summary.json');
if (!fs.existsSync(sumPath)) {
  console.error('[notify] 找不到 ai_daily_summary.json，先跑 build.js');
  process.exit(1);
}
const sum = JSON.parse(fs.readFileSync(sumPath, 'utf8'));

// 可选 AI 点评
let enr = null;
const enrPath = path.join(ROOT, 'ai_daily_enriched.json');
if (fs.existsSync(enrPath)) {
  try { enr = JSON.parse(fs.readFileSync(enrPath, 'utf8')); } catch (e) { enr = null; }
}

// 股票：按涨跌幅排序 + emoji（红涨绿跌）+ 异动标注
const sorted = [...sum.stocks].sort((a, b) => b.changePct - a.changePct);
const arrow = (q) => (q.changePct > 0 ? '🔴' : q.changePct < 0 ? '🟢' : '⚪');
const warn = (q) => (Math.abs(q.changePct) >= 5 ? ' ⚠️' : '');
const stocksTxt = sorted
  .map((q) => `${arrow(q)} ${q.name}（${q.mkt}）${q.currency}${q.price} ${q.changePct >= 0 ? '+' : ''}${q.changePct.toFixed(2)}%${warn(q)}`)
  .join('\n');
const upN = sum.stocks.filter((q) => q.changePct > 0).length;
const downN = sum.stocks.filter((q) => q.changePct < 0).length;

const secEmoji = { '模型发布/更新': '🤖', '产品发布/更新': '📦', '行业动态': '🌐', '论文研究': '📄', '技巧与观点': '💡' };
const secLine = sum.sectionStats.map((s) => `${secEmoji[s.label] || '•'} ${s.label} ${s.count}`).join(' ｜ ');

const link = shareLink || '（未提供链接）';
const title = `🦞 AI HOT 日报 · ${sum.date}`;

// 头条 + 精选（来自 AI 点评）
let highlight = '';
if (enr && enr.headline && enr.headline.title) {
  highlight += `🔥 今日头条\n${enr.headline.title}\n💬 ${enr.headline.comment || ''}\n\n`;
}
if (enr && Array.isArray(enr.picks) && enr.picks.length) {
  highlight += '✨ 精选速览\n' + enr.picks.map((p, i) => `${i + 1}. ${p.title}\n   💬 ${p.comment || ''}`).join('\n') + '\n\n';
}
if (enr && enr.stockComment) highlight += `📊 盘面：${enr.stockComment}\n\n`;

(async () => {
  let url, body;
  if (channel === 'pushplus') {
    url = 'https://www.pushplus.plus/send';
    const content =
      `<h3>${title}</h3>` +
      `<p>📌 总条数 <b>${sum.total}</b> ｜ 涨 ${upN} / 跌 ${downN}</p>` +
      `<p>${secLine}</p>` +
      (highlight ? `<p>${highlight.replace(/\n/g, '<br>')}</p>` : '') +
      `<p><b>AI 概念股（${sum.stocks.length} 只）</b></p>` +
      `<pre>${stocksTxt}</pre>` +
      `<p><a href="${link}">📱 点开看今日完整日报</a></p>` +
      `<p style="color:#999">数据来源 ${sum.source || 'AI HOT'} · 红涨绿跌 · 仅供参考</p>`;
    body = JSON.stringify({ token, title, content, template: 'html', channel: 'wechat' });
  } else {
    url = `https://sctapi.ftqq.com/${token}.send`;
    const desp =
      `> 📌 总条数 **${sum.total}** ｜ 涨 ${upN} / 跌 ${downN}\n\n` +
      `${secLine}\n\n` +
      (highlight ? highlight + '\n' : '') +
      `**AI 概念股（${sum.stocks.length} 只）**\n${stocksTxt}\n\n` +
      `[📱 点开看今日完整日报](${link})\n` +
      `> 数据来源 ${sum.source || 'AI HOT'} · 红涨绿跌 · 仅供参考`;
    body = JSON.stringify({ title, desp });
  }
  try {
    const r = await fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body });
    const j = await r.json();
    console.log('[notify]', channel, 'response:', JSON.stringify(j));
    const ok = channel === 'pushplus' ? j.code === 200 : j.code === 0 || j.errcode === 0;
    if (!ok) process.exit(1);
  } catch (e) {
    console.error('[notify] 请求失败:', e.message);
    process.exit(1);
  }
})();
