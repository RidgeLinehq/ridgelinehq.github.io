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
 *   App.screen(route, { roles, title, render(root), update(root) })   register a screen. `roles` omitted = everyone.
 *       App.screen('sales', { roles: ['owner', 'rep'], title: 'Sales', render: function (root) { root.appendChild(App.ui.title('Sales')); } });
 *       `root` is emptied before every render and stacks its children with a 16px gap. Keep your own
 *       view state (filters, the month shown) in variables in your file and render from them: render
 *       runs again whenever the data changes. Scroll position is kept, and so is any text typed
 *       into an input that has a `name` (give App.ui.field a name: App.ui.field({ name: 'find' })).
 *       A screen with a box people type in while data arrives (Clients and its search) also gives `update`:
 *       it is called instead of render when new data arrives, redraws only what is under the box (the box
 *       never leaves the page, so the keyboard stays up), and answers false when the whole screen must be built again.
 *   App.go(route)                 switch screen (closes any open sheet first).      App.go('calendar');
 *   App.route                     the current route name, for example 'today'.
 *   App.actions                   cross-screen entry points. Register yours:        App.actions.openClient = function (id) { ... };
 *       Names in use: newSale({date, clientId}), openSale(saleId), openClient(id), bookVisit(clientId),
 *       openTeam(), openSettings(), openNotices(), editStandards().
 *   App.act(name, arg)            call one by name.                                 App.act('newSale', { date: '2026-11-19' });
 *
 * THE DATA (always the latest answer from the system; never keep your own copy)
 *   App.data                      the snapshot from brief-product.md: me, team, settings, days, taken, clients, sales, jobs, board, notices, problems.
 *                                 A tech's settings hold only businessName, standards and standardsUpdatedAt (no rates, no services).
 *   App.mode                      'sample' or 'live'.                               if (App.mode === 'sample') ...
 *                                 Sample mode is ONLY for config.js saying "" (empty). If config.js did not load, or holds
 *                                 something that is not an https:// address, the page shows a plain message instead and no
 *                                 screen ever runs (App.mode is then 'off').
 *   App.me()                      who is signed in: { id, name, role, ... }.        App.me().name
 *   App.role()                    'owner' | 'rep' | 'tech'.                         if (App.role() === 'owner') ...
 *   App.today()                   the business day, 'YYYY-MM-DD' (from the system, not the phone).
 *   App.member(id)                a team member or null.                            App.member(sale.repId)
 *   App.nameOf(id, fallback)      a team member's name.                             App.nameOf(job.assignedTo, 'Unassigned')
 *   App.people(roles)             active team members, optionally only some roles.  App.people(['rep'])
 *   App.ownerName()               the owner's first name, for words like "Ask Grayson".
 *   App.client(id), App.job(id), App.sale(id)        find one thing in the data, or null.
 *   App.jobsOn(date)              that day's jobs you can see (not cancelled), in time order.
 *   App.isOverdue(job)            still scheduled and its day has passed.
 *   App.dayOf(date)               the owner's setting for a day: { date, open, slots } or null (not listed = blocked).
 *   App.freeSlots(date)           the times still free that day.                    App.freeSlots('2026-11-19') -> ['09:30', '14:00']
 *                                 Which of today's times have passed goes by the system's clock (it comes with every answer), not the phone's.
 *   App.freeDays()                every day from today on that still has a free time, in order.
 *   App.needsStandards()          true while I still have to confirm the company standards.
 *   App.hasRead(member)           has this person confirmed the current standards (owner's view of the team).
 *
 * TALKING TO THE SYSTEM
 *   Three rules hold for every save: nothing fails silently, nothing is saved twice, and nothing is shown as saved
 *   that is not. sheet.send and App.ui.save keep all three for you; use them, not App.api.send, for anything a
 *   person saves.
 *   sheet.send(action, fields, opts) -> Promise of the answer. A save from a sheet (see SHEETS):
 *       - the button says "Saving...", the sheet's body is inert, and new data does not redraw the sheet until
 *         the answer is in. A second tap does nothing (it answers { ok: false, skipped: true });
 *       - a failure is said in red by the button. If the sheet was closed meanwhile, it is a red toast that stays
 *         until it is tapped, with Retry (the same action, fields and id);
 *       - no answer at all (error.code 'network') may still have saved. So the id of that try is kept, and every
 *         later try from that sheet goes out under it, WHATEVER was changed since, until the system answers. The
 *         system answers the same fields from memory (ok, replay: true) and refuses changed ones with
 *         'already_saved': the sheet then closes and the system's words stay on screen until tapped ("Your first
 *         try was saved. Check it, then make the change again if you still need to."). So never skip a save
 *         because "nothing was changed" while sheet.unanswered(action, fields, attempt) is true: send it.
 *       opts: { button, busyText, attempt, saved, landed, onLanded, stays }
 *         attempt   names what is being attempted when one sheet could save different things with the same action
 *                   ('link', 'commission'). The footer button's default is 'form'. A row of a pick-list (opts.button)
 *                   always sends the same fields, so it has none: its id goes with its fields.
 *         saved     the words for "it is saved" (or a function(res)): used when the save succeeds later, from Retry.
 *         landed    function -> true when the data shows this very save (the job is at that time, the note is there).
 *                   A try that got no answer and then lands is finished as saved: the sheet closes with `saved`
 *                   (or opts.onLanded() runs instead), and its id is done with.
 *         stays     the sheet handles 'already_saved' itself (Add person).
 *       sh.send('addNote', { kind: kind, id: id, text: text }, { saved: 'Note saved.' }).then(function (res) { if (res.ok) ... });
 *   App.ui.save(button, action, fields, opts) -> the same for a button that is not a sheet's footer (on a screen, or
 *       in a sheet's body). The screen (or sheet) under it is not redrawn while it saves. The message goes to
 *       opts.errorEl; if a redraw takes that line away, or there is none, it is the red toast that stays.
 *       button may be null for a one-tap control that has already flipped (pass opts.sheet): after 0.6 s a
 *       "Saving..." line shows, and on failure you put the control back.
 *       opts: { errorEl, sheet, busyText, attempt, saved, landed, onLanded, keeps (you keep the message across redraws) }
 *       App.ui.save(btn, 'updateJob', { jobId: id, patch: { status: 'cancelled' } }, { errorEl: err, saved: 'Job cancelled.' });
 *   App.api.send(action, fields, opts) -> Promise of the answer { ok, result, error: { code, message }, opId, replay }.
 *       The bare call: adds token, since, day and an opId (opts.opId, or a fresh one); applies the returned data
 *       (which re-renders); never rejects. A failed call (no signal, time-out, not our JSON) answers
 *       { ok: false, error: { code: 'network', message } }. opts.onAnswer(res) runs when the system answers, before
 *       its data is applied. Use it for reading ('sync') and for a flow that keeps its own id (New sale).
 *       error.message is already plain words for the team: show it as it is. The codes worth a branch are
 *       'slot_taken' / 'slot_closed' (the time is gone: picker.setError(res.error.message)), 'already_saved' and
 *       'network'. An 'auth' answer signs the phone out and shows sign-in by itself.
 *
 * RE-RENDERING WHEN DATA CHANGES
 *   App.refresh()                 re-render the current screen and tell open sheets and live pieces. Call it after
 *                                 you change your own view state.                   filter = 'Active'; App.refresh();
 *   App.on(event, fn) -> off()    'data' (new data applied), 'route' (screen changed), 'tick' (every 20 seconds),
 *                                 'signout' (this person is leaving this phone: they tapped Sign out, the system ended their
 *                                 sign-in, or the sample data is being reset). It runs BEFORE anything is cleared, so App.me()
 *                                 and App.data still answer: clear what you keep on the phone for this person here.
 *                                 fn gets { chosen, removed }: chosen is true for a tap on Sign out or a sample reset;
 *                                 removed is true when the system said this person is no longer on the team. With both
 *                                 false the same person can sign back in (their PIN was reset, the sign-in ran out).
 *       App.on('signout', function (why) { if (why.chosen || why.removed) forgetDraftOf(App.me().id); });
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
 *     sheet.send(action, fields, opts)       save from the footer button (see TALKING TO THE SYSTEM): "Saving...", an inert
 *                                            body, the message by the button, one id per attempt, resolves with the answer.
 *     sheet.unanswered(action, fields, attempt)   true while an earlier try of that save from here has had no answer
 *     sheet.isOpen()                         false once it has been closed (an answer can arrive after that)
 *     sheet.hold() -> release()              for a sheet that saves through App.api.send itself: until release() is
 *                                            called the body is inert and new data does not redraw the sheet
 *     sheet.rebuild()                        run `body` again, keeping the scroll position
 *     sheet.reveal(el)                       scroll the body to an element (the first missing field)
 *     sheet.close()                          close it (and anything opened on top of it)
 *   App.toast(text, opts) -> remove()    a short message. opts: { bad: true, retry: fn, action: { label, onTap }, ms, sticky, hold }.
 *       It sits just above the tab bar. While a sheet is open it appears at the top instead, just under the
 *       sheet's header (just above a short sheet when there is room), so it never covers the sheet's button,
 *       the words by it, or the thing it confirms. Do not toast what the screen already shows in the same spot.
 *       sticky: it stays until its button is tapped (Retry, your action, or OK): for a failure that has nowhere
 *       else to be said. hold: it stays, with no button, until you call remove() ("Saving...").
 *       App.toast('Sale saved.');     App.toast(res.error.message, { bad: true, sticky: true });
 *   App.confirm({ title, text, yes, no, danger }) -> Promise of true or false. In-page, never the browser's own.
 *       App.confirm({ title: 'Delete this client?', text: 'Their sales and jobs go too.', yes: 'Delete client', danger: true }).then(function (ok) { ... });
 *
 * BUILDING THINGS (text from people is always safe: strings become text nodes, never HTML; nothing here builds HTML from text)
 *   Classes for everything (cards, lists, rows, label-value rows, stat blocks, pills, buttons, fields, chips,
 *   callouts, legends) are in app.css, each with a comment naming it; its index is at the top of that file.
 *   Inside a sheet (which is slate already) a .card turns into a darker well by itself.
 *   App.h(tag, attrs, ...children) -> element. attrs: class, text, on<event>, anything else is an attribute.
 *       App.h('p', { class: 'muted' }, 'Sold by ', App.h('b', null, name))
 *   App.icon(name, size) -> <svg> Names: today (a clipboard with a check) sales calendar clients dashboard leaders schedule standards bell close
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
 *   App.ui.chips({ options: [{ value, label, count }], value, scroll, onChange }) -> el with el.get(), el.set(v), el.setOptions(list)
 *       Pick one. scroll: one line that slides sideways.
 *       App.ui.chips({ options: [{ value: '', label: 'All', count: 9 }, { value: 'New', label: 'New', count: 3 }], value: '', scroll: true, onChange: fn })
 *   App.ui.toggle({ label, hint, checked, onChange }) -> el with el.get(), el.set(bool)
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
 *       lead, title, sub, right: text or elements. sub may be a list of lines. cls: 'is-you' (my row in a ranking), 'row-clip' (one line each), 'is-off'.
 *       App.ui.row({ title: c.name, sub: 'Window cleaning, $150.00 a month', right: App.ui.clientPill(c.status), onTap: function () { App.act('openClient', c.id); } })
 *   App.ui.kv(label, value)       one label-value row; put them in App.h('div', { class: 'kvs' }). value: text or an element.
 *   App.ui.stats([{ value, unit, label, tone }])     the slim summary card of numbers side by side.
 *   App.ui.empty({ title, text, button: { label, onTap, kind } })     an empty state with one next step.
 *   App.ui.notes(list)            note history, newest first (who, when, text).
 *   App.ui.jobCard(job, { showDate, primary })    the full job card with its actions (Call, Directions, Add note, Mark done).
 *       Its "Mark done" is the quiet style unless primary: true. A screen has ONE ice button: Today gives it to the first job still to do.
 *   App.ui.openJob(jobId)         open the Job sheet (details, notes, and for the owner assign, move, change, cancel).
 *
 * REPEATED PIECES: each is built ONE way, here. Use these, do not build a look-alike in your own file.
 *   A list row                    App.ui.row (above), inside App.h('div', { class: 'list' }).
 *   A compact job row             App.ui.jobRow(job, { showDate, title, sub, pill }) -> a row (time, client, what, address) that opens the Job sheet.
 *       showDate: the day above the time. title: replaces the client's name (inside that client's own sheet, pass what is being done).
 *       sub: replaces the lines under the title (text, an element, or a list of them). pill: false hides the status pill
 *       (pass it in a list whose label already says the status, like "Recently done"). Nothing in the row is ever cut off:
 *       long text wraps and the pill stays top right.
 *       list.appendChild(App.ui.jobRow(job, { showDate: true }));
 *   A "Coming up" list            App.ui.comingUp(jobs, { empty, who }) -> a .list of job rows with their day, or the `empty` words when there are none.
 *       You choose and sort the jobs. who: true adds who each job is given to (an amber "Unassigned" when nobody is); it is on for
 *       the owner and off for everyone else unless you say.
 *       root.appendChild(App.ui.label('Coming up', { count: jobs.length || null }));
 *       root.appendChild(App.ui.comingUp(jobs, { empty: 'Nothing is booked for the next 14 days.' }));
 *   Choosing a person, or nobody  App.ui.nobodyRow({ sub, selected, onTap(e, rowEl) }) -> the "Nobody" row. Always the FIRST row of the list.
 *                                 App.ui.personRow(member, { sub, selected, onTap(e, rowEl) }) -> initials, name, role in words, a check when selected.
 *       list.appendChild(App.ui.nobodyRow({ sub: 'You assign each job yourself', selected: !cur, onTap: function (e, rowEl) { pick(null, '', rowEl); } }));
 *       people.forEach(function (m) { list.appendChild(App.ui.personRow(m, { selected: cur === m.id, onTap: function (e, rowEl) { pick(m.id, m.name, rowEl); } })); });
 *   Pick one of a few             App.ui.chips (above); two to four fixed choices: App.ui.segmented.
 *   Adding a note                 App.ui.addNote(kind, id) -> opens the small "Add note" sheet and saves it. kind: 'job' | 'client'.
 *       The only way a note is added anywhere: a button that calls it, never a text box of your own.
 *       App.ui.button('Add note', { icon: 'note', small: true, onTap: function () { App.ui.addNote('client', c.id); } })
 *   Saving                        sheet.send / App.ui.save (above): "Saving...", the message by the button, a safe retry.
 *   Mark done and Undo            only through the job card and the Job sheet (App.ui.jobCard, App.ui.openJob): the card says
 *                                 "Saving..." until the system has it, and carries a red line that stays if it could not be saved.
 *   Asking first                  App.confirm (above).
 *   The saved moment              App.ui.savedHead(text) -> the big check and the heading ("Sale saved", "Person added") that
 *                                 open a "saved: do another or finish" view. Under it: what was saved, one quiet button for
 *                                 "do another", and Done as the sheet's footer button.
 *       el.appendChild(App.ui.savedHead('Sale saved'));
 *   Not here yet: "Add a time" (a day's sheet and Settings each build it, the same way) has no shared helper in this file.
 *   App.ui.monthGrid({ month, min, max, day(date), onPick(date), onMonth(ym) }) -> el with el.refresh(), el.setMonth(ym), el.getMonth()
 *       A month of days, Sunday first, with arrows. For each day your `day(date)` returns
 *       { state: 'open' | 'full' | 'blocked' | 'past', label: '3 left', disabled: bool, selected: bool }.
 *       Keep the month yourself across renders: pass `month` ('YYYY-MM') and listen to onMonth.
 *   App.ui.slotPicker({ value, date, emptyText, onChange(value) }) -> el with el.get(), el.set({date, time} or null), el.getDay(), el.setError(message), el.refresh()
 *       Month grid plus the free times of the chosen day. Updates itself when someone else takes a time.
 *       el.get() is { date, time } once a time is chosen, otherwise null. el.getDay() is the day on show.
 *       var when = App.ui.slotPicker({ date: '2026-11-19', onChange: function (v) { sheet.setButton(v ? 'Save sale and book ' + App.fmt.when(v.date, v.time) : 'Save sale'); } });
 *
 * FORMATTERS (App.fmt)
 *   money(cents) '$150.00'      moneyShort(cents) '$150'        toCents('150.50') 15050 (null when it is not a price)
 *   day(date) 'Thu, Nov 19'     dayLong(date) 'Thursday, November 19'     dayShort(date) 'Nov 19'     month('2026-11') 'November 2026'
 *   dayHead(date) 'Thursday, Nov 19' (a screen title: the full weekday with the short month always fits on one line)
 *   time('09:30') '9:30 AM'     when(date, time) 'Thu, Nov 19 at 9:30 AM'
 *   clock(ms) '2:14 PM'         date(ms) 'Nov 17'               stamp(ms) 'Nov 17, 2:14 PM'           ago(ms) '5 min ago'
 *   plural(2, 'sale') '2 sales' initials('Grayson Jones') 'GJ'  first('Grayson Jones') 'Grayson'
 *   tel(phone) 'tel:6155550142' maps(address) the Google Maps directions link
 * ===================================================================================
 */
var App = (function () {
  'use strict';

  var Core = RidgelineCore, D = Core.dates, doc = document;
  var App = { mode: 'sample', backend: '', data: null, route: '', actions: {}, ui: {}, fmt: {}, api: {}, sheet: {} };
  var ui = App.ui, fmt = App.fmt;

  /* fails: background refreshes that failed in a row. failKind: 'offline' (no answer at all) or 'error' (the system answered, but not with our data).
     heard: the system has answered since this page was opened. stale: the page opened on a saved copy from another day.
     clock: the system's own clock as of its last answer (see businessHM). gen: goes up each time the phone forgets who was signed in. */
  var state = { token: null, inApp: false, okAt: 0, fails: 0, failKind: '', syncing: false, signingIn: false,
    heard: false, stale: false, clock: null, gen: 0, cantKeep: false, toldKeep: false };
  var els = {};
  var screens = Object.create(null);      /* no built-in names: #constructor or #toString is never a screen */
  var own = Object.prototype.hasOwnProperty;

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
  var REMOVED_RE = /no longer on the team/i;      /* the system's words to a phone whose person was removed (see core.js, "Signed out") */
  var CANNOT_KEEP = 'This phone cannot save your sign-in. You will need to sign in again next time.';
  var CANNOT_REACH = 'Cannot reach the team system. Check your signal and try again. If your signal is fine, tell Grayson.';
  var PIN_RE = /^\d{6}$/;                 /* every PIN is exactly 6 digits */

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
  function clear(el) { el.textContent = ''; return el; }

  App.h = h;

  /* ================= icons: one small set of line icons (24px box, stroke 1.75, round caps) ================= */

  var ICONS = {
    today: '<rect x="5" y="4.5" width="14" height="17" rx="2.2"/><path d="M9 4.5v-1.2a.8.8 0 0 1 .8-.8h4.4a.8.8 0 0 1 .8.8v1.2"/><path d="M8.8 13.3l2.3 2.3 4.1-4.4"/>',
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
  /* A screen title: the full weekday with the short month ("Wednesday, Nov 18") fits one line on the narrowest phone. */
  fmt.dayHead = function (date) {
    if (!D.isDay(date)) return '';
    return DAYS[D.weekday(date)] + ', ' + fmt.dayShort(date);
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

  /* What config.js says decides the mode, and nothing else does:
       ""                      sample mode: made-up data on this phone
       an https:// address     the real thing
       nothing at all          config.js did not load. Say so and offer Reload.
       anything else           it is not connected properly. Say so.
     The last two never fall back to sample data: on the real site that would show the team a made-up
     system that lets anyone in as the owner. */
  var stopped = '';      /* '' (running), 'load' (config.js did not load) or 'config' (not an https:// address) */

  function backendUrl(raw, dev) {
    if (typeof raw !== 'string') return '';
    var s = raw.trim(), u = null;
    if (!s || /\s/.test(s)) return '';
    try { u = new URL(s); } catch (e) { return ''; }
    if (!u.hostname || !(u.protocol === 'https:' || (dev && u.protocol === 'http:'))) return '';
    return s;
  }

  function pickMode() {
    var raw = window.RIDGELINE_BACKEND;
    var host = location.hostname;
    var dev = location.protocol === 'file:' || host === 'localhost' || host === '127.0.0.1';
    if (dev) {   /* test overrides, honored nowhere else */
      var q = null;
      try { q = new URLSearchParams(location.search); } catch (e) { /* no query support */ }
      if (q && q.get('sample') === '1') raw = '';
      else if (q && q.get('backend')) raw = q.get('backend');
    }
    var url = raw === '' || raw === undefined ? '' : backendUrl(raw, dev);
    stopped = raw === '' || url ? '' : raw === undefined ? 'load' : 'config';
    App.backend = url;
    App.mode = stopped ? 'off' : url ? 'live' : 'sample';
    storage.prefix = 'ridgeline.' + App.mode + '.';
  }

  /* The page cannot start: one plain message where sign-in would be. Nothing is read, saved or sent. */
  function showStopped() {
    els.app.hidden = true;
    els.signin.hidden = false;
    var load = stopped === 'load';
    clear(els.signinBody).appendChild(h('div', { class: 'stop' },
      h('p', { class: 'stop-text', role: 'alert' }, load
        ? 'This page did not load all the way. Check your signal, then reload.'
        : 'The team system is not connected yet. Tell Grayson.'),
      ui.button('Reload', { kind: load ? 'primary' : 'quiet', block: true, onTap: function () { location.reload(); } })));
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

  function saveSample() {
    if (!storage.set('db', JSON.stringify({ day: sample.day, dump: sample.store.dump() }))) cannotKeep();
  }

  /* A call ends one of three ways: our answer; NOT_OURS (something answered, but not with our data: an
     error page, a crash); or null (nothing answered at all: no signal, or it took too long). */
  var NOT_OURS = { notOurs: true };

  function callSample(req) {
    return new Promise(function (resolve) {
      setTimeout(function () {
        var res = NOT_OURS;
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
          finish(isAnswer(res) ? res : NOT_OURS);
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

  /* Every save carries an id (opId). The system remembers a saved id together with what was sent: the same
     id with the same fields again is answered from memory and saves nothing more; the same id with different
     fields is refused with 'already_saved', because the first try did save. So a caller that got NO answer
     (code 'network') passes the same id on every later try of that thing, whatever was changed since, until
     the system answers. See save() below, which does this for every sheet and button. */
  function send(action, fields, opts) {
    opts = opts || {};
    var req = { action: action }, k;
    for (k in fields || {}) if (Object.prototype.hasOwnProperty.call(fields, k)) req[k] = fields[k];
    if (action !== 'login') {
      req.token = state.token;
      if (App.data) { req.since = App.data.rev; req.day = App.data.today; }
      if (action !== 'sync' && action !== 'logout') req.opId = opts.opId || newId();
    }
    return attempt(req, 0).then(function (res) { return settle(req, res, opts); });
  }

  function settle(req, res, opts) {
    /* `reached` tells "the system answered with something else" from "nothing answered": the strip words differ. */
    if (!isAnswer(res)) return { ok: false, error: { code: 'network', message: NO_SIGNAL, reached: res === NOT_OURS }, opId: req.opId };
    /* The caller hears that the system answered BEFORE the data that came with the answer is applied, so what
       it was keeping for an unanswered try (see save and setDone) is out of the way when the screen is drawn. */
    if (opts && opts.onAnswer) { try { opts.onAnswer(res); } catch (e) { report(e); } }
    var mine = req.action === 'login' || (!!state.token && req.token === state.token);
    if (mine) {
      if (res.ok || res.sync) state.okAt = Date.now();
      /* An answer from a working system means the connection is back (a "server" answer is not that). */
      if (res.ok || res.error.code !== 'server') {
        var was = state.fails || !state.heard;
        state.fails = 0;
        state.heard = true;
        if (was) drawStrip();
      }
      /* A new sign-in: this phone is that person's from here on, and so is the copy of the data kept on it. */
      if (req.action === 'login' && res.ok && res.result && res.result.token && res.sync && res.sync.me) {
        state.token = String(res.result.token);
        var kept = storage.set('who', String(res.sync.me.id));
        if (!storage.set('token', state.token) || !kept) cannotKeep();
      }
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
    /* The system's clock comes with every answer. What is kept is how far this phone's clock is from it. */
    if (typeof sync.nowMs === 'number' && Core.dates.isHM(sync.nowHM)) state.clock = { hm: sync.nowHM, ms: sync.nowMs, off: sync.nowMs - Date.now() };
    if (sync.same) {
      if (holdsSignIn()) storage.set('at', String(state.okAt));
      return;
    }
    if (!sync.me || !Array.isArray(sync.jobs) || !sync.settings) return;   /* not a snapshot we understand */
    var cur = App.data;
    if (cur && cur.me.id === sync.me.id && cur.today === sync.today && sync.rev < cur.rev) return;   /* an older answer that arrived late */
    App.data = sync;
    keepSnapshot(sync);        /* what the system said, before any unsaved one-tap change is laid over it */
    staleTries();
    layMarks();
    changed();
  }

  /* The copy of the data kept on the phone belongs to one person: whoever signed in on it last. It is
     stored with that person's id ('who'), only by the tab that holds the phone's sign-in (a tab still
     running as someone else never writes over it), and at start-up a copy that is not that person's is
     ignored (see start). */
  function holdsSignIn() { return !!state.token && storage.get('token') === state.token; }
  function keepSnapshot(sync) {
    if (!holdsSignIn()) return;
    storage.set('who', String(sync.me.id));
    /* A copy that cannot be saved (the phone is full) takes the old one with it: an old copy is never shown as the latest. */
    if (!storage.set('snap', JSON.stringify(sync))) { storage.del('snap'); storage.del('at'); return; }
    storage.set('at', String(state.okAt));
  }

  /* The phone cannot keep the sign-in (its storage is full or blocked). Said once, when the person is in the app. */
  function cannotKeep() {
    state.cantKeep = true;
    if (state.inApp) tellCannotKeep();
  }
  function tellCannotKeep() {
    if (!state.cantKeep || state.toldKeep || !els.toasts) return;
    state.toldKeep = true;
    App.toast(CANNOT_KEEP + (App.mode === 'sample' ? ' The sample data will start over too.' : ''), { sticky: true });
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
  function emit(name, detail) {
    (listeners[name] || []).slice().forEach(function (fn) { try { fn(detail); } catch (e) { report(e); } });
  }
  function onPage(el) { return el.isConnected !== undefined ? el.isConnected : doc.documentElement.contains(el); }

  App.live = function (el, fn) { liveItems.push({ el: el, fn: fn, misses: 0 }); };
  function runLive() {
    liveItems = liveItems.filter(function (item) {
      if (!onPage(item.el)) return ++item.misses < 6;   /* gone from the page for a while: forget it */
      item.misses = 0;
      var scope = heldScope(item.el);
      if (scope) { scope.dirty = true; return true; }   /* its sheet or screen is saving: it is drawn when that is over */
      try { item.fn(); } catch (e) { report(e); }
      return true;
    });
  }

  /* ----- nothing is redrawn under a save -----
     While a save is on its way, the sheet it was sent from (or the screen, for a button on the screen) is
     held: new data does not redraw it, so the button that says "Saving..." and the line its message goes to
     are still there when the answer comes. A held sheet's body is also inert: nothing in it can be typed
     or tapped. What was missed is drawn once, when the save is over. */
  var SCREEN = { holds: 0, dirty: false };

  function heldScope(el) {
    if (SCREEN.holds && els.screen && els.screen.contains(el)) return SCREEN;
    for (var i = 0; i < layers.length; i++) if (layers[i].holds && layers[i].wrap.contains(el)) return layers[i];
    return null;
  }
  function sheetOf(el) {
    if (!el) return null;
    for (var i = 0; i < layers.length; i++) if (layers[i].kind === 'sheet' && layers[i].el.contains(el)) return layers[i];
    return null;
  }
  function setInert(sh, on) {
    sh.body.classList.toggle('is-saving', on);
    if (on) {
      sh.body.setAttribute('inert', '');
      sh.body.setAttribute('aria-busy', 'true');
      if (sh.body.contains(doc.activeElement)) { try { doc.activeElement.blur(); } catch (e) { /* fine */ } }
    } else {
      sh.body.removeAttribute('inert');
      sh.body.removeAttribute('aria-busy');
    }
  }
  /* Hold a sheet (or SCREEN) until the function this returns is called. */
  function hold(scope) {
    if (!scope) return function () {};
    var over = false;
    scope.holds = (scope.holds || 0) + 1;
    if (scope.body) setInert(scope, true);
    return function () {
      if (over) return;
      over = true;
      scope.holds--;
      if (scope.holds > 0) return;
      if (scope.body) setInert(scope, false);
      if (!scope.dirty) return;
      scope.dirty = false;
      if (!state.inApp || !App.data) return;
      if (scope === SCREEN) drawScreen(true);
      else if (layers.indexOf(scope) >= 0 && scope.update) { try { scope.update(); } catch (e) { report(e); } }
      runLive();
      sweepStanding();
    };
  }

  /* New data (or a view change): redraw the chrome and the screen, then tell open sheets and live pieces. */
  function changed() {
    if (!state.inApp || !App.data) return;
    checkLanded();
    drawChrome();
    if (SCREEN.holds) SCREEN.dirty = true; else drawScreen(true);
    layers.slice().forEach(function (layer) {
      if (layers.indexOf(layer) < 0 || !layer.update) return;
      if (layer.holds) { layer.dirty = true; return; }
      try { layer.update(); } catch (e) { report(e); }
    });
    runLive();
    sweepStanding();
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
  App.ownerName = function () {
    var owner = App.people(['owner'])[0];
    return owner ? fmt.first(owner.name) || 'the owner' : 'the owner';
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

  /* The time right now in the business's zone, 'HH:MM'. It is the system's clock, not the phone's: every
     answer says what time the system makes it (nowHM, nowMs), and the phone only counts on from there. A
     phone whose clock is hours out still shows the right times as passed. Until the system has answered
     once (the page just opened with no signal) it is this phone's own clock, read in the business's zone. */
  var zoneClock = null, zoneDay = null;
  function businessHM() {
    var c = state.clock;
    if (c) {
      var gone = (Date.now() + c.off) - c.ms;             /* how long ago the system said so, by its own clock */
      var mins = (+c.hm.slice(0, 2)) * 60 + (+c.hm.slice(3, 5)) + Math.floor(((c.ms % 60000) + gone) / 60000);
      mins = ((mins % 1440) + 1440) % 1440;
      return pad2(Math.floor(mins / 60)) + ':' + pad2(mins % 60);
    }
    if (App.mode === 'sample') return localHM(Date.now());
    try {
      zoneClock = zoneClock || new Intl.DateTimeFormat('en-GB', { timeZone: 'America/Chicago', hour: '2-digit', minute: '2-digit', hour12: false });
      var s = zoneClock.format(new Date());
      if (/^\d{2}:\d{2}$/.test(s)) return s === '24:00' ? '00:00' : s;
    } catch (e) { /* fall through to the phone's clock */ }
    return localHM(Date.now());
  }

  /* The business day by this phone's clock: only used when the page opens, to tell that the saved copy is from another day. */
  function businessDay() {
    if (App.mode === 'sample') return localDay(Date.now());
    try {
      zoneDay = zoneDay || new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Chicago', year: 'numeric', month: '2-digit', day: '2-digit' });
      var s = zoneDay.format(new Date());
      if (D.isDay(s)) return s;
    } catch (e) { /* fall through to the phone's own day */ }
    return localDay(Date.now());
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
    var fn = own.call(App.actions, name) ? App.actions[name] : null;
    try {
      if (typeof fn !== 'function') throw new Error('No action called ' + name);
      fn(arg);
    } catch (e) {
      report(e);
      App.toast('That could not be opened. Try again.', { bad: true });
      return false;
    }
    return true;
  };

  /* ================= layers: sheets and dialogs, closed by the phone's back button ================= */

  var layers = [], afterPop = null, lockY = 0;

  /* Locking the page behind a sheet puts it at its top (the body stops being taller than the screen).
     Where it was is remembered here and put back when the last sheet closes. The browser is not left to
     do that (history.scrollRestoration is 'manual', see start): browsers differ on when they restore the
     scroll around a step back in history, and it would land on whatever screen is showing by then. */
  function lockPage() {
    var root = doc.documentElement;
    if (root.classList.contains('locked')) return;
    lockY = window.pageYOffset || root.scrollTop || 0;
    root.classList.add('locked');
  }
  function unlockPage() {
    var root = doc.documentElement;
    if (!root.classList.contains('locked')) return;
    root.classList.remove('locked');
    window.scrollTo(0, lockY);
  }

  function pushLayer(layer) {
    layer.opener = doc.activeElement;
    layers.push(layer);
    lockPage();
    layer.inHistory = false;
    try { history.pushState({ rwLayer: layers.length }, ''); layer.inHistory = true; } catch (e) { /* no history here: the close button still works */ }
    placeToasts();
  }

  /* Toasts sit just above the tab bar. While a sheet is open they go to the top instead: just under the
     sheet's header, or just above a short sheet when there is room there. So a message never covers the
     sheet's button, the words by it, or the thing lower down that it confirms. */
  function placeToasts() {
    if (!els.toasts) return;
    var st = els.toasts.style, sh = null, i;
    for (i = layers.length - 1; i >= 0 && !sh; i--) if (layers[i].kind === 'sheet') sh = layers[i];
    if (!sh) { st.top = ''; st.bottom = ''; return; }
    var edge = sh.wrap.getBoundingClientRect().top + sh.el.offsetTop;   /* the sheet's top edge (where it rests, not where its slide-up is) */
    if (sh.el.classList.contains('sheet-small') && edge >= 72) {
      st.top = 'auto';
      st.bottom = Math.round(window.innerHeight - edge + 8) + 'px';
    } else {
      st.top = Math.round(edge + sh.head.offsetHeight + 8) + 'px';
      st.bottom = 'auto';
    }
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
    if (!layers.length) unlockPage();
    placeToasts();
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
    placeToasts();
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
    var footWatch = null;
    sh.foot = foot;
    sh.head = h('div', { class: 'sheet-head' }, title, closeBtn);
    sh.el = h('section', { class: 'sheet' + (o.small ? ' sheet-small' : ''), role: 'dialog', 'aria-modal': 'true', 'aria-label': o.title || 'Details', tabindex: '-1' },
      sh.head, sh.body, foot);
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
      placeToasts();
    };
    sh.note = function (text) { noteEl.textContent = text || ''; noteEl.hidden = !text; placeToasts(); };
    sh.error = function (message) {
      errorEl.textContent = message || '';
      errorEl.hidden = !message;
      foot.classList.toggle('has-error', !!message);
      placeToasts();
    };
    sh.send = function (action, fields, opts) {
      opts = opts || {};
      /* The footer button saves a form: one id for the whole attempt, whatever is changed between tries. A row of
         a pick-list (opts.button) always sends the same fields, so its id goes with those. */
      /* opts.landed with the words that say it is saved (opts.saved): a try that got no answer and then shows in
         the data closes the sheet with those words, unless opts.onLanded says what to do instead. */
      var onLanded = opts.onLanded || (opts.landed && typeof opts.saved === 'string' ? function () { sh.close(); App.toast(opts.saved); } : null);
      return save(opts.button || sh.button, action, fields, { error: sh.error, busyText: opts.busyText, sheet: sh, closes: true,
        attempt: opts.attempt || (opts.button ? null : 'form'), saved: opts.saved, landed: opts.landed, onLanded: onLanded, stays: opts.stays });
    };
    sh.unanswered = function (action, fields, attempt) { return !!tries[slotOf(action, fields, attempt || 'form')]; };
    sh.isOpen = function () { return layers.indexOf(sh) >= 0; };
    sh.hold = function () { return hold(sh); };
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
    sh.gone = function () {
      if (footWatch) footWatch.disconnect();
      if (o.onClose) o.onClose(sh);
    };

    els.layers.appendChild(sh.wrap);
    pushLayer(sh);
    /* A short sheet grows and shrinks (a note, an error, a longer title) and its top edge moves: toasts follow. */
    try {
      footWatch = new ResizeObserver(placeToasts);
      footWatch.observe(sh.head);
      footWatch.observe(sh.el);
    } catch (e) { footWatch = null; }
    try { if (o.body) o.body(sh.body, sh); } catch (e) { report(e); }
    if (!sh.el.contains(doc.activeElement)) { try { sh.el.focus({ preventScroll: true }); } catch (e2) { /* fine */ } }
    return sh;
  };

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

  /* Timed toasts come and go, at most two at a time. A sticky one is a message that must not be missed (a save
     that failed after its sheet was closed): it stays until its button is tapped, and nothing pushes it out. */
  App.toast = function (text, o) {
    o = o || {};
    var gone = false, timer = null, stays = !!(o.sticky || o.hold);
    var el = h('div', { class: 'toast' + (o.bad ? ' toast-bad' : '') + (stays ? ' is-sticky' : ''), role: o.bad ? 'alert' : null }, h('span', { class: 'toast-text' }, text));
    function remove() {
      if (gone) return;
      gone = true;
      clearTimeout(timer);
      if (el.parentNode) el.parentNode.removeChild(el);
    }
    var action = o.retry ? { label: 'Retry', onTap: o.retry } : o.action || (o.sticky ? { label: 'OK', onTap: function () {} } : null);
    if (action && !o.hold) {
      el.appendChild(h('button', { type: 'button', class: 'toast-btn', onclick: function () { remove(); action.onTap(); } }, action.label));
    }
    var timed = Array.prototype.filter.call(els.toasts.children, function (t) { return !t.classList.contains('is-sticky'); });
    while (!stays && timed.length >= 2) els.toasts.removeChild(timed.shift());
    placeToasts();
    els.toasts.appendChild(el);
    if (!stays) timer = setTimeout(remove, o.ms || (action ? 8000 : o.bad ? 5000 : 2600));
    return remove;
  };

  /* ================= saving: one way, for every sheet and button ================= */
  /*
   * Nothing fails silently, nothing is saved twice, and nothing is shown as saved that is not:
   *   - the button says "Saving...", the sheet's body is inert and nothing under the save is redrawn (hold);
   *   - a failure is said in words by the button. If the button or its sheet is gone by then (the sheet was
   *     closed, the person moved on), it is a red toast that stays until it is tapped, with Retry;
   *   - a save that got NO answer may have gone through, so its id is kept (`tries`) and every later try of
   *     the same thing goes out under that id, whatever was changed, until the system answers. The system then
   *     answers the same fields from memory, and refuses changed ones with 'already_saved': its words are
   *     shown, the data it sent with them is on screen, and the sheet closes so the person sees what was saved;
   *   - a try that got no answer and then turns up in the data (opts.landed) is finished as saved.
   */

  var tries = {};        /* slot (or slot and fields) -> the id of a save that was sent and has not been answered */
  var failToasts = {};   /* slot -> removes the red toast (or the "Saving..." of its Retry) about that slot */
  var landings = {};     /* slot -> [{ test, done }]: unanswered tries that can be recognised in the data */
  var standing = {};     /* slot -> { el, c, res }: a failure that is being said on a line by its button */
  var SKIPPED = { ok: false, skipped: true, error: { code: 'busy', message: '' } };

  /* What a save is about: the action, the thing it changes, and which part of it. Two saves with the same slot
     are two tries at the same thing. */
  function slotOf(action, fields, attempt) {
    var f = fields || {}, part = f.patch || f.settings;
    var target = f.jobId || f.clientId || f.saleId || f.id || (f.member && f.member.id) || '';
    return action + ':' + target + ':' + (attempt || (part && typeof part === 'object' ? Object.keys(part).sort().join(',') : ''));
  }
  function dropFailToast(slot) {
    if (failToasts[slot]) { failToasts[slot](); delete failToasts[slot]; }
  }
  function forgetTries(slot) {
    Object.keys(tries).forEach(function (key) { if (key === slot || key.indexOf(slot + '=') === 0) delete tries[key]; });
  }
  /* The system answered this try (saved, or refused): nothing is left hanging. */
  function answered(c) {
    delete tries[c.key];
    delete landings[c.slot];
  }
  /* New data is on screen. The id of a one-tap save that got no answer is only good for trying that same tap
     again straight away: from here on the person is looking at what the system holds, and the same tap is a
     new decision (a form's id is different: it stays until the system answers, see save). */
  function staleTries() {
    Object.keys(tries).forEach(function (key) { if (key.indexOf('=') > 0) delete tries[key]; });
  }
  function checkLanded() {
    Object.keys(landings).forEach(function (slot) {
      var hit = null;
      (landings[slot] || []).forEach(function (w) {
        if (hit) return;
        try { if (w.test()) hit = w; } catch (e) { report(e); }
      });
      if (!hit) return;
      delete landings[slot];
      forgetTries(slot);
      dropFailToast(slot);
      if (standing[slot]) { standing[slot].el.hidden = true; delete standing[slot]; }      /* "Could not save" is no longer true */
      try { hit.done(); } catch (e2) { report(e2); }
    });
  }
  /* No answer came back. The save may have gone through all the same: keep its id, watch for it in the data,
     and ask for the latest straight away, so the truth is on screen in a moment if the connection is back. */
  function unanswered(c) {
    tries[c.key] = c.id;
    if (c.o.landed && c.o.onLanded) {
      var list = landings[c.slot] || (landings[c.slot] = []);
      list.push({ test: c.o.landed, done: c.o.onLanded });
      if (list.length > 6) list.shift();
    }
    setTimeout(syncNow, 0);
  }
  function canRetry(code) { return code === 'network' || code === 'busy' || code === 'server'; }

  /* A failure said on a line by its button stays said. If a redraw takes that line away while the person is
     still looking at the same sheet or screen, the message moves to a red toast that stays until it is tapped. */
  function sweepStanding() {
    Object.keys(standing).forEach(function (slot) {
      var st = standing[slot];
      if (onPage(st.el) && !st.el.hidden) return;                /* still there to be read */
      delete standing[slot];
      if (st.c.sh ? st.c.sh.isOpen() : st.c.route === App.route) failToast(st.c, st.res);
    });
  }

  /* A failure with nowhere left to show it: a red toast that stays until it is tapped. Retry sends the very
     same thing again under the same id. */
  function failToast(c, res) {
    dropFailToast(c.slot);
    failToasts[c.slot] = App.toast(res.error.message, { bad: true, sticky: true, retry: canRetry(res.error.code) ? function () {
      var gen = state.gen, saving = App.toast('Saving...', { hold: true });
      failToasts[c.slot] = saving;
      tries[c.key] = c.id;
      send(c.action, c.fields, { opId: c.id, onAnswer: function () { answered(c); } }).then(function (r) {
        saving();
        if (failToasts[c.slot] === saving) delete failToasts[c.slot];
        if (gen !== state.gen) return;
        if (r.ok) {
          if (typeof c.o.saved === 'function') c.o.saved(r); else App.toast(c.o.saved || 'Saved.');
          return;
        }
        if (r.error.code === 'auth') return;
        if (r.error.code === 'network') unanswered(c);
        if (r.error.code === 'already_saved') App.toast(r.error.message, { bad: true, sticky: true });
        else failToast(c, r);
      });
    } : null });
  }

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

  /* btn may be null (a one-tap control that has already flipped). o: { sheet, closes, error(message), errorEl,
     busyText, attempt, saved, landed, onLanded }. */
  function save(btn, action, fields, o) {
    o = o || {};
    if (btn && btn.classList.contains('is-busy')) return Promise.resolve(SKIPPED);
    var sh = o.sheet || sheetOf(btn);
    if (!btn && sh && sh.holds) return Promise.resolve(SKIPPED);      /* that sheet is already saving something */
    var slot = slotOf(action, fields, o.attempt);
    var c = { action: action, fields: fields, o: o, slot: slot, key: o.attempt ? slot : slot + '=' + JSON.stringify(fields || {}), sh: sh, route: App.route };
    var gen = state.gen;
    c.id = tries[c.key] || newId();
    tries[c.key] = c.id;             /* from the moment it is sent until the system answers: a second try at the same thing, even from a sheet opened again meanwhile, is the same save */
    dropFailToast(slot);             /* a new try at the same thing: the old failure is being dealt with */
    delete standing[slot];
    setBusy(btn, true, o.busyText);
    if (o.error) o.error('');
    var release = hold(sh || (btn && els.screen && els.screen.contains(btn) ? SCREEN : null));
    /* A one-tap control has no button to say "Saving..." on: when the answer is slow in coming, a line says it. */
    var wait = null, waitTimer = btn ? null : setTimeout(function () { wait = App.toast('Saving...', { hold: true }); }, 600);
    return send(action, fields, { opId: c.id, onAnswer: function () { answered(c); } }).then(function (res) {
      clearTimeout(waitTimer);
      if (wait) wait();
      setBusy(btn, false);
      release();                     /* whatever new data arrived meanwhile is drawn now, before the outcome is told */
      if (res.ok || gen !== state.gen || res.error.code === 'auth') return res;      /* signed out: the sign-in screen says why */
      if (res.error.code === 'network') unanswered(c);
      if (res.error.code === 'already_saved') {
        /* The first try was saved and this one was not run. Say so in the system's words; they stay until tapped. */
        if (o.stays) return res;       /* the sheet says it in its own place (Add person) */
        if (o.closes && sh && sh.isOpen()) sh.close();
        App.toast(res.error.message, { bad: true, sticky: true });
        return res;
      }
      /* By the button if that place is still there; otherwise where it cannot be missed. */
      var there = o.closes ? !!sh && sh.isOpen() : !!o.errorEl && onPage(o.errorEl);
      if (there && o.error) {
        o.error(res.error.message);
        if (!o.closes && !o.keeps) standing[slot] = { el: o.errorEl, c: c, res: res };     /* a line in something that gets redrawn: watched */
      } else failToast(c, res);
      return res;
    });
  }

  ui.save = function (btn, action, fields, o) {
    o = o || {};
    var errorEl = o.errorEl;
    return save(btn, action, fields, {
      busyText: o.busyText, sheet: o.sheet, attempt: o.attempt, saved: o.saved, landed: o.landed, onLanded: o.onLanded, errorEl: errorEl, keeps: o.keeps,
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
    var options = o.options || [], value = o.value;
    var el = h('div', { class: 'chips' + (o.scroll ? ' chips-scroll' : ''), role: 'group', 'aria-label': o.label || null });
    function draw() {
      clear(el);
      options.forEach(function (op) {
        var on = value === op.value;
        el.appendChild(h('button', { type: 'button', class: 'chip' + (on ? ' is-on' : ''), 'aria-pressed': on ? 'true' : 'false', onclick: function () {
          if (value === op.value) return;
          value = op.value;
          draw();
          if (o.onChange) o.onChange(value);
        } }, op.label, op.count != null ? h('span', { class: 'chip-count' }, String(op.count)) : null));
      });
    }
    el.get = function () { return value; };
    el.set = function (v) { value = v; draw(); };
    el.setOptions = function (list) {
      list = list || [];
      var same = list.length === options.length && el.children.length === list.length &&
        list.every(function (op, i) { return op.value === options[i].value && op.label === options[i].label; });
      options = list;
      if (!same) { draw(); return; }
      /* The same choices with new counts: only the numbers change. The row is not rebuilt, so it keeps its place. */
      list.forEach(function (op, i) {
        var chip = el.children[i], count = chip.querySelector('.chip-count');
        if (op.count == null) { if (count) chip.removeChild(count); }
        else if (count) count.textContent = String(op.count);
        else chip.appendChild(h('span', { class: 'chip-count' }, String(op.count)));
      });
    };
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

  ui.title = function (text, lead) {
    return h('header', { class: 'head' }, h('h1', { class: 'title' }, text), lead ? h('p', { class: 'lead' }, lead) : null);
  };
  ui.label = function (text, o) {
    o = o || {};
    return h('h2', { class: 'label' + (o.tone ? ' label-' + o.tone : '') }, h('span', null, text), o.count != null ? h('span', { class: 'label-count' }, String(o.count)) : null);
  };
  ui.pill = function (text, tone) { return h('span', { class: 'pill pill-' + (tone || 'mute') }, text); };
  ui.jobPill = function (job) {
    var m = markOf(job);
    if (m && m.state === 'saving') return ui.pill('Saving', 'mute');      /* not Done (or Scheduled again) until the system has it */
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
  /* The top of a "saved" view: the same check and heading wherever something has just been saved for good. */
  ui.savedHead = function (text) {
    return h('div', { class: 'sold-head' }, icon('check-circle', 40), h('h3', { class: 'sold-title' }, text));
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
        times.appendChild(h('p', { class: 'muted' }, o.emptyText || 'No open days yet. Ask ' + App.ownerName() + ' to open some.'));
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
    el.getDay = function () { return day || ''; };
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

  /* ----- Mark done and Undo: one tap, and the card tells the truth all the way -----
     The card changes at once and says "Saving..." where the done line goes. Until the system answers, the
     change is laid back over any newer data that arrives (layMarks), and a second tap does nothing. If no
     answer comes, the job goes back to what the system last said, the card carries a red line that stays
     ("Not saved. Tap to try again.") and a red toast says why; both send the same thing again under the same
     id, so a save that did get through is never made twice. "Marked done." with Undo is only said once the
     system has it: a job from an earlier day leaves the screen then, and that message is how it comes back. */
  var marks = {};      /* jobId -> { done, opId, state: 'saving' | 'failed', stamp, truth, unsay } */

  function markOf(job) { return job && own.call(marks, job.id) ? marks[job.id] : null; }
  function dropMark(jobId) {
    var m = own.call(marks, jobId) ? marks[jobId] : null;
    if (!m) return;
    if (m.unsay) m.unsay();
    delete marks[jobId];
  }
  function wear(job, m) {
    var me = App.me();
    m.truth = { status: job.status, doneAt: job.doneAt, doneBy: job.doneBy };      /* what the system last said */
    job.status = m.done ? 'done' : 'scheduled';
    job.doneAt = m.done ? m.stamp : null;
    job.doneBy = m.done && me ? me.id : null;
  }
  /* New data arrived. A change still on its way is laid over it again; one that failed is finished with if
     the data now shows what was asked for (the answer was lost, the save was not). */
  function layMarks() {
    Object.keys(marks).forEach(function (jobId) {
      var m = marks[jobId], job = App.job(jobId);
      if (m.state === 'saving') { if (job) wear(job, m); return; }
      if (!job || (job.status === 'done') === m.done) dropMark(jobId);
    });
  }

  function setDone(jobId, done) {
    var job = App.job(jobId), me = App.me(), old = markOf(job);
    if (!job || !me) {
      dropMark(jobId);
      if (me) App.toast('That job is no longer on your list.');
      return;
    }
    if (old && old.state === 'saving') return;                    /* one at a time: a second tap does nothing */
    var m = { done: !!done, state: 'saving', stamp: done ? Date.now() : null, opId: old && old.done === !!done ? old.opId : newId() };
    dropMark(jobId);
    marks[jobId] = m;
    wear(job, m);
    changed();
    var gen = state.gen;
    send('setJobDone', { jobId: jobId, done: m.done }, { opId: m.opId, onAnswer: function () { if (marks[jobId] === m) delete marks[jobId]; } }).then(function (res) {
      if (gen !== state.gen) return;
      var now = App.job(jobId);
      if (res.ok) {
        changed();                                               /* "Saving..." comes off the card */
        if (m.done && now && now.status === 'done') {
          App.toast('Marked done.', { ms: 6000, action: { label: 'Undo', onTap: function () { setDone(jobId, false); } } });
        }
        return;
      }
      if (res.error.code === 'auth') return;
      /* Not saved, as far as this phone knows: the card goes back to what the system last said. */
      if (now && m.truth && now.status === (m.done ? 'done' : 'scheduled') && now.doneAt === m.stamp) {
        now.status = m.truth.status; now.doneAt = m.truth.doneAt; now.doneBy = m.truth.doneBy;
      }
      if (canRetry(res.error.code) && now) {
        m.state = 'failed';
        marks[jobId] = m;
        m.unsay = App.toast(res.error.message, { bad: true, sticky: true, retry: function () { m.unsay = null; setDone(jobId, m.done); } });
        if (res.error.code === 'network') setTimeout(syncNow, 0);  /* it may have got through: look */
      } else {
        App.toast(res.error.message, { bad: true, sticky: true });
      }
      changed();
    });
  }

  function jobActions(job) {
    var c = job.client || {}, row = h('div', { class: 'job-actions' });
    if (fmt.tel(c.phone)) row.appendChild(ui.button('Call', { icon: 'phone', small: true, href: fmt.tel(c.phone) }));
    if (c.address) row.appendChild(ui.button('Directions', { icon: 'directions', small: true, href: fmt.maps(c.address), newTab: true }));
    row.appendChild(ui.button('Add note', { icon: 'note', small: true, onTap: function () { ui.addNote('job', job.id); } }));
    return row;
  }

  /* The red line a failed Mark done (or Undo) leaves on its job. It stays until it is tapped; tapping tries again. */
  function unsavedLine(job, m) {
    return h('button', { type: 'button', class: 'job-unsaved', onclick: function () { setDone(job.id, m.done); } },
      icon('alert', 20), h('span', null, m.done ? 'Not saved. Tap to try again.' : 'Undo was not saved. Tap to try again.'));
  }

  function doneLine(job) {
    var m = markOf(job);
    if (m && m.state === 'saving') return h('div', { class: 'job-done-line', role: 'status' }, h('span', null, 'Saving...'));
    return h('div', { class: 'job-done-line' }, h('span', null, doneText(job)),
      canMark(job) && !m ? ui.button('Undo', { kind: 'text', small: true, onTap: function () { setDone(job.id, false); } }) : null);
  }

  /* What goes where "Mark done" goes on a job that is still to do: the button, "Saving..." while an Undo is
     on its way, or the red line after a Mark done that was not saved. */
  function markControl(job, primary) {
    var m = markOf(job);
    if (m && m.state === 'saving') return h('div', { class: 'job-done-line', role: 'status' }, h('span', null, 'Saving...'));
    if (m && m.done) return unsavedLine(job, m);
    return ui.button('Mark done', { kind: primary ? 'primary' : 'quiet', block: true, onTap: function () { setDone(job.id, true); } });
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
    if (done) {
      card.appendChild(doneLine(job));
      if (markOf(job) && markOf(job).state === 'failed') card.appendChild(unsavedLine(job, markOf(job)));   /* an Undo that was not saved */
      return card;
    }
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
    /* One ice button per screen: only the card the screen marks as `primary` gets it. The rest are the same size, quiet. */
    if (canMark(job)) card.appendChild(markControl(job, o.primary));
    return card;
  };

  /* The compact job row. Nothing is cut off: the name wraps beside the pill (which stays top right), and
     the lines under it run the full width below the pill. */
  ui.jobRow = function (job, o) {
    o = o || {};
    var c = job.client || {};
    var lead = h('span', { class: 'row-time' }, o.showDate ? h('small', null, fmt.day(job.date)) : null, fmt.time(job.time));
    var sub = o.sub != null ? o.sub : [job.what, c.address];
    var name = o.title != null ? o.title : (c.name || 'Client');
    var pill = o.pill === false ? null : ui.jobPill(job);
    return ui.row({ lead: lead, title: pill ? h('span', { class: 'row-head' }, h('span', { class: 'row-head-text' }, name), pill) : name,
      sub: sub, cls: 'row-job', chevron: false, onTap: function () { ui.openJob(job.id); } });
  };

  /* A "Coming up" list: job rows with their day and no status pill. The caller chooses and sorts the jobs. */
  ui.comingUp = function (jobs, o) {
    o = o || {};
    jobs = jobs || [];
    if (!jobs.length) return h('p', { class: 'muted' }, o.empty || 'Nothing is booked yet.');
    var who = o.who == null ? App.role() === 'owner' : !!o.who;
    var list = h('div', { class: 'list' });
    jobs.forEach(function (job) {
      var sub = [job.what];
      if (who) sub.push(job.assignedTo ? App.nameOf(job.assignedTo, 'Someone') : h('span', { class: 'warn strong' }, 'Unassigned'));
      list.appendChild(ui.jobRow(job, { showDate: true, pill: false, sub: sub }));
    });
    return list;
  };

  /* Choosing a person, or nobody: the two rows every such list is made of. "Nobody" is always first. */
  function pickedMark(on) { return on ? h('span', { class: 'ice' }, icon('check', 22)) : null; }
  ui.personRow = function (m, o) {
    o = o || {};
    return ui.row({ lead: h('span', { class: 'avatar' }, fmt.initials(m.name)), title: m.name, sub: o.sub != null ? o.sub : (ROLE_WORDS[m.role] || ''),
      right: pickedMark(o.selected), chevron: false, onTap: o.onTap });
  };
  ui.nobodyRow = function (o) {
    o = o || {};
    return ui.row({ lead: h('span', { class: 'avatar avatar-none' }, icon('minus', 18)), title: 'Nobody', sub: o.sub,
      right: pickedMark(o.selected), chevron: false, onTap: o.onTap });
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
        /* A try that got no answer may have saved the note all the same. It has when the notes hold one more
           like it than before: then the sheet is finished as saved, and nothing is sent again. */
        var had = sameNotes(kind, id, text);
        function saved() { sh.close(); App.toast('Note saved.'); }
        sh.send('addNote', { kind: kind, id: id, text: text }, { saved: 'Note saved.',
          landed: function () { return sameNotes(kind, id, text) > had; }, onLanded: saved
        }).then(function (res) { if (res.ok) saved(); });
      } }
    });
  };
  /* How many of my own notes with these words the job or client holds. */
  function sameNotes(kind, id, text) {
    var thing = kind === 'job' ? App.job(id) : App.client(id), me = App.me();
    return ((thing && thing.notes) || []).filter(function (n) { return !!me && n.by === me.id && n.text === text; }).length;
  }

  function openAssign(jobId) {
    App.sheet.open({
      title: 'Assign to', small: true,
      update: function (sh) { sh.rebuild(); },
      body: function (el, sh) {
        var job = App.job(jobId);
        if (!job) { el.appendChild(h('p', { class: 'muted' }, 'That job is no longer here.')); return; }
        /* A sales rep cannot see or finish a job, so only techs and owners are offered (the system refuses anyone else). */
        var order = { tech: 0, owner: 1 };
        var people = App.people(['tech', 'owner']).sort(function (a, b) { return (order[a.role] - order[b.role]) || (a.name < b.name ? -1 : 1); });
        var list = h('div', { class: 'list' });
        function pick(id, name, rowEl) {
          if (id === (job.assignedTo || null)) { sh.close(); return; }
          var said = id ? 'Assigned to ' + name + '.' : 'Nobody is assigned now.';
          sh.send('updateJob', { jobId: jobId, patch: { assignedTo: id } }, { button: rowEl, saved: said,
            landed: function () { var now = App.job(jobId); return !!now && (now.assignedTo || null) === id; }
          }).then(function (res) {
            if (!res.ok) return;
            sh.close();
            App.toast(said);
          });
        }
        list.appendChild(ui.nobodyRow({ sub: 'Leave this job unassigned', selected: !job.assignedTo, onTap: function (e, rowEl) { pick(null, '', rowEl); } }));
        people.forEach(function (m) {
          list.appendChild(ui.personRow(m, { selected: job.assignedTo === m.id, onTap: function (e, rowEl) { pick(m.id, m.name, rowEl); } }));
        });
        el.appendChild(list);
      }
    });
  }

  var PICK_TIME = 'Pick a day and a time';      /* the footer button of a slot picker sheet before a time is chosen */

  function openMove(jobId) {
    var job = App.job(jobId), picker;
    if (!job) return;
    var sh = App.sheet.open({
      title: 'Move to another time',
      body: function (el, sheet) {
        el.appendChild(h('p', { class: 'muted' }, ((job.client || {}).name || 'This job') + ' is booked for ' + fmt.when(job.date, job.time) + '.'));
        picker = ui.slotPicker({ onChange: function (v) { sheet.setButton(v ? 'Move to ' + fmt.when(v.date, v.time) : PICK_TIME, !v); } });
        el.appendChild(picker);
      },
      footer: { label: PICK_TIME, onTap: function (sheet) {
        var v = picker.get();
        if (!v) return;
        function moved() { sheet.close(); App.toast('Moved to ' + fmt.when(v.date, v.time) + '.'); }
        sheet.send('moveJob', { jobId: jobId, date: v.date, time: v.time }, { saved: moved,
          /* No answer, and then the job turns up at that time: it was moved. */
          landed: function () { var now = App.job(jobId); return !!now && now.date === v.date && now.time === v.time; }, onLanded: moved
        }).then(function (res) {
          if (res.ok) moved();
          else if (res.error.code === 'slot_taken' || res.error.code === 'slot_closed') {
            sheet.error('');
            picker.set(null);
            picker.setError(res.error.message);
            sheet.setButton(PICK_TIME, true);
          }
        });
      } }
    });
    sh.setButton(PICK_TIME, true);
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
        sh.send('updateJob', { jobId: jobId, patch: { what: text } }, { attempt: 'what', saved: 'Saved.',
          landed: function () { var now = App.job(jobId); return !!now && now.what === text; }
        }).then(function (res) {
          if (!res.ok) return;
          sh.close();
          App.toast('Saved.');
        });
      } }
    });
  }

  function bringBack(jobId) {
    var said = 'The job is back on the schedule.';
    save(null, 'updateJob', { jobId: jobId, patch: { status: 'scheduled' } }, { saved: said,
      landed: function () { var now = App.job(jobId); return !!now && now.status === 'scheduled'; }, onLanded: function () { App.toast(said); }
    }).then(function (res) {
      if (res.ok) App.toast(said);
    });
  }

  function cancelJob(job, btn, errorEl, sh) {
    var c = job.client || {};
    App.confirm({
      title: 'Cancel this job?',
      text: (c.name || 'This job') + ', ' + fmt.when(job.date, job.time) + '. That time can be booked again.',
      yes: 'Cancel job', no: 'Keep it', danger: true
    }).then(function (yes) {
      if (!yes) return;
      function cancelled() {
        sh.close();
        App.toast('Job cancelled.', { action: { label: 'Undo', onTap: function () { bringBack(job.id); } } });
      }
      ui.save(btn, 'updateJob', { jobId: job.id, patch: { status: 'cancelled' } }, { errorEl: errorEl, saved: cancelled,
        landed: function () { var now = App.job(job.id); return !!now && now.status === 'cancelled'; }, onLanded: cancelled
      }).then(function (res) {
        if (res.ok) cancelled();
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
    /* The same truth as on the card: "Saving..." until the system has it, and a red line if it could not be saved. */
    var mark = markOf(job);
    if (scheduled && canMark(job)) el.appendChild(markControl(job, true));
    if (done && mark && mark.state === 'saving') {
      el.appendChild(h('div', { class: 'callout', role: 'status' }, h('span', { class: 'strong' }, 'Saving...')));
    } else if (done) {
      el.appendChild(h('div', { class: 'callout callout-good' }, h('div', { class: 'between' },
        h('span', { class: 'strong' }, doneText(job)),
        canMark(job) && !mark ? ui.button('Undo', { kind: 'text', small: true, onTap: function () { setDone(job.id, false); } }) : null)));
      if (mark) el.appendChild(unsavedLine(job, mark));
    }
    if (cancelled) {
      el.appendChild(h('div', { class: 'callout' }, h('p', { class: 'callout-title' }, 'This job was cancelled.'),
        owner ? h('p', { class: 'muted small' }, 'You can put it back on the schedule if its time is still free.') : null));
      if (owner) {
        var backErr = h('p', { class: 'form-error', role: 'alert', hidden: true });
        el.appendChild(ui.button('Put it back on the schedule', { block: true, small: true, onTap: function (e, btn) {
          ui.save(btn, 'updateJob', { jobId: job.id, patch: { status: 'scheduled' } }, { errorEl: backErr, saved: 'The job is back on the schedule.',
            landed: function () { var now = App.job(job.id); return !!now && now.status === 'scheduled'; },
            onLanded: function () { App.toast('The job is back on the schedule.'); }
          }).then(function (res) {
            if (res.ok) App.toast('The job is back on the schedule.');
          });
        } }));
        el.appendChild(backErr);
      }
    }

    el.appendChild(ui.label('Notes'));
    el.appendChild((job.notes || []).length ? ui.notes(job.notes) : h('p', { class: 'muted' }, 'No notes yet.'));

    if (cancelled || !(owner || (me.role === 'rep' && scheduled))) return;
    el.appendChild(ui.label(owner ? 'Manage this job' : 'Change this appointment'));   /* a rep can only move the booked time */
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

  var tabsKey = '', meLine = null;

  /* When this phone last heard from the system, as the strip says it: "at 2:14 PM", or "Tue, Nov 17 at 10:00 AM"
     when that was not today. */
  function savedWhen() {
    if (!state.okAt) return '';
    var day = localDay(state.okAt);
    return day === localDay(Date.now()) ? 'at ' + fmt.clock(state.okAt) : fmt.when(day, localHM(state.okAt));
  }
  /* The same moment for the account sheet: "2:14 PM", or "Nov 16, 2:14 PM". */
  function savedAt() {
    if (!state.okAt) return '';
    return localDay(state.okAt) === localDay(Date.now()) ? fmt.clock(state.okAt) : fmt.stamp(state.okAt);
  }
  /* Is what is on screen older than it looks? After two failed refreshes in a row; or after the very first
     one when the page has only its saved copy to show (it was opened with no signal). */
  function behind() { return state.fails >= (state.heard ? 2 : 1); }

  /* The one status line under the top bar. It says which kind of trouble it is: nothing answered (no
     connection), or the system answered with an error. A page that opened on a saved copy from another day
     says so at once, before its first refresh has even come back. */
  function drawStrip() {
    if (!els.strip) return;
    var text = '', at = savedWhen(), showing = at ? 'Showing what was saved ' + at + '. ' : '';
    if (behind()) text = (state.failKind === 'error' ? 'The system is not answering. ' : 'No connection. ') + showing + 'Trying again.';
    else if (state.stale && !state.heard && showing) text = showing + 'Getting the latest.';
    else if (App.mode === 'sample') text = 'Sample data. Nothing here is real yet.';
    els.strip.hidden = !text;
    els.stripText.textContent = text;
    if (meLine && onPage(meLine)) meLine.textContent = upToDateText();   /* the account sheet never says "Up to date" under this strip */
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

  function drawScreen(keep) {
    var root = els.screen, def = screens[App.route] || {};
    /* A screen with a box someone types in (Clients and its search) redraws only what is under the box: the
       box never leaves the page, so the keyboard stays up and nothing typed is lost. Its `update` answers
       false when it cannot (the screen has to be built again). */
    if (keep && typeof def.update === 'function' && root._drawn === App.route && root.firstChild) {
      try { if (def.update(root) !== false) return; } catch (e0) { report(e0); }
    }
    var y = window.pageYOffset || doc.documentElement.scrollTop || 0;
    var typed = keep ? keepTyped(root) : [];
    clear(root);
    root.className = 'screen screen-' + App.route;
    root._drawn = App.route;
    try {
      def.render(root);
    } catch (e) {
      report(e);
      clear(root);
      root.appendChild(ui.empty({ title: 'This screen could not be shown.', text: 'Close the app and open it again. If it keeps happening, tell ' + App.ownerName() + '.' }));
    }
    if (keep) { restoreTyped(root, typed); window.scrollTo(0, y); }
    else window.scrollTo(0, 0);
  }

  /* Only a screen that was registered, and that this role may open. Anything else in the address goes to Today. */
  function allowed(route) {
    var def = typeof route === 'string' ? screens[route] : null;
    return !!def && typeof def.render === 'function' && (!def.roles || def.roles.indexOf(App.role()) >= 0);
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
    lockY = 0;                 /* a new screen starts at its top, also once a sheet over it closes */
    SCREEN.dirty = false;      /* it is about to be drawn from scratch */
    App.route = route;
    drawChrome();
    drawScreen(false);
    emit('route');
  }

  App.screen = function (route, def) { screens[String(route)] = def || {}; };
  App.go = function (route) { closeAll(function () { show(route); }); };

  /* ================= staying live ================= */

  var liveTimer = null;

  function syncNow() {
    if (state.syncing || !state.token || !state.inApp) return;
    state.syncing = true;
    send('sync').then(function (res) {
      state.syncing = false;
      /* "Busy" only means several phones asked at the same moment: the next round will do. */
      if (res.ok || res.error.code === 'auth' || res.error.code === 'busy') return;
      state.fails++;            /* two in a row and the strip says so, until one works (the first one, when the page opened on its saved copy) */
      state.failKind = res.error.code === 'network' && !res.error.reached ? 'offline' : 'error';
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
    tellCannotKeep();
  }

  function leaveApp() {
    state.inApp = false;
    stopLive();
    dropTo(0, false);
    clear(els.toasts);        /* nothing left over from whoever was signed in: no message... */
    clear(els.screen);        /* ...and not their last screen either, sitting in the hidden page */
    els.screen._drawn = '';
    els.app.hidden = true;
    els.signin.hidden = false;
    window.scrollTo(0, 0);
  }

  function forget() {
    state.token = null;
    state.fails = 0;
    state.failKind = '';
    state.stale = false;
    state.gen++;               /* an answer to anything this person sent is no longer shown to whoever is here next */
    tries = {};
    landings = {};
    failToasts = {};
    standing = {};
    marks = {};
    App.data = null;
    storage.del('token');
    storage.del('who');
    storage.del('snap');
    storage.del('at');
  }

  /* Sign out (or be signed out): forget this phone's token and saved data, show sign-in with the reason.
     Other files hear 'signout' first, while App.me() still answers, and clear what they keep for this person. */
  function signOut(message) {
    var token = state.token;
    if (App.data) emit('signout', { chosen: !message, removed: !!message && REMOVED_RE.test(message) });
    if (token && !message) transport({ action: 'logout', token: token });   /* best effort; nothing waits on it */
    forget();
    showSignIn(message);
  }

  function askSignOut() {
    App.confirm({
      title: 'Sign out of this phone?',
      text: 'You will need your name and PIN to sign in again.',
      yes: 'Sign out', no: 'Stay signed in'
    }).then(function (yes) { if (yes) signOut(); });
  }

  function logIn(name, pin, btn, errorEl) {
    if (state.signingIn) return;          /* one sign-in at a time, whichever button was tapped */
    state.signingIn = true;
    setBusy(btn, true, 'Signing in...');
    if (errorEl) errorEl.hidden = true;
    send('login', { name: name, pin: pin }).then(function (res) {
      state.signingIn = false;
      setBusy(btn, false);
      if (!res.ok || !state.token || !App.data) {
        /* The system's own words when it answered ("That name and PIN do not match."). No answer at all, or one
           that is not ours: in real mode say what to do about it; the sample cannot be out of reach. */
        var msg = !res.ok && res.error.code !== 'network' ? res.error.message
          : App.mode === 'live' ? CANNOT_REACH : 'Could not sign in. Try again.';
        if (res.ok) forget();        /* an answer we could not use: keep nothing of it */
        if (errorEl) { errorEl.textContent = msg; errorEl.hidden = false; }
        else App.toast(msg, { bad: true });
        return;
      }
      enterApp('today');             /* settle() has already kept the token and whose phone this is now */
    });
  }

  function showSignIn(message) {
    leaveApp();
    var body = clear(els.signinBody);

    if (App.mode === 'sample') {
      /* One button per role, for the first sample person of that role who can still sign in with their
         starting PIN. Someone trying the sample may have removed or renamed them, or changed that PIN. */
      var quick = h('div', { class: 'btn-row' }), missing = false;
      ['owner', 'rep', 'tech'].forEach(function (role) {
        var p = RidgelineSample.PEOPLE.filter(function (x) { return x.role === role && sampleKnows(x); })[0];
        if (!p) { missing = true; return; }
        quick.appendChild(ui.button(ROLE_WORDS[role], { small: true, onTap: function (e, btn) { logIn(p.name, p.pin, btn, error); } }));
      });
      body.appendChild(h('div', { class: 'card' },
        h('div', { class: 'stack-xs' },
          h('p', { class: 'strong' }, 'Sample mode'),
          h('p', { class: 'muted small' }, 'This is made-up data so you can try everything.' + (quick.firstChild ? ' Sign straight in as:' : ''))),
        quick.firstChild ? quick : null,
        missing ? ui.button('Reset sample data', { kind: 'text', small: true, icon: 'reset', onTap: resetSample }) : null,
        h('p', { class: 'muted small sample-next' }, 'Sample data starts fresh each day.'),
        h('p', { class: 'muted small' }, 'Grayson: this becomes your real team app once the setup steps are done.')));
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
      if (!PIN_RE.test(p)) { pin.setError('Your PIN is 6 digits.'); pin.input.focus(); return; }
      logIn(n, p, btn, error);
    } },
      h('h1', { class: 'signin-title' }, 'Team sign in'), name, pin, btn, error,
      h('p', { class: 'hint' }, 'Forgot your PIN? Ask Grayson to reset it.')));
  }

  function sampleKnows(p) {
    try {
      return sample.store.list('team').some(function (m) {
        return m.active && m.role === p.role && m.name === p.name && Core.sha256(m.salt + ':' + p.pin) === m.pinHash;
      });
    } catch (e) { return false; }
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
      var why = !res.ok && res.error.code !== 'network' ? res.error.message
        : App.mode === 'live' ? CANNOT_REACH : 'Could not load. Try again.';
      body.appendChild(h('div', { class: 'stack' },
        h('p', { class: 'form-error', role: 'alert' }, why),
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
    /* A job from an earlier day stays in its place while its Mark done is still being saved (or could not be). */
    var overdue = d.jobs.filter(function (j) { return App.isOverdue(j) || (j.date < today && j.status !== 'cancelled' && !!markOf(j)); }).sort(byTime);
    var doneCount = todays.filter(function (j) { return j.status === 'done' && !(markOf(j) && markOf(j).state === 'saving'); }).length;   /* only what is saved counts */
    var next = todays.filter(function (j) { return j.status === 'scheduled'; })[0];
    var nextTime = next ? fmt.time(next.time).split(' ') : null;
    /* The one ice button on this screen: "Mark done" on the first job still to do, an overdue one before today's. */
    var first = overdue[0] || next || null;
    function card(job) { return ui.jobCard(job, { primary: !!first && job.id === first.id }); }

    root.appendChild(h('header', { class: 'head' },
      h('p', { class: 'lead' }, greeting() + ', ' + fmt.first(me.name)),
      h('h1', { class: 'title' }, fmt.dayHead(today))));

    root.appendChild(ui.stats([
      { value: todays.length, label: 'Jobs today' },
      { value: doneCount, label: 'Done' },
      nextTime ? { value: nextTime[0], unit: nextTime[1], label: 'Next job' } : { value: '–', label: 'Next job', tone: 'mute' }
    ]));

    /* Overdue jobs come first, in red. The standards reminder sits under them, above today's jobs. */
    if (overdue.length) {
      root.appendChild(ui.label('Overdue', { tone: 'bad', count: overdue.length }));
      overdue.forEach(function (job) { root.appendChild(card(job)); });
    }
    if (App.needsStandards()) {
      root.appendChild(h('div', { class: 'card remind' },
        h('img', { class: 'remind-photo', src: 'photo-standard.jpg', alt: '', onerror: function () { this.style.visibility = 'hidden'; } }),
        h('div', { class: 'remind-text' },
          h('p', { class: 'remind-title' }, 'Company standards'),
          h('p', { class: 'remind-sub' }, 'Read these and confirm.')),      /* one line on the narrowest phone, and true for a rep, who does no jobs */
        ui.button('Read', { small: true, onTap: function () { App.go('standards'); } })));
    }
    if (overdue.length) root.appendChild(ui.label('Today'));
    todays.forEach(function (job) { root.appendChild(card(job)); });

    if (!todays.length) {
      if (me.role === 'rep') {
        root.appendChild(ui.empty({ title: 'Nothing scheduled today.', text: 'Made a sale? Enter it and book the appointment before you leave.',
          button: { label: 'New sale', kind: 'primary', onTap: function () { App.act('newSale', {}); } } }));
      } else if (me.role === 'owner' && !App.freeDays().length) {
        /* Only when nothing from today on can be booked: with days already open there is nothing to tell him to do. */
        root.appendChild(ui.empty({ title: 'Nothing scheduled today.', text: 'Open days in Calendar so your reps can book.',
          button: { label: 'Go to Calendar', onTap: function () { App.go('calendar'); } } }));
      } else if (me.role === 'owner') {
        root.appendChild(ui.empty({ title: 'Nothing scheduled today.', text: 'Appointments booked for today show up here.' }));
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

    /* The owner's own part sits right under the title, not below the whole page: who has read them, and the way in to edit. */
    if (me.role === 'owner') {
      var crew = App.people(['rep', 'tech']), read = crew.filter(App.hasRead).length;
      root.appendChild(h('div', { class: 'std-owner' },
        h('p', { class: 'muted' }, crew.length
          ? read + ' of ' + crew.length + ' have read these.'
          : 'Nobody else is on the team yet. Tap your initials at the top left, then Team.'),
        ui.button('Edit standards', { icon: 'edit', small: true, onTap: function () { App.act('editStandards'); } })));
    }

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

    if (me.role === 'owner') return;
    var foot = h('div', { class: 'std-foot' });
    if (App.needsStandards()) {
      var error = h('p', { class: 'form-error', role: 'alert', hidden: true });
      if (me.standardsAckAt > 0 && s.standardsUpdatedAt) {
        foot.appendChild(h('p', { class: 'warn strong' }, 'Updated ' + fmt.date(s.standardsUpdatedAt) + '. Read them again and confirm.'));
      }
      /* No toast on success: the button turns into the green "You confirmed these" line in the same spot, and a toast would sit on it. */
      foot.appendChild(ui.button('I have read these', { kind: 'primary', block: true, onTap: function (e, btn) {
        /* A try that got no answer and did get through shows by itself: new data turns the button into the green line. */
        ui.save(btn, 'ackStandards', {}, { errorEl: error, landed: function () { return !App.needsStandards(); }, onLanded: function () {} });
      } }));
      foot.appendChild(error);
    } else {
      foot.appendChild(h('p', { class: 'std-ok' }, icon('check-circle', 20), h('span', null, 'You confirmed these on ' + fmt.date(me.standardsAckAt) + '.')));
    }
    root.appendChild(foot);
  }

  /* ================= the Me sheet and Change PIN ================= */

  /* The line at the foot of the account sheet. It only says "Up to date" while refreshes are working:
     under the no-connection strip it says when the data is from instead. */
  function upToDateText() {
    if (App.mode === 'sample') return 'Sample data, saved on this phone only.';
    var at = savedAt();
    if (!at) return 'Waiting for a connection.';
    return behind() || (state.stale && !state.heard) ? 'Last updated ' + at + '.' : 'Up to date as of ' + at + '.';
  }

  function openChangePin() {
    var cur = ui.field({ label: 'Current PIN', name: 'pin-now', type: 'password', inputmode: 'numeric', maxlength: 6 });
    var next = ui.field({ label: 'New PIN', name: 'pin-new', type: 'password', inputmode: 'numeric', maxlength: 6, hint: '6 digits. Pick one only you know.' });
    var again = ui.field({ label: 'New PIN again', name: 'pin-again', type: 'password', inputmode: 'numeric', maxlength: 6 });
    App.sheet.open({
      title: 'Change PIN',
      body: function (el) { el.appendChild(cur); el.appendChild(next); el.appendChild(again); },
      footer: { label: 'Save new PIN', onTap: function (sh) {
        var a = cur.val(), b = next.val(), c = again.val();
        if (!a) { cur.setError('Type the PIN you use now.'); sh.reveal(cur); return; }
        if (!PIN_RE.test(b)) { next.setError('A PIN is 6 digits.'); sh.reveal(next); return; }
        if (b !== c) { again.setError('The two new PINs do not match.'); sh.reveal(again); return; }
        /* A PIN that is too easy to guess is refused by the system, in its own words, by the button. */
        var said = 'Your PIN is changed. Your other phones were signed out.';
        sh.send('changePin', { oldPin: a, newPin: b }, { saved: said }).then(function (res) {
          if (!res.ok) return;
          sh.close();
          App.toast(said);
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
      if (App.data) emit('signout', { chosen: true });      /* whoever is signed in is about to stop existing */
      forget();
      startSample(true);
      if (!person) {
        showSignIn();
        App.toast('Sample data is back to the start.');
        return;
      }
      leaveApp();
      clear(els.signinBody).appendChild(h('p', { class: 'muted' }, 'Loading...'));
      send('login', { name: person.name, pin: person.pin }).then(function (res) {
        if (!res.ok || !state.token || !App.data) { forget(); showSignIn(); return; }
        enterApp('today');
        App.toast('Sample data is back to the start.');
      });
    });
  }

  function openMe() {
    var liveLine = h('p', null, upToDateText());
    meLine = liveLine;          /* drawStrip keeps it in step with the strip */
    App.live(liveLine, function () { liveLine.textContent = upToDateText(); });
    App.sheet.open({
      title: 'Your account',
      update: function (sh) { sh.rebuild(); },      /* no input in here, so the pills on its rows simply stay current */
      body: function (el) {
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
        list.appendChild(ui.row({ icon: 'signout', title: 'Sign out', chevron: false, onTap: askSignOut }));
        el.appendChild(list);

        el.appendChild(h('div', { class: 'me-foot' }, h('p', null, 'Ridgeline Wash Co. A higher standard of clean.'), liveLine));
      }
    });
  }

  /* ================= start ================= */

  /* Another tab on this phone signed out, or someone else signed in there. This tab follows at once (it
     starts again and picks up whoever is signed in now), so it can never go on showing one person's data,
     or save it over the next person's. */
  function onOtherTab(e) {
    if (e.key !== null && e.key !== storage.prefix + 'token') return;
    if (state.signingIn || storage.get('token') === state.token) return;
    try { location.reload(); } catch (err) { /* stays as it is */ }
  }

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
    if (stopped) { showStopped(); return; }      /* config.js missing or wrong: say so, and never fall back to sample data */
    var fresh = App.mode === 'sample' ? startSample(false) : false;

    if (window.visualViewport) {
      window.visualViewport.addEventListener('resize', fitLayers);
      window.visualViewport.addEventListener('scroll', fitLayers);
      fitLayers();
    }
    /* The app places the scroll itself: the top of a new screen, kept on a redraw, put back when a sheet closes
       (lockPage / unlockPage). Left to the browser, going to another screen from a sheet lands that screen at
       the old one's scroll position, because the sheet closes with a step back in history. */
    try { history.scrollRestoration = 'manual'; } catch (e) { /* an old browser: it restores the scroll itself, as before */ }
    window.addEventListener('resize', placeToasts);
    window.addEventListener('storage', onOtherTab);
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
    var snap = storage.json('snap'), who = storage.get('who');
    if (state.token && fresh) {
      /* The sample starts over each day (or after its saved copy is lost), so yesterday's sign-in no longer exists. */
      forget();
      snap = null;
    }
    /* The saved copy is only used when it belongs to the person who signed in last on this phone. Anyone
       else's (or one kept before that was recorded) is dropped, and the app loads fresh instead. */
    if (snap && (!snap.me || !who || String(snap.me.id) !== who)) {
      snap = null;
      storage.del('snap');
    }
    if (state.token && snap && snap.me && Array.isArray(snap.jobs) && snap.settings) {
      App.data = snap;
      state.okAt = +storage.get('at') || 0;
      state.stale = snap.today !== businessDay();      /* yesterday's copy: the strip says so from the first moment */
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
