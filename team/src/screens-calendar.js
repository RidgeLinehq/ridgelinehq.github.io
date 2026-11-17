/*
 * Ridgeline Wash Co. team app: the Calendar screen (#calendar).
 *
 * Owner, "Availability": the month grid with how many times are still free on each open day, the
 *   Day sheet (open or block one day and set its times), "Open weekdays", "Block all" and
 *   "Coming up" (the next 14 days of appointments).
 * Sales rep, "Open days": the same grid to read, not change. Tapping an open day shows its free
 *   times and the rep's own appointments, with "New sale on this day".
 */
(function () {
  'use strict';

  var h = App.h, ui = App.ui, fmt = App.fmt;
  var D = RidgelineCore.dates, LIMITS = RidgelineCore.LIMITS;

  /* View state. It lives here because render runs again every time the data changes. */
  var month = null;        /* the month on show, 'YYYY-MM' */
  var viewer = null;       /* who that state belongs to */
  var bulkError = '';      /* why "Open weekdays" or "Block all" last failed */

  /* ---------- small helpers ---------- */

  function pad2(n) { return (n < 10 ? '0' : '') + n; }
  function clear(el) { el.textContent = ''; return el; }
  function shiftMonth(ym, n) {
    var y = +ym.slice(0, 4), m = +ym.slice(5, 7) - 1 + n;
    y += Math.floor(m / 12);
    return y + '-' + pad2(((m % 12) + 12) % 12 + 1);
  }
  function monthWord(ym) { return fmt.month(ym).split(' ')[0]; }
  function daysOf(ym) {
    var out = [], count = D.daysInMonth(+ym.slice(0, 4), +ym.slice(5, 7));
    for (var i = 1; i <= count; i++) out.push(ym + '-' + pad2(i));
    return out;
  }
  function usualSlots() {
    var list = (App.data.settings.defaultSlots || []).slice().sort();
    return list.length ? list : RidgelineCore.DEFAULT_SETTINGS.defaultSlots.slice();
  }
  function scheduledOn(date) { return App.jobsOn(date).filter(function (j) { return j.status === 'scheduled'; }); }

  /* A retry after a failed save re-uses its id so nothing is saved twice. That is only right while
     the thing being saved is the same, so a changed save starts fresh. */
  function freshSave(btn, fields) {
    var key = JSON.stringify(fields);
    if (btn && btn._sent !== key) { btn._sent = key; btn._ops = null; }
  }

  /* One day of the grid, the same for the owner and for reps: open days say how many times are left. */
  function dayState(date) {
    if (date < App.today()) return { state: 'past', disabled: true };
    var day = App.dayOf(date);
    if (!day || !day.open) return { state: 'blocked' };
    var free = App.freeSlots(date).length;
    return free ? { state: 'open', label: free + ' left' } : { state: 'full', label: 'Full' };
  }

  function legend() {
    function item(cls, text) { return h('span', { class: 'legend-item' }, h('span', { class: 'swatch' + (cls ? ' ' + cls : '') }), text); }
    return h('div', { class: 'legend' }, item('is-open', 'Open'), item('is-full', 'Full'), item('', 'Blocked'), item('is-today', 'Today'));
  }

  function monthGrid(o) {
    var now = App.today().slice(0, 7);
    if (!month || month < now) month = now;
    var grid = ui.monthGrid({
      month: month, min: now, max: shiftMonth(now, 12),
      day: o.day, onPick: o.onPick,
      onMonth: function (ym) { month = ym; if (o.onMonth) o.onMonth(ym); }
    });
    App.live(grid, grid.refresh);      /* a time that passes during the day drops out of "3 left" */
    return grid;
  }

  /* ---------- owner: open weekdays, block all ---------- */

  function bulkSave(btn, errorEl, days, doneText) {
    var fields = { days: days };
    bulkError = '';
    freshSave(btn, fields);
    ui.save(btn, 'setDays', fields, { errorEl: errorEl }).then(function (res) {
      if (res.skipped) return;
      if (res.ok) App.toast(doneText);
      else bulkError = res.error.message;
    });
  }

  function openWeekdays(btn, errorEl) {
    var ym = month, today = App.today(), usual = usualSlots();
    var left = daysOf(ym).filter(function (date) {
      var wd = D.weekday(date);
      return date >= today && wd >= 1 && wd <= 5;
    });
    var days = left.filter(function (date) { var cur = App.dayOf(date); return !(cur && cur.open); });
    if (!left.length) { App.toast('No weekdays are left in ' + monthWord(ym) + '.'); return; }
    if (!days.length) { App.toast('Every weekday left in ' + monthWord(ym) + ' is already open.'); return; }
    bulkSave(btn, errorEl, days.map(function (date) { return { date: date, open: true, slots: usual }; }),
      fmt.plural(days.length, 'weekday') + ' opened in ' + monthWord(ym) + '.');
  }

  function blockAll(btn, errorEl) {
    var ym = month, today = App.today(), booked = 0;
    var days = daysOf(ym).filter(function (date) { var cur = App.dayOf(date); return date >= today && !!cur && cur.open; });
    if (!days.length) { App.toast('No open days are left in ' + monthWord(ym) + '.'); return; }
    days.forEach(function (date) { booked += scheduledOn(date).length; });
    App.confirm({
      title: 'Block all of ' + monthWord(ym) + '?',
      text: 'Reps will not be able to book ' + (days.length === 1 ? 'the 1 open day' : 'any of the ' + days.length + ' open days') + ' left in ' + monthWord(ym) + '.' +
        (booked ? ' The ' + fmt.plural(booked, 'appointment') + ' already booked ' + (booked === 1 ? 'stays' : 'stay') + ' on the schedule.' : ''),
      yes: 'Block all', no: 'Keep them', danger: true
    }).then(function (yes) {
      if (!yes) return;
      bulkSave(btn, errorEl, days.map(function (date) { return { date: date, open: false }; }),
        fmt.plural(days.length, 'day') + ' blocked in ' + monthWord(ym) + '.');
    });
  }

  /* ---------- owner: the Day sheet ---------- */

  function openDay(date) {
    var cur = App.dayOf(date);
    var was = { open: !!(cur && cur.open), slots: ((cur && cur.slots) || []).slice().sort() };
    var open = was.open, adding = false;
    var slots = was.slots.length ? was.slots.slice() : usualSlots();

    var blockedNote = h('div');
    var timesLabel = ui.label('Times');
    var timesEl = h('div', { class: 'stack-md' });
    var bookedLabel = ui.label('Booked this day');
    var bookedEl = h('div', { class: 'stack-md' });
    var timeField = ui.field({ name: 'new-time', type: 'time' });
    timeField.input.setAttribute('aria-label', 'New time');
    var toggle = ui.toggle({ label: 'Open for appointments', checked: open, onChange: function (on) {
      open = on;
      adding = false;
      sheet.error('');
      draw();
    } });

    function addTime() {
      var m = /^(\d{1,2}):(\d{2})/.exec(timeField.input.value || '');
      var time = m ? pad2(+m[1]) + ':' + m[2] : '';
      if (!D.isHM(time)) { timeField.setError('Pick a time first.'); return; }
      if (slots.indexOf(time) >= 0) { timeField.setError(fmt.time(time) + ' is already on the list.'); return; }
      if (slots.length >= LIMITS.slotsPerDay) { timeField.setError('A day can have ' + LIMITS.slotsPerDay + ' times at most.'); return; }
      slots.push(time);
      slots.sort();
      timeField.input.value = '';
      adding = false;
      sheet.error('');
      drawTimes();
    }

    function drawTimes() {
      clear(timesEl);
      if (slots.length) {
        var chips = h('div', { class: 'chips', role: 'group', 'aria-label': 'Times' });
        slots.forEach(function (time) {
          chips.appendChild(h('button', { type: 'button', class: 'chip chip-x', 'aria-label': 'Remove ' + fmt.time(time), onclick: function () {
            slots.splice(slots.indexOf(time), 1);
            drawTimes();
          } }, fmt.time(time), App.icon('close', 16)));
        });
        timesEl.appendChild(chips);
        timesEl.appendChild(h('p', { class: 'hint' }, 'Tap a time to remove it.'));
      } else {
        timesEl.appendChild(h('p', { class: 'muted' }, 'No times on this day yet. Add one, or use your usual times.'));
      }
      timesEl.appendChild(h('div', { class: 'btn-row' },
        ui.button('Add a time', { icon: 'plus', small: true, onTap: function () {
          adding = !adding;
          timeField.setError('');
          drawTimes();
          if (adding) { try { timeField.input.focus(); } catch (e) { /* fine */ } }
        } }),
        ui.button('Use my usual times', { small: true, onTap: function () {
          slots = usualSlots();
          adding = false;
          sheet.error('');
          drawTimes();
        } })));
      if (adding) timesEl.appendChild(h('div', { class: 'cols-2' }, timeField, ui.button('Add', { onTap: addTime })));
    }

    function drawBooked() {
      var jobs = App.jobsOn(date), waiting = jobs.filter(function (j) { return j.status === 'scheduled'; }).length;

      clear(blockedNote);
      blockedNote.hidden = open;
      if (!open && waiting) {
        blockedNote.appendChild(h('div', { class: 'callout callout-warn' },
          h('p', { class: 'callout-title' }, waiting === 1 ? '1 appointment is already booked on this day' : waiting + ' appointments are already booked on this day'),
          h('p', { class: 'small' }, waiting === 1
            ? 'Blocking the day does not cancel it. It stays on the schedule until you move or cancel it.'
            : 'Blocking the day does not cancel them. They stay on the schedule until you move or cancel them.')));
      } else if (!open) {
        blockedNote.appendChild(h('p', { class: 'muted' }, 'This day is blocked. Reps cannot book it.'));
      }

      clear(bookedEl);
      bookedLabel.hidden = bookedEl.hidden = !jobs.length;
      if (!jobs.length) return;
      var list = h('div', { class: 'list' });
      jobs.forEach(function (job) {
        var c = App.client(job.clientId), seller = c ? App.nameOf(c.repId, '') : '';
        list.appendChild(ui.jobRow(job, { sub: seller ? 'Sold by ' + seller : job.what }));
      });
      bookedEl.appendChild(list);
      if (open) bookedEl.appendChild(h('p', { class: 'hint' }, 'Blocking this day does not cancel ' + (jobs.length === 1 ? 'this appointment.' : 'these appointments.')));
    }

    function draw() {
      timesLabel.hidden = timesEl.hidden = !open;
      if (open) drawTimes();
      drawBooked();
    }

    var sheet = App.sheet.open({
      title: fmt.dayLong(date),
      body: function (el) {
        el.appendChild(toggle);
        el.appendChild(blockedNote);
        el.appendChild(timesLabel);
        el.appendChild(timesEl);
        el.appendChild(bookedLabel);
        el.appendChild(bookedEl);
      },
      update: function () { drawBooked(); },       /* someone just booked or moved a job on this day */
      footer: { label: 'Save', onTap: function (sh) {
        if (open && !slots.length) { sh.error('Add at least one time, or switch the day off.'); return; }
        var same = open === was.open && (!open || slots.join() === was.slots.join());
        if (same) { sh.close(); return; }
        var fields = { days: [{ date: date, open: open, slots: slots.slice() }] };
        var booked = scheduledOn(date).length;
        freshSave(sh.button, fields);
        sh.send('setDays', fields).then(function (res) {
          if (!res.ok) return;
          sh.close();
          if (open) App.toast(fmt.day(date) + ' is open with ' + fmt.plural(slots.length, 'time') + '.');
          else App.toast(fmt.day(date) + ' is blocked.' + (booked ? ' The ' + fmt.plural(booked, 'appointment') + ' already booked ' + (booked === 1 ? 'stays' : 'stay') + '.' : ''));
        });
      } }
    });
    draw();
    return sheet;
  }

  /* ---------- owner: the screen ---------- */

  function comingUp() {
    var today = App.today(), last = D.addDays(today, 14);
    return App.data.jobs.filter(function (j) { return j.status === 'scheduled' && j.date > today && j.date <= last; })
      .sort(function (a, b) { return a.date < b.date ? -1 : a.date > b.date ? 1 : a.time < b.time ? -1 : a.time > b.time ? 1 : 0; });
  }

  function renderOwner(root) {
    root.appendChild(ui.title('Availability', 'Tap a day to open it, block it or change its times.'));

    var error = h('p', { class: 'form-error', role: 'alert', hidden: !bulkError }, bulkError);
    root.appendChild(h('div', { class: 'btn-row' },
      ui.button('Open weekdays', { small: true, onTap: function (e, btn) { openWeekdays(btn, error); } }),
      ui.button('Block all', { small: true, onTap: function (e, btn) { blockAll(btn, error); } })));
    root.appendChild(error);

    root.appendChild(monthGrid({ day: dayState, onPick: openDay, onMonth: function () { bulkError = ''; error.hidden = true; } }));
    root.appendChild(legend());

    if (!App.freeDays().length) {
      root.appendChild(ui.empty({ title: 'No days are open for booking.',
        text: 'Your reps cannot book an appointment until you open some. Tap a day, or tap Open weekdays for the rest of the month.' }));
    }

    var jobs = comingUp();
    root.appendChild(ui.label('Coming up', { count: jobs.length || null }));
    if (!jobs.length) { root.appendChild(h('p', { class: 'muted' }, 'Nothing is booked for the next 14 days.')); return; }
    var list = h('div', { class: 'list' });
    jobs.forEach(function (job) {
      list.appendChild(ui.jobRow(job, { showDate: true, pill: false,
        sub: job.assignedTo ? App.nameOf(job.assignedTo, 'Someone') : h('span', { class: 'warn strong' }, 'Unassigned') }));
    });
    root.appendChild(list);
  }

  /* ---------- sales rep: read only ---------- */

  function openRepDay(date) {
    return App.sheet.open({
      title: fmt.dayLong(date), small: true,
      update: function (sh) { sh.rebuild(); },
      footer: { label: 'New sale on this day', onTap: function () { App.act('newSale', { date: date }); } },
      body: function (el, sh) {
        var day = App.dayOf(date), isOpen = !!day && day.open && date >= App.today();
        var free = App.freeSlots(date), mine = App.jobsOn(date);

        if (!isOpen) el.appendChild(h('p', { class: 'muted' }, 'This day is not open for booking any more.'));
        else {
          el.appendChild(ui.label('Free times', { count: free.length || null }));
          if (free.length) {
            var tags = h('div', { class: 'time-tags' });
            free.forEach(function (time) { tags.appendChild(h('span', { class: 'time-tag' }, fmt.time(time))); });
            el.appendChild(tags);
          } else el.appendChild(h('p', { class: 'muted' }, 'No times are left on this day.'));
        }

        if (mine.length) {
          var list = h('div', { class: 'list' });
          mine.forEach(function (job) { list.appendChild(ui.jobRow(job)); });
          el.appendChild(ui.label('Your appointments'));
          el.appendChild(list);
        }
        sh.setButton(free.length ? 'New sale on this day' : null);
      }
    });
  }

  function renderRep(root) {
    root.appendChild(ui.title('Open days', 'Tap an open day to see the times you can book.'));
    root.appendChild(monthGrid({
      day: function (date) {
        var s = dayState(date);
        s.disabled = s.state !== 'open' && s.state !== 'full';
        return s;
      },
      onPick: openRepDay
    }));
    root.appendChild(legend());
    if (!App.freeDays().length) {
      root.appendChild(ui.empty({ title: 'No open days yet.', text: 'You can still save a sale now and book it once Grayson opens some days.' }));
    }
  }

  /* ---------- register ---------- */

  App.screen('calendar', {
    roles: ['owner', 'rep'], title: 'Calendar',
    render: function (root) {
      var me = App.me();
      if (viewer !== me.id) { viewer = me.id; month = null; bulkError = ''; }
      if (me.role === 'owner') renderOwner(root); else renderRep(root);
    }
  });

  /* Each visit to the Calendar starts on the current month. */
  App.on('route', function () { if (App.route !== 'calendar') { month = null; bulkError = ''; } });
})();
