"""Loader for the single source of truth (../committees.json).

The workbook is split into two sheets (boys, girls). Each sheet has a `combined`
mirror calendar and a list of `tabs`; each tab provides key, name, tab (sheet tab
name), section (general|boys|girls), color, calendar_id. Everything else — iCal
URL, subscribe link — is derived here so no value is duplicated.

Consumers:
- tools/gen_config.py: per-sheet _Config.*.csv + Committees.*.gs, and the website
  config in site/data/*.json.
"""

import json
import os
import urllib.parse

_ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
COMMITTEES_JSON = os.path.join(_ROOT, "committees.json")


def derive_ical_url(calendar_id):
    if not calendar_id:
        return ""
    enc = urllib.parse.quote(calendar_id, safe="")
    return f"https://calendar.google.com/calendar/ical/{enc}/public/basic.ics"


def derive_subscribe_url(calendar_id):
    if not calendar_id:
        return ""
    return f"https://calendar.google.com/calendar/u/0/r?cid={calendar_id}"


def _expand_tab(t):
    cid = t.get("calendar_id", "").strip()
    return {
        "key": t["key"],
        "name": t["name"],
        "tab": t.get("tab", t["name"]),
        "section": t.get("section", "general"),
        "color": t["color"],
        "calendar_id": cid,
        "ical_url": derive_ical_url(cid),
        "subscribe_url": derive_subscribe_url(cid),
    }


def _expand_combined(c):
    cid = c.get("calendar_id", "").strip()
    return {
        "name": c["name"],
        "color": c.get("color", "#0f172a"),
        "calendar_id": cid,
        "ical_url": derive_ical_url(cid),
        "subscribe_url": derive_subscribe_url(cid),
    }


def _load(path):
    with open(path, encoding="utf-8") as f:
        return json.load(f)


def load_sheets(path=COMMITTEES_JSON):
    """Return per-sheet structure: [{id, name, combined, tabs:[expanded]}]."""
    data = _load(path)
    sheets = []
    for s in data["sheets"]:
        sheets.append({
            "id": s["id"],
            "name": s["name"],
            "combined": _expand_combined(s["combined"]),
            "tabs": [_expand_tab(t) for t in s["tabs"]],
        })
    return sheets


def load_committees(path=COMMITTEES_JSON):
    """Flat list of every tab across both sheets (for the website)."""
    out = []
    for s in load_sheets(path):
        out.extend(s["tabs"])
    return out


def load_combined(path=COMMITTEES_JSON):
    """The combined mirror calendars, one per sheet (Boys, Girls)."""
    return [{"sheet": s["id"], **s["combined"]} for s in load_sheets(path)]


def load_extra_calendars(path=COMMITTEES_JSON):
    """Website-only display calendars (e.g. US Holidays) — not synced from a sheet."""
    data = _load(path)
    out = []
    for e in data.get("extra_calendars", []):
        cid = e.get("calendar_id", "").strip()
        out.append({
            "key": e["key"],
            "name": e["name"],
            "section": e.get("section", "general"),
            "color": e["color"],
            "calendar_id": cid,
            "ical_url": derive_ical_url(cid),
            "subscribe_url": derive_subscribe_url(cid),
            "display_only": True,
        })
    return out


def load_settings(path=COMMITTEES_JSON):
    data = _load(path)
    return {
        "organization": data.get("organization", ""),
        "google_api_key": data.get("google_api_key", ""),
        # Which sections the website publishes. Unpublished sections stay fully
        # configured and keep syncing — they're just hidden from the site.
        "published_sections": data.get("published_sections",
                                       ["general", "boys", "girls"]),
    }
