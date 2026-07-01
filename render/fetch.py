"""Fetch + parse public iCal feeds into normalized event dicts.

No credentials needed — the committee calendars are public, so this is a plain
HTTP GET of each `.ics` URL. Recurring events are expanded into individual
occurrences within the requested window.

A normalized event is:
    {
        "title": str,
        "start": "YYYY-MM-DDTHH:MM:SS" or "YYYY-MM-DD" (all-day),
        "end":   same format or None,
        "all_day": bool,
        "location": str,
        "description": str,
        "committee": <committee key>,
    }
"""

from datetime import date, datetime, time

import requests

try:
    import icalendar
    import recurring_ical_events
    _ICAL_OK = True
except ImportError:  # allow --sample to work without the parsing libs installed
    _ICAL_OK = False


def fetch_committee_events(committee, window_start, window_end, timeout=30):
    """Return normalized events for one committee within [start, end] (dates)."""
    url = committee.get("ical_url")
    if not url:
        return []
    if not _ICAL_OK:
        raise RuntimeError(
            "icalendar/recurring_ical_events not installed — run "
            "`pip install -r requirements.txt` (or use --sample)."
        )

    resp = requests.get(url, timeout=timeout)
    resp.raise_for_status()
    cal = icalendar.Calendar.from_ical(resp.content)

    occurrences = recurring_ical_events.of(cal).between(window_start, window_end)
    events = []
    for comp in occurrences:
        events.append(_normalize(comp, committee["key"]))
    events.sort(key=lambda e: e["start"])
    return events


def _normalize(comp, committee_key):
    dtstart = comp.get("DTSTART").dt
    dtend_prop = comp.get("DTEND")
    dtend = dtend_prop.dt if dtend_prop is not None else None

    all_day = isinstance(dtstart, date) and not isinstance(dtstart, datetime)

    return {
        "title": str(comp.get("SUMMARY", "")).strip(),
        "start": _iso(dtstart),
        "end": _iso(dtend) if dtend is not None else None,
        "all_day": all_day,
        "location": str(comp.get("LOCATION", "")).strip(),
        "description": str(comp.get("DESCRIPTION", "")).strip(),
        "committee": committee_key,
    }


def _iso(value):
    """Serialize a date or datetime to ISO string (naive, local)."""
    if isinstance(value, datetime):
        return value.replace(tzinfo=None).strftime("%Y-%m-%dT%H:%M:%S")
    if isinstance(value, date):
        return value.strftime("%Y-%m-%d")
    if isinstance(value, time):
        return value.strftime("%H:%M:%S")
    return str(value)
