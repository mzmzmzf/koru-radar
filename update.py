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

def parse_krx_csv(filepath):
    """兼容 UTF-8 与韩文 CP949/EUC-KR 编码解析 KRX 成分股市值总和"""
    for enc in ["utf-8-sig", "cp949", "euc-kr", "utf-8"]:
        try:
            with open(filepath, "r", encoding=enc) as f:
                rows = list(csv.reader(f))
            if not rows or len(rows) < 2:
                continue

            header = rows[0]
            cap_idx = -1
            for i, col in enumerate(header):
                if any(k in col for k in ["상장시가총액", "시가총액", "Market Cap", "市值"]):
                    cap_idx = i
                    break

            total_val = 0.0
            for row in rows[1:]:
                if not row:
                    continue
                if cap_idx != -1 and cap_idx < len(row):
                    raw = row[cap_idx].replace(",", "").strip()
                    if raw.replace(".", "", 1).isdigit():
                        total_val += float(raw)
                else:
                    # 兜底：取该行最大数值列作为市值
                    nums = []
                    for cell in row:
                        c = cell.replace(",", "").strip()
                        if c.replace(".", "", 1).isdigit():
                            nums.append(float(c))
                    if nums:
                        total_val += max(nums)

            if total_val > 0:
                # 自动归一化单位为“万亿韩元” (10^12 KRW)
                if total_val > 1e14:
                    cap_trillion = total_val / 1e12
                elif total_val > 1e8:
                    cap_trillion = total_val / 1e6
                else:
                    cap_trillion = total_val
                return round(cap_trillion, 2)
        except Exception:
            continue
    return None

def main():
    os.makedirs("data", exist_ok=True)
    if os.path.exists(JSON_PATH):
        with open(JSON_PATH, "r", encoding="utf-8") as f:
            history = json.load(f)
    else:
        history = list(BASE_HISTORY)

    history_map = {item["date"]: item for item in history}

    # 扫描根目录所有 data_XXXX_YYYYMMDD.csv 文件
    csv_files = sorted(glob.glob("data_*_*.csv"))
    parsed_files = []

    for fp in csv_files:
        m = re.search(r"data_\d+_(\d{4})(\d{2})(\d{2})\.csv$", os.path.basename(fp))
        if not m:
            continue
        date_str = f"{m.group(2)}/{m.group(3)}"  # 转换为 MM/DD
        cap = parse_krx_csv(fp)
        if cap:
            # 锚定 11/11 (4088.85万亿 = 838.32点) 同步推算母体点位
            est_point = round(838.32 * (cap / 4088.85), 2)
            history_map[date_str] = {
                "date": date_str,
                "cap": cap,
                "point": est_point
            }
            parsed_files.append(fp)
            print(f"[OK] 解析成功 {fp} -> 日期: {date_str}, 市值: {cap} 万亿, 映射点位: {est_point}")

    # 按日期排序并写回 JSON
    sorted_history = sorted(history_map.values(), key=lambda x: x["date"])
    with open(JSON_PATH, "w", encoding="utf-8") as f:
        json.dump(sorted_history, f, ensure_ascii=False, indent=2)

    # 自动清理过期 CSV（仅保留最新 1 份，保持仓库整洁）
    if len(parsed_files) > 1:
        for old_fp in parsed_files[:-1]:
            os.remove(old_fp)
            print(f"[CLEAN] 已清理旧数据文件: {old_fp}")

if __name__ == "__main__":
    main()
