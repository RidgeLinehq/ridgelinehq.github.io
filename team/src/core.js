/*
 * Ridgeline Wash Co. team system: shared core.
 *
 * One file of plain JavaScript that runs unchanged in two places:
 *   1. the Google Apps Script backend (team/backend/Code.gs), where it is the real server;
 *   2. the page itself, in sample mode, so the app works before a backend is connected.
 * No DOM, no network and no Google APIs in here. The host passes in a `store` and an `env`.
 *
 * store: list(coll) -> array of plain objects, each with a string `id` (fresh copies)
 *        put(coll, doc)            upsert by doc.id
 *        del(coll, id)
 *        getRev() -> number        setRev(n)
 *        cacheGet(key) -> string|null     cachePut(key, string, ttlSeconds)     cacheDel(key)
 * env:   now() -> ms since epoch
 *        dayKey(ms) -> 'YYYY-MM-DD' in the business time zone
 *        hm(ms) -> 'HH:MM' (24 hour) in the business time zone
 *        uuid() -> random string
 *        notify({subject, body, to})   emails the owner; may throw. A host may instead keep the
 *                                  message and send it once the data is saved (the Google host does).
 *
 * Every request is { action, token?, since?, day?, opId?, ... } and every answer is
 * { ok: true, result, sync } or { ok: false, error: { code, message }, sync? }.
 * Money is always whole cents. Days are 'YYYY-MM-DD' strings, times are 'HH:MM' strings.
 *
 * Rules the page can count on (each is enforced further down, where the action is):
 *   PINs      Every PIN is exactly 6 digits, whether a person picks it or the system makes it.
 *             The easy ones are refused: one digit six times, a straight run up or down, and
 *             the same pair or the same three digits repeated. RidgelineCore.check.pin(pin)
 *             gives '' or the words to show ("A PIN is 6 digits." / "Pick a PIN that is harder
 *             to guess."). check.payLink(link) does the same for a payment link.
 *   Sign-in   Wrong PINs are counted per person only (5 quick ones lock that person for 15
 *             minutes; 20 inside 6 hours pause them for the rest of the 6 hours and the owner is
 *             told). Nothing is counted for a wrong name, and nothing can pause the whole team.
 *   Signed    error.code 'auth' always means: forget the token and show the sign-in screen with
 *   out       error.message. It is "Please sign in again." except for someone who was removed
 *             from the team, whose phone is told "You are no longer on the team. Ask the owner
 *             if that is a mistake."
 *   Sales     A sale keeps the commission rates it was saved with. A sale whose seller (repId)
 *             is an owner is saved with 0 and 0: the owner's own sales earn no commission, and
 *             createSale answers commissionCents 0 for them. Its dated events are still listed.
 *             The owner corrects a sale with updateSale {saleId, patch: {priceCents?, service?,
 *             repId?}}; one-time or monthly cannot be changed (remove the sale and enter it again).
 *             Moving a sale from one rep to another keeps the rates saved on it. Moving it to an
 *             owner sets them to 0; moving it from an owner to a rep takes today's Settings rates.
 *   Retries   A save sent with an opId is remembered for 6 hours, together with what was sent.
 *             The same opId with the same fields again is answered from memory (replay: true) and
 *             saves nothing more. The same opId with different fields is not run: the first try
 *             was saved, so the answer is error.code 'already_saved' with the sync. A try that
 *             was refused is not remembered, so its opId can be sent again with the fields put
 *             right. "The same fields" means everything in the request except token, since, day
 *             and opId, in any order.
 *   Sync      What each role receives is decided in buildSync. A tech receives no clients, sales,
 *             days or board; settings with only businessName, standards and standardsUpdatedAt;
 *             and only their own jobs from 30 days ago onward, plus older ones still to be done.
 *   Clock     Every sync, the short "nothing changed" one too, carries the system's clock: nowMs
 *             (ms since epoch) and nowHM ('HH:MM' in the business time zone). A phone works out
 *             which of today's times have passed from these, not from its own clock.
 *   Notices   Written the way the screens write: "Wed, Nov 18 at 8:00 AM" and "$1,250.00". One
 *             about a client carries that client's id as clientId.
 */
var RidgelineCore = (function () {
  'use strict';

  var VERSION = '1.0.0';
  var ROLES = ['owner', 'rep', 'tech'];
  var CLIENT_STATUSES = ['New', 'Active', 'Paused', 'Cancelled'];
  var PAY_STATUSES = ['unpaid', 'paid', 'late'];
  var BILLING = ['once', 'monthly'];
  var COLLECTIONS = ['team', 'sessions', 'settings', 'days', 'clients', 'sales', 'jobs', 'notices', 'problems'];
  var LIMITS = {
    name: 60, line: 160, text: 500, notesKept: 50, noticesKept: 60, problemsKept: 30,
    maxCents: 100000000, sessionDays: 90, loginTries: 5, lockSeconds: 900,
    longTries: 20, longSeconds: 21600,   /* 20 wrong PINs inside 6 hours (the longest the cache remembers) pause that person */
    retrySeconds: 21600,                 /* how long a saved action is remembered by its opId */
    retryChars: 20000,                   /* the most that memory may take as text; the Google cache drops anything over 30,000 */
    techJobDays: 30,                     /* how far back a tech's phone is sent the jobs they have finished */
    docChars: 45000,                     /* the most one record may take as JSON; a cell of the sheet holds 50,000 */
    daysPerCall: 62, slotsPerDay: 24, services: 20, standardSections: 12, standardItems: 20, standardLine: 240
  };
  var CLIENT_FULL = 'There is no room to save more on this client. Shorten the name, the address or another detail, then try again.';
  var DEFAULT_SETTINGS = {
    id: 'main',
    businessName: 'Ridgeline Wash Co.',
    services: [
      { id: 'windows', name: 'Window cleaning', priceCents: 0 },
      { id: 'house', name: 'House wash', priceCents: 0 },
      { id: 'pressure', name: 'Pressure wash', priceCents: 0 }
    ],
    firstPct: 30,
    monthlyPct: 10,
    defaultSlots: ['08:00', '09:30', '12:00', '14:00'],
    defaultTechId: null,
    notifyEmail: '',
    emailOnBooking: true,
    /* Company standards: a starting draft built from the job checklist in Grayson's own mockups.
       The owner edits these in the app; everyone else reads them and confirms they have. */
    standards: [
      { id: 'job', title: 'On every job', ordered: true, items: [
        'Arrive on time. If you will be more than 10 minutes late, call the customer before the start time.',
        'Take before photos.',
        'Protect what is nearby. Move or cover furniture, plants, door mats and cars before any water or soap.',
        'Do the whole job that was sold. If part of it cannot be done safely, stop and call Grayson.',
        'Take after photos.',
        'Walk the customer through the finished work before you leave. If nobody is home, add a note to the job.',
        'Leave the property tidier than you found it. Hoses coiled, gates closed, nothing left behind.',
        'Mark the job done and add a note about anything the next person should know.'
      ] },
      { id: 'show', title: 'How we show up', ordered: false, items: [
        'Clean clothes and closed-toe shoes. Ridgeline uniforms are coming soon.',
        'Introduce yourself by name and say you are with Ridgeline Wash Co.',
        'Be polite and patient with every customer, every time.',
        "No smoking, vaping or loud music on a customer's property.",
        'Park where you are not blocking anyone, unless the customer tells you otherwise.'
      ] },
      { id: 'safety', title: 'Safety first', ordered: false, items: [
        'If it is not safe, do not do it. Call Grayson.',
        'Check your ladder and the ground under it before every climb.',
        'Keep water and spray away from outlets, power lines, people and pets.',
        'Wear eye protection and gloves when you use cleaning solution.'
      ] },
      { id: 'selling', title: 'Selling the right way', ordered: false, items: [
        'Be honest about what a service will and will not do.',
        'Quote only the services and prices Grayson has approved.',
        'Enter every sale the same day and book the appointment before you leave.',
        'If someone says no, thank them and move on.'
      ] },
      { id: 'wrong', title: 'When something goes wrong', ordered: false, items: [
        'Damage or a complaint: stop, take a photo, tell the customer we will make it right, and call Grayson right away.',
        'Add a note to the job so nothing is forgotten.'
      ] }
    ],
    standardsUpdatedAt: 0
  };

  /* ---------- small helpers ---------- */

  function AppError(code, message) { this.appCode = code; this.message = message; }

  function pad2(n) { return (n < 10 ? '0' : '') + n; }
  function clone(o) { return JSON.parse(JSON.stringify(o)); }

  function rotr(x, n) { return (x >>> n) | (x << (32 - n)); }
  var SHA_K = [
    0x428a2f98, 0x71374491, 0xb5c0fbcf, 0xe9b5dba5, 0x3956c25b, 0x59f111f1, 0x923f82a4, 0xab1c5ed5,
    0xd807aa98, 0x12835b01, 0x243185be, 0x550c7dc3, 0x72be5d74, 0x80deb1fe, 0x9bdc06a7, 0xc19bf174,
    0xe49b69c1, 0xefbe4786, 0x0fc19dc6, 0x240ca1cc, 0x2de92c6f, 0x4a7484aa, 0x5cb0a9dc, 0x76f988da,
    0x983e5152, 0xa831c66d, 0xb00327c8, 0xbf597fc7, 0xc6e00bf3, 0xd5a79147, 0x06ca6351, 0x14292967,
    0x27b70a85, 0x2e1b2138, 0x4d2c6dfc, 0x53380d13, 0x650a7354, 0x766a0abb, 0x81c2c92e, 0x92722c85,
    0xa2bfe8a1, 0xa81a664b, 0xc24b8b70, 0xc76c51a3, 0xd192e819, 0xd6990624, 0xf40e3585, 0x106aa070,
    0x19a4c116, 0x1e376c08, 0x2748774c, 0x34b0bcb5, 0x391c0cb3, 0x4ed8aa4a, 0x5b9cca4f, 0x682e6ff3,
    0x748f82ee, 0x78a5636f, 0x84c87814, 0x8cc70208, 0x90befffa, 0xa4506ceb, 0xbef9a3f7, 0xc67178f2
  ];

  /* SHA-256 of a string (UTF-8), as lowercase hex. Pure JavaScript so both hosts agree. */
  function sha256(str) {
    str = String(str);
    var bytes = [], i, c;
    for (i = 0; i < str.length; i++) {
      c = str.charCodeAt(i);
      if (c < 0x80) bytes.push(c);
      else if (c < 0x800) bytes.push(0xc0 | (c >> 6), 0x80 | (c & 63));
      else if (c >= 0xd800 && c < 0xdc00 && i + 1 < str.length) {
        var cp = 0x10000 + ((c & 0x3ff) << 10) + (str.charCodeAt(++i) & 0x3ff);
        bytes.push(0xf0 | (cp >> 18), 0x80 | ((cp >> 12) & 63), 0x80 | ((cp >> 6) & 63), 0x80 | (cp & 63));
      } else bytes.push(0xe0 | (c >> 12), 0x80 | ((c >> 6) & 63), 0x80 | (c & 63));
    }
    var H = [0x6a09e667, 0xbb67ae85, 0x3c6ef372, 0xa54ff53a, 0x510e527f, 0x9b05688c, 0x1f83d9ab, 0x5be0cd19];
    var bits = bytes.length * 8;
    bytes.push(0x80);
    while (bytes.length % 64 !== 56) bytes.push(0);
    var hi = Math.floor(bits / 0x100000000), lo = bits >>> 0;
    bytes.push((hi >>> 24) & 255, (hi >>> 16) & 255, (hi >>> 8) & 255, hi & 255,
               (lo >>> 24) & 255, (lo >>> 16) & 255, (lo >>> 8) & 255, lo & 255);
    var w = new Array(64), t;
    for (var off = 0; off < bytes.length; off += 64) {
      for (t = 0; t < 16; t++) {
        w[t] = (bytes[off + t * 4] << 24) | (bytes[off + t * 4 + 1] << 16) | (bytes[off + t * 4 + 2] << 8) | bytes[off + t * 4 + 3];
      }
      for (t = 16; t < 64; t++) {
        var s0 = rotr(w[t - 15], 7) ^ rotr(w[t - 15], 18) ^ (w[t - 15] >>> 3);
        var s1 = rotr(w[t - 2], 17) ^ rotr(w[t - 2], 19) ^ (w[t - 2] >>> 10);
        w[t] = (w[t - 16] + s0 + w[t - 7] + s1) | 0;
      }
      var a = H[0], b = H[1], cc = H[2], d = H[3], e = H[4], f = H[5], g = H[6], h = H[7];
      for (t = 0; t < 64; t++) {
        var S1 = rotr(e, 6) ^ rotr(e, 11) ^ rotr(e, 25);
        var ch = (e & f) ^ (~e & g);
        var t1 = (h + S1 + ch + SHA_K[t] + w[t]) | 0;
        var S0 = rotr(a, 2) ^ rotr(a, 13) ^ rotr(a, 22);
        var maj = (a & b) ^ (a & cc) ^ (b & cc);
        var t2 = (S0 + maj) | 0;
        h = g; g = f; f = e; e = (d + t1) | 0; d = cc; cc = b; b = a; a = (t1 + t2) | 0;
      }
      H[0] = (H[0] + a) | 0; H[1] = (H[1] + b) | 0; H[2] = (H[2] + cc) | 0; H[3] = (H[3] + d) | 0;
      H[4] = (H[4] + e) | 0; H[5] = (H[5] + f) | 0; H[6] = (H[6] + g) | 0; H[7] = (H[7] + h) | 0;
    }
    var out = '';
    for (i = 0; i < 8; i++) out += ('00000000' + (H[i] >>> 0).toString(16)).slice(-8);
    return out;
  }

  /* ---------- days and times ---------- */

  function daysInMonth(y, m) { return new Date(Date.UTC(y, m, 0)).getUTCDate(); }

  function isDay(s) {
    if (typeof s !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(s)) return false;
    var y = +s.slice(0, 4), m = +s.slice(5, 7), d = +s.slice(8, 10);
    return y >= 2000 && y <= 2200 && m >= 1 && m <= 12 && d >= 1 && d <= daysInMonth(y, m);
  }

  function isHM(s) {
    return typeof s === 'string' && /^\d{2}:\d{2}$/.test(s) && +s.slice(0, 2) < 24 && +s.slice(3, 5) < 60;
  }

  function dayOf(y, m, d) { return y + '-' + pad2(m) + '-' + pad2(d); }

  function addDays(day, n) {
    var t = Date.UTC(+day.slice(0, 4), +day.slice(5, 7) - 1, +day.slice(8, 10)) + n * 86400000;
    var dt = new Date(t);
    return dayOf(dt.getUTCFullYear(), dt.getUTCMonth() + 1, dt.getUTCDate());
  }

  /* Same day of the month k months later, clamped to the month's last day (Jan 31 -> Feb 28). */
  function addMonths(day, k) {
    var y = +day.slice(0, 4), m0 = +day.slice(5, 7) - 1 + k, d = +day.slice(8, 10);
    y += Math.floor(m0 / 12);
    var m = ((m0 % 12) + 12) % 12 + 1;
    return dayOf(y, m, Math.min(d, daysInMonth(y, m)));
  }

  /* 0 = Sunday ... 6 = Saturday */
  function weekday(day) {
    return new Date(Date.UTC(+day.slice(0, 4), +day.slice(5, 7) - 1, +day.slice(8, 10))).getUTCDay();
  }

  /* Weeks run Monday to Sunday. */
  function weekStart(day) { return addDays(day, -((weekday(day) + 6) % 7)); }
  function monthStart(day) { return day.slice(0, 8) + '01'; }

  /* ---------- commission ---------- */

  /* The client's status on a given day, from its status log (oldest first). */
  function statusOn(client, day) {
    var log = (client && client.statusLog) || [], status = 'New';
    for (var i = 0; i < log.length; i++) if (log[i].day <= day) status = log[i].status;
    return status;
  }

  /* pct percent of a price in whole cents, half a cent rounding up. Worked in whole numbers,
     because in floating point 5.1% of $15.00 comes out a hair under 76.5 cents and loses a cent. */
  function share(priceCents, pct) { return Math.round(priceCents * Math.round((pct || 0) * 100) / 10000); }

  /*
   * What one sale has earned its rep so far, as dated events.
   * The sale pays firstPct of the price on the day it was sold. A monthly sale also pays
   * monthlyPct of the price on the same day of every following month, for as long as the
   * client is still New or Active on that day (paused and cancelled months pay nothing).
   * The percentages are the ones saved on the sale, so later rate changes never rewrite history.
   *
   * The client's status alone is not enough, because one client can have several sales. So a
   * monthly sale can carry an endDay, and it pays nothing dated after that day, ever:
   *   - when the client is set to Cancelled, their monthly sales end that day. If they buy again
   *     later, the new sale pays; the old one does not start again.
   *   - when the client buys another monthly plan, the older monthly sale ends that day (it
   *     also remembers which sale replaced it, as endedBy), so only one plan pays each month.
   * Pausing sets no endDay: the paused months pay nothing and the pay picks up afterwards.
   */
  function commissionEvents(sale, client, today) {
    var events = [{ day: sale.day, cents: share(sale.priceCents, sale.firstPct), kind: 'first' }];
    if (sale.billing === 'monthly' && client) {
      var each = share(sale.priceCents, sale.monthlyPct);
      for (var k = 1; k <= 600; k++) {
        var due = addMonths(sale.day, k);
        if (due > today || (sale.endDay && due > sale.endDay)) break;
        var st = statusOn(client, due);
        if (st === 'New' || st === 'Active') events.push({ day: due, cents: each, kind: 'monthly' });
      }
    }
    return events;
  }

  /* Total cents of the events dated from..to inclusive (either bound may be omitted). */
  function sumEvents(events, from, to) {
    var total = 0;
    for (var i = 0; i < events.length; i++) {
      var e = events[i];
      if ((!from || e.day >= from) && (!to || e.day <= to)) total += e.cents;
    }
    return total;
  }

  /* ---------- input checks ---------- */

  /* Text from a value a phone sent. A list or an object is not text: it counts as empty.
     (String() throws on an object such as {"toString": 1}, which a stranger could send.) */
  function str(v) { return v == null || typeof v === 'object' || typeof v === 'function' ? '' : String(v); }

  function line(v, max, required, msg) {
    var s = str(v).replace(/[\u0000-\u001f\u007f]/g, ' ').replace(/\s+/g, ' ').trim();
    if (s.length > max) s = s.slice(0, max);
    if (required && !s) throw new AppError('invalid', msg || 'Something is missing.');
    return s;
  }

  function para(v, max, required, msg) {
    var s = str(v).replace(/\r\n?/g, '\n').replace(/[\u0000-\u0008\u000b-\u001f\u007f]/g, '').trim();
    if (s.length > max) s = s.slice(0, max);
    if (required && !s) throw new AppError('invalid', msg || 'Something is missing.');
    return s;
  }

  function cents(v, msg) {
    if (typeof v !== 'number' || !isFinite(v) || v < 0 || v > LIMITS.maxCents || Math.floor(v) !== v) {
      throw new AppError('invalid', msg || 'Enter a price.');
    }
    return v;
  }

  function pct(v) {
    if (typeof v !== 'number' || !isFinite(v) || v < 0 || v > 100) throw new AppError('invalid', 'A percentage must be between 0 and 100.');
    return Math.round(v * 100) / 100;
  }

  var LINK_BAD = 'That payment link does not look right. Paste the whole link from your payment page.';

  /*
   * What is wrong with a payment link, in words; '' when it is fine. No link at all is fine too.
   * The owner copies this link and sends it to a client, so it has to go where it looks like it
   * goes. The site it opens is the part between https:// and the first / ? or #. That part must
   * be a plain site name with a dot in it (letters, digits, hyphens, and a port if it has one):
   *   - nothing before an "@". In https://buy.stripe.com@evil.example/pay the real site is
   *     evil.example. An "@" anywhere before the first "/" is refused;
   *   - not a bare word such as "localhost", and no look-alike letters from other alphabets;
   *   - no spaces, quotes, angle brackets or backslashes anywhere in the link.
   */
  function linkProblem(s) {
    if (!s) return '';
    if (s.length > 300) return 'That payment link is too long.';   /* a link cut short is a broken link */
    if (!/^https:\/\//i.test(s)) return 'A payment link must start with https://';
    var rest = s.slice(8), site = rest.split(/[\/?#]/)[0];
    if (/[\s\u0000-\u001f\u007f<>"'`\\]/.test(s) || rest.split('/')[0].indexOf('@') >= 0) return LINK_BAD;
    if (!/^[a-z0-9-]+(\.[a-z0-9-]+)+(:\d{1,5})?$/i.test(site)) return LINK_BAD;
    return '';
  }

  /* A payment link as it is saved: tidied to one line, then checked. */
  function payLink(v) {
    var s = line(v, 301), problem = linkProblem(s);
    if (problem) throw new AppError('invalid', problem);
    return s;
  }

  /* A PIN is exactly 6 digits. */
  function pinOk(v) { return typeof v === 'string' && /^\d{6}$/.test(v); }

  /* The PINs a stranger would try first: one digit six times (000000), a straight run up or
     down (123456, 654321, and the ones that pass through 0 such as 567890), and the same pair or
     the same three digits repeated (121212, 123123). */
  function pinWeak(pin) {
    if (/^(\d\d)\1\1$/.test(pin) || /^(\d{3})\1$/.test(pin)) return true;
    var up = true, down = true;
    for (var i = 1; i < pin.length; i++) {
      var step = (pin.charCodeAt(i) - pin.charCodeAt(i - 1) + 10) % 10;
      if (step !== 1) up = false;
      if (step !== 9) down = false;
    }
    return up || down;
  }

  /* What is wrong with a PIN somebody wants to use, in words for them; '' when it is fine. */
  function pinProblem(v) {
    if (!pinOk(v)) return 'A PIN is 6 digits.';
    if (pinWeak(v)) return 'Pick a PIN that is harder to guess.';
    return '';
  }

  /* A PIN somebody picked, checked. */
  function chosenPin(v) {
    var pin = str(v), problem = pinProblem(pin);
    if (problem) throw new AppError('invalid', problem);
    return pin;
  }

  /* One record is one cell of the Google Sheet, and a cell holds 50,000 characters. Whatever can
     make a record longer checks it here first, before anything is saved, and says what to shorten. */
  function fits(doc, msg) {
    if (JSON.stringify(doc).length > LIMITS.docChars) throw new AppError('invalid', msg);
  }

  function cleanSlots(list) {
    var seen = {}, out = [];
    (Array.isArray(list) ? list : []).forEach(function (s) {
      if (isHM(s) && !seen[s]) { seen[s] = 1; out.push(s); }
    });
    out.sort();
    return out.slice(0, LIMITS.slotsPerDay);
  }

  function normName(s) { return str(s).replace(/\s+/g, ' ').trim().toLowerCase(); }

  /* ---------- telling a retry from a change ---------- */

  var ALREADY_SAVED = 'Your first try was saved. Check it, then make the change again if you still need to.';
  var NOT_FIELDS = ['token', 'since', 'day', 'opId'];   /* about the phone and the try, not about what is being saved */

  /* A value as one line of text that comes out the same whatever order its keys were listed in.
     Written out by hand, not with JSON.stringify, so that nothing a phone sends can make it
     throw. Nothing the app sends is nested anywhere near 20 deep, and no action reads that far
     down, so whatever is deeper cannot change what is saved and all counts as the same. */
  function stable(v, depth, skip) {
    var t = typeof v;
    if (v === null || v === undefined || t === 'function') return 'null';
    if (t === 'string') return JSON.stringify(v);
    if (t === 'number') return isFinite(v) ? String(v) : 'null';
    if (t === 'boolean') return v ? 'true' : 'false';
    if (t !== 'object') return JSON.stringify(String(v));
    if (depth > 20) return '"..."';
    var out = [], i;
    if (Array.isArray(v)) {
      for (i = 0; i < v.length; i++) out.push(stable(v[i], depth + 1));
      return '[' + out.join(',') + ']';
    }
    var keys = Object.keys(v).sort();
    for (i = 0; i < keys.length; i++) {
      var x = v[keys[i]];
      if (x === undefined || typeof x === 'function' || (skip && skip.indexOf(keys[i]) >= 0)) continue;
      out.push(JSON.stringify(keys[i]) + ':' + stable(x, depth + 1));
    }
    return '{' + out.join(',') + '}';
  }

  /* A short fingerprint of what a request asks for: its action and every field, but not its
     token, since, day or opId. Two tries with the same fingerprint are the same thing again. */
  function fieldsHash(req) { return sha256(stable(req, 0, NOT_FIELDS)).slice(0, 16); }

  /* ---------- the core ---------- */

  function create(store, env) {
    var mem = {};

    function all(coll) { return mem[coll] || (mem[coll] = store.list(coll)); }

    function find(coll, id) {
      var list = all(coll);
      for (var i = 0; i < list.length; i++) if (list[i].id === id) return list[i];
      return null;
    }

    function put(coll, doc) {
      var list = all(coll), hit = false;
      for (var i = 0; i < list.length; i++) if (list[i].id === doc.id) { list[i] = doc; hit = true; break; }
      if (!hit) list.push(doc);
      store.put(coll, doc);
    }

    function del(coll, id) {
      var list = all(coll);
      for (var i = 0; i < list.length; i++) if (list[i].id === id) { list.splice(i, 1); break; }
      store.del(coll, id);
    }

    function newId(prefix) { return prefix + '_' + String(env.uuid()).replace(/[^a-zA-Z0-9]/g, '').slice(0, 14); }
    function today() { return env.dayKey(env.now()); }

    function getSettings() {
      var s = find('settings', 'main'), out = clone(DEFAULT_SETTINGS), k;
      if (s) for (k in s) if (Object.prototype.hasOwnProperty.call(s, k)) out[k] = s[k];
      return out;
    }

    function hashPin(salt, pin) { return sha256(salt + ':' + pin); }
    /* A PIN the system makes: 6 digits, never one of the weak ones. */
    function randomPin() {
      for (var i = 0; ; i++) {
        var n = parseInt(sha256(env.uuid() + ':' + env.now() + ':' + i).slice(0, 12), 16) % 1000000;
        var pin = ('000000' + n).slice(-6);
        if (!pinWeak(pin)) return pin;
      }
    }

    function trimOldest(coll, keep, field) {
      var list = all(coll).slice().sort(function (a, b) { return a[field] < b[field] ? -1 : a[field] > b[field] ? 1 : 0; });
      for (var i = 0; i < list.length - keep; i++) del(coll, list[i].id);
    }

    function recordProblem(where, message) {
      try {
        put('problems', { id: newId('p'), at: env.now(), where: String(where).slice(0, 60), message: String(message).slice(0, 300) });
        trimOldest('problems', LIMITS.problemsKept, 'at');
        store.setRev(store.getRev() + 1);
      } catch (e) { /* the store itself is down; the caller still gets the error answer */ }
    }

    /* A line for the owner's notifications, and an email when one is asked for. clientId (when
       the notice is about a client) lets the page open that client from the notice. */
    function tellOwner(type, text, emailSubject, emailBody, clientId) {
      var notice = { id: newId('n'), at: env.now(), type: type, text: text };
      if (clientId) notice.clientId = clientId;
      put('notices', notice);
      trimOldest('notices', LIMITS.noticesKept, 'at');
      var s = getSettings();
      if (emailSubject && s.emailOnBooking) {
        try { env.notify({ subject: emailSubject, body: emailBody || text, to: s.notifyEmail || '' }); }
        catch (e) { recordProblem('email', 'An email alert could not be sent: ' + (e && e.message ? e.message : e)); }
      }
    }

    function sessionsOf(memberId) { return all('sessions').filter(function (s) { return s.memberId === memberId; }); }

    function dropSessions(memberId, exceptHash) {
      sessionsOf(memberId).forEach(function (s) {
        if (s.id === exceptHash) return;
        store.cacheDel('sess:' + s.id);
        del('sessions', s.id);
      });
    }

    /* Someone removed from the team keeps their stored sign-ins, so their phone can be told why
       it no longer works (see auth). Only the quick copies go, so the very next request is
       checked against the team list. The stored ones are cleared away at 90 days like any other. */
    function uncacheSessions(memberId) {
      sessionsOf(memberId).forEach(function (s) { store.cacheDel('sess:' + s.id); });
    }

    function refreshSessions(m) {
      sessionsOf(m.id).forEach(function (s) {
        if (env.now() - s.createdAt > LIMITS.sessionDays * 86400000) return;   /* expired: leave it signed out */
        store.cachePut('sess:' + s.id, JSON.stringify({ id: m.id, name: m.name, role: m.role }), 21600);
      });
    }

    function auth(token) {
      if (typeof token !== 'string' || token.length < 16 || token.length > 200) return null;
      var hash = sha256(token);
      var cached = store.cacheGet('sess:' + hash);
      if (cached) { try { var c = JSON.parse(cached); c.sess = hash; return c; } catch (e) { /* fall through */ } }
      var sess = find('sessions', hash);
      if (!sess || env.now() - sess.createdAt > LIMITS.sessionDays * 86400000) return null;
      var m = find('team', sess.memberId);
      if (!m) return null;
      /* A phone that was signed in when its person was removed hears the reason, not just "sign in again". */
      if (!m.active) throw new AppError('auth', 'You are no longer on the team. Ask the owner if that is a mistake.');
      store.cachePut('sess:' + hash, JSON.stringify({ id: m.id, name: m.name, role: m.role }), 21600);
      return { id: m.id, name: m.name, role: m.role, sess: hash };
    }

    function bumpFail(key) {
      var n = (parseInt(store.cacheGet(key), 10) || 0) + 1;
      store.cachePut(key, String(n), LIMITS.lockSeconds);
      return n;
    }

    /*
     * Wrong PINs are counted per person, and only per person. There is no count for the whole
     * team: a stranger must never be able to lock everybody out by guessing. And nothing at all is
     * counted or stored for a name that is not on the team, or for a PIN that is not 6 digits.
     *
     * A person's wrong PINs are counted in two ways, whether they are typed at sign-in or as the
     * "current PIN" when changing a PIN:
     *   fail:<id>    5 quick ones lock that person for 15 minutes (the count lapses 15 minutes
     *                after the last wrong try, and a right PIN clears it);
     *   fail6h:<id>  "count:when the first one was", kept for 6 hours from the first wrong try.
     *                20 inside that window pause the person until the window runs out, and the
     *                owner is told once. This is what stops four quiet guesses every 15 minutes.
     *                A right PIN at sign-in does not clear it; only time, the owner resetting
     *                the PIN, or the person changing their own PIN does.
     */
    function pinLocked(m) {
      /* An owner cannot ask the owner. What works for them is the wait, or the reset in the setup guide. */
      var owner = m.role === 'owner';
      if ((parseInt(store.cacheGet('fail6h:' + m.id), 10) || 0) >= LIMITS.longTries) {
        throw new AppError('locked', 'Too many wrong tries. This sign-in is paused for a few hours. ' +
          (owner ? 'To get in sooner, follow "Forgot your PIN?" in the setup guide.' : 'Ask the owner to reset your PIN.'));
      }
      if ((parseInt(store.cacheGet('fail:' + m.id), 10) || 0) >= LIMITS.loginTries) {
        throw new AppError('locked', 'Too many wrong tries. Wait 15 minutes' +
          (owner ? ' and try again.' : ', or ask the owner to reset your PIN.'));
      }
    }

    function wrongPin(m) {
      bumpFail('fail:' + m.id);
      var key = 'fail6h:' + m.id, was = String(store.cacheGet(key) || '').split(':');
      var n = (parseInt(was[0], 10) || 0) + 1, since = parseInt(was[1], 10) || env.now();
      var left = LIMITS.longSeconds - Math.floor((env.now() - since) / 1000);
      if (left < 1) { n = 1; since = env.now(); left = LIMITS.longSeconds; }
      store.cachePut(key, n + ':' + since, left);
      if (n === LIMITS.longTries) {
        tellOwner('signin', 'Someone tried the wrong PIN for ' + m.name + ' ' + n + ' times. ' + (m.role === 'owner'
          ? 'Sign-in under that name is paused for a few hours. Phones that are already signed in keep working. To sign in sooner, follow "Forgot your PIN?" in the setup guide.'
          : 'Their sign-in is paused for a few hours. Reset their PIN if that was not them.'));
        store.setRev(store.getRev() + 1);
      }
    }

    function clearPinFails(memberId) {
      store.cacheDel('fail:' + memberId);
      store.cacheDel('fail6h:' + memberId);
    }

    function login(req) {
      var name = normName(req.name), pin = str(req.pin);
      var wrong = new AppError('auth', 'That name and PIN do not match. Check both and try again.');
      if (!name || !pinOk(pin)) throw wrong;
      var active = all('team').filter(function (m) { return m.active; });
      var hits = active.filter(function (m) { return normName(m.name) === name; });
      if (!hits.length) hits = active.filter(function (m) { return normName(m.name).split(' ')[0] === name; });
      if (hits.length !== 1) throw wrong;   /* nobody by that name (or a removed person): nothing is counted */
      var m = hits[0];
      pinLocked(m);
      if (hashPin(m.salt, pin) !== m.pinHash) { wrongPin(m); throw wrong; }
      store.cacheDel('fail:' + m.id);
      /* A sign-in older than 90 days is already refused; this is where it is cleared away. */
      all('sessions').filter(function (s) { return env.now() - s.createdAt > LIMITS.sessionDays * 86400000; })
        .forEach(function (s) { store.cacheDel('sess:' + s.id); del('sessions', s.id); });
      var token = String(env.uuid()) + String(env.uuid());
      var hash = sha256(token);
      put('sessions', { id: hash, memberId: m.id, createdAt: env.now() });
      store.cachePut('sess:' + hash, JSON.stringify({ id: m.id, name: m.name, role: m.role }), 21600);
      return { token: token, me: { id: m.id, name: m.name, role: m.role, sess: hash } };
    }

    /* ---------- what each person is allowed to see ---------- */

    function buildSync(me, req) {
      /* The system's clock goes out with every answer, so a phone whose own clock is wrong can
         still tell which of today's times have passed. */
      var rev = store.getRev(), nowMs = env.now(), day = env.dayKey(nowMs), nowHM = env.hm(nowMs);
      if (req && req.since === rev && req.day === day) return { rev: rev, today: day, same: true, nowMs: nowMs, nowHM: nowHM };
      var owner = me.role === 'owner', rep = me.role === 'rep';
      var settings = getSettings();
      var team = all('team'), clients = all('clients'), sales = all('sales'), jobs = all('jobs');
      var clientById = {}, mine = {};
      clients.forEach(function (c) { clientById[c.id] = c; });

      var myClients = owner ? clients : rep ? clients.filter(function (c) { return c.repId === me.id; }) : [];
      myClients.forEach(function (c) { mine[c.id] = 1; });
      var mySales = owner ? sales : rep ? sales.filter(function (s) { return s.repId === me.id; }) : [];
      var mySaleIds = Object.create(null);
      mySales.forEach(function (s) { mySaleIds[s.id] = 1; });
      /* A tech's phone holds a client's name, phone and address for each job, so it is only sent
         the jobs it still needs: everything of theirs from 30 days ago onward, and anything older
         that is still waiting to be done. */
      var techFrom = addDays(day, -LIMITS.techJobDays);
      var myJobs = owner ? jobs
        : rep ? jobs.filter(function (j) { return mine[j.clientId]; })
        : jobs.filter(function (j) {
          return j.assignedTo === me.id && j.status !== 'cancelled' && (j.date >= techFrom || j.status === 'scheduled');
        });

      var meDoc = find('team', me.id) || {};
      var out = {
        rev: rev, today: day, same: false, nowMs: nowMs, nowHM: nowHM,
        me: { id: me.id, name: me.name, role: me.role, noticesSeenAt: meDoc.noticesSeenAt || 0, standardsAckAt: meDoc.standardsAckAt || 0 },
        team: team.map(function (m) {
          var v = { id: m.id, name: m.name, role: m.role, active: !!m.active };
          if (owner) { v.createdAt = m.createdAt; v.standardsAckAt = m.standardsAckAt || 0; }
          return v;
        }),
        /* A rep needs the price list and the rates to sell. A tech needs neither. */
        settings: owner ? settings : rep ? {
          businessName: settings.businessName, services: settings.services,
          firstPct: settings.firstPct, monthlyPct: settings.monthlyPct,
          standards: settings.standards, standardsUpdatedAt: settings.standardsUpdatedAt
        } : {
          businessName: settings.businessName, standards: settings.standards, standardsUpdatedAt: settings.standardsUpdatedAt
        },
        days: me.role === 'tech' ? [] : all('days')
          .filter(function (d) { return d.id >= addDays(day, -45); })
          .map(function (d) { return { date: d.id, open: !!d.open, slots: d.slots || [] }; }),
        taken: me.role === 'tech' ? [] : jobs
          .filter(function (j) { return j.status !== 'cancelled' && j.date >= day; })
          .map(function (j) { return { date: j.date, time: j.time }; }),
        clients: myClients,
        sales: mySales.map(function (s) {
          var v = clone(s), c = clientById[s.clientId];
          v.clientName = c ? c.name : '';
          v.events = commissionEvents(s, c, day);
          /* endedBy names the newer plan that took this one's place. A rep is told which sale that
             is only when it is their own; for someone else's it just says 'other'. */
          if (v.endedBy && !mySaleIds[v.endedBy]) v.endedBy = 'other';
          return v;
        }),
        jobs: myJobs.map(function (j) {
          var v = clone(j), c = clientById[j.clientId] || {};
          v.client = { name: c.name || '', contact: c.contact || '', phone: c.phone || '', address: c.address || '' };
          return v;
        }),
        board: [],
        notices: owner ? all('notices') : [],
        problems: owner ? all('problems') : []
      };

      if (me.role !== 'tech') {
        var rows = {}, wk = weekStart(day), mo = monthStart(day);
        team.forEach(function (m) {
          if (m.role === 'tech') return;
          rows[m.id] = { id: m.id, name: m.name, role: m.role, active: !!m.active,
            week: { count: 0, cents: 0 }, month: { count: 0, cents: 0 }, all: { count: 0, cents: 0 } };
        });
        sales.forEach(function (s) {
          var r = rows[s.repId];
          if (!r) return;
          r.all.count++; r.all.cents += s.priceCents;
          if (s.day >= mo) { r.month.count++; r.month.cents += s.priceCents; }
          if (s.day >= wk) { r.week.count++; r.week.cents += s.priceCents; }
        });
        Object.keys(rows).forEach(function (id) {
          var r = rows[id];
          if (r.all.count > 0 || (r.active && r.role === 'rep')) out.board.push(r);
        });
      }
      return out;
    }

    /* ---------- booking ---------- */

    function assertSlotFree(date, time, ignoreJobId) {
      if (!isDay(date) || !isHM(time)) throw new AppError('invalid', 'Pick a day and a time.');
      var day = today();
      if (date < day) throw new AppError('slot_closed', 'That day has passed. Pick another day.');
      var d = find('days', date);
      if (!d || !d.open || (d.slots || []).indexOf(time) < 0) {
        throw new AppError('slot_closed', 'That time is not open. Pick another.');
      }
      if (date === day && time <= env.hm(env.now())) {
        throw new AppError('slot_closed', 'That time has already passed today. Pick another.');
      }
      var clash = all('jobs').some(function (j) {
        return j.id !== ignoreJobId && j.status !== 'cancelled' && j.date === date && j.time === time;
      });
      if (clash) throw new AppError('slot_taken', 'That time was just taken. Pick another.');
    }

    /* A sales rep cannot see or finish a job, so a job only ever goes to a tech or an owner. */
    function canDoJobs(m) { return !!m && !!m.active && (m.role === 'tech' || m.role === 'owner'); }

    function needJobTaker(id) {
      var m = find('team', id);
      if (!m || !m.active) throw new AppError('invalid', 'Pick someone who is on the team.');
      if (!canDoJobs(m)) throw new AppError('invalid', 'Only a tech or the owner can be given a job. Pick one of them.');
      return m;
    }

    function defaultTech() {
      var id = getSettings().defaultTechId, m = id ? find('team', id) : null;
      return canDoJobs(m) ? m.id : null;
    }

    /* Someone who is leaving, or becoming a sales rep, keeps the jobs they finished. The ones
       still to do go back to nobody, and new jobs stop going to them. */
    function takeOffJobs(memberId) {
      all('jobs').filter(function (j) { return j.assignedTo === memberId && j.status === 'scheduled'; })
        .forEach(function (j) { j.assignedTo = null; put('jobs', j); });
      var s = find('settings', 'main');
      if (s && s.defaultTechId === memberId) { s.defaultTechId = null; put('settings', s); }
    }

    /* A day and time the way every screen writes them: "Wed, Nov 18 at 8:00 AM". The year is
       added only when it is not this year: "Thu, Jan 7, 2027 at 8:00 AM". */
    function whenText(date, time) {
      var months = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
      var days = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
      var h = +time.slice(0, 2), ampm = h < 12 ? 'AM' : 'PM';
      return days[weekday(date)] + ', ' + months[+date.slice(5, 7) - 1] + ' ' + (+date.slice(8, 10)) +
        (date.slice(0, 4) === today().slice(0, 4) ? '' : ', ' + date.slice(0, 4)) +
        ' at ' + ((h % 12) || 12) + ':' + time.slice(3, 5) + ' ' + ampm;
    }

    /* Money the way every screen writes it: "$1,250.00". */
    function money(c) {
      return '$' + String(Math.floor(c / 100)).replace(/\B(?=(\d{3})+(?!\d))/g, ',') + '.' + pad2(c % 100);
    }

    function canTouchClient(me, client) { return me.role === 'owner' || (me.role === 'rep' && client.repId === me.id); }

    function needClient(id) {
      var c = find('clients', id);
      if (!c) throw new AppError('not_found', 'That client is no longer here.');
      return c;
    }

    function needJob(id) {
      var j = find('jobs', id);
      if (!j) throw new AppError('not_found', 'That job is no longer here.');
      return j;
    }

    function pushNote(doc, me, text) {
      doc.notes = (doc.notes || []).concat([{ at: env.now(), by: me.id, text: text }]).slice(-LIMITS.notesKept);
    }

    /* A job going back on the schedule cannot stay with someone who has left the team or sells now. */
    function dropGoneAssignee(job) {
      if (!canDoJobs(job.assignedTo ? find('team', job.assignedTo) : null)) job.assignedTo = null;
    }

    function setStatus(client, status) {
      if (client.status === status) return;
      client.status = status;
      client.statusLog = (client.statusLog || []).concat([{ day: today(), status: status }]).slice(-200);
    }

    /* Ends the monthly pay of this client's monthly sales that are still running (see
       commissionEvents). `by` is the newer monthly sale taking their place, when that is why. */
    function endMonthlySales(clientId, day, by) {
      all('sales').forEach(function (s) {
        if (s.clientId !== clientId || s.billing !== 'monthly' || s.endDay || s.id === by) return;
        s.endDay = day;
        if (by) s.endedBy = by;
        put('sales', s);
      });
    }

    /* Who a sale can belong to: a sales rep or an owner who is on the team. */
    function needSeller(id) {
      var m = find('team', id);
      if (!m || !m.active || m.role === 'tech') throw new AppError('invalid', 'Pick a sales rep or an owner who is on the team.');
      return m;
    }

    /* The commission rates a sale is saved with. An owner's own sales earn no commission; a
       rep's sale takes the rates in Settings on the day it is saved. */
    function ratesFor(seller, settings) {
      return seller.role === 'owner' ? { firstPct: 0, monthlyPct: 0 } : { firstPct: settings.firstPct, monthlyPct: settings.monthlyPct };
    }

    /* The client's newest sale (the last one entered wins a tie), or null when they have none. */
    function newestSale(clientId) {
      var newest = null;
      all('sales').forEach(function (s) {
        if (s.clientId === clientId && (!newest || s.soldAt >= newest.soldAt)) newest = s;
      });
      return newest;
    }

    /* ---------- actions (who may call each, and what it does) ---------- */

    var ACTIONS = {

      saveMember: { roles: ['owner'], run: function (me, req) {
        var m = req.member || {};
        var name = line(m.name, 40, true, 'Add a name.');
        if (ROLES.indexOf(m.role) < 0) throw new AppError('invalid', 'Pick a role.');
        var clash = all('team').some(function (t) { return t.active && t.id !== m.id && normName(t.name) === normName(name); });
        if (clash) throw new AppError('invalid', 'Someone on the team already has that name. Add a last initial.');
        if (m.id) {
          var cur = find('team', m.id);
          if (!cur || !cur.active) throw new AppError('not_found', 'That person is no longer on the team.');
          if (cur.role === 'owner' && m.role !== 'owner') {
            var owners = all('team').filter(function (t) { return t.active && t.role === 'owner'; }).length;
            if (owners < 2) throw new AppError('invalid', 'There has to be at least one owner.');
          }
          var roleChanged = cur.role !== m.role;
          cur.name = name; cur.role = m.role;
          fits(cur, 'That name is too long to save. Shorten it and try again.');
          put('team', cur);
          if (roleChanged && cur.id !== me.id) dropSessions(cur.id); else refreshSessions(cur);
          if (roleChanged && !canDoJobs(cur)) takeOffJobs(cur.id);   /* now a sales rep: the same as leaving, as far as jobs go */
          return { id: cur.id };
        }
        var pin = m.pin != null && m.pin !== '' ? chosenPin(m.pin) : randomPin(), salt = String(env.uuid());
        var doc = { id: newId('m'), name: name, role: m.role, salt: salt, pinHash: hashPin(salt, pin), active: true, createdAt: env.now() };
        fits(doc, 'That name is too long to save. Shorten it and try again.');
        put('team', doc);
        return { id: doc.id, pin: pin };
      } },

      removeMember: { roles: ['owner'], run: function (me, req) {
        var m = find('team', req.id);
        if (!m || !m.active) throw new AppError('not_found', 'That person is no longer on the team.');
        if (m.id === me.id) throw new AppError('invalid', 'You cannot remove yourself.');
        m.active = false; m.removedAt = env.now();
        put('team', m);
        uncacheSessions(m.id);
        takeOffJobs(m.id);
        return { id: m.id };
      } },

      resetPin: { roles: ['owner'], run: function (me, req) {
        var m = find('team', req.id);
        if (!m || !m.active) throw new AppError('not_found', 'That person is no longer on the team.');
        if (m.id === me.id) throw new AppError('invalid', 'Use Change PIN for your own PIN.');
        var pin = req.pin != null && req.pin !== '' ? chosenPin(req.pin) : randomPin();
        m.salt = String(env.uuid()); m.pinHash = hashPin(m.salt, pin);
        put('team', m);
        dropSessions(m.id);
        clearPinFails(m.id);
        return { id: m.id, pin: pin };
      } },

      /* A wrong "current PIN" counts exactly like a wrong PIN at sign-in, so a phone that is
         lying around signed in cannot be used to guess its owner's PIN. */
      changePin: { roles: ROLES, run: function (me, req) {
        var m = find('team', me.id);
        if (!m) throw new AppError('auth', 'Please sign in again.');
        pinLocked(m);
        if (hashPin(m.salt, str(req.oldPin)) !== m.pinHash) { wrongPin(m); throw new AppError('invalid', 'Your current PIN is not right.'); }
        var newPin = chosenPin(req.newPin);
        m.salt = String(env.uuid()); m.pinHash = hashPin(m.salt, newPin);
        put('team', m);
        dropSessions(m.id, me.sess);
        clearPinFails(m.id);   /* a new PIN starts with a clean count, like one the owner reset */
        return {};
      } },

      saveSettings: { roles: ['owner'], run: function (me, req) {
        var p = req.settings || {}, s = getSettings();
        /* The id a list entry keeps: the one it came with, or a fresh one when it came with none
           or with one that an earlier entry of the same list already has. */
        function ownId(taken, given, prefix) {
          var id = line(given, 30);
          if (!id || taken[id]) id = newId(prefix);
          taken[id] = 1;
          return id;
        }
        if (p.services !== undefined) {
          if (!Array.isArray(p.services) || !p.services.length || p.services.length > LIMITS.services) {
            throw new AppError('invalid', 'Keep at least one service on the list.');
          }
          var seen = Object.create(null), serviceIds = Object.create(null);   /* not {}: a service may be named "constructor" */
          s.services = p.services.map(function (x) {
            var name = line(x && x.name, 40, true, 'Every service needs a name.');
            if (seen[normName(name)]) throw new AppError('invalid', 'Two services have the same name.');
            seen[normName(name)] = 1;
            return { id: ownId(serviceIds, x.id, 's'), name: name, priceCents: cents(x.priceCents == null ? 0 : x.priceCents, 'Check the service prices.') };
          });
        }
        if (p.firstPct !== undefined) s.firstPct = pct(p.firstPct);
        if (p.monthlyPct !== undefined) s.monthlyPct = pct(p.monthlyPct);
        if (p.defaultSlots !== undefined) {
          s.defaultSlots = cleanSlots(p.defaultSlots);
          if (!s.defaultSlots.length) throw new AppError('invalid', 'Keep at least one time.');
        }
        if (p.defaultTechId !== undefined) s.defaultTechId = p.defaultTechId ? needJobTaker(p.defaultTechId).id : null;
        if (p.notifyEmail !== undefined) {
          var em = line(p.notifyEmail, 120);
          if (em && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(em)) throw new AppError('invalid', 'That email address does not look right.');
          s.notifyEmail = em;
        }
        if (p.emailOnBooking !== undefined) s.emailOnBooking = !!p.emailOnBooking;
        if (p.standards !== undefined) {
          if (!Array.isArray(p.standards) || p.standards.length > LIMITS.standardSections) {
            throw new AppError('invalid', 'Keep the standards to ' + LIMITS.standardSections + ' sections or fewer.');
          }
          var sectionIds = Object.create(null);
          var next = p.standards.map(function (sec) {
            var items = (Array.isArray(sec && sec.items) ? sec.items : [])
              .map(function (it) { return line(it, LIMITS.standardLine); })
              .filter(function (it) { return it; })
              .slice(0, LIMITS.standardItems);
            return { id: ownId(sectionIds, sec && sec.id, 'st'), title: line(sec && sec.title, 60, true, 'Every section needs a title.'),
              ordered: !!(sec && sec.ordered), items: items };
          });
          if (JSON.stringify(next) !== JSON.stringify(s.standards)) { s.standards = next; s.standardsUpdatedAt = env.now(); }
        }
        s.id = 'main';
        fits(s, 'The company standards are too long to save. Shorten a few lines or remove a section, then try again.');
        put('settings', s);
        return {};
      } },

      /* Open or block days and set each day's time slots. Existing bookings are never removed. */
      setDays: { roles: ['owner'], run: function (me, req) {
        var list = Array.isArray(req.days) ? req.days : [];
        if (!list.length || list.length > LIMITS.daysPerCall) throw new AppError('invalid', 'Pick at least one day.');
        var defaults = getSettings().defaultSlots;
        var docs = list.map(function (d) {
          if (!d || !isDay(d.date)) throw new AppError('invalid', 'One of those days is not a real date.');
          var cur = find('days', d.date);
          var slots = d.slots !== undefined ? cleanSlots(d.slots) : (cur && cur.slots && cur.slots.length ? cur.slots : defaults.slice());
          if (d.open && !slots.length) slots = defaults.slice();
          return { id: d.date, open: !!d.open, slots: slots };
        });
        docs.forEach(function (doc) { put('days', doc); });
        return { count: docs.length };
      } },

      /* A sale, and (normally) its appointment, saved together or not at all. */
      createSale: { roles: ['owner', 'rep'], run: function (me, req) {
        var day = today(), now = env.now(), settings = getSettings();
        var service = line(req.service, 60, true, 'Pick what was sold.');
        var price = cents(req.priceCents, 'Enter the price.');
        var billing = 'once';   /* what a sale is when the request does not say */
        if (req.billing != null) {
          if (BILLING.indexOf(req.billing) < 0) throw new AppError('invalid', 'Pick one-time or monthly.');
          billing = req.billing;
        }
        var notes = para(req.notes, LIMITS.text);
        var seller = me.role === 'owner' && req.repId ? needSeller(req.repId) : me, repId = seller.id;
        var rates = ratesFor(seller, settings);
        var client, isNew = !req.clientId;
        if (isNew) {
          var c = req.client || {};
          client = {
            id: newId('c'), name: line(c.name, LIMITS.name, true, 'Add the client\'s name.'),
            contact: line(c.contact, LIMITS.name), phone: line(c.phone, 30), email: line(c.email, 120),
            address: line(c.address, LIMITS.line), status: 'New', statusLog: [{ day: day, status: 'New' }],
            service: service, priceCents: price, billing: billing, startDate: day, repId: repId,
            stripeLink: payLink(req.stripeLink), payStatus: 'unpaid', notes: [], createdAt: now
          };
        } else {
          client = needClient(req.clientId);
          if (!canTouchClient(me, client)) throw new AppError('forbidden', 'That client belongs to another rep.');
        }
        var appt = req.appointment || null;
        if (appt) assertSlotFree(appt.date, appt.time);
        var what = line(req.what, LIMITS.line) || service;

        var sale = {
          id: newId('s'), clientId: client.id, repId: repId, service: service, priceCents: price, billing: billing,
          notes: notes, soldAt: now, day: day, firstPct: rates.firstPct, monthlyPct: rates.monthlyPct, jobId: null
        };
        var job = null;
        if (appt) {
          job = {
            id: newId('j'), clientId: client.id, saleId: sale.id, date: appt.date, time: appt.time, what: what,
            assignedTo: defaultTech(), status: 'scheduled', doneAt: null, doneBy: null, notes: [], createdBy: me.id, createdAt: now
          };
          sale.jobId = job.id;
        }
        if (!isNew) {
          client.service = service; client.priceCents = price; client.billing = billing;
          if (client.status === 'Cancelled' || client.status === 'Paused') setStatus(client, 'Active');
        }
        if (notes) pushNote(client, me, notes);
        fits(client, notes ? 'There is no room left in this client\'s notes. Shorten the note on this sale and try again.' : CLIENT_FULL);
        put('clients', client);
        put('sales', sale);
        if (job) put('jobs', job);
        if (!isNew && billing === 'monthly') endMonthlySales(client.id, day, sale.id);   /* one monthly plan pays at a time */

        if (me.role !== 'owner') {
          var head = me.name + ' sold ' + service + ' to ' + client.name + ' for ' + money(price) + (billing === 'monthly' ? ' a month' : '');
          var text = job ? head + '. Booked for ' + whenText(job.date, job.time) + '.' : head + '. No appointment booked yet.';
          tellOwner(job ? 'booking' : 'sale', text,
            job ? 'Appointment booked: ' + client.name + ', ' + whenText(job.date, job.time) : 'New sale, no appointment yet: ' + client.name,
            text + '\n\n' + (client.address ? 'Address: ' + client.address + '\n' : '') + (client.phone ? 'Phone: ' + client.phone + '\n' : '') +
              (job && !job.assignedTo ? '\nNobody is assigned to this job yet.' : ''), client.id);
        }
        return { clientId: client.id, saleId: sale.id, jobId: job ? job.id : null,
          commissionCents: share(price, rates.firstPct) };
      } },

      /*
       * Fixes a sale that was entered wrong: the price, the name of the service, or who made it.
       * Commission, totals and the leaderboard follow by themselves, because they are worked out
       * from the sale every time. patch may hold any of: priceCents, service, repId.
       *   - A new seller has to be a sales rep or an owner who is on the team. A sale moved from
       *     one rep to another keeps the rates it was saved with: it was only filed under the
       *     wrong name. Moved to an owner it earns nothing (0 and 0). Moved from an owner to a
       *     rep it has no rates of its own to keep, so it takes the ones in Settings today.
       *     "From an owner" goes by what the seller it is taken from is now. A patch that names
       *     the seller the sale already has changes nothing.
       *   - If this is the client's newest sale, the client's service and price follow the fix.
       *   - One-time or monthly cannot be changed here. For that, remove the sale and enter it again.
       */
      updateSale: { roles: ['owner'], run: function (me, req) {
        var sale = find('sales', req.saleId), p = req.patch && typeof req.patch === 'object' ? req.patch : {};
        if (!sale) throw new AppError('not_found', 'That sale is no longer here.');
        if (p.billing !== undefined && p.billing !== sale.billing) {
          throw new AppError('invalid', 'One-time or monthly cannot be changed on a sale. Remove the sale and enter it again.');
        }
        var client = find('clients', sale.clientId), newest = newestSale(sale.clientId);
        var follows = !!client && !!newest && newest.id === sale.id, clientChanged = false;
        if (p.priceCents !== undefined) {
          sale.priceCents = cents(p.priceCents, 'Enter the price.');
          if (follows && client.priceCents !== sale.priceCents) { client.priceCents = sale.priceCents; clientChanged = true; }
        }
        if (p.service !== undefined) {
          sale.service = line(p.service, 60, true, 'Pick what was sold.');
          if (follows && client.service !== sale.service) { client.service = sale.service; clientChanged = true; }
        }
        if (p.repId !== undefined && p.repId !== sale.repId) {
          var seller = needSeller(p.repId), was = find('team', sale.repId);
          if (seller.role === 'owner' || (was && was.role === 'owner')) {
            var rates = ratesFor(seller, getSettings());
            sale.firstPct = rates.firstPct; sale.monthlyPct = rates.monthlyPct;
          }
          sale.repId = seller.id;
        }
        fits(sale, 'There is no room to save more on this sale. Shorten the service name, then try again.');
        if (clientChanged) { fits(client, CLIENT_FULL); put('clients', client); }
        put('sales', sale);
        return { saleId: sale.id, clientId: sale.clientId };
      } },

      /* Book an appointment for a client who is already in the system. */
      bookJob: { roles: ['owner', 'rep'], run: function (me, req) {
        var client = needClient(req.clientId);
        if (!canTouchClient(me, client)) throw new AppError('forbidden', 'That client belongs to another rep.');
        assertSlotFree(req.date, req.time);
        var sale = req.saleId ? find('sales', req.saleId) : null;
        if (sale && (sale.clientId !== client.id || sale.jobId)) sale = null;
        var job = {
          id: newId('j'), clientId: client.id, saleId: sale ? sale.id : null, date: req.date, time: req.time,
          what: line(req.what, LIMITS.line) || client.service || 'Job', assignedTo: defaultTech(), status: 'scheduled',
          doneAt: null, doneBy: null, notes: [], createdBy: me.id, createdAt: env.now()
        };
        put('jobs', job);
        if (sale) { sale.jobId = job.id; put('sales', sale); }
        if (me.role !== 'owner') {
          var text = me.name + ' booked ' + client.name + ' for ' + whenText(job.date, job.time) + '.';
          tellOwner('booking', text, 'Appointment booked: ' + client.name + ', ' + whenText(job.date, job.time), text, client.id);
        }
        return { jobId: job.id };
      } },

      moveJob: { roles: ['owner', 'rep'], run: function (me, req) {
        var job = needJob(req.jobId), client = find('clients', job.clientId);
        if (me.role !== 'owner' && !(client && client.repId === me.id)) throw new AppError('forbidden', 'That job belongs to another rep.');
        if (job.status !== 'scheduled') throw new AppError('invalid', 'Only a job that is still scheduled can be moved.');
        assertSlotFree(req.date, req.time, job.id);
        job.date = req.date; job.time = req.time;
        put('jobs', job);
        if (me.role !== 'owner') {
          var moved = me.name + ' moved ' + (client ? client.name : 'an appointment') + ' to ' + whenText(job.date, job.time) + '.';
          tellOwner('booking', moved, 'Appointment moved: ' + (client ? client.name : 'an appointment') + ', ' + whenText(job.date, job.time), moved, job.clientId);
        }
        return { jobId: job.id };
      } },

      /* Assign a job, change what needs doing, cancel it or bring it back. */
      updateJob: { roles: ['owner'], run: function (me, req) {
        var job = needJob(req.jobId), p = req.patch || {};
        if (p.assignedTo !== undefined) job.assignedTo = p.assignedTo ? needJobTaker(p.assignedTo).id : null;
        if (p.what !== undefined) job.what = line(p.what, LIMITS.line, true, 'Say what needs to be done.');
        if (p.status !== undefined) {
          if (p.status === 'cancelled') job.status = 'cancelled';
          else if (p.status === 'scheduled') {
            var clash = all('jobs').some(function (j) {
              return j.id !== job.id && j.status !== 'cancelled' && j.date === job.date && j.time === job.time;
            });
            if (clash) throw new AppError('slot_taken', 'That time has since been taken. Move the job to a new time instead.');
            job.status = 'scheduled'; job.doneAt = null; job.doneBy = null;
            dropGoneAssignee(job);
          } else throw new AppError('invalid', 'That is not a job status.');
        }
        fits(job, 'There is no room to save more on this job. Shorten what needs to be done, then try again.');
        put('jobs', job);
        return { jobId: job.id };
      } },

      setJobDone: { roles: ['owner', 'tech'], run: function (me, req) {
        var job = needJob(req.jobId);
        if (me.role !== 'owner' && job.assignedTo !== me.id) throw new AppError('forbidden', 'That job is assigned to someone else.');
        if (job.status === 'cancelled') throw new AppError('invalid', 'That job was cancelled.');
        var done = req.done !== false;
        job.status = done ? 'done' : 'scheduled';
        job.doneAt = done ? env.now() : null;
        job.doneBy = done ? me.id : null;
        if (!done) dropGoneAssignee(job);
        put('jobs', job);
        var client = find('clients', job.clientId);
        if (done && client && client.status === 'New') { setStatus(client, 'Active'); put('clients', client); }
        if (done && me.role !== 'owner') {
          tellOwner('done', me.name + ' marked ' + (client ? client.name : 'a job') + ' done (' + job.what + ').', null, null, job.clientId);
        }
        return { jobId: job.id, status: job.status };
      } },

      addNote: { roles: ROLES, run: function (me, req) {
        var text = para(req.text, LIMITS.text, true, 'Write the note first.');
        if (req.kind === 'job') {
          var job = needJob(req.id), jc = find('clients', job.clientId);
          var ok = me.role === 'owner' || (me.role === 'tech' && job.assignedTo === me.id) || (me.role === 'rep' && jc && jc.repId === me.id);
          if (!ok) throw new AppError('forbidden', 'That job belongs to someone else.');
          pushNote(job, me, text);
          fits(job, 'There is no room left in this job\'s notes. Shorten the note and try again.');
          put('jobs', job);
        } else if (req.kind === 'client') {
          var client = needClient(req.id);
          if (!canTouchClient(me, client)) throw new AppError('forbidden', 'That client belongs to another rep.');
          pushNote(client, me, text);
          fits(client, 'There is no room left in this client\'s notes. Shorten the note and try again.');
          put('clients', client);
        } else throw new AppError('invalid', 'Bad request.');
        return {};
      } },

      /* The owner can change anything; a rep can fix the contact details of their own clients.
         The owner can also hand a client to another rep (patch.repId). That changes who looks
         after the client from now on, and so who sees them and books for them. Sales already
         made stay with whoever made them, commission included. */
      updateClient: { roles: ['owner', 'rep'], run: function (me, req) {
        var client = needClient(req.clientId), p = req.patch || {}, owner = me.role === 'owner';
        if (!canTouchClient(me, client)) throw new AppError('forbidden', 'That client belongs to another rep.');
        var next = clone(client);
        if (p.name !== undefined) next.name = line(p.name, LIMITS.name, true, 'Add the client\'s name.');
        if (p.contact !== undefined) next.contact = line(p.contact, LIMITS.name);
        if (p.phone !== undefined) next.phone = line(p.phone, 30);
        if (p.email !== undefined) next.email = line(p.email, 120);
        if (p.address !== undefined) next.address = line(p.address, LIMITS.line);
        if (owner) {
          if (p.service !== undefined) next.service = line(p.service, 60, true, 'Pick a service.');
          if (p.priceCents !== undefined) next.priceCents = cents(p.priceCents, 'Enter the price.');
          if (p.billing !== undefined) {
            if (BILLING.indexOf(p.billing) < 0) throw new AppError('invalid', 'Pick one-time or monthly.');
            next.billing = p.billing;
          }
          if (p.startDate !== undefined) {
            if (!isDay(p.startDate)) throw new AppError('invalid', 'That start date is not a real date.');
            next.startDate = p.startDate;
          }
          if (p.stripeLink !== undefined) next.stripeLink = payLink(p.stripeLink);
          if (p.payStatus !== undefined) {
            if (PAY_STATUSES.indexOf(p.payStatus) < 0) throw new AppError('invalid', 'That is not a payment status.');
            next.payStatus = p.payStatus;
          }
          if (p.status !== undefined) {
            if (CLIENT_STATUSES.indexOf(p.status) < 0) throw new AppError('invalid', 'That is not a client status.');
            setStatus(next, p.status);
          }
          if (p.repId !== undefined) next.repId = needSeller(p.repId).id;
        }
        fits(next, CLIENT_FULL);
        put('clients', next);
        if (owner && p.status !== undefined) {
          var day = today();
          if (next.status === 'Cancelled') endMonthlySales(next.id, day);
          else if (client.status === 'Cancelled') {
            /* A cancel taken back the same day (a slip of the thumb) had not stopped any pay yet,
               so the plan it ended runs on: the newest one, because only one plan pays at a time. */
            var back = null;
            all('sales').forEach(function (s) {
              if (s.clientId === next.id && s.endDay === day && !s.endedBy && (!back || s.soldAt >= back.soldAt)) back = s;
            });
            if (back) { delete back.endDay; put('sales', back); }
          }
        }
        return { clientId: next.id };
      } },

      deleteClient: { roles: ['owner'], run: function (me, req) {
        var client = needClient(req.clientId);
        all('sales').filter(function (s) { return s.clientId === client.id; }).forEach(function (s) { del('sales', s.id); });
        all('jobs').filter(function (j) { return j.clientId === client.id; }).forEach(function (j) { del('jobs', j.id); });
        del('clients', client.id);
        return {};
      } },

      /* Removes a sale entered by mistake. Its appointment goes with it if the job has not been
         done yet. A sale to a client who was already here had rewritten what that client buys
         (service, price, one-time or monthly); removing it puts those back to what the client's
         newest remaining sale says. With no sale left, the client is left as they are. */
      deleteSale: { roles: ['owner'], run: function (me, req) {
        var sale = find('sales', req.saleId);
        if (!sale) throw new AppError('not_found', 'That sale is no longer here.');
        var wasNewest = (newestSale(sale.clientId) || {}).id === sale.id;
        var job = sale.jobId ? find('jobs', sale.jobId) : null;
        if (job && job.status === 'scheduled') del('jobs', job.id);
        else if (job) { job.saleId = null; put('jobs', job); }
        /* If this sale had taken the place of an older monthly plan, that plan is the client's
           plan again. It runs on, or ends when and why the removed sale ended. */
        all('sales').forEach(function (s) {
          if (s.endedBy !== sale.id) return;
          delete s.endDay; delete s.endedBy;
          if (sale.endDay) { s.endDay = sale.endDay; if (sale.endedBy) s.endedBy = sale.endedBy; }
          put('sales', s);
        });
        del('sales', sale.id);
        /* Not checked with fits(): by now the sale is gone, so this must not be refused. These three
           are short, so a client that fitted before still fits its cell after. */
        var client = find('clients', sale.clientId), last = newestSale(sale.clientId);
        if (wasNewest && client && last) {
          client.service = last.service; client.priceCents = last.priceCents; client.billing = last.billing;
          put('clients', client);
        }
        return {};
      } },

      /* "I have read the company standards." Remembered per person, with the time. */
      ackStandards: { roles: ROLES, run: function (me) {
        var m = find('team', me.id);
        if (!m) throw new AppError('auth', 'Please sign in again.');
        m.standardsAckAt = env.now();
        put('team', m);
        if (me.role !== 'owner') tellOwner('standards', me.name + ' read the company standards.');
        return { at: m.standardsAckAt };
      } },

      readNotices: { roles: ['owner'], run: function (me) {
        var m = find('team', me.id);
        if (m) { m.noticesSeenAt = env.now(); put('team', m); }
        return {};
      } },

      clearProblems: { roles: ['owner'], run: function () {
        all('problems').slice().forEach(function (p) { del('problems', p.id); });
        return {};
      } },

      logout: { roles: ROLES, run: function (me) {
        store.cacheDel('sess:' + me.sess);
        del('sessions', me.sess);
        return {};
      } }
    };

    function fail(code, message, me, req) {
      var out = { ok: false, error: { code: code, message: message } };
      mem = {};   /* drop anything a failed action changed in memory but never saved */
      if (me) { try { out.sync = buildSync(me, req); } catch (e) { /* answer without it */ } }
      return out;
    }

    function handle(req) {
      mem = {};
      var me = null;
      try {
        if (!req || typeof req.action !== 'string') return fail('invalid', 'Bad request.');
        if (req.action === 'ping') return { ok: true, result: { version: VERSION } };
        if (req.action === 'login') {
          var li = login(req);
          return { ok: true, result: { token: li.token }, sync: buildSync(li.me, null) };
        }
        me = auth(req.token);
        if (!me) return fail('auth', 'Please sign in again.');
        if (req.action === 'sync') return { ok: true, result: {}, sync: buildSync(me, req) };
        var a = Object.prototype.hasOwnProperty.call(ACTIONS, req.action) ? ACTIONS[req.action] : null;
        if (!a) return fail('invalid', 'Bad request.');
        if (a.roles.indexOf(me.role) < 0) return fail('forbidden', 'You do not have access to that.', me, req);
        /*
         * A retry is the same thing again, or nothing. What is remembered under an opId is the
         * answer and a fingerprint of what was sent (see fieldsHash):
         *   never seen                  the action runs;
         *   seen, the same fields       answered from memory, nothing is saved again;
         *   seen, different fields      not run. The first try was saved and its answer was lost
         *                               on the way back, so the phone is told that, with the sync
         *                               to show what was saved.
         * A try that was refused never gets as far as being remembered, so the same opId can
         * come again with the fields put right.
         */
        var opKey = typeof req.opId === 'string' && req.opId.length >= 8 && req.opId.length <= 80 ? 'op:' + me.id + ':' + req.opId : null;
        var sent = opKey ? fieldsHash(req) : '';
        if (opKey) {
          var prev = store.cacheGet(opKey);
          if (prev) {
            var kept = null;
            try { kept = JSON.parse(prev); } catch (e) { kept = null; }
            /* Something is remembered, so this opId was saved once. If it cannot be read, or does
               not say what was sent, the safe answer is the one that saves nothing. */
            if (!kept || typeof kept !== 'object' || kept.h !== sent) return fail('already_saved', ALREADY_SAVED, me, req);
            return { ok: true, result: kept.r && typeof kept.r === 'object' ? kept.r : {}, sync: buildSync(me, req), replay: true };
          }
        }
        var result = a.run(me, req);
        store.setRev(store.getRev() + 1);
        if (opKey) {
          /* A host's cache drops what is too big for it, and a dropped memory would let a retry
             save twice. So an answer too long to keep is remembered without its details: a
             changed retry is still refused, and the same try again is told it was saved. */
          var memo = JSON.stringify({ h: sent, r: result });
          if (memo.length > LIMITS.retryChars) memo = JSON.stringify({ h: sent, big: true });
          store.cachePut(opKey, memo, LIMITS.retrySeconds);
        }
        return { ok: true, result: result, sync: req.action === 'logout' ? null : buildSync(me, req) };
      } catch (e) {
        if (e && e.appCode) return fail(e.appCode, e.message, me, req);
        recordProblem(req && req.action ? req.action : 'request', e && e.message ? e.message : String(e));
        return fail('server', 'Something went wrong on our side. Nothing was saved. Try again.');
      }
    }

    /* First run: make the owner (and the default settings) if there is no owner yet. */
    function bootstrap(opts) {
      mem = {};
      opts = opts || {};
      var owner = all('team').filter(function (m) { return m.active && m.role === 'owner'; })[0];
      if (!find('settings', 'main')) put('settings', clone(DEFAULT_SETTINGS));
      if (owner) return { created: false, name: owner.name };
      /* The host may name the first PIN (the sample data and the dev server do). One that is not
         6 digits, or is easy to guess, is not used: the owner gets one made for them instead. */
      var pin = pinProblem(str(opts.pin)) ? randomPin() : str(opts.pin), salt = String(env.uuid());
      var name = line(opts.name, 40) || 'Owner';
      put('team', { id: newId('m'), name: name, role: 'owner', salt: salt, pinHash: hashPin(salt, pin), active: true, createdAt: env.now() });
      store.setRev(store.getRev() + 1);
      return { created: true, name: name, pin: pin };
    }

    /* Recovery for a forgotten owner PIN; only the host (never a request) can call this. */
    function resetOwnerPin() {
      mem = {};
      var owner = all('team').filter(function (m) { return m.active && m.role === 'owner'; })[0];
      if (!owner) return null;
      var pin = randomPin();
      owner.salt = String(env.uuid()); owner.pinHash = hashPin(owner.salt, pin);
      put('team', owner);
      dropSessions(owner.id);
      clearPinFails(owner.id);
      store.setRev(store.getRev() + 1);
      return { name: owner.name, pin: pin };
    }

    /* For the host: puts a line on the owner's problems list for something that went wrong
       outside a request, such as an alert email that could not be sent after the save. */
    function hostProblem(where, message) {
      mem = {};
      recordProblem(where, message);
    }

    return { handle: handle, bootstrap: bootstrap, resetOwnerPin: resetOwnerPin, recordProblem: hostProblem };
  }

  /* A store that lives in memory: used by sample mode in the page and by the tests. */
  function memoryStore(initial) {
    var data = {}, cache = {}, rev = 0, clock = function () { return Date.now(); };
    COLLECTIONS.forEach(function (c) { data[c] = {}; });
    if (initial && initial.data) {
      Object.keys(initial.data).forEach(function (c) {
        data[c] = {};
        (initial.data[c] || []).forEach(function (doc) { data[c][doc.id] = clone(doc); });
      });
      rev = initial.rev || 0;
    }
    return {
      list: function (coll) { return Object.keys(data[coll] || {}).map(function (id) { return clone(data[coll][id]); }); },
      put: function (coll, doc) { (data[coll] || (data[coll] = {}))[doc.id] = clone(doc); },
      del: function (coll, id) { if (data[coll]) delete data[coll][id]; },
      getRev: function () { return rev; },
      setRev: function (n) { rev = n; },
      cacheGet: function (key) {
        var e = cache[key];
        if (!e) return null;
        if (e.until < clock()) { delete cache[key]; return null; }
        return e.value;
      },
      cachePut: function (key, value, ttl) { cache[key] = { value: String(value), until: clock() + ttl * 1000 }; },
      cacheDel: function (key) { delete cache[key]; },
      setClock: function (fn) { clock = fn; },
      dump: function () {
        var out = { rev: rev, data: {} };
        Object.keys(data).forEach(function (c) { out.data[c] = Object.keys(data[c]).map(function (id) { return clone(data[c][id]); }); });
        return out;
      }
    };
  }

  return {
    VERSION: VERSION, ROLES: ROLES, CLIENT_STATUSES: CLIENT_STATUSES, PAY_STATUSES: PAY_STATUSES, BILLING: BILLING,
    COLLECTIONS: COLLECTIONS, LIMITS: LIMITS, DEFAULT_SETTINGS: DEFAULT_SETTINGS,
    create: create, memoryStore: memoryStore, sha256: sha256,
    calc: { commissionEvents: commissionEvents, sumEvents: sumEvents, statusOn: statusOn },
    /* The same checks the actions make, for a form that wants to say so before it sends.
       Each gives '' when the value is fine, or the words to show. */
    check: { pin: pinProblem, payLink: function (v) { return linkProblem(line(v, 301)); } },
    dates: { isDay: isDay, isHM: isHM, addDays: addDays, addMonths: addMonths, weekday: weekday, weekStart: weekStart, monthStart: monthStart, daysInMonth: daysInMonth }
  };
})();

if (typeof module !== 'undefined' && module.exports) module.exports = RidgelineCore;
