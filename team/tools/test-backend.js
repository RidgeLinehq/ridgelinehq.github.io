#!/usr/bin/env node
/*
 * Proves the Google Apps Script backend (team/backend/Code.gs) without Google.
 *
 *   node tools/test-backend.js                    build Code.gs, then test it
 *   node tools/test-backend.js --code other.gs    test that file instead (no build)
 *
 * It builds Code.gs, then runs it inside Node against in-memory stand-ins for the Google
 * services the backend uses (SpreadsheetApp, PropertiesService, CacheService, LockService,
 * Utilities, MailApp, ContentService, Session, Logger). The stand-ins are strict in the ways the
 * real services are: an empty sheet has getLastRow() === 0, getRange throws on zero rows or
 * outside the sheet, setValues throws on a size mismatch, a cell that is not plain text turns
 * "2026-11-19" into a date, properties only hold strings, cache entries expire, writes are held
 * back until SpreadsheetApp.flush(), and the lock can be held by someone else.
 *
 * Every run (one doPost, one setup, ...) happens in a FRESH vm context. The only thing two runs
 * share is the fake Google data, exactly like two real requests. So anything the backend tried
 * to remember in a global variable would be gone, and the tests would fail.
 *
 * Exits non-zero if anything fails.
 */
'use strict';

const assert = require('assert');
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const vm = require('vm');
const { execFileSync } = require('child_process');

const root = path.join(__dirname, '..');
/* Normally: build, then test what was built. `--code some/file.gs` tests that file instead, without building. */
const given = process.argv.indexOf('--code') > -1 ? process.argv[process.argv.indexOf('--code') + 1] : null;
if (!given) execFileSync(process.execPath, [path.join(__dirname, 'build.js'), '--backend-only'], { cwd: root, stdio: 'pipe' });
const codePath = given ? path.resolve(given) : path.join(root, 'backend', 'Code.gs');
const script = new vm.Script(fs.readFileSync(codePath, 'utf8'), { filename: 'Code.gs' });
const core = require(path.join(root, 'src', 'core.js'));

const SERVER_MESSAGE = 'Something went wrong on our side. Nothing was saved. Try again.';
const BUSY_MESSAGE = 'The system is busy. Try again in a moment.';
const ALREADY_SAVED = 'Your first try was saved. Check it, then make the change again if you still need to.';
const uid = () => crypto.randomUUID();

/* The business clock, worked out here without the backend's help, to check the clock it sends. */
const chicago = new Intl.DateTimeFormat('en-US', { timeZone: 'America/Chicago', hourCycle: 'h23', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit' });
function chicagoAt(ms) {
  const p = {};
  chicago.formatToParts(new Date(ms)).forEach((x) => { p[x.type] = x.value; });
  return { day: p.year + '-' + p.month + '-' + p.day, hm: p.hour + ':' + p.minute };
}

/* ====================================================================================
 * The fake Google
 * ==================================================================================== */

function newGoogle() {
  return {
    files: {},             // spreadsheet id -> { id, name, sheets: [sheet] }
    props: {},             // Script Properties
    cache: new Map(),      // key -> { value, until }
    cacheNow: 100000,      // the cache's clock, in seconds; tests move it forward
    lockHolder: null,      // which run holds the script lock
    mail: [],              // every email sent
    logs: [],              // every Logger.log
    fail: {},              // point -> how many times to fail there (see failIf)
    hooks: {},             // beforeLock / afterLock: run once, used to interleave two requests. onMail: run once when an email is about to go out.
                           // afterRead: { tab: fn }, run once right after that tab has been read (something else happens while a request is half way)
    tweak: null,           // (ctx) => ...: run on every fresh copy of the script before it is used, to change a limit inside the code under test
    seq: 0,
    ownerEmail: 'grayson@example.com'
  };
}

function newSheet(name) { return { name: name, maxRows: 1000, maxCols: 26, cells: new Map(), formats: new Map() }; }
const at = (r, c) => r + ':' + c;
const rowOf = (key) => +key.slice(0, key.indexOf(':'));
const colOf = (key) => +key.slice(key.indexOf(':') + 1);
function lastRow(sh) { let m = 0; for (const k of sh.cells.keys()) m = Math.max(m, rowOf(k)); return m; }
function lastCol(sh) { let m = 0; for (const k of sh.cells.keys()) m = Math.max(m, colOf(k)); return m; }
function cell(sh, r, c) { const v = sh.cells.get(at(r, c)); return v === undefined ? '' : v; }
function setCell(sh, r, c, v) { if (v === '') sh.cells.delete(at(r, c)); else sh.cells.set(at(r, c), v); }
const isDate = (v) => Object.prototype.toString.call(v) === '[object Date]';

/* What Sheets does to a value typed into a cell. Plain-text cells ('@') keep strings as they are. */
function typed(value, format) {
  if (isDate(value)) return new Date(value.getTime());
  if (typeof value === 'number' || typeof value === 'boolean') return format === '@' ? String(value) : value;
  if (format === '@' || value === '') return value;
  if (/^\d{4}-\d{1,2}-\d{1,2}$/.test(value)) return new Date(value + 'T00:00:00');
  if (/^[+-]?\d+(\.\d+)?([eE][+-]?\d+)?$/.test(value)) return Number(value);
  if (/^(true|false)$/i.test(value)) return value.toLowerCase() === 'true';
  if (value[0] === '=') return '#ERROR!';
  if (value[0] === "'") return value.slice(1);
  return value;
}

function services(G, run) {
  const log = (s) => run.calls.push(s);
  const failIf = (point) => {
    if (G.fail[point] > 0) {
      G.fail[point]--;
      log('FAILED ' + point);
      throw new Error('Service error: Spreadsheets (made to fail by the test at ' + point + ')');
    }
  };
  const send = () => { const p = run.pending; run.pending = []; p.forEach((f) => f()); };
  const int = (n) => typeof n === 'number' && Number.isInteger(n);
  const backing = new WeakMap();

  function rangeApi(sh, row, col, numRows, numCols) {
    const api = {
      getNumRows: () => numRows,
      getNumColumns: () => numCols,
      getValues() {
        failIf('sheet.read:' + sh.name);
        send();
        log('sheet.read:' + sh.name);
        const out = [];
        for (let i = 0; i < numRows; i++) {
          const line = [];
          for (let j = 0; j < numCols; j++) line.push(cell(sh, row + i, col + j));
          out.push(line);
        }
        const then = G.hooks.afterRead && G.hooks.afterRead[sh.name];
        if (then) { delete G.hooks.afterRead[sh.name]; then(); }
        return out;
      },
      setValues(values) {
        if (!Array.isArray(values) || values.length !== numRows) {
          throw new Error('The number of rows in the data does not match the number of rows in the range. The data has ' +
            (Array.isArray(values) ? values.length : 'no rows') + ' but the range has ' + numRows + '.');
        }
        values.forEach((line) => {
          if (!Array.isArray(line) || line.length !== numCols) {
            throw new Error('The number of columns in the data does not match the number of columns in the range. The data has ' +
              (Array.isArray(line) ? line.length : 'no columns') + ' but the range has ' + numCols + '.');
          }
          line.forEach((v) => {
            if (!(typeof v === 'string' || typeof v === 'number' || typeof v === 'boolean' || isDate(v))) {
              throw new Error('Cannot put a ' + (v === null ? 'null' : typeof v) + ' in a cell.');
            }
            if (typeof v === 'string' && v.length > 50000) throw new Error('Your input contains more than the maximum of 50000 characters in a single cell.');
          });
        });
        failIf('sheet.write:' + sh.name);
        log('sheet.write:' + sh.name);
        const copy = values.map((line) => line.slice());
        run.pending.push(() => {
          for (let i = 0; i < numRows; i++) {
            for (let j = 0; j < numCols; j++) {
              setCell(sh, row + i, col + j, typed(copy[i][j], sh.formats.get(at(row + i, col + j)) || 'General'));
            }
          }
        });
        return api;
      },
      setNumberFormat(format) {
        if (typeof format !== 'string' || !format) throw new Error('setNumberFormat needs a format string.');
        log('sheet.format:' + sh.name);
        run.pending.push(() => {
          for (let i = 0; i < numRows; i++) for (let j = 0; j < numCols; j++) sh.formats.set(at(row + i, col + j), format);
        });
        return api;
      }
    };
    return api;
  }

  function sheetApi(sh) {
    const api = {
      getName: () => sh.name,
      getLastRow() { send(); return lastRow(sh); },
      getLastColumn() { send(); return lastCol(sh); },
      getMaxRows: () => sh.maxRows,
      getMaxColumns: () => sh.maxCols,
      getRange(row, col, numRows, numCols) {
        if (numRows === undefined) numRows = 1;
        if (numCols === undefined) numCols = 1;
        if (![row, col, numRows, numCols].every(int)) throw new Error('The parameters do not match the method signature for Sheet.getRange (whole numbers only in this fake).');
        if (row < 1 || col < 1) throw new Error('The starting row and column of the range must be at least 1.');
        if (numRows < 1) throw new Error('The number of rows in the range must be at least 1.');
        if (numCols < 1) throw new Error('The number of columns in the range must be at least 1.');
        if (row + numRows - 1 > sh.maxRows || col + numCols - 1 > sh.maxCols) throw new Error('The coordinates of the range are outside the dimensions of the sheet.');
        return rangeApi(sh, row, col, numRows, numCols);
      },
      /* A1 down to the last row and column with anything in them; one blank cell for an empty sheet. */
      getDataRange() { send(); return rangeApi(sh, 1, 1, Math.max(1, lastRow(sh)), Math.max(1, lastCol(sh))); },
      insertRowsAfter(after, howMany) {
        if (!int(after) || !int(howMany)) throw new Error('insertRowsAfter needs whole numbers.');
        if (after < 1 || after > sh.maxRows) throw new Error('Those rows are out of bounds.');
        if (howMany < 1) throw new Error('The number of rows to insert must be at least 1.');
        send();
        log('sheet.insertRows:' + sh.name);
        const cells = new Map(), formats = new Map();
        for (const [k, v] of sh.cells) cells.set(rowOf(k) > after ? at(rowOf(k) + howMany, colOf(k)) : k, v);
        /* Pessimistic on purpose: the new rows do NOT take the plain-text format of their neighbours. */
        for (const [k, v] of sh.formats) formats.set(rowOf(k) > after ? at(rowOf(k) + howMany, colOf(k)) : k, v);
        sh.cells = cells;
        sh.formats = formats;
        sh.maxRows += howMany;
        return api;
      }
    };
    backing.set(api, sh);
    return api;
  }

  function bookApi(file) {
    return {
      getId: () => file.id,
      getName: () => file.name,
      getUrl: () => 'https://docs.google.com/spreadsheets/d/' + file.id + '/edit',
      getNumSheets: () => file.sheets.length,
      getSheets: () => file.sheets.map(sheetApi),
      getSheetByName(name) {
        if (typeof name !== 'string') throw new Error('getSheetByName needs a name.');
        const sh = file.sheets.find((s) => s.name === name);
        return sh ? sheetApi(sh) : null;
      },
      insertSheet(name) {
        if (typeof name !== 'string' || !name) throw new Error('This fake needs insertSheet(name).');
        if (file.sheets.some((s) => s.name === name)) throw new Error('A sheet with the name "' + name + '" already exists. Please enter another name.');
        log('ss.insertSheet:' + name);
        const sh = newSheet(name);
        file.sheets.push(sh);
        return sheetApi(sh);
      },
      deleteSheet(sheet) {
        const sh = backing.get(sheet);
        if (!sh || file.sheets.indexOf(sh) < 0) throw new Error('deleteSheet needs a sheet of this spreadsheet.');
        if (file.sheets.length === 1) throw new Error("You can't remove all the sheets in a document.");
        send();
        log('ss.deleteSheet:' + sh.name);
        file.sheets.splice(file.sheets.indexOf(sh), 1);
      }
    };
  }

  const globals = {
    SpreadsheetApp: {
      create(name) {
        if (typeof name !== 'string' || !name) throw new Error('create needs a name.');
        log('ss.create');
        const file = { id: 'sheet' + crypto.randomBytes(8).toString('hex'), name: name, sheets: [newSheet('Sheet1')] };
        G.files[file.id] = file;
        return bookApi(file);
      },
      openById(id) {
        failIf('ss.open');
        log('ss.open');
        if (typeof id !== 'string' || !G.files[id]) throw new Error('Document ' + id + ' is missing (perhaps it was deleted, or you don\'t have read access?)');
        return bookApi(G.files[id]);
      },
      flush() {
        if (G.fail['ss.flush'] > 0) run.pending = [];   // a failed send loses what was waiting
        failIf('ss.flush');
        send();
        log('ss.flush');
      },
      getActiveSpreadsheet: () => null,   // there is none in a standalone web app
      getUi() { throw new Error('Cannot call SpreadsheetApp.getUi() from this context.'); }
    },

    PropertiesService: {
      getScriptProperties() {
        return {
          getProperty(key) {
            if (typeof key !== 'string') throw new Error('getProperty needs a string key.');
            log('props.get:' + key);
            return Object.prototype.hasOwnProperty.call(G.props, key) ? G.props[key] : null;
          },
          setProperty(key, value) {
            if (typeof key !== 'string' || typeof value !== 'string') throw new Error('Script Properties only hold strings (got ' + typeof value + ' for ' + key + ').');
            failIf('props.set:' + key);
            log('props.set:' + key);
            G.props[key] = value;
          },
          deleteProperty(key) { log('props.delete:' + key); delete G.props[key]; }
        };
      }
    },

    CacheService: {
      getScriptCache() {
        const checkKey = (key) => {
          if (typeof key !== 'string') throw new Error('Cache keys are strings.');
          if (key.length > 250) throw new Error('Argument too large: key');
        };
        return {
          get(key) {
            checkKey(key);
            log('cache.get:' + key);
            const e = G.cache.get(key);
            if (!e) return null;
            if (e.until <= G.cacheNow) { G.cache.delete(key); return null; }
            return e.value;
          },
          put(key, value, seconds) {
            checkKey(key);
            if (typeof value !== 'string') throw new Error('Cache values are strings.');
            if (Buffer.byteLength(value, 'utf8') > 100 * 1024) throw new Error('Argument too large: value');
            if (seconds === undefined) seconds = 600;
            if (!int(seconds) || seconds < 1 || seconds > 21600) throw new Error('Cache expiration must be a whole number of seconds from 1 to 21600 (got ' + seconds + ').');
            failIf('cache.put');
            failIf('cache.put:' + key);
            log('cache.put:' + key);
            G.cache.set(key, { value: value, until: G.cacheNow + seconds });
          },
          remove(key) { checkKey(key); log('cache.remove:' + key); G.cache.delete(key); },
          removeAll(keys) {
            if (!Array.isArray(keys)) throw new Error('removeAll needs a list of keys.');
            keys.forEach((key) => { checkKey(key); log('cache.remove:' + key); G.cache.delete(key); });
          }
        };
      }
    },

    LockService: {
      getScriptLock() {
        return {
          /* The real one waits up to `ms`. Nothing else runs while a fake request runs, so this
             one answers at once; the hooks let a test run another request "in the meantime". */
          tryLock(ms) {
            if (typeof ms !== 'number' || !(ms > 0)) throw new Error('tryLock needs a wait time in milliseconds.');
            log('lock.try:' + ms);
            const before = G.hooks.beforeLock;
            if (before) { G.hooks.beforeLock = null; before(); }
            if (G.lockHolder !== null && G.lockHolder !== run.id) return false;
            G.lockHolder = run.id;
            log('lock.acquire');
            const after = G.hooks.afterLock;
            if (after) { G.hooks.afterLock = null; after(); }
            return true;
          },
          releaseLock() {
            if (G.lockHolder === run.id) G.lockHolder = null;
            log('lock.release');
          },
          hasLock: () => G.lockHolder === run.id
        };
      }
    },

    Utilities: {
      formatDate(date, timeZone, format) {
        if (!date || typeof date.getTime !== 'function' || isNaN(date.getTime())) throw new Error('formatDate needs a real date.');
        if (typeof timeZone !== 'string' || typeof format !== 'string') throw new Error('formatDate needs a time zone and a format.');
        const parts = {};
        new Intl.DateTimeFormat('en-US', { timeZone: timeZone, hourCycle: 'h23', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit' })
          .formatToParts(new Date(date.getTime())).forEach((p) => { parts[p.type] = p.value; });
        if (format === 'yyyy-MM-dd') return parts.year + '-' + parts.month + '-' + parts.day;
        if (format === 'HH:mm') return parts.hour + ':' + parts.minute;
        throw new Error('This fake only knows the formats yyyy-MM-dd and HH:mm (got ' + format + ').');
      },
      getUuid: () => crypto.randomUUID(),
      sleep(ms) {
        if (typeof ms !== 'number' || !(ms >= 0)) throw new Error('sleep needs milliseconds.');
        log('sleep:' + ms);
      }
    },

    MailApp: {
      sendEmail(to, subject, body) {
        if (arguments.length !== 3 || typeof to !== 'string' || typeof subject !== 'string' || typeof body !== 'string') {
          throw new Error('This fake needs sendEmail(to, subject, body), all strings.');
        }
        if (!/^[^\s@]+@[^\s@]+$/.test(to)) throw new Error('Failed to send email: no recipient');
        const onMail = G.hooks.onMail;
        if (onMail) { G.hooks.onMail = null; onMail(); }
        if (G.fail.mail > 0) { G.fail.mail--; log('FAILED mail'); throw new Error('Service invoked too many times for one day: email.'); }
        log('mail');
        G.mail.push({ to: to, subject: subject, body: body });
      }
    },

    ContentService: {
      MimeType: { JSON: 'JSON', TEXT: 'TEXT' },
      createTextOutput(text) {
        if (typeof text !== 'string') throw new Error('createTextOutput needs text.');
        let mime = 'TEXT';
        const out = {
          isFakeTextOutput: true,
          setMimeType(m) { if (m !== 'JSON' && m !== 'TEXT') throw new Error('Unknown mime type.'); mime = m; return out; },
          getContent: () => text,
          getMimeType: () => mime
        };
        return out;
      }
    },

    /* getActiveUser is left out on purpose: it is empty for visitors and must not be used. */
    Session: { getEffectiveUser: () => ({ getEmail: () => G.ownerEmail }) },

    Logger: { log(text) { G.logs.push(String(text)); } }
  };

  return { globals: globals, end: send };
}

/* ====================================================================================
 * Running things the way Google would
 * ==================================================================================== */

/* The rules every run must keep, read off the list of Google calls it made. */
function checkRun(r, opts) {
  opts = opts || {};
  assert(!r.leaked, 'the lock was still held when the run ended (releaseLock was never called)');
  let held = false, unsent = false, revWrites = 0;
  const reads = {}, writes = {};
  r.calls.forEach((c) => {
    if (c === 'lock.acquire') held = true;
    else if (c === 'lock.release') { assert(!unsent, 'the lock was released before the writes were sent with SpreadsheetApp.flush()'); held = false; }
    else if (c === 'ss.flush' || c === 'FAILED ss.flush') unsent = false;
    else if (c === 'mail' || c === 'FAILED mail') { if (opts.post) assert(!unsent && revWrites > 0, 'an alert email went out before the save was finished'); }
    else if (c.indexOf('cache.put:rev') === 0) assert(c === 'cache.put:rev' ? held : !held, 'the saved copy of REV is cached under the lock, the looked-up copy without it: ' + c);
    /* Without the lock a request may look in the cache and at the revision number, and that is all. A sign-in
       above all is never put in the cache without it: one that was cleared a moment earlier could come back. */
    else if (c.indexOf('cache.put:') === 0 || c.indexOf('cache.remove:') === 0) assert(held, 'the cache was changed without holding the lock: ' + c);
    else if (c === 'ss.open' || c.indexOf('sheet.read:') === 0) { assert(held, 'the sheet was read without holding the lock: ' + c); if (c !== 'ss.open') reads[c] = (reads[c] || 0) + 1; }
    else if (c === 'ss.create') assert(held, 'made a spreadsheet without holding the lock');
    else if (/^(sheet\.(write|format|insertRows)|ss\.(insertSheet|deleteSheet)):/.test(c)) {
      assert(held, 'changed the sheet without holding the lock: ' + c);
      unsent = true;
      if (c.indexOf('sheet.write:') === 0) writes[c] = (writes[c] || 0) + 1;
    } else if (c.indexOf('props.set:') === 0) {
      assert(held, 'changed a script property without holding the lock: ' + c);
      if (c === 'props.set:REV') { assert(!unsent, 'REV was written before the new data was sent to the sheet'); revWrites++; }
    }
  });
  assert(!unsent, 'the run ended with writes that were never sent with SpreadsheetApp.flush()');
  if (!opts.loose) {
    /* One write of REV per request. The one exception: an alert email failed after the save, and saying so on the problems list is a second small save. */
    const allowed = r.calls.indexOf('FAILED mail') >= 0 ? 2 : 1;
    assert(revWrites <= allowed, 'REV was written ' + revWrites + ' times in one request');
    Object.keys(reads).forEach((k) => assert.strictEqual(reads[k], 1, k + ' happened ' + reads[k] + ' times in one request'));
    Object.keys(writes).forEach((k) => assert.strictEqual(writes[k], 1, k + ' happened ' + writes[k] + ' times in one request'));
  }
}

/* Every global the script defines that is not a function: its settings. A run must leave them alone. */
function globalState(ctx, serviceNames) {
  const out = {};
  Object.keys(ctx).sort().forEach((k) => {
    if (serviceNames.indexOf(k) >= 0 || typeof ctx[k] === 'function' || k === 'RidgelineCore') return;
    out[k] = ctx[k];
  });
  return JSON.stringify(out);
}

function world() {
  const G = newGoogle();

  /* One run = one fresh JavaScript world that shares only G with the others. */
  function run(fn, arg) {
    const me = { id: 'run' + (++G.seq), calls: [], pending: [] };
    const svc = services(G, me);
    const serviceNames = Object.keys(svc.globals);
    const ctx = vm.createContext(svc.globals);
    script.runInContext(ctx);
    if (G.tweak) G.tweak(ctx);
    assert.strictEqual(typeof ctx[fn], 'function', fn + ' is not a function in Code.gs');
    const settled = globalState(ctx, serviceNames);
    assert(settled.indexOf('"OWNER_NAME"') > 0, 'the settings at the top of gas.js are there');
    let out, error = null;
    try { out = ctx[fn](arg); } catch (e) { error = e; }
    assert.strictEqual(globalState(ctx, serviceNames), settled, 'a run changed a global variable; nothing may be kept in globals');
    svc.end();                                   // Google sends any held-back writes when a run ends
    const leaked = G.lockHolder === me.id;
    if (leaked) G.lockHolder = null;             // ... and lets go of the lock
    return { out: out, error: error, calls: me.calls, leaked: leaked };
  }

  function readJson(out) {
    assert(out && out.isFakeTextOutput, 'the answer was not made with ContentService.createTextOutput');
    assert.strictEqual(out.getMimeType(), 'JSON', 'the answer was not marked as JSON');
    return JSON.parse(out.getContent());
  }

  /* One call from the app. body: an object (sent as JSON text) or a raw string. */
  function post(body, opts) {
    opts = opts || {};
    const event = Object.prototype.hasOwnProperty.call(opts, 'event') ? opts.event
      : { parameter: {}, postData: { type: 'text/plain', contents: typeof body === 'string' ? body : JSON.stringify(body) } };
    const sent = Date.now();
    const r = run('doPost', event);
    assert(!r.error, 'doPost threw instead of answering JSON: ' + (r.error && r.error.message));
    const res = readJson(r.out);
    checkRun(r, Object.assign({ post: true }, opts));
    /* Every sync in every answer of every test, the short one too, carries the system's clock. */
    if (res && res.sync) {
      const s = res.sync;
      assert(Number.isInteger(s.nowMs) && s.nowMs >= sent && s.nowMs <= Date.now(), 'sync.nowMs is not the time the request was answered: ' + s.nowMs);
      assert.deepStrictEqual([s.nowHM, s.today], [chicagoAt(s.nowMs).hm, chicagoAt(s.nowMs).day], 'sync.nowHM and sync.today are not business time at nowMs');
    }
    return { res: res, calls: r.calls };
  }

  /* A setting or a limit as the code under test has it (a top-level name in Code.gs). */
  function peek(name) {
    const ctx = vm.createContext(services(G, { id: 'peek', calls: [], pending: [] }).globals);
    script.runInContext(ctx);
    return ctx[name];
  }

  function byHand(fn, opts) {
    const r = run(fn);
    if (!(opts && opts.mayFail)) assert(!r.error, fn + ' threw: ' + (r.error && r.error.message));
    checkRun(r, { loose: true });
    return r;
  }

  const file = () => G.files[G.props.SHEET_ID];
  const sheet = (name) => file().sheets.find((s) => s.name === name);
  /* The tab as a person would see it: [A, B] for every row down to the last one with anything in it. */
  function rows(name) {
    const sh = sheet(name), out = [];
    for (let r = 1; r <= lastRow(sh); r++) out.push([cell(sh, r, 1), cell(sh, r, 2)]);
    return out;
  }
  /* The records in a tab, checking the layout on the way: header, then [id, JSON] rows, all text. */
  function docs(name) {
    const all = rows(name);
    assert.deepStrictEqual(all[0], ['id', 'json'], 'row 1 of the "' + name + '" tab is not the header');
    return all.slice(1).map((line, i) => {
      assert.strictEqual(typeof line[0], 'string', name + ' row ' + (i + 2) + ': column A is not text');
      assert.strictEqual(typeof line[1], 'string', name + ' row ' + (i + 2) + ': column B is not text');
      const doc = JSON.parse(line[1]);
      assert.strictEqual(line[0], doc.id, name + ' row ' + (i + 2) + ': column A is not the record id');
      return doc;
    });
  }
  const snapshot = (names) => JSON.stringify((names || core.COLLECTIONS).map((n) => [n, sheet(n) ? rows(n) : null]));

  return { G: G, run: run, post: post, peek: peek, byHand: byHand, get: () => readJson(run('doGet').out), file: file, sheet: sheet, rows: rows, docs: docs, snapshot: snapshot };
}

const must = (r) => { assert.strictEqual(r.res.ok, true, 'expected ok, got ' + JSON.stringify(r.res.error)); return r.res; };
const fails = (r, code) => {
  assert.strictEqual(r.res.ok, false, 'expected the error "' + code + '" but the call worked');
  assert.strictEqual(r.res.error.code, code, 'expected "' + code + '", got "' + r.res.error.code + '": ' + r.res.error.message);
  assert(typeof r.res.error.message === 'string' && r.res.error.message.length > 0);
  return r.res;
};
/* The short "nothing changed" answer: exactly rev, today, same and the clock (the clock itself is checked on every answer, in post). */
const nothingNew = (r, rev, today, what) => {
  assert.deepStrictEqual(Object.keys(r.res.sync || {}).sort(), ['nowHM', 'nowMs', 'rev', 'same', 'today'], what);
  assert.deepStrictEqual(Object.assign({}, r.res, { sync: Object.assign({}, r.res.sync, { nowMs: 0, nowHM: '' }) }),
    { ok: true, result: {}, sync: { rev: rev, today: today, same: true, nowMs: 0, nowHM: '' } }, what);
  return r.res;
};
const pinIn = (text, label) => {
  const m = new RegExp('^' + label + ': (\\d{6})$', 'm').exec(text);
  assert(m, 'no "' + label + ': 482913" line (a 6 digit PIN) in:\n' + text);
  return m[1];
};

function saleBody(token, name, date, time, extra) {
  return Object.assign({
    action: 'createSale', token: token, opId: uid(),
    client: { name: name, contact: 'Pat', phone: '615-555-0100', email: '', address: '12 Main St, Smithville' },
    service: 'Window cleaning', priceCents: 15000, billing: 'once', notes: '', what: '', stripeLink: '',
    appointment: date ? { date: date, time: time } : null
  }, extra || {});
}

/* A system that is set up: owner signed in, two reps and a tech, the next ten days open. */
function ready() {
  const w = world();
  w.byHand('setup');
  const pin = pinIn(w.G.mail[0].body, 'PIN');
  const login = (name, p) => must(w.post({ action: 'login', name: name, pin: p }));
  const first = login('Grayson', pin);
  const owner = first.result.token, today = first.sync.today;
  const add = (name, role, p) => must(w.post({ action: 'saveMember', token: owner, opId: uid(), member: { name: name, role: role, pin: p } })).result.id;
  const ids = { mason: add('Mason', 'rep', '271845'), riley: add('Riley', 'rep', '604417'), cole: add('Cole', 'tech', '906132') };
  const days = [];
  for (let i = 1; i <= 10; i++) days.push(core.dates.addDays(today, i));
  must(w.post({ action: 'setDays', token: owner, opId: uid(), days: days.map((d) => ({ date: d, open: true, slots: ['08:00', '09:30', '12:00', '14:00'] })) }));
  const x = {
    w: w, G: w.G, pin: pin, owner: owner, ids: ids, today: today, days: days, login: login,
    mason: login('Mason', '271845').result.token, riley: login('Riley', '604417').result.token, cole: login('Cole', '906132').result.token
  };
  x.sale = (token, name, date, time, extra) => w.post(saleBody(token, name, date, time, extra));
  x.view = (token) => must(w.post({ action: 'sync', token: token })).sync;
  return x;
}

/* ====================================================================================
 * The tests
 * ==================================================================================== */

const failed = [];
let count = 0;
function test(name, fn) {
  count++;
  try {
    fn();
    console.log('ok    ' + name);
  } catch (e) {
    failed.push(name);
    const lines = String((e && e.stack) || e).split('\n').slice(0, 10).map((l) => (l.length > 300 ? l.slice(0, 300) + ' ...' : l));
    console.log('FAIL  ' + name + '\n      ' + lines.join('\n      '));
  }
}

test('the stand-ins are as strict as the real Google services', () => {
  const G = newGoogle(), me = { id: 'x', calls: [], pending: [] }, g = services(G, me).globals;
  const book = g.SpreadsheetApp.create('T'), sh = book.getSheetByName('Sheet1');
  assert.strictEqual(sh.getLastRow(), 0);
  assert.deepStrictEqual(sh.getDataRange().getValues(), [['']]);
  assert.throws(() => sh.getRange(1, 1, 0, 2), /at least 1/);
  assert.throws(() => sh.getRange(0, 1, 1, 2), /at least 1/);
  assert.throws(() => sh.getRange(1001, 1, 1, 1), /outside the dimensions/);
  assert.throws(() => sh.getRange(1, 1, 1, 27), /outside the dimensions/);
  assert.throws(() => sh.getRange(1, 1, 2, 2).setValues([['a', 'b']]), /does not match/);
  assert.throws(() => sh.getRange(1, 1, 1, 2).setValues([['a']]), /does not match/);
  assert.throws(() => sh.getRange(1, 1, 1, 1).setValues([[null]]), /null/);
  assert.throws(() => sh.getRange(1, 1, 1, 1).setValues([['x'.repeat(50001)]]), /50000/);
  sh.getRange(1, 1, 1, 1).setValues([['2026-11-19']]);
  assert(isDate(sh.getRange(1, 1, 1, 1).getValues()[0][0]), 'a date-looking string in a normal cell becomes a date');
  sh.getRange(2, 1, 1, 1).setNumberFormat('@').setValues([['2026-11-19']]);
  assert.strictEqual(sh.getRange(2, 1, 1, 1).getValues()[0][0], '2026-11-19');
  assert.strictEqual(sh.getLastRow(), 2);
  sh.getRange(3, 1, 1, 1).setValues([['held back']]);
  assert.strictEqual(lastRow(G.files[book.getId()].sheets[0]), 2, 'a write waits until it is sent');
  g.SpreadsheetApp.flush();
  assert.strictEqual(lastRow(G.files[book.getId()].sheets[0]), 3);
  assert.throws(() => book.deleteSheet(sh), /remove all the sheets/);
  assert.throws(() => book.insertSheet('Sheet1'), /already exists/);
  assert.throws(() => g.SpreadsheetApp.openById('nope'), /missing/);
  const props = g.PropertiesService.getScriptProperties();
  assert.strictEqual(props.getProperty('none'), null);
  assert.throws(() => props.setProperty('REV', 5), /only hold strings/);
  const cache = g.CacheService.getScriptCache();
  assert.throws(() => cache.put('k', 'v', 21601), /21600/);
  assert.throws(() => cache.put('k'.repeat(251), 'v', 60), /too large/);
  assert.throws(() => cache.put('k', 'v'.repeat(100 * 1024 + 1), 60), /too large/);
  cache.put('k', 'v', 60);
  assert.strictEqual(cache.get('k'), 'v');
  G.cacheNow += 61;
  assert.strictEqual(cache.get('k'), null, 'cache entries expire');
  G.lockHolder = 'someone else';
  assert.strictEqual(g.LockService.getScriptLock().tryLock(1000), false);
  assert.throws(() => g.MailApp.sendEmail('', 's', 'b'), /no recipient/);
  assert.throws(() => g.Utilities.formatDate(new Date(), 'America/Chicago', 'YYYY-MM-DD'), /only knows/);
});

test('before setup has been run, the web app still answers JSON', () => {
  const w = world();
  assert.deepStrictEqual(w.get(), { ok: true, service: 'ridgeline-wash-team', version: core.VERSION });
  const r = w.post({ action: 'login', name: 'Grayson', pin: '482913' });
  fails(r, 'server');
  assert.strictEqual(r.res.error.message, SERVER_MESSAGE);
  const ping = w.post({ action: 'ping' });
  assert.deepStrictEqual(ping.res, { ok: true, result: { version: core.VERSION } });
  assert(!ping.calls.some((c) => /^(lock|sheet|ss)\./.test(c)), 'ping must not touch the lock or the sheet');
});

test('setup makes the sheet, the tabs, the owner, and emails the sign-in', () => {
  const w = world(), G = w.G;
  const r = w.byHand('setup');
  assert(r.calls.indexOf('lock.acquire') >= 0 && r.calls.indexOf('lock.acquire') < r.calls.indexOf('ss.create'), 'setup takes the lock first');
  assert.strictEqual(Object.keys(G.files).length, 1);
  assert.strictEqual(w.file().name, 'Ridgeline Wash Co. Team Data');
  assert.deepStrictEqual(w.file().sheets.map((s) => s.name).sort(), core.COLLECTIONS.slice().sort(), 'one tab per collection and no leftover Sheet1');
  core.COLLECTIONS.forEach((name) => {
    assert.deepStrictEqual(w.rows(name)[0], ['id', 'json']);
    assert.strictEqual(w.sheet(name).formats.get(at(500, 1)), '@', 'columns A and B are plain text all the way down');
    assert.strictEqual(w.sheet(name).formats.get(at(500, 2)), '@');
  });
  assert.strictEqual(G.props.OWNER_EMAIL, G.ownerEmail);
  assert.strictEqual(G.props.REV, '1');

  assert.strictEqual(G.mail.length, 1);
  assert.strictEqual(G.mail[0].to, G.ownerEmail);
  assert.strictEqual(G.mail[0].subject, 'Ridgeline Wash Co.: your team system is ready');
  const body = G.mail[0].body, pin = pinIn(body, 'PIN');
  assert.strictEqual(core.check.pin(pin), '', 'the owner\'s first PIN is 6 digits and not one that is easy to guess: ' + pin);
  assert(/^Sign-in name: Grayson$/m.test(body));
  assert(/never share this sheet with anyone/.test(body) && /everyone's PIN/.test(body), 'the email says to keep the data sheet private, and why');
  assert(body.indexOf('https://docs.google.com/spreadsheets/d/' + G.props.SHEET_ID) >= 0, 'the email links to the data sheet');
  assert(/Deploy/.test(body) && /Web app/.test(body) && /Anyone/.test(body), 'the email says what to do next');
  assert(G.logs.some((l) => l.indexOf('PIN: ' + pin) >= 0 && l.indexOf('Sign-in name: Grayson') >= 0), 'the same text is in the log');
  assert(body.indexOf('—') < 0, 'no em dash');

  const team = w.docs('team');
  assert.strictEqual(team.length, 1);
  assert.strictEqual(team[0].name, 'Grayson');
  assert.strictEqual(team[0].role, 'owner');
  core.COLLECTIONS.forEach((name) => w.rows(name).forEach((line) => {
    assert(!/"pin"/.test(line[1]) && line[1].indexOf('"' + pin + '"') < 0, 'the PIN itself is never stored (found in the ' + name + ' tab)');
  }));
  assert.deepStrictEqual(Object.keys(G.props).sort(), ['OWNER_EMAIL', 'REV', 'SHEET_ID'], 'and it is not kept in the script properties either');
  assert.deepStrictEqual(w.docs('settings').map((d) => d.id), ['main']);
  assert(w.docs('settings')[0].standards.length >= 3, 'the starting company standards are saved');

  const signedIn = must(w.post({ action: 'login', name: 'Grayson', pin: pin }));
  assert.strictEqual(signedIn.sync.me.role, 'owner');
});

test('setup can be run again: nothing is wiped and the PIN does not change', () => {
  const x = ready(), w = x.w, G = x.G;
  must(x.sale(x.mason, 'Oak Street Dental', x.days[0], '09:30'));
  const before = w.snapshot(), props = JSON.stringify(G.props), mails = G.mail.length;
  const r = w.byHand('setup');
  assert.strictEqual(w.snapshot(), before, 'the sheet is exactly as it was');
  assert.strictEqual(JSON.stringify(G.props), props, 'the script properties are exactly as they were');
  assert.strictEqual(Object.keys(G.files).length, 1, 'no second spreadsheet');
  assert(!r.calls.some((c) => c.indexOf('sheet.write:') === 0), 'a second setup writes nothing');
  assert.strictEqual(G.mail.length, mails + 1);
  const body = G.mail[G.mail.length - 1].body;
  assert(!/\d{4}/.test(body.replace(/https?:\S+/g, '')), 'the second email shows no PIN');
  assert(/was not changed/.test(body) && /resetOwnerPin/.test(body));
  must(w.post({ action: 'login', name: 'Grayson', pin: x.pin }));
  assert.strictEqual(must(w.post({ action: 'sync', token: x.owner })).sync.clients.length, 1);
  const kept = w.snapshot();

  /* A blank Sheet1 left behind by a first run that was cut short is cleaned up; one with something in it is not. */
  w.file().sheets.push(newSheet('Sheet1'));
  w.byHand('setup');
  assert(!w.sheet('Sheet1'));
  const mine = newSheet('Sheet1');
  setCell(mine, 1, 1, 'my own notes');
  w.file().sheets.push(mine);
  w.byHand('setup');
  assert(w.sheet('Sheet1'), 'a Sheet1 with something in it is left alone');
  assert.strictEqual(w.snapshot(), kept);
});

test('setup never starts a second sheet when the first cannot be opened', () => {
  const x = ready(), G = x.G, id = G.props.SHEET_ID, kept = G.files[id];
  delete G.files[id];
  const r = x.w.byHand('setup', { mayFail: true });
  assert(r.error && /could not be opened/.test(r.error.message), 'setup stops with a plain message');
  assert.strictEqual(Object.keys(G.files).length, 0);
  assert.strictEqual(G.props.SHEET_ID, id);
  G.files[id] = kept;
  x.w.byHand('setup');
  must(x.w.post({ action: 'login', name: 'Grayson', pin: x.pin }));
});

test('signing in: a wrong PIN is refused, a right one gives a token that lasts across requests', () => {
  const w = world(), G = w.G;
  w.byHand('setup');
  const pin = pinIn(G.mail[0].body, 'PIN'), wrong = '000000';   /* never a real PIN: the system refuses to make or take it */
  const bad = w.post({ action: 'login', name: 'Grayson', pin: wrong });
  fails(bad, 'auth');
  assert.strictEqual(w.docs('sessions').length, 0);
  fails(w.post({ action: 'login', name: 'Nobody', pin: pin }), 'auth');
  const good = w.post({ action: 'login', name: '  grayson ', pin: pin });
  const res = must(good);
  assert(good.calls.indexOf('lock.acquire') >= 0, 'signing in writes, so it takes the lock');
  assert(typeof res.result.token === 'string' && res.result.token.length >= 32);
  assert.strictEqual(res.sync.same, false);
  assert.strictEqual(res.sync.me.name, 'Grayson');
  assert.strictEqual(w.docs('sessions').length, 1);
  assert(w.snapshot().indexOf(res.result.token) < 0, 'the token itself is not stored, only its hash');
  G.cache.clear();   // nothing but the sheet is left to remember the session
  assert.strictEqual(must(w.post({ action: 'sync', token: res.result.token })).sync.me.role, 'owner');
  fails(w.post({ action: 'sync', token: 'not-a-real-token-0123456789' }), 'auth');
  fails(w.post({ action: 'sync' }), 'auth');
});

test('owner, reps and tech work a whole job through the web app', () => {
  const x = ready(), w = x.w, G = x.G, d1 = x.days[0], d2 = x.days[1];

  /* The rep sells and books in one go. */
  const body = saleBody(x.mason, 'Oak Street Dental', d1, '09:30', { billing: 'monthly', notes: 'Gate code 4471' });
  const mails = G.mail.length;
  const s1 = must(w.post(body)).result;
  assert(s1.clientId && s1.saleId && s1.jobId);
  assert.strictEqual(s1.commissionCents, 4500);
  assert.strictEqual(G.mail.length, mails + 1, 'the owner is emailed about the booking');
  assert.strictEqual(G.mail[mails].to, G.ownerEmail);
  assert(/^Ridgeline Wash Co\.: Appointment booked: Oak Street Dental/.test(G.mail[mails].subject));

  /* The same tap sent twice (bad signal) saves once. */
  const again = must(w.post(body));
  assert.strictEqual(again.replay, true);
  assert.deepStrictEqual(again.result, s1);
  assert.strictEqual(w.docs('sales').length, 1);
  assert.strictEqual(w.docs('clients').length, 1);
  assert.strictEqual(w.docs('jobs').length, 1);
  assert.strictEqual(G.mail.length, mails + 1);

  /* An action that is refused part way leaves no trace, in the answer or in the sheet. */
  const jobsBefore = w.snapshot(['jobs']);
  const refused = w.post({ action: 'updateJob', token: x.owner, opId: uid(), jobId: s1.jobId, patch: { assignedTo: x.ids.cole, status: 'no such status' } });
  fails(refused, 'invalid');
  assert.strictEqual(refused.res.sync.jobs[0].assignedTo, null, 'the refused change is not in the answer');
  assert.strictEqual(w.snapshot(['jobs']), jobsBefore);

  /* The owner assigns it; the tech sees it, finishes it and leaves a note. */
  must(w.post({ action: 'updateJob', token: x.owner, opId: uid(), jobId: s1.jobId, patch: { assignedTo: x.ids.cole } }));
  const tech = x.view(x.cole);
  assert.strictEqual(tech.jobs.length, 1);
  assert.strictEqual(tech.jobs[0].client.name, 'Oak Street Dental');
  assert.deepStrictEqual(tech.clients, []);
  assert.deepStrictEqual(tech.sales, []);
  must(w.post({ action: 'setJobDone', token: x.cole, opId: uid(), jobId: s1.jobId, done: true }));
  must(w.post({ action: 'addNote', token: x.cole, opId: uid(), kind: 'job', id: s1.jobId, text: 'Back gate was locked. Did the front only.' }));

  /* The rep adds a note, fixes the phone number, books a second visit and moves it. */
  must(w.post({ action: 'addNote', token: x.mason, opId: uid(), kind: 'client', id: s1.clientId, text: 'Wants a quote for the awning.' }));
  must(w.post({ action: 'updateClient', token: x.mason, opId: uid(), clientId: s1.clientId, patch: { phone: '615-555-0199' } }));
  const visit = must(w.post({ action: 'bookJob', token: x.mason, opId: uid(), clientId: s1.clientId, date: d2, time: '12:00', what: 'Second visit' })).result;
  must(w.post({ action: 'moveJob', token: x.mason, opId: uid(), jobId: visit.jobId, date: d2, time: '14:00' }));

  /* Roles hold on the server. */
  fails(w.post({ action: 'deleteClient', token: x.mason, opId: uid(), clientId: s1.clientId }), 'forbidden');
  fails(w.post(saleBody(x.cole, 'Not allowed', d2, '08:00')), 'forbidden');
  fails(w.post({ action: 'addNote', token: x.riley, opId: uid(), kind: 'client', id: s1.clientId, text: 'Not mine' }), 'forbidden');
  const other = x.view(x.riley);
  assert.deepStrictEqual(other.clients, []);
  assert(other.taken.some((t) => t.date === d2 && t.time === '14:00'), 'another rep still sees that the time is gone');
  assert(!other.taken.some((t) => t.date === d2 && t.time === '12:00'), 'the old time is free again');

  /* The owner edits the client and the payment, and sees everything. */
  must(w.post({ action: 'updateClient', token: x.owner, opId: uid(), clientId: s1.clientId,
    patch: { payStatus: 'paid', stripeLink: 'https://buy.stripe.com/test_123', priceCents: 17500 } }));
  const all = x.view(x.owner);
  const job = all.jobs.find((j) => j.id === s1.jobId), client = all.clients[0];
  assert.strictEqual(job.status, 'done');
  assert.strictEqual(job.doneBy, x.ids.cole);
  assert.strictEqual(job.notes.length, 1);
  assert.strictEqual(client.status, 'Active');
  assert.strictEqual(client.phone, '615-555-0199');
  assert.strictEqual(client.payStatus, 'paid');
  assert.strictEqual(client.priceCents, 17500);
  assert.deepStrictEqual(client.notes.map((n) => n.text), ['Gate code 4471', 'Wants a quote for the awning.']);
  assert.strictEqual(all.sales[0].events[0].cents, 4500);
  assert(all.notices.some((n) => n.type === 'booking') && all.notices.some((n) => n.type === 'done'));
  assert.strictEqual(all.board.find((b) => b.id === x.ids.mason).all.cents, 15000);

  /* It is all in the sheet, as JSON rows, and a brand-new request with an empty cache reads it back. */
  assert.deepStrictEqual(w.docs('clients').map((c) => c.id), [s1.clientId]);
  assert.strictEqual(w.docs('jobs').length, 2);
  assert.strictEqual(w.docs('jobs').find((j) => j.id === visit.jobId).time, '14:00');
  G.cache.clear();
  assert.deepStrictEqual(x.view(x.owner).clients, [w.docs('clients')[0]]);

  /* The owner removes the sale (the finished job stays), then the client (its jobs go too). */
  must(w.post({ action: 'deleteSale', token: x.owner, opId: uid(), saleId: s1.saleId }));
  assert.strictEqual(w.docs('sales').length, 0);
  assert.strictEqual(w.docs('jobs').length, 2);
  must(w.post({ action: 'deleteClient', token: x.owner, opId: uid(), clientId: s1.clientId }));
  assert.strictEqual(w.docs('clients').length, 0);
  assert.strictEqual(w.docs('jobs').length, 0);
  fails(w.post({ action: 'addNote', token: x.owner, opId: uid(), kind: 'client', id: s1.clientId, text: 'Gone' }), 'not_found');

  /* PINs and people. */
  must(w.post({ action: 'changePin', token: x.mason, opId: uid(), oldPin: '271845', newPin: '517293' }));
  fails(w.post({ action: 'login', name: 'Mason', pin: '271845' }), 'auth');
  x.login('Mason', '517293');
  const reset = must(w.post({ action: 'resetPin', token: x.owner, opId: uid(), id: x.ids.cole })).result;
  fails(w.post({ action: 'sync', token: x.cole }), 'auth');
  x.login('Cole', reset.pin);
  must(w.post({ action: 'removeMember', token: x.owner, opId: uid(), id: x.ids.riley }));
  fails(w.post({ action: 'sync', token: x.riley }), 'auth');
  fails(w.post({ action: 'login', name: 'Riley', pin: '604417' }), 'auth');
  must(w.post({ action: 'logout', token: x.mason, opId: uid() }));
  fails(w.post({ action: 'sync', token: x.mason }), 'auth');
});

test('company standards: the owner edits them, a rep confirms, the owner sees who has', () => {
  const x = ready(), w = x.w;
  const start = x.view(x.mason);
  assert.deepStrictEqual(start.settings.standards, core.DEFAULT_SETTINGS.standards, 'the starting draft is there for everyone');
  assert.strictEqual(start.settings.standardsUpdatedAt, 0);
  assert.strictEqual(start.me.standardsAckAt, 0);
  fails(w.post({ action: 'saveSettings', token: x.cole, opId: uid(), settings: { standards: [] } }), 'forbidden');

  must(w.post({ action: 'saveSettings', token: x.owner, opId: uid(), settings: { standards: [
    { title: 'On every job', ordered: true, items: ['Arrive on time.', 'Take before photos.', 'Walk the customer through the work.'] },
    { title: 'Safety first', ordered: false, items: ['If it is not safe, do not do it. Call Grayson.'] }
  ] } }));
  const saved = w.docs('settings')[0];
  assert.deepStrictEqual(saved.standards.map((s) => s.title), ['On every job', 'Safety first']);
  assert(saved.standardsUpdatedAt > 0);

  const rep = x.view(x.mason);
  assert.strictEqual(rep.settings.standards.length, 2);
  assert.strictEqual(rep.settings.standards[0].items.length, 3);
  assert(rep.me.standardsAckAt < rep.settings.standardsUpdatedAt, 'the rep still has to confirm');
  const ack = must(w.post({ action: 'ackStandards', token: x.mason, opId: uid() })).result;
  assert(ack.at >= rep.settings.standardsUpdatedAt);
  assert.strictEqual(x.view(x.mason).me.standardsAckAt, ack.at);
  assert.strictEqual(w.docs('team').find((m) => m.id === x.ids.mason).standardsAckAt, ack.at, 'the confirmation is in the sheet');

  const owner = x.view(x.owner);
  assert.strictEqual(owner.team.find((m) => m.id === x.ids.mason).standardsAckAt, ack.at);
  assert.strictEqual(owner.team.find((m) => m.id === x.ids.cole).standardsAckAt, 0);
  assert(owner.notices.some((n) => n.type === 'standards' && /Mason/.test(n.text)));
});

test('the sheet holds plain-text [id, JSON] rows, and ids that look like dates stay text', () => {
  const x = ready(), w = x.w;
  must(x.sale(x.mason, 'Alpha', x.days[0], '08:00'));
  must(x.sale(x.riley, 'Bravo', x.days[0], '09:30'));
  core.COLLECTIONS.forEach((name) => {
    w.docs(name);   // checks the header, text cells, and that column A is the id inside column B
    w.rows(name).forEach((line, i) => assert(line[1] !== '', name + ' has a blank row ' + (i + 1) + ' in the middle'));
  });
  assert.deepStrictEqual(w.docs('days').map((d) => d.id), x.days);
  assert.deepStrictEqual(w.rows('days').slice(1).map((line) => line[0]), x.days, 'column A of the days tab is the date as text, not a real date');
  assert.strictEqual(w.docs('clients').length, 2);
  assert.strictEqual(w.docs('sales').length, 2);
  assert.strictEqual(w.docs('jobs').length, 2);
  assert.strictEqual(w.docs('team').length, 4);

  /* Even if the plain-text format has been lost from the tab, a write puts it back first. */
  w.sheet('days').formats.clear();
  const extra = core.dates.addDays(x.today, 11);
  must(w.post({ action: 'setDays', token: x.owner, opId: uid(), days: [{ date: extra, open: true }] }));
  assert.deepStrictEqual(w.rows('days').slice(1).map((line) => line[0]), x.days.concat([extra]));
});

test('deleting records shrinks the tab: no stale rows, no gaps', () => {
  const x = ready(), w = x.w, d = x.days[0];
  const a = must(x.sale(x.mason, 'Alpha', d, '08:00')).result;
  const b = must(x.sale(x.mason, 'Bravo', d, '09:30')).result;
  const c = must(x.sale(x.mason, 'Charlie', d, '12:00')).result;
  ['clients', 'sales', 'jobs'].forEach((name) => assert.strictEqual(w.rows(name).length, 4));

  must(w.post({ action: 'deleteSale', token: x.owner, opId: uid(), saleId: b.saleId }));
  assert.deepStrictEqual(w.docs('sales').map((s) => s.id), [a.saleId, c.saleId]);
  assert.deepStrictEqual(w.docs('jobs').map((j) => j.id), [a.jobId, c.jobId], 'the visit that had not happened yet went with the sale');
  assert.strictEqual(lastRow(w.sheet('sales')), 3);
  assert.strictEqual(cell(w.sheet('sales'), 4, 1), '');
  assert.strictEqual(cell(w.sheet('sales'), 4, 2), '');
  assert.strictEqual(w.rows('clients').length, 4, 'a tab nobody changed is left alone');

  must(w.post({ action: 'deleteClient', token: x.owner, opId: uid(), clientId: a.clientId }));
  assert.deepStrictEqual(w.docs('clients').map((k) => k.id), [b.clientId, c.clientId]);
  assert.deepStrictEqual(w.docs('sales').map((s) => s.id), [c.saleId]);
  assert.deepStrictEqual(w.docs('jobs').map((j) => j.id), [c.jobId]);

  must(w.post({ action: 'deleteClient', token: x.owner, opId: uid(), clientId: b.clientId }));
  must(w.post({ action: 'deleteClient', token: x.owner, opId: uid(), clientId: c.clientId }));
  ['clients', 'sales', 'jobs'].forEach((name) => assert.deepStrictEqual(w.rows(name), [['id', 'json']], name + ' is back to just its header'));
  const view = x.view(x.owner);
  assert.deepStrictEqual([view.clients.length, view.sales.length, view.jobs.length, view.taken.length], [0, 0, 0, 0]);

  const again = must(x.sale(x.mason, 'Delta', d, '08:00')).result;
  assert.deepStrictEqual(w.docs('clients').map((k) => k.id), [again.clientId]);
});

test('two reps race for the same time: exactly one gets it', () => {
  /* Riley's request gets the lock while Mason's is still waiting for it. */
  let x = ready(), other = null;
  x.G.hooks.beforeLock = () => { other = x.sale(x.riley, 'Riley Client', x.days[0], '09:30'); };
  let mine = x.sale(x.mason, 'Mason Client', x.days[0], '09:30');
  must(other);
  fails(mine, 'slot_taken');
  assert(mine.res.sync.taken.some((t) => t.date === x.days[0] && t.time === '09:30'), 'the loser is sent the fresh list of taken times');
  assert.strictEqual(x.w.docs('jobs').filter((j) => j.date === x.days[0] && j.time === '09:30').length, 1);
  assert.deepStrictEqual(x.w.docs('clients').map((c) => c.name), ['Riley Client'], 'the loser left nothing behind');
  assert.strictEqual(x.w.docs('sales').length, 1);

  /* Riley's request arrives while Mason's holds the lock: it is told to try again, and then loses. */
  x = ready();
  const rileyBody = saleBody(x.riley, 'Riley Client', x.days[0], '09:30');
  x.G.hooks.afterLock = () => { other = x.w.post(rileyBody); };
  mine = x.sale(x.mason, 'Mason Client', x.days[0], '09:30');
  must(mine);
  fails(other, 'busy');
  assert.strictEqual(other.res.error.message, BUSY_MESSAGE);
  fails(x.w.post(rileyBody), 'slot_taken');
  assert.strictEqual(x.w.docs('jobs').length, 1);
  assert.deepStrictEqual(x.w.docs('clients').map((c) => c.name), ['Mason Client']);
});

test('a request that waited for the lock works from what is in the sheet now, not from before the wait', () => {
  const x = ready(), w = x.w, G = x.G;
  const c = must(x.sale(x.mason, 'Alpha', x.days[0], '08:00')).result;
  let other = null;

  /* Two notes on the same client, the second request arriving first at the lock. */
  G.hooks.beforeLock = () => { other = w.post({ action: 'addNote', token: x.mason, opId: uid(), kind: 'client', id: c.clientId, text: 'From Mason' }); };
  const mine = must(w.post({ action: 'addNote', token: x.owner, opId: uid(), kind: 'client', id: c.clientId, text: 'From Grayson' }));
  assert.strictEqual(mine.sync.rev, must(other).sync.rev + 1, 'each save gets its own revision number');
  assert.strictEqual(G.props.REV, String(mine.sync.rev));
  assert.deepStrictEqual(w.docs('clients')[0].notes.map((n) => n.text), ['From Mason', 'From Grayson'], 'neither note overwrote the other');

  /* A "what is new?" that had to wait is answered with what the other request just saved. */
  const view = x.view(x.owner);
  G.hooks.beforeLock = () => { other = x.sale(x.riley, 'Bravo', x.days[0], '09:30'); };
  const late = must(w.post({ action: 'sync', token: x.owner, since: view.rev, day: '2020-01-01' }));
  assert.strictEqual(late.sync.rev, +G.props.REV);
  assert(late.sync.rev > view.rev);
  assert(late.sync.clients.some((k) => k.name === 'Bravo'));
});

test('"nothing changed" is answered without the lock and without opening the sheet', () => {
  const x = ready(), w = x.w, G = x.G;
  const full = x.view(x.mason);
  assert.strictEqual(full.same, false);
  const ask = { action: 'sync', token: x.mason, since: full.rev, day: full.today };
  const quiet = (r, what) => assert(!r.calls.some((c) => /^(lock|sheet|ss)\./.test(c) || c.indexOf('props.set') === 0),
    what + ' touched the lock or the sheet: ' + r.calls.join(', '));

  const fast = w.post(ask);
  nothingNew(fast, full.rev, full.today);
  quiet(fast, 'the fast path');
  assert(fast.calls.every((c) => c.indexOf('cache.get:') === 0), 'the fast path only looks in the cache: ' + fast.calls.join(', '));

  /* It works even while another request holds the lock. */
  G.lockHolder = 'another request';
  const during = w.post(ask);
  assert.strictEqual(during.res.sync.same, true);
  quiet(during, 'the fast path');
  G.lockHolder = null;

  /* When the cache has forgotten the sign-in, the check does not go and read it from the sheet behind the
     lock's back. It takes its turn: the sign-in is read and put back in the cache under the lock, nothing is
     written to the sheet, and the answer is still "nothing changed". The checks after it are fast again. */
  const relearned = (r, what) => {
    nothingNew(r, full.rev, full.today, what);
    const turn = r.calls.indexOf('lock.acquire'), put = r.calls.findIndex((c) => c.indexOf('cache.put:sess:') === 0);
    assert(turn >= 0 && r.calls.indexOf('sheet.read:sessions') > turn && put > turn && put < r.calls.indexOf('lock.release'), what + ': the sign-in was not read and cached under the lock: ' + r.calls.join(', '));
    assert(r.calls.slice(0, r.calls.indexOf('lock.try:15000')).every((c) => c.indexOf('cache.get:') === 0 || c === 'props.get:REV' || c === 'cache.put:rev:seen'),
      what + ': before its turn it did more than look in the cache and at the revision number: ' + r.calls.join(', '));
    assert(!r.calls.some((c) => /^sheet\.(write|format|insertRows)/.test(c) || c.indexOf('props.set') === 0), what + ': it wrote something');
  };
  G.cache.clear();
  relearned(w.post(ask), 'a cold cache');
  quiet(w.post(ask), 'the fast path, once the cache is warm again,');
  G.cacheNow += 21601;   // six hours later the cache has let go of everything
  relearned(w.post(ask), 'six hours later');
  quiet(w.post(ask), 'the fast path, after that,');

  /* Something changed: the lock, and the whole picture. */
  must(x.sale(x.mason, 'Alpha', x.days[0], '08:00'));
  const after = w.post(ask);
  assert(after.calls.indexOf('lock.acquire') >= 0);
  assert.strictEqual(after.res.sync.same, false);
  assert(after.res.sync.rev > full.rev);
  assert.strictEqual(after.res.sync.clients.length, 1);

  /* A new day: the lock, and the whole picture. */
  const newDay = w.post({ action: 'sync', token: x.mason, since: after.res.sync.rev, day: core.dates.addDays(full.today, -1) });
  assert(newDay.calls.indexOf('lock.acquire') >= 0);
  assert.strictEqual(newDay.res.sync.same, false);

  /* A phone that is no longer signed in never gets "nothing changed". */
  const out = w.post({ action: 'sync', token: 'x'.repeat(40), since: after.res.sync.rev, day: full.today }, { loose: true });
  fails(out, 'auth');
  assert(out.calls.indexOf('lock.acquire') >= 0, 'anything but "nothing changed" is answered under the lock');
});

test('a held lock gives "busy" as JSON and saves nothing', () => {
  const x = ready(), w = x.w, G = x.G, before = w.snapshot(), rev = G.props.REV;
  G.lockHolder = 'another request';
  const r = x.sale(x.mason, 'Alpha', x.days[0], '08:00');
  assert.deepStrictEqual(r.res, { ok: false, error: { code: 'busy', message: BUSY_MESSAGE } });
  assert(r.calls.indexOf('lock.try:15000') >= 0, 'it waits up to 15 seconds for its turn');
  assert(!r.calls.some((c) => /^(sheet|ss)\./.test(c)), 'nothing is read or written without the lock');
  fails(w.post({ action: 'login', name: 'Mason', pin: '271845' }), 'busy');
  fails(w.post({ action: 'sync', token: x.mason }), 'busy');
  assert.deepStrictEqual(w.post({ action: 'ping' }).res, { ok: true, result: { version: core.VERSION } });
  assert.strictEqual(w.snapshot(), before);
  assert.strictEqual(G.props.REV, rev);
  G.lockHolder = null;
  must(x.sale(x.mason, 'Alpha', x.days[0], '08:00'));
});

test('a body that is not a proper request gets a JSON error, never a crash', () => {
  const x = ready(), w = x.w, before = w.snapshot();
  const bad = { ok: false, error: { code: 'invalid', message: 'Bad request.' } };
  ['', '   ', 'not json', '{"action":', '[]', '[{"action":"sync"}]', '"sync"', 'null', '42', 'true', '{}', '{"action":7}', '{"token":"abc"}'].forEach((text) => {
    const r = w.post(text);
    assert.deepStrictEqual(r.res, bad, 'for the body ' + JSON.stringify(text));
    assert(!r.calls.some((c) => /^(lock|sheet|ss)\./.test(c)), 'rubbish never gets as far as the lock');
  });
  [undefined, null, {}, { postData: null }, { postData: {} }, { postData: { contents: 12 } }, { parameter: { action: 'ping' } }].forEach((event) => {
    assert.deepStrictEqual(w.post(null, { event: event }).res, bad);
  });
  fails(w.post({ action: 'noSuchThing', token: x.owner }), 'invalid');
  fails(w.post({ action: 'noSuchThing' }), 'auth');
  fails(w.post({ action: 'createSale', token: x.mason, opId: uid() }), 'invalid');
  fails(w.post({ action: 'setDays', token: x.owner, opId: uid(), days: 'tomorrow' }), 'invalid');
  fails(w.post({ action: '__proto__', token: x.owner }), 'invalid');
  fails(w.post({ action: 'constructor', token: x.owner }), 'invalid');
  assert.strictEqual(w.snapshot(), before, 'none of that changed the sheet');
});

test('a row somebody broke by hand is skipped, kept, and reported to the owner once', () => {
  const x = ready(), w = x.w, d = x.days[0];
  const a = must(x.sale(x.mason, 'Alpha', d, '08:00')).result;
  const b = must(x.sale(x.mason, 'Bravo', d, '09:30')).result;
  const c = must(x.sale(x.mason, 'Charlie', d, '12:00')).result;
  const sh = w.sheet('clients');
  const cut = '{"id":"' + b.clientId + '","name":"Bra';
  setCell(sh, 3, 2, cut);                                              // Bravo's JSON cut off half way
  setCell(sh, 5, 1, 'note to self'); setCell(sh, 5, 2, 'call the bank');   // something typed underneath
  setCell(sh, 6, 2, '[1,2,3]');                                        // JSON, but not a record
  setCell(sh, 7, 2, 12345);                                            // a number
  setCell(sh, 9, 1, a.clientId); setCell(sh, 9, 2, cell(sh, 2, 2));    // row 8 left blank, then a copy of Alpha
  setCell(sh, 4, 1, 'typed over');                                     // Charlie's id in column A overwritten (column B is fine)

  const first = w.post({ action: 'sync', token: x.owner });
  assert.deepStrictEqual(must(first).sync.clients.map((k) => k.name), ['Alpha', 'Charlie'], 'the good rows still load, once each');
  const jobs = x.view(x.owner).jobs;
  assert.deepStrictEqual(jobs.map((j) => j.client.name).sort(), ['', 'Alpha', 'Charlie'], 'a job whose client row is broken does not break anything');

  const told = (view) => view.problems.filter((p) => /"clients" tab/.test(p.message) && /could not be read/.test(p.message));
  let view = x.view(x.owner);
  assert.strictEqual(told(view).length, 1, 'the owner is told');
  assert(/^4 rows /.test(told(view)[0].message));

  must(w.post({ action: 'addNote', token: x.owner, opId: uid(), kind: 'client', id: c.clientId, text: 'Still here' }));
  const now = w.rows('clients');
  assert.deepStrictEqual(now[0], ['id', 'json']);
  assert.deepStrictEqual(now.slice(1, 3).map((line) => line[0]), [a.clientId, c.clientId], 'column A is put right from the record itself');
  assert.strictEqual(JSON.parse(now[2][1]).notes.length, 1);
  assert.deepStrictEqual(now.slice(3), [[b.clientId, cut], ['note to self', 'call the bank'], ['', '[1,2,3]'], ['', '12345']],
    'what could not be read is kept, word for word, under the good rows');
  view = x.view(x.owner);
  assert.strictEqual(told(view).length, 1, 'and the owner is not told twice');
  assert.deepStrictEqual(view.clients.map((k) => k.name), ['Alpha', 'Charlie']);

  /* The tab sorted by hand, which moves the header row down among the records: it is still just the header. */
  const jobsTab = w.sheet('jobs');
  const moved = [cell(jobsTab, 2, 1), cell(jobsTab, 2, 2)];
  setCell(jobsTab, 2, 1, 'id'); setCell(jobsTab, 2, 2, 'json');
  setCell(jobsTab, 1, 1, moved[0]); setCell(jobsTab, 1, 2, moved[1]);
  const sorted = x.view(x.owner);
  assert.strictEqual(sorted.jobs.length, 3);
  assert(!sorted.problems.some((p) => /"jobs" tab/.test(p.message)));
  must(w.post({ action: 'updateJob', token: x.owner, opId: uid(), jobId: c.jobId, patch: { what: 'Front windows only' } }));
  assert.strictEqual(w.docs('jobs').length, 3);

  /* The header row deleted by hand, so every record moved up one row: nothing is lost. */
  const sales = w.sheet('sales');
  for (let r = 1; r <= 3; r++) { setCell(sales, r, 1, cell(sales, r + 1, 1)); setCell(sales, r, 2, cell(sales, r + 1, 2)); }
  setCell(sales, 4, 1, ''); setCell(sales, 4, 2, '');
  assert.strictEqual(x.view(x.owner).sales.length, 3);
  must(w.post({ action: 'deleteSale', token: x.owner, opId: uid(), saleId: a.saleId }));
  assert.deepStrictEqual(w.docs('sales').map((s) => s.id), [b.saleId, c.saleId]);
});

test('a tab that runs out of rows is made longer before it is written', () => {
  const x = ready(), w = x.w, sh = w.sheet('days');
  sh.maxRows = lastRow(sh);   // no spare rows at all
  const more = [];
  for (let i = 11; i <= 50; i++) more.push({ date: core.dates.addDays(x.today, i), open: i % 7 !== 0 });
  const r = w.post({ action: 'setDays', token: x.owner, opId: uid(), days: more });
  must(r);
  assert(r.calls.indexOf('sheet.insertRows:days') >= 0);
  assert.strictEqual(sh.maxRows, 51);
  assert.strictEqual(w.docs('days').length, 50);
  w.rows('days').slice(1).forEach((line) => assert(core.dates.isDay(line[0]), 'column A stayed text in the new rows: ' + line[0]));
  assert.strictEqual(x.view(x.owner).days.length, 50);
});

test('a missing tab is treated as empty and made again when it is needed', () => {
  const x = ready(), w = x.w;
  w.file().sheets = w.file().sheets.filter((s) => s.name !== 'notices');
  assert.deepStrictEqual(x.view(x.owner).notices, []);
  must(x.sale(x.mason, 'Alpha', x.days[0], '08:00'));
  assert(w.sheet('notices'), 'the tab is back');
  assert.strictEqual(w.docs('notices').length, 1);
  assert.strictEqual(x.view(x.owner).notices.length, 1);
});

test('when an action fails half way, nothing of it is saved and the retry saves it once', () => {
  const x = ready(), w = x.w, G = x.G;
  const watched = ['clients', 'sales', 'jobs', 'notices', 'team', 'days', 'settings', 'sessions'];
  const before = w.snapshot(watched), rev = +G.props.REV, mails = G.mail.length;
  /* The rep's sale has already handed over the client, the sale and the job when the notices tab fails to load. */
  G.fail['sheet.read:notices'] = 2;   // a read is tried twice before it counts as failed
  const body = saleBody(x.mason, 'Half Saved', x.days[0], '08:00');
  const r = w.post(body, { loose: true });
  fails(r, 'server');
  assert.strictEqual(r.res.error.message, SERVER_MESSAGE);
  assert(r.calls.indexOf('FAILED sheet.read:notices') >= 0, 'the test did make it fail half way');
  assert.strictEqual(w.snapshot(watched), before, '"Nothing was saved" has to be true');
  assert.strictEqual(G.mail.length, mails);
  assert(w.docs('problems').some((p) => p.where === 'createSale'), 'the owner can see what went wrong');
  assert.strictEqual(+G.props.REV, rev + 1);
  assert(!Array.from(G.cache.keys()).some((k) => k.indexOf('op:') === 0 && k.indexOf(body.opId) > 0), 'the failed try is not remembered as done');
  assert.strictEqual(x.view(x.owner).problems.length, 1);

  const again = must(w.post(body));
  assert(!again.replay, 'the retry really runs');
  assert.deepStrictEqual([w.docs('clients').length, w.docs('sales').length, w.docs('jobs').length], [1, 1, 1]);
  assert.strictEqual(G.mail.length, mails + 1);
  assert.strictEqual(must(w.post(body)).replay, true);
  assert.deepStrictEqual([w.docs('clients').length, w.docs('sales').length, w.docs('jobs').length], [1, 1, 1]);

  /* The same, failing at the very end: the whole sale had been handed over, and remembered as
     done, when putting the answer together failed. It must not be saved OR remembered. */
  const mid = w.snapshot(watched);
  G.fail['sheet.read:team'] = 2;
  const late = saleBody(x.mason, 'Failed At The End', x.days[0], '09:30');
  const r2 = w.post(late, { loose: true });
  fails(r2, 'server');
  const remembered = r2.calls.findIndex((c) => c.indexOf('cache.put:op:') === 0 && c.indexOf(late.opId) > 0);
  assert(remembered >= 0 && remembered < r2.calls.indexOf('FAILED sheet.read:team'), 'the test did make it fail after the action was complete');
  assert.strictEqual(w.snapshot(watched), mid, '"Nothing was saved" has to be true here too');
  assert(!Array.from(G.cache.keys()).some((k) => k.indexOf(late.opId) > 0), 'so the retry must not be answered from memory');
  const redo = must(w.post(late));
  assert(!redo.replay);
  assert.deepStrictEqual([w.docs('clients').length, w.docs('sales').length, w.docs('jobs').length], [2, 2, 2]);
});

test('a save that fails once is tried again; a save that keeps failing is reported, not hidden', () => {
  const x = ready(), w = x.w, G = x.G;
  const c = must(x.sale(x.mason, 'Alpha', x.days[0], '08:00')).result;
  const note = (text) => ({ action: 'addNote', token: x.owner, opId: uid(), kind: 'client', id: c.clientId, text: text });

  G.fail['ss.flush'] = 1;
  const r = w.post(note('Call before coming.'), { loose: true });
  must(r);
  assert(r.calls.indexOf('FAILED ss.flush') >= 0);
  assert(r.calls.indexOf('props.set:REV') > r.calls.lastIndexOf('ss.flush'), 'REV is only written after a send that worked');
  assert.deepStrictEqual(w.docs('clients')[0].notes.map((n) => n.text), ['Call before coming.'], 'the retry wrote the whole tab again');
  assert.strictEqual(G.props.REV, String(r.res.sync.rev));

  const rev = +G.props.REV, body = note('Second note.');
  G.fail['ss.flush'] = 3;
  const bad = w.post(body, { loose: true });
  fails(bad, 'server');
  assert.strictEqual(bad.res.error.message, SERVER_MESSAGE);
  assert.strictEqual(G.fail['ss.flush'], 0, 'it tried three times');
  assert.strictEqual(w.docs('clients')[0].notes.length, 1);
  assert(!Array.from(G.cache.keys()).some((k) => k.indexOf(body.opId) > 0), 'the failed save is not remembered as done');
  assert(+G.props.REV > rev, 'phones are told to reload, in case part of it did land');
  const again = must(w.post(body));
  assert(!again.replay);
  assert.deepStrictEqual(w.docs('clients')[0].notes.map((n) => n.text), ['Call before coming.', 'Second note.']);

  /* A read that fails once is simply read again; nobody hears of it. */
  G.cache.clear();
  G.fail['ss.open'] = 1;
  G.fail['sheet.read:clients'] = 1;
  const hiccup = w.post({ action: 'sync', token: x.owner });
  assert.strictEqual(must(hiccup).sync.clients.length, 1);
  assert(hiccup.calls.indexOf('FAILED ss.open') >= 0 && hiccup.calls.indexOf('FAILED sheet.read:clients') >= 0);

  /* The sheet cannot be opened at all: still JSON, still no lock left behind. */
  G.cache.clear();
  G.fail['ss.open'] = 9;
  fails(w.post({ action: 'sync', token: x.owner }, { loose: true }), 'server');
  G.fail['ss.open'] = 0;
  must(w.post({ action: 'sync', token: x.owner }));
});

test('notes that would outgrow a cell are refused in plain words before anything is saved', () => {
  const x = ready(), w = x.w;
  const c = must(x.sale(x.mason, 'Alpha', x.days[0], '08:00')).result;
  const big = '"'.repeat(500);   // every quote mark takes two characters once it is JSON
  let saved = 0, refused = null;
  for (let i = 0; i < 50 && !refused; i++) {
    const r = w.post({ action: 'addNote', token: x.owner, opId: uid(), kind: 'client', id: c.clientId, text: big });
    if (r.res.ok) saved++; else refused = r;
  }
  assert(refused, 'fifty such notes cannot fit in one cell');
  assert.deepStrictEqual(refused.res.error, { code: 'invalid', message: 'There is no room left in this client\'s notes. Shorten the note and try again.' });
  assert(saved >= 35 && saved < 49, 'saved ' + saved);
  assert(!refused.calls.some((k) => /^sheet\.write:/.test(k) || k === 'props.set:REV'), 'a refused note writes nothing');
  assert.strictEqual(w.docs('clients')[0].notes.length, saved);
  assert.strictEqual(refused.res.sync.clients[0].notes.length, saved, 'and the answer shows the notes as they still are');
  w.rows('clients').forEach((line) => assert(line[1].length <= core.LIMITS.docChars, 'a row is ' + line[1].length + ' characters'));
  assert.deepStrictEqual(x.view(x.owner).problems, [], 'it is the person\'s to fix, not a problem for the owner');
  must(w.post({ action: 'updateClient', token: x.owner, opId: uid(), clientId: c.clientId, patch: { phone: '615-555-0142' } }));

  /* The same for the company standards: twelve full sections do not fit, and say so. */
  const sections = [];
  for (let i = 0; i < 12; i++) { const items = []; for (let k = 0; k < 20; k++) items.push('L'.repeat(240)); sections.push({ id: 's' + i, title: 'Section ' + i, items: items }); }
  const before = w.snapshot(['settings']);
  const std = w.post({ action: 'saveSettings', token: x.owner, opId: uid(), settings: { standards: sections } });
  assert.deepStrictEqual(std.res.error, { code: 'invalid', message: 'The company standards are too long to save. Shorten a few lines or remove a section, then try again.' });
  assert.strictEqual(w.snapshot(['settings']), before);
  must(w.post({ action: 'saveSettings', token: x.owner, opId: uid(), settings: { standards: sections.slice(0, 8) } }));
  assert.strictEqual(w.docs('settings')[0].standards.length, 8);
  core.COLLECTIONS.forEach((name) => w.rows(name).forEach((line) => assert(line[1].length <= core.LIMITS.docChars)));
});

test('the sheet itself still refuses a record over 50,000 characters (a row padded by hand), and the owner is told', () => {
  const x = ready(), w = x.w;
  const c = must(x.sale(x.mason, 'Alpha', x.days[0], '08:00')).result;
  must(w.post({ action: 'updateJob', token: x.owner, opId: uid(), jobId: c.jobId, patch: { assignedTo: x.ids.cole } }));
  /* Somebody pastes a long text into the job's row. Marking the job done makes the record a few characters longer. */
  const sh = w.sheet('jobs'), job = JSON.parse(cell(sh, 2, 2));
  job.pasted = '';
  job.pasted = 'p'.repeat(49995 - JSON.stringify(job).length);
  const padded = JSON.stringify(job);
  setCell(sh, 2, 2, padded);
  const r = w.post({ action: 'setJobDone', token: x.cole, opId: uid(), jobId: c.jobId, done: true }, { loose: true });
  fails(r, 'server');
  assert.strictEqual(r.res.error.message, SERVER_MESSAGE);
  assert.strictEqual(cell(sh, 2, 2), padded, 'the row is left exactly as it was');
  assert.strictEqual(w.docs('clients')[0].status, 'New', 'and nothing else of the action was saved');
  const problems = x.view(x.owner).problems;
  assert(problems.some((p) => p.where === 'setJobDone' && /"jobs" tab/.test(p.message) && /too big/.test(p.message)), JSON.stringify(problems));
});

test('when the alert email cannot be sent, the sale is still saved and the owner is told', () => {
  const x = ready(), w = x.w, G = x.G, mails = G.mail.length;
  G.fail.mail = 1;
  const r = x.sale(x.mason, 'Alpha', x.days[0], '08:00');
  must(r);
  assert(r.calls.indexOf('FAILED mail') >= 0);
  assert.strictEqual(G.mail.length, mails);
  assert.strictEqual(w.docs('sales').length, 1);
  const view = x.view(x.owner);
  assert(view.problems.some((p) => p.where === 'email'));
  assert(view.notices.some((n) => n.type === 'booking'));

  /* With no saved address, alerts go to whoever the web app runs as (the owner). */
  delete G.props.OWNER_EMAIL;
  must(x.sale(x.mason, 'Echo', x.days[1], '08:00'));
  assert.strictEqual(G.mail.length, mails + 1);
  assert.strictEqual(G.mail[mails].to, G.ownerEmail);

  /* The owner can send alerts to another address, or switch them off. */
  must(w.post({ action: 'saveSettings', token: x.owner, opId: uid(), settings: { notifyEmail: 'office@example.com' } }));
  must(x.sale(x.mason, 'Bravo', x.days[0], '09:30'));
  assert.strictEqual(G.mail[G.mail.length - 1].to, 'office@example.com');
  must(w.post({ action: 'saveSettings', token: x.owner, opId: uid(), settings: { emailOnBooking: false } }));
  const quiet = G.mail.length;
  must(x.sale(x.mason, 'Charlie', x.days[0], '12:00'));
  assert.strictEqual(G.mail.length, quiet);
});

test('resetOwnerPin gives the owner a new PIN and signs the owner out everywhere', () => {
  const x = ready(), w = x.w, G = x.G, mails = G.mail.length, others = w.snapshot(['clients', 'sales', 'jobs', 'days', 'settings']);
  const r = w.byHand('resetOwnerPin');
  assert(r.calls.indexOf('lock.acquire') >= 0);
  assert.strictEqual(G.mail.length, mails + 1);
  const mail = G.mail[mails];
  assert.strictEqual(mail.to, G.ownerEmail);
  assert.strictEqual(mail.subject, 'Ridgeline Wash Co.: your new PIN');
  const pin = pinIn(mail.body, 'New PIN');
  assert(/^Sign-in name: Grayson$/m.test(mail.body));
  assert(G.logs.some((l) => l.indexOf('New PIN: ' + pin) >= 0), 'the new PIN is in the log too');
  fails(w.post({ action: 'sync', token: x.owner }), 'auth');
  if (pin !== x.pin) fails(w.post({ action: 'login', name: 'Grayson', pin: x.pin }), 'auth');
  assert.strictEqual(x.login('Grayson', pin).sync.me.role, 'owner');
  must(w.post({ action: 'sync', token: x.mason }));
  assert.strictEqual(w.snapshot(['clients', 'sales', 'jobs', 'days', 'settings']), others);
  assert.strictEqual(w.docs('team').filter((m) => m.role === 'owner').length, 1);

  const empty = world();
  const none = empty.byHand('resetOwnerPin', { mayFail: true });
  assert(none.error, 'before setup there is nothing to reset, and it says so');
  assert.strictEqual(empty.G.mail.length, 0);
});

test('alert emails go out only after the save: a save that fails sends nothing, and its retry sends one', () => {
  const x = ready(), w = x.w, G = x.G, mails = G.mail.length;

  /* A sale that saves: the email is the last thing that happens, after the sheet and REV are written. */
  const good = x.sale(x.mason, 'Alpha', x.days[0], '08:00');
  must(good);
  const sent = good.calls.indexOf('mail');
  assert(sent > good.calls.lastIndexOf('ss.flush') && sent > good.calls.indexOf('props.set:REV') && sent > good.calls.lastIndexOf('sheet.write:notices'),
    'the email was sent before the save had finished: ' + good.calls.join(', '));
  assert(sent < good.calls.indexOf('lock.release'), 'and before the request lets go of its turn');
  assert.strictEqual(G.mail.length, mails + 1);

  /* The save fails (three tries, all refused by Google): the owner must not get an email about a sale that is not there. */
  const body = saleBody(x.mason, 'Bravo', x.days[0], '09:30');
  G.fail['ss.flush'] = 3;
  const bad = w.post(body, { loose: true });
  fails(bad, 'server');
  assert.strictEqual(G.fail['ss.flush'], 0, 'the test did make the save fail');
  assert(bad.calls.indexOf('mail') < 0 && bad.calls.indexOf('FAILED mail') < 0, 'nothing was emailed for a save that failed');
  assert.strictEqual(G.mail.length, mails + 1);
  assert.deepStrictEqual(w.docs('clients').map((c) => c.name), ['Alpha']);

  /* The rep taps Save again: saved once, emailed once. A third tap is answered from memory and emails nobody. */
  const again = must(w.post(body));
  assert(!again.replay);
  assert.strictEqual(G.mail.length, mails + 2);
  assert(/^Ridgeline Wash Co\.: Appointment booked: Bravo/.test(G.mail[mails + 1].subject));
  assert.strictEqual(must(w.post(body)).replay, true);
  assert.strictEqual(G.mail.length, mails + 2);
  assert.deepStrictEqual(w.docs('clients').map((c) => c.name), ['Alpha', 'Bravo']);

  /* An action that is refused, or that fails half way, emails nobody either. */
  fails(x.sale(x.riley, 'Taken', x.days[0], '08:00'), 'slot_taken');
  G.fail['sheet.read:team'] = 2;
  fails(w.post(saleBody(x.riley, 'Half Way', x.days[0], '12:00'), { loose: true }), 'server');
  assert.strictEqual(G.mail.length, mails + 2);
});

test('an email that cannot be sent after the save does not fail the sale, and the owner finds out in the app', () => {
  const x = ready(), w = x.w, G = x.G, mails = G.mail.length;
  const seen = x.view(x.owner);
  G.fail.mail = 1;
  const r = x.sale(x.mason, 'Alpha', x.days[0], '08:00');
  const res = must(r);
  assert(res.result.saleId && res.result.jobId, 'the rep gets the normal answer');
  assert(r.calls.indexOf('FAILED mail') > r.calls.indexOf('props.set:REV'), 'the email was tried after the save');
  assert.strictEqual(G.mail.length, mails);
  assert.deepStrictEqual([w.docs('clients').length, w.docs('sales').length, w.docs('jobs').length, w.docs('notices').length], [1, 1, 1, 1]);
  const problems = w.docs('problems');
  assert.strictEqual(problems.length, 1);
  assert.strictEqual(problems[0].where, 'email');
  assert.strictEqual(problems[0].message, 'An email alert could not be sent: Service invoked too many times for one day: email.');
  assert.strictEqual(+G.props.REV, res.sync.rev + 1, 'the problem moved the revision number on, so the owner\'s phone picks it up');
  assert(G.logs.some((l) => /email alert could not be sent/.test(l)), 'and it is in the script log too');
  const owner = w.post({ action: 'sync', token: x.owner, since: seen.rev, day: seen.today });
  assert.strictEqual(must(owner).sync.problems.length, 1);
  assert.deepStrictEqual(x.view(x.mason).problems, [], 'the rep is not shown it');
  /* The same tap again is a replay: no second sale, no second try at the email, no second problem. */
  assert.strictEqual(G.mail.length, mails);
  must(x.sale(x.mason, 'Bravo', x.days[0], '09:30'));
  assert.strictEqual(G.mail.length, mails + 1, 'the next alert goes out as usual');
  assert.strictEqual(w.docs('problems').length, 1);

  /* If even the problems list cannot be saved, the sale still stands and the rep still gets a normal answer. */
  G.fail.mail = 1;
  G.hooks.onMail = () => { G.fail['ss.flush'] = 3; };   // the sale is saved by now; every later save fails
  const body = saleBody(x.mason, 'Charlie', x.days[0], '12:00');
  const worst = w.post(body, { loose: true });
  assert(must(worst).result.saleId);
  assert.strictEqual(G.fail['ss.flush'], 0, 'the test did make the second save fail');
  assert.deepStrictEqual(w.docs('clients').map((c) => c.name), ['Alpha', 'Bravo', 'Charlie']);
  assert.strictEqual(w.docs('problems').length, 1);
  assert(G.logs.some((l) => /could not be added to the problems list/.test(l)), 'it is at least in the script log');
  assert.strictEqual(must(w.post(body)).replay, true, 'the sale counts as saved, so the same tap again saves nothing more');
});

test('fifty "anything new?" checks in a row cost at most one property read, and a save is seen by the very next check', () => {
  const x = ready(), w = x.w, G = x.G;
  const phones = [x.owner, x.mason, x.riley, x.cole];
  for (let i = 0; i < 6; i++) phones.push(x.login(i % 2 ? 'Mason' : 'Riley', i % 2 ? '271845' : '604417').result.token);
  const view = x.view(x.owner);
  const ask = (token, rev) => w.post({ action: 'sync', token: token, since: rev, day: view.today });
  const propertyReads = (r) => r.calls.filter((c) => c.indexOf('props.get:') === 0);
  const fifty = (rev) => {
    let reads = [];
    for (let i = 0; i < 50; i++) {
      const r = ask(phones[i % phones.length], rev);
      nothingNew(r, rev, view.today, 'check ' + (i + 1));
      assert(!r.calls.some((c) => /^(lock|sheet|ss)\./.test(c) || c.indexOf('props.set') === 0), 'check ' + (i + 1) + ' touched the lock or the sheet');
      reads = reads.concat(propertyReads(r));
    }
    return reads;
  };

  /* Soon after a save the number is in the cache already (the save put it there). */
  assert.deepStrictEqual(fifty(view.rev), [], 'no property read at all');

  /* A quiet spell later the cache has let go of the save's copy (150 seconds). The first check reads REV once and the other 49 do not. */
  G.cacheNow += 151;
  assert.deepStrictEqual(fifty(view.rev), ['props.get:REV']);
  assert.strictEqual(G.cache.get('rev:seen').value, String(view.rev));
  G.cacheNow += 119;
  assert.deepStrictEqual(fifty(view.rev), [], 'the looked-up copy is good for two minutes');
  G.cacheNow += 2;
  assert.deepStrictEqual(fifty(view.rev), ['props.get:REV'], 'and then REV is read once more');

  /* A save: the very next check from a phone that holds the old number gets the new picture. */
  const sale = x.sale(x.mason, 'Alpha', x.days[0], '08:00');
  must(sale);
  assert(sale.calls.indexOf('cache.put:rev') > sale.calls.indexOf('props.set:REV'), 'the save updates the property, then the cache');
  assert(sale.calls.indexOf('cache.put:rev') < sale.calls.indexOf('lock.release'), 'while it still holds the lock');
  assert(!G.cache.has('rev:seen') && G.cache.get('rev').value === G.props.REV, 'after a save the cache holds the new number and no copy of the old one');
  const next = ask(x.riley, view.rev);
  assert.strictEqual(next.res.sync.same, false, 'a stale "nothing changed" was answered after a save');
  assert.strictEqual(next.res.sync.rev, +G.props.REV);
  assert(next.res.sync.taken.some((t) => t.date === x.days[0] && t.time === '08:00'));
  assert(next.calls.indexOf('lock.acquire') >= 0 && next.calls.indexOf('props.get:REV') > next.calls.indexOf('lock.acquire'), 'and what it was told came from the property, read under the lock');
  const rev2 = next.res.sync.rev;
  phones.forEach((p) => assert.strictEqual(ask(p, view.rev).res.sync.same, false, 'every phone with the old number is told'));
  assert.deepStrictEqual(fifty(rev2), [], 'and the new number is answered from the cache from then on');

  /* A check that read REV just before a save and put its copy in the cache just after it: the save's copy still wins. */
  G.cacheNow += 151;
  assert.strictEqual(must(ask(x.owner, rev2)).sync.same, true);                  // this check's copy: rev:seen = rev2
  must(x.sale(x.riley, 'Bravo', x.days[0], '09:30'));                             // the save: REV and rev = rev2 + 1
  const rev3 = +G.props.REV;
  assert.strictEqual(rev3, rev2 + 1);
  G.cache.set('rev:seen', { value: String(rev2), until: G.cacheNow + 120 });      // the late copy of the old number
  assert.strictEqual(ask(x.mason, rev2).res.sync.same, false);
  assert.deepStrictEqual(fifty(rev3), []);
  G.cacheNow += 121;                                                              // the late copy runs out first ...
  assert(G.cache.get('rev').value === String(rev3) && G.cache.get('rev').until > G.cacheNow, 'the save\'s copy has to outlast it');
  assert.strictEqual(ask(x.cole, rev2).res.sync.same, false);
  assert.deepStrictEqual(fifty(rev3), []);

  /* Under the lock the property decides, whatever the cache says. */
  G.cache.set('rev', { value: '9000', until: G.cacheNow + 150 });
  G.cache.set('rev:seen', { value: '9000', until: G.cacheNow + 120 });
  const c = w.docs('clients')[0];
  const note = must(w.post({ action: 'addNote', token: x.owner, opId: uid(), kind: 'client', id: c.id, text: 'From the property' }));
  assert.strictEqual(note.sync.rev, rev3 + 1);
  assert.strictEqual(G.props.REV, String(rev3 + 1));
  assert.strictEqual(G.cache.get('rev').value, String(rev3 + 1), 'and the save put the right number back in the cache');
  assert.strictEqual(must(w.post({ action: 'sync', token: x.mason, since: 9000, day: view.today })).sync.rev, rev3 + 1);

  /* If the cache will not take the new number, no number is left in it at all. */
  G.cache.set('rev:seen', { value: String(rev3 + 1), until: G.cacheNow + 120 });
  G.fail['cache.put:rev'] = 1;
  must(w.post({ action: 'addNote', token: x.owner, opId: uid(), kind: 'client', id: c.id, text: 'Cache hiccup' }));
  assert.strictEqual(G.props.REV, String(rev3 + 2));
  assert(!G.cache.has('rev') && !G.cache.has('rev:seen'), 'an old number was left in the cache');
  const cold = ask(x.riley, rev3 + 1);
  assert.strictEqual(cold.res.sync.same, false, 'so the next check goes to the property and is told the truth');
  assert.strictEqual(cold.calls.indexOf('props.get:REV') < cold.calls.indexOf('lock.try:15000'), true);
  assert.deepStrictEqual(fifty(rev3 + 2), []);

  /* A setup run again and a PIN reset from the editor write through the same store, so they keep the cache right too. */
  w.byHand('resetOwnerPin');
  assert.strictEqual(G.cache.get('rev').value, G.props.REV);
  assert.strictEqual(+G.props.REV, rev3 + 3);
  assert.strictEqual(ask(x.mason, rev3 + 2).res.sync.same, false);
});

test('twenty wrong PINs, four at a time, pause that sign-in and leave the owner a note in the sheet', () => {
  const x = ready(), w = x.w, G = x.G;
  const rev = +G.props.REV;
  let last = null;
  for (let batch = 0; batch < 5; batch++) {
    if (batch) G.cacheNow += 16 * 60;   // long enough for the 15 minute lock to forget
    for (let i = 0; i < 4; i++) { last = w.post({ action: 'login', name: 'Mason', pin: '000000' }); fails(last, 'auth'); }
  }
  assert(last.calls.indexOf('sheet.write:notices') >= 0 && last.calls.indexOf('props.set:REV') >= 0, 'the 20th wrong try is the one that saves the note');
  const notes = w.docs('notices');
  assert.strictEqual(notes.length, 1);
  assert.strictEqual(notes[0].type, 'signin');
  assert.strictEqual(notes[0].text, 'Someone tried the wrong PIN for Mason 20 times. Their sign-in is paused for a few hours. Reset their PIN if that was not them.');
  assert.strictEqual(+G.props.REV, rev + 1);
  G.cacheNow += 16 * 60;
  const paused = w.post({ action: 'login', name: 'Mason', pin: '271845' });
  fails(paused, 'locked');
  assert(/paused for a few hours/.test(paused.res.error.message));
  assert(!paused.calls.some((c) => /^sheet\.write:/.test(c)), 'a paused try saves nothing more');
  must(w.post({ action: 'sync', token: x.mason }));   // the phone that was already signed in is not thrown out
  assert.strictEqual(x.view(x.owner).notices.length, 1);

  /* A wrong "current PIN" counts the same way, through the same web address. */
  for (let i = 0; i < 5; i++) fails(w.post({ action: 'changePin', token: x.riley, opId: uid(), oldPin: '000000', newPin: '517293' }), 'invalid');
  fails(w.post({ action: 'changePin', token: x.riley, opId: uid(), oldPin: '604417', newPin: '517293' }), 'locked');
  fails(w.post({ action: 'login', name: 'Riley', pin: '604417' }), 'locked');
  G.cacheNow += 16 * 60;
  must(w.post({ action: 'changePin', token: x.riley, opId: uid(), oldPin: '604417', newPin: '517293' }));

  /* The owner resets the PIN: the pause is lifted. Otherwise it lifts by itself when the 6 hours are up. */
  const reset = must(w.post({ action: 'resetPin', token: x.owner, opId: uid(), id: x.ids.mason, pin: '730526' })).result;
  assert.strictEqual(x.login('Mason', reset.pin).sync.me.name, 'Mason');
  for (let batch = 0; batch < 5; batch++) {
    G.cacheNow += 16 * 60;
    for (let i = 0; i < 4; i++) fails(w.post({ action: 'login', name: 'Cole', pin: '000000' }), 'auth');
  }
  G.cacheNow += 16 * 60;
  fails(w.post({ action: 'login', name: 'Cole', pin: '906132' }), 'locked');
  G.cacheNow += 21600;
  x.login('Cole', '906132');
  assert.strictEqual(w.docs('notices').length, 2);
});

test('sign-ins older than 90 days leave the sheet when somebody signs in, and a saved action is remembered for 6 hours', () => {
  const x = ready(), w = x.w, G = x.G;
  const before = w.docs('sessions').length;
  /* Three old sign-ins, as rows in the sessions tab: two long expired, one a day short of 90 days. */
  const sh = w.sheet('sessions'), day = 86400000, now = Date.now();
  const old = [{ id: 'a'.repeat(64), memberId: x.ids.mason, createdAt: now - 91 * day }, { id: 'b'.repeat(64), memberId: x.ids.cole, createdAt: now - 400 * day },
    { id: 'c'.repeat(64), memberId: x.ids.riley, createdAt: now - 89 * day }];
  old.forEach((doc, i) => { setCell(sh, before + 2 + i, 1, doc.id); setCell(sh, before + 2 + i, 2, JSON.stringify(doc)); });
  assert.strictEqual(w.docs('sessions').length, before + 3);
  fails(w.post({ action: 'login', name: 'Mason', pin: '000000' }), 'auth');
  must(w.post({ action: 'sync', token: x.mason }));
  assert.strictEqual(w.docs('sessions').length, before + 3, 'only a sign-in that works clears them away');
  x.login('Riley', '604417');
  const ids = w.docs('sessions').map((d) => d.id);
  assert.strictEqual(ids.length, before + 2, 'the two expired rows are gone and the new sign-in is there');
  assert(ids.indexOf(old[0].id) < 0 && ids.indexOf(old[1].id) < 0 && ids.indexOf(old[2].id) >= 0);
  assert.strictEqual(lastRow(sh), before + 3, 'no blank rows left behind');
  [x.owner, x.mason, x.riley, x.cole].forEach((t) => must(w.post({ action: 'sync', token: t })));

  const body = saleBody(x.mason, 'Alpha', x.days[0], '08:00');
  must(w.post(body));
  const key = Array.from(G.cache.keys()).find((k) => k.indexOf('op:') === 0 && k.indexOf(body.opId) > 0);
  assert.strictEqual(G.cache.get(key).until - G.cacheNow, 21600, 'remembered for 6 hours');
  G.cacheNow += 21599;
  assert.strictEqual(must(w.post(body)).replay, true);
  assert.strictEqual(w.docs('sales').length, 1);
});

test('a body over 100,000 characters is turned away as a bad request before it is read; one of exactly 100,000 is answered', () => {
  const x = ready(), w = x.w, before = w.snapshot();
  const bad = { ok: false, error: { code: 'invalid', message: 'Bad request.' } };
  /* A real request from a signed-in phone, padded with a field the app never sends until it is exactly n characters long. */
  const sized = (req, n) => {
    const bare = JSON.stringify(Object.assign({}, req, { pad: '' }));
    const text = JSON.stringify(Object.assign({}, req, { pad: 'x'.repeat(n - bare.length) }));
    assert.strictEqual(text.length, n);
    return text;
  };
  const sync = { action: 'sync', token: x.mason };
  assert.strictEqual(w.post(sized(sync, 100000)).res.ok, true, 'exactly 100,000 characters is still read and answered');
  const touched = (r) => r.calls.filter((c) => /^(lock|sheet|ss|props|cache|mail)/.test(c));
  [100001, 100002, 250000, 4000000].forEach((n) => {
    const r = w.post(sized(sync, n));
    assert.deepStrictEqual(r.res, bad, 'a ' + n + ' character body from a signed-in phone');
    assert.deepStrictEqual(touched(r), [], 'it never got as far as the lock, the cache, the properties or the sheet');
  });
  /* The same for a stranger, for a save, and for text that is not a request at all. */
  [sized({ action: 'login', name: 'Grayson', pin: x.pin }, 100001), sized({ action: 'ping' }, 100001), 'z'.repeat(100001), ' '.repeat(100001) + '{"action":"ping"}', '['.repeat(300000),
    JSON.stringify(Object.assign(saleBody(x.mason, 'Too Big', x.days[0], '08:00'), { notes: 'n'.repeat(150000) }))].forEach((text) => {
    const r = w.post(text);
    assert.deepStrictEqual(r.res, bad);
    assert.deepStrictEqual(touched(r), []);
  });
  assert.strictEqual(w.snapshot(), before, 'none of that changed the sheet');
  /* Long but honest requests are nowhere near the limit and still go through. */
  must(w.post(Object.assign(saleBody(x.mason, 'Long Note', x.days[0], '08:00'), { notes: 'n'.repeat(5000) })));
  assert.strictEqual(w.docs('sales').length, 1);
});

test('someone removed from the team: their phone is told why, from the sheet as well as from the cache, and their name no longer signs in', () => {
  const x = ready(), w = x.w, G = x.G;
  const words = 'You are no longer on the team. Ask the owner if that is a mistake.';
  must(w.post({ action: 'sync', token: x.cole }));   /* Cole's sign-in is in the cache now */
  const sessions = w.docs('sessions').length;
  must(w.post({ action: 'removeMember', token: x.owner, opId: uid(), id: x.ids.cole }));
  assert.strictEqual(w.docs('sessions').length, sessions, 'the stored sign-in stays in the sheet');
  assert(!Array.from(G.cache.keys()).some((k) => k.indexOf('sess:') === 0 && JSON.parse(G.cache.get(k).value).id === x.ids.cole), 'the quick copy of it is gone');
  const told = w.post({ action: 'sync', token: x.cole, since: +G.props.REV - 1, day: x.today });   /* what his phone last knew: it was removed since */
  assert.deepStrictEqual(told.res, { ok: false, error: { code: 'auth', message: words } }, 'the reason, and no data with it');
  assert.deepStrictEqual(fails(w.post({ action: 'setJobDone', token: x.cole, opId: uid(), jobId: 'j_any' }), 'auth').error.message, words);
  G.cacheNow += 7 * 3600;   /* long after the cache has forgotten everybody */
  assert.strictEqual(fails(w.post({ action: 'sync', token: x.cole }), 'auth').error.message, words);
  assert(!Array.from(G.cache.keys()).some((k) => k.indexOf('sess:') === 0 && G.cache.get(k).until > G.cacheNow && JSON.parse(G.cache.get(k).value).id === x.ids.cole), 'and being told does not sign them back in');
  /* Their name and PIN get the same answer as a name nobody ever had, and store nothing. */
  const liveKeys = () => Array.from(G.cache.keys()).filter((k) => G.cache.get(k).until > G.cacheNow).sort().join();
  const snap = w.snapshot(), keys = liveKeys();
  const stranger = fails(w.post({ action: 'login', name: 'Nobody', pin: '906132' }), 'auth').error.message;
  for (let i = 0; i < 8; i++) assert.strictEqual(fails(w.post({ action: 'login', name: 'Cole', pin: '906132' }), 'auth').error.message, stranger);
  for (let i = 0; i < 60; i++) fails(w.post({ action: 'login', name: 'Stranger ' + i, pin: i % 2 ? '000000' : '1234' }), 'auth');
  assert.strictEqual(w.snapshot(), snap);
  assert.strictEqual(liveKeys(), keys, 'no counter was started for a name that is not on the team');
  /* 69 wrong tries by strangers and nobody is paused: the people who are on the team still sign in. */
  x.login('Mason', '271845'); x.login('Grayson', x.pin);
  must(w.post({ action: 'sync', token: x.mason }));
});

test('a "nothing changed?" check never puts a sign-in in the cache: one that a sign-out, a PIN reset or a removal cleared a moment earlier cannot come back', () => {
  const x = ready(), w = x.w, G = x.G;
  const today = x.today;
  const ask = (token) => ({ action: 'sync', token: token, since: +G.props.REV, day: today });
  const cached = (token) => { const e = G.cache.get('sess:' + core.sha256(token)); return !!e && e.until > G.cacheNow; };
  const sessionPuts = (r) => r.calls.filter((c) => c.indexOf('cache.put:sess:') === 0);
  [x.mason, x.riley, x.cole].forEach((t) => must(w.post(ask(t))));
  assert(cached(x.mason) && cached(x.riley) && cached(x.cole));

  /* The plain case first. With the sign-in in the cache the check writes nothing at all. Without it, and with
     the lock held by someone else, it must wait its turn: it does not read the sign-in from the sheet on the
     side and cache it. So the phone hears "busy", and the cache still knows nothing about that sign-in. */
  const warm = w.post(ask(x.mason));
  assert.strictEqual(warm.res.sync.same, true);
  assert.deepStrictEqual(warm.calls.filter((c) => c.indexOf('cache.get:') !== 0), [], 'a check answered from the cache did more than read it');
  G.cache.clear();
  G.lockHolder = 'another request';
  const waiting = w.post(ask(x.mason));
  fails(waiting, 'busy');
  assert.deepStrictEqual(sessionPuts(waiting), []);
  assert(!waiting.calls.some((c) => /^(ss|sheet)\./.test(c)), 'it read the sheet without the lock: ' + waiting.calls.join(', '));
  assert(!cached(x.mason));
  G.lockHolder = null;

  /* The race itself, three ways. A check is half way through (it has just read the tab named here) when the
     thing that clears the sign-in arrives. If that is answered "busy", the check held the lock and the app
     sends it again afterwards. Either way, once it has gone through, the old sign-in must be dead and stay dead. */
  const out = 'Please sign in again.', gone = 'You are no longer on the team. Ask the owner if that is a mistake.';
  const races = [
    ['a sign-out', 'sessions', x.mason, () => ({ action: 'logout', token: x.mason, opId: uid() }), out],
    ['a PIN reset', 'sessions', x.riley, () => ({ action: 'resetPin', token: x.owner, opId: uid(), id: x.ids.riley, pin: '730526' }), out],
    ['a removal', 'team', x.cole, () => ({ action: 'removeMember', token: x.owner, opId: uid(), id: x.ids.cole }), gone]
  ];
  races.forEach((race) => {
    const what = race[0], tab = race[1], token = race[2], clear = race[3], words = race[4];
    G.cache.clear();   // the cache has forgotten everyone, so the next check has to learn the sign-in again
    let landed = null;
    G.hooks.afterRead = { [tab]: () => { landed = w.post(clear()); } };
    const check = w.post(ask(token));
    assert(landed, what + ': the test did not get in between');
    if (landed.res.ok) {
      /* It got in while the check was reading, so the check was reading without the lock. Whatever the check then answers, it must not have cached what it read. */
      assert.deepStrictEqual(sessionPuts(check), [], what + ' landed during the check, and the check still cached the sign-in it had read before');
    } else {
      fails(landed, 'busy');
      assert.strictEqual(check.res.sync.same, true, what + ': the check itself was fine');
      must(w.post(clear()));
    }
    assert(!cached(token), what + ': the sign-in is back in the cache');
    for (let i = 0; i < 3; i++) {
      const after = w.post(ask(token));
      assert.deepStrictEqual(after.res, { ok: false, error: { code: 'auth', message: words } }, what + ': the cleared sign-in still works');
      assert(!cached(token), what + ': being refused put the sign-in back');
    }
  });
  /* Everyone else is still signed in, and the new PIN works. */
  must(w.post(ask(x.owner)));
  x.login('Riley', '730526');
});

test('a retry through the web app is the same thing again or nothing: a changed retry is refused as already saved and writes nothing', () => {
  const x = ready(), w = x.w, G = x.G;
  const body = saleBody(x.mason, 'Lost Answer', x.days[0], '08:00');
  const first = must(w.post(body));
  assert(!first.replay && first.result.saleId);
  const snap = w.snapshot(), rev = G.props.REV, mails = G.mail.length;
  const wrote = (r) => r.calls.filter((c) => /^(sheet\.(write|format|insertRows)|props\.set|mail|cache\.put:op:)/.test(c));

  /* The answer was lost; the rep picks another time and taps again. Same opId, different fields. */
  const changedBody = Object.assign({}, body, { appointment: { date: x.days[0], time: '09:30' }, since: first.sync.rev, day: first.sync.today });
  const changed = w.post(changedBody);
  assert.deepStrictEqual(fails(changed, 'already_saved').error, { code: 'already_saved', message: ALREADY_SAVED });
  assert.deepStrictEqual(Object.keys(changed.res).sort(), ['error', 'ok', 'sync']);
  assert.strictEqual(changed.res.sync.same, true, 'a phone that already holds the latest is told nothing changed');
  assert(changed.calls.indexOf('lock.acquire') >= 0, 'it is decided under the lock, from what was really saved');
  assert.deepStrictEqual(wrote(changed), []);
  const shown = fails(w.post(Object.assign({}, changedBody, { since: 0 })), 'already_saved').sync;
  assert.deepStrictEqual([shown.same, shown.sales.length, shown.jobs.map((j) => j.time), shown.taken.map((t) => t.time)], [false, 1, ['08:00'], ['08:00']], 'the sync shows what the first try saved');
  assert.deepStrictEqual([w.snapshot(), G.props.REV, G.mail.length], [snap, rev, mails], 'nothing was saved, emailed or renumbered');

  /* The very same request again is still answered from memory, in whatever order its fields come. */
  const turned = {};
  Object.keys(body).reverse().forEach((k) => { turned[k] = body[k]; });
  const again = w.post(turned);
  assert.deepStrictEqual([must(again).replay, again.res.result], [true, first.result]);
  assert.deepStrictEqual(wrote(again), []);

  /* What the cache holds for it: the answer and a short fingerprint of what was sent, well inside what the cache takes. */
  const key = Array.from(G.cache.keys()).find((k) => k.indexOf('op:') === 0 && k.indexOf(body.opId) > 0);
  const kept = JSON.parse(G.cache.get(key).value);
  assert.deepStrictEqual([Object.keys(kept), kept.r], [['h', 'r'], first.result]);
  assert(/^[0-9a-f]{16}$/.test(kept.h));
  const maxValue = w.peek('CACHE_MAX_VALUE'), maxKey = w.peek('CACHE_MAX_KEY'), limits = w.peek('RidgelineCore').LIMITS;
  assert.deepStrictEqual([maxValue, maxKey], [30000, 250]);
  assert(limits.retryChars > 1000 && limits.retryChars <= maxValue, 'the core may remember ' + limits.retryChars + ' characters but the cache drops anything over ' + maxValue);
  assert('op:m_12345678901234:'.length + 80 <= maxKey, 'the longest key for a remembered action fits the cache');
  assert(key.length <= maxKey && G.cache.get(key).value.length <= limits.retryChars);

  /* A refused try is not remembered: the same opId with the time put right goes through, once. */
  const taken = saleBody(x.riley, 'Second Choice', x.days[0], '08:00');
  fails(w.post(taken), 'slot_taken');
  assert(!Array.from(G.cache.keys()).some((k) => k.indexOf(taken.opId) > 0));
  const right = Object.assign({}, taken, { appointment: { date: x.days[0], time: '12:00' } });
  assert(!must(w.post(right)).replay);
  assert.strictEqual(must(w.post(right)).replay, true);
  fails(w.post(taken), 'already_saved');
  assert.strictEqual(w.docs('sales').length, 2);

  /* A person added with a lost answer: the same try again brings the PIN back; a changed one does not add a second person. */
  const add = { action: 'saveMember', token: x.owner, opId: uid(), member: { name: 'Jake', role: 'rep' } };
  const made = must(w.post(add)).result, team = w.docs('team').length;
  assert.deepStrictEqual(must(w.post(add)).result, made);
  fails(w.post(Object.assign({}, add, { member: { name: 'Jake B', role: 'rep' } })), 'already_saved');
  assert.strictEqual(w.docs('team').length, team);
  x.login('Jake', made.pin);
});

test('an answer too big for the cache is never a silent second save: the retry is told it was saved, a changed retry is refused, the sheet holds it once', () => {
  const x = ready(), w = x.w, G = x.G;
  /* No real answer is anywhere near too big, so make it so the only way there is: shrink the two limits inside the code under test. */
  G.tweak = (ctx) => { ctx.CACHE_MAX_VALUE = 64; ctx.RidgelineCore.LIMITS.retryChars = 64; };
  const body = saleBody(x.mason, 'Big Answer', null);   /* no appointment, so nothing but the memory of it stands in the way of a second sale */
  const first = must(w.post(body));
  assert(JSON.stringify({ h: 'x'.repeat(16), r: first.result }).length > 64, 'the test did make the answer too big to keep whole');
  const key = Array.from(G.cache.keys()).find((k) => k.indexOf('op:') === 0 && k.indexOf(body.opId) > 0);
  assert(key, 'nothing at all was remembered, so a retry would save the sale again');
  const kept = JSON.parse(G.cache.get(key).value);
  assert.deepStrictEqual([Object.keys(kept), kept.big], [['h', 'big'], true]);
  assert(G.cache.get(key).value.length <= 64);
  const snap = w.snapshot(), mails = G.mail.length;
  const again = must(w.post(body));
  assert.deepStrictEqual([again.replay, again.result, again.sync.sales.length], [true, {}, 1], 'the same try again is told it was saved and is shown it; only the details of the first answer are gone');
  fails(w.post(Object.assign({}, body, { priceCents: 17500 })), 'already_saved');
  assert.deepStrictEqual([w.snapshot(), G.mail.length, w.docs('sales').length, w.docs('clients').length], [snap, mails, 1, 1]);
  G.tweak = null;
  assert.strictEqual(must(w.post(body)).replay, true);
});

test('every sync through the web app carries the system\'s clock, the unlocked "nothing changed" one too', () => {
  const x = ready(), w = x.w;
  /* post() already checks nowMs, nowHM and today on every answer of every test. Here: that the fields are there at all, in each kind of answer. */
  const clocked = (r, what) => { assert(r.res.sync && 'nowMs' in r.res.sync && /^\d\d:\d\d$/.test(r.res.sync.nowHM), what + ' carries no clock'); return r; };
  const full = clocked(w.post({ action: 'sync', token: x.cole }), 'a full sync').res.sync;
  assert.strictEqual(full.same, false);
  const quick = clocked(w.post({ action: 'sync', token: x.cole, since: full.rev, day: full.today }), 'the short sync');
  nothingNew(quick, full.rev, full.today);
  assert(quick.calls.indexOf('lock.acquire') < 0, 'the short sync was not the unlocked one');
  clocked(w.post({ action: 'login', name: 'Cole', pin: '906132' }), 'a sign-in');
  const note = { action: 'ackStandards', token: x.cole, opId: uid() };
  clocked(w.post(note), 'a save');
  assert.strictEqual(clocked(w.post(note), 'a replay').res.replay, true);
  fails(clocked(w.post(Object.assign({ extra: 1 }, note)), 'a changed retry'), 'already_saved');
  fails(clocked(w.post({ action: 'saveSettings', token: x.cole, settings: {} }), 'a refusal'), 'forbidden');
  /* No sync, no clock. */
  assert.deepStrictEqual(Object.keys(fails(w.post({ action: 'sync', token: 'x'.repeat(40) }), 'auth')).sort(), ['error', 'ok']);
  assert.deepStrictEqual(w.post('not json').res, { ok: false, error: { code: 'invalid', message: 'Bad request.' } });
});

test('the local stand-in (tools/dev-server.js) keeps the same rules: 6 digit PINs for its three people, and the same size limit', () => {
  const dev = require(path.join(__dirname, 'dev-server.js'));   /* loaded, not started: it listens on no port */
  assert.deepStrictEqual(dev.PEOPLE.map((p) => [p.name, p.role, p.pin]), [['Grayson', 'owner', '482913'], ['Mason', 'rep', '271845'], ['Cole', 'tech', '906132']]);
  dev.PEOPLE.forEach((p) => {
    assert.strictEqual(core.check.pin(p.pin), '', p.name + '\'s PIN would be refused by the real system');
    const r = dev.answerPost(JSON.stringify({ action: 'login', name: p.name, pin: p.pin }));
    assert(r.ok && r.sync.me.name === p.name && r.sync.me.role === p.role, p.name + ' cannot sign in to the stand-in with PIN ' + p.pin);
  });
  ['1234', '2222', '3333'].forEach((old) => assert.strictEqual(dev.answerPost(JSON.stringify({ action: 'login', name: 'Grayson', pin: old })).error.code, 'auth'));
  const source = fs.readFileSync(path.join(__dirname, 'dev-server.js'), 'utf8'), gas = fs.readFileSync(path.join(root, 'src', 'gas.js'), 'utf8');
  dev.PEOPLE.forEach((p) => assert(source.indexOf('PIN ' + p.pin) > 0, 'the note at the top of dev-server.js does not give ' + p.name + '\'s PIN'));
  assert.strictEqual(dev.MAX_BODY_CHARS, 100000);
  assert(/var MAX_BODY_CHARS = 100000;/.test(gas), 'gas.js and the stand-in disagree about the size limit');
  const bad = { ok: false, error: { code: 'invalid', message: 'Bad request.' } };
  const padded = (n) => { const head = '{"action":"ping","pad":"', tail = '"}'; return head + 'x'.repeat(n - head.length - tail.length) + tail; };
  assert.strictEqual(dev.answerPost(padded(100000)).ok, true, 'exactly 100,000 characters is answered');
  assert.deepStrictEqual(dev.answerPost(padded(100001)), bad, 'one more is not');
  assert.deepStrictEqual(dev.answerPost('z'.repeat(3000000)), bad);
  assert.deepStrictEqual(dev.answerPost('not json'), bad);
  /* It runs the same core, so it tells a retry from a change and sends its clock the same way. */
  const ask = (req) => dev.answerPost(JSON.stringify(req));
  const mason = ask({ action: 'login', name: 'Mason', pin: '271845' });
  const sent = Date.now(), quiet = ask({ action: 'sync', token: mason.result.token, since: mason.sync.rev, day: mason.sync.today }).sync;
  assert.deepStrictEqual(Object.keys(quiet).sort(), ['nowHM', 'nowMs', 'rev', 'same', 'today']);
  assert(quiet.same === true && quiet.nowMs >= sent && quiet.nowMs <= Date.now() && quiet.nowHM === chicagoAt(quiet.nowMs).hm && quiet.today === chicagoAt(quiet.nowMs).day);
  const sale = { action: 'createSale', token: mason.result.token, opId: uid(), client: { name: 'Stand-in Client' }, service: 'House wash', priceCents: 9000 };
  const saved = ask(sale);
  assert.deepStrictEqual([ask(sale).replay, ask(sale).result], [true, saved.result]);
  const changed = ask(Object.assign({}, sale, { priceCents: 9900 }));
  assert.deepStrictEqual([changed.ok, changed.error, changed.sync.sales.map((v) => v.priceCents)], [false, { code: 'already_saved', message: ALREADY_SAVED }, [9000]]);
});

/* The stand-in over real HTTP, on a port of its own. It runs in a second Node so that this file can stay
   a plain top-to-bottom script: the helper starts the server, makes the calls, prints what came back as JSON. */
const DEV_PROBE = `
const http = require('http');
const dev = require(process.argv[1]);
function post(port, query, body) {
  return new Promise((resolve) => {
    const started = Date.now();
    const req = http.request({ host: '127.0.0.1', port: port, path: '/' + query, method: 'POST', agent: false, headers: { 'Content-Type': 'text/plain;charset=utf-8' } }, (res) => {
      let text = '';
      res.setEncoding('utf8');
      res.on('data', (c) => { text += c; });
      res.on('end', () => {
        let json = null;
        try { json = JSON.parse(text); } catch (e) { json = null; }
        resolve({ status: res.statusCode, type: res.headers['content-type'], json: json, html: json ? '' : text.slice(0, 15), ms: Date.now() - started });
      });
    });
    req.on('error', (e) => resolve({ lost: true, why: e.code || e.message, ms: Date.now() - started }));
    req.end(JSON.stringify(body));
  });
}
/* A phone that stops waiting after giveUp milliseconds. */
function impatient(port, query, body, giveUp) {
  return new Promise((resolve) => {
    const req = http.request({ host: '127.0.0.1', port: port, path: '/' + query, method: 'POST', agent: false }, () => resolve('answered'));
    req.on('error', () => resolve('gave up'));
    req.end(JSON.stringify(body));
    setTimeout(() => req.destroy(), giveUp);
  });
}
const wait = (ms) => new Promise((r) => setTimeout(r, ms));
dev.server.listen(0, '127.0.0.1', async () => {
  const port = dev.server.address().port, out = {};
  try {
    const first = await post(port, '', { action: 'login', name: 'Mason', pin: '271845' });
    const token = first.json.result.token, day = first.json.sync.days[2].date;
    const sale = (op, price, time) => ({ action: 'createSale', token: token, opId: op, client: { name: 'Lost ' + op }, service: 'House wash', priceCents: price, billing: 'once', appointment: time ? { date: day, time: time } : null });
    const sales = async () => (await post(port, '', { action: 'sync', token: token })).json.sync.sales.map((s) => s.priceCents).sort();
    out.plain = { status: first.status, type: first.type, clock: [typeof first.json.sync.nowMs, first.json.sync.nowHM.length] };
    out.dropped = await post(port, '?drop=1', sale('op-drop-000001', 15000, '08:00'));
    out.afterDrop = await sales();
    out.retry = (await post(port, '', sale('op-drop-000001', 15000, '08:00'))).json;
    out.changed = (await post(port, '', sale('op-drop-000001', 17500, '09:30'))).json;
    out.afterRetries = await sales();
    out.failed = await post(port, '?fail=1', sale('op-fail-000001', 22000, '12:00'));
    out.failedWithDrop = await post(port, '?fail=1&drop=1', sale('op-fail-000002', 23000, '12:00'));
    out.afterFail = await sales();
    out.slow = await post(port, '?delay=250', { action: 'sync', token: token });
    out.slowDrop = await post(port, '?delay=250&drop=1', sale('op-drop-000002', 30000, null));
    out.afterSlowDrop = await sales();
    out.gaveUpOnDelay = await impatient(port, '?delay=300', sale('op-gone-000001', 41000, null), 60);
    out.gaveUpOnDrop = await impatient(port, '?delay=300&drop=1', sale('op-gone-000002', 42000, null), 60);
    await wait(450);
    out.afterGivingUp = await sales();
    out.dropRefused = await post(port, '?drop=1', sale('op-drop-000003', 50000, '08:00'));
    out.afterDropRefused = await sales();
    out.stillAnswers = (await post(port, '', { action: 'ping' })).json;
  } catch (e) { out.crash = String(e && e.stack ? e.stack : e); }
  process.stdout.write(JSON.stringify(out));
  dev.server.close();
  process.exit(0);
});
`;

test('the local stand-in over HTTP: ?drop=1 runs and saves the request and then says nothing, and ?delay and ?fail still work', () => {
  const text = execFileSync(process.execPath, ['-e', DEV_PROBE, path.join(__dirname, 'dev-server.js')], { cwd: root, encoding: 'utf8', timeout: 30000, stdio: ['ignore', 'pipe', 'pipe'] });
  const out = JSON.parse(text);
  assert(!out.crash, 'the helper crashed: ' + out.crash);
  assert.deepStrictEqual(out.plain, { status: 200, type: 'application/json; charset=utf-8', clock: ['number', 5] });

  /* drop=1: the phone gets no answer at all, but the sale is there. */
  assert.strictEqual(out.dropped.lost, true, 'a dropped answer came back: ' + JSON.stringify(out.dropped));
  assert.deepStrictEqual(out.afterDrop, [15000], 'the request whose answer was dropped was not saved');
  /* So the tester can go on from a real lost answer: the same request again is a replay, a changed one is already_saved. */
  assert.deepStrictEqual([out.retry.ok, out.retry.replay, typeof out.retry.result.saleId], [true, true, 'string']);
  assert.deepStrictEqual([out.changed.ok, out.changed.error, out.changed.sync.sales.length], [false, { code: 'already_saved', message: ALREADY_SAVED }, 1]);
  assert.deepStrictEqual(out.afterRetries, [15000]);

  /* fail=1 is as it was: HTTP 500, an HTML page, nothing run. With fail=1, drop=1 changes nothing. */
  [out.failed, out.failedWithDrop].forEach((r) => assert.deepStrictEqual([r.status, r.type, r.html], [500, 'text/html; charset=utf-8', '<!DOCTYPE html>']));
  assert.deepStrictEqual(out.afterFail, [15000]);

  /* delay is as it was, and combines with drop: the wait first, then the save, then silence. */
  assert(out.slow.status === 200 && out.slow.json.ok === true && out.slow.ms >= 240, 'delay=250 answered after ' + out.slow.ms + ' ms');
  assert(out.slowDrop.lost === true && out.slowDrop.ms >= 240, 'delay=250&drop=1: ' + JSON.stringify(out.slowDrop));
  assert.deepStrictEqual(out.afterSlowDrop, [15000, 30000]);

  /* A phone that stops waiting during a plain delay: the request is not run (as before). With drop=1 it is run
     all the same, like a backend that carries on after the app gave up. */
  assert.deepStrictEqual([out.gaveUpOnDelay, out.gaveUpOnDrop], ['gave up', 'gave up']);
  assert.deepStrictEqual(out.afterGivingUp, [15000, 30000, 42000]);

  /* A request the core refuses is refused, dropped or not: nothing is saved by it. */
  assert.strictEqual(out.dropRefused.lost, true);
  assert.deepStrictEqual(out.afterDropRefused, [15000, 30000, 42000]);
  assert.strictEqual(out.stillAnswers.ok, true, 'the stand-in stopped answering after a dropped connection');

  const source = fs.readFileSync(path.join(__dirname, 'dev-server.js'), 'utf8');
  ['?delay=1500', '?fail=1', '?drop=1'].forEach((knob) => assert(source.slice(0, source.indexOf("'use strict'")).indexOf(knob) > 0, 'the note at the top of dev-server.js does not explain ' + knob));
});

console.log('\n' + (count - failed.length) + ' of ' + count + ' backend tests passed.');
if (failed.length) {
  console.log('Failed:\n  ' + failed.join('\n  '));
  process.exit(1);
}
