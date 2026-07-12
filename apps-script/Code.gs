/**
 * Spring Educational Services — Sheet → Google Calendar sync.
 *
 * Bound to the committee Google Sheet. For each committee tab it reconciles the
 * rows against that committee's Google Calendar:
 *   - new row (no Event ID)      -> create event, write its ID back to col I
 *   - existing row, changed      -> update the event in place (series: recreate)
 *   - row cleared / orphaned     -> delete the calendar event
 *
 * Idempotent: each event's ID lives in col I and a content hash lives on the
 * event as a tag, so re-running never creates duplicates.
 *
 * Runs as your Google account — no API keys/secrets. Run `setupTriggers` once.
 */

// ---- Sheet layout ---------------------------------------------------------
var COL = {
  TITLE: 1,        // A
  START_DATE: 2,   // B
  START_TIME: 3,   // C  (blank => all-day)
  END_DATE: 4,     // D  (blank => single-day; fill for multi-day events)
  END_TIME: 5,     // E
  LOCATION: 6,     // F
  DESCRIPTION: 7,  // G
  REPEAT: 8,       // H  (None | Weekly | Monthly)
  REPEAT_UNTIL: 9, // I
  STATUS: 10,      // J  (auto — shown first, right after the event data)
  LAST_SYNCED: 11, // K  (auto — shown)
  EVENT_ID: 12     // L  (auto — hidden; needed for the sync, not for humans)
};
var NUM_COLS = 12;
var FIRST_DATA_ROW = 2;
var SYNC_TAG = 'ses_sync';   // marks events we manage
var HASH_TAG = 'ses_hash';   // content hash for change detection
var SRC_TAG = 'ses_src';     // on combined-calendar mirrors: source committee event id
// The event id we also store in the sheet. Recurring INSTANCES inherit their
// series' tags, so this lets the orphan sweep map any fetched event (single or
// recurring instance) back to the row that owns it — which getId() cannot do.
var ID_TAG = 'ses_id';
// The _Config row whose Committee name starts with this prefix is THIS sheet's
// combined mirror calendar. So the Boys sheet auto-targets "SES – All Events Boys"
// and the Girls sheet "SES – All Events Girls" using the exact same code (en dash).
var COMBINED_PREFIX = 'SES – All Events';

/** True if a _Config committee name is the combined mirror row (not a real tab). */
function isCombinedName_(name) {
  return String(name).indexOf(COMBINED_PREFIX) === 0;
}

// ===========================================================================
// Triggers
// ===========================================================================

/** Run once from the editor to install triggers. */
function setupTriggers() {
  var triggers = ScriptApp.getProjectTriggers();
  for (var i = 0; i < triggers.length; i++) {
    ScriptApp.deleteTrigger(triggers[i]);
  }
  ScriptApp.newTrigger('syncAll').timeBased().everyMinutes(10).create();
  ScriptApp.newTrigger('onEditSync')
    .forSpreadsheet(SpreadsheetApp.getActive())
    .onEdit()
    .create();
  // Deleting a row is a STRUCTURAL change: it fires onChange, never onEdit. Without
  // this trigger, deleting a row wouldn't sync until the 10-minute timed run.
  ScriptApp.newTrigger('onChangeSync')
    .forSpreadsheet(SpreadsheetApp.getActive())
    .onChange()
    .create();
  SpreadsheetApp.getActive().toast('Triggers installed. Running first sync…');
  syncAll();
}

/**
 * Structural change (row inserted/removed). We act ONLY on REMOVE_ROW:
 * a deleted row takes its Event ID with it, so the calendar event can only be
 * found by the orphan sweep in syncAll().
 *
 * Restricting to REMOVE_ROW is also the loop guard: unlike onEdit, an installable
 * onChange CAN fire on the script's own writes (Status / Last Synced). Our script
 * never removes rows, so this handler can never re-trigger itself.
 */
function onChangeSync(e) {
  if (!e || e.changeType !== 'REMOVE_ROW') return;
  syncAll();
}

/**
 * On-edit: sync ONLY the edited row(s) — a single lightweight calendar call.
 * The expensive cross-row orphan sweep is left to the timed syncAll, so typing
 * in the sheet stays fast.
 */
function onEditSync(e) {
  if (!e || !e.range) return;
  var sheet = e.range.getSheet();
  var map = readConfig();
  var cfg = map[sheet.getName()];
  if (!cfg) return;                                   // not a committee tab
  if (e.range.getColumn() >= COL.STATUS) return;      // ignore edits to auto cols (Status, Last Synced, Event ID)

  var calendar = CalendarApp.getCalendarById(cfg.calendarId);
  if (!calendar) return;

  var start = e.range.getRow();
  var count = e.range.getNumRows();
  for (var r = start; r < start + count; r++) {
    if (r < FIRST_DATA_ROW) continue;
    var res = syncSheetRow(sheet, calendar, r, null, null);
    // One write for Status / Last Synced / Event ID (they're contiguous J:L).
    sheet.getRange(r, COL.STATUS, 1, 3).setValues([res.auto]);
  }
}

// ===========================================================================
// Sync
// ===========================================================================

/** Sync every committee tab in CONFIG_ROWS, then mirror into the combined calendar. */
function syncAll() {
  // The timed trigger and onChangeSync can fire at once — don't let two runs
  // reconcile the same calendars concurrently.
  var lock = LockService.getScriptLock();
  if (!lock.tryLock(30000)) {
    Logger.log('Another sync is already running — skipping this one.');
    return;
  }

  try {
    var map = readConfig();
    var combined = null;
    var live = []; // { id: committeeEventId, ev: parsedEvent } across all committees

    Object.keys(map).forEach(function (sheetName) {
      if (isCombinedName_(sheetName)) { combined = map[sheetName]; return; } // mirror target, not a tab
      try {
        var synced = syncSheet(sheetName, map[sheetName].calendarId);
        for (var i = 0; i < synced.length; i++) live.push(synced[i]);
      } catch (err) {
        Logger.log('Sync failed for ' + sheetName + ': ' + err);
      }
    });

    if (combined && combined.calendarId) {
      try {
        mirrorCombined_(combined.calendarId, live);
      } catch (err) {
        Logger.log('Combined mirror failed: ' + err);
      }
    }
  } finally {
    lock.releaseLock();
  }
}

/**
 * Reconcile one committee tab against its calendar.
 * Returns an array of { id, ev } for every live row (for the combined mirror).
 */
function syncSheet(sheetName, calendarId) {
  var sheet = SpreadsheetApp.getActive().getSheetByName(sheetName);
  if (!sheet) return [];
  var calendar = CalendarApp.getCalendarById(calendarId);
  if (!calendar) throw new Error('No access to calendar ' + calendarId);

  var lastRow = sheet.getLastRow();
  var liveIds = {}; // event IDs still referenced by a (non-blank) row
  var live = [];

  if (lastRow >= FIRST_DATA_ROW) {
    var n = lastRow - FIRST_DATA_ROW + 1;
    // Read the whole data block in ONE call instead of row-by-row.
    var data = sheet.getRange(FIRST_DATA_ROW, 1, n, NUM_COLS).getValues();
    var auto = []; // Status / Last Synced / Event ID for every row

    for (var i = 0; i < n; i++) {
      var res = syncSheetRow(sheet, calendar, FIRST_DATA_ROW + i, liveIds, data[i]);
      auto.push(res.auto);
      if (res.live) live.push(res.live);
    }

    // ONE write for the whole J:L block instead of 3 API calls per row.
    sheet.getRange(FIRST_DATA_ROW, COL.STATUS, n, 3).setValues(auto);
  }

  sweepOrphans(calendar, liveIds);
  return live;
}

/**
 * Sync a single row to the calendar. `values` may be passed in (to avoid a
 * re-read); `liveIds` is the running set for the orphan sweep (null on edit).
 * Returns { id, ev } for a live row, or null otherwise.
 */
function syncSheetRow(sheet, calendar, row, liveIds, values) {
  if (!values) values = sheet.getRange(row, 1, 1, NUM_COLS).getValues()[0];
  var ev = parseRow(values);
  var eventId = String(values[COL.EVENT_ID - 1] || '').trim();
  var lastSynced = values[COL.LAST_SYNCED - 1]; // keep the old stamp unless we sync

  // Blank row that still holds an Event ID => the event was removed.
  if (!ev.title && !ev.startDate) {
    if (eventId) deleteEvent(calendar, eventId);
    return { auto: ['', '', ''], live: null };  // clears Status / Last Synced / Event ID
  }

  // Incomplete row (missing title or start date) — flag and skip.
  if (!ev.title || !ev.startDate) {
    return { auto: ['Needs Title and Start Date', lastSynced, eventId], live: null };
  }

  try {
    var newId = upsertEvent(calendar, eventId, ev);
    if (liveIds) liveIds[newId] = true;
    return { auto: ['Synced', new Date(), newId], live: { id: newId, ev: ev } };
  } catch (err) {
    return { auto: ['Error: ' + err.message, lastSynced, eventId], live: null };
  }
}

// ===========================================================================
// Event create / update / delete
// ===========================================================================

/**
 * Does the calendar event still match what the sheet says? The hash tag alone
 * only detects SHEET changes — if someone edited the event directly in Google
 * Calendar the tag is untouched, so we must compare the event's real fields.
 * The sheet is the source of truth, so any mismatch gets overwritten.
 */
function eventMatches_(event, ev) {
  if (event.getTitle() !== ev.title) return false;
  if ((event.getLocation() || '') !== (ev.location || '')) return false;
  if ((event.getDescription() || '') !== (ev.description || '')) return false;
  if (event.isAllDayEvent() !== !!ev.allDay) return false;
  if (!ev.allDay && ev.start && ev.end) {
    if (event.getStartTime().getTime() !== ev.start.getTime()) return false;
    if (event.getEndTime().getTime() !== ev.end.getTime()) return false;
  }
  return true;
}

/** Create or update; returns the (possibly new) event ID. */
function upsertEvent(calendar, eventId, ev) {
  var hash = contentHash(ev);
  var isSeries = ev.repeat === 'Weekly' || ev.repeat === 'Monthly';

  if (eventId) {
    var existing = safeGetEvent(calendar, eventId);
    if (existing) {
      var recurring = isSeries || (existing.isRecurringEvent && existing.isRecurringEvent());
      // Unchanged in the sheet AND untouched in Google Calendar -> nothing to do.
      // (Series fields aren't reliably comparable, so trust the hash for those.)
      if (existing.getTag(HASH_TAG) === hash && (recurring || eventMatches_(existing, ev))) {
        if (!existing.getTag(ID_TAG)) existing.setTag(ID_TAG, eventId); // heal legacy events
        return eventId;
      }
      // Series edits aren't reliably patchable in place -> recreate.
      if (recurring) {
        deleteEvent(calendar, eventId);
      } else {
        applyToEvent(existing, ev);          // sheet wins: overwrite any manual edit
        existing.setTag(HASH_TAG, hash);
        existing.setTag(ID_TAG, eventId);
        return eventId;
      }
    }
  }
  return createEvent(calendar, ev, hash);
}

function createEvent(calendar, ev, hash) {
  var event = createEventOn_(calendar, ev);
  var id = event.getId();
  event.setTag(SYNC_TAG, '1');
  event.setTag(HASH_TAG, hash);
  event.setTag(ID_TAG, id);   // so the sweep can identify it (incl. recurring instances)
  return id;
}

/** Build the calendar event on `calendar` (no tags). Shared by committee + mirror. */
function createEventOn_(calendar, ev) {
  if (ev.repeat === 'Weekly' || ev.repeat === 'Monthly') {
    var recurrence = CalendarApp.newRecurrence();
    var rule = ev.repeat === 'Weekly'
      ? recurrence.addWeeklyRule()
      : recurrence.addMonthlyRule();
    if (ev.repeatUntil) rule.until(ev.repeatUntil);
    // Recurring occurrences use the start day/time; per-occurrence multi-day
    // spans aren't supported by CalendarApp series, so each occurrence is one day.
    if (ev.allDay) {
      return calendar.createAllDayEventSeries(ev.title, ev.startDate, recurrence, opts(ev));
    }
    return calendar.createEventSeries(ev.title, ev.start, ev.end, recurrence, opts(ev));
  }
  if (ev.allDay) {
    if (ev.multiDay) {
      return calendar.createAllDayEvent(ev.title, ev.startDate, exclusiveEnd_(ev.endDate), opts(ev));
    }
    return calendar.createAllDayEvent(ev.title, ev.startDate, opts(ev));
  }
  // Timed events (single or multi-day) use the resolved start/end datetimes.
  return calendar.createEvent(ev.title, ev.start, ev.end, opts(ev));
}

function applyToEvent(event, ev) {
  event.setTitle(ev.title);
  event.setLocation(ev.location || '');
  event.setDescription(ev.description || '');
  if (ev.allDay) {
    if (ev.multiDay) {
      event.setAllDayDates(ev.startDate, exclusiveEnd_(ev.endDate));
    } else {
      event.setAllDayDate(ev.startDate);
    }
  } else {
    event.setTime(ev.start, ev.end);
  }
}

/** CalendarApp ids look like "abc@google.com"; the Calendar API wants just "abc". */
function apiEventId_(id) {
  return String(id).replace(/@google\.com$/, '');
}

/**
 * Delete an event by the id stored in the sheet — single events AND whole
 * recurring series.
 *
 * getEventById() returns NULL for a recurring series id (you need
 * getEventSeriesById), so the old "fetch then delete" approach silently did
 * nothing for repeating events. Try the series first, and prefer the Calendar API,
 * which removes a series outright when given the series id.
 */
function deleteEvent(calendar, eventId) {
  if (typeof Calendar !== 'undefined' && Calendar.Events) {
    try {
      Calendar.Events.remove(calendar.getId(), apiEventId_(eventId));
      return; // removes a series outright
    } catch (err) {
      // 404/410 = already gone. Anything else: fall through to CalendarApp.
      var msg = String(err);
      if (msg.indexOf('404') >= 0 || msg.indexOf('410') >= 0 || /not found|deleted/i.test(msg)) return;
      Logger.log('Calendar API delete failed for ' + eventId + ' (' + err + ') — trying CalendarApp.');
    }
  }

  // CalendarApp fallback — series FIRST, because getEventById() misses series.
  try {
    var series = calendar.getEventSeriesById(eventId);
    if (series) { series.deleteEventSeries(); return; }
  } catch (e) { /* not a series (or no access) — fall through */ }

  var event = safeGetEvent(calendar, eventId);
  if (event) {
    try { event.deleteEventSeries(); } catch (e) { /* not a series */ }
    try { event.deleteEvent(); } catch (e) { /* already gone */ }
  }
}

/** Window used ONLY by the slow fallback path (the fast path needs no window). */
function sweepWindow_() {
  var from = new Date(); from.setFullYear(from.getFullYear() - 2);
  var to = new Date();   to.setFullYear(to.getFullYear() + 5);
  return { from: from, to: to };
}

/**
 * List the events WE manage on a calendar, as { id, src, hash, recurring }.
 * `id` is the same id stored in the sheet, so it can be matched to a row.
 *
 * FAST PATH (Calendar advanced service — enable via Apps Script → Services + →
 * Calendar API): Google filters server-side to only our tagged events, a recurring
 * series comes back as ONE item instead of every occurrence, and there is no time
 * window at all (so nothing can escape cleanup).
 *
 * FALLBACK (CalendarApp): download every event in a 7-year window and filter here.
 * Correct but much heavier — a weekly event expands into hundreds of instances.
 * Used automatically if the advanced service isn't enabled, so nothing breaks.
 */
function listManagedEvents_(calendarId) {
  if (typeof Calendar !== 'undefined' && Calendar.Events) {
    try {
      var out = [];
      var pageToken = null;
      do {
        var resp = Calendar.Events.list(calendarId, {
          privateExtendedProperty: SYNC_TAG + '=1', // only our events
          singleEvents: false,                      // a series stays ONE item
          showDeleted: false,
          maxResults: 2500,
          pageToken: pageToken
        });
        var items = resp.items || [];
        for (var i = 0; i < items.length; i++) {
          var p = (items[i].extendedProperties && items[i].extendedProperties.private) || {};
          // Events created before ID_TAG existed have no ses_id. Don't skip them —
          // they'd be invisible to the sweep and could never be deleted. The sheet
          // stores CalendarApp ids ("<id>@google.com"); the API returns "<id>".
          var id = p[ID_TAG] || (items[i].id + '@google.com');
          out.push({
            id: id,
            src: p[SRC_TAG] || '',
            hash: p[HASH_TAG] || '',
            recurring: !!items[i].recurrence
          });
        }
        pageToken = resp.nextPageToken;
      } while (pageToken);
      return out;
    } catch (err) {
      Logger.log('Calendar API unavailable (' + err + ') — using the slower fallback.');
    }
  }

  var calendar = CalendarApp.getCalendarById(calendarId);
  if (!calendar) return [];
  var w = sweepWindow_();
  var events = calendar.getEvents(w.from, w.to);
  var seen = {}, list = [];
  for (var j = 0; j < events.length; j++) {
    var e = events[j];
    if (e.getTag(SYNC_TAG) !== '1') continue;                // not ours
    var recurring = !!(e.isRecurringEvent && e.isRecurringEvent());
    var id = e.getTag(ID_TAG);
    if (!id) {
      // Legacy event with no ID_TAG. A recurring INSTANCE's getId() is not the
      // series id the sheet stored, so ask for the series id — otherwise the event
      // is invisible to the sweep and can never be deleted.
      if (recurring) {
        try { id = e.getEventSeries().getId(); } catch (err) { continue; }
      } else {
        id = e.getId();
      }
    }
    if (seen[id]) continue;   // a series yields many instances — collapse them
    seen[id] = true;
    list.push({
      id: id,
      src: e.getTag(SRC_TAG) || '',
      hash: e.getTag(HASH_TAG) || '',
      recurring: recurring
    });
  }
  return list;
}

/**
 * READ-ONLY diagnosis: shows exactly what the sync sees on each calendar and which
 * events it considers orphans. Changes nothing. Use it when an event won't delete.
 */
function diagnoseSync() {
  var fast = (typeof Calendar !== 'undefined' && Calendar.Events);
  var out = ['Calendar API: ' + (fast ? 'ENABLED (fast path)' : 'NOT enabled (slow fallback)')];
  var map = readConfig();

  Object.keys(map).forEach(function (name) {
    var cfg = map[name];
    var combined = isCombinedName_(name);
    out.push('');
    out.push('=== ' + name + (combined ? '  [combined mirror]' : '') + ' ===');

    var managed = listManagedEvents_(cfg.calendarId);

    // Which Event IDs does the sheet still reference?
    var inSheet = {};
    var sheet = SpreadsheetApp.getActive().getSheetByName(name);
    if (sheet) {
      var lastRow = sheet.getLastRow();
      if (lastRow >= FIRST_DATA_ROW) {
        var data = sheet.getRange(FIRST_DATA_ROW, 1, lastRow - FIRST_DATA_ROW + 1, NUM_COLS).getValues();
        for (var i = 0; i < data.length; i++) {
          var rid = String(data[i][COL.EVENT_ID - 1] || '').trim();
          if (rid) inSheet[rid] = String(data[i][COL.TITLE - 1] || '(untitled)');
        }
      }
      out.push('  rows in sheet with an Event ID : ' + Object.keys(inSheet).length);
    }
    out.push('  events we manage on calendar   : ' + managed.length);

    for (var k = 0; k < managed.length; k++) {
      var m = managed[k];
      if (combined) {
        out.push('    mirror  recurring=' + (m.recurring ? 'yes' : 'no') + '  src=' + m.src);
        continue;
      }
      var keep = !!inSheet[m.id];
      out.push('    ' + (keep ? 'KEEP  ' : 'ORPHAN') +
               '  recurring=' + (m.recurring ? 'yes' : 'no ') +
               '  ' + (keep ? inSheet[m.id] : '<- will be deleted next sync') +
               '  id=' + m.id);
    }
  });

  var text = out.join('\n');
  Logger.log(text);
  SpreadsheetApp.getUi().alert(
    'Sync diagnosis',
    text.length > 1400 ? text.substring(0, 1400) + '\n\n…full output in the Executions log.' : text,
    SpreadsheetApp.getUi().ButtonSet.OK);
}

/**
 * Delete every managed event whose row no longer exists in the sheet — recurring
 * series included (the whole series, once).
 */
function sweepOrphans(calendar, liveIds) {
  var managed = listManagedEvents_(calendar.getId());
  for (var i = 0; i < managed.length; i++) {
    var id = managed[i].id;
    if (liveIds[id]) continue;  // still referenced by a row — keep
    deleteEvent(calendar, id);  // series-aware: deleteEventSeries() then deleteEvent()
  }
}

// ===========================================================================
// Combined "SES – All Events" mirror
// ===========================================================================

/**
 * Mirror every live committee event into the combined calendar. Each mirror is
 * tagged with its source committee event id (SRC_TAG), so we reconcile without
 * needing a second column in the sheet. Runs only from the timed syncAll.
 */
function mirrorCombined_(combinedCalendarId, live) {
  var cal = CalendarApp.getCalendarById(combinedCalendarId);
  if (!cal) { Logger.log('No access to combined calendar ' + combinedCalendarId); return; }

  // Only our mirrors, series collapsed to one item each (see listManagedEvents_).
  var existing = listManagedEvents_(combinedCalendarId);

  // Index existing mirrors by the source committee-event id they copy.
  var bySrc = {};
  for (var i = 0; i < existing.length; i++) {
    if (existing[i].src) bySrc[existing[i].src] = existing[i];
  }

  // Create/update a mirror for every live committee event.
  var liveSrc = {};
  for (var j = 0; j < live.length; j++) {
    var srcId = live[j].id;
    var ev = live[j].ev;
    liveSrc[srcId] = true;
    var hash = contentHash(ev);
    var m = bySrc[srcId];

    if (!m) { createMirror_(cal, ev, srcId, hash); continue; }
    if (m.hash === hash) continue; // unchanged — nothing to do (no API call)

    var seriesish = m.recurring || ev.repeat === 'Weekly' || ev.repeat === 'Monthly';
    if (seriesish) {
      deleteEvent(cal, m.id);                 // series edits aren't patchable
      createMirror_(cal, ev, srcId, hash);
    } else {
      // Only now do we fetch the real event object — the common (unchanged) case
      // above costs no API call at all.
      var mirror = safeGetEvent(cal, m.id);
      if (mirror) {
        applyToEvent(mirror, ev);
        mirror.setTag(HASH_TAG, hash);
      } else {
        createMirror_(cal, ev, srcId, hash);  // vanished — recreate
      }
    }
  }

  // Remove mirrors whose source row no longer exists.
  for (var k = 0; k < existing.length; k++) {
    var s = existing[k].src;
    if (s && !liveSrc[s]) deleteEvent(cal, existing[k].id);
  }
}

function createMirror_(calendar, ev, srcId, hash) {
  var event = createEventOn_(calendar, ev);
  var id = event.getId();
  event.setTag(SYNC_TAG, '1');
  event.setTag(SRC_TAG, srcId);
  event.setTag(HASH_TAG, hash);
  event.setTag(ID_TAG, id);   // lets listManagedEvents_ map it back
  return id;
}


// ===========================================================================
// Helpers
// ===========================================================================

function opts(ev) {
  return { location: ev.location || '', description: ev.description || '' };
}

function safeGetEvent(calendar, eventId) {
  try {
    return calendar.getEventById(eventId);
  } catch (e) {
    return null;
  }
}

/** Read a sheet row into a normalized event object. */
function parseRow(v) {
  var title = String(v[COL.TITLE - 1] || '').trim();
  var startDate = toDate_(v[COL.START_DATE - 1]);
  var endDate = toDate_(v[COL.END_DATE - 1]) || startDate;        // blank => single-day
  if (startDate && endDate && endDate < startDate) endDate = startDate; // guard typos

  var startTime = v[COL.START_TIME - 1];
  var endTime = v[COL.END_TIME - 1];
  var allDay = !startTime;
  var multiDay = !!(startDate && endDate && endDate > startDate);

  // Resolved start/end as datetimes (for timed events).
  var start = startDate;
  var end = null;
  if (startDate && !allDay) {
    start = combine(startDate, startTime);
    end = endTime ? combine(endDate, endTime) : new Date(start.getTime() + 60 * 60 * 1000);
    if (end <= start) end = new Date(start.getTime() + 60 * 60 * 1000);
  }

  var repeat = String(v[COL.REPEAT - 1] || 'None').trim();
  if (repeat.toLowerCase() === 'none' || repeat === '') repeat = 'None';
  var repeatUntil = toDate_(v[COL.REPEAT_UNTIL - 1]);

  return {
    title: title,
    startDate: startDate,
    endDate: endDate,
    allDay: allDay,
    multiDay: multiDay,
    start: start,                 // datetime (timed) or startDate (all-day)
    end: end,                     // datetime (timed) or null (all-day)
    location: String(v[COL.LOCATION - 1] || '').trim(),
    description: String(v[COL.DESCRIPTION - 1] || '').trim(),
    repeat: repeat,
    repeatUntil: repeatUntil
  };
}

/** Coerce a sheet cell into a valid Date, or null. */
function toDate_(val) {
  var d = val instanceof Date ? val : (val ? new Date(val) : null);
  return (d && !isNaN(d.getTime())) ? d : null;
}

/** All-day events use an EXCLUSIVE end date — return endDate + 1 day. */
function exclusiveEnd_(endDate) {
  var d = new Date(endDate.getTime());
  d.setDate(d.getDate() + 1);
  return d;
}

/** Combine a date cell with a time cell (Date, "6:30 PM", or "18:30"). */
function combine(date, time) {
  var d = new Date(date.getTime());
  if (time instanceof Date) {
    d.setHours(time.getHours(), time.getMinutes(), 0, 0);
    return d;
  }
  var s = String(time).trim().toUpperCase();
  var mer = s.indexOf('PM') >= 0 ? 'PM' : (s.indexOf('AM') >= 0 ? 'AM' : null);
  s = s.replace(/AM|PM/g, '').trim();
  var parts = s.split(':');
  var hh = parseInt(parts[0], 10) || 0;
  var mm = parseInt(parts[1], 10) || 0;
  if (mer === 'PM' && hh < 12) hh += 12;   // 6 PM -> 18
  if (mer === 'AM' && hh === 12) hh = 0;   // 12 AM -> 0
  d.setHours(hh, mm, 0, 0);
  return d;
}

function contentHash(ev) {
  var parts = [
    ev.title,
    ev.startDate ? ev.startDate.getTime() : '',
    ev.endDate ? ev.endDate.getTime() : '',
    ev.start ? ev.start.getTime() : '',
    ev.end ? ev.end.getTime() : '',
    ev.allDay,
    ev.multiDay,
    ev.location,
    ev.description,
    ev.repeat,
    ev.repeatUntil ? ev.repeatUntil.getTime() : ''
  ].join('|');
  var bytes = Utilities.computeDigest(Utilities.DigestAlgorithm.MD5, parts);
  return bytes.map(function (b) {
    return ('0' + (b & 0xff).toString(16)).slice(-2);
  }).join('');
}


/**
 * Read the tab → calendar mapping straight from CONFIG_ROWS (defined in the
 * generated Committees.gs). No _Config tab needed — the Calendar IDs are baked
 * into the script. Returns { committeeTabName: {calendarId, color, icalUrl, subscribeUrl} }.
 */
function readConfig() {
  var map = {};
  if (typeof CONFIG_ROWS === 'undefined') {
    throw new Error('Missing Committees.gs (CONFIG_ROWS). Paste this sheet\'s Committees.*.gs.');
  }
  for (var i = 0; i < CONFIG_ROWS.length; i++) {
    var r = CONFIG_ROWS[i];
    var name = String(r[0] || '').trim();
    var calendarId = String(r[1] || '').trim();
    if (!name || !calendarId) continue;
    map[name] = {
      calendarId: calendarId,
      color: String(r[2] || '').trim(),
      icalUrl: String(r[3] || '').trim(),
      subscribeUrl: String(r[4] || '').trim()
    };
  }
  return map;
}
