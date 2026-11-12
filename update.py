import os
import re
import csv
import json
import glob

# 统一校准为 KOSPI 200 单倍成分股总市值口径（万亿韩元）
BASE_HISTORY = [
    {"date": "10/08", "cap": 2090.25, "point": 865.20},
    {"date": "10/10", "cap": 2070.10, "point": 855.10},
    {"date": "10/12", "cap": 2035.00, "point": 840.00},
    {"date": "10/14", "cap": 2032.55, "point": 839.20},
    {"date": "10/16", "cap": 1990.20, "point": 820.50},
    {"date": "10/18", "cap": 2002.50, "point": 825.00},
    {"date": "10/20", "cap": 2010.40, "point": 828.60},
    {"date": "10/22", "cap": 1990.10, "point": 819.40},
    {"date": "10/24", "cap": 2007.80, "point": 826.80},
    {"date": "10/26", "cap": 1987.50, "point": 818.20},
    {"date": "10/28", "cap": 1990.00, "point": 819.00},
    {"date": "10/30", "cap": 1982.60, "point": 815.40},
    {"date": "11/01", "cap": 1997.50, "point": 822.00},
    {"date": "11/02", "cap": 2034.25, "point": 838.00},
    {"date": "11/03", "cap": 2027.60, "point": 835.40},
    {"date": "11/04", "cap": 2007.50, "point": 826.00},
    {"date": "11/05", "cap": 2020.25, "point": 831.20},
    {"date": "11/06", "cap": 2000.10, "point": 823.00},
    {"date": "11/07", "cap": 2004.00, "point": 824.50},
    {"date": "11/08", "cap": 1975.20, "point": 811.20},
    {"date": "11/09", "cap": 1907.50, "point": 782.40},
    {"date": "11/10", "cap": 1915.10, "point": 785.60},
    {"date": "11/11", "cap": 2044.43, "point": 838.32}
]

JSON_PATH = os.path.join("data", "kospi_history.json")
MIN_VALID_CAP = 1200.0   # KOSPI 200 单倍市值物理下限（万亿韩元）
MAX_VALID_CAP = 3500.0   # KOSPI 200 单倍市值物理上限（万亿韩元）
ANCHOR_CAP_1111 = 2044.43
ANCHOR_PT_1111 = 838.32


def normalize_to_trillion_krw(raw_sum):
    """自动匹配 원 / 천원 / 백만원 / 억원 量级，锁定单倍万亿韩元区间"""
    for divisor in (1e12, 1e9, 1e6, 1e4, 1.0):
        val = raw_sum / divisor
        if MIN_VALID_CAP <= val <= MAX_VALID_CAP:
            return round(val, 2)
    return None


def parse_krx_csv(filepath):
    for enc in ("utf-8-sig", "cp949", "euc-kr", "utf-8"):
        try:
            with open(filepath, "r", encoding=enc) as f:
                rows = list(csv.reader(f))
            if len(rows) < 2:
                continue

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
            valid_rows = [
                r for r in data_rows
                if r and not any(w in "".join(r) for w in ("합계", "총계", "소계", "Total"))
            ]

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
                    return cap

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
                    return cap
        except Exception:
            continue
    return None


def main():
    os.makedirs("data", exist_ok=True)
    # 每次重构基于校准后的单倍底座，彻底清除旧双倍脏数据
    history_map = {item["date"]: dict(item) for item in BASE_HISTORY}

    if os.path.exists(JSON_PATH):
        with open(JSON_PATH, "r", encoding="utf-8") as f:
            old_data = json.load(f)
        for item in old_data:
            d = item.get("date")
            c = float(item.get("cap", 0))
            if d and d not in history_map and MIN_VALID_CAP <= c <= MAX_VALID_CAP:
                history_map[d] = item

    csv_files = sorted(glob.glob("data_*_*.csv"))
    parsed_files = []

    for fp in csv_files:
        m = re.search(r"data_\d+_(\d{4})(\d{2})(\d{2})\.csv$", os.path.basename(fp))
        if not m:
            continue
        date_str = f"{m.group(2)}/{m.group(3)}"
        cap = parse_krx_csv(fp)
        if cap:
            est_point = round(ANCHOR_PT_1111 * (cap / ANCHOR_CAP_1111), 2)
            history_map[date_str] = {
                "date": date_str,
                "cap": cap,
                "point": est_point
            }
            parsed_files.append(fp)

    sorted_history = sorted(history_map.values(), key=lambda x: x["date"])
    with open(JSON_PATH, "w", encoding="utf-8") as f:
        json.dump(sorted_history, f, ensure_ascii=False, indent=2)

    if len(parsed_files) > 1:
        for old_fp in parsed_files[:-1]:
            os.remove(old_fp)


if __name__ == "__main__":
    main()
