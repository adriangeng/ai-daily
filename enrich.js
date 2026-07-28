// enrich.js —— 调用云端 LLM 生成「AI 一句话点评」（新建文件，不修改原四件套）
// 读取 items_raw.json（文章标题/摘要/分类/热度）+ ai_daily_summary.json（股票）
// 输出 ai_daily_enriched.json，供 notify.js 融合进微信推送
// 无 LLM_API_KEY 时优雅跳过（continue-on-error 兜底）
const fs = require('fs');
const path = require('path');
const ROOT = __dirname;

const API_KEY = process.env.LLM_API_KEY;
const MODEL = process.env.LLM_MODEL || 'Qwen/Qwen2.5-7B-Instruct';
if (!API_KEY) {
  console.log('[enrich] 未配置 LLM_API_KEY，跳过 AI 点评（推送将使用规则优化版）');
  process.exit(0);
}

const itemsRawPath = path.join(ROOT, 'items_raw.json');
const sumPath = path.join(ROOT, 'ai_daily_summary.json');
if (!fs.existsSync(itemsRawPath) || !fs.existsSync(sumPath)) {
  console.error('[enrich] 缺少 items_raw.json 或 ai_daily_summary.json');
  process.exit(1);
}
const itemsRaw = JSON.parse(fs.readFileSync(itemsRawPath, 'utf8'));
const sum = JSON.parse(fs.readFileSync(sumPath, 'utf8'));

// 取 selected 且热度较高的文章（最多 12 条喂给模型，控制 token）
const items = (itemsRaw.items || [])
  .filter((i) => i.selected !== false)
  .sort((a, b) => (b.score || 0) - (a.score || 0))
  .slice(0, 12)
  .map((i) => ({ title: i.title, category: i.category, summary: i.summary || '', score: i.score || 0 }));

const stocks = sum.stocks.map((s) => ({ name: s.name, mkt: s.mkt, changePct: +s.changePct.toFixed(2) }));

const sysPrompt =
  '你是资深 AI 行业编辑，为关注 AI 与资本市场的中国读者写每日速评。' +
  '要求：1) 只输出合法 JSON，不要任何解释或 markdown 代码块包裹；' +
  '2) 中文、简洁、有独立判断，敢给观点，不堆砌；3) 每条点评不超过 40 字。';

const userPrompt =
  `今天是 ${sum.date}。以下是当日 AI HOT 精选资讯与 AI 概念股涨跌：\n\n` +
  `【资讯】\n` +
  items.map((i, idx) => `${idx + 1}. [${i.category}] ${i.title}\n   摘要:${i.summary}\n   热度:${i.score}`).join('\n') +
  `\n\n【AI 概念股涨跌幅 %】\n` +
  stocks.map((s) => `${s.name}(${s.mkt}) ${s.changePct > 0 ? '+' : ''}${s.changePct}%`).join('  ') +
  `\n\n请输出 JSON：\n{
  "headline": {"title":"当日最重磅一条的标题","comment":"一句话点评(<=40字)"},
  "picks": [{"title":"重要条目标题","comment":"一句话点评(<=40字)"}],
  "stockComment": "一句话总结今日 AI 概念股整体盘面(<=60字)"
}`;

(async () => {
  try {
    const r = await fetch('https://api.siliconflow.cn/v1/chat/completions', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + API_KEY },
      body: JSON.stringify({
        model: MODEL,
        messages: [
          { role: 'system', content: sysPrompt },
          { role: 'user', content: userPrompt },
        ],
        temperature: 0.6,
        max_tokens: 900,
        response_format: { type: 'json_object' },
      }),
    });
    const j = await r.json();
    if (j.error) {
      console.error('[enrich] API error:', JSON.stringify(j.error));
      process.exit(1);
    }
    let txt = (j.choices && j.choices[0] && j.choices[0].message && j.choices[0].message.content) || '';
    // 容错：去掉可能的 ```json 代码块包裹
    const m = txt.match(/\{[\s\S]*\}/);
    if (m) txt = m[0];
    const data = JSON.parse(txt);
    fs.writeFileSync(
      path.join(ROOT, 'ai_daily_enriched.json'),
      JSON.stringify({ date: sum.date, model: MODEL, ...data }, null, 2),
      'utf8'
    );
    console.log('[enrich] 生成点评成功：headline +', (data.picks || []).length, '条精选');
  } catch (e) {
    console.error('[enrich] 失败:', e.message);
    process.exit(1);
  }
})();
