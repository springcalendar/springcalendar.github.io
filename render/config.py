"""Committee config for the renderer + website.

The data now lives in ONE place — ../committees.json (the single source of truth).
This module just loads it. To change committees or calendar IDs, edit that JSON
file, then run `python tools/gen_config.py` and `python render/build.py`.

Each loaded committee dict has: key, name, color, calendar_id, tab, ical_url,
subscribe_url (the last three are auto-derived).
"""

from committees import load_committees

COMMITTEES = load_committees()


def by_key(key):
    for c in COMMITTEES:
        if c["key"] == key:
            return c
    raise KeyError(key)
