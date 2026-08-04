#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
国际足坛News Adrian — RSS 抓取 + 全文抽取 + 分类引擎  (v3, 大幅扩源)
- 直连 RSS：意大利(国米/意甲深度+全文) + 英/西/德/法 多国源 + ESPN
- Google News RSS 聚合：按「联赛 + 重点俱乐部」关键词搜索，带来德甲/法甲/荷甲/葡超等
  全球广度（沙箱可能超时，但 GitHub Actions 有完整外网必通）
- 4档可信度(已官宣/强传闻/传闻/弱传闻) + 联赛分类 + 重点球队 tagging(teams/is_major)
- 全局去重(跨源合并, also_in 记录同源)；默认仅保留近 36h 内发布
- 纯标准库 urllib，并发抓取，可在 GitHub Actions 运行；数据本地解析不出本机
用法：
  python fetch_rss.py [--max-age-hours 36] [--no-filter] [--no-google] [--deep] [--body-limit 1600]
"""
import urllib.request, urllib.error, ssl, re, json, sys, argparse, time, threading
from email.utils import parsedate_to_datetime
from datetime import datetime, timezone, timedelta
from collections import defaultdict
from html.parser import HTMLParser
from concurrent.futures import ThreadPoolExecutor, as_completed
import urllib.parse

ctx = ssl.create_default_context()
ctx.check_hostname = False
ctx.verify_mode = ssl.CERT_NONE
UA = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120 Safari/537.36"

# ——————————————————————————————————————————————
# 直连 RSS 源  (name, url, kind, lang)
# kind: inter / seriea / seriea_broad / broad(英西德法等)
# lang: it / en / es / de / fr  (用于提示，不强制)
# ——————————————————————————————————————————————
SOURCES = [
    # —— 意大利(深度 + 可抓全文) ——
    ("fcinternews.it",  "https://www.fcinternews.it/rss",                    "inter",        "it"),
    ("fcinter1908.it",  "https://www.fcinter1908.it/feed",                   "inter",        "it"),
    ("sempreinter.com", "https://sempreinter.com/feed/",                     "inter",        "en"),
    ("milannews.it",    "https://www.milannews.it/rss",                      "seriea",       "it"),
    ("romanews.eu",     "https://www.romanews.eu/feed/",                     "seriea",       "it"),
    ("juventusnews24",  "https://www.juventusnews24.com/feed/",              "seriea",       "it"),
    ("violanews",       "https://www.violanews.com/feed/",                   "seriea",       "it"),
    ("sampnews24",      "https://www.sampnews24.com/feed/",                  "seriea",       "it"),
    ("tuttosport",      "https://www.tuttosport.com/rss/calcio.xml",         "seriea_broad","it"),
    ("gazzetta",        "https://www.gazzetta.it/rss/calcio.xml",            "seriea_broad","it"),
    # —— 英语综合 ——
    ("ESPN Soccer",     "https://www.espn.com/espn/rss/soccer/news",         "broad",        "en"),
    ("BBC Sport",       "https://feeds.bbci.co.uk/sport/football/rss.xml",   "broad",        "en"),
    ("Guardian",        "https://www.theguardian.com/football/transfer-window/rss", "broad", "en"),
    ("Skysports",       "https://www.skysports.com/rss/12040",               "broad",        "en"),
    # —— 西语 ——
    ("Marca",           "https://www.marca.com/rss/inicio.xml",              "broad",        "es"),
    ("AS",              "https://as.com/rss/portal/deportivo/futbol.xml",   "broad",        "es"),
    ("MundoDeportivo",  "https://www.mundodeportivo.com/rss/futbol.xml",     "broad",        "es"),
    # —— 德语 ——
    ("Kicker",          "https://www.kicker.de/rss/transfers-2",             "broad",        "de"),
    # —— 法语 ——
    ("LEquipe",         "https://www.lequipe.fr/rss/flash-foot.xml",         "broad",        "fr"),
]

INTER_KW = re.compile(r"\b(inter|internazionale|nerazzurr[oi]|fc inter|appiano)\b", re.I)
MIAMI_KW = re.compile(r"inter miami|miami", re.I)

# ——————————————————————————————————————————————
# 重点球队覆盖清单（可配置：增删球队只改这里）
# ——————————————————————————————————————————————
COVERAGE = {
    "意甲": [
        ("国际米兰", re.compile(r"\b(inter|internazionale|nerazzurr[oi]|fc inter|appiano)\b", re.I)),
        ("尤文图斯", re.compile(r"\b(juve|juventus|bianconer[ai]|vecchia signora)\b", re.I)),
        ("AC米兰",   re.compile(r"\b(milan|rossoner[oi]|diavolo)\b", re.I)),
        ("那不勒斯", re.compile(r"\b(napoli|partenope[oi]|azzurri)\b", re.I)),
        ("罗马",     re.compile(r"\b(roma|gialloross[oi])\b", re.I)),
        ("拉齐奥",   re.compile(r"\b(lazio|biancocelest[oi])\b", re.I)),
        ("亚特兰大", re.compile(r"\b(atalanta|bergamaschi|dea)\b", re.I)),
        ("佛罗伦萨", re.compile(r"\b(fiorentina|viola|firenze)\b", re.I)),
        ("博洛尼亚", re.compile(r"\b(bologna|rossoblu|felsine[oi])\b", re.I)),
        ("都灵",     re.compile(r"\b(torino|granata|toro)\b", re.I)),
    ],
    "英超": [
        ("阿森纳",   re.compile(r"\b(arsenal|gunners)\b", re.I)),
        ("切尔西",   re.compile(r"\b(chelsea|blues)\b", re.I)),
        ("利物浦",   re.compile(r"\b(liverpool|reds)\b", re.I)),
        ("曼城",     re.compile(r"\b(manchester city|man city|cityzens|citizens)\b", re.I)),
        ("曼联",     re.compile(r"\b(manchester united|man utd|man united|red devils)\b", re.I)),
        ("热刺",     re.compile(r"\b(tottenham|spurs)\b", re.I)),
        ("纽卡斯尔", re.compile(r"\b(newcastle|magpies|toon)\b", re.I)),
        ("阿斯顿维拉", re.compile(r"\b(aston villa|villans)\b", re.I)),
        ("布莱顿",   re.compile(r"\b(brighton|seagulls)\b", re.I)),
        ("西汉姆",   re.compile(r"\b(west ham|hammers|irons)\b", re.I)),
    ],
    "西甲": [
        ("皇家马德里", re.compile(r"\b(real madrid|los blancos|merengues)\b", re.I)),
        ("巴塞罗那",   re.compile(r"\b(barcelona|barca|blaugrana|cul[eé]s?)\b", re.I)),
        ("马德里竞技", re.compile(r"\b(atletico|atleti|colchoneros|rojiblancos)\b", re.I)),
        ("毕尔巴鄂",   re.compile(r"\b(athletic|bilbao|leones)\b", re.I)),
        ("赫罗纳",     re.compile(r"\b(girona)\b", re.I)),
        ("塞维利亚",   re.compile(r"\b(sevilla)\b", re.I)),
        ("瓦伦西亚",   re.compile(r"\b(valencia)\b", re.I)),
        ("皇家社会",   re.compile(r"\b(real sociedad|txuri urdin)\b", re.I)),
        ("比利亚雷亚尔", re.compile(r"\b(villarreal|submarino)\b", re.I)),
    ],
    "德甲": [
        ("拜仁慕尼黑", re.compile(r"\b(bayern|bayern munich|fcb|die roten)\b", re.I)),
        ("多特蒙德",   re.compile(r"\b(dortmund|bv b|schwarzgelb|borussia)\b", re.I)),
        ("勒沃库森",   re.compile(r"\b(bayer leverkusen|leverkusen|werkself)\b", re.I)),
        ("RB莱比锡",   re.compile(r"\b(rb leipzig|leipzig|die roten bullen)\b", re.I)),
        ("法兰克福",   re.compile(r"\b(eintracht|frankfurt|eintracht frankfurt)\b", re.I)),
        ("门兴",       re.compile(r"\b(gladbach|borussia monchengladbach)\b", re.I)),
    ],
    "法甲": [
        ("巴黎圣日耳曼", re.compile(r"\b(psg|paris saint-germain|paris sg|les parisiens)\b", re.I)),
        ("马赛",       re.compile(r"\b(olympique marseille|marseille|om|les phoceens)\b", re.I)),
        ("摩纳哥",     re.compile(r"\b(monaco|as monaco|les monégasques)\b", re.I)),
        ("里昂",       re.compile(r"\b(olympique lyonnais|lyon|les gones)\b", re.I)),
        ("尼斯",       re.compile(r"\b(nice|ogc nice|les aiglons)\b", re.I)),
    ],
}

LEAGUE_RULES = [
    ("西甲",   re.compile(r"\b(real madrid|barcelona|atletico|atleti|la liga|vinicius|mbappe|barca|sevilla|valencia|bilbao|real sociedad|girona|betis|ligue|españ|espan)\b", re.I)),
    ("英超",   re.compile(r"\b(premier|arsenal|chelsea|liverpool|manchester|man city|man utd|tottenham|newcastle|aston villa|brighton|west ham|fulham|brentford|crystal palace|everton|nottingham|man united|manchester city|premiership)\b", re.I)),
    ("德甲",   re.compile(r"\b(bundesliga|bayern|dortmund|leverkusen|leipzig|eintracht|gladbach|frankfurt|borussia|kicker)\b", re.I)),
    ("法甲",   re.compile(r"\b(ligue 1|ligue1|psg|paris|marseille|monaco|lyon|nice|om\b|rennes|lille)\b", re.I)),
    ("意甲",   re.compile(r"\b(serie a|juve|juventus|milan|inter|napoli|roma|lazio|fiorentina|atalanta|torino|sampdoria|genoa|bologna|verona|lecce|como|parma|cesena|pisa|sassuolo|udinese|empoli|cremonese|palermo|catanzaro|modena)\b", re.I)),
    ("欧洲主流联赛", re.compile(r"\b(champions league|europa league|porto|benfica|ajax|eredivisie|primeira|ligue|bundesliga|psg|bayern|dortmund)\b", re.I)),
]

TIER_RULES = [
    ("已官宣", re.compile(r"\b(ufficiale|ufficializzato|annunciato|annuncia|firma|firmava|completed|complete|official|confirmed|confirms|confirma|riscattato|ingaggio|arriva a|diventa|passa al|presentato|here we go|signs|signed|signing|joins|joined|agree|agreed|deal done|sealed|unveiled|unveils|loan|permanent|for \$|for £|for €|for a fee|medical)\b", re.I)),
    ("强传闻", re.compile(r"\b(vicino|vicina|accordo|intesa|spinge|chiude|chiuso|quasi|imminente|imminent|deciso|fumata bianca|prende|acordo|close to|set to|agreeing|advanced talks|verbal agreement|personal terms|on the verge|edging|priority target)\b", re.I)),
    ("传闻",   re.compile(r"\b(interessa|interessato|pista|obiettivo|sogno|trattativa|tratta|piace|piacerebbe|idea|ipotesi|valuta|contatto|sondaggio|linked|linking|interest|interested|target|monitoring|wants|keen|exploring|bid|offer)\b", re.I)),
    ("弱传闻", re.compile(r"\b(potrebbe|ipotizza|ipotetico|voce|rumour|rumor|si parla|emerso|secondo|sonderebbe|pista remota|sussurro|could|might|reportedly|speculation|whispers|touted)\b", re.I)),
]

# ——————————————————————————————————————————————
# 语言策略：所有语种源（英/西/德/法/意）均保留，不按语言丢弃条目；
# 非中/非英标题在 build 阶段由免费翻译 API（MyMemory/Google）统一翻成简中，
# 故 fetch 阶段无需任何语言检测，也不引入任何付费翻译依赖。
# ——————————————————————————————————————————————

# Google News RSS 聚合查询（关键词 → 联赛提示）
GN_LEAGUE_QUERIES = [
    ("意甲 转会", "Serie A transfer", "意甲"),
    ("英超 转会", "Premier League transfer", "英超"),
    ("西甲 转会", "La Liga transfer", "西甲"),
    ("德甲 转会", "Bundesliga transfer", "德甲"),
    ("法甲 转会", "Ligue 1 transfer", "法甲"),
    ("转会窗口 新闻", "football transfer news", "欧洲主流联赛"),
]
GN_CLUB_QUERIES = [
    ("国米", "Inter Milan transfer", "意甲"),
    ("尤文", "Juventus transfer", "意甲"),
    ("米兰", "AC Milan transfer", "意甲"),
    ("那不勒斯", "Napoli transfer", "意甲"),
    ("罗马", "AS Roma transfer", "意甲"),
    ("皇马", "Real Madrid transfer", "西甲"),
    ("巴萨", "Barcelona transfer", "西甲"),
    ("马竞", "Atletico Madrid transfer", "西甲"),
    ("阿森纳", "Arsenal transfer", "英超"),
    ("切尔西", "Chelsea transfer", "英超"),
    ("利物浦", "Liverpool transfer", "英超"),
    ("曼城", "Manchester City transfer", "英超"),
    ("曼联", "Manchester United transfer", "英超"),
    ("热刺", "Tottenham transfer", "英超"),
    ("纽卡", "Newcastle transfer", "英超"),
    ("拜仁", "Bayern Munich transfer", "德甲"),
    ("多特", "Borussia Dortmund transfer", "德甲"),
    ("勒沃库森", "Bayer Leverkusen transfer", "德甲"),
    ("巴黎", "PSG transfer", "法甲"),
    ("马赛", "Marseille transfer", "法甲"),
]

class TextExtractor(HTMLParser):
    def __init__(self):
        super().__init__()
        self.in_p = False; self.skip = False; self.texts = []
    def handle_starttag(self, tag, attrs):
        if tag == "p": self.in_p = True
        if tag in ("script", "style", "noscript"): self.skip = True
    def handle_endtag(self, tag):
        if tag == "p": self.in_p = False
        if tag in ("script", "style", "noscript"): self.skip = False
    def handle_data(self, data):
        if self.in_p and not self.skip:
            t = data.strip()
            if t: self.texts.append(t)

def fetch(url, timeout=10, binary=False):
    req = urllib.request.Request(url, headers={"User-Agent": UA, "Accept": "application/rss+xml, application/xml, text/xml, */*"})
    with urllib.request.urlopen(req, timeout=timeout, context=ctx) as r:
        return r.read() if binary else r.read().decode("utf-8", "ignore")

def classify_league(text):
    for name, rx in LEAGUE_RULES:
        if rx.search(text): return name
    return "其他"

def classify_tier(text):
    for name, rx in TIER_RULES:
        if rx.search(text): return name
    return "弱传闻"

def tag_teams(text):
    teams = []
    for lg, tlist in COVERAGE.items():
        for disp, rx in tlist:
            if rx.search(text):
                teams.append(disp)
    seen = set(); out = []
    for t in teams:
        if t not in seen:
            seen.add(t); out.append(t)
    return out

BOILER = ["Installa la nostra App", "Mentre navighi nell'app", "scarica l'app",
          "disattiva il blocco", "Tutti i diritti riservati", "©", "seguici su",
          "iscriviti al canale", "cookie", "We use cookies"]

def norm_words(s):
    return set(re.findall(r"[a-zàèéìòù0-9]{3,}", (s or "").lower()))

def strip_tags(s):
    return re.sub(r"<[^>]+>", " ", s or "")

def parse_feed(xml):
    items = []
    blocks = re.findall(r"<item[ >].*?</item>|<entry[ >].*?</entry>", xml, re.S)
    for b in blocks:
        title = re.search(r"<title[^>]*>(?:<!\[CDATA\[(.*?)\]\]>|([^<]+))</title>", b, re.S)
        title = (title.group(1) or title.group(2) or "").strip()
        desc = re.search(r"<description[^>]*>(?:<!\[CDATA\[(.*?)\]\]>|([^<]+))</description>", b, re.S)
        summ = (desc.group(1) or desc.group(2) or "")
        link = None
        l1 = re.search(r"<link[^>]*>([^<]+)</link>", b)
        if l1: link = l1.group(1).strip()
        if not link:
            l2 = re.search(r"<link[^>]*href=\"([^\"]+)\"", b)
            if l2: link = l2.group(1).strip()
        pub = re.search(r"<pubDate[^>]*>([^<]+)</pubDate>|<dc:date[^>]*>([^<]+)</dc:date>|<updated[^>]*>([^<]+)</updated>", b)
        pub = (pub.group(1) or pub.group(2) or pub.group(3) or "").strip()
        items.append({"title": title, "summary": strip_tags(summ).strip(),
                      "link": link, "pubDate": pub})
    return items

def parse_gn(xml):
    """解析 Google News RSS 搜索结果。标题格式通常为 'Headline - Source'。"""
    items = []
    blocks = re.findall(r"<item[ >].*?</item>|<entry[ >].*?</entry>", xml, re.S)
    for b in blocks:
        title = re.search(r"<title[^>]*>(?:<!\[CDATA\[(.*?)\]\]>|([^<]+))</title>", b, re.S)
        title = (title.group(1) or title.group(2) or "").strip()
        desc = re.search(r"<description[^>]*>(?:<!\[CDATA\[(.*?)\]\]>|([^<]+))</description>", b, re.S)
        summ = (desc.group(1) or desc.group(2) or "")
        link = None
        l1 = re.search(r"<link[^>]*>([^<]+)</link>", b)
        if l1: link = l1.group(1).strip()
        if not link:
            l2 = re.search(r"<link[^>]*href=\"([^\"]+)\"", b)
            if l2: link = l2.group(1).strip()
        pub = re.search(r"<pubDate[^>]*>([^<]+)</pubDate>|<dc:date[^>]*>([^<]+)</dc:date>|<updated[^>]*>([^<]+)</updated>", b)
        pub = (pub.group(1) or pub.group(2) or pub.group(3) or "").strip()
        # source from <source> tag if present
        src = re.search(r"<source[^>]*>([^<]+)</source>", b)
        src_name = (src.group(1).strip() if src else "")
        # 标题拆分 "Headline - Source"
        headline, suffix = title, ""
        if " - " in title:
            headline, suffix = title.rsplit(" - ", 1)
            headline, suffix = headline.strip(), suffix.strip()
        if not src_name and suffix:
            src_name = suffix
        items.append({
            "title": headline,
            "summary": strip_tags(summ).strip(),
            "link": link, "pubDate": pub,
            "gn_source": src_name,
        })
    return items

def fetch_direct(name, url, kind, lang):
    try:
        xml = fetch(url, timeout=10)
        its = parse_feed(xml)
        return (name, kind, lang, its, None)
    except Exception as e:
        return (name, kind, lang, [], f"{type(e).__name__}: {e}")

def fetch_gn(label, query, league_hint):
    try:
        q = urllib.parse.quote(query)
        url = f"https://news.google.com/rss/search?q={q}&hl=en-US&gl=US&ceid=US:en"
        xml = fetch(url, timeout=12)
        its = parse_gn(xml)
        for it in its:
            it["gn_label"] = label
            it["gn_league_hint"] = league_hint
        return (label, league_hint, its, None)
    except Exception as e:
        return (label, league_hint, [], f"{type(e).__name__}: {e}")

def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--max-age-hours", type=float, default=36.0)
    ap.add_argument("--no-filter", action="store_true")
    ap.add_argument("--no-google", action="store_true", help="禁用 Google News 聚合(沙箱/调试用)")
    ap.add_argument("--deep", action="store_true", help="对重点球队取前若干篇也抓全文")
    ap.add_argument("--deep-per-team", type=int, default=2)
    ap.add_argument("--deep-team-cap", type=int, default=24, help="--deep 全文抓取总数上限(控时)")
    ap.add_argument("--body-limit", type=int, default=1400)
    ap.add_argument("--keep-italian", action="store_true",
                    help="（保留参数以兼容历史调用；现已统一由免费翻译 API 处理，不再按语言丢弃）")
    ap.add_argument("--no-body", action="store_true",
                    help="不抓正文全文(云端推送版用：仅翻译标题以省翻译额度，正文不出现原文)")
    args = ap.parse_args()

    now = datetime.now(timezone.utc)
    raw_items = []
    src_counts = {}
    gn_counts = {}

    # —— 并发抓取直连 RSS + Google News ——
    futs = []
    with ThreadPoolExecutor(max_workers=10) as ex:
        for (name, url, kind, lang) in SOURCES:
            futs.append(ex.submit(fetch_direct, name, url, kind, lang))
        if not args.no_google:
            for (label, query, lh) in GN_LEAGUE_QUERIES + GN_CLUB_QUERIES:
                futs.append(ex.submit(fetch_gn, label, query, lh))
        for f in as_completed(futs):
            res = f.result()
            if len(res) == 5:  # direct
                name, kind, lang, its, err = res
                src_counts[name] = len(its) if err is None else f"ERR:{err}"
                for it in its:
                    it["source"] = name; it["kind"] = kind; it["lang"] = lang
                    raw_items.append(it)
            else:  # google news
                label, lh, its, err = res
                gn_counts[label] = len(its) if err is None else f"ERR:{err}"
                for it in its:
                    it["source"] = f"GN:{it.get('gn_source') or label}"
                    it["kind"] = "gn"; it["lang"] = "en"
                    it["league_hint"] = lh
                    raw_items.append(it)

    items = []
    dropped_old = 0
    for it in raw_items:
        text_title_sum = (it["title"] + " " + it["summary"])
        is_inter = bool(INTER_KW.search(text_title_sum)) and not MIAMI_KW.search(text_title_sum)
        if it.get("kind") == "gn" and it.get("gn_label") == "国米":
            is_inter = True  # Google News 国米查询命中视为国米
        pub_dt = None
        if it["pubDate"]:
            try:
                pub_dt = parsedate_to_datetime(it["pubDate"])
                if pub_dt.tzinfo is None: pub_dt = pub_dt.replace(tzinfo=timezone.utc)
            except Exception:
                pub_dt = None
        fresh = True
        if not args.no_filter and pub_dt is not None:
            age_h = (now - pub_dt).total_seconds() / 3600.0
            if age_h > args.max_age_hours:
                fresh = False
        if not fresh:
            dropped_old += 1
            continue
        # 所有语种条目均保留（含意大利文），翻译在 build 阶段由免费 API 统一处理
        if it.get("kind") == "gn":
            lg = it.get("league_hint") or classify_league(text_title_sum)
        else:
            lg = "意甲" if it["kind"] in ("seriea", "seriea_broad") else classify_league(text_title_sum)
        if is_inter: lg = "意甲"
        teams = tag_teams(text_title_sum)
        if is_inter and "国际米兰" not in teams:
            teams.insert(0, "国际米兰")
        it2 = {
            "source": it["source"], "kind": it["kind"], "lang": it.get("lang"),
            "title": it["title"], "summary": it["summary"][:400],
            "link": it["link"], "pubDate": it["pubDate"],
            "is_inter": is_inter, "league": lg, "teams": teams,
            "is_major": bool(teams), "body": "",
        }
        items.append(it2)

    def get_body(link):
        if not link or not link.startswith("http"): return ""
        try:
            htmltext = fetch(link, timeout=10)
            p = TextExtractor(); p.feed(htmltext)
            cleaned = [t for t in p.texts if not any(b in t for b in BOILER)]
            joined = re.sub(r"\s+", " ", " ".join(cleaned)).strip()
            return joined
        except Exception:
            return ""

    inter_items = [i for i in items if i["is_inter"]]
    noninter = [i for i in items if not i["is_inter"]]
    if not args.no_body:
        for it in inter_items:
            b = get_body(it["link"])
            it["body"] = b[:args.body_limit]
            time.sleep(0.2)
    if args.deep:
        by_team = defaultdict(list)
        for it in noninter:
            for t in it["teams"]:
                by_team[t].append(it)
        cnt = 0
        for t, lst in by_team.items():
            for it in lst[:args.deep_per_team]:
                if cnt >= args.deep_team_cap: break
                if not args.no_body:
                    b = get_body(it["link"])
                    it["body"] = b[:args.body_limit]
                    time.sleep(0.18)
                cnt += 1
            if cnt >= args.deep_team_cap: break

    for it in items:
        blob = it["title"] + " " + it["summary"] + " " + it["body"]
        it["tier_hint"] = classify_tier(blob)
        it.pop("kind", None)  # 保留 lang 字段，供 build_briefing / 诊断使用

    # —— 全局去重：国米独立保留；其余跨源按标题相似度合并 ——
    final = list(inter_items)
    seen_ids = set(id(i) for i in inter_items)
    rest = [i for i in noninter if id(i) not in seen_ids]
    used = []
    for it in rest:
        merged = False
        for u in used:
            wa, wb = norm_words(u["title"]), norm_words(it["title"])
            if wa and wb and len(wa & wb) / len(wa | wb) >= 0.55:
                u.setdefault("also_in", [])
                if it["source"] not in u["also_in"]:
                    u["also_in"].append(it["source"])
                if len(it["body"]) > len(u["body"]):
                    u["body"] = it["body"]; u["summary"] = it["summary"]
                if len(it["title"]) > len(u["title"]):
                    u["title"] = it["title"]
                merged = True
                break
        if not merged:
            used.append(it)
    final.extend(used)

    def sortkey(x):
        return x.get("pubDate") or ""
    final.sort(key=sortkey, reverse=True)

    major_count = sum(1 for i in final if i["is_major"])
    team_counts = defaultdict(int)
    for i in final:
        for t in i["teams"]:
            team_counts[t] += 1

    out = {
        "fetched_at": now.isoformat(),
        "total": len(raw_items),
        "kept": len(final),
        "inter_count": sum(1 for i in final if i["is_inter"]),
        "major_count": major_count,
        "team_counts": dict(team_counts),
        "dropped_old": dropped_old,
        "freshness_filter": (False if args.no_filter else f"{args.max_age_hours}h"),
        "source_counts": src_counts,
        "google_news_counts": gn_counts,
        "items": final,
    }
    print(json.dumps(out, ensure_ascii=False))

if __name__ == "__main__":
    main()
