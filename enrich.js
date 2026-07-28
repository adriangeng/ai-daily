// enrich.js —— 调用云端 LLM 生成增强内容（新建文件，不修改原四件套）
// 读取 daily_raw.json（当日资讯，与 build.js 渲染顺序一致）+ ai_daily_summary.json（股票）
// 输出 ai_daily_enriched.json，供 build.js（网页）与 notify.js（微信）消费
// 生成内容：①每条新闻 130-170 字扩写摘要 ②4 模块各 90-140 字辣评（信息密度优先，可略多）
//          ③AI 泡沫导语段 80-140 字 ④动态今日导读 ⑤头条/精选/盘面点评（供微信）
// 无 LLM_API_KEY 时优雅跳过（continue-on-error 兜底，网页走规则降级版）
//
// 稳健性设计：所有生成拆成多个「小 JSON」调用，单次 JSON 越小越不易被 7B 模型写崩；
// 扩写按 8 条/批分多批避免 token 截断；文本统一用中文引号，禁用英文双引号（消除转义断裂）。
const fs = require('fs');
const path = require('path');
const ROOT = __dirname;

const API_KEY = process.env.LLM_API_KEY;
const MODEL = process.env.LLM_MODEL || 'Qwen/Qwen2.5-14B-Instruct';
if (!API_KEY) {
  console.log('[enrich] 未配置 LLM_API_KEY，跳过 AI 增强（网页/推送将使用规则版）');
  process.exit(0);
}

const dailyPath = path.join(ROOT, 'daily_raw.json');
const sumPath = path.join(ROOT, 'ai_daily_summary.json');
if (!fs.existsSync(dailyPath) || !fs.existsSync(sumPath)) {
  console.error('[enrich] 缺少 daily_raw.json 或 ai_daily_summary.json');
  process.exit(1);
}
const daily = JSON.parse(fs.readFileSync(dailyPath, 'utf8'));
const sum = JSON.parse(fs.readFileSync(sumPath, 'utf8'));

const CANON_LABELS = ['模型发布/更新', '产品发布/更新', '行业动态', '论文研究', '技巧与观点'];
const MODULES = [
  { key: 'model-product', label: '模型 & 产品', secs: ['模型发布/更新', '产品发布/更新'] },
  { key: 'industry-paper', label: '行业 & 论文', secs: ['行业动态', '论文研究'] },
  { key: 'tips', label: '技巧与观点', secs: ['技巧与观点'] },
];

const byLabel = {};
for (const sec of (daily.sections || [])) byLabel[sec.label] = sec;

// 收集待扩写条目（与 build.js 渲染顺序一致：5 版块 + 快讯）
const expandItems = [];
for (const lab of CANON_LABELS) {
  const sec = byLabel[lab];
  for (const it of ((sec && sec.items) || [])) {
    expandItems.push({ title: it.title || '', summary: it.summary || '' });
  }
}
for (const f of (daily.flashes || [])) {
  expandItems.push({ title: f.title || '', summary: f.summary || '' });
}

const stocks = (sum.stocks || []).map((s) => ({
  name: s.name, mkt: s.mkt, changePct: +(s.changePct || 0).toFixed(2),
}));

const NO_QUOTE_RULE = '文本中如需引用，必须使用中文引号「」或『』，禁止使用英文双引号，以避免破坏 JSON。';

function stripJSON(txt) {
  const m = txt.match(/\{[\s\S]*\}/);
  return m ? m[0] : txt;
}
async function callLLM(system, user, maxTokens) {
  const r = await fetch('https://api.siliconflow.cn/v1/chat/completions', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + API_KEY },
    body: JSON.stringify({
      model: MODEL,
      messages: [
        { role: 'system', content: system },
        { role: 'user', content: user },
      ],
      temperature: 0.5,
      max_tokens: maxTokens,
      response_format: { type: 'json_object' },
    }),
  });
  const j = await r.json();
  if (j.error) {
    console.error('[enrich] API error:', JSON.stringify(j.error));
    throw new Error('API error');
  }
  const txt = (j.choices && j.choices[0] && j.choices[0].message && j.choices[0].message.content) || '';
  return JSON.parse(stripJSON(txt));
}
async function callLLMRetry(system, user, maxTokens, tag) {
  for (let attempt = 1; attempt <= 2; attempt++) {
    try {
      const data = await callLLM(system, user, maxTokens);
      console.log('[enrich] ' + tag + ' 成功 (尝试 ' + attempt + ')');
      return data;
    } catch (e) {
      console.error('[enrich] ' + tag + ' 第 ' + attempt + ' 次失败: ' + e.message);
    }
  }
  console.error('[enrich] ' + tag + ' 重试耗尽，跳过该部分');
  return null;
}

// ---- Call 1：扩写摘要，按 8 条/批分多批（小 JSON + 防截断） ----
const sysExpand =
  '你是中文 AI 资讯编辑。只输出合法 JSON，不要任何解释，不要用 markdown 代码块包裹。' + NO_QUOTE_RULE;
async function expandChunk(chunk, idx, total) {
  const user =
    `今天是 ${sum.date}。下面有 ${chunk.length} 条新闻（标题+原摘要），是第 ${idx + 1}/${total} 批。` +
    `请为每条把「原摘要」扩写到 130–170 字（中文），补全背景、影响与看点，保持客观，不要编造原文未提及的具体数字或结论。` +
    `严格按输入顺序输出字符串数组，不要遗漏、不要合并。\n\n` +
    chunk.map((it, i) => `${i + 1}. 标题:${it.title}\n   原摘要:${it.summary}`).join('\n') +
    `\n\n请只输出 JSON：\n{ "summaries": ["第1条扩写摘要(120-160字)","第2条扩写摘要", ...] }`;
  const d = await callLLMRetry(sysExpand, user, 4096, '扩写摘要批' + (idx + 1));
  const arr = d && Array.isArray(d.summaries) ? d.summaries : [];
  return arr.map((s, i) => ({ title: chunk[i] ? chunk[i].title : '', summary: s || '' }));
}

// ---- Call 2a：4 模块辣评（小 JSON） ----
const sysReview =
  '你是资深 AI 行业编辑，为关注 AI 与资本市场的中国读者写速评。只输出合法 JSON，不要 markdown 代码块。' +
  '中文、有独立判断、敢给观点、不堆砌。' + NO_QUOTE_RULE;
function moduleCtxText() {
  const moduleCtx = MODULES.map((m) => {
    const titles = [];
    for (const lab of m.secs) {
      const sec = byLabel[lab];
      for (const it of ((sec && sec.items) || [])) titles.push(it.title);
    }
    return { label: m.label, titles };
  });
  return moduleCtx.map((m) =>
    `【${m.label}】\n` + (m.titles.length ? m.titles.map((t, i) => `  ${i + 1}. ${t}`).join('\n') : '  （今日暂无内容）')
  ).join('\n');
}
async function genModuleReviews() {
  const user =
    `今天是 ${sum.date}。当日 AI 资讯按模块：\n` + moduleCtxText() +
    `\n\n请只输出 JSON：\n{ "moduleReviews": {
  "model-product": "模型&产品模块辣评，90–140 字，信息密度优先，可略多",
  "industry-paper": "行业&论文模块辣评，90–140 字，信息密度优先，可略多",
  "tips": "技巧与观点模块辣评，90–140 字，信息密度优先，可略多",
  "stocks": "AI概念股模块辣评，90–140 字，信息密度优先，可略多，结合当日涨跌"
} }`;
  const d = await callLLMRetry(sysReview, user, 800, '模块辣评');
  return (d && d.moduleReviews) ? d.moduleReviews : {};
}

// ---- Call 2b：动态导读 + 泡沫导语（小 JSON） ----
async function genLeadBubble() {
  const user =
    `今天是 ${sum.date}。AI 概念股当日涨跌（%）：\n` +
    stocks.map((s) => `${s.name}(${s.mkt}) ${s.changePct > 0 ? '+' : ''}${s.changePct}%`).join('  ') +
    `\n\n请只输出 JSON：\n{
  "leadText": "今日导读一段话，60-100字，点出当日 AI 主线与最大变量",
  "bubbleComment": "回答读者问题『AI 泡沫是不是在慢慢爆掉？』，80-140字，结合当日资讯与概念股表现给出你的判断，可以下明确结论"
}`;
  const d = await callLLMRetry(sysReview, user, 800, '导读/泡沫导语');
  return d ? { leadText: d.leadText || '', bubbleComment: d.bubbleComment || '' } : { leadText: '', bubbleComment: '' };
}

// ---- Call 2c：微信头条/精选/盘面（小 JSON，原可用结构） ----
async function genHeadline() {
  const items = (daily.sections || []).flatMap((sec) => (sec.items || []).map((it) => it.title)).slice(0, 16);
  const user =
    `今天是 ${sum.date}。当日 AI 资讯标题：\n` + items.map((t, i) => `${i + 1}. ${t}`).join('\n') +
    `\n\nAI 概念股涨跌（%）：` + stocks.map((s) => `${s.name} ${s.changePct > 0 ? '+' : ''}${s.changePct}%`).join('  ') +
    `\n\n请只输出 JSON：\n{
  "headline": {"title":"当日最重磅一条标题","comment":"一句话点评(<=40字)"},
  "picks": [{"title":"重要条目标题","comment":"一句话点评(<=40字)"}],
  "stockComment": "一句话总结今日 AI 概念股整体盘面(<=60字)"
}`;
  const d = await callLLMRetry(sysReview, user, 600, '头条/精选');
  return d ? {
    headline: d.headline || null,
    picks: Array.isArray(d.picks) ? d.picks : [],
    stockComment: d.stockComment || '',
  } : { headline: null, picks: [], stockComment: '' };
}

(async () => {
  const out = {
    date: sum.date,
    model: MODEL,
    expanded: [],
    leadText: '',
    bubbleComment: '',
    moduleReviews: {},
    headline: null,
    picks: [],
    stockComment: '',
  };

  // 扩写：8 条/批
  const CHUNK = 8;
  for (let i = 0; i < expandItems.length; i += CHUNK) {
    const chunk = expandItems.slice(i, i + CHUNK);
    const part = await expandChunk(chunk, i / CHUNK, Math.ceil(expandItems.length / CHUNK));
    out.expanded.push(...part.slice(0, chunk.length));
  }

  const [reviews, leadBubble, headline] = await Promise.all([
    genModuleReviews(),
    genLeadBubble(),
    genHeadline(),
  ]);
  out.moduleReviews = reviews;
  out.leadText = leadBubble.leadText;
  out.bubbleComment = leadBubble.bubbleComment;
  out.headline = headline.headline;
  out.picks = headline.picks;
  out.stockComment = headline.stockComment;

  fs.writeFileSync(path.join(ROOT, 'ai_daily_enriched.json'), JSON.stringify(out, null, 2), 'utf8');
  console.log('[enrich] 生成完成：扩写 ' + out.expanded.length + '/' + expandItems.length +
    ' 条摘要' + (out.moduleReviews && Object.keys(out.moduleReviews).length ? ' + 模块辣评' : '') +
    (out.bubbleComment ? ' + 泡沫导语' : '') + (out.headline ? ' + 头条/精选' : ''));
})();
