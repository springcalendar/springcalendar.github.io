# Google Sheet templates

Two ways to create the committee workbook. **Option A is recommended** — it builds
everything (tabs, formatting, dropdowns, protected columns, sample rows) in one click.

## Option A — one-click builder (recommended)

1. Create a new blank Google Sheet (sheets.new).
2. **Extensions → Apps Script**. Paste **both** [`../apps-script/Code.gs`](../apps-script/Code.gs)
   and [`../apps-script/SetupSheet.gs`](../apps-script/SetupSheet.gs) into the project
   (use the **+** to add a second script file). Save.
3. Reload the Sheet. A new **"SES Calendar"** menu appears →
   **Set up / repair sheet**. Approve the permission prompt.
4. Done — all 6 committee tabs + `_Config` are built and formatted.
   Then use the same menu → **Install auto-sync triggers** once.

Re-running "Set up / repair sheet" is safe — it only adds what's missing.

## Option B — manual CSV import

1. Create a new Google Sheet.
2. For each committee: **File → Import → Upload** [`committee-template.csv`](committee-template.csv)
   → **Insert new sheet(s)** → rename the tab to the committee name (exact names below).
   Repeat 6 times.
3. Import [`_Config.csv`](_Config.csv) the same way; rename that tab to `_Config`.
4. Delete the empty default `Sheet1`.

> CSV import does **not** carry formatting, the Repeat dropdown, or column
> protection — Option A does. After a CSV import you can still run the Apps Script
> "Set up / repair sheet" to apply all of that on top.

### Exact committee tab names
- `COLLEGE / UNIVERSITY (MEN)`
- `COLLEGE / UNIVERSITY (WOMEN)`
- `HIGH SCHOOL BOYS`
- `HIGH SCHOOL GIRLS`
- `MIDDLE SCHOOL BOYS`
- `MIDDLE SCHOOL GIRLS`

### Columns
| A | B | C | D | E | F | G | H | I | J | K | L |
|---|---|---|---|---|---|---|---|---|---|---|---|
| Event Title | Start Date | Start Time | End Date | End Time | Location | Description | Repeat | Repeat Until | 🔒 Event ID | 🔒 Last Synced | 🔒 Status |

- Leave **Start Time blank** for an all-day event.
- Leave **End Date blank** for single-day events; fill it in for **multi-day**
  events (e.g. a 3-day camp) — enter the actual last day.
- **Repeat** = `None` / `Weekly` / `Monthly`; set **Repeat Until** for repeating events.
- **Columns J–L are filled automatically by the sync script — don't edit them.**
- To **remove** an event, clear its row's cells (don't delete the whole row).
