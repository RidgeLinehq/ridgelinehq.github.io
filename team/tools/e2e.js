#!/usr/bin/env node
/*
 * End-to-end check of the BUILT page (team/index.html), driven the way a person drives it:
 * a phone-sized Chromium (390x844, touch), real taps and real typing, nothing called behind the UI.
 *
 *   node tools/build.js && node tools/e2e.js          both halves (about 4 minutes)
 *   node tools/e2e.js sample                          sample mode only  (index.html?sample=1)
 *   node tools/e2e.js real                            real mode only    (index.html?backend=<tools/dev-server.js>)
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
 * to tap), what the page has stored on the phone, and, in real mode, the server's own data to count what
 * was really saved. The one thing it writes is a marker on the page, to prove the page was never reloaded.
 * Two controls have no keys to type with in a headless browser, so they are set directly: a <select>
 * (selectOption) and the native time box (fill).
 *
 * Real mode starts tools/dev-server.js on a free port (Grayson 1234, Mason 2222, Cole 3333) and signs in
 * on three separate phones. Failed saves are made three ways: the dev server's own ?fail=1 knob (the
 * request is sent on to it with that added), an answer that is lost after the server saved, and the server
 * process itself stopped (SIGSTOP) and started again (SIGCONT), which keeps its data. A "busy" answer to
 * a background refresh is handed to the page in the server's place.
 *
 * Both halves read the clock, so a run that straddles midnight (Central time) can fail for that reason alone.
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
const BUILT = args.includes('--page') ? path.resolve(args[args.indexOf('--page') + 1]) : path.join(ROOT, 'index.html');
const PAGE = 'file://' + BUILT;
const only = args.find((a) => a === 'sample' || a === 'real') || '';
const SHOTS = args.includes('--shots') ? (args[args.indexOf('--shots') + 1] || '') : '';
const HEADED = args.includes('--headed');
const WAIT = 8000;          /* how long a thing may take to show up */
const LIVE = 27000;         /* "within about 25 seconds": one 20 second refresh plus the answer */

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
  when(d, t, today) { return words.day(d, today) + ' at ' + words.time(t); },
  month(ym) { return MONTHS[+ym.slice(5, 7) - 1] + ' ' + ym.slice(0, 4); },
  monthKey(title) { const m = /^(\w+) (\d{4})$/.exec(tidy(title)); return m ? m[2] + '-' + String(MONTHS.indexOf(m[1]) + 101).slice(1) : ''; },
  hm(label) { const m = /^(\d{1,2}):(\d{2}) (AM|PM)$/.exec(tidy(label)); const h = (+m[1] % 12) + (m[3] === 'PM' ? 12 : 0); return String(h + 100).slice(1) + ':' + m[2]; }
};

/* ================= a phone ================= */

class Phone {
  constructor(ctx, page, who) {
    this.ctx = ctx; this.page = page; this.who = who;
    this.problems = [];      /* console errors and page errors since the last health check */
    this.quietNet = 0;       /* while > 0, the browser's own "request failed" lines are expected */
    page.setDefaultTimeout(WAIT);
    page.on('console', (m) => {
      if (m.type() !== 'error') return;
      const text = m.text(), where = (m.location() || {}).url || '';
      if (/fonts\.(googleapis|gstatic)\.com/.test(where + ' ' + text)) { fontsMissing = true; return; }
      if (this.quietNet && /Failed to load resource|net::ERR_|ERR_INTERNET_DISCONNECTED/.test(text)) return;
      this.problems.push('console error: ' + text);
    });
    page.on('pageerror', (e) => this.problems.push('page error: ' + e.message));
  }

  get screen() { return this.page.locator('#screen'); }
  get top() { return this.page.locator('#layers > .layer').last(); }           /* the sheet or dialog on top */
  get foot() { return this.top.locator('.sheet-foot .btn'); }                   /* its footer button */
  get toasts() { return this.page.locator('#toasts .toast'); }
  row(scope, title) { return scope.locator('.row').filter({ has: this.page.locator('.row-title', { hasText: title instanceof RegExp ? title : exact(title) }) }); }
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
  async signOut() {
    await this.closeAll();
    await this.me();
    await this.row(this.top, 'Sign out').tap();
    await this.page.locator('#signin:not([hidden])').waitFor();
  }
  async signInForm(name, pin) {
    await this.type(this.page.locator('#signin-body [name="name"]'), name);
    await this.type(this.page.locator('#signin-body [name="pin"]'), pin);
    await this.page.locator('#signin-body button[type="submit"]').tap();
  }
  async signedIn() { await this.page.locator('#app:not([hidden])').waitFor(); }
  today() { return this.page.evaluate(() => window.App.today()); }

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

async function newPhone(browser, who, url) {
  const ctx = await browser.newContext({
    viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true, deviceScaleFactor: 2,
    locale: 'en-US', timezoneId: 'America/Chicago', permissions: ['clipboard-read', 'clipboard-write']
  });
  const page = await ctx.newPage();
  const p = new Phone(ctx, page, who);
  phones.push(p);
  await page.goto(url);
  await page.locator('#signin:not([hidden]), #app:not([hidden])').first().waitFor();
  return p;
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

/* ============================================================================================
 * SAMPLE MODE
 * ============================================================================================ */

async function sampleMode(browser) {
  const T = 'sample: ';
  const p = await newPhone(browser, 'sample phone', PAGE + '?sample=1');
  const list = [p];
  const S = { name: 'Birch Hollow Farm' };       /* what the walk makes, remembered for later parts */

  const quick = (role) => p.page.locator('#signin-body .btn', { hasText: exact(role) });
  async function asRole(role) {
    await quick(role).tap();
    await p.signedIn();
  }

  await part(T + 'the sign-in screen', list, async () => {
    await sees(T + 'the sign-in screen shows the logo, the tagline and the sign-in form', p.page.locator('#signin .signin-logo svg'));
    await says(T + 'the tagline reads "A higher standard of clean"', p.page.locator('#signin .tagline'), 'A higher standard of clean');
    await says(T + 'sample mode says so and offers the three roles', p.page.locator('#signin-body .card'), /Sample mode.*made-up data.*Owner.*Sales rep.*Tech/);
    await says(T + 'the form says who resets a forgotten PIN', p.page.locator('#signin-body .hint'), 'Forgot your PIN? Ask Grayson to reset it.');
    await p.health('the sign-in screen');
  });

  await part(T + 'wrong PINs', list, async () => {
    await p.page.locator('#signin-body button[type="submit"]').tap();
    await says(T + 'signing in with nothing typed asks for the name', p.page.locator('#signin-body .field-error:not([hidden])'), 'Type your name.');
    await p.signInForm('Avery', '0000');
    await says(T + 'a wrong PIN shows the system\'s own words', p.page.locator('#signin-body .form-error'), 'That name and PIN do not match. Check both and try again.');
    await check(T + 'what was typed is still in the boxes after a wrong PIN', (await p.field(p.page, 'name').inputValue()) === 'Avery');
    for (let i = 0; i < 4; i++) {
      await p.signInForm('Avery', '000' + (i + 1));
      await p.page.locator('#signin-body button[type="submit"]:not([disabled])').waitFor();
    }
    await p.signInForm('Avery', '3333');
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
      await p.tab('Today');
      await sees(T + role + ': Today shows the date as its title and the three numbers', p.screen.locator('.stats .stat').nth(2));
      await p.me();
      const rows = (await p.top.locator('.row .row-title').allTextContents()).map(tidy);
      check(T + role + ': the account sheet lists ' + t.me.join(', '), rows.join() === t.me.join(), 'got ' + rows.join(', '));
      await says(T + role + ': the account sheet names ' + t.name + ' as ' + t.role, p.top.locator('.me-head'), new RegExp(t.name + '\\s*' + t.role));
      await p.health('the account sheet');
      check(T + role + ': the bell is ' + (role === 'Owner' ? 'there' : 'not there'), (await p.page.locator('#bell-btn').isVisible()) === (role === 'Owner'));
      await p.close();
      await p.signOut();
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

    await p.foot.tap();
    await says(T + 'saving an empty sale marks the name', sh.locator('.field.has-error').first(), 'Add the customer or business name.');
    const marked = (await sh.locator('.field-error:not([hidden]), .slotpick-times .form-error').allTextContents()).map(tidy);
    check(T + 'it marks all six things that are missing', ['Add the customer or business name.', 'Add a phone number.', 'Add the address.', 'Pick what was sold.', 'Enter the price.', 'Pick a time, or tap Book later.']
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
    await says(T + 'the saved view names the customer', p.kv(sh, 'Customer'), S.name);
    await says(T + 'the saved view shows the appointment', p.kv(sh, 'Appointment'), S.when);
    await says(T + 'the saved view shows what was earned', sh.locator('.callout-ice'), /You earned\s*\$103\.65\s*Then \$34\.55 every month they stay\./);
    await p.health('the Sale saved view');
    await p.btn(sh, 'Done').tap();
    await until(async () => (await p.layers()) === 0);

    const row = p.row(p.screen, S.name);
    await says(T + 'the sale is in My sales with its price and what it earned', row, /House wash, .*\$345\.50\/mo.*\+\$103\.65/);
    const after = { month: tidy(await p.screen.locator('.nums-cell .stat-label').nth(1).textContent()), big: tidy(await p.screen.locator('.big-num').first().textContent()) };
    const money = (s) => Math.round(parseFloat(s.replace(/[$,]/g, '')) * 100);
    check(T + 'My numbers went up by one sale and $103.65 commission', parseInt(after.month, 10) === parseInt(before.month, 10) + 1 && money(after.big) === money(before.big) + 10365,
      before.month + ' / ' + before.big + ' became ' + after.month + ' / ' + after.big);

    await p.tab('Clients', 'Clients');
    await says(T + 'the new client is in the rep\'s Clients', p.row(p.screen, S.name), /House wash, \$345\.50 a month.*New/);

    await p.tab('Calendar', 'Open days');
    await p.showMonth(p.screen, S.day.slice(0, 7));
    await p.day(p.screen, S.day).tap();
    await p.sheet(words.dayLong(S.day));
    const tags = (await p.top.locator('.time-tag').allTextContents()).map(tidy);
    check(T + 'on the rep\'s calendar that time is no longer free', tags.length > 0 && tags.indexOf(words.time(S.time)) < 0, 'free: ' + tags.join(', '));
    await sees(T + 'the day lists the rep\'s own appointment', p.row(p.top, S.name));
    await p.foot.tap();
    await p.sheet('New sale');
    await says(T + '"New sale on this day" opens New sale on that day', p.top.locator('.slotpick-day'), exact(words.dayLong(S.day)));
    const left = (await p.top.locator('.slotpick-times .chip').allTextContents()).map(tidy);
    check(T + 'the booked time is gone from the picker', left.length > 0 && left.indexOf(words.time(S.time)) < 0, 'offered: ' + left.join(', '));
    await p.closeAll();
    await p.signOut();
  });

  /* ----- the owner sees all of it ----- */
  await part(T + 'the owner sees the sale, the job, the client and a notification', list, async () => {
    await asRole('Owner');
    await sees(T + 'the owner\'s bell shows a dot', p.page.locator('#bell-btn.has-dot'));
    await p.page.locator('#bell-btn').tap();
    await p.sheet('Notifications');
    await says(T + 'the newest notification is the sale and its booking', p.top.locator('.row.notice').first(), /Mason sold House wash to Birch Hollow Farm for \$345\.50 a month\. Booked .*\./);
    await sees(T + 'it is marked as new', p.top.locator('.row.notice.is-new').first());
    await p.close();
    await gone(T + 'the bell\'s dot clears once the notifications were opened', p.page.locator('#bell-btn.has-dot'));

    await p.tab('Sales', 'Sales');
    await says(T + 'the owner\'s Sales lists it with who sold it', p.row(p.screen, S.name), /Sold by Mason/);
    await p.row(p.screen, S.name).tap();
    await p.sheet(S.name);
    await says(T + 'the sale sheet shows the appointment', p.top.locator('.row .row-time'), words.time(S.time));
    await says(T + 'the sale sheet lists the commission by date', p.top, /New sale, 30% of the price\s*\$103\.65/);
    await says(T + 'a running monthly sale says when it pays next', p.top.locator('.hint'), 'Next: $34.55 on ' + words.day(D.addMonths(S.today, 1), S.today) + ', if they are still a client.');
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
    await p.btn(cs, 'Copy').tap();
    await sees(T + 'Copy says the payment link was copied', p.toasts.filter({ hasText: 'Payment link copied.' }));
    await says(T + 'the note typed with the sale is in the client\'s notes', cs.locator('.notes .note').first(), /Mason, .*Two story house\. Use the side gate\./);
    await says(T + 'the visit is under Jobs', cs.locator('.row .row-time').first(), words.time(S.time));
    await p.close();
    await p.type(p.field(p.screen, 'client-search'), '');

    await p.tab('Calendar', 'Availability');
    await p.showMonth(p.screen, S.day.slice(0, 7));
    await p.day(p.screen, S.day).tap();
    await p.sheet(words.dayLong(S.day));
    await says(T + 'the owner\'s day sheet lists the booking and who sold it', p.row(p.top, S.name), 'Sold by Mason');
    await p.top.locator('.switch').tap();
    await says(T + 'switching a booked day off warns that the booking stays', p.top.locator('.callout-warn'), /already booked on this day.*Blocking the day does not cancel/);
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
    await p.btn(ds, 'Add a time').tap();
    await p.field(ds, 'new-time').fill('10:15');
    await p.btn(ds, 'Add').tap();
    await sees(T + 'a time can be removed and another added', ds.locator('.chip-x[aria-label="Remove 10:15 AM"]'));
    await p.btn(ds, 'Add a time').tap();
    await p.field(ds, 'new-time').fill('10:15');
    await p.btn(ds, 'Add').tap();
    await says(T + 'the same time twice is refused', ds.locator('.field-error:not([hidden])'), '10:15 AM is already on the list.');
    await p.health('the day sheet with its times');
    await p.foot.tap();
    await sees(T + 'saving says the day is open with 4 times', p.toasts.filter({ hasText: words.day(blocked, S.today) + ' is open with 4 times.' }));
    await says(T + 'the calendar now shows that day with 4 left', p.day(p.screen, blocked), '4 left');

    /* block an open day */
    await p.showMonth(p.screen, quietDay.slice(0, 7));
    await p.day(p.screen, quietDay).tap();
    await p.sheet(words.dayLong(quietDay), true);
    await p.top.locator('.switch').tap();
    await p.foot.tap();
    await sees(T + 'blocking an open day says so', p.toasts.filter({ hasText: words.day(quietDay, S.today) + ' is blocked.' }));
    check(T + 'the calendar shows that day as blocked', await until(async () => /is-blocked/.test(await p.day(p.screen, quietDay).getAttribute('class'))));

    await p.tab('Sales', 'Sales');
    await p.btn(p.screen, 'New sale').tap();
    await p.sheet('New sale', true);
    await p.showMonth(p.top, quietDay.slice(0, 7));
    check(T + 'in the picker the blocked day is greyed out and cannot be tapped', (await p.day(p.top, quietDay).evaluate((el) => el.tagName + ' ' + el.className)).indexOf('SPAN') === 0);
    check(T + 'and the day that was just opened can be picked', (await p.timesOn(p.top, blocked)).join() === '09:30,10:15,12:00,14:00');
    await p.close();

    /* open weekdays, block all */
    await p.tab('Calendar', 'Availability');
    await p.showMonth(p.screen, quietDay.slice(0, 7));
    await p.btn(p.screen, 'Open weekdays').tap();
    await sees(T + '"Open weekdays" says how many it opened', p.toasts.filter({ hasText: /weekdays? opened in/ }));
    check(T + 'the day blocked a moment ago is open again', await until(async () => /is-open/.test(await p.day(p.screen, quietDay).getAttribute('class'))));
    const openNow = await p.screen.locator('.month-days .day.is-open, .month-days .day.is-full').count();
    await p.btn(p.screen, 'Block all').tap();
    await p.dialog('Block all of');
    await p.answer('Keep them');
    check(T + '"Block all" asks first, and "Keep them" changes nothing', (await p.screen.locator('.month-days .day.is-open, .month-days .day.is-full').count()) === openNow);

    const far = D.addMonths(S.today.slice(0, 8) + '01', 3).slice(0, 7);
    await p.showMonth(p.screen, far);
    await p.btn(p.screen, 'Open weekdays').tap();
    const farName = words.month(far).split(' ')[0];
    await sees(T + 'a month far ahead opens all its weekdays in one tap', p.toasts.filter({ hasText: new RegExp('\\d+ weekdays opened in ' + farName) }));
    const made = await p.screen.locator('.month-days .day.is-open').count();
    await p.btn(p.screen, 'Block all').tap();
    await p.dialog('Block all of');
    await p.answer('Block all');
    await sees(T + '"Block all" blocks them again after the question', p.toasts.filter({ hasText: made + ' days blocked in ' + farName }));
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
    check(T + 'the Assign sheet offers only techs and owners (Cole, Grayson), no sales reps', people.join() === 'Cole,Grayson', 'offered: ' + people.join(', '));
    await p.row(p.top, 'Cole').tap();
    await sees(T + 'assigning says "Assigned to Cole."', p.toasts.filter({ hasText: 'Assigned to Cole.' }));
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
    await sees(T + 'moving says where it moved to', p.toasts.filter({ hasText: 'Moved to ' + words.when(to.date, to.time, S.today) + '.' }));
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
    await p.answer('Keep it');
    await p.btn(p.top, 'Cancel job').tap();
    await p.dialog('Cancel this job?');
    await p.answer('Cancel job');
    await sees(T + 'cancelling a job asks first, then says "Job cancelled." with Undo', p.toasts.filter({ hasText: 'Job cancelled.' }));
    await gone(T + 'the cancelled job leaves Coming up', p.row(p.screen, job));
    await p.toasts.filter({ hasText: 'Job cancelled.' }).locator('.toast-btn').tap();
    await sees(T + 'Undo puts it back on the schedule', p.row(p.screen, job));
  });

  /* ----- a sale waiting for an appointment ----- */
  await part(T + 'the owner books a sale that was waiting', list, async () => {
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
    await sees(T + 'booking it says when', p.toasts.filter({ hasText: 'Booked for ' + words.when(at.date, at.time, S.today) + '.' }));
    await p.sheet('Walnut Street Duplex', true);
    await says(T + 'the sale now shows its appointment', p.top.locator('.row .row-time'), words.time(at.time));
    await p.close();
    await gone(T + 'nothing is waiting for an appointment on the Dashboard any more', p.row(p.screen, /waiting for an appointment/));
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
    await sees(T + 'a service can be added', p.toasts.filter({ hasText: 'Services saved.' }));
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
    await p.foot.tap();
    await p.sheet('Settings', true);
    await says(T + 'the usual times are saved', p.row(p.top, 'Usual appointment times'), '8:00 AM, 9:30 AM, 12:00 PM, 2:00 PM, 4:00 PM');

    await p.row(p.top, 'Give new jobs to').tap();
    await p.sheet('Give new jobs to');
    const who = (await p.top.locator('.row .row-title').allTextContents()).map(tidy);
    check(T + '"Give new jobs to" offers Nobody, techs and owners, no sales reps', who.join() === 'Nobody,Cole,Grayson', 'offered: ' + who.join(', '));
    await p.row(p.top, 'Cole').tap();
    await sees(T + 'choosing Cole says new jobs go to him', p.toasts.filter({ hasText: 'New jobs go to Cole.' }));
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

    await p.tab('Sales', 'Sales');
    await p.btn(p.screen, 'New sale').tap();
    await p.sheet('New sale', true);
    await sees(T + 'New sale offers the new service', p.top.locator('.chip', { hasText: exact('Gutter cleaning') }));
    await p.top.locator('.chip', { hasText: exact('Gutter cleaning') }).tap();
    await says(T + 'the line above the button uses the new commission rate', p.top.locator('.sheet-foot .form-note'), 'You earn $30.00 on this sale.');

    /* the owner sells to an existing client for one of his reps, and books later */
    await p.btn(p.top, 'Existing client').tap();
    await p.type(p.field(p.top, 'sale-find'), 'parker');
    await p.row(p.top, 'Parker Residence').tap();
    await sees(T + 'an existing client can be searched for and picked', p.top.locator('.card', { hasText: 'Parker Residence' }));
    await p.field(p.top, 'sale-rep').selectOption({ label: 'Avery' });
    await says(T + 'choosing who sold it changes whose earnings the line shows', p.top.locator('.sheet-foot .form-note'), 'Avery earns $30.00 on this sale.');
    await p.btn(p.top, 'Book later').tap();
    await says(T + '"Book later" turns the button into plain "Save sale"', p.foot, exact('Save sale'));
    await p.foot.tap();
    await sees(T + 'the sale saves without an appointment', p.top.locator('.sold-title'));
    await says(T + 'the saved view says it is not booked yet and who earned', p.top, /Not booked yet.*Avery earned\s*\$30\.00/);
    await p.btn(p.top, 'Done').tap();
    await until(async () => (await p.layers()) === 0);
    const row = p.row(p.screen, 'Parker Residence').filter({ hasText: 'Gutter cleaning' });
    await says(T + 'it is listed under Avery with "No appointment yet"', row, /Sold by Avery.*No appointment yet/);
    await row.tap();
    await p.sheet('Parker Residence');
    await p.btn(p.top, 'Remove sale').tap();
    await p.dialog('Remove this sale?');
    await p.answer('Remove sale');
    await sees(T + 'the owner can remove a sale after a question', p.toasts.filter({ hasText: 'Sale removed.' }));
    await gone(T + 'the removed sale leaves the list', row);
  });

  /* ----- company standards: the owner edits ----- */
  await part(T + 'the owner edits the company standards', list, async () => {
    await p.me();
    await p.row(p.top, 'Company standards').tap();
    await p.screen.locator('h1.title', { hasText: 'Company standards' }).waitFor();
    await p.health('the Company standards page');
    await sees(T + 'the standards page shows his photo with the tagline across it', p.screen.locator('.std-photo img'));
    check(T + 'the photo really loaded', await p.screen.locator('.std-photo img').evaluate((img) => img.complete && img.naturalWidth > 0));
    await says(T + 'the owner sees how many have read them', p.screen.locator('.std-foot'), '1 of 3 have read these.');
    await p.btn(p.screen, 'Edit standards').tap();
    await p.sheet('Edit standards');
    const ed = p.top;
    await says(T + 'the editor says a change asks everyone to confirm again', ed.locator('.sheet-foot'), 'Saving a change asks everyone to read these again and confirm.');
    const box = p.field(ed, 'std-items-0');
    await box.tap();
    await box.press('Control+End');
    await box.press('Enter');
    await box.pressSequentially('Close every gate behind you.');
    await p.btn(ed, 'Add a section').tap();
    await p.type(p.field(ed, 'std-title-5'), 'Scratch section');
    await ed.locator('.card').nth(5).locator('.btn', { hasText: 'Remove section' }).tap();
    await p.dialog('Remove this section?');
    await p.answer('Remove section');
    check(T + 'a section can be added and removed again', await until(async () => (await ed.locator('.card').count()) === 5));
    await p.foot.tap();
    await sees(T + 'saving says the team will be asked to read them again', p.toasts.filter({ hasText: 'Standards saved. Your team will be asked to read them again.' }));
    await says(T + 'the page shows the new line', p.screen.locator('.std-sec').first(), 'Close every gate behind you.');
    await says(T + 'nobody has read the changed standards yet', p.screen.locator('.std-foot'), '0 of 3 have read these.');
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
    await p.foot.tap();
    await p.sheet('Person added');
    S.jakePin = tidy(await p.top.locator('.callout-big').textContent());
    check(T + 'a new person gets a PIN, shown once in a clear box', /^\d{4}$/.test(S.jakePin), S.jakePin);
    await says(T + 'the box says to tell them in person', p.top.locator('.callout'), /PIN for Jake.*Tell them in person\. It is not shown again\./);
    await p.foot.tap();
    await p.sheet('Team', true);
    await sees(T + 'Jake is listed in Team', p.row(p.top, 'Jake'));

    await p.row(p.top, 'Avery').tap();
    await p.sheet('Avery');
    await p.row(p.top, 'Reset PIN').tap();
    await p.dialog('Reset the PIN for Avery?');
    await p.answer('Reset PIN');
    await p.sheet('New PIN');
    S.averyPin = tidy(await p.top.locator('.callout-big').textContent());
    check(T + 'Reset PIN shows the new PIN once', /^\d{4}$/.test(S.averyPin), S.averyPin);
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
    await sees(T + 'the tech is reminded to read the company standards', p.screen.locator('.remind', { hasText: 'Read these before your next job.' }));
    await sees(T + 'an overdue job is pinned first in red', p.screen.locator('article.job').first().locator('.pill-bad', { hasText: 'Overdue' }));
    const card = p.card('Oak Hill Driveway');
    await sees(T + 'the job the owner assigned is on the tech\'s Today', card);
    const doneBefore = tidy(await p.screen.locator('.stats .stat').nth(1).locator('.stat-num').textContent());
    await p.btn(card, 'Mark done').tap();
    await says(T + '"Mark done" flips the card at once and says who did it', card, /Done .* by Cole/);
    check(T + 'the Done number on Today goes up', await until(async () => tidy(await p.screen.locator('.stats .stat').nth(1).locator('.stat-num').textContent()) === String(+doneBefore + 1)));
    await p.btn(card, 'Undo').tap();
    await sees(T + 'Undo puts the job back', p.btn(card, 'Mark done'));
    await p.btn(card, 'Mark done').tap();
    await sees(T + 'and it can be marked done again', card.locator('.pill-good', { hasText: 'Done' }));

    const parker = p.card('Parker Residence');
    await p.btn(parker, 'Add note').tap();
    await p.sheet('Add note');
    await p.foot.tap();
    await says(T + 'an empty note is refused', p.top.locator('.field-error:not([hidden])'), 'Write the note first.');
    await p.type(p.field(p.top, 'note'), 'Dog in the yard. Knock first.');
    await p.foot.tap();
    await sees(T + 'a note saves', p.toasts.filter({ hasText: 'Note saved.' }));
    await says(T + 'the newest note shows on the job card', parker.locator('.meta-row.is-note'), 'Dog in the yard. Knock first.');
    const call = await p.btn(parker, 'Call').getAttribute('href');
    check(T + 'the card\'s Call button is a phone link', call === 'tel:6155550142', call);

    await p.tab('Schedule', 'Schedule');
    await p.row(p.screen, S.name).tap();
    await p.sheet(S.name);
    await p.btn(p.top, 'Mark done').tap();
    await says(T + 'the tech marks the new job done from its sheet', p.top.locator('.callout-good'), /Done .* by Cole/);
    await p.close();
    await sees(T + 'it moves to Recently done', p.row(p.screen, S.name).locator('.pill-good'));

    await p.tab('Standards', 'Company standards');
    await p.btn(p.screen, 'I have read these').tap();
    await sees(T + 'the tech confirms the standards', p.screen.locator('.std-ok', { hasText: 'You confirmed these on ' + words.dayShort(S.today) + '.' }));
    await p.tab('Today');
    await gone(T + 'the reminder is gone from Today', p.screen.locator('.remind'));

    /* change PIN */
    await p.me();
    await p.row(p.top, 'Change PIN').tap();
    await p.sheet('Change PIN');
    await p.type(p.field(p.top, 'pin-now'), '0000');
    await p.type(p.field(p.top, 'pin-new'), '5555');
    await p.type(p.field(p.top, 'pin-again'), '5556');
    await p.foot.tap();
    await says(T + 'two new PINs that differ are caught', p.top.locator('.field-error:not([hidden])'), 'The two new PINs do not match.');
    await p.type(p.field(p.top, 'pin-again'), '5555');
    await p.foot.tap();
    await says(T + 'a wrong current PIN shows the system\'s words by the button', p.top.locator('.sheet-foot .form-error'), 'Your current PIN is not right.');
    await p.type(p.field(p.top, 'pin-now'), '4444');
    await p.foot.tap();
    await sees(T + 'the PIN changes', p.toasts.filter({ hasText: 'Your PIN is changed.' }));
    await p.signOut();
    await gone(T + 'the sample "Tech" button goes away once his starting PIN no longer works', quick('Tech'));
    await sees(T + 'and the sign-in screen offers to reset the sample', p.btn(p.page.locator('#signin-body'), 'Reset sample data'));
    await p.signInForm('Cole', '4444');
    await says(T + 'the old PIN no longer signs in', p.page.locator('#signin-body .form-error'), 'That name and PIN do not match.');
    await p.signInForm('Cole', '5555');
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
    await sees(T + 'the client\'s visit shows Done', cs.locator('.row').filter({ hasText: 'House wash' }).locator('.pill-good', { hasText: 'Done' }));
    await sees(T + 'a first finished visit makes a New client Active', cs.locator('.cluster .pill', { hasText: 'Active' }));

    await p.type(p.field(cs, 'client-note'), 'Prefers mornings.');
    await p.btn(cs, 'Add note').tap();
    await says(T + 'the owner adds a client note and it tops the history', cs.locator('.notes .note').first(), /Grayson, .*Prefers mornings\./);
    check(T + 'the note box is emptied after saving', (await p.field(cs, 'client-note').inputValue()) === '');

    await cs.locator('.seg[aria-label="Payment status"] .seg-btn', { hasText: exact('Late') }).tap();
    await sees(T + 'payment status changes with one tap', p.toasts.filter({ hasText: 'Marked as late.' }));
    await sees(T + 'a late client carries a red Late pill', cs.locator('.cluster .pill-bad', { hasText: 'Late' }));

    await p.btn(cs, 'Edit').tap();
    await p.sheet('Edit payment link');
    await p.type(p.field(p.top, 'pay-link'), 'http://pay.example.com/x');
    await p.foot.tap();
    await says(T + 'a payment link must be https', p.top.locator('.field-error:not([hidden])'), 'A payment link must start with https://');
    await p.type(p.field(p.top, 'pay-link'), 'https://pay.example.com/birch-2');
    await p.foot.tap();
    await sees(T + 'the payment link can be changed', p.toasts.filter({ hasText: 'Payment link saved.' }));
    check(T + 'Open now goes to the new link', await until(async () => (await p.btn(cs, 'Open').getAttribute('href')) === 'https://pay.example.com/birch-2'));

    await p.row(cs, 'Edit details').tap();
    await p.sheet('Edit details');
    await p.type(p.field(p.top, 'c-contact'), 'Patricia Birch');
    await p.type(p.field(p.top, 'c-phone'), '615-555-0100');
    await says(T + 'the edit sheet says past sales stay with whoever made them', p.top.locator('.field', { hasText: 'Looked after by' }), 'Sales already made stay with whoever made them.');
    const reps = (await p.field(p.top, 'c-rep').locator('option').allTextContents()).map(tidy);
    check(T + '"Looked after by" offers the owner and the sales reps, no techs', reps.join() === 'Grayson (you),Avery,Mason', reps.join());
    await p.field(p.top, 'c-rep').selectOption({ label: 'Avery' });
    await p.foot.tap();
    await sees(T + 'saving says who looks after the client now', p.toasts.filter({ hasText: 'Saved. Avery looks after this client now.' }));
    await p.sheet(S.name, true);
    await says(T + 'the new contact shows', p.kv(cs, 'Contact'), 'Patricia Birch');
    await says(T + 'the sale stays with Mason', p.kv(cs, 'Sold by'), 'Mason');
    await says(T + 'and Avery looks after the client', p.kv(cs, 'Looked after by'), 'Avery');

    await p.btn(cs, 'Book a visit').tap();
    await p.sheet('Book a visit');
    const free = (await freeDays(p)).filter((x) => x.times.length >= 2);
    const at = { date: free[3].date, time: free[3].times[1] };
    await p.pickTime(p.top, at.date, at.time);
    await p.foot.tap();
    await sees(T + 'another visit can be booked from the client', p.toasts.filter({ hasText: 'Booked ' + words.when(at.date, at.time, S.today) + '.' }));
    check(T + 'the client now has two visits', await until(async () => (await cs.locator('.row .row-time').count()) === 2));

    /* a monthly plan that ends promises nothing more */
    await cs.locator('.seg[aria-label="Client status"] .seg-btn', { hasText: exact('Paused') }).tap();
    await sees(T + 'the status changes with one tap', p.toasts.filter({ hasText: 'Status changed to Paused.' }));
    await cs.locator('.seg[aria-label="Client status"] .seg-btn', { hasText: exact('Cancelled') }).tap();
    await p.dialog('Cancel this client?');
    await p.answer('Cancel client');
    await sees(T + 'cancelling a monthly client asks first', p.toasts.filter({ hasText: 'Status changed to Cancelled.' }));
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
    await sees(T + 'a cancel can be taken back the same day', p.toasts.filter({ hasText: 'Status changed to Active.' }));
    await p.close();
    await p.screen.locator('.chip', { hasText: 'Cancelled' }).tap();
    await p.row(p.screen, 'Maple Court Rental').tap();
    await p.sheet('Maple Court Rental');
    await p.btn(p.top, 'Delete client').tap();
    await p.dialog('Delete this client?');
    await says(T + 'deleting a client says its sales and jobs go too', p.page.locator('.dialog-text'), /This also removes their 1 sale and 1 job\./);
    await p.answer('Delete client');
    await sees(T + 'the client is deleted', p.toasts.filter({ hasText: 'Client deleted.' }));
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
    await sees(T + 'marking one paid says so', p.toasts.filter({ hasText: 'Marked as paid.' }));
    await p.closeAll();
    await says(T + 'the Dashboard is down to one late payment', p.row(p.screen, 'Late payment'), S.name);
    await sees(T + 'the Dashboard shows the six numbers', p.screen.locator('.stat-grid .stat').nth(5));
    await sees(T + 'and the leaderboard with each rep\'s commission', p.screen.locator('.row', { hasText: /Mason.*commission/ }));
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
    const toast = p.toasts.filter({ hasText: 'Cleared.' });
    await toast.waitFor();
    const boxes = await p.page.evaluate(() => {
      const t = document.querySelector('#toasts .toast').getBoundingClientRect();
      const f = document.querySelector('#layers > .layer:last-child .sheet-foot').getBoundingClientRect();
      return { toastBottom: t.bottom, toastTop: t.top, footTop: f.top, footBottom: f.bottom };
    });
    check(T + 'a toast over an open sheet sits above the footer, not on its button or note', boxes.toastBottom <= boxes.footTop && boxes.toastTop > 0, JSON.stringify(boxes));
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
    await sees(T + 'a role change says they need to sign in again', p.toasts.filter({ hasText: 'Jake R is now a sales rep. They need to sign in again.' }));
    await p.sheet('Jake R', true);
    await p.btn(p.top, 'Remove from team').tap();
    await p.dialog('Remove Jake R from the team?');
    await says(T + 'removing someone says their sales history stays', p.page.locator('.dialog-text'), 'Their sales history stays.');
    await p.answer('Remove');
    await sees(T + 'the person is removed', p.toasts.filter({ hasText: 'Jake R is no longer on the team.' }));
    await p.sheet('Team', true);
    await gone(T + 'and is no longer listed', p.row(p.top, /Jake/));
    await p.closeAll();
    await p.signOut();
    await p.signInForm('Jake R', S.jakePin2);
    await says(T + 'a removed person cannot sign in', p.page.locator('#signin-body .form-error'), 'That name and PIN do not match.');
  });

  /* ----- the rep who was handed the client, and asked to confirm again ----- */
  await part(T + 'a rep is asked to confirm the standards again, and is handed a client', list, async () => {
    await p.signInForm('Avery', '3333');
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
    await p.row(p.top, 'Edit contact details').tap();
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

  await p.ctx.close();
  phones.splice(phones.indexOf(p), 1);
}

/* ============================================================================================
 * REAL MODE
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
    if (!srv.token) srv.token = (await srv.ask({ action: 'login', name: 'Grayson', pin: '1234' })).result.token;
    return (await srv.ask({ action: 'sync', token: srv.token })).sync;
  };
  return srv;
}

async function realMode(browser) {
  const T = 'real: ';
  const srv = await startServer();
  const url = PAGE + '?backend=' + encodeURIComponent(srv.url);
  let A = null, B = null, C = null;
  const list = [];
  const R = {};

  /* Make the next call of one action fail on one phone.
     'crash': sent on to the dev server with its ?fail=1 knob (HTTP 500 and an error page, nothing saved).
     'lost':  the server gets it and saves it, but its answer never reaches the phone.
     'busy':  the phone is told "The system is busy", as the real backend says when several phones ask at once. */
  const BUSY = JSON.stringify({ ok: false, error: { code: 'busy', message: 'The system is busy. Try again in a moment.' } });
  function breakNext(p, action, kind, times) { p.fault = { action, kind, left: times || 1 }; p.quietNet++; }
  function mend(p) { p.fault = null; p.quietNet = Math.max(0, p.quietNet - 1); }
  async function wire(p) {
    await p.ctx.route((u) => u.href.indexOf(srv.url) === 0, async (route) => {
      const f = p.fault;
      let action = '';
      try { action = JSON.parse(route.request().postData() || '{}').action; } catch (e) { action = ''; }
      if (action === 'sync' || action === 'login') p.lastRefresh = Date.now();
      if (action === 'sync') p.refreshes = (p.refreshes || 0) + 1;
      if (!f || f.left < 1 || action !== f.action) return route.continue();
      f.left--;
      if (f.kind === 'crash') return route.continue({ url: srv.url + '/?fail=1' });
      if (f.kind === 'busy') return route.fulfill({ status: 200, contentType: 'application/json', headers: { 'Access-Control-Allow-Origin': '*' }, body: BUSY });
      try { await route.fetch(); } catch (e) { /* the phone still hears nothing */ }
      return route.abort('failed');
    });
  }
  async function open(who) {
    const p = await newPhone(browser, who, url);
    await wire(p);
    await p.page.reload();
    await p.page.locator('#signin:not([hidden])').waitFor();
    list.push(p);
    return p;
  }
  /* The page refreshes by itself every 20 seconds. A few checks need the phone NOT to hear from the
     server for a moment (so the only way it can learn of a save is the retry itself): wait out a
     refresh that is about to happen. */
  async function calm(p, ms) {
    const due = (p.lastRefresh || 0) + 20000 - Date.now();
    if (due < ms) await sleep(Math.max(0, due) + 1500);
  }
  /* Fill the New sale sheet (already open) for a new customer. */
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
  const salesNamed = async (name) => (await srv.snapshot()).sales.filter((s) => s.clientName === name).length;
  const notesSaying = async (text) => {
    const snap = await srv.snapshot();
    let n = 0;
    snap.clients.concat(snap.jobs).forEach((x) => (x.notes || []).forEach((note) => { if (note.text === text) n++; }));
    return n;
  };

  try {
    await part(T + 'signing in with a name and a PIN', list, async () => {
      A = await open('the owner\'s phone');
      await gone(T + 'with a backend there is no sample card on the sign-in screen', A.page.locator('#signin-body .card'), 1500);
      await A.signInForm('Grayson', '9999');
      await says(T + 'a wrong PIN is refused in the system\'s words', A.page.locator('#signin-body .form-error'), 'That name and PIN do not match. Check both and try again.');
      await A.signInForm('Grayson', '1234');
      await A.signedIn();
      const tabs = (await A.page.locator('.tabbar .tab').allTextContents()).map(tidy);
      check(T + 'Grayson signs in with his name and PIN and gets the owner\'s tabs', tabs.join() === 'Today,Sales,Calendar,Clients,Dashboard', tabs.join());
      check(T + 'there is no sample strip in real mode', !(await A.page.locator('#strip').isVisible()));
      B = await open('the rep\'s phone');
      await B.signInForm('mason', '2222');
      await B.signedIn();
      check(T + 'Mason signs in (any letter case) and gets the rep\'s tabs', (await B.page.locator('.tabbar .tab').allTextContents()).map(tidy).join() === 'Today,Sales,Calendar,Clients,Leaders');
      C = await open('the tech\'s phone');
      await C.signInForm('Cole', '3333');
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
      await B.btn(B.top, 'Done').tap();

      const went = await until(async () => (await A.top.locator('.slotpick-times .chip', { hasText: exact(words.time(R.times[0])) }).count()) === 0, LIVE, 250);
      check(T + 'that time disappears from the owner\'s open slot picker without a reload (took ' + Math.round((Date.now() - savedAt) / 1000) + ' s)', went);
      await A.close();
      await sees(T + 'the rep\'s sale has appeared on the owner\'s phone without a reload', A.row(A.screen, 'Lakeshore Bakery'), LIVE);
      await says(T + 'it shows who sold it', A.row(A.screen, 'Lakeshore Bakery'), 'Sold by Mason');
      check(T + 'the owner\'s page was never reloaded in between', await A.page.evaluate(() => window.e2eNotReloaded === true));
      await sees(T + 'the owner\'s bell has a dot', A.page.locator('#bell-btn.has-dot'));
      await A.page.locator('#bell-btn').tap();
      await A.sheet('Notifications');
      await says(T + 'the owner is told about the booking', A.top.locator('.row.notice').first(), /Mason sold Window cleaning to Lakeshore Bakery for \$180\.00\. Booked /);
      await A.close();

      /* assign it; the tech's phone hears; the tech finishes it; the owner's phone hears */
      await A.tab('Calendar', 'Availability');
      await A.row(A.screen, 'Lakeshore Bakery').tap();
      await A.sheet('Lakeshore Bakery');
      await A.row(A.top, 'Assign to').tap();
      await A.sheet('Assign to');
      const people = (await A.top.locator('.row .row-title').allTextContents()).map(tidy);
      check(T + 'the Assign sheet offers Cole and Grayson, not the sales rep', people.join() === 'Cole,Grayson', people.join());
      await A.row(A.top, 'Cole').tap();
      await A.sheet('Lakeshore Bakery', true);
      await C.tab('Schedule', 'Schedule');
      await sees(T + 'the job shows up on the tech\'s phone without a reload', C.row(C.screen, 'Lakeshore Bakery'), LIVE);
      await C.row(C.screen, 'Lakeshore Bakery').tap();
      await C.sheet('Lakeshore Bakery');

      breakNext(C, 'setJobDone', 'crash');
      await C.btn(C.top, 'Mark done').tap();
      await sees(T + 'a "Mark done" that cannot be saved says so in a red toast with Retry', C.toasts.filter({ hasText: 'Could not save. Check your signal and try again.' }).locator('.toast-btn', { hasText: 'Retry' }));
      await sees(T + 'and the job goes back to not done', C.btn(C.top, 'Mark done'));
      mend(C);
      await C.toasts.locator('.toast-btn', { hasText: 'Retry' }).tap();
      await says(T + 'Retry then marks it done', C.top.locator('.callout-good'), /Done .* by Cole/);
      await says(T + 'the owner\'s open job sheet turns to done without a reload', A.top.locator('.callout-good'), /Done .* by Cole/, LIVE);
      await A.close();
      await C.close();
      await C.health('the tech\'s Schedule');
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
      check(T + 'and no sale was saved for the one refused', (await salesNamed(loserName)) === 0);
      await loser.health('the New sale sheet after the refusal');
      await loser.pickTime(loser.top, R.day, R.times[2]);
      await loser.foot.tap();
      await sees(T + 'they pick another time and the sale saves', loser.top.locator('.sold-title'));
      check(T + 'saved once', (await salesNamed(loserName)) === 1);
      await loser.btn(loser.top, 'Done').tap();
      await winner.btn(winner.top, 'Done').tap();
    });

    /* ----- saves that fail ----- */
    await part(T + 'a save fails and is tried again', list, async () => {
      /* 1. the server crashes (the dev server's ?fail=1): nothing was saved */
      await newSale(B);
      await fillSale(B, 'Pinecrest Motel', '260');
      await B.type(B.field(B.top, 'sale-notes'), 'Ask for the manager.');
      await B.btn(B.top, 'Book later').tap();
      breakNext(B, 'createSale', 'crash');
      await B.foot.tap();
      await says(T + 'when the server answers with an error page, the sale sheet says so in words by the button', B.top.locator('.sheet-foot .form-error'), 'Could not save. Check your signal and try again.');
      check(T + 'the sale is still all there to try again', (await B.field(B.top, 'sale-name').inputValue()) === 'Pinecrest Motel' && (await B.field(B.top, 'sale-notes').inputValue()) === 'Ask for the manager.' && (await B.field(B.top, 'sale-price').inputValue()) === '260');
      check(T + 'nothing was saved by the failed try', (await salesNamed('Pinecrest Motel')) === 0);
      await B.health('the New sale sheet after a failed save');
      mend(B);
      await B.foot.tap();
      await sees(T + 'tapping Save again saves it', B.top.locator('.sold-title'));
      check(T + 'the sale was saved once', (await salesNamed('Pinecrest Motel')) === 1);
      await B.btn(B.top, 'Done').tap();

      /* 2. the answer is lost after the server saved: the retry must not save a second one */
      await calm(B, 9000);
      await newSale(B);
      await fillSale(B, 'Ridgeview Storage', '310');
      await B.btn(B.top, 'Book later').tap();
      breakNext(B, 'createSale', 'lost');
      await B.foot.tap();
      await says(T + 'when the answer never arrives, the sheet says it could not save', B.top.locator('.sheet-foot .form-error'), 'Could not save. Check your signal and try again.');
      check(T + '(the server had in fact saved it)', (await salesNamed('Ridgeview Storage')) === 1);
      mend(B);
      const logBefore = srv.log.length;
      await B.foot.tap();
      await sees(T + 'tapping Save again ends on "Sale saved"', B.top.locator('.sold-title'));
      check(T + 'and there is still exactly one such sale, not two', (await salesNamed('Ridgeview Storage')) === 1);
      await until(() => /createSale/.test(srv.log.slice(logBefore)), 2000);
      check(T + 'because the retry carried the same id (the server answered "already saved")', /createSale\s+ok \(a retry of something already saved\)/.test(srv.log.slice(logBefore)), srv.log.slice(logBefore).trim().split('\n').slice(-3).join(' / '));
      await B.btn(B.top, 'Done').tap();

      /* 3. the answer is lost, then the person changes what they typed: nothing may be lost without a word */
      await calm(B, 9000);
      await newSale(B);
      await fillSale(B, 'Hollow Creek Inn', '400');
      await B.btn(B.top, 'Book later').tap();
      breakNext(B, 'createSale', 'lost');
      await B.foot.tap();
      await B.top.locator('.sheet-foot .form-error').waitFor();
      mend(B);
      await B.type(B.field(B.top, 'sale-price'), '450');
      await B.foot.tap();
      await sees(T + 'a sale changed after a lost answer ends on "Sale saved"', B.top.locator('.sold-title'));
      await says(T + 'and says plainly that the first try is what went through, before the change', B.top.locator('.callout-warn'), 'This went through on your first try');
      await says(T + 'showing the price that was really saved', B.kv(B.top, 'Sold'), '$400.00');
      check(T + 'one sale, not two', (await salesNamed('Hollow Creek Inn')) === 1);
      await B.btn(B.top, 'Done').tap();

      /* 4. a note: fails, is changed, is saved. The changed words are what is kept. */
      await B.tab('Clients', 'Clients');
      await B.row(B.screen, 'Pinecrest Motel').tap();
      await B.sheet('Pinecrest Motel');
      const cs = B.top;
      await B.type(B.field(cs, 'client-note'), 'First words');
      breakNext(B, 'addNote', 'crash');
      await B.btn(cs, 'Add note').tap();
      await says(T + 'a note that cannot be saved says so right by its button', cs.locator('.form-error:not([hidden])').first(), 'Could not save. Check your signal and try again.');
      check(T + 'the note is still in the box', (await B.field(cs, 'client-note').inputValue()) === 'First words');
      mend(B);
      await B.type(B.field(cs, 'client-note'), 'Second words');
      await B.btn(cs, 'Add note').tap();
      await says(T + 'changed and saved again, the note that shows is the changed one', cs.locator('.notes .note').first(), 'Second words');
      check(T + 'the system holds the changed note once and the first words not at all', (await notesSaying('Second words')) === 1 && (await notesSaying('First words')) === 0);

      /* 5. a note whose answer is lost, then changed: a new save, so the new words are not swallowed */
      await B.type(B.field(cs, 'client-note'), 'Third words');
      breakNext(B, 'addNote', 'lost');
      await B.btn(cs, 'Add note').tap();
      await cs.locator('.form-error:not([hidden])').first().waitFor();
      mend(B);
      await B.type(B.field(cs, 'client-note'), 'Fourth words');
      await B.btn(cs, 'Add note').tap();
      await says(T + 'after a lost answer, changed words are saved as their own note (not answered with the old one)', cs.locator('.notes .note').first(), 'Fourth words');
      check(T + 'the system holds the new words once', (await notesSaying('Fourth words')) === 1);
    });

    /* ----- the server itself stops ----- */
    await part(T + 'the server stops and comes back', list, async () => {
      const cs = B.top;
      await B.type(B.field(cs, 'client-note'), 'Gate code 4411');
      list.forEach((p) => { p.quietNet++; });
      srv.child.kill('SIGSTOP');
      const stoppedAt = Date.now();
      await B.btn(cs, 'Add note').tap();
      await sees(T + 'with the server stopped the button shows "Saving..."', B.btn(cs, 'Saving...'), 3000);
      await says(T + 'after 20 seconds without an answer it says it could not save', cs.locator('.form-error:not([hidden])').first(), 'Could not save. Check your signal and try again.', 26000);
      check(T + 'that took about 20 seconds (' + Math.round((Date.now() - stoppedAt) / 1000) + ' s)', Date.now() - stoppedAt > 18000);
      check(T + 'the note is still in the box', (await B.field(cs, 'client-note').inputValue()) === 'Gate code 4411');
      await B.health('the client sheet while the server is stopped');
      srv.child.kill('SIGCONT');
      await B.btn(cs, 'Add note').tap();
      await says(T + 'once the server is back, tapping again saves the note', cs.locator('.notes .note').first(), 'Gate code 4411', 15000);
      check(T + 'the note box is emptied', await until(async () => (await B.field(cs, 'client-note').inputValue()) === ''));
      await sleep(1500);
      check(T + 'and the system holds that note exactly once', (await notesSaying('Gate code 4411')) === 1, String(await notesSaying('Gate code 4411')));
      await B.close();
      await until(async () => !(await B.page.locator('#strip').isVisible()), LIVE);
      list.forEach((p) => { p.quietNet = Math.max(0, p.quietNet - 1); p.problems.length = 0; });
    });

    /* ----- no connection ----- */
    await part(T + 'the no-connection strip', list, async () => {
      check(T + 'with a connection there is no strip', !(await B.page.locator('#strip').isVisible()));

      /* A background refresh that is answered "busy" (the page asks three times before it gives up). */
      breakNext(B, 'sync', 'busy', 3);
      const answered = await until(() => B.fault.left === 0, 30000);
      await sleep(1500);
      check(T + 'a background refresh answered "busy" shows no toast and no strip', answered && (await B.toasts.count()) === 0 && !(await B.page.locator('#strip').isVisible()),
        answered ? 'toasts: ' + (await B.toasts.allTextContents()).join(' / ') : 'the page did not refresh');
      mend(B);

      B.quietNet++;
      await B.ctx.setOffline(true);
      const offAt = Date.now(), asked = B.refreshes || 0;
      await until(() => (B.refreshes || 0) > asked, 30000);
      await sleep(1500);
      check(T + 'and it does not count as a failed refresh: one real failure after it still shows no strip', !(await B.page.locator('#strip').isVisible()));
      await says(T + 'after two refreshes fail, the strip says there is no connection and what time the data is from', B.page.locator('#strip-text'),
        /^No connection\. Showing what was saved at \d{1,2}:\d{2} [AP]M\. Trying again\.$/, 50000);
      ok(T + '(it appeared ' + Math.round((Date.now() - offAt) / 1000) + ' s after the connection went)');
      await B.tab('Sales', 'Sales');
      await sees(T + 'the app still shows what it last knew', B.row(B.screen, 'Pinecrest Motel'));
      await B.ctx.setOffline(false);
      await gone(T + 'the strip clears once a refresh works again', B.page.locator('#strip'), LIVE);
      B.quietNet--;
      B.problems.length = 0;
      await B.health('the rep\'s Sales tab after the connection came back');
    });

    /* ----- a removed person ----- */
    await part(T + 'a person is removed while their phone is signed in', list, async () => {
      await C.tab('Today');
      await A.me();
      await A.row(A.top, 'Team').tap();
      await A.sheet('Team');
      await A.row(A.top, 'Cole').tap();
      await A.sheet('Cole');
      await A.btn(A.top, 'Remove from team').tap();
      await A.dialog('Remove Cole from the team?');
      await A.answer('Remove');
      await sees(T + 'the owner removes Cole', A.toasts.filter({ hasText: 'Cole is no longer on the team.' }));
      await A.closeAll();
      await sees(T + 'Cole\'s phone lands on the sign-in screen by itself', C.page.locator('#signin:not([hidden])'), LIVE);
      await says(T + 'with a message saying why', C.page.locator('#signin-body .form-error'), 'Please sign in again.');
      check(T + 'and nothing of his is left on that phone', await C.page.evaluate(() => !localStorage.getItem('ridgeline.live.token') && !localStorage.getItem('ridgeline.live.snap')));
      await C.signInForm('Cole', '3333');
      await says(T + 'he cannot sign back in', C.page.locator('#signin-body .form-error'), 'That name and PIN do not match. Check both and try again.');
      await C.health('the sign-in screen of the removed person');
      await A.health('the owner\'s Today at the end');
      await B.health('the rep\'s phone at the end');
    });
  } finally {
    try { srv.child.kill('SIGCONT'); } catch (e) { /* already gone */ }
    srv.child.kill();
    for (const p of list) { try { await p.ctx.close(); } catch (e) { /* closed */ } phones.splice(phones.indexOf(p), 1); }
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
  try {
    if (only !== 'real') await sampleMode(browser);
    if (only !== 'sample') await realMode(browser);
  } catch (e) {
    fail('the walk stopped early', e && e.stack ? e.stack.split('\n').slice(0, 3).join(' ') : e);
  } finally {
    await browser.close();
  }
  console.log('');
  if (fontsMissing) console.log('note  the web fonts could not be fetched here, so the layout was checked in the fallback fonts');
  console.log(tally.ok + ' passed, ' + tally.bad + ' failed, in ' + Math.round((Date.now() - started) / 1000) + ' s');
  if (tally.bad) { console.log('Failed:'); tally.failed.forEach((n) => console.log('  ' + n)); }
  process.exit(tally.bad ? 1 : 0);
})();
