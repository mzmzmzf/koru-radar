#!/usr/bin/env python3
import os, re, sys
from collections import Counter

base = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
html_path = os.path.join(base, "index.html")
html = open(html_path, encoding="utf-8").read()

# 1. Check local <link> and <script src="./..."> exist
refs = re.findall(r'(?:href|src)="(\./[^"]+)"', html)
missing = [r for r in refs if r.split("?")[0] != "./manifest.json" and not os.path.exists(os.path.join(base, r.split("?")[0]))]
if missing:
    print("FAIL: Missing referenced files:", missing)
    sys.exit(1)

# 2. Check duplicate DOM IDs
ids = re.findall(r'\bid=["\']([^"\']+)["\']', html)
dups = {k: v for k, v in Counter(ids).items() if v > 1}
if dups:
    print("FAIL: Duplicate DOM IDs:", dups)
    sys.exit(1)

# 3. Check viewport allows user scaling
if "user-scalable=no" in html:
    print("FAIL: viewport still disables user scaling")
    sys.exit(1)

print(f"OK: {len(refs)} local assets verified, {len(ids)} unique DOM IDs, viewport accessible.")
