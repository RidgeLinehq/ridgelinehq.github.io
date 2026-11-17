/*
 * Ridgeline Wash Co. team app: the Calendar screen (#calendar).
 *
 * Owner, "Availability": the month grid with how many times are still free on each open day, the
 *   Day sheet (open or block one day and set its times), "Open weekdays", "Block all" and
 *   "Coming up" (the next 14 days of appointments).
 * Sales rep, "Open days": the same grid to read, not change. Tapping an open day shows its open
 *   times and the rep's own appointments, with "New sale on this day". Under the grid,
 *   "My appointments": the rep's own, from today on, for the next 30 days.
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

  function byWhen(a, b) { return a.date < b.date ? -1 : a.date > b.date ? 1 : a.time < b.time ? -1 : a.time > b.time ? 1 : 0; }

  /* One day of the grid, the same for the owner and for reps: open days say how many times are left.
     "Full" (amber) only ever means every time is booked. An open day whose times have simply gone by
     (today, late in the day) says "0 left" in the quiet colour instead: "No times left" is too long for a
     day cell on a small phone, so those words are kept for the day's own sheet. */
  function dayState(date) {
    if (date < App.today()) return { state: 'past', disabled: true };
    var day = App.dayOf(date);
    if (!day || !day.open) return { state: 'blocked' };
    var free = App.freeSlots(date).length;
    if (free) return { state: 'open', label: free + ' left' };
    var slots = day.slots || [], taken = {};
    (App.data.taken || []).forEach(function (t) { if (t.date === date) taken[t.time] = 1; });
    var booked = slots.length > 0 && slots.every(function (time) { return taken[time]; });
    return booked ? { state: 'full', label: 'Full' } : { state: 'spent', label: '0 left' };
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
    /* Say exactly what one tap is about to do: how many days, from when to when, with which times. */
    var span = days.length === 1 ? fmt.day(days[0]) : fmt.dayShort(days[0]) + ' to ' + fmt.dayShort(days[days.length - 1]);
    App.confirm({
      title: 'Open ' + fmt.plural(days.length, 'weekday') + ', ' + span + ', with your usual times?',
      text: 'Your usual times are ' + usual.map(fmt.time).join(', ') + '.' +
        (days.length < left.length ? ' Days that are already open keep the times they have.' : ''),
      yes: days.length === 1 ? 'Open it' : 'Open them', no: 'Cancel'
    }).then(function (yes) {
      if (!yes) return;
      bulkSave(btn, errorEl, days.map(function (date) { return { date: date, open: true, slots: usual }; }),
        fmt.plural(days.length, 'weekday') + ' opened in ' + monthWord(ym) + '.');
    });
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
    var open = was.open, closed = false, addTimer = null;
    var slots = was.slots.length ? was.slots.slice() : usualSlots();

    var blockedNote = h('div');
    var timesLabel = ui.label('Times');
    var chipsEl = h('div', { class: 'stack-sm' });
    var bookedLabel = ui.label('Booked this day');
    var bookedEl = h('div', { class: 'stack-md' });
    /* "Add a time" is the same piece as in Settings, Usual appointment times: a time box with Add beside it. */
    var addError = h('p', { class: 'form-error', role: 'alert', hidden: true });
    var timeField = ui.field({ label: 'Add a time', name: 'new-time', type: 'time', onInput: function () { say(''); } });
    var usualBtn = ui.button('Use my usual times', { kind: 'text', onTap: function () {
      clearTimeout(addTimer);
      slots = usualSlots();
      timeField.input.value = '';
      say('');
      sheet.error('');
      drawTimes();
    } });
    usualBtn.classList.add('btn-start');
    var timesEl = h('div', { class: 'stack-md' }, chipsEl,
      h('div', { class: 'add-row' }, timeField, ui.button('Add', { onTap: function () { addTime(false); } })),
      addError, usualBtn);
    var toggle = ui.toggle({ label: 'Open for appointments', checked: open, onChange: function (on) {
      open = on;
      clearTimeout(addTimer);
      say('');
      sheet.error('');
      draw();
    } });

    function say(message) { addError.textContent = message || ''; addError.hidden = !message; }

    /* Puts the time in the box on the list. Answers false when it cannot go on (the words under the box
       say why). With `quiet`, an empty box, or a time that is already on the list, is nothing to stop for. */
    function addTime(quiet) {
      clearTimeout(addTimer);
      var input = timeField.input, m = /^(\d{1,2}):(\d{2})/.exec(input.value || '');
      var time = m ? pad2(+m[1]) + ':' + m[2] : '';
      if (!time) {
        if (input.validity && input.validity.badInput) { say('That is not a time.'); return false; }   /* half typed */
        if (!quiet) say('Pick a time first.');
        return !!quiet;
      }
      if (!D.isHM(time)) { say('That is not a time.'); return false; }
      if (slots.indexOf(time) >= 0) {
        input.value = '';
        if (!quiet) say(fmt.time(time) + ' is already on the list.');
        return !!quiet;
      }
      if (slots.length >= LIMITS.slotsPerDay) { say('That is the most times a day can hold.'); return false; }
      slots.push(time);
      slots.sort();
      input.value = '';
      say('');
      sheet.error('');
      drawTimes();
      return true;
    }
    /* A time that was picked goes on the list as soon as the box is left, with no need to tap Add. It waits
       a moment first, so the tap that took the finger off the box (Add, Save, a time to remove) lands
       before the list is drawn again. */
    timeField.input.addEventListener('blur', function () {
      clearTimeout(addTimer);
      addTimer = setTimeout(function () {
        if (!closed && open && document.activeElement !== timeField.input) addTime(true);
      }, 250);
    });

    function drawTimes() {
      clear(chipsEl);
      if (slots.length) {
        var chips = h('div', { class: 'chips', role: 'group', 'aria-label': 'Times' });
        slots.forEach(function (time) {
          chips.appendChild(h('button', { type: 'button', class: 'chip chip-x', 'aria-label': 'Remove ' + fmt.time(time), onclick: function () {
            slots.splice(slots.indexOf(time), 1);
            drawTimes();
          } }, fmt.time(time), App.icon('close', 16)));
        });
        chipsEl.appendChild(chips);
        chipsEl.appendChild(h('p', { class: 'hint' }, 'Tap a time to remove it.'));
        /* The grid says "0 left" for this day: say why, in full. */
        if (dayState(date).state === 'spent') chipsEl.appendChild(h('p', { class: 'muted' }, 'No times left today. The ones that were not booked have passed.'));
      } else {
        chipsEl.appendChild(h('p', { class: 'muted' }, 'No times on this day yet. Add one, or use your usual times.'));
      }
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
        /* Who sold it is on the sale; an appointment booked later with no sale goes by the client's own rep. */
        var sale = job.saleId ? App.sale(job.saleId) : null, c = App.client(job.clientId);
        var seller = App.nameOf(sale ? sale.repId : c ? c.repId : null, '');
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
      update: function () { drawBooked(); },       /* someone just booked or moved an appointment on this day */
      onClose: function () { closed = true; clearTimeout(addTimer); },
      footer: { label: 'Save', onTap: function (sh) {
        /* A time still sitting in the box is added first: picking it and tapping Save must not lose it. */
        if (open && !addTime(true)) { sh.error(''); sh.reveal(timesLabel); return; }
        if (open && !slots.length) { sh.error('Add at least one time, or switch the day off.'); return; }
        var same = open === was.open && (!open || slots.join() === was.slots.join());
        if (same) { sh.close(); return; }
        var fields = { days: [{ date: date, open: open, slots: slots.slice() }] };
        var booked = scheduledOn(date).length;
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

  /* The appointments this person can see that are still scheduled, from one day through another, soonest first.
     Both lists of what is still to come (the owner's "Coming up", a rep's "My appointments") are drawn by App.ui.comingUp. */
  function scheduledBetween(from, to) {
    return App.data.jobs.filter(function (j) { return j.status === 'scheduled' && j.date >= from && j.date <= to; }).sort(byWhen);
  }

  /* ---------- owner: the screen ---------- */

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
      root.appendChild(ui.empty({ title: 'No days are open.',
        text: 'Your reps cannot book an appointment until you open some. Tap a day, or tap Open weekdays for the rest of the month.' }));
    }

    var today = App.today(), jobs = scheduledBetween(D.addDays(today, 1), D.addDays(today, 14));
    root.appendChild(ui.label('Coming up', { count: jobs.length || null }));
    root.appendChild(ui.comingUp(jobs, { empty: 'Nothing is booked for the next 14 days.', who: true }));
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

        if (!isOpen) el.appendChild(h('p', { class: 'muted' }, 'This day is not open any more.'));
        else {
          /* Words, not tiles: these are for reading. The times that can be tapped are in New sale. */
          el.appendChild(ui.label('Open times', { count: free.length || null }));
          el.appendChild(free.length
            ? h('p', { class: 'num' }, free.map(fmt.time).join(', '))
            : h('p', { class: 'muted' }, 'No times left on this day. Pick another day.'));
        }

        if (mine.length) {
          var list = h('div', { class: 'list' });
          mine.forEach(function (job) { list.appendChild(ui.jobRow(job)); });
          el.appendChild(ui.label('My appointments'));
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
        s.disabled = s.state !== 'open' && s.state !== 'full' && s.state !== 'spent';
        return s;
      },
      onPick: openRepDay
    }));
    root.appendChild(legend());
    if (!App.freeDays().length) {
      root.appendChild(ui.empty({ title: 'No open days yet.', text: 'You can still save a sale now and book it once ' + App.ownerName() + ' opens some days.' }));
    }

    /* The rep's own appointments, from today on, so the one to move or check is one tap away. */
    var today = App.today(), jobs = scheduledBetween(today, D.addDays(today, 30));
    root.appendChild(ui.label('My appointments', { count: jobs.length || null }));
    root.appendChild(ui.comingUp(jobs, { empty: 'You have nothing booked for the next 30 days.', who: false }));
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

  /* Each time the Calendar is opened it starts on the current month. */
  App.on('route', function () { if (App.route !== 'calendar') { month = null; bulkError = ''; } });
})();
