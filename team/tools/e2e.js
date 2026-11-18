#!/usr/bin/env node
/*
 * End-to-end check of the BUILT page (team/index.html), driven the way a person drives it:
 * a phone-sized Chromium (390x844, touch), real taps and real typing, nothing called behind the UI.
 *
 *   node tools/build.js && node tools/e2e.js          everything (about 2 minutes)
 *   node tools/e2e.js sample                          one walk only. The walks are:
 *                                                       sample   sample mode, every role, every screen (index.html?sample=1)
 *                                                       start    how the page starts: the three config.js cases, a phone clock
 *                                                                set to a Wednesday, a day whose times have passed
 *                                                       real     real mode on three phones (index.html?backend=<tools/dev-server.js>)
 *                                                       lost     real mode with answers that get lost on the way back
 *                                                     Several can be named: node tools/e2e.js sample start
 *   node tools/e2e.js --width 360                     run it all on a phone that wide (any width; 360 is the smallest we promise).
 *                                                     The screen is 844 tall from 390 wide up and 740 below; --height N sets it.
 *   node tools/e2e.js --serial                        one walk after the other, about 4 minutes (by default two run side by side)
 *   node tools/e2e.js --shots /some/folder            also save a picture of every phone when a check fails
 *   node tools/e2e.js --headed                        watch it happen
 *   node tools/e2e.js --page /other/index.html        drive another build of the page (config.js and
 *                                                     photo-standard.jpg must sit beside it)
 *
 * One line per check ("ok" or "FAIL"). Exit code 1 if anything failed.
 * On every screen and every sheet it also checks: no console errors, no page errors, no sideways scroll,
 * nothing sticking out past the edge of the screen.
 *
 * Where the script looks behind the screen, it only reads: the day and the open days (to choose which day
 * to tap), the data the page holds (App.data, to work out a number the screen should show and to see what a
 * tech's phone was sent), what the page has stored on the phone, and, in real mode, the server's own data to
 * count what was really saved. It writes two things: a marker on the page, to prove the page was never
 * reloaded, and the "online" event a phone gets when its signal comes back, which makes the page ask for the
 * latest at once instead of at its next 20 second round (the walk says where it waits out a real round).
 * Two controls have no keys to type with in a headless browser, so they are set directly: a <select>
 * (selectOption) and the native time box (fill). Where the phone's clock matters, the browser is given one.
 *
 * The real-mode walks each start their own tools/dev-server.js on a free port (Grayson 482913, Mason 271845,
 * Cole 906132) and sign in on separate phones. Saves are made to fail with the dev server's own knobs, added
 * to the address of one request on its way out: ?fail=1 (an error page, nothing saved), ?drop=1 (saved, and
 * the answer never arrives), ?delay=N&fail=1 (the error page after a wait, so a sheet can be closed while it
 * says "Saving..."). In one part the server process itself is stopped (SIGSTOP) and started again (SIGCONT),
 * which keeps its data.
 * A "busy" answer to a background refresh is handed to the page in the server's place.
 *
 * The walks read the clock, so a run that straddles midnight (Central time) can fail for that reason alone,
 * and so can the last two minutes before it (one part books a job for 11:58 PM today).
 *
 * It needs Playwright with Chromium (npm i -D playwright && npx playwright install chromium).
 */
'use strict';
const path = require('path');
const fs = require('fs');
const net = require('net');
const { spawn } = require('child_process');

let chromium;
try { ({ chromium } = require('playwright')); } catch (e) {
  console.error('This script needs Playwright: npm i -D playwright && npx playwright install chromium');
  process.exit(1);
}
const Core = require(path.join(__dirname, '..', 'src', 'core.js'));
const D = Core.dates;

const ROOT = path.join(__dirname, '..');
const args = process.argv.slice(2);
const argAfter = (name) => (args.includes(name) ? args[args.indexOf(name) + 1] || '' : '');
const BUILT = args.includes('--page') ? path.resolve(argAfter('--page')) : path.join(ROOT, 'index.html');
const PAGE = 'file://' + BUILT;
const WALKS = ['sample', 'start', 'real', 'lost'];
const wanted = args.filter((a) => WALKS.indexOf(a) >= 0);
const SHOTS = argAfter('--shots');
const HEADED = args.includes('--headed');
const SERIAL = args.includes('--serial') || HEADED;
const WIDTH = args.includes('--width') ? parseInt(argAfter('--width'), 10) : 390;
const HEIGHT = args.includes('--height') ? parseInt(argAfter('--height'), 10) : (WIDTH >= 390 ? 844 : 740);
if (!(WIDTH >= 280 && WIDTH <= 2000) || !(HEIGHT >= 400 && HEIGHT <= 2000)) {
  console.error('Usage: node tools/e2e.js [sample] [start] [real] [lost] [--width 360] [--height 740] [--serial] [--shots folder] [--headed] [--page file]');
  process.exit(1);
}
const WAIT = 8000;          /* how long a thing may take to show up */
const LIVE = 27000;         /* "within about 25 seconds": one 20 second refresh plus the answer */
const PINS = { Grayson: '482913', Mason: '271845', Avery: '730526', Cole: '906132' };   /* the sample people; the dev server has the same three */
const NO_SIGNAL = 'Could not save. Check your signal and try again.';
const FIRST_SAVED = 'Your first try was saved. Check it, then make the change again if you still need to.';   /* the system's words for a changed retry */

/* ================= one line per check ================= */

const tally = { ok: 0, bad: 0, failed: [] };
let fontsMissing = false, shotCount = 0;
const phones = [];

function ok(name) { tally.ok++; console.log('ok    ' + name); return true; }
function fail(name, why) {
  tally.bad++;
  tally.failed.push(name);
  console.log('FAIL  ' + name + (why ? '   [' + String(why).split('\n')[0].slice(0, 300) + ']' : ''));
  return false;
}
function check(name, cond, why) { return cond ? ok(name) : fail(name, typeof why === 'function' ? why() : why); }

async function pictures(label) {
  if (!SHOTS) return;
  fs.mkdirSync(SHOTS, { recursive: true });
  const n = String(++shotCount).padStart(3, '0');
  for (const p of phones) {
    if (p.page.isClosed()) continue;
    try { await p.page.screenshot({ path: path.join(SHOTS, n + '-' + p.who + '-' + label.replace(/[^a-z0-9]+/gi, '-').slice(0, 60) + '.png') }); } catch (e) { /* no picture */ }
  }
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
async function until(fn, ms, every) {
  const end = Date.now() + (ms || WAIT);
  for (;;) {
    let v = false;
    try { v = await fn(); } catch (e) { v = false; }
    if (v) return v;
    if (Date.now() > end) return false;
    await sleep(every || 100);
  }
}
const tidy = (s) => String(s == null ? '' : s).replace(/ /g, ' ').replace(/\s+/g, ' ').trim();
const exact = (text) => new RegExp('^\\s*' + String(text).replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + '\\s*$');

/* A thing is on screen (waits for it). */
async function sees(name, loc, ms) {
  try { await loc.first().waitFor({ state: 'visible', timeout: ms || WAIT }); return ok(name); }
  catch (e) { await pictures(name); return fail(name, 'not on screen'); }
}
/* A thing is not on screen (waits for it to go). */
async function gone(name, loc, ms) {
  try { await loc.first().waitFor({ state: 'hidden', timeout: ms || WAIT }); return ok(name); }
  catch (e) { await pictures(name); return fail(name, 'still on screen'); }
}
/* The words of a thing contain (or match) what is wanted. */
async function says(name, loc, want, ms) {
  let got = '';
  const hit = await until(async () => {
    got = tidy(await loc.first().textContent({ timeout: 1000 }));
    return want instanceof RegExp ? want.test(got) : got.indexOf(want) >= 0;
  }, ms || WAIT);
  if (hit) return ok(name);
  await pictures(name);
  return fail(name, 'it says: ' + (got || '(nothing)'));
}

/* ================= words the way the app writes them ================= */

const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
const DAYS = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
const words = {
  time(hm) { const h = +hm.slice(0, 2); return ((h % 12) || 12) + ':' + hm.slice(3, 5) + (h < 12 ? ' AM' : ' PM'); },
  dayShort(d) { return MONTHS[+d.slice(5, 7) - 1].slice(0, 3) + ' ' + (+d.slice(8, 10)); },
  day(d, today) { const s = DAYS[D.weekday(d)].slice(0, 3) + ', ' + words.dayShort(d); return d.slice(0, 4) === today.slice(0, 4) ? s : s + ', ' + d.slice(0, 4); },
  dayLong(d) { return DAYS[D.weekday(d)] + ', ' + MONTHS[+d.slice(5, 7) - 1] + ' ' + (+d.slice(8, 10)); },
  dayHead(d) { return DAYS[D.weekday(d)] + ', ' + words.dayShort(d); },                 /* the title of Today */
  when(d, t, today) { return words.day(d, today) + ' at ' + words.time(t); },
  month(ym) { return MONTHS[+ym.slice(5, 7) - 1] + ' ' + ym.slice(0, 4); },
  monthKey(title) { const m = /^(\w+) (\d{4})$/.exec(tidy(title)); return m ? m[2] + '-' + String(MONTHS.indexOf(m[1]) + 101).slice(1) : ''; },
  hm(label) { const m = /^(\d{1,2}):(\d{2}) (AM|PM)$/.exec(tidy(label)); const h = (+m[1] % 12) + (m[3] === 'PM' ? 12 : 0); return String(h + 100).slice(1) + ':' + m[2]; },
  plural(n, word) { return n + ' ' + (n === 1 ? word : word + 's'); },
  money(cents) { const c = Math.abs(Math.round(cents)); return (cents < 0 ? '-$' : '$') + String(Math.floor(c / 100)).replace(/\B(?=(\d{3})+(?!\d))/g, ',') + '.' + String(c % 100 + 100).slice(1); },
  moneyShort(cents) { return Math.round(cents) % 100 === 0 ? words.money(cents).slice(0, -3) : words.money(cents); }
};
const cents = (text) => Math.round(parseFloat(String(text).replace(/[$,]/g, '')) * 100);

/* Revenue the way the fix list defines it: money due in the period. Every commission event of a sale is one
   payment of its price (the first, then each month a monthly client was kept), so the price counts once for
   each event dated in the period. Worked out here from the sales the page (or the server) holds. */
function revenue(sales, from, today) {
  let total = 0;
  (sales || []).forEach((s) => { (s.events || []).forEach((e) => { if (e.day >= from && e.day <= today) total += s.priceCents; }); });
  return total;
}
function commission(sales, from, today) {
  let total = 0;
  (sales || []).forEach((s) => { (s.events || []).forEach((e) => { if (e.day >= from && e.day <= today) total += e.cents; }); });
  return total;
}

/* ================= a phone ================= */

class Phone {
  constructor(ctx, page, who) {
    this.ctx = ctx; this.page = page; this.who = who;
    this.problems = [];      /* console errors and page errors since the last health check */
    this.quietNet = 0;       /* while > 0, the browser's own "request failed" lines are expected (the phone is offline) */
    this.backend = '';       /* real mode: where its backend is. A request to it that the walk made fail is not a page problem */
    this.faults = [];
    page.setDefaultTimeout(WAIT);
    page.on('console', (m) => {
      if (m.type() !== 'error') return;
      const text = m.text(), where = (m.location() || {}).url || '';
      const netLine = /Failed to load resource|net::ERR_|ERR_INTERNET_DISCONNECTED/.test(text);
      if (/fonts\.(googleapis|gstatic)\.com/.test(where + ' ' + text)) { if (!this.quietNet) fontsMissing = true; return; }
      if (this.quietNet && netLine) return;
      if (this.backend && netLine && where.indexOf(this.backend) === 0) return;
      this.problems.push('console error: ' + text);
    });
    page.on('pageerror', (e) => this.problems.push('page error: ' + e.message));
  }

  get screen() { return this.page.locator('#screen'); }
  get top() { return this.page.locator('#layers > .layer').last(); }           /* the sheet or dialog on top */
  get foot() { return this.top.locator('.sheet-foot .btn'); }                   /* its footer button */
  get toasts() { return this.page.locator('#toasts .toast'); }
  toast(text) { return this.toasts.filter({ hasText: text }); }
  /* A list row by its title. A job row's title holds the name and a pill, so its name is looked for on its own. */
  row(scope, title) {
    return scope.locator('.row').filter({ has: this.page.locator('.row-head-text, .row-title:not(:has(.row-head))', { hasText: title instanceof RegExp ? title : exact(title) }) });
  }
  btn(scope, label) { return scope.locator('.btn').filter({ has: this.page.locator('.btn-label', { hasText: label instanceof RegExp ? label : exact(label) }) }); }
  kv(scope, label) { return scope.locator('.kv').filter({ has: this.page.locator('.kv-label', { hasText: exact(label) }) }).locator('.kv-value'); }
  card(client) { return this.screen.locator('article.job').filter({ has: this.page.locator('.job-name', { hasText: client }) }); }
  field(scope, name) { return scope.locator('[name="' + name + '"]'); }
  layers() { return this.page.locator('#layers > .layer').count(); }

  /* No console errors, no page errors, no sideways scroll, nothing past the edge. One line. */
  async health(where) {
    const layout = await this.page.evaluate(() => {
      const out = [], w = window.innerWidth, de = document.documentElement;
      if (de.scrollWidth > w) out.push('the page is ' + de.scrollWidth + ' wide on a ' + w + ' screen');
      if (window.pageXOffset) out.push('the page is scrolled sideways');
      document.querySelectorAll('.sheet, .sheet-body, .dialog').forEach((el) => {
        if (el.scrollWidth > el.clientWidth + 1) out.push('.' + el.className.split(' ')[0] + ' scrolls sideways (' + el.scrollWidth + ' in ' + el.clientWidth + ')');
      });
      document.querySelectorAll('#app *, #signin *, #layers *, #toasts *').forEach((el) => {
        const slider = el.closest('.chips-scroll');
        if (slider && slider !== el) return;            /* a row of chips that slides sideways on purpose */
        const b = el.getBoundingClientRect();
        if (!b.width || !b.height) return;
        if (b.right > w + 0.5 || b.left < -0.5) out.push((el.className && el.className.baseVal === undefined ? el.tagName + '.' + el.className : el.tagName) + ' sticks out (' + Math.round(b.left) + ' to ' + Math.round(b.right) + ')');
      });
      return out.slice(0, 4);
    });
    const errors = this.problems.splice(0);
    const all = errors.concat(layout);
    if (all.length) await pictures('health-' + where);
    return check(this.who + ': ' + where + ' is clean (no errors, no sideways scroll)', !all.length, all.join(' | '));
  }

  /* Typing: tap the box, clear what is in it, type the keys one by one. */
  async type(loc, text) {
    await loc.tap();
    await loc.press('Control+A');
    await loc.press('Backspace');
    if (text) await loc.pressSequentially(text);
  }

  /* The sheet on top has this title and has finished sliding up. Checks its health once. */
  async sheet(title, quiet) {
    const want = title instanceof RegExp ? title : exact(title);
    await this.top.locator('.sheet-title').filter({ hasText: want }).waitFor();
    await this.top.locator('.sheet').evaluate((el) => Promise.all(el.getAnimations().map((a) => a.finished.catch(() => {}))));
    if (!quiet) await this.health('the "' + tidy(await this.top.locator('.sheet-title').textContent()) + '" sheet');
  }
  async dialog(title) {
    await this.page.locator('.dialog .dialog-title', { hasText: title }).waitFor();
    await this.health('the "' + title + '" question');
  }
  answer(label) { return this.page.locator('.dialog .btn').filter({ hasText: exact(label) }).tap(); }

  async close() {
    const n = await this.layers();
    await this.top.locator('.sheet-close').tap();
    await until(async () => (await this.layers()) < n);
  }
  async closeAll() {
    for (let i = 0; i < 8 && (await this.layers()) > 0; i++) {
      const n = await this.layers();
      await this.page.keyboard.press('Escape');
      await until(async () => (await this.layers()) < n, 1500);
    }
  }

  /* A tab of the tab bar: tap it, wait for its screen, check its health. */
  async tab(label, title) {
    await this.page.locator('.tabbar .tab', { hasText: exact(label) }).tap();
    if (title) await this.screen.locator('h1.title', { hasText: title }).first().waitFor();
    else await this.page.locator('.tabbar .tab.is-on', { hasText: exact(label) }).waitFor();
    await this.health('the ' + label + ' tab');
  }

  async me() {
    await this.page.locator('#me-btn').tap();
    await this.sheet('Your account', true);
  }
  /* Sign out: the row in the account sheet, then the question it asks. */
  async signOut() {
    await this.closeAll();
    await this.me();
    await this.row(this.top, 'Sign out').tap();
    await this.page.locator('.dialog .dialog-title', { hasText: 'Sign out of this phone?' }).waitFor();
    await this.answer('Sign out');
    await this.page.locator('#signin:not([hidden])').waitFor();
  }
  async signInForm(name, pin) {
    await this.type(this.page.locator('#signin-body [name="name"]'), name);
    await this.type(this.page.locator('#signin-body [name="pin"]'), pin);
    await this.page.locator('#signin-body button[type="submit"]').tap();
  }
  async signedIn() { await this.page.locator('#app:not([hidden])').waitFor(); }
  today() { return this.page.evaluate(() => window.App.today()); }
  /* The phone's signal comes back (the browser's "online" event): the page asks for the latest at once. */
  wake() { return this.page.evaluate(() => { window.dispatchEvent(new Event('online')); }); }
  /* What the page keeps on the phone: each key and how long its value is. Only read. */
  stored() {
    return this.page.evaluate(() => {
      const out = {};
      for (let i = 0; i < localStorage.length; i++) { const k = localStorage.key(i); out[k] = (localStorage.getItem(k) || '').length; }
      return out;
    });
  }
  /* How many lines of text a thing takes. */
  lines(loc) {
    return loc.first().evaluate((el) => {
      const cs = getComputedStyle(el), lh = parseFloat(cs.lineHeight) || parseFloat(cs.fontSize) * 1.2;
      return Math.round((el.getBoundingClientRect().height - parseFloat(cs.paddingTop) - parseFloat(cs.paddingBottom)) / lh);
    });
  }

  /* ----- the month grid and the slot picker ----- */
  async showMonth(scope, ym) {
    const want = words.month(ym);
    for (let i = 0; i < 16; i++) {
      const now = tidy(await scope.locator('.month-title').first().textContent());
      if (now === want) return;
      await scope.locator(words.monthKey(now) < ym ? '[aria-label="Next month"]' : '[aria-label="Previous month"]').first().tap();
    }
    throw new Error('could not get the calendar to ' + want);
  }
  day(scope, date) {
    return scope.locator('.month-days .day').filter({ has: this.page.locator('.day-num', { hasText: new RegExp('^' + (+date.slice(8, 10)) + '$') }) });
  }
  /* In a slot picker: show that day and return the times it offers ('HH:MM'). */
  async timesOn(scope, date) {
    await this.showMonth(scope, date.slice(0, 7));
    const cell = this.day(scope, date);
    if ((await cell.evaluate((el) => el.tagName)) !== 'BUTTON') return [];
    await cell.tap();
    await scope.locator('.slotpick-day', { hasText: exact(words.dayLong(date)) }).waitFor();
    const labels = await scope.locator('.slotpick-times .chip').allTextContents();
    return labels.map(words.hm);
  }
  async pickTime(scope, date, time) {
    await this.timesOn(scope, date);
    await scope.locator('.slotpick-times .chip', { hasText: exact(words.time(time)) }).tap();
    await scope.locator('.slotpick-times .chip.is-on', { hasText: exact(words.time(time)) }).waitFor();
  }
}

/* A phone: its own browser context, the size of the run (or the size asked for), in the business's time zone. */
async function newPhone(browser, who, url, o) {
  o = o || {};
  const ctx = await browser.newContext({
    viewport: { width: o.width || WIDTH, height: o.height || HEIGHT }, isMobile: true, hasTouch: true, deviceScaleFactor: 2,
    locale: 'en-US', timezoneId: 'America/Chicago', permissions: ['clipboard-read', 'clipboard-write']
  });
  if (o.before) await o.before(ctx);
  const page = await ctx.newPage();
  const p = new Phone(ctx, page, who);
  phones.push(p);
  if (url) {
    await page.goto(url);
    await page.locator('#signin:not([hidden]), #app:not([hidden])').first().waitFor();
  }
  return p;
}
async function dropPhone(p) {
  try { await p.ctx.close(); } catch (e) { /* closed */ }
  if (phones.indexOf(p) >= 0) phones.splice(phones.indexOf(p), 1);
}

/* Runs one part of the walk. If a step in it cannot be done, that is one FAIL line and the walk goes on. */
async function part(name, list, fn) {
  try { await fn(); }
  catch (e) {
    await pictures(name);
    fail(name + ': could not finish', e && e.message);
    for (const p of list) { try { await p.closeAll(); } catch (e2) { /* next part will say so */ } }
  }
}

/* What the page knows about open days, read to choose which day to tap. */
function freeDays(p) {
  return p.page.evaluate(() => {
    const A = window.App, today = A.today();
    return A.freeDays().map((d) => ({ date: d, times: A.freeSlots(d), jobs: A.jobsOn(d).length })).filter((x) => x.date > today);
  });
}

/* Days from the day after tomorrow on that are not open for booking (blocked, or never opened). */
function closedDays(p) {
  return p.page.evaluate(() => {
    const A = window.App, out = [];
    for (let i = 2; i < 45; i++) {
      const t = new Date(A.today() + 'T12:00:00Z');
      t.setUTCDate(t.getUTCDate() + i);
      const d = t.toISOString().slice(0, 10), day = A.dayOf(d);
      if (!day || !day.open) out.push(d);
    }
    return out;
  });
}

/* What a tech's phone holds: read from the page's data and from the copy it keeps on the phone. */
async function techHoldsNoPrices(p, name) {
  const got = await p.page.evaluate(() => {
    const d = window.App.data, keys = ['firstPct', 'monthlyPct', 'priceCents', 'services', 'stripeLink', 'events', 'board'];
    let kept = '';
    for (let i = 0; i < localStorage.length; i++) { if (/\.snap$/.test(localStorage.key(i))) kept += localStorage.getItem(localStorage.key(i)); }
    const held = JSON.stringify(d);
    return { role: d.me.role, settings: Object.keys(d.settings).sort().join(), sales: (d.sales || []).length, clients: (d.clients || []).length,
      board: (d.board || []).length, jobs: (d.jobs || []).length, keptSome: kept.length > 0,
      inData: keys.filter((k) => k !== 'board' && held.indexOf('"' + k + '":') >= 0),
      inKept: keys.filter((k) => k !== 'board' && kept.indexOf('"' + k + '":') >= 0) };
  });
  return check(name, got.role === 'tech' && got.settings === 'businessName,standards,standardsUpdatedAt' && !got.sales && !got.clients && !got.board &&
    got.jobs > 0 && got.keptSome && !got.inData.length && !got.inKept.length, JSON.stringify(got));
}

/* Today's cards, top to bottom: which are overdue, where the reminder sits, and which "Mark done" is the ice one. */
function todayLayout(p) {
  return p.page.evaluate(() => {
    const out = [];
    Array.prototype.forEach.call(document.querySelectorAll('#screen > *'), (el) => {
      if (el.matches('.label')) out.push({ kind: 'label', text: el.querySelector('span').textContent });
      else if (el.matches('.remind')) out.push({ kind: 'remind' });
      else if (el.matches('article.job')) {
        const b = Array.prototype.filter.call(el.querySelectorAll('.btn'), (x) => x.textContent.trim() === 'Mark done')[0];
        out.push({ kind: 'job', name: el.querySelector('.job-name').textContent.trim(), overdue: el.classList.contains('is-overdue'), done: el.classList.contains('is-done'),
          mark: b ? (b.classList.contains('btn-primary') ? 'ice' : b.classList.contains('btn-quiet') ? 'quiet' : 'other') : '', height: b ? Math.round(b.getBoundingClientRect().height) : 0 });
      }
    });
    return { items: out, ice: document.querySelectorAll('#screen .btn-primary').length };
  });
}

/* ============================================================================================
 * SAMPLE MODE
 * ============================================================================================ */

async function sampleMode(browser) {
  const T = 'sample: ';
  const p = await newPhone(browser, 'sample phone', PAGE + '?sample=1');
  const list = [p];
  const S = { name: 'Birch Hollow Farm' };       /* what the walk makes, remembered for later parts */
  const LOOKALIKE = 'https://buy.stripe.com@pay.example.net/birch';      /* reads like Stripe, goes somewhere else */
  const LINK_WORDS = Core.check.payLink(LOOKALIKE);                     /* the system's own words for it */

  const quick = (role) => p.page.locator('#signin-body .btn', { hasText: exact(role) });
  async function asRole(role) {
    await quick(role).tap();
    await p.signedIn();
  }
  const draftKeys = async () => Object.keys(await p.stored()).filter((k) => /saleDraft/.test(k));
  const statNum = (label) => p.screen.locator('.stat-grid .stat').filter({ has: p.page.locator('.stat-label', { hasText: exact(label) }) }).locator('.stat-num');
  const pageSales = () => p.page.evaluate(() => window.App.data.sales.map((s) => ({ priceCents: s.priceCents, day: s.day, events: s.events })));

  await part(T + 'the sign-in screen', list, async () => {
    await sees(T + 'the sign-in screen shows the logo, the tagline and the sign-in form', p.page.locator('#signin .signin-logo svg'));
    await says(T + 'the tagline reads "A higher standard of clean"', p.page.locator('#signin .tagline'), 'A higher standard of clean');
    await says(T + 'sample mode says so and offers the three roles', p.page.locator('#signin-body .card'), /Sample mode.*made-up data.*Owner.*Sales rep.*Tech/);
    await says(T + 'the sample card says the sample starts fresh each day', p.page.locator('#signin-body .card'), 'Sample data starts fresh each day.');
    await says(T + 'and tells Grayson it becomes his real team app after the setup steps', p.page.locator('#signin-body .card'), 'Grayson: this becomes your real team app once the setup steps are done.');
    await says(T + 'the form says who resets a forgotten PIN', p.page.locator('#signin-body .hint'), 'Forgot your PIN? Ask Grayson to reset it.');
    const pin = await p.field(p.page.locator('#signin-body'), 'pin').evaluate((el) => ({ type: el.type, max: el.getAttribute('maxlength'), mode: el.getAttribute('inputmode') }));
    check(T + 'the PIN box hides what is typed, shows the number keys and takes 6 digits', pin.type === 'password' && pin.max === '6' && pin.mode === 'numeric', JSON.stringify(pin));
    await p.health('the sign-in screen');
  });

  await part(T + 'wrong PINs', list, async () => {
    await p.page.locator('#signin-body button[type="submit"]').tap();
    await says(T + 'signing in with nothing typed asks for the name', p.page.locator('#signin-body .field-error:not([hidden])'), 'Type your name.');
    await p.signInForm('Avery', '7305');
    await says(T + 'a 4-digit PIN is stopped on the phone: "Your PIN is 6 digits."', p.page.locator('#signin-body .field-error:not([hidden])'), 'Your PIN is 6 digits.');
    await p.signInForm('Avery', '730527');
    await says(T + 'a wrong PIN shows the system\'s own words', p.page.locator('#signin-body .form-error'), 'That name and PIN do not match. Check both and try again.');
    await check(T + 'what was typed is still in the boxes after a wrong PIN', (await p.field(p.page, 'name').inputValue()) === 'Avery');
    for (let i = 0; i < 4; i++) {
      await p.signInForm('Avery', '73052' + (i + 1));
      await p.page.locator('#signin-body button[type="submit"]:not([disabled])').waitFor();
    }
    await p.signInForm('Avery', PINS.Avery);
    await says(T + 'after five wrong PINs even the right one is refused, in the system\'s words (locked)', p.page.locator('#signin-body .form-error'),
      'Too many wrong tries. Wait 15 minutes, or ask the owner to reset your PIN.');
    await p.health('the sign-in screen after wrong PINs');
  });

  /* ----- every role: every tab, the Me sheet ----- */
  const TOUR = {
    Owner: { tabs: [['Today', null], ['Sales', 'Sales'], ['Calendar', 'Availability'], ['Clients', 'Clients'], ['Dashboard', 'Dashboard']],
      me: ['Change PIN', 'Company standards', 'Team', 'Settings', 'Notifications', 'Uniforms', 'Reset sample data', 'Sign out'], name: 'Grayson', role: 'Owner' },
    'Sales rep': { tabs: [['Today', null], ['Sales', 'Sales'], ['Calendar', 'Open days'], ['Clients', 'Clients'], ['Leaders', 'Leaderboard']],
      me: ['Change PIN', 'Company standards', 'Uniforms', 'Reset sample data', 'Sign out'], name: 'Mason', role: 'Sales rep' },
    Tech: { tabs: [['Today', null], ['Schedule', 'Schedule'], ['Standards', 'Company standards']],
      me: ['Change PIN', 'Company standards', 'Uniforms', 'Reset sample data', 'Sign out'], name: 'Cole', role: 'Tech' }
  };
  for (const role of Object.keys(TOUR)) {
    await part(T + 'the ' + role + ' looks at every tab', list, async () => {
      const t = TOUR[role];
      await asRole(role);
      const labels = (await p.page.locator('.tabbar .tab').allTextContents()).map(tidy);
      check(T + role + ' signs in with one tap and gets the tabs ' + t.tabs.map((x) => x[0]).join(', '), labels.join() === t.tabs.map((x) => x[0]).join(), 'got ' + labels.join(', '));
      await says(T + role + ': the strip under the top bar says it is sample data', p.page.locator('#strip-text'), 'Sample data. Nothing here is real yet.');
      for (const [label, title] of t.tabs) await p.tab(label, title);
      const icons = await p.page.evaluate(() => Array.prototype.map.call(document.querySelectorAll('.tabbar .tab'), (b) => b.querySelector('svg').innerHTML));
      check(T + role + ': every tab has its own icon (Today is not the calendar)', new Set(icons).size === icons.length);
      await p.tab('Today');
      await sees(T + role + ': Today shows the date as its title and the three numbers', p.screen.locator('.stats .stat').nth(2));
      const today = await p.today();
      const head = tidy(await p.screen.locator('h1.title').textContent());
      check(T + role + ': the title of Today is the full weekday and the short month, on one line ("' + words.dayHead(today) + '")',
        head === words.dayHead(today) && (await p.lines(p.screen.locator('h1.title'))) === 1, head);

      const lay = await todayLayout(p), jobs = lay.items.filter((x) => x.kind === 'job');
      const at = (test) => lay.items.findIndex(test);
      if (role === 'Owner') {
        const marks = jobs.filter((j) => j.mark), first = jobs.filter((j) => !j.done)[0];
        check(T + 'Owner: Today has exactly one ice button, "Mark done" on the first job still to do (the overdue one)',
          lay.ice === 1 && !!first && first.overdue && first.mark === 'ice' && marks.filter((j) => j.mark === 'ice').length === 1, JSON.stringify(jobs));
        check(T + 'Owner: every other "Mark done" is the quiet style, the same size', marks.length >= 3 && marks.every((j) => j === first || j.mark === 'quiet') &&
          marks.every((j) => j.height === first.height && j.height >= 44), JSON.stringify(marks));
      } else if (role === 'Tech') {
        const iOver = at((x) => x.kind === 'label' && x.text === 'Overdue'), iJob = at((x) => x.kind === 'job' && x.overdue), iRem = at((x) => x.kind === 'remind');
        const iToday = at((x) => x.kind === 'label' && x.text === 'Today'), iFirst = at((x) => x.kind === 'job' && !x.overdue);
        check(T + 'Tech: Today runs Overdue, then the company standards reminder, then today\'s jobs',
          iOver >= 0 && iOver < iJob && iJob < iRem && iRem < iToday && iToday < iFirst, JSON.stringify(lay.items.map((x) => x.kind + (x.overdue ? '!' : ''))));
        check(T + 'Tech: one ice "Mark done" only, on the overdue job', lay.ice === 1 && jobs[0].overdue && jobs[0].mark === 'ice', JSON.stringify(jobs));
        await techHoldsNoPrices(p, T + 'Tech: his phone holds no commission rates, no price list, no sales and no clients (the page\'s data and the copy kept on the phone)');
      } else {
        check(T + 'Sales rep: the reminder sits above the appointments and nothing on Today is an ice button (a rep marks nothing done)',
          at((x) => x.kind === 'remind') >= 0 && at((x) => x.kind === 'remind') < at((x) => x.kind === 'job') && lay.ice === 0 && jobs.every((j) => !j.mark), JSON.stringify(lay));
      }

      await p.me();
      const rows = (await p.top.locator('.row .row-title').allTextContents()).map(tidy);
      check(T + role + ': the account sheet lists ' + t.me.join(', '), rows.join() === t.me.join(), 'got ' + rows.join(', '));
      await says(T + role + ': the account sheet names ' + t.name + ' as ' + t.role, p.top.locator('.me-head'), new RegExp(t.name + '\\s*' + t.role));
      await p.health('the account sheet');
      check(T + role + ': the bell is ' + (role === 'Owner' ? 'there' : 'not there'), (await p.page.locator('#bell-btn').isVisible()) === (role === 'Owner'));
      await p.close();
      await p.signOut();
      const left = await p.page.evaluate(() => ({ screen: document.getElementById('screen').children.length, toasts: document.getElementById('toasts').children.length,
        keys: Object.keys(localStorage).filter((k) => /\.(token|snap|who|at)$/.test(k)) }));
      check(T + role + ': after signing out nothing of theirs is left on the page or the phone', !left.screen && !left.toasts && !left.keys.length, JSON.stringify(left));
    });
  }

  /* ----- the rep's whole new-sale-and-book flow ----- */
  await part(T + 'a rep enters a sale and books it', list, async () => {
    await asRole('Sales rep');
    S.today = await p.today();
    const free = await freeDays(p);
    const roomy = free.filter((x) => x.times.length >= 3);
    S.day = roomy[0].date; S.time = roomy[0].times[1];
    S.when = words.when(S.day, S.time, S.today);

    await p.tab('Sales', 'Sales');
    const before = { month: tidy(await p.screen.locator('.nums-cell .stat-label').nth(1).textContent()), big: tidy(await p.screen.locator('.big-num').first().textContent()) };
    await p.btn(p.screen, 'New sale').tap();
    await p.sheet('New sale');
    const sh = p.top;
    const firstLabel = tidy(await sh.locator('.sheet-body .label').first().textContent()), firstBox = tidy(await sh.locator('.sheet-body .field-label').first().textContent());
    check(T + 'the first part of New sale is "Client" and its first box is "Name (person or business)"', firstLabel === 'Client' && firstBox === 'Name (person or business)', firstLabel + ' / ' + firstBox);
    check(T + 'nothing on New sale says "customer", "visit" or "booking"', !/customer|visit|booking/i.test(tidy(await sh.textContent())));

    await p.foot.tap();
    await says(T + 'saving an empty sale marks the name', sh.locator('.field.has-error').first(), 'Add the client\'s name.');
    const marked = (await sh.locator('.field-error:not([hidden]), .slotpick-times .form-error').allTextContents()).map(tidy);
    check(T + 'it marks all six things that are missing', ['Add the client\'s name.', 'Add a phone number.', 'Add the address.', 'Pick what was sold.', 'Enter the price.', 'Pick a time, or tap Book later.']
      .every((m) => marked.indexOf(m) >= 0), 'marked: ' + marked.join(' / '));

    await p.type(p.field(sh, 'sale-name'), S.name);
    await p.type(p.field(sh, 'sale-contact'), 'Pat Birch');
    await p.type(p.field(sh, 'sale-phone'), '615-555-0199');
    await p.type(p.field(sh, 'sale-email'), 'pat@example.com');
    await p.type(p.field(sh, 'sale-address'), '40 Birch Hollow Rd, Smithville, TN 37166');
    await sh.locator('.chip', { hasText: exact('House wash') }).tap();
    check(T + 'choosing House wash fills in its usual price', (await p.field(sh, 'sale-price').inputValue()) === '300', await p.field(sh, 'sale-price').inputValue());
    await p.type(p.field(sh, 'sale-price'), 'abc');
    await p.foot.tap();
    await says(T + 'a price that is not a number is refused in plain words', sh.locator('.field.has-error .field-error').first(), 'Enter the price in dollars, like 150 or 150.50.');
    await p.type(p.field(sh, 'sale-price'), '345.50');
    await sh.locator('.seg-btn', { hasText: exact('Monthly') }).tap();
    await p.type(p.field(sh, 'sale-notes'), 'Two story house. Use the side gate.');
    await p.type(p.field(sh, 'sale-link'), 'pay.example.com/birch');
    await p.foot.tap();
    await says(T + 'a payment link without https:// is refused', sh.locator('.field.has-error .field-error').first(), 'A payment link must start with https://');
    await p.type(p.field(sh, 'sale-link'), LOOKALIKE);
    await p.foot.tap();
    check(T + '(the system has its own words for a look-alike payment link)', /does not look right/.test(LINK_WORDS), LINK_WORDS);
    await says(T + 'a look-alike payment link (a real name, then "@" and another site) is refused in the system\'s words', sh.locator('.field.has-error .field-error').first(), LINK_WORDS);
    await p.type(p.field(sh, 'sale-link'), 'HTTPS://pay.example.com/birch');

    const offered = await p.timesOn(sh, S.day);
    check(T + 'the picker offers ' + words.dayLong(S.day) + ' with its free times', offered.indexOf(S.time) >= 0, 'offered: ' + offered.join(', '));
    const shut = await sh.locator('.month-days span.day').count(), open = await sh.locator('.month-days button.day').count();
    check(T + 'only days with a free time can be tapped; past and blocked days are greyed out', shut > 0 && open > 0, open + ' can be tapped, ' + shut + ' cannot');
    await p.pickTime(sh, S.day, S.time);
    await says(T + 'the button reads "Save sale and book ' + S.when + '"', p.foot, exact('Save sale and book ' + S.when));
    await says(T + 'the line above the button says what the rep earns (30%, then 10% a month)', sh.locator('.sheet-foot .form-note'), 'You earn $103.65 on this sale, then $34.55 every month they stay.');
    await p.health('the filled-in New sale sheet');

    await p.foot.tap();
    await sees(T + 'the sale saves and the sheet says "Sale saved"', sh.locator('.sold-title', { hasText: 'Sale saved' }));
    await says(T + 'the saved view names the client', p.kv(sh, 'Client'), S.name);
    await says(T + 'the saved view says what they bought', p.kv(sh, 'What they bought'), 'House wash, $345.50 a month');
    await says(T + 'the saved view shows the appointment', p.kv(sh, 'Appointment'), S.when);
    await says(T + 'the saved view shows what was earned', sh.locator('.callout-ice'), /You earned\s*\$103\.65\s*Then \$34\.55 every month they stay\./);
    await says(T + 'the saved view has one quiet "New sale" and "Done" as the sheet\'s button', p.foot, exact('Done'));
    await p.health('the Sale saved view');
    await p.foot.tap();
    await until(async () => (await p.layers()) === 0);

    const row = p.row(p.screen, S.name);
    await says(T + 'the sale is in My sales with its price and "Earned $103.65"', row, /House wash, .*\$345\.50\/mo.*Earned \$103\.65/);
    const after = { month: tidy(await p.screen.locator('.nums-cell .stat-label').nth(1).textContent()), big: tidy(await p.screen.locator('.big-num').first().textContent()) };
    check(T + 'My numbers went up by one sale and $103.65 commission', parseInt(after.month, 10) === parseInt(before.month, 10) + 1 && cents(after.big) === cents(before.big) + 10365,
      before.month + ' / ' + before.big + ' became ' + after.month + ' / ' + after.big);

    await p.tab('Clients', 'Clients');
    await says(T + 'the new client is in the rep\'s Clients', p.row(p.screen, S.name), /House wash, \$345\.50 a month.*New/);

    await p.tab('Calendar', 'Open days');
    await p.showMonth(p.screen, S.day.slice(0, 7));
    const mine = p.row(p.screen, S.name);
    await says(T + 'the rep\'s Calendar lists "My appointments" under the grid, with the day, the time and the client', p.screen, new RegExp('My appointments.*' + words.day(S.day, S.today) + '\\s*' + words.time(S.time) + '\\s*' + S.name));
    await mine.tap();
    await p.sheet(S.name);
    await says(T + 'an appointment in that list opens its Job sheet, where the rep can move it', p.top, /Change this appointment.*Move to another time/);
    await p.close();
    await p.day(p.screen, S.day).tap();
    await p.sheet(words.dayLong(S.day));
    const times = tidy(await p.top.locator('.sheet-body p.num').first().textContent()).split(', ');
    check(T + 'on the rep\'s calendar that time is no longer open', times.length > 0 && times.indexOf(words.time(S.time)) < 0 && times.every((x) => /^\d{1,2}:\d{2} [AP]M$/.test(x)), 'open: ' + times.join(', '));
    check(T + 'the open times are words to read, not things that look like buttons', (await p.top.locator('.sheet-body button, .sheet-body .chip, .sheet-body .time-tag').count()) ===
      (await p.top.locator('.sheet-body .row').count()));
    await says(T + 'the day lists the rep\'s own appointment under "My appointments"', p.top.locator('.sheet-body'), new RegExp('My appointments.*' + S.name));
    await p.foot.tap();
    await p.sheet('New sale');
    await says(T + '"New sale on this day" opens New sale on that day', p.top.locator('.slotpick-day'), exact(words.dayLong(S.day)));
    const left = (await p.top.locator('.slotpick-times .chip').allTextContents()).map(tidy);
    check(T + 'the booked time is gone from the picker', left.length > 0 && left.indexOf(words.time(S.time)) < 0, 'offered: ' + left.join(', '));
    await p.closeAll();
  });

  /* ----- signing out ----- */
  await part(T + 'signing out asks first, and takes a half-typed sale with it', list, async () => {
    await p.tab('Sales', 'Sales');
    await p.btn(p.screen, 'New sale').tap();
    await p.sheet('New sale', true);
    await p.type(p.field(p.top, 'sale-name'), 'Half Typed Client');
    await p.type(p.field(p.top, 'sale-phone'), '615-555-0100');
    await p.close();
    check(T + 'a half-typed sale is kept on the phone while its rep is signed in', await until(async () => (await draftKeys()).length === 1, 3000), (await draftKeys()).join());
    await p.me();
    await p.row(p.top, 'Sign out').tap();
    await p.dialog('Sign out of this phone?');
    await p.answer('Stay signed in');
    await sleep(300);
    check(T + '"Sign out" asks first, and "Stay signed in" changes nothing', (await p.page.locator('#app').isVisible()) && (await draftKeys()).length === 1);
    await p.row(p.top, 'Sign out').tap();
    await p.dialog('Sign out of this phone?');
    await p.answer('Sign out');
    await sees(T + 'answering "Sign out" shows the sign-in screen', p.page.locator('#signin:not([hidden])'));
    check(T + 'signing out on purpose removes the half-typed sale from the phone', (await draftKeys()).length === 0, (await draftKeys()).join());
    await asRole('Sales rep');
    await p.tab('Sales', 'Sales');
    await p.btn(p.screen, 'New sale').tap();
    await p.sheet('New sale', true);
    check(T + 'signed in again, New sale starts empty', (await p.field(p.top, 'sale-name').inputValue()) === '' && (await p.top.locator('.callout', { hasText: 'We kept what you typed.' }).count()) === 0);
    await p.close();
    await p.signOut();
  });

  /* ----- the owner sees all of it ----- */
  await part(T + 'the owner sees the sale, the job, the client and a notification', list, async () => {
    await asRole('Owner');
    check(T + 'the owner signing in on the same phone gets his own data, not the rep\'s', await p.page.evaluate(() => window.App.data.me.name === 'Grayson' && window.App.data.sales.length > 5 &&
      JSON.parse(localStorage.getItem('ridgeline.sample.snap')).me.name === 'Grayson' && localStorage.getItem('ridgeline.sample.who') === window.App.data.me.id));
    await sees(T + 'the owner\'s bell shows a dot', p.page.locator('#bell-btn.has-dot'));
    await p.page.locator('#bell-btn').tap();
    await p.sheet('Notifications');
    await says(T + 'the newest notification is the sale and its appointment, written like every screen writes a day, a time and money', p.top.locator('.row.notice').first(),
      'Mason sold House wash to Birch Hollow Farm for $345.50 a month. Booked for ' + S.when + '.');
    await sees(T + 'it is marked as new', p.top.locator('.row.notice.is-new').first());
    await p.top.locator('.row.notice').first().tap();
    await p.sheet(S.name);
    ok(T + 'tapping the notification opens the client it is about');
    await p.close();
    await p.sheet('Notifications', true);
    await p.close();
    await gone(T + 'the bell\'s dot clears once the notifications were opened', p.page.locator('#bell-btn.has-dot'));

    await p.tab('Sales', 'Sales');
    await says(T + 'the owner\'s Sales lists it with who sold it', p.row(p.screen, S.name), /Sold by Mason/);
    await p.row(p.screen, S.name).tap();
    await p.sheet(S.name);
    await says(T + 'the sale sheet shows the appointment', p.top.locator('.row .row-time'), words.time(S.time));
    await says(T + 'the sale sheet lists the commission by date', p.top, /New sale, 30% of the price\s*\$103\.65/);
    await says(T + 'a running monthly sale says when it pays next', p.top.locator('.hint'), 'Next: $34.55 on ' + words.day(D.addMonths(S.today, 1), S.today) + ', if they are still a client.');
    await says(T + 'the owner\'s sale sheet offers "Fix this sale" above "Remove sale"', p.top, /Manage this sale.*Fix this sale.*Remove sale/);
    await p.close();

    await p.tab('Clients', 'Clients');
    await p.type(p.field(p.screen, 'client-search'), 'birch');
    check(T + 'searching Clients for "birch" leaves just that client', await until(async () => (await p.screen.locator('.list .row').count()) === 1));
    await p.row(p.screen, S.name).tap();
    await p.sheet(S.name);
    const cs = p.top;
    await says(T + 'the client sheet shows the contact', p.kv(cs, 'Contact'), 'Pat Birch');
    await says(T + 'the client sheet shows the service and price', p.kv(cs, 'Service and price'), 'House wash, $345.50 a month');
    await says(T + 'the client sheet shows who sold it', p.kv(cs, 'Sold by'), 'Mason');
    const call = await p.btn(cs, 'Call').getAttribute('href'), go = await p.btn(cs, 'Directions').getAttribute('href');
    check(T + 'Call is a real phone link and Directions a real map link', call === 'tel:6155550199' && go === 'https://www.google.com/maps/dir/?api=1&destination=' + encodeURIComponent('40 Birch Hollow Rd, Smithville, TN 37166'), call + ' / ' + go);
    const openLink = p.btn(cs, 'Open');
    await sees(T + 'a payment link typed as HTTPS:// (capitals) is still a link to open', openLink);
    check(T + 'that link opens the address that was typed, in a new tab', (await openLink.getAttribute('href')) === 'HTTPS://pay.example.com/birch' && (await openLink.getAttribute('target')) === '_blank');
    await says(T + 'beside Open it says where the link really goes', cs.locator('.pay-goes'), exact('Opens pay.example.com'));
    await p.btn(cs, 'Copy').tap();
    await sees(T + 'Copy says the payment link was copied', p.toast('Payment link copied.'));
    await says(T + 'the note typed with the sale is in the client\'s notes', cs.locator('.notes .note').first(), /Mason, .*Two story house\. Use the side gate\./);
    await says(T + 'the appointment is under Jobs', cs.locator('.row .row-time').first(), words.time(S.time));
    check(T + 'the client sheet says "client", "appointment" and "job", never "customer", "visit" or "booking"', !/customer|visit|\bbooking/i.test(tidy(await cs.textContent())));
    await p.close();
    await p.type(p.field(p.screen, 'client-search'), '');

    await p.tab('Calendar', 'Availability');
    await p.showMonth(p.screen, S.day.slice(0, 7));
    await p.day(p.screen, S.day).tap();
    await p.sheet(words.dayLong(S.day));
    await says(T + 'the owner\'s day sheet lists the appointment and who sold it', p.row(p.top, S.name), 'Sold by Mason');
    await p.top.locator('.switch').tap();
    await says(T + 'switching a booked day off warns that the appointment stays', p.top.locator('.callout-warn'), /already booked on this day.*Blocking the day does not cancel/);
    await p.close();

    await p.tab('Sales', 'Sales');
    await p.btn(p.screen, 'New sale').tap();
    await p.sheet('New sale', true);
    const offered = await p.timesOn(p.top, S.day);
    check(T + 'the owner\'s picker does not offer the booked time either', offered.length > 0 && offered.indexOf(S.time) < 0, 'offered: ' + offered.join(', '));
    await p.close();
  });

  /* ----- the owner opens and blocks days ----- */
  await part(T + 'the owner opens and blocks days', list, async () => {
    await p.tab('Calendar', 'Availability');
    const free = await freeDays(p);
    const blocked = (await closedDays(p))[0];
    const quietDay = free.filter((x) => x.jobs === 0 && x.date !== S.day && D.weekday(x.date) >= 1 && D.weekday(x.date) <= 5)[0].date;
    S.blockedDay = quietDay;

    /* open a blocked day and set its times */
    await p.showMonth(p.screen, blocked.slice(0, 7));
    await p.day(p.screen, blocked).tap();
    await p.sheet(words.dayLong(blocked));
    const ds = p.top;
    await says(T + 'a blocked day says reps cannot book it', ds, 'This day is blocked. Reps cannot book it.');
    await ds.locator('.switch').tap();
    await sees(T + 'switching it on shows the usual times', ds.locator('.chip-x').nth(3));
    await ds.locator('.chip-x[aria-label="Remove 8:00 AM"]').tap();
    await p.field(ds, 'new-time').fill('10:15');
    await p.btn(ds, 'Add').tap();
    await sees(T + 'a time can be removed and another added', ds.locator('.chip-x[aria-label="Remove 10:15 AM"]'));
    await p.field(ds, 'new-time').fill('10:15');
    await p.btn(ds, 'Add').tap();
    await says(T + 'the same time twice is refused', ds.locator('.sheet-body .form-error:not([hidden])'), '10:15 AM is already on the list.');
    await p.health('the day sheet with its times');
    /* a time that was picked and never "Added": Save must not drop it */
    await p.field(ds, 'new-time').fill('15:45');
    await p.foot.tap();
    await sees(T + 'a time still sitting in the "Add a time" box is saved with the day (open with 5 times)', p.toast(words.day(blocked, S.today) + ' is open with 5 times.'));
    await says(T + 'the calendar now shows that day with 5 left', p.day(p.screen, blocked), '5 left');

    /* block an open day */
    await p.showMonth(p.screen, quietDay.slice(0, 7));
    await p.day(p.screen, quietDay).tap();
    await p.sheet(words.dayLong(quietDay), true);
    await p.top.locator('.switch').tap();
    await p.foot.tap();
    await sees(T + 'blocking an open day says so', p.toast(words.day(quietDay, S.today) + ' is blocked.'));
    check(T + 'the calendar shows that day as blocked', await until(async () => /is-blocked/.test(await p.day(p.screen, quietDay).getAttribute('class'))));

    await p.tab('Sales', 'Sales');
    await p.btn(p.screen, 'New sale').tap();
    await p.sheet('New sale', true);
    await p.showMonth(p.top, quietDay.slice(0, 7));
    check(T + 'in the picker the blocked day is greyed out and cannot be tapped', (await p.day(p.top, quietDay).evaluate((el) => el.tagName + ' ' + el.className)).indexOf('SPAN') === 0);
    check(T + 'and the day that was just opened can be picked, with the time that was never "Added"', (await p.timesOn(p.top, blocked)).join() === '09:30,10:15,12:00,14:00,15:45');
    await p.close();

    /* open weekdays (it asks first), block all */
    await p.tab('Calendar', 'Availability');
    await p.showMonth(p.screen, quietDay.slice(0, 7));
    const openDays = await p.page.evaluate(() => window.App.data.days.filter((d) => d.open).map((d) => d.date));
    const ym = quietDay.slice(0, 7), toOpen = [];
    for (let i = 1; i <= D.daysInMonth(+ym.slice(0, 4), +ym.slice(5, 7)); i++) {
      const d = ym + '-' + String(i + 100).slice(1);
      if (d >= S.today && D.weekday(d) >= 1 && D.weekday(d) <= 5 && openDays.indexOf(d) < 0) toOpen.push(d);
    }
    const span = toOpen.length === 1 ? words.day(toOpen[0], S.today) : words.dayShort(toOpen[0]) + ' to ' + words.dayShort(toOpen[toOpen.length - 1]);
    const question = 'Open ' + words.plural(toOpen.length, 'weekday') + ', ' + span + ', with your usual times?';
    await p.btn(p.screen, 'Open weekdays').tap();
    await sees(T + '"Open weekdays" asks first, with the count and the dates: "' + question + '"', p.page.locator('.dialog .dialog-title', { hasText: exact(question) }));
    await says(T + 'and names the usual times', p.page.locator('.dialog .dialog-text'), 'Your usual times are 8:00 AM, 9:30 AM, 12:00 PM, 2:00 PM.');
    await p.health('the "Open weekdays" question');
    await p.answer('Cancel');
    await sleep(300);
    check(T + '"Cancel" opens nothing', /is-blocked/.test(await p.day(p.screen, quietDay).getAttribute('class')) && (await p.toasts.filter({ hasText: /opened in/ }).count()) === 0);
    await p.btn(p.screen, 'Open weekdays').tap();
    await p.page.locator('.dialog .dialog-title').waitFor();
    await p.answer(toOpen.length === 1 ? 'Open it' : 'Open them');
    await sees(T + 'answering yes opens them and says how many', p.toast(words.plural(toOpen.length, 'weekday') + ' opened in ' + words.month(ym).split(' ')[0] + '.'));
    check(T + 'the day blocked a moment ago is open again', await until(async () => /is-open/.test(await p.day(p.screen, quietDay).getAttribute('class'))));
    const openNow = await p.screen.locator('.month-days .day.is-open, .month-days .day.is-full, .month-days .day.is-spent').count();
    await p.btn(p.screen, 'Block all').tap();
    await p.dialog('Block all of');
    await p.answer('Keep them');
    check(T + '"Block all" asks first, and "Keep them" changes nothing', (await p.screen.locator('.month-days .day.is-open, .month-days .day.is-full, .month-days .day.is-spent').count()) === openNow);

    const far = D.addMonths(S.today.slice(0, 8) + '01', 3).slice(0, 7);
    await p.showMonth(p.screen, far);
    await p.btn(p.screen, 'Open weekdays').tap();
    await p.page.locator('.dialog .dialog-title', { hasText: /^Open \d+ weekdays, \w{3} \d+ to \w{3} \d+, with your usual times\?$/ }).waitFor();
    await p.answer('Open them');
    const farName = words.month(far).split(' ')[0];
    await sees(T + 'a month far ahead opens all its weekdays after one question', p.toasts.filter({ hasText: new RegExp('\\d+ weekdays opened in ' + farName) }));
    const made = await p.screen.locator('.month-days .day.is-open').count();
    await p.btn(p.screen, 'Block all').tap();
    await p.dialog('Block all of');
    await p.answer('Block all');
    await sees(T + '"Block all" blocks them again after the question', p.toast(made + ' days blocked in ' + farName));
    check(T + 'that month has no open day left', await until(async () => (await p.screen.locator('.month-days .day.is-open').count()) === 0));
    await p.health('the calendar a few months ahead');
  });

  /* ----- assigning ----- */
  await part(T + 'the owner assigns jobs', list, async () => {
    await p.tab('Dashboard', 'Dashboard');
    await p.row(p.screen, 'Jobs with nobody assigned').tap();
    await p.sheet('Nobody assigned');
    await p.row(p.top, S.name).tap();
    await p.sheet(S.name);
    await p.row(p.top, 'Assign to').tap();
    await p.sheet('Assign to');
    const people = (await p.top.locator('.row .row-title').allTextContents()).map(tidy);
    check(T + 'the Assign sheet offers Nobody first, then only techs and owners (Cole, Grayson), no sales reps', people.join() === 'Nobody,Cole,Grayson', 'offered: ' + people.join(', '));
    await p.row(p.top, 'Cole').tap();
    await sees(T + 'assigning says "Assigned to Cole."', p.toast('Assigned to Cole.'));
    await p.sheet(S.name, true);
    await says(T + 'the job sheet now shows Cole', p.row(p.top, 'Assign to'), 'Cole');
    await p.close();
    await p.sheet('Nobody assigned', true);
    check(T + 'the list of unassigned jobs is one shorter', await until(async () => (await p.top.locator('.row').count()) === 1));
    await p.close();

    await p.tab('Today');
    const card = p.card('Oak Hill Driveway');
    await card.locator('button.pill-warn').tap();
    await p.sheet('Assign to', true);
    await p.row(p.top, 'Cole').tap();
    await gone(T + 'the amber "Unassigned" chip on Today opens Assign and goes away once assigned', card.locator('button.pill-warn'));
    await says(T + 'the card now names Cole', card.locator('.meta'), 'Cole');
    await p.tab('Dashboard', 'Dashboard');
    await gone(T + 'the Dashboard no longer lists a job with nobody assigned', p.row(p.screen, /nobody assigned/));
  });

  /* ----- the job sheet: move, change, cancel ----- */
  await part(T + 'the owner moves, changes and cancels a job', list, async () => {
    await p.tab('Calendar', 'Availability');
    await p.showMonth(p.screen, S.today.slice(0, 7));
    const job = 'Dry Creek Cabin';
    await p.row(p.screen, job).tap();
    await p.sheet(job);
    await p.row(p.top, 'Move to another time').tap();
    await p.sheet('Move to another time');
    const free = (await freeDays(p)).filter((x) => x.times.length >= 2 && x.date !== S.day);
    const to = { date: free[1].date, time: free[1].times[0] };
    await p.pickTime(p.top, to.date, to.time);
    await says(T + 'the Move button names the new time', p.foot, 'Move to ' + words.when(to.date, to.time, S.today));
    await p.foot.tap();
    await sees(T + 'moving says where it moved to', p.toast('Moved to ' + words.when(to.date, to.time, S.today) + '.'));
    await p.sheet(job, true);
    await says(T + 'the job sheet shows the new time', p.top.locator('.card-title'), words.when(to.date, to.time, S.today));

    await p.row(p.top, 'Change what needs doing').tap();
    await p.sheet('Change what needs doing');
    await p.type(p.field(p.top, 'what'), 'Cabin wash and the back deck');
    await p.foot.tap();
    await p.sheet(job, true);
    await says(T + 'what needs doing can be changed', p.top.locator('.job-what'), 'Cabin wash and the back deck');

    await p.btn(p.top, 'Cancel job').tap();
    await p.dialog('Cancel this job?');
    await says(T + 'the question says the time can be booked again', p.page.locator('.dialog-text'), 'That time can be booked again.');
    await p.answer('Keep it');
    await p.btn(p.top, 'Cancel job').tap();
    await p.dialog('Cancel this job?');
    await p.answer('Cancel job');
    await sees(T + 'cancelling a job asks first, then says "Job cancelled." with Undo', p.toast('Job cancelled.'));
    await gone(T + 'the cancelled job leaves Coming up', p.row(p.screen, job));
    await p.toast('Job cancelled.').locator('.toast-btn').tap();
    await sees(T + 'Undo puts it back on the schedule', p.row(p.screen, job));
  });

  /* ----- what the Dashboard says needs doing ----- */
  await part(T + 'the owner books a sale that was waiting, and a monthly client with nothing booked', list, async () => {
    await p.tab('Dashboard', 'Dashboard');
    await p.row(p.screen, 'Sale waiting for an appointment').tap();
    await p.sheet('Walnut Street Duplex');
    await sees(T + 'the Dashboard\'s waiting sale opens the sale itself, with "Book the appointment" one tap away', p.btn(p.top, 'Book the appointment'));
    await p.btn(p.top, 'Book the appointment').tap();
    await p.sheet('Book the appointment');
    const free = (await freeDays(p)).filter((x) => x.times.length >= 2);
    const at = { date: free[2].date, time: free[2].times[0] };
    await p.pickTime(p.top, at.date, at.time);
    await p.foot.tap();
    await sees(T + 'booking it says when', p.toast('Booked for ' + words.when(at.date, at.time, S.today) + '.'));
    await p.sheet('Walnut Street Duplex', true);
    await says(T + 'the sale now shows its appointment', p.top.locator('.row .row-time'), words.time(at.time));
    await p.close();
    await gone(T + 'nothing is waiting for an appointment on the Dashboard any more', p.row(p.screen, /waiting for an appointment/));

    /* a New or Active monthly client with no job from today on */
    const noNext = p.row(p.screen, 'Monthly clients with no next appointment');
    await says(T + 'the Dashboard lists "Monthly clients with no next appointment" and names them', noNext, 'Lakeview Dental Office and Main Street Storefront');
    await noNext.tap();
    await p.sheet('No next appointment');
    await p.row(p.top, 'Main Street Storefront').tap();
    await p.sheet('Main Street Storefront');
    const book = p.btn(p.top, 'Book an appointment');
    await says(T + 'it opens that client where the appointments are, saying why', p.top.locator('.sheet-body'), 'This monthly client has no next appointment.');
    const seen = await book.evaluate((el) => { const b = el.getBoundingClientRect(); return b.top >= 0 && b.bottom <= window.innerHeight && el.classList.contains('btn-primary'); });
    check(T + 'with "Book an appointment" in view as the one ice button', seen);
    await book.tap();
    await p.sheet('Book an appointment');
    const next = (await freeDays(p)).filter((x) => x.times.length >= 2)[3];
    await p.pickTime(p.top, next.date, next.times[0]);
    await p.foot.tap();
    await sees(T + 'an appointment booked from there says when', p.toast('Booked for ' + words.when(next.date, next.times[0], S.today) + '.'));
    await p.closeAll();
    const one = p.row(p.screen, 'Monthly client with no next appointment');
    await says(T + 'the Dashboard is down to one such client', one, 'Lakeview Dental Office');
    await one.tap();
    await p.sheet('Lakeview Dental Office');
    ok(T + 'and with one left the row opens that client straight away');
    await p.close();
  });

  /* ----- settings ----- */
  await part(T + 'the owner changes the settings', list, async () => {
    await p.me();
    await p.row(p.top, 'Settings').tap();
    await p.sheet('Settings');
    const settings = p.top;

    await p.row(settings, 'Services').tap();
    await p.sheet('Services');
    await p.btn(p.top, 'Add a service').tap();
    await p.type(p.field(p.top, 'svc-name-3'), 'Gutter cleaning');
    await p.type(p.field(p.top, 'svc-price-3'), '120');
    await p.foot.tap();
    await sees(T + 'a service can be added', p.toast('Services saved.'));
    await p.sheet('Settings', true);
    await says(T + 'Settings lists the new service', p.row(p.top, 'Services'), 'Gutter cleaning');

    await p.row(p.top, 'Commission').tap();
    await p.sheet('Commission');
    await p.type(p.field(p.top, 'pct-first'), '150');
    await p.foot.tap();
    await says(T + 'a commission over 100 is refused', p.top.locator('.field-error:not([hidden])'), 'Enter a number from 0 to 100, like 30 or 12.5.');
    await p.type(p.field(p.top, 'pct-first'), '25');
    await p.type(p.field(p.top, 'pct-monthly'), '12.5');
    await says(T + 'the commission sheet works an example as you type', p.top, 'On a $200.00 monthly sale a rep earns $50.00, then $25.00 every month the client stays.');
    await p.foot.tap();
    await p.sheet('Settings', true);
    await says(T + 'the commission rates are saved', p.row(p.top, 'Commission'), '25% on a new sale, 12.5% each month after');

    await p.row(p.top, 'Usual appointment times').tap();
    await p.sheet('Usual appointment times');
    await p.field(p.top, 'slot-new').fill('16:00');
    await p.btn(p.top, 'Add').tap();
    await sees(T + 'a usual time can be added', p.top.locator('.chip-x[aria-label="Remove 4:00 PM"]'));
    await p.field(p.top, 'slot-new').fill('17:15');
    await p.foot.tap();
    await p.sheet('Settings', true);
    await says(T + 'the usual times are saved, with the one that was picked and never "Added"', p.row(p.top, 'Usual appointment times'), '8:00 AM, 9:30 AM, 12:00 PM, 2:00 PM, 4:00 PM, 5:15 PM');

    await p.row(p.top, 'Give new jobs to').tap();
    await p.sheet('Give new jobs to');
    const who = (await p.top.locator('.row .row-title').allTextContents()).map(tidy);
    check(T + '"Give new jobs to" offers Nobody, techs and owners, no sales reps', who.join() === 'Nobody,Cole,Grayson', 'offered: ' + who.join(', '));
    await p.row(p.top, 'Cole').tap();
    await sees(T + 'choosing Cole says new jobs go to him', p.toast('New jobs go to Cole.'));
    await p.sheet('Settings', true);

    await p.row(p.top, 'Email alerts').tap();
    await p.sheet('Email alerts');
    await says(T + 'in sample mode the email sheet says emails start once the system is connected', p.top.locator('.callout'), 'Emails start once the system is connected.');
    await p.type(p.field(p.top, 'notify-email'), 'not an email');
    await p.foot.tap();
    await says(T + 'a bad email address is refused', p.top.locator('.field-error:not([hidden])'), 'That email address does not look right.');
    await p.type(p.field(p.top, 'notify-email'), 'grayson@example.com');
    await p.foot.tap();
    await p.sheet('Settings', true);
    await says(T + 'the email setting is saved', p.row(p.top, 'Email alerts'), 'On, sent to grayson@example.com');

    await p.row(p.top, 'Company standards').tap();
    await p.sheet('Edit standards');
    await p.close();
    await p.sheet('Settings', true);
    await p.closeAll();
  });

  /* ----- the owner sells: for a rep, and for himself ----- */
  await part(T + 'the owner enters sales for a rep and for himself', list, async () => {
    await p.tab('Dashboard', 'Dashboard');
    const owedBefore = tidy(await statNum('Commission owed this month').textContent());
    await p.tab('Sales', 'Sales');
    await p.btn(p.screen, 'New sale').tap();
    await p.sheet('New sale', true);
    await sees(T + 'New sale offers the new service', p.top.locator('.chip', { hasText: exact('Gutter cleaning') }));
    await p.top.locator('.chip', { hasText: exact('Gutter cleaning') }).tap();
    await says(T + 'with the owner as the seller the line above the button says there is no commission', p.top.locator('.sheet-foot .form-note'), exact('No commission on the owner\'s own sales.'));
    const sellers = (await p.field(p.top, 'sale-rep').locator('option').allTextContents()).map(tidy);
    check(T + '"Sold by" offers the owner first, then every sales rep', sellers.join() === 'Grayson (you),Avery,Mason', sellers.join());

    /* the owner sells to an existing client for one of his reps, and books later */
    await p.top.locator('.seg-btn', { hasText: exact('Existing client') }).tap();
    await p.type(p.field(p.top, 'sale-find'), 'parker');
    await p.row(p.top, 'Parker Residence').tap();
    await sees(T + 'an existing client can be searched for and picked', p.top.locator('.card', { hasText: 'Parker Residence' }));
    await p.field(p.top, 'sale-rep').selectOption({ label: 'Avery' });
    await says(T + 'choosing who sold it changes whose earnings the line shows, at the new rate', p.top.locator('.sheet-foot .form-note'), 'Avery earns $30.00 on this sale.');
    await p.btn(p.top, 'Book later').tap();
    await says(T + '"Book later" turns the button into plain "Save sale"', p.foot, exact('Save sale'));
    await p.foot.tap();
    await sees(T + 'the sale saves without an appointment', p.top.locator('.sold-title'));
    await says(T + 'the saved view says it is not booked yet and who earned', p.top, /Not booked yet.*Avery earned\s*\$30\.00/);
    await p.foot.tap();
    await until(async () => (await p.layers()) === 0);
    const row = p.row(p.screen, 'Parker Residence').filter({ hasText: 'Gutter cleaning' });
    await says(T + 'it is listed under Avery with "No appointment yet"', row, /Sold by Avery.*No appointment yet/);
    await p.tab('Clients', 'Clients');
    await says(T + 'a sale to an existing client changes what that client buys', p.row(p.screen, 'Parker Residence'), 'Gutter cleaning, $120.00 one-time');
    await p.tab('Sales', 'Sales');
    await row.tap();
    await p.sheet('Parker Residence');
    await p.btn(p.top, 'Remove sale').tap();
    await p.dialog('Remove this sale?');
    await p.answer('Remove sale');
    await sees(T + 'the owner can remove a sale after a question', p.toast('Sale removed.'));
    await gone(T + 'the removed sale leaves the list', row);
    await p.tab('Clients', 'Clients');
    await says(T + 'and removing it puts the client back to what they bought before', p.row(p.screen, 'Parker Residence'), 'Window cleaning, $150.00 one-time');

    /* the owner's own sale earns no commission */
    await p.tab('Sales', 'Sales');
    await p.btn(p.screen, 'New sale').tap();
    await p.sheet('New sale', true);
    const sh = p.top;
    await p.type(p.field(sh, 'sale-name'), 'Owner Sold Shed');
    await p.type(p.field(sh, 'sale-phone'), '615-555-0121');
    await p.type(p.field(sh, 'sale-address'), '5 Shed Rd, Smithville, TN 37166');
    await sh.locator('.chip', { hasText: exact('Pressure wash') }).tap();
    await p.btn(sh, 'Book later').tap();
    await says(T + 'the owner selling as himself is told "No commission on the owner\'s own sales."', sh.locator('.sheet-foot .form-note'), exact('No commission on the owner\'s own sales.'));
    await p.foot.tap();
    await sees(T + 'his own sale saves', sh.locator('.sold-title', { hasText: 'Sale saved' }));
    check(T + 'and its saved view shows no earned amount', (await sh.locator('.callout-ice').count()) === 0 && !/earned/i.test(tidy(await sh.textContent())), tidy(await sh.textContent()).slice(0, 200));
    await p.foot.tap();
    await until(async () => (await p.layers()) === 0);
    const own = p.row(p.screen, 'Owner Sold Shed');
    await says(T + 'in the list it reads "No commission"', own, /Pressure wash, .*Sold by Grayson.*\$200\.00.*No commission/);
    await own.tap();
    await p.sheet('Owner Sold Shed');
    await says(T + 'its sheet says there is no commission on the owner\'s own sales', p.top, /Commission\s*No commission on the owner's own sales\./);
    check(T + 'and shows no "Earned so far"', (await p.kv(p.top, 'Earned so far').count()) === 0);
    await p.close();
    await p.tab('Dashboard', 'Dashboard');
    check(T + 'the owner\'s own sale leaves "Commission owed this month" where it was (' + owedBefore + ')', tidy(await statNum('Commission owed this month').textContent()) === owedBefore,
      tidy(await statNum('Commission owed this month').textContent()));
  });

  /* ----- company standards: the owner edits ----- */
  await part(T + 'the owner edits the company standards', list, async () => {
    await p.me();
    await p.row(p.top, 'Company standards').tap();
    await p.screen.locator('h1.title', { hasText: 'Company standards' }).waitFor();
    await p.health('the Company standards page');
    await sees(T + 'the standards page shows his photo with the tagline across it', p.screen.locator('.std-photo img'));
    check(T + 'the photo really loaded', await until(() => p.screen.locator('.std-photo img').evaluate((img) => img.complete && img.naturalWidth > 0)));
    await says(T + 'the owner sees how many have read them, right under the title', p.screen.locator('.std-owner'), '1 of 3 have read these.');
    await p.btn(p.screen.locator('.std-owner'), 'Edit standards').tap();
    await p.sheet('Edit standards');
    const ed = p.top;
    await says(T + 'the editor says a change asks everyone to confirm again', ed.locator('.sheet-foot'), 'Saving a change asks everyone to read these again and confirm.');
    const boxes = await ed.locator('.card').first().locator('textarea.std-line').count();
    check(T + 'each standard has a box of its own (8 in the first section)', boxes === 8, String(boxes));
    const last = p.field(ed, 'std-item-0-' + (boxes - 1));
    await last.tap();
    await last.press('Control+End');
    await last.press('Enter');
    await p.field(ed, 'std-item-0-' + boxes).waitFor();
    await p.field(ed, 'std-item-0-' + boxes).pressSequentially('Close every gate behind you.');
    ok(T + 'Enter at the end of a standard starts the next one in a new box');
    await p.btn(ed, 'Add a section').tap();
    await p.type(p.field(ed, 'std-title-5'), 'Scratch section');
    await ed.locator('.card').nth(5).locator('.btn', { hasText: 'Remove section' }).tap();
    await p.dialog('Remove this section?');
    await p.answer('Remove section');
    check(T + 'a section can be added and removed again', await until(async () => (await ed.locator('.card').count()) === 5));
    await p.foot.tap();
    await sees(T + 'saving says the team will be asked to read them again', p.toast('Standards saved. Your team will be asked to read them again.'));
    await says(T + 'the page shows the new line', p.screen.locator('.std-sec').first(), 'Close every gate behind you.');
    await says(T + 'nobody has read the changed standards yet', p.screen.locator('.std-owner'), '0 of 3 have read these.');
  });

  /* ----- team: add, reset PIN ----- */
  await part(T + 'the owner adds a person and resets PINs', list, async () => {
    await p.me();
    await p.row(p.top, 'Team').tap();
    await p.sheet('Team');
    await says(T + 'Team shows who has not read the changed standards', p.row(p.top, 'Avery'), 'Has not read the changed standards yet');
    await p.foot.tap();
    await p.sheet('Add person');
    await p.foot.tap();
    await says(T + 'adding a person needs a name', p.top.locator('.field-error:not([hidden])'), 'Add a name.');
    await p.type(p.field(p.top, 'new-name'), 'Mason');
    await p.foot.tap();
    await says(T + 'a name already on the team is refused', p.top.locator('.field-error:not([hidden])'), 'Someone on the team already has that name. Add a last initial.');
    await p.type(p.field(p.top, 'new-name'), 'Jake');
    await p.top.locator('.seg-btn', { hasText: exact('Tech') }).tap();
    await says(T + 'the PIN box says a PIN is 6 digits and may be left blank', p.top.locator('.field', { has: p.page.locator('[name="new-pin"]') }), '6 digits. Leave it blank and one is made for them.');
    await p.type(p.field(p.top, 'new-pin'), '4821');
    await p.foot.tap();
    await says(T + 'a 4-digit PIN is refused in the system\'s words ("' + Core.check.pin('4821') + '")', p.top.locator('.field-error:not([hidden])'), exact(Core.check.pin('4821')));
    await p.type(p.field(p.top, 'new-pin'), '123456');
    await p.foot.tap();
    await says(T + 'a PIN that is easy to guess (123456) is refused by the system, in its words, by the button', p.top.locator('.sheet-foot .form-error'), exact(Core.check.pin('123456')));
    check(T + '(those words are "A PIN is 6 digits." and "Pick a PIN that is harder to guess.")', Core.check.pin('4821') === 'A PIN is 6 digits.' && Core.check.pin('123456') === 'Pick a PIN that is harder to guess.');
    check(T + 'the name and the role are still as typed after the refusal', (await p.field(p.top, 'new-name').inputValue()) === 'Jake' && (await p.top.locator('.seg-btn.is-on').textContent()) === 'Tech');
    await p.type(p.field(p.top, 'new-pin'), '');
    await p.foot.tap();
    await sees(T + 'with the PIN left blank the person is added: "Person added"', p.top.locator('.sold-title', { hasText: 'Person added' }));
    await p.health('the Person added view');
    S.jakePin = tidy(await p.top.locator('.callout-big').textContent());
    check(T + 'a new person gets a 6-digit PIN, shown once in a clear box, and not an easy one', /^\d{6}$/.test(S.jakePin) && Core.check.pin(S.jakePin) === '', S.jakePin);
    await says(T + 'the box says to tell them in person', p.top.locator('.callout'), /PIN for Jake.*Tell them in person\. It is not shown again\./);
    await p.foot.tap();
    await p.sheet('Team', true);
    await sees(T + 'Jake is listed in Team', p.row(p.top, 'Jake'));

    await p.row(p.top, 'Avery').tap();
    await p.sheet('Avery');
    await says(T + 'a person\'s sheet says what to do about a lost phone', p.top, 'Lost phone? Reset their PIN. It signs them out everywhere.');
    await p.row(p.top, 'Reset PIN').tap();
    await p.dialog('Reset the PIN for Avery?');
    await p.answer('Reset PIN');
    await p.sheet('New PIN');
    S.averyPin = tidy(await p.top.locator('.callout-big').textContent());
    check(T + 'Reset PIN shows the new 6-digit PIN once', /^\d{6}$/.test(S.averyPin) && S.averyPin !== PINS.Avery, S.averyPin);
    await p.foot.tap();
    await p.closeAll();
    await p.signOut();

    await p.signInForm('jake', S.jakePin);
    await p.signedIn();
    const labels = (await p.page.locator('.tabbar .tab').allTextContents()).map(tidy);
    check(T + 'Jake signs in with his name and that PIN and gets the tech\'s tabs', labels.join() === 'Today,Schedule,Standards', labels.join());
    await says(T + 'a tech with nothing to do is told so', p.screen.locator('.empty'), 'Nothing scheduled today.');
    await p.tab('Schedule', 'Schedule');
    await says(T + 'an empty Schedule says "No jobs coming up."', p.screen.locator('.empty'), 'No jobs coming up.');
    await p.signOut();
  });

  /* ----- the tech ----- */
  await part(T + 'the tech marks jobs done and adds a note', list, async () => {
    await asRole('Tech');
    await sees(T + 'the tech is reminded to read the company standards', p.screen.locator('.remind', { hasText: 'Read these and confirm.' }));
    await sees(T + 'an overdue job is pinned first in red', p.screen.locator('article.job').first().locator('.pill-bad', { hasText: 'Overdue' }));
    const card = p.card('Oak Hill Driveway');
    await sees(T + 'the job the owner assigned is on the tech\'s Today', card);
    const doneNum = p.screen.locator('.stats .stat').nth(1).locator('.stat-num');
    const doneBefore = tidy(await doneNum.textContent());
    await p.btn(card, 'Mark done').tap();
    await says(T + '"Mark done" turns the card to done and says who did it', card, /Done .* by Cole/);
    const marked = p.toast('Marked done.');
    await sees(T + 'and answers with "Marked done." and an Undo', marked.locator('.toast-btn', { hasText: exact('Undo') }));
    check(T + 'the Done number on Today goes up', await until(async () => tidy(await doneNum.textContent()) === String(+doneBefore + 1)));
    await marked.locator('.toast-btn').tap();
    await sees(T + 'the toast\'s Undo puts the job back', p.btn(card, 'Mark done'));
    check(T + 'and the Done number goes back down', await until(async () => tidy(await doneNum.textContent()) === doneBefore));
    await p.btn(card, 'Mark done').tap();
    await sees(T + 'it can be marked done again', card.locator('.pill-good', { hasText: 'Done' }));
    await p.btn(card, 'Undo').tap();
    await sees(T + 'the card\'s own Undo works too', p.btn(card, 'Mark done'));
    await p.btn(card, 'Mark done').tap();
    await card.locator('.pill-good', { hasText: 'Done' }).waitFor();

    /* an overdue job leaves the red section when it is done: the toast is how it comes back */
    const late = p.card('Lakeview Dental Office');
    await p.btn(late, 'Mark done').tap();
    await gone(T + 'an overdue job that is marked done leaves the Overdue section', late);
    await sees(T + 'and it too answers "Marked done." with Undo', p.toast('Marked done.').last().locator('.toast-btn', { hasText: exact('Undo') }));
    await p.toast('Marked done.').last().locator('.toast-btn').tap();
    await sees(T + 'Undo brings the overdue job back', late.locator('.pill-bad', { hasText: 'Overdue' }));

    const parker = p.card('Parker Residence');
    await p.btn(parker, 'Add note').tap();
    await p.sheet('Add note');
    await p.foot.tap();
    await says(T + 'an empty note is refused', p.top.locator('.field-error:not([hidden])'), 'Write the note first.');
    await p.type(p.field(p.top, 'note'), 'Dog in the yard. Knock first.');
    await p.foot.tap();
    await sees(T + 'a note saves', p.toast('Note saved.'));
    await says(T + 'the newest note shows on the job card', parker.locator('.meta-row.is-note'), 'Dog in the yard. Knock first.');
    const call = await p.btn(parker, 'Call').getAttribute('href');
    check(T + 'the card\'s Call button is a phone link', call === 'tel:6155550142', call);

    await p.tab('Schedule', 'Schedule');
    await p.row(p.screen, S.name).tap();
    await p.sheet(S.name);
    await p.btn(p.top, 'Mark done').tap();
    await says(T + 'the tech marks the new job done from its sheet', p.top.locator('.callout-good'), /Done .* by Cole/);
    await p.close();
    const recent = await until(() => p.page.evaluate((name) => {
      const labels = Array.prototype.filter.call(document.querySelectorAll('#screen .label'), (l) => l.textContent.trim() === 'Recently done');
      const list = labels.length ? labels[0].nextElementSibling : null;
      const row = list ? Array.prototype.filter.call(list.querySelectorAll('.row'), (r) => r.textContent.indexOf(name) >= 0)[0] : null;
      return row ? { pills: row.querySelectorAll('.pill').length } : null;
    }, S.name));
    check(T + 'it moves to "Recently done", where the rows carry no "Done" pill (the label says it)', !!recent && recent.pills === 0, JSON.stringify(recent));

    await p.tab('Standards', 'Company standards');
    await p.btn(p.screen, 'I have read these').tap();
    await sees(T + 'the tech confirms the standards', p.screen.locator('.std-ok', { hasText: 'You confirmed these on ' + words.dayShort(S.today) + '.' }));
    await p.tab('Today');
    await gone(T + 'the reminder is gone from Today', p.screen.locator('.remind'));

    /* change PIN */
    await p.me();
    await p.row(p.top, 'Change PIN').tap();
    await p.sheet('Change PIN');
    await says(T + 'Change PIN says a PIN is 6 digits', p.top, '6 digits. Pick one only you know.');
    await p.type(p.field(p.top, 'pin-now'), '906133');
    await p.type(p.field(p.top, 'pin-new'), '5082');
    await p.type(p.field(p.top, 'pin-again'), '5082');
    await p.foot.tap();
    await says(T + 'a new PIN of 4 digits is refused: "A PIN is 6 digits."', p.top.locator('.field-error:not([hidden])'), exact('A PIN is 6 digits.'));
    await p.type(p.field(p.top, 'pin-new'), '508217');
    await p.type(p.field(p.top, 'pin-again'), '508218');
    await p.foot.tap();
    await says(T + 'two new PINs that differ are caught', p.top.locator('.field-error:not([hidden])'), 'The two new PINs do not match.');
    await p.type(p.field(p.top, 'pin-again'), '508217');
    await p.foot.tap();
    await says(T + 'a wrong current PIN shows the system\'s words by the button', p.top.locator('.sheet-foot .form-error'), 'Your current PIN is not right.');
    await p.type(p.field(p.top, 'pin-now'), PINS.Cole);
    await p.type(p.field(p.top, 'pin-new'), '121212');
    await p.type(p.field(p.top, 'pin-again'), '121212');
    await p.foot.tap();
    await says(T + 'a new PIN that is easy to guess (121212) is refused in the system\'s words', p.top.locator('.sheet-foot .form-error'), exact('Pick a PIN that is harder to guess.'));
    await p.type(p.field(p.top, 'pin-new'), '508217');
    await p.type(p.field(p.top, 'pin-again'), '508217');
    await p.foot.tap();
    await sees(T + 'the PIN changes', p.toast('Your PIN is changed. Your other phones were signed out.'));
    await p.signOut();
    await gone(T + 'the sample "Tech" button goes away once his starting PIN no longer works', quick('Tech'));
    await sees(T + 'and the sign-in screen offers to reset the sample', p.btn(p.page.locator('#signin-body'), 'Reset sample data'));
    await p.signInForm('Cole', PINS.Cole);
    await says(T + 'the old PIN no longer signs in', p.page.locator('#signin-body .form-error'), 'That name and PIN do not match.');
    await p.signInForm('Cole', '508217');
    await p.signedIn();
    ok(T + 'the new PIN signs in');
    await p.signOut();
  });

  /* ----- the owner again: done, notes, client edits, payment ----- */
  await part(T + 'the owner sees the work done and edits the client', list, async () => {
    await asRole('Owner');
    await says(T + 'the job the tech finished shows done for the owner', p.card('Oak Hill Driveway'), /Done .* by Cole/);
    await p.card('Parker Residence').locator('.job-name').tap();
    await p.sheet('Parker Residence');
    await says(T + 'the tech\'s note is in the job\'s note history', p.top.locator('.notes .note').first(), /Cole, .*Dog in the yard\. Knock first\./);
    await p.close();

    await p.tab('Clients', 'Clients');
    await p.row(p.screen, S.name).tap();
    await p.sheet(S.name, true);
    const cs = p.top;
    await sees(T + 'the client\'s job shows Done', cs.locator('.row').filter({ hasText: 'House wash' }).locator('.pill-good', { hasText: 'Done' }));
    await sees(T + 'a first finished job makes a New client Active', cs.locator('.cluster .pill', { hasText: 'Active' }));
    const order = await cs.evaluate((el) => {
      const body = el.querySelector('.sheet-body'), edit = Array.prototype.filter.call(body.querySelectorAll('.btn'), (b) => b.textContent.trim() === 'Edit details')[0];
      const labels = Array.prototype.map.call(body.querySelectorAll('.label'), (l) => l.textContent.trim());
      return { labels: labels.join(), editInHead: !!edit && !!edit.closest('.sec-head') && edit.closest('.sec-head').textContent.indexOf('Details') === 0, boxes: body.querySelectorAll('textarea, input').length };
    });
    check(T + '"Edit details" sits with the details at the top of the client sheet, and the sheet has no note box of its own',
      order.editInHead && order.labels === 'Details,Payment,Notes,Jobs,Manage this client' && order.boxes === 0, JSON.stringify(order));

    await p.btn(cs, 'Add note').tap();
    await p.sheet('Add note');
    await p.type(p.field(p.top, 'note'), 'Prefers mornings.');
    await p.foot.tap();
    await sees(T + 'a client note is added through the same "Add note" sheet as a job note', p.toast('Note saved.'));
    await says(T + 'and it tops the client\'s history', cs.locator('.notes .note').first(), /Grayson, .*Prefers mornings\./);

    await cs.locator('.seg[aria-label="Payment status"] .seg-btn', { hasText: exact('Late') }).tap();
    await sees(T + 'payment status changes with one tap', p.toast('Marked as late.'));
    await sees(T + 'a late client carries a red Late pill', cs.locator('.cluster .pill-bad', { hasText: 'Late' }));

    await p.btn(cs, 'Edit').tap();
    await p.sheet('Edit payment link');
    await p.type(p.field(p.top, 'pay-link'), 'http://pay.example.com/x');
    await p.foot.tap();
    await says(T + 'a payment link must be https', p.top.locator('.field-error:not([hidden])'), 'A payment link must start with https://');
    await p.type(p.field(p.top, 'pay-link'), LOOKALIKE);
    await p.foot.tap();
    await says(T + 'a look-alike link is refused by the system, in its words, by the button', p.top.locator('.sheet-foot .form-error'), exact(LINK_WORDS));
    check(T + 'what was typed stays in the box after the refusal', (await p.field(p.top, 'pay-link').inputValue()) === LOOKALIKE);
    await p.type(p.field(p.top, 'pay-link'), 'https://buy.stripe.com/test_8wM5kq7Zb');
    await p.foot.tap();
    await sees(T + 'the payment link can be changed', p.toast('Payment link saved.'));
    check(T + 'Open now goes to the new link', await until(async () => (await p.btn(cs, 'Open').getAttribute('href')) === 'https://buy.stripe.com/test_8wM5kq7Zb'));
    await says(T + 'and right by Open it says "Opens buy.stripe.com"', cs.locator('.pay-goes'), exact('Opens buy.stripe.com'));
    const gap = await cs.evaluate((el) => {
      const goes = el.querySelector('.pay-goes').getBoundingClientRect();
      const open = Array.prototype.filter.call(el.querySelectorAll('.btn'), (b) => b.textContent.trim() === 'Open')[0].getBoundingClientRect();
      return Math.round(open.top - goes.bottom);
    });
    check(T + '(that line sits directly above the Open button)', gap >= 0 && gap <= 24, gap + ' px apart');

    await p.btn(cs, 'Edit details').tap();
    await p.sheet('Edit details');
    const note = p.top.locator('.callout', { hasText: 'This changes what the client pays from now on. To fix a sale that was entered wrong, open the sale.' });
    check(T + 'Edit details says nothing about sales until the service or the price is changed', !(await note.isVisible()));
    await p.type(p.field(p.top, 'c-price'), '400');
    await sees(T + 'changing the price there says it changes what the client pays from now on, and that a wrong sale is fixed in the sale', note);
    await sees(T + 'with a way straight to the sale', p.btn(note, 'Open the sale'));
    await p.type(p.field(p.top, 'c-price'), '345.50');
    await gone(T + 'putting the price back takes that line away again', note);
    await p.type(p.field(p.top, 'c-contact'), 'Patricia Birch');
    await p.type(p.field(p.top, 'c-phone'), '615-555-0100');
    await says(T + 'the edit sheet says past sales stay with whoever made them', p.top.locator('.field', { has: p.page.locator('[name="c-rep"]') }), 'Sales already made stay with whoever made them.');
    const reps = (await p.field(p.top, 'c-rep').locator('option').allTextContents()).map(tidy);
    check(T + '"Their rep" offers the owner and the sales reps, no techs', reps.join() === 'Grayson (you),Avery,Mason', reps.join());
    await p.field(p.top, 'c-rep').selectOption({ label: 'Avery' });
    await p.foot.tap();
    await sees(T + 'saving says who looks after the client now', p.toast('Saved. Avery looks after this client now.'));
    await p.sheet(S.name, true);
    await says(T + 'the new contact shows', p.kv(cs, 'Contact'), 'Patricia Birch');
    await says(T + 'the sale stays with Mason', p.kv(cs, 'Sold by'), 'Mason');
    await says(T + 'and Avery is their rep', p.kv(cs, 'Their rep'), 'Avery');
    await says(T + 'the price was left alone', p.kv(cs, 'Service and price'), 'House wash, $345.50 a month');

    await p.btn(cs, 'Book an appointment').tap();
    await p.sheet('Book an appointment');
    const free = (await freeDays(p)).filter((x) => x.times.length >= 2);
    const at = { date: free[3].date, time: free[3].times[1] };
    await p.pickTime(p.top, at.date, at.time);
    await p.foot.tap();
    await sees(T + 'another appointment can be booked from the client', p.toast('Booked for ' + words.when(at.date, at.time, S.today) + '.'));
    check(T + 'the client now has two jobs', await until(async () => (await cs.locator('.row .row-time').count()) === 2));

    /* a monthly plan that ends promises nothing more */
    await cs.locator('.seg[aria-label="Client status"] .seg-btn', { hasText: exact('Paused') }).tap();
    await sees(T + 'the status changes with one tap', p.toast('Status changed to Paused.'));
    await cs.locator('.seg[aria-label="Client status"] .seg-btn', { hasText: exact('Cancelled') }).tap();
    await p.dialog('Cancel this client?');
    await p.answer('Cancel client');
    await sees(T + 'cancelling a monthly client asks first', p.toast('Status changed to Cancelled.'));
    await p.close();

    await p.tab('Sales', 'Sales');
    await says(T + 'a monthly sale that ended says so in the list', p.row(p.screen, S.name), 'Monthly plan ended ' + words.dayShort(S.today));
    await p.row(p.screen, S.name).tap();
    await p.sheet(S.name);
    await says(T + 'its sheet says the monthly commission ended', p.top, 'Monthly commission on this sale ended ' + words.day(S.today, S.today) + ', when the client cancelled.');
    check(T + 'and nothing on it promises future pay', !/Next:|every month they stay/.test(tidy(await p.top.textContent())));
    await p.close();
    await p.row(p.screen, 'Maple Court Rental').tap();
    await p.sheet('Maple Court Rental');
    check(T + 'the sample\'s cancelled monthly client promises nothing either', /Monthly commission on this sale ended/.test(tidy(await p.top.textContent())) && !/Next:/.test(tidy(await p.top.textContent())));
    await p.close();

    await p.tab('Clients', 'Clients');
    await p.row(p.screen, S.name).tap();
    await p.sheet(S.name, true);
    await p.top.locator('.seg[aria-label="Client status"] .seg-btn', { hasText: exact('Active') }).tap();
    await sees(T + 'a cancel can be taken back the same day', p.toast('Status changed to Active.'));
    await p.close();
    await p.screen.locator('.chip', { hasText: 'Cancelled' }).tap();
    await p.row(p.screen, 'Maple Court Rental').tap();
    await p.sheet('Maple Court Rental');
    await p.btn(p.top, 'Remove client').tap();
    await p.dialog('Remove this client?');
    await says(T + 'removing a client says its sales and jobs go too', p.page.locator('.dialog-text'), /This also removes their 1 sale and 1 job\./);
    await p.answer('Remove client');
    await sees(T + 'the client is removed', p.toast('Client removed.'));
    await says(T + 'the Cancelled filter is then empty', p.screen.locator('.empty'), 'No cancelled clients.');
    await p.btn(p.screen, 'Show all clients').tap();
    await p.health('the Clients tab after the edits');

    await p.tab('Dashboard', 'Dashboard');
    await p.row(p.screen, 'Late payments').tap();
    await p.sheet('Late payments');
    check(T + 'the Dashboard lists both late payments', (await p.top.locator('.row').count()) === 2);
    await p.row(p.top, 'Hilltop Cafe').tap();
    await p.sheet('Hilltop Cafe');
    await p.top.locator('.seg[aria-label="Payment status"] .seg-btn', { hasText: exact('Paid') }).tap();
    await sees(T + 'marking one paid says so', p.toast('Marked as paid.'));
    await p.closeAll();
    await says(T + 'the Dashboard is down to one late payment', p.row(p.screen, 'Late payment'), S.name);
    await sees(T + 'the Dashboard shows the six numbers', p.screen.locator('.stat-grid .stat').nth(5));
    const labels = (await p.screen.locator('.stat-grid .stat-label').allTextContents()).map(tidy);
    check(T + 'they are Sales and Revenue this week, Sales and Revenue this month, Active clients, Commission owed this month',
      labels.join() === 'Sales this week,Revenue this week,Sales this month,Revenue this month,Active clients,Commission owed this month', labels.join());
    const grid = await p.screen.locator('.stat-grid').evaluate((el) => {
      const cells = Array.prototype.map.call(el.querySelectorAll('.stat'), (c) => { const b = c.getBoundingClientRect(), cs = getComputedStyle(c); return { x: Math.round(b.left), h: Math.round(b.height), rail: parseFloat(cs.borderLeftWidth) }; });
      return { cols: new Set(cells.map((c) => c.x)).size, heights: new Set(cells.map((c) => c.h)).size, rails: cells.filter((c) => c.rail > 1).length };
    });
    check(T + 'in a plain grid of two columns with even rows and no coloured rail', grid.cols === 2 && grid.heights === 1 && grid.rails === 0, JSON.stringify(grid));

    /* revenue is the money due in the period, worked out here from the sales the page holds */
    const sales = await pageSales(), wk = D.weekStart(S.today), mo = D.monthStart(S.today);
    const want = { week: revenue(sales, wk, S.today), month: revenue(sales, mo, S.today), owed: commission(sales, mo, S.today), sold: sales.filter((s) => s.day >= mo).reduce((t, s) => t + s.priceCents, 0),
      countWeek: sales.filter((s) => s.day >= wk).length, countMonth: sales.filter((s) => s.day >= mo).length };
    const got = { week: tidy(await statNum('Revenue this week').textContent()), month: tidy(await statNum('Revenue this month').textContent()), owed: tidy(await statNum('Commission owed this month').textContent()),
      countWeek: tidy(await statNum('Sales this week').textContent()), countMonth: tidy(await statNum('Sales this month').textContent()) };
    /* (On most days of a month a monthly client's payment has already come due in it, and the two figures differ.) */
    check(T + '"Revenue this month" is the money due this month: every payment dated in it, the monthly clients\' too (' + words.moneyShort(want.month) +
      (want.month !== want.sold ? ', where the new sales alone are ' + words.moneyShort(want.sold) : '') + ')', got.month === words.moneyShort(want.month), 'the Dashboard says ' + got.month);
    check(T + '"Revenue this week" is worked out the same way (' + words.moneyShort(want.week) + ')', got.week === words.moneyShort(want.week), 'the Dashboard says ' + got.week);
    check(T + 'the counts beside them are the sales made in the period (' + want.countWeek + ' and ' + want.countMonth + ')', got.countWeek === String(want.countWeek) && got.countMonth === String(want.countMonth), got.countWeek + ' and ' + got.countMonth);
    check(T + '"Commission owed this month" is every commission dated this month (' + words.moneyShort(want.owed) + ')', got.owed === words.moneyShort(want.owed), 'the Dashboard says ' + got.owed);
    await sees(T + 'and the leaderboard with each rep\'s commission', p.screen.locator('.row', { hasText: /Mason.*commission/ }));
    await says(T + 'where the owner\'s own row says "No commission"', p.screen.locator('.row', { hasText: /Grayson/ }).filter({ hasText: 'sale' }).first(), 'No commission');

    await p.tab('Sales', 'Sales');
    const cells = (await p.screen.locator('.nums-cell').allTextContents()).map(tidy);
    check(T + 'the owner\'s Sales screen shows the same revenue, with the new sales counted beside it',
      cells[0] === words.moneyShort(want.week) + 'Revenue this week' + words.plural(want.countWeek, 'new sale') && cells[1] === words.moneyShort(want.month) + 'Revenue this month' + words.plural(want.countMonth, 'new sale'), cells.join(' | '));
    await says(T + 'and calls the commission by the same name as the Dashboard, with the same amount', p.screen.locator('.nums-main'), new RegExp('^Commission owed this month\\s*' + words.moneyShort(want.owed).replace(/[$.]/g, '\\$&')));
  });

  /* ----- toasts, the back button, a reload ----- */
  await part(T + 'toasts, the back button and a reload', list, async () => {
    await p.tab('Sales', 'Sales');
    await p.btn(p.screen, 'New sale').tap();
    await p.sheet('New sale', true);
    await p.type(p.field(p.top, 'sale-name'), 'Half typed');
    await p.close();
    await p.btn(p.screen, 'New sale').tap();
    await p.sheet('New sale', true);
    await sees(T + 'a half-typed sale is kept when the sheet is closed', p.top.locator('.callout', { hasText: 'We kept what you typed.' }));
    await p.btn(p.top, 'Start over').tap();
    const toast = p.toast('Cleared.');
    await toast.waitFor();
    /* (an earlier message may still be showing above this one: the messages stack downward from just under the header) */
    const at = { first: await p.toasts.first().boundingBox(), toast: await toast.boundingBox(), button: await toast.locator('.toast-btn').boundingBox(),
      head: await p.top.locator('.sheet-head').boundingBox(), foot: await p.top.locator('.sheet-foot').boundingBox() };
    const boxes = { stackTop: Math.round(at.first.y), toastTop: Math.round(at.toast.y), toastBottom: Math.round(at.toast.y + at.toast.height), headBottom: Math.round(at.head.y + at.head.height),
      footTop: Math.round(at.foot.y), button: Math.round(at.button.height) };
    check(T + 'a toast over an open sheet sits at the top, just under the sheet\'s header, well clear of its button',
      boxes.stackTop >= boxes.headBottom && boxes.stackTop - boxes.headBottom <= 24 && boxes.toastTop >= boxes.stackTop && boxes.toastBottom < boxes.footTop - 200, JSON.stringify(boxes));
    check(T + 'the toast\'s own button is at least 44px tall', boxes.button >= 44, boxes.button + ' px');
    await p.health('a toast over the New sale sheet');
    await toast.locator('.toast-btn').tap();
    check(T + 'Undo brings the typed sale back', await until(async () => (await p.field(p.top, 'sale-name').inputValue()) === 'Half typed'));
    await p.btn(p.top, 'Start over').tap();

    await p.page.goBack();
    check(T + 'the phone\'s back button closes the sheet and stays on the screen', await until(async () => (await p.layers()) === 0) && /#sales$/.test(p.page.url()));
    await p.page.reload();
    await p.signedIn();
    await sees(T + 'a reload keeps the person signed in on the same data', p.row(p.screen, S.name));
    await p.page.goto(PAGE + '?sample=1#leaders');
    await p.signedIn();
    check(T + 'a screen that is not the owner\'s falls back to Today', await until(() => /#today$/.test(p.page.url())));
    for (const name of ['constructor', '__proto__', 'toString']) {
      await p.page.goto(PAGE + '?sample=1#' + name);
      await p.page.reload();
      await p.signedIn();
      const landed = await until(() => /#today$/.test(p.page.url())) && (await p.page.locator('.tabbar .tab.is-on').textContent()) === 'Today' && (await p.screen.locator('.stats').count()) === 1;
      check(T + 'an address ending in #' + name + ' is not a screen: it goes to Today', landed, p.page.url());
    }
    await p.health('Today after a reload');
  });

  /* ----- team: rename, role, remove ----- */
  await part(T + 'the owner renames, changes and removes a person', list, async () => {
    await p.me();
    await p.row(p.top, 'Team').tap();
    await p.sheet('Team', true);
    await says(T + 'Team shows that Cole read the standards', p.row(p.top, 'Cole'), 'Read the standards ' + words.dayShort(S.today));
    await p.row(p.top, 'Jake').tap();
    await p.sheet('Jake');
    await p.row(p.top, 'Reset PIN').tap();
    await p.dialog('Reset the PIN for Jake?');
    await p.answer('Reset PIN');
    await p.sheet('New PIN', true);
    S.jakePin2 = tidy(await p.top.locator('.callout-big').textContent());
    await p.foot.tap();
    await p.sheet('Jake', true);
    await p.row(p.top, 'Change name').tap();
    await p.sheet('Change name');
    await p.type(p.field(p.top, 'person-name'), 'Jake R');
    await p.foot.tap();
    await p.sheet('Jake R', true);
    ok(T + 'a person can be renamed');
    await p.row(p.top, 'Change role').tap();
    await p.sheet('Change role');
    await p.row(p.top, 'Sales rep').tap();
    await sees(T + 'a role change says they need to sign in again', p.toast('Jake R is now a sales rep. They need to sign in again.'));
    await p.sheet('Jake R', true);
    await p.btn(p.top, 'Remove from team').tap();
    await p.dialog('Remove Jake R from the team?');
    await says(T + 'removing someone says their sales history stays', p.page.locator('.dialog-text'), 'Their sales history stays.');
    await p.answer('Remove');
    await sees(T + 'the person is removed', p.toast('Jake R is no longer on the team.'));
    await p.sheet('Team', true);
    await gone(T + 'and is no longer listed', p.row(p.top, /Jake/));
    await p.closeAll();
    await p.signOut();
    await p.signInForm('Jake R', S.jakePin2);
    await says(T + 'a removed person cannot sign in', p.page.locator('#signin-body .form-error'), 'That name and PIN do not match.');
  });

  /* ----- the rep who was handed the client, and asked to confirm again ----- */
  await part(T + 'a rep is asked to confirm the standards again, and is handed a client', list, async () => {
    await p.signInForm('Avery', PINS.Avery);
    await says(T + 'after the reset the old PIN no longer works', p.page.locator('#signin-body .form-error'), /do not match|Too many wrong tries/);
    await p.signInForm('Avery', S.averyPin);
    await p.signedIn();
    ok(T + 'Avery signs in with the PIN the owner reset');
    await sees(T + 'she is asked to read the standards again', p.screen.locator('.remind'));
    await p.btn(p.screen.locator('.remind'), 'Read').tap();
    await p.screen.locator('h1.title', { hasText: 'Company standards' }).waitFor();
    await says(T + 'the page says they were updated and to confirm again', p.screen.locator('.std-foot'), 'Updated ' + words.dayShort(S.today) + '. Read them again and confirm.');
    await sees(T + 'the changed line is there to read', p.screen.locator('.std-item', { hasText: 'Close every gate behind you.' }));
    await p.btn(p.screen, 'I have read these').tap();
    await sees(T + 'she confirms and it says so', p.screen.locator('.std-ok', { hasText: 'You confirmed these on ' + words.dayShort(S.today) + '.' }));
    await p.health('the Company standards page for a rep');

    await p.tab('Clients', 'Clients');
    await p.row(p.screen, S.name).tap();
    await p.sheet(S.name);
    ok(T + 'the client the owner handed over is in her Clients');
    check(T + 'a rep reads the payment status but cannot change it', (await p.top.locator('.seg[aria-label="Payment status"]').count()) === 0 && (await p.top.locator('.seg[aria-label="Client status"]').count()) === 0);
    await p.btn(p.top, 'Edit contact details').tap();
    await p.sheet('Edit contact details');
    check(T + 'a rep can edit the five contact fields only', (await p.top.locator('.sheet-body .input').count()) === 5);
    await p.type(p.field(p.top, 'c-email'), 'patricia@example.com');
    await p.foot.tap();
    await p.sheet(S.name, true);
    await says(T + 'her change to the email is saved', p.kv(p.top, 'Email'), 'patricia@example.com');
    await p.close();
    await p.tab('Sales', 'Sales');
    await gone(T + 'the sale itself did not move to her', p.row(p.screen, S.name), 1500);
    await p.signOut();

    await asRole('Sales rep');
    await p.tab('Clients', 'Clients');
    await gone(T + 'Mason no longer has the client', p.row(p.screen, S.name), 1500);
    await p.tab('Sales', 'Sales');
    await p.row(p.screen, S.name).tap();
    await p.sheet(S.name);
    await says(T + 'but he keeps the sale and what it earned', p.kv(p.top, 'Earned so far'), '$103.65');
    await p.close();
    await p.tab('Leaders', 'Leaderboard');
    await sees(T + 'the leaderboard marks his own row "You"', p.screen.locator('.row.is-you .pill', { hasText: 'You' }));
    await p.screen.locator('.seg-btn', { hasText: exact('All time') }).tap();
    await sees(T + 'the leaderboard switches period', p.screen.locator('.seg-btn.is-on', { hasText: exact('All time') }));
    await says(T + 'it explains the commission with the rates in force', p.screen, 'You earn 25% of each sale, then 12.5% every month a monthly client stays.');
    await p.health('the Leaders tab');
    await p.signOut();
  });

  /* ----- start the sample over ----- */
  await part(T + 'the sample can be reset', list, async () => {
    await p.btn(p.page.locator('#signin-body'), 'Reset sample data').tap();
    await p.dialog('Reset sample data?');
    await p.answer('Reset');
    await sees(T + 'resetting brings all three sample buttons back', quick('Tech'));
    await asRole('Owner');
    await p.tab('Clients', 'Clients');
    await gone(T + 'and everything the walk added is gone', p.row(p.screen, S.name), 1500);
    await p.health('Clients after the reset');
  });

  await dropPhone(p);
}

/* ============================================================================================
 * HOW THE PAGE STARTS
 * ============================================================================================ */

async function startCases(browser) {
  const T = 'start: ';
  const list = [];

  /* ----- config.js decides the mode, and nothing else does -----
     The built page is served to the browser at the team's real address, with the config.js this part
     chooses beside it (the same bytes as index.html on disk; nothing leaves this computer). */
  const SITE = 'https://ridgelinehq.github.io/team/';
  const html = fs.readFileSync(BUILT, 'utf8');
  const beside = (name) => path.join(path.dirname(BUILT), name);
  let config = { body: 'window.RIDGELINE_BACKEND = "";' };
  const p = await newPhone(browser, 'a phone at the real address', null);
  list.push(p);
  await p.ctx.route((u) => u.hostname === 'ridgelinehq.github.io' || u.hostname === 'backend.example', async (route) => {
    const u = new URL(route.request().url());
    if (u.hostname === 'backend.example') return route.abort('failed');                 /* a backend that cannot be reached */
    const file = u.pathname.replace(/^\/team\/?/, '') || 'index.html';
    if (file === 'index.html') return route.fulfill({ status: 200, contentType: 'text/html; charset=utf-8', body: html });
    if (file === 'config.js') {
      if (config.body == null) return route.abort('failed');                            /* it did not load (a bad signal) */
      return route.fulfill({ status: 200, contentType: 'application/javascript; charset=utf-8', body: config.body });
    }
    if (/^[\w.-]+$/.test(file) && fs.existsSync(beside(file))) return route.fulfill({ status: 200, path: beside(file) });
    return route.fulfill({ status: 404, contentType: 'text/plain', body: 'Not found' });
  });
  const body = p.page.locator('#signin-body');
  async function load(query) {
    await p.page.goto(SITE + (query || ''));
    await p.page.locator('#signin:not([hidden]), #app:not([hidden])').first().waitFor();
  }
  const state = () => p.page.evaluate(() => ({ mode: window.App.mode, card: document.querySelectorAll('#signin-body .card').length, form: document.querySelectorAll('#signin-body form').length,
    app: !document.getElementById('app').hidden, keys: Object.keys(localStorage).length }));

  await part(T + 'config.js says "" (empty)', list, async () => {
    await load();
    await says(T + 'config.js with an empty address gives sample mode, and the sign-in screen says so', body.locator('.card'), /Sample mode.*made-up data/);
    await body.locator('.btn', { hasText: exact('Owner') }).tap();
    await p.signedIn();
    await says(T + 'the app then runs on sample data', p.page.locator('#strip-text'), 'Sample data. Nothing here is real yet.');
    await p.health('sample mode at the real address');
    await p.signOut();
  });

  await part(T + 'config.js did not load', list, async () => {
    config = { body: null };
    p.quietNet++;
    await load();
    await says(T + 'when config.js does not load the page says "This page did not load all the way. Check your signal, then reload."', body.locator('.stop-text'),
      exact('This page did not load all the way. Check your signal, then reload.'));
    await sees(T + 'with a Reload button', p.btn(body, 'Reload'));
    let s = await state();
    check(T + 'and it is not sample mode: no sample card, no sign-in form, no app', s.mode === 'off' && !s.card && !s.form && !s.app, JSON.stringify(s));
    await p.health('the "did not load" message');
    await load('?sample=1');
    s = await state();
    check(T + 'adding ?sample=1 to the real address does not turn sample mode on', s.mode === 'off' && !s.card && !s.form &&
      tidy(await body.locator('.stop-text').textContent()) === 'This page did not load all the way. Check your signal, then reload.', JSON.stringify(s));
    config = { body: 'window.RIDGELINE_BACKEND = "";' };
    await p.btn(body, 'Reload').tap();
    await sees(T + 'Reload loads the page again, and once config.js arrives the sign-in screen is there', body.locator('form'));
    p.quietNet--;
    p.problems.length = 0;
  });

  await part(T + 'config.js holds something that is not an https:// address', list, async () => {
    for (const [what, value] of [['an http:// address', 'http://script.google.com/macros/s/abc/exec'], ['a word', 'ridgeline'], ['an address with a space in it', 'https://script.google.com/macros/s/ab c/exec']]) {
      config = { body: 'window.RIDGELINE_BACKEND = ' + JSON.stringify(value) + ';' };
      await load();
      const s = await state();
      check(T + what + ' in config.js: "The team system is not connected yet. Tell Grayson.", and never sample mode',
        tidy(await body.locator('.stop-text').textContent()) === 'The team system is not connected yet. Tell Grayson.' && s.mode === 'off' && !s.card && !s.form && !s.app, JSON.stringify(s));
    }
    await p.health('the "not connected yet" message');
    await load('?sample=1&backend=' + encodeURIComponent('http://127.0.0.1:9/'));
    const s = await state();
    check(T + 'neither ?sample=1 nor ?backend= changes that at the real address', s.mode === 'off' && !s.card && !s.form, JSON.stringify(s));
  });

  await part(T + 'config.js holds an https:// address', list, async () => {
    config = { body: 'window.RIDGELINE_BACKEND = "https://backend.example/macros/s/abc/exec";' };
    await load();
    const s = await state();
    check(T + 'an https:// address in config.js gives the real sign-in screen, with no sample card', s.mode === 'live' && !s.card && s.form === 1, JSON.stringify(s));
    p.quietNet++;
    await p.signInForm('Grayson', PINS.Grayson);
    await says(T + 'when sign-in cannot reach the system it says so, and what to do', body.locator('.form-error'),
      exact('Cannot reach the team system. Check your signal and try again. If your signal is fine, tell Grayson.'));
    check(T + 'the name is still in the box', (await p.field(body, 'name').inputValue()) === 'Grayson');
    await p.health('the sign-in screen when the system cannot be reached');
    p.quietNet--;
  });
  await dropPhone(p);
  list.length = 0;

  /* ----- the phone's clock: a Wednesday, on the narrowest phone -----
     Sample mode goes by the phone's own clock, so the browser is given one: Wednesday August 30, 2028, 10:00 AM.
     "Wednesday, Aug 30" is within a pixel of the widest heading the app can write (measured over every weekday,
     month and day; only "Wednesday, May 24" is wider, and May is no shorter written out, so it would not show a
     heading that had gone back to the full month). */
  const WED = '2028-08-30';
  const q = await newPhone(browser, 'a 360 wide phone on a Wednesday', null, { width: 360, height: 740,
    before: (ctx) => ctx.clock.setFixedTime(new Date(WED + 'T10:00:00-05:00')) });
  list.push(q);
  const quick = (role) => q.page.locator('#signin-body .btn', { hasText: exact(role) });

  await part(T + 'the date heading on the narrowest phone', list, async () => {
    await q.page.goto(PAGE + '?sample=1');
    await q.page.locator('#signin:not([hidden])').waitFor();
    for (const role of ['Owner', 'Tech']) {
      await quick(role).tap();
      await q.signedIn();
      await q.page.evaluate(() => document.fonts.ready);
      const head = tidy(await q.screen.locator('h1.title').textContent());
      check(T + role + ': on a 360 wide phone the heading "' + words.dayHead(WED) + '" (the longest weekday) stays on one line',
        D.weekday(WED) === 3 && head === 'Wednesday, Aug 30' && (await q.lines(q.screen.locator('h1.title'))) === 1, head + ', ' + (await q.lines(q.screen.locator('h1.title'))) + ' lines');
      if (role === 'Tech') {
        check(T + 'Tech: the reminder card keeps "Company standards" and "Read these and confirm." on one line each at 360',
          (await q.lines(q.screen.locator('.remind-title'))) === 1 && (await q.lines(q.screen.locator('.remind-sub'))) === 1);
      }
      await q.health('Today at 360 wide (' + role + ')');
      await q.signOut();
    }
  });

  await part(T + 'a day whose times have passed', list, async () => {
    const today = WED, cell = () => q.day(q.screen, today);
    await quick('Owner').tap();
    await q.signedIn();
    await q.tab('Calendar', 'Availability');
    await says(T + 'a day with every time booked says "Full"', cell(), 'Full');
    check(T + 'in amber (.is-full)', /is-full/.test(await cell().getAttribute('class')));
    await cell().tap();
    await q.sheet(words.dayLong(today));
    await q.field(q.top, 'new-time').fill('09:00');       /* it is 10:00 AM: this time has already gone by, and nobody booked it */
    await q.foot.tap();
    await sees(T + 'the owner adds a time that has already gone by today', q.toast(words.day(today, today) + ' is open with 5 times.'));
    await says(T + 'that day is then not "Full": its cell reads "0 left"', cell(), /^30\s*0 left$/);
    const look = await cell().evaluate((el) => ({ cls: el.className, label: getComputedStyle(el.querySelector('.day-label')).color,
      amber: getComputedStyle(document.documentElement).getPropertyValue('--warn').trim() }));
    check(T + 'in the quiet colour, not amber (.is-spent)', /is-spent/.test(look.cls) && !/is-full/.test(look.cls) && look.label === 'rgb(169, 184, 198)', JSON.stringify(look));
    await cell().tap();
    await q.sheet(words.dayLong(today), true);
    await says(T + 'and its sheet says why in full', q.top, 'No times left today. The ones that were not booked have passed.');
    await q.close();
    await q.health('the Calendar at 360 wide');
    await q.signOut();

    await quick('Sales rep').tap();
    await q.signedIn();
    await q.tab('Calendar', 'Open days');
    await says(T + 'the rep\'s calendar says "0 left" for that day too', cell(), /^30\s*0 left$/);
    await cell().tap();
    await q.sheet(words.dayLong(today));
    await says(T + 'and tapping it tells the rep to pick another day', q.top, 'No times left on this day. Pick another day.');
    check(T + 'with no "New sale on this day" button', !(await q.foot.isVisible()));
    await q.close();
  });
  await dropPhone(q);
}

/* ============================================================================================
 * REAL MODE: what both real walks use
 * ============================================================================================ */

function freePort() {
  return new Promise((resolve, reject) => {
    const s = net.createServer();
    s.on('error', reject);
    s.listen(0, '127.0.0.1', () => { const port = s.address().port; s.close(() => resolve(port)); });
  });
}

async function startServer() {
  const port = await freePort();
  const child = spawn(process.execPath, [path.join(__dirname, 'dev-server.js'), String(port)], { stdio: ['ignore', 'pipe', 'pipe'] });
  const srv = { port, child, log: '', url: 'http://127.0.0.1:' + port };
  child.stdout.on('data', (b) => { srv.log += b; });
  child.stderr.on('data', (b) => { srv.log += b; });
  const up = await until(() => /is listening/.test(srv.log), 10000);
  if (!up) { child.kill(); throw new Error('tools/dev-server.js did not start: ' + srv.log); }
  /* The server's own data, asked for from here (not through the page), to count what was really saved. */
  srv.ask = async (req) => {
    const r = await fetch(srv.url, { method: 'POST', headers: { 'Content-Type': 'text/plain;charset=utf-8' }, body: JSON.stringify(req) });
    return r.json();
  };
  srv.snapshot = async () => {
    if (!srv.token) srv.token = (await srv.ask({ action: 'login', name: 'Grayson', pin: PINS.Grayson })).result.token;
    return (await srv.ask({ action: 'sync', token: srv.token })).sync;
  };
  /* Counting what the server holds. */
  srv.salesNamed = async (name, priceCents) => (await srv.snapshot()).sales.filter((s) => s.clientName === name && (priceCents == null || s.priceCents === priceCents)).length;
  srv.jobsAt = async (client, date, time) => (await srv.snapshot()).jobs.filter((j) => (j.client || {}).name === client && j.date === date && j.time === time && j.status !== 'cancelled').length;
  srv.notesSaying = async (text) => {
    const snap = await srv.snapshot();
    let n = 0;
    snap.clients.concat(snap.jobs).forEach((x) => (x.notes || []).forEach((note) => { if (note.text === text) n++; }));
    return n;
  };
  srv.people = async (name) => (await srv.snapshot()).team.filter((m) => m.active && m.name === name).length;
  srv.retried = (action, from) => new RegExp(action + '\\s+ok \\(a retry of something already saved\\)').test(srv.log.slice(from || 0));
  srv.stop = () => {
    try { child.kill('SIGCONT'); } catch (e) { /* already gone */ }
    child.kill();
  };
  return srv;
}

/* Phones that talk to one dev server, and the ways a call from one of them can be made to go wrong.
     'crash'       sent on to the dev server with ?fail=1: HTTP 500 and an error page, nothing saved
     'drop'        ?drop=1: the server runs it and saves it, then closes the connection without a word
     'slow-crash'  ?delay=N&fail=1: the same error page, after a wait (long enough to close a sheet that says "Saving...")
     'busy'        the phone is told "The system is busy", as the real backend says when several phones ask at once
   cut(p, action, kind, times) arms it for the next call (or calls) of that action; mend(p) takes every fault away. */
function plumbing(browser, srv) {
  const url = PAGE + '?backend=' + encodeURIComponent(srv.url);
  const BUSY = JSON.stringify({ ok: false, error: { code: 'busy', message: 'The system is busy. Try again in a moment.' } });
  function cut(p, action, kind, times, ms) { p.faults.push({ action, kind, left: times || 1, ms: ms || 2500 }); }
  function mend(p) { p.faults = []; }
  /* A lost answer the phone cannot find out about by itself: the save is dropped on its way back, and the phone's
     own "what is the latest?" fails too, so the only thing left to it is to try again. */
  function lose(p, action) { cut(p, action, 'drop'); cut(p, 'sync', 'crash', 99); }
  async function open(who) {
    const p = await newPhone(browser, who, null);
    p.backend = srv.url;
    p.refreshes = 0;
    await p.ctx.route((u) => u.href.indexOf(srv.url) === 0, async (route) => {
      let action = '';
      try { action = JSON.parse(route.request().postData() || '{}').action; } catch (e) { action = ''; }
      if (action === 'sync') p.refreshes++;
      const f = p.faults.filter((x) => x.left > 0 && x.action === action)[0];
      if (!f) return route.continue();
      f.left--;
      if (f.kind === 'busy') return route.fulfill({ status: 200, contentType: 'application/json', headers: { 'Access-Control-Allow-Origin': '*' }, body: BUSY });
      const knob = f.kind === 'crash' ? 'fail=1' : f.kind === 'drop' ? 'drop=1' : 'delay=' + f.ms + '&fail=1';
      return route.continue({ url: srv.url + '/?' + knob });
    });
    await p.page.goto(url);
    await p.page.locator('#signin:not([hidden])').waitFor();
    return p;
  }
  /* The phone asks for the latest once, now (its signal "came back"), and the answer has been dealt with. */
  async function refresh(p) {
    const n = p.refreshes;
    /* (a page that is in the middle of a refresh does not start another: ask again if this one was not heard) */
    for (let i = 0; i < 4 && p.refreshes === n; i++) {
      await p.wake();
      await until(() => p.refreshes > n, 1500, 50);
    }
    await sleep(400);
  }
  return { url, cut, mend, lose, open, refresh };
}

/* Fill the New sale sheet (already open) for a new client. */
async function fillSale(p, name, price) {
  const sh = p.top;
  await p.type(p.field(sh, 'sale-name'), name);
  await p.type(p.field(sh, 'sale-phone'), '615-555-0147');
  await p.type(p.field(sh, 'sale-address'), '12 Test St, Smithville, TN');
  await sh.locator('.chip', { hasText: exact('Window cleaning') }).tap();
  await p.type(p.field(sh, 'sale-price'), price);
}
async function newSale(p) {
  await p.tab('Sales', 'Sales');
  await p.btn(p.screen, 'New sale').tap();
  await p.sheet('New sale', true);
}
/* The red message that stays until it is tapped. */
const redToast = (p, text) => p.page.locator('#toasts .toast.toast-bad.is-sticky').filter({ hasText: text });

/* ============================================================================================
 * REAL MODE
 * ============================================================================================ */

async function realMode(browser) {
  const T = 'real: ';
  const srv = await startServer();
  const net = plumbing(browser, srv), cut = net.cut, mend = net.mend;
  let A = null, B = null, C = null, N = null;
  const list = [];
  const R = {};
  const open = async (who) => { const p = await net.open(who); list.push(p); return p; };
  const month = async () => { const snap = await srv.snapshot(), mo = D.monthStart(snap.today); return { revenue: revenue(snap.sales, mo, snap.today), owed: commission(snap.sales, mo, snap.today), count: snap.sales.filter((s) => s.day >= mo).length }; };
  const statNum = (p, label) => p.screen.locator('.stat-grid .stat').filter({ has: p.page.locator('.stat-label', { hasText: exact(label) }) }).locator('.stat-num');

  try {
    await part(T + 'signing in with a name and a PIN', list, async () => {
      A = await open('the owner\'s phone');
      await gone(T + 'with a backend there is no sample card on the sign-in screen', A.page.locator('#signin-body .card'), 1500);
      await A.signInForm('Grayson', '4829');
      await says(T + 'a PIN that is too short is stopped on the phone', A.page.locator('#signin-body .field-error:not([hidden])'), 'Your PIN is 6 digits.');
      await A.signInForm('Grayson', '482914');
      await says(T + 'a wrong PIN is refused in the system\'s words', A.page.locator('#signin-body .form-error'), 'That name and PIN do not match. Check both and try again.');
      await A.signInForm('Grayson', PINS.Grayson);
      await A.signedIn();
      const tabs = (await A.page.locator('.tabbar .tab').allTextContents()).map(tidy);
      check(T + 'Grayson signs in with his name and 6-digit PIN and gets the owner\'s tabs', tabs.join() === 'Today,Sales,Calendar,Clients,Dashboard', tabs.join());
      check(T + 'there is no sample strip in real mode', !(await A.page.locator('#strip').isVisible()));
      B = await open('the rep\'s phone');
      await B.signInForm('mason', PINS.Mason);
      await B.signedIn();
      check(T + 'Mason signs in (any letter case) and gets the rep\'s tabs', (await B.page.locator('.tabbar .tab').allTextContents()).map(tidy).join() === 'Today,Sales,Calendar,Clients,Leaders');
      C = await open('the tech\'s phone');
      await C.signInForm('Cole', PINS.Cole);
      await C.signedIn();
      check(T + 'Cole signs in and gets the tech\'s tabs', (await C.page.locator('.tabbar .tab').allTextContents()).map(tidy).join() === 'Today,Schedule,Standards');
      for (const [p, tabsOf] of [[A, ['Sales', 'Calendar', 'Clients', 'Dashboard', 'Today']], [B, ['Sales', 'Calendar', 'Clients', 'Leaders', 'Today']], [C, ['Schedule', 'Standards', 'Today']]]) {
        for (const t of tabsOf) await p.tab(t);
      }
      await A.me();
      await says(T + 'the account sheet says the data is live', A.top.locator('.me-foot'), /Up to date as of \d{1,2}:\d{2} [AP]M\./);
      await A.close();
      R.today = await A.today();
      const free = (await freeDays(A)).filter((x) => x.times.length >= 4);
      R.day = free[0].date;
      R.times = free[0].times;
    });

    /* ----- live sharing between two phones ----- */
    await part(T + 'two phones share the same live data', list, async () => {
      await newSale(A);
      await A.page.evaluate(() => { window.e2eNotReloaded = true; });
      const seen = await A.timesOn(A.top, R.day);
      check(T + 'the owner has a slot picker open on ' + words.dayLong(R.day) + ' showing ' + words.time(R.times[0]), seen.indexOf(R.times[0]) >= 0, seen.join());

      await newSale(B);
      await fillSale(B, 'Lakeshore Bakery', '180');
      await B.pickTime(B.top, R.day, R.times[0]);
      await B.foot.tap();
      await sees(T + 'the rep saves a sale and books ' + words.when(R.day, R.times[0], R.today), B.top.locator('.sold-title'));
      const savedAt = Date.now();
      await B.foot.tap();

      /* the one place the walk waits out the page's own 20 second round */
      const went = await until(async () => (await A.top.locator('.slotpick-times .chip', { hasText: exact(words.time(R.times[0])) }).count()) === 0, LIVE, 250);
      check(T + 'that time disappears from the owner\'s open slot picker by itself, with no reload (took ' + Math.round((Date.now() - savedAt) / 1000) + ' s)', went);
      await A.close();
      await sees(T + 'the rep\'s sale has appeared on the owner\'s phone without a reload', A.row(A.screen, 'Lakeshore Bakery'), LIVE);
      await says(T + 'it shows who sold it', A.row(A.screen, 'Lakeshore Bakery'), 'Sold by Mason');
      check(T + 'the owner\'s page was never reloaded in between', await A.page.evaluate(() => window.e2eNotReloaded === true));
      await sees(T + 'the owner\'s bell has a dot', A.page.locator('#bell-btn.has-dot'));
      await A.page.locator('#bell-btn').tap();
      await A.sheet('Notifications');
      await says(T + 'the owner is told about the sale and its appointment', A.top.locator('.row.notice').first(),
        'Mason sold Window cleaning to Lakeshore Bakery for $180.00. Booked for ' + words.when(R.day, R.times[0], R.today) + '.');
      await A.close();

      /* assign it; the tech's phone hears; the tech finishes it; the owner's phone hears */
      await A.tab('Calendar', 'Availability');
      await A.row(A.screen, 'Lakeshore Bakery').tap();
      await A.sheet('Lakeshore Bakery');
      await A.row(A.top, 'Assign to').tap();
      await A.sheet('Assign to');
      const people = (await A.top.locator('.row .row-title').allTextContents()).map(tidy);
      check(T + 'the Assign sheet offers Nobody, Cole and Grayson, not the sales rep', people.join() === 'Nobody,Cole,Grayson', people.join());
      await A.row(A.top, 'Cole').tap();
      await A.sheet('Lakeshore Bakery', true);
      await C.tab('Schedule', 'Schedule');
      await net.refresh(C);
      await sees(T + 'the job shows up on the tech\'s phone without a reload', C.row(C.screen, 'Lakeshore Bakery'));
      await techHoldsNoPrices(C, T + 'the tech\'s phone was sent no commission rates, no price list, no sales and no clients');
      await C.row(C.screen, 'Lakeshore Bakery').tap();
      await C.sheet('Lakeshore Bakery');

      cut(C, 'setJobDone', 'crash');
      await C.btn(C.top, 'Mark done').tap();
      await sees(T + 'a "Mark done" that cannot be saved says so in a red message that stays, with Retry', redToast(C, NO_SIGNAL).locator('.toast-btn', { hasText: 'Retry' }));
      await says(T + 'and the job sheet carries a red line in place of the button', C.top.locator('.job-unsaved'), 'Not saved. Tap to try again.');
      check(T + 'the job is not shown as done', (await C.top.locator('.callout-good').count()) === 0 && (await C.btn(C.top, 'Mark done').count()) === 0);
      mend(C);
      await redToast(C, NO_SIGNAL).locator('.toast-btn', { hasText: 'Retry' }).tap();
      await says(T + 'Retry then marks it done', C.top.locator('.callout-good'), /Done .* by Cole/);
      await gone(T + 'and the red line is gone', C.top.locator('.job-unsaved'));
      await net.refresh(A);
      await says(T + 'the owner\'s open job sheet turns to done without a reload', A.top.locator('.callout-good'), /Done .* by Cole/);
      await A.close();
      await C.close();
      await C.health('the tech\'s Schedule');
    });

    /* ----- fixing a sale ----- */
    await part(T + 'the owner fixes a sale and the rep\'s phone follows', list, async () => {
      await B.tab('Sales', 'Sales');
      const mine = B.row(B.screen, 'Lakeshore Bakery');
      await says(T + 'the rep\'s sale reads $180.00 and "Earned $54.00"', mine, /Window cleaning, .*\$180\.00.*Earned \$54\.00/);

      await A.tab('Sales', 'Sales');
      await A.row(A.screen, 'Lakeshore Bakery').tap();
      await A.sheet('Lakeshore Bakery');
      const saleSheet = A.top;
      await A.btn(saleSheet, 'Fix this sale').tap();
      await A.sheet('Fix this sale');
      await A.type(A.field(A.top, 'fix-price'), '');
      await A.foot.tap();
      await says(T + '"Fix this sale" will not save an empty price', A.top.locator('.field-error:not([hidden])'), 'Enter the price.');
      await A.type(A.field(A.top, 'fix-price'), '250');
      await A.field(A.top, 'fix-service').selectOption({ label: 'House wash' });
      await says(T + 'the sheet says one-time or monthly cannot be changed there', A.top, 'One-time or monthly cannot be changed here. For that, remove the sale and enter it again.');
      await A.foot.tap();
      await sees(T + 'the owner corrects the price and the service: "Sale fixed."', A.toast('Sale fixed.'));
      await A.sheet('Lakeshore Bakery', true);
      await says(T + 'the sale shows the new service', A.kv(saleSheet, 'Service'), 'House wash');
      await says(T + 'the new price', A.kv(saleSheet, 'Price'), '$250.00 one-time');
      await says(T + 'and the commission follows: earned so far $75.00', A.kv(saleSheet, 'Earned so far'), '$75.00');
      await A.close();
      let want = await month();
      const ownerCells = async () => (await A.screen.locator('.nums-cell').allTextContents()).map(tidy);
      check(T + 'the owner\'s totals follow: revenue this month ' + words.moneyShort(want.revenue) + ', commission owed ' + words.moneyShort(want.owed),
        want.revenue === 25000 && want.owed === 7500 && (await until(async () => (await ownerCells())[1] === '$250Revenue this month1 new sale')) &&
        tidy(await A.screen.locator('.big-num').first().textContent()) === '$75', (await ownerCells()).join(' | '));

      await net.refresh(B);
      await says(T + 'the rep\'s phone follows: House wash, $250.00, "Earned $75.00"', mine, /House wash, .*\$250\.00.*Earned \$75\.00/);
      const repCells = async () => (await B.screen.locator('.nums-cell').allTextContents()).map(tidy).join(' | ') + ' | ' + tidy(await B.screen.locator('.big-num').first().textContent());
      check(T + 'and so do his numbers: $250 sold this month, $75 commission', (await repCells()) === '$2501 sale this week | $2501 sale this month | $75', await repCells());
      await B.tab('Clients', 'Clients');
      await says(T + 'the client follows the fix too', B.row(B.screen, 'Lakeshore Bakery'), 'House wash, $250.00 one-time');

      /* who made the sale: to the owner (no commission), and back */
      await A.row(A.screen, 'Lakeshore Bakery').tap();
      await A.sheet('Lakeshore Bakery', true);
      await A.btn(A.top, 'Fix this sale').tap();
      await A.sheet('Fix this sale', true);
      const sellers = (await A.field(A.top, 'fix-rep').locator('option').allTextContents()).map(tidy);
      check(T + '"Sold by" offers the owner and the sales rep', sellers.join() === 'Grayson (you),Mason', sellers.join());
      await A.field(A.top, 'fix-rep').selectOption({ label: 'Grayson (you)' });
      await says(T + 'picking the owner as the seller says there is no commission on his own sales', A.top.locator('.field-hint:not([hidden])').last(), 'No commission on the owner\'s own sales.');
      await A.foot.tap();
      await A.sheet('Lakeshore Bakery', true);
      await says(T + 'the sale is then the owner\'s', A.kv(A.top, 'Sold by'), 'Grayson');
      await says(T + 'and its sheet says it earns no commission', A.top, /Commission\s*No commission on the owner's own sales\./);
      check(T + 'with no "Earned so far"', (await A.kv(A.top, 'Earned so far').count()) === 0);
      await A.close();
      await says(T + 'in the owner\'s list it reads "No commission"', A.row(A.screen, 'Lakeshore Bakery'), /Sold by Grayson.*No commission/);
      want = await month();
      check(T + 'commission owed drops to $0 while the revenue stays', want.owed === 0 && want.revenue === 25000 && tidy(await A.screen.locator('.big-num').first().textContent()) === '$0');
      await B.tab('Sales', 'Sales');
      await net.refresh(B);
      await gone(T + 'the sale leaves the rep\'s phone', B.row(B.screen, 'Lakeshore Bakery'));
      check(T + 'and his numbers go back to nothing', (await repCells()) === '$00 sales this week | $00 sales this month | $0', await repCells());

      await A.row(A.screen, 'Lakeshore Bakery').tap();
      await A.sheet('Lakeshore Bakery', true);
      await A.btn(A.top, 'Fix this sale').tap();
      await A.sheet('Fix this sale', true);
      await A.field(A.top, 'fix-rep').selectOption({ label: 'Mason' });
      await says(T + 'giving it back to the rep says he gets the commission at today\'s rates', A.top.locator('.field-hint:not([hidden])').last(), 'Mason gets the commission on this sale, at the rates in Settings today.');
      await A.foot.tap();
      await A.sheet('Lakeshore Bakery', true);
      await says(T + 'the sale is the rep\'s again', A.kv(A.top, 'Sold by'), 'Mason');
      await A.closeAll();
      await net.refresh(B);
      await says(T + 'and it is back on the rep\'s phone with what it earns', B.row(B.screen, 'Lakeshore Bakery'), /House wash, .*\$250\.00.*Earned \$75\.00/);

      /* the owner's own sale */
      await newSale(A);
      await fillSale(A, 'Owner Side Shed', '200');
      await A.btn(A.top, 'Book later').tap();
      await says(T + 'the owner entering his own sale is told "No commission on the owner\'s own sales."', A.top.locator('.sheet-foot .form-note'), exact('No commission on the owner\'s own sales.'));
      await A.foot.tap();
      await sees(T + 'his own sale saves', A.top.locator('.sold-title', { hasText: 'Sale saved' }));
      check(T + 'with no earned amount on the saved view', (await A.top.locator('.callout-ice').count()) === 0 && !/earned/i.test(tidy(await A.top.textContent())));
      await A.foot.tap();
      await says(T + 'and reads "No commission" in his list', A.row(A.screen, 'Owner Side Shed'), /Sold by Grayson.*\$200\.00.*No commission/);
      want = await month();
      await A.tab('Dashboard', 'Dashboard');
      const got = { revenue: tidy(await statNum(A, 'Revenue this month').textContent()), owed: tidy(await statNum(A, 'Commission owed this month').textContent()), count: tidy(await statNum(A, 'Sales this month').textContent()) };
      check(T + 'the Dashboard: 2 sales this month, revenue ' + words.moneyShort(want.revenue) + ' (the money due, worked out from the server\'s data), commission owed ' + words.moneyShort(want.owed) + ' (the owner\'s sale adds none)',
        want.revenue === 45000 && want.owed === 7500 && got.revenue === '$450' && got.owed === '$75' && got.count === '2', JSON.stringify(got));
    });

    /* ----- double booking ----- */
    await part(T + 'two people go for the same time', list, async () => {
      const time = R.times[1];
      await newSale(A);
      await fillSale(A, 'Owner Side Diner', '210');
      await A.pickTime(A.top, R.day, time);
      await newSale(B);
      await fillSale(B, 'Rep Side Diner', '220');
      await B.pickTime(B.top, R.day, time);
      await Promise.all([A.foot.tap(), B.foot.tap()]);
      const outcome = async (p) => {
        if (await p.top.locator('.sold-title').count()) return 'saved';
        if (await p.top.locator('.slotpick-times .form-error').count()) return 'refused';
        return '';
      };
      await until(async () => (await outcome(A)) && (await outcome(B)), WAIT);
      const a = await outcome(A), b = await outcome(B);
      check(T + 'both tap Save on ' + words.time(time) + ' at the same moment: one is saved, one is refused', [a, b].sort().join() === 'refused,saved', 'owner: ' + a + ', rep: ' + b);
      const loser = a === 'refused' ? A : B, winner = a === 'refused' ? B : A;
      const loserName = loser === A ? 'Owner Side Diner' : 'Rep Side Diner';
      await says(T + 'the one refused is told in plain words, at the appointment', loser.top.locator('.slotpick-times .form-error'), 'That time was just taken. Pick another.');
      check(T + 'everything they typed is still there', (await loser.field(loser.top, 'sale-name').inputValue()) === loserName && (await loser.field(loser.top, 'sale-price').inputValue()) !== '');
      const left = (await loser.top.locator('.slotpick-times .chip').allTextContents()).map(tidy);
      check(T + 'the taken time is no longer offered to them', left.length > 0 && left.indexOf(words.time(time)) < 0, left.join());
      const snap = await srv.snapshot();
      check(T + 'the system holds exactly one job at that time', snap.jobs.filter((j) => j.date === R.day && j.time === time && j.status !== 'cancelled').length === 1);
      check(T + 'and no sale was saved for the one refused', (await srv.salesNamed(loserName)) === 0);
      await loser.health('the New sale sheet after the refusal');
      await loser.pickTime(loser.top, R.day, R.times[2]);
      await loser.foot.tap();
      await sees(T + 'they pick another time and the sale saves', loser.top.locator('.sold-title'));
      check(T + 'saved once', (await srv.salesNamed(loserName)) === 1);
      await loser.foot.tap();
      await winner.foot.tap();
    });

    /* ----- saves that fail ----- */
    await part(T + 'a save fails and is tried again', list, async () => {
      /* 1. the server crashes (the dev server's ?fail=1): nothing was saved */
      await newSale(B);
      await fillSale(B, 'Pinecrest Motel', '260');
      await B.type(B.field(B.top, 'sale-notes'), 'Ask for the manager.');
      await B.btn(B.top, 'Book later').tap();
      cut(B, 'createSale', 'crash');
      await B.foot.tap();
      await says(T + 'when the server answers with an error page, the sale sheet says so in words by the button', B.top.locator('.sheet-foot .form-error'), NO_SIGNAL);
      check(T + 'the sale is still all there to try again', (await B.field(B.top, 'sale-name').inputValue()) === 'Pinecrest Motel' && (await B.field(B.top, 'sale-notes').inputValue()) === 'Ask for the manager.' && (await B.field(B.top, 'sale-price').inputValue()) === '260');
      check(T + 'nothing was saved by the failed try', (await srv.salesNamed('Pinecrest Motel')) === 0);
      await B.health('the New sale sheet after a failed save');
      mend(B);
      await B.foot.tap();
      await sees(T + 'tapping Save again saves it', B.top.locator('.sold-title'));
      check(T + 'the sale was saved once', (await srv.salesNamed('Pinecrest Motel')) === 1);
      await B.foot.tap();

      /* 2. a note: fails (nothing saved), is changed, is saved. The changed words are what is kept. */
      await B.tab('Clients', 'Clients');
      await B.row(B.screen, 'Pinecrest Motel').tap();
      await B.sheet('Pinecrest Motel');
      const cs = B.top;
      await B.btn(cs, 'Add note').tap();
      await B.sheet('Add note');
      await B.type(B.field(B.top, 'note'), 'First words');
      cut(B, 'addNote', 'crash');
      await B.foot.tap();
      await says(T + 'a note that cannot be saved says so right by its button', B.top.locator('.sheet-foot .form-error'), NO_SIGNAL);
      check(T + 'the note is still in the box', (await B.field(B.top, 'note').inputValue()) === 'First words');
      mend(B);
      await B.type(B.field(B.top, 'note'), 'Second words');
      await B.foot.tap();
      await sees(T + 'changed and saved again, it says "Note saved."', B.toast('Note saved.'));
      await says(T + 'and the note that shows is the changed one', cs.locator('.notes .note').first(), 'Second words');
      check(T + 'the system holds the changed note once and the first words not at all (the failed try never reached it)', (await srv.notesSaying('Second words')) === 1 && (await srv.notesSaying('First words')) === 0);
    });

    /* ----- the server itself stops ----- */
    await part(T + 'the server stops and comes back', list, async () => {
      const cs = B.top;
      await B.btn(cs, 'Add note').tap();
      await B.sheet('Add note', true);
      await B.type(B.field(B.top, 'note'), 'Gate code 4411');
      srv.child.kill('SIGSTOP');
      const stoppedAt = Date.now();
      await B.foot.tap();
      await sees(T + 'with the server stopped the button shows "Saving..."', B.btn(B.top, 'Saving...'), 3000);
      check(T + 'and nothing in the sheet can be typed or tapped meanwhile', (await B.top.locator('.sheet-body[inert]').count()) === 1);
      await says(T + 'after 20 seconds without an answer it says it could not save', B.top.locator('.sheet-foot .form-error'), NO_SIGNAL, 26000);
      check(T + 'that took about 20 seconds (' + Math.round((Date.now() - stoppedAt) / 1000) + ' s)', Date.now() - stoppedAt > 18000);
      check(T + 'the note is still in the box, and the box can be typed in again', (await B.field(B.top, 'note').inputValue()) === 'Gate code 4411' && (await B.top.locator('.sheet-body[inert]').count()) === 0);
      await B.health('the Add note sheet while the server is stopped');
      srv.child.kill('SIGCONT');
      await B.foot.tap();
      await sees(T + 'once the server is back, tapping again saves the note', B.toast('Note saved.'), 25000);
      await says(T + 'and it shows on the client', cs.locator('.notes .note').first(), 'Gate code 4411');
      await sleep(1500);
      check(T + 'the system holds that note exactly once', (await srv.notesSaying('Gate code 4411')) === 1, String(await srv.notesSaying('Gate code 4411')));
      await B.close();
      for (const p of [A, B, C]) { await net.refresh(p); await until(async () => !(await p.page.locator('#strip').isVisible()), LIVE); p.problems.length = 0; }
    });

    /* ----- a refresh that fails ----- */
    await part(T + 'the strip under the top bar', list, async () => {
      check(T + 'with a connection there is no strip', !(await B.page.locator('#strip').isVisible()));

      /* A background refresh that is answered "busy" (the page asks three times before it gives up). */
      cut(B, 'sync', 'busy', 3);
      await net.refresh(B);
      const answered = await until(() => B.faults.length && B.faults[0].left === 0, 10000);
      await sleep(1500);
      check(T + 'a background refresh answered "busy" shows no toast and no strip', answered && (await B.toasts.count()) === 0 && !(await B.page.locator('#strip').isVisible()),
        answered ? 'toasts: ' + (await B.toasts.allTextContents()).join(' / ') : 'the page did not refresh');
      mend(B);

      B.quietNet++;
      await B.ctx.setOffline(true);
      await net.refresh(B);
      check(T + 'and it does not count as a failed refresh: one real failure after it still shows no strip', !(await B.page.locator('#strip').isVisible()));
      await net.refresh(B);
      await says(T + 'after two refreshes fail, the strip says there is no connection and what time the data is from', B.page.locator('#strip-text'),
        /^No connection\. Showing what was saved at \d{1,2}:\d{2} [AP]M\. Trying again\.$/);
      await B.me();
      await says(T + 'under that strip the account sheet says "Last updated", never "Up to date"', B.top.locator('.me-foot'), /Last updated \d{1,2}:\d{2} [AP]M\./);
      check(T + '(it does not say "Up to date")', !/Up to date/.test(tidy(await B.top.locator('.me-foot').textContent())));
      await B.close();
      await B.tab('Sales', 'Sales');
      await sees(T + 'the app still shows what it last knew', B.row(B.screen, 'Pinecrest Motel'));
      await B.ctx.setOffline(false);
      await net.refresh(B);
      await gone(T + 'the strip clears once a refresh works again', B.page.locator('#strip'));
      B.quietNet--;
      B.problems.length = 0;

      /* the system can be reached, but answers with an error page */
      cut(B, 'sync', 'crash', 99);
      await net.refresh(B);
      await net.refresh(B);
      await says(T + 'when the system is reached but keeps answering with an error, the strip says "The system is not answering."', B.page.locator('#strip-text'),
        /^The system is not answering\. Showing what was saved at \d{1,2}:\d{2} [AP]M\. Trying again\.$/);
      await B.health('the rep\'s Sales tab under the strip');
      mend(B);
      await net.refresh(B);
      await gone(T + 'and that clears too once it answers', B.page.locator('#strip'));
      await B.me();
      await says(T + 'the account sheet says "Up to date" again', B.top.locator('.me-foot'), /Up to date as of \d{1,2}:\d{2} [AP]M\./);
      await B.close();
      await B.health('the rep\'s Sales tab after the connection came back');
    });

    /* ----- a new person, and a person removed ----- */
    await part(T + 'a new person signs in, and is removed with a sale half typed', list, async () => {
      await A.me();
      await A.row(A.top, 'Team').tap();
      await A.sheet('Team');
      await A.foot.tap();
      await A.sheet('Add person');
      await A.type(A.field(A.top, 'new-name'), 'Jake');
      await A.foot.tap();
      await sees(T + 'the owner adds a sales rep', A.top.locator('.sold-title', { hasText: 'Person added' }));
      const pin = tidy(await A.top.locator('.callout-big').textContent());
      check(T + 'and is shown his PIN once: 6 digits, made by the system, not an easy one', /^\d{6}$/.test(pin) && Core.check.pin(pin) === '', pin);
      await A.foot.tap();
      await A.closeAll();

      N = await open('the new rep\'s phone');
      await N.signInForm('Jake', pin);
      await N.signedIn();
      check(T + 'the new person signs in on his own phone with that PIN and gets the rep\'s tabs', (await N.page.locator('.tabbar .tab').allTextContents()).map(tidy).join() === 'Today,Sales,Calendar,Clients,Leaders');
      await newSale(N);
      await N.type(N.field(N.top, 'sale-name'), 'Half Typed Farm');
      await N.type(N.field(N.top, 'sale-phone'), '615-555-0188');
      await N.close();
      const drafts = async () => Object.keys(await N.stored()).filter((k) => /saleDraft/.test(k));
      check(T + 'he types half a sale and closes it: it is kept on his phone', await until(async () => (await drafts()).length === 1, 3000), (await drafts()).join());

      await A.me();
      await A.row(A.top, 'Team').tap();
      await A.sheet('Team', true);
      await A.row(A.top, 'Jake').tap();
      await A.sheet('Jake');
      await A.btn(A.top, 'Remove from team').tap();
      await A.dialog('Remove Jake from the team?');
      await A.answer('Remove');
      await sees(T + 'the owner removes him', A.toast('Jake is no longer on the team.'));
      await A.closeAll();
      await net.refresh(N);
      await sees(T + 'his phone lands on the sign-in screen by itself', N.page.locator('#signin:not([hidden])'));
      await says(T + 'and says he is no longer on the team', N.page.locator('#signin-body .form-error'), exact('You are no longer on the team. Ask the owner if that is a mistake.'));
      const left = Object.keys(await N.stored());
      check(T + 'nothing of his is left on that phone: no sign-in, no saved data, and the half-typed sale is gone', left.length === 0, left.join());
      await N.signInForm('Jake', pin);
      await says(T + 'he cannot sign back in', N.page.locator('#signin-body .form-error'), 'That name and PIN do not match. Check both and try again.');
      await N.health('the sign-in screen of the removed person');
    });

    /* ----- someone else on the same phone ----- */
    await part(T + 'another person signs in on the rep\'s phone', list, async () => {
      await B.signOut();
      const left = await B.page.evaluate(() => ({ keys: Object.keys(localStorage), screen: document.getElementById('screen').children.length, toasts: document.getElementById('toasts').children.length }));
      check(T + 'the rep signs out (after the question): nothing of his is left on the phone or the page', !left.keys.length && !left.screen && !left.toasts, JSON.stringify(left));
      await B.signInForm('Cole', PINS.Cole);
      await B.signedIn();
      check(T + 'Cole signs in on that phone and gets his own tabs', (await B.page.locator('.tabbar .tab').allTextContents()).map(tidy).join() === 'Today,Schedule,Standards');
      await techHoldsNoPrices(B, T + 'the phone now holds Cole\'s data only: none of the rep\'s sales, clients, prices or commission');
      const mine = await B.page.evaluate(() => ({ me: window.App.data.me.name, who: localStorage.getItem('ridgeline.live.who') === window.App.data.me.id, text: document.getElementById('app').textContent }));
      check(T + 'and shows nothing of the rep\'s', mine.me === 'Cole' && mine.who && !/Pinecrest Motel|Earned|Commission/.test(mine.text), mine.me);
      await B.health('the rep\'s phone with the tech signed in');
      await A.health('the owner\'s phone at the end');
      await C.health('the tech\'s phone at the end');
    });
  } finally {
    srv.stop();
    for (const p of list.slice()) await dropPhone(p);
  }
}

/* ============================================================================================
 * REAL MODE: ANSWERS THAT GET LOST
 * Nothing fails silently, nothing is saved twice, nothing is shown as saved that is not.
 * ============================================================================================ */

async function lostAnswers(browser) {
  const T = 'lost: ';
  const srv = await startServer();
  const net = plumbing(browser, srv), cut = net.cut, mend = net.mend, lose = net.lose;
  let A = null, B = null, C = null, N = null;
  const list = [];
  const L = { client: 'Signal Ridge Cafe', late: '23:58' };
  const open = async (who) => { const p = await net.open(who); list.push(p); return p; };
  const byButton = (p) => p.top.locator('.sheet-foot .form-error');
  const inert = async (p) => (await p.top.locator('.sheet-body[inert]').count()) === 1;
  const okButton = (p, text) => redToast(p, text).locator('.toast-btn', { hasText: exact('OK') });
  const retryButton = (p) => redToast(p, NO_SIGNAL).locator('.toast-btn', { hasText: exact('Retry') });
  const when = (date, time) => words.when(date, time, L.today);
  /* Where a red message that stays sits over the sheet on top: its bottom edge, and where the sheet's body starts. */
  const overSheet = (p) => p.page.evaluate(() => {
    const t = document.querySelector('#toasts .toast.is-sticky').getBoundingClientRect(), top = document.querySelector('#layers > .layer:last-child');
    return { headBottom: Math.round(top.querySelector('.sheet-head').getBoundingClientRect().bottom), messageTop: Math.round(t.top), messageBottom: Math.round(t.bottom),
      bodyTop: Math.round(top.querySelector('.sheet-body').getBoundingClientRect().top) };
  });
  const clearOf = (o) => o.messageTop >= o.headBottom && o.bodyTop >= o.messageBottom;
  /* No 20 second round of this phone falls in the next `ms` (its rounds start when it signs in). */
  async function calm(p, ms) {
    const left = 20000 - ((Date.now() - p.liveAt) % 20000);
    if (left < ms) await sleep(left + 1500);
  }
  /* Tap the footer button, see "Saving..." with the sheet's body out of reach, and close the sheet while it says so. */
  async function closeWhileSaving(p, name) {
    await p.foot.tap();
    const saving = await until(async () => (await p.btn(p.top, 'Saving...').count()) === 1 && (await inert(p)), 1200, 30);
    await p.close();
    return check(T + name + ': while it says "Saving..." nothing in the sheet can be typed or tapped, and the sheet can still be closed', !!saving);
  }

  try {
    await part(T + 'setting up', list, async () => {
      A = await open('the owner\'s phone');
      await A.signInForm('Grayson', PINS.Grayson);
      await A.signedIn();
      B = await open('the rep\'s phone');
      await B.signInForm('Mason', PINS.Mason);
      await B.signedIn();
      B.liveAt = Date.now();
      C = await open('the tech\'s phone');
      await C.signInForm('Cole', PINS.Cole);
      await C.signedIn();
      L.today = await A.today();

      /* every new job goes to Cole, and today gets one late time, so the tech has a job today whenever this runs */
      await A.me();
      await A.row(A.top, 'Settings').tap();
      await A.sheet('Settings', true);
      await A.row(A.top, 'Give new jobs to').tap();
      await A.sheet('Give new jobs to', true);
      await A.row(A.top, 'Cole').tap();
      await A.toast('New jobs go to Cole.').waitFor();
      await A.closeAll();
      await A.tab('Calendar', 'Availability');
      await A.day(A.screen, L.today).tap();
      await A.sheet(words.dayLong(L.today), true);
      await A.field(A.top, 'new-time').fill(L.late);
      await A.foot.tap();
      await A.toast(words.day(L.today, L.today) + ' is open with 5 times.').waitFor();

      await net.refresh(B);
      await newSale(B);
      await fillSale(B, L.client, '210');
      await B.pickTime(B.top, L.today, L.late);
      await B.foot.tap();
      await B.top.locator('.sold-title').waitFor();
      await B.foot.tap();
      await net.refresh(C);
      await sees(T + 'the tech has a job today (booked for ' + words.time(L.late) + ' and given to him by itself)', C.card(L.client));
      const free = (await freeDays(B)).filter((x) => x.times.length >= 4);
      L.d0 = free[0].date; L.t = free[0].times;
      L.d1 = free[1].date; L.u = free[1].times;
    });

    /* ----- New sale ----- */
    await part(T + 'New sale and a lost answer', list, async () => {
      /* the same sale again */
      await newSale(B);
      await fillSale(B, 'Lost One Bakery', '210');
      await B.btn(B.top, 'Book later').tap();
      lose(B, 'createSale');
      let from = srv.log.length;
      await B.foot.tap();
      await says(T + 'New sale: when the answer never arrives, the sheet says it could not save', byButton(B), NO_SIGNAL);
      check(T + 'New sale: (the system had in fact saved it)', (await srv.salesNamed('Lost One Bakery')) === 1);
      check(T + 'New sale: everything typed is still there', (await B.field(B.top, 'sale-name').inputValue()) === 'Lost One Bakery' && (await B.field(B.top, 'sale-price').inputValue()) === '210');
      await B.foot.tap();
      await sees(T + 'New sale: tapping Save again, unchanged, ends on "Sale saved"', B.top.locator('.sold-title', { hasText: 'Sale saved' }));
      check(T + 'New sale: there is one such sale, not two, because the retry carried the same id', (await srv.salesNamed('Lost One Bakery')) === 1 && srv.retried('createSale', from), srv.log.slice(from).trim().split('\n').slice(-3).join(' / '));
      mend(B);
      await B.foot.tap();

      /* changed before the retry */
      await calm(B, 9000);
      await newSale(B);
      await fillSale(B, 'Lost Two Diner', '300');
      await B.btn(B.top, 'Book later').tap();
      cut(B, 'createSale', 'drop');
      cut(B, 'sync', 'crash', 1);
      await B.foot.tap();
      await byButton(B).waitFor();
      await until(() => B.faults.every((f) => f.left === 0), 3000, 50);
      mend(B);
      await B.type(B.field(B.top, 'sale-price'), '350');
      await B.foot.tap();
      await sees(T + 'New sale: changed after a lost answer and saved again, it ends on "Sale saved"', B.top.locator('.sold-title', { hasText: 'Sale saved' }));
      await says(T + 'New sale: and says "Your first try was saved.", before the change', B.top.locator('.callout-warn'), /^Your first try was saved\..*before your last changes/);
      await says(T + 'New sale: showing the price that was really saved', B.kv(B.top, 'What they bought'), '$300.00');
      check(T + 'New sale: the system holds one sale at $300.00 and none at $350.00', (await srv.salesNamed('Lost Two Diner', 30000)) === 1 && (await srv.salesNamed('Lost Two Diner')) === 1);
      await B.health('the Sale saved view after a changed retry');
      await B.foot.tap();

      /* closed while it was saving, and the save failed */
      await newSale(B);
      await fillSale(B, 'Lost Three Motel', '400');
      await B.btn(B.top, 'Book later').tap();
      cut(B, 'createSale', 'slow-crash');
      await closeWhileSaving(B, 'New sale');
      const red = redToast(B, NO_SIGNAL + ' What you typed is kept.');
      await sees(T + 'New sale: closed while saving, a save that fails is still reported, in a red message that stays, with a way back', red.locator('.toast-btn', { hasText: exact('Open') }));
      check(T + 'New sale: nothing was saved by that try', (await srv.salesNamed('Lost Three Motel')) === 0);
      mend(B);
      await red.locator('.toast-btn').tap();
      await B.sheet('New sale', true);
      check(T + 'New sale: "Open" brings back what was typed', (await B.field(B.top, 'sale-name').inputValue()) === 'Lost Three Motel' && (await B.field(B.top, 'sale-price').inputValue()) === '400');
      await B.foot.tap();
      await B.top.locator('.sold-title').waitFor();
      check(T + 'New sale: and it then saves once', (await srv.salesNamed('Lost Three Motel')) === 1);
      await B.foot.tap();
    });

    /* ----- Book an appointment ----- */
    await part(T + 'Book an appointment and a lost answer', list, async () => {
      const name = 'Lost One Bakery';
      await B.tab('Clients', 'Clients');
      await B.row(B.screen, name).tap();
      await B.sheet(name, true);
      const book = async () => { await B.btn(B.top, 'Book an appointment').tap(); await B.sheet('Book an appointment', true); };
      const jobTimes = async () => (await B.top.locator('.row .row-time').allTextContents()).map(tidy).join(' | ');

      await book();
      await B.pickTime(B.top, L.d0, L.t[0]);
      lose(B, 'bookJob');
      let from = srv.log.length;
      await B.foot.tap();
      await says(T + 'Book an appointment: a lost answer says it could not save', byButton(B), NO_SIGNAL);
      check(T + 'Book an appointment: (the system had booked it)', (await srv.jobsAt(name, L.d0, L.t[0])) === 1);
      await B.foot.tap();
      await sees(T + 'Book an appointment: tapping again, unchanged, says "Booked for ' + when(L.d0, L.t[0]) + '."', B.toast('Booked for ' + when(L.d0, L.t[0]) + '.'));
      check(T + 'Book an appointment: booked once, not twice (the retry carried the same id)', (await srv.jobsAt(name, L.d0, L.t[0])) === 1 && srv.retried('bookJob', from));
      mend(B);

      await book();
      await B.pickTime(B.top, L.d0, L.t[1]);
      lose(B, 'bookJob');
      await B.foot.tap();
      await byButton(B).waitFor();
      await B.pickTime(B.top, L.d0, L.t[2]);
      await B.foot.tap();
      await sees(T + 'Book an appointment: a different time after a lost answer is answered "Your first try was saved...", in a red message that stays', okButton(B, FIRST_SAVED));
      check(T + 'Book an appointment: the sheet closes, so what was saved is on screen: ' + words.time(L.t[1]) + ', not ' + words.time(L.t[2]),
        await until(async () => (await B.layers()) === 1 && (await jobTimes()).indexOf(words.time(L.t[1])) >= 0 && (await jobTimes()).indexOf(words.time(L.t[2])) < 0), await jobTimes());
      check(T + 'Book an appointment: the system holds the first time once and the second not at all', (await srv.jobsAt(name, L.d0, L.t[1])) === 1 && (await srv.jobsAt(name, L.d0, L.t[2])) === 0);
      const over = await overSheet(B);
      check(T + 'Book an appointment: the message sits under the client sheet\'s header and hides none of the sheet (its body starts below the message)', clearOf(over), JSON.stringify(over));
      await B.health('the client sheet under the red message');
      await okButton(B, FIRST_SAVED).tap();
      await gone(T + 'Book an appointment: the message goes when OK is tapped', redToast(B, FIRST_SAVED));
      mend(B);

      await book();
      await B.pickTime(B.top, L.d0, L.t[3]);
      cut(B, 'bookJob', 'slow-crash');
      await closeWhileSaving(B, 'Book an appointment');
      await sees(T + 'Book an appointment: closed while saving, a save that fails is still reported, in a red message with Retry', retryButton(B));
      check(T + 'Book an appointment: nothing was booked by that try', (await srv.jobsAt(name, L.d0, L.t[3])) === 0);
      mend(B);
      await retryButton(B).tap();
      await sees(T + 'Book an appointment: Retry books it', B.toast('Booked for ' + when(L.d0, L.t[3]) + '.'));
      check(T + 'Book an appointment: once', (await srv.jobsAt(name, L.d0, L.t[3])) === 1);
      await B.closeAll();
    });

    /* ----- Move ----- */
    await part(T + 'Move and a lost answer', list, async () => {
      const name = 'Lost One Bakery';
      const at = async (date, time) => srv.jobsAt(name, date, time);
      await B.tab('Calendar', 'Open days');
      await B.screen.locator('.row').filter({ has: B.page.locator('.row-time', { hasText: words.day(L.d0, L.today) + words.time(L.t[0]) }) }).filter({ hasText: name }).tap();
      await B.sheet(name, true);
      const move = async () => { await B.row(B.top, 'Move to another time').tap(); await B.sheet('Move to another time', true); };
      const shown = async () => tidy(await B.top.locator('.card-title').textContent());

      await move();
      await B.pickTime(B.top, L.d1, L.u[0]);
      lose(B, 'moveJob');
      let from = srv.log.length;
      await B.foot.tap();
      await says(T + 'Move: a lost answer says it could not save', byButton(B), NO_SIGNAL);
      check(T + 'Move: (the system had moved it)', (await at(L.d1, L.u[0])) === 1 && (await at(L.d0, L.t[0])) === 0);
      await B.foot.tap();
      await sees(T + 'Move: tapping again, unchanged, says "Moved to ' + when(L.d1, L.u[0]) + '."', B.toast('Moved to ' + when(L.d1, L.u[0]) + '.'));
      check(T + 'Move: the job is there once (the retry carried the same id)', (await at(L.d1, L.u[0])) === 1 && srv.retried('moveJob', from) && (await shown()) === when(L.d1, L.u[0]), await shown());
      mend(B);

      await move();
      await B.pickTime(B.top, L.d1, L.u[1]);
      lose(B, 'moveJob');
      await B.foot.tap();
      await byButton(B).waitFor();
      await B.pickTime(B.top, L.d1, L.u[2]);
      await B.foot.tap();
      await sees(T + 'Move: a different time after a lost answer is answered "Your first try was saved..."', okButton(B, FIRST_SAVED));
      check(T + 'Move: the sheet closes and the job shows where it really is: ' + when(L.d1, L.u[1]), await until(async () => (await B.layers()) === 1 && (await shown()) === when(L.d1, L.u[1])), await shown());
      check(T + 'Move: the system holds it at the first time, and nothing at the second', (await at(L.d1, L.u[1])) === 1 && (await at(L.d1, L.u[2])) === 0 && (await at(L.d1, L.u[0])) === 0);
      await okButton(B, FIRST_SAVED).tap();
      mend(B);

      await move();
      await B.pickTime(B.top, L.d1, L.u[3]);
      cut(B, 'moveJob', 'slow-crash');
      await closeWhileSaving(B, 'Move');
      await sees(T + 'Move: closed while saving, a save that fails is still reported, in a red message with Retry', retryButton(B));
      check(T + 'Move: the job was not moved by that try', (await at(L.d1, L.u[1])) === 1 && (await at(L.d1, L.u[3])) === 0);
      mend(B);
      await retryButton(B).tap();
      await sees(T + 'Move: Retry moves it', B.toast('Moved to ' + when(L.d1, L.u[3]) + '.'));
      check(T + 'Move: and it is in one place only', (await at(L.d1, L.u[3])) === 1 && (await at(L.d1, L.u[1])) === 0);

      /* ----- Add note, on the same job ----- */
      const note = async () => { await B.btn(B.top, 'Add note').tap(); await B.sheet('Add note', true); };
      const newest = async () => tidy(await B.top.locator('.notes .note .note-text').first().textContent());
      await note();
      await B.type(B.field(B.top, 'note'), 'Gate code 2468');
      lose(B, 'addNote');
      from = srv.log.length;
      await B.foot.tap();
      await says(T + 'Add note: a lost answer says it could not save', byButton(B), NO_SIGNAL);
      check(T + 'Add note: the note is still in the box (and the system had saved it)', (await B.field(B.top, 'note').inputValue()) === 'Gate code 2468' && (await srv.notesSaying('Gate code 2468')) === 1);
      await B.foot.tap();
      await sees(T + 'Add note: tapping again, unchanged, says "Note saved."', B.toast('Note saved.'));
      check(T + 'Add note: the note is there once, not twice (the retry carried the same id)', (await srv.notesSaying('Gate code 2468')) === 1 && srv.retried('addNote', from) &&
        (await until(async () => (await B.layers()) === 1 && (await newest()) === 'Gate code 2468')));
      mend(B);

      await note();
      await B.type(B.field(B.top, 'note'), 'Use the side door');
      lose(B, 'addNote');
      await B.foot.tap();
      await byButton(B).waitFor();
      await B.type(B.field(B.top, 'note'), 'Use the back door');
      await B.foot.tap();
      await sees(T + 'Add note: changed words after a lost answer are answered "Your first try was saved..."', okButton(B, FIRST_SAVED));
      check(T + 'Add note: the sheet closes and the note that shows is the one that was saved', await until(async () => (await B.layers()) === 1 && (await newest()) === 'Use the side door'), await newest());
      check(T + 'Add note: the system holds the first words once and the changed words not at all', (await srv.notesSaying('Use the side door')) === 1 && (await srv.notesSaying('Use the back door')) === 0);
      await okButton(B, FIRST_SAVED).tap();
      mend(B);

      await note();
      await B.type(B.field(B.top, 'note'), 'Closed while saving');
      cut(B, 'addNote', 'slow-crash');
      await closeWhileSaving(B, 'Add note');
      await sees(T + 'Add note: closed while saving, a save that fails is still reported, in a red message with Retry', retryButton(B));
      check(T + 'Add note: nothing was saved by that try', (await srv.notesSaying('Closed while saving')) === 0);
      mend(B);
      await retryButton(B).tap();
      await sees(T + 'Add note: Retry saves it', B.toast('Note saved.'));
      check(T + 'Add note: once', (await srv.notesSaying('Closed while saving')) === 1);
      await B.closeAll();
      await net.refresh(B);
      await B.health('the rep\'s phone after the lost answers');
    });

    /* ----- Add person ----- */
    await part(T + 'Add person and a lost answer', list, async () => {
      N = await open('a spare phone');
      const signsIn = async (who, pin) => {
        await N.signInForm(who, pin);
        const inApp = await until(() => N.page.locator('#app:not([hidden])').isVisible(), 5000);
        if (inApp) await N.signOut();
        return inApp;
      };
      await A.me();
      await A.row(A.top, 'Team').tap();
      await A.sheet('Team', true);
      const team = A.page.locator('#layers > .layer').nth(1);      /* the Team sheet, under whatever opens on top of it (the account sheet is under both) */
      const pinShown = async () => tidy(await A.top.locator('.callout-big').textContent());

      /* the answer is lost; the person shows up on the list behind; tap again */
      await A.foot.tap();
      await A.sheet('Add person', true);
      await A.type(A.field(A.top, 'new-name'), 'Jake');
      cut(A, 'saveMember', 'drop');
      let from = srv.log.length;
      await A.foot.tap();
      await says(T + 'Add person: a lost answer says it could not save', byButton(A), NO_SIGNAL);
      check(T + 'Add person: the person was added all the same, and turns up on the Team list behind the sheet', await until(async () => (await team.locator('.row-title', { hasText: exact('Jake') }).count()) === 1) && (await srv.people('Jake')) === 1);
      await A.foot.tap();
      await sees(T + 'Add person: tapping again is not refused as "already has that name": it ends on "Person added"', A.top.locator('.sold-title', { hasText: 'Person added' }));
      const jake = await pinShown();
      check(T + 'Add person: with the PIN, there is one Jake, not two (the retry carried the same id)', /^\d{6}$/.test(jake) && (await srv.people('Jake')) === 1 && srv.retried('saveMember', from), jake);
      check(T + 'Add person: and that PIN signs Jake in', await signsIn('Jake', jake));
      await A.foot.tap();
      await A.sheet('Team', true);

      /* the name is changed before the retry */
      await A.foot.tap();
      await A.sheet('Add person', true);
      await A.type(A.field(A.top, 'new-name'), 'Nora');
      lose(A, 'saveMember');
      await A.foot.tap();
      await byButton(A).waitFor();
      await A.type(A.field(A.top, 'new-name'), 'Nina');
      await A.foot.tap();
      await says(T + 'Add person: a changed name after a lost answer says who was added and that the PIN did not come through', A.top.locator('.callout-warn'), 'Nora was added, but the PIN did not come through.');
      await says(T + 'Add person: and that the changed name was not added', A.top.locator('.sheet-body'), 'Nina was not added. Add them again if you still need to.');
      check(T + 'Add person: the system holds one Nora and no Nina', (await srv.people('Nora')) === 1 && (await srv.people('Nina')) === 0);
      mend(A);
      await A.health('the "PIN did not come through" view');
      await A.btn(A.top, 'Reset PIN').tap();
      await sees(T + 'Add person: "Reset PIN" right there shows a new PIN in the same sheet', A.top.locator('.callout-big'));
      const nora = await pinShown();
      check(T + 'Add person: and that PIN signs Nora in', /^\d{6}$/.test(nora) && (await signsIn('Nora', nora)), nora);
      await A.foot.tap();
      await A.sheet('Team', true);

      /* closed while it was saving, and the save failed */
      await A.foot.tap();
      await A.sheet('Add person', true);
      await A.type(A.field(A.top, 'new-name'), 'Omar');
      cut(A, 'saveMember', 'slow-crash');
      await closeWhileSaving(A, 'Add person');
      await sees(T + 'Add person: closed while saving, a save that fails is still reported, in a red message with Retry', retryButton(A));
      check(T + 'Add person: nobody was added by that try', (await srv.people('Omar')) === 0);
      mend(A);
      await retryButton(A).tap();
      await sees(T + 'Add person: Retry adds the person and shows the PIN once', A.top.locator('.sold-title', { hasText: 'Person added' }));
      const omar = await pinShown();
      check(T + 'Add person: once, with a PIN that signs Omar in', (await srv.people('Omar')) === 1 && (await signsIn('Omar', omar)), omar);
      await A.closeAll();
      await dropPhone(N);
      list.splice(list.indexOf(N), 1);
    });

    /* ----- a Settings sheet ----- */
    await part(T + 'Commission (a Settings sheet) and a lost answer', list, async () => {
      const rate = async () => (await srv.snapshot()).settings.firstPct;
      await A.me();
      await A.row(A.top, 'Settings').tap();
      await A.sheet('Settings', true);
      const commission = async () => { await A.row(A.top, 'Commission').tap(); await A.sheet('Commission', true); };
      const line = async () => tidy(await A.row(A.top, 'Commission').textContent());

      await commission();
      await A.type(A.field(A.top, 'pct-first'), '35');
      lose(A, 'saveSettings');
      let from = srv.log.length;
      await A.foot.tap();
      await says(T + 'Commission: a lost answer says it could not save', byButton(A), NO_SIGNAL);
      check(T + 'Commission: (the system had saved 35%)', (await rate()) === 35);
      await A.foot.tap();
      await sees(T + 'Commission: tapping again, unchanged, says "Commission saved."', A.toast('Commission saved.'));
      check(T + 'Commission: Settings shows 35% (the retry carried the same id)', srv.retried('saveSettings', from) && (await until(async () => (await A.layers()) === 2 && /^Commission35% on a new sale/.test(await line()))), await line());
      mend(A);

      await commission();
      await A.type(A.field(A.top, 'pct-first'), '40');
      lose(A, 'saveSettings');
      await A.foot.tap();
      await byButton(A).waitFor();
      await A.type(A.field(A.top, 'pct-first'), '45');
      await A.foot.tap();
      await sees(T + 'Commission: a different rate after a lost answer is answered "Your first try was saved..."', okButton(A, FIRST_SAVED));
      check(T + 'Commission: the sheet closes and Settings shows what was saved: 40%, not 45%', await until(async () => (await A.layers()) === 2 && /^Commission40% on a new sale/.test(await line())), await line());
      check(T + 'Commission: the system holds 40%', (await rate()) === 40);
      await okButton(A, FIRST_SAVED).tap();
      mend(A);

      await commission();
      await A.type(A.field(A.top, 'pct-first'), '50');
      cut(A, 'saveSettings', 'slow-crash');
      await closeWhileSaving(A, 'Commission');
      await sees(T + 'Commission: closed while saving, a save that fails is still reported, in a red message with Retry', retryButton(A));
      check(T + 'Commission: nothing was changed by that try', (await rate()) === 40);
      mend(A);
      await retryButton(A).tap();
      await sees(T + 'Commission: Retry saves it', A.toast('Commission saved.'));
      check(T + 'Commission: the system holds 50%', (await rate()) === 50);
      await A.closeAll();
      await net.refresh(A);
      await A.health('the owner\'s phone after the lost answers');
    });

    /* ----- Mark done ----- */
    await part(T + 'a Mark done that cannot be saved', list, async () => {
      const job = async () => (await srv.snapshot()).jobs.filter((j) => (j.client || {}).name === L.client && j.date === L.today)[0];
      const told = async () => (await srv.snapshot()).notices.filter((n) => /Cole marked Signal Ridge Cafe done/.test(n.text)).length;
      await C.tab('Today');
      const card = C.card(L.client), doneNum = C.screen.locator('.stats .stat').nth(1).locator('.stat-num');
      const doneBefore = tidy(await doneNum.textContent());

      cut(C, 'setJobDone', 'slow-crash', 1, 2500);
      await C.btn(card, 'Mark done').tap();
      await says(T + 'Mark done: until the system has it the card says "Saving..."', card.locator('.job-done-line'), exact('Saving...'), 2000);
      check(T + 'Mark done: its pill says "Saving", and the Done number does not count it yet', tidy(await card.locator('.pill').first().textContent()) === 'Saving' && tidy(await doneNum.textContent()) === doneBefore);
      await says(T + 'Mark done: when it cannot be saved the card carries a red line: "Not saved. Tap to try again."', card.locator('.job-unsaved'), exact('Not saved. Tap to try again.'));
      const failedAt = Date.now();
      await sees(T + 'Mark done: and a red message says why, with Retry', retryButton(C));
      check(T + 'Mark done: the job is back to "Scheduled", is not counted as done, and nothing says "Marked done."',
        tidy(await card.locator('.pill').first().textContent()) === 'Scheduled' && tidy(await doneNum.textContent()) === doneBefore && (await C.toast('Marked done.').count()) === 0 && (await job()).status === 'scheduled');
      mend(C);
      await card.locator('.job-name').tap();
      await C.sheet(L.client);
      check(T + 'Mark done: the job\'s sheet carries the same red line in place of the button', (await C.top.locator('.job-unsaved').count()) === 1 && (await C.btn(C.top, 'Mark done').count()) === 0);
      const over = await overSheet(C);
      check(T + 'Mark done: over that sheet the red message hides nothing: the sheet starts below it', clearOf(over), JSON.stringify(over));
      await C.close();
      await sleep(Math.max(0, failedAt + 9000 - Date.now()));
      check(T + 'Mark done: 9 seconds later the red line and the red message are both still there', (await card.locator('.job-unsaved').isVisible()) && (await retryButton(C).isVisible()));
      await C.health('Today with a job that was not saved');
      const room = await C.page.evaluate(() => {
        const line = document.querySelector('#screen .job-unsaved').getBoundingClientRect(), toast = document.querySelector('#toasts .toast.is-sticky').getBoundingClientRect();
        const canScroll = document.documentElement.scrollHeight - window.innerHeight - window.pageYOffset;
        return { lineBottom: Math.round(line.bottom), toastTop: Math.round(toast.top), canScroll: Math.round(canScroll) };
      });
      check(T + 'Mark done: the red message never traps the red line under it: the page can be scrolled until the line is clear of it', room.lineBottom - room.canScroll <= room.toastTop, JSON.stringify(room));
      await card.locator('.job-unsaved').tap();
      await says(T + 'Mark done: tapping the red line tries again, and the job is done', card, /Done .* by Cole/);
      await sees(T + 'Mark done: only now does it say "Marked done.", with Undo', C.toast('Marked done.').locator('.toast-btn', { hasText: exact('Undo') }));
      check(T + 'Mark done: the red line and the red message are gone, and the Done number counts it',
        (await card.locator('.job-unsaved').count()) === 0 && (await redToast(C, NO_SIGNAL).count()) === 0 && (await until(async () => tidy(await doneNum.textContent()) === String(+doneBefore + 1))) && (await job()).status === 'done');

      /* the same, with an answer that is lost after the system saved it */
      await C.btn(card, 'Undo').tap();
      await C.btn(card, 'Mark done').waitFor();
      const before = await told();
      lose(C, 'setJobDone');
      const from = srv.log.length;
      await C.btn(card, 'Mark done').tap();
      await sees(T + 'Mark done: a lost answer leaves the red line too', card.locator('.job-unsaved'));
      check(T + 'Mark done: (the system had in fact marked it done)', (await job()).status === 'done');
      await retryButton(C).tap();
      await says(T + 'Mark done: Retry on the red message finishes it', card, /Done .* by Cole/);
      mend(C);
      check(T + 'Mark done: the owner was told once, not twice (the retry carried the same id)', (await told()) === before + 1 && srv.retried('setJobDone', from), 'told ' + ((await told()) - before) + ' times');
      await net.refresh(C);
      await C.health('the tech\'s Today after the retries');
    });

    /* ----- opened with no signal ----- */
    await part(T + 'the app is opened with no signal', list, async () => {
      C.quietNet++;
      await C.ctx.setOffline(true);
      const openedAt = Date.now();
      await C.page.reload();
      await C.page.locator('#app:not([hidden])').waitFor();
      await says(T + 'opened with no signal, the app shows what it last knew and the strip says so at once', C.page.locator('#strip-text'),
        /^No connection\. Showing what was saved at \d{1,2}:\d{2} [AP]M\. Trying again\.$/, 5000);
      const took = Date.now() - openedAt;
      check(T + '(' + (took / 1000).toFixed(1) + ' s after opening: after the first failed refresh, not a second one 20 seconds later)', took < 8000);
      await sees(T + 'the saved copy is on screen under it', C.card(L.client));
      await C.me();
      await says(T + 'and the account sheet says "Last updated", not "Up to date"', C.top.locator('.me-foot'), /Last updated \d{1,2}:\d{2} [AP]M\./);
      await C.close();
      await C.health('Today opened with no signal');

      /* the same phone opened the next day (its clock is put a day ahead), still with no signal */
      await C.ctx.clock.setFixedTime(new Date(Date.now() + 26 * 3600 * 1000));
      await C.page.reload();
      await C.page.locator('#app:not([hidden])').waitFor();
      await says(T + 'opened the next day with no signal, the strip says which day the copy is from', C.page.locator('#strip-text'),
        new RegExp('^No connection\\. Showing what was saved ' + words.day(L.today, L.today) + ' at \\d{1,2}:\\d{2} [AP]M\\. Trying again\\.$'), 5000);
      await C.ctx.setOffline(false);
      await net.refresh(C);
      await gone(T + 'the strip clears once the signal is back', C.page.locator('#strip'));
      C.quietNet--;
      C.problems.length = 0;
    });
  } finally {
    srv.stop();
    for (const p of list.slice()) await dropPhone(p);
  }
}

/* ================= run ================= */

(async () => {
  if (!fs.existsSync(BUILT)) { console.error(BUILT + ' is missing. Build first: node tools/build.js'); process.exit(1); }
  const started = Date.now();
  let browser;
  try { browser = await chromium.launch({ headless: !HEADED }); } catch (e) {
    console.error('Chromium could not be started (npx playwright install chromium): ' + (e && e.message ? e.message.split('\n')[0] : e));
    process.exit(1);
  }
  const walks = { sample: sampleMode, start: startCases, real: realMode, lost: lostAnswers };
  const run = (wanted.length ? WALKS.filter((w) => wanted.indexOf(w) >= 0) : WALKS);
  /* Two lanes side by side (the walks share nothing but the browser): sample mode in one, real mode in the other. */
  const lanes = SERIAL ? [run] : [run.filter((w) => w === 'sample' || w === 'start'), run.filter((w) => w === 'real' || w === 'lost')];
  async function lane(names) {
    for (const name of names) {
      try { await walks[name](browser); }
      catch (e) { fail('the ' + name + ' walk stopped early', e && e.stack ? e.stack.split('\n').slice(0, 3).join(' ') : e); }
    }
  }
  try { await Promise.all(lanes.map(lane)); }
  finally { await browser.close(); }
  console.log('');
  if (fontsMissing) console.log('note  the web fonts could not be fetched here, so the layout was checked in the fallback fonts');
  console.log(tally.ok + ' passed, ' + tally.bad + ' failed, in ' + Math.round((Date.now() - started) / 1000) + ' s, on a ' + WIDTH + 'x' + HEIGHT + ' screen');
  if (tally.bad) { console.log('Failed:'); tally.failed.forEach((n) => console.log('  ' + n)); }
  process.exit(tally.bad ? 1 : 0);
})();
