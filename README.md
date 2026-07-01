# Spring Educational Services — Calendar System

A near-zero-cost system where committee members add events to a **Google Sheet**,
events flow automatically into per-group **public Google Calendars** (people
subscribe to the groups they want), and a **live website** shows everything —
updating instantly, with no build step.

```
[Google Sheet]  ──Apps Script──►  [7 public Google Calendars]  ──live Google Calendar API──►  [Website]
  members add rows                 (6 groups + "SES – All Events")        (browser reads events directly)
                                    people subscribe on their phones
```

Two moving parts, cleanly separated:
- **Apps Script** (inside the Sheet) is the *only* thing that writes — it runs as
  your Google account, so **no write credentials live anywhere**.
- **The website** is fully static and reads events **live** from the Google
  Calendar API in the browser, so it's always current and needs **no rebuild**.

---

## Google setup (one time, manual)

### 1. Create the Google Sheet
Create a blank sheet → **Extensions → Apps Script** → paste `apps-script/Code.gs`,
`apps-script/SetupSheet.gs`, and `apps-script/Committees.gs`, **Save**. Reload the
sheet → **SES Calendar → Set up / repair sheet**. It builds one tab per group
(names, formatting, date pickers, required-field markers) and fills the `_Config`
tab with your Calendar IDs automatically.

Each group tab's columns:

| A | B | C | D | E | F | G | H | I | J | K | L |
|---|---|---|---|---|---|---|---|---|---|---|---|
| Event Title `*` | Start Date `*` | Start Time | End Date | End Time | Location | Description | Repeat | Repeat Until | 🔒 Event ID | 🔒 Last Synced | 🔒 Status |

- **Required** (`*`): Event Title and Start Date. Empty required cells turn red.
- **End Date**: blank = single-day; fill it in for multi-day events (e.g. a 3-day camp).
- **Start Time** blank = all-day event. **Repeat**: None / Weekly / Monthly.
- Columns J–L are auto-managed — don't edit.

### 2. Create the public calendars
In [Google Calendar](https://calendar.google.com), create one calendar per group
plus a 7th named **`SES – All Events`**. For each: **Settings → Access permissions
→ Make available to public → See all event details**, then copy its **Calendar ID**
(Integrate calendar section).

Put each Calendar ID into [`committees.json`](committees.json) and run
`python tools/gen_config.py` (see *Updating* below). That's the single source of
truth — it feeds the sheet's `_Config`, the Apps Script, and the website.

### 3. Turn on the sync
In Apps Script, run **`setupTriggers`** once (or menu → **Install auto-sync
triggers**), approve the permission prompt. This installs the every-10-min timer +
on-edit sync and runs the first sync. It also mirrors every event into
**SES – All Events**.

**Test:** add a row to a group tab → within ~10 min it appears in that group's
Google Calendar, the Status cell turns green "Synced", and it shows on the website.
To remove an event, clear its row's cells (don't delete the row).

### 4. Create the website's Google Calendar API key
The live website reads events through the Google Calendar API, which needs a public
(read-only) API key:
1. [console.cloud.google.com](https://console.cloud.google.com) → new project.
2. **APIs & Services → Enable APIs → Google Calendar API → Enable.**
3. **Credentials → Create credentials → API key.**
4. **Restrict the key:** *API restrictions* → Google Calendar API only;
   *Application restrictions* → HTTP referrers → add your site
   (`https://springcalendar.github.io/*` and your custom domain).
5. Paste the key into [`committees.json`](committees.json) → `google_api_key`, run
   `python tools/gen_config.py`, commit + push.

> This key is **read-only and safe to expose** in a public site — it only lets the
> browser *read* your already-public calendars, and it's locked to your domain.

---

## Repo layout

```
committees.json              SINGLE SOURCE OF TRUTH (group names, colors, calendar IDs, API key)
apps-script/
  Code.gs                    Sheet → Calendar sync + combined-calendar mirror
  SetupSheet.gs              one-click sheet builder / repairer
  Committees.gs              generated: group list + _Config rows
render/committees.py         config loader (used by the generator)
tools/gen_config.py          committees.json → _Config.csv, Committees.gs, site/data/*.json
site/                        the static website (GitHub Pages root)
  index.html                 live FullCalendar view (Google Calendar API)
  subscribe.html             per-group + All-Events subscribe links
  assets/                    logo + CSS
  data/                      generated config JSON (committees, combined, settings)
.github/workflows/build.yml  publishes site/ to GitHub Pages on push
sheet-templates/             _Config.csv + CSV import fallback
```

## Updating (single source of truth)

All group + calendar data lives in **[`committees.json`](committees.json)** — per
group just `key`, `name`, `color`, `calendar_id` (plus the top-level
`google_api_key`). Everything else is derived.

**To change a group, a Calendar ID, or the API key:**
1. Edit [`committees.json`](committees.json).
2. Run `python tools/gen_config.py` — regenerates `_Config.csv`, `Committees.gs`,
   and `site/data/{committees,combined,settings}.json`.
3. If group data changed: paste the new `Committees.gs` into Apps Script and run
   **Set up / repair sheet** (writes the new `_Config`).
4. `git add . && git commit -m "..." && git push` → the site redeploys.

`gen_config.py` is pure Python standard library — no dependencies to install.

## Deploy (GitHub Pages)

1. Push to GitHub.
2. **Settings → Pages → Source: GitHub Actions.**
3. The workflow publishes `site/` on every push (no build — the site is static and
   loads events live). Live at `https://<user>.github.io/<repo>/`.
4. Custom domain: add a `CNAME` file under `site/` with your domain + configure DNS.
