# Spring Educational Services — Calendar System

A near-zero-cost system where committee members add events to **Google Sheets**,
events flow automatically into **public Google Calendars** (people subscribe to the
groups they want), and a **live website** shows everything with a **Boys / Girls /
General** switch — updating instantly, no build step.

```
[Boys Sheet]  ─┐
[Girls Sheet] ─┤ Apps Script ─► [public Google Calendars] ─live Google Calendar API─► [Website]
 members add   │  (per sheet)    8 group/general + 2 combined     Boys / Girls / General switch
```

- Two separate sheets so the **boys and girls committees work independently**.
- **Apps Script** (inside each sheet) is the only thing that *writes* — runs as your
  Google account, so **no write credentials anywhere**.
- **The website** is static and reads events **live** from the Google Calendar API
  in the browser — always current, no rebuild.

### Structure
- **Boys sheet (5 tabs):** Special Days, General Events, University Men,
  High School Boy, Middle School Boy. It **owns** the shared Special Days + General
  Events.
- **Girls sheet (3 tabs):** University Women, High School Girl, Middle School Girl.
- **Website switch:** **General** = every event from both sheets; **Boys** = boys'
  groups + Special Days + General Events; **Girls** = girls' groups + Special Days +
  General Events.
- Each sheet mirrors all its events into its own **SES – All Events Boys / Girls**
  calendar (for one-tap phone subscription).

---

## Setup (one time, manual)

### 1. Two Google Sheets
Create a **Boys** sheet and a **Girls** sheet (separate documents = separate editor
access). In **each**: **Extensions → Apps Script** → paste `apps-script/Code.gs`,
`apps-script/SetupSheet.gs`, and **that sheet's** `apps-script/Committees.boys.gs`
or `Committees.girls.gs` (rename the file to `Committees` in the editor). **Save**.
Reload the sheet → **SES Calendar → Set up / repair sheet** — it builds that sheet's
tabs. The Calendar IDs are baked into `Committees.gs` (`CONFIG_ROWS`) and read
directly by `Code.gs`, so there's **no `_Config` tab** to manage.

Each tab's columns:

| A | B | C | D | E | F | G | H | I | J | K | L |
|---|---|---|---|---|---|---|---|---|---|---|---|
| Event Title `*` | Start Date `*` | Start Time | End Date | End Time | Location | Description | Repeat | Repeat Until | 🔒 Status | 🔒 Last Synced | 🔒 Event ID *(hidden)* |

- **Required** (`*`): Event Title and Start Date. **End Date** blank = single-day.
  **Start Time** blank = all-day. **Repeat**: None / Weekly / Monthly.
- Columns J–L are auto-managed — don't edit. Event ID (L) is hidden from view.

### 2. Public calendars
Each tab syncs to a Google Calendar, plus two combined mirrors. All must be
**public** (Settings → Access permissions → *Make available to public*). The IDs are
already in [`committees.json`](committees.json); to change one, edit that file and
re-run the generator (see *Updating*).

### 3. Turn on the sync (in BOTH sheets)
In each sheet's Apps Script, run **`setupTriggers`** (or menu → **Install auto-sync
triggers**), approve the prompt. Installs the 10-min timer + on-edit sync, runs the
first sync, and mirrors into that sheet's **SES – All Events** calendar.

**Test:** add a row → within ~10 min it's in the Google Calendar (Status → green
"Synced") and on the website. To remove an event, clear its row's cells.

### 4. Website Google Calendar API key
The live site reads events via the Google Calendar API (read-only key):
1. [console.cloud.google.com](https://console.cloud.google.com) → new project →
   **Enable Google Calendar API**.
2. **Credentials → Create credentials → API key.**
3. **Restrict:** API restrictions → Google Calendar API only; Application
   restrictions → HTTP referrers → `https://springcalendar.github.io/*` (+ your
   domain).
4. Paste into [`committees.json`](committees.json) → `google_api_key`, run
   `python tools/gen_config.py`, commit + push.

> The key is **read-only and safe to expose** — it only reads your already-public
> calendars and is locked to your domain.

---

## Repo layout

```
committees.json              SINGLE SOURCE OF TRUTH (two sheets, tabs, sections, IDs, API key)
apps-script/
  Code.gs                    Sheet → Calendar sync + combined mirror (same in both sheets)
  SetupSheet.gs              sheet builder / repairer (same in both sheets)
  Committees.boys.gs         generated: Boys sheet's tabs + CONFIG_ROWS (calendar mapping)
  Committees.girls.gs        generated: Girls sheet's tabs + CONFIG_ROWS
render/committees.py         config loader (used by the generator)
tools/gen_config.py          committees.json → Committees.*.gs + site/data/*.json
site/                        the static website (GitHub Pages root)
  index.html                 live calendar with Boys/Girls/General switch
  subscribe.html             subscribe links, grouped by section
  data/                      generated config JSON (committees, combined, settings)
sheet-templates/             committee-template.csv (CSV import fallback)
.github/workflows/build.yml  publishes site/ to GitHub Pages on push
```

## Updating (single source of truth)

Everything lives in **[`committees.json`](committees.json)** — two `sheets`, each
with `tabs` (`key`, `name`, `tab`, `section`, `color`, `calendar_id`) and a
`combined` mirror, plus the top-level `google_api_key`. iCal + subscribe URLs and
tab names are derived.

**To change anything:**
1. Edit [`committees.json`](committees.json).
2. Run `python tools/gen_config.py` — regenerates `Committees.{boys,girls}.gs`
   and `site/data/*.json`.
3. If a sheet's tabs changed: paste its new `Committees.*.gs` into that sheet's
   Apps Script and run **Set up / repair sheet**.
4. `git add . && git commit -m "..." && git push` → the site redeploys.

`gen_config.py` is pure Python standard library — nothing to install.

## Deploy (GitHub Pages)

1. Push to GitHub → **Settings → Pages → Source: GitHub Actions.**
2. The workflow publishes `site/` on every push (no build). Live at
   `https://<user>.github.io/<repo>/`.
3. Custom domain: add a `CNAME` file under `site/` + configure DNS.
