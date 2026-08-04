#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
build_briefing.py — 将 fetch_rss.py 输出的 JSON 渲染为 markdown 晨报
结构：🔵国米置顶(全文) + ⚽意甲/英超/西甲/德甲/法甲 重点球队分组(每队按4档)
纯 Python，无外部翻译服务依赖，可在 GitHub Actions 运行。
用法：python build_briefing.py <input.json> [output.md]
"""
import json, sys, os, re
from collections import defaultdict

# 翻译模块（免费免密钥翻译 API：MyMemory + Google gtx；始终启用，失败则保留原文）
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import translate

TIER_MARK = {"已官宣": "✅", "强传闻": "🟢", "传闻": "🟡", "弱传闻": "🔴"}

# 展示顺序（与 fetch_rss.py COVERAGE 保持一致；仅用于渲染）
LEAGUES = ["意甲", "英超", "西甲", "德甲", "法甲"]
TEAMS_ORDER = {
    "意甲": ["国际米兰","尤文图斯","AC米兰","那不勒斯","罗马","拉齐奥","亚特兰大","佛罗伦萨","博洛尼亚","都灵"],
    "英超": ["阿森纳","切尔西","利物浦","曼城","曼联","热刺","纽卡斯尔","阿斯顿维拉","布莱顿","西汉姆"],
    "西甲": ["皇家马德里","巴塞罗那","马德里竞技","毕尔巴鄂","赫罗纳","塞维利亚","瓦伦西亚","皇家社会","比利亚雷亚尔"],
    "德甲": ["拜仁慕尼黑","多特蒙德","勒沃库森","RB莱比锡","法兰克福","门兴"],
    "法甲": ["巴黎圣日耳曼","马赛","摩纳哥","里昂","尼斯"],
}

def render_item(i, with_body=False, body_len=220, no_links=False):
    tier = i.get("tier_hint", "弱传闻")
    mark = TIER_MARK.get(tier, "🔴")
    t = (i.get("title_zh") or i.get("title") or "").strip()
    if not t:
        return None
    src = i.get("source", "")
    teams = " / ".join(i.get("teams", []))
    line = f"- {mark} **{t}**"
    meta = f"来源: {src}"
    if teams:
        meta += f" ｜ 涉及: {teams}"
    line += f"  \n  └ {meta}"
    if with_body and i.get("body"):
        snip = i["body"][:body_len].replace("\n", " ").strip()
        if snip:
            line += f"  \n  > {snip}"
    if i.get("also_in"):
        line += f"  ｜ 同源: {', '.join(i['also_in'][:4])}"
    if i.get("link") and not no_links:
        line += f"  \n  🔗 {i['link']}"
    return line

def main():
    import argparse
    ap = argparse.ArgumentParser()
    ap.add_argument("inp", nargs="?", default="calcio_raw.json")
    ap.add_argument("outp", nargs="?", default="calcio_briefing_latest.md")
    ap.add_argument("--inter", type=int, default=16, help="国米展开条数(带全文)")
    ap.add_argument("--team", type=int, default=4, help="每支重点球队展示条数")
    ap.add_argument("--other", type=int, default=4, help="联赛其他动态展示条数")
    ap.add_argument("--body-len", type=int, default=220, help="国米正文摘要长度上限")
    ap.add_argument("--no-links", action="store_true", help="不输出原文链接(进一步压缩推送体积)")
    args = ap.parse_args()
    inp, outp = args.inp, args.outp
    d = json.load(open(inp, encoding="utf-8"))
    items = d.get("items", [])
    # 免费翻译：将非中/英标题(意/西/德/法)翻成简中；无网络或失败则保留原文
    if translate.enabled():
        translate.translate_items(items)
    inter = [i for i in items if i.get("is_inter")]
    non = [i for i in items if not i.get("is_inter")]

    # 按球队归集
    by_team = defaultdict(list)
    for i in non:
        for t in i.get("teams", []):
            by_team[t].append(i)
    # 联赛其他(无具体球队但带联赛标签)
    league_other = defaultdict(list)
    for i in non:
        lg = i.get("league", "")
        if lg in LEAGUES and not i.get("teams"):
            league_other[lg].append(i)

    L = []
    date = (d.get("fetched_at") or "")[:10]
    L.append(f"# ⚽ 欧洲足坛转会晨报 · {date}")
    L.append("")
    L.append(f"> 抓取 **{d.get('total','?')}** 条 → 保留近 {d.get('freshness_filter')} 内 **{d.get('kept','?')}** 条"
             f"（国米 **{d.get('inter_count','?')}** · 重点球队命中 **{d.get('major_count','?')}**）")
    L.append("")
    L.append("> 档位：✅ 已官宣 ｜ 🟢 强传闻 ｜ 🟡 传闻 ｜ 🔴 弱传闻  ｜  聚合源默认低档，须经权威源印证才升级")
    L.append("")

    # 🔵 国米
    L.append("## 🔵 国际米兰专区（置顶）")
    L.append("")
    if inter:
        for i in inter[:args.inter]:
            r = render_item(i, with_body=True, body_len=args.body_len, no_links=args.no_links)
            if r: L.append(r)
        if len(inter) > args.inter:
            L.append(f"- …国米另有 **{len(inter)-args.inter}** 条未展开")
    else:
        L.append("_暂无近窗国米动态_")
    L.append("")

    # 各联赛
    league_emoji = {"意甲":"🇮🇹","英超":"🏴","西甲":"🇪🇸","德甲":"🇩🇪","法甲":"🇫🇷"}
    for lg in LEAGUES:
        L.append(f"## {league_emoji.get(lg,'⚽')} {lg}重点球队")
        L.append("")
        any_team = False
        for team in TEAMS_ORDER.get(lg, []):
            lst = by_team.get(team, [])
            if not lst:
                continue
            any_team = True
            # 按档位排序：已官宣>强>传>弱
            order = {"已官宣":0,"强传闻":1,"传闻":2,"弱传闻":3}
            lst2 = sorted(lst, key=lambda x: order.get(x.get("tier_hint","弱传闻"),9))
            L.append(f"### {team}（{len(lst)}）")
            L.append("")
            for i in lst2[:args.team]:
                r = render_item(i, with_body=False, no_links=args.no_links)
                if r: L.append(r)
            if len(lst2) > args.team:
                L.append(f"- …{team}另有 **{len(lst2)-args.team}** 条")
            L.append("")
        # 联赛其他
        lo = league_other.get(lg, [])
        if lo and any_team is False or lo:
            order = {"已官宣":0,"强传闻":1,"传闻":2,"弱传闻":3}
            lo2 = sorted(lo, key=lambda x: order.get(x.get("tier_hint","弱传闻"),9))
            if lo2:
                L.append(f"### 📡 {lg}其他动态")
                L.append("")
                for i in lo2[:args.other]:
                    r = render_item(i, with_body=False, no_links=args.no_links)
                    if r: L.append(r)
                L.append("")
        if not any_team and not lo:
            L.append("_本窗暂无重点动态_")
            L.append("")

    L.append("---")
    L.append("*数据来源：Google News 全球聚合（按联赛/俱乐部关键词）+ 英语/西/德/法/意 RSS 五大联赛直连源。**意/西/德/法标题由免费翻译 API 自动译为简体中文**（意/西/德/法源原文不再出现）。RSS 滞后约 0.5–数小时，官宣以俱乐部官方为准。本简报仅为公开新闻聚合，不构成投注或交易建议。*")

    out = "\n".join(L)
    with open(outp, "w", encoding="utf-8") as f:
        f.write(out)
    # 同时输出到 stdout（供 workflow 调试）
    print(f"[build] 渲染完成 → {outp}  ({len(out)} 字符, {out.count(chr(10))+1} 行)")
    # 若过大，提示（pushplus 可能截断）
    if len(out) > 28000:
        print(f"[build] ⚠️ 内容较大({len(out)}字符)，pushplus 可能截断，建议查看仓库完整版")

if __name__ == "__main__":
    main()
