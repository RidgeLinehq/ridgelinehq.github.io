/*
 * Ridgeline Wash Co. team app: the foundation.
 * Sample or real mode, talking to the system, staying live, the router and tab bar, sheets,
 * toasts, the shared UI pieces, sign-in, Today, Company standards and the Me sheet.
 *
 * ============================ WHAT OTHER FILES MAY USE ============================
 * Everything hangs on the one global `App`. Wrap your file in an IIFE and register at load time;
 * the app itself starts on DOMContentLoaded, after every file has registered.
 *
 * SCREENS AND ROUTES
 *   App.screen(route, { roles, title, render(root) })   register a screen. `roles` omitted = everyone.
 *       App.screen('sales', { roles: ['owner', 'rep'], title: 'Sales', render: function (root) { root.appendChild(App.ui.title('Sales')); } });
 *       `root` is emptied before every render and stacks its children with a 16px gap. Keep your own
 *       view state (filters, the month shown) in variables in your file and render from them: render
 *       runs again whenever the data changes. Scroll position is kept, and so is any text typed
 *       into an input that has a `name` (give App.ui.field a name: App.ui.field({ name: 'find' })).
 *   App.go(route)                 switch screen (closes any open sheet first).      App.go('calendar');
 *   App.route                     the current route name, for example 'today'.
 *   App.actions                   cross-screen entry points. Register yours:        App.actions.openClient = function (id) { ... };
 *       Names in use: newSale({date, clientId}), openClient(id), bookVisit(clientId), openTeam(),
 *       openSettings(), openNotices(), editStandards().
 *   App.act(name, arg)            call one if it exists (says "coming soon" if not). App.act('newSale', { date: '2026-11-19' });
 *
 * THE DATA (always the latest answer from the system; never keep your own copy)
 *   App.data                      the snapshot from brief-product.md: me, team, settings, days, taken, clients, sales, jobs, board, notices, problems.
 *   App.mode                      'sample' or 'live'.                               if (App.mode === 'sample') ...
 *   App.me()                      who is signed in: { id, name, role, ... }.        App.me().name
 *   App.role()                    'owner' | 'rep' | 'tech'.                         if (App.role() === 'owner') ...
 *   App.today()                   the business day, 'YYYY-MM-DD' (from the system, not the phone).
 *   App.member(id)                a team member or null.                            App.member(sale.repId)
 *   App.nameOf(id, fallback)      a team member's name.                             App.nameOf(job.assignedTo, 'Unassigned')
 *   App.people(roles)             active team members, optionally only some roles.  App.people(['rep'])
 *   App.client(id), App.job(id), App.sale(id)        find one thing in the data, or null.
 *   App.jobsOn(date)              that day's jobs you can see (not cancelled), in time order.
 *   App.isOverdue(job)            still scheduled and its day has passed.
 *   App.dayOf(date)               the owner's setting for a day: { date, open, slots } or null (not listed = blocked).
 *   App.freeSlots(date)           the times still free that day.                    App.freeSlots('2026-11-19') -> ['09:30', '14:00']
 *   App.freeDays()                every day from today on that still has a free time, in order.
 *   App.needsStandards()          true while I still have to confirm the company standards.
 *   App.hasRead(member)           has this person confirmed the current standards (owner's view of the team).
 *
 * TALKING TO THE SYSTEM
 *   App.api.send(action, fields, opts) -> Promise of the answer { ok, result, error: { code, message } }.
 *       Adds token, since, day and a fresh opId; applies the returned data (which re-renders); never rejects.
 *       A failed call (no signal, time-out, not our JSON) answers { ok: false, error: { code: 'network', message } }.
 *       Pass opts.opId to retry the same action without saving twice.
 *       App.api.send('addNote', { kind: 'client', id: c.id, text: text }).then(function (res) { if (res.ok) ... });
 *       error.message is already plain words for the team: show it as it is. The codes worth a branch are
 *       'slot_taken' / 'slot_closed' (the time is gone: picker.setError(res.error.message)) and 'network'.
 *       An 'auth' answer signs the phone out and shows sign-in by itself.
 *   App.ui.save(button, action, fields, opts) -> Promise of the answer. The whole save pattern for any button:
 *       disables it and shows "Saving...", sends, re-uses the opId when tapped again after a failure, and shows
 *       the message in opts.errorEl (or a red toast). opts: { errorEl, quiet, busyText }.
 *       App.ui.save(btn, 'updateClient', { clientId: id, patch: { payStatus: 'paid' } }, { errorEl: err });
 *   Inside a sheet use sheet.send(action, fields) instead (see SHEETS): same thing on the footer button.
 *       Both answer { ok: false, skipped: true } when the button is already busy saving, so a double tap does nothing.
 *
 * RE-RENDERING WHEN DATA CHANGES
 *   App.refresh()                 re-render the current screen and tell open sheets and live pieces. Call it after
 *                                 you change your own view state.                   filter = 'Active'; App.refresh();
 *   App.on(event, fn) -> off()    'data' (new data applied), 'route' (screen changed), 'tick' (every 20 seconds).
 *   App.live(el, fn)              call fn on every data change and tick for as long as el is on the page.
 *       App.live(listEl, function () { drawList(listEl); });
 *
 * SHEETS, TOASTS, CONFIRM
 *   App.sheet.open({ title, small, body(el, sheet), footer: { label, onTap(sheet), kind }, update(sheet), onClose() }) -> sheet
 *       A panel that slides up. `body` builds the scrolling part once. `footer` adds one sticky button.
 *       `update` runs when new data arrives while the sheet is open: change only what needs changing, so
 *       nothing typed is lost (or call sheet.rebuild() when the sheet holds no input). small: true = only as
 *       tall as its content. The phone's back button closes the top sheet.
 *       var sh = App.sheet.open({ title: 'Add note', small: true, body: function (el) { el.appendChild(box); },
 *         footer: { label: 'Save note', onTap: function (sh) { sh.send('addNote', {...}).then(function (res) { if (res.ok) sh.close(); }); } } });
 *     sheet.el, sheet.body, sheet.button     the panel, the scrolling body, the footer button (or null)
 *     sheet.setTitle(text)                   sheet.setButton(label, disabled)     (setButton(null) hides the footer button)
 *     sheet.note(text)                       a quiet line just above the footer button ("You earn $45.00 on this sale.")
 *     sheet.error(message)                   red words just above the footer button ('' clears them)
 *     sheet.send(action, fields, opts)       save from the footer button: "Saving...", same opId on a retry, shows the
 *                                            message on failure, resolves with the answer. opts: { button, quiet, busyText }
 *     sheet.rebuild()                        run `body` again, keeping the scroll position
 *     sheet.reveal(el)                       scroll the body to an element (the first missing field)
 *     sheet.close()                          close it (and anything opened on top of it)
 *   App.sheet.closeAll()
 *   App.toast(text, opts)         a short message. opts: { bad: true, retry: fn, action: { label, onTap }, ms }.
 *       App.toast('Sale saved.');     App.toast(res.error.message, { bad: true, retry: tryAgain });
 *   App.confirm({ title, text, yes, no, danger }) -> Promise of true or false. In-page, never the browser's own.
 *       App.confirm({ title: 'Delete this client?', text: 'Their sales and jobs go too.', yes: 'Delete client', danger: true }).then(function (ok) { ... });
 *
 * BUILDING THINGS (text from people is always safe: strings become text nodes, never HTML)
 *   Classes for everything (cards, lists, rows, label-value rows, stat blocks, pills, buttons, fields, chips,
 *   callouts, legends) are in app.css, each with a comment naming it; its index is at the top of that file.
 *   Inside a sheet (which is slate already) a .card turns into a darker well by itself.
 *   App.h(tag, attrs, ...children) -> element. attrs: class, text, on<event>, anything else is an attribute.
 *       App.h('p', { class: 'muted' }, 'Sold by ', App.h('b', null, name))
 *   App.esc(text)                 escape &<>"' for the rare case you must build an HTML string.
 *   App.icon(name, size) -> <svg> Names: today sales calendar clients dashboard leaders schedule standards bell close
 *       chevron-left chevron-right chevron-down phone directions note edit check check-circle plus minus search user
 *       team settings key shirt signout reset clock pin alert info copy external trash mail repeat dollar
 *
 * FORM HELPERS (each returns an element with a few methods on it)
 *   App.ui.field({ label, name, type, value, placeholder, hint, optional, prefix, options, rows, inputmode, autocomplete,
 *                  maxlength, autocapitalize, onInput }) -> el with el.input, el.val() (trimmed), el.setError(message)
 *       type: 'text' (default), 'tel', 'email', 'password', 'date', 'time', 'textarea', 'select' (options: [{ value, label }]).
 *       var price = App.ui.field({ label: 'Price', name: 'price', inputmode: 'decimal', prefix: '$' });  price.setError('Enter the price.');
 *   App.ui.segmented({ options: [{ value, label }], value, onChange, label }) -> el with el.get(), el.set(value)
 *       App.ui.segmented({ options: [{ value: 'once', label: 'One-time' }, { value: 'monthly', label: 'Monthly' }], value: 'once', onChange: fn })
 *   App.ui.chips({ options: [{ value, label, count }], value, multi, big, scroll, onChange }) -> el with el.get(), el.set(v), el.setOptions(list)
 *       One choice by default (value), several with multi: true (value is an array). big: large chips (times). scroll: one sliding line.
 *       canClear: true lets a tap on the chosen chip clear it (el.get() is then null).
 *       App.ui.chips({ options: [{ value: '', label: 'All', count: 9 }, { value: 'New', label: 'New', count: 3 }], value: '', scroll: true, onChange: fn })
 *   App.ui.toggle({ label, hint, checked, onChange }) -> el with el.get(), el.set(bool)      (also App.ui['switch'])
 *       App.ui.toggle({ label: 'Open for appointments', checked: day.open, onChange: function (on) { ... } })
 *   App.ui.button(label, { kind, icon, small, block, href, newTab, onTap }) -> <button> or <a>
 *       kind: 'primary' | 'quiet' (default) | 'danger' | 'text'.       App.ui.button('New sale', { kind: 'primary', block: true, onTap: fn })
 *
 * DISPLAY HELPERS
 *   App.ui.title(text, lead)      the screen title with an optional quiet line under it.
 *   App.ui.label(text, { count, tone })     the tiny uppercase section label. tone: 'bad' | 'warn' | 'good' | 'mute'.
 *   App.ui.pill(text, tone)       tone: 'good' | 'warn' | 'bad' | 'ice' | 'mute'.
 *   App.ui.jobPill(job)           Scheduled / Done / Overdue / Cancelled.
 *   App.ui.clientPill(status)     New / Active / Paused / Cancelled.
 *   App.ui.payPill(payStatus)     Not paid yet / Paid / Late.
 *   App.ui.row({ lead, icon, title, sub, right, chevron, onTap, cls }) -> one list row (a button when onTap is given). Put rows in App.h('div', { class: 'list' }).
 *       lead, title, sub, right: text or elements. sub may be a list of lines. cls: 'is-you' (my row in a ranking), 'row-clip' (one line each), 'is-off', 'row-danger'.
 *       App.ui.row({ title: c.name, sub: 'Window cleaning, $150.00 a month', right: App.ui.clientPill(c.status), onTap: function () { App.act('openClient', c.id); } })
 *   App.ui.kv(label, value)       one label-value row; put them in App.h('div', { class: 'kvs' }). value: text or an element.
 *   App.ui.stats([{ value, unit, label, tone }])     the slim summary card of numbers side by side.
 *   App.ui.empty({ title, text, button: { label, onTap, kind } })     an empty state with one next step.
 *   App.ui.notes(list)            note history, newest first (who, when, text).
 *   App.ui.addNote(kind, id)      open the small "Add note" sheet. kind: 'job' | 'client'.
 *   App.ui.jobCard(job, { showDate })       the full job card with its actions (Call, Directions, Add note, Mark done).
 *   App.ui.jobRow(job, { showDate, sub, pill })   a compact row (time, client, what, address) that opens the Job sheet. pill: false hides the status.
 *   App.ui.openJob(jobId)         open the Job sheet (details, notes, and for the owner assign, move, change, cancel).
 *   App.ui.monthGrid({ month, min, max, day(date), onPick(date), onMonth(ym) }) -> el with el.refresh(), el.setMonth(ym), el.getMonth()
 *       A month of days, Sunday first, with arrows. For each day your `day(date)` returns
 *       { state: 'open' | 'full' | 'blocked' | 'past', label: '3 left', disabled: bool, selected: bool }.
 *       Keep the month yourself across renders: pass `month` ('YYYY-MM') and listen to onMonth.
 *   App.ui.slotPicker({ value, date, emptyText, onChange(value) }) -> el with el.get(), el.set({date, time} or null), el.setError(message), el.refresh()
 *       Month grid plus the free times of the chosen day. Updates itself when someone else takes a time.
 *       el.get() is { date, time } once a time is chosen, otherwise null.
 *       var when = App.ui.slotPicker({ date: '2026-11-19', onChange: function (v) { sheet.setButton(v ? 'Save sale and book ' + App.fmt.when(v.date, v.time) : 'Save sale'); } });
 *
 * FORMATTERS (App.fmt)
 *   money(cents) '$150.00'      moneyShort(cents) '$150'        toCents('150.50') 15050 (null when it is not a price)
 *   day(date) 'Thu, Nov 19'     dayLong(date) 'Thursday, November 19'     dayShort(date) 'Nov 19'     month('2026-11') 'November 2026'
 *   time('09:30') '9:30 AM'     when(date, time) 'Thu, Nov 19 at 9:30 AM'
 *   clock(ms) '2:14 PM'         date(ms) 'Nov 17'               stamp(ms) 'Nov 17, 2:14 PM'           ago(ms) '5 min ago'
 *   plural(2, 'sale') '2 sales' initials('Grayson Jones') 'GJ'  first('Grayson Jones') 'Grayson'
 *   tel(phone) 'tel:6155550142' maps(address) the Google Maps directions link
 * ===================================================================================
 */
var App = (function () {
  'use strict';

  var Core = RidgelineCore, D = Core.dates, doc = document;
  var App = { version: Core.VERSION, mode: 'sample', backend: '', data: null, route: '', actions: {}, ui: {}, fmt: {}, api: {}, sheet: {} };
  var ui = App.ui, fmt = App.fmt;

  var state = { token: null, inApp: false, okAt: 0, fails: 0, syncing: false, signingIn: false };
  var els = {};
  var screens = {};

  var TABS = {
    owner: ['today', 'sales', 'calendar', 'clients', 'dashboard'],
    rep: ['today', 'sales', 'calendar', 'clients', 'leaders'],
    tech: ['today', 'schedule', 'standards']
  };
  var TAB_INFO = {
    today: { label: 'Today', icon: 'today' },
    sales: { label: 'Sales', icon: 'sales' },
    calendar: { label: 'Calendar', icon: 'calendar' },
    clients: { label: 'Clients', icon: 'clients' },
    dashboard: { label: 'Dashboard', icon: 'dashboard' },
    leaders: { label: 'Leaders', icon: 'leaders' },
    schedule: { label: 'Schedule', icon: 'schedule' },
    standards: { label: 'Standards', icon: 'standards' }
  };
  var ROLE_WORDS = { owner: 'Owner', rep: 'Sales rep', tech: 'Tech' };
  var NO_SIGNAL = 'Could not save. Check your signal and try again.';

  /* ================= small helpers ================= */

  function pad2(n) { return (n < 10 ? '0' : '') + n; }
  function report(e) { if (window.console && console.error) console.error(e); }
  function wait(ms) { return new Promise(function (resolve) { setTimeout(resolve, ms); }); }

  function newId() {
    try { if (window.crypto && crypto.randomUUID) return crypto.randomUUID(); } catch (e) { /* fall through */ }
    var s = '';
    try {
      var a = new Uint8Array(16);
      crypto.getRandomValues(a);
      for (var i = 0; i < a.length; i++) s += ('0' + a[i].toString(16)).slice(-2);
      return s;
    } catch (e2) { /* fall through */ }
    while (s.length < 32) s += Math.floor(Math.random() * 16).toString(16);
    return s + Date.now().toString(16);
  }

  /* Build an element. Strings become text nodes, so text from people can never turn into HTML. */
  function h(tag, attrs) {
    var el = doc.createElement(tag), k, v;
    for (k in attrs || {}) {
      v = attrs[k];
      if (v == null || v === false) continue;
      if (k === 'class') el.className = v;
      else if (k === 'text') el.textContent = v;
      else if (k.slice(0, 2) === 'on' && typeof v === 'function') el.addEventListener(k.slice(2), v);
      else el.setAttribute(k, v === true ? '' : v);
    }
    for (var i = 2; i < arguments.length; i++) addKid(el, arguments[i]);
    return el;
  }
  function addKid(el, kid) {
    if (kid == null || kid === false || kid === true) return;
    if (Array.isArray(kid)) kid.forEach(function (x) { addKid(el, x); });
    else if (kid.nodeType) el.appendChild(kid);
    else el.appendChild(doc.createTextNode(String(kid)));
  }
  function esc(s) {
    return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
    });
  }
  function clear(el) { el.textContent = ''; return el; }

  App.h = h;
  App.esc = esc;

  /* ================= icons: one small set of line icons (24px box, stroke 1.75, round caps) ================= */

  var ICONS = {
    today: '<rect x="3" y="4.5" width="18" height="16.5" rx="2.5"/><path d="M8 2.5v4M16 2.5v4M3 10h18"/><circle cx="12" cy="15.5" r="1.6" fill="currentColor" stroke="none"/>',
    sales: '<circle cx="12" cy="12" r="9"/><path d="M12 6.5v11M14.7 9.2c-.5-.8-1.5-1.2-2.7-1.2-1.7 0-2.9.8-2.9 2s1 1.7 2.9 2 2.9.8 2.9 2-1.2 2-2.9 2c-1.3 0-2.3-.5-2.8-1.3"/>',
    calendar: '<rect x="3" y="4.5" width="18" height="16.5" rx="2.5"/><path d="M8 2.5v4M16 2.5v4M3 10h18"/>',
    clients: '<circle cx="9" cy="8" r="3.5"/><path d="M2.5 20v-1.5a4.5 4.5 0 0 1 4.5-4.5h4a4.5 4.5 0 0 1 4.5 4.5V20M16 4.7a3.5 3.5 0 0 1 0 6.6M18.5 14.3a4.5 4.5 0 0 1 3 4.2V20"/>',
    dashboard: '<rect x="3.5" y="3.5" width="7" height="7" rx="1.5"/><rect x="13.5" y="3.5" width="7" height="7" rx="1.5"/><rect x="3.5" y="13.5" width="7" height="7" rx="1.5"/><rect x="13.5" y="13.5" width="7" height="7" rx="1.5"/>',
    leaders: '<path d="M6 20v-6M12 20V4M18 20v-9"/>',
    schedule: '<path d="M9 6h11M9 12h11M9 18h11"/><path d="M4.5 6h.01M4.5 12h.01M4.5 18h.01" stroke-width="2.6"/>',
    standards: '<path d="M12 21.5s7.5-3.6 7.5-9.3V5.4L12 2.5 4.5 5.4v6.8c0 5.7 7.5 9.3 7.5 9.3z"/><path d="M8.8 11.9l2.3 2.3 4.1-4.4"/>',
    bell: '<path d="M18 9a6 6 0 1 0-12 0c0 6.5-2.5 8-2.5 8h17S18 15.5 18 9z"/><path d="M10.2 20.5a2 2 0 0 0 3.6 0"/>',
    close: '<path d="M18 6L6 18M6 6l12 12"/>',
    'chevron-left': '<path d="M15 18l-6-6 6-6"/>',
    'chevron-right': '<path d="M9 18l6-6-6-6"/>',
    'chevron-down': '<path d="M6 9l6 6 6-6"/>',
    phone: '<path d="M21 16.5v2.7a1.8 1.8 0 0 1-2 1.8 17.8 17.8 0 0 1-7.8-2.8 17.5 17.5 0 0 1-5.4-5.4A17.8 17.8 0 0 1 3 5a1.8 1.8 0 0 1 1.8-2h2.7a1.8 1.8 0 0 1 1.8 1.5c.1.9.3 1.7.6 2.5a1.8 1.8 0 0 1-.4 1.9L8.4 10a14.4 14.4 0 0 0 5.6 5.6l1.1-1.1a1.8 1.8 0 0 1 1.9-.4c.8.3 1.6.5 2.5.6A1.8 1.8 0 0 1 21 16.5z"/>',
    directions: '<path d="M3.5 10.8L20.5 3.5l-7.3 17-2.2-7.5-7.5-2.2z"/>',
    note: '<path d="M11 4.5H5.5a2 2 0 0 0-2 2v12a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V13"/><path d="M17.7 3.3a2 2 0 0 1 2.9 2.9L12 14.8l-3.8.9.9-3.8 8.6-8.6z"/>',
    edit: '<path d="M16.5 3.8a2.4 2.4 0 0 1 3.5 3.4L7.8 19.5 3.5 20.5l1-4.3L16.5 3.8z"/>',
    check: '<path d="M20 6.5L9.5 17.5 4 12"/>',
    'check-circle': '<circle cx="12" cy="12" r="9"/><path d="M8 12.3l2.7 2.7 5.3-5.6"/>',
    plus: '<path d="M12 5v14M5 12h14"/>',
    minus: '<path d="M5 12h14"/>',
    search: '<circle cx="11" cy="11" r="7"/><path d="M20.5 20.5L16 16"/>',
    user: '<circle cx="12" cy="8" r="3.8"/><path d="M4.5 20.5v-1a5 5 0 0 1 5-5h5a5 5 0 0 1 5 5v1"/>',
    team: '<circle cx="9" cy="8" r="3.5"/><path d="M2.5 20v-1.5a4.5 4.5 0 0 1 4.5-4.5h4a4.5 4.5 0 0 1 4.5 4.5V20M16 4.7a3.5 3.5 0 0 1 0 6.6M18.5 14.3a4.5 4.5 0 0 1 3 4.2V20"/>',
    settings: '<path d="M4 6h9M17 6h3M4 12h3M11 12h9M4 18h9M17 18h3"/><circle cx="15" cy="6" r="2"/><circle cx="9" cy="12" r="2"/><circle cx="15" cy="18" r="2"/>',
    key: '<rect x="4.5" y="10.5" width="15" height="10.5" rx="2.2"/><path d="M8 10.5V7.5a4 4 0 0 1 8 0v3"/><path d="M12 14.8v2" stroke-width="2.2"/>',
    shirt: '<path d="M8.5 3.5L3 6.3l1.7 4.2 2.8-1V20.5h9v-11l2.8 1L21 6.3l-5.5-2.8a3.5 3.5 0 0 1-7 0z"/>',
    signout: '<path d="M9.5 20.5h-4a2 2 0 0 1-2-2v-13a2 2 0 0 1 2-2h4M16 16.5l4.5-4.5L16 7.5M20.5 12h-11"/>',
    reset: '<path d="M3.5 4.5v5h5"/><path d="M4.2 14.5a8.5 8.5 0 1 0 1.9-8.3L3.5 9.5"/>',
    clock: '<circle cx="12" cy="12" r="9"/><path d="M12 7v5l3.2 2"/>',
    pin: '<path d="M19.5 10c0 5.5-7.5 11.5-7.5 11.5S4.5 15.5 4.5 10a7.5 7.5 0 0 1 15 0z"/><circle cx="12" cy="10" r="2.7"/>',
    alert: '<path d="M10.4 4.2L2.8 17.5a1.8 1.8 0 0 0 1.6 2.7h15.2a1.8 1.8 0 0 0 1.6-2.7L13.6 4.2a1.8 1.8 0 0 0-3.2 0z"/><path d="M12 9.5v4"/><path d="M12 16.8h.01" stroke-width="2.4"/>',
    info: '<circle cx="12" cy="12" r="9"/><path d="M12 11.5v5"/><path d="M12 7.8h.01" stroke-width="2.4"/>',
    copy: '<rect x="8.5" y="8.5" width="12" height="12" rx="2"/><path d="M5.5 15.5h-.5a1.5 1.5 0 0 1-1.5-1.5V5a1.5 1.5 0 0 1 1.5-1.5h9A1.5 1.5 0 0 1 15.5 5v.5"/>',
    external: '<path d="M18 13.5v5a2 2 0 0 1-2 2H5.5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h5M15 3.5h5.5V9M10.5 13.5l10-10"/>',
    trash: '<path d="M3.5 6.5h17M18.5 6.5v12.5a2 2 0 0 1-2 2h-9a2 2 0 0 1-2-2V6.5M8.5 6.5V4.5a1.5 1.5 0 0 1 1.5-1.5h4a1.5 1.5 0 0 1 1.5 1.5v2M10 11v5.5M14 11v5.5"/>',
    mail: '<rect x="3" y="5" width="18" height="14" rx="2.2"/><path d="M3.5 7l8.5 6 8.5-6"/>',
    repeat: '<path d="M16.5 2.5l4 4-4 4"/><path d="M3.5 11.5v-1a4 4 0 0 1 4-4h13M7.5 21.5l-4-4 4-4"/><path d="M20.5 12.5v1a4 4 0 0 1-4 4h-13"/>',
    dollar: '<path d="M12 2.5v19M16.5 6.5c-.8-1.2-2.4-2-4.5-2-2.8 0-4.7 1.3-4.7 3.3S9 10.8 12 11.5s4.7 1.7 4.7 3.7-1.9 3.3-4.7 3.3c-2.2 0-3.8-.8-4.6-2.1"/>'
  };

  function icon(name, size) {
    var s = +size || 24, holder = doc.createElement('span');
    holder.innerHTML = '<svg class="ico" viewBox="0 0 24 24" width="' + s + '" height="' + s + '" aria-hidden="true" focusable="false">' + (ICONS[name] || '') + '</svg>';
    return holder.firstChild;
  }
  App.icon = icon;

  /* ================= formatters ================= */

  var MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
  var DAYS = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];

  function commas(n) { return String(n).replace(/\B(?=(\d{3})+(?!\d))/g, ','); }
  function localDay(ms) { var d = new Date(ms); return d.getFullYear() + '-' + pad2(d.getMonth() + 1) + '-' + pad2(d.getDate()); }
  function localHM(ms) { var d = new Date(ms); return pad2(d.getHours()) + ':' + pad2(d.getMinutes()); }
  function thisYear() { return App.data ? App.data.today.slice(0, 4) : String(new Date().getFullYear()); }

  fmt.money = function (cents) {
    var c = Math.round(+cents || 0), neg = c < 0;
    c = Math.abs(c);
    return (neg ? '-$' : '$') + commas(Math.floor(c / 100)) + '.' + pad2(c % 100);
  };
  fmt.moneyShort = function (cents) {
    var c = Math.round(+cents || 0);
    return c % 100 === 0 ? (c < 0 ? '-$' : '$') + commas(Math.abs(c) / 100) : fmt.money(c);
  };
  fmt.toCents = function (text) {
    var s = String(text == null ? '' : text).replace(/[$,\s]/g, '');
    if (!/^(\d+\.?\d{0,2}|\.\d{1,2})$/.test(s)) return null;
    return Math.round(parseFloat(s) * 100);
  };
  fmt.day = function (date) {
    if (!D.isDay(date)) return '';
    var s = DAYS[D.weekday(date)].slice(0, 3) + ', ' + fmt.dayShort(date);
    return date.slice(0, 4) === thisYear() ? s : s + ', ' + date.slice(0, 4);
  };
  fmt.dayLong = function (date) {
    if (!D.isDay(date)) return '';
    return DAYS[D.weekday(date)] + ', ' + MONTHS[+date.slice(5, 7) - 1] + ' ' + (+date.slice(8, 10));
  };
  fmt.dayShort = function (date) {
    if (!D.isDay(date)) return '';
    return MONTHS[+date.slice(5, 7) - 1].slice(0, 3) + ' ' + (+date.slice(8, 10));
  };
  fmt.month = function (ym) { return MONTHS[+String(ym).slice(5, 7) - 1] + ' ' + String(ym).slice(0, 4); };
  fmt.time = function (hm) {
    if (!D.isHM(hm)) return '';
    var hr = +hm.slice(0, 2);
    return ((hr % 12) || 12) + ':' + hm.slice(3, 5) + (hr < 12 ? ' AM' : ' PM');
  };
  fmt.when = function (date, time) { return fmt.day(date) + ' at ' + fmt.time(time); };
  fmt.clock = function (ms) { return fmt.time(localHM(ms)); };
  fmt.date = function (ms) {
    var day = localDay(ms), s = fmt.dayShort(day);
    return day.slice(0, 4) === thisYear() ? s : s + ', ' + day.slice(0, 4);
  };
  fmt.stamp = function (ms) { return fmt.date(ms) + ', ' + fmt.clock(ms); };
  fmt.ago = function (ms) {
    var now = Date.now(), mins = Math.floor((now - ms) / 60000);
    if (mins < 1) return 'Just now';
    if (mins < 60) return mins + ' min ago';
    if (localDay(ms) === localDay(now)) return Math.floor(mins / 60) + ' hr ago';
    if (localDay(ms) === localDay(now - 86400000)) return 'Yesterday';
    return fmt.date(ms);
  };
  fmt.plural = function (n, word, many) { return n + ' ' + (n === 1 ? word : (many || word + 's')); };
  fmt.first = function (name) { return String(name || '').trim().split(/\s+/)[0] || ''; };
  fmt.initials = function (name) {
    var parts = String(name || '').trim().split(/\s+/).filter(Boolean);
    if (!parts.length) return '?';
    var s = parts[0].charAt(0) + (parts.length > 1 ? parts[parts.length - 1].charAt(0) : '');
    return s.toUpperCase();
  };
  fmt.tel = function (phone) {
    var s = String(phone || '').trim().replace(/[a-z#;,].*$/i, '');   /* drop "ext. 12" and anything after it */
    var digits = s.replace(/[^\d]/g, '');
    return digits ? 'tel:' + (s.charAt(0) === '+' ? '+' : '') + digits : '';
  };
  fmt.maps = function (address) { return 'https://www.google.com/maps/dir/?api=1&destination=' + encodeURIComponent(String(address || '')); };

  /* ================= storage: every read and write is guarded; the app still runs without it ================= */

  var storage = {
    prefix: 'ridgeline.sample.',
    get: function (key) { try { return window.localStorage.getItem(this.prefix + key); } catch (e) { return null; } },
    set: function (key, value) { try { window.localStorage.setItem(this.prefix + key, value); return true; } catch (e) { return false; } },
    del: function (key) { try { window.localStorage.removeItem(this.prefix + key); } catch (e) { /* nothing to remove */ } },
    json: function (key) {
      var s = this.get(key);
      if (!s) return null;
      try { return JSON.parse(s); } catch (e) { return null; }
    }
  };

  /* ================= sample or real ================= */

  function pickMode() {
    var url = typeof window.RIDGELINE_BACKEND === 'string' ? window.RIDGELINE_BACKEND.trim() : '';
    var host = location.hostname;
    var dev = location.protocol === 'file:' || host === 'localhost' || host === '127.0.0.1';
    if (dev) {   /* test overrides, honored nowhere else */
      var q = null;
      try { q = new URLSearchParams(location.search); } catch (e) { /* no query support */ }
      if (q && q.get('sample') === '1') url = '';
      else if (q && q.get('backend')) url = q.get('backend');
    }
    if (url && !(/^https:\/\//i.test(url) || (dev && /^http:\/\//i.test(url)))) url = '';
    App.backend = url;
    App.mode = url ? 'live' : 'sample';
    storage.prefix = 'ridgeline.' + App.mode + '.';
  }

  /* ----- sample mode: RidgelineCore running in the page, saved on this phone ----- */

  var sample = null;

  function sampleClock() { return { now: function () { return Date.now(); }, dayKey: localDay, hm: localHM, uuid: newId, notify: function () {} }; }

  /* Loads today's saved sample, or builds a fresh one. Returns true when it was built fresh. */
  function startSample(forceFresh) {
    var today = localDay(Date.now()), saved = forceFresh ? null : storage.json('db'), dump = null;
    if (saved && saved.day === today && saved.dump && saved.dump.data) dump = saved.dump;
    var fresh = !dump, store;
    if (fresh) {
      try { dump = RidgelineSample.build({ now: Date.now(), dayKey: localDay, hm: localHM, uuid: newId }); }
      catch (e) { report(e); dump = null; }
    }
    try { store = Core.memoryStore(dump || undefined); }
    catch (e2) { report(e2); store = Core.memoryStore(); fresh = true; }
    sample = { store: store, core: Core.create(store, sampleClock()), day: today };
    if (!dump) sample.core.bootstrap({ name: RidgelineSample.PEOPLE[0].name, pin: RidgelineSample.PEOPLE[0].pin });
    if (fresh) saveSample();
    return fresh;
  }

  function saveSample() { storage.set('db', JSON.stringify({ day: sample.day, dump: sample.store.dump() })); }

  function callSample(req) {
    return new Promise(function (resolve) {
      setTimeout(function () {
        var res = null;
        try {
          res = JSON.parse(JSON.stringify(sample.core.handle(req)));
          if (req.action !== 'sync') saveSample();
        } catch (e) { report(e); }
        resolve(res);
      }, req.action === 'sync' ? 0 : 150);
    });
  }

  /* ----- real mode: the same JSON over fetch to the Apps Script web app ----- */

  function callBackend(req) {
    return new Promise(function (resolve) {
      var done = false, ctrl = null, timer;
      function finish(res) {
        if (done) return;
        done = true;
        clearTimeout(timer);
        resolve(res);
      }
      try { ctrl = new AbortController(); } catch (e) { ctrl = null; }
      timer = setTimeout(function () {
        finish(null);
        if (ctrl) { try { ctrl.abort(); } catch (e) { /* already settled */ } }
      }, 20000);
      try {
        /* text/plain keeps the browser from sending a preflight, which Apps Script cannot answer. */
        fetch(App.backend, {
          method: 'POST',
          headers: { 'Content-Type': 'text/plain;charset=utf-8' },
          body: JSON.stringify(req),
          signal: ctrl ? ctrl.signal : undefined
        }).then(function (r) { return r.text(); }).then(function (text) {
          var res = null;
          try { res = JSON.parse(text); } catch (e) { res = null; }   /* an error page, not our JSON */
          finish(res);
        }).catch(function () { finish(null); });
      } catch (e3) { finish(null); }
    });
  }

  /* Is this one of our answers? Anything else counts as a failed call. */
  function isAnswer(res) {
    if (!res || typeof res !== 'object') return false;
    if (res.ok === true) return true;
    return res.ok === false && !!res.error && typeof res.error.message === 'string';
  }

  function transport(req) { return App.mode === 'sample' ? callSample(req) : callBackend(req); }

  /* "The system is busy" means try again: do that quietly a couple of times before telling anyone. */
  function attempt(req, tries) {
    return transport(req).then(function (res) {
      if (isAnswer(res) && !res.ok && res.error.code === 'busy' && tries < 2) {
        return wait(900).then(function () { return attempt(req, tries + 1); });
      }
      return res;
    });
  }

  /* ================= App.api.send ================= */

  function send(action, fields, opts) {
    opts = opts || {};
    var req = { action: action }, k;
    for (k in fields || {}) if (Object.prototype.hasOwnProperty.call(fields, k)) req[k] = fields[k];
    if (action !== 'login') {
      req.token = state.token;
      if (App.data) { req.since = App.data.rev; req.day = App.data.today; }
      if (action !== 'sync' && action !== 'logout') req.opId = opts.opId || newId();
    }
    return attempt(req, 0).then(function (res) { return settle(req, res); });
  }

  function settle(req, res) {
    if (!isAnswer(res)) return { ok: false, error: { code: 'network', message: NO_SIGNAL }, opId: req.opId };
    var mine = req.action === 'login' || (!!state.token && req.token === state.token);
    if (mine) {
      if (res.ok || res.sync) state.okAt = Date.now();
      if (res.ok && state.fails) { state.fails = 0; drawStrip(); }
      if (res.sync) applySync(res.sync);
      if (!res.ok && res.error.code === 'auth' && req.action !== 'login') signOut(res.error.message || 'Please sign in again.');
    }
    res.opId = req.opId;
    if (!res.ok && !res.error.message) res.error.message = NO_SIGNAL;
    return res;
  }

  App.api.send = send;

  function applySync(sync) {
    if (!sync || typeof sync !== 'object') return;
    if (sync.same) { storage.set('at', String(state.okAt)); return; }
    if (!sync.me || !Array.isArray(sync.jobs) || !sync.settings) return;   /* not a snapshot we understand */
    var cur = App.data;
    if (cur && cur.me.id === sync.me.id && cur.today === sync.today && sync.rev < cur.rev) return;   /* an older answer that arrived late */
    App.data = sync;
    storage.set('snap', JSON.stringify(sync));
    storage.set('at', String(state.okAt));
    changed();
  }

  /* ================= events and re-rendering ================= */

  var listeners = {}, liveItems = [];

  App.on = function (name, fn) {
    (listeners[name] || (listeners[name] = [])).push(fn);
    return function () {
      var list = listeners[name] || [], i = list.indexOf(fn);
      if (i >= 0) list.splice(i, 1);
    };
  };
  function emit(name) {
    (listeners[name] || []).slice().forEach(function (fn) { try { fn(); } catch (e) { report(e); } });
  }
  function onPage(el) { return el.isConnected !== undefined ? el.isConnected : doc.documentElement.contains(el); }

  App.live = function (el, fn) { liveItems.push({ el: el, fn: fn, misses: 0 }); };
  function runLive() {
    liveItems = liveItems.filter(function (item) {
      if (!onPage(item.el)) return ++item.misses < 6;   /* gone from the page for a while: forget it */
      item.misses = 0;
      try { item.fn(); } catch (e) { report(e); }
      return true;
    });
  }

  /* New data (or a view change): redraw the chrome and the screen, then tell open sheets and live pieces. */
  function changed() {
    if (!state.inApp || !App.data) return;
    drawChrome();
    drawScreen(true);
    layers.slice().forEach(function (layer) {
      if (layers.indexOf(layer) < 0 || !layer.update) return;
      try { layer.update(); } catch (e) { report(e); }
    });
    runLive();
    emit('data');
  }
  App.refresh = changed;

  /* ================= reading the data ================= */

  function findIn(list, id) {
    list = list || [];
    for (var i = 0; i < list.length; i++) if (list[i].id === id) return list[i];
    return null;
  }
  function byTime(a, b) { return a.date < b.date ? -1 : a.date > b.date ? 1 : a.time < b.time ? -1 : a.time > b.time ? 1 : 0; }

  App.me = function () { return App.data ? App.data.me : null; };
  App.role = function () { return App.data ? App.data.me.role : ''; };
  App.today = function () { return App.data ? App.data.today : localDay(Date.now()); };
  App.member = function (id) { return App.data && id ? findIn(App.data.team, id) : null; };
  App.nameOf = function (id, fallback) {
    var m = App.member(id);
    return m ? m.name : (fallback == null ? '' : fallback);
  };
  App.people = function (roles) {
    if (!App.data) return [];
    return App.data.team.filter(function (m) { return m.active && (!roles || roles.indexOf(m.role) >= 0); });
  };
  App.client = function (id) { return App.data ? findIn(App.data.clients, id) : null; };
  App.job = function (id) { return App.data ? findIn(App.data.jobs, id) : null; };
  App.sale = function (id) { return App.data ? findIn(App.data.sales, id) : null; };
  App.jobsOn = function (date) {
    if (!App.data) return [];
    return App.data.jobs.filter(function (j) { return j.date === date && j.status !== 'cancelled'; }).sort(byTime);
  };
  App.isOverdue = function (job) { return !!job && job.status === 'scheduled' && job.date < App.today(); };
  App.dayOf = function (date) {
    var days = (App.data && App.data.days) || [];
    for (var i = 0; i < days.length; i++) if (days[i].date === date) return days[i];
    return null;
  };

  /* The time right now in the business's zone, 'HH:MM' (sample mode simply uses this phone's clock). */
  var zoneClock = null;
  function businessHM() {
    if (App.mode === 'sample') return localHM(Date.now());
    try {
      zoneClock = zoneClock || new Intl.DateTimeFormat('en-GB', { timeZone: 'America/Chicago', hour: '2-digit', minute: '2-digit', hour12: false });
      var s = zoneClock.format(new Date());
      if (/^\d{2}:\d{2}$/.test(s)) return s === '24:00' ? '00:00' : s;
    } catch (e) { /* fall through to the phone's clock */ }
    return localHM(Date.now());
  }

  App.freeSlots = function (date) {
    var d = App.data;
    if (!d || !date || date < d.today) return [];
    var day = App.dayOf(date);
    if (!day || !day.open) return [];
    var taken = {}, nowHM = date === d.today ? businessHM() : '';
    (d.taken || []).forEach(function (t) { if (t.date === date) taken[t.time] = 1; });
    return (day.slots || []).filter(function (s) { return !taken[s] && (!nowHM || s > nowHM); }).sort();
  };
  App.freeDays = function () {
    var d = App.data;
    if (!d) return [];
    return (d.days || []).map(function (x) { return x.date; })
      .filter(function (date) { return date >= d.today && App.freeSlots(date).length > 0; }).sort();
  };
  App.hasRead = function (member) {
    if (!member || !App.data) return false;
    var at = member.standardsAckAt || 0;
    return at > 0 && at >= (App.data.settings.standardsUpdatedAt || 0);
  };
  App.needsStandards = function () {
    var me = App.me();
    return !!me && me.role !== 'owner' && !App.hasRead(me);
  };

  /* ================= cross-screen actions ================= */

  App.act = function (name, arg) {
    var fn = App.actions[name];
    if (typeof fn !== 'function') { App.toast('That part is coming soon.'); return false; }
    try { fn(arg); } catch (e) { report(e); App.toast('That could not be opened. Try again.', { bad: true }); }
    return true;
  };

  /* ================= layers: sheets and dialogs, closed by the phone's back button ================= */

  var layers = [], afterPop = null;

  function pushLayer(layer) {
    layer.opener = doc.activeElement;
    layers.push(layer);
    doc.documentElement.classList.add('locked');
    layer.inHistory = false;
    try { history.pushState({ rwLayer: layers.length }, ''); layer.inHistory = true; } catch (e) { /* no history here: the close button still works */ }
  }

  /* Close layers until `depth` are left. Returns true when a history step back is on its way. */
  function dropTo(depth, fromHistory) {
    var steps = 0, layer = null;
    while (layers.length > depth) {
      layer = layers.pop();
      if (layer.inHistory) steps++;
      if (layer.wrap.parentNode) layer.wrap.parentNode.removeChild(layer.wrap);
      try { if (layer.gone) layer.gone(); } catch (e) { report(e); }
    }
    if (!layers.length) doc.documentElement.classList.remove('locked');
    if (layer && layer.opener && layer.opener.focus && onPage(layer.opener)) {
      try { layer.opener.focus({ preventScroll: true }); } catch (e2) { /* focus is a nicety */ }
    }
    if (steps && !fromHistory) {
      try { history.go(-steps); return true; } catch (e3) { /* stay put */ }
    }
    return false;
  }

  function closeAll(then) {
    var moving = dropTo(0, false);
    if (!then) return;
    if (!moving) { then(); return; }
    var ran = false;
    function run() {
      if (ran) return;
      ran = true;
      afterPop = null;
      then();
    }
    afterPop = run;
    setTimeout(run, 400);
  }

  function onPopState() {
    var depth = (history.state && history.state.rwLayer) || 0;
    if (depth < layers.length) dropTo(depth, true);
    if (afterPop) afterPop();
  }

  /* While the on-screen keyboard is up, keep sheets inside the part of the screen that is still visible. */
  function fitLayers() {
    var vv = window.visualViewport, st = els.layers && els.layers.style;
    if (!st) return;
    if (!vv || Math.abs((vv.scale || 1) - 1) > 0.01) {
      st.removeProperty('--vv-h');
      st.removeProperty('--vv-top');
      return;
    }
    st.setProperty('--vv-h', Math.round(vv.height) + 'px');
    st.setProperty('--vv-top', Math.round(vv.offsetTop) + 'px');
  }

  /* ----- sheets ----- */

  App.sheet.open = function (o) {
    o = o || {};
    var sh = { kind: 'sheet' };
    var title = h('h2', { class: 'sheet-title' }, o.title || '');
    var closeBtn = h('button', { type: 'button', class: 'iconbtn sheet-close', 'aria-label': 'Close', onclick: function () { sh.close(); } }, icon('close', 20));
    var errorEl = h('p', { class: 'form-error', role: 'alert', hidden: true });
    var noteEl = h('p', { class: 'form-note', hidden: true });
    sh.body = h('div', { class: 'sheet-body' });
    sh.button = o.footer ? ui.button(o.footer.label, {
      kind: o.footer.kind || 'primary', block: true,
      onTap: function () { if (o.footer.onTap) o.footer.onTap(sh); }
    }) : null;
    var foot = h('div', { class: 'sheet-foot' + (sh.button ? '' : ' is-bare') }, noteEl, errorEl, sh.button);
    sh.el = h('section', { class: 'sheet' + (o.small ? ' sheet-small' : ''), role: 'dialog', 'aria-modal': 'true', 'aria-label': o.title || 'Details', tabindex: '-1' },
      h('div', { class: 'sheet-head' }, title, closeBtn), sh.body, foot);
    sh.wrap = h('div', { class: 'layer' }, sh.el);
    if (o.small) sh.wrap.addEventListener('click', function (e) { if (e.target === sh.wrap) sh.close(); });

    sh.setTitle = function (text) { title.textContent = text || ''; sh.el.setAttribute('aria-label', text || 'Details'); };
    sh.setButton = function (label, disabled) {
      if (!sh.button) return;
      sh.button.hidden = label == null;
      foot.classList.toggle('is-bare', label == null);
      if (label == null) return;
      var span = sh.button.querySelector('.btn-label');
      if (sh.button.classList.contains('is-busy')) sh.button._idle = label;
      else span.textContent = label;
      sh.button._off = !!disabled;
      if (!sh.button.classList.contains('is-busy')) sh.button.disabled = !!disabled;
    };
    sh.note = function (text) { noteEl.textContent = text || ''; noteEl.hidden = !text; };
    sh.error = function (message) {
      errorEl.textContent = message || '';
      errorEl.hidden = !message;
      foot.classList.toggle('has-error', !!message);
    };
    sh.busy = function (on, text) { setBusy(sh.button, on, text); };
    sh.send = function (action, fields, opts) {
      opts = opts || {};
      return save(opts.button || sh.button, action, fields, { error: sh.error, quiet: opts.quiet, busyText: opts.busyText, key: sh });
    };
    sh.rebuild = function () {
      var y = sh.body.scrollTop;
      clear(sh.body);
      try { o.body(sh.body, sh); } catch (e) { report(e); }
      sh.body.scrollTop = y;
    };
    sh.reveal = function (el) {
      if (!el || !sh.body.contains(el)) return;
      var top = el.getBoundingClientRect().top - sh.body.getBoundingClientRect().top + sh.body.scrollTop;
      sh.body.scrollTop = Math.max(0, top - 16);
    };
    sh.close = function () {
      var i = layers.indexOf(sh);
      if (i >= 0) dropTo(i, false);
    };
    sh.update = o.update ? function () { o.update(sh); } : null;
    sh.gone = function () { if (o.onClose) o.onClose(sh); };

    els.layers.appendChild(sh.wrap);
    pushLayer(sh);
    try { if (o.body) o.body(sh.body, sh); } catch (e) { report(e); }
    if (!sh.el.contains(doc.activeElement)) { try { sh.el.focus({ preventScroll: true }); } catch (e2) { /* fine */ } }
    return sh;
  };
  App.sheet.closeAll = function () { closeAll(); };

  /* ----- confirm dialog ----- */

  App.confirm = function (o) {
    o = o || {};
    return new Promise(function (resolve) {
      var answered = false, layer = { kind: 'dialog' };
      function answer(yes) {
        if (answered) return;
        answered = true;
        var i = layers.indexOf(layer);
        if (i >= 0) dropTo(i, false);
        resolve(yes);
      }
      var yesBtn = ui.button(o.yes || 'Yes', { kind: o.danger ? 'danger' : 'primary', onTap: function () { answer(true); } });
      var noBtn = ui.button(o.no || 'Cancel', { kind: 'quiet', onTap: function () { answer(false); } });
      var box = h('div', { class: 'dialog', role: 'alertdialog', 'aria-modal': 'true', 'aria-label': o.title || 'Are you sure?', tabindex: '-1' },
        h('h2', { class: 'dialog-title' }, o.title || 'Are you sure?'),
        o.text ? h('p', { class: 'dialog-text' }, o.text) : null,
        h('div', { class: 'cols-2' }, noBtn, yesBtn));
      layer.wrap = h('div', { class: 'layer layer-center', onclick: function (e) { if (e.target === layer.wrap) answer(false); } }, box);
      layer.gone = function () { if (!answered) { answered = true; resolve(false); } };
      els.layers.appendChild(layer.wrap);
      pushLayer(layer);
      try { box.focus({ preventScroll: true }); } catch (e) { /* fine */ }
    });
  };

  /* ----- toasts ----- */

  App.toast = function (text, o) {
    o = o || {};
    var gone = false, timer;
    var el = h('div', { class: 'toast' + (o.bad ? ' toast-bad' : ''), role: o.bad ? 'alert' : null }, h('span', { class: 'toast-text' }, text));
    function remove() {
      if (gone) return;
      gone = true;
      clearTimeout(timer);
      if (el.parentNode) el.parentNode.removeChild(el);
    }
    var action = o.retry ? { label: 'Retry', onTap: o.retry } : o.action;
    if (action) {
      el.appendChild(h('button', { type: 'button', class: 'toast-btn', onclick: function () { remove(); action.onTap(); } }, action.label));
    }
    while (els.toasts.children.length >= 2) els.toasts.removeChild(els.toasts.firstChild);
    els.toasts.appendChild(el);
    timer = setTimeout(remove, o.ms || (action ? 8000 : o.bad ? 5000 : 2600));
    return remove;
  };

  /* ================= saving: "Saving...", same opId on a retry, the message by the button ================= */

  function setBusy(btn, on, text) {
    if (!btn) return;
    var label = btn.querySelector('.btn-label');
    if (on) {
      if (label && btn._idle == null) { btn._idle = label.textContent; label.textContent = text || 'Saving...'; }
      btn.disabled = true;
      btn.classList.add('is-busy');
    } else {
      if (label && btn._idle != null) { label.textContent = btn._idle; btn._idle = null; }
      btn.disabled = !!btn._off;
      btn.classList.remove('is-busy');
    }
  }

  function save(btn, action, fields, o) {
    o = o || {};
    if (btn && btn.classList.contains('is-busy')) return Promise.resolve({ ok: false, skipped: true, error: { code: 'busy', message: '' } });
    var holder = btn || o.key || {};
    var ops = holder._ops || (holder._ops = {});
    if (!ops[action]) ops[action] = newId();
    setBusy(btn, true, o.busyText);
    if (o.error) o.error('');
    return send(action, fields, { opId: ops[action] }).then(function (res) {
      setBusy(btn, false);
      if (res.ok) ops[action] = null;
      else if (!o.quiet) {
        if (o.error) o.error(res.error.message);
        else App.toast(res.error.message, { bad: true });
      }
      return res;
    });
  }

  ui.save = function (btn, action, fields, o) {
    o = o || {};
    var errorEl = o.errorEl;
    return save(btn, action, fields, {
      quiet: o.quiet, busyText: o.busyText,
      error: errorEl ? function (message) { errorEl.textContent = message || ''; errorEl.hidden = !message; } : null
    });
  };

  /* ================= shared UI pieces ================= */

  ui.button = function (label, o) {
    o = o || {};
    var link = !!o.href;
    var el = h(link ? 'a' : 'button', {
      class: 'btn btn-' + (o.kind || 'quiet') + (o.small ? ' btn-sm' : '') + (o.block ? ' btn-block' : ''),
      type: link ? null : 'button', href: link ? o.href : null,
      target: o.newTab ? '_blank' : null, rel: o.newTab ? 'noopener noreferrer' : null
    }, o.icon ? icon(o.icon, o.small ? 18 : 20) : null, h('span', { class: 'btn-label' }, label));
    if (o.onTap) el.addEventListener('click', function (e) { o.onTap(e, el); });
    return el;
  };

  var fieldCount = 0;
  ui.field = function (o) {
    o = o || {};
    var id = 'fld' + (++fieldCount), input, control;
    if (o.type === 'textarea') input = h('textarea', { class: 'input', rows: o.rows || 3 });
    else if (o.type === 'select') {
      input = h('select', { class: 'input' });
      (o.options || []).forEach(function (op) { input.appendChild(h('option', { value: op.value }, op.label)); });
    } else input = h('input', { class: 'input', type: o.type || 'text' });
    input.id = id;
    input.name = o.name || id;
    if (o.placeholder) input.placeholder = o.placeholder;
    if (o.inputmode) input.setAttribute('inputmode', o.inputmode);
    if (o.maxlength) input.setAttribute('maxlength', o.maxlength);
    input.setAttribute('autocomplete', o.autocomplete || 'off');
    if (o.autocapitalize) input.setAttribute('autocapitalize', o.autocapitalize);
    if (o.type === 'password' || o.type === 'email' || o.type === 'tel' || o.autocapitalize === 'none') {
      input.setAttribute('autocorrect', 'off');
      input.setAttribute('spellcheck', 'false');
    }
    if (o.value != null) input.value = o.value;

    if (o.prefix) control = h('span', { class: 'input-wrap has-prefix' }, h('span', { class: 'input-prefix' }, o.prefix), input);
    else if (o.type === 'select') control = h('span', { class: 'input-wrap' }, input, h('span', { class: 'input-arrow' }, icon('chevron-down', 20)));
    else control = input;

    var err = h('p', { class: 'field-error', id: id + '-err', role: 'alert', hidden: true });
    var el = h('div', { class: 'field' },
      o.label ? h('label', { class: 'field-label', for: id }, o.label, o.optional ? h('span', { class: 'field-opt' }, ' (optional)') : null) : null,
      control,
      o.hint ? h('p', { class: 'field-hint' }, o.hint) : null,
      err);
    el.input = input;
    el.val = function () { return String(input.value == null ? '' : input.value).trim(); };
    el.setError = function (message) {
      err.textContent = message || '';
      err.hidden = !message;
      el.classList.toggle('has-error', !!message);
      if (message) { input.setAttribute('aria-invalid', 'true'); input.setAttribute('aria-describedby', id + '-err'); }
      else { input.removeAttribute('aria-invalid'); input.removeAttribute('aria-describedby'); }
    };
    function typed() {
      if (!err.hidden) el.setError('');
      if (o.onInput) o.onInput(input.value, el);
    }
    input.addEventListener('input', typed);
    if (o.type === 'select') input.addEventListener('change', typed);
    return el;
  };

  ui.segmented = function (o) {
    o = o || {};
    var value = o.value, el = h('div', { class: 'seg', role: 'group', 'aria-label': o.label || null }), buttons = [];
    function paint() {
      buttons.forEach(function (b) {
        var on = b.v === value;
        b.el.classList.toggle('is-on', on);
        b.el.setAttribute('aria-pressed', on ? 'true' : 'false');
      });
    }
    (o.options || []).forEach(function (op) {
      var b = h('button', { type: 'button', class: 'seg-btn', onclick: function () {
        if (value === op.value) return;
        value = op.value;
        paint();
        if (o.onChange) o.onChange(value);
      } }, op.label);
      buttons.push({ v: op.value, el: b });
      el.appendChild(b);
    });
    el.get = function () { return value; };
    el.set = function (v) { value = v; paint(); };
    paint();
    return el;
  };

  ui.chips = function (o) {
    o = o || {};
    var multi = !!o.multi, options = o.options || [];
    var value = multi ? (o.value || []).slice() : o.value;
    var el = h('div', { class: 'chips' + (o.big ? ' chips-big' : '') + (o.scroll ? ' chips-scroll' : ''), role: 'group', 'aria-label': o.label || null });
    function isOn(v) { return multi ? value.indexOf(v) >= 0 : value === v; }
    function draw() {
      clear(el);
      options.forEach(function (op) {
        el.appendChild(h('button', { type: 'button', class: 'chip' + (isOn(op.value) ? ' is-on' : ''), 'aria-pressed': isOn(op.value) ? 'true' : 'false', onclick: function () {
          if (multi) {
            var i = value.indexOf(op.value);
            if (i >= 0) value.splice(i, 1); else value.push(op.value);
          } else {
            if (value === op.value && !o.canClear) return;
            value = value === op.value ? null : op.value;
          }
          draw();
          if (o.onChange) o.onChange(multi ? value.slice() : value);
        } }, op.label, op.count != null ? h('span', { class: 'chip-count' }, String(op.count)) : null));
      });
    }
    el.get = function () { return multi ? value.slice() : value; };
    el.set = function (v) { value = multi ? (v || []).slice() : v; draw(); };
    el.setOptions = function (list) { options = list || []; draw(); };
    draw();
    return el;
  };

  ui.toggle = function (o) {
    o = o || {};
    var on = !!o.checked;
    var el = h('button', { type: 'button', class: 'switch', role: 'switch', 'aria-checked': on ? 'true' : 'false', onclick: function () {
      on = !on;
      el.setAttribute('aria-checked', on ? 'true' : 'false');
      if (o.onChange) o.onChange(on);
    } },
      h('span', { class: 'switch-text' }, h('span', { class: 'switch-label' }, o.label || ''), o.hint ? h('span', { class: 'switch-hint' }, o.hint) : null),
      h('span', { class: 'switch-track' }));
    el.get = function () { return on; };
    el.set = function (v) { on = !!v; el.setAttribute('aria-checked', on ? 'true' : 'false'); };
    return el;
  };
  ui['switch'] = ui.toggle;

  ui.title = function (text, lead) {
    return h('header', { class: 'head' }, h('h1', { class: 'title' }, text), lead ? h('p', { class: 'lead' }, lead) : null);
  };
  ui.label = function (text, o) {
    o = o || {};
    return h('h2', { class: 'label' + (o.tone ? ' label-' + o.tone : '') }, h('span', null, text), o.count != null ? h('span', { class: 'label-count' }, String(o.count)) : null);
  };
  ui.pill = function (text, tone) { return h('span', { class: 'pill pill-' + (tone || 'mute') }, text); };
  ui.jobPill = function (job) {
    if (job.status === 'done') return ui.pill('Done', 'good');
    if (job.status === 'cancelled') return ui.pill('Cancelled', 'mute');
    return App.isOverdue(job) ? ui.pill('Overdue', 'bad') : ui.pill('Scheduled', 'warn');
  };
  ui.clientPill = function (status) {
    var tone = { New: 'ice', Active: 'good', Paused: 'warn', Cancelled: 'mute' }[status] || 'mute';
    return ui.pill(status || 'New', tone);
  };
  ui.payPill = function (payStatus) {
    if (payStatus === 'paid') return ui.pill('Paid', 'good');
    if (payStatus === 'late') return ui.pill('Late', 'bad');
    return ui.pill('Not paid yet', 'warn');
  };

  ui.row = function (o) {
    o = o || {};
    var tap = typeof o.onTap === 'function';
    var el = h(tap ? 'button' : 'div', { class: 'row' + (o.cls ? ' ' + o.cls : ''), type: tap ? 'button' : null },
      o.icon ? h('span', { class: 'row-lead' }, icon(o.icon, 22)) : null,
      o.lead != null ? h('span', { class: 'row-lead' }, o.lead) : null,
      h('span', { class: 'row-main' },
        h('span', { class: 'row-title' }, o.title),
        (Array.isArray(o.sub) ? o.sub : [o.sub]).map(function (line) { return line ? h('span', { class: 'row-sub' }, line) : null; })),
      o.right != null ? h('span', { class: 'row-right' }, o.right) : null,
      (o.chevron == null ? tap : o.chevron) ? h('span', { class: 'row-chev' }, icon('chevron-right', 20)) : null);
    if (tap) el.addEventListener('click', function (e) { o.onTap(e, el); });
    return el;
  };
  ui.kv = function (label, value) {
    return h('div', { class: 'kv' }, h('span', { class: 'kv-label' }, label), h('span', { class: 'kv-value' }, value));
  };
  ui.stats = function (items) {
    var el = h('div', { class: 'stats' });
    (items || []).forEach(function (it) {
      el.appendChild(h('div', { class: 'stat' },
        h('span', { class: 'stat-num' + (it.tone ? ' is-' + it.tone : '') }, String(it.value), it.unit ? h('small', null, it.unit) : null),
        h('span', { class: 'stat-label' }, it.label)));
    });
    return el;
  };
  ui.empty = function (o) {
    o = o || {};
    return h('div', { class: 'empty' },
      h('p', { class: 'empty-title' }, o.title || 'Nothing here yet.'),
      o.text ? h('p', { class: 'empty-text' }, o.text) : null,
      o.button ? ui.button(o.button.label, { kind: o.button.kind || 'quiet', small: true, onTap: o.button.onTap }) : null);
  };
  ui.notes = function (list) {
    var el = h('div', { class: 'notes' });
    (list || []).slice().reverse().forEach(function (n) {
      el.appendChild(h('div', { class: 'note' },
        h('p', { class: 'note-by' }, h('b', null, App.nameOf(n.by, 'Someone')), ', ' + fmt.stamp(n.at)),
        h('p', { class: 'note-text' }, n.text)));
    });
    return el;
  };

  /* ================= month grid and slot picker ================= */

  function shiftMonth(ym, n) {
    var y = +ym.slice(0, 4), m = +ym.slice(5, 7) - 1 + n;
    y += Math.floor(m / 12);
    return y + '-' + pad2(((m % 12) + 12) % 12 + 1);
  }

  ui.monthGrid = function (o) {
    o = o || {};
    var ym = o.month || App.today().slice(0, 7);
    var el = h('div', { class: 'month' });

    function move(n) {
      ym = shiftMonth(ym, n);
      draw();
      if (o.onMonth) o.onMonth(ym);
    }
    function draw() {
      var today = App.today(), y = +ym.slice(0, 4), m = +ym.slice(5, 7);
      var count = D.daysInMonth(y, m), lead = D.weekday(ym + '-01'), labels = false, i;
      var days = h('div', { class: 'month-days' });
      for (i = 0; i < lead; i++) days.appendChild(h('span', { 'aria-hidden': 'true' }));
      for (i = 1; i <= count; i++) {
        var cell = dayCell(ym + '-' + pad2(i), today);
        if (cell.hasLabel) labels = true;
        days.appendChild(cell);
      }
      var prev = h('button', { type: 'button', class: 'iconbtn iconbtn-quiet', 'aria-label': 'Previous month', disabled: !!o.min && ym <= o.min, onclick: function () { move(-1); } }, icon('chevron-left', 20));
      var next = h('button', { type: 'button', class: 'iconbtn iconbtn-quiet', 'aria-label': 'Next month', disabled: !!o.max && ym >= o.max, onclick: function () { move(1); } }, icon('chevron-right', 20));
      var dow = h('div', { class: 'month-dow', 'aria-hidden': 'true' });
      ['S', 'M', 'T', 'W', 'T', 'F', 'S'].forEach(function (d) { dow.appendChild(h('span', null, d)); });
      clear(el);
      el.className = 'month' + (labels ? ' has-labels' : '');
      el.appendChild(h('div', { class: 'month-head' }, h('h3', { class: 'month-title' }, fmt.month(ym)), h('div', { class: 'month-nav' }, prev, next)));
      el.appendChild(dow);
      el.appendChild(days);
    }
    function dayCell(date, today) {
      var s = (o.day && o.day(date)) || {};
      var tap = !s.disabled && typeof o.onPick === 'function';
      var cell = h(tap ? 'button' : 'span', {
        class: 'day' + (s.state ? ' is-' + s.state : '') + (date === today ? ' is-today' : '') + (s.selected ? ' is-selected' : ''),
        type: tap ? 'button' : null,
        'aria-label': fmt.dayLong(date) + (s.label ? ', ' + s.label : '') + (date === today ? ', today' : ''),
        'aria-pressed': tap ? (s.selected ? 'true' : 'false') : null,
        onclick: tap ? function () { o.onPick(date); } : null
      }, h('span', { class: 'day-num' }, String(+date.slice(8, 10))), s.label ? h('span', { class: 'day-label' }, s.label) : null);
      cell.hasLabel = !!s.label;
      return cell;
    }

    el.refresh = draw;
    el.setMonth = function (next) { if (next && next !== ym) { ym = next; draw(); } };
    el.getMonth = function () { return ym; };
    draw();
    return el;
  };

  ui.slotPicker = function (o) {
    o = o || {};
    var value = o.value && o.value.date && o.value.time ? { date: o.value.date, time: o.value.time } : null;
    var day = value ? value.date : (o.date || null), problem = '';
    if (!value && (!day || !App.freeSlots(day).length)) day = App.freeDays()[0] || day;

    var el = h('div', { class: 'slotpick' }), times = h('div', { class: 'slotpick-times' });
    var gridOpts = {
      month: (day || App.today()).slice(0, 7),
      min: App.today().slice(0, 7),
      day: function (date) {
        var free = App.freeSlots(date).length;
        return { state: date < App.today() ? 'past' : free ? 'open' : 'blocked', disabled: !free, selected: date === day };
      },
      onPick: function (date) {
        day = date;
        problem = '';
        if (value && value.date !== date) change(null); else draw();
      }
    };
    var grid = ui.monthGrid(gridOpts);

    function lastMonth() {
      var free = App.freeDays(), last = free.length ? free[free.length - 1].slice(0, 7) : App.today().slice(0, 7);
      return last > grid.getMonth() ? last : grid.getMonth();
    }
    function change(v) {
      value = v;
      draw();
      if (o.onChange) o.onChange(value);
    }
    function drawTimes() {
      clear(times);
      if (problem) times.appendChild(h('p', { class: 'form-error', role: 'alert' }, problem));
      if (!App.freeDays().length) {
        times.appendChild(h('p', { class: 'muted' }, o.emptyText || 'No open days yet. Ask Grayson to open some.'));
        return;
      }
      if (!day) { times.appendChild(h('p', { class: 'muted' }, 'Pick a day to see its open times.')); return; }
      var free = App.freeSlots(day);
      times.appendChild(h('p', { class: 'slotpick-day' }, fmt.dayLong(day)));
      if (!free.length) { times.appendChild(h('p', { class: 'muted' }, 'No times left on this day. Pick another day.')); return; }
      var chips = h('div', { class: 'chips chips-big', role: 'group', 'aria-label': 'Open times' });
      free.forEach(function (time) {
        var on = !!value && value.date === day && value.time === time;
        chips.appendChild(h('button', { type: 'button', class: 'chip' + (on ? ' is-on' : ''), 'aria-pressed': on ? 'true' : 'false', onclick: function () {
          problem = '';
          change({ date: day, time: time });
        } }, fmt.time(time)));
      });
      times.appendChild(chips);
    }
    function draw() {
      gridOpts.min = App.today().slice(0, 7);
      gridOpts.max = lastMonth();
      grid.refresh();
      drawTimes();
    }
    /* New data: a time someone else just took disappears, and a chosen time that is gone is dropped. */
    function live() {
      if (value && App.freeSlots(value.date).indexOf(value.time) < 0) {
        problem = 'That time was just taken. Pick another.';
        change(null);
        return;
      }
      draw();
    }

    el.appendChild(grid);
    el.appendChild(times);
    el.get = function () { return value ? { date: value.date, time: value.time } : null; };
    el.set = function (v) {
      value = v && v.date && v.time ? { date: v.date, time: v.time } : null;
      if (value) { day = value.date; grid.setMonth(day.slice(0, 7)); }
      problem = '';
      draw();
    };
    el.setError = function (message) { problem = message || ''; drawTimes(); };
    el.refresh = live;
    App.live(el, live);
    draw();
    return el;
  };

  /* ================= jobs: the card, the row, the sheet ================= */

  function lastNote(job) { var n = job.notes || []; return n.length ? n[n.length - 1] : null; }
  function canMark(job) {
    var me = App.me();
    return !!me && job.status !== 'cancelled' && (me.role === 'owner' || (me.role === 'tech' && job.assignedTo === me.id));
  }
  function doneText(job) {
    var when = job.doneAt ? (localDay(job.doneAt) === localDay(Date.now()) ? fmt.clock(job.doneAt) : fmt.stamp(job.doneAt)) : '';
    var who = App.nameOf(job.doneBy, '');
    return 'Done' + (when ? ' ' + when : '') + (who ? ' by ' + who : '');
  }
  function metaRow(iconName, content, cls) {
    return h('div', { class: 'meta-row' + (cls ? ' ' + cls : '') }, icon(iconName, 18), h('span', null, content));
  }

  /* One-tap: flips at once, saves behind, rolls back with a red toast and Retry if the save fails. */
  function setDone(jobId, done, opId) {
    var job = App.job(jobId), me = App.me();
    if (!job || !me) return;
    var before = { status: job.status, doneAt: job.doneAt, doneBy: job.doneBy }, stamp = done ? Date.now() : null;
    job.status = done ? 'done' : 'scheduled';
    job.doneAt = stamp;
    job.doneBy = done ? me.id : null;
    changed();
    opId = opId || newId();
    send('setJobDone', { jobId: jobId, done: done }, { opId: opId }).then(function (res) {
      if (res.ok) return;
      var now = App.job(jobId);
      if (now && now.status === (done ? 'done' : 'scheduled') && now.doneAt === stamp) {
        now.status = before.status; now.doneAt = before.doneAt; now.doneBy = before.doneBy;
        changed();
      }
      App.toast(res.error.message, { bad: true, retry: res.error.code === 'network' ? function () { setDone(jobId, done, opId); } : null });
    });
  }

  function jobActions(job) {
    var c = job.client || {}, row = h('div', { class: 'job-actions' });
    if (fmt.tel(c.phone)) row.appendChild(ui.button('Call', { icon: 'phone', small: true, href: fmt.tel(c.phone) }));
    if (c.address) row.appendChild(ui.button('Directions', { icon: 'directions', small: true, href: fmt.maps(c.address), newTab: true }));
    row.appendChild(ui.button('Add note', { icon: 'note', small: true, onTap: function () { ui.addNote('job', job.id); } }));
    return row;
  }

  function doneLine(job) {
    return h('div', { class: 'job-done-line' }, h('span', null, doneText(job)),
      canMark(job) ? ui.button('Undo', { kind: 'text', small: true, onTap: function () { setDone(job.id, false); } }) : null);
  }

  ui.jobCard = function (job, o) {
    o = o || {};
    var me = App.me(), c = job.client || {}, over = App.isOverdue(job);
    var done = job.status === 'done', cancelled = job.status === 'cancelled';
    var card = h('article', { class: 'card job' + (over ? ' is-overdue' : '') + (done ? ' is-done' : '') + (cancelled ? ' is-cancelled' : '') });
    card.appendChild(h('div', { class: 'job-top' },
      h('span', { class: 'job-time' }, o.showDate ? fmt.day(job.date) + ', ' + fmt.time(job.time) : fmt.time(job.time)),
      ui.jobPill(job)));
    if (over && !o.showDate) card.appendChild(h('p', { class: 'job-due' }, 'Was due ' + fmt.day(job.date)));
    card.appendChild(h('button', { type: 'button', class: 'job-name', onclick: function () { ui.openJob(job.id); } },
      h('span', null, c.name || 'Client'), icon('chevron-right', 20)));
    if (job.what) card.appendChild(h('p', { class: 'job-what' }, job.what));
    if (done) { card.appendChild(doneLine(job)); return card; }
    if (cancelled) return card;

    var meta = h('div', { class: 'meta' }), note = lastNote(job);
    if (c.address) meta.appendChild(metaRow('pin', c.address));
    if (c.phone) meta.appendChild(metaRow('phone', c.phone));
    if (me.role !== 'tech') {
      if (job.assignedTo) meta.appendChild(metaRow('user', App.nameOf(job.assignedTo, 'Someone')));
      else if (me.role === 'owner') {
        meta.appendChild(metaRow('user', h('button', { type: 'button', class: 'pill pill-warn', onclick: function () { openAssign(job.id); } }, 'Unassigned', icon('chevron-right', 14))));
      } else meta.appendChild(metaRow('user', ui.pill('Unassigned', 'warn')));
    }
    if (note) meta.appendChild(metaRow('note', note.text, 'is-note'));
    if (meta.firstChild) card.appendChild(meta);
    card.appendChild(jobActions(job));
    if (canMark(job)) card.appendChild(ui.button('Mark done', { kind: 'primary', block: true, onTap: function () { setDone(job.id, true); } }));
    return card;
  };

  ui.jobRow = function (job, o) {
    o = o || {};
    var c = job.client || {};
    var lead = h('span', { class: 'row-time' }, o.showDate ? h('small', null, fmt.day(job.date)) : null, fmt.time(job.time));
    var sub = o.sub != null ? o.sub : [job.what, c.address];
    return ui.row({ lead: lead, title: c.name || 'Client', sub: sub, cls: 'row-clip', right: o.pill === false ? null : ui.jobPill(job), chevron: false, onTap: function () { ui.openJob(job.id); } });
  };

  ui.addNote = function (kind, id) {
    var box = ui.field({ label: 'Note', name: 'note', type: 'textarea', rows: 4, maxlength: Core.LIMITS.text,
      placeholder: kind === 'job' ? 'Anything the next person should know' : 'What should the team know about this client?' });
    return App.sheet.open({
      title: 'Add note', small: true,
      body: function (el) {
        el.appendChild(box);
        try { box.input.focus(); } catch (e) { /* fine */ }
      },
      footer: { label: 'Save note', onTap: function (sh) {
        var text = box.val();
        if (!text) { box.setError('Write the note first.'); return; }
        sh.send('addNote', { kind: kind, id: id, text: text }).then(function (res) {
          if (!res.ok) return;
          sh.close();
          App.toast('Note saved.');
        });
      } }
    });
  };

  function openAssign(jobId) {
    App.sheet.open({
      title: 'Assign to', small: true,
      update: function (sh) { sh.rebuild(); },
      body: function (el, sh) {
        var job = App.job(jobId);
        if (!job) { el.appendChild(h('p', { class: 'muted' }, 'That job is no longer here.')); return; }
        var order = { tech: 0, owner: 1, rep: 2 };
        var people = App.people().sort(function (a, b) { return (order[a.role] - order[b.role]) || (a.name < b.name ? -1 : 1); });
        var list = h('div', { class: 'list' });
        function pick(id, name, rowEl) {
          if (id === (job.assignedTo || null)) { sh.close(); return; }
          sh.send('updateJob', { jobId: jobId, patch: { assignedTo: id } }, { button: rowEl }).then(function (res) {
            if (!res.ok) return;
            sh.close();
            App.toast(id ? 'Assigned to ' + name + '.' : 'Nobody is assigned now.');
          });
        }
        people.forEach(function (m) {
          var on = job.assignedTo === m.id;
          list.appendChild(ui.row({
            lead: h('span', { class: 'avatar' }, fmt.initials(m.name)), title: m.name, sub: ROLE_WORDS[m.role] || '',
            right: on ? h('span', { class: 'ice' }, icon('check', 22)) : null, chevron: false,
            onTap: function (e, rowEl) { pick(m.id, m.name, rowEl); }
          }));
        });
        if (job.assignedTo) {
          list.appendChild(ui.row({ title: 'Nobody yet', sub: 'Leave this job unassigned', chevron: false, onTap: function (e, rowEl) { pick(null, '', rowEl); } }));
        }
        el.appendChild(list);
      }
    });
  }

  function openMove(jobId) {
    var job = App.job(jobId), picker;
    if (!job) return;
    var sh = App.sheet.open({
      title: 'Move to another time',
      body: function (el, sheet) {
        el.appendChild(h('p', { class: 'muted' }, ((job.client || {}).name || 'This job') + ' is booked for ' + fmt.when(job.date, job.time) + '.'));
        picker = ui.slotPicker({ onChange: function (v) { sheet.setButton(v ? 'Move to ' + fmt.when(v.date, v.time) : 'Pick a new time', !v); } });
        el.appendChild(picker);
      },
      footer: { label: 'Pick a new time', onTap: function (sheet) {
        var v = picker.get();
        if (!v) return;
        sheet.send('moveJob', { jobId: jobId, date: v.date, time: v.time }).then(function (res) {
          if (res.ok) {
            sheet.close();
            App.toast('Moved to ' + fmt.when(v.date, v.time) + '.');
          } else if (res.error.code === 'slot_taken' || res.error.code === 'slot_closed') {
            sheet.error('');
            picker.set(null);
            picker.setError(res.error.message);
            sheet.setButton('Pick a new time', true);
          }
        });
      } }
    });
    sh.setButton('Pick a new time', true);
  }

  function openWhat(jobId) {
    var job = App.job(jobId);
    if (!job) return;
    var box = ui.field({ label: 'What needs to be done', name: 'what', value: job.what, maxlength: Core.LIMITS.line });
    App.sheet.open({
      title: 'Change what needs doing', small: true,
      body: function (el) { el.appendChild(box); },
      footer: { label: 'Save', onTap: function (sh) {
        var text = box.val();
        if (!text) { box.setError('Say what needs to be done.'); return; }
        sh.send('updateJob', { jobId: jobId, patch: { what: text } }).then(function (res) {
          if (!res.ok) return;
          sh.close();
          App.toast('Saved.');
        });
      } }
    });
  }

  function bringBack(jobId) {
    send('updateJob', { jobId: jobId, patch: { status: 'scheduled' } }).then(function (res) {
      if (res.ok) App.toast('The job is back on the schedule.');
      else App.toast(res.error.message, { bad: true });
    });
  }

  function cancelJob(job, btn, errorEl, sh) {
    var c = job.client || {};
    App.confirm({
      title: 'Cancel this job?',
      text: (c.name || 'This job') + ', ' + fmt.when(job.date, job.time) + '. The time opens up again for booking.',
      yes: 'Cancel job', no: 'Keep it', danger: true
    }).then(function (yes) {
      if (!yes) return;
      ui.save(btn, 'updateJob', { jobId: job.id, patch: { status: 'cancelled' } }, { errorEl: errorEl }).then(function (res) {
        if (!res.ok) return;
        sh.close();
        App.toast('Job cancelled.', { action: { label: 'Undo', onTap: function () { bringBack(job.id); } } });
      });
    });
  }

  function drawJob(el, sh, jobId) {
    var job = App.job(jobId), me = App.me();
    if (!job || !me) return;
    var c = job.client || {}, owner = me.role === 'owner';
    var done = job.status === 'done', cancelled = job.status === 'cancelled', scheduled = job.status === 'scheduled';

    el.appendChild(h('div', { class: 'stack-sm' },
      h('div', null, ui.jobPill(job)),
      h('p', { class: 'card-title num' }, fmt.when(job.date, job.time)),
      job.what ? h('p', { class: 'job-what' }, job.what) : null));

    var kvs = h('div', { class: 'kvs' });
    if (c.address) kvs.appendChild(ui.kv('Address', c.address));
    if (c.phone) kvs.appendChild(ui.kv('Phone', c.phone));
    if (c.contact) kvs.appendChild(ui.kv('Contact', c.contact));
    if (me.role === 'rep') kvs.appendChild(ui.kv('Assigned to', job.assignedTo ? App.nameOf(job.assignedTo, 'Someone') : ui.pill('Unassigned', 'warn')));
    if (kvs.firstChild) el.appendChild(kvs);

    if (!cancelled) el.appendChild(jobActions(job));
    if (scheduled && canMark(job)) {
      el.appendChild(ui.button('Mark done', { kind: 'primary', block: true, onTap: function () { setDone(job.id, true); } }));
    }
    if (done) {
      el.appendChild(h('div', { class: 'callout callout-good' }, h('div', { class: 'between' },
        h('span', { class: 'strong' }, doneText(job)),
        canMark(job) ? ui.button('Undo', { kind: 'text', small: true, onTap: function () { setDone(job.id, false); } }) : null)));
    }
    if (cancelled) {
      el.appendChild(h('div', { class: 'callout' }, h('p', { class: 'callout-title' }, 'This job was cancelled.'),
        owner ? h('p', { class: 'muted small' }, 'You can put it back on the schedule if its time is still free.') : null));
      if (owner) {
        var backErr = h('p', { class: 'form-error', role: 'alert', hidden: true });
        el.appendChild(ui.button('Put it back on the schedule', { block: true, onTap: function (e, btn) {
          ui.save(btn, 'updateJob', { jobId: job.id, patch: { status: 'scheduled' } }, { errorEl: backErr }).then(function (res) {
            if (res.ok) App.toast('The job is back on the schedule.');
          });
        } }));
        el.appendChild(backErr);
      }
    }

    el.appendChild(ui.label('Notes'));
    el.appendChild((job.notes || []).length ? ui.notes(job.notes) : h('p', { class: 'muted' }, 'No notes yet.'));

    if (cancelled || !(owner || (me.role === 'rep' && scheduled))) return;
    el.appendChild(ui.label(owner ? 'Manage this job' : 'Change this job'));
    var list = h('div', { class: 'list' });
    if (owner) {
      list.appendChild(ui.row({ icon: 'user', title: 'Assign to',
        right: job.assignedTo ? App.nameOf(job.assignedTo, 'Someone') : ui.pill('Unassigned', 'warn'),
        onTap: function () { openAssign(job.id); } }));
    }
    if (scheduled) list.appendChild(ui.row({ icon: 'calendar', title: 'Move to another time', onTap: function () { openMove(job.id); } }));
    if (owner) list.appendChild(ui.row({ icon: 'edit', title: 'Change what needs doing', onTap: function () { openWhat(job.id); } }));
    el.appendChild(list);
    if (owner && scheduled) {
      var cancelErr = h('p', { class: 'form-error', role: 'alert', hidden: true });
      el.appendChild(ui.button('Cancel job', { kind: 'danger', block: true, onTap: function (e, btn) { cancelJob(job, btn, cancelErr, sh); } }));
      el.appendChild(cancelErr);
    }
  }

  ui.openJob = function (jobId) {
    var job = App.job(jobId);
    if (!job) { App.toast('That job is no longer here.'); return null; }
    return App.sheet.open({
      title: (job.client || {}).name || 'Job',
      body: function (el, sh) { drawJob(el, sh, jobId); },
      update: function (sh) {
        var now = App.job(jobId);
        if (!now) { sh.close(); App.toast('That job is no longer on your list.'); return; }
        sh.setTitle((now.client || {}).name || 'Job');
        sh.rebuild();
      }
    });
  };

  /* ================= the shell: top bar, strip, tab bar, router ================= */

  var tabsKey = '';

  function drawStrip() {
    if (!els.strip) return;
    var text = '';
    if (state.fails >= 2) {
      var at = state.okAt ? (localDay(state.okAt) === localDay(Date.now()) ? fmt.clock(state.okAt) : fmt.stamp(state.okAt)) : '';
      text = 'No connection. ' + (at ? 'Showing what was saved at ' + at + '. ' : '') + 'Trying again.';
    } else if (App.mode === 'sample') text = 'Sample data. Nothing here is real yet.';
    els.strip.hidden = !text;
    els.stripText.textContent = text;
  }

  function drawChrome() {
    var d = App.data, me = d.me, owner = me.role === 'owner';
    els.meBtn.textContent = fmt.initials(me.name);
    els.bell.hidden = !owner;
    if (owner) {
      var unread = (d.notices || []).some(function (n) { return n.at > (me.noticesSeenAt || 0); });
      els.bell.classList.toggle('has-dot', unread);
      els.bell.setAttribute('aria-label', unread ? 'Notifications, some are new' : 'Notifications');
    }
    var key = me.role + '|' + App.route;
    if (key !== tabsKey) {
      tabsKey = key;
      clear(els.tabs);
      (TABS[me.role] || TABS.tech).forEach(function (route) {
        var info = TAB_INFO[route], on = route === App.route;
        els.tabs.appendChild(h('button', { type: 'button', class: 'tab' + (on ? ' is-on' : ''), 'aria-current': on ? 'page' : null,
          onclick: function () { App.go(route); } }, icon(info.icon), h('span', null, info.label)));
      });
    }
    drawStrip();
  }

  /* Text someone is typing on a screen survives a re-render (the input needs a name, which App.ui.field takes). */
  function keepTyped(root) {
    var out = [], active = doc.activeElement;
    Array.prototype.forEach.call(root.querySelectorAll('input, textarea, select'), function (el) {
      var key = el.name || el.id;
      if (!key || el.type === 'checkbox' || el.type === 'radio') return;
      var item = { key: key, value: el.value, focus: el === active };
      if (item.focus) { try { item.from = el.selectionStart; item.to = el.selectionEnd; } catch (e) { /* not a text box */ } }
      out.push(item);
    });
    return out;
  }
  function restoreTyped(root, kept) {
    if (!kept.length) return;
    var found = {};
    Array.prototype.forEach.call(root.querySelectorAll('input, textarea, select'), function (el) {
      var key = el.name || el.id;
      if (key && !found[key]) found[key] = el;
    });
    kept.forEach(function (item) {
      var el = found[item.key];
      if (!el) return;
      if (el.value !== item.value) el.value = item.value;
      if (item.focus) {
        try {
          el.focus({ preventScroll: true });
          if (item.from != null) el.setSelectionRange(item.from, item.to);
        } catch (e) { /* fine */ }
      }
    });
  }

  function placeholder(root, route) {
    var info = TAB_INFO[route] || { label: 'This screen' };
    root.appendChild(ui.title(info.label));
    root.appendChild(ui.empty({ title: 'This screen is on its way.', text: 'Everything else in the app works in the meantime.' }));
  }

  function drawScreen(keep) {
    var root = els.screen, def = screens[App.route];
    var y = window.pageYOffset || doc.documentElement.scrollTop || 0;
    var typed = keep ? keepTyped(root) : [];
    clear(root);
    root.className = 'screen screen-' + App.route;
    try {
      if (def) def.render(root); else placeholder(root, App.route);
    } catch (e) {
      report(e);
      clear(root);
      root.appendChild(ui.empty({ title: 'This screen could not be shown.', text: 'Close the app and open it again. If it keeps happening, tell Grayson.' }));
    }
    if (keep) { restoreTyped(root, typed); window.scrollTo(0, y); }
    else window.scrollTo(0, 0);
  }

  function allowed(route) {
    var role = App.role(), def = screens[route];
    if (def) return !def.roles || def.roles.indexOf(role) >= 0;
    return (TABS[role] || []).indexOf(route) >= 0;
  }
  function readHash() { return String(location.hash || '').replace(/^#\/?/, '').split(/[?&/]/)[0]; }
  function writeHash(route) {
    if (readHash() === route) return;
    try { history.replaceState(history.state, '', '#' + route); }
    catch (e) { try { location.hash = route; } catch (e2) { /* the screen still shows */ } }
  }

  function show(route) {
    if (!state.inApp || !App.data) return;
    if (!route || !allowed(route)) route = 'today';
    writeHash(route);
    App.route = route;
    drawChrome();
    drawScreen(false);
    emit('route');
  }

  App.screen = function (route, def) { screens[route] = def || {}; };
  App.go = function (route) { closeAll(function () { show(route); }); };

  /* ================= staying live ================= */

  var liveTimer = null;

  function syncNow() {
    if (state.syncing || !state.token || !state.inApp) return;
    state.syncing = true;
    send('sync').then(function (res) {
      state.syncing = false;
      if (res.ok || res.error.code === 'auth') return;
      state.fails++;            /* two in a row and the strip says so, until one works */
      drawStrip();
    });
  }
  function tick() {
    if (doc.visibilityState === 'hidden' || !state.inApp) return;
    runLive();
    emit('tick');
    syncNow();
  }
  function startLive() { if (!liveTimer) liveTimer = setInterval(tick, 20000); }
  function stopLive() { if (liveTimer) { clearInterval(liveTimer); liveTimer = null; } }

  /* ================= signing in and out ================= */

  function enterApp(route) {
    state.inApp = true;
    els.signin.hidden = true;
    els.app.hidden = false;
    tabsKey = '';
    show(route || readHash() || 'today');
    startLive();
  }

  function leaveApp() {
    state.inApp = false;
    stopLive();
    dropTo(0, false);
    clear(els.toasts);        /* nothing left over from whoever was signed in */
    els.app.hidden = true;
    els.signin.hidden = false;
    window.scrollTo(0, 0);
  }

  function forget() {
    state.token = null;
    state.fails = 0;
    App.data = null;
    storage.del('token');
    storage.del('snap');
    storage.del('at');
  }

  /* Sign out (or be signed out): forget this phone's token and saved data, show sign-in with the reason. */
  function signOut(message) {
    var token = state.token;
    if (token && !message) transport({ action: 'logout', token: token });   /* best effort; nothing waits on it */
    forget();
    showSignIn(message);
  }

  function logIn(name, pin, btn, errorEl) {
    if (state.signingIn) return;          /* one sign-in at a time, whichever button was tapped */
    state.signingIn = true;
    setBusy(btn, true, 'Signing in...');
    if (errorEl) errorEl.hidden = true;
    send('login', { name: name, pin: pin }).then(function (res) {
      state.signingIn = false;
      setBusy(btn, false);
      if (!res.ok || !res.result || !res.result.token || !App.data) {
        var msg = !res.ok && res.error.code !== 'network' ? res.error.message : 'Could not sign in. Check your signal and try again.';
        if (errorEl) { errorEl.textContent = msg; errorEl.hidden = false; }
        else App.toast(msg, { bad: true });
        return;
      }
      state.token = res.result.token;
      storage.set('token', state.token);
      enterApp('today');
    });
  }

  function showSignIn(message) {
    leaveApp();
    var body = clear(els.signinBody);

    if (App.mode === 'sample') {
      var quick = h('div', { class: 'btn-row' });
      RidgelineSample.PEOPLE.filter(function (p, i, all) {
        return all.map(function (x) { return x.role; }).indexOf(p.role) === i;   /* the first person of each role */
      }).forEach(function (p) {
        quick.appendChild(ui.button(ROLE_WORDS[p.role], { small: true, onTap: function (e, btn) { logIn(p.name, p.pin, btn, error); } }));
      });
      body.appendChild(h('div', { class: 'card' },
        h('div', { class: 'stack-xs' },
          h('p', { class: 'strong' }, 'Sample mode'),
          h('p', { class: 'muted small' }, 'This is made-up data so you can try everything. Sign straight in as:')),
        quick));
    }

    var name = ui.field({ label: 'Name', name: 'name', autocomplete: 'username', autocapitalize: 'words' });
    var pin = ui.field({ label: 'PIN', name: 'pin', type: 'password', inputmode: 'numeric', autocomplete: 'off', maxlength: 6 });
    name.input.setAttribute('autocorrect', 'off');
    name.input.setAttribute('spellcheck', 'false');
    var error = h('p', { class: 'form-error', role: 'alert', hidden: !message }, message || '');
    var btn = ui.button('Sign in', { kind: 'primary', block: true });
    btn.type = 'submit';
    body.appendChild(h('form', { class: 'signin-form', novalidate: true, onsubmit: function (e) {
      e.preventDefault();
      var n = name.val(), p = pin.val();
      if (!n) { name.setError('Type your name.'); name.input.focus(); return; }
      if (!/^\d{4,6}$/.test(p)) { pin.setError('Your PIN is 4 to 6 digits.'); pin.input.focus(); return; }
      logIn(n, p, btn, error);
    } },
      h('h1', { class: 'signin-title' }, 'Team sign in'), name, pin, btn, error,
      h('p', { class: 'hint' }, 'Forgot your PIN? Ask Grayson to reset it.')));
  }

  /* A signed-in phone with nothing saved to show yet: load first, with a way out if that fails. */
  function showLoading() {
    leaveApp();
    var body = clear(els.signinBody);
    body.appendChild(h('p', { class: 'muted' }, 'Loading...'));
    send('sync').then(function (res) {
      if (state.inApp || !state.token) return;
      if (res.ok && App.data) { enterApp(); return; }
      clear(body);
      body.appendChild(h('div', { class: 'stack' },
        h('p', { class: 'form-error', role: 'alert' }, 'Could not load. Check your signal and try again.'),
        ui.button('Try again', { kind: 'primary', block: true, onTap: showLoading }),
        ui.button('Sign in as someone else', { kind: 'text', onTap: function () { signOut(); } })));
    });
  }

  /* ================= Today ================= */

  function greeting() {
    var hr = new Date().getHours();
    return hr < 12 ? 'Good morning' : hr < 17 ? 'Good afternoon' : 'Good evening';
  }

  function renderToday(root) {
    var d = App.data, me = d.me, today = d.today;
    var todays = App.jobsOn(today);
    var overdue = d.jobs.filter(App.isOverdue).sort(byTime);
    var doneCount = todays.filter(function (j) { return j.status === 'done'; }).length;
    var next = todays.filter(function (j) { return j.status === 'scheduled'; })[0];
    var nextTime = next ? fmt.time(next.time).split(' ') : null;

    root.appendChild(h('header', { class: 'head' },
      h('p', { class: 'lead' }, greeting() + ', ' + fmt.first(me.name)),
      h('h1', { class: 'title' }, fmt.dayLong(today))));

    root.appendChild(ui.stats([
      { value: todays.length, label: 'Jobs today' },
      { value: doneCount, label: 'Done' },
      nextTime ? { value: nextTime[0], unit: nextTime[1], label: 'Next job' } : { value: '–', label: 'Next job', tone: 'mute' }
    ]));

    if (App.needsStandards()) {
      root.appendChild(h('div', { class: 'card remind' },
        h('img', { class: 'remind-photo', src: 'photo-standard.jpg', alt: '', onerror: function () { this.style.visibility = 'hidden'; } }),
        h('div', { class: 'remind-text' },
          h('p', { class: 'remind-title' }, 'Company standards'),
          h('p', { class: 'remind-sub' }, 'Read these before your next job.')),
        ui.button('Read', { kind: 'primary', small: true, onTap: function () { App.go('standards'); } })));
    }

    if (overdue.length) {
      root.appendChild(ui.label('Overdue', { tone: 'bad', count: overdue.length }));
      overdue.forEach(function (job) { root.appendChild(ui.jobCard(job)); });
      root.appendChild(ui.label('Today'));
    }
    todays.forEach(function (job) { root.appendChild(ui.jobCard(job)); });

    if (!todays.length) {
      if (me.role === 'rep') {
        root.appendChild(ui.empty({ title: 'Nothing scheduled today.', text: 'Made a sale? Enter it and book the appointment before you leave.',
          button: { label: 'New sale', kind: 'primary', onTap: function () { App.act('newSale', {}); } } }));
      } else if (me.role === 'owner') {
        root.appendChild(ui.empty({ title: 'Nothing scheduled today.', text: 'Open days in Calendar so your reps can book.',
          button: { label: 'Go to Calendar', onTap: function () { App.go('calendar'); } } }));
      } else {
        root.appendChild(ui.empty({ title: 'Nothing scheduled today.', text: 'New jobs show up here as soon as they are given to you.' }));
      }
    }
  }

  /* ================= Company standards ================= */

  function renderStandards(root) {
    var d = App.data, me = d.me, s = d.settings, sections = s.standards || [];

    var frame = h('div', { class: 'std-photo' },
      h('img', { src: 'photo-standard.jpg', alt: '', onerror: function () { this.hidden = true; } }),
      h('p', { class: 'std-photo-strip' }, 'A higher standard of clean'));
    root.appendChild(frame);
    root.appendChild(ui.title('Company standards', 'This is how we work on every job.'));

    if (!sections.length) root.appendChild(ui.empty({ title: 'No standards have been written yet.' }));
    sections.forEach(function (sec) {
      var list = h(sec.ordered ? 'ol' : 'ul', { class: 'std-list' });
      (sec.items || []).forEach(function (item, i) {
        list.appendChild(h('li', { class: 'std-item' },
          sec.ordered ? h('span', { class: 'std-num', 'aria-hidden': 'true' }, String(i + 1)) : h('span', { class: 'std-mark' }, icon('check', 18)),
          h('span', null, item)));
      });
      root.appendChild(h('section', { class: 'std-sec' }, ui.label(sec.title), list));
    });

    var foot = h('div', { class: 'std-foot' });
    if (me.role === 'owner') {
      var crew = App.people(['rep', 'tech']), read = crew.filter(App.hasRead).length;
      foot.appendChild(h('p', { class: 'muted' }, crew.length
        ? read + ' of ' + crew.length + ' have read these.'
        : 'Nobody else is on the team yet. Add your people from the menu at the top left.'));
      foot.appendChild(ui.button('Edit standards', { icon: 'edit', block: true, onTap: function () { App.act('editStandards'); } }));
    } else if (App.needsStandards()) {
      var error = h('p', { class: 'form-error', role: 'alert', hidden: true });
      if (me.standardsAckAt > 0 && s.standardsUpdatedAt) {
        foot.appendChild(h('p', { class: 'warn strong' }, 'Updated ' + fmt.date(s.standardsUpdatedAt) + '. Read them again and confirm.'));
      }
      foot.appendChild(ui.button('I have read these', { kind: 'primary', block: true, onTap: function (e, btn) {
        ui.save(btn, 'ackStandards', {}, { errorEl: error }).then(function (res) { if (res.ok) App.toast('Thanks. That is saved.'); });
      } }));
      foot.appendChild(error);
    } else {
      foot.appendChild(h('p', { class: 'std-ok' }, icon('check-circle', 20), h('span', null, 'You confirmed these on ' + fmt.date(me.standardsAckAt) + '.')));
    }
    root.appendChild(foot);
  }

  /* ================= the Me sheet and Change PIN ================= */

  function upToDateText() {
    if (App.mode === 'sample') return 'Sample data, saved on this phone only.';
    return state.okAt ? 'Up to date as of ' + fmt.clock(state.okAt) + '.' : 'Waiting for a connection.';
  }

  function openChangePin() {
    var cur = ui.field({ label: 'Current PIN', name: 'pin-now', type: 'password', inputmode: 'numeric', maxlength: 6 });
    var next = ui.field({ label: 'New PIN', name: 'pin-new', type: 'password', inputmode: 'numeric', maxlength: 6, hint: '4 to 6 digits. Pick one only you know.' });
    var again = ui.field({ label: 'New PIN again', name: 'pin-again', type: 'password', inputmode: 'numeric', maxlength: 6 });
    App.sheet.open({
      title: 'Change PIN',
      body: function (el) { el.appendChild(cur); el.appendChild(next); el.appendChild(again); },
      footer: { label: 'Save new PIN', onTap: function (sh) {
        var a = cur.val(), b = next.val(), c = again.val();
        if (!a) { cur.setError('Type the PIN you use now.'); sh.reveal(cur); return; }
        if (!/^\d{4,6}$/.test(b)) { next.setError('A PIN is 4 to 6 digits.'); sh.reveal(next); return; }
        if (b !== c) { again.setError('The two new PINs do not match.'); sh.reveal(again); return; }
        sh.send('changePin', { oldPin: a, newPin: b }).then(function (res) {
          if (!res.ok) return;
          sh.close();
          App.toast('Your PIN is changed.');
        });
      } }
    });
  }

  function resetSample() {
    App.confirm({
      title: 'Reset sample data?',
      text: 'Everything you changed in sample mode goes back to how it started.',
      yes: 'Reset', no: 'Keep it'
    }).then(function (yes) {
      if (!yes) return;
      var me = App.me(), person = null;
      RidgelineSample.PEOPLE.forEach(function (p) { if (me && p.name === me.name && p.role === me.role) person = p; });
      forget();
      startSample(true);
      if (!person) { showSignIn(); return; }
      leaveApp();
      clear(els.signinBody).appendChild(h('p', { class: 'muted' }, 'Loading...'));
      send('login', { name: person.name, pin: person.pin }).then(function (res) {
        if (!res.ok || !App.data) { showSignIn(); return; }
        state.token = res.result.token;
        storage.set('token', state.token);
        enterApp('today');
        App.toast('Sample data is back to the start.');
      });
    });
  }

  function openMe() {
    var liveLine = h('p', null, upToDateText());
    App.sheet.open({
      title: 'Your account',
      update: function () { liveLine.textContent = upToDateText(); },
      body: function (el, sh) {
        var me = App.me(), owner = me.role === 'owner';
        el.appendChild(h('div', { class: 'me-head' },
          h('span', { class: 'avatar avatar-lg' }, fmt.initials(me.name)),
          h('div', { class: 'stack-xs' }, h('p', { class: 'me-name' }, me.name), h('p', { class: 'muted' }, ROLE_WORDS[me.role] || ''))));

        var list = h('div', { class: 'list' });
        list.appendChild(ui.row({ icon: 'key', title: 'Change PIN', onTap: openChangePin }));
        list.appendChild(ui.row({ icon: 'standards', title: 'Company standards',
          right: App.needsStandards() ? ui.pill('Read these', 'warn') : null,
          onTap: function () { App.go('standards'); } }));
        if (owner) {
          var unread = (App.data.notices || []).filter(function (n) { return n.at > (me.noticesSeenAt || 0); }).length;
          list.appendChild(ui.row({ icon: 'team', title: 'Team', onTap: function () { App.act('openTeam'); } }));
          list.appendChild(ui.row({ icon: 'settings', title: 'Settings', onTap: function () { App.act('openSettings'); } }));
          list.appendChild(ui.row({ icon: 'bell', title: 'Notifications', right: unread ? ui.pill(unread + ' new', 'ice') : null, onTap: function () { App.act('openNotices'); } }));
        }
        list.appendChild(ui.row({ icon: 'shirt', title: 'Uniforms', right: ui.pill('Coming soon', 'mute'), cls: 'is-off' }));
        if (App.mode === 'sample') list.appendChild(ui.row({ icon: 'reset', title: 'Reset sample data', chevron: false, onTap: resetSample }));
        list.appendChild(ui.row({ icon: 'signout', title: 'Sign out', chevron: false, onTap: function () { signOut(); } }));
        el.appendChild(list);

        el.appendChild(h('div', { class: 'me-foot' }, h('p', null, 'Ridgeline Wash Co. A higher standard of clean.'), liveLine));
      }
    });
  }

  /* ================= start ================= */

  /* The logo is on the page twice and each copy carries the same gradient id: give each its own. */
  function fixLogoIds() {
    Array.prototype.forEach.call(doc.querySelectorAll('.topbar-logo svg, .signin-logo svg'), function (svg, n) {
      Array.prototype.forEach.call(svg.querySelectorAll('[id]'), function (node) {
        var old = node.id, fresh = old + '-' + (n + 1);
        node.id = fresh;
        Array.prototype.forEach.call(svg.querySelectorAll('[fill="url(#' + old + ')"]'), function (user) { user.setAttribute('fill', 'url(#' + fresh + ')'); });
        Array.prototype.forEach.call(svg.querySelectorAll('[stroke="url(#' + old + ')"]'), function (user) { user.setAttribute('stroke', 'url(#' + fresh + ')'); });
      });
    });
  }

  function start() {
    ['app', 'signin', 'layers', 'toasts', 'screen', 'tabs', 'strip'].forEach(function (id) { els[id] = doc.getElementById(id); });
    els.signinBody = doc.getElementById('signin-body');
    els.stripText = doc.getElementById('strip-text');
    els.meBtn = doc.getElementById('me-btn');
    els.bell = doc.getElementById('bell-btn');
    if (!els.app || !els.signin) return;
    fixLogoIds();
    els.bell.appendChild(icon('bell'));
    els.meBtn.addEventListener('click', openMe);
    els.bell.addEventListener('click', function () { App.act('openNotices'); });

    pickMode();
    var fresh = App.mode === 'sample' ? startSample(false) : false;

    if (window.visualViewport) {
      window.visualViewport.addEventListener('resize', fitLayers);
      window.visualViewport.addEventListener('scroll', fitLayers);
      fitLayers();
    }
    window.addEventListener('popstate', onPopState);
    window.addEventListener('hashchange', function () { if (state.inApp && readHash() !== App.route) show(readHash()); });
    window.addEventListener('online', syncNow);
    window.addEventListener('pageshow', function (e) { if (e.persisted) syncNow(); });
    doc.addEventListener('visibilitychange', function () { if (doc.visibilityState !== 'hidden') syncNow(); });
    doc.addEventListener('keydown', function (e) {
      if (e.key !== 'Escape' || !layers.length) return;
      e.preventDefault();
      dropTo(layers.length - 1, false);
    });

    state.token = storage.get('token');
    var snap = storage.json('snap');
    if (state.token && fresh) {
      /* The sample starts over each day (or after its saved copy is lost), so yesterday's sign-in no longer exists. */
      forget();
      snap = null;
    }
    if (state.token && snap && snap.me && Array.isArray(snap.jobs) && snap.settings) {
      App.data = snap;
      state.okAt = +storage.get('at') || 0;
      enterApp();        /* open at once on what this phone last knew... */
      syncNow();         /* ...then catch up */
    } else if (state.token) showLoading();
    else showSignIn();
  }

  App.screen('today', { title: 'Today', render: renderToday });
  App.screen('standards', { title: 'Company standards', render: renderStandards });

  if (doc.readyState === 'loading') doc.addEventListener('DOMContentLoaded', start);
  else setTimeout(start, 0);

  window.App = App;
  return App;
})();
