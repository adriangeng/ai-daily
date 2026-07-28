// enrich.js —— 调用云端 LLM 生成增强内容（新建文件，不修改原四件套）
// 读取 daily_raw.json（当日资讯，与 build.js 渲染顺序一致）+ ai_daily_summary.json（股票）
// 输出 ai_daily_enriched.json，供 build.js（网页）与 notify.js（微信）消费
// 生成内容：①每条新闻 120-160 字扩写摘要 ②4 模块各 50-100 字辣评
//          ③AI 泡沫导语段 80-140 字 ④动态今日导读 ⑤头条/精选/盘面点评（供微信）
// 无 LLM_API_KEY 时优雅跳过（continue-on-error 兜底，网页走规则降级版）
const fs = require('fs');
const path = require('path');
const ROOT = __dirname;

const API_KEY = process.env.LLM_API_KEY;
const MODEL = process.env.LLM_MODEL || 'Qwen/Qwen2.5-7B-Instruct';
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

// ---- Call 1：扩写每条新闻摘要至 120-160 字（按序字符串数组，避免标题字段 JSON 断裂） ----
const sys1 =
  '你是中文 AI 资讯编辑。只输出合法 JSON，不要任何解释，不要用 markdown 代码块包裹。' +
  '为每条新闻把过短的摘要扩写成信息量充足的段落。';
const user1 =
  `今天是 ${sum.date}。下面有 ${expandItems.length} 条新闻（标题+原摘要）。请为每条把「原摘要」扩写到 120–160 字（中文），` +
  `补全背景、影响与看点，保持客观，不要编造原文未提及的具体数字或结论。严格按输入顺序输出，不要遗漏、不要合并。` +
  `所有字符串内的双引号必须转义为 \\"，不要使用未转义的换行。\n\n` +
  expandItems.map((it, i) => `${i + 1}. 标题:${it.title}\n   原摘要:${it.summary}`).join('\n') +
  `\n\n请只输出 JSON：\n{ "summaries": ["第1条扩写摘要(120-160字)","第2条扩写摘要", ...] }\n（summaries 长度必须等于 ${expandItems.length}）`;

// ---- Call 2：模块辣评 + 泡沫导语 + 动态导读 + 微信头条/精选 ----
const moduleCtx = MODULES.map((m) => {
  const titles = [];
  for (const lab of m.secs) {
    const sec = byLabel[lab];
    for (const it of ((sec && sec.items) || [])) titles.push(it.title);
  }
  return { key: m.key, label: m.label, titles };
});
const sys2 =
  '你是资深 AI 行业编辑，为关注 AI 与资本市场的中国读者写每日速评。' +
  '只输出合法 JSON，不要 markdown 代码块。中文、有独立判断、敢给观点、不堆砌。';
const user2 =
  `今天是 ${sum.date}。当日 AI 资讯按模块如下：\n` +
  moduleCtx.map((m) =>
    `【${m.label}】\n` + (m.titles.length ? m.titles.map((t, i) => `  ${i + 1}. ${t}`).join('\n') : '  （今日暂无内容）')
  ).join('\n') +
  `\n\nAI 概念股当日涨跌（%）：\n` +
  stocks.map((s) => `${s.name}(${s.mkt}) ${s.changePct > 0 ? '+' : ''}${s.changePct}%`).join('  ') +
  `\n\n请只输出 JSON：\n{
  "leadText": "今日导读一段话，60-100字，点出当日 AI 主线与最大变量",
  "bubbleComment": "回答读者问题『AI 泡沫是不是在慢慢爆掉？』，80-140字，结合当日资讯与概念股表现给出你的判断，可以下明确结论",
  "moduleReviews": {
    "model-product": "模型&产品模块辣评，50-100字",
    "industry-paper": "行业&论文模块辣评，50-100字",
    "tips": "技巧与观点模块辣评，50-100字",
    "stocks": "AI概念股模块辣评，50-100字，结合当日涨跌"
  },
  "headline": {"title":"当日最重磅一条标题","comment":"一句话点评(<=40字)"},
  "picks": [{"title":"重要条目标题","comment":"一句话点评(<=40字)"}],
  "stockComment": "一句话总结今日 AI 概念股整体盘面(<=60字)"
}`;

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

  const d1 = await callLLMRetry(sys1, user1, 4096, '扩写摘要');
  if (d1 && Array.isArray(d1.summaries)) {
    d1.summaries.forEach((s, i) => {
      if (expandItems[i]) out.expanded.push({ title: expandItems[i].title, summary: s || '' });
    });
  }

  const d2 = await callLLMRetry(sys2, user2, 1200, '模块辣评/导语');
  if (d2) {
    out.leadText = d2.leadText || '';
    out.bubbleComment = d2.bubbleComment || '';
    out.moduleReviews = d2.moduleReviews || {};
    out.headline = d2.headline || null;
    out.picks = Array.isArray(d2.picks) ? d2.picks : [];
    out.stockComment = d2.stockComment || '';
  }

  fs.writeFileSync(path.join(ROOT, 'ai_daily_enriched.json'), JSON.stringify(out, null, 2), 'utf8');
  console.log('[enrich] 生成完成：扩写 ' + out.expanded.length + '/' + expandItems.length +
    ' 条摘要 + 模块辣评' + (out.bubbleComment ? ' + 泡沫导语' : '') +
    (out.headline ? ' + 头条/精选' : ''));
})();
