#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
push_calcio.py —— 将生成的晨报 markdown 推送到 pushplus。

用法:
  python push_calcio.py <markdown_file> [title]

读取本脚本同目录的 .push_config.json（由 GitHub Actions 从 PUSH_CONFIG_JSON 密钥生成，
本地手动跑也可放一份）:
  { "channel": "pushplus", "token": "你的token" }

设计原则:
  - token 未配置时仅打印提示并 exit(0)，不报错中断（保证自动化不崩）。
  - 推送失败(网络/服务端错误)仅打印，不影响已落盘的 markdown 文件。
  - 成功判定解析服务端返回的 JSON 内层 code（避免把 999 误判成功）。
"""
import sys, os, json, urllib.request, urllib.error

HERE = os.path.dirname(os.path.abspath(__file__))
CONFIG = os.path.join(HERE, ".push_config.json")
API = "https://www.pushplus.plus/send"


def load_token():
    try:
        with open(CONFIG, encoding="utf-8") as f:
            cfg = json.load(f)
        return (cfg.get("token") or "").strip()
    except Exception:
        return ""


def main():
    if len(sys.argv) < 2:
        print("usage: push_calcio.py <markdown_file> [title]")
        sys.exit(2)

    md = sys.argv[1]
    title = sys.argv[2] if len(sys.argv) > 2 else "欧洲足坛转会晨报"

    token = load_token()
    if not token:
        print(f"[pushplus] 未找到 {CONFIG} 或 token 为空，跳过推送。")
        sys.exit(0)

    try:
        with open(md, encoding="utf-8") as f:
            content = f.read()
    except Exception as e:
        print("[pushplus] 读取文件失败:", e)
        sys.exit(1)

    payload = {
        "token": token,
        "title": title,
        "content": content,
        "template": "markdown",
    }
    data = json.dumps(payload, ensure_ascii=False).encode("utf-8")
    req = urllib.request.Request(API, data=data, headers={"Content-Type": "application/json"})
    try:
        with urllib.request.urlopen(req, timeout=20) as resp:
            code = resp.getcode()
            body = resp.read().decode("utf-8", "ignore")
        print("[pushplus] HTTP", code, "body:", body)
        ok = False
        try:
            ok = (json.loads(body).get("code") == 200)
        except Exception:
            ok = (code == 200)
        if ok:
            print("[pushplus] 推送成功 ✅")
        else:
            print("[pushplus] 推送失败（服务端返回非 200 code），请检查 token / 配额")
    except urllib.error.HTTPError as e:
        print("[pushplus] HTTPError", e.code, e.read().decode("utf-8", "ignore"))
    except Exception as e:
        print("[pushplus] 网络错误:", e)


if __name__ == "__main__":
    main()
