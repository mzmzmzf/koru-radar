import csv
import glob
import json
import os
import re
from datetime import datetime, timedelta

DATA_DIR = "data"
OUTPUT_JSON = os.path.join(DATA_DIR, "kospi_history.json")
MAX_HISTORY_DAYS = 185  # 保留半年（约 6 个月 / 130+ 个交易日）历史数据


def read_csv_rows(filepath):
    for enc in ("utf-8-sig", "cp949", "euc-kr", "utf-8"):
        try:
            with open(filepath, "r", encoding=enc, newline="") as f:
                rows = list(csv.reader(f))
            if rows and len(rows) >= 2:
                return rows
        except Exception:
            continue
    return []


def parse_number(raw):
    if raw is None:
        return 0.0
    cleaned = str(raw).replace(",", "").replace('"', "").strip()
    try:
        return float(cleaned)
    except ValueError:
        return 0.0


def normalize_cap_trillion(raw_cap):
    if raw_cap <= 0:
        return 0.0
    if raw_cap > 1e11:      # 원 -> 조원 (万亿韩元)
        return raw_cap / 1e12
    if raw_cap > 1e5:       # 백만원 -> 조원
        return raw_cap / 1e6
    return raw_cap


def main():
    os.makedirs(DATA_DIR, exist_ok=True)
    records_by_date = {}

    # 1. 读取已有历史记录作为底稿
    if os.path.exists(OUTPUT_JSON):
        try:
            with open(OUTPUT_JSON, "r", encoding="utf-8") as f:
                old_list = json.load(f)
            if isinstance(old_list, list):
                for item in old_list:
                    d = str(item.get("date", "")).strip()
                    if d and item.get("cap"):
                        records_by_date[d] = {
                            "date": d,
                            "cap": round(float(item["cap"]), 2),
                            **({"point": round(float(item["point"]), 2)} if item.get("point") else {})
                        }
        except Exception:
            pass

    # 2. 扫描根目录与 data/ 目录下的所有 data_*.csv 文件
    csv_files = sorted(set(glob.glob("data_*.csv") + glob.glob(os.path.join(DATA_DIR, "data_*.csv"))))
    for fp in csv_files:
        rows = read_csv_rows(fp)
        if len(rows) < 2:
            continue

        headers = [h.strip() for h in rows[0]]
        date_idx = next((i for i, h in enumerate(headers) if "일자" in h or "날짜" in h or "date" in h.lower()), -1)
        close_idx = next((i for i, h in enumerate(headers) if h == "종가" or "현재가" in h or "지수" in h or "close" in h.lower()), -1)
        cap_idx = next((i for i, h in enumerate(headers) if "상장시가총액" in h or "시가총액" in h or "cap" in h.lower()), -1)

        # 情况 A: KRX 多日历史指数时序表 (如 data_4256_20261116.csv)
        if date_idx != -1 and cap_idx != -1:
            for r in rows[1:]:
                if len(r) <= max(date_idx, cap_idx):
                    continue
                m = re.search(r"(\d{4})[/-](\d{1,2})[/-](\d{1,2})", r[date_idx])
                if not m:
                    continue
                mm_dd = f"{int(m.group(2)):02d}/{int(m.group(3)):02d}"
                full_key = f"{m.group(1)}-{mm_dd}"
                cap_val = normalize_cap_trillion(parse_number(r[cap_idx]))
                pt_val = parse_number(r[close_idx]) if close_idx != -1 and len(r) > close_idx else 0.0
                if cap_val > 100:
                    entry = {"_sort": full_key, "date": mm_dd, "cap": round(cap_val, 2)}
                    if pt_val > 0:
                        entry["point"] = round(pt_val, 2)
                    records_by_date[full_key] = entry

        # 情况 B: KRX 单日成分股快照表 (如 data_0359_YYYYMMDD.csv)
        elif cap_idx != -1 and date_idx == -1:
            total_cap = sum(parse_number(r[cap_idx]) for r in rows[1:] if len(r) > cap_idx)
            cap_val = normalize_cap_trillion(total_cap)
            m = re.search(r"(\d{4})(\d{2})(\d{2})", os.path.basename(fp))
            if cap_val > 100 and m:
                mm_dd = f"{m.group(2)}/{m.group(3)}"
                full_key = f"{m.group(1)}-{mm_dd}"
                old_pt = records_by_date.get(mm_dd, {}).get("point")
                entry = {"_sort": full_key, "date": mm_dd, "cap": round(cap_val, 2)}
                if old_pt:
                    entry["point"] = old_pt
                records_by_date[full_key] = entry

    # 3. 统一排序并截取最近半年（185天 / 最多140个交易日）
    normalized_list = []
    for k, v in records_by_date.items():
        sort_k = v.get("_sort")
        if not sort_k:
            # 兼容旧的 MM/DD 键
            year_guess = "2026"
            sort_k = f"{year_guess}-{v['date']}"
        item = {"_sort": sort_k, "date": v["date"], "cap": v["cap"]}
        if v.get("point"):
            item["point"] = v["point"]
        normalized_list.append(item)

    # 按完整日期去重并升序排列
    dedup = {x["_sort"]: x for x in normalized_list}
    sorted_items = sorted(dedup.values(), key=lambda x: x["_sort"])[-135:]

    final_output = []
    for x in sorted_items:
        row_out = {"date": x["date"], "cap": x["cap"]}
        if "point" in x:
            row_out["point"] = x["point"]
        final_output.append(row_out)

    with open(OUTPUT_JSON, "w", encoding="utf-8") as f:
        json.dump(final_output, f, ensure_ascii=False, indent=2)
    print(f"Updated {OUTPUT_JSON} with {len(final_output)} trading days.")


if __name__ == "__main__":
    main()
