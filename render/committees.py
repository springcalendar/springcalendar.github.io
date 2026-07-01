"""Loader for the single source of truth (../committees.json).

Per committee the JSON provides only: key, name, color, calendar_id.
This module derives everything else so no value is ever duplicated:

    tab           = name.upper()                 (the Google Sheet tab name)
    ical_url      = public .ics feed for the calendar (renderer's data source)
    subscribe_url = one-click "Add to Google Calendar" link

Both render/config.py and tools/gen_config.py import from here, so the derivation
lives in exactly one place.
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


def derive_tab(name):
    # The sheet tab name matches the display name (Title Case) as-is.
    return name


def load_committees(path=COMMITTEES_JSON):
    """Return a list of fully-expanded committee dicts."""
    with open(path, encoding="utf-8") as f:
        data = json.load(f)

    committees = []
    for c in data["committees"]:
        cid = c.get("calendar_id", "").strip()
        committees.append({
            "key": c["key"],
            "name": c["name"],
            "color": c["color"],
            "calendar_id": cid,
            "tab": derive_tab(c["name"]),
            "ical_url": derive_ical_url(cid),
            "subscribe_url": derive_subscribe_url(cid),
        })
    return committees


def load_combined(path=COMMITTEES_JSON):
    """Return the combined 'SES – All Events' calendar dict, or None if not defined.

    Like committees, only name/color/calendar_id are stored; the iCal + subscribe
    URLs are derived. `calendar_id` may be blank until the 7th calendar exists.
    """
    with open(path, encoding="utf-8") as f:
        data = json.load(f)
    c = data.get("combined")
    if not c:
        return None
    cid = c.get("calendar_id", "").strip()
    return {
        "name": c["name"],
        "color": c.get("color", "#0f172a"),
        "calendar_id": cid,
        "ical_url": derive_ical_url(cid),
        "subscribe_url": derive_subscribe_url(cid),
    }


def load_settings(path=COMMITTEES_JSON):
    """Site-wide settings for the live website (e.g. the Google Calendar API key)."""
    with open(path, encoding="utf-8") as f:
        data = json.load(f)
    return {
        "organization": data.get("organization", ""),
        "google_api_key": data.get("google_api_key", ""),
    }


def load_meta(path=COMMITTEES_JSON):
    with open(path, encoding="utf-8") as f:
        data = json.load(f)
    return {"organization": data.get("organization", "")}
