"""Regenerate derived config from the single source of truth (committees.json).

Run after editing committees.json:

    python tools/gen_config.py

It rewrites:
  - sheet-templates/_Config.csv   -> import into the Google Sheet's _Config tab
  - apps-script/Committees.gs     -> paste into the Apps Script project (tab list)

Nothing here needs credentials; it's pure text generation.
"""

import csv
import os
import sys

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
sys.path.insert(0, os.path.join(ROOT, "render"))

from committees import load_committees, load_combined  # noqa: E402

CONFIG_CSV = os.path.join(ROOT, "sheet-templates", "_Config.csv")
COMMITTEES_GS = os.path.join(ROOT, "apps-script", "Committees.gs")


def write_config_csv(committees, combined):
    os.makedirs(os.path.dirname(CONFIG_CSV), exist_ok=True)
    with open(CONFIG_CSV, "w", newline="", encoding="utf-8") as f:
        w = csv.writer(f)
        w.writerow(["Committee", "CalendarId", "Color", "iCalURL", "SubscribeURL"])
        for c in committees:
            w.writerow([c["tab"], c["calendar_id"], c["color"],
                        c["ical_url"], c["subscribe_url"]])
        if combined:
            # The combined "SES – All Events" calendar. Apps Script reads this row
            # to know where to mirror every event; it has no committee tab.
            w.writerow([combined["name"], combined["calendar_id"], combined["color"],
                        combined["ical_url"], combined["subscribe_url"]])
    print(f"  wrote {os.path.relpath(CONFIG_CSV, ROOT)}")


def _js(s):
    """Escape a Python string for a single-quoted JS literal."""
    return str(s).replace("\\", "\\\\").replace("'", "\\'")


def write_committees_gs(committees, combined):
    lines = [
        "/**",
        " * AUTO-GENERATED from committees.json by tools/gen_config.py.",
        " * Do not edit by hand — re-run the generator instead.",
        " * COMMITTEE_TABS: names+colors for building tabs.",
        " * CONFIG_ROWS: full _Config rows (name, calendarId, color, iCal, subscribe),",
        " *   written into the _Config tab by SetupSheet.gs so the Calendar IDs are baked in.",
        " */",
        "var COMMITTEE_TABS = [",
    ]
    for c in committees:
        lines.append(f"  {{ name: '{_js(c['tab'])}', color: '{c['color']}' }},")
    lines.append("];")
    lines.append("")
    lines.append("var CONFIG_ROWS = [")

    def row(name, cid, color, ical, sub):
        return (f"  ['{_js(name)}', '{_js(cid)}', '{color}', "
                f"'{_js(ical)}', '{_js(sub)}'],")

    for c in committees:
        lines.append(row(c["tab"], c["calendar_id"], c["color"],
                         c["ical_url"], c["subscribe_url"]))
    if combined:
        lines.append(row(combined["name"], combined["calendar_id"], combined["color"],
                         combined["ical_url"], combined["subscribe_url"]))
    lines.append("];")

    with open(COMMITTEES_GS, "w", encoding="utf-8") as f:
        f.write("\n".join(lines) + "\n")
    print(f"  wrote {os.path.relpath(COMMITTEES_GS, ROOT)}")


def main():
    committees = load_committees()
    combined = load_combined()
    print(f"Generating config for {len(committees)} committees"
          + (" + combined calendar:" if combined else ":"))
    write_config_csv(committees, combined)
    write_committees_gs(committees, combined)
    print("Done. Next: import _Config.csv into the sheet (or paste the CalendarId "
          "column), and re-run python render/build.py.")


if __name__ == "__main__":
    main()
