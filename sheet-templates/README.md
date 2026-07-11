# Google Sheet templates

There are **two** workbooks — a **Boys** sheet and a **Girls** sheet. Build each
with the one-click Apps Script builder (recommended); the CSVs are a fallback.

## Option A — one-click builder (recommended)

For **each** sheet (Boys, then Girls):
1. Create a new blank Google Sheet (sheets.new).
2. **Extensions → Apps Script.** Add three files:
   [`../apps-script/Code.gs`](../apps-script/Code.gs),
   [`../apps-script/SetupSheet.gs`](../apps-script/SetupSheet.gs), and the matching
   **`Committees.boys.gs`** or **`Committees.girls.gs`** (paste it into a file named
   `Committees`). Save.
3. Reload the Sheet → **SES Calendar → Set up / repair sheet**. Approve the prompt.
   It builds that sheet's tabs + `_Config` (with Calendar IDs baked in).
4. Same menu → **Install auto-sync triggers** once.

Re-running "Set up / repair sheet" is safe — it only adds/repairs what's needed.

## Option B — manual CSV import
Import [`committee-template.csv`](committee-template.csv) for each group tab
(rename to the tab names below). CSV import doesn't carry formatting/dropdowns/
protection — run "Set up / repair sheet" afterward to apply them.

> There is **no `_Config` tab** — the Calendar IDs are baked into `Committees.gs`
> (`CONFIG_ROWS`) and read directly by `Code.gs`.

### Tab names
**Boys sheet:** `Special Days`, `General Events`, `University Men`,
`High School Boy`, `Middle School Boy`
**Girls sheet:** `University Women`, `High School Girl`, `Middle School Girl`

### Columns
| A | B | C | D | E | F | G | H | I | J | K | L |
|---|---|---|---|---|---|---|---|---|---|---|---|
| Event Title | Start Date | Start Time | End Date | End Time | Location | Description | Repeat | Repeat Until | 🔒 Status | 🔒 Last Synced | 🔒 Event ID *(hidden)* |

- Leave **Start Time blank** for an all-day event.
- Leave **End Date blank** for single-day; fill it in for multi-day events.
- **Repeat** = `None` / `Weekly` / `Monthly`; set **Repeat Until** for repeating events.
- **Columns J–L are auto-managed — don't edit them.** Event ID (L) is hidden.
- To **remove** an event, clear its row's cells (don't delete the whole row).
