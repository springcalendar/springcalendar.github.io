/**
 * Spring Educational Services — one-click sheet builder.
 *
 * Paste this into the SAME Apps Script project as Code.gs, save, then either:
 *   - reload the Sheet and use the "SES Calendar" menu → "Set up / repair sheet", or
 *   - run `setupSheet` once from the editor.
 *
 * Safe to re-run: it creates only what's missing and never deletes your events.
 *
 * The committee list (COMMITTEE_TABS) lives in Committees.gs, which is generated
 * from committees.json by tools/gen_config.py — the single source of truth.
 */

// A trailing " *" marks a required column (Event Title and Start Date).
// Auto columns are last: Status, Last Synced, then Event ID (hidden).
var HEADERS = [
  'Event Title *', 'Start Date *', 'Start Time', 'End Date', 'End Time', 'Location',
  'Description', 'Repeat', 'Repeat Until', '🔒 Status', '🔒 Last Synced', '🔒 Event ID'
];

// How many rows get the live formatting/validation. Keep this modest — applying
// date pickers, dropdowns, banding and conditional formatting to thousands of
// rows makes the sheet sluggish. Re-run "Set up / repair sheet" to extend later.
var STYLED_ROWS = 300;

// Columns: Title, Start Date, Start Time, End Date, End Time, Location,
//          Description, Repeat, Repeat Until, [3 auto].
var SAMPLE_ROWS = [
  ['Weekly Study Circle', '2026-07-07', '6:30 PM', '', '8:00 PM', 'Main Hall',
   'Bring your notebooks.', 'Weekly', '2026-08-25', '', '', ''],
  ['Guest Speaker Night', '2026-07-15', '7:00 PM', '', '8:30 PM', 'Room 204',
   'Special guest TBA.', 'None', '', '', '', ''],
  ['Community Service Day', '2026-07-22', '', '', '', 'City Park',
   'All-day event — leave Start Time blank for all-day.', 'None', '', '', '', ''],
  ['Summer Camp', '2026-08-03', '', '2026-08-05', '', 'Mountain Retreat',
   '3-day camp — fill in End Date for multi-day events.', 'None', '', '', '', '']
];

/** Adds the menu when the sheet opens. */
function onOpen() {
  SpreadsheetApp.getUi()
    .createMenu('SES Calendar')
    .addItem('Set up / repair sheet', 'setupSheet')
    .addSeparator()
    .addItem('Sync now', 'syncAll')          // from Code.gs
    .addItem('Install auto-sync triggers', 'setupTriggers')  // from Code.gs
    .addToUi();
}

/** Build/repair every committee tab (Calendar IDs come from CONFIG_ROWS in Committees.gs). */
function setupSheet() {
  var ss = SpreadsheetApp.getActive();

  renameLegacyTabs_(ss); // ALL-CAPS tabs -> Title Case (before we look them up)

  COMMITTEE_TABS.forEach(function (c, i) {
    var sheet = ss.getSheetByName(c.name) || ss.insertSheet(c.name);
    migrateLayoutIfNeeded_(sheet);
    formatCommitteeTab(sheet, c.color);
    if (i === 0 && sheet.getLastRow() < 2) {
      sheet.getRange(2, 1, SAMPLE_ROWS.length, HEADERS.length).setValues(SAMPLE_ROWS);
    }
  });

  // The old _Config tab is no longer used — Code.gs reads CONFIG_ROWS directly.
  var cfg = ss.getSheetByName('_Config');
  if (cfg) ss.deleteSheet(cfg);

  // Remove the default "Sheet1" if it's still empty.
  var def = ss.getSheetByName('Sheet1');
  if (def && def.getLastRow() === 0 && ss.getSheets().length > 1) {
    ss.deleteSheet(def);
  }

  SpreadsheetApp.getActive().toast('Sheet set up complete ✓');
}

/**
 * Shrink the grid to what we actually use. A default tab is 1000 x 26 = 26,000
 * cells but we only need 12 columns — that dead weight is the main reason the
 * sheet feels slow when switching tabs. Never deletes rows that hold data.
 */
function trimGrid_(sheet, lastCol, rows) {
  var maxCols = sheet.getMaxColumns();
  if (maxCols > lastCol) sheet.deleteColumns(lastCol + 1, maxCols - lastCol);

  // Keep header + styled rows, but never cut into rows that already have content.
  var keep = Math.max(rows + 1, sheet.getLastRow());
  var maxRows = sheet.getMaxRows();
  if (maxRows > keep) sheet.deleteRows(keep + 1, maxRows - keep);
}

/** Header styling, formats, validation, and protection for one committee tab. */
function formatCommitteeTab(sheet, accent) {
  var lastCol = HEADERS.length;
  var rows = STYLED_ROWS; // styled data-entry rows

  // Do this FIRST so we never format cells we're about to delete.
  trimGrid_(sheet, lastCol, rows);

  // Clear any validation left over from a previous (larger) run.
  sheet.getRange(2, 1, Math.max(sheet.getMaxRows() - 1, 1), lastCol).clearDataValidations();

  // --- Header row -------------------------------------------------------
  sheet.getRange(1, 1, 1, lastCol)
       .setValues([HEADERS])
       .setFontWeight('bold')
       .setFontSize(11)
       .setFontColor('#ffffff')
       .setBackground(accent)
       .setHorizontalAlignment('center')
       .setVerticalAlignment('middle');
  sheet.setRowHeight(1, 40);
  sheet.setFrozenRows(1);
  sheet.setFrozenColumns(1); // keep Event Title visible when scrolling right
  markRequiredHeaders_(sheet); // highlight the " *" on required columns

  // Friendly hover notes on the trickier columns.
  sheet.getRange(1, COL.TITLE).setNote('Required.');
  sheet.getRange(1, COL.START_DATE).setNote('Required. Click the cell and pick a date.');
  sheet.getRange(1, COL.START_TIME).setNote('Leave blank for an all-day event.\nPick a time like 6:30 PM (up to 11:30 PM).');
  sheet.getRange(1, COL.END_DATE).setNote('Leave blank for single-day events.\nFill in for multi-day events (e.g. a 3-day camp) — enter the actual last day.');
  sheet.getRange(1, COL.REPEAT).setNote('None, Weekly, or Monthly.');
  sheet.getRange(1, COL.STATUS).setNote('Auto-filled by the sync — don\'t edit Status, Last Synced, or the hidden Event ID column.');

  // --- Column widths ----------------------------------------------------
  // A..I event data, then Status, Last Synced, Event ID (hidden).
  var widths = [240, 130, 100, 130, 100, 170, 280, 100, 130, 150, 160, 220];
  for (var i = 0; i < widths.length; i++) sheet.setColumnWidth(i + 1, widths[i]);
  sheet.hideColumns(COL.EVENT_ID); // needed by the sync, hidden from humans

  // --- Alternating row bands on the editable columns (A:I) --------------
  sheet.getBandings().forEach(function (b) { b.remove(); });
  sheet.getRange(2, 1, rows, COL.REPEAT_UNTIL)
    .applyRowBanding(SpreadsheetApp.BandingTheme.LIGHT_GREY, false, false)
    .setFirstRowColor('#ffffff').setSecondRowColor('#f3f6fb');

  // --- Display formats --------------------------------------------------
  sheet.getRange(2, COL.START_DATE, rows, 1).setNumberFormat('ddd, mmm d, yyyy');
  sheet.getRange(2, COL.END_DATE, rows, 1).setNumberFormat('ddd, mmm d, yyyy');
  sheet.getRange(2, COL.REPEAT_UNTIL, rows, 1).setNumberFormat('ddd, mmm d, yyyy');
  sheet.getRange(2, COL.START_TIME, rows, 1).setNumberFormat('h:mm AM/PM');
  sheet.getRange(2, COL.END_TIME, rows, 1).setNumberFormat('h:mm AM/PM');
  // CLIP, not wrap: wrapping forces Sheets to recompute row heights constantly,
  // which is a real rendering drag. Full text is still visible on click.
  sheet.getRange(2, COL.DESCRIPTION, rows, 1)
       .setWrap(false)
       .setWrapStrategy(SpreadsheetApp.WrapStrategy.CLIP);

  // Alignment: center dates/times/repeat, middle-align everything.
  sheet.getRange(2, 1, rows, lastCol).setVerticalAlignment('middle');
  sheet.getRange(2, COL.START_DATE, rows, 4).setHorizontalAlignment('center'); // B,C,D,E
  sheet.getRange(2, COL.REPEAT, rows, 2).setHorizontalAlignment('center');     // H,I

  // --- Data validation: real pickers, not plain text --------------------
  var datePicker = SpreadsheetApp.newDataValidation()
    .requireDate().setAllowInvalid(false)
    .setHelpText('Click the cell and pick a date from the calendar.').build();
  sheet.getRange(2, COL.START_DATE, rows, 1).setDataValidation(datePicker);
  sheet.getRange(2, COL.END_DATE, rows, 1).setDataValidation(datePicker);
  sheet.getRange(2, COL.REPEAT_UNTIL, rows, 1).setDataValidation(datePicker);

  var timePicker = SpreadsheetApp.newDataValidation()
    .requireValueInList(timeOptions_(), true).setAllowInvalid(true)
    .setHelpText('Pick a time, or type your own (e.g. 6:45 PM).').build();
  sheet.getRange(2, COL.START_TIME, rows, 1).setDataValidation(timePicker);
  sheet.getRange(2, COL.END_TIME, rows, 1).setDataValidation(timePicker);

  var repeatPicker = SpreadsheetApp.newDataValidation()
    .requireValueInList(['None', 'Weekly', 'Monthly'], true)
    .setAllowInvalid(false).build();
  sheet.getRange(2, COL.REPEAT, rows, 1).setDataValidation(repeatPicker);

  // --- Conditional formatting -------------------------------------------
  var statusCol = sheet.getRange(2, COL.STATUS, rows, 1);
  var titleCol = sheet.getRange(2, COL.TITLE, rows, 1);
  var startCol = sheet.getRange(2, COL.START_DATE, rows, 1);
  sheet.setConditionalFormatRules([
    // Status (L) cues.
    SpreadsheetApp.newConditionalFormatRule()
      .whenTextContains('Synced').setBackground('#d8f3e3').setFontColor('#137a3a')
      .setRanges([statusCol]).build(),
    SpreadsheetApp.newConditionalFormatRule()
      .whenTextContains('Error').setBackground('#fde0e0').setFontColor('#b42318')
      .setRanges([statusCol]).build(),
    SpreadsheetApp.newConditionalFormatRule()
      .whenTextContains('Needs').setBackground('#fdf1d6').setFontColor('#a15c07')
      .setRanges([statusCol]).build(),
    // Required-but-empty cells turn red once the member has started the row.
    // Deliberately a 2-cell check, not COUNTA($A2:$I2): a 9-cell scan per row
    // across 300 rows is recalculated constantly and is a real drag. Filling
    // either required field flags the other, which is the case that matters.
    SpreadsheetApp.newConditionalFormatRule()
      .whenFormulaSatisfied('=AND($A2="",$B2<>"")')
      .setBackground('#fde0e0').setRanges([titleCol]).build(),
    SpreadsheetApp.newConditionalFormatRule()
      .whenFormulaSatisfied('=AND($B2="",$A2<>"")')
      .setBackground('#fde0e0').setRanges([startCol]).build()
  ]);

  // --- Auto-managed columns (Status, Last Synced, Event ID): grey + protect --
  sheet.getRange(2, COL.STATUS, rows, 3)
       .setBackground('#eef1f5').setFontColor('#9aa6b2').setHorizontalAlignment('center');
  var hasProtection = sheet.getProtections(SpreadsheetApp.ProtectionType.RANGE)
    .some(function (p) { return p.getDescription() === 'Auto-managed (do not edit)'; });
  if (!hasProtection) {
    sheet.getRange(2, COL.STATUS, rows, 3).protect()
      .setDescription('Auto-managed (do not edit)').setWarningOnly(true);
  }

  // --- Outer border only ------------------------------------------------
  // The inner grid (last two args) bordered every one of ~3,600 cells. The row
  // banding already separates rows, so the outline is enough — and much lighter.
  sheet.getRange(1, 1, rows + 1, lastCol)
       .setBorder(true, true, true, true, false, false, '#dbe2ea', SpreadsheetApp.BorderStyle.SOLID);
}

/**
 * Migrate the older layout (no End Date column) to the new one by inserting a
 * blank End Date column at position D. This shifts existing event data — and the
 * auto-managed Event ID / Last Synced / Status columns — into their new
 * positions, so synced events stay intact. Idempotent: skips if already migrated.
 */
function migrateLayoutIfNeeded_(sheet) {
  if (sheet.getLastColumn() < 4 || sheet.getLastRow() < 1) return;
  var hdr = sheet.getRange(1, 1, 1, sheet.getLastColumn()).getValues()[0];
  var hasEndDate = hdr.some(function (h) {
    return String(h).trim().toLowerCase() === 'end date';
  });
  var oldEndTimeAtD = String(hdr[3] || '').trim().toLowerCase() === 'end time';
  if (!hasEndDate && oldEndTimeAtD) {
    sheet.insertColumnAfter(COL.START_TIME); // new empty End Date column at D
  }
}

/** Rename any legacy ALL-CAPS committee tabs to the Title Case names. */
function renameLegacyTabs_(ss) {
  COMMITTEE_TABS.forEach(function (c) {
    if (ss.getSheetByName(c.name)) return;              // already correct
    var legacy = ss.getSheetByName(c.name.toUpperCase());
    if (legacy) legacy.setName(c.name);                 // preserves all data
  });
}

/** Colour the trailing " *" on required headers amber so it stands out. */
function markRequiredHeaders_(sheet) {
  var white = SpreadsheetApp.newTextStyle().setForegroundColor('#ffffff').setBold(true).build();
  var amber = SpreadsheetApp.newTextStyle().setForegroundColor('#fde047').setBold(true).build();
  [COL.TITLE, COL.START_DATE].forEach(function (col) {
    var cell = sheet.getRange(1, col);
    var text = String(cell.getValue());
    var star = text.lastIndexOf('*');
    if (star < 0) return;
    cell.setRichTextValue(
      SpreadsheetApp.newRichTextValue().setText(text)
        .setTextStyle(0, star, white)
        .setTextStyle(star, text.length, amber)
        .build());
  });
}

/** Half-hour AM/PM time options 6:00 AM .. 11:30 PM for the Start/End Time dropdowns. */
function timeOptions_() {
  var out = [];
  for (var h = 6; h <= 23; h++) {
    out.push(fmtAmPm_(h, 0));
    out.push(fmtAmPm_(h, 30));
  }
  return out;
}

function fmtAmPm_(h, m) {
  var mer = h < 12 ? 'AM' : 'PM';
  var hh = h % 12; if (hh === 0) hh = 12;
  return hh + ':' + (m < 10 ? '0' + m : m) + ' ' + mer;
}

