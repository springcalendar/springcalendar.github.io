"""Month-grid helper: turn a list of normalized events into weeks of days."""

import calendar as _cal
from collections import defaultdict
from datetime import date, timedelta

MONTH_NAMES = [
    "", "January", "February", "March", "April", "May", "June",
    "July", "August", "September", "October", "November", "December",
]


def _parse_day(iso):
    return date(int(iso[0:4]), int(iso[5:7]), int(iso[8:10]))


def event_days(ev):
    """Every calendar day an event covers (multi-day events span several)."""
    start = _parse_day(ev["start"])
    end_iso = ev.get("end")
    if not end_iso:
        return [start]
    last = _parse_day(end_iso)
    if ev.get("all_day"):
        last = last - timedelta(days=1)  # iCal all-day end is exclusive
    if last < start:
        last = start
    days, d = [], start
    while d <= last and len(days) < 60:  # cap guards against bad data
        days.append(d)
        d += timedelta(days=1)
    return days


def events_by_day(events):
    """Group events by each date they cover (YYYY-MM-DD key)."""
    grouped = defaultdict(list)
    for ev in events:
        for d in event_days(ev):
            grouped[d.strftime("%Y-%m-%d")].append(ev)
    for day in grouped.values():
        # all-day/multi-day first, then by start time
        day.sort(key=lambda e: (not e["all_day"], e["start"]))
    return grouped


def build_month_grid(year, month, events):
    """Return weeks: list of weeks, each a list of 7 day dicts.

    day dict = {"date": date, "day": int, "in_month": bool, "events": [...]}.
    Weeks start on Sunday to match common US calendars.
    """
    grouped = events_by_day(events)
    cal = _cal.Calendar(firstweekday=6)  # 6 = Sunday
    weeks = []
    for week in cal.monthdatescalendar(year, month):
        days = []
        for d in week:
            key = d.strftime("%Y-%m-%d")
            days.append({
                "date": d,
                "day": d.day,
                "in_month": d.month == month,
                "is_today": d == date.today(),
                "events": grouped.get(key, []),
            })
        weeks.append(days)
    return weeks


def month_label(year, month):
    return f"{MONTH_NAMES[month]} {year}"
