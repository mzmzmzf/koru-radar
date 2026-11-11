#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
跨市场量化作战终端 · 宏观数据自动化巡检引擎 (update.py)
功能：
1. 智能扫描本地 data_2828_*.csv 历史官方数据，自动更新市值双轨图与 CHoCH 突破点
2. 海外网络直连 Naver Finance / Yahoo Finance / OKX，实现全自动无人值守抓取
3. 动态重算 SVG 向量图折线点位坐标 (0-500 x 20-200)，精准更新 index.html
"""

import os
import re
import csv
import glob
import json
import urllib.request
from datetime import datetime

# ==================== 1. 本地 CSV 智能解析引擎 ====================
def parse_local_csv():
    """扫描当前目录下的 data_2828_*.csv 文件，解析韩国官方权威历史市值序列"""
    csv_files = glob.glob('*data_2828*.csv')
    if not csv_files:
        print("[INFO] 未发现本地 CSV 文件，切入全自动网络爬虫模式")
        return None

    # 获取最新日期的 CSV
    target_csv = sorted(csv_files)[-1]
    print(f"[SUCCESS] 捕获最新权威母体交割单: {target_csv}")

    rows = []
    try:
        with open(target_csv, 'r', encoding='utf-8', errors='ignore') as f:
            reader = csv.DictReader(f)
            for r in reader:
                try:
                    date_str = r['Date'].strip()
                    close_val = float(r['Close'].replace(',', ''))
                    chg_val = float(r['Change'].replace(',', ''))
                    chg_pct = float(r['%Change'].replace(',', ''))
                    # 市值换算为万亿韩元 (Total market cap / 1e6)
                    cap_val = float(r['Total market cap.'].replace(',', '')) / 1e6
                    rows.append({
                        'date': date_str,
                        'close': close_val,
                        'change': chg_val,
                        'chg_pct': chg_pct,
                        'cap': cap_val
                    })
                except Exception:
                    continue
    except Exception as e:
        print(f"[ERROR] 读取 CSV 失败: {e}")
        return None

    if not rows:
        return None

    # 按时间升序排序
    rows.sort(key=lambda x: x['date'])
    return rows

# ==================== 2. 全自动海外网络爬虫引擎 ====================
def fetch_online_data():
    """海外直连抓取韩国母体 KOSPI 200、离岸汇率与 OKX 持仓"""
    headers = {
        "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36",
        "Accept": "application/json"
    }

    online_data = {
        "close": 838.32,
        "chg_pct": 2.95,
        "usdkrw": 1334.75,
        "oi_wan": 117.32
    }

    # 1. 抓取 Naver Finance KOSPI 200 (韩国母体指数)
    try:
        url = "https://m.stock.naver.com/api/index/KPI200/basic"
        req = urllib.request.Request(url, headers=headers)
        with urllib.request.urlopen(req, timeout=8) as resp:
            res_json = json.loads(resp.read().decode('utf-8'))
            if 'nowValue' in res_json:
                online_data["close"] = float(res_json['nowValue'].replace(',', ''))
                online_data["chg_pct"] = float(res_json.get('changeRate', 2.95))
                print(f"[ONLINE] Naver 实时母体收盘: {online_data['close']} ({online_data['chg_pct']:+}%)")
    except Exception as e:
        print(f"[WARN] Naver 抓取抖动: {e}")

    # 2. 抓取 USDKRW 离岸汇率 (Yahoo Finance)
    try:
        url = "https://query1.finance.yahoo.com/v8/finance/chart/USDKRW=X?interval=1d&range=1d"
        req = urllib.request.Request(url, headers=headers)
        with urllib.request.urlopen(req, timeout=8) as resp:
            res_json = json.loads(resp.read().decode('utf-8'))
            fx = res_json['chart']['result'][0]['meta']['regularMarketPrice']
            online_data["usdkrw"] = round(float(fx), 2)
            print(f"[ONLINE] 实时离岸汇率 USDKRW: {online_data['usdkrw']}")
    except Exception as e:
        print(f"[WARN] 汇率抓取抖动: {e}")

    # 3. 抓取 OKX KORU 合约持仓量 (OI)
    try:
        url = "https://www.okx.com/api/v5/market/tickers?instType=SWAP"
        req = urllib.request.Request(url, headers=headers)
        with urllib.request.urlopen(req, timeout=8) as resp:
            res_json = json.loads(resp.read().decode('utf-8'))
            for item in res_json.get('data', []):
                if item.get('instId') == 'KORU-USDT-SWAP':
                    # 换算为万张/万额度
                    vol = float(item.get('volCcy24h', 1173200)) / 10000.0
                    online_data["oi_wan"] = round(vol, 2)
                    print(f"[ONLINE] OKX KORU 换手持仓: {online_data['oi_wan']} 万")
                    break
    except Exception as e:
        print(f"[WARN] OKX OI 抓取抖动: {e}")

    return online_data

# ==================== 3. 动态 SVG 走势图精算引擎 ====================
def calculate_svg_layout(rows):
    """根据实际市值序列动态计算响应式 SVG 坐标体系"""
    caps = [r['cap'] for r in rows]
    min_c = min(caps)
    max_c = max(caps)
    n = len(caps)

    points = []
    for i, c in enumerate(caps):
        x = int(round(i * (500.0 / (n - 1))))
        y = int(round(195 - (c - min_c) / (max_c - min_c) * (195 - 20)))
        points.append(f"{x},{y}")

    poly_str = " ".join(points)
    polygon_str = f"0,20 {poly_str} 500,200 0,200"

    # 底部拐点 (最小值)
    bottom_idx = caps.index(min_c)
    bottom_x = int(round(bottom_idx * (500.0 / (n - 1))))
    bottom_y = int(round(195 - (min_c - min_c) / (max_c - min_c) * (195 - 20)))

    # 最新点 (数组末尾)
    latest_x = 500
    latest_y = int(round(195 - (caps[-1] - min_c) / (max_c - min_c) * (195 - 20)))

    return {
        "poly_str": poly_str,
        "polygon_str": polygon_str,
        "bottom_x": bottom_x,
        "bottom_y": bottom_y,
        "latest_x": latest_x,
        "latest_y": latest_y,
        "min_cap": min_c,
        "max_cap": max_c
    }

# ==================== 4. index.html 正则渗透与重写 ====================
def update_index_html(data, svg_info=None):
    if not os.path.exists("index.html"):
        print("[ERROR] 根目录下未找到 index.html")
        return False

    with open("index.html", "r", encoding="utf-8") as f:
        html = f.read()

    # 1. 战报焦点卡片 (母体点位与涨幅)
    html = re.sub(
        r'首尔母体收复\s*[\d\.]+\s*点\s*\([+-]?[\d\.]+%?\)',
        f"首尔母体收复 {data['close']:.2f} 点 ({data['chg_pct']:+.2f}%)",
        html
    )

    # 2. 单日市值回血
    if 'daily_rebound' in data:
        html = re.sub(
        r'首尔单日市值回血\s*[\d\.]+\s*万亿韩元',
        f"首尔单日市值回血 {data['daily_rebound']:.1f} 万亿韩元",
        html
    )

    # 3. 汇率动态卡片
    html = re.sub(
        r'<div class="metric-name">USDKRW 离岸汇率</div>\s*<div class="metric-val"[^>]*>[\d\.,]+</div>',
        f'<div class="metric-name">USDKRW 离岸汇率</div>\n                <div class="metric-val" style="color:var(--neon-cyan);">{data["usdkrw"]:,}</div>',
        html
    )

    # 4. OKX 持仓量卡片 (严格杜绝万万叠字)
    html = re.sub(
        r'<div class="metric-name">OKX 合约持仓量 \(OI\)</div>\s*<div class="metric-val"[^>]*>[\d\.,]+\s*万?</div>',
        f'<div class="metric-name">OKX 合约持仓量 (OI)</div>\n                <div class="metric-val" style="color:#60a5fa;">{data["oi_wan"]} 万</div>',
        html
    )

    # 5. 大盘逐档映射表当前位置
    html = re.sub(
        r'<tr class="row-highlight">\s*<td>[\d\.]+</td>',
        f'<tr class="row-highlight">\n                            <td>{data["close"]:.2f}</td>',
        html
    )

    # 6. SVG 市值图与文本更新 (若有序列数据)
    if svg_info:
        # 图表标题日期范围
        html = re.sub(
            r'📈\s*KOSPI 200 整体市值变动走势\s*\([^)]+\)',
            f"📈 KOSPI 200 整体市值变动走势 ({data['start_date']} - {data['end_date']})",
            html
        )
        # 最新总市值数值
        html = re.sub(
            r'最新:\s*[\d\.,]+\s*万亿韩元',
            f"最新: {data['latest_cap']:,.2f} 万亿韩元",
            html
        )
        # 图表副标题描述
        html = re.sub(
            r'大盘在\s*[\d\/]+\s*触及\s*[\d,]+\s*万亿绝对底部后形成单日强力 CHoCH 结构反转[^<]*。',
            f"大盘在 {data['bottom_date']} 触及 {int(round(svg_info['min_cap'])):,} 万亿绝对底部后形成单日强力 CHoCH 结构反转，单日回血 {data['daily_rebound']:+.1f} 万亿 (两日累计 +{data['total_rebound']:.1f} 万亿)。",
            html
        )
        # SVG 折线与面积
        html = re.sub(
            r'<polygon points="[^"]+"\s*fill="url\(#chartGrad\)"\s*/>',
            f'<polygon points="{svg_info["polygon_str"]}" fill="url(#chartGrad)"/>',
            html
        )
        html = re.sub(
            r'<polyline points="[^"]+"\s*fill="none"\s*stroke="#10b981"\s*stroke-width="2.5"\s*/>',
            f'<polyline points="{svg_info["poly_str"]}" fill="none" stroke="#10b981" stroke-width="2.5"/>',
            html
        )
        # 底部标记点
        html = re.sub(
            r'<circle cx="\d+" cy="\d+" r="4" fill="#ef4444"/>\s*<text x="\d+" y="\d+" fill="#f87171" font-size="10">[^<]+</text>',
            f'<circle cx="{svg_info["bottom_x"]}" cy="{svg_info["bottom_y"]}" r="4" fill="#ef4444"/>\n                        <text x="{svg_info["bottom_x"]-37}" y="{svg_info["bottom_y"]-10}" fill="#f87171" font-size="10">{data["bottom_date"]} 底 {int(round(svg_info["min_cap"]))}</text>',
            html
        )
        # 最新标记点
        html = re.sub(
            r'<circle cx="\d+" cy="\d+" r="5" fill="#10b981"/>\s*<text x="\d+" y="\d+" fill="#34d399" font-size="10" font-weight="bold">[^<]+</text>',
            f'<circle cx="{svg_info["latest_x"]}" cy="{svg_info["latest_y"]}" r="5" fill="#10b981"/>\n                        <text x="{svg_info["latest_x"]-60}" y="{svg_info["latest_y"]-10}" fill="#34d399" font-size="10" font-weight="bold">+{data["daily_rebound"]:.1f}万亿</text>',
            html
        )

    with open("index.html", "w", encoding="utf-8") as f:
        f.write(html)

    print("[SUCCESS] index.html 已完成全维度精算校准与无痕注入！")
    return True

# ==================== 主控执行入口 ====================
def main():
    print("=" * 60)
    print("🚀 跨市场量化作战终端 · 自动巡检引擎启动")
    print("=" * 60)

    # 1. 尝试解析本地 CSV
    rows = parse_local_csv()

    # 2. 抓取网络实时数据 (汇率、持仓量、备用收盘价)
    online = fetch_online_data()

    if rows:
        latest = rows[-1]
        prev = rows[-2] if len(rows) > 1 else latest
        bottom = min(rows, key=lambda x: x['cap'])

        start_date = "/".join(rows[0]['date'].split('/')[-2:])
        end_date = "/".join(latest['date'].split('/')[-2:])
        bottom_date = "/".join(bottom['date'].split('/')[-2:])

        daily_reb = latest['cap'] - prev['cap']
        total_reb = latest['cap'] - bottom['cap']

        svg_layout = calculate_svg_layout(rows)

        final_data = {
            "close": latest['close'],
            "chg_pct": latest['chg_pct'],
            "daily_rebound": daily_reb,
            "total_rebound": total_reb,
            "latest_cap": latest['cap'],
            "start_date": start_date,
            "end_date": end_date,
            "bottom_date": bottom_date,
            "usdkrw": online["usdkrw"],
            "oi_wan": online["oi_wan"]
        }
        update_index_html(final_data, svg_layout)
    else:
        final_data = {
            "close": online["close"],
            "chg_pct": online["chg_pct"],
            "usdkrw": online["usdkrw"],
            "oi_wan": online["oi_wan"]
        }
        update_index_html(final_data)

    print("=" * 60)
    print("🏁 巡检完毕，战术数据已同步至最新形态")
    print("=" * 60)

if __name__ == "__main__":
    main()
