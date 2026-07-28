const WK = ['星期日','星期一','星期二','星期三','星期四','星期五','星期六'];
const pad = n => String(n).padStart(2,'0');

function fmtDateHuman(ds){
  const [y,m,d] = ds.split('-').map(Number);
  const dt = new Date(Date.UTC(y, m-1, d));
  return y + '年' + m + '月' + d + '日 ' + WK[dt.getUTCDay()];
}
function fmtBJ(iso){
  if(!iso) return '';
  const d = new Date(iso);
  const bj = new Date(d.getTime() + 8*3600*1000);
  const M = bj.getUTCMonth()+1, D = bj.getUTCDate();
  const now = new Date(Date.now()+8*3600*1000);
  const tM = now.getUTCMonth()+1, tD = now.getUTCDate();
  let prefix;
  if(M===tM && D===tD) prefix='今天';
  else if(M===tM && D===tD-1) prefix='昨天';
  else prefix = M + '月' + D + '日';
  return prefix + ' ' + pad(bj.getUTCHours()) + ':' + pad(bj.getUTCMinutes());
}

// HERO
document.getElementById('heroDate').textContent = fmtDateHuman(DATA.date);
document.getElementById('heroMeta').textContent =
  '每日北京时间 06:00 自动生成 · 数据来源 ' + DATA.source;
if(DATA.lead){
  document.getElementById('leadText').textContent = DATA.lead;
} else {
  document.getElementById('leadBox').style.display = 'none';
}
if(DATA.bubbleComment){
  const bb = document.getElementById('leadBox');
  const d = document.createElement('div');
  d.className = 'bubble';
  d.innerHTML = '<span class="bl">🫧 AI 泡沫在慢慢爆掉吗？</span>' + DATA.bubbleComment;
  bb.appendChild(d);
}
document.getElementById('totalNum').textContent = DATA.total;

if(!DATA.isToday){
  const fb = document.getElementById('fallbackBox');
  fb.className = 'fallback';
  fb.textContent = '⚠ 当日日报尚未生成，已回退至最近一期（' + DATA.date + '）';
}

// STATS
const statsEl = document.getElementById('stats');
DATA.moduleStats.forEach(function(s,i){
  const c = ['var(--s1)','var(--s2)','var(--s3)','var(--s4)','var(--s5)'][i];
  const el = document.createElement('div');
  el.className = 'stat';
  el.innerHTML = '<div class="num" style="color:#fff">' + s.count + '</div><div class="lab">' + s.label + '</div>';
  statsEl.appendChild(el);
});

// NAV
const navEl = document.getElementById('nav');
DATA.modules.forEach(function(s,i){
  const a = document.createElement('a');
  a.href = '#sec-' + i;
  a.innerHTML = s.label + '<span class="c">' + s.items.length + '</span>';
  navEl.appendChild(a);
});
if(DATA.stocks && DATA.stocks.length){
  const a = document.createElement('a');
  a.href = '#sec-stocks';
  a.innerHTML = 'AI 概念股<span class="c">' + DATA.stocks.length + '</span>';
  navEl.appendChild(a);
}

// SECTIONS + CARDS
const main = document.getElementById('main');
DATA.modules.forEach(function(s,i){
  const sec = document.createElement('section');
  sec.className = 'section';
  sec.id = 'sec-' + i;
  const dot = ['var(--s1)','var(--s2)','var(--s3)','var(--s4)','var(--s5)'][i];
  sec.innerHTML =
    '<div class="sec-head">' +
      '<span class="sec-dot" style="background:' + dot + '"></span>' +
      '<h2>' + s.label + '</h2>' +
      '<span class="cnt">' + s.items.length + ' 条</span>' +
    '</div><div class="grid"></div>';
  const grid = sec.querySelector('.grid');
  if(s.empty){
    grid.innerHTML = '<div style="grid-column:1/-1;color:var(--sub);font-size:13.5px;' +
      'background:#fff;border:1px dashed var(--line);border-radius:14px;padding:18px 20px">' +
      '今日该模块暂无入选内容</div>';
  }
  if(s.review){
    const note = document.createElement('div');
    note.className = 'comment edit';
    note.style.gridColumn = '1/-1';
    note.style.marginTop = '0';
    note.innerHTML = '<span class="cl">模块辣评</span>' + s.review;
    grid.appendChild(note);
  }
  if(s.comment){
    const note = document.createElement('div');
    note.className = 'comment edit';
    note.style.gridColumn = '1/-1';
    note.style.marginTop = '0';
    note.innerHTML = '<span class="cl">编辑点评</span>' + s.comment;
    grid.appendChild(note);
  }
  s.items.forEach(function(it){
    const card = document.createElement('article');
    card.className = 'card';
    const time = fmtBJ(it.publishedAt);
    card.innerHTML =
      '<div class="c-top">' +
        '<span class="badge">' + it.n + '</span>' +
        '<span class="chip" title="' + it.sourceName.replace(/"/g,'&quot;') + '">' + it.sourceName + '</span>' +
        (time ? '<span class="ctime">' + time + '</span>' : '') +
      '</div>' +
      '<h3>' + it.title + '</h3>' +
      '<p class="sum">' + it.summary + '</p>' +
      (it.comment ? '<div class="comment"><span class="cl">辣评</span>' + it.comment + '</div>' : '') +
      '<a class="go" href="' + it.sourceUrl + '" target="_blank" rel="noopener noreferrer">查看原文</a>';
    grid.appendChild(card);
  });
  main.appendChild(sec);
});

// STOCKS MODULE (AI-related companies, multi-market)
if(DATA.stocks && DATA.stocks.length){
  const sec = document.createElement('section');
  sec.className = 'section sec-stocks';
  sec.id = 'sec-stocks';
  sec.innerHTML =
    '<div class="sec-head">' +
      '<span class="sec-dot"></span>' +
      '<h2>AI 概念股</h2>' +
      '<span class="cnt">' + DATA.stocks.length + ' 只</span>' +
    '</div>' +
    '<div class="sec-cap">各市场收盘 / 盘中快照 · 来源 <a href="https://gu.qq.com/" target="_blank" rel="noopener noreferrer">' + (DATA.stockSource || '') + '</a>' +
      ' · 红涨绿跌 · 数据仅供参考，不构成投资建议</div>' +
    '<div class="stocks-grid"></div>';
  const grid = sec.querySelector('.stocks-grid');
  DATA.stocks.forEach(function(q){
    const up = q.change >= 0;
    const card = document.createElement('div');
    card.className = 'stock-card ' + (up ? 'up' : 'down');
    const arrow = up ? '▲' : '▼';
    const sign = up ? '+' : '';
    const rng = (q.dayLow != null && q.dayHigh != null)
      ? ('今日 ' + q.sym + q.dayLow.toFixed(2) + '–' + q.dayHigh.toFixed(2))
      : '';
    card.innerHTML =
      '<div class="sc-top"><span class="sc-tk">' + q.t + '</span>' +
        '<span class="sc-name">' + q.name + '</span>' +
        '<span class="sc-mkt">' + q.mktLabel + '</span></div>' +
      '<div class="sc-price"><span class="sc-cur">' + q.sym + '</span>' + q.price.toFixed(2) +
        ' <span class="sc-chg">' + arrow + ' ' + sign + q.change.toFixed(2) +
        ' (' + sign + q.changePct.toFixed(2) + '%)</span></div>' +
      (rng ? '<div class="sc-range">' + rng + '</div>' : '') +
      '<div class="sc-time">更新 ' + (q.bjTime || '') + '（北京时间）</div>';
    grid.appendChild(card);
  });
  main.appendChild(sec);
}

// FLASHES (bonus)
if(DATA.flashes && DATA.flashes.length){
  const sec = document.createElement('section');
  sec.className = 'section sec-flash';
  sec.id = 'sec-flashes';
  sec.innerHTML =
    '<div class="sec-head">' +
      '<span class="sec-dot"></span>' +
      '<h2>快讯</h2>' +
      '<span class="cnt">' + DATA.flashes.length + ' 条</span>' +
    '</div><div class="grid flash-grid"></div>';
  const grid = sec.querySelector('.grid');
  DATA.flashes.forEach(function(it){
    const card = document.createElement('article');
    card.className = 'card';
    const time = fmtBJ(it.publishedAt);
    card.innerHTML =
      '<div class="c-top">' +
        '<span class="badge">' + it.n + '</span>' +
        '<span class="chip" title="' + it.sourceName.replace(/"/g,'&quot;') + '">' + it.sourceName + '</span>' +
        (time ? '<span class="ctime">' + time + '</span>' : '') +
      '</div>' +
      '<h3>' + it.title + '</h3>' +
      '<p class="sum">' + it.summary + '</p>' +
      (it.comment ? '<div class="comment"><span class="cl">辣评</span>' + it.comment + '</div>' : '') +
      '<a class="go" href="' + it.sourceUrl + '" target="_blank" rel="noopener noreferrer">查看原文</a>';
    grid.appendChild(card);
  });
  main.appendChild(sec);
}

// FOOTER
document.getElementById('footTotal').textContent = '本日报共 ' + DATA.total + ' 条 AI 动态';

// back to top
const topBtn = document.getElementById('top');
window.addEventListener('scroll', function(){
  topBtn.classList.toggle('show', window.scrollY > 500);
});
topBtn.addEventListener('click', function(){ window.scrollTo({top:0,behavior:'smooth'}); });
