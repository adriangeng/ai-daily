#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
translate.py — 用免费、免密钥的翻译 API 把非中/英新闻标题翻成简体中文。
云端版(GitHub Actions)在 build_briefing 阶段调用；无网络 / 失败 / 限额 时优雅退化(保留原文)。
后端：
  主：MyMemory  https://api.mymemory.translated.net  (匿名 5000 词/天，无需 key)
  兜：Google Translate 公共 gtx 端点  https://translate.googleapis.com/translate_a/single  (无官方限额)
目标语言：简体中文(zh-CN)。源语言取条目 lang 字段(it/es/de/fr)；en/zh 不翻译。
仅依赖标准库 urllib，可在 GitHub Actions 运行，不依赖任何密钥或付费翻译服务。
"""
import json
import re
import urllib.parse
import urllib.request
import urllib.error

TARGET = "zh-CN"
# 需要翻译的源语言 -> API 语言码
SRC_MAP = {"it": "it", "es": "es", "de": "de", "fr": "fr", "pt": "pt", "nl": "nl"}

MYMEMORY = "https://api.mymemory.translated.net/get?q={q}&langpair={src}|{tgt}"
GOOGLE_GTX = "https://translate.googleapis.com/translate_a/single?client=gtx&sl={src}&tl={tgt}&dt=t&q={q}"

_UA = {"User-Agent": "Mozilla/5.0 (compatible; CalcioBot/1.0)"}


def enabled():
    """免费版无需密钥，始终可用。"""
    return True


def _http_get(url, timeout=12):
    req = urllib.request.Request(url, headers=_UA)
    with urllib.request.urlopen(req, timeout=timeout) as r:
        return r.read().decode("utf-8", "ignore")


def _translate_one(text, src):
    """翻译单条；全部失败回退原文。"""
    if not text or src not in SRC_MAP:
        return text
    q = urllib.parse.quote(text[:480])
    # 1) MyMemory（主）
    try:
        url = MYMEMORY.format(q=q, src=src, tgt=TARGET)
        data = json.loads(_http_get(url))
        if data.get("responseStatus") == 200:
            t = (data.get("responseData") or {}).get("translatedText") or ""
            if t and t != text:
                return t
        # 403 限额 / 无结果 -> 转 Google
    except Exception:
        pass
    # 2) Google gtx（兜底）
    try:
        url = GOOGLE_GTX.format(q=q, src=src, tgt=TARGET)
        raw = _http_get(url)
        arr = json.loads(raw)
        parts = []
        for seg in (arr[0] or []):
            if seg and seg[0]:
                parts.append(seg[0])
        t = "".join(parts).strip()
        if t:
            return t
    except Exception:
        pass
    return text  # 全部失败 -> 保留原文


def translate_items(items, cfg=None):
    """就地把 items 中 lang 非 zh/en 的 title 翻成简中，存入 title_zh 并标记 lang=zh。
    失败/无翻译则保留原 title，不影响渲染。"""
    for it in items:
        lang = (it.get("lang") or "").lower()
        if lang not in SRC_MAP:
            continue
        title = it.get("title") or ""
        if not title:
            continue
        try:
            tr = _translate_one(title, lang)
        except Exception:
            tr = title
        if tr and tr != title:
            it["title_zh"] = tr
            it["lang"] = "zh"  # 已中文化，下游无需再按原语言分支
    return items
