"""Build step: fetch events -> write website JSON + render monthly PNG/PDF.

Usage:
    python build.py                 # current month, real iCal feeds from config
    python build.py --month 2026-07 # specific month
    python build.py --sample        # fake data (no Google setup needed)
    python build.py --no-images     # skip PNG/PDF (skip Playwright)

Outputs into ../site/:
    data/committees.json        committee metadata (key, name, color, links)
    data/<key>.json             FullCalendar events for one committee (broad window)
    data/all.json               all committees combined
    images/<key>-<YYYY-MM>.png  per-committee monthly calendar (+ .pdf)
    images/all-<YYYY-MM>.png    combined monthly calendar (+ .pdf)
"""

import argparse
import base64
import json
import os
from datetime import date, datetime, timedelta

from config import COMMITTEES
from committees import load_combined
import calendarutil
import fetch as fetch_mod

ROOT = os.path.dirname(os.path.abspath(__file__))
SITE = os.path.normpath(os.path.join(ROOT, "..", "site"))
DATA_DIR = os.path.join(SITE, "data")
IMAGES_DIR = os.path.join(SITE, "images")
TEMPLATES_DIR = os.path.join(ROOT, "templates")
CSS_PATH = os.path.join(ROOT, "static", "calendar.css")

# Website data window: a few months back, several ahead.
WINDOW_BACK_DAYS = 60
WINDOW_FWD_DAYS = 270


def main():
    args = parse_args()
    year, month = parse_month(args.month)

    os.makedirs(DATA_DIR, exist_ok=True)
    os.makedirs(IMAGES_DIR, exist_ok=True)

    window_start = date.today() - timedelta(days=WINDOW_BACK_DAYS)
    window_end = date.today() + timedelta(days=WINDOW_FWD_DAYS)

    # 1. Collect events per committee.
    per_committee = {}
    for committee in COMMITTEES:
        if args.sample:
            events = sample_events(committee, year, month)
        else:
            events = fetch_mod.fetch_committee_events(committee, window_start, window_end)
        per_committee[committee["key"]] = events
        print(f"  {committee['name']}: {len(events)} events")

    # 2. Write website JSON (FullCalendar format).
    write_committees_json()
    all_events = []
    for committee in COMMITTEES:
        events = per_committee[committee["key"]]
        fc = [to_fullcalendar(e, committee) for e in events]
        write_json(os.path.join(DATA_DIR, f"{committee['key']}.json"), fc)
        all_events.extend(fc)
    write_json(os.path.join(DATA_DIR, "all.json"), all_events)
    print(f"Wrote JSON for {len(COMMITTEES)} committees + combined to {DATA_DIR}")

    # 3. Render images.
    if args.no_images:
        print("Skipping images (--no-images).")
        return
    render_images(year, month, per_committee)


# ---------------------------------------------------------------------------
# JSON output
# ---------------------------------------------------------------------------

def to_fullcalendar(ev, committee):
    return {
        "title": ev["title"],
        "start": ev["start"],
        "end": ev["end"],
        "allDay": ev["all_day"],
        "color": committee["color"],
        "extendedProps": {
            "committee": committee["key"],
            "committeeName": committee["name"],
            "location": ev.get("location", ""),
            "description": ev.get("description", ""),
        },
    }


def write_committees_json():
    meta = [
        {
            "key": c["key"],
            "name": c["name"],
            "color": c["color"],
            "subscribe_url": c.get("subscribe_url", ""),
            "ical_url": c.get("ical_url", ""),
        }
        for c in COMMITTEES
    ]
    write_json(os.path.join(DATA_DIR, "committees.json"), meta)

    # Combined "SES – All Events" calendar (subscribe-only; empty URL until the
    # 7th calendar's ID is set in committees.json). Kept in its own file so the
    # committees.json array shape stays unchanged.
    combined = load_combined() or {}
    write_json(os.path.join(DATA_DIR, "combined.json"), {
        "name": combined.get("name", "SES – All Events"),
        "color": combined.get("color", "#0f172a"),
        "subscribe_url": combined.get("subscribe_url", ""),
        "ical_url": combined.get("ical_url", ""),
    })


def write_json(path, obj):
    with open(path, "w", encoding="utf-8") as f:
        json.dump(obj, f, ensure_ascii=False, indent=2)


# ---------------------------------------------------------------------------
# Image rendering (HTML template -> Playwright -> PNG + PDF)
# ---------------------------------------------------------------------------

def render_images(year, month, per_committee):
    try:
        from jinja2 import Environment, FileSystemLoader, select_autoescape
        from playwright.sync_api import sync_playwright
    except ImportError as exc:
        print(f"Skipping images — missing dependency: {exc}")
        print("  Install with: pip install -r requirements.txt && python -m playwright install chromium")
        return

    env = Environment(
        loader=FileSystemLoader(TEMPLATES_DIR),
        autoescape=select_autoescape(["html"]),
    )
    template = env.get_template("month.html.j2")
    with open(CSS_PATH, encoding="utf-8") as f:
        css = f.read()
    logo_uri = _logo_data_uri()

    label = calendarutil.month_label(year, month)
    stamp = f"{year:04d}-{month:02d}"

    jobs = []  # (filename_stem, html)
    for committee in COMMITTEES:
        events = [e for e in per_committee[committee["key"]] if in_month(e, year, month)]
        weeks = calendarutil.build_month_grid(year, month, events)
        html = template.render(
            css=css,
            logo_uri=logo_uri,
            title=committee["name"],
            subtitle="Spring Educational Services",
            month_label=label,
            weeks=weeks,
            legend=None,
            accent=committee["color"],
            max_per_day=4,
        )
        jobs.append((f"{committee['key']}-{stamp}", html))

    # Combined calendar (all committees, color-coded).
    combined = []
    for committee in COMMITTEES:
        for e in per_committee[committee["key"]]:
            if in_month(e, year, month):
                ce = dict(e)
                ce["color"] = committee["color"]
                combined.append(ce)
    weeks = calendarutil.build_month_grid(year, month, combined)
    html = template.render(
        css=css,
        logo_uri=logo_uri,
        title="All Groups",
        subtitle="Spring Educational Services",
        month_label=label,
        weeks=weeks,
        legend=[{"name": c["name"], "color": c["color"]} for c in COMMITTEES],
        accent="#0f172a",
        max_per_day=5,
    )
    jobs.append((f"all-{stamp}", html))

    with sync_playwright() as p:
        browser = p.chromium.launch()
        page = browser.new_page(viewport={"width": 1400, "height": 1000})
        for stem, html in jobs:
            page.set_content(html, wait_until="networkidle")
            element = page.locator(".calendar-page")
            png_path = os.path.join(IMAGES_DIR, f"{stem}.png")
            pdf_path = os.path.join(IMAGES_DIR, f"{stem}.pdf")
            element.screenshot(path=png_path)
            page.pdf(path=pdf_path, print_background=True,
                     width="1400px", height="1000px")
            print(f"  rendered {stem}.png / .pdf")
        browser.close()


def _logo_data_uri():
    """Embed the SES badge as a base64 data URI (Playwright set_content has no base URL)."""
    path = os.path.join(SITE, "assets", "SES_icon.png")
    if not os.path.exists(path):
        return ""
    with open(path, "rb") as f:
        b64 = base64.b64encode(f.read()).decode("ascii")
    return "data:image/png;base64," + b64


def in_month(ev, year, month):
    d = ev["start"][:10]
    return d[:7] == f"{year:04d}-{month:02d}"


# ---------------------------------------------------------------------------
# Sample data (for local testing before Google setup)
# ---------------------------------------------------------------------------

def sample_events(committee, year, month):
    """Deterministic fake events spread across the month, varying per committee."""
    key = committee["key"]
    seed = sum(ord(ch) for ch in key)
    titles = [
        "Weekly Study Circle", "Guest Speaker Night", "Community Service Day",
        "Sports & Recreation", "Mentorship Session", "Monthly Social",
        "Workshop", "Volunteer Drive",
    ]
    locations = ["Main Hall", "Room 204", "City Park", "Community Center", "Online"]
    events = []
    for i in range(6):
        day = ((seed + i * 4) % 26) + 1
        d = date(year, month, day)
        title = titles[(seed + i) % len(titles)]
        hour = 9 + ((seed + i * 3) % 9)
        all_day = (i % 5 == 0)
        if all_day:
            start = d.strftime("%Y-%m-%d")
            end = None
        else:
            start = datetime(year, month, day, hour, 0).strftime("%Y-%m-%dT%H:%M:%S")
            end = datetime(year, month, day, hour + 1, 30).strftime("%Y-%m-%dT%H:%M:%S")
        events.append({
            "title": title,
            "start": start,
            "end": end,
            "all_day": all_day,
            "location": locations[(seed + i) % len(locations)],
            "description": f"Sample event for {committee['name']}.",
            "committee": key,
        })

    # A multi-day example (camp) to showcase spanning across days.
    camp_start = date(year, month, ((seed + 2) % 18) + 5)
    camp_end_excl = camp_start + timedelta(days=3)  # 3-day camp, all-day end is exclusive
    events.append({
        "title": "Annual Camp",
        "start": camp_start.strftime("%Y-%m-%d"),
        "end": camp_end_excl.strftime("%Y-%m-%d"),
        "all_day": True,
        "location": "Retreat Center",
        "description": f"3-day overnight camp for {committee['name']}.",
        "committee": key,
    })

    events.sort(key=lambda e: e["start"])
    return events


# ---------------------------------------------------------------------------
# Args
# ---------------------------------------------------------------------------

def parse_args():
    ap = argparse.ArgumentParser(description="Build committee calendars.")
    ap.add_argument("--month", help="Target month YYYY-MM (default: current).")
    ap.add_argument("--sample", action="store_true", help="Use fake data.")
    ap.add_argument("--no-images", action="store_true", help="Skip PNG/PDF rendering.")
    return ap.parse_args()


def parse_month(value):
    if not value:
        today = date.today()
        return today.year, today.month
    dt = datetime.strptime(value, "%Y-%m")
    return dt.year, dt.month


if __name__ == "__main__":
    main()
