#!/usr/bin/env node
/*
 * Tests for team/src/core.js (the shared rules: sign-in, roles, booking, commission, standards).
 *
 *   node tools/test-core.js            run everything; one line per test; exit code 1 on any failure
 *   node tools/test-core.js booking    run only the tests whose name contains "booking"
 *
 * No dependencies. The clock is movable (env.now) and days are America/Chicago days, like the
 * real backend. These tests are written to break the rules, not to admire them.
 */
'use strict';
const path = require('path');
const crypto = require('crypto');
const C = require(path.join(__dirname, '..', 'src', 'core.js'));

/* ---------- tiny test kit ---------- */

let passed = 0, failed = 0, group = '';
const failures = [];
const only = process.argv[2] ? process.argv[2].toLowerCase() : null;

function section(name) { group = name; }

function test(name, fn) {
  const full = group + ': ' + name;
  if (only && full.toLowerCase().indexOf(only) < 0) return;
  try { fn(); passed++; console.log('ok    ' + full); }
  catch (e) {
    failed++; failures.push(full);
    console.log('FAIL  ' + full + '  ->  ' + String(e && e.message ? e.message : e).split('\n')[0]);
  }
}

function short(s) { s = String(s); return s.length > 300 ? s.slice(0, 300) + '...' : s; }
function ok(cond, msg) { if (!cond) throw new Error(msg || 'expected something true'); }
function eq(got, want, msg) {
  const a = JSON.stringify(got), b = JSON.stringify(want);
  if (a !== b) throw new Error((msg ? msg + ': ' : '') + 'got ' + short(a) + ' but wanted ' + short(b));
}
function has(text, piece, msg) { if (String(text).indexOf(piece) < 0) throw new Error((msg || 'missing') + ': ' + piece); }
function lacks(text, piece, msg) { if (String(text).indexOf(piece) >= 0) throw new Error((msg || 'must not contain') + ': ' + piece); }

/* A small seeded random number generator, so a failing run can be repeated exactly. */
function rng(seed) {
  let a = seed >>> 0;
  return function () {
    a = (a + 0x6D2B79F5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/* ---------- Chicago time ---------- */

const chicago = new Intl.DateTimeFormat('en-US', {
  timeZone: 'America/Chicago', year: 'numeric', month: '2-digit', day: '2-digit',
  hour: '2-digit', minute: '2-digit', hourCycle: 'h23'
});
function parts(ms) { const o = {}; chicago.formatToParts(new Date(ms)).forEach((p) => { o[p.type] = p.value; }); return o; }
function dayKey(ms) { const p = parts(ms); return p.year + '-' + p.month + '-' + p.day; }
function hm(ms) { const p = parts(ms); return p.hour + ':' + p.minute; }

/* The moment a Chicago wall clock shows this day and time. */
function chi(day, time) {
  time = time || '09:00';
  const d = day.split('-').map(Number), t = time.split(':').map(Number);
  for (const off of [6, 5]) {
    const ms = Date.UTC(d[0], d[1] - 1, d[2], t[0] + off, t[1]);
    if (dayKey(ms) === day && hm(ms) === time) return ms;
  }
  throw new Error('There is no ' + day + ' ' + time + ' in Chicago');
}

const MIN = 60000, HOUR = 3600000, DAY = 86400000;
const CODES = ['auth', 'locked', 'forbidden', 'invalid', 'not_found', 'slot_taken', 'slot_closed', 'already_saved', 'busy', 'server'];
const ALREADY_SAVED = 'Your first try was saved. Check it, then make the change again if you still need to.';
const SLOTS = ['08:00', '09:30', '12:00', '14:00'];
const ACTIONS = ['sync', 'logout', 'changePin', 'ackStandards', 'addNote', 'createSale', 'bookJob', 'moveJob', 'updateClient',
  'setJobDone', 'updateJob', 'deleteClient', 'deleteSale', 'updateSale', 'saveMember', 'removeMember', 'resetPin', 'saveSettings',
  'setDays', 'readNotices', 'clearProblems'];

/* ---------- a world: one store, one core, a clock we control, and a cast of people ---------- */

function world(opts) {
  opts = opts || {};
  const w = { t: opts.t || chi(opts.day || '2026-11-17', opts.time || '09:00'), n: opts.n || 0, emails: [], tokens: {}, ids: {}, calls: 0, mailDown: false };
  w.env = {
    now: () => w.t, dayKey: dayKey, hm: hm,
    uuid: () => {
      const h = crypto.createHash('sha256').update('uuid-' + (++w.n)).digest('hex');
      return h.slice(0, 8) + '-' + h.slice(8, 12) + '-' + h.slice(12, 16) + '-' + h.slice(16, 20) + '-' + h.slice(20, 32);
    },
    notify: (m) => { if (w.mailDown) throw new Error('mail is down'); w.emails.push(m); }
  };
  w.store = C.memoryStore(opts.initial);
  w.store.setClock(() => w.t);
  w.core = C.create(w.store, w.env);

  /* Every single answer in every test goes through these checks. */
  w.raw = (req) => {
    w.calls++;
    let res;
    try { res = w.core.handle(req); } catch (e) { throw new Error('handle() threw: ' + (e && e.message)); }
    ok(res && typeof res === 'object' && typeof res.ok === 'boolean', 'answer is not {ok: ...}');
    const text = JSON.stringify(res);
    lacks(text, '"pinHash"', 'answer leaks a PIN hash'); lacks(text, '"salt"', 'answer leaks a PIN salt');
    if (!res.ok) {
      ok(res.error && CODES.indexOf(res.error.code) >= 0, 'unknown error code ' + JSON.stringify(res.error));
      ok(typeof res.error.message === 'string' && res.error.message.length > 3, 'error has no words');
      ok(!/undefined|null|NaN|\[object/.test(res.error.message), 'error words are not plain: ' + res.error.message);
      ok(!/customer/i.test(res.error.message), 'it is "client", never "customer": ' + res.error.message);
    } else {
      ok(!('error' in res), 'an accepted answer carries an error');
      ok(res.result && typeof res.result === 'object' && !Array.isArray(res.result), 'an accepted answer has no result');
      if (req.action !== 'ping' && req.action !== 'logout') ok(res.sync && typeof res.sync.rev === 'number' && C.dates.isDay(res.sync.today) && typeof res.sync.same === 'boolean', 'an accepted answer has no sync');
      /* Hidden from JSON and from key listings; only so that `res.error.code` reads "accepted" in a failure message. */
      Object.defineProperty(res, 'error', { enumerable: false, value: { code: 'accepted', message: '' } });
    }
    /* Whatever kind of answer it is, a sync in it carries the system's clock as it was when the request was answered. */
    if (res.sync) eq([res.sync.nowMs, res.sync.nowHM, res.sync.today], [w.t, hm(w.t), dayKey(w.t)], 'the clock in the sync of ' + (req && req.action));
    return res;
  };
  w.call = (who, action, fields) => w.raw(Object.assign({ action: action, token: w.tokens[who] }, fields || {}));
  w.must = (who, action, fields) => {
    const res = w.call(who, action, fields);
    if (!res.ok) throw new Error(who + ' ' + action + ' was refused: ' + res.error.code + ' "' + res.error.message + '"');
    return res;
  };
  /* A refusal must carry the expected code and must leave the stored data exactly as it was. */
  w.refuse = (who, action, fields, code) => {
    const before = JSON.stringify(w.store.dump());
    const res = w.call(who, action, fields);
    if (res.ok) throw new Error(who + ' ' + action + ' should have been refused (' + code + ') but was accepted');
    if (res.error.code !== code) throw new Error(who + ' ' + action + ': wanted ' + code + ' but got ' + res.error.code + ' "' + res.error.message + '"');
    if (JSON.stringify(w.store.dump()) !== before) throw new Error(who + ' ' + action + ' was refused (' + code + ') but still changed stored data');
    return res;
  };
  w.login = (who, name, pin) => {
    const res = w.raw({ action: 'login', name: name, pin: pin });
    if (!res.ok) throw new Error('login as ' + name + ' failed: ' + res.error.message);
    w.tokens[who] = res.result.token;
    return res;
  };
  w.tryLogin = (name, pin) => w.raw({ action: 'login', name: name, pin: pin });
  w.full = (who) => w.must(who, 'sync').sync;
  w.db = () => w.store.dump().data;
  w.rev = () => w.store.getRev();
  w.at = (day, time) => { w.t = chi(day, time); };
  w.wait = (ms) => { w.t += ms; };
  w.today = () => dayKey(w.t);
  w.openDays = (from, count, slots) => {
    const days = [];
    for (let i = 0; i < count; i++) days.push(slots ? { date: C.dates.addDays(from, i), open: true, slots: slots } : { date: C.dates.addDays(from, i), open: true });
    w.must('owner', 'setDays', { days: days });
  };
  /* A copy of this world as it is right now (same people, same tokens, its own store). */
  w.fork = () => {
    const f = world({ bare: true, initial: w.store.dump(), t: w.t, n: w.n + 100000 });
    f.tokens = Object.assign({}, w.tokens); f.ids = Object.assign({}, w.ids);
    return f;
  };
  if (opts.bare) return w;

  const boot = w.core.bootstrap({ name: 'Grayson', pin: '482913' });
  ok(boot.created && boot.pin === '482913', 'bootstrap did not make the owner');
  w.login('owner', 'Grayson', '482913');
  w.ids.owner = w.full('owner').me.id;
  [['mason', 'Mason Reed', 'rep', '271845'], ['jake', 'Jake Miller', 'rep', '604417'], ['cole', 'Cole', 'tech', '906132'], ['tess', 'Tess Hart', 'tech', '358206']]
    .forEach((p) => {
      const r = w.must('owner', 'saveMember', { member: { name: p[1], role: p[2], pin: p[3] } });
      ok(r.result.pin === p[3], 'saveMember did not hand back the PIN');
      w.ids[p[0]] = r.result.id;
      w.login(p[0], p[1], p[3]);
    });
  w.openDays(w.today(), 14);
  return w;
}

/* Two reps, each with one client, one sale and one booked visit, each visit given to a different tech. */
function seeded(opts) {
  const w = world(opts);
  const a = w.must('mason', 'createSale', {
    client: { name: 'Alpha Marker House', contact: 'Ann Alpha', phone: '615-555-0001', email: 'ann@alpha.example', address: '1 Alpha Way, Smithville' },
    service: 'Window cleaning', priceCents: 15000, billing: 'monthly', notes: 'alpha-secret-sale-note', stripeLink: 'https://pay.example/alpha',
    appointment: { date: '2026-11-18', time: '09:30' }
  }).result;
  const b = w.must('jake', 'createSale', {
    client: { name: 'Bravo Marker Home', contact: 'Bob Bravo', phone: '615-555-0002', email: 'bob@bravo.example', address: '2 Bravo Road, Smithville' },
    service: 'House wash', priceCents: 30000, billing: 'once', notes: 'bravo-secret-sale-note', stripeLink: 'https://pay.example/bravo',
    appointment: { date: '2026-11-18', time: '12:00' }
  }).result;
  w.ids.clientA = a.clientId; w.ids.saleA = a.saleId; w.ids.jobA = a.jobId;
  w.ids.clientB = b.clientId; w.ids.saleB = b.saleId; w.ids.jobB = b.jobId;
  w.must('owner', 'updateJob', { jobId: a.jobId, patch: { assignedTo: w.ids.cole } });
  w.must('owner', 'updateJob', { jobId: b.jobId, patch: { assignedTo: w.ids.tess } });
  w.must('mason', 'addNote', { kind: 'client', id: a.clientId, text: 'alpha-secret-client-note' });
  w.must('jake', 'addNote', { kind: 'client', id: b.clientId, text: 'bravo-secret-client-note' });
  w.must('cole', 'addNote', { kind: 'job', id: a.jobId, text: 'alpha-secret-job-note' });
  w.must('tess', 'addNote', { kind: 'job', id: b.jobId, text: 'bravo-secret-job-note' });
  return w;
}

/* The name and PIN each of the cast signs in with. */
const PINS = { owner: ['Grayson', '482913'], mason: ['Mason Reed', '271845'], jake: ['Jake Miller', '604417'], cole: ['Cole', '906132'], tess: ['Tess Hart', '358206'] };

function byId(list, id) { return list.filter((x) => x.id === id)[0] || null; }
function liveAt(w, date, time) { return w.db().jobs.filter((j) => j.status !== 'cancelled' && j.date === date && j.time === time).length; }

/* ================================================================== */
section('sha256');

function nodeSha(s) { return crypto.createHash('sha256').update(s, 'utf8').digest('hex'); }

test('matches Node for fixed inputs, including every padding edge', () => {
  const inputs = ['', 'a', 'abc', '1234', '000000', 'salt:1234', 'The quick brown fox jumps over the lazy dog',
    'héllo wörld', '日本語のテキスト', 'soap 🧼 and smile 😀 mixed', '\u0000\u0001\u007f', 'a\nb\tc\r\n',
    '<script>alert(1)</' + 'script>', 'x'.repeat(100000), 'é'.repeat(4097), '😀'.repeat(1000)];
  for (let n = 0; n <= 200; n++) inputs.push('q'.repeat(n));
  inputs.forEach((s) => { if (C.sha256(s) !== nodeSha(s)) throw new Error('differs for ' + JSON.stringify(s.slice(0, 20)) + ' (length ' + s.length + ')'); });
});

test('matches Node for 400 random strings of mixed alphabets', () => {
  const r = rng(7), pools = ['abcXYZ019 :-_', 'éñüßΩ', '中文€☃', ['😀', '🧼', '🌊']];
  for (let i = 0; i < 400; i++) {
    let s = '';
    const len = Math.floor(r() * 180);
    for (let k = 0; k < len; k++) { const p = pools[Math.floor(r() * pools.length)]; s += p[Math.floor(r() * p.length)]; }
    if (C.sha256(s) !== nodeSha(s)) throw new Error('differs for ' + JSON.stringify(s));
  }
});

test('turns numbers and other values into text first, and always gives 64 hex characters', () => {
  eq(C.sha256(1234), nodeSha('1234'));
  [null, undefined, 0, true, {}, []].forEach((v) => ok(/^[0-9a-f]{64}$/.test(C.sha256(v)), 'bad digest for ' + String(v)));
});

/* ================================================================== */
section('dates');

test('isDay and isHM accept only real days and times', () => {
  ['2026-11-17', '2028-02-29', '2000-01-01', '2026-12-31'].forEach((d) => ok(C.dates.isDay(d), d + ' should be a day'));
  ['2026-02-29', '2026-13-01', '2026-00-10', '2026-11-31', '2026-1-1', '26-11-17', '2026/11/17', '', ' 2026-11-17', '2026-11-17 ', '1999-12-31',
    20261117, null, undefined, {}, [], '2026-11-17T00:00', '2026-11-1٧'].forEach((d) => ok(!C.dates.isDay(d), JSON.stringify(d) + ' should not be a day'));
  ['00:00', '08:00', '23:59'].forEach((t) => ok(C.dates.isHM(t), t + ' should be a time'));
  ['24:00', '08:60', '8:00', '0800', '08:00 ', '08:0', 800, null, '', 'ab:cd', '-1:00'].forEach((t) => ok(!C.dates.isHM(t), JSON.stringify(t) + ' should not be a time'));
});

test('addMonths clamps to the last day of a short month and crosses years', () => {
  eq(C.dates.addMonths('2027-01-31', 1), '2027-02-28');
  eq(C.dates.addMonths('2028-01-31', 1), '2028-02-29');
  eq(C.dates.addMonths('2027-01-31', 2), '2027-03-31');
  eq(C.dates.addMonths('2027-01-31', 3), '2027-04-30');
  eq(C.dates.addMonths('2026-12-15', 1), '2027-01-15');
  eq(C.dates.addMonths('2026-11-30', 3), '2027-02-28');
  eq(C.dates.addMonths('2026-03-31', 12), '2027-03-31');
  eq(C.dates.addMonths('2028-02-29', 12), '2029-02-28');
  eq(C.dates.addMonths('2026-05-31', 25), '2028-06-30');
});

test('weeks start on Monday, including across a month and a year', () => {
  eq(C.dates.weekStart('2026-11-16'), '2026-11-16');   /* a Monday */
  eq(C.dates.weekStart('2026-11-17'), '2026-11-16');
  eq(C.dates.weekStart('2026-11-22'), '2026-11-16');   /* the Sunday */
  eq(C.dates.weekStart('2026-11-23'), '2026-11-23');
  eq(C.dates.weekStart('2026-12-01'), '2026-11-30');
  eq(C.dates.weekStart('2027-01-01'), '2026-12-28');
  eq(C.dates.weekStart('2027-01-03'), '2026-12-28');
  eq(C.dates.monthStart('2027-01-31'), '2027-01-01');
  eq(C.dates.addDays('2026-12-31', 1), '2027-01-01');
  eq(C.dates.addDays('2028-03-01', -1), '2028-02-29');
  eq(C.dates.addDays('2026-11-01', 1), '2026-11-02');   /* the day the clocks go back */
});

test('the test clock really is Chicago time (late evening is still the same day)', () => {
  const ms = chi('2026-11-17', '23:30');
  eq(new Date(ms).toISOString().slice(0, 10), '2026-11-18', 'this moment is already tomorrow in UTC');
  eq(dayKey(ms), '2026-11-17'); eq(hm(ms), '23:30');
  eq(hm(chi('2026-07-04', '00:05')), '00:05');   /* summer time, just after midnight */
});

/* ================================================================== */
section('commission math');

function sale(day, priceCents, billing, firstPct, monthlyPct) {
  return { day: day, priceCents: priceCents, billing: billing, firstPct: firstPct === undefined ? 30 : firstPct, monthlyPct: monthlyPct === undefined ? 10 : monthlyPct };
}
function clientWith(log) { return { statusLog: log }; }

test('a one-time sale pays 30% once, however long ago it was', () => {
  eq(C.calc.commissionEvents(sale('2026-01-15', 20000, 'once'), clientWith([{ day: '2026-01-15', status: 'New' }]), '2030-01-15'),
    [{ day: '2026-01-15', cents: 6000, kind: 'first' }]);
});

test('a monthly sale pays 30% then 10% on the same day of each later month', () => {
  const ev = C.calc.commissionEvents(sale('2026-11-17', 15000, 'monthly'), clientWith([{ day: '2026-11-17', status: 'New' }]), '2027-02-17');
  eq(ev, [{ day: '2026-11-17', cents: 4500, kind: 'first' }, { day: '2026-12-17', cents: 1500, kind: 'monthly' },
    { day: '2027-01-17', cents: 1500, kind: 'monthly' }, { day: '2027-02-17', cents: 1500, kind: 'monthly' }]);
  eq(C.calc.commissionEvents(sale('2026-11-17', 15000, 'monthly'), clientWith([]), '2026-12-16').length, 1, 'the day before the first monthly date');
});

test('a sale on the 31st pays on the last day of shorter months, then on the 31st again', () => {
  const days = C.calc.commissionEvents(sale('2027-01-31', 10000, 'monthly'), clientWith([]), '2027-06-30').map((e) => e.day);
  eq(days, ['2027-01-31', '2027-02-28', '2027-03-31', '2027-04-30', '2027-05-31', '2027-06-30']);
  eq(C.calc.commissionEvents(sale('2028-01-31', 10000, 'monthly'), clientWith([]), '2028-02-29').map((e) => e.day), ['2028-01-31', '2028-02-29']);
  eq(C.calc.commissionEvents(sale('2028-01-31', 10000, 'monthly'), clientWith([]), '2028-02-28').length, 1);
});

test('paused and cancelled months pay nothing, and resuming pays again', () => {
  const c = clientWith([{ day: '2026-01-10', status: 'New' }, { day: '2026-02-01', status: 'Active' }, { day: '2026-03-05', status: 'Paused' },
    { day: '2026-05-10', status: 'Active' }, { day: '2026-07-09', status: 'Cancelled' }, { day: '2026-09-11', status: 'Active' }]);
  const days = C.calc.commissionEvents(sale('2026-01-10', 10000, 'monthly'), c, '2026-12-31').filter((e) => e.kind === 'monthly').map((e) => e.day);
  eq(days, ['2026-02-10', '2026-05-10', '2026-06-10', '2026-10-10', '2026-11-10', '2026-12-10']);
});

test('a sale with an endDay pays nothing dated after that day, whatever the client\'s status says', () => {
  const days = (endDay, log, today) => C.calc.commissionEvents(Object.assign(sale('2026-01-10', 10000, 'monthly'), endDay ? { endDay: endDay } : {}), clientWith(log || []), today || '2026-12-31')
    .filter((e) => e.kind === 'monthly').map((e) => e.day);
  eq(days('2026-04-09'), ['2026-02-10', '2026-03-10'], 'ended the day before a pay day');
  eq(days('2026-04-10'), ['2026-02-10', '2026-03-10', '2026-04-10'], 'a pay day that is the end day itself still pays');
  eq(days('2026-04-11'), ['2026-02-10', '2026-03-10', '2026-04-10']);
  eq(days('2026-01-10'), [], 'ended the day it was sold: the first 30% and nothing more');
  eq(days('2026-02-09'), []);
  eq(days('2030-01-01', null, '2026-03-10'), ['2026-02-10', '2026-03-10'], 'an end day still to come changes nothing yet');
  eq(days(null).length, 11, 'no end day: every month so far');
  /* Cancelled in April, Active again from August (they bought something else): the months after August stay unpaid. */
  const log = [{ day: '2026-01-10', status: 'New' }, { day: '2026-04-20', status: 'Cancelled' }, { day: '2026-08-01', status: 'Active' }];
  eq(days('2026-04-20', log), ['2026-02-10', '2026-03-10', '2026-04-10']);
  eq(days(null, log), ['2026-02-10', '2026-03-10', '2026-04-10', '2026-08-10', '2026-09-10', '2026-10-10', '2026-11-10', '2026-12-10'], 'without the end day the old sale would start paying again');
  /* A pause before the end still only pauses. */
  eq(days('2026-07-01', [{ day: '2026-02-15', status: 'Paused' }, { day: '2026-04-15', status: 'Active' }]), ['2026-02-10', '2026-05-10', '2026-06-10']);
  eq(C.calc.commissionEvents(Object.assign(sale('2026-01-10', 10000, 'once'), { endDay: '2026-01-01' }), clientWith([]), '2026-12-31'), [{ day: '2026-01-10', cents: 3000, kind: 'first' }], 'the first payment never depends on it');
});

test('the rates saved on the sale are used, not today\'s', () => {
  const ev = C.calc.commissionEvents(sale('2026-01-10', 10000, 'monthly', 50, 20), clientWith([]), '2026-02-10');
  eq(ev.map((e) => e.cents), [5000, 2000]);
  eq(C.calc.commissionEvents(sale('2026-01-10', 10000, 'monthly', 0, 0), clientWith([]), '2026-02-10').map((e) => e.cents), [0, 0]);
});

test('odd cents round to the nearest cent, half a cent rounds up', () => {
  const first = (price, pct) => C.calc.commissionEvents(sale('2026-01-10', price, 'once', pct, 0), null, '2026-01-10')[0].cents;
  eq(first(3335, 30), 1001, '30% of $33.35 is 1000.5 cents');
  eq(first(3333, 30), 1000);
  eq(first(1, 30), 0); eq(first(2, 30), 1); eq(first(5, 10), 1); eq(first(4, 10), 0); eq(first(15, 10), 2);
  eq(first(9999, 10), 1000); eq(first(100000000, 30), 30000000); eq(first(0, 30), 0);
});

test('whole-number rates are exact for every price up to $500 (checked against integer math)', () => {
  for (let pct = 0; pct <= 100; pct++) for (let price = 0; price <= 50000; price += (price < 2000 ? 1 : 7)) {
    const want = Math.floor((price * pct + 50) / 100);
    const got = C.calc.commissionEvents(sale('2026-01-10', price, 'once', pct, 0), null, '2026-01-10')[0].cents;
    if (got !== want) throw new Error(pct + '% of ' + price + ' cents gave ' + got + ', wanted ' + want);
  }
});

test('rates with decimals (5.1%, 33.3%, 0.7%) still round half a cent up', () => {
  /* Each of these is exactly N and a half cents; floating point alone lands just under the half. */
  [[1500, 5.1, 77], [5500, 5.1, 281], [5500, 0.7, 39], [3000, 1.15, 35], [11000, 0.35, 39]].forEach((x) => {
    const ev = C.calc.commissionEvents(sale('2026-01-10', x[0], 'monthly', x[1], x[1]), clientWith([]), '2026-02-10');
    eq(ev[0].cents, x[2], x[1] + '% of ' + x[0] + ' cents (first)');
    eq(ev[1].cents, x[2], x[1] + '% of ' + x[0] + ' cents (monthly)');
  });
  let bad = 0, example = '';
  for (let p100 = 1; p100 <= 10000; p100 += 3) for (let price = 50; price <= 20000; price += 50) {
    if ((price * p100) % 10000 !== 5000) continue;
    const got = C.calc.commissionEvents(sale('2026-01-10', price, 'once', p100 / 100, 0), null, '2026-01-10')[0].cents;
    if (got !== (price * p100 + 5000) / 10000) { bad++; example = example || (p100 / 100) + '% of ' + price + ' cents gave ' + got; }
  }
  ok(bad === 0, bad + ' half-cent cases rounded down, for example ' + example);
});

test('sumEvents adds the events inside a range, both ends included', () => {
  const ev = [{ day: '2026-01-31', cents: 100 }, { day: '2026-02-01', cents: 20 }, { day: '2026-02-28', cents: 3 }];
  eq(C.calc.sumEvents(ev), 123);
  eq(C.calc.sumEvents(ev, '2026-02-01'), 23);
  eq(C.calc.sumEvents(ev, '2026-02-01', '2026-02-27'), 20);
  eq(C.calc.sumEvents(ev, null, '2026-01-31'), 100);
  eq(C.calc.sumEvents([], '2026-01-01', '2026-12-31'), 0);
});

test('statusOn reads the status log by day and starts at New', () => {
  const c = clientWith([{ day: '2026-03-05', status: 'Paused' }, { day: '2026-03-05', status: 'Active' }, { day: '2026-04-01', status: 'Cancelled' }]);
  eq(C.calc.statusOn(c, '2026-03-04'), 'New');
  eq(C.calc.statusOn(c, '2026-03-05'), 'Active', 'two changes on one day: the later one counts');
  eq(C.calc.statusOn(c, '2026-04-01'), 'Cancelled');
  eq(C.calc.statusOn(null, '2026-04-01'), 'New');
});

/* ================================================================== */
section('sign-in');

test('signing in answers with a token and that person\'s first full snapshot', () => {
  const w = world();
  const r = w.tryLogin('Mason Reed', '271845');
  eq([Object.keys(r).sort().join(), Object.keys(r.result).join(), typeof r.result.token], ['ok,result,sync', 'token', 'string']);
  ok(r.result.token.length >= 32 && r.result.token.length <= 200 && r.result.token !== w.tokens.mason, 'each sign-in gets its own long token');
  eq([r.sync.same, r.sync.me.id, r.sync.me.role, r.sync.today, r.sync.rev], [false, w.ids.mason, 'rep', '2026-11-17', w.rev()]);
  ok(w.raw({ action: 'sync', token: r.result.token }).ok);
});

test('name matching ignores case and extra spaces, and a first name is enough when it is unique', () => {
  const w = world();
  ['Grayson', 'grayson', 'GRAYSON', '  Grayson  ', '\tgrayson\n'].forEach((n) => ok(w.tryLogin(n, '482913').ok, 'could not sign in as ' + JSON.stringify(n)));
  ['Mason Reed', 'mason reed', 'MASON   REED', ' mason  reed ', 'mason', 'Mason'].forEach((n) => ok(w.tryLogin(n, '271845').ok, 'could not sign in as ' + JSON.stringify(n)));
  ok(w.tryLogin('tess', '358206').ok && w.tryLogin('Cole', '906132').ok);
  ok(w.tryLogin('grayson', 482913).ok, 'a PIN sent as a number still works');
});

test('a wrong name, a last name alone or part of a name does not sign in', () => {
  const w = world();
  ['Reed', 'Mas', 'Mason R', 'Mason Reed Jr', 'masonreed', '', '   ', null, undefined, 'nobody'].forEach((n) => {
    const r = w.tryLogin(n, '271845');
    ok(!r.ok && r.error.code === 'auth', JSON.stringify(n) + ' should not sign in');
    ok(!r.sync && !r.result, 'a failed sign-in must not carry data');
  });
});

test('two people with the same first name must use their full names', () => {
  const w = world();
  w.must('owner', 'saveMember', { member: { name: 'Jake Smith', role: 'rep', pin: '774169' } });
  eq(w.tryLogin('jake', '604417').error.code, 'auth'); eq(w.tryLogin('jake', '774169').error.code, 'auth');
  ok(w.tryLogin('jake miller', '604417').ok && w.tryLogin('Jake Smith', '774169').ok);
  eq(w.tryLogin('jake miller', '774169').error.code, 'auth', 'the other Jake\'s PIN must not open this one');
});

test('someone whose whole name is one word wins over someone it is the first name of', () => {
  const w = world();
  w.must('owner', 'saveMember', { member: { name: 'Cole Younger', role: 'tech', pin: '885203' } });
  const r = w.tryLogin('cole', '906132');
  ok(r.ok && r.sync.me.id === w.ids.cole);
  eq(w.tryLogin('cole', '885203').error.code, 'auth');
  ok(w.tryLogin('cole younger', '885203').ok);
});

test('a wrong PIN or a PIN of the wrong shape is refused with the same words', () => {
  const w = world();
  const words = w.tryLogin('nobody', '482913').error.message;
  ['000000', '0000', '1234', '4829', '48291', '4829133', '48291a', '', ' 482913', '482913 ', '482 913', null, undefined, [], {}, true, 12345678].forEach((p) => {
    const r = w.tryLogin('Grayson', p);
    ok(!r.ok && r.error.code === 'auth', 'PIN ' + JSON.stringify(p) + ' should be refused');
    eq(r.error.message, words, 'a wrong PIN and an unknown name must read the same');
  });
});

test('five wrong PINs lock that person, even for the right PIN, and 15 minutes later it lets go', () => {
  const w = world();
  for (let i = 1; i <= 5; i++) eq(w.tryLogin(i % 2 ? 'mason' : 'Mason Reed', '000000').error.code, 'auth', 'try ' + i);
  eq(w.tryLogin('mason', '271845').error.code, 'locked', 'right PIN while locked');
  eq(w.tryLogin('mason', '000000').error.code, 'locked');
  ok(w.tryLogin('jake miller', '604417').ok, 'other people are not locked');
  w.wait(14 * MIN);
  eq(w.tryLogin('Mason Reed', '271845').error.code, 'locked', 'still locked after 14 minutes');
  w.wait(MIN + 1000);
  ok(w.tryLogin('mason', '271845').ok, 'free again after 15 minutes');
});

test('four wrong PINs then the right one clears the count', () => {
  const w = world();
  for (let i = 0; i < 4; i++) w.tryLogin('mason', '000000');
  ok(w.tryLogin('mason', '271845').ok);
  for (let i = 0; i < 4; i++) eq(w.tryLogin('mason', '000000').error.code, 'auth');
  ok(w.tryLogin('mason', '271845').ok, 'the earlier four must not count any more');
});

test('a lock does not sign anyone out who is already in', () => {
  const w = world();
  for (let i = 0; i < 6; i++) w.tryLogin('mason', '000000');
  ok(w.call('mason', 'sync').ok);
});

const PAUSED_NOTICE = 'Someone tried the wrong PIN for Mason Reed 20 times. Their sign-in is paused for a few hours. Reset their PIN if that was not them.';

/* Counts every write a request makes to the store's cache and to its data, so a test can say "this stored nothing". */
function watchStore(w) {
  const seen = { cache: [], data: 0 }, s = w.store, real = { cachePut: s.cachePut, cacheDel: s.cacheDel, put: s.put, del: s.del, setRev: s.setRev };
  s.cachePut = (k, v, ttl) => { seen.cache.push(k); real.cachePut(k, v, ttl); };
  s.cacheDel = (k) => { seen.cache.push(k); real.cacheDel(k); };
  s.put = (c, d) => { seen.data++; real.put(c, d); };
  s.del = (c, id) => { seen.data++; real.del(c, id); };
  s.setRev = (n) => { seen.data++; real.setRev(n); };
  seen.stop = () => Object.assign(s, real);
  return seen;
}

test('there is no lock for the whole team: hundreds of wrong tries by strangers pause nobody', () => {
  const w = world();
  for (let i = 1; i <= 300; i++) {
    eq(w.tryLogin('stranger ' + i, '135790').error.code, 'auth', 'made-up name, try ' + i);
    eq(w.tryLogin(i % 2 ? 'Grayson' : 'mason', String(1000 + i)).error.code, 'auth', 'a real name with a PIN of the wrong shape, try ' + i);
  }
  /* Four wrong PINs each for three real people on top: 612 wrong tries in all, well past the old limit of 40. */
  ['Grayson', 'mason', 'cole'].forEach((n) => { for (let i = 0; i < 4; i++) eq(w.tryLogin(n, '000000').error.code, 'auth'); });
  Object.keys(PINS).forEach((k) => ok(w.tryLogin(PINS[k][0], PINS[k][1]).ok, PINS[k][0] + ' could not sign in with the right PIN'));
  eq(w.db().notices, []);
});

test('a wrong name, or a PIN that is not 6 digits, stores nothing at all: no counter is made or bumped', () => {
  const w = world();
  w.must('owner', 'saveMember', { member: { name: 'Jake Smith', role: 'rep', pin: '774169' } });
  w.must('owner', 'removeMember', { id: w.ids.tess });
  const before = JSON.stringify(w.store.dump()), seen = watchStore(w);
  /* nobody by that name; a last name alone; a first name two people share; someone who was removed; no name at all */
  ['nobody', 'stranger', 'Reed', 'jake', 'Tess Hart', 'tess', '', '   ', null, undefined, 'Grayson Wash', '__proto__', 'constructor'].forEach((n) => {
    for (let i = 0; i < 30; i++) eq(w.tryLogin(n, i % 2 ? '358206' : '000000').error.code, 'auth', 'name ' + JSON.stringify(n));
  });
  ['Grayson', 'mason', 'cole'].forEach((n) => ['1234', '0000', '48291', '4829133', '', 'abcdef', null].forEach((p) => {
    for (let i = 0; i < 10; i++) eq(w.tryLogin(n, p).error.code, 'auth');
  }));
  eq(seen.cache, [], 'a counter was stored for a wrong name or a malformed PIN');
  eq(seen.data, 0);
  eq(JSON.stringify(w.store.dump()), before);
  /* The watch itself works: one wrong 6 digit PIN for a real person is counted, for that person only. */
  eq(w.tryLogin('mason', '000000').error.code, 'auth');
  eq(seen.cache.sort(), ['fail6h:' + w.ids.mason, 'fail:' + w.ids.mason]);
  seen.stop();
  ok(w.tryLogin('Grayson', '482913').ok && w.tryLogin('cole', '906132').ok && w.tryLogin('jake miller', '604417').ok, 'and nobody was locked by any of it');
});

test('the lock says what that person can do about it: an owner is not told to ask the owner', () => {
  const w = world();
  for (let i = 0; i < 5; i++) { w.tryLogin('mason', '000000'); w.tryLogin('Grayson', '000000'); }
  eq(w.tryLogin('mason', '271845').error.message, 'Too many wrong tries. Wait 15 minutes, or ask the owner to reset your PIN.');
  eq(w.tryLogin('Grayson', '482913').error.message, 'Too many wrong tries. Wait 15 minutes and try again.');
  slowGuesses(w, 5, () => { w.tryLogin('mason', '000000'); w.tryLogin('Grayson', '000000'); });
  eq(w.tryLogin('mason', '271845').error.message, 'Too many wrong tries. This sign-in is paused for a few hours. Ask the owner to reset your PIN.');
  eq(w.tryLogin('Grayson', '482913').error.message, 'Too many wrong tries. This sign-in is paused for a few hours. To get in sooner, follow "Forgot your PIN?" in the setup guide.');
  eq(w.db().notices.map((n) => n.text).sort(), [
    'Someone tried the wrong PIN for Grayson 20 times. Sign-in under that name is paused for a few hours. Phones that are already signed in keep working. To sign in sooner, follow "Forgot your PIN?" in the setup guide.',
    PAUSED_NOTICE]);
  ok(w.call('owner', 'sync').ok && w.call('mason', 'sync').ok, 'phones that are already signed in keep working');
  /* What the setup guide tells the owner to do does work. */
  const fresh = w.core.resetOwnerPin();
  ok(w.tryLogin('Grayson', fresh.pin).ok);
});

test('changing your own PIN starts the count of wrong tries again, like a reset by the owner', () => {
  const w = world();
  slowGuesses(w, 5, (n) => { if (n < 20) w.tryLogin('mason', '000000'); });   /* 19 of the 20 */
  w.wait(16 * MIN);
  w.must('mason', 'changePin', { oldPin: '271845', newPin: '517293' });
  slowGuesses(w, 5, (n) => { if (n < 20) eq(w.tryLogin('mason', '000000').error.code, 'auth', 'wrong try ' + n + ' against the new PIN'); });
  w.wait(16 * MIN);
  ok(w.tryLogin('mason', '517293').ok, '19 more wrong tries against the new PIN do not add up with the 19 against the old one');
  eq(w.db().notices, []);
});

const REMOVED_WORDS = 'You are no longer on the team. Ask the owner if that is a mistake.';

test('a removed person cannot sign in, and their phone is signed out at once and told why', () => {
  const w = world();
  const second = w.tryLogin('mason', '271845').result.token;   /* Mason has two phones */
  ok(w.call('mason', 'sync').ok);
  w.must('owner', 'removeMember', { id: w.ids.mason });
  [w.tokens.mason, second].forEach((token) => {
    const r = w.raw({ action: 'sync', token: token });
    eq([r.ok, r.error.code, r.error.message, r.sync, r.result], [false, 'auth', REMOVED_WORDS, undefined, undefined], 'the phone hears why, and gets no data with it');
  });
  /* Whatever the phone asks for, it is told the same thing and nothing is done or saved. */
  const before = JSON.stringify(w.store.dump());
  ACTIONS.concat(['dumpEverything']).forEach((a) => {
    const r = w.call('mason', a, { client: { name: 'Ghost' }, service: 'House wash', priceCents: 100, oldPin: '271845', newPin: '517293', since: w.rev(), day: w.today(), opId: 'removed-op-0001' });
    eq([r.error.code, r.error.message, r.sync], ['auth', REMOVED_WORDS, undefined], a);
  });
  eq(JSON.stringify(w.store.dump()), before);
  eq(w.raw({ action: 'sync', token: second }).error.message, REMOVED_WORDS, 'and it is told again the next time, not just once');
  /* Signing in under that name is the same plain "no match" a stranger gets: nothing says the name was ever real. */
  const stranger = w.tryLogin('nobody', '271845').error;
  ['Mason Reed', 'mason'].forEach((n) => eq(w.tryLogin(n, '271845').error, stranger));
  eq(w.raw({ action: 'sync', token: 'x'.repeat(40) }).error.message, 'Please sign in again.', 'a phone that never was signed in is not told about the team');
  ok(w.call('jake', 'sync').ok && w.call('owner', 'sync').ok, 'nobody else is signed out');
});

test('a removed person\'s sign-ins are kept only to tell their phone why, and are cleared away at 90 days like any other', () => {
  const w = world();
  w.must('owner', 'removeMember', { id: w.ids.mason });
  eq(w.db().sessions.filter((s) => s.memberId === w.ids.mason).length, 1, 'the stored sign-in stays');
  w.wait(89 * DAY);
  w.login('jake', 'Jake Miller', '604417');
  eq(w.call('mason', 'sync').error.message, REMOVED_WORDS, 'still told why after 89 days');
  w.wait(DAY + HOUR);
  eq(w.call('mason', 'sync').error.message, 'Please sign in again.', 'after 90 days it is an expired sign-in like any other');
  w.login('jake', 'Jake Miller', '604417');   /* the next sign-in by anyone clears expired ones away */
  eq(w.db().sessions.filter((s) => s.memberId === w.ids.mason).length, 0);
  eq(w.call('mason', 'sync').error.message, 'Please sign in again.');
  /* Signing out, a role change and a PIN reset still end a sign-in the ordinary way. */
  w.login('owner', 'Grayson', '482913'); w.login('cole', 'Cole', '906132'); w.login('tess', 'Tess Hart', '358206');
  w.must('owner', 'resetPin', { id: w.ids.cole });
  w.must('owner', 'saveMember', { member: { id: w.ids.tess, name: 'Tess Hart', role: 'rep' } });
  eq([w.call('cole', 'sync').error.message, w.call('tess', 'sync').error.message], ['Please sign in again.', 'Please sign in again.']);
  /* Someone removed and then added again under the same name is a new person: the old phone is told, the new PIN works. */
  w.must('owner', 'removeMember', { id: w.ids.jake });
  const again = w.must('owner', 'saveMember', { member: { name: 'Jake Miller', role: 'rep', pin: '730526' } }).result;
  eq(w.call('jake', 'sync').error.message, REMOVED_WORDS);
  eq(w.tryLogin('jake miller', '730526').sync.me.id, again.id);
});

test('resetting a PIN signs that person out everywhere and only the new PIN works', () => {
  const w = world();
  const second = w.tryLogin('mason', '271845').result.token;
  const r = w.must('owner', 'resetPin', { id: w.ids.mason });
  ok(/^\d{6}$/.test(r.result.pin), 'a fresh six digit PIN comes back');
  eq(w.call('mason', 'sync').error.code, 'auth');
  eq(w.raw({ action: 'sync', token: second }).error.code, 'auth');
  if (r.result.pin !== '271845') eq(w.tryLogin('mason', '271845').error.code, 'auth');
  ok(w.tryLogin('mason', r.result.pin).ok);
  eq(w.must('owner', 'resetPin', { id: w.ids.jake, pin: '653421' }).result.pin, '653421');
  ok(w.tryLogin('jake miller', '653421').ok);
});

test('resetting a PIN also lifts a lock', () => {
  const w = world();
  for (let i = 0; i < 6; i++) w.tryLogin('mason', '000000');
  eq(w.tryLogin('mason', '271845').error.code, 'locked');
  w.must('owner', 'resetPin', { id: w.ids.mason, pin: '905172' });
  ok(w.tryLogin('mason', '905172').ok);
});

/* Four wrong PINs, then a wait long enough for the 15 minute lock to forget them: the slow way to guess. */
function slowGuesses(w, batches, guess) {
  for (let b = 0; b < batches; b++) {
    if (b) w.wait(16 * MIN);
    for (let i = 0; i < 4; i++) guess(b * 4 + i + 1);
  }
}

test('four wrong PINs every 15 minutes: the 20th inside 6 hours pauses that person and the owner is told once', () => {
  const w = world(), start = w.t, rev = w.rev();
  slowGuesses(w, 5, (n) => eq(w.tryLogin('mason', '000000').error.code, 'auth', 'wrong try ' + n + ' is just a wrong PIN'));
  const paused = w.tryLogin('mason', '271845');
  eq(paused.error.code, 'locked', 'the right PIN after 20 wrong ones');
  has(paused.error.message, 'paused for a few hours');
  eq(w.db().notices.map((n) => [n.type, n.text]), [['signin', PAUSED_NOTICE]]);
  ok(w.rev() > rev, 'the owner\'s phone is told there is something new');
  eq(w.must('owner', 'sync', { since: rev, day: w.today() }).sync.notices.length, 1);
  eq(w.emails.length, 0, 'in the app, not by email');
  ok(w.call('mason', 'sync').ok, 'a phone that is already signed in keeps working');
  ok(w.tryLogin('jake miller', '604417').ok, 'nobody else is paused');
  /* It outlasts the 15 minute lock, and more tries neither extend it nor tell the owner again. */
  w.wait(20 * MIN);
  for (let i = 0; i < 7; i++) eq(w.tryLogin('mason', i % 2 ? '271845' : '000000').error.code, 'locked');
  w.t = start + 6 * HOUR - MIN;
  eq(w.tryLogin('mason', '271845').error.code, 'locked', 'one minute before the 6 hours are up');
  eq(w.db().notices.length, 1, 'the owner is told once');
  w.t = start + 6 * HOUR + 1000;
  ok(w.tryLogin('mason', '271845').ok, 'free again once the 6 hours from the first wrong try are up');
  /* A new window starts from nothing. */
  slowGuesses(w, 4, () => w.tryLogin('mason', '000000'));
  w.wait(16 * MIN);
  ok(w.tryLogin('mason', '271845').ok, '16 wrong tries in the new window do not pause anyone');
  eq(w.db().notices.length, 1);
});

test('nineteen wrong PINs in 6 hours pause nobody, and the count does not carry into the next 6 hours', () => {
  const w = world(), start = w.t;
  slowGuesses(w, 5, (n) => { if (n < 20) w.tryLogin('mason', '000000'); });
  w.wait(16 * MIN);
  ok(w.tryLogin('mason', '271845').ok, 'a right PIN after 19 wrong ones');
  w.t = start + 6 * HOUR + 1000;
  eq(w.tryLogin('mason', '000000').error.code, 'auth');
  w.wait(16 * MIN);
  ok(w.tryLogin('mason', '271845').ok, 'the 19 from before are forgotten, so this was the first of a new count');
  eq(w.db().notices, []);
});

test('the owner resetting the PIN lifts the 6 hour pause', () => {
  const w = world();
  slowGuesses(w, 5, () => w.tryLogin('mason', '000000'));
  w.wait(16 * MIN);
  eq(w.tryLogin('mason', '271845').error.code, 'locked');
  w.must('owner', 'resetPin', { id: w.ids.mason, pin: '905172' });
  ok(w.tryLogin('mason', '905172').ok);
  slowGuesses(w, 4, () => w.tryLogin('mason', '000000'));
  w.wait(16 * MIN);
  ok(w.tryLogin('mason', '905172').ok, 'and the count started again from nothing');
});

test('a wrong current PIN in changePin counts like a wrong sign-in: five quick ones lock for 15 minutes', () => {
  const w = world();
  for (let i = 1; i <= 5; i++) eq(w.refuse('mason', 'changePin', { oldPin: '00000' + i, newPin: '517293' }, 'invalid').error.message, 'Your current PIN is not right.', 'guess ' + i);
  const locked = w.refuse('mason', 'changePin', { oldPin: '271845', newPin: '517293' }, 'locked');
  has(locked.error.message, 'Wait 15 minutes');
  ok(locked.sync && locked.sync.me.id === w.ids.mason, 'the phone stays signed in and is told where things stand');
  eq(w.tryLogin('mason', '271845').error.code, 'locked', 'it is the same count as sign-in, so signing in is locked too');
  ok(w.call('mason', 'sync').ok && w.call('jake', 'changePin', { oldPin: '604417', newPin: '454817' }).ok, 'nobody is signed out and nobody else is locked');
  w.wait(14 * MIN);
  w.refuse('mason', 'changePin', { oldPin: '271845', newPin: '517293' }, 'locked');
  w.wait(MIN + 1000);
  w.must('mason', 'changePin', { oldPin: '271845', newPin: '517293' });
  ok(w.tryLogin('mason', '517293').ok);
  /* Wrong sign-ins and wrong current PINs add up, and a right current PIN clears the short count. */
  for (let i = 0; i < 3; i++) w.tryLogin('jake miller', '000000');
  for (let i = 0; i < 2; i++) w.refuse('jake', 'changePin', { oldPin: '000000', newPin: '618294' }, 'invalid');
  w.refuse('jake', 'changePin', { oldPin: '454817', newPin: '618294' }, 'locked');
  for (let i = 0; i < 4; i++) w.refuse('cole', 'changePin', { oldPin: '000000', newPin: '618294' }, 'invalid');
  w.must('cole', 'changePin', { oldPin: '906132', newPin: '618294' });
  for (let i = 0; i < 4; i++) w.refuse('cole', 'changePin', { oldPin: '000000', newPin: '719305' }, 'invalid');
  w.must('cole', 'changePin', { oldPin: '618294', newPin: '719305' });
});

test('a borrowed phone cannot guess slowly either: 20 wrong current PINs in 6 hours pause changePin and tell the owner', () => {
  const w = world();
  slowGuesses(w, 5, (n) => eq(w.call('mason', 'changePin', { oldPin: String(100000 + n), newPin: '517293' }).error.code, 'invalid'));
  w.wait(16 * MIN);
  const r = w.refuse('mason', 'changePin', { oldPin: '271845', newPin: '517293' }, 'locked');
  has(r.error.message, 'paused for a few hours');
  eq(w.full('owner').notices.map((n) => n.text), [PAUSED_NOTICE]);
  ok(w.tryLogin('mason', '517293').error.code === 'locked' && w.tryLogin('mason', '271845').error.code === 'locked', 'and the PIN was never changed');
  w.must('owner', 'resetPin', { id: w.ids.mason, pin: '806193' });
  w.login('mason', 'Mason Reed', '806193');
  w.must('mason', 'changePin', { oldPin: '806193', newPin: '517293' });
});

test('sign-ins older than 90 days are deleted from the data the next time anyone signs in', () => {
  const w = world();
  eq(w.db().sessions.length, 5);
  w.wait(50 * DAY);
  w.login('tess', 'Tess Hart', '358206');            /* a second, newer sign-in for Tess */
  eq(w.db().sessions.length, 6, 'nothing has expired yet, so nothing is deleted');
  w.wait(41 * DAY);                                /* day 91: the first five are past 90 days */
  eq(w.call('mason', 'sync').error.code, 'auth');
  eq(w.db().sessions.length, 6, 'refusing an old sign-in does not delete it');
  eq(w.tryLogin('jake miller', '000000').error.code, 'auth');
  eq(w.db().sessions.length, 6, 'a failed sign-in deletes nothing');
  w.login('jake', 'Jake Miller', '604417');
  const left = w.db().sessions;
  eq(left.map((s) => s.memberId).sort(), [w.ids.jake, w.ids.tess].sort(), 'only Tess\'s newer sign-in and the one just made are left');
  ok(left.every((s) => w.t - s.createdAt <= 90 * DAY));
  ok(w.call('tess', 'sync').ok && w.call('jake', 'sync').ok, 'the sign-ins that are still good keep working');
  eq(w.call('mason', 'sync').error.code, 'auth');
  eq(w.call('owner', 'sync').error.code, 'auth');
});

test('resetPin refuses bad PINs, yourself and people who are gone', () => {
  const w = world();
  ['12', '1234', '48291', '1234567', 'abcdef', '482 91', 12, -123456, 1.5, '123456', '000000'].forEach((p) => w.refuse('owner', 'resetPin', { id: w.ids.mason, pin: p }, 'invalid'));
  w.refuse('owner', 'resetPin', { id: w.ids.owner, pin: '432187' }, 'invalid');
  w.refuse('owner', 'resetPin', { id: 'm_nobody' }, 'not_found');
  w.refuse('owner', 'resetPin', {}, 'not_found');
  w.must('owner', 'removeMember', { id: w.ids.jake });
  w.refuse('owner', 'resetPin', { id: w.ids.jake }, 'not_found');
  ok(w.call('mason', 'sync').ok, 'refused resets signed nobody out');
});

test('a session lasts 90 days and no longer', () => {
  const w = world();
  w.wait(90 * DAY - HOUR);
  ok(w.call('mason', 'sync').ok, 'still signed in just before 90 days');
  w.wait(7 * HOUR);
  eq(w.call('mason', 'sync').error.code, 'auth', 'signed out 6 hours past 90 days at the latest');
  w.wait(30 * DAY);
  eq(w.call('mason', 'createSale', { client: { name: 'Late' }, service: 'House wash', priceCents: 100 }).error.code, 'auth');
  ok(w.tryLogin('mason', '271845').ok, 'signing in again works');
});

test('an expired session stays dead when the owner edits that person', () => {
  const w = world();
  w.wait(91 * DAY);
  eq(w.call('mason', 'sync').error.code, 'auth');
  w.login('owner', 'Grayson', '482913');
  w.must('owner', 'saveMember', { member: { id: w.ids.mason, name: 'Mason Reed', role: 'rep' } });
  eq(w.call('mason', 'sync').error.code, 'auth', 'an edit by the owner must not bring an expired sign-in back to life');
  w.must('owner', 'saveMember', { member: { id: w.ids.mason, name: 'Mason T Reed', role: 'rep' } });
  eq(w.call('mason', 'sync').error.code, 'auth');
});

test('logout ends that phone only', () => {
  const w = world();
  const other = w.tryLogin('mason', '271845').result.token;
  const r = w.must('mason', 'logout');
  ok(r.sync === null || r.sync === undefined, 'logout must not carry data');
  eq(w.call('mason', 'sync').error.code, 'auth');
  eq(w.call('mason', 'logout').error.code, 'auth');
  ok(w.raw({ action: 'sync', token: other }).ok, 'the other phone stays signed in');
});

test('changePin: this phone stays in, every other phone is signed out, the old PIN stops working', () => {
  const w = world();
  const other = w.tryLogin('mason', '271845').result.token;
  w.refuse('mason', 'changePin', { oldPin: '000000', newPin: '517293' }, 'invalid');
  ['12', '1234', '48291', '1234567', 'abcdef', '', null, undefined, '654321', '111111'].forEach((p) => w.refuse('mason', 'changePin', { oldPin: '271845', newPin: p }, 'invalid'));
  ok(w.raw({ action: 'sync', token: other }).ok, 'a refused change signs nobody out');
  w.must('mason', 'changePin', { oldPin: '271845', newPin: '515927' });
  ok(w.call('mason', 'sync').ok, 'this phone stays signed in');
  eq(w.raw({ action: 'sync', token: other }).error.code, 'auth', 'the other phone is signed out');
  eq(w.tryLogin('mason', '271845').error.code, 'auth');
  ok(w.tryLogin('mason', '515927').ok);
  ok(w.call('jake', 'sync').ok && w.call('owner', 'sync').ok, 'nobody else is touched');
});

test('a renamed person signs in under the new name; a role change signs them out', () => {
  const w = world();
  w.must('owner', 'saveMember', { member: { id: w.ids.mason, name: 'Mason Q Reed', role: 'rep' } });
  eq(w.must('mason', 'sync').sync.me.name, 'Mason Q Reed', 'still signed in, with the new name');
  eq(w.tryLogin('mason reed', '271845').error.code, 'auth');
  ok(w.tryLogin('mason q reed', '271845').ok);
  w.must('owner', 'saveMember', { member: { id: w.ids.mason, name: 'Mason Q Reed', role: 'tech' } });
  eq(w.call('mason', 'sync').error.code, 'auth', 'a changed role means sign in again');
  eq(w.tryLogin('mason', '271845').sync.me.role, 'tech');
});

test('no token, a made-up token or the stored session id is never accepted', () => {
  const w = world();
  const storedIds = w.db().sessions.map((s) => s.id);
  ok(storedIds.length >= 5);
  [undefined, null, '', 'short', 'x'.repeat(16), 'x'.repeat(201), w.tokens.mason.slice(0, -1), w.tokens.mason + 'x', w.tokens.mason.toUpperCase(),
    C.sha256(w.tokens.mason), storedIds[0], 0, 12345678901234567, true, {}, [], [w.tokens.mason], { token: w.tokens.mason }].forEach((tok) => {
    ACTIONS.forEach((a) => {
      const r = w.raw({ action: a, token: tok });
      ok(!r.ok && r.error.code === 'auth' && !r.sync && !r.result, a + ' with token ' + short(JSON.stringify(tok)) + ' should be signed out, got ' + JSON.stringify(r.error));
    });
  });
});

test('the PIN is never stored: only a salted hash, different for people with the same PIN', () => {
  const w = world();
  w.must('owner', 'saveMember', { member: { name: 'Twin One', role: 'rep', pin: '271845' } });
  const team = w.db().team;
  team.forEach((m) => { ok(!('pin' in m), 'a PIN is stored in the clear'); ok(/^[0-9a-f]{64}$/.test(m.pinHash) && m.salt, 'no salted hash'); });
  const a = byId(team, w.ids.mason), b = team.filter((m) => m.name === 'Twin One')[0];
  ok(a.pinHash !== b.pinHash && a.salt !== b.salt, 'same PIN must not give the same hash');
  lacks(JSON.stringify(w.store.dump()), w.tokens.mason, 'a session token is stored in the clear');
});

test('bootstrap makes one owner once, and resetOwnerPin gives a new PIN and signs the owner out', () => {
  const w = world();
  eq(w.core.bootstrap({ name: 'Someone Else', pin: '999147' }), { created: false, name: 'Grayson' });
  eq(w.db().team.filter((m) => m.role === 'owner').length, 1);
  const r = w.core.resetOwnerPin();
  ok(r.name === 'Grayson' && /^\d{6}$/.test(r.pin));
  eq(w.call('owner', 'sync').error.code, 'auth');
  ok(w.tryLogin('grayson', r.pin).ok);
});

/* The PINs anyone would try first, written out a second way so the core's own rule is checked against something. */
function easyPin(p) {
  return /^(\d)\1{5}$/.test(p) || /^(\d\d)\1{2}$/.test(p) || /^(\d{3})\1$/.test(p) ||
    '01234567890123456789'.indexOf(p) >= 0 || '98765432109876543210'.indexOf(p) >= 0;
}
const EASY_PINS = ['000000', '111111', '999999', '123456', '234567', '456789', '012345', '567890', '890123', '654321', '987654', '543210', '210987', '098765',
  '121212', '909090', '474747', '123123', '482482', '900900', '007007'];
const FINE_PINS = ['482913', '271845', '730526', '906132', '112233', '123321', '123457', '121213', '100000', '000001', '135790', '246802', '122222', '654322', '123124'];

test('a PIN is exactly 6 digits wherever one is picked: 4 and 5 digit PINs are refused in plain words', () => {
  const w = world(), words = 'A PIN is 6 digits.';
  ['1234', '0000', '48291', '4829', '4829133', '48291a', 'abcdef', ' 482913', '48 2913', '', null, undefined, 4829, 1.5, true, ['482913'], { pin: '482913' }].forEach((p) => {
    const tag = ' for ' + JSON.stringify(p);
    if (p !== '' && p != null) {   /* for these two actions an empty PIN means "make one for them" */
      eq(w.refuse('owner', 'saveMember', { member: { name: 'New Hire', role: 'rep', pin: p } }, 'invalid').error.message, words, 'saveMember' + tag);
      eq(w.refuse('owner', 'resetPin', { id: w.ids.mason, pin: p }, 'invalid').error.message, words, 'resetPin' + tag);
    }
    eq(w.refuse('mason', 'changePin', { oldPin: '271845', newPin: p }, 'invalid').error.message, words, 'changePin' + tag);
  });
  /* The old 4 to 6 digit rule is gone: nobody can sign in with fewer than 6 digits, even if such a PIN were somehow stored. */
  ['2718', '27184', '2718450'].forEach((p) => eq(w.tryLogin('mason', p).error.code, 'auth'));
  ok(w.tryLogin('mason', '271845').ok, 'and those tries did not lock him');
  eq(w.must('owner', 'saveMember', { member: { name: 'New Hire', role: 'rep', pin: '730526' } }).result.pin, '730526');
  eq(w.must('owner', 'resetPin', { id: w.ids.mason, pin: 730526 }).result.pin, '730526', 'six digits sent as a number are still that PIN');
  w.must('jake', 'changePin', { oldPin: '604417', newPin: '730526' });
  ok(w.tryLogin('new hire', '730526').ok && w.tryLogin('mason', '730526').ok && w.tryLogin('jake miller', '730526').ok);
});

test('a PIN that is easy to guess is refused wherever one is picked, and one that only looks close is fine', () => {
  const w = world(), words = 'Pick a PIN that is harder to guess.';
  EASY_PINS.forEach((p) => {
    ok(easyPin(p), p + ' is on the easy list by mistake');
    eq(w.refuse('owner', 'saveMember', { member: { name: 'New Hire', role: 'tech', pin: p } }, 'invalid').error.message, words, 'saveMember with ' + p);
    eq(w.refuse('owner', 'resetPin', { id: w.ids.mason, pin: p }, 'invalid').error.message, words, 'resetPin with ' + p);
    eq(w.refuse('mason', 'changePin', { oldPin: '271845', newPin: p }, 'invalid').error.message, words, 'changePin with ' + p);
    eq(C.check.pin(p), words);
  });
  ok(w.tryLogin('mason', '271845').ok && w.call('mason', 'sync').ok, 'refused PINs changed nothing and signed nobody out');
  FINE_PINS.forEach((p, i) => {
    ok(!easyPin(p), p + ' is on the fine list by mistake');
    eq(C.check.pin(p), '', p + ' should be allowed');
    eq(w.must('owner', 'resetPin', { id: w.ids.jake, pin: p }).result.pin, p);
    w.must('owner', 'saveMember', { member: { name: 'Fine Pin ' + i, role: 'tech', pin: p } });
    ok(w.tryLogin('fine pin ' + i, p).ok && w.tryLogin('jake miller', p).ok);
  });
});

test('of the million possible PINs, exactly the 1,110 easy ones are refused', () => {
  let refused = 0;
  for (let n = 0; n < 1000000; n++) {
    const p = ('00000' + n).slice(-6), says = C.check.pin(p);
    if (says) refused++;
    if ((says !== '') !== easyPin(p)) throw new Error(p + (says ? ' is refused but is not easy to guess' : ' is easy to guess but is allowed'));
    if (says && says !== 'Pick a PIN that is harder to guess.') throw new Error(p + ' is refused with the wrong words: ' + says);
  }
  eq(refused, 1110);
  ['1234', '12345', '1234567', '', 'abcdef', null, undefined, 482913, ['482913']].forEach((p) => eq(C.check.pin(p), 'A PIN is 6 digits.', 'check.pin(' + JSON.stringify(p) + ')'));
});

test('a PIN the system makes is always 6 digits and never an easy one, whatever the dice say', () => {
  const w = world(), realUuid = w.env.uuid, seen = new Set();
  /* 5000 different rolls of the dice. With no guard, about five of them would come up as an easy PIN. */
  for (let k = 0; k < 5000; k++) {
    w.env.uuid = () => 'dice-' + k;
    const pin = w.must('owner', 'resetPin', { id: w.ids.mason }).result.pin;
    if (!/^\d{6}$/.test(pin)) throw new Error('the system made the PIN ' + JSON.stringify(pin));
    if (easyPin(pin)) throw new Error('the system made the easy PIN ' + pin + ' (roll ' + k + ')');
    seen.add(pin);
  }
  w.env.uuid = realUuid;
  ok(seen.size > 4950, 'the PINs it makes are spread out: ' + seen.size + ' different ones in 5000');
  ok(Array.from(seen).some((p) => p[0] === '0'), 'a PIN may start with 0 and still has 6 digits');
  for (let i = 0; i < 40; i++) {
    const r = w.must('owner', 'saveMember', { member: { name: 'Auto ' + i, role: 'tech' } }).result;
    ok(/^\d{6}$/.test(r.pin) && !easyPin(r.pin), 'saveMember made the PIN ' + r.pin);
    ok(w.tryLogin('auto ' + i, r.pin).ok, 'the PIN that was handed back signs that person in');
  }
  const o = w.core.resetOwnerPin();
  ok(/^\d{6}$/.test(o.pin) && !easyPin(o.pin) && w.tryLogin('grayson', o.pin).ok, 'resetOwnerPin made the PIN ' + o.pin);
});

test('first-time setup never starts the owner on a short or easy PIN, even when the host asks for one', () => {
  ['1234', '12345', '123456', '000000', '121212', '', null, undefined, 1234].forEach((given) => {
    const w = world({ bare: true });
    const boot = w.core.bootstrap({ name: 'Grayson', pin: given });
    ok(boot.created && /^\d{6}$/.test(boot.pin) && !easyPin(boot.pin), 'bootstrap with ' + JSON.stringify(given) + ' made the PIN ' + boot.pin);
    ok(boot.pin !== String(given), 'the PIN that was asked for was used');
    ok(w.tryLogin('grayson', boot.pin).ok);
    if (typeof given === 'string' && given) eq(w.tryLogin('grayson', given).error.code, 'auth', 'the PIN that was asked for must not sign the owner in');
  });
  const w = world({ bare: true });
  eq(w.core.bootstrap({ name: 'Grayson', pin: '482913' }), { created: true, name: 'Grayson', pin: '482913' }, 'a good PIN the host names is used as it is');
});

/* ================================================================== */
section('roles');

/* One request per action that the OWNER could really make in a seeded world, so a refusal can only be about the role. */
function sampleRequests(w) {
  return {
    addNote: { kind: 'client', id: w.ids.clientA, text: 'matrix note' },
    createSale: { client: { name: 'Matrix Client' }, service: 'House wash', priceCents: 5000, billing: 'once', appointment: { date: '2026-11-19', time: '08:00' } },
    bookJob: { clientId: w.ids.clientA, date: '2026-11-19', time: '09:30', what: 'Second visit' },
    moveJob: { jobId: w.ids.jobA, date: '2026-11-19', time: '12:00' },
    updateClient: { clientId: w.ids.clientA, patch: { phone: '615-555-9999' } },
    setJobDone: { jobId: w.ids.jobA, done: true },
    updateJob: { jobId: w.ids.jobA, patch: { what: 'Changed by the matrix' } },
    deleteClient: { clientId: w.ids.clientA },
    deleteSale: { saleId: w.ids.saleA },
    updateSale: { saleId: w.ids.saleA, patch: { priceCents: 1, service: 'Changed by the matrix', repId: w.ids.jake } },
    saveMember: { member: { name: 'Matrix Person', role: 'owner', pin: '121347' } },
    removeMember: { id: w.ids.jake },
    resetPin: { id: w.ids.jake, pin: '121347' },
    saveSettings: { settings: { firstPct: 99, notifyEmail: 'thief@evil.example', standards: [] } },
    setDays: { days: [{ date: '2026-11-25', open: false }, { date: '2026-12-25', open: true, slots: ['03:00'] }] },
    readNotices: {},
    clearProblems: {}
  };
}
const OWNER_ONLY = ['updateJob', 'deleteClient', 'deleteSale', 'updateSale', 'saveMember', 'removeMember', 'resetPin', 'saveSettings', 'setDays', 'readNotices', 'clearProblems'];
const NOT_FOR = {
  rep: OWNER_ONLY.concat(['setJobDone']),
  tech: OWNER_ONLY.concat(['createSale', 'bookJob', 'moveJob', 'updateClient'])
};

test('the owner can do every action in the table (so the table itself is sound)', () => {
  const base = seeded(), reqs = sampleRequests(base);
  Object.keys(reqs).forEach((a) => { const w = base.fork(); w.must('owner', a, reqs[a]); ok(w.rev() > base.rev(), a + ' did not count as a change'); });
});

['rep', 'tech'].forEach((role) => {
  NOT_FOR[role].forEach((a) => {
    test('a ' + role + ' cannot ' + a, () => {
      const w = seeded(), who = role === 'rep' ? 'mason' : 'cole';   /* Mason owns client A; Cole is assigned job A */
      const r = w.refuse(who, a, sampleRequests(w)[a], 'forbidden');
      ok(r.sync && r.sync.me.id === w.ids[who], 'a refusal still tells the phone where things stand');
      /* the same request again with an opId, and again as a retry: still refused, still nothing saved */
      w.refuse(who, a, Object.assign({ opId: 'matrix-op-0001' }, sampleRequests(w)[a]), 'forbidden');
      w.refuse(who, a, Object.assign({ opId: 'matrix-op-0001' }, sampleRequests(w)[a]), 'forbidden');
    });
  });
});

test('a rep or tech cannot make themselves the owner, reset the owner\'s PIN or remove the owner', () => {
  const w = seeded();
  ['mason', 'cole'].forEach((who) => {
    w.refuse(who, 'saveMember', { member: { id: w.ids[who], name: 'Sneaky', role: 'owner' } }, 'forbidden');
    w.refuse(who, 'saveMember', { member: { name: 'Sneaky Two', role: 'owner', pin: '135790' } }, 'forbidden');
    w.refuse(who, 'resetPin', { id: w.ids.owner, pin: '135790' }, 'forbidden');
    w.refuse(who, 'resetPin', { id: w.ids[who], pin: '135790' }, 'forbidden');
    w.refuse(who, 'removeMember', { id: w.ids.owner }, 'forbidden');
    w.refuse(who, 'saveSettings', { settings: { defaultTechId: w.ids[who] } }, 'forbidden');
  });
  eq(w.tryLogin('grayson', '135790').error.code, 'auth');
  ok(w.tryLogin('grayson', '482913').ok);
});

test('each role can do its own work', () => {
  const base = seeded(), reqs = sampleRequests(base);
  ['createSale', 'bookJob', 'moveJob', 'updateClient', 'addNote'].forEach((a) => { base.fork().must('mason', a, reqs[a]); });
  base.fork().must('cole', 'setJobDone', reqs.setJobDone);
  base.fork().must('cole', 'addNote', { kind: 'job', id: base.ids.jobA, text: 'gate code 4411' });
  ['mason', 'cole', 'owner'].forEach((who) => { const w = base.fork(); w.must(who, 'ackStandards'); w.must(who, 'changePin', { oldPin: who === 'mason' ? '271845' : who === 'cole' ? '906132' : '482913', newPin: '808197' }); w.must(who, 'logout'); });
});

test('a rep cannot touch another rep\'s client or job in any way', () => {
  const w = seeded();
  w.refuse('jake', 'createSale', { clientId: w.ids.clientA, service: 'House wash', priceCents: 100, billing: 'monthly' }, 'forbidden');
  w.refuse('jake', 'createSale', { clientId: w.ids.clientA, service: 'House wash', priceCents: 100, appointment: { date: '2026-11-19', time: '08:00' } }, 'forbidden');
  w.refuse('jake', 'bookJob', { clientId: w.ids.clientA, date: '2026-11-19', time: '08:00' }, 'forbidden');
  w.refuse('jake', 'moveJob', { jobId: w.ids.jobA, date: '2026-11-19', time: '08:00' }, 'forbidden');
  w.refuse('jake', 'updateClient', { clientId: w.ids.clientA, patch: { name: 'Stolen', phone: '000' } }, 'forbidden');
  w.refuse('jake', 'addNote', { kind: 'client', id: w.ids.clientA, text: 'I was here' }, 'forbidden');
  w.refuse('jake', 'addNote', { kind: 'job', id: w.ids.jobA, text: 'I was here' }, 'forbidden');
  /* and the same the other way round */
  w.refuse('mason', 'moveJob', { jobId: w.ids.jobB, date: '2026-11-19', time: '08:00' }, 'forbidden');
  w.refuse('mason', 'updateClient', { clientId: w.ids.clientB, patch: { address: 'nowhere' } }, 'forbidden');
});

test('a tech cannot mark, or write on, a job that is not theirs', () => {
  const w = seeded();
  w.refuse('tess', 'setJobDone', { jobId: w.ids.jobA, done: true }, 'forbidden');
  w.refuse('tess', 'setJobDone', { jobId: w.ids.jobA, done: false }, 'forbidden');
  w.refuse('tess', 'addNote', { kind: 'job', id: w.ids.jobA, text: 'not mine' }, 'forbidden');
  w.refuse('tess', 'addNote', { kind: 'client', id: w.ids.clientB, text: 'techs do not write on clients' }, 'forbidden');
  w.must('owner', 'updateJob', { jobId: w.ids.jobA, patch: { assignedTo: null } });
  w.refuse('cole', 'setJobDone', { jobId: w.ids.jobA }, 'forbidden');
  w.refuse('cole', 'addNote', { kind: 'job', id: w.ids.jobA, text: 'no longer mine' }, 'forbidden');
  w.must('owner', 'updateJob', { jobId: w.ids.jobA, patch: { assignedTo: w.ids.tess } });
  w.refuse('cole', 'setJobDone', { jobId: w.ids.jobA }, 'forbidden');
  w.must('tess', 'setJobDone', { jobId: w.ids.jobA });
  w.refuse('cole', 'setJobDone', { jobId: w.ids.jobA, done: false }, 'forbidden');
  eq(byId(w.db().jobs, w.ids.jobA).doneBy, w.ids.tess);
});

test('a rep cannot credit a sale to someone else, and the owner can', () => {
  const w = seeded();
  const r = w.must('mason', 'createSale', { client: { name: 'Credit Test' }, service: 'House wash', priceCents: 1000, repId: w.ids.jake }).result;
  eq(byId(w.db().sales, r.saleId).repId, w.ids.mason); eq(byId(w.db().clients, r.clientId).repId, w.ids.mason);
  const o = w.must('owner', 'createSale', { client: { name: 'Owner Entered' }, service: 'House wash', priceCents: 1000, repId: w.ids.jake }).result;
  eq(byId(w.db().sales, o.saleId).repId, w.ids.jake);
  ok(w.full('jake').clients.some((c) => c.id === o.clientId), 'the credited rep sees the client');
  w.refuse('owner', 'createSale', { client: { name: 'To A Tech' }, service: 'House wash', priceCents: 1000, repId: w.ids.cole }, 'invalid');
  w.refuse('owner', 'createSale', { client: { name: 'To Nobody' }, service: 'House wash', priceCents: 1000, repId: 'm_nobody' }, 'invalid');
});

test('a rep cannot hook a visit for their client onto another rep\'s sale', () => {
  const w = seeded();
  const js = w.must('jake', 'createSale', { client: { name: 'Bravo Two' }, service: 'House wash', priceCents: 2000 }).result;
  const r = w.must('mason', 'bookJob', { clientId: w.ids.clientA, date: '2026-11-19', time: '08:00', saleId: js.saleId }).result;
  eq(byId(w.db().jobs, r.jobId).saleId, null);
  eq(byId(w.db().sales, js.saleId).jobId, null);
});

test('a rep can fix contact details of their own client but not price, status, payment or owner', () => {
  const w = seeded();
  const before = byId(w.db().clients, w.ids.clientA);
  w.must('mason', 'updateClient', { clientId: w.ids.clientA, patch: {
    name: 'Alpha Marker House 2', contact: 'New Contact', phone: '615-555-7777', email: 'new@alpha.example', address: '9 New Street',
    priceCents: 1, service: 'Free', billing: 'once', status: 'Cancelled', payStatus: 'paid', stripeLink: 'https://evil.example/pay', startDate: '2020-01-01',
    repId: w.ids.jake, id: 'c_hijack', notes: [], statusLog: [], createdAt: 0 } });
  const after = byId(w.db().clients, w.ids.clientA);
  eq([after.name, after.contact, after.phone, after.email, after.address], ['Alpha Marker House 2', 'New Contact', '615-555-7777', 'new@alpha.example', '9 New Street']);
  ['priceCents', 'service', 'billing', 'status', 'payStatus', 'stripeLink', 'startDate', 'repId', 'id', 'notes', 'statusLog', 'createdAt'].forEach((k) => eq(after[k], before[k], k + ' must not change'));
  eq(w.db().clients.length, 2);
});

test('nobody, not even the owner, can rewrite a client\'s id, notes or history through updateClient', () => {
  const w = seeded();
  const before = byId(w.db().clients, w.ids.clientA);
  w.must('owner', 'updateClient', { clientId: w.ids.clientA, patch: { id: 'c_other', notes: [], statusLog: [], createdAt: 1 } });
  eq(byId(w.db().clients, w.ids.clientA), before);
});

test('the owner can hand a client to another rep: the new rep sees and books for them, past sales stay where they were', () => {
  const w = seeded();
  const saleBefore = byId(w.db().sales, w.ids.saleA), boardBefore = JSON.stringify(w.full('owner').board);
  const r = w.must('owner', 'updateClient', { clientId: w.ids.clientA, patch: { repId: w.ids.jake } });
  eq(r.result, { clientId: w.ids.clientA });
  eq(byId(w.db().clients, w.ids.clientA).repId, w.ids.jake);
  eq(byId(w.db().sales, w.ids.saleA), saleBefore, 'the sale already made is untouched, rep and all');
  eq(JSON.stringify(w.full('owner').board), boardBefore, 'and the leaderboard does not move');

  const jake = w.full('jake'), mason = w.full('mason');
  eq(jake.clients.map((c) => c.id).sort(), [w.ids.clientA, w.ids.clientB].sort(), 'the new rep sees the client');
  ok(jake.jobs.some((j) => j.id === w.ids.jobA), 'and their visits');
  eq(jake.sales.map((s) => s.id), [w.ids.saleB], 'but not the sale someone else made');
  eq([mason.clients, mason.jobs], [[], []], 'the old rep no longer sees the client or the visits');
  eq(mason.sales.map((s) => [s.id, s.repId, s.clientName, s.events.length]), [[w.ids.saleA, w.ids.mason, 'Alpha Marker House', 1]], 'the old rep keeps the sale and its commission');
  checkView(jake); checkView(mason);

  w.must('jake', 'addNote', { kind: 'client', id: w.ids.clientA, text: 'Mine to look after now.' });
  w.must('jake', 'bookJob', { clientId: w.ids.clientA, date: '2026-11-19', time: '08:00' });
  w.must('jake', 'moveJob', { jobId: w.ids.jobA, date: '2026-11-19', time: '09:30' });
  w.must('jake', 'updateClient', { clientId: w.ids.clientA, patch: { phone: '615-555-0177' } });
  const sold = w.must('jake', 'createSale', { clientId: w.ids.clientA, service: 'House wash', priceCents: 20000, billing: 'monthly' }).result;
  eq(byId(w.db().sales, sold.saleId).repId, w.ids.jake, 'a new sale is the new rep\'s');
  /* The new rep's monthly plan ends the old rep's. The old rep is told the day and that another plan took its place, but not which sale. */
  const mine = w.full('mason').sales[0];
  eq([mine.id, mine.endDay, mine.endedBy], [w.ids.saleA, '2026-11-17', 'other']);
  lacks(JSON.stringify(w.full('mason')), sold.saleId, 'the old rep is sent the id of a sale that is not theirs');
  eq(byId(w.full('owner').sales, w.ids.saleA).endedBy, sold.saleId, 'the owner can see which sale took its place');
  eq(byId(w.db().sales, w.ids.saleA).endedBy, sold.saleId, 'and the stored sale keeps the real id');
  w.refuse('mason', 'addNote', { kind: 'client', id: w.ids.clientA, text: 'still mine?' }, 'forbidden');
  w.refuse('mason', 'bookJob', { clientId: w.ids.clientA, date: '2026-11-19', time: '12:00' }, 'forbidden');
  w.refuse('mason', 'moveJob', { jobId: w.ids.jobA, date: '2026-11-19', time: '12:00' }, 'forbidden');
  w.refuse('mason', 'createSale', { clientId: w.ids.clientA, service: 'House wash', priceCents: 100 }, 'forbidden');

  /* Only to an active rep or owner, and only by the owner. */
  [w.ids.cole, 'm_nobody', '', null, 5, {}, [w.ids.mason], 'constructor'].forEach((id) => {
    const res = w.refuse('owner', 'updateClient', { clientId: w.ids.clientA, patch: { phone: 'should not save', repId: id } }, 'invalid');
    eq(res.error.message, 'Pick a sales rep or an owner who is on the team.');
  });
  w.must('jake', 'updateClient', { clientId: w.ids.clientA, patch: { repId: w.ids.mason } });
  eq(byId(w.db().clients, w.ids.clientA).repId, w.ids.jake, 'a rep cannot hand a client on');
  w.must('owner', 'updateClient', { clientId: w.ids.clientA, patch: { repId: w.ids.owner } });
  eq(byId(w.db().clients, w.ids.clientA).repId, w.ids.owner, 'the owner can take a client on');
  eq(w.full('jake').clients.map((c) => c.id), [w.ids.clientB]);

  /* The case it is for: a rep leaves, and their clients go to someone who is still here. */
  w.must('owner', 'removeMember', { id: w.ids.jake });
  w.refuse('owner', 'updateClient', { clientId: w.ids.clientB, patch: { repId: w.ids.jake } }, 'invalid');
  w.must('owner', 'updateClient', { clientId: w.ids.clientB, patch: { repId: w.ids.mason } });
  const after = w.full('mason');
  eq(after.clients.map((c) => c.id), [w.ids.clientB]);
  ok(after.jobs.some((j) => j.id === w.ids.jobB) && after.sales.every((s) => s.repId === w.ids.mason));
  eq(byId(w.db().sales, w.ids.saleB).repId, w.ids.jake, 'the rep who left keeps the credit for what they sold');
  checkData(w);
});

/* ================================================================== */
section('what each person receives');

function keys(o) { return Object.keys(o).sort().join(','); }
const TOP_KEYS = 'board,clients,days,jobs,me,notices,nowHM,nowMs,problems,rev,sales,same,settings,taken,team,today';

/* A seeded world with an owner email, a notice or two and a recorded problem, so there is something to leak. */
function leaky() {
  const w = seeded();
  w.must('owner', 'saveSettings', { settings: { notifyEmail: 'boss-private@ridgeline.example', defaultTechId: w.ids.tess } });
  w.mailDown = true;
  w.must('jake', 'createSale', { client: { name: 'Bravo Marker Shop' }, service: 'Pressure wash', priceCents: 7700 });
  w.mailDown = false;
  w.must('cole', 'ackStandards'); w.must('jake', 'ackStandards');
  ok(w.db().problems.length === 1 && w.db().notices.length >= 4, 'the setup should have a problem and some notices');
  return w;
}

/* Text that must never appear in anything sent to this person. */
function secretsFor(w, who) {
  const db = w.db(), out = [];
  db.team.forEach((m) => { out.push(m.pinHash, m.salt); });
  db.sessions.forEach((s) => out.push(s.id));
  Object.keys(w.tokens).forEach((k) => { if (k !== who) out.push(w.tokens[k]); });
  if (who !== 'owner') {
    out.push('boss-private@ridgeline.example', 'mail is down', 'read the company standards', ' sold ', '"defaultTechId"', '"notifyEmail"', '"emailOnBooking"', '"defaultSlots"', '"createdAt":' + byId(db.team, w.ids.owner).createdAt + ',"standardsAckAt"');
  }
  const alpha = ['Alpha Marker', 'Ann Alpha', '615-555-0001', 'ann@alpha.example', '1 Alpha Way', 'alpha-secret', 'pay.example/alpha', w.ids.clientA, w.ids.saleA, w.ids.jobA];
  const bravo = ['Bravo Marker', 'Bob Bravo', '615-555-0002', 'bob@bravo.example', '2 Bravo Road', 'bravo-secret', 'pay.example/bravo', w.ids.clientB, w.ids.saleB, w.ids.jobB];
  if (who === 'mason') out.push.apply(out, bravo);
  if (who === 'jake') out.push.apply(out, alpha);
  if (who === 'cole' || who === 'tess') out.push('"firstPct"', '"monthlyPct"', '"services"', '"priceCents"');   /* no rates, no price list, no prices */
  if (who === 'cole') out.push.apply(out, bravo.concat(['ann@alpha.example', 'alpha-secret-sale-note', 'alpha-secret-client-note', 'pay.example', '"priceCents":15000', '"stripeLink"', '"payStatus"']));
  if (who === 'tess') out.push.apply(out, alpha.concat(['bob@bravo.example', 'bravo-secret-sale-note', 'bravo-secret-client-note', 'pay.example', '"priceCents":30000', '"stripeLink"', '"payStatus"']));
  return out;
}
function assertNoLeak(w, who, res, label) {
  const text = JSON.stringify(res);
  secretsFor(w, who).forEach((s) => lacks(text, s, label + ' sent to ' + who + ' leaks'));
}

test('the owner receives everything', () => {
  const w = leaky(), s = w.full('owner');
  eq(keys(s), TOP_KEYS);
  eq(s.clients.length, 3); eq(s.sales.length, 3); eq(s.jobs.length, 2); eq(s.problems.length, 1); ok(s.notices.length >= 4);
  s.team.forEach((m) => eq(keys(m), 'active,createdAt,id,name,role,standardsAckAt'));
  eq(s.settings.notifyEmail, 'boss-private@ridgeline.example'); eq(s.settings.defaultTechId, w.ids.tess);
  ok(Array.isArray(s.settings.defaultSlots) && s.settings.emailOnBooking === true);
  eq(byId(s.team, w.ids.cole).standardsAckAt, w.t); eq(byId(s.team, w.ids.mason).standardsAckAt, 0);
  assertNoLeak(w, 'owner', s, 'sync');
});

test('a rep receives only their own clients, sales and jobs, field by field', () => {
  const w = leaky(), s = w.full('mason');
  eq(keys(s), TOP_KEYS);
  eq(keys(s.me), 'id,name,noticesSeenAt,role,standardsAckAt'); eq([s.me.id, s.me.name, s.me.role], [w.ids.mason, 'Mason Reed', 'rep']);
  eq(s.team.length, 5); s.team.forEach((m) => eq(keys(m), 'active,id,name,role', 'a team entry'));
  eq(keys(s.settings), 'businessName,firstPct,monthlyPct,services,standards,standardsUpdatedAt');
  eq(s.clients.map((c) => c.id), [w.ids.clientA]); eq(s.sales.map((x) => x.id), [w.ids.saleA]); eq(s.jobs.map((j) => j.id), [w.ids.jobA]);
  ok(s.clients.every((c) => c.repId === w.ids.mason) && s.sales.every((x) => x.repId === w.ids.mason));
  eq(s.notices, []); eq(s.problems, []);
  s.taken.forEach((t) => eq(keys(t), 'date,time', 'a taken slot carries no details'));
  ok(s.taken.some((t) => t.date === '2026-11-18' && t.time === '12:00'), 'the other rep\'s slot still shows as taken');
  s.board.forEach((b) => eq(keys(b), 'active,all,id,month,name,role,week'));
  ok(s.days.length === 14 && s.days.every((d) => keys(d) === 'date,open,slots'));
  eq(s.sales[0].clientName, 'Alpha Marker House'); eq(s.sales[0].events, [{ day: '2026-11-17', cents: 4500, kind: 'first' }]);
  eq(s.jobs[0].client, { name: 'Alpha Marker House', contact: 'Ann Alpha', phone: '615-555-0001', address: '1 Alpha Way, Smithville' });
  assertNoLeak(w, 'mason', s, 'sync');
  assertNoLeak(w, 'jake', w.full('jake'), 'sync');
});

test('a tech receives only the jobs given to them, with no money and no client list', () => {
  const w = leaky(), s = w.full('cole');
  eq(keys(s), TOP_KEYS);
  eq([s.clients, s.sales, s.days, s.taken, s.board, s.notices, s.problems], [[], [], [], [], [], [], []]);
  eq(s.jobs.map((j) => j.id), [w.ids.jobA]);
  eq(keys(s.jobs[0]), 'assignedTo,client,clientId,createdAt,createdBy,date,doneAt,doneBy,id,notes,saleId,status,time,what');
  eq(keys(s.jobs[0].client), 'address,contact,name,phone');
  s.team.forEach((m) => eq(keys(m), 'active,id,name,role'));
  eq(keys(s.settings), 'businessName,standards,standardsUpdatedAt', 'a tech is sent the standards, and neither the commission rates nor the price list');
  eq([s.settings.businessName, s.settings.standards, s.settings.standardsUpdatedAt], ['Ridgeline Wash Co.', C.DEFAULT_SETTINGS.standards, 0]);
  assertNoLeak(w, 'cole', s, 'sync');
  assertNoLeak(w, 'tess', w.full('tess'), 'sync');
});

test('a tech\'s phone is sent their jobs from 30 days ago onward; older ones only while they still need doing', () => {
  const w = world({ day: '2026-11-17' });
  const job = (name, date, time) => {
    const r = w.must('mason', 'createSale', { client: { name: name, phone: '615-555-0100', address: '5 Oak St' }, service: 'House wash', priceCents: 10000, appointment: { date: date, time: time } }).result;
    w.must('owner', 'updateJob', { jobId: r.jobId, patch: { assignedTo: w.ids.cole } });
    return r.jobId;
  };
  const done = job('Done On The 18th', '2026-11-18', '08:00'), late = job('Still Waiting', '2026-11-18', '09:30'), later = job('Done On The 20th', '2026-11-20', '08:00');
  const tessJob = w.must('mason', 'createSale', { client: { name: 'Tess Does This' }, service: 'House wash', priceCents: 10000, appointment: { date: '2026-11-18', time: '12:00' } }).result.jobId;
  w.must('owner', 'updateJob', { jobId: tessJob, patch: { assignedTo: w.ids.tess } });
  w.at('2026-11-18', '10:00'); w.must('cole', 'setJobDone', { jobId: done });
  w.at('2026-11-20', '10:00'); w.must('cole', 'setJobDone', { jobId: later });
  const coleSees = () => w.full('cole').jobs.map((j) => j.id).sort();
  const all = [done, late, later].sort();
  eq(coleSees(), all);
  w.at('2026-12-18', '09:00'); relog(w);   /* 30 days after the 18th */
  eq(coleSees(), all, 'a job done 30 days ago is still sent');
  w.at('2026-12-19', '00:05'); relog(w);   /* 31 days after */
  eq(coleSees(), [late, later].sort(), 'one from 31 days ago is not, unless it is still waiting to be done');
  w.at('2026-12-21', '09:00'); relog(w);
  eq(coleSees(), [late], 'the job from the 20th has gone too; the overdue one never leaves the phone of the person who has to do it');
  /* Nothing is deleted: the owner and the rep still have every job, and the old job is still there to be put back. */
  eq(w.full('owner').jobs.length, 4); eq(w.full('mason').jobs.length, 4);
  w.must('cole', 'setJobDone', { jobId: late });
  eq(coleSees(), [], 'once the old job is done it is history too');
  w.must('cole', 'setJobDone', { jobId: late, done: false });
  eq(coleSees(), [late], 'and marking it not done brings it back');
  w.must('owner', 'setJobDone', { jobId: done, done: false });
  eq(coleSees(), [done, late].sort(), 'an old finished job the owner puts back on the schedule is sent again');
  /* The other tech's phone was never sent any of these, and holds no more than Cole's does. */
  eq(w.full('tess').jobs.map((j) => j.id), [tessJob]);
  w.must('tess', 'setJobDone', { jobId: tessJob });
  eq(w.full('tess').jobs, []);
  const text = JSON.stringify(w.full('tess'));
  ['615-555-0100', '5 Oak St', 'Done On The 18th', 'Tess Does This'].forEach((x) => lacks(text, x, 'a phone number, address or name from an old job is still on the tech\'s phone'));
});

test('a tech stops seeing a job that is cancelled or given to someone else', () => {
  const w = seeded();
  w.must('owner', 'updateJob', { jobId: w.ids.jobA, patch: { status: 'cancelled' } });
  eq(w.full('cole').jobs, []);
  w.must('owner', 'updateJob', { jobId: w.ids.jobA, patch: { status: 'scheduled', assignedTo: w.ids.tess } });
  eq(w.full('cole').jobs, []);
  eq(w.full('tess').jobs.map((j) => j.id).sort(), [w.ids.jobA, w.ids.jobB].sort());
});

test('nothing leaks in any kind of answer: sign-in, saves, refusals, replays, changed retries, fast answers', () => {
  const w = leaky();
  const pins = { mason: ['Mason Reed', '271845'], jake: ['Jake Miller', '604417'], cole: ['Cole', '906132'], tess: ['Tess Hart', '358206'], owner: ['Grayson', '482913'] };
  Object.keys(pins).forEach((who) => {
    const own = who === 'mason' ? 'A' : 'B', other = who === 'mason' || who === 'cole' ? 'B' : 'A', rep = who === 'mason' || who === 'jake', tech = who === 'cole' || who === 'tess';
    /* Something this person may save, sent three times under one opId: for real, the same again, and changed. */
    const save = rep ? ['addNote', { kind: 'client', id: w.ids['client' + own], text: 'fine', opId: 'leak-op-' + who }]
      : tech ? ['addNote', { kind: 'job', id: w.ids['job' + (who === 'cole' ? 'A' : 'B')], text: 'fine', opId: 'leak-op-' + who }]
      : ['readNotices', { opId: 'leak-op-' + who }];
    const answers = {
      'sign-in': w.login(who, pins[who][0], pins[who][1]),
      'sync': w.call(who, 'sync'),
      'unchanged sync': w.call(who, 'sync', { since: w.rev(), day: w.today() }),
      'note on someone else\'s client': w.call(who, 'addNote', { kind: 'client', id: w.ids['client' + other], text: 'probe' }),
      'note on someone else\'s job': w.call(who, 'addNote', { kind: 'job', id: w.ids['job' + other], text: 'probe' }),
      'owner action': w.call(who, 'saveSettings', { settings: { firstPct: 30 } }),
      'bad request': w.call(who, 'bookJob', { clientId: 'c_missing', date: 'x', time: 'y' }),
      'unknown action': w.call(who, 'dumpEverything'),
      'own save': w.call(who, save[0], save[1]),
      'replay': w.call(who, save[0], Object.assign({}, save[1])),
      'changed retry': w.call(who, save[0], Object.assign({}, save[1], { text: 'changed', extra: 1 })),
      'ack': w.call(who, 'ackStandards'),
      'change PIN refused': w.call(who, 'changePin', { oldPin: '000000', newPin: '135790' })
    };
    ok(answers['own save'].ok && !answers['own save'].replay && answers.replay.replay === true, 'the replay was not a replay for ' + who);
    eq([answers['changed retry'].ok, answers['changed retry'].error.code, answers['changed retry'].sync.me.id], [false, 'already_saved', w.ids[who]], 'the changed retry for ' + who);
    Object.keys(answers).forEach((label) => assertNoLeak(w, who, answers[label], label));
    if (who !== 'owner') {
      ok(!answers['note on someone else\'s client'].ok && !answers['note on someone else\'s job'].ok && !answers['owner action'].ok, who + ' got through');
    }
  });
});

test('the data a person receives never changes because of what a different person asked for', () => {
  /* The core keeps a per-request memory of the store; one person's failed request must not bleed into the next answer. */
  const w = seeded();
  const before = JSON.stringify(w.full('mason'));
  w.call('jake', 'createSale', { clientId: w.ids.clientA, service: 'Hijack', priceCents: 1 });
  w.call('cole', 'updateClient', { clientId: w.ids.clientA, patch: { name: 'Hijack' } });
  w.call('jake', 'createSale', { client: { name: 'Half Saved' }, service: 'House wash', priceCents: 100, appointment: { date: '2026-11-18', time: '09:30' } });
  eq(JSON.stringify(w.full('mason')), before);
});

/* ================================================================== */
section('booking');

function sell(w, who, name, date, time, extra) {
  return w.call(who, 'createSale', Object.assign({ client: { name: name }, service: 'House wash', priceCents: 10000, billing: 'once',
    appointment: date ? { date: date, time: time } : null }, extra || {}));
}
function sellOk(w, who, name, date, time, extra) {
  const r = sell(w, who, name, date, time, extra);
  if (!r.ok) throw new Error('sale for ' + name + ' refused: ' + r.error.code + ' ' + r.error.message);
  return r.result;
}
/* The three ways a rep can ask for a slot. Each returns the answer; `spare` is a job of Mason's to move. */
function askers(w) {
  if (w.askers) return w.askers;
  const mine = sellOk(w, 'mason', 'Asker Home', '2026-11-30', '14:00');
  return w.askers = {
    createSale: (d, t) => w.call('mason', 'createSale', { client: { name: 'Asker New' }, service: 'House wash', priceCents: 10000, appointment: { date: d, time: t } }),
    bookJob: (d, t) => w.call('mason', 'bookJob', { clientId: mine.clientId, date: d, time: t }),
    moveJob: (d, t) => w.call('mason', 'moveJob', { jobId: mine.jobId, date: d, time: t })
  };
}
function refusedAll(w, date, time, code, why) {
  const ask = askers(w);
  Object.keys(ask).forEach((a) => {
    const before = JSON.stringify(w.store.dump());
    const r = ask[a](date, time);
    eq(r.error.code, code, a + ' ' + why);
    eq(JSON.stringify(w.store.dump()), before, a + ' ' + why + ' but saved something');
  });
}

test('a sale with an appointment saves the client, the sale and the visit together', () => {
  const w = world();
  const r = sellOk(w, 'mason', 'First Home', '2026-11-18', '09:30');
  const db = w.db(), job = byId(db.jobs, r.jobId), sale = byId(db.sales, r.saleId), client = byId(db.clients, r.clientId);
  eq([job.clientId, job.saleId, job.date, job.time, job.what, job.status, job.assignedTo, job.createdBy], [r.clientId, r.saleId, '2026-11-18', '09:30', 'House wash', 'scheduled', null, w.ids.mason]);
  eq([sale.clientId, sale.jobId, sale.repId, sale.day, sale.firstPct, sale.monthlyPct], [r.clientId, r.jobId, w.ids.mason, '2026-11-17', 30, 10]);
  eq([client.repId, client.status, client.statusLog, client.payStatus, client.startDate], [w.ids.mason, 'New', [{ day: '2026-11-17', status: 'New' }], 'unpaid', '2026-11-17']);
  eq(r.commissionCents, 3000);
  ['owner', 'mason', 'jake'].forEach((who) => eq(w.full(who).taken, [{ date: '2026-11-18', time: '09:30' }], who + ' sees the slot as taken'));
});

test('a day that was never opened, a blocked day and a time not on the list are all closed', () => {
  const w = world();
  refusedAll(w, '2026-12-20', '09:30', 'slot_closed', 'on a day never opened');
  w.must('owner', 'setDays', { days: [{ date: '2026-11-20', open: false }] });
  refusedAll(w, '2026-11-20', '09:30', 'slot_closed', 'on a blocked day');
  refusedAll(w, '2026-11-19', '10:00', 'slot_closed', 'at a time not on the list');
  refusedAll(w, '2026-11-19', '09:31', 'slot_closed', 'one minute off a listed time');
  w.must('owner', 'setDays', { days: [{ date: '2026-11-21', open: true, slots: ['10:00'] }] });
  refusedAll(w, '2026-11-21', '09:30', 'slot_closed', 'at a default time on a day with its own times');
  ok(sell(w, 'jake', 'Own Times', '2026-11-21', '10:00').ok);
});

test('a day in the past is closed even if the owner opens it', () => {
  const w = world();
  w.must('owner', 'setDays', { days: [{ date: '2026-11-16', open: true }, { date: '2026-11-10', open: true }] });
  refusedAll(w, '2026-11-16', '14:00', 'slot_closed', 'yesterday');
  refusedAll(w, '2026-11-10', '14:00', 'slot_closed', 'last week');
});

test('a time earlier today, or right now, is closed; later today is open', () => {
  const w = world({ time: '09:30' });
  refusedAll(w, '2026-11-17', '08:00', 'slot_closed', 'earlier today');
  refusedAll(w, '2026-11-17', '09:30', 'slot_closed', 'this very minute');
  ok(sell(w, 'mason', 'Noon Today', '2026-11-17', '12:00').ok, 'later today is fine');
  w.at('2026-11-17', '13:59');
  ok(sell(w, 'jake', 'Two Today', '2026-11-17', '14:00').ok, 'one minute ahead is fine');
});

test('the day is the Chicago day, late at night and just after midnight', () => {
  const w = world({ time: '23:30' });   /* already Nov 18 in UTC */
  refusedAll(w, '2026-11-17', '14:00', 'slot_closed', 'at 11:30 PM for 2 PM the same day');
  ok(sell(w, 'mason', 'Early Bird', '2026-11-18', '08:00').ok, 'tomorrow 8 AM is open at 11:30 PM');
  eq(byId(w.db().sales, w.db().sales[0].id).day, '2026-11-17', 'the sale is dated today in Chicago, not tomorrow in UTC');
  w.at('2026-11-18', '00:10');
  refusedAll(w, '2026-11-17', '14:00', 'slot_closed', 'for yesterday, ten minutes after midnight');
  ok(sell(w, 'jake', 'After Midnight', '2026-11-18', '09:30').ok);
  w.at('2026-11-18', '08:01');
  refusedAll(w, '2026-11-18', '08:00', 'slot_closed', 'a minute after the slot started');
});

test('a day or time that is not real is refused as a mistake', () => {
  const w = world();
  [['2026-02-30', '09:30'], ['tomorrow', '09:30'], [null, '09:30'], [20261118, '09:30'], ['2026-11-18', '9:30'], ['2026-11-18', '25:00'],
    ['2026-11-18', null], ['2026-11-18', 930], [['2026-11-18'], ['09:30']], [{}, {}], ['', '']].forEach((x) => refusedAll(w, x[0], x[1], 'invalid', 'with ' + JSON.stringify(x)));
  ['next week', true, 5, [], {}, { date: '2026-11-18' }, { time: '09:30' }].forEach((a) => {
    w.refuse('mason', 'createSale', { client: { name: 'Odd Appointment' }, service: 'House wash', priceCents: 100, appointment: a }, 'invalid');
  });
});

test('never two live jobs in one slot: a second sale, by anyone, is refused', () => {
  const w = world();
  sellOk(w, 'mason', 'Winner', '2026-11-18', '09:30');
  ['jake', 'mason', 'owner'].forEach((who) => {
    const before = JSON.stringify(w.store.dump());
    eq(sell(w, who, 'Loser', '2026-11-18', '09:30').error.code, 'slot_taken', who);
    eq(JSON.stringify(w.store.dump()), before, 'the refused sale saved something');
  });
  eq(liveAt(w, '2026-11-18', '09:30'), 1);
});

test('never two live jobs in one slot: bookJob and moveJob are refused too', () => {
  const w = world();
  const a = sellOk(w, 'mason', 'Holder', '2026-11-18', '09:30'), b = sellOk(w, 'jake', 'Mover', '2026-11-18', '12:00');
  w.refuse('jake', 'bookJob', { clientId: b.clientId, date: '2026-11-18', time: '09:30' }, 'slot_taken');
  w.refuse('mason', 'bookJob', { clientId: a.clientId, date: '2026-11-18', time: '09:30' }, 'slot_taken');
  w.refuse('owner', 'bookJob', { clientId: b.clientId, date: '2026-11-18', time: '09:30' }, 'slot_taken');
  w.refuse('jake', 'moveJob', { jobId: b.jobId, date: '2026-11-18', time: '09:30' }, 'slot_taken');
  w.refuse('owner', 'moveJob', { jobId: b.jobId, date: '2026-11-18', time: '09:30' }, 'slot_taken');
  eq(liveAt(w, '2026-11-18', '09:30'), 1); eq(byId(w.db().jobs, b.jobId).time, '12:00');
});

test('never two live jobs in one slot: a cancelled job cannot come back onto a time that was taken since', () => {
  const w = world();
  const a = sellOk(w, 'mason', 'Cancelled One', '2026-11-18', '09:30');
  w.must('owner', 'updateJob', { jobId: a.jobId, patch: { status: 'cancelled' } });
  const b = sellOk(w, 'jake', 'Took The Slot', '2026-11-18', '09:30');
  w.refuse('owner', 'updateJob', { jobId: a.jobId, patch: { status: 'scheduled' } }, 'slot_taken');
  w.refuse('owner', 'updateJob', { jobId: a.jobId, patch: { assignedTo: w.ids.cole, what: 'sneak', status: 'scheduled' } }, 'slot_taken');
  eq(liveAt(w, '2026-11-18', '09:30'), 1);
  w.must('owner', 'updateJob', { jobId: b.jobId, patch: { status: 'cancelled' } });
  w.must('owner', 'updateJob', { jobId: a.jobId, patch: { status: 'scheduled' } });
  w.refuse('owner', 'updateJob', { jobId: b.jobId, patch: { status: 'scheduled' } }, 'slot_taken');
  eq(liveAt(w, '2026-11-18', '09:30'), 1);
});

test('a cancelled job frees its slot', () => {
  const w = world();
  const a = sellOk(w, 'mason', 'Will Cancel', '2026-11-18', '09:30');
  w.must('owner', 'updateJob', { jobId: a.jobId, patch: { status: 'cancelled' } });
  eq(w.full('jake').taken, []);
  ok(sell(w, 'jake', 'Takes It', '2026-11-18', '09:30').ok);
});

test('moving a job frees the old slot and holds the new one', () => {
  const w = world();
  const a = sellOk(w, 'mason', 'Mover', '2026-11-18', '09:30');
  w.must('mason', 'moveJob', { jobId: a.jobId, date: '2026-11-19', time: '14:00' });
  eq(w.full('jake').taken, [{ date: '2026-11-19', time: '14:00' }]);
  ok(sell(w, 'jake', 'Old Slot', '2026-11-18', '09:30').ok, 'the old slot is free');
  eq(sell(w, 'jake', 'New Slot', '2026-11-19', '14:00').error.code, 'slot_taken');
  w.must('mason', 'moveJob', { jobId: a.jobId, date: '2026-11-19', time: '14:00' });   /* onto its own time: fine */
  eq(w.db().jobs.filter((j) => j.clientId === a.clientId).length, 1, 'moving must not copy the job');
});

test('only a job that is still scheduled can be moved', () => {
  const w = seeded();
  w.must('cole', 'setJobDone', { jobId: w.ids.jobA });
  w.refuse('mason', 'moveJob', { jobId: w.ids.jobA, date: '2026-11-19', time: '08:00' }, 'invalid');
  w.must('owner', 'updateJob', { jobId: w.ids.jobB, patch: { status: 'cancelled' } });
  w.refuse('jake', 'moveJob', { jobId: w.ids.jobB, date: '2026-11-19', time: '08:00' }, 'invalid');
  w.refuse('owner', 'moveJob', { jobId: 'j_missing', date: '2026-11-19', time: '08:00' }, 'not_found');
});

test('blocking a day, or taking a time off its list, keeps what is already booked there', () => {
  const w = world();
  const a = sellOk(w, 'mason', 'Stays Booked', '2026-11-18', '09:30'), b = sellOk(w, 'jake', 'Also Stays', '2026-11-19', '12:00');
  w.must('owner', 'setDays', { days: [{ date: '2026-11-18', open: false }, { date: '2026-11-19', open: true, slots: ['08:00'] }] });
  eq([byId(w.db().jobs, a.jobId).status, byId(w.db().jobs, b.jobId).status], ['scheduled', 'scheduled']);
  eq(w.full('mason').taken.length, 2, 'both still show as taken');
  eq(sell(w, 'jake', 'Too Late', '2026-11-18', '08:00').error.code, 'slot_closed');
  eq(sell(w, 'jake', 'Too Late', '2026-11-19', '12:00').error.code, 'slot_closed');
  w.must('owner', 'setDays', { days: [{ date: '2026-11-18', open: true }] });
  eq(w.full('mason').days.filter((d) => d.date === '2026-11-18')[0].slots, SLOTS, 'reopening brings the times back');
  eq(sell(w, 'jake', 'Still Taken', '2026-11-18', '09:30').error.code, 'slot_taken');
});

test('a sale whose slot is refused saves nothing at all for a new client', () => {
  const w = world();
  sellOk(w, 'jake', 'Holder', '2026-11-18', '09:30');
  const counts = () => { const d = w.db(); return [d.clients.length, d.sales.length, d.jobs.length, d.notices.length, w.emails.length, w.rev()]; };
  const before = counts();
  [['2026-11-18', '09:30', 'slot_taken'], ['2026-12-25', '09:30', 'slot_closed'], ['2026-11-18', '10:10', 'slot_closed'], ['2026-11-16', '09:30', 'slot_closed'], ['2026-11-17', '08:00', 'slot_closed'], ['nope', '09:30', 'invalid']]
    .forEach((x) => {
      const r = w.refuse('mason', 'createSale', { client: { name: 'Never Saved', phone: '1', address: '2' }, service: 'House wash', priceCents: 5000, billing: 'monthly', notes: 'never', appointment: { date: x[0], time: x[1] } }, x[2]);
      eq(r.sync.clients, [], 'the answer shows no new client'); eq(r.sync.sales, []);
    });
  eq(counts(), before);
  lacks(JSON.stringify(w.store.dump()), 'Never Saved');
});

test('a sale whose slot is refused changes nothing on an existing client', () => {
  const w = seeded();
  w.must('owner', 'updateClient', { clientId: w.ids.clientA, patch: { status: 'Cancelled' } });
  const before = byId(w.db().clients, w.ids.clientA);
  w.refuse('mason', 'createSale', { clientId: w.ids.clientA, service: 'Pressure wash', priceCents: 99900, billing: 'once', notes: 'should vanish', appointment: { date: '2026-11-18', time: '12:00' } }, 'slot_taken');
  eq(byId(w.db().clients, w.ids.clientA), before, 'the client was changed by a refused sale');
  eq(w.db().sales.length, 2);
});

test('two reps asking for the same slot: exactly one gets it, on every slot of a day', () => {
  SLOTS.forEach((time, i) => {
    const w = world();
    const first = i % 2 ? 'mason' : 'jake', second = i % 2 ? 'jake' : 'mason';
    const a = sell(w, first, 'Racer One', '2026-11-20', time), b = sell(w, second, 'Racer Two', '2026-11-20', time);
    ok(a.ok && !b.ok && b.error.code === 'slot_taken', 'at ' + time);
    eq(liveAt(w, '2026-11-20', time), 1);
    ok(b.sync.taken.some((t) => t.date === '2026-11-20' && t.time === time), 'the loser is told the slot is now taken');
    eq(w.db().clients.length, 1);
  });
});

test('every slot of every open day can be booked once and only once', () => {
  const w = world();
  let booked = 0;
  for (let d = 0; d < 14; d++) SLOTS.forEach((time) => {
    const date = C.dates.addDays('2026-11-17', d);
    const r = sell(w, booked % 2 ? 'mason' : 'jake', 'Sweep ' + date + ' ' + time, date, time);
    if (date === '2026-11-17' && time <= '09:00') eq(r.error.code, 'slot_closed'); else { ok(r.ok, date + ' ' + time + ' refused'); booked++; }
  });
  eq(booked, 14 * 4 - 1);
  for (let d = 0; d < 14; d++) SLOTS.forEach((time) => {
    const date = C.dates.addDays('2026-11-17', d);
    ok(!sell(w, 'owner', 'Second', date, time).ok, date + ' ' + time + ' was booked twice');
    ok(liveAt(w, date, time) <= 1);
  });
  eq(w.db().jobs.length, booked); eq(w.full('mason').taken.length, booked);
});

test('a finished job keeps its slot, and un-finishing it does not double book', () => {
  const w = seeded();
  w.must('cole', 'setJobDone', { jobId: w.ids.jobA });
  eq(sell(w, 'jake', 'On A Done Slot', '2026-11-18', '09:30').error.code, 'slot_taken');
  w.must('cole', 'setJobDone', { jobId: w.ids.jobA, done: false });
  eq(byId(w.db().jobs, w.ids.jobA).status, 'scheduled');
  eq(liveAt(w, '2026-11-18', '09:30'), 1);
  w.must('owner', 'updateJob', { jobId: w.ids.jobA, patch: { status: 'cancelled' } });
  w.refuse('cole', 'setJobDone', { jobId: w.ids.jobA }, 'invalid');
  w.refuse('owner', 'setJobDone', { jobId: w.ids.jobA, done: false }, 'invalid');
  ok(sell(w, 'jake', 'Now Free', '2026-11-18', '09:30').ok);
  w.refuse('owner', 'setJobDone', { jobId: w.ids.jobA }, 'invalid');
  eq(liveAt(w, '2026-11-18', '09:30'), 1);
});

test('deleting a sale or a client frees their slots', () => {
  const w = seeded();
  w.must('owner', 'deleteSale', { saleId: w.ids.saleA });
  ok(sell(w, 'jake', 'After Sale Delete', '2026-11-18', '09:30').ok);
  w.must('owner', 'deleteClient', { clientId: w.ids.clientB });
  ok(sell(w, 'mason', 'After Client Delete', '2026-11-18', '12:00').ok);
});

test('a sale with no appointment can be booked later, and the visit links to that sale once', () => {
  const w = world();
  const s = sellOk(w, 'mason', 'Book Later', null);
  eq([s.jobId, w.db().jobs.length, byId(w.db().sales, s.saleId).jobId], [null, 0, null]);
  [0, false, '', undefined].forEach((a) => ok(w.must('mason', 'createSale', { client: { name: 'No Appt ' + String(a) }, service: 'House wash', priceCents: 100, appointment: a }).result.jobId === null));
  const j1 = w.must('mason', 'bookJob', { clientId: s.clientId, date: '2026-11-18', time: '08:00', saleId: s.saleId }).result.jobId;
  const j2 = w.must('mason', 'bookJob', { clientId: s.clientId, date: '2026-11-19', time: '08:00', saleId: s.saleId }).result.jobId;
  eq([byId(w.db().sales, s.saleId).jobId, byId(w.db().jobs, j1).saleId, byId(w.db().jobs, j2).saleId], [j1, s.saleId, null]);
  eq(byId(w.db().jobs, j2).what, 'House wash', 'a visit with no description takes the client\'s service');
  w.refuse('mason', 'bookJob', { clientId: 'c_missing', date: '2026-11-20', time: '08:00' }, 'not_found');
  w.refuse('mason', 'bookJob', { date: '2026-11-20', time: '08:00' }, 'not_found');
});

test('new visits go to the default tech while they are on the team', () => {
  const w = world();
  w.must('owner', 'saveSettings', { settings: { defaultTechId: w.ids.cole } });
  const a = sellOk(w, 'mason', 'For Cole', '2026-11-18', '08:00');
  eq(byId(w.db().jobs, a.jobId).assignedTo, w.ids.cole);
  eq(w.full('cole').jobs.length, 1);
  w.must('owner', 'removeMember', { id: w.ids.cole });
  const b = sellOk(w, 'mason', 'For Nobody', '2026-11-18', '09:30');
  eq(byId(w.db().jobs, b.jobId).assignedTo, null);
  w.refuse('owner', 'saveSettings', { settings: { defaultTechId: w.ids.cole } }, 'invalid');
  w.refuse('owner', 'saveSettings', { settings: { defaultTechId: 'm_nobody' } }, 'invalid');
});

test('setDays: bad dates save nothing, times are cleaned, and an open day always has times', () => {
  const w = world();
  w.refuse('owner', 'setDays', { days: [{ date: '2026-12-01', open: true }, { date: '2026-02-30', open: true }] }, 'invalid');
  w.refuse('owner', 'setDays', { days: [] }, 'invalid'); w.refuse('owner', 'setDays', {}, 'invalid'); w.refuse('owner', 'setDays', { days: 'all' }, 'invalid');
  w.refuse('owner', 'setDays', { days: [null] }, 'invalid'); w.refuse('owner', 'setDays', { days: ['2026-12-01'] }, 'invalid');
  const many = []; for (let i = 0; i < 63; i++) many.push({ date: C.dates.addDays('2027-01-01', i), open: true });
  w.refuse('owner', 'setDays', { days: many }, 'invalid');
  w.must('owner', 'setDays', { days: many.slice(0, 62) });
  w.must('owner', 'setDays', { days: [{ date: '2026-12-01', open: true, slots: ['14:00', '08:00', '08:00', '25:00', 'noon', 9, null, '10:15'] },
    { date: '2026-12-02', open: true, slots: [] }, { date: '2026-12-03', open: true, slots: 'none' }, { date: '2026-12-04', open: false, slots: ['07:00'] }] });
  const days = w.db().days;
  eq(byId(days, '2026-12-01').slots, ['08:00', '10:15', '14:00']);
  eq(byId(days, '2026-12-02').slots, SLOTS); eq(byId(days, '2026-12-03').slots, SLOTS);
  eq([byId(days, '2026-12-04').open, byId(days, '2026-12-04').slots], [false, ['07:00']]);
  const lots = []; for (let h = 0; h < 24; h++) lots.push((h < 10 ? '0' : '') + h + ':00', (h < 10 ? '0' : '') + h + ':30');
  w.must('owner', 'setDays', { days: [{ date: '2026-12-05', open: true, slots: lots }] });
  eq(byId(w.db().days, '2026-12-05').slots.length, 24, 'at most 24 times a day');
});

/* ================================================================== */
section('idempotency');

test('the same opId twice saves once and answers the same', () => {
  const w = world();
  const req = { opId: 'op-sale-0001', client: { name: 'Once Only' }, service: 'House wash', priceCents: 12000, billing: 'monthly', appointment: { date: '2026-11-18', time: '09:30' } };
  const a = w.must('mason', 'createSale', req), rev = w.rev();
  const b = w.must('mason', 'createSale', req), c = w.must('mason', 'createSale', req);
  eq(b.result, a.result); eq(c.result, a.result);
  ok(!a.replay && b.replay === true && c.replay === true);
  const db = w.db();
  eq([db.clients.length, db.sales.length, db.jobs.length, db.notices.length, w.emails.length, w.rev()], [1, 1, 1, 1, 1, rev]);
  eq(b.sync.sales.length, 1);
});

test('a retry is still a replay 59 minutes later', () => {
  const w = world();
  const req = { opId: 'op-sale-0002', client: { name: 'Slow Retry' }, service: 'House wash', priceCents: 12000 };
  w.must('mason', 'createSale', req); w.wait(59 * MIN);
  ok(w.must('mason', 'createSale', req).replay === true); eq(w.db().sales.length, 1);
});

test('a retry is remembered for 6 hours: still a replay after 5 hours 59 minutes', () => {
  const w = world();
  const req = { opId: 'op-sale-0003', client: { name: 'Very Slow Retry' }, service: 'House wash', priceCents: 12000 };
  const first = w.must('mason', 'createSale', req);
  w.wait(5 * HOUR + 59 * MIN);
  const again = w.must('mason', 'createSale', req);
  ok(again.replay === true, 'a phone that was out of signal all afternoon must not save the sale twice');
  eq([again.result, w.db().sales.length, w.db().clients.length], [first.result, 1, 1]);
  eq(C.LIMITS.retrySeconds, 21600, 'the longest the cache can remember');
});

test('a different person using the same opId is not a replay', () => {
  const w = world();
  const req = (name) => ({ opId: 'op-shared-0001', client: { name: name }, service: 'House wash', priceCents: 12000 });
  const a = w.must('mason', 'createSale', req('Mason Customer')), b = w.must('jake', 'createSale', req('Jake Customer')), c = w.must('owner', 'createSale', req('Owner Customer'));
  ok(!a.replay && !b.replay && !c.replay);
  eq(w.db().sales.map((s) => s.repId).sort(), [w.ids.mason, w.ids.jake, w.ids.owner].sort());
  ok(a.result.saleId !== b.result.saleId && b.result.saleId !== c.result.saleId);
  eq(w.full('jake').sales.length, 1, 'and nobody is handed the other person\'s answer');
});

test('a refused try is not remembered: the retry with the same opId goes through', () => {
  const w = world();
  sellOk(w, 'jake', 'Holder', '2026-11-18', '09:30');
  const req = (time) => ({ opId: 'op-retry-0001', client: { name: 'Second Try' }, service: 'House wash', priceCents: 100, appointment: { date: '2026-11-18', time: time } });
  eq(w.call('mason', 'createSale', req('09:30')).error.code, 'slot_taken');
  const r = w.must('mason', 'createSale', req('12:00'));
  ok(!r.replay && r.result.jobId);
  eq(w.db().sales.length, 2);
});

test('notes, bookings, done marks and confirmations all replay instead of repeating', () => {
  const w = seeded();
  const notes = byId(w.db().clients, w.ids.clientA).notes.length, notices = w.db().notices.length;
  for (let i = 0; i < 3; i++) {
    w.must('mason', 'addNote', { kind: 'client', id: w.ids.clientA, text: 'only once', opId: 'op-note-00001' });
    w.must('mason', 'bookJob', { clientId: w.ids.clientA, date: '2026-11-19', time: '08:00', opId: 'op-book-00001' });
    w.must('cole', 'setJobDone', { jobId: w.ids.jobA, opId: 'op-done-00001' });
    w.must('cole', 'ackStandards', { opId: 'op-ack-000001' });
  }
  eq(byId(w.db().clients, w.ids.clientA).notes.length, notes + 1);
  eq(w.db().jobs.length, 3);
  eq(w.db().notices.length, notices + 3, 'one notice each for the booking, the finished job and the confirmation');
});

test('an opId that is not a real id is ignored, never trusted and never a crash', () => {
  const w = world();
  [12345678, 'short', '', null, {}, ['op-array-0001'], true, 'x'.repeat(81)].forEach((op, i) => {
    w.must('mason', 'createSale', { opId: op, client: { name: 'Odd Op ' + i }, service: 'House wash', priceCents: 100 });
    w.must('mason', 'createSale', { opId: op, client: { name: 'Odd Op ' + i }, service: 'House wash', priceCents: 100 });
  });
  eq(w.db().sales.length, 16);
});

/* ---- a retry is the same thing again, or nothing ---- */

/* What the core put in the store's cache under op: keys, newest last: [{ key, value, ttl }]. */
function opMemory(w) {
  const seen = [], real = w.store.cachePut;
  w.store.cachePut = (k, v, ttl) => { if (String(k).indexOf('op:') === 0) seen.push({ key: k, value: v, ttl: ttl }); real(k, v, ttl); };
  return seen;
}

test('the same opId with different fields is not run: the phone is told its first try was saved, and is shown it', () => {
  const w = seeded(), notices = w.db().notices.length;
  const note = (text) => ({ kind: 'job', id: w.ids.jobA, text: text, opId: 'op-gate-000001' });
  const first = w.must('cole', 'addNote', note('Gate code is 1234'));
  ok(!first.replay);
  const r = w.refuse('cole', 'addNote', note('Gate code is 4321, not 1234'), 'already_saved');   /* refuse() also proves the stored data did not move */
  eq(r.error, { code: 'already_saved', message: ALREADY_SAVED });
  eq(keys(r), 'error,ok,sync', 'no result and no replay flag on a refusal');
  eq([r.sync.same, r.sync.rev, r.sync.me.id], [false, w.rev(), w.ids.cole], 'it carries the sync');
  const texts = () => byId(w.db().jobs, w.ids.jobA).notes.map((n) => n.text);
  eq(byId(r.sync.jobs, w.ids.jobA).notes.map((n) => n.text), texts(), 'and the sync shows what was really saved');
  eq(texts().filter((t) => t.indexOf('Gate code') === 0), ['Gate code is 1234']);
  /* A phone that has refreshed since gets the short sync, with the clock, and still the refusal. */
  const quiet = w.refuse('cole', 'addNote', Object.assign(note('Third wording'), { since: w.rev(), day: w.today() }), 'already_saved');
  eq(quiet.sync, { rev: w.rev(), today: w.today(), same: true, nowMs: w.t, nowHM: '09:00' });
  /* The first try again, word for word, is still a replay, however many changed tries came between. */
  const again = w.must('cole', 'addNote', note('Gate code is 1234'));
  eq([again.replay, again.result], [true, first.result]);
  /* The correction goes through as a new action, with an id of its own. */
  w.must('cole', 'addNote', Object.assign(note('Gate code is 4321, not 1234'), { opId: 'op-gate-000002' }));
  eq(texts().filter((t) => t.indexOf('Gate code') === 0), ['Gate code is 1234', 'Gate code is 4321, not 1234']);
  eq(w.db().notices.length, notices);
});

test('a lost answer, then a different choice under the same opId: move, book, commission, days, a fix, done, a new person and a sale each keep the first and only the first', () => {
  const w = seeded();
  const emails = () => w.emails.length, notices = () => w.db().notices.length;
  const cases = [
    { who: 'mason', action: 'moveJob', first: { jobId: w.ids.jobA, date: '2026-11-18', time: '14:00' }, then: { jobId: w.ids.jobA, date: '2026-11-20', time: '09:30' },
      saved: () => { const j = byId(w.db().jobs, w.ids.jobA); return [j.date, j.time, liveAt(w, '2026-11-20', '09:30')]; }, want: ['2026-11-18', '14:00', 0] },
    { who: 'mason', action: 'bookJob', first: { clientId: w.ids.clientA, date: '2026-11-19', time: '09:30' }, then: { clientId: w.ids.clientA, date: '2026-11-19', time: '12:00' },
      saved: () => w.db().jobs.filter((j) => j.clientId === w.ids.clientA && j.date === '2026-11-19').map((j) => j.time), want: ['09:30'] },
    { who: 'owner', action: 'saveSettings', first: { settings: { firstPct: 35 } }, then: { settings: { firstPct: 25 } },
      saved: () => w.db().settings[0].firstPct, want: 35 },
    { who: 'owner', action: 'setDays', first: { days: [{ date: '2026-12-01', open: true, slots: ['08:00'] }] }, then: { days: [{ date: '2026-12-01', open: true, slots: ['08:00', '10:00'] }] },
      saved: () => byId(w.db().days, '2026-12-01').slots, want: ['08:00'] },
    { who: 'owner', action: 'updateJob', first: { jobId: w.ids.jobB, patch: { assignedTo: w.ids.cole } }, then: { jobId: w.ids.jobB, patch: { assignedTo: null } },
      saved: () => byId(w.db().jobs, w.ids.jobB).assignedTo, want: w.ids.cole },
    { who: 'owner', action: 'updateSale', first: { saleId: w.ids.saleB, patch: { priceCents: 28000 } }, then: { saleId: w.ids.saleB, patch: { priceCents: 2800 } },
      saved: () => byId(w.db().sales, w.ids.saleB).priceCents, want: 28000 },
    { who: 'jake', action: 'updateClient', first: { clientId: w.ids.clientB, patch: { phone: '615-555-0111' } }, then: { clientId: w.ids.clientB, patch: { phone: '615-555-0222' } },
      saved: () => byId(w.db().clients, w.ids.clientB).phone, want: '615-555-0111' },
    { who: 'cole', action: 'setJobDone', first: { jobId: w.ids.jobA, done: true }, then: { jobId: w.ids.jobA, done: false },
      saved: () => byId(w.db().jobs, w.ids.jobA).status, want: 'done' },
    { who: 'owner', action: 'saveMember', first: { member: { name: 'Jake', role: 'rep' } }, then: { member: { name: 'Jake B', role: 'rep' } },
      saved: () => w.db().team.filter((m) => m.active && /^Jake( B)?$/.test(m.name)).map((m) => m.name), want: ['Jake'] },
    { who: 'jake', action: 'createSale', first: { client: { name: 'One Sale Only' }, service: 'House wash', priceCents: 15000, billing: 'once', appointment: { date: '2026-11-19', time: '14:00' } },
      then: { client: { name: 'One Sale Only' }, service: 'House wash', priceCents: 17500, billing: 'once', appointment: { date: '2026-11-19', time: '14:00' } },
      saved: () => w.db().sales.filter((x) => byId(w.db().clients, x.clientId).name === 'One Sale Only').map((x) => x.priceCents), want: [15000] }
  ];
  cases.forEach((c, i) => {
    const op = { opId: 'op-lost-answer-' + i }, label = c.action + ' as ' + c.who;
    const first = w.must(c.who, c.action, Object.assign({}, c.first, op));
    ok(!first.replay, label);
    const rev = w.rev(), mail = emails(), told = notices();
    const r = w.refuse(c.who, c.action, Object.assign({}, c.then, op), 'already_saved');
    eq([r.error.message, r.sync.same, r.sync.rev], [ALREADY_SAVED, false, rev], label);
    eq(c.saved(), c.want, label + ': what is stored is the first try');
    const again = w.must(c.who, c.action, Object.assign({}, c.first, op));
    eq([again.replay, again.result, w.rev(), emails(), notices()], [true, first.result, rev, mail, told], label + ': the first try again is a replay that saves, emails and tells nothing more');
  });
  /* The person added with a lost answer: the same try again hands back the PIN that was made. */
  const made = w.must('owner', 'saveMember', { member: { name: 'Jake', role: 'rep' }, opId: 'op-lost-answer-' + cases.findIndex((c) => c.action === 'saveMember') });
  ok(made.replay === true && /^\d{6}$/.test(made.result.pin) && w.tryLogin('Jake', made.result.pin).ok, 'the replay did not bring the PIN back');
  checkData(w);
});

test('a PIN change whose answer was lost: a different new PIN under the same opId changes nothing and counts no wrong try', () => {
  const w = world();
  w.must('mason', 'changePin', { oldPin: '271845', newPin: '517293', opId: 'op-pin-000001' });
  const seen = watchStore(w);
  const r = w.refuse('mason', 'changePin', { oldPin: '271845', newPin: '730526', opId: 'op-pin-000001' }, 'already_saved');
  seen.stop();
  eq([r.error.message, seen.cache, seen.data], [ALREADY_SAVED, [], 0], 'not "Your current PIN is not right", and nothing counted against him');
  eq([w.tryLogin('Mason Reed', '730526').ok, w.tryLogin('Mason Reed', '271845').ok, w.tryLogin('Mason Reed', '517293').ok], [false, false, true], 'the first new PIN is the PIN');
  ok(w.must('mason', 'changePin', { oldPin: '271845', newPin: '517293', opId: 'op-pin-000001' }).replay === true);
});

test('"the same fields" ignores token, since, day and the order of keys, and nothing else', () => {
  const w = seeded();
  const base = { opId: 'op-same-000001', client: { name: 'Key Order', phone: '615-555-0142', address: '9 Elm St' }, service: 'House wash', priceCents: 12000, billing: 'monthly',
    notes: 'Side gate', appointment: { date: '2026-11-19', time: '08:00' } };
  const first = w.must('mason', 'createSale', base), rev = w.rev();
  /* The same request with every list of keys turned round, sent by another phone of his (a new token) that has refreshed (since and day). */
  const flip = (v) => {
    if (!v || typeof v !== 'object') return v;
    if (Array.isArray(v)) return v.map(flip);
    const out = {}; Object.keys(v).reverse().forEach((k) => { out[k] = flip(v[k]); }); return out;
  };
  w.login('mason2', 'Mason Reed', '271845');
  const other = w.must('mason2', 'createSale', Object.assign(flip(base), { since: rev, day: w.today() }));
  eq([other.replay, other.result, other.sync.same], [true, first.result, true]);
  eq(w.must('mason', 'createSale', Object.assign({}, base, { since: 0, day: '2020-01-01' })).replay, true);
  eq(w.must('mason', 'createSale', Object.assign({ extra: undefined }, base)).replay, true, 'a field that is not there and one that is undefined are the same on the wire');
  /* Any real difference, however small, is a different thing. */
  const set = (p, v) => { const req = JSON.parse(JSON.stringify(base)); setPath(req, p, v); return req; };
  const changed = [set(['priceCents'], 12001), set(['priceCents'], '12000'), set(['billing'], 'once'), set(['notes'], 'Side gate '), set(['notes'], ''), set(['client', 'name'], 'Key order'),
    set(['client', 'phone'], null), set(['appointment', 'time'], '09:30'), set(['appointment'], null), set(['client', 'email'], ''), set(['extra'], false), set(['extra'], 0), set(['extra'], null),
    set(['client'], ['Key Order']), set(['service'], ['House wash']), set(['priceCents'], true)];
  changed.forEach((req) => { const r = w.refuse('mason', 'createSale', req, 'already_saved'); eq(r.error.message, ALREADY_SAVED, describe(req)); });
  /* true and "true", 1 and "1", a list and its only entry: none of them count as the same. */
  w.must('cole', 'setJobDone', { jobId: w.ids.jobA, done: true, opId: 'op-same-000002' });
  ['true', 1, [true], { 0: true }, null].forEach((v) => w.refuse('cole', 'setJobDone', { jobId: w.ids.jobA, done: v, opId: 'op-same-000002' }, 'already_saved'));
  ok(w.must('cole', 'setJobDone', { done: true, opId: 'op-same-000002', jobId: w.ids.jobA }).replay === true);
  /* The same opId for another action is a different thing too. */
  eq(w.refuse('mason', 'bookJob', Object.assign({}, base, { clientId: first.result.clientId, date: '2026-11-19', time: '12:00' }), 'already_saved').error.message, ALREADY_SAVED);
  eq([w.db().sales.length, w.rev()], [3, rev + 1], 'one sale and one finished job were saved in all of that');
});

test('a refused try is not remembered, whatever the refusal: the same opId with the fields put right is run, once', () => {
  const w = seeded();
  const tries = [
    ['invalid', 'mason', 'addNote', { kind: 'client', id: w.ids.clientA, text: '   ' }, { kind: 'client', id: w.ids.clientA, text: 'Now with words' }],
    ['not_found', 'mason', 'addNote', { kind: 'client', id: 'c_missing', text: 'x' }, { kind: 'client', id: w.ids.clientA, text: 'Right client' }],
    ['forbidden', 'mason', 'addNote', { kind: 'client', id: w.ids.clientB, text: 'x' }, { kind: 'client', id: w.ids.clientA, text: 'My own client' }],
    ['slot_taken', 'jake', 'bookJob', { clientId: w.ids.clientB, date: '2026-11-18', time: '09:30' }, { clientId: w.ids.clientB, date: '2026-11-18', time: '14:00' }],
    ['slot_closed', 'jake', 'moveJob', { jobId: w.ids.jobB, date: '2026-11-16', time: '09:30' }, { jobId: w.ids.jobB, date: '2026-11-19', time: '09:30' }],
    ['invalid', 'owner', 'saveMember', { member: { name: 'Pat', role: 'rep', pin: '123456' } }, { member: { name: 'Pat', role: 'rep', pin: '274916' } }],
    ['invalid', 'cole', 'changePin', { oldPin: '906132', newPin: '111111' }, { oldPin: '906132', newPin: '274916' }]
  ];
  tries.forEach((t, i) => {
    const op = { opId: 'op-refused-' + i + '-0001' }, label = t[2] + ' refused as ' + t[0];
    w.refuse(t[1], t[2], Object.assign({}, t[3], op), t[0]);
    w.refuse(t[1], t[2], Object.assign({}, t[3], op), t[0]);                       /* the same refused try again is refused again, for the same reason */
    const rev = w.rev(), fixed = w.must(t[1], t[2], Object.assign({}, t[4], op));
    ok(!fixed.replay && w.rev() === rev + 1, label + ': the corrected try did not run');
    ok(w.must(t[1], t[2], Object.assign({}, t[4], op)).replay === true, label + ': and now it is remembered');
    eq(w.refuse(t[1], t[2], Object.assign({}, t[3], op), 'already_saved').error.message, ALREADY_SAVED, label + ': so the first, refused wording is now a changed retry');
    eq(w.rev(), rev + 1, label);
  });
  eq(w.tryLogin('Pat', '274916').ok, true);
});

test('an opId the system has never seen runs normally, and after 6 hours it has forgotten: a changed try then runs as new', () => {
  const w = seeded();
  const note = (text, op) => ({ kind: 'client', id: w.ids.clientA, text: text, opId: op });
  const count = () => byId(w.db().clients, w.ids.clientA).notes.length, start = count();
  ['op-fresh-000001', 'op-fresh-000002', 'op-fresh-000003'].forEach((op) => ok(!w.must('mason', 'addNote', note('Same words', op)).replay, op));
  eq(count(), start + 3, 'three ids are three notes, even with the same words');
  w.wait(5 * HOUR + 59 * MIN);
  w.refuse('mason', 'addNote', note('Changed words', 'op-fresh-000001'), 'already_saved');
  w.wait(2 * MIN);
  ok(!w.must('mason', 'addNote', note('Changed words', 'op-fresh-000001')).replay, 'six hours on, the id is as good as new');
  eq(count(), start + 4);
});

test('what is remembered is small, holds no more than the answer and a 16 character fingerprint, and always fits the cache', () => {
  const base = seeded(), reqs = sampleRequests(base);
  ok(C.LIMITS.retryChars <= 30000, 'the Google cache drops a value over 30,000 characters (CACHE_MAX_VALUE in gas.js)');
  Object.keys(reqs).forEach((a, i) => {
    const w = base.fork(), mem = opMemory(w), op = 'x'.repeat(80 - String(i).length) + i;   /* the longest opId there can be */
    const res = w.must('owner', a, Object.assign({ opId: op }, reqs[a]));
    eq(mem.length, 1, a + ' was remembered once');
    const kept = JSON.parse(mem[0].value);
    eq([Object.keys(kept), kept.r, mem[0].ttl, mem[0].key], [['h', 'r'], res.result, 21600, 'op:' + w.ids.owner + ':' + op], a);
    ok(/^[0-9a-f]{16}$/.test(kept.h), a + ': the fingerprint is ' + kept.h);
    ok(mem[0].key.length <= 250 && mem[0].value.length < 300, a + ': key ' + mem[0].key.length + ', value ' + mem[0].value.length + ' characters');
    lacks(mem[0].value, w.tokens.owner, 'the memory of ' + a);
    const again = w.must('owner', a, Object.assign({ opId: op }, reqs[a]));
    eq([again.replay, again.result, mem.length], [true, res.result, 1], a + ' replays and is not remembered a second time');
  });
  /* The fingerprint is the core's own sha256 of the fields in key order, cut to 16. */
  const w = base.fork(), mem = opMemory(w);
  w.must('mason', 'addNote', { text: 'b', opId: 'op-print-00001', id: w.ids.clientA, kind: 'client', token: w.tokens.mason, since: 3, day: 'x' });
  eq(JSON.parse(mem[0].value).h, C.sha256('{"action":"addNote","id":' + JSON.stringify(w.ids.clientA) + ',"kind":"client","text":"b"}').slice(0, 16));
});

test('an answer too long to remember whole is remembered by its fingerprint alone: never a second save, never a silent one', () => {
  const real = C.LIMITS.retryChars;
  try {
    C.LIMITS.retryChars = 60;   /* as if the answer to a sale were too long to keep */
    const w = world(), mem = opMemory(w);
    /* A cache that, like Google's, quietly drops what is too big for it. */
    const put = w.store.cachePut;
    w.store.cachePut = (k, v, ttl) => { if (String(v).length <= 60) put(k, v, ttl); };
    const req = { opId: 'op-too-big-0001', client: { name: 'Big Answer' }, service: 'House wash', priceCents: 12000, appointment: { date: '2026-11-18', time: '09:30' } };
    const first = w.must('mason', 'createSale', req), rev = w.rev();
    ok(first.result.saleId && JSON.stringify({ h: 'x'.repeat(16), r: first.result }).length > 60, 'the test did make the answer too long to keep');
    const kept = JSON.parse(mem[0].value);
    eq([Object.keys(kept), kept.big, mem[0].value.length <= 60], [['h', 'big'], true, true], 'the fingerprint and a marker, and it fits');
    const again = w.must('mason', 'createSale', req);
    eq([again.replay, again.result, again.sync.sales.length, again.sync.rev], [true, {}, 1, rev], 'the same try again: saved, says so, shows it; only the details of the first answer are gone');
    const r = w.refuse('mason', 'createSale', Object.assign({}, req, { priceCents: 13000 }), 'already_saved');
    eq(r.error.message, ALREADY_SAVED);
    eq([w.db().sales.length, w.db().clients.length, w.db().jobs.length, w.db().notices.length, w.emails.length, w.rev()], [1, 1, 1, 1, 1, rev]);
    /* A short answer is still kept whole under the same small limit. */
    const note = { kind: 'client', id: first.result.clientId, text: 'short', opId: 'op-too-big-0002' };
    w.must('mason', 'addNote', note);
    eq([JSON.parse(mem[1].value).r, w.must('mason', 'addNote', note).result], [{}, {}]);
  } finally { C.LIMITS.retryChars = real; }
  eq(C.LIMITS.retryChars, 20000);
});

test('a memory that cannot be read, or that does not say what was sent, never lets the action run again', () => {
  const w = seeded();
  const note = { kind: 'client', id: w.ids.clientA, text: 'kept once', opId: 'op-broken-0001' };
  w.must('mason', 'addNote', note);
  const key = 'op:' + w.ids.mason + ':op-broken-0001';
  ['{}', 'not json', '{"id":"m_x","pin":"123456"}', 'null', '[]', '7', '"h"', '{"h":7,"r":{}}', '{"r":{}}'].forEach((junk) => {
    w.store.cachePut(key, junk, 600);
    eq(w.refuse('mason', 'addNote', note, 'already_saved').error.message, ALREADY_SAVED, 'with ' + junk + ' in the cache');
  });
  eq(byId(w.db().clients, w.ids.clientA).notes.filter((n) => n.text === 'kept once').length, 1);
  eq(w.db().problems, []);
});

test('junk under an opId cannot crash the fingerprint: deep, huge and odd values are just fields', () => {
  const w = seeded();
  let deep = 'bottom'; for (let i = 0; i < 20000; i++) deep = [deep];
  let deeper = 'another bottom'; for (let i = 0; i < 20000; i++) deeper = { k: deeper };
  const odd = [deep, deeper, 'x'.repeat(200000), NaN, Infinity, -0, () => 1, Symbol('s'), new Date(0), JSON.parse('{"__proto__":{"a":1},"constructor":"c"}')];
  odd.forEach((v, i) => {
    const req = { kind: 'client', id: w.ids.clientA, text: 'odd ' + i, extra: v, opId: 'op-odd-' + i + '-00001' };
    ok(!w.must('mason', 'addNote', req).replay, 'value ' + i);
    ok(w.must('mason', 'addNote', req).replay === true, 'value ' + i + ' again');
    eq(w.refuse('mason', 'addNote', Object.assign({}, req, { text: 'changed' }), 'already_saved').error.code, 'already_saved');
  });
  eq(w.db().problems, []);
  ok(({}).a === undefined);
});

/* ================================================================== */
section('commission');

function relog(w, list) { (list || Object.keys(PINS)).forEach((k) => w.login(k, PINS[k][0], PINS[k][1])); }
function eventsOf(w, who, saleId) { return byId(w.full(who).sales, saleId).events; }
function plain(w, who, name, priceCents, billing, extra) {
  return w.must(who, 'createSale', Object.assign({ client: { name: name }, service: 'Window cleaning', priceCents: priceCents, billing: billing || 'once' }, extra || {})).result;
}

test('a monthly sale made on Jan 31 pays 30%, then 10% on Feb 28, Mar 31, Apr 30 as the days arrive', () => {
  const w = world({ day: '2027-01-31', time: '16:00' });
  const s = plain(w, 'mason', 'Month End Monthly', 15000, 'monthly');
  eq(s.commissionCents, 4500);
  const first = { day: '2027-01-31', cents: 4500, kind: 'first' }, m = (day) => ({ day: day, cents: 1500, kind: 'monthly' });
  eq(eventsOf(w, 'mason', s.saleId), [first]);
  w.at('2027-02-27', '23:59'); eq(eventsOf(w, 'mason', s.saleId), [first], 'the evening before');
  w.at('2027-02-28', '00:01'); eq(eventsOf(w, 'mason', s.saleId), [first, m('2027-02-28')], 'one minute into Feb 28 in Chicago');
  w.at('2027-03-30', '12:00'); eq(eventsOf(w, 'mason', s.saleId).length, 2);
  w.at('2027-03-31', '12:00'); eq(eventsOf(w, 'mason', s.saleId), [first, m('2027-02-28'), m('2027-03-31')]);
  w.at('2027-04-30', '12:00'); eq(eventsOf(w, 'mason', s.saleId).map((e) => e.day), ['2027-01-31', '2027-02-28', '2027-03-31', '2027-04-30']);
  eq(eventsOf(w, 'owner', s.saleId), eventsOf(w, 'mason', s.saleId), 'the owner sees the same numbers');
  eq(C.calc.sumEvents(eventsOf(w, 'mason', s.saleId)), 9000);
  eq(w.full('jake').sales, []);
});

test('a one-time sale pays once, even years later', () => {
  const w = world({ day: '2027-01-31' });
  const s = plain(w, 'mason', 'One Time', 20000, 'once');
  w.at('2029-06-15', '09:00'); relog(w);
  eq(eventsOf(w, 'mason', s.saleId), [{ day: '2027-01-31', cents: 6000, kind: 'first' }]);
});

test('paused months pay nothing and resuming pays again; a cancel ends that sale\'s monthly pay for good', () => {
  const w = world({ day: '2027-01-10' });
  const s = plain(w, 'mason', 'Stop And Start', 10000, 'monthly');
  const set = (day, status) => { w.at(day, '10:00'); relog(w, ['owner']); w.must('owner', 'updateClient', { clientId: s.clientId, patch: { status: status } }); };
  set('2027-02-20', 'Paused');      /* Feb 10 was paid; Mar 10 falls in the pause */
  eq(byId(w.db().sales, s.saleId).endDay, undefined, 'a pause ends nothing');
  set('2027-03-25', 'Active');      /* Apr 10 is paid */
  set('2027-04-15', 'Cancelled');   /* May 10 is not, and nothing after it either */
  eq(byId(w.db().sales, s.saleId).endDay, '2027-04-15', 'the sale remembers the day its monthly pay ended');
  set('2027-06-10', 'Active');      /* set back to Active weeks later: the old sale does not start again */
  w.at('2027-09-09', '10:00'); relog(w);
  eq(eventsOf(w, 'mason', s.saleId), [{ day: '2027-01-10', cents: 3000, kind: 'first' }, { day: '2027-02-10', cents: 1000, kind: 'monthly' },
    { day: '2027-04-10', cents: 1000, kind: 'monthly' }]);
  eq(byId(w.full('mason').sales, s.saleId).endDay, '2027-04-15', 'and the rep is sent that day with the sale');
  eq(byId(w.db().clients, s.clientId).statusLog.map((x) => x.day + ' ' + x.status),
    ['2027-01-10 New', '2027-02-20 Paused', '2027-03-25 Active', '2027-04-15 Cancelled', '2027-06-10 Active']);
});

test('a cancelled client who buys again later does not start the old monthly sale paying again', () => {
  const w = world({ day: '2027-01-10' });
  const old = plain(w, 'mason', 'Left And Came Back', 10000, 'monthly');
  w.at('2027-03-15', '10:00'); relog(w, ['owner']);
  w.must('owner', 'updateClient', { clientId: old.clientId, patch: { status: 'Cancelled' } });
  w.at('2027-05-20', '10:00'); relog(w);
  const again = w.must('mason', 'createSale', { clientId: old.clientId, service: 'House wash', priceCents: 20000, billing: 'once' }).result;
  eq(byId(w.db().clients, old.clientId).status, 'Active', 'buying again makes them a client again');
  w.at('2027-08-01', '10:00'); relog(w);
  eq(eventsOf(w, 'mason', old.saleId).map((e) => e.day + ' ' + e.cents), ['2027-01-10 3000', '2027-02-10 1000', '2027-03-10 1000'], 'nothing after the cancel, even though the client is Active again');
  eq(eventsOf(w, 'mason', again.saleId), [{ day: '2027-05-20', cents: 6000, kind: 'first' }]);
  eq([byId(w.db().sales, old.saleId).endDay, byId(w.db().sales, again.saleId).endDay], ['2027-03-15', undefined]);
  /* Cancelling again, or a cancel of someone who was never monthly, moves no end day. */
  w.must('owner', 'updateClient', { clientId: old.clientId, patch: { status: 'Cancelled' } });
  eq([byId(w.db().sales, old.saleId).endDay, byId(w.db().sales, again.saleId).endDay], ['2027-03-15', undefined]);
});

test('a second monthly plan ends the first: only one of them pays each month', () => {
  const w = world({ day: '2027-01-10' });
  const first = plain(w, 'mason', 'Upgraded', 10000, 'monthly'), other = plain(w, 'mason', 'Someone Else', 8000, 'monthly');
  w.at('2027-02-15', '10:00'); relog(w);
  const extra = w.must('mason', 'createSale', { clientId: first.clientId, service: 'Pressure wash', priceCents: 5000, billing: 'once' }).result;
  eq(byId(w.db().sales, first.saleId).endDay, undefined, 'a one-time job on top ends nothing');
  w.at('2027-03-20', '10:00'); relog(w);
  const second = w.must('mason', 'createSale', { clientId: first.clientId, service: 'Window cleaning', priceCents: 16000, billing: 'monthly' }).result;
  const db = w.db();
  eq([byId(db.sales, first.saleId).endDay, byId(db.sales, first.saleId).endedBy], ['2027-03-20', second.saleId]);
  eq([byId(db.sales, second.saleId).endDay, byId(db.sales, extra.saleId).endDay, byId(db.sales, other.saleId).endDay], [undefined, undefined, undefined], 'nothing else is ended');
  w.at('2027-06-15', '10:00'); relog(w);
  eq(eventsOf(w, 'mason', first.saleId).map((e) => e.day), ['2027-01-10', '2027-02-10', '2027-03-10'], 'the old plan stops the day the new one is sold');
  eq([byId(w.full('mason').sales, first.saleId).endDay, byId(w.full('mason').sales, first.saleId).endedBy], ['2027-03-20', second.saleId], 'the rep is sent both: the day, and their own sale that took its place');
  eq(eventsOf(w, 'mason', second.saleId).map((e) => e.day + ' ' + e.cents), ['2027-03-20 4800', '2027-04-20 1600', '2027-05-20 1600']);
  eq(eventsOf(w, 'mason', other.saleId).length, 6, 'another client\'s plan pays on');
  /* A third plan ends the second and leaves the first as it was. */
  const third = w.must('owner', 'createSale', { clientId: first.clientId, service: 'Window cleaning', priceCents: 20000, billing: 'monthly' }).result;
  eq([byId(w.db().sales, first.saleId).endDay, byId(w.db().sales, second.saleId).endDay, byId(w.db().sales, second.saleId).endedBy, byId(w.db().sales, third.saleId).endDay],
    ['2027-03-20', '2027-06-15', third.saleId, undefined]);
  checkData(w);
});

test('mistakes can be taken back: a cancel undone the same day, and a deleted sale that had replaced a plan', () => {
  const w = world({ day: '2027-01-10' });
  const a = plain(w, 'mason', 'Wrong Tap', 10000, 'monthly');
  w.at('2027-02-20', '10:00'); relog(w);
  w.must('owner', 'updateClient', { clientId: a.clientId, patch: { status: 'Cancelled' } });
  eq(byId(w.db().sales, a.saleId).endDay, '2027-02-20');
  w.at('2027-02-20', '16:00');
  w.must('owner', 'updateClient', { clientId: a.clientId, patch: { status: 'Active' } });
  eq(byId(w.db().sales, a.saleId).endDay, undefined, 'the same day: as if it never happened');
  w.at('2027-04-15', '10:00'); relog(w);
  eq(eventsOf(w, 'mason', a.saleId).map((e) => e.day), ['2027-01-10', '2027-02-10', '2027-03-10', '2027-04-10']);

  /* A second monthly sale entered by mistake, then deleted: the first plan is the plan again. */
  const dup = w.must('mason', 'createSale', { clientId: a.clientId, service: 'Window cleaning', priceCents: 10000, billing: 'monthly' }).result;
  eq(byId(w.db().sales, a.saleId).endDay, '2027-04-15');
  w.must('owner', 'deleteSale', { saleId: dup.saleId });
  eq([byId(w.db().sales, a.saleId).endDay, byId(w.db().sales, a.saleId).endedBy], [undefined, undefined]);
  w.at('2027-05-10', '10:00'); relog(w);
  eq(eventsOf(w, 'mason', a.saleId).length, 5, 'and it pays on May 10');

  /* If the sale that is deleted had itself been ended, the older plan ends when and why it did. */
  const b = w.must('mason', 'createSale', { clientId: a.clientId, service: 'Window cleaning', priceCents: 12000, billing: 'monthly' }).result;
  w.at('2027-06-20', '10:00'); relog(w);
  w.must('owner', 'updateClient', { clientId: a.clientId, patch: { status: 'Cancelled' } });
  eq([byId(w.db().sales, a.saleId).endDay, byId(w.db().sales, b.saleId).endDay], ['2027-05-10', '2027-06-20']);
  w.must('owner', 'deleteSale', { saleId: b.saleId });
  eq([byId(w.db().sales, a.saleId).endDay, byId(w.db().sales, a.saleId).endedBy], ['2027-06-20', undefined], 'the first plan ran until the client cancelled');

  /* A cancel taken back on a later day stays a cancel, and so does one that came before a new plan the same day. */
  w.at('2027-06-21', '10:00'); relog(w, ['owner']);
  w.must('owner', 'updateClient', { clientId: a.clientId, patch: { status: 'Active' } });
  eq(byId(w.db().sales, a.saleId).endDay, '2027-06-20');
  const c = plain(w, 'jake', 'Busy Day', 10000, 'monthly');
  w.at('2027-07-05', '09:00'); relog(w);
  w.must('owner', 'updateClient', { clientId: c.clientId, patch: { status: 'Cancelled' } });
  const c2 = w.must('jake', 'createSale', { clientId: c.clientId, service: 'Window cleaning', priceCents: 9000, billing: 'monthly' }).result;
  w.must('owner', 'updateClient', { clientId: c.clientId, patch: { status: 'Cancelled' } });
  w.must('owner', 'updateClient', { clientId: c.clientId, patch: { status: 'Active' } });
  eq([byId(w.db().sales, c.saleId).endDay, byId(w.db().sales, c2.saleId).endDay], ['2027-07-05', undefined], 'only the newest plan comes back, so two never pay at once');
  checkData(w);
});

test('changing the rates later does not change old sales; new sales use the new rates', () => {
  const w = world({ day: '2027-01-10' });
  const old = plain(w, 'mason', 'Old Rates', 10000, 'monthly');
  w.at('2027-02-15', '09:00');
  w.must('owner', 'saveSettings', { settings: { firstPct: 50, monthlyPct: 20 } });
  const fresh = plain(w, 'mason', 'New Rates', 10000, 'monthly');
  eq(fresh.commissionCents, 5000);
  w.at('2027-03-16', '09:00');
  eq(eventsOf(w, 'mason', old.saleId).map((e) => e.cents), [3000, 1000, 1000]);
  eq(eventsOf(w, 'mason', fresh.saleId).map((e) => e.cents), [5000, 2000]);
  const s = w.full('mason');
  eq([s.settings.firstPct, s.settings.monthlyPct], [50, 20], 'reps see the current rates');
  eq([byId(s.sales, old.saleId).firstPct, byId(s.sales, old.saleId).monthlyPct], [30, 10]);
});

test('rates must be numbers from 0 to 100', () => {
  const w = world();
  [-1, 100.01, 101, '30', NaN, Infinity, null, [30], {}].forEach((v) => {
    w.refuse('owner', 'saveSettings', { settings: { firstPct: v } }, 'invalid');
    /* one bad value refuses the whole save, including the good values sent with it */
    w.refuse('owner', 'saveSettings', { settings: { firstPct: 20, defaultSlots: ['07:00'], notifyEmail: 'a@b.co', emailOnBooking: false, standards: [], monthlyPct: v } }, 'invalid');
  });
  w.must('owner', 'saveSettings', { settings: { firstPct: 33.333, monthlyPct: 0 } });
  eq([w.full('owner').settings.firstPct, w.full('owner').settings.monthlyPct], [33.33, 0]);
  w.must('owner', 'saveSettings', { settings: { firstPct: 100, monthlyPct: 100 } });
  eq(plain(w, 'mason', 'All Of It', 999, 'once').commissionCents, 999);
});

test('odd cents round to the nearest cent in a real sale, half a cent up', () => {
  const w = world({ day: '2027-01-10' });
  const s = plain(w, 'mason', 'Odd Cents', 3335, 'monthly');
  eq(s.commissionCents, 1001);
  w.at('2027-02-10', '09:00');
  eq(eventsOf(w, 'mason', s.saleId).map((e) => e.cents), [1001, 334]);
  w.must('owner', 'saveSettings', { settings: { firstPct: 5.1, monthlyPct: 0.7 } });
  const t = plain(w, 'mason', 'Decimal Rate', 5500, 'monthly');
  eq(t.commissionCents, 281, '5.1% of $55.00 is 280.5 cents');
  w.at('2027-03-10', '09:00');
  eq(eventsOf(w, 'mason', t.saleId).map((e) => e.cents), [281, 39], 'and 0.7% of $55.00 is 38.5 cents');
});

test('the price must be whole cents from $0 to $1,000,000', () => {
  const w = world();
  [-1, -0.5, 1.5, 0.1, NaN, Infinity, -Infinity, '100', '', null, undefined, true, [100], {}, 100000001, 1e21].forEach((p) => {
    w.refuse('mason', 'createSale', { client: { name: 'Bad Price' }, service: 'House wash', priceCents: p, appointment: { date: '2026-11-18', time: '09:30' } }, 'invalid');
  });
  eq(plain(w, 'mason', 'Free', 0).commissionCents, 0);
  eq(plain(w, 'mason', 'Big', 100000000).commissionCents, 30000000);
  w.db().sales.forEach((s) => ok(Number.isInteger(s.priceCents) && s.priceCents >= 0));
});

test('the owner\'s own sales earn no commission, whoever the owner is, and still count as sales', () => {
  const w = world({ day: '2027-01-10' });
  const second = w.must('owner', 'saveMember', { member: { name: 'Second Owner', role: 'owner', pin: '606147' } }).result.id;
  const own = plain(w, 'owner', 'Owner Sold This', 100000, 'monthly');
  eq(own.commissionCents, 0, 'the answer to the save says nothing was earned');
  const forOther = plain(w, 'owner', 'Sold By The Other Owner', 50000, 'once', { repId: second });
  eq(forOther.commissionCents, 0);
  const db = w.db();
  eq([byId(db.sales, own.saleId).repId, byId(db.sales, own.saleId).firstPct, byId(db.sales, own.saleId).monthlyPct], [w.ids.owner, 0, 0]);
  eq([byId(db.sales, forOther.saleId).repId, byId(db.sales, forOther.saleId).firstPct, byId(db.sales, forOther.saleId).monthlyPct], [second, 0, 0]);
  /* Every payment is still listed with its date (the page adds up revenue from these); each is worth nothing to anybody. */
  w.at('2027-03-10', '09:00'); relog(w, ['owner']);
  eq(eventsOf(w, 'owner', own.saleId), [{ day: '2027-01-10', cents: 0, kind: 'first' }, { day: '2027-02-10', cents: 0, kind: 'monthly' }, { day: '2027-03-10', cents: 0, kind: 'monthly' }]);
  eq(eventsOf(w, 'owner', forOther.saleId), [{ day: '2027-01-10', cents: 0, kind: 'first' }]);
  eq(C.calc.sumEvents(eventsOf(w, 'owner', own.saleId)) + C.calc.sumEvents(eventsOf(w, 'owner', forOther.saleId)), 0);
  eq(row(w, 'owner', w.ids.owner), [0, 0, 0, 0, 1, 100000], 'the sale still counts on the board as a sale made');
  /* The settings were never touched, and they do not bring the commission back. */
  eq([w.full('owner').settings.firstPct, w.full('owner').settings.monthlyPct], [30, 10]);
  w.must('owner', 'saveSettings', { settings: { firstPct: 50, monthlyPct: 20 } });
  eq(C.calc.sumEvents(eventsOf(w, 'owner', own.saleId)), 0);
  checkData(w);
});

test('a sale the owner enters for a rep, and a rep\'s own sale, earn the rep the usual commission', () => {
  const w = world({ day: '2027-01-10' });
  const forMason = plain(w, 'owner', 'Entered For Mason', 100000, 'monthly', { repId: w.ids.mason });
  eq(forMason.commissionCents, 30000);
  const masons = plain(w, 'mason', 'Mason Sold This', 20000, 'once');
  eq(masons.commissionCents, 6000);
  const db = w.db();
  eq([byId(db.sales, forMason.saleId).repId, byId(db.sales, forMason.saleId).firstPct, byId(db.sales, forMason.saleId).monthlyPct], [w.ids.mason, 30, 10]);
  eq([byId(db.sales, masons.saleId).firstPct, byId(db.sales, masons.saleId).monthlyPct], [30, 10]);
  w.at('2027-02-10', '09:00'); relog(w, ['mason']);
  eq(eventsOf(w, 'mason', forMason.saleId).map((e) => e.cents), [30000, 10000]);
  /* A rep cannot dodge it or gain from it by naming the owner as the seller: a rep's sale is always the rep's. */
  const sneaky = plain(w, 'mason', 'Named The Owner', 10000, 'once', { repId: w.ids.owner });
  eq([sneaky.commissionCents, byId(w.db().sales, sneaky.saleId).repId, byId(w.db().sales, sneaky.saleId).firstPct], [3000, w.ids.mason, 30]);
});

/* ================================================================== */
section('fixing a sale');

function saleRow(w, id) { const x = byId(w.db().sales, id); return x ? [x.service, x.priceCents, x.repId, x.firstPct, x.monthlyPct, x.billing] : null; }
function clientRow(w, id) { const c = byId(w.db().clients, id); return c ? [c.service, c.priceCents, c.billing, c.repId] : null; }

test('the owner fixes a wrong price: the sale, its commission, the board and the client all follow', () => {
  const w = world({ day: '2027-01-10' });
  const typo = plain(w, 'mason', 'Typed 1500 For 150', 150000, 'monthly');
  eq([typo.commissionCents, row(w, 'owner', w.ids.mason)[5], clientRow(w, typo.clientId)[1]], [45000, 150000, 150000]);
  w.at('2027-02-12', '09:00'); relog(w);
  eq(eventsOf(w, 'mason', typo.saleId).map((e) => e.cents), [45000, 15000]);
  const before = byId(w.db().sales, typo.saleId), rev = w.rev();
  const r = w.must('owner', 'updateSale', { saleId: typo.saleId, patch: { priceCents: 15000 } });
  eq(r.result, { saleId: typo.saleId, clientId: typo.clientId });
  ok(w.rev() > rev && r.sync.same === false, 'every phone hears about the fix');
  eq(byId(w.db().sales, typo.saleId), Object.assign({}, before, { priceCents: 15000 }), 'only the price changed on the stored sale');
  eq(eventsOf(w, 'mason', typo.saleId), [{ day: '2027-01-10', cents: 4500, kind: 'first' }, { day: '2027-02-10', cents: 1500, kind: 'monthly' }], 'the rep now sees what the sale really earned');
  eq(eventsOf(w, 'owner', typo.saleId), eventsOf(w, 'mason', typo.saleId));
  eq(row(w, 'jake', w.ids.mason), [0, 0, 0, 0, 1, 15000], 'the leaderboard follows');
  eq(clientRow(w, typo.clientId), ['Window cleaning', 15000, 'monthly', w.ids.mason], 'and so does what the client pays');
  w.at('2027-03-10', '09:00'); relog(w, ['mason']);
  eq(eventsOf(w, 'mason', typo.saleId).map((e) => e.cents), [4500, 1500, 1500], 'later months are paid on the fixed price');
  checkData(w);
});

test('the owner fixes the name of the service; the price and everything else stay', () => {
  const w = seeded();
  const before = byId(w.db().sales, w.ids.saleA), job = byId(w.db().jobs, w.ids.jobA);
  w.must('owner', 'updateSale', { saleId: w.ids.saleA, patch: { service: '  House   wash ' } });
  eq(byId(w.db().sales, w.ids.saleA), Object.assign({}, before, { service: 'House wash' }));
  eq(clientRow(w, w.ids.clientA), ['House wash', 15000, 'monthly', w.ids.mason]);
  eq(byId(w.db().jobs, w.ids.jobA), job, 'the booked job is not touched');
  eq(byId(w.full('mason').sales, w.ids.saleA).service, 'House wash');
  eq(saleRow(w, w.ids.saleB), ['House wash', 30000, w.ids.jake, 30, 10, 'once'], 'nobody else\'s sale moved');
});

test('only a fix to the client\'s newest sale changes what the client buys, and only the part that was fixed', () => {
  const w = world({ day: '2027-01-10' });
  const first = plain(w, 'mason', 'Two Sales', 10000, 'monthly');
  w.at('2027-02-15', '10:00'); relog(w);
  const second = w.must('mason', 'createSale', { clientId: first.clientId, service: 'Pressure wash', priceCents: 40000, billing: 'once' }).result;
  eq(clientRow(w, first.clientId), ['Pressure wash', 40000, 'once', w.ids.mason]);
  w.must('owner', 'updateSale', { saleId: first.saleId, patch: { priceCents: 12000, service: 'Windows, inside and out' } });
  eq(saleRow(w, first.saleId), ['Windows, inside and out', 12000, w.ids.mason, 30, 10, 'monthly']);
  eq(clientRow(w, first.clientId), ['Pressure wash', 40000, 'once', w.ids.mason], 'fixing the older sale leaves the client as the newest sale set them');
  w.must('owner', 'updateSale', { saleId: second.saleId, patch: { priceCents: 45000 } });
  eq(clientRow(w, first.clientId), ['Pressure wash', 45000, 'once', w.ids.mason]);
  /* The owner then sets what the client pays from now on by hand. Fixing only the service name of the sale keeps that price. */
  w.must('owner', 'updateClient', { clientId: first.clientId, patch: { priceCents: 50000 } });
  w.must('owner', 'updateSale', { saleId: second.saleId, patch: { service: 'Driveway wash' } });
  eq(clientRow(w, first.clientId), ['Driveway wash', 50000, 'once', w.ids.mason]);
  eq(saleRow(w, second.saleId), ['Driveway wash', 45000, w.ids.mason, 30, 10, 'once']);
  /* Once the newest sale is removed, the one before it is the newest and its fixes reach the client again. */
  w.must('owner', 'deleteSale', { saleId: second.saleId });
  w.must('owner', 'updateSale', { saleId: first.saleId, patch: { priceCents: 11000 } });
  eq(clientRow(w, first.clientId)[1], 11000);
  checkData(w);
});

test('the owner fixes who made the sale: moved from one rep to another it keeps the rates it was sold under', () => {
  const w = world({ day: '2027-01-10' });
  const s = plain(w, 'mason', 'Really Jake\'s Sale', 20000, 'monthly');
  w.at('2027-02-10', '09:00'); relog(w);
  w.must('owner', 'saveSettings', { settings: { firstPct: 25, monthlyPct: 8 } });
  eq(saleRow(w, s.saleId), ['Window cleaning', 20000, w.ids.mason, 30, 10, 'monthly'], 'a rate change alone never touches a sale');

  w.must('owner', 'updateSale', { saleId: s.saleId, patch: { repId: w.ids.jake } });
  eq(saleRow(w, s.saleId), ['Window cleaning', 20000, w.ids.jake, 30, 10, 'monthly'], 'moved to another rep: the rates saved on the sale stay, whatever Settings says today');
  eq(w.full('mason').sales, [], 'the rep it was taken from no longer has it');
  eq(eventsOf(w, 'jake', s.saleId), [{ day: '2027-01-10', cents: 6000, kind: 'first' }, { day: '2027-02-10', cents: 2000, kind: 'monthly' }], 'the rep it went to earns what the sale always earned, from the day it was sold');
  eq([row(w, 'owner', w.ids.mason), row(w, 'owner', w.ids.jake)], [[0, 0, 0, 0, 0, 0], [0, 0, 0, 0, 1, 20000]], 'the board moves with it');
  eq(clientRow(w, s.clientId), ['Window cleaning', 20000, 'monthly', w.ids.mason], 'who looks after the client is a separate thing and does not move');

  /* Back again, with a price fix in the same patch, on a day when Settings says something else again: still the sale's own rates. */
  w.must('owner', 'saveSettings', { settings: { firstPct: 50, monthlyPct: 0 } });
  w.must('owner', 'updateSale', { saleId: s.saleId, patch: { repId: w.ids.mason, priceCents: 21000 } });
  eq(saleRow(w, s.saleId), ['Window cleaning', 21000, w.ids.mason, 30, 10, 'monthly']);
  eq(eventsOf(w, 'mason', s.saleId).map((e) => e.cents), [6300, 2100]);
  /* A rep who has since left can still be the one a sale is taken from: nothing about the rates changes. */
  w.must('owner', 'removeMember', { id: w.ids.mason });
  w.must('owner', 'updateSale', { saleId: s.saleId, patch: { repId: w.ids.jake } });
  eq(saleRow(w, s.saleId), ['Window cleaning', 21000, w.ids.jake, 30, 10, 'monthly']);
  /* A sale made after the rates changed carries the new rates, and keeps those when it is moved. */
  const late = plain(w, 'jake', 'Sold At Fifty', 10000, 'once');
  w.must('owner', 'saveSettings', { settings: { firstPct: 30, monthlyPct: 10 } });
  const sam = w.must('owner', 'saveMember', { member: { name: 'Sam New', role: 'rep', pin: '606147' } }).result.id;
  w.must('owner', 'updateSale', { saleId: late.saleId, patch: { repId: sam } });
  eq(saleRow(w, late.saleId), ['Window cleaning', 10000, sam, 50, 0, 'once']);
  checkData(w);
});

test('a sale moved to an owner earns nothing; moved from an owner to a rep it takes the rates in Settings that day', () => {
  const w = world({ day: '2027-01-10' });
  const s = plain(w, 'jake', 'Really The Owner\'s', 20000, 'monthly');
  w.at('2027-02-10', '09:00'); relog(w);
  w.must('owner', 'saveSettings', { settings: { firstPct: 25, monthlyPct: 8 } });

  w.must('owner', 'updateSale', { saleId: s.saleId, patch: { repId: w.ids.owner } });
  eq(saleRow(w, s.saleId), ['Window cleaning', 20000, w.ids.owner, 0, 0, 'monthly'], 'moved to the owner: no commission');
  eq(eventsOf(w, 'owner', s.saleId), [{ day: '2027-01-10', cents: 0, kind: 'first' }, { day: '2027-02-10', cents: 0, kind: 'monthly' }]);
  eq(w.full('jake').sales, []);

  w.must('owner', 'saveSettings', { settings: { firstPct: 40, monthlyPct: 15 } });
  w.must('owner', 'updateSale', { saleId: s.saleId, patch: { repId: w.ids.mason } });
  eq(saleRow(w, s.saleId), ['Window cleaning', 20000, w.ids.mason, 40, 15, 'monthly'], 'moved from the owner to a rep: the rates in Settings on the day of the fix');
  eq(eventsOf(w, 'mason', s.saleId).map((e) => e.cents), [8000, 3000]);

  /* From then on it is a rep's sale like any other: a later move to another rep keeps the 40 and 15. */
  w.must('owner', 'saveSettings', { settings: { firstPct: 30, monthlyPct: 10 } });
  w.must('owner', 'updateSale', { saleId: s.saleId, patch: { repId: w.ids.jake } });
  eq(saleRow(w, s.saleId), ['Window cleaning', 20000, w.ids.jake, 40, 15, 'monthly']);

  /* Naming the seller the sale already has changes nothing, so a price fix that sends every field keeps the rates. */
  w.must('owner', 'updateSale', { saleId: s.saleId, patch: { repId: w.ids.jake, priceCents: 21000, service: 'Window cleaning' } });
  eq(saleRow(w, s.saleId), ['Window cleaning', 21000, w.ids.jake, 40, 15, 'monthly']);

  /* A sale the owner entered as their own has no rates to keep: given to the rep who really made it, it takes today's. */
  const own = plain(w, 'owner', 'Entered By Grayson', 10000, 'once');
  eq(saleRow(w, own.saleId), ['Window cleaning', 10000, w.ids.owner, 0, 0, 'once']);
  w.must('owner', 'updateSale', { saleId: own.saleId, patch: { repId: w.ids.mason } });
  eq(saleRow(w, own.saleId), ['Window cleaning', 10000, w.ids.mason, 30, 10, 'once']);
  eq(eventsOf(w, 'mason', own.saleId), [{ day: '2027-02-10', cents: 3000, kind: 'first' }]);

  /* From one owner to another it stays at nothing, and "from an owner" goes by what the seller is now. */
  const second = w.must('owner', 'saveMember', { member: { name: 'Second Owner', role: 'owner', pin: '606147' } }).result.id;
  w.must('owner', 'updateSale', { saleId: own.saleId, patch: { repId: w.ids.owner } });
  w.must('owner', 'updateSale', { saleId: own.saleId, patch: { repId: second } });
  eq(saleRow(w, own.saleId), ['Window cleaning', 10000, second, 0, 0, 'once']);
  w.must('owner', 'saveSettings', { settings: { firstPct: 20, monthlyPct: 5 } });
  w.must('owner', 'saveMember', { member: { id: w.ids.jake, name: 'Jake Miller', role: 'owner' } });   /* Jake is made an owner; his sale keeps its 40 and 15 */
  eq(saleRow(w, s.saleId), ['Window cleaning', 21000, w.ids.jake, 40, 15, 'monthly']);
  w.must('owner', 'updateSale', { saleId: s.saleId, patch: { repId: w.ids.mason } });
  eq(saleRow(w, s.saleId), ['Window cleaning', 21000, w.ids.mason, 20, 5, 'monthly'], 'taken from someone who is an owner now: today\'s rates');
  checkData(w);
});

test('a sale can only be given to a sales rep or an owner who is on the team', () => {
  const w = seeded();
  const second = w.must('owner', 'saveMember', { member: { name: 'Second Owner', role: 'owner', pin: '606147' } }).result.id;
  w.must('owner', 'removeMember', { id: w.ids.jake });
  [w.ids.cole, w.ids.tess, w.ids.jake, 'm_nobody', '', null, 0, 7, {}, [w.ids.owner], '__proto__', 'constructor'].forEach((id) => {
    const r = w.refuse('owner', 'updateSale', { saleId: w.ids.saleA, patch: { repId: id, priceCents: 99 } }, 'invalid');
    eq(r.error.message, 'Pick a sales rep or an owner who is on the team.', 'repId ' + JSON.stringify(id));
  });
  eq(saleRow(w, w.ids.saleA), ['Window cleaning', 15000, w.ids.mason, 30, 10, 'monthly'], 'and the price sent along with a bad seller was not saved either');
  w.must('owner', 'updateSale', { saleId: w.ids.saleA, patch: { repId: second } });
  eq(saleRow(w, w.ids.saleA), ['Window cleaning', 15000, second, 0, 0, 'monthly'], 'any owner will do, and earns nothing');
  /* Jake has left. His sale can still have its price fixed, and stays his, with the rates it was sold under. */
  w.must('owner', 'updateSale', { saleId: w.ids.saleB, patch: { priceCents: 28000, repId: w.ids.jake } });
  eq(saleRow(w, w.ids.saleB), ['House wash', 28000, w.ids.jake, 30, 10, 'once']);
  eq(byId(w.full('owner').sales, w.ids.saleB).events, [{ day: '2026-11-17', cents: 8400, kind: 'first' }]);
});

test('one-time or monthly cannot be changed by a fix: the owner is told to remove the sale and enter it again', () => {
  const w = seeded();
  const r = w.refuse('owner', 'updateSale', { saleId: w.ids.saleA, patch: { billing: 'once', priceCents: 1 } }, 'invalid');
  eq(r.error.message, 'One-time or monthly cannot be changed on a sale. Remove the sale and enter it again.');
  w.refuse('owner', 'updateSale', { saleId: w.ids.saleB, patch: { billing: 'monthly' } }, 'invalid');
  w.refuse('owner', 'updateSale', { saleId: w.ids.saleB, patch: { billing: 'weekly' } }, 'invalid');
  w.must('owner', 'updateSale', { saleId: w.ids.saleA, patch: { billing: 'monthly', priceCents: 16000 } });
  eq(saleRow(w, w.ids.saleA), ['Window cleaning', 16000, w.ids.mason, 30, 10, 'monthly'], 'saying what it already is is fine');
  eq(clientRow(w, w.ids.clientA)[2], 'monthly');
});

test('a fix is checked like any other save: one bad value refuses all of it, and nothing else on the sale can be rewritten', () => {
  const w = seeded();
  [{ priceCents: -1 }, { priceCents: 1.5 }, { priceCents: '100' }, { priceCents: null }, { priceCents: NaN }, { priceCents: 100000001 }, { priceCents: [100] },
    { service: '' }, { service: '   ' }, { service: null }, { service: ['House wash'] }, { service: {} },
    { priceCents: 5000, service: '' }, { service: 'Fine', priceCents: -5 }].forEach((patch) => w.refuse('owner', 'updateSale', { saleId: w.ids.saleA, patch: patch }, 'invalid'));
  ['s_nobody', '', null, undefined, 5, {}, w.ids.clientA, w.ids.jobA, '__proto__'].forEach((id) => w.refuse('owner', 'updateSale', { saleId: id, patch: { priceCents: 100 } }, 'not_found'));
  w.refuse('owner', 'updateSale', { patch: { priceCents: 100 } }, 'not_found');
  eq(w.refuse('owner', 'updateSale', { saleId: 's_nobody', patch: { priceCents: 100 } }, 'not_found').error.message, 'That sale is no longer here.');
  const before = byId(w.db().sales, w.ids.saleA), client = byId(w.db().clients, w.ids.clientA);
  /* Fields that are not part of a fix are ignored, and a patch that is not a list of fields fixes nothing. */
  w.must('owner', 'updateSale', { saleId: w.ids.saleA, patch: { id: 's_other', clientId: w.ids.clientB, day: '2020-01-01', soldAt: 1, firstPct: 99, monthlyPct: 99, jobId: w.ids.jobB,
    endDay: '2026-11-17', endedBy: w.ids.saleB, notes: 'rewritten', events: [], clientName: 'x' } });
  w.must('owner', 'updateSale', { saleId: w.ids.saleA, patch: JSON.parse('{"__proto__":{"priceCents":1},"constructor":{"priceCents":1},"prototype":{"service":"x"}}') });
  [undefined, null, 'priceCents', 5, [], [{ priceCents: 1 }], true].forEach((patch) => w.must('owner', 'updateSale', { saleId: w.ids.saleA, patch: patch }));
  eq(byId(w.db().sales, w.ids.saleA), before);
  eq(byId(w.db().clients, w.ids.clientA), client);
  /* A long service name is cut to 60 like everywhere else, and the price limit is the same $1,000,000. */
  w.must('owner', 'updateSale', { saleId: w.ids.saleA, patch: { service: 'S'.repeat(500), priceCents: 100000000 } });
  eq(saleRow(w, w.ids.saleA), ['S'.repeat(60), 100000000, w.ids.mason, 30, 10, 'monthly']);
  eq(byId(w.full('mason').sales, w.ids.saleA).events[0].cents, 30000000);
  checkData(w);
});

test('a fix sent twice with the same opId is made once, and only the owner can make one', () => {
  const w = seeded();
  const a = w.must('owner', 'updateSale', { saleId: w.ids.saleA, patch: { priceCents: 12000 }, opId: 'fix-sale-0001' });
  const rev = w.rev();
  w.must('owner', 'updateSale', { saleId: w.ids.saleA, patch: { priceCents: 9000 } });
  const again = w.must('owner', 'updateSale', { saleId: w.ids.saleA, patch: { priceCents: 12000 }, opId: 'fix-sale-0001' });
  eq([again.replay, again.result], [true, a.result]);
  eq(saleRow(w, w.ids.saleA)[1], 9000, 'the retry did not put the older fix back on top of the newer one');
  ok(w.rev() === rev + 1);
  ['mason', 'jake', 'cole'].forEach((who) => w.refuse(who, 'updateSale', { saleId: w.ids.saleA, patch: { priceCents: 1, repId: w.ids[who] } }, 'forbidden'));
  eq(w.raw({ action: 'updateSale', saleId: w.ids.saleA, patch: { priceCents: 1 } }).error.code, 'auth');
});

/* ================================================================== */
section('board');

function row(w, who, id) { const r = byId(w.full(who).board, id); return r ? [r.week.count, r.week.cents, r.month.count, r.month.cents, r.all.count, r.all.cents] : null; }

test('week (Monday start), month and all-time totals across a month and a year boundary', () => {
  const w = world({ day: '2026-12-21', time: '10:00' });   /* a Monday */
  plain(w, 'mason', 'B1', 10000);
  eq(row(w, 'mason', w.ids.mason), [1, 10000, 1, 10000, 1, 10000]);
  w.at('2026-12-27', '10:00'); plain(w, 'mason', 'B2', 20000, 'monthly');   /* Sunday: last day of that week */
  eq(row(w, 'mason', w.ids.mason), [2, 30000, 2, 30000, 2, 30000]);
  w.at('2026-12-28', '00:05'); plain(w, 'mason', 'B3', 30000); plain(w, 'jake', 'B4', 5000);   /* Monday: a new week */
  eq(row(w, 'mason', w.ids.mason), [1, 30000, 3, 60000, 3, 60000]);
  eq(row(w, 'mason', w.ids.jake), [1, 5000, 1, 5000, 1, 5000]);
  w.at('2026-12-31', '23:50'); plain(w, 'mason', 'B5', 40000);
  eq(row(w, 'mason', w.ids.mason), [2, 70000, 4, 100000, 4, 100000]);
  w.at('2027-01-01', '00:10'); plain(w, 'mason', 'B6', 50000);   /* new month and year, same week */
  eq(row(w, 'mason', w.ids.mason), [3, 120000, 1, 50000, 5, 150000]);
  eq(row(w, 'mason', w.ids.jake), [1, 5000, 0, 0, 1, 5000]);
  w.at('2027-01-03', '23:59');
  eq(row(w, 'jake', w.ids.mason), [3, 120000, 1, 50000, 5, 150000], 'Sunday night, seen by the other rep');
  w.at('2027-01-04', '00:01');
  eq(row(w, 'owner', w.ids.mason), [0, 0, 1, 50000, 5, 150000], 'Monday morning');
  w.at('2027-02-01', '09:00');
  eq(row(w, 'owner', w.ids.mason), [0, 0, 0, 0, 5, 150000]);
  eq(JSON.stringify(w.full('mason').board), JSON.stringify(w.full('owner').board), 'everyone sees the same board');
  eq(w.full('cole').board, []);
});

test('who is on the board', () => {
  const w = world();
  eq(w.full('mason').board.map((b) => b.name).sort(), ['Jake Miller', 'Mason Reed'], 'reps with no sales yet are listed; the owner and techs are not');
  plain(w, 'owner', 'Owner Sale', 7000);
  eq(row(w, 'mason', w.ids.owner), [1, 7000, 1, 7000, 1, 7000]);
  const s = plain(w, 'mason', 'Counted Then Deleted', 9000);
  w.must('owner', 'updateClient', { clientId: s.clientId, patch: { status: 'Cancelled' } });
  eq(row(w, 'jake', w.ids.mason), [1, 9000, 1, 9000, 1, 9000], 'a cancelled client still counts as a sale made');
  w.must('owner', 'removeMember', { id: w.ids.mason }); w.must('owner', 'removeMember', { id: w.ids.jake });
  const b = w.full('owner').board;
  eq(b.map((x) => x.name + ':' + x.active).sort(), ['Grayson:true', 'Mason Reed:false'], 'a removed rep stays only if they sold something');
  w.must('owner', 'deleteSale', { saleId: s.saleId });
  eq(w.full('owner').board.map((x) => x.name), ['Grayson']);
});

/* ================================================================== */
section('clients and jobs');

test('the status log records each change with its day, once', () => {
  const w = seeded();
  const set = (status) => w.must('owner', 'updateClient', { clientId: w.ids.clientA, patch: { status: status } });
  set('New');   /* no change: no entry */
  w.at('2026-11-20', '09:00'); set('Paused'); set('Paused');
  w.at('2026-11-25', '09:00'); set('Cancelled'); set('Active');
  eq(byId(w.db().clients, w.ids.clientA).statusLog, [{ day: '2026-11-17', status: 'New' }, { day: '2026-11-20', status: 'Paused' },
    { day: '2026-11-25', status: 'Cancelled' }, { day: '2026-11-25', status: 'Active' }]);
  ['active', 'Deleted', '', null, 5, ['Active'], 'constructor'].forEach((s) => w.refuse('owner', 'updateClient', { clientId: w.ids.clientA, patch: { status: s } }, 'invalid'));
});

test('a New client becomes Active when their first job is finished, and stays Active', () => {
  const w = seeded();
  w.at('2026-11-18', '11:00');
  const r = w.must('cole', 'setJobDone', { jobId: w.ids.jobA });
  eq(r.result, { jobId: w.ids.jobA, status: 'done' });
  const c = byId(w.db().clients, w.ids.clientA), j = byId(w.db().jobs, w.ids.jobA);
  eq([c.status, c.statusLog], ['Active', [{ day: '2026-11-17', status: 'New' }, { day: '2026-11-18', status: 'Active' }]]);
  eq([j.status, j.doneAt, j.doneBy], ['done', w.t, w.ids.cole]);
  const n = w.full('owner').notices.filter((x) => x.type === 'done');
  eq(n.map((x) => x.text), ['Cole marked Alpha Marker House done (Window cleaning).'], 'the owner is told, in the app\'s own words');
  w.must('cole', 'setJobDone', { jobId: w.ids.jobA, done: false });
  const j2 = byId(w.db().jobs, w.ids.jobA);
  eq([j2.status, j2.doneAt, j2.doneBy, byId(w.db().clients, w.ids.clientA).status], ['scheduled', null, null, 'Active']);
  eq(byId(w.db().clients, w.ids.clientB).status, 'New', 'the other client is untouched');
});

test('finishing a job does not wake a paused or cancelled client, and the owner can finish any job', () => {
  const w = seeded();
  w.must('owner', 'updateClient', { clientId: w.ids.clientB, patch: { status: 'Paused' } });
  w.must('owner', 'setJobDone', { jobId: w.ids.jobB });
  eq(byId(w.db().clients, w.ids.clientB).status, 'Paused');
  eq(byId(w.db().jobs, w.ids.jobB).doneBy, w.ids.owner);
  eq(w.db().notices.filter((x) => x.type === 'done').length, 0, 'the owner is not told about their own work');
  w.refuse('owner', 'setJobDone', { jobId: 'j_missing' }, 'not_found'); w.refuse('cole', 'setJobDone', {}, 'not_found');
});

test('notes are kept to the latest 50 on a client and on a job', () => {
  const w = seeded();
  for (let i = 1; i <= 55; i++) {
    w.wait(1000);
    w.must('mason', 'addNote', { kind: 'client', id: w.ids.clientA, text: 'client note ' + i });
    w.must(i % 2 ? 'cole' : 'mason', 'addNote', { kind: 'job', id: w.ids.jobA, text: 'job note ' + i });
  }
  const cn = byId(w.db().clients, w.ids.clientA).notes, jn = byId(w.db().jobs, w.ids.jobA).notes;
  eq([cn.length, cn[0].text, cn[49].text], [50, 'client note 6', 'client note 55']);
  eq([jn.length, jn[0].text, jn[49].text], [50, 'job note 6', 'job note 55']);
  eq([jn[49].by, jn[48].by, jn[49].at], [w.ids.cole, w.ids.mason, w.t]);
  ['', '   ', null, undefined, '\n\n'].forEach((t) => w.refuse('mason', 'addNote', { kind: 'client', id: w.ids.clientA, text: t }, 'invalid'));
  ['sale', 'team', '', null, 'constructor', undefined].forEach((k) => w.refuse('mason', 'addNote', { kind: k, id: w.ids.clientA, text: 'x' }, 'invalid'));
  w.refuse('mason', 'addNote', { kind: 'client', id: 'c_missing', text: 'x' }, 'not_found');
  w.refuse('mason', 'addNote', { kind: 'job', id: w.ids.clientA, text: 'x' }, 'not_found');
});

test('long text is cut to its limit, never refused and never stored whole', () => {
  const w = world(), big = 'A'.repeat(5000);
  const r = w.must('mason', 'createSale', { client: { name: big, contact: big, phone: big, email: big, address: big }, service: big, priceCents: 100, notes: big, what: big,
    appointment: { date: '2026-11-18', time: '09:30' } }).result;
  const c = byId(w.db().clients, r.clientId), s = byId(w.db().sales, r.saleId), j = byId(w.db().jobs, r.jobId);
  eq([c.name.length, c.contact.length, c.phone.length, c.email.length, c.address.length, c.service.length, s.service.length, s.notes.length, c.notes[0].text.length, j.what.length],
    [60, 60, 30, 120, 160, 60, 60, 500, 500, 160]);
  w.must('mason', 'addNote', { kind: 'job', id: r.jobId, text: big });
  eq(byId(w.db().jobs, r.jobId).notes[0].text.length, 500);
  w.must('owner', 'updateJob', { jobId: r.jobId, patch: { what: big } });
  eq(byId(w.db().jobs, r.jobId).what.length, 160);
  w.must('owner', 'updateClient', { clientId: r.clientId, patch: { name: big, service: big, address: big } });
  const c2 = byId(w.db().clients, r.clientId);
  eq([c2.name.length, c2.service.length, c2.address.length], [60, 60, 160]);
  const m = w.must('owner', 'saveMember', { member: { name: big, role: 'rep' } }).result;
  eq(byId(w.db().team, m.id).name.length, 40);
  ok(JSON.stringify(w.store.dump()).indexOf('A'.repeat(501)) < 0, 'somewhere more than 500 characters were stored');
  ok(w.db().notices.every((n) => n.text.length < 400), 'a notice grew with the input');
});

test('one-line fields are tidied to a single clean line; notes keep their line breaks', () => {
  const w = world();
  const r = w.must('mason', 'createSale', { client: { name: '  Tidy \t  Home \n', address: '12  Main St,\r\nSmithville\u0000\u0007 TN ' }, service: ' House wash ', priceCents: 100,
    notes: '  first line\r\nsecond line\n\n  third\tline\u0000 \n ' }).result;
  const c = byId(w.db().clients, r.clientId);
  eq([c.name, c.address, c.service], ['Tidy Home', '12 Main St, Smithville TN', 'House wash']);
  eq(c.notes[0].text, 'first line\nsecond line\n\n  third\tline');
  w.must('mason', 'addNote', { kind: 'client', id: r.clientId, text: 'old style line one\rold style line two' });
  eq(byId(w.db().clients, r.clientId).notes[1].text, 'old style line one\nold style line two', 'a bare carriage return is a line break, not nothing');
});

test('a payment link must be a plain https link', () => {
  const w = seeded();
  const bad = ['http://pay.example/x', 'javascript:alert(1)', 'JaVaScRiPt:alert(1)', 'data:text/html,<script>', 'ftp://pay.example', '//pay.example/x', 'pay.example/x', 'https://',
    'https://pay.example/a b', 'https://pay.example/"onmouseover="x', "https://pay.example/'x", 'https://pay.example/<script>', 'https://pay.example/`x`', 'x https://pay.example', 'https:/pay.example', 'https:\\\\pay.example',
    'https://pay.example/\njavascript:alert(1)', 5, true];
  bad.forEach((link) => {
    w.refuse('mason', 'createSale', { client: { name: 'Bad Link' }, service: 'House wash', priceCents: 100, stripeLink: link }, 'invalid');
    w.refuse('owner', 'updateClient', { clientId: w.ids.clientA, patch: { phone: 'changed with a bad link', stripeLink: link } }, 'invalid');
  });
  eq(byId(w.db().clients, w.ids.clientA).stripeLink, 'https://pay.example/alpha');
  ['https://buy.stripe.com/test_abc123', 'https://pay.example/x?y=1&z=2#frag', '  https://pay.example/trim  '].forEach((link) => {
    w.must('owner', 'updateClient', { clientId: w.ids.clientA, patch: { stripeLink: link } });
    eq(byId(w.db().clients, w.ids.clientA).stripeLink, link.trim());
  });
  ['', null, {}, ['http://not-text.example'], { href: 'javascript:alert(1)' }].forEach((v) => {   /* nothing, or not text at all: no link */
    w.must('owner', 'updateClient', { clientId: w.ids.clientA, patch: { stripeLink: 'https://pay.example/reset' } });
    w.must('owner', 'updateClient', { clientId: w.ids.clientA, patch: { stripeLink: v } });
    eq(byId(w.db().clients, w.ids.clientA).stripeLink, '');
  });
  w.db().clients.forEach((c) => ok(c.stripeLink === '' || /^https:\/\//i.test(c.stripeLink), 'a stored link is not https: ' + c.stripeLink));
});

test('a payment link has to go where it looks like it goes: no "@" trick, no bare word, no spaces', () => {
  const w = seeded(), words = 'That payment link does not look right. Paste the whole link from your payment page.';
  const tricks = [
    'https://buy.stripe.com@evil.example/pay/abc', 'HTTPS://buy.stripe.com@evil.example/p', 'https://buy.stripe.com:443@evil.example/', 'https://grayson:pin@pay.example/x', 'https://@pay.example/x',
    'https://buy.stripe.com%40evil.example/x', 'https://buy.stripe.com\\@evil.example/x', 'https://evil.example\\.buy.stripe.com/x', 'https://pay.example?to=@evil.example/x', 'https://pay.example#@evil.example/x',
    'https://localhost/pay', 'https://stripe/pay', 'https://pay', 'https://12345/x', 'https://', 'https:///pay.example/x', 'https://./x', 'https://.pay.example/x', 'https://pay.example./x', 'https://pay..example/x',
    'https://pay.example:/x', 'https://pay.example:80a/x', 'https://[::1]/x', 'https://pаy.example/x', 'https://pay_me.example/x', 'https://pay.example,evil.example/x',
    'https://pay.example/a b', 'https://pay. example/x', 'https://pay.example/a\tb', 'https://pay.example/a\nb', 'https://pay.example/a\u0000b', 'https://pay.example/a b', 'https://pay.example/a\u007fb',
    'https://pay.example/"x', "https://pay.example/'x", 'https://pay.example/<x>', 'https://pay.example/`x`', 'https://pay.example/a\\b'];
  tricks.forEach((link) => {
    const tag = JSON.stringify(link);
    eq(w.refuse('mason', 'createSale', { client: { name: 'Trick Link' }, service: 'House wash', priceCents: 100, stripeLink: link }, 'invalid').error.message, words, 'createSale with ' + tag);
    eq(w.refuse('owner', 'updateClient', { clientId: w.ids.clientA, patch: { phone: 'changed with a trick link', stripeLink: link } }, 'invalid').error.message, words, 'updateClient with ' + tag);
    eq(C.check.payLink(link), words, 'check.payLink(' + tag + ')');
  });
  eq(byId(w.db().clients, w.ids.clientA).stripeLink, 'https://pay.example/alpha', 'nothing was saved');
  /* The older messages still say what they always said. */
  ['http://pay.example/x', 'javascript:alert(1)', 'pay.example/x', 'x https://pay.example', 'https:/pay.example'].forEach((link) => {
    eq(w.refuse('owner', 'updateClient', { clientId: w.ids.clientA, patch: { stripeLink: link } }, 'invalid').error.message, 'A payment link must start with https://');
    eq(C.check.payLink(link), 'A payment link must start with https://');
  });
  eq(C.check.payLink('https://pay.example/' + 'k'.repeat(281)), 'That payment link is too long.');
  /* Real payment pages, and an "@" where it is harmless (after the first "/"), are all fine. */
  const fine = ['https://buy.stripe.com/test_abc123', 'https://BUY.Stripe.com/4gw5kC', 'https://checkout.square.site/merchant/ML7/checkout/ABC', 'https://www.paypal.com/paypalme/ridgelinewash/150',
    'https://venmo.com/u/Ridgeline-Wash', 'https://cash.app/$ridgelinewash', 'https://pay.example:8443/x', 'https://pay.example', 'https://pay.example/', 'https://pay.example?x=1', 'https://pay.example#top',
    'https://pay.example/x?email=ann@alpha.example&y=2#frag', 'https://pay.example/@ridgeline', 'https://xn--pay-9la.example/x', 'https://a-b.c-d.example/%20x', 'https://192.0.2.7/pay', '  https://pay.example/trim \n'];
  fine.forEach((link) => {
    eq(C.check.payLink(link), '', 'check.payLink(' + JSON.stringify(link) + ')');
    w.must('owner', 'updateClient', { clientId: w.ids.clientA, patch: { stripeLink: link } });
    eq(byId(w.db().clients, w.ids.clientA).stripeLink, link.trim());
    const c = w.must('mason', 'createSale', { client: { name: 'Fine Link' }, service: 'House wash', priceCents: 100, stripeLink: link }).result;
    eq(byId(w.db().clients, c.clientId).stripeLink, link.trim());
  });
  ['', '   ', null, undefined, {}, []].forEach((v) => eq(C.check.payLink(v), '', 'no link at all is fine'));
  checkData(w);
});

test('a payment link too long to keep whole is refused, never saved cut short', () => {
  const w = seeded();   /* a cut link still looks like a link, but it takes the client nowhere */
  [301, 420, 5000].forEach((n) => {
    const link = ('https://checkout.pay.example/c/pay/' + 'a1b2c3d4'.repeat(700)).slice(0, n - 4) + '#end';
    const u = w.call('owner', 'updateClient', { clientId: w.ids.clientA, patch: { stripeLink: link } });
    const stored = byId(w.db().clients, w.ids.clientA).stripeLink;
    ok(u.ok ? stored === link : (u.error.code === 'invalid' && stored === 'https://pay.example/alpha'), 'a ' + n + ' character link was saved as ' + stored.length + ' characters');
    const c = w.call('mason', 'createSale', { client: { name: 'Long Link ' + n }, service: 'House wash', priceCents: 100, stripeLink: link });
    ok(c.ok ? byId(w.db().clients, c.result.clientId).stripeLink === link : (c.error.code === 'invalid' && !w.db().clients.some((x) => x.name === 'Long Link ' + n)), 'a sale kept a ' + n + ' character link cut short');
  });
  const fits = 'https://pay.example/' + 'k'.repeat(280);
  eq(fits.length, 300);
  w.must('owner', 'updateClient', { clientId: w.ids.clientA, patch: { stripeLink: fits } });
  eq(byId(w.db().clients, w.ids.clientA).stripeLink, fits, 'a 300 character link is kept whole');
});

test('the owner can edit everything on a client, and one bad value refuses the whole edit', () => {
  const w = seeded();
  w.must('owner', 'updateClient', { clientId: w.ids.clientA, patch: { service: 'Pressure wash', priceCents: 22000, billing: 'once', startDate: '2026-12-01', payStatus: 'paid', status: 'Active' } });
  const c = byId(w.db().clients, w.ids.clientA);
  eq([c.service, c.priceCents, c.billing, c.startDate, c.payStatus, c.status], ['Pressure wash', 22000, 'once', '2026-12-01', 'paid', 'Active']);
  eq(byId(w.db().sales, w.ids.saleA).priceCents, 15000, 'editing the client never rewrites a sale');
  [{ priceCents: -5 }, { priceCents: 1.5 }, { priceCents: '100' }, { billing: 'weekly' }, { startDate: '2026-02-30' }, { startDate: 5 }, { payStatus: 'refunded' }, { status: 'Gone' }, { name: '' }, { name: '   ' }, { service: '' }]
    .forEach((p) => w.refuse('owner', 'updateClient', { clientId: w.ids.clientA, patch: Object.assign({ phone: 'should not save', email: 'should@not.save' }, p) }, 'invalid'));
  w.refuse('owner', 'updateClient', { clientId: 'c_missing', patch: { phone: '1' } }, 'not_found');
  w.refuse('owner', 'updateClient', { patch: { phone: '1' } }, 'not_found');
  ['paid', 'unpaid', 'late'].forEach((p) => w.must('owner', 'updateClient', { clientId: w.ids.clientA, patch: { payStatus: p } }));
});

test('a new sale to an existing client updates what they buy and wakes a cancelled client', () => {
  const w = seeded();
  w.must('owner', 'updateClient', { clientId: w.ids.clientA, patch: { status: 'Cancelled' } });
  w.at('2026-11-19', '09:00');
  const r = w.must('mason', 'createSale', { clientId: w.ids.clientA, client: { name: 'Ignored Name' }, service: 'Pressure wash', priceCents: 9900, billing: 'once', notes: 'came back',
    stripeLink: 'http://ignored.example', appointment: { date: '2026-11-20', time: '08:00' } }).result;
  eq(r.clientId, w.ids.clientA);
  const c = byId(w.db().clients, w.ids.clientA);
  eq([c.name, c.service, c.priceCents, c.billing, c.status, c.stripeLink, c.startDate], ['Alpha Marker House', 'Pressure wash', 9900, 'once', 'Active', 'https://pay.example/alpha', '2026-11-17']);
  eq(c.statusLog[c.statusLog.length - 1], { day: '2026-11-19', status: 'Active' });
  eq(c.notes[c.notes.length - 1].text, 'came back');
  eq([w.db().clients.length, w.db().sales.length, w.db().jobs.length], [2, 3, 3]);
  w.refuse('mason', 'createSale', { clientId: 'c_missing', service: 'House wash', priceCents: 100 }, 'not_found');
});

test('a sale needs a client name and a service', () => {
  const w = world();
  [{ client: {}, service: 'House wash' }, { client: { name: '  ' }, service: 'House wash' }, { service: 'House wash' }, { client: 'Just A String', service: 'House wash' }, { client: null, service: 'House wash' },
    { client: { name: 'No Service' } }, { client: { name: 'No Service' }, service: '' }, { client: { name: 'No Service' }, service: ' \n ' }]
    .forEach((f) => w.refuse('mason', 'createSale', Object.assign({ priceCents: 100, appointment: { date: '2026-11-18', time: '09:30' } }, f), 'invalid'));
  /* The words say "client", like the rest of the app. */
  eq(w.refuse('mason', 'createSale', { client: { name: ' ' }, service: 'House wash', priceCents: 100 }, 'invalid').error.message, 'Add the client\'s name.');
  const s = plain(w, 'mason', 'Named', 100);
  eq(w.refuse('mason', 'updateClient', { clientId: s.clientId, patch: { name: '' } }, 'invalid').error.message, 'Add the client\'s name.');
});

test('a sale says one-time or monthly; anything else is refused, and saying nothing means one-time', () => {
  const w = world();
  ['weekly', 'yearly', 'Monthly', 'ONCE', ' monthly', '', 0, 1, true, false, ['monthly'], { monthly: true }].forEach((b) => {
    const r = w.refuse('mason', 'createSale', { client: { name: 'Odd Billing' }, service: 'House wash', priceCents: 100, billing: b, appointment: { date: '2026-11-18', time: '09:30' } }, 'invalid');
    eq(r.error.message, 'Pick one-time or monthly.', 'billing ' + JSON.stringify(b));
  });
  eq([w.db().clients.length, w.db().sales.length, w.db().jobs.length], [0, 0, 0], 'a guess is never saved as one-time or as monthly');
  [undefined, null].forEach((b, i) => {
    const r = w.must('mason', 'createSale', { client: { name: 'No Billing ' + i }, service: 'House wash', priceCents: 100, billing: b }).result;
    eq([byId(w.db().sales, r.saleId).billing, byId(w.db().clients, r.clientId).billing], ['once', 'once']);
  });
  const none = w.must('mason', 'createSale', { client: { name: 'No Billing At All' }, service: 'House wash', priceCents: 100 }).result;
  eq(byId(w.db().sales, none.saleId).billing, 'once');
  ['once', 'monthly'].forEach((b) => { const said = plain(w, 'mason', 'Says ' + b, 100, b); eq(byId(w.db().sales, said.saleId).billing, b); });
});

test('deleting a client removes their sales and visits and nobody else\'s', () => {
  const w = seeded();
  w.must('mason', 'bookJob', { clientId: w.ids.clientA, date: '2026-11-19', time: '08:00' });
  w.must('owner', 'deleteClient', { clientId: w.ids.clientA });
  const db = w.db();
  eq([db.clients.map((c) => c.id), db.sales.map((s) => s.id), db.jobs.map((j) => j.id)], [[w.ids.clientB], [w.ids.saleB], [w.ids.jobB]]);
  const s = w.full('mason');
  eq([s.clients, s.sales, s.jobs, s.taken.length], [[], [], [], 1]);
  eq(w.full('cole').jobs, []);
  eq(byId(s.board, w.ids.mason).all, { count: 0, cents: 0 });
  w.refuse('owner', 'deleteClient', { clientId: w.ids.clientA }, 'not_found');
  w.refuse('mason', 'addNote', { kind: 'job', id: w.ids.jobA, text: 'gone' }, 'not_found');
});

test('removing a sale puts the client back to what their newest remaining sale says', () => {
  const w = world({ day: '2027-01-10' });
  const what = (id) => { const c = byId(w.db().clients, id); return [c.service, c.priceCents, c.billing]; };
  const first = w.must('mason', 'createSale', { client: { name: 'Bought Three Times' }, service: 'Window cleaning', priceCents: 15000, billing: 'monthly' }).result;
  w.at('2027-02-12', '10:00'); relog(w);
  const second = w.must('mason', 'createSale', { clientId: first.clientId, service: 'House wash', priceCents: 30000, billing: 'once' }).result;
  w.at('2027-03-05', '10:00'); relog(w);
  const third = w.must('mason', 'createSale', { clientId: first.clientId, service: 'Pressure wash', priceCents: 9900, billing: 'once' }).result;
  eq(what(first.clientId), ['Pressure wash', 9900, 'once'], 'each sale to a client who is already here rewrites what they buy');

  /* An older sale goes: the client is as the newest one left them. */
  w.must('owner', 'deleteSale', { saleId: second.saleId });
  eq(what(first.clientId), ['Pressure wash', 9900, 'once']);
  /* The newest sale goes: back to the one before it, how often included. */
  w.must('owner', 'deleteSale', { saleId: third.saleId });
  eq(what(first.clientId), ['Window cleaning', 15000, 'monthly'], 'entered by mistake, removed, and the client is a monthly window client again');
  const c = byId(w.db().clients, first.clientId);
  eq([c.name, c.status, c.repId, c.startDate, c.payStatus], ['Bought Three Times', 'New', w.ids.mason, '2027-01-10', 'unpaid'], 'nothing else about the client moves');
  eq(byId(w.full('mason').clients, first.clientId).service, 'Window cleaning', 'and the rep\'s phone shows it');
  /* The last sale goes: there is nothing to go back to, so the client is left as they are. */
  w.must('owner', 'deleteSale', { saleId: first.saleId });
  eq(what(first.clientId), ['Window cleaning', 15000, 'monthly']);
  eq(w.db().sales.filter((x) => x.clientId === first.clientId), []);
  checkData(w);
});

test('removing a sale that was not the client\'s newest leaves what the owner set by hand', () => {
  const w = world({ day: '2027-01-10' });
  const first = w.must('mason', 'createSale', { client: { name: 'Price Went Up' }, service: 'Window cleaning', priceCents: 15000, billing: 'monthly' }).result;
  w.at('2027-02-12', '10:00'); relog(w);
  const second = w.must('mason', 'createSale', { clientId: first.clientId, service: 'Window cleaning', priceCents: 16000, billing: 'monthly' }).result;
  w.must('owner', 'updateClient', { clientId: first.clientId, patch: { priceCents: 17500, service: 'Windows and screens' } });
  w.must('owner', 'deleteSale', { saleId: first.saleId });
  const c = byId(w.db().clients, first.clientId);
  eq([c.service, c.priceCents, c.billing], ['Windows and screens', 17500, 'monthly'], 'the older sale never set these, so removing it does not touch them');
  /* A different client's sale has no say at all. */
  const other = w.must('jake', 'createSale', { client: { name: 'Someone Else' }, service: 'House wash', priceCents: 22000, billing: 'once' }).result;
  w.must('owner', 'deleteSale', { saleId: second.saleId });
  eq([byId(w.db().clients, first.clientId).service, byId(w.db().clients, first.clientId).priceCents], ['Windows and screens', 17500], 'no sale of theirs is left: left alone');
  eq(byId(w.db().clients, other.clientId).service, 'House wash');
  checkData(w);
});

test('deleting a sale removes a visit that has not happened, and keeps one that has', () => {
  const base = seeded();
  let w = base.fork();
  w.must('owner', 'deleteSale', { saleId: w.ids.saleA });
  eq([byId(w.db().jobs, w.ids.jobA), byId(w.db().sales, w.ids.saleA), w.db().clients.length], [null, null, 2], 'scheduled visit goes, client stays');
  w.refuse('owner', 'deleteSale', { saleId: w.ids.saleA }, 'not_found'); w.refuse('owner', 'deleteSale', {}, 'not_found');
  w = base.fork();
  w.must('cole', 'setJobDone', { jobId: w.ids.jobA });
  w.must('owner', 'deleteSale', { saleId: w.ids.saleA });
  const j = byId(w.db().jobs, w.ids.jobA);
  eq([j.status, j.saleId, j.doneBy], ['done', null, w.ids.cole], 'finished visit stays, unhooked from the sale');
  w = base.fork();
  w.must('owner', 'updateJob', { jobId: w.ids.jobA, patch: { status: 'cancelled' } });
  w.must('owner', 'deleteSale', { saleId: w.ids.saleA });
  eq([byId(w.db().jobs, w.ids.jobA).status, byId(w.db().jobs, w.ids.jobA).saleId], ['cancelled', null]);
  eq(w.full('mason').sales, []);
});

test('removing someone unassigns their scheduled jobs, keeps their finished ones and clears the default tech', () => {
  const w = seeded();
  w.must('owner', 'saveSettings', { settings: { defaultTechId: w.ids.cole } });
  const extra = sellOk(w, 'mason', 'Second For Cole', '2026-11-19', '08:00');
  eq(byId(w.db().jobs, extra.jobId).assignedTo, w.ids.cole);
  w.must('cole', 'setJobDone', { jobId: w.ids.jobA });
  w.must('owner', 'removeMember', { id: w.ids.cole });
  const db = w.db(), done = byId(db.jobs, w.ids.jobA);
  eq(byId(db.jobs, extra.jobId).assignedTo, null);
  eq([done.status, done.assignedTo, done.doneBy], ['done', w.ids.cole, w.ids.cole]);
  eq(byId(db.settings, 'main').defaultTechId, null); eq(w.full('owner').settings.defaultTechId, null);
  const m = byId(w.full('mason').team, w.ids.cole);
  eq([m.name, m.active], ['Cole', false], 'the name still resolves for old jobs');
  eq(byId(db.jobs, w.ids.jobB).assignedTo, w.ids.tess, 'other people\'s jobs are untouched');
  w.refuse('owner', 'removeMember', { id: w.ids.cole }, 'not_found'); w.refuse('owner', 'removeMember', { id: 'm_nobody' }, 'not_found'); w.refuse('owner', 'removeMember', {}, 'not_found');
  w.refuse('owner', 'removeMember', { id: w.ids.owner }, 'invalid');
  w.refuse('owner', 'updateJob', { jobId: extra.jobId, patch: { assignedTo: w.ids.cole } }, 'invalid');
  w.refuse('owner', 'saveMember', { member: { id: w.ids.cole, name: 'Cole', role: 'tech' } }, 'not_found');
});

test('a job brought back after its tech left is not left with someone who is gone', () => {
  const w = seeded();
  w.must('owner', 'updateJob', { jobId: w.ids.jobA, patch: { status: 'cancelled' } });   /* cancelled while it was Cole's */
  w.must('tess', 'setJobDone', { jobId: w.ids.jobB });                                    /* finished by Tess */
  w.must('owner', 'removeMember', { id: w.ids.cole }); w.must('owner', 'removeMember', { id: w.ids.tess });
  w.must('owner', 'updateJob', { jobId: w.ids.jobA, patch: { status: 'scheduled' } });
  eq(byId(w.db().jobs, w.ids.jobA).assignedTo, null, 'un-cancelled job');
  const f = w.fork();
  w.must('owner', 'setJobDone', { jobId: w.ids.jobB, done: false });
  eq(byId(w.db().jobs, w.ids.jobB).assignedTo, null, 'job marked not done again');
  f.must('owner', 'updateJob', { jobId: f.ids.jobB, patch: { status: 'scheduled' } });
  eq(byId(f.db().jobs, f.ids.jobB).assignedTo, null, 'finished job set back to scheduled');
  w.db().jobs.concat(f.db().jobs).forEach((j) => { if (j.status === 'scheduled' && j.assignedTo) ok(byId(w.db().team, j.assignedTo).active, 'a scheduled job belongs to someone who is gone'); });
});

test('updateJob: assign, describe, cancel and bring back; anything else is refused', () => {
  const w = seeded();
  w.must('owner', 'updateJob', { jobId: w.ids.jobA, patch: { assignedTo: w.ids.tess, what: '  Windows, inside and out  ' } });
  eq([byId(w.db().jobs, w.ids.jobA).assignedTo, byId(w.db().jobs, w.ids.jobA).what], [w.ids.tess, 'Windows, inside and out']);
  [{ assignedTo: 'm_nobody' }, { assignedTo: 'constructor' }, { assignedTo: {} }, { what: '' }, { what: '  ' }, { what: null }, { status: 'done' }, { status: 'Scheduled' }, { status: '' }, { status: null }, { status: 5 }]
    .forEach((p) => w.refuse('owner', 'updateJob', { jobId: w.ids.jobA, patch: Object.assign({ what: 'should not save' }, p) }, 'invalid'));
  w.refuse('owner', 'updateJob', { jobId: 'j_missing', patch: {} }, 'not_found'); w.refuse('owner', 'updateJob', {}, 'not_found');
  w.must('owner', 'updateJob', { jobId: w.ids.jobA, patch: { assignedTo: '' } });
  eq(byId(w.db().jobs, w.ids.jobA).assignedTo, null);
  w.must('owner', 'updateJob', { jobId: w.ids.jobA, patch: { date: '2020-01-01', time: '03:00', clientId: w.ids.clientB, id: 'j_x', doneBy: w.ids.owner, saleId: null } });
  const j = byId(w.db().jobs, w.ids.jobA);
  eq([j.date, j.time, j.clientId, j.doneBy, j.saleId], ['2026-11-18', '09:30', w.ids.clientA, null, w.ids.saleA], 'only assignedTo, what and status can be patched');
});

test('a job can only be given to a tech or the owner, never to a sales rep', () => {
  const w = seeded();
  [w.ids.mason, w.ids.jake].forEach((rep) => {
    const j = w.refuse('owner', 'updateJob', { jobId: w.ids.jobA, patch: { what: 'should not save', assignedTo: rep } }, 'invalid');
    eq(j.error.message, 'Only a tech or the owner can be given a job. Pick one of them.');
    const s = w.refuse('owner', 'saveSettings', { settings: { firstPct: 1, defaultTechId: rep } }, 'invalid');
    eq(s.error.message, 'Only a tech or the owner can be given a job. Pick one of them.');
  });
  eq(w.refuse('owner', 'updateJob', { jobId: w.ids.jobA, patch: { assignedTo: 'm_nobody' } }, 'invalid').error.message, 'Pick someone who is on the team.');
  [w.ids.tess, w.ids.owner, w.ids.cole].forEach((id) => {
    w.must('owner', 'updateJob', { jobId: w.ids.jobA, patch: { assignedTo: id } });
    w.must('owner', 'saveSettings', { settings: { defaultTechId: id } });
    eq([byId(w.db().jobs, w.ids.jobA).assignedTo, w.full('owner').settings.defaultTechId], [id, id]);
  });
  w.must('owner', 'updateJob', { jobId: w.ids.jobA, patch: { assignedTo: w.ids.owner } });
  w.must('owner', 'setJobDone', { jobId: w.ids.jobA });
  eq(byId(w.db().jobs, w.ids.jobA).doneBy, w.ids.owner, 'the owner can do a job given to the owner');
  checkData(w);
});

test('making a tech a sales rep takes them off their scheduled jobs and off "new jobs go to", like removing them', () => {
  const w = seeded();
  w.must('owner', 'saveSettings', { settings: { defaultTechId: w.ids.cole } });
  const extra = sellOk(w, 'mason', 'Second For Cole', '2026-11-19', '08:00');
  eq(byId(w.db().jobs, extra.jobId).assignedTo, w.ids.cole);
  w.must('cole', 'setJobDone', { jobId: w.ids.jobA });
  w.must('owner', 'saveMember', { member: { id: w.ids.cole, name: 'Cole B', role: 'tech' } });   /* a new name only: nothing moves */
  eq([byId(w.db().jobs, extra.jobId).assignedTo, byId(w.db().settings, 'main').defaultTechId], [w.ids.cole, w.ids.cole]);

  w.must('owner', 'saveMember', { member: { id: w.ids.cole, name: 'Cole B', role: 'rep' } });
  const db = w.db(), done = byId(db.jobs, w.ids.jobA);
  eq(byId(db.jobs, extra.jobId).assignedTo, null, 'the job still to do goes back to nobody');
  eq([done.status, done.assignedTo, done.doneBy], ['done', w.ids.cole, w.ids.cole], 'the finished job still says who did it');
  eq([byId(db.settings, 'main').defaultTechId, w.full('owner').settings.defaultTechId], [null, null]);
  eq(byId(db.jobs, w.ids.jobB).assignedTo, w.ids.tess, 'other people\'s jobs are untouched');
  const next = sellOk(w, 'mason', 'After The Change', '2026-11-19', '09:30');
  eq(byId(w.db().jobs, next.jobId).assignedTo, null, 'new jobs no longer go to them');
  w.refuse('owner', 'updateJob', { jobId: extra.jobId, patch: { assignedTo: w.ids.cole } }, 'invalid');
  w.must('owner', 'setJobDone', { jobId: w.ids.jobA, done: false });
  eq(byId(w.db().jobs, w.ids.jobA).assignedTo, null, 'a finished job put back on the schedule does not go back to a sales rep');
  checkData(w);

  /* A tech who becomes an owner, or an owner who becomes a tech, can still do jobs and keeps them. */
  w.must('owner', 'saveSettings', { settings: { defaultTechId: w.ids.tess } });
  w.must('owner', 'saveMember', { member: { id: w.ids.tess, name: 'Tess Hart', role: 'owner' } });
  eq([byId(w.db().jobs, w.ids.jobB).assignedTo, byId(w.db().settings, 'main').defaultTechId], [w.ids.tess, w.ids.tess]);
  w.must('owner', 'saveMember', { member: { id: w.ids.tess, name: 'Tess Hart', role: 'tech' } });
  eq([byId(w.db().jobs, w.ids.jobB).assignedTo, byId(w.db().settings, 'main').defaultTechId], [w.ids.tess, w.ids.tess]);
  /* An owner made a sales rep is taken off the same way. */
  w.must('owner', 'saveMember', { member: { id: w.ids.tess, name: 'Tess Hart', role: 'owner' } });
  w.must('owner', 'saveMember', { member: { id: w.ids.tess, name: 'Tess Hart', role: 'rep' } });
  eq([byId(w.db().jobs, w.ids.jobB).assignedTo, byId(w.db().settings, 'main').defaultTechId], [null, null]);
  checkData(w);
});

test('the last owner cannot be demoted or removed', () => {
  const w = world();
  w.refuse('owner', 'saveMember', { member: { id: w.ids.owner, name: 'Grayson', role: 'rep' } }, 'invalid');
  w.refuse('owner', 'saveMember', { member: { id: w.ids.owner, name: 'Grayson', role: 'tech' } }, 'invalid');
  w.refuse('owner', 'removeMember', { id: w.ids.owner }, 'invalid');
  const second = w.must('owner', 'saveMember', { member: { name: 'Second Owner', role: 'owner', pin: '606147' } }).result.id;
  w.login('second', 'Second Owner', '606147');
  w.refuse('second', 'removeMember', { id: second }, 'invalid');
  w.must('second', 'saveMember', { member: { id: w.ids.owner, name: 'Grayson', role: 'rep' } });   /* fine while there are two */
  w.refuse('second', 'saveMember', { member: { id: second, name: 'Second Owner', role: 'rep' } }, 'invalid');
  eq(w.db().team.filter((m) => m.active && m.role === 'owner').map((m) => m.id), [second]);
  eq(w.call('owner', 'sync').error.code, 'auth', 'the demoted owner is signed out');
  eq(w.tryLogin('grayson', '482913').sync.me.role, 'rep');
  eq(w.tryLogin('grayson', '482913').sync.notices, [], 'and no longer receives owner data');
});

test('two people cannot share a name; a removed person\'s name can be used again', () => {
  const w = world();
  ['Mason Reed', 'mason reed', '  MASON   REED ', 'Cole', 'grayson'].forEach((n) => w.refuse('owner', 'saveMember', { member: { name: n, role: 'rep', pin: '101347' } }, 'invalid'));
  w.refuse('owner', 'saveMember', { member: { id: w.ids.jake, name: 'Mason Reed', role: 'rep' } }, 'invalid');
  w.must('owner', 'saveMember', { member: { id: w.ids.jake, name: 'JAKE MILLER', role: 'rep' } });   /* your own name, re-cased */
  w.must('owner', 'removeMember', { id: w.ids.mason });
  const again = w.must('owner', 'saveMember', { member: { name: 'Mason Reed', role: 'tech', pin: '101347' } }).result;
  ok(again.id !== w.ids.mason);
  const li = w.tryLogin('mason reed', '101347');
  ok(li.ok && li.sync.me.id === again.id && li.sync.me.role === 'tech');
  eq(w.tryLogin('mason reed', '271845').error.code, 'auth', 'the removed person\'s PIN does not open the new one');
});

test('saveMember checks the name, the role and the PIN, and ignores everything else', () => {
  const w = world();
  [{ role: 'rep' }, { name: '', role: 'rep' }, { name: '   ', role: 'rep' }, { name: 'No Role' }, { name: 'Bad Role', role: 'admin' }, { name: 'Bad Role', role: 'Owner' }, { name: 'Bad Role', role: ['rep'] },
    { name: 'Bad Pin', role: 'rep', pin: '12' }, { name: 'Bad Pin', role: 'rep', pin: '1234' }, { name: 'Bad Pin', role: 'rep', pin: '48291' }, { name: 'Bad Pin', role: 'rep', pin: '1234567' }, { name: 'Bad Pin', role: 'rep', pin: 'abcdef' }, { name: 'Bad Pin', role: 'rep', pin: 0 }, { name: 'Bad Pin', role: 'rep', pin: -123456 },
    { name: 'Bad Pin', role: 'rep', pin: false }, { name: 'Bad Pin', role: 'rep', pin: ['482913'] }, { name: 'Bad Pin', role: 'rep', pin: '123456' }, { name: 'Bad Pin', role: 'rep', pin: '777777' },
    'Just A Name', null, 5, ['x']].forEach((m) => w.refuse('owner', 'saveMember', { member: m }, 'invalid'));
  w.refuse('owner', 'saveMember', {}, 'invalid');
  w.refuse('owner', 'saveMember', { member: { id: 'm_nobody', name: 'Ghost', role: 'rep' } }, 'not_found');
  const r = w.must('owner', 'saveMember', { member: { name: 'Auto Pin', role: 'tech', active: false, pinHash: 'x', salt: 'y', createdAt: 5, standardsAckAt: 99, noticesSeenAt: 99, removedAt: 1 } }).result;
  ok(/^\d{6}$/.test(r.pin), 'a six digit PIN is made when none is given');
  const m = byId(w.db().team, r.id);
  eq([m.active, m.createdAt, m.standardsAckAt, m.noticesSeenAt, m.removedAt], [true, w.t, undefined, undefined, undefined]);
  ok(w.tryLogin('auto pin', r.pin).ok);
  const before = byId(w.db().team, w.ids.mason);
  const e = w.must('owner', 'saveMember', { member: { id: w.ids.mason, name: 'Mason Reed', role: 'rep', pin: '000000', active: false, pinHash: 'x' } }).result;
  eq(e, { id: w.ids.mason }, 'an edit never hands back a PIN');
  eq(byId(w.db().team, w.ids.mason), before, 'an edit cannot change the PIN or switch someone off');
});

test('the owner is told about what reps and techs do, and not about their own work', () => {
  const w = world();
  w.must('owner', 'saveSettings', { settings: { notifyEmail: 'boss@ridgeline.example' } });
  const a = sellOk(w, 'mason', 'Told Home', '2026-11-18', '09:30', { client: { name: 'Told Home', phone: '615-555-0100', address: '5 Oak St' } });
  let n = w.db().notices;
  eq([n.length, n[0].type, n[0].at], [1, 'booking', w.t]);
  eq(n[0].text, 'Mason Reed sold House wash to Told Home for $100.00. Booked for Wed, Nov 18 at 9:30 AM.');
  eq([w.emails.length, w.emails[0].to, w.emails[0].subject], [1, 'boss@ridgeline.example', 'Appointment booked: Told Home, Wed, Nov 18 at 9:30 AM']);
  has(w.emails[0].body, '5 Oak St'); has(w.emails[0].body, '615-555-0100'); has(w.emails[0].body, 'Nobody is assigned');
  plain(w, 'mason', 'No Visit Yet', 20000, 'monthly');
  n = w.db().notices.sort((x, y) => x.text < y.text ? -1 : 1);
  ok(w.db().notices.some((x) => x.type === 'sale' && x.text === 'Mason Reed sold Window cleaning to No Visit Yet for $200.00 a month. No appointment booked yet.'));
  eq(w.emails.length, 2);
  w.must('mason', 'moveJob', { jobId: a.jobId, date: '2026-11-19', time: '14:00' });
  ok(w.db().notices.some((x) => x.text === 'Mason Reed moved Told Home to Thu, Nov 19 at 2:00 PM.')); eq(w.emails.length, 3);
  eq([w.emails[2].subject, w.emails[2].body], ['Appointment moved: Told Home, Thu, Nov 19 at 2:00 PM', 'Mason Reed moved Told Home to Thu, Nov 19 at 2:00 PM.']);
  w.must('mason', 'bookJob', { clientId: a.clientId, date: '2026-11-20', time: '12:00' });
  ok(w.db().notices.some((x) => x.text === 'Mason Reed booked Told Home for Fri, Nov 20 at 12:00 PM.')); eq(w.emails.length, 4);
  eq(w.emails[3].subject, 'Appointment booked: Told Home, Fri, Nov 20 at 12:00 PM');
  const count = w.db().notices.length;
  sellOk(w, 'owner', 'Owner Did It', '2026-11-21', '08:00'); w.must('owner', 'moveJob', { jobId: a.jobId, date: '2026-11-19', time: '08:00' });
  w.must('owner', 'bookJob', { clientId: a.clientId, date: '2026-11-22', time: '08:00' }); w.must('owner', 'setJobDone', { jobId: a.jobId }); w.must('owner', 'ackStandards');
  eq([w.db().notices.length, w.emails.length], [count, 4], 'nothing for the owner\'s own work');
  w.must('owner', 'saveSettings', { settings: { emailOnBooking: false } });
  plain(w, 'jake', 'Quiet Sale', 100);
  eq([w.db().notices.length, w.emails.length], [count + 1, 4], 'a notice but no email when emails are off');
  w.emails.forEach((m) => ok(!/[\r\n]/.test(m.subject), 'an email subject has a line break in it'));
});

test('notices and emails write a day, a time and money the way every screen does', () => {
  const w = world({ day: '2026-12-28', time: '09:00' });
  w.must('owner', 'saveSettings', { settings: { notifyEmail: 'boss@ridgeline.example' } });
  w.must('owner', 'setDays', { days: [{ date: '2026-12-30', open: true, slots: ['00:00', '08:05', '12:00', '12:30', '23:59'] }, { date: '2027-01-07', open: true, slots: ['08:00', '13:15'] }] });
  const texts = () => w.db().notices.map((n) => n.text);
  const a = sellOk(w, 'mason', 'Big Job', '2026-12-30', '08:05', { priceCents: 125000, billing: 'monthly' });
  eq(texts(), ['Mason Reed sold House wash to Big Job for $1,250.00 a month. Booked for Wed, Dec 30 at 8:05 AM.'], 'comma after the weekday, "at" before the time, commas in the thousands');
  eq([w.emails[0].subject, w.emails[0].body.split('\n')[0]], ['Appointment booked: Big Job, Wed, Dec 30 at 8:05 AM', 'Mason Reed sold House wash to Big Job for $1,250.00 a month. Booked for Wed, Dec 30 at 8:05 AM.']);
  const times = { '00:00': '12:00 AM', '12:00': '12:00 PM', '12:30': '12:30 PM', '23:59': '11:59 PM' };
  Object.keys(times).forEach((t) => {
    w.must('mason', 'moveJob', { jobId: a.jobId, date: '2026-12-30', time: t });
    eq(texts().slice(-1)[0], 'Mason Reed moved Big Job to Wed, Dec 30 at ' + times[t] + '.');
  });
  /* A day in another year carries the year, like the app's own dates. */
  w.must('mason', 'bookJob', { clientId: a.clientId, date: '2027-01-07', time: '13:15' });
  eq(texts().slice(-1)[0], 'Mason Reed booked Big Job for Thu, Jan 7, 2027 at 1:15 PM.');
  eq(w.emails.slice(-1)[0].subject, 'Appointment booked: Big Job, Thu, Jan 7, 2027 at 1:15 PM');
  w.at('2027-01-02', '09:00'); relog(w);
  w.must('mason', 'moveJob', { jobId: a.jobId, date: '2027-01-07', time: '08:00' });
  eq(texts().slice(-1)[0], 'Mason Reed moved Big Job to Thu, Jan 7 at 8:00 AM.', 'once it is that year, no year');
  /* Money: whole dollars, cents, thousands and millions. */
  [[0, '$0.00'], [5, '$0.05'], [99999, '$999.99'], [100000, '$1,000.00'], [123456789 - 23456789, '$1,000,000.00'], [9876543, '$98,765.43']].forEach((x, i) => {
    plain(w, 'jake', 'Money ' + i, x[0]);
    eq(texts().slice(-1)[0], 'Jake Miller sold Window cleaning to Money ' + i + ' for ' + x[1] + '. No appointment booked yet.');
  });
  w.db().notices.forEach((n) => { lacks(n.text, 'undefined'); ok(!/\b(Sun|Mon|Tue|Wed|Thu|Fri|Sat) (Jan|Dec)/.test(n.text), 'a weekday with no comma after it: ' + n.text); });
});

test('a notice about a client says which client, so the page can open them from it', () => {
  const w = seeded();
  w.must('mason', 'moveJob', { jobId: w.ids.jobA, date: '2026-11-19', time: '08:00' });
  w.must('mason', 'bookJob', { clientId: w.ids.clientA, date: '2026-11-20', time: '08:00' });
  w.at('2026-11-18', '13:00');
  w.must('tess', 'setJobDone', { jobId: w.ids.jobB });
  w.must('cole', 'ackStandards');
  for (let i = 0; i < 20; i++) { if (i % 4 === 0) w.wait(16 * MIN); w.tryLogin('mason', '000000'); }
  const about = w.full('owner').notices.map((n) => [n.type, n.clientId]);
  eq(about, [['booking', w.ids.clientA], ['booking', w.ids.clientB], ['booking', w.ids.clientA], ['booking', w.ids.clientA], ['done', w.ids.clientB], ['standards', undefined], ['signin', undefined]]);
  w.full('owner').notices.forEach((n) => eq(keys(n), n.clientId ? 'at,clientId,id,text,type' : 'at,id,text,type'));
  eq(w.full('mason').notices, [], 'and they still go to the owner only');
});

test('when the email cannot be sent the sale is still saved and the owner sees a problem', () => {
  const w = world();
  w.mailDown = true;
  const r = w.must('mason', 'createSale', { client: { name: 'Mail Down' }, service: 'House wash', priceCents: 100, appointment: { date: '2026-11-18', time: '09:30' } });
  ok(r.result.jobId && w.db().sales.length === 1 && w.db().jobs.length === 1 && w.db().notices.length === 1);
  eq(r.sync.problems, [], 'the rep is not shown the problem');
  const p = w.full('owner').problems;
  eq([p.length, p[0].where, p[0].message], [1, 'email', 'An email alert could not be sent: mail is down']);
  w.must('owner', 'clearProblems'); eq(w.full('owner').problems, []);
});

test('notices are kept to the latest 60 and problems to the latest 30; reading notices is remembered', () => {
  const w = world();
  w.mailDown = true;
  for (let i = 1; i <= 65; i++) { w.wait(1000); plain(w, 'mason', 'Notice ' + i, 100); }
  const n = w.full('owner').notices.sort((a, b) => a.at - b.at), p = w.full('owner').problems;
  eq([n.length, p.length], [60, 30]);
  has(n[0].text, 'Notice 6 '); has(n[59].text, 'Notice 65 ');
  eq(w.full('owner').me.noticesSeenAt, 0);
  w.must('owner', 'readNotices');
  eq(w.full('owner').me.noticesSeenAt, w.t);
  eq(w.full('mason').me.noticesSeenAt, 0);
});

/* ================================================================== */
section('company standards');

function needsToConfirm(s) { return s.me.role !== 'owner' && (s.me.standardsAckAt === 0 || s.me.standardsAckAt < s.settings.standardsUpdatedAt); }
function draft() { return JSON.parse(JSON.stringify(C.DEFAULT_SETTINGS.standards)); }

test('the starting draft is five short sections of plain rules', () => {
  const st = C.DEFAULT_SETTINGS.standards;
  eq(st.map((s) => s.title), ['On every job', 'How we show up', 'Safety first', 'Selling the right way', 'When something goes wrong']);
  eq(st.map((s) => s.ordered), [true, false, false, false, false]);
  eq(st.map((s) => s.id).sort().join(), Array.from(new Set(st.map((s) => s.id))).sort().join(), 'section ids are unique');
  ok(st.length <= C.LIMITS.standardSections);
  st.forEach((s) => {
    ok(s.items.length >= 2 && s.items.length <= C.LIMITS.standardItems && s.title.length <= 60, s.title);
    s.items.forEach((it) => {
      ok(typeof it === 'string' && it.length > 10 && it.length <= C.LIMITS.standardLine && it === it.trim(), 'bad line: ' + it);
      ok(!/[!—–]|[\ud800-\udfff]|\s{2,}/.test(it), 'no exclamation marks, long dashes, emoji or double spaces: ' + it);
      ok(/[.]$/.test(it), 'each rule is a full sentence: ' + it);
    });
  });
  eq(C.DEFAULT_SETTINGS.standardsUpdatedAt, 0);
});

test('everyone receives the same standards, and at first nobody but the owner is done with them', () => {
  const w = world();
  Object.keys(PINS).forEach((who) => {
    const s = w.full(who);
    eq(s.settings.standards, C.DEFAULT_SETTINGS.standards, who); eq(s.settings.standardsUpdatedAt, 0); eq(s.me.standardsAckAt, 0);
    eq(needsToConfirm(s), who !== 'owner', who);
  });
  eq(w.tryLogin('cole', '906132').sync.settings.standards.length, 5, 'they arrive with the sign-in answer too');
});

test('only the owner can change the standards', () => {
  const w = world();
  ['mason', 'jake', 'cole', 'tess'].forEach((who) => {
    w.refuse(who, 'saveSettings', { settings: { standards: [{ id: 'job', title: 'Do what you like', items: ['Anything goes.'] }] } }, 'forbidden');
    w.refuse(who, 'saveSettings', { settings: { standards: [] } }, 'forbidden');
  });
  eq(w.full('cole').settings.standards, C.DEFAULT_SETTINGS.standards); eq(w.full('cole').settings.standardsUpdatedAt, 0);
});

test('the owner\'s edit is saved tidy: trimmed, blank lines dropped, long lines cut, ids kept', () => {
  const w = world(), long = 'L'.repeat(300), many = []; for (let i = 1; i <= 25; i++) many.push('Rule ' + i + '.');
  w.must('owner', 'saveSettings', { settings: { standards: [
    { id: 'job', title: '  On   every job \n', ordered: 1, items: ['  Arrive   on time. ', '', '   ', null, 'Second\trule.\n', long, 42] },
    { title: 'T'.repeat(100), ordered: 'yes', items: many },
    { id: 'x'.repeat(50), title: 'No items', ordered: 0 },
    { id: 'odd', title: 'Odd items', items: 'not a list' }] } });
  const st = w.full('tess').settings.standards;
  eq(st[0], { id: 'job', title: 'On every job', ordered: true, items: ['Arrive on time.', 'Second rule.', 'L'.repeat(240), '42'] });
  eq([st[1].title.length, st[1].ordered, st[1].items.length, st[1].items[19]], [60, true, 20, 'Rule 20.']);
  ok(/^st_[a-zA-Z0-9]+$/.test(st[1].id), 'a section sent without an id is given one');
  eq([st[2].id.length, st[2].ordered, st[2].items, st[3].items], [30, false, [], []]);
  eq(w.full('owner').settings.standardsUpdatedAt, w.t);
});

test('limits: at most 12 sections, every section needs a title, and a bad save changes nothing', () => {
  const w = world(), thirteen = []; for (let i = 0; i < 13; i++) thirteen.push({ id: 's' + i, title: 'Section ' + i, items: ['One rule.'] });
  [thirteen, 'text', 5, null, {}, true, [{ id: 'a', items: ['No title.'] }], [{ id: 'a', title: '   ', items: [] }], [null], ['just text'], [5], [[]],
    [{ id: 'ok', title: 'Fine', items: ['Fine.'] }, { id: 'bad', title: '', items: ['x'] }]].forEach((v) => {
    w.refuse('owner', 'saveSettings', { settings: { firstPct: 1, standards: v } }, 'invalid');
  });
  eq(w.full('owner').settings.standards, C.DEFAULT_SETTINGS.standards);
  w.must('owner', 'saveSettings', { settings: { standards: thirteen.slice(0, 12) } });
  eq(w.full('mason').settings.standards.length, 12);
  w.must('owner', 'saveSettings', { settings: { standards: [] } });
  eq(w.full('mason').settings.standards, [], 'the owner may clear them');
});

test('the "last changed" time moves only when the words really change', () => {
  const w = world();
  const at = () => w.full('owner').settings.standardsUpdatedAt;
  w.wait(HOUR); w.must('owner', 'saveSettings', { settings: { standards: draft() } });
  eq(at(), 0, 'saving the same standards again');
  const spaced = draft(); spaced[0].title = '  On every   job '; spaced[1].items[0] = spaced[1].items[0] + '   '; spaced[2].items.push('', '  '); spaced[0].ordered = 1;
  w.must('owner', 'saveSettings', { settings: { standards: spaced } });
  eq(at(), 0, 'only spaces and blank lines differ');
  w.must('owner', 'saveSettings', { settings: { firstPct: 25, notifyEmail: 'g@ridgeline.example', defaultSlots: ['07:00'] } });
  eq(at(), 0, 'other settings were saved');
  w.wait(HOUR); const edited = draft(); edited[2].items[0] = 'If it is not safe, stop.';
  w.must('owner', 'saveSettings', { settings: { standards: edited } });
  const t1 = w.t; eq(at(), t1, 'one line changed');
  w.wait(HOUR); w.must('owner', 'saveSettings', { settings: { standards: edited } }); w.must('owner', 'saveSettings', { settings: { monthlyPct: 5 } });
  eq(at(), t1, 'same again');
  const moved = JSON.parse(JSON.stringify(edited)); moved[1].items.reverse();
  w.must('owner', 'saveSettings', { settings: { standards: moved } }); eq(at(), w.t, 'the order changed');
  w.wait(HOUR); const flipped = JSON.parse(JSON.stringify(moved)); flipped[1].ordered = true;
  w.must('owner', 'saveSettings', { settings: { standards: flipped } }); eq(at(), w.t, 'a list became numbered');
  w.wait(HOUR); const t2 = at();
  w.refuse('owner', 'saveSettings', { settings: { standards: [{ title: '' }] } }, 'invalid');
  w.must('owner', 'saveSettings', { settings: { standardsUpdatedAt: 0, standards: undefined } });
  eq(at(), t2, 'the time cannot be set by hand');
});

test('"I have read these" is remembered for that person only, and the owner is told', () => {
  const w = world();
  w.wait(5 * MIN);
  const r = w.must('mason', 'ackStandards');
  eq(r.result, { at: w.t }); eq(r.sync.me.standardsAckAt, w.t); eq(needsToConfirm(r.sync), false);
  ['jake', 'cole', 'tess'].forEach((who) => { eq(w.full(who).me.standardsAckAt, 0, who); ok(needsToConfirm(w.full(who))); });
  const o = w.full('owner');
  eq(o.team.map((m) => m.name + ':' + m.standardsAckAt).sort(), ['Cole:0', 'Grayson:0', 'Jake Miller:0', 'Mason Reed:' + w.t, 'Tess Hart:0']);
  const n = o.notices.filter((x) => x.type === 'standards');
  eq([n.length, n[0].text, w.emails.length], [1, 'Mason Reed read the company standards.', 0]);
  w.must('owner', 'ackStandards');
  eq(w.db().notices.length, 1, 'the owner confirming tells nobody');
  ['mason', 'jake', 'cole'].forEach((who) => { w.full(who).team.forEach((m) => ok(!('standardsAckAt' in m), who + ' can see who has confirmed')); });
  const before = byId(w.db().team, w.ids.jake);
  w.must('mason', 'ackStandards', { id: w.ids.jake, memberId: w.ids.jake, at: 1, member: { id: w.ids.jake } });
  eq(byId(w.db().team, w.ids.jake), before, 'nobody can confirm for someone else');
});

test('when the owner changes the standards everyone has to confirm again', () => {
  const w = world();
  ['mason', 'cole'].forEach((who) => w.must(who, 'ackStandards'));
  w.wait(DAY);
  const edited = draft(); edited[0].items.push('Lock the gate behind you.');
  w.must('owner', 'saveSettings', { settings: { standards: edited } });
  ['mason', 'jake', 'cole', 'tess'].forEach((who) => ok(needsToConfirm(w.full(who)), who + ' should need to confirm again'));
  ok(!needsToConfirm(w.full('owner')));
  w.wait(MIN); w.must('cole', 'ackStandards');
  ok(!needsToConfirm(w.full('cole')) && needsToConfirm(w.full('mason')));
  eq(w.full('cole').settings.standards[0].items.slice(-1), ['Lock the gate behind you.']);
  w.wait(MIN); w.must('owner', 'saveSettings', { settings: { standards: edited, firstPct: 31 } });
  ok(!needsToConfirm(w.full('cole')), 'saving them unchanged must not ask people again');
});

/* ================================================================== */
section('hostile input');

const NASTY = ['<script>alert(1)</' + 'script>', '"><img src=x onerror=alert(1)>', "'); DROP TABLE clients;--", '{{7*7}} ${7*7} <%= 7*7 %>', '<b>bold</b> & <i>co</i>', 'javascript:alert(1)',
  '&lt;already&gt; &amp; escaped', '‮reversed text', '%00%0a..\\..\\etc', '=HYPERLINK("http://evil","x")', '😀 中文 é', 'constructor', '__proto__', 'toString', 'null', 'undefined', '0', 'true'];

test('requests that are not requests get a plain refusal', () => {
  const w = world(), before = JSON.stringify(w.store.dump());
  [null, undefined, 'login', 5, true, [], {}, { action: 5 }, { action: null }, { action: ['sync'] }, { action: {} }, { token: w.tokens.owner }, [{ action: 'sync' }]].forEach((req) => {
    const r = w.raw(req);
    eq([r.ok, r.error.code, r.sync], [false, 'invalid', undefined], JSON.stringify(req));
  });
  eq(w.raw({ action: 'ping' }), { ok: true, result: { version: C.VERSION } });
  eq(JSON.stringify(w.store.dump()), before);
});

test('action names borrowed from JavaScript itself do nothing', () => {
  const w = seeded();
  const names = ['constructor', '__proto__', 'prototype', 'toString', 'valueOf', 'hasOwnProperty', 'isPrototypeOf', '__defineGetter__', '__lookupGetter__', 'propertyIsEnumerable', 'toLocaleString',
    'roles', 'run', 'handle', 'bootstrap', 'resetOwnerPin', 'Sync', 'LOGIN', 'sync ', ' sync', 'createSale\u0000', 'deleteEverything', ''];
  names.forEach((a) => {
    eq(w.raw({ action: a }).error.code, 'auth', 'without a token: ' + JSON.stringify(a));
    ['owner', 'mason', 'cole'].forEach((who) => w.refuse(who, a, { id: w.ids.owner, clientId: w.ids.clientA, jobId: w.ids.jobA, pin: '135790', member: { name: 'X', role: 'owner' } }, 'invalid'));
  });
  ok(({}).polluted === undefined);
});

test('ids borrowed from JavaScript itself are just ids that do not exist', () => {
  const w = seeded();
  ['__proto__', 'constructor', 'toString', 'hasOwnProperty', 'valueOf', 'main', 'length', '0', ''].forEach((id) => {
    if (id) w.refuse('owner', 'deleteClient', { clientId: id }, 'not_found');
    w.refuse('owner', 'deleteSale', { saleId: id }, 'not_found');
    w.refuse('owner', 'updateJob', { jobId: id, patch: { what: 'x' } }, 'not_found');
    w.refuse('owner', 'setJobDone', { jobId: id }, 'not_found');
    w.refuse('owner', 'moveJob', { jobId: id, date: '2026-11-19', time: '08:00' }, 'not_found');
    w.refuse('owner', 'removeMember', { id: id }, 'not_found');
    w.refuse('owner', 'resetPin', { id: id }, 'not_found');
    w.refuse('owner', 'addNote', { kind: 'client', id: id, text: 'x' }, 'not_found');
    w.refuse('owner', 'addNote', { kind: 'job', id: id, text: 'x' }, 'not_found');
    if (id) w.refuse('owner', 'bookJob', { clientId: id, date: '2026-11-19', time: '08:00' }, 'not_found');
    if (id) w.refuse('owner', 'createSale', { clientId: id, service: 'House wash', priceCents: 100 }, 'not_found');
    if (id) w.refuse('owner', 'createSale', { client: { name: 'Bad Rep' }, service: 'House wash', priceCents: 100, repId: id }, 'invalid');
    if (id) w.refuse('owner', 'saveMember', { member: { id: id, name: 'Ghost', role: 'rep' } }, 'not_found');
    if (id) w.refuse('owner', 'saveSettings', { settings: { defaultTechId: id } }, 'invalid');
    if (id) w.refuse('owner', 'updateJob', { jobId: w.ids.jobA, patch: { assignedTo: id } }, 'invalid');
  });
});

test('a service, a person or a client may be called "constructor", "__proto__" or "toString"', () => {
  const w = world();
  const odd = ['constructor', '__proto__', 'toString', 'hasOwnProperty', 'valueOf'];
  w.must('owner', 'saveSettings', { settings: { services: odd.map((n) => ({ name: n, priceCents: 100 })) } });
  eq(w.full('mason').settings.services.map((s) => s.name), odd);
  w.refuse('owner', 'saveSettings', { settings: { services: [{ name: 'toString' }, { name: ' TOSTRING ' }] } }, 'invalid');
  odd.forEach((n, i) => {
    const m = w.must('owner', 'saveMember', { member: { name: n, role: 'rep', pin: '7049' + (10 + i) } }).result;
    const li = w.tryLogin(n.toUpperCase(), '7049' + (10 + i));
    ok(li.ok && li.sync.me.id === m.id && li.sync.me.name === n, 'could not sign in as ' + n);
    const s = w.raw({ action: 'createSale', token: li.result.token, client: { name: n, address: n }, service: n, priceCents: 1000, what: n, notes: n });
    ok(s.ok && s.sync.clients[0].name === n && s.sync.sales[0].service === n && byId(s.sync.board, m.id).all.cents === 1000, 'sale as ' + n);
  });
  ok(({}).polluted === undefined && Object.keys(Object.prototype).length === 0);
});

test('the services list: one to twenty, each with a name and a real price, no doubles', () => {
  const w = world(), twentyOne = []; for (let i = 0; i < 21; i++) twentyOne.push({ name: 'Service ' + i });
  [[], twentyOne, 'windows', null, {}, [null], [{}], [{ name: '' }], [{ name: 'A' }, { name: ' a ' }], [{ name: 'A', priceCents: -1 }], [{ name: 'A', priceCents: 9.99 }], [{ name: 'A', priceCents: '5' }], [{ name: 'A', priceCents: NaN }]]
    .forEach((v) => w.refuse('owner', 'saveSettings', { settings: { services: v } }, 'invalid'));
  w.must('owner', 'saveSettings', { settings: { services: [{ id: 'windows', name: '  Window   cleaning ', priceCents: 14900 }, { name: 'Gutter cleaning' }] } });
  const sv = w.full('mason').settings.services;
  eq([sv[0], sv[1].name, sv[1].priceCents], [{ id: 'windows', name: 'Window cleaning', priceCents: 14900 }, 'Gutter cleaning', 0]);
  ok(/^s_[a-zA-Z0-9]+$/.test(sv[1].id));
  w.must('owner', 'saveSettings', { settings: { services: twentyOne.slice(0, 20) } });
});

test('two services, or two sections of the standards, never end up with the same id', () => {
  const w = world();
  const long = 'x'.repeat(30);
  w.must('owner', 'saveSettings', { settings: {
    services: [{ id: 'windows', name: 'Windows' }, { id: 'windows', name: 'Doors' }, { id: ' windows ', name: 'Gutters' }, { id: long + 'A', name: 'Long A' }, { id: long + 'B', name: 'Long B' }, { name: 'No Id' }, { id: '__proto__', name: 'Proto One' }, { id: '__proto__', name: 'Proto Two' }],
    standards: [{ id: 'job', title: 'One', items: ['A rule.'] }, { id: 'job', title: 'Two', items: ['A rule.'] }, { id: 'job', title: 'Three', items: ['A rule.'] }, { id: 'show', title: 'Four' }]
  } });
  const st = w.full('mason').settings, unique = (list) => new Set(list.map((x) => x.id)).size === list.length;
  ok(unique(st.services), 'service ids: ' + st.services.map((s) => s.id).join(', '));
  ok(unique(st.standards), 'section ids: ' + st.standards.map((s) => s.id).join(', '));
  eq([st.services[0].id, st.services[3].id, st.services[6].id, st.standards[0].id, st.standards[3].id], ['windows', long, '__proto__', 'job', 'show'], 'the first to use an id keeps it');
  ok([1, 2, 4, 5, 7].every((i) => /^s_[a-zA-Z0-9]+$/.test(st.services[i].id)) && [1, 2].every((i) => /^st_[a-zA-Z0-9]+$/.test(st.standards[i].id)), 'the others are given fresh ones');
  eq(st.services.map((s) => s.name), ['Windows', 'Doors', 'Gutters', 'Long A', 'Long B', 'No Id', 'Proto One', 'Proto Two'], 'nothing is dropped or reordered');
  /* Sent back exactly as received, the ids stay as they are, so nobody is asked to confirm the standards again. */
  const at = w.full('owner').settings.standardsUpdatedAt;
  w.wait(HOUR);
  w.must('owner', 'saveSettings', { settings: { services: st.services, standards: st.standards } });
  const again = w.full('owner').settings;
  eq([again.services, again.standards, again.standardsUpdatedAt], [st.services, st.standards, at]);
  ok(({}).polluted === undefined && Object.keys(Object.prototype).length === 0);
  checkData(w);
});

test('the owner email and time slots are checked before they are saved', () => {
  const w = world();
  ['not-an-email', 'a@b', 'a b@c.de', '@c.de', 'a@', 'a@@b.co', '<a@b.co>\nBcc: x@y.z'].forEach((e) => w.refuse('owner', 'saveSettings', { settings: { notifyEmail: e } }, 'invalid'));
  w.must('owner', 'saveSettings', { settings: { notifyEmail: '  grayson@ridgeline.example ' } });
  eq(w.full('owner').settings.notifyEmail, 'grayson@ridgeline.example');
  w.must('owner', 'saveSettings', { settings: { notifyEmail: '' } }); eq(w.full('owner').settings.notifyEmail, '');
  [[], ['25:00'], 'all day', null, [null], ['8am']].forEach((s) => eq(w.refuse('owner', 'saveSettings', { settings: { defaultSlots: s } }, 'invalid').error.message, 'Keep at least one time.'));
  w.must('owner', 'saveSettings', { settings: { defaultSlots: ['13:00', '07:30', '07:30', 'x'] } });
  eq(w.full('owner').settings.defaultSlots, ['07:30', '13:00']);
  w.must('owner', 'saveSettings', { settings: { businessName: 'Evil Corp', id: 'other', bogus: 1 } });
  eq([w.full('mason').settings.businessName, w.db().settings.length, w.db().settings[0].id], ['Ridgeline Wash Co.', 1, 'main'], 'unknown settings are ignored');
});

test('HTML, script and other odd text in every text field is stored exactly as typed', () => {
  NASTY.forEach((x, i) => {
    const w = world();
    const cut = (n) => x.slice(0, n);
    const m = w.must('owner', 'saveMember', { member: { name: x, role: 'rep', pin: '919347' } }).result;
    eq(byId(w.full('cole').team, m.id).name, cut(40), 'member name');
    const li = w.tryLogin(x, '919347'); ok(li.ok, 'the person named ' + x + ' can sign in');
    const r = w.raw({ action: 'createSale', token: li.result.token, client: { name: x, contact: x, phone: x, email: x, address: x }, service: x, priceCents: 12345, billing: 'monthly', notes: x, what: x,
      appointment: { date: '2026-11-18', time: '09:30' } });
    ok(r.ok, 'sale refused: ' + JSON.stringify(r.error));
    const c = r.sync.clients[0], s = r.sync.sales[0], j = r.sync.jobs[0];
    eq([c.name, c.contact, c.phone, c.email, c.address, c.service, c.notes[0].text], [x, x, cut(30), x, x, x, x], 'client fields');
    eq([s.service, s.notes, s.clientName, j.what, j.client.name, j.client.address], [x, x, x, x, x, x], 'sale and job fields');
    w.must('owner', 'updateJob', { jobId: j.id, patch: { what: x + ' again', assignedTo: w.ids.cole } });
    w.must('cole', 'addNote', { kind: 'job', id: j.id, text: x });
    w.must('owner', 'addNote', { kind: 'client', id: c.id, text: x });
    w.must('owner', 'updateClient', { clientId: c.id, patch: { name: x + ' 2', contact: x, address: x, service: x } });
    w.must('cole', 'setJobDone', { jobId: j.id });
    w.must('owner', 'saveSettings', { settings: { services: [{ id: x, name: x, priceCents: 1 }], standards: [{ id: x, title: x, items: [x, x + ' two'] }] } });
    const t = w.full('cole'), o = w.full('owner');
    eq([t.jobs[0].what, t.jobs[0].notes[0].text, t.jobs[0].client.name, t.settings.standards[0].title, t.settings.standards[0].items], [x + ' again', x, x + ' 2', x, [x, x + ' two']], 'what the tech receives');
    eq(w.full('mason').settings.services[0].name, x, 'what a rep receives');
    ok(o.notices.some((n) => n.text.indexOf(x) >= 0), 'the notice carries the text as typed');
    ok(w.emails.length >= 1 && w.emails[0].subject.indexOf(x) >= 0 && !/[\r\n]/.test(w.emails[0].subject), 'the email subject');
    eq(o.problems, [], 'case ' + i + ' recorded a problem');
    lacks(JSON.stringify(w.store.dump()), '&lt;script', 'something escaped the text before storing it');
  });
});

/* Every value a careless or hostile phone could put in a field. */
const JUNK = [undefined, null, true, false, 0, -1, 1.5, 42, NaN, Infinity, -Infinity, 1e308, '', ' ', '\n', 'x', '0', '-1', 'null', 'undefined', '__proto__', 'constructor', 'toString',
  '2026-11-18', '09:30', 'x'.repeat(100000), '\u0000\u0001\u0002', '<img src=x onerror=alert(1)>', [], [null], [[]], ['a', 'b'], [{}], {}, { a: 1 }, { length: 3 }, { toString: 1 }, { toString: null, valueOf: null },
  { valueOf: 1 }, JSON.parse('{"__proto__":{"polluted":true}}'), JSON.parse('{"constructor":{"prototype":{"polluted":true}}}'), JSON.parse('{"id":"__proto__","name":"__proto__"}')];

function pathsOf(o, prefix, out) {
  Object.keys(o).forEach((k) => {
    const p = prefix.concat([k]);
    out.push(p);
    if (o[k] && typeof o[k] === 'object') pathsOf(o[k], p, out);
  });
  return out;
}
function setPath(o, p, v) { let cur = o; for (let i = 0; i < p.length - 1; i++) cur = cur[p[i]]; cur[p[p.length - 1]] = v; }
function describe(v) { try { const s = JSON.stringify(v); return typeof v === 'number' || v === undefined ? String(v) : short(s).slice(0, 60); } catch (e) { return String(v); } }

function hostileCases(w) {
  const std = [{ id: 'job', title: 'On every job', ordered: true, items: ['Arrive on time.', 'Take photos.'] }];
  return [
    ['login', null, { name: 'Grayson', pin: '482913' }],
    ['sync', 'mason', { since: w.rev(), day: w.today() }],
    ['changePin', 'mason', { oldPin: '271845', newPin: '432187' }],
    ['ackStandards', 'cole', {}],
    ['logout', 'tess', {}],
    ['addNote', 'mason', { kind: 'client', id: w.ids.clientA, text: 'a note' }],
    ['addNote', 'cole', { kind: 'job', id: w.ids.jobA, text: 'a note' }],
    ['createSale', 'owner', { client: { name: 'N', contact: 'C', phone: 'P', email: 'E', address: 'A' }, service: 'House wash', priceCents: 5000, billing: 'monthly', notes: 'n', what: 'w',
      stripeLink: 'https://pay.example/x', appointment: { date: '2026-11-19', time: '08:00' }, repId: w.ids.mason }],
    ['createSale', 'mason', { clientId: w.ids.clientA, service: 'House wash', priceCents: 5000, billing: 'once', appointment: { date: '2026-11-19', time: '09:30' } }],
    ['bookJob', 'mason', { clientId: w.ids.clientA, date: '2026-11-19', time: '12:00', what: 'w', saleId: w.ids.saleA }],
    ['moveJob', 'mason', { jobId: w.ids.jobA, date: '2026-11-19', time: '14:00' }],
    ['setJobDone', 'cole', { jobId: w.ids.jobA, done: true }],
    ['updateClient', 'owner', { clientId: w.ids.clientA, patch: { name: 'N', contact: 'C', phone: 'P', email: 'E', address: 'A', service: 'S', priceCents: 100, billing: 'once', startDate: '2026-11-20',
      stripeLink: 'https://pay.example/y', payStatus: 'paid', status: 'Paused', repId: w.ids.jake } }],
    ['updateClient', 'mason', { clientId: w.ids.clientA, patch: { name: 'N', phone: 'P' } }],
    ['updateJob', 'owner', { jobId: w.ids.jobA, patch: { assignedTo: w.ids.tess, what: 'w', status: 'cancelled' } }],
    ['deleteClient', 'owner', { clientId: w.ids.clientB }],
    ['deleteSale', 'owner', { saleId: w.ids.saleB }],
    ['updateSale', 'owner', { saleId: w.ids.saleA, patch: { priceCents: 12000, service: 'House wash', repId: w.ids.jake, billing: 'monthly' } }],
    ['saveMember', 'owner', { member: { name: 'New Person', role: 'tech', pin: '565247' } }],
    ['saveMember', 'owner', { member: { id: w.ids.jake, name: 'Jake M', role: 'tech' } }],
    ['removeMember', 'owner', { id: w.ids.jake }],
    ['resetPin', 'owner', { id: w.ids.jake, pin: '565247' }],
    ['saveSettings', 'owner', { settings: { services: [{ id: 'windows', name: 'Window cleaning', priceCents: 100 }], firstPct: 30, monthlyPct: 10, defaultSlots: ['08:00', '10:00'],
      defaultTechId: w.ids.cole, notifyEmail: 'g@ridgeline.example', emailOnBooking: true, standards: std } }],
    ['setDays', 'owner', { days: [{ date: '2026-12-01', open: true, slots: ['08:00', '10:00'] }, { date: '2026-12-02', open: false }] }],
    ['readNotices', 'owner', {}],
    ['clearProblems', 'owner', {}]
  ];
}

/* Things that must be true of the stored data after anything at all has happened. */
function checkData(w, snapshot) {
  const db = snapshot || w.db(), team = {}, clients = {}, sales = {}, jobs = {}, slot = {}, running = {};
  db.team.forEach((m) => { team[m.id] = m; }); db.clients.forEach((c) => { clients[c.id] = c; });
  db.sales.forEach((s) => { sales[s.id] = s; }); db.jobs.forEach((j) => { jobs[j.id] = j; });
  ok(db.team.some((m) => m.active && m.role === 'owner'), 'no owner is left');
  const names = new Set();
  db.team.forEach((m) => {
    ok(C.ROLES.indexOf(m.role) >= 0 && typeof m.name === 'string' && m.name.length >= 1 && m.name.length <= 40, 'bad team member ' + JSON.stringify(m.name));
    if (m.active) { const k = m.name.replace(/\s+/g, ' ').trim().toLowerCase(); ok(!names.has(k), 'two active people called ' + k); names.add(k); }
  });
  db.jobs.forEach((j) => {
    ok(C.dates.isDay(j.date) && C.dates.isHM(j.time), 'a job has a bad day or time: ' + j.date + ' ' + j.time);
    ok(['scheduled', 'done', 'cancelled'].indexOf(j.status) >= 0, 'a job has status ' + j.status);
    ok(clients[j.clientId], 'a job has no client');
    if (j.status !== 'cancelled') { const k = j.date + ' ' + j.time; ok(!slot[k], 'two live jobs at ' + k); slot[k] = 1; }
    if (j.saleId) ok(sales[j.saleId] && sales[j.saleId].jobId === j.id, 'a job points at a sale that does not point back');
    if (j.assignedTo) ok(team[j.assignedTo], 'a job is assigned to nobody we know');
    if (j.status === 'scheduled') {
      ok(j.doneAt === null && j.doneBy === null, 'a scheduled job says it was done');
      if (j.assignedTo) ok(team[j.assignedTo].active, 'a scheduled job is assigned to someone who is gone');
      if (j.assignedTo) ok(team[j.assignedTo].role !== 'rep', 'a scheduled job is assigned to a sales rep, who cannot see or finish it');
    }
    if (j.status === 'done') ok(j.doneAt > 0 && team[j.doneBy], 'a finished job does not say who finished it');
    ok(typeof j.what === 'string' && j.what.length >= 1 && j.what.length <= 160 && Array.isArray(j.notes) && j.notes.length <= 50, 'bad job text');
  });
  db.sales.forEach((s) => {
    ok(clients[s.clientId] && team[s.repId] && team[s.repId].role !== undefined, 'a sale has no client or rep');
    ok(Number.isInteger(s.priceCents) && s.priceCents >= 0 && s.priceCents <= 100000000, 'a sale has price ' + s.priceCents);
    ok(C.BILLING.indexOf(s.billing) >= 0 && C.dates.isDay(s.day) && s.service.length >= 1 && s.service.length <= 60, 'bad sale fields');
    ok(typeof s.firstPct === 'number' && s.firstPct >= 0 && s.firstPct <= 100 && typeof s.monthlyPct === 'number' && s.monthlyPct >= 0 && s.monthlyPct <= 100, 'bad sale rates');
    if (s.jobId) ok(jobs[s.jobId] && jobs[s.jobId].saleId === s.id, 'a sale points at a job that does not point back');
    if (s.endDay !== undefined) ok(s.billing === 'monthly' && C.dates.isDay(s.endDay) && s.endDay >= s.day, 'a sale has a bad end day: ' + s.endDay);
    if (s.endedBy !== undefined) ok(s.endDay !== undefined && sales[s.endedBy] && sales[s.endedBy].clientId === s.clientId && sales[s.endedBy].billing === 'monthly', 'a sale was ended by a sale that is not there');
    if (s.billing === 'monthly' && s.endDay === undefined) {
      ok(!running[s.clientId], 'a client has two monthly plans paying at once');
      ok(clients[s.clientId].status !== 'Cancelled', 'a cancelled client still has a monthly plan paying');
      running[s.clientId] = 1;
    }
  });
  db.clients.forEach((c) => {
    ok(C.CLIENT_STATUSES.indexOf(c.status) >= 0 && c.statusLog.length >= 1 && c.statusLog[c.statusLog.length - 1].status === c.status, 'client status and its log disagree');
    ok(c.statusLog.every((x, i) => C.dates.isDay(x.day) && (i === 0 || c.statusLog[i - 1].day <= x.day)), 'the status log is out of order');
    ok(team[c.repId] && typeof c.name === 'string' && c.name.length >= 1 && c.name.length <= 60, 'bad client name or rep');
    ok(Number.isInteger(c.priceCents) && c.priceCents >= 0 && C.BILLING.indexOf(c.billing) >= 0 && C.PAY_STATUSES.indexOf(c.payStatus) >= 0 && C.dates.isDay(c.startDate), 'bad client fields');
    ok(c.stripeLink === '' || /^https:\/\/\S+$/i.test(c.stripeLink), 'bad payment link ' + c.stripeLink);
    ok(Array.isArray(c.notes) && c.notes.length <= 50 && c.notes.every((n) => typeof n.text === 'string' && n.text.length <= 500), 'bad client notes');
  });
  db.days.forEach((d) => ok(C.dates.isDay(d.id) && typeof d.open === 'boolean' && Array.isArray(d.slots) && d.slots.every(C.dates.isHM) && d.slots.length <= 24 && (!d.open || d.slots.length > 0), 'bad day ' + JSON.stringify(d)));
  const st = db.settings.filter((s) => s.id === 'main')[0];
  eq(db.settings.length, 1, 'settings documents');
  ok(st.services.length >= 1 && st.services.length <= 20 && st.services.every((s) => s.name && Number.isInteger(s.priceCents) && s.priceCents >= 0), 'bad services');
  ok(st.firstPct >= 0 && st.firstPct <= 100 && st.monthlyPct >= 0 && st.monthlyPct <= 100 && st.defaultSlots.length >= 1 && st.defaultSlots.every(C.dates.isHM), 'bad rates or slots');
  ok(st.defaultTechId === null || (team[st.defaultTechId] && team[st.defaultTechId].active), 'the default tech is gone');
  ok(st.defaultTechId === null || team[st.defaultTechId].role !== 'rep', 'new jobs are set to go to a sales rep');
  ok(new Set(st.services.map((x) => x.id)).size === st.services.length && new Set(st.standards.map((x) => x.id)).size === st.standards.length, 'two services or two sections share an id');
  ok(typeof st.emailOnBooking === 'boolean' && typeof st.notifyEmail === 'string' && typeof st.standardsUpdatedAt === 'number', 'bad settings types');
  ok(Array.isArray(st.standards) && st.standards.length <= 12 && st.standards.every((s) => s.id && s.title && s.title.length <= 60 && typeof s.ordered === 'boolean' &&
    s.items.length <= 20 && s.items.every((it) => typeof it === 'string' && it.length >= 1 && it.length <= 240)), 'bad standards');
  ok(db.notices.length <= 60 && db.problems.length <= 30, 'notices or problems were not trimmed');
  db.sessions.forEach((s) => ok(team[s.memberId], 'a session belongs to nobody we know'));   /* a removed person's stay, so their phone can be told why */
  Object.keys(db).forEach((coll) => db[coll].forEach((d) => ok(JSON.stringify(d).length < 50000, 'a record in ' + coll + ' is too big for one cell of the sheet')));
}

/* What a full answer may contain for the person it is for. */
function checkView(s) {
  if (!s || s.same) return;
  const mine = {};
  if (s.me.role !== 'owner') {
    eq([s.notices, s.problems], [[], []], 'owner-only lists');
    eq(keys(s.settings), s.me.role === 'tech' ? 'businessName,standards,standardsUpdatedAt' : 'businessName,firstPct,monthlyPct,services,standards,standardsUpdatedAt');
    s.team.forEach((m) => eq(keys(m), 'active,id,name,role'));
  }
  if (s.me.role === 'rep') {
    s.clients.forEach((c) => { ok(c.repId === s.me.id, 'a rep received someone else\'s client'); mine[c.id] = 1; });
    s.sales.forEach((x) => ok(x.repId === s.me.id, 'a rep received someone else\'s sale'));
    s.jobs.forEach((j) => ok(mine[j.clientId], 'a rep received a job for someone else\'s client'));
  }
  if (s.me.role === 'tech') {
    eq([s.clients, s.sales, s.days, s.taken, s.board], [[], [], [], [], []], 'a tech received more than jobs');
    s.jobs.forEach((j) => ok(j.assignedTo === s.me.id && j.status !== 'cancelled', 'a tech received a job that is not theirs'));
    s.jobs.forEach((j) => ok(j.status === 'scheduled' || j.date >= C.dates.addDays(s.today, -30), 'a tech received a finished job from more than 30 days ago: ' + j.date));
  }
  s.taken.forEach((t) => ok(t.date >= s.today && keys(t) === 'date,time', 'bad taken entry'));
  s.sales.forEach((x) => ok(x.events.length >= 1 && x.events[0].kind === 'first' && x.events.every((e) => Number.isInteger(e.cents) && e.cents >= 0 && e.day <= s.today), 'bad commission events'));
}

test('junk of every type in every field of every action: never a crash, never a server error, never bad data', () => {
  const base = seeded(), bad = [];
  let tried = 0;
  hostileCases(base).forEach((hc) => {
    const action = hc[0], who = hc[1], good = hc[2];
    const tmpl = Object.assign({ action: action, opId: 'hostile-op-0001' }, who ? { token: base.tokens[who], since: base.rev(), day: base.today() } : {}, good);
    { const w = base.fork(); const r = w.raw(JSON.parse(JSON.stringify(tmpl))); if (!r.ok) bad.push(action + ' as ' + who + ': the untouched request was refused (' + r.error.code + ')'); }
    pathsOf(tmpl, [], []).forEach((p) => {
      if (p.length === 1 && p[0] === 'action') return;
      JUNK.forEach((junk) => {
        const w = base.fork(), req = JSON.parse(JSON.stringify(tmpl));
        setPath(req, p, junk);
        tried++;
        try {
          const r = w.raw(req);
          if (!r.ok && r.error.code === 'server') throw new Error('server error');
          if (w.db().problems.length) throw new Error('recorded a problem: ' + w.db().problems[0].message);
          if (({}).polluted !== undefined) throw new Error('polluted Object.prototype');
          checkData(w); checkView(r.sync);
        } catch (e) { bad.push(action + (who ? ' as ' + who : '') + ' with ' + p.join('.') + ' = ' + describe(junk) + ' -> ' + e.message); delete Object.prototype.polluted; }
      });
    });
  });
  ok(tried > 4000, 'only ' + tried + ' cases ran');
  if (process.env.SHOW_ALL) bad.forEach((b) => console.log('      ' + b));
  ok(bad.length === 0, bad.length + ' of ' + tried + ' cases went wrong, for example: ' + bad.slice(0, 4).join(' | '));
});

test('a stranger sending junk to sign-in cannot write to the owner\'s problem list or stir the data', () => {
  const w = world(), before = JSON.stringify(w.store.dump());
  JUNK.forEach((j) => {
    [w.raw({ action: 'login', name: j, pin: '482913' }), w.raw({ action: 'login', name: 'Grayson', pin: j }), w.raw({ action: 'login', name: j, pin: j })].forEach((r) => {
      ok(!r.ok && (r.error.code === 'auth' || r.error.code === 'locked'), 'sign-in with ' + describe(j) + ' answered ' + r.error.code);
    });
  });
  eq(JSON.stringify(w.store.dump()), before);
});

test('everything huge at once is handled and stored cut down', () => {
  const w = seeded(), big = 'Z'.repeat(300000);
  const list = []; for (let i = 0; i < 5000; i++) list.push(big.slice(0, 50));
  w.must('mason', 'createSale', { client: { name: big, contact: big, phone: big, email: big, address: big, extra: big }, service: big, priceCents: 1, notes: big, what: big, extra: list });
  w.refuse('mason', 'createSale', { client: { name: big }, service: big, priceCents: 1, stripeLink: 'https://pay.example/a b' + big }, 'invalid');
  w.refuse('owner', 'saveSettings', { settings: { standards: list.map((x) => ({ title: x })) } }, 'invalid');
  w.must('owner', 'saveSettings', { settings: { standards: [{ title: big, items: list }] } });
  w.refuse('owner', 'setDays', { days: list.map(() => ({ date: '2026-12-01', open: true })) }, 'invalid');
  w.must('owner', 'setDays', { days: [{ date: '2026-12-01', open: true, slots: list }] });
  eq(w.raw({ action: 'sync', token: big }).error.code, 'auth');
  eq(w.tryLogin(big, big).error.code, 'auth');
  ok(JSON.stringify(w.store.dump()).length < 60000, 'the stored data ballooned');
  checkData(w);
});

/* ================================================================== */
section('records that would outgrow a cell');

/* A record is one cell of the Google Sheet (50,000 characters at most). The core refuses, in plain words, at 45,000. */
const CEILING = C.LIMITS.docChars;
const size = (doc) => JSON.stringify(doc).length;
const QUOTES = '"'.repeat(500);   /* 500 characters to type, 1,000 once it is JSON */

/* Puts a record straight into the store, grown to exactly `chars` characters of JSON: with notes
   where the record has notes (never more than 50, never longer than 500), or else with a field
   somebody added by hand in the sheet. */
function grown(w, coll, id, chars) {
  const doc = byId(w.db()[coll], id);
  if (coll === 'team') { doc.memo = ''; doc.memo = 'p'.repeat(chars - size(doc)); }
  else {
    const note = (text) => ({ at: w.t, by: w.ids.owner, text: text });
    doc.notes = [];
    while (chars - size(doc) > 2200) doc.notes.push(note(QUOTES));
    while (chars - size(doc) > 540) doc.notes.push(note('p'.repeat(400)));
    const last = note('');
    doc.notes.push(last);
    last.text = 'p'.repeat(chars - size(doc));
    ok(doc.notes.length < 50 && last.text.length <= 500, 'the test could not build its record');
  }
  eq(size(doc), chars);
  w.store.put(coll, doc);
  return doc;
}

test('the limits really could outgrow a cell: this is what the guard is for', () => {
  const fullStandards = []; for (let s = 0; s < 12; s++) { const items = []; for (let i = 0; i < 20; i++) items.push('L'.repeat(240)); fullStandards.push({ id: 's' + s, title: 'Section ' + s, items: items }); }
  ok(size(fullStandards) > 50000, 'twelve full sections are ' + size(fullStandards) + ' characters');
  ok(50 * size({ at: 1795000000000, by: 'm_0123456789abcd', text: QUOTES }) > 50000, 'and so are fifty notes full of quote marks');
  ok(CEILING === 45000 && CEILING < 50000);
});

test('company standards too long for one cell are refused in plain words, and nothing is saved', () => {
  const w = world();
  const sections = (n, len) => { const out = []; for (let s = 0; s < n; s++) { const items = []; for (let i = 0; i < 20; i++) items.push('L'.repeat(len)); out.push({ id: 's' + s, title: 'Section ' + s, items: items }); } return out; };
  const r = w.refuse('owner', 'saveSettings', { settings: { firstPct: 12, standards: sections(12, 240) } }, 'invalid');
  eq(r.error.message, 'The company standards are too long to save. Shorten a few lines or remove a section, then try again.');
  eq([r.sync.settings.standards, r.sync.settings.firstPct], [C.DEFAULT_SETTINGS.standards, 30], 'the answer shows the standards as they still are');
  w.refuse('owner', 'saveSettings', { settings: { standards: sections(10, 240) } }, 'invalid');   /* 48,000 and more: under the cell, over the ceiling */
  w.must('owner', 'saveSettings', { settings: { standards: sections(12, 170) } });
  const saved = byId(w.db().settings, 'main');
  ok(size(saved) <= CEILING && saved.standards.length === 12 && w.full('cole').settings.standards[11].items.length === 20, 'a long but reasonable set is saved whole');
  /* With the standards nearly full, a longer services list is refused too, and a shorter set of standards makes room. */
  w.must('owner', 'saveSettings', { settings: { standards: sections(9, 240) } });
  const many = []; for (let i = 0; i < 20; i++) many.push({ name: 'A fairly long service name number ' + i, priceCents: 100 });
  const nearly = size(byId(w.db().settings, 'main'));
  ok(nearly <= CEILING && nearly > CEILING - 1500, 'the settings are ' + nearly + ' characters');
  w.refuse('owner', 'saveSettings', { settings: { services: many } }, 'invalid');
  w.must('owner', 'saveSettings', { settings: { services: many, standards: sections(9, 200) } });
  checkData(w);
});

test('notes full of quote marks stop being accepted before the client would outgrow its cell', () => {
  const w = seeded();
  let saved = 0, refused = null;
  for (let i = 0; i < 50 && !refused; i++) {
    const r = w.call('mason', 'addNote', { kind: 'client', id: w.ids.clientA, text: QUOTES });
    if (r.ok) saved++; else refused = r;
  }
  ok(refused && saved >= 35 && saved < 49, 'saved ' + saved + ' notes');
  eq([refused.error.code, refused.error.message], ['invalid', 'There is no room left in this client\'s notes. Shorten the note and try again.']);
  const before = byId(w.db().clients, w.ids.clientA);
  ok(size(before) <= CEILING && before.notes.length === saved + 2, 'the record stops at ' + size(before) + ' characters');
  w.refuse('mason', 'addNote', { kind: 'client', id: w.ids.clientA, text: QUOTES }, 'invalid');
  eq(byId(w.db().clients, w.ids.clientA), before, 'a refused note changes nothing');
  ok(w.must('jake', 'addNote', { kind: 'client', id: w.ids.clientB, text: QUOTES }).ok, 'other clients are not affected');
  /* Exactly the room that is left is still fine; one character more is not. */
  const b = grown(w, 'clients', w.ids.clientB, CEILING - 100);
  const room = CEILING - size(b) - size({ at: w.t, by: w.ids.jake, text: '' }) - 1;
  ok(room >= 1 && room <= 100, 'room for ' + room);
  w.refuse('jake', 'addNote', { kind: 'client', id: w.ids.clientB, text: 'p'.repeat(room + 1) }, 'invalid');
  w.must('jake', 'addNote', { kind: 'client', id: w.ids.clientB, text: 'p'.repeat(room) });
  eq(size(byId(w.db().clients, w.ids.clientB)), CEILING);
  w.refuse('jake', 'addNote', { kind: 'client', id: w.ids.clientB, text: 'x' }, 'invalid');
  w.db().clients.concat(w.db().jobs).forEach((d) => ok(size(d) <= CEILING));
  checkData(w);
});

test('a sale note, a job note and a job description are refused the same way, and nothing of the request is saved', () => {
  const w = seeded();
  grown(w, 'clients', w.ids.clientA, CEILING - 100);
  const sale = { clientId: w.ids.clientA, service: 'Window cleaning', priceCents: 15000, billing: 'monthly', appointment: { date: '2026-11-19', time: '08:00' } };
  const r = w.refuse('mason', 'createSale', Object.assign({ notes: 'Wants the back windows done as well this time.' }, sale), 'invalid');
  eq(r.error.message, 'There is no room left in this client\'s notes. Shorten the note on this sale and try again.');
  eq([w.db().sales.length, w.db().jobs.length, w.full('jake').taken.some((t) => t.date === '2026-11-19' && t.time === '08:00')], [2, 2, false], 'no sale, no visit, and the time is still free');
  eq(byId(w.db().sales, w.ids.saleA).endDay, undefined, 'and the plan they already had was not ended');
  ok(w.must('mason', 'createSale', Object.assign({ notes: 'Short.' }, sale)).result.jobId, 'with a shorter note the sale goes through');

  grown(w, 'jobs', w.ids.jobA, CEILING - 30);
  const n = w.refuse('cole', 'addNote', { kind: 'job', id: w.ids.jobA, text: 'The gate was locked so I could not reach the back.' }, 'invalid');
  eq(n.error.message, 'There is no room left in this job\'s notes. Shorten the note and try again.');
  const u = w.refuse('owner', 'updateJob', { jobId: w.ids.jobA, patch: { assignedTo: w.ids.tess, what: 'Windows inside and out, plus the two skylights over the kitchen' } }, 'invalid');
  eq(u.error.message, 'There is no room to save more on this job. Shorten what needs to be done, then try again.');
  w.must('owner', 'updateJob', { jobId: w.ids.jobA, patch: { assignedTo: w.ids.tess, what: 'Windows' } });
  w.must('tess', 'setJobDone', { jobId: w.ids.jobA });
  w.db().clients.concat(w.db().jobs).forEach((d) => ok(size(d) < 50000, 'a record got past the cell limit'));
});

test('an edit that would push a full client record over is refused whole; shortening something makes room', () => {
  const w = seeded();
  const full = grown(w, 'clients', w.ids.clientA, CEILING);
  w.must('owner', 'updateClient', { clientId: w.ids.clientA, patch: { phone: '615-555-0009' } });   /* the same length: still fits */
  eq(size(byId(w.db().clients, w.ids.clientA)), CEILING);
  [[{ address: full.address + ', Apt 2' }, 'owner'], [{ name: full.name + 's' }, 'mason'], [{ status: 'Cancelled' }, 'owner'], [{ status: 'Paused', phone: '1' }, 'owner'], [{ repId: w.ids.jake, email: 'a-much-longer-address@alpha.example' }, 'owner']]
    .forEach((x) => {
      const r = w.refuse(x[1], 'updateClient', { clientId: w.ids.clientA, patch: x[0] }, 'invalid');
      eq(r.error.message, 'There is no room to save more on this client. Shorten the name, the address or another detail, then try again.');
    });
  eq(byId(w.db().sales, w.ids.saleA).endDay, undefined, 'a refused cancel ends no monthly pay');
  w.refuse('mason', 'createSale', { clientId: w.ids.clientA, service: 'Window cleaning and screens', priceCents: 15000 }, 'invalid');
  w.must('owner', 'updateClient', { clientId: w.ids.clientA, patch: { contact: '', email: '', address: '', status: 'Cancelled' } });   /* 49 characters shorter makes room for the 48 a cancel adds */
  const now = byId(w.db().clients, w.ids.clientA);
  ok(now.status === 'Cancelled' && size(now) === CEILING - 1, 'the record is now ' + size(now) + ' characters');
  eq(byId(w.db().sales, w.ids.saleA).endDay, '2026-11-17');
});

test('on a client whose record is full, a fix to a sale that needs more room is refused whole, and removing a sale always goes through', () => {
  const w = seeded();
  const extra = w.must('mason', 'createSale', { clientId: w.ids.clientA, service: 'Gutters', priceCents: 100, billing: 'once' }).result;
  grown(w, 'clients', w.ids.clientA, CEILING);
  const sale = byId(w.db().sales, extra.saleId);
  const r = w.refuse('owner', 'updateSale', { saleId: extra.saleId, patch: { priceCents: 12345, service: 'Gutter cleaning and downspouts, front and back' } }, 'invalid');
  eq(r.error.message, 'There is no room to save more on this client. Shorten the name, the address or another detail, then try again.');
  eq(byId(w.db().sales, extra.saleId), sale, 'the sale was not half fixed');
  w.must('owner', 'updateSale', { saleId: extra.saleId, patch: { priceCents: 200, service: 'Gutter' } });   /* no longer than before: fits */
  eq([byId(w.db().clients, w.ids.clientA).service, byId(w.db().clients, w.ids.clientA).priceCents], ['Gutter', 200]);
  /* An older sale's fix never touches the client, so it has all the room it needs. */
  w.must('owner', 'updateSale', { saleId: w.ids.saleA, patch: { service: 'Window cleaning, inside and out, every single pane of it' } });
  /* Removing the newest sale puts the longer service and price back. That is never refused: the sale must go. */
  w.must('owner', 'deleteSale', { saleId: extra.saleId });
  const c = byId(w.db().clients, w.ids.clientA);
  eq([c.service, c.priceCents, c.billing], ['Window cleaning, inside and out, every single pane of it', 15000, 'monthly']);
  ok(size(c) > CEILING && size(c) < 50000, 'the client is ' + size(c) + ' characters: over the usual limit by a little, and well inside what one cell holds');
  eq(byId(w.db().sales, extra.saleId), null);
});

test('a team record somebody padded by hand in the sheet cannot be pushed over by a longer name', () => {
  const w = world();
  grown(w, 'team', w.ids.mason, CEILING);
  const r = w.refuse('owner', 'saveMember', { member: { id: w.ids.mason, name: 'Mason Reed Junior', role: 'rep' } }, 'invalid');
  eq(r.error.message, 'That name is too long to save. Shorten it and try again.');
  w.must('owner', 'saveMember', { member: { id: w.ids.mason, name: 'Mason Rees', role: 'rep' } });
  eq(byId(w.db().team, w.ids.mason).name, 'Mason Rees');
  ok(w.must('owner', 'saveMember', { member: { name: 'N'.repeat(40), role: 'tech' } }).result.pin, 'an ordinary new person is nowhere near the limit');
});

/* ================================================================== */
section('sync fast path');

test('same rev and same day: rev, today, same and the system\'s clock, and nothing else', () => {
  const w = seeded();
  Object.keys(PINS).forEach((who) => {
    const full = w.full(who);
    const r = w.must(who, 'sync', { since: full.rev, day: full.today });
    eq(r, { ok: true, result: {}, sync: { rev: full.rev, today: '2026-11-17', same: true, nowMs: chi('2026-11-17', '09:00'), nowHM: '09:00' } }, who);
  });
});

test('anything other than the exact rev and day gets the full snapshot', () => {
  const w = seeded(), rev = w.rev(), day = w.today();
  [[rev - 1, day], [rev + 1, day], [0, day], [String(rev), day], [null, day], [undefined, day], [rev, '2026-11-16'], [rev, '2026-11-18'], [rev, null], [rev, undefined], [rev, ''], [[rev], day], [NaN, day]]
    .forEach((x) => { const s = w.must('mason', 'sync', { since: x[0], day: x[1] }).sync; ok(s.same === false && s.clients.length === 1 && s.rev === rev, 'since ' + describe(x[0]) + ' day ' + describe(x[1])); });
});

test('a new day in Chicago gives the full snapshot even when nothing was saved', () => {
  const w = seeded(), rev = w.rev();
  w.at('2026-11-17', '23:59');
  eq(w.must('mason', 'sync', { since: rev, day: '2026-11-17' }).sync.same, true, 'one minute before midnight');
  w.at('2026-11-18', '00:00');
  const s = w.must('mason', 'sync', { since: rev, day: '2026-11-17' }).sync;
  eq([s.same, s.today, s.rev], [false, '2026-11-18', rev]);
  eq(w.must('mason', 'sync', { since: rev, day: '2026-11-18' }).sync.same, true);
  w.at('2026-12-17', '08:00');
  const later = w.must('mason', 'sync', { since: rev, day: '2026-11-18' }).sync;
  eq([later.same, later.sales[0].events.length, later.taken], [false, 2, []], 'the new day brings the month\'s commission and drops old slots');
});

test('within one day and one rev the full snapshot never differs except for the clock, so "same" is always true', () => {
  const w = seeded();
  const texts = {};
  ['00:01', '08:00', '09:31', '12:00', '23:59'].forEach((time) => {
    w.at('2026-11-18', time);
    Object.keys(PINS).forEach((who) => {
      const full = w.full(who);
      eq([full.nowHM, full.nowMs], [time, chi('2026-11-18', time)], who + ' at ' + time);
      const t = JSON.stringify(Object.assign({}, full, { nowMs: 0, nowHM: '' }));
      if (texts[who] === undefined) texts[who] = t; else ok(texts[who] === t, who + ' at ' + time + ' got a different snapshot with the same rev and day');
    });
  });
});

test('every save moves the rev by one or more and answers with the full snapshot; nothing else moves it', () => {
  const base = seeded(), reqs = sampleRequests(base);
  Object.keys(reqs).forEach((a) => {
    const w = base.fork(), rev = w.rev();
    const r = w.must('owner', a, Object.assign({ since: rev, day: w.today() }, reqs[a]));
    ok(w.rev() > rev && r.sync.same === false && r.sync.rev === w.rev(), a);
    eq(w.must('mason', 'sync', { since: rev, day: w.today() }).sync.same, false, 'other people get the news after ' + a);
  });
  const w = base.fork(), rev = w.rev(), same = { since: rev, day: w.today() };
  w.tryLogin('mason', '271845'); w.tryLogin('mason', '000000'); w.tryLogin('nobody', '000000');
  w.call('mason', 'sync', same); w.call('mason', 'dumpEverything', same);
  const short = (n) => ({ rev: n, today: w.today(), same: true, nowMs: w.t, nowHM: '09:00' });
  eq(w.refuse('mason', 'saveSettings', Object.assign({ settings: { firstPct: 1 } }, same), 'forbidden').sync, short(rev), 'a refusal with nothing new says so');
  eq(w.refuse('jake', 'addNote', Object.assign({ kind: 'client', id: w.ids.clientA, text: 'x' }, same), 'forbidden').sync.same, true);
  eq(w.refuse('mason', 'createSale', Object.assign({ client: { name: 'X' }, service: 'Y', priceCents: 1, appointment: { date: '2026-11-18', time: '09:30' } }, same), 'slot_taken').sync.same, true);
  eq(w.rev(), rev);
  const op = Object.assign({ kind: 'client', id: w.ids.clientA, text: 'once', opId: 'fast-op-0001' }, same);
  const first = w.must('mason', 'addNote', op), again = w.must('mason', 'addNote', Object.assign({}, op, { since: first.sync.rev }));
  eq([first.sync.same, w.rev(), again.replay, again.sync], [false, rev + 1, true, short(rev + 1)], 'a replay moves nothing');
  const changed = w.refuse('mason', 'addNote', Object.assign({}, op, { text: 'twice', since: rev + 1 }), 'already_saved');
  eq([changed.sync, w.rev()], [short(rev + 1), rev + 1], 'a changed retry moves nothing either');
});

test('the fast answer is not given to a phone that has been signed out', () => {
  const w = seeded(), same = { since: w.rev(), day: w.today() };
  w.must('mason', 'logout');
  const r = w.call('mason', 'sync', same);
  eq([r.error.code, r.sync], ['auth', undefined]);
  w.must('owner', 'removeMember', { id: w.ids.jake });
  eq(w.call('jake', 'sync', { since: w.rev(), day: w.today() }).error.code, 'auth');
});

/* ================================================================== */
section('the system clock');

test('every answer that carries a sync carries the clock: sign-in, refresh, nothing new, a save, a replay, a changed retry and a refusal, for every role', () => {
  const w = seeded();
  w.at('2026-11-17', '13:07');
  const want = [chi('2026-11-17', '13:07'), '13:07'];
  const clock = (res, label) => { ok(res.sync, label + ' has no sync'); eq([res.sync.nowMs, res.sync.nowHM], want, label); return res; };
  Object.keys(PINS).forEach((who) => {
    clock(w.login(who, PINS[who][0], PINS[who][1]), 'sign-in as ' + who);
    const full = clock(w.must(who, 'sync'), 'a refresh for ' + who).sync;
    eq(full.same, false);
    const same = clock(w.must(who, 'sync', { since: full.rev, day: full.today }), 'nothing new for ' + who).sync;
    eq([keys(same), same.same], ['nowHM,nowMs,rev,same,today', true]);
    const op = { opId: 'clock-op-' + who };
    ok(!clock(w.must(who, 'ackStandards', op), 'a save by ' + who).replay);
    ok(clock(w.must(who, 'ackStandards', op), 'a replay for ' + who).replay === true);
    eq(clock(w.call(who, 'ackStandards', Object.assign({ changed: 1 }, op)), 'a changed retry by ' + who).error.code, 'already_saved');
    eq(clock(w.call(who, 'addNote', { kind: 'client', id: 'c_missing', text: 'x' }), 'a refusal for ' + who).error.code, 'not_found');
    eq(clock(w.call(who, 'addNote', { kind: 'client', id: 'c_missing', text: 'x', since: w.rev(), day: w.today() }), 'a refusal with nothing new for ' + who).sync.same, true);
  });
  eq(clock(w.call('cole', 'saveSettings', { settings: { firstPct: 1 } }), 'a role refusal').error.code, 'forbidden');
  /* An answer with no sync has no clock either: a ping, a sign-out, and anything from a phone that is not signed in. */
  eq(w.raw({ action: 'ping' }), { ok: true, result: { version: C.VERSION } });
  eq(w.must('tess', 'logout').sync, null);
  eq(keys(w.call('tess', 'sync')), 'error,ok');
  eq(keys(w.tryLogin('Grayson', '000000')), 'error,ok');
});

test('the clock is the system\'s own, in business time: across midnight, across both daylight-saving changes, whatever the phone says', () => {
  const w = seeded();
  [['2026-11-17', '23:59'], ['2026-11-18', '00:00'], ['2027-03-14', '01:59'], ['2027-03-14', '03:00'], ['2027-07-04', '12:00'], ['2027-11-07', '00:30'], ['2027-11-07', '03:15']].forEach((at) => {
    w.at(at[0], at[1]); relog(w, ['mason', 'cole']);
    const short = w.must('mason', 'sync', { since: w.rev(), day: at[0], nowMs: 5, nowHM: '99:99', now: 1, today: '2020-01-01' }).sync;   /* what a phone claims is not listened to */
    eq(short, { rev: w.rev(), today: at[0], same: true, nowMs: chi(at[0], at[1]), nowHM: at[1] }, at.join(' '));
    const full = w.full('cole');
    eq([full.same, full.today, full.nowHM, full.nowMs], [false, at[0], at[1], chi(at[0], at[1])], at.join(' '));
  });
  ok(chi('2027-03-14', '03:00') - chi('2027-03-14', '01:59') === MIN, 'the test did cross the spring change, where one minute on the clock is an hour and a minute on the wall');
});

test('nowHM is the clock the booking rule uses: a time today can be booked exactly when it is later than nowHM', () => {
  const base = world();
  ['00:00', '07:59', '08:00', '08:01', '09:29', '09:30', '11:59', '12:00', '13:59', '14:00', '23:59'].forEach((time) => {
    SLOTS.forEach((slot) => {
      const w = base.fork();
      w.at('2026-11-17', time);
      const nowHM = w.full('mason').nowHM, r = sell(w, 'mason', 'Clock ' + slot, '2026-11-17', slot);
      eq([nowHM, r.ok, r.ok ? '' : r.error.code], [time, slot > nowHM, slot > nowHM ? '' : 'slot_closed'], slot + ' at ' + time);
    });
  });
});

/* ================================================================== */
section('words');

test('nothing the system can say to a phone says "customer": it is "client" everywhere', () => {
  const fs = require('fs');
  /* The company standards the system starts with are Grayson's own words to his team and are left as they are. */
  const coreText = fs.readFileSync(path.join(__dirname, '..', 'src', 'core.js'), 'utf8');
  const from = coreText.indexOf('    standards: ['), to = coreText.indexOf('    standardsUpdatedAt: 0');
  ok(from > 0 && to > from, 'could not find the default standards in core.js');
  lacks((coreText.slice(0, from) + coreText.slice(to)).toLowerCase(), 'customer', 'core.js, outside the default standards');
  ['src/gas.js', 'tools/dev-server.js'].forEach((f) => lacks(fs.readFileSync(path.join(__dirname, '..', f), 'utf8').toLowerCase(), 'customer', f));
  /* And the ones a rep meets first. */
  const w = seeded();
  [{}, { name: '' }, { name: '   ' }, { name: null }, { name: ['x'] }].forEach((c) => {
    eq(w.refuse('mason', 'createSale', { client: c, service: 'House wash', priceCents: 100 }, 'invalid').error.message, 'Add the client\'s name.');
  });
  eq(w.refuse('mason', 'updateClient', { clientId: w.ids.clientA, patch: { name: ' ' } }, 'invalid').error.message, 'Add the client\'s name.');
  eq(w.refuse('mason', 'addNote', { kind: 'client', id: 'c_missing', text: 'x' }, 'not_found').error.message, 'That client is no longer here.');
  eq(w.refuse('mason', 'bookJob', { clientId: w.ids.clientB, date: '2026-11-19', time: '08:00' }, 'forbidden').error.message, 'That client belongs to another rep.');
});

/* ================================================================== */
section('random play');

function playRandomly(seed, steps) {
  const r = rng(seed), pick = (list) => list[Math.floor(r() * list.length)], chance = (p) => r() < p;
  const w = world();
  const people = Object.keys(PINS).map((k) => ({ key: k, id: w.ids[k], name: PINS[k][0], pin: PINS[k][1] }));
  const tally = { ok: 0 };
  const texts = ['Fine.', 'Gate code 4411', NASTY[0], NASTY[1], 'x'.repeat(700), '', '  spaced   out  ', 'line one\nline two'];
  let actor = null, role = null, db = null;   /* db: the stored data as it was when this step began */
  /* Mostly something of the actor's own, sometimes anyone's, sometimes nothing real. */
  const anyId = (coll) => {
    let l = db[coll];
    if (chance(0.08) || !l.length) return pick(['c_missing', '__proto__', '', null, 7]);
    if (chance(0.65)) {
      let own = l;
      const mine = {}; db.clients.forEach((c) => { if (c.repId === actor.id) mine[c.id] = 1; });
      if (role === 'tech' && coll === 'jobs') own = l.filter((j) => j.assignedTo === actor.id);
      if (role === 'rep' && coll === 'clients') own = l.filter((c) => c.repId === actor.id);
      if (role === 'rep' && coll === 'jobs') own = l.filter((j) => mine[j.clientId]);
      if (role === 'rep' && coll === 'sales') own = l.filter((x) => x.repId === actor.id);
      if (own.length) l = own;
    }
    return pick(l).id;
  };
  const USUAL = {
    owner: ['createSale', 'createSale', 'bookJob', 'moveJob', 'moveJob', 'updateJob', 'updateJob', 'updateJob', 'updateJob', 'updateJob', 'setJobDone', 'setJobDone', 'addNote', 'updateClient', 'updateClient',
      'setDays', 'saveSettings', 'saveSettings', 'saveMember', 'saveMember', 'removeMember', 'deleteClient', 'deleteSale', 'updateSale', 'updateSale', 'resetPin', 'sync', 'ackStandards', 'readNotices', 'clearProblems', 'changePin'],
    rep: ['createSale', 'createSale', 'createSale', 'createSale', 'createSale', 'bookJob', 'bookJob', 'moveJob', 'moveJob', 'addNote', 'updateClient', 'sync', 'ackStandards', 'changePin', 'logout'],
    tech: ['setJobDone', 'setJobDone', 'setJobDone', 'setJobDone', 'addNote', 'addNote', 'sync', 'ackStandards', 'changePin', 'logout']
  };
  const anyDay = () => chance(0.1) ? pick(['2026-02-30', 'soon', null, C.dates.addDays(w.today(), -1 - Math.floor(r() * 5)), C.dates.addDays(w.today(), 40)]) : C.dates.addDays(w.today(), Math.floor(r() * 4));
  const anyTime = () => chance(0.1) ? pick(['10:00', '9:30', '', null, '23:59']) : pick(SLOTS);
  const price = () => chance(0.1) ? pick([-1, 1.5, NaN, '100', null, 100000001]) : Math.floor(r() * 50000);
  const keepOpen = () => {
    let o = people[0];
    if (!w.call('owner', 'sync').ok) w.login('owner', o.name, o.pin);
    const days = []; for (let i = 0; i < 8; i++) days.push({ date: C.dates.addDays(w.today(), i), open: !(i === 3 && chance(0.3)) });
    w.must('owner', 'setDays', { days: days });
  };
  const make = {
    sync: () => ({ since: chance(0.5) ? w.rev() : 0, day: w.today() }),
    ackStandards: () => ({}),
    readNotices: () => ({}), clearProblems: () => ({}),
    addNote: () => chance(0.5) ? { kind: 'client', id: anyId('clients'), text: pick(texts) } : { kind: pick(['job', 'job', 'x']), id: anyId('jobs'), text: pick(texts) },
    createSale: () => Object.assign({ service: pick(['Window cleaning', 'House wash', 'Pressure wash', 'Window cleaning', 'House wash', 'Pressure wash', '', NASTY[4]]), priceCents: price(), billing: pick(['once', 'monthly', 'monthly', 'yearly']), notes: pick(texts),
      stripeLink: pick(['', '', 'https://pay.example/ok', 'http://bad.example', 'javascript:alert(1)']), appointment: chance(0.75) ? { date: anyDay(), time: anyTime() } : null, repId: chance(0.2) ? pick(people).id : undefined },
      chance(0.3) ? { clientId: anyId('clients') } : { client: { name: chance(0.12) ? pick(['', '   ', NASTY[2]]) : 'Home ' + Math.floor(r() * 1e6), phone: '615-555-' + Math.floor(r() * 9999), address: pick(texts) } }),
    bookJob: () => ({ clientId: anyId('clients'), date: anyDay(), time: anyTime(), what: pick(texts), saleId: chance(0.4) ? anyId('sales') : undefined }),
    moveJob: () => ({ jobId: anyId('jobs'), date: anyDay(), time: anyTime() }),
    setJobDone: () => ({ jobId: anyId('jobs'), done: pick([true, true, false, undefined]) }),
    updateClient: () => ({ clientId: anyId('clients'), patch: pick([{ status: pick(C.CLIENT_STATUSES.concat(['Gone'])) }, { phone: 'p', name: pick(texts) }, { priceCents: price(), billing: pick(['once', 'monthly']) },
      { payStatus: pick(['paid', 'late', 'unpaid', 'x']) }, { stripeLink: pick(['https://pay.example/z', 'bad']) }, { repId: pick(people).id, id: 'c_x' }]) }),
    updateJob: () => ({ jobId: anyId('jobs'), patch: pick([{ status: 'cancelled' }, { status: 'scheduled' }, { status: 'scheduled' }, { assignedTo: pick(people).id }, { assignedTo: null }, { what: pick(texts) }, { status: 'done' }]) }),
    deleteClient: () => ({ clientId: anyId('clients') }),
    deleteSale: () => ({ saleId: anyId('sales') }),
    updateSale: () => ({ saleId: anyId('sales'), patch: pick([{ priceCents: price() }, { service: pick(['Window cleaning', 'House wash', '', NASTY[4]]) }, { repId: pick(people).id }, { repId: pick(people).id, priceCents: price() },
      { billing: pick(['once', 'monthly']) }, 'nothing', null]) }),
    removeMember: () => ({ id: pick(people).id }),
    resetPin: () => ({ id: pick(people).id, pin: '6' + (10000 + Math.floor(r() * 89999)) }),
    saveMember: () => chance(0.5) ? { member: { name: pick(['Rep ', 'Tech ', 'Sam ']) + Math.floor(r() * 30), role: pick(['rep', 'tech', 'boss']), pin: '7' + (10000 + Math.floor(r() * 89999)) } }
      : { member: { id: pick(people).id, name: pick(people).name, role: pick(['rep', 'tech', 'rep', 'tech', 'owner']) } },
    saveSettings: () => ({ settings: pick([{ firstPct: pick([30, 25.5, 0, 100, 101]), monthlyPct: pick([10, 7.25, -1]) }, { defaultTechId: pick(people).id }, { defaultTechId: null },
      { standards: draft().slice(0, 1 + Math.floor(r() * 5)) }, { defaultSlots: pick([SLOTS, SLOTS, []]) }, { emailOnBooking: chance(0.5) }, { services: [{ name: 'Window cleaning' }, { name: 'House wash', priceCents: price() }] }]) }),
    setDays: () => ({ days: [{ date: anyDay(), open: chance(0.7), slots: chance(0.3) ? [anyTime(), anyTime()] : undefined }] }),
    changePin: () => ({ oldPin: chance(0.8) ? 'CURRENT' : '000000', newPin: '8' + (10000 + Math.floor(r() * 89999)) }),
    logout: () => ({})
  };
  const names = Object.keys(make);
  for (let step = 1; step <= steps; step++) {
    const where = 'seed ' + seed + ' step ' + step;
    try {
      if (chance(0.05)) { const day = w.today(); w.wait(Math.floor(r() * 14 * HOUR) + 5 * MIN); if (w.today() !== day) keepOpen(); }
      db = w.db();
      const team = db.team, here = people.filter((x) => { const m = byId(team, x.id); return m && m.active; });
      const p = chance(0.05) ? pick(people) : chance(0.2) ? people[0] : pick(here);
      actor = p; role = (byId(team, p.id) || {}).role;
      const action = chance(0.8) ? pick(USUAL[role]) : pick(names), fields = make[action]();
      if (action === 'changePin' && fields.oldPin === 'CURRENT') fields.oldPin = p.pin;
      if (action === 'saveMember' && fields.member.role === 'owner' && fields.member.id !== people[0].id) fields.member.role = 'rep';   /* one owner only, so the play can always go on */
      if (chance(0.25)) fields.opId = 'play-' + seed + '-' + Math.floor(r() * 40);
      if (!w.tokens[p.key] || chance(0.03)) { const li = w.tryLogin(chance(0.97) ? p.name : p.name + 'x', chance(0.97) ? p.pin : '000000'); if (li.ok) w.tokens[p.key] = li.result.token; }
      const revBefore = w.rev(), res = w.call(p.key, action, fields);
      tally[res.ok ? 'ok' : res.error.code] = (tally[res.ok ? 'ok' : res.error.code] || 0) + 1;
      if (res.replay) tally.replay = (tally.replay || 0) + 1;
      ok(res.ok || res.error.code !== 'server', action + ' gave a server error');
      /* An opId that comes round again is the same thing again (a replay) or a changed retry (already_saved). Neither saves anything. */
      if (res.replay || (!res.ok && res.error.code === 'already_saved')) {
        ok(fields.opId && w.rev() === revBefore, action + ' was answered ' + (res.replay ? 'as a replay' : 'already_saved') + ' but something was saved');
        if (!res.ok) eq([res.error.message, typeof res.sync.rev], [ALREADY_SAVED, 'number'], action);
      }
      if (res.ok && !res.replay) {
        if (action === 'saveMember' && res.result.pin) people.push({ key: 'p' + people.length, id: res.result.id, name: fields.member.name, pin: res.result.pin });
        if (action === 'saveMember' && fields.member.id) people.forEach((x) => { if (x.id === fields.member.id) x.name = fields.member.name; });
        if (action === 'resetPin') people.forEach((x) => { if (x.id === fields.id) x.pin = res.result.pin; });
        if (action === 'changePin') p.pin = fields.newPin;
        if (action === 'logout') delete w.tokens[p.key];
      }
      if (!res.ok && res.error.code === 'auth') delete w.tokens[p.key];
      /* Every save that carried an opId is sent once more, word for word, as a phone does when the answer was lost. */
      if (res.ok && !res.replay && fields.opId && action !== 'sync' && action !== 'logout') {
        const saved = JSON.stringify(w.db()), again = w.call(p.key, action, fields);
        ok(again.ok && again.replay === true && JSON.stringify(again.result) === JSON.stringify(res.result), action + ' sent again was not answered from memory');
        ok(JSON.stringify(w.db()) === saved && w.rev() === res.sync.rev, action + ' sent again saved something');
        tally.replay = (tally.replay || 0) + 1;
      }
      const after = w.db();
      checkData(w, after); checkView(res.sync);
      eq(after.problems, [], 'a problem was recorded');
      /* Grayson is the only owner all through the play, so every sale that is his must be one that pays no commission. */
      after.sales.forEach((x) => { if (x.repId === people[0].id) ok(x.firstPct === 0 && x.monthlyPct === 0, 'a sale by the owner is set to pay commission'); });
      after.team.forEach((m) => { if (!m.active && !db.team.some((b) => b.id === m.id && !b.active)) ok(!w.call(people.filter((x) => x.id === m.id).map((x) => x.key)[0] || 'nobody', 'sync').ok, 'someone who was just removed is still signed in'); });
      if (step % 40 === 0) people.forEach((x) => { if (w.tokens[x.key]) { const s = w.call(x.key, 'sync'); if (s.ok) { checkView(s.sync); ok(s.sync.me.id === x.id, 'a token answered as someone else'); } } });
    } catch (e) { throw new Error(where + ': ' + e.message); }
  }
  return tally;
}

[11, 2026, 90211, 424242].forEach((seed) => {
  test('2500 random actions by everyone (seed ' + seed + ') never break a rule', () => {
    const t = playRandomly(seed, 2500);
    if (process.env.SHOW_ALL) console.log('      ' + JSON.stringify(t));
    ok(t.ok > 700 && t.forbidden > 100 && t.slot_taken > 5 && t.slot_taken + t.slot_closed > 40 && t.invalid > 50 && t.not_found > 20 && t.auth > 5 && t.already_saved > 2 && t.replay > 100, 'the play was too tame: ' + JSON.stringify(t));
  });
});

/* ================================================================== */
section('when the store fails');

test('a store that breaks in the middle of a save gives a plain refusal and leaves the owner a note', () => {
  const w = world(), realPut = w.store.put;
  let failOn = 'sales';
  w.store.put = (coll, doc) => { if (coll === failOn) { failOn = null; throw new Error('could not write the ' + coll + ' tab'); } realPut(coll, doc); };
  const r = w.call('mason', 'createSale', { client: { name: 'Bad Luck' }, service: 'House wash', priceCents: 100, appointment: { date: '2026-11-18', time: '09:30' }, opId: 'store-op-0001' });
  eq([r.ok, r.error.code, r.sync, r.result], [false, 'server', undefined, undefined]);
  has(r.error.message, 'Try again');
  const p = w.full('owner').problems;
  eq([p.length, p[0].where, p[0].message], [1, 'createSale', 'could not write the sales tab']);
  eq(w.full('mason').problems, []);
  const again = w.must('mason', 'createSale', { client: { name: 'Bad Luck' }, service: 'House wash', priceCents: 100, appointment: { date: '2026-11-18', time: '09:30' }, opId: 'store-op-0001' });
  ok(!again.replay && again.result.jobId, 'the retry with the same opId really saves');
  eq([w.db().sales.length, w.db().jobs.length], [1, 1]);
});

test('the host can add to the owner\'s problems list after a save, and a broken store does not make that throw', () => {
  const w = world(), rev = w.rev();
  w.core.recordProblem('email', 'An email alert could not be sent: Service invoked too many times for one day: email.');
  eq(w.full('owner').problems.map((p) => [p.where, p.message, p.at]), [['email', 'An email alert could not be sent: Service invoked too many times for one day: email.', w.t]]);
  eq(w.rev(), rev + 1, 'the owner\'s phone is told there is something new');
  eq(w.full('mason').problems, [], 'only the owner sees it');
  for (let i = 0; i < 35; i++) { w.wait(1000); w.core.recordProblem('w'.repeat(100), 'm'.repeat(1000)); }
  const p = w.full('owner').problems;
  eq([p.length, p[0].where.length, p[0].message.length], [30, 60, 300], 'kept short, and kept to the latest 30');
  w.store.put = () => { throw new Error('the sheet is unreachable'); };
  w.core.recordProblem('email', 'not saved, but not a crash either');
});

test('a store that is completely down still gets a plain answer, for every action', () => {
  const w = seeded();
  w.store.list = () => { throw new Error('the sheet is unreachable'); };
  w.store.put = () => { throw new Error('the sheet is unreachable'); };
  w.store.cacheGet = () => null;
  const reqs = sampleRequests(w);
  Object.keys(reqs).concat(['sync', 'login', 'logout', 'ackStandards']).forEach((a) => {
    const r = w.raw(Object.assign({ action: a, token: w.tokens.owner, name: 'Grayson', pin: '482913' }, reqs[a] || {}));
    eq([r.ok, r.error.code, r.sync], [false, 'server', undefined], a);
  });
});

/* ================================================================== */

console.log('');
console.log(passed + ' passed, ' + failed + ' failed');
if (failed) { console.log('Failed:'); failures.forEach((f) => console.log('  ' + f)); }
process.exit(failed ? 1 : 0);
