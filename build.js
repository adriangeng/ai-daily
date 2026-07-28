const fs = require('fs');
const path = require('path');

// 项目根 = 脚本所在目录（稳定路径，便于每日自动任务复用）
const ROOT = __dirname;
const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36';

// 渲染模式：node build.js --render 时跳过联网拉取，直接用已落盘的 raw 文件（供 enrich 之后二次渲染）
const RENDER_ONLY = process.argv.includes('--render');

// ---- 自动拉取数据（失败则回退到本地缓存文件） ----
async function fetchJSON(url, timeout = 12000) {
  const ctrl = new AbortController();
  const to = setTimeout(() => ctrl.abort(), timeout);
  try {
    const r = await fetch(url, { signal: ctrl.signal, headers: { 'User-Agent': UA } });
    clearTimeout(to);
    if (!r.ok) throw new Error('HTTP ' + r.status);
    return await r.json();
  } finally { clearTimeout(to); }
}
async function loadDaily() {
  if (RENDER_ONLY && fs.existsSync(path.join(ROOT, 'daily_raw.json'))) {
    return JSON.parse(fs.readFileSync(path.join(ROOT, 'daily_raw.json'), 'utf8'));
  }
  try {
    const d = await fetchJSON('https://aihot.virxact.com/api/public/daily');
    fs.writeFileSync(path.join(ROOT, 'daily_raw.json'), JSON.stringify(d, null, 0));
    return d;
  } catch (e) {
    console.error('[daily] 在线拉取失败，回退本地缓存：', e.message);
    return JSON.parse(fs.readFileSync(path.join(ROOT, 'daily_raw.json'), 'utf8'));
  }
}
async function loadItems() {
  if (RENDER_ONLY && fs.existsSync(path.join(ROOT, 'items_raw.json'))) {
    return JSON.parse(fs.readFileSync(path.join(ROOT, 'items_raw.json'), 'utf8'));
  }
  try {
    const d = await fetchJSON('https://aihot.virxact.com/api/public/items?mode=selected&take=100');
    fs.writeFileSync(path.join(ROOT, 'items_raw.json'), JSON.stringify(d, null, 0));
    return d;
  } catch (e) {
    console.error('[items] 在线拉取失败，回退本地缓存：', e.message);
    return JSON.parse(fs.readFileSync(path.join(ROOT, 'items_raw.json'), 'utf8'));
  }
}

// ---- source section labels (from aihot daily) ----
const CANON_LABELS = ['模型发布/更新', '产品发布/更新', '行业动态', '论文研究', '技巧与观点'];
// ---- 4 展示模块：合并 5 个原始版块 ----
const MODULES = [
  { key: 'model-product', label: '模型 & 产品', secs: ['模型发布/更新', '产品发布/更新'] },
  { key: 'industry-paper', label: '行业 & 论文', secs: ['行业动态', '论文研究'] },
  { key: 'tips', label: '技巧与观点', secs: ['技巧与观点'] },
];

// ---- build title -> publishedAt lookup from items feed (for Beijing time) ----
const norm = (s) => (s || '').trim().toLowerCase();

// ---- today (Beijing) ----
function bjDateStr(d) {
  const bj = new Date(d.getTime() + 8 * 3600 * 1000);
  return bj.getUTCFullYear() + '-' +
    String(bj.getUTCMonth() + 1).padStart(2, '0') + '-' +
    String(bj.getUTCDate()).padStart(2, '0');
}

// ---- truncate Chinese summary to <=60 chars ----
function truncate(str, max = 60) {
  if (!str) return '';
  const arr = Array.from(str);
  if (arr.length <= max) return str;
  return arr.slice(0, max).join('') + '…';
}

// ---- editorial lead (~120 chars) + per-item sharp commentary (truth-style) ----
const LEAD = '今日 AI 两极化：Grok CLI、Suno 上新；ChatGPT 被套出“高中生级”制毒指南、Claude Opus 5 提示词遭泄露。开源战升温，OpenAI 求封中国模型、黄仁勋马斯克护开源；8 美元芯片跑模型，AI 从云掉进掌心。';

const COMMENTS = {
  'xai 发布 grok cli 并支持 /tutorial 命令':
    '马斯克把教程塞进 /tutorial 命令，真相是想让 Grok 成为你敲命令时绕不开的默认助手——抢开发者入口，比多一个聊天窗口重要得多。',
  'suno 推出多项新功能，含midi导出等':
    'Suno 补上 MIDI 导出，真实意图是让你“哼的歌”能直接进专业软件接着改——把玩具变成工作流的第一环，用户就再也难换平台。',
  '数百用户向chatgpt索要毒药与生物武器配方，部分获得高中生水平步骤指南':
    '几百人套出制毒指南，真正的问题不是模型“学坏”，而是 OpenAI 一边内部把 GPT-5 标成高风险、一边没向监管报警——把风险关在门内，对外继续讲安全故事。',
  'openai、anthropic 游说美国限制中国开源模型，黄仁勋与马斯克公开反对':
    'OpenAI 求封中国开源、黄仁勋却护开源，真相是立场由“卖什么”决定：卖铲子的永远挺开放，怕被白嫖的模型厂才喊封锁。',
  '在 8 美元的 esp32-s3 微控制器上运行 28.9m 参数大语言模型':
    '8 美元芯片跑起大模型，真正说明的不是“端侧革命”到来，而是够用的小模型已经能跑在垃圾硬件上——AI 能力的下限正被快速拉低、走向普惠。',
  'claude opus 5 系统提示词被完整泄露，共 135027 字符、约 3.4 万 token':
    '13 万字提示词被扒光，真正曝光的不是安全事故，而是 Claude 早已把“主动推荐自家 App”写进系统指令——你以为在聊天，它其实在当销售；至于 24 小时冒出的 3D 游戏 Demo，无论是否故意，效果上都成了 Anthropic 一场全网免费的能力营销。',
};

// ---- editorial "truth" commentary for TODAY's empty sections (meta, not a news item) ----
const SECTION_COMMENTS = {
  '模型发布/更新':
    '今日无重磅模型发布，真相是厂商在憋闭源大招、或把弹药排到下月——表面平静实则在排期，别被“今天没新闻”骗了。',
  '论文研究':
    '今日无顶会级论文进简报，不是没人发，而是能被社区挑出来、值得精读的还没冒头——热闹在产线，不在 arXiv。',
};

// ---- 读取 AI 增强产物（enrich.js 生成；缺失时规则降级） ----
let ENR = null;
try { ENR = JSON.parse(fs.readFileSync(path.join(ROOT, 'ai_daily_enriched.json'), 'utf8')); } catch (e) {}
function expSummary(title, fallback) {
  if (ENR && Array.isArray(ENR.expanded)) {
    const t = norm(title);
    const hit = ENR.expanded.find((x) => norm(x.title) === t);
    if (hit && hit.summary) return hit.summary;
  }
  return fallback;
}
function modReview(key) {
  if (ENR && ENR.moduleReviews && ENR.moduleReviews[key]) return ENR.moduleReviews[key];
  return '';
}

// ---- AI-related stock quotes (snapshot at build time, via Tencent 自选股) ----
const MKT = {
  us:  { prefix:'us', cur:'USD', sym:'$',   tz:'America/New_York', label:'美股' },
  sh:  { prefix:'sh', cur:'CNY', sym:'¥',   tz:'Asia/Shanghai',    label:'A股' },
  sz:  { prefix:'sz', cur:'CNY', sym:'¥',   tz:'Asia/Shanghai',    label:'A股' },
  hk:  { prefix:'hk', cur:'HKD', sym:'HK$', tz:'Asia/Hong_Kong',  label:'港股' },
  kr:  { prefix:'kr', cur:'KRW', sym:'₩',   tz:'Asia/Seoul',       label:'韩股' },
};

const STOCK_DEFS = [
  { t:'NVDA', name:'英伟达', mkt:'us' },
  { t:'MSFT', name:'微软', mkt:'us' },
  { t:'GOOGL', name:'谷歌', mkt:'us' },
  { t:'AMD', name:'AMD', mkt:'us' },
  { t:'TSLA', name:'特斯拉', mkt:'us' },
  { t:'005930', name:'三星电子', mkt:'kr' },
  { t:'000660', name:'SK海力士', mkt:'kr' },
  { t:'02513', name:'智谱', mkt:'hk' },
];

function tzOffsetMs(tz, date) {
  const nm = new Intl.DateTimeFormat('en-US', {
    timeZone: tz, timeZoneName: 'shortOffset', hour12: false,
  }).formatToParts(new Date(date)).find((p) => p.type === 'timeZoneName').value;
  const m = nm.match(/GMT([+-]?\d+)/);
  const oh = m ? parseInt(m[1], 10) : 0;
  return oh * 3600 * 1000;
}
function wallToBeijing(str, tz) {
  if (!str) return '';
  const s = str.replace(/[^\d]/g, '');
  if (s.length < 14) return '';
  const Y=+s.slice(0,4), M=+s.slice(4,6), D=+s.slice(6,8),
        h=+s.slice(8,10), mi=+s.slice(10,12), sec=+s.slice(12,14);
  const asUTC = Date.UTC(Y, M-1, D, h, mi, sec);
  const utc = asUTC - tzOffsetMs(tz, new Date(asUTC));
  const bj = new Date(utc + 8*3600*1000);
  const wk = ['日','一','二','三','四','五','六'][bj.getUTCDay()];
  const p2 = (n) => String(n).padStart(2,'0');
  return (bj.getUTCMonth()+1) + '月' + bj.getUTCDate() + '日 周' + wk + ' ' +
    p2(bj.getUTCHours()) + ':' + p2(bj.getUTCMinutes());
}

async function fetchQuote(def) {
  const mk = MKT[def.mkt];
  const url = 'https://qt.gtimg.cn/q=' + mk.prefix + def.t;
  try {
    const ctrl = new AbortController();
    const to = setTimeout(() => ctrl.abort(), 8000);
    const r = await fetch(url, {
      signal: ctrl.signal,
      headers: { 'User-Agent': UA, 'Referer': 'https://gu.qq.com/' },
    });
    clearTimeout(to);
    if (!r.ok) return null;
    const buf = Buffer.from(await r.arrayBuffer());
    const txt = buf.toString('latin1');
    const m = txt.match(/="([^"]*)"/);
    if (!m) return null;
    const f = m[1].split('~');
    const price = parseFloat(f[3]);
    const prev = parseFloat(f[4]);
    if (!isFinite(price) || !isFinite(prev)) return null;
    let tIdx = -1;
    for (let i = 0; i < f.length; i++) {
      const v = (f[i] || '').trim();
      if (/^\d{4}[-/]\d{2}[-/]\d{2}[ T]\d{2}:\d{2}:\d{2}$/.test(v) || /^\d{14}$/.test(v)) tIdx = i;
    }
    const change = price - prev;
    const pct = prev ? (change / prev) * 100 : 0;
    const hi = tIdx >= 0 ? parseFloat(f[tIdx + 3]) : NaN;
    const lo = tIdx >= 0 ? parseFloat(f[tIdx + 4]) : NaN;
    const tStr = tIdx >= 0 ? f[tIdx].trim() : '';
    return {
      t: def.t, name: def.name, mkt: def.mkt, mktLabel: mk.label,
      price, prev, change, changePct: pct,
      currency: mk.cur, sym: mk.sym,
      bjTime: wallToBeijing(tStr, mk.tz),
      dayHigh: isFinite(hi) ? hi : null,
      dayLow: isFinite(lo) ? lo : null,
    };
  } catch (e) { return null; }
}

// ============ 主流程 ============
(async () => {
  const daily = await loadDaily();
  const itemsResp = await loadItems();

  const pubMap = new Map();
  for (const it of (itemsResp.items || [])) {
    const k = norm(it.title);
    if (k && !pubMap.has(k)) pubMap.set(k, it.publishedAt || null);
  }

  const bjNow = new Date(Date.now() + 8 * 3600 * 1000);
  const bjToday = bjDateStr(new Date());
  const isToday = daily.date === bjToday;

  // ---- assemble 4 展示模块（合并 5 原始版块，全局编号连续） ----
  const modules = [];
  let globalN = 0;
  const byLabel = {};
  for (const sec of (daily.sections || [])) byLabel[sec.label] = sec;

  for (const m of MODULES) {
    const items = [];
    for (const lab of m.secs) {
      const sec = byLabel[lab];
      const rawItems = (sec && sec.items) || [];
      for (const it of rawItems) {
        globalN += 1;
        items.push({
          n: globalN,
          title: it.title || '(无标题)',
          summary: expSummary(it.title, truncate(it.summary, 60)),
          sourceName: it.sourceName || it.source || '未知来源',
          sourceUrl: it.sourceUrl || it.url || '#',
          publishedAt: pubMap.get(norm(it.title)) || null,
          comment: COMMENTS[norm(it.title)] || '',
        });
      }
    }
    modules.push({
      key: m.key, label: m.label,
      items, empty: items.length === 0,
      review: modReview(m.key),
    });
  }

  // ---- flashes (bonus, continue global numbering) ----
  const flashes = (daily.flashes || []).map((f) => {
    globalN += 1;
    return {
      n: globalN,
      title: f.title || '(无标题)',
      summary: truncate(f.summary, 60),
      sourceName: f.sourceName || '未知来源',
      sourceUrl: f.sourceUrl || '#',
      publishedAt: f.publishedAt || null,
    };
  });

  const total = globalN;
  const matchedTime = modules.reduce((a, s) => a + s.items.filter((i) => i.publishedAt).length, 0);
  const moduleStats = modules.map((m) => ({ label: m.label, count: m.items.length }));
  moduleStats.push({ label: 'AI 概念股', count: STOCK_DEFS.length });

  // ---- stocks ----
  let stocks = [];
  try {
    const qs = await Promise.all(STOCK_DEFS.map((s) => fetchQuote(s)));
    stocks = qs.filter(Boolean);
  } catch (e) { console.error('stock fetch error:', e.message); }

  const DATA = {
    date: daily.date,
    isToday,
    generatedAt: daily.generatedAt || null,
    lead: (ENR && ENR.leadText) ? ENR.leadText : LEAD,
    bubbleComment: (ENR && ENR.bubbleComment) ? ENR.bubbleComment : '',
    leadTitle: daily.lead && daily.lead.title ? daily.lead.title : null,
    modules,
    flashes,
    total,
    moduleStats,
    source: 'aihot.virxact.com',
    stocks,
    stockSource: '腾讯自选股',
  };

  const clientDesktop = fs.readFileSync(path.join(ROOT, 'client.js'), 'utf8');
  const clientMobile = fs.readFileSync(path.join(ROOT, 'client_mobile.js'), 'utf8');
  const htmlTail = `
</script>
</body>
</html>`;

  const base = 'ai_daily';
  const dateStr = daily.date;
  const outs = [
    { name: base + '_latest.html', mobile: false },
    { name: base + '_' + dateStr + '.html', mobile: false },
    { name: base + '_mobile_latest.html', mobile: true, alsoIndex: true },
    { name: base + '_mobile_' + dateStr + '.html', mobile: true },
  ];

  for (const o of outs) {
    const head = makeHead(daily, o.mobile);
    const client = o.mobile ? clientMobile : clientDesktop;
    const html = head + 'const DATA = ' + JSON.stringify(DATA) + ';\n' + client + htmlTail;
    fs.writeFileSync(path.join(ROOT, o.name), html, 'utf8');
    if (o.alsoIndex) {
      fs.writeFileSync(path.join(ROOT, 'index.html'), html, 'utf8'); // 公网部署根入口
    }
  }

  // 写聚合摘要（供推送脚本使用，轻量、不含完整 HTML）
  fs.writeFileSync(path.join(ROOT, 'ai_daily_summary.json'), JSON.stringify({
    date: daily.date, isToday, total, moduleStats,
    stocks: stocks.map((q) => ({
      t: q.t, name: q.name, mkt: q.mktLabel, price: q.price,
      change: q.change, changePct: q.changePct, currency: q.currency, bjTime: q.bjTime,
    })),
    source: 'aihot.virxact.com',
  }, null, 0));

  console.log('date=' + daily.date + ' isToday=' + isToday +
    ' total=' + total + ' timeMatched=' + matchedTime + '/' + total +
    ' stocks=' + stocks.length + '/' + STOCK_DEFS.length);
  console.log('written 4 files + summary -> ' + base + '{_latest,_' + dateStr + '}{,_mobile}.html');
})();

// ============ HTML 头（含 body 骨架，桌面/移动共用骨架，仅 CSS 不同） ============
function makeHead(daily, mobile) {
  const css = mobile ? MOBILE_CSS : DESKTOP_CSS;
  const vp = mobile
    ? '<meta name="viewport" content="width=device-width, initial-scale=1, maximum-scale=1, user-scalable=no, viewport-fit=cover">'
    : '<meta name="viewport" content="width=device-width, initial-scale=1.0">';
  return `<!DOCTYPE html>
<html lang="zh-CN">
<head>
<meta charset="UTF-8">
${vp}
<title>AI HOT 日报 FOR ADRIAN · ${daily.date}</title>
<style>
${css}
</style>
</head>
<body>
  <header class="hero">
    <div class="wrap">
      <div class="kicker">AI HOT Daily · 中文 AI 资讯晨报</div>
      <h1>AI HOT 日报 FOR ADRIAN</h1>
      <div class="date" id="heroDate"></div>
      <div class="meta" id="heroMeta"></div>
      <div id="fallbackBox"></div>
      <div class="leadbox" id="leadBox"><span class="lt">今日导读</span><span id="leadText"></span></div>
      <div class="stats" id="stats"></div>
      <div class="total">
        <span class="big" id="totalNum">0</span>
        <span class="t">条 AI 动态 · 四模块全覆盖</span>
      </div>
    </div>
  </header>

  <nav class="nav"><div class="wrap" id="nav"></div></nav>

  <main class="wrap" id="main"></main>

  <footer>
    <div class="wrap">
      <div class="ftotal" id="footTotal"></div>
      <div>数据来源：<a href="https://aihot.virxact.com" target="_blank" rel="noopener noreferrer">aihot.virxact.com</a>
        · 本页为离线快照，所有内容以原文为准</div>
    </div>
  </footer>

  <button id="top" title="回到顶部">↑</button>

<script>`;
}

const DESKTOP_CSS = `  :root{
    --bg:#f5f7fb; --card:#ffffff; --ink:#1b2230; --sub:#5b6677;
    --line:#e7ebf2; --brand:#3b5bff; --brand2:#7a4dff;
    --chip:#eef2ff; --chipink:#3b5bff;
    --s1:#3b5bff; --s2:#00a37a; --s3:#ff8a3d; --s4:#a259ff; --s5:#ff5d8f;
  }
  *{box-sizing:border-box;margin:0;padding:0}
  html{scroll-behavior:smooth}
  body{
    font-family:-apple-system,BlinkMacSystemFont,"Segoe UI","PingFang SC","Hiragino Sans GB","Microsoft YaHei",sans-serif;
    background:var(--bg);color:var(--ink);line-height:1.6;
    -webkit-font-smoothing:antialiased;
  }
  a{color:inherit;text-decoration:none}
  .wrap{max-width:1180px;margin:0 auto;padding:0 20px}

  .hero{
    background:linear-gradient(135deg,#3b5bff 0%,#7a4dff 100%);
    color:#fff;padding:46px 0 54px;position:relative;overflow:hidden;
  }
  .hero::after{content:"";position:absolute;right:-80px;top:-80px;width:320px;height:320px;
    background:radial-gradient(circle,rgba(255,255,255,.18),transparent 70%);}
  .hero .kicker{font-size:13px;letter-spacing:2px;opacity:.85;text-transform:uppercase}
  .hero h1{font-size:40px;font-weight:800;margin:6px 0 2px;letter-spacing:1px}
  .hero .date{font-size:20px;font-weight:600;opacity:.95}
  .hero .meta{margin-top:10px;font-size:13.5px;opacity:.9}
  .fallback{margin-top:14px;display:inline-block;background:rgba(255,255,255,.18);
    border:1px solid rgba(255,255,255,.35);padding:6px 12px;border-radius:999px;font-size:13px}
  .leadbox{margin-top:18px;background:rgba(255,255,255,.12);border-left:4px solid #fff;
    border-radius:10px;padding:14px 18px;font-size:14.5px;line-height:1.75;max-width:840px}
  .leadbox .lt{font-size:12px;letter-spacing:2px;opacity:.8;text-transform:uppercase;margin-bottom:6px;display:block}
  .bubble{margin-top:13px;border-top:1px dashed rgba(255,255,255,.4);padding-top:11px;font-size:13.5px;line-height:1.75}
  .bubble .bl{font-weight:800;display:block;margin-bottom:5px;opacity:.96}
  .stats{display:flex;flex-wrap:wrap;gap:12px;margin-top:26px}
  .stat{background:rgba(255,255,255,.14);border:1px solid rgba(255,255,255,.22);
    border-radius:14px;padding:12px 16px;min-width:120px}
  .stat .num{font-size:26px;font-weight:800;line-height:1}
  .stat .lab{font-size:12.5px;opacity:.9;margin-top:6px}
  .total{display:flex;align-items:center;gap:10px;margin-top:22px;
    background:rgba(255,255,255,.14);border-radius:14px;padding:12px 18px;width:fit-content}
  .total .big{font-size:30px;font-weight:800}
  .total .t{font-size:14px;opacity:.92}

  .nav{position:sticky;top:0;z-index:20;background:rgba(245,247,251,.92);
    backdrop-filter:blur(8px);border-bottom:1px solid var(--line);padding:12px 0}
  .nav .wrap{display:flex;flex-wrap:wrap;gap:10px;align-items:center}
  .nav a{font-size:13.5px;font-weight:600;color:var(--sub);background:#fff;
    border:1px solid var(--line);border-radius:999px;padding:7px 14px;transition:.18s;display:flex;gap:7px;align-items:center}
  .nav a:hover{border-color:var(--brand);color:var(--brand);transform:translateY(-1px)}
  .nav a .c{background:var(--chip);color:var(--chipink);border-radius:999px;
    font-size:11.5px;padding:1px 7px;font-weight:700}

  .section{margin:34px 0 8px;scroll-margin-top:64px}
  .sec-head{display:flex;align-items:center;gap:12px;margin-bottom:18px}
  .sec-dot{width:12px;height:12px;border-radius:4px;flex:none}
  .sec-head h2{font-size:22px;font-weight:800}
  .sec-head .cnt{font-size:13px;color:var(--sub);background:#fff;border:1px solid var(--line);
    border-radius:999px;padding:2px 10px}
  .grid{display:grid;grid-template-columns:repeat(auto-fill,minmax(290px,1fr));gap:16px}

  .card{background:var(--card);border:1px solid var(--line);border-radius:16px;
    padding:18px 18px 16px;display:flex;flex-direction:column;position:relative;
    transition:.18s;box-shadow:0 1px 2px rgba(20,30,60,.04)}
  .card:hover{transform:translateY(-3px);box-shadow:0 10px 26px rgba(40,60,120,.12);border-color:#d7def0}
  .c-top{display:flex;align-items:center;gap:10px;margin-bottom:10px}
  .badge{flex:none;width:30px;height:30px;border-radius:9px;color:#fff;font-weight:800;
    font-size:14px;display:flex;align-items:center;justify-content:center;
    background:linear-gradient(135deg,var(--brand),var(--brand2))}
  .chip{font-size:12px;font-weight:600;color:var(--chipink);background:var(--chip);
    border-radius:999px;padding:3px 10px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;max-width:170px}
  .ctime{margin-left:auto;font-size:11.5px;color:var(--sub);flex:none}
  .card h3{font-size:16px;font-weight:700;line-height:1.45;margin-bottom:8px}
  .card .sum{font-size:13.5px;color:var(--sub);flex:1;margin-bottom:12px}
  .comment{border-left:3px solid var(--brand2);background:#faf9ff;border-radius:0 8px 8px 0;
    padding:8px 11px;font-size:12.5px;line-height:1.6;color:#3a2d5c;margin-bottom:14px}
  .comment .cl{font-weight:800;color:var(--brand2);margin-right:6px}
  .comment.edit{border-left-color:var(--s3);background:#fff8f1}
  .comment.edit .cl{color:var(--s3)}
  .card .go{margin-top:auto;font-size:13px;font-weight:700;color:var(--brand);
    display:inline-flex;align-items:center;gap:5px}
  .card .go::after{content:"→";transition:.18s}
  .card:hover .go::after{transform:translateX(3px)}

  .flash-grid .card{border-style:dashed}
  .sec-flash .sec-dot{background:#94a3b8}

  .sec-stocks .sec-dot{background:var(--s5)}
  .sec-cap{font-size:12.5px;color:var(--sub);margin:-8px 0 16px}
  .sec-cap a{color:var(--brand);font-weight:600}
  .stocks-grid{display:grid;grid-template-columns:repeat(auto-fill,minmax(196px,1fr));gap:14px}
  .stock-card{background:var(--card);border:1px solid var(--line);border-radius:14px;
    padding:14px 16px;position:relative;overflow:hidden;transition:.18s}
  .stock-card:hover{transform:translateY(-2px);box-shadow:0 8px 20px rgba(40,60,120,.1)}
  .stock-card.up{border-top:3px solid #e23c31}
  .stock-card.down{border-top:3px solid #0a9a52}
  .sc-top{display:flex;align-items:baseline;gap:8px;margin-bottom:8px}
  .sc-tk{font-weight:800;font-size:15px;letter-spacing:.3px}
  .sc-name{font-size:12.5px;color:var(--sub)}
  .sc-mkt{margin-left:auto;font-size:11px;font-weight:700;color:#5b6b8c;background:#eef2f9;
    border:1px solid #dfe6f2;border-radius:999px;padding:1px 8px;white-space:nowrap}
  .sc-price{font-size:21px;font-weight:800;display:flex;align-items:baseline;gap:8px;flex-wrap:wrap;line-height:1.2}
  .sc-cur{font-size:13px;font-weight:700;opacity:.7}
  .sc-chg{font-size:13px;font-weight:700}
  .up .sc-price,.up .sc-chg{color:#e23c31}
  .down .sc-price,.down .sc-chg{color:#0a9a52}
  .sc-range{font-size:11.5px;color:var(--sub);margin-top:7px}
  .sc-time{font-size:11px;color:var(--sub);margin-top:5px;opacity:.85}
  .stocks-empty{grid-column:1/-1;color:var(--sub);font-size:13.5px;background:#fff;
    border:1px dashed var(--line);border-radius:14px;padding:18px 20px}

  footer{margin:48px 0 40px;padding-top:24px;border-top:1px solid var(--line);
    text-align:center;color:var(--sub);font-size:13px}
  footer .ftotal{font-size:15px;font-weight:700;color:var(--ink);margin-bottom:6px}
  footer a{color:var(--brand);font-weight:600}

  #top{position:fixed;right:22px;bottom:22px;width:44px;height:44px;border-radius:50%;
    background:linear-gradient(135deg,var(--brand),var(--brand2));color:#fff;border:none;
    font-size:20px;cursor:pointer;box-shadow:0 6px 18px rgba(60,90,255,.4);
    opacity:0;pointer-events:none;transition:.25s;z-index:30}
  #top.show{opacity:1;pointer-events:auto}
  @media(max-width:560px){
    .hero h1{font-size:30px}.hero .date{font-size:17px}
    .wrap{padding:0 14px}.grid{grid-template-columns:1fr}
  }`;

const MOBILE_CSS = `  :root{
    --bg:#f3f5fa; --card:#ffffff; --ink:#1b2230; --sub:#5b6677;
    --line:#e7ebf2; --brand:#3b5bff; --brand2:#7a4dff;
    --chip:#eef2ff; --chipink:#3b5bff;
    --s1:#3b5bff; --s2:#00a37a; --s3:#ff8a3d; --s4:#a259ff; --s5:#ff5d8f;
  }
  *{box-sizing:border-box;margin:0;padding:0;-webkit-tap-highlight-color:transparent}
  html{-webkit-text-size-adjust:100%}
  body{
    font-family:-apple-system,BlinkMacSystemFont,"Segoe UI","PingFang SC","Hiragino Sans GB","Microsoft YaHei",sans-serif;
    background:var(--bg);color:var(--ink);line-height:1.65;
    -webkit-font-smoothing:antialiased;
  }
  a{color:inherit;text-decoration:none}
  .wrap{padding:0 14px}

  .hero{
    background:linear-gradient(135deg,#3b5bff 0%,#7a4dff 100%);
    color:#fff;padding:30px 0 34px;
  }
  .hero .kicker{font-size:12px;letter-spacing:1.5px;opacity:.85}
  .hero h1{font-size:28px;font-weight:800;margin:4px 0 2px}
  .hero .date{font-size:17px;font-weight:600;opacity:.95}
  .hero .meta{margin-top:8px;font-size:12.5px;opacity:.88}
  .fallback{margin-top:12px;display:inline-block;background:rgba(255,255,255,.18);
    border:1px solid rgba(255,255,255,.35);padding:5px 11px;border-radius:999px;font-size:12px}
  .leadbox{margin-top:14px;background:rgba(255,255,255,.13);border-left:4px solid #fff;
    border-radius:9px;padding:12px 14px;font-size:14px;line-height:1.7}
  .leadbox .lt{font-size:11px;letter-spacing:1.5px;opacity:.8;display:block;margin-bottom:5px}
  .bubble{margin-top:11px;border-top:1px dashed rgba(255,255,255,.4);padding-top:10px;font-size:13.5px;line-height:1.7}
  .bubble .bl{font-weight:800;display:block;margin-bottom:4px;opacity:.96}
  .stats{display:flex;flex-wrap:wrap;gap:8px;margin-top:18px}
  .stat{flex:1 1 28%;background:rgba(255,255,255,.14);border:1px solid rgba(255,255,255,.22);
    border-radius:12px;padding:10px 12px;min-width:0}
  .stat .num{font-size:21px;font-weight:800;line-height:1.1}
  .stat .lab{font-size:11.5px;opacity:.9;margin-top:4px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
  .total{display:flex;align-items:center;gap:8px;margin-top:16px;
    background:rgba(255,255,255,.14);border-radius:12px;padding:10px 14px}
  .total .big{font-size:26px;font-weight:800}
  .total .t{font-size:13px;opacity:.92}

  .nav{background:#fff;border-bottom:1px solid var(--line);padding:10px 0;
    overflow-x:auto;-webkit-overflow-scrolling:touch;white-space:nowrap}
  .nav .wrap{display:flex;gap:8px;padding:0 12px}
  .nav a{font-size:13px;font-weight:600;color:var(--sub);background:#f3f5fa;
    border:1px solid var(--line);border-radius:999px;padding:7px 13px;display:inline-flex;gap:6px;align-items:center;flex:none}
  .nav a .c{background:var(--chip);color:var(--chipink);border-radius:999px;
    font-size:11px;padding:1px 6px;font-weight:700}

  .section{margin:26px 0 6px;scroll-margin-top:8px}
  .sec-head{display:flex;align-items:center;gap:10px;margin-bottom:14px}
  .sec-dot{width:10px;height:10px;border-radius:3px;flex:none}
  .sec-head h2{font-size:19px;font-weight:800}
  .sec-head .cnt{font-size:12px;color:var(--sub);background:#fff;border:1px solid var(--line);
    border-radius:999px;padding:2px 9px}
  .grid{display:flex;flex-direction:column;gap:12px}

  .card{background:var(--card);border:1px solid var(--line);border-radius:14px;
    padding:15px 15px 14px;display:flex;flex-direction:column;box-shadow:0 1px 2px rgba(20,30,60,.04)}
  .c-top{display:flex;align-items:center;gap:9px;margin-bottom:9px}
  .badge{flex:none;width:28px;height:28px;border-radius:8px;color:#fff;font-weight:800;
    font-size:13px;display:flex;align-items:center;justify-content:center;
    background:linear-gradient(135deg,var(--brand),var(--brand2))}
  .chip{font-size:11.5px;font-weight:600;color:var(--chipink);background:var(--chip);
    border-radius:999px;padding:3px 9px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;max-width:52%}
  .ctime{margin-left:auto;font-size:11px;color:var(--sub);flex:none}
  .card h3{font-size:16.5px;font-weight:700;line-height:1.45;margin-bottom:7px}
  .card .sum{font-size:14px;color:var(--sub);margin-bottom:11px}
  .comment{border-left:3px solid var(--brand2);background:#faf9ff;border-radius:0 8px 8px 0;
    padding:8px 11px;font-size:13px;line-height:1.6;color:#3a2d5c;margin-bottom:12px}
  .comment .cl{font-weight:800;color:var(--brand2);margin-right:6px}
  .comment.edit{border-left-color:var(--s3);background:#fff8f1}
  .comment.edit .cl{color:var(--s3)}
  .card .go{margin-top:auto;font-size:14.5px;font-weight:700;color:#fff;
    background:linear-gradient(135deg,var(--brand),var(--brand2));
    border-radius:11px;padding:11px 14px;display:flex;align-items:center;justify-content:center;gap:6px;
    min-height:44px}

  .flash-grid .card{border-style:dashed}
  .sec-flash .sec-dot{background:#94a3b8}

  .sec-stocks .sec-dot{background:var(--s5)}
  .sec-cap{font-size:12px;color:var(--sub);margin:-6px 0 14px;line-height:1.7}
  .sec-cap a{color:var(--brand);font-weight:600}
  .stocks-grid{display:grid;grid-template-columns:repeat(2,1fr);gap:10px}
  .stock-card{background:var(--card);border:1px solid var(--line);border-radius:12px;
    padding:11px 12px;position:relative;overflow:hidden}
  .stock-card.up{border-top:3px solid #e23c31}
  .stock-card.down{border-top:3px solid #0a9a52}
  .sc-top{display:flex;align-items:baseline;gap:5px;margin-bottom:6px;flex-wrap:wrap}
  .sc-tk{font-weight:800;font-size:13.5px;letter-spacing:.3px}
  .sc-name{font-size:11.5px;color:var(--sub)}
  .sc-mkt{margin-left:auto;font-size:10px;font-weight:700;color:#5b6b8c;background:#eef2f9;
    border:1px solid #dfe6f2;border-radius:999px;padding:1px 6px;white-space:nowrap}
  .sc-price{font-size:18px;font-weight:800;display:flex;align-items:baseline;gap:5px;flex-wrap:wrap;line-height:1.2}
  .sc-cur{font-size:11.5px;font-weight:700;opacity:.7}
  .sc-chg{font-size:12px;font-weight:700}
  .up .sc-price,.up .sc-chg{color:#e23c31}
  .down .sc-price,.down .sc-chg{color:#0a9a52}
  .sc-range{font-size:10.5px;color:var(--sub);margin-top:5px}
  .sc-time{font-size:10px;color:var(--sub);margin-top:3px;opacity:.85}
  .stocks-empty{grid-column:1/-1;color:var(--sub);font-size:13px;background:#fff;
    border:1px dashed var(--line);border-radius:12px;padding:16px 18px}

  footer{margin:38px 0 30px;padding-top:20px;border-top:1px solid var(--line);
    text-align:center;color:var(--sub);font-size:12.5px}
  footer .ftotal{font-size:14px;font-weight:700;color:var(--ink);margin-bottom:6px}
  footer a{color:var(--brand);font-weight:600}

  #top{position:fixed;right:16px;bottom:16px;width:42px;height:42px;border-radius:50%;
    background:linear-gradient(135deg,var(--brand),var(--brand2));color:#fff;border:none;
    font-size:19px;cursor:pointer;box-shadow:0 6px 18px rgba(60,90,255,.4);
    opacity:0;pointer-events:none;transition:.25s;z-index:30}
  #top.show{opacity:1;pointer-events:auto}`;
