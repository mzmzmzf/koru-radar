import os
import re
import csv
import json
import glob

# 10/08 - 11/11 基准历史底座
BASE_HISTORY = [
    {"date": "10/08", "cap": 4180.5, "point": 865.2},
    {"date": "10/10", "cap": 4140.2, "point": 855.1},
    {"date": "10/12", "cap": 4070.0, "point": 840.0},
    {"date": "10/14", "cap": 4065.1, "point": 839.2},
    {"date": "10/16", "cap": 3980.4, "point": 820.5},
    {"date": "10/18", "cap": 4005.0, "point": 825.0},
    {"date": "10/20", "cap": 4020.8, "point": 828.6},
    {"date": "10/22", "cap": 3980.2, "point": 819.4},
    {"date": "10/24", "cap": 4015.6, "point": 826.8},
    {"date": "10/26", "cap": 3975.0, "point": 818.2},
    {"date": "10/28", "cap": 3980.0, "point": 819.0},
    {"date": "10/30", "cap": 3965.2, "point": 815.4},
    {"date": "11/01", "cap": 3995.0, "point": 822.0},
    {"date": "11/02", "cap": 4068.5, "point": 838.0},
    {"date": "11/03", "cap": 4055.2, "point": 835.4},
    {"date": "11/04", "cap": 4015.0, "point": 826.0},
    {"date": "11/05", "cap": 4040.5, "point": 831.2},
    {"date": "11/06", "cap": 4000.2, "point": 823.0},
    {"date": "11/07", "cap": 4008.0, "point": 824.5},
    {"date": "11/08", "cap": 3950.4, "point": 811.2},
    {"date": "11/09", "cap": 3815.0, "point": 782.4},
    {"date": "11/10", "cap": 3830.2, "point": 785.6},
    {"date": "11/11", "cap": 4088.85, "point": 838.32}
]

JSON_PATH = os.path.join("data", "kospi_history.json")
MIN_VALID_CAP = 2000.0   # KOSPI 200 总市值物理下限（万亿韩元）
MAX_VALID_CAP = 8500.0   # KOSPI 200 总市值物理上限（万亿韩元）


def normalize_to_trillion_krw(raw_sum):
    """自动匹配 원 / 천원 / 백만원 / 억원 量级，严格锁定在 2000~8500 万亿韩元物理区间"""
    for divisor in (1e12, 1e9, 1e6, 1e4, 1.0):
        val = raw_sum / divisor
        if MIN_VALID_CAP <= val <= MAX_VALID_CAP:
            return round(val, 2)
    return None


def parse_krx_csv(filepath):
    """兼容 UTF-8 / CP949 / EUC-KR 编码与多行表头，精准提取 KOSPI 200 总市值"""
    for enc in ("utf-8-sig", "cp949", "euc-kr", "utf-8"):
        try:
            with open(filepath, "r", encoding=enc) as f:
                rows = list(csv.reader(f))
            if len(rows) < 2:
                continue

            # 在前 5 行中自动定位表头行
            header_row_idx = 0
            cap_idx = -1
            for r_idx in range(min(5, len(rows))):
                for c_idx, col in enumerate(rows[r_idx]):
                    clean_col = col.strip().replace(" ", "")
                    if any(k in clean_col for k in ("상장시가총액", "시가총액", "MKTCAP", "MarketCap", "市值")):
                        header_row_idx = r_idx
                        cap_idx = c_idx
                        break
                if cap_idx != -1:
                    break

            data_rows = rows[header_row_idx + 1:]
            # 过滤汇总行（如 합계 / 총계），防止重复累加翻倍
            valid_rows = [
                r for r in data_rows
                if r and not any(w in "".join(r) for w in ("합계", "총계", "소계", "Total"))
            ]

            # 方式 1：优先按匹配到的市值列求和
            if cap_idx != -1:
                total_val = 0.0
                for row in valid_rows:
                    if cap_idx < len(row):
                        num_str = row[cap_idx].replace(",", "").strip()
                        try:
                            total_val += float(num_str)
                        except ValueError:
                            pass
                cap = normalize_to_trillion_krw(total_val)
                if cap:
                    print(f"[INFO] 命中市值列(第{cap_idx}列): 原始求和={total_val} -> 归一化={cap} 万亿韩元")
                    return cap

            # 方式 2：按列独立求和并匹配物理区间（自动避开股票代码、成交额、股数列）
            num_cols = max(len(r) for r in valid_rows)
            header = rows[header_row_idx]
            for c_idx in range(num_cols):
                col_name = header[c_idx].strip() if c_idx < len(header) else ""
                if any(bad in col_name for bad in ("코드", "거래량", "거래대금", "주식수", "종가", "대비", "등락")):
                    continue
                col_sum = 0.0
                for row in valid_rows:
                    if c_idx < len(row):
                        num_str = row[c_idx].replace(",", "").strip()
                        try:
                            col_sum += float(num_str)
                        except ValueError:
                            pass
                cap = normalize_to_trillion_krw(col_sum)
                if cap:
                    print(f"[INFO] 自动量级匹配(第{c_idx}列 {col_name}): 原始求和={col_sum} -> 归一化={cap} 万亿韩元")
                    return cap
        except Exception:
            continue
    return None


def main():
    os.makedirs("data", exist_ok=True)
    if os.path.exists(JSON_PATH):
        with open(JSON_PATH, "r", encoding="utf-8") as f:
            raw_history = json.load(f)
        # 自动剔除历史 JSON 中的异常脏数据（如 20302358.00）
        history = [
            item for item in raw_history
            if MIN_VALID_CAP <= float(item.get("cap", 0)) <= MAX_VALID_CAP
        ]
    else:
        history = list(BASE_HISTORY)

    history_map = {item["date"]: item for item in history}
    for base_item in BASE_HISTORY:
        history_map.setdefault(base_item["date"], base_item)

    csv_files = sorted(glob.glob("data_*_*.csv"))
    parsed_files = []

    for fp in csv_files:
        m = re.search(r"data_\d+_(\d{4})(\d{2})(\d{2})\.csv$", os.path.basename(fp))
        if not m:
            continue
        date_str = f"{m.group(2)}/{m.group(3)}"
        cap = parse_krx_csv(fp)
        if cap:
            est_point = round(838.32 * (cap / 4088.85), 2)
            history_map[date_str] = {
                "date": date_str,
                "cap": cap,
                "point": est_point
            }
            parsed_files.append(fp)
            print(f"[OK] {fp} -> {date_str} | 市值: {cap} 万亿 | 点位: {est_point}")
        else:
            print(f"[WARN] {fp} 未识别到有效市值区间，跳过写入")

    sorted_history = sorted(history_map.values(), key=lambda x: x["date"])
    with open(JSON_PATH, "w", encoding="utf-8") as f:
        json.dump(sorted_history, f, ensure_ascii=False, indent=2)

    if len(parsed_files) > 1:
        for old_fp in parsed_files[:-1]:
            os.remove(old_fp)


if __name__ == "__main__":
    main()
