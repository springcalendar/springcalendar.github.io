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
var HEADERS = [
  'Event Title *', 'Start Date *', 'Start Time', 'End Date', 'End Time', 'Location',
  'Description', 'Repeat', 'Repeat Until', '🔒 Event ID', '🔒 Last Synced', '🔒 Status'
];

// How many rows get the live formatting/validation. Keep this modest — applying
// date pickers, dropdowns, banding and conditional formatting to thousands of
// rows makes the sheet sluggish. Re-run "Set up / repair sheet" to extend later.
var STYLED_ROWS = 300;

// Columns: Title, Start Date, Start Time, End Date, End Time, Location,
//          Description, Repeat, Repeat Until, [3 auto].
var SAMPLE_ROWS = [
  ['Weekly Study Circle', '2026-07-07', '18:30', '', '20:00', 'Main Hall',
   'Bring your notebooks.', 'Weekly', '2026-08-25', '', '', ''],
  ['Guest Speaker Night', '2026-07-15', '19:00', '', '20:30', 'Room 204',
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

/** Build/repair every committee tab and the _Config tab. */
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

  buildConfigTab(ss);

  // Remove the default "Sheet1" if it's still empty.
  var def = ss.getSheetByName('Sheet1');
  if (def && def.getLastRow() === 0 && ss.getSheets().length > 1) {
    ss.deleteSheet(def);
  }

  SpreadsheetApp.getActive().toast('Sheet set up complete ✓');
}

/** Header styling, formats, validation, and protection for one committee tab. */
function formatCommitteeTab(sheet, accent) {
  var lastCol = HEADERS.length;
  var rows = STYLED_ROWS; // styled data-entry rows

  // Clear any validation left over from a previous (larger) run across the whole
  // sheet, so only the modest styled block stays "live" — this is the main fix
  // for sheet sluggishness.
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
  sheet.getRange(1, COL.START_TIME).setNote('Leave blank for an all-day event.\nUse 24-hour time, e.g. 18:30 = 6:30 PM.');
  sheet.getRange(1, COL.END_DATE).setNote('Leave blank for single-day events.\nFill in for multi-day events (e.g. a 3-day camp) — enter the actual last day.');
  sheet.getRange(1, COL.REPEAT).setNote('None, Weekly, or Monthly.');
  sheet.getRange(1, COL.EVENT_ID).setNote('Filled in automatically by the sync — please do not edit columns J, K, L.');

  // --- Column widths ----------------------------------------------------
  var widths = [240, 130, 100, 130, 100, 170, 280, 100, 130, 220, 150, 150];
  for (var i = 0; i < widths.length; i++) sheet.setColumnWidth(i + 1, widths[i]);

  // --- Alternating row bands on the editable columns (A:I) --------------
  sheet.getBandings().forEach(function (b) { b.remove(); });
  sheet.getRange(2, 1, rows, COL.REPEAT_UNTIL)
    .applyRowBanding(SpreadsheetApp.BandingTheme.LIGHT_GREY, false, false)
    .setFirstRowColor('#ffffff').setSecondRowColor('#f3f6fb');

  // --- Display formats --------------------------------------------------
  sheet.getRange(2, COL.START_DATE, rows, 1).setNumberFormat('ddd, mmm d, yyyy');
  sheet.getRange(2, COL.END_DATE, rows, 1).setNumberFormat('ddd, mmm d, yyyy');
  sheet.getRange(2, COL.REPEAT_UNTIL, rows, 1).setNumberFormat('ddd, mmm d, yyyy');
  sheet.getRange(2, COL.START_TIME, rows, 1).setNumberFormat('HH:mm');
  sheet.getRange(2, COL.END_TIME, rows, 1).setNumberFormat('HH:mm');
  sheet.getRange(2, COL.DESCRIPTION, rows, 1).setWrap(true);

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
    .setHelpText('Pick a time, or type your own as 24-hour HH:MM (e.g. 18:45).').build();
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
    SpreadsheetApp.newConditionalFormatRule()
      .whenFormulaSatisfied('=AND($A2="",COUNTA($A2:$I2)>0)')
      .setBackground('#fde0e0').setRanges([titleCol]).build(),
    SpreadsheetApp.newConditionalFormatRule()
      .whenFormulaSatisfied('=AND($B2="",COUNTA($A2:$I2)>0)')
      .setBackground('#fde0e0').setRanges([startCol]).build()
  ]);

  // --- Auto-managed columns I:K: grey + protect (warning-only) ----------
  sheet.getRange(2, COL.EVENT_ID, rows, 3)
       .setBackground('#eef1f5').setFontColor('#9aa6b2').setHorizontalAlignment('center');
  var hasProtection = sheet.getProtections(SpreadsheetApp.ProtectionType.RANGE)
    .some(function (p) { return p.getDescription() === 'Auto-managed (do not edit)'; });
  if (!hasProtection) {
    sheet.getRange(2, COL.EVENT_ID, rows, 3).protect()
      .setDescription('Auto-managed (do not edit)').setWarningOnly(true);
  }

  // --- Outer + inner grid border ---------------------------------------
  sheet.getRange(1, 1, rows + 1, lastCol)
       .setBorder(true, true, true, true, true, true, '#dbe2ea', SpreadsheetApp.BorderStyle.SOLID);
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

/** Half-hour time options 06:00..22:00 for the Start/End Time dropdowns. */
function timeOptions_() {
  var out = [];
  for (var h = 6; h <= 22; h++) {
    out.push(pad2_(h) + ':00');
    out.push(pad2_(h) + ':30');
  }
  return out;
}

function pad2_(n) {
  return (n < 10 ? '0' : '') + n;
}

/** Create + pre-fill the _Config tab. */
function buildConfigTab(ss) {
  var sheet = ss.getSheetByName('_Config') || ss.insertSheet('_Config');
  var headers = ['Committee', 'CalendarId', 'Color', 'iCalURL', 'SubscribeURL'];

  sheet.getRange(1, 1, 1, headers.length)
       .setValues([headers])
       .setFontWeight('bold')
       .setFontColor('#ffffff')
       .setBackground('#0f172a')
       .setHorizontalAlignment('center')
       .setVerticalAlignment('middle');
  sheet.setRowHeight(1, 36);
  sheet.setFrozenRows(1);
  sheet.getRange(1, 2).setNote('Calendar IDs are generated from committees.json — edit there and re-run the generator, not here.');

  // Write the data rows from the generated CONFIG_ROWS (single source of truth:
  // committees.json → tools/gen_config.py → Committees.gs). This bakes in the
  // Calendar IDs + derived iCal/subscribe URLs. Falls back to name+color only if
  // an older Committees.gs (without CONFIG_ROWS) is in the project.
  var data = (typeof CONFIG_ROWS !== 'undefined' && CONFIG_ROWS.length)
    ? CONFIG_ROWS
    : COMMITTEE_TABS.map(function (c) { return [c.name, '', c.color, '', '']; });

  var oldRows = Math.max(sheet.getLastRow() - 1, 0);
  if (oldRows > data.length) {
    sheet.getRange(2, 1, oldRows, headers.length).clearContent();
  }
  sheet.getRange(2, 1, data.length, headers.length).setValues(data);

  var widths = [260, 340, 90, 380, 380];
  for (var i = 0; i < widths.length; i++) sheet.setColumnWidth(i + 1, widths[i]);

  var nRows = data.length;
  sheet.getBandings().forEach(function (b) { b.remove(); });
  sheet.getRange(2, 1, nRows, headers.length)
       .applyRowBanding(SpreadsheetApp.BandingTheme.LIGHT_GREY, false, false)
       .setFirstRowColor('#ffffff').setSecondRowColor('#f3f6fb');
  sheet.getRange(1, 1, nRows + 1, headers.length)
       .setBorder(true, true, true, true, true, true, '#dbe2ea', SpreadsheetApp.BorderStyle.SOLID);

  // Move _Config to the end.
  ss.setActiveSheet(sheet);
  ss.moveActiveSheet(ss.getSheets().length);
}
