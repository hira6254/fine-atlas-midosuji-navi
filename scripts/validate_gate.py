#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
Deterministic Health, Compliance & Security Gate (<0.2s, ¥0)
Validates merged Midosuji store dataset, scripts compliance, JS syntax, HTML DOM IDs, and Excel output.
"""

import json
import os
import re
import subprocess
import sys
import openpyxl

BASE_DIR = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
MERGED_JSON = os.path.join(BASE_DIR, "scripts", "stores_merged.json")
DATA_JS = os.path.join(BASE_DIR, "data.js")
APP_JS = os.path.join(BASE_DIR, "app.js")
INDEX_HTML = os.path.join(BASE_DIR, "index.html")
XLSX_PATH = os.path.join(
    BASE_DIR, "御堂筋線_江坂〜梅田_チラシ架電＆訪問リスト_ファインアトラス富田専用.xlsx"
)

REQUIRED_STORE_KEYS = [
    "id",
    "name",
    "kana",
    "rank",
    "stationCode",
    "stationGroup",
    "stationDetail",
    "walkMinutes",
    "rideFromEsakaMin",
    "fareFromEsakaYen",
    "address",
    "phone",
    "phoneType",
    "genre",
    "segmentCode",
    "segmentLabel",
    "priceRange",
    "closedDay",
    "callWindow",
    "hookProduct",
    "fishTags",
    "menuEvidence",
    "whyFit",
    "callFlyerPitch",
    "visit1FlyerPitch",
    "visit2RelationPitch",
]

FORBIDDEN_UNVERIFIED_PATTERNS = [
    (r"月額\s*1万", "未確定の『月額1万円』定期便価格表現"),
    (r"月\s*1万円\s*(から|〜|プラン|定期)", "未確定の『月1万円〜定期便』価格表現"),
    (r"無料サンプル", "未確認の『無料サンプル』断定表現"),
    (r"11月25日", "未確認の社内計画開業日（11月25日）"),
    (r"cybozu\.com", "社内サイボウズURLの混入"),
    (r"標準仕入目安|FA粗利率|卸相場レンジ", "社内用仕入原価・粗利率データの混入"),
    (r"authKey|vaultPepper|ENCv1:", "シークレット文字列の混入"),
]


def fail(errors):
    print("\n[GATE FAILED] Total errors:", len(errors))
    for e in errors[:40]:
        print("  ❌", e)
    sys.exit(1)


def main():
    errors = []
    warnings = []

    if not os.path.exists(MERGED_JSON):
        fail(["stores_merged.json does not exist. Run build_deliverables.py first."])

    with open(MERGED_JSON, "r", encoding="utf-8") as f:
        stores = json.load(f)

    if len(stores) < 80:
        errors.append(f"Store count too low: {len(stores)} (expected >= 80)")

    phones = set()
    station_counts = {}
    phone_re = re.compile(r"^0\d{1,4}-\d{1,4}-\d{3,4}$")
    dummy_re = re.compile(r"(0000-0000|1234-5678|9999-9999|XXXX|xxxx)")

    for st in stores:
        sid = st.get("id")
        sname = st.get("name", f"id={sid}")
        for k in REQUIRED_STORE_KEYS:
            if k not in st or st[k] in (None, ""):
                errors.append(f"[{sname}] missing required field: {k}")

        ph = str(st.get("phone", "")).strip()
        if not phone_re.match(ph) or dummy_re.search(ph):
            errors.append(f"[{sname}] invalid or placeholder phone format: {ph}")
        ph_digits = re.sub(r"[^0-9]", "", ph)
        if ph_digits in phones:
            errors.append(f"[{sname}] duplicate phone number: {ph}")
        phones.add(ph_digits)

        code = st.get("stationCode", "")
        station_counts[code] = station_counts.get(code, 0) + 1

        addr = str(st.get("address", ""))
        if code == "M11" and ("吹田市" not in addr and "豊中市" not in addr):
            errors.append(f"[{sname}] M11 store address outside Suita/Toyonaka: {addr}")
        elif code in ("M12", "M13", "M14") and "淀川区" not in addr:
            errors.append(f"[{sname}] {code} store address outside Yodogawa-ku: {addr}")
        elif code in ("M15", "M16", "M16S") and "北区" not in addr:
            errors.append(f"[{sname}] {code} store address outside Kita-ku: {addr}")

        walk = st.get("walkMinutes", 99)
        if not isinstance(walk, int) or walk < 1 or walk > 12:
            errors.append(f"[{sname}] walkMinutes out of range (1..12): {walk}")

        blob = " ".join(
            str(st.get(f_key, ""))
            for f_key in ("whyFit", "callFlyerPitch", "visit1FlyerPitch", "visit2RelationPitch")
        )
        for pat, desc in FORBIDDEN_UNVERIFIED_PATTERNS:
            if re.search(pat, blob):
                errors.append(f"[{sname}] contains forbidden text ({desc})")

    for req_code in ("M11", "M12", "M13", "M14", "M15", "M16", "M16S"):
        if station_counts.get(req_code, 0) < 5:
            errors.append(f"Station {req_code} has too few stores: {station_counts.get(req_code, 0)}")

    # Check JS syntax with node --check
    for js_file in (DATA_JS, APP_JS):
        res = subprocess.run(["node", "--check", js_file], capture_output=True, text=True)
        if res.returncode != 0:
            errors.append(f"JS syntax check failed for {os.path.basename(js_file)}: {res.stderr}")

    # Check HTML integrity & robots noindex + single <h1> + forbidden terms
    with open(INDEX_HTML, "r", encoding="utf-8") as f:
        html = f.read()
    if 'noindex, nofollow' not in html:
        errors.append("index.html missing <meta name='robots' content='noindex, nofollow'>")
    h1_count = len(re.findall(r"<h1[\s>]", html))
    if h1_count != 1:
        errors.append(f"index.html must have exactly 1 <h1>, found {h1_count}")

    for pat, desc in FORBIDDEN_UNVERIFIED_PATTERNS:
        if re.search(pat, html):
            errors.append(f"index.html contains forbidden text ({desc})")

    # Check all getElementById references in app.js exist in index.html
    with open(APP_JS, "r", encoding="utf-8") as f:
        app_code = f.read()
    referenced_ids = set(re.findall(r'getElementById\("([^"]+)"\)', app_code))
    html_ids = set(re.findall(r'id="([^"]+)"', html))
    missing_dom_ids = referenced_ids - html_ids
    if missing_dom_ids:
        errors.append(f"app.js references missing HTML IDs: {sorted(missing_dom_ids)}")

    # Check Excel workbook
    if not os.path.exists(XLSX_PATH):
        errors.append("Excel workbook missing")
    else:
        wb = openpyxl.load_workbook(XLSX_PATH, data_only=False)
        expected_sheets = [
            "ダッシュボード_御堂筋線攻略",
            "御堂筋線_厳選架電＆訪問リスト",
            "富田専用_4段階トーク＆切り返し集",
            "ファインアトラス基礎知識＆厳守ルール",
        ]
        if wb.sheetnames != expected_sheets:
            errors.append(f"Excel sheets mismatch: {wb.sheetnames}")
        ws_list = wb["御堂筋線_厳選架電＆訪問リスト"]
        excel_rows = ws_list.max_row - 4
        if excel_rows != len(stores):
            errors.append(f"Excel store row count ({excel_rows}) != JSON count ({len(stores)})")

    if errors:
        fail(errors)

    direct_06 = sum(1 for s in stores if str(s["phone"]).startswith("06-"))
    print("✅ [DETERMINISTIC GATE PASSED]")
    print(f"   Total Unique Verified Stores : {len(stores)} stores")
    print(f"   Direct 06 Landline Ratio     : {direct_06}/{len(stores)} ({direct_06*100/len(stores):.1f}%)")
    print(f"   Station Breakdown            : {station_counts}")
    if warnings:
        for w in warnings:
            print("   ⚠️", w)


if __name__ == "__main__":
    main()
