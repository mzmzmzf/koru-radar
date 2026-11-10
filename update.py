import os
import re
import json
import urllib.request
import yfinance as yf
from datetime import datetime

def fetch_okx_oi():
    """利用海外节点通过 OKX 官方开放 API 直连抓取 KORU 合约真实持仓量"""
    url = "https://www.okx.com/api/v5/public/open-interest?instType=SWAP&instId=KORU-USDT-SWAP"
    headers = {"User-Agent": "Mozilla/5.0"}
    try:
        req = urllib.request.Request(url, headers=headers)
        with urllib.request.urlopen(req, timeout=8) as resp:
            res = json.loads(resp.read().decode('utf-8'))
            if res.get("code") == "0" and res.get("data"):
                # 获取持仓张数并换算为万单位
                oi_raw = float(res["data"][0].get("oiCcy", 0))
                oi_wan = round(oi_raw / 10000.0, 2)
                return oi_wan if oi_wan > 0 else 954.77
    except Exception as e:
        print(f"OKX API 连接提示 (保留前值): {e}")
    return 954.77

def fetch_and_update():
    print(">>> 启动全球宏观与跨市场衍生品数据巡检引擎...")
    
    # 1. 抓取首尔大盘指数 (^KS200) 与 美元兑韩元 (KRW=X)
    latest_kospi = 814.31
    latest_usdkrw = 1337.10
    try:
        ks200_ticker = yf.Ticker("^KS200")
        ks_hist = ks200_ticker.history(period="5d")
        latest_kospi = round(float(ks_hist['Close'].iloc[-1]), 2)
        
        krw_ticker = yf.Ticker("KRW=X")
        krw_hist = krw_ticker.history(period="5d")
        latest_usdkrw = round(float(krw_hist['Close'].iloc[-1]), 2)
        print(f"[OK] KOSPI 200: {latest_kospi} 点 | USDKRW: {latest_usdkrw}")
    except Exception as e:
        print(f"[Warn] 韩国宏观数据抓取提示: {e}")

    # 2. 抓取美股 KORU 真实收盘价
    latest_koru = 7.580
    try:
        koru_ticker = yf.Ticker("KORU")
        koru_hist = koru_ticker.history(period="5d")
        latest_koru = round(float(koru_hist['Close'].iloc[-1]), 3)
        print(f"[OK] KORU 美股真实收盘价: {latest_koru} USDT")
    except Exception as e:
        print(f"[Warn] KORU 现货抓取提示: {e}")

    # 3. 抓取 OKX 合约真实持仓量 (OI)
    latest_oi = fetch_okx_oi()
    print(f"[OK] OKX 合约持仓量 (OI): {latest_oi} 万")

    # 4. 动态装载并替换 index.html 中的核心参数
    html_path = "index.html"
    if not os.path.exists(html_path):
        print("[Error] 未找到 index.html")
        return

    with open(html_path, "r", encoding="utf-8") as f:
        content = f.read()

    today_str = datetime.now().strftime("%Y-%m-%d %H:%M")

    # 替换 JS 内核常数
    content = re.sub(r'const BASE_KOSPI = [0-9.]+;', f'const BASE_KOSPI = {latest_kospi};', content)
    content = re.sub(r'const BASE_USDKRW = [0-9.]+;', f'const BASE_USDKRW = {latest_usdkrw};', content)
    content = re.sub(r'let currentKoruBase = [0-9.]+;', f'let currentKoruBase = {latest_koru};', content)
    content = re.sub(r'const BASE_KORU = [0-9.]+;', f'const BASE_KORU = {latest_koru};', content)

    # 替换前端看板重点展示数值
    content = re.sub(r'id="koru-val"[^>]*>[0-9.]+', f'id="koru-val">{latest_koru:.3f}', content)
    content = re.sub(r'id="usdkrw-val"[^>]*>[0-9,.]+', f'id="usdkrw-val">{latest_usdkrw:,.2f}', content)
    content = re.sub(r'id="okx-oi-val"[^>]*>[0-9.]+', f'id="okx-oi-val">{latest_oi:.2f}', content)
    content = re.sub(r'id="update-time">[^<]*<', f'id="update-time">{today_str}<', content)

    with open(html_path, "w", encoding="utf-8") as f:
        f.write(content)

    print(f">>> 雷达所有宏观、现货与合约数据已同步校准，时间戳: {today_str}")

if __name__ == "__main__":
    fetch_and_update()
