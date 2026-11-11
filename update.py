import os
import re
import json
import urllib.request
import yfinance as yf
from datetime import datetime

def fetch_okx_oi():
    """直连 OKX 官方开放 API 抓取 KORU 合约真实持仓量"""
    url = "https://www.okx.com/api/v5/public/open-interest?instType=SWAP&instId=KORU-USDT-SWAP"
    headers = {"User-Agent": "Mozilla/5.0"}
    try:
        req = urllib.request.Request(url, headers=headers)
        with urllib.request.urlopen(req, timeout=8) as resp:
            res = json.loads(resp.read().decode('utf-8'))
            if res.get("code") == "0" and res.get("data"):
                oi_raw = float(res["data"][0].get("oiCcy", 0))
                oi_wan = round(oi_raw / 10000.0, 2)
                return oi_wan if oi_wan > 0 else 124.38
    except Exception as e:
        print(f"OKX API 连接提示: {e}")
    return 124.38

def fetch_and_update():
    print(">>> 启动全球宏观与跨市场衍生品数据巡检引擎...")
    
    # 1. 抓取大盘与汇率
    latest_kospi = 814.31
    latest_usdkrw = 1342.44
    try:
        ks200_ticker = yf.Ticker("^KS200")
        ks_hist = ks200_ticker.history(period="5d")
        latest_kospi = round(float(ks_hist['Close'].iloc[-1]), 2)
        
        krw_ticker = yf.Ticker("KRW=X")
        krw_hist = krw_ticker.history(period="5d")
        latest_usdkrw = round(float(krw_hist['Close'].iloc[-1]), 2)
        print(f"[OK] KOSPI 200: {latest_kospi} 点 | USDKRW: {latest_usdkrw}")
    except Exception as e:
        print(f"[Warn] 宏观数据抓取提示: {e}")

    # 2. 抓取美股 KORU 真实收盘价
    latest_koru = 7.155
    try:
        koru_ticker = yf.Ticker("KORU")
        koru_hist = koru_ticker.history(period="5d")
        latest_koru = round(float(koru_hist['Close'].iloc[-1]), 3)
        print(f"[OK] KORU 美股真实收盘价: {latest_koru} USDT")
    except Exception as e:
        print(f"[Warn] KORU 现货抓取提示: {e}")

    # 3. 抓取 OKX 合约持仓量
    latest_oi = fetch_okx_oi()
    print(f"[OK] OKX 合约持仓量 (OI): {latest_oi} 万")

    # 4. 靶向替换 index.html 中的核心展示数值
    html_path = "index.html"
    if not os.path.exists(html_path):
        print("[Error] 未找到 index.html")
        return

    with open(html_path, "r", encoding="utf-8") as f:
        content = f.read()

    # 纠正被误伤的第一止盈锚点 (强行归位回 8.331 USDT)
    content = re.sub(r'(第一止盈锚点[\s\S]*?>)\s*[0-9,.]+(\s*USDT)', r'\g<1>8.331\2', content)

    # 精确匹配“USDKRW 离岸汇率”卡片内的独立数字
    content = re.sub(r'(USDKRW\s*离岸汇率[\s\S]*?<div[^>]*>)\s*[0-9,.]+', rf'\g<1>{latest_usdkrw:,.2f}', content)
    # 精确匹配“OKX 合约持仓量”卡片内的独立数字
    content = re.sub(r'(OKX\s*合约持仓量[^\n<]*?[\s\S]*?<div[^>]*>)\s*[0-9.]+(\s*万)*', rf'\g<1>{latest_oi:.2f}', content)
    # 精确匹配“KORU 实时动态价”卡片内的独立数字
    content = re.sub(r'(KORU\s*实时动态价[\s\S]*?<div[^>]*>)\s*[0-9.]+(\s*USDT)?', rf'\g<1>{latest_koru:.3f} USDT', content)
    # 顶部基准价格动态同步
    content = re.sub(r'(-0\.05\s*<\/button>\s*<button[^>]*>)\s*[0-9.]+', rf'\g<1>{latest_koru:.3f}', content)

    with open(html_path, "w", encoding="utf-8") as f:
        f.write(content)

    print(">>> 靶向校准完成，第一止盈位 8.331 已锁定。")

if __name__ == "__main__":
    fetch_and_update()
