# Spring Educational Services — Committee Calendar System

A near-zero-cost system where committee members add events to a **Google Sheet**,
events flow automatically into per-committee **public Google Calendars** (people
subscribe to the groups they want), and a **website + shareable monthly PNG/PDF
calendars** are generated automatically — per-committee and combined.

> **Key property:** only the Apps Script (inside the Sheet) ever *writes*, and it
> runs as your Google account — so there are **no API keys or secrets anywhere**.
> The website/renderer only *read public iCal feeds*, needing no credentials.

```
[Google Sheet]  ──AppsScript──►  [6 public Google Calendars]  ──.ics──►  [Python renderer]
  members add rows                people subscribe                         │
                                                                           ├─► site/data/*.json  → website (FullCalendar)
                                                                           └─► site/images/*     → shareable PNG/PDF
```

---

## Quick start (test locally first — no Google setup needed)

You can see the whole renderer + website working with **sample data** before doing
any Google setup:

```powershell
cd render
python -m pip install -r requirements.txt
python -m playwright install chromium      # only needed for PNG/PDF images
python build.py --sample                   # generates site/data/*.json + site/images/*

cd ..\site
python -m http.server 8000                 # open http://localhost:8000
```

Open `http://localhost:8000` for the interactive calendar and
`http://localhost:8000/subscribe.html` for the subscribe links page.

When you're ready for real data, do the Google setup below and run
`python build.py` (without `--sample`).

---

## Google setup (one time, manual)

### 1. Create the Google Sheet

**Fastest:** create a blank sheet, paste `apps-script/Code.gs` **and**
`apps-script/SetupSheet.gs` into Extensions → Apps Script, reload, then use the
**SES Calendar → Set up / repair sheet** menu — it builds all tabs, formatting,
the Repeat dropdown, protected columns, and sample rows automatically. See
[`sheet-templates/README.md`](sheet-templates/README.md) for that and a CSV-import
alternative.

The structure it creates (or that you build manually) — **one tab per committee**,
named exactly:

- `COLLEGE / UNIVERSITY (MEN)`
- `COLLEGE / UNIVERSITY (WOMEN)`
- `HIGH SCHOOL BOYS`
- `HIGH SCHOOL GIRLS`
- `MIDDLE SCHOOL BOYS`
- `MIDDLE SCHOOL GIRLS`

Each tab uses these headers in row 1 (members add events from row 2 down):

| A | B | C | D | E | F | G | H | I | J | K | L |
|---|---|---|---|---|---|---|---|---|---|---|---|
| Event Title | Start Date | Start Time | End Date | End Time | Location | Description | Repeat | Repeat Until | 🔒 Event ID | 🔒 Last Synced | 🔒 Status |

- **Required columns** (marked with `*`): **Event Title** and **Start Date**.
  Everything else is optional. If a row is started but a required cell is empty,
  that cell turns **red** so members can see what's missing.
- **Start Date / End Date / Repeat Until**: use the date picker (or `YYYY-MM-DD`).
- **End Date**: leave **blank for single-day events**; fill it in for **multi-day**
  events (e.g. a 3-day camp) — enter the actual last day.
- **Start/End Time**: e.g. `18:30`. Leave **Start Time blank** for an all-day event.
- **Repeat**: `None`, `Weekly`, or `Monthly`.
- **Columns J–L are auto-managed by the script — don't edit them.**

Add one more tab named `_Config` with headers:

| Committee | CalendarId | Color | iCalURL | SubscribeURL |
|-----------|-----------|-------|---------|--------------|

The **Committee** value in each row must match a committee tab name exactly.

### 2. Create the 6 public calendars
In [Google Calendar](https://calendar.google.com): for each committee, **+ → Create
new calendar**. Then open the calendar's **Settings**:
- Under *Access permissions*, tick **Make available to public** → *See all event details*.
- Copy the **Calendar ID** (Integrate calendar section) → paste into `_Config` → `CalendarId`.
- Copy the **Public address in iCal format** (the `...basic.ics` URL) → `_Config` → `iCalURL`.
- Build the **subscribe link** → `_Config` → `SubscribeURL`:
  `https://calendar.google.com/calendar/u/0/r?cid=<URL-ENCODED-CALENDAR-ID>`
- Pick a `Color` hex per committee (e.g. `#2563eb`).

### 2b. (Optional) The combined "SES – All Events" calendar
For a single calendar people can subscribe to instead of picking committees:
- Create a **7th public calendar** named **`SES – All Events`**.
- Paste its Calendar ID into [`committees.json`](committees.json) under
  `combined.calendar_id`, then run `python tools/gen_config.py`.
- The Apps Script **mirrors** every committee event into it on each timed sync (it
  can't be auto-merged by Google). The subscribe page shows an "Add all events"
  button once the ID is set.
- **Note:** subscribe to specific committees **or** to All Events — not both, or
  events appear twice (inherent to any combined calendar).

### 3. Install the sync script
In the Sheet: **Extensions → Apps Script**. Delete the default code, paste the
contents of [`apps-script/Code.gs`](apps-script/Code.gs), **Save**.

Run `setupTriggers` once (from the editor's Run menu) to install the every-10-min
timer + on-edit trigger. Approve the permission prompt (it runs as you).

**Test:** add a row to a committee tab → within ~10 min the event appears in that
committee's calendar and column I fills with an Event ID. To **remove** an event,
clear its row's cells (don't delete the row) — the next sync deletes the calendar
event. Editing a row updates the event in place (no duplicates).

### 4. Point the renderer at the real feeds
Put each committee's real `iCalURL` into [`render/config.py`](render/config.py)
(or wire it to read `_Config`). Then `python build.py` produces the live website
data and monthly images.

---

## Repo layout

```
apps-script/Code.gs          Sheet→Calendar idempotent sync (paste into bound script)
render/                      Python renderer (reads public .ics → JSON + PNG/PDF)
  config.py                  committees: key, name, color, iCal URL
  fetch.py                   fetch + parse + expand recurring events
  build.py                   emit JSON + render images   (--sample for fake data)
  calendarutil.py            month-grid helper
  templates/month.html.j2    Jinja2 monthly-grid template
  static/calendar.css        the calendar styling
  requirements.txt
site/                        static website (GitHub Pages root)
  index.html                 FullCalendar interactive view
  subscribe.html             per-committee subscribe links
  data/ images/              generated (created by build.py)
.github/workflows/build.yml  cron: render + deploy to GitHub Pages
```

## Updating the system (single source of truth)

All committee + calendar data lives in **one file: [`committees.json`](committees.json)**.
Per committee you only set `key`, `name`, `color`, and `calendar_id` — the iCal URL,
subscribe link, and sheet tab name are derived automatically.

**To add/rename a committee or paste a new Calendar ID:**
1. Edit [`committees.json`](committees.json).
2. Run `python tools/gen_config.py` — regenerates
   [`sheet-templates/_Config.csv`](sheet-templates/_Config.csv) and
   [`apps-script/Committees.gs`](apps-script/Committees.gs).
3. Import `_Config.csv` into the sheet's `_Config` tab (or paste the CalendarId
   column). If you added/renamed committees, also paste the new `Committees.gs`
   into Apps Script and run **SES Calendar → Set up / repair sheet**.
4. Run `python render/build.py` (CI does this automatically once pushed).

That's it — `config.py`, the website, and the images all read from the JSON, so
you never edit committee data in more than one place.

## Going live (GitHub Pages → custom domain)

1. Push this repo to GitHub.
2. Repo **Settings → Pages → Source: GitHub Actions**.
3. The workflow in `.github/workflows/build.yml` runs hourly (and on demand),
   rebuilds `site/data` + `site/images`, and deploys.
4. For your custom domain: add a `CNAME` file under `site/` with your domain and
   configure DNS per GitHub's instructions.
