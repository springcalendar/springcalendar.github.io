"""Regenerate all derived config from the single source of truth (committees.json).

Run after editing committees.json:

    python tools/gen_config.py

It rewrites, per sheet (boys, girls):
  - sheet-templates/_Config.<sheet>.csv   -> import into that sheet's _Config tab
  - apps-script/Committees.<sheet>.gs     -> paste into that sheet's Apps Script

...and for the website:
  - site/data/committees.json             -> every tab (with section) for the switch
  - site/data/combined.json               -> the two "All Events" mirror calendars
  - site/data/settings.json               -> Google Calendar API key

Pure Python standard library only — no credentials, no third-party deps.
"""

import csv
import json
import os
import sys

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
sys.path.insert(0, os.path.join(ROOT, "render"))

from committees import load_sheets, load_committees, load_combined, load_settings  # noqa: E402

SHEET_TEMPLATES = os.path.join(ROOT, "sheet-templates")
APPS_SCRIPT = os.path.join(ROOT, "apps-script")
SITE_DATA = os.path.join(ROOT, "site", "data")

CONFIG_HEADER = ["Committee", "CalendarId", "Color", "iCalURL", "SubscribeURL"]


def _js(s):
    """Escape a Python string for a single-quoted JS literal."""
    return str(s).replace("\\", "\\\\").replace("'", "\\'")


def _config_rows(sheet):
    """The _Config rows for one sheet: its tabs, then its combined mirror row."""
    rows = [[t["tab"], t["calendar_id"], t["color"], t["ical_url"], t["subscribe_url"]]
            for t in sheet["tabs"]]
    c = sheet["combined"]
    rows.append([c["name"], c["calendar_id"], c["color"], c["ical_url"], c["subscribe_url"]])
    return rows


def write_config_csv(sheet):
    os.makedirs(SHEET_TEMPLATES, exist_ok=True)
    path = os.path.join(SHEET_TEMPLATES, f"_Config.{sheet['id']}.csv")
    with open(path, "w", newline="", encoding="utf-8") as f:
        w = csv.writer(f)
        w.writerow(CONFIG_HEADER)
        w.writerows(_config_rows(sheet))
    print(f"  wrote {os.path.relpath(path, ROOT)}")


def write_committees_gs(sheet):
    lines = [
        "/**",
        f" * AUTO-GENERATED from committees.json by tools/gen_config.py — {sheet['name']} sheet.",
        " * Do not edit by hand — re-run the generator instead.",
        " * Paste this into the " + sheet["name"] + " sheet's Apps Script project.",
        " */",
        "var COMMITTEE_TABS = [",
    ]
    for t in sheet["tabs"]:
        lines.append(f"  {{ name: '{_js(t['tab'])}', color: '{t['color']}' }},")
    lines.append("];")
    lines.append("")
    lines.append("var CONFIG_ROWS = [")
    for r in _config_rows(sheet):
        name, cid, color, ical, sub = r
        lines.append(f"  ['{_js(name)}', '{_js(cid)}', '{color}', '{_js(ical)}', '{_js(sub)}'],")
    lines.append("];")

    path = os.path.join(APPS_SCRIPT, f"Committees.{sheet['id']}.gs")
    with open(path, "w", encoding="utf-8") as f:
        f.write("\n".join(lines) + "\n")
    print(f"  wrote {os.path.relpath(path, ROOT)}")


def _write_json(name, obj):
    os.makedirs(SITE_DATA, exist_ok=True)
    path = os.path.join(SITE_DATA, name)
    with open(path, "w", encoding="utf-8") as f:
        json.dump(obj, f, ensure_ascii=False, indent=2)
    print(f"  wrote {os.path.relpath(path, ROOT)}")


def write_site_config(committees, combined, settings):
    """Static config the live website reads (events load live from the browser)."""
    _write_json("committees.json", [
        {
            "key": t["key"],
            "name": t["name"],
            "section": t["section"],
            "color": t["color"],
            "calendar_id": t["calendar_id"],
            "subscribe_url": t["subscribe_url"],
            "ical_url": t["ical_url"],
        }
        for t in committees
    ])
    _write_json("combined.json", [
        {
            "sheet": c["sheet"],
            "name": c["name"],
            "color": c["color"],
            "calendar_id": c["calendar_id"],
            "subscribe_url": c["subscribe_url"],
            "ical_url": c["ical_url"],
        }
        for c in combined
    ])
    _write_json("settings.json", {
        "organization": settings["organization"],
        "google_api_key": settings["google_api_key"],
    })


def main():
    sheets = load_sheets()
    print(f"Generating config for {len(sheets)} sheets:")
    for sheet in sheets:
        print(f"  [{sheet['name']}] {len(sheet['tabs'])} tabs")
        write_config_csv(sheet)
        write_committees_gs(sheet)
    write_site_config(load_committees(), load_combined(), load_settings())
    print("Done. Paste each Committees.<sheet>.gs into the matching sheet's Apps "
          "Script; commit + push to update the live site.")


if __name__ == "__main__":
    main()
