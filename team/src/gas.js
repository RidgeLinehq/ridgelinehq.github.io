/*
 * Ridgeline Wash Co. team system: the Google Apps Script host.
 *
 * RidgelineCore (above, in this same file) holds every rule. This part only gives it what it
 * needs to run on Google: a Google Sheet to keep the data in, the clock, email, a lock so two
 * phones can never write at the same moment, and the web address the phones talk to.
 *
 * Two functions are run by hand from the editor's function menu:
 *   setup          once, the first time. Safe to run again: it never wipes data or changes a PIN.
 *   resetOwnerPin  only when the owner has forgotten the PIN.
 * doPost and doGet are called by the app. Every other function ends in an underscore, which
 * keeps it out of the function menu.
 *
 * Nothing is remembered between requests. Each one opens the sheet by its id, builds a fresh
 * store, does its work, saves, and ends.
 */

/* The only things you might ever change. */
var OWNER_NAME = 'Grayson';
var TIME_ZONE = 'America/Chicago';
var SHEET_TITLE = 'Ridgeline Wash Co. Team Data';

/* Google's limits, and how long a request waits for its turn to write. */
var CELL_MAX_CHARS = 50000;      /* the most text one cell of a Google Sheet can hold */
var CACHE_MAX_SECONDS = 21600;   /* the longest the cache keeps anything (6 hours) */
var CACHE_MAX_KEY = 250;
var CACHE_MAX_VALUE = 30000;     /* characters; Google's limit is 100 KB */
var REV_SEEN_SECONDS = 120;      /* how long a looked-up copy of the revision number stays in the cache */
var REV_CACHE_SECONDS = 150;     /* the same for the copy a save leaves there; it has to be the longer of the two */
var LOCK_WAIT_MS = 15000;
var SETUP_LOCK_WAIT_MS = 30000;
var SAVE_TRIES = 3;
var EMAIL_PREFIX = 'Ridgeline Wash Co.: ';
var HEADER = ['id', 'json'];

/* ---------- the web address the phones talk to ---------- */

/* Every call from the app lands here. Whatever happens, the answer is JSON the phone can read. */
function doPost(e) {
  var answer;
  try {
    answer = answerPost_(e);
  } catch (err) {
    log_('A request failed: ' + errorText_(err));
    answer = serverError_();
  }
  return json_(answer);
}

/* Opening the web app link in a browser shows this, which proves the link works. */
function doGet() {
  return json_({ ok: true, service: 'ridgeline-wash-team', version: RidgelineCore.VERSION });
}

function json_(answer) {
  return ContentService.createTextOutput(JSON.stringify(answer)).setMimeType(ContentService.MimeType.JSON);
}

function serverError_() {
  return { ok: false, error: { code: 'server', message: 'Something went wrong on our side. Nothing was saved. Try again.' } };
}

function busy_() {
  return { ok: false, error: { code: 'busy', message: 'The system is busy. Try again in a moment.' } };
}

function badRequest_() {
  return { ok: false, error: { code: 'invalid', message: 'Bad request.' } };
}

function answerPost_(e) {
  /* The page sends its JSON as plain text, so it arrives here as one string. */
  var text = e && e.postData && typeof e.postData.contents === 'string' ? e.postData.contents : '';
  var req = null;
  try { req = JSON.parse(text); } catch (err) { req = null; }
  if (!req || typeof req !== 'object' || Array.isArray(req) || typeof req.action !== 'string') return badRequest_();

  /* A ping touches nothing, so it needs no lock. */
  if (req.action === 'ping') return RidgelineCore.create(newStore_(), newEnv_()).handle(req);

  /* "Has anything changed?" is asked by every phone every few seconds. When the answer is no,
     it is given without the lock and without opening the sheet. */
  if (req.action === 'sync') {
    var same = answerIfNothingChanged_(req);
    if (same) return same;
  }

  /* Everything else takes its turn, one request at a time. This is what makes a double booking
     impossible: the second request only looks at the calendar after the first has saved. */
  var lock = LockService.getScriptLock();
  if (!lock.tryLock(LOCK_WAIT_MS)) return busy_();
  try {
    return answerLocked_(req);
  } finally {
    release_(lock);
  }
}

/*
 * The only thing this may ever answer is "nothing changed" to someone who is signed in. Any
 * other outcome (signed out, a new day, an error) is thrown away and the request is run again
 * properly, under the lock.
 *
 * This is the one place that takes the revision number from the cache (newStore_(true)), so
 * that a phone asking every 20 seconds does not use up Google's daily allowance of property
 * reads. See quickRev in the store for why that copy can be trusted.
 */
function answerIfNothingChanged_(req) {
  var store = newStore_(true), env = newEnv_();
  if (req.since !== store.getRev() || req.day !== env.dayKey(env.now())) return null;
  var res = RidgelineCore.create(store, env).handle(req);
  if (res && res.ok === true && res.sync && res.sync.same === true && !store.hasChanges()) return res;
  return null;
}

/* Runs one request while holding the lock. The store is built here, after the lock was taken,
   so everything it reads is the latest (the revision number comes from the property itself). */
function answerLocked_(req) {
  var store = newStore_(), env = newEnv_(), core = RidgelineCore.create(store, env), res;
  try {
    res = core.handle(req);
    /* "Something went wrong" promises that nothing was saved, so make that true: drop whatever
       the failed action had changed and keep only the note about the problem. */
    if (res && res.ok === false && res.error && res.error.code === 'server') store.keepOnlyProblems();
    store.reportUnreadableRows(env);
    store.flush();
  } catch (err) {
    /* Saving failed. Forget what this request put in the cache, so a retry is run for real
       instead of being answered from memory. */
    try { store.forgetCache(); } catch (ignore) { /* the cache empties itself in time */ }
    throw err;
  }
  /* Everything is saved. Only now do the alert emails the action asked for go out. A save that
     failed never gets this far, so it never emails, and its retry emails once. */
  var mail = env.takeOutbox();
  if (res && res.ok === true && mail.length) sendMail_(mail, core, store);
  return res;
}

/*
 * Sends the emails an action asked for. The action is already saved, so an email that cannot
 * be sent must neither undo it nor fail it. The owner still has to find out, so it goes on the
 * problems list the app shows, which takes one more small save.
 */
function sendMail_(mail, core, store) {
  var failed = [], i;
  for (i = 0; i < mail.length; i++) {
    try {
      MailApp.sendEmail(mail[i].to || ownerEmail_(), EMAIL_PREFIX + mail[i].subject, mail[i].body);
    } catch (err) {
      failed.push(errorText_(err));
    }
  }
  if (!failed.length) return;
  try {
    for (i = 0; i < failed.length; i++) {
      log_('An email alert could not be sent: ' + failed[i]);
      core.recordProblem('email', 'An email alert could not be sent: ' + failed[i]);
    }
    store.flush();
  } catch (err) {
    log_('That could not be added to the problems list in the app: ' + errorText_(err));
  }
}

function release_(lock) {
  try { lock.releaseLock(); } catch (ignore) { /* Google lets go of it when the request ends */ }
}

/* ---------- the store: one tab per collection in the Google Sheet ---------- */

/*
 * Row 1 of every tab is the header (id, json). Every other row is one record: column A is its
 * id (for people reading the sheet) and column B is the whole record as JSON. Only column B is
 * trusted when reading.
 *
 * A tab is read at most once per request and kept in memory. put and del change that memory
 * and mark the tab; flush() then rewrites each marked tab in one go.
 *
 * quick: true only for the "nothing changed?" check, which runs without the lock and may take
 * the revision number from the cache. Every other request holds the lock and reads the property.
 */
function newStore_(quick) {
  var props = PropertiesService.getScriptProperties();
  var cache = CacheService.getScriptCache();
  var book = null;         /* the spreadsheet, opened the first time a tab is needed */
  var tabs = {};           /* collection name -> what this request has read and changed */
  var savedRev = null;     /* the revision number as Script Properties has it */
  var rev = null;          /* the revision number this request wants to save, if it changed it */
  var cacheKeys = [];      /* cache keys this request has written */

  function open() {
    if (book) return book;
    var id = props.getProperty('SHEET_ID');
    if (!id) throw new Error('The data sheet has not been set up yet. Run setup first.');
    book = twice_(function () { return SpreadsheetApp.openById(id); });
    return book;
  }

  function load(coll) {
    if (RidgelineCore.COLLECTIONS.indexOf(coll) < 0) throw new Error('There is no "' + coll + '" tab.');
    if (tabs[coll]) return tabs[coll];
    var sheet = open().getSheetByName(coll);
    /* lastRow: how far down the tab has anything in it. ids: the records in sheet order.
       json: id -> the record's JSON text. junk: rows that could not be read, kept as they are. */
    var t = { name: coll, sheet: sheet, lastRow: 0, ids: [], json: Object.create(null), junk: [], dirty: false };
    if (sheet) {
      /* getDataRange is never empty: a blank sheet gives one blank cell. */
      var values = twice_(function () { return sheet.getDataRange().getValues(); });
      t.lastRow = values.length;
      for (var i = 0; i < values.length; i++) {
        var a = values[i].length > 0 ? cellText_(values[i][0]) : '';
        var b = values[i].length > 1 ? cellText_(values[i][1]) : '';
        /* The header is skipped wherever it is: sorting the tab by hand can move it off row 1. */
        if (a === HEADER[0] && b === HEADER[1]) continue;
        if (!b.trim()) continue;
        var id = recordId_(b);
        if (id === null) { t.junk.push([a, b]); continue; }
        if (!(id in t.json)) t.ids.push(id);
        t.json[id] = b;
      }
    }
    tabs[coll] = t;
    return t;
  }

  function list(coll) {
    var t = load(coll), out = [];
    for (var i = 0; i < t.ids.length; i++) out.push(JSON.parse(t.json[t.ids[i]]));
    return out;
  }

  function put(coll, doc) {
    if (!doc || typeof doc.id !== 'string' || !doc.id) throw new Error('A record for the "' + coll + '" tab has no id.');
    var text = JSON.stringify(doc);
    if (text.length > CELL_MAX_CHARS) {
      throw new Error('A record in the "' + coll + '" tab has grown too big to save (more than ' + CELL_MAX_CHARS + ' characters).');
    }
    var t = load(coll);
    if (!(doc.id in t.json)) t.ids.push(doc.id);
    t.json[doc.id] = text;
    t.dirty = true;
  }

  function del(coll, id) {
    var t = load(coll), key = String(id);
    if (!(key in t.json)) return;
    delete t.json[key];
    t.ids.splice(t.ids.indexOf(key), 1);
    t.dirty = true;
  }

  function readRev() {
    if (savedRev === null) savedRev = quick ? quickRev() : propertyRev();
    return savedRev;
  }

  function propertyRev() { return parseInt(props.getProperty('REV'), 10) || 0; }

  /*
   * The revision number without the lock, and nearly always without reading the property.
   * Google allows only so many property reads a day, and every open phone asks "anything
   * new?" every 20 seconds. So two copies are kept in the cache:
   *   rev:seen   put there by this function when it found neither and had to read REV (120 seconds)
   *   rev        put there by whoever writes REV, while still holding the lock (150 seconds)
   * So in a quiet spell REV is read once every two minutes, however many phones are asking.
   * A save puts rev and takes rev:seen out, so after a save the cache holds the new number and
   * nothing else. One thing can still slip in: a check that read REV just before the save and
   * stores its copy just after it. That is why rev is looked at first and rev:seen only when
   * rev is gone, and why rev is the longer lived: the save's copy is the one that gets read,
   * and it outlasts the late one by 30 seconds. (Only a check that stalled longer than that
   * between its two steps could leave an old number to be read, for two minutes at most.
   * Nothing is ever decided from it: bookings and saves hold the lock and read the property.)
   */
  function quickRev() {
    var n = cachedRev('rev');
    if (n === null) n = cachedRev('rev:seen');
    if (n !== null) return n;
    n = propertyRev();
    try { cache.put('rev:seen', String(n), REV_SEEN_SECONDS); } catch (ignore) { /* the next check reads the property again */ }
    return n;
  }

  function cachedRev(key) {
    var value = null;
    try { value = cache.get(key); } catch (ignore) { /* the same as not being there */ }
    return typeof value === 'string' && /^\d+$/.test(value) ? parseInt(value, 10) : null;
  }

  /* Called right after REV is written, under the lock: the new number goes in the cache and a
     looked-up copy of the old one comes out. If that cannot be done, no copy may stay at all. */
  function rememberRev(n) {
    try {
      cache.put('rev', String(n), REV_CACHE_SECONDS);
      cache.remove('rev:seen');
    } catch (err) {
      try { cache.removeAll(['rev', 'rev:seen']); } catch (ignore) { /* both are gone within three minutes anyway */ }
    }
  }

  function getRev() { return rev === null ? readRev() : rev; }

  function setRev(n) {
    if (typeof n !== 'number' || !isFinite(n)) throw new Error('The revision number has to be a number.');
    rev = n;
  }

  /* Rewrites one tab: the header, every record, the rows nobody could read, then blank rows
     down to where the tab used to end, so a removed record disappears in the same write. */
  function writeTab(t) {
    if (!t.sheet) t.sheet = makeTab_(open(), t.name);
    var rows = [[HEADER[0], HEADER[1]]], i;
    for (i = 0; i < t.ids.length; i++) rows.push([t.ids[i], t.json[t.ids[i]]]);
    for (i = 0; i < t.junk.length; i++) rows.push([t.junk[i][0], t.junk[i][1]]);
    var used = rows.length;
    while (rows.length < t.lastRow) rows.push(['', '']);
    var max = t.sheet.getMaxRows();
    if (max < rows.length) t.sheet.insertRowsAfter(max, rows.length - max);
    /* Plain text first, or Sheets would turn an id like 2026-11-19 into a date. */
    t.sheet.getRange(1, 1, rows.length, 2).setNumberFormat('@').setValues(rows);
    return used;
  }

  function save() {
    var names = RidgelineCore.COLLECTIONS, written = [], i, t;
    for (i = 0; i < names.length; i++) {
      t = tabs[names[i]];
      if (t && t.dirty) written.push({ tab: t, used: writeTab(t) });
    }
    /* Sheets holds writes back until told to send them. Send them, and only count a tab as
       saved once that has worked. */
    if (written.length) SpreadsheetApp.flush();
    for (i = 0; i < written.length; i++) {
      written[i].tab.dirty = false;
      written[i].tab.lastRow = written[i].used;
    }
    /* The revision number goes last, so nobody is ever told "there is something new" before
       the new data is really there. Then the cache's copy of it, so the very next "anything
       new?" check sees the new number. */
    if (rev !== null && rev !== readRev()) {
      props.setProperty('REV', String(rev));
      savedRev = rev;
      rememberRev(rev);
    }
    rev = null;
  }

  function flush() {
    for (var tries = 1; ; tries++) {
      try {
        save();
        return;
      } catch (err) {
        if (tries >= SAVE_TRIES) {
          /* Some tabs may have been written and others not. Make every phone reload what is
             really in the sheet. */
          if (rev !== null) { try { props.setProperty('REV', String(rev)); rememberRev(rev); } catch (ignore) { /* nothing more to try */ } }
          throw err;
        }
        Utilities.sleep(tries * 500);
      }
    }
  }

  function hasChanges() {
    for (var name in tabs) if (Object.prototype.hasOwnProperty.call(tabs, name) && tabs[name].dirty) return true;
    return rev !== null && rev !== readRev();
  }

  function forgetCache() {
    if (!cacheKeys.length) return;
    var keys = cacheKeys;
    cacheKeys = [];
    cache.removeAll(keys);
  }

  /* Undo everything this request changed except the problems list. */
  function keepOnlyProblems() {
    var keep = tabs.problems;
    tabs = {};
    rev = null;
    if (keep && keep.dirty) {
      tabs.problems = keep;
      rev = readRev() + 1;
    }
    forgetCache();
  }

  /* A row someone changed by hand so it no longer reads as a record is skipped, never deleted.
     Tell the owner once, through the same problems list the app already shows. */
  function reportUnreadableRows(env) {
    try {
      var names = RidgelineCore.COLLECTIONS, i, j;
      for (i = 0; i < names.length; i++) {
        var t = tabs[names[i]];
        if (!t || !t.junk.length) continue;
        var one = t.junk.length === 1;
        var message = (one ? '1 row' : t.junk.length + ' rows') + ' in the "' + t.name + '" tab of the data sheet could not be read and ' +
          (one ? 'is' : 'are') + ' being skipped. Nothing was deleted. It was probably changed by hand.';
        var known = list('problems'), told = false;
        for (j = 0; j < known.length; j++) if (known[j].message === message) told = true;
        if (told) continue;
        put('problems', { id: 'p_' + String(env.uuid()).replace(/[^a-zA-Z0-9]/g, '').slice(0, 14), at: env.now(), where: 'data sheet', message: message });
        setRev(getRev() + 1);
      }
    } catch (err) {
      log_('Could not report unreadable rows: ' + errorText_(err));
    }
  }

  return {
    list: list,
    put: put,
    del: del,
    getRev: getRev,
    setRev: setRev,
    cacheGet: function (key) {
      key = String(key);
      if (key.length > CACHE_MAX_KEY) return null;
      var value = cache.get(key);
      return value === null || value === undefined ? null : String(value);
    },
    cachePut: function (key, value, ttlSeconds) {
      key = String(key);
      value = String(value);
      /* The cache only ever saves time. Something too big for it is simply not kept. */
      if (key.length > CACHE_MAX_KEY || value.length > CACHE_MAX_VALUE) return;
      var seconds = Math.floor(Number(ttlSeconds));
      if (!(seconds >= 1)) seconds = 1;
      if (seconds > CACHE_MAX_SECONDS) seconds = CACHE_MAX_SECONDS;
      cache.put(key, value, seconds);
      cacheKeys.push(key);
    },
    cacheDel: function (key) {
      key = String(key);
      if (key.length > CACHE_MAX_KEY) return;
      cache.remove(key);
    },
    flush: flush,
    hasChanges: hasChanges,
    forgetCache: forgetCache,
    keepOnlyProblems: keepOnlyProblems,
    reportUnreadableRows: reportUnreadableRows
  };
}

/* A new tab, with columns A and B formatted as plain text. Whoever asked for it writes the header. */
function makeTab_(book, name) {
  var sheet = book.insertSheet(name);
  sheet.getRange(1, 1, sheet.getMaxRows(), 2).setNumberFormat('@');
  return sheet;
}

/* Reading is safe to repeat, so a hiccup at Google's end gets one more try before anyone hears of it. */
function twice_(read) {
  try {
    return read();
  } catch (err) {
    Utilities.sleep(300);
    return read();
  }
}

function cellText_(value) {
  if (typeof value === 'string') return value;
  return value === null || value === undefined ? '' : String(value);
}

/* The id inside a row's JSON, or null when the row is not a record. */
function recordId_(text) {
  var doc;
  try { doc = JSON.parse(text); } catch (err) { return null; }
  if (!doc || typeof doc !== 'object' || Array.isArray(doc) || typeof doc.id !== 'string' || !doc.id) return null;
  return doc.id;
}

/* ---------- the env: clock, ids and email ---------- */

function newEnv_() {
  var outbox = [];   /* emails the core has asked for during this request, not sent yet */
  return {
    now: function () { return new Date().getTime(); },
    dayKey: function (ms) { return Utilities.formatDate(new Date(ms), TIME_ZONE, 'yyyy-MM-dd'); },
    hm: function (ms) { return Utilities.formatDate(new Date(ms), TIME_ZONE, 'HH:mm'); },
    uuid: function () { return Utilities.getUuid(); },
    /* The core asks for an email in the middle of an action, before anything is saved. It is
       only kept here; answerLocked_ sends it after the save. Nothing is ever emailed for a
       save that failed. */
    notify: function (msg) {
      outbox.push({ to: msg && msg.to ? String(msg.to) : '', subject: String(msg && msg.subject), body: String(msg && msg.body) });
    },
    takeOutbox: function () {
      var mail = outbox;
      outbox = [];
      return mail;
    }
  };
}

/* The web app runs as the person who deployed it, so the "effective user" is the owner. */
function ownerEmail_() {
  return PropertiesService.getScriptProperties().getProperty('OWNER_EMAIL') || Session.getEffectiveUser().getEmail();
}

/* ---------- run by hand from the editor ---------- */

/*
 * First-time setup. Makes the Google Sheet and its tabs, makes the owner's sign-in, and emails
 * the owner the sign-in name and PIN. Running it again changes nothing and shows no PIN.
 */
function setup() {
  var lock = LockService.getScriptLock();
  if (!lock.tryLock(SETUP_LOCK_WAIT_MS)) throw new Error('The system is busy right now. Wait a minute, then run setup again.');
  try {
    var props = PropertiesService.getScriptProperties();
    var book = prepareBook_(props);
    if (!props.getProperty('OWNER_EMAIL')) {
      var email = Session.getEffectiveUser().getEmail();
      if (email) props.setProperty('OWNER_EMAIL', email);
    }
    var store = newStore_();
    var made = RidgelineCore.create(store, newEnv_()).bootstrap({ name: OWNER_NAME });
    try {
      store.flush();
    } catch (err) {
      throw new Error('Setup could not finish saving. Run setup again. If it then says your PIN was not changed and you never got one, run resetOwnerPin. (' + errorText_(err) + ')');
    }
    tellOwner_('your team system is ready', setupMessage_(made, book.getUrl()));
  } finally {
    release_(lock);
  }
}

/* For a forgotten owner PIN: makes a new one, signs the owner out everywhere, and emails it. */
function resetOwnerPin() {
  var lock = LockService.getScriptLock();
  if (!lock.tryLock(SETUP_LOCK_WAIT_MS)) throw new Error('The system is busy right now. Wait a minute, then run resetOwnerPin again.');
  try {
    var store = newStore_();
    var out = RidgelineCore.create(store, newEnv_()).resetOwnerPin();
    if (!out) throw new Error('There is no owner yet. Run setup first.');
    store.flush();
    tellOwner_('your new PIN', [
      'Your PIN was reset.',
      '',
      'Sign-in name: ' + out.name,
      'New PIN: ' + out.pin,
      '',
      'Every phone that was signed in as you has been signed out. Sign in again with the new PIN.',
      'You can change it to one you will remember after you sign in.'
    ].join('\n'));
  } finally {
    release_(lock);
  }
}

/* Opens the data sheet, or makes it the first time, and makes sure every tab is there. */
function prepareBook_(props) {
  var names = RidgelineCore.COLLECTIONS, id = props.getProperty('SHEET_ID');
  var book, spare = ['Sheet1'], i, sheet;
  if (id) {
    try {
      book = twice_(function () { return SpreadsheetApp.openById(id); });
    } catch (err) {
      /* Never quietly start a second sheet: that would leave the real data behind. */
      throw new Error('The data sheet could not be opened, so nothing was changed. Wait a minute and run setup again. (' + errorText_(err) + ')');
    }
  } else {
    book = SpreadsheetApp.create(SHEET_TITLE);
    props.setProperty('SHEET_ID', book.getId());
    spare = [];
    var first = book.getSheets();
    for (i = 0; i < first.length; i++) spare.push(first[i].getName());
  }
  for (i = 0; i < names.length; i++) {
    if (!book.getSheetByName(names[i])) makeTab_(book, names[i]).getRange(1, 1, 1, 2).setValues([[HEADER[0], HEADER[1]]]);
  }
  /* The blank tab every new spreadsheet starts with. Only removed while it is still empty. */
  for (i = 0; i < spare.length; i++) {
    sheet = book.getSheetByName(spare[i]);
    if (sheet && names.indexOf(spare[i]) < 0 && sheet.getLastRow() === 0) book.deleteSheet(sheet);
  }
  SpreadsheetApp.flush();
  return book;
}

function setupMessage_(made, sheetUrl) {
  var lines = [];
  if (made.created) {
    lines.push('Your team system is set up.', '',
      'Sign-in name: ' + made.name,
      'PIN: ' + made.pin,
      'Keep the PIN to yourself. You can change it to one you will remember after you sign in.');
  } else {
    lines.push('Your team system was already set up. Nothing was changed.', '',
      'Sign-in name: ' + made.name,
      'Your PIN was not changed. If you forgot it, pick resetOwnerPin in the script editor and tap Run.');
  }
  lines.push('',
    'Your data lives in this Google Sheet:',
    sheetUrl,
    'Look any time, but do not type in it. The app does the writing.',
    '',
    'Next step, if you have not done it yet: in the script editor tap Deploy, then New deployment. Pick Web app, set "Execute as" to Me and "Who has access" to Anyone, tap Deploy, and copy the Web app URL (it ends in /exec).');
  return lines.join('\n');
}

/* Shows the message in the editor's log first, so it is never lost, then emails it. */
function tellOwner_(subject, body) {
  log_(EMAIL_PREFIX + subject + '\n\n' + body);
  try {
    var to = ownerEmail_();
    if (!to) {
      log_('No email address was found, so this was not emailed. Everything you need is in the log above.');
      return;
    }
    MailApp.sendEmail(to, EMAIL_PREFIX + subject, body);
  } catch (err) {
    log_('The email could not be sent (' + errorText_(err) + '). Everything you need is in the log above.');
  }
}

function log_(text) {
  try { Logger.log(text); } catch (ignore) { /* logging must never break a request */ }
}

function errorText_(err) {
  return err && err.message ? String(err.message) : String(err);
}
