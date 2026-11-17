/*
 * Ridgeline Wash Co. team app: the owner's side, and the techs' Schedule.
 *
 *   #dashboard (owner)      Needs attention, the numbers, the leaderboard, Coming up
 *   #schedule  (tech)       jobs from tomorrow on by day, then the last ones finished
 *   App.actions.openNotices()      the Notifications sheet (the bell); a notice opens what it is about
 *   App.actions.openTeam()         the Team sheet: add, rename, role, Reset PIN, Remove
 *   App.actions.openSettings()     the Settings sheet: services, commission, usual times,
 *                                  who gets new jobs, email alerts, company standards
 *   App.actions.editStandards()    the Edit standards sheet
 *
 * Everything is read from App.data on every render; the only things kept here are view choices.
 */
(function () {
  'use strict';

  var h = App.h, ui = App.ui, fmt = App.fmt;
  var Core = RidgelineCore, D = Core.dates, LIMITS = Core.LIMITS;

  var ROLE_WORDS = { owner: 'Owner', rep: 'Sales rep', tech: 'Tech' };
  var ROLE_HELP = {
    rep: 'Enters their own sales and books the appointments.',
    tech: 'Sees the jobs given to them and marks them done.',
    owner: 'Sees and controls everything, like you.'
  };
  var ROLE_ORDER = ['rep', 'tech', 'owner'];
  var NAME_TAKEN = 'Someone on the team already has that name. Add a last initial.';
  var PRICE_HELP = 'Enter the price in dollars, like 150 or 150.50.';
  var PIN_HELP = 'A PIN is 6 digits.';
  var OWED_LABEL = 'Commission owed';        /* this month's, like the other numbers; short enough to stay on one line */

  /* ================= small helpers ================= */

  function clear(el) { el.textContent = ''; return el; }
  function byWhen(a, b) { return a.date < b.date ? -1 : a.date > b.date ? 1 : a.time < b.time ? -1 : a.time > b.time ? 1 : 0; }
  function byName(a, b) {
    var x = String(a.name || '').toLowerCase(), y = String(b.name || '').toLowerCase();
    return x < y ? -1 : x > y ? 1 : 0;
  }
  function norm(s) { return String(s == null ? '' : s).replace(/\s+/g, ' ').trim().toLowerCase(); }
  /* One line of text the way the system will store it. */
  function oneLine(s) { return String(s == null ? '' : s).replace(/[\u0000-\u001f\u007f]/g, ' ').replace(/\s+/g, ' ').trim(); }
  function sum(list, pick) { var t = 0; list.forEach(function (x) { t += pick(x); }); return t; }

  /* "A", "A and B", "A, B and 2 more" */
  function names(list) {
    if (list.length <= 2) return list.join(' and ');
    return list[0] + ', ' + list[1] + ' and ' + (list.length - 2) + ' more';
  }
  function priceLine(service, cents, billing) {
    return (service || 'Service') + ', ' + fmt.money(cents) + (billing === 'monthly' ? ' a month' : ' one-time');
  }
  function whenWords(job) {
    return job.date === App.today() ? 'today at ' + fmt.time(job.time) : fmt.when(job.date, job.time);
  }
  function pctText(n) { return String(Math.round((+n || 0) * 100) / 100) + '%'; }
  /* The same sum the system does: pct percent of a price, in whole cents. */
  function share(cents, pct) { return Math.round(cents * Math.round((pct || 0) * 100) / 10000); }

  function openClient(id) { App.act('openClient', id); }
  /* A client who needs an appointment opens at their Jobs, where "Book an appointment" is. */
  function openClientJobs(id) { App.act('openClient', { id: id, show: 'jobs' }); }
  /* A sale that is waiting opens as the sale itself: "Book the appointment" is right there. */
  function openSale(id) { App.act('openSale', id); }

  /* A small sheet that lists a few things, each of which opens something. It stays current. */
  function openList(title, build) {
    App.sheet.open({
      title: title, small: true,
      update: function (sh) { sh.rebuild(); },
      body: function (el) {
        var rows = build();
        if (!rows.length) { el.appendChild(h('p', { class: 'muted' }, 'Nothing left here.')); return; }
        var list = h('div', { class: 'list' });
        rows.forEach(function (row) { list.appendChild(row); });
        el.appendChild(list);
      }
    });
  }

  /* A field with something at its right edge (the "%" in Commission). */
  function withSuffix(field, text) {
    var wrap = h('span', { class: 'input-wrap has-suffix' });
    field.insertBefore(wrap, field.input);
    wrap.appendChild(field.input);
    wrap.appendChild(h('span', { class: 'input-suffix', 'aria-hidden': 'true' }, text));
    return field;
  }

  /* ================= Dashboard: needs attention ================= */

  function lateClients() {
    return App.data.clients.filter(function (c) { return c.payStatus === 'late'; }).sort(byName);
  }
  function overdueJobs() { return App.data.jobs.filter(App.isOverdue).sort(byWhen); }
  function looseJobs() {
    return App.data.jobs.filter(function (j) { return j.status === 'scheduled' && !j.assignedTo; }).sort(byWhen);
  }
  /* A sale is waiting while nothing was booked for it: not with the sale, and not for that client since. */
  function waitingSales() {
    var d = App.data;
    return d.sales.filter(function (s) {
      if (s.jobId) return false;
      var c = App.client(s.clientId);
      if (c && c.status === 'Cancelled') return false;
      return !d.jobs.some(function (j) {
        return j.clientId === s.clientId && j.status !== 'cancelled' && !j.saleId && (j.createdAt || 0) >= (s.soldAt || 0);
      });
    }).sort(function (a, b) { return (a.soldAt || 0) - (b.soldAt || 0); });
  }

  /* A New or Active monthly client with nothing booked from today on. One whose sale is still waiting for its
     first appointment is already in the row above, so it is not counted twice. */
  function monthlyWithNoNext(waiting) {
    var test = App.needsAppointment, held = {};
    if (!test) return [];
    (waiting || waitingSales()).forEach(function (s) { held[s.clientId] = true; });
    return App.data.clients.filter(function (c) { return !held[c.id] && test(c); }).sort(byName);
  }

  function lateRows() {
    return lateClients().map(function (c) {
      return ui.row({ title: c.name, sub: priceLine(c.service, c.priceCents, c.billing), right: ui.payPill('late'),
        onTap: function () { openClient(c.id); } });
    });
  }
  function jobRows(pick) {
    /* Only an overdue job carries its pill here: the sheet's title already says what the rest are. */
    return function () {
      return pick().map(function (j) { return ui.jobRow(j, App.isOverdue(j) ? { showDate: true } : { showDate: true, pill: false }); });
    };
  }
  function waitingRows() {
    return waitingSales().map(function (s) {
      return ui.row({ title: s.clientName || 'Client',
        sub: [priceLine(s.service, s.priceCents, s.billing), 'Sold ' + fmt.dayShort(s.day) + ' by ' + App.nameOf(s.repId, 'someone')],
        onTap: function () { openSale(s.id); } });
    });
  }

  function noNextRows() {
    return monthlyWithNoNext().map(function (c) {
      return ui.row({ title: c.name, sub: priceLine(c.service, c.priceCents, c.billing), onTap: function () { openClientJobs(c.id); } });
    });
  }

  /* The count that leads a row, in the color of its state (the words beside it say what it is). */
  function count(n, tone) { return h('span', { class: 'rank' }, h('span', { class: tone }, String(n))); }

  /* What went wrong, in plain words first. What the system itself reported goes under it, small. */
  var PROBLEM_WORDS = {
    email: 'An email alert could not be sent.',
    sync: 'Something went wrong while getting the latest.',
    login: 'Something went wrong while someone was signing in.'
  };
  function problemWords(p) {
    var known = Object.prototype.hasOwnProperty.call(PROBLEM_WORDS, p.where) ? PROBLEM_WORDS[p.where] : '';
    var raw = String(p.message == null ? '' : p.message);
    if (p.where === 'email') raw = raw.replace(/^An email alert could not be sent:\s*/, '');
    return { say: known || 'Something went wrong while saving.', raw: raw };
  }

  function problemsRow(problems) {
    var shown = problems.slice(0, 3), more = problems.length - shown.length;
    var lines = h('span', { class: 'stack-sm' });
    shown.forEach(function (p) {
      var w = problemWords(p);
      lines.appendChild(h('span', { class: 'stack-xs' },
        h('span', { class: 'problem-say' }, w.raw ? w.say + ' Details:' : w.say),
        w.raw ? h('span', { class: 'problem-raw' }, w.raw) : null,
        h('span', { class: 'hint' }, fmt.stamp(p.at))));
    });
    if (more > 0) lines.appendChild(h('span', { class: 'hint' }, 'And ' + fmt.plural(more, 'older one') + '.'));
    var clearBtn = ui.button('Clear', { kind: 'text', small: true, onTap: function (e, btn) {
      ui.save(btn, 'clearProblems', {}, { busyText: 'Clearing...' }).then(function (res) { if (res.ok) App.toast('Cleared.'); });
    } });
    return ui.row({ lead: count(problems.length, 'bad'), title: problems.length === 1 ? 'System problem' : 'System problems',
      sub: lines, right: clearBtn, chevron: false, cls: 'row-top' });
  }

  function attentionRows() {
    var d = App.data, today = d.today, rows = [];
    var late = lateClients(), overdue = overdueJobs(), loose = looseJobs(), waiting = waitingSales();
    var noNext = monthlyWithNoNext(waiting);

    if (late.length) {
      rows.push(ui.row({ lead: count(late.length, 'bad'), title: late.length === 1 ? 'Late payment' : 'Late payments',
        sub: names(late.map(function (c) { return c.name; })),
        onTap: function () { if (late.length === 1) openClient(late[0].id); else openList('Late payments', lateRows); } }));
    }
    if (overdue.length) {
      rows.push(ui.row({ lead: count(overdue.length, 'bad'), title: overdue.length === 1 ? 'Overdue job' : 'Overdue jobs',
        sub: overdue.length === 1
          ? ((overdue[0].client || {}).name || 'A job') + ', was due ' + fmt.day(overdue[0].date)
          : names(overdue.map(function (j) { return (j.client || {}).name || 'A job'; })),
        onTap: function () { if (overdue.length === 1) ui.openJob(overdue[0].id); else openList('Overdue jobs', jobRows(overdueJobs)); } }));
    }
    if (loose.length) {
      rows.push(ui.row({ lead: count(loose.length, 'warn'), title: loose.length === 1 ? 'Job with nobody assigned' : 'Jobs with nobody assigned',
        sub: loose.length === 1
          ? ((loose[0].client || {}).name || 'A job') + ', ' + whenWords(loose[0])
          : names(loose.map(function (j) { return (j.client || {}).name || 'A job'; })),
        onTap: function () { if (loose.length === 1) ui.openJob(loose[0].id); else openList('Nobody assigned', jobRows(looseJobs)); } }));
    }
    if (waiting.length) {
      rows.push(ui.row({ lead: count(waiting.length, 'warn'), title: waiting.length === 1 ? 'Sale waiting for an appointment' : 'Sales waiting for an appointment',
        sub: names(waiting.map(function (s) { return s.clientName || 'A client'; })),
        onTap: function () { if (waiting.length === 1) openSale(waiting[0].id); else openList('Waiting for an appointment', waitingRows); } }));
    }
    if (noNext.length) {
      rows.push(ui.row({ lead: count(noNext.length, 'warn'),
        title: noNext.length === 1 ? 'Monthly client with no next appointment' : 'Monthly clients with no next appointment',
        sub: names(noNext.map(function (c) { return c.name; })),
        onTap: function () { if (noNext.length === 1) openClientJobs(noNext[0].id); else openList('No next appointment', noNextRows); } }));
    }

    var end = D.addDays(today, 6);
    var free = App.freeDays().filter(function (date) { return date <= end; });
    if (!free.length) {
      var anyOpen = (d.days || []).some(function (x) { return x.open && x.date >= today && x.date <= end; });
      rows.push(ui.row({ lead: count(0, 'warn'),
        title: anyOpen ? 'Open times in the next 7 days' : 'Open days in the next 7 days',
        sub: anyOpen ? 'No open day has a time left. Open more so your reps can book.' : 'Your reps cannot book until you open some.',
        onTap: function () { App.go('calendar'); } }));
    }

    var problems = (d.problems || []).slice().sort(function (a, b) { return (b.at || 0) - (a.at || 0); });
    if (problems.length) rows.push(problemsRow(problems));

    if (!rows.length) {
      rows.push(ui.row({ lead: h('span', { class: 'good' }, App.icon('check-circle', 24)), title: 'All clear.' }));
    }
    return rows;
  }

  /* ================= Dashboard: numbers, leaderboard, coming up ================= */

  function statGrid(items) {
    var el = h('div', { class: 'stat-grid dash-nums' });
    items.forEach(function (it) {
      el.appendChild(h('div', { class: 'stat' }, h('span', { class: 'stat-num' }, it.value), h('span', { class: 'stat-label' }, it.label)));
    });
    return el;
  }

  /* Revenue is money due in the period. Every commission event of a sale is one payment of its price (the
     first, then each month a monthly client was kept), so the price counts once for each event dated from
     `from` on. An event is never dated after today. */
  function revenueFrom(from) {
    return sum(App.data.sales, function (s) {
      var paid = (s.events || []).filter(function (e) { return e.day >= from; }).length;
      return paid * (s.priceCents || 0);
    });
  }

  function numbers() {
    var d = App.data, wk = D.weekStart(d.today), mo = D.monthStart(d.today);
    var week = d.sales.filter(function (s) { return s.day >= wk; }).length;      /* sales made in the period */
    var month = d.sales.filter(function (s) { return s.day >= mo; }).length;
    var owed = sum(d.sales, function (s) { return Core.calc.sumEvents(s.events || [], mo, null); });
    var active = d.clients.filter(function (c) { return c.status === 'Active'; }).length;
    return statGrid([
      { value: String(week), label: 'Sales this week' },
      { value: fmt.moneyShort(revenueFrom(wk)), label: 'Revenue this week' },
      { value: String(month), label: 'Sales this month' },
      { value: fmt.moneyShort(revenueFrom(mo)), label: 'Revenue this month' },
      { value: String(active), label: 'Active clients' },
      { value: fmt.moneyShort(owed), label: OWED_LABEL }
    ]);
  }

  /* The next 7 days of appointments, drawn by the one shared "Coming up" list. */
  function comingJobs() {
    var d = App.data, end = D.addDays(d.today, 7);
    return d.jobs.filter(function (j) { return j.status === 'scheduled' && j.date > d.today && j.date <= end; }).sort(byWhen);
  }

  function renderDashboard(root) {
    root.appendChild(ui.title('Dashboard'));

    root.appendChild(ui.label('Needs attention'));
    var attention = h('div', { class: 'list' });
    attentionRows().forEach(function (row) { attention.appendChild(row); });
    root.appendChild(attention);

    root.appendChild(ui.label('Numbers'));
    root.appendChild(numbers());

    root.appendChild(ui.label('Leaderboard'));
    var board = h('div');
    root.appendChild(board);
    ui.leaderboard(board, { showCommission: true });

    var coming = comingJobs();
    root.appendChild(ui.label('Coming up', { count: coming.length || null }));
    root.appendChild(ui.comingUp(coming, { empty: 'Nothing is booked for the next 7 days.' }));
  }

  /* ================= Schedule (techs) ================= */

  function renderSchedule(root) {
    var d = App.data, today = d.today, tomorrow = D.addDays(today, 1);
    var ahead = d.jobs.filter(function (j) { return j.status === 'scheduled' && j.date > today; }).sort(byWhen);
    var done = d.jobs.filter(function (j) { return j.status === 'done'; })
      .sort(function (a, b) { return (b.doneAt || 0) - (a.doneAt || 0); }).slice(0, 10);

    root.appendChild(ui.title('Schedule', 'Your jobs from tomorrow on.'));

    if (!ahead.length) {
      var left = App.jobsOn(today).filter(function (j) { return j.status === 'scheduled'; }).length;
      root.appendChild(ui.empty(left
        ? { title: 'No jobs coming up.', text: 'You still have ' + fmt.plural(left, 'job') + ' to do today.', button: { label: 'Go to Today', onTap: function () { App.go('today'); } } }
        : { title: 'No jobs coming up.', text: 'New jobs show up here as soon as they are given to you.' }));
    } else if (ahead[0].date !== tomorrow) {
      /* The list starts later than tomorrow: say that tomorrow is free, so nobody has to work it out from a date. */
      root.appendChild(ui.label('Tomorrow, ' + fmt.day(tomorrow)));
      root.appendChild(h('p', { class: 'muted' }, 'No jobs tomorrow.'));
    }
    var list = null, day = '';
    ahead.forEach(function (j) {
      if (j.date !== day) {
        day = j.date;
        root.appendChild(ui.label((day === tomorrow ? 'Tomorrow, ' : '') + fmt.day(day)));
        list = h('div', { class: 'list' });
        root.appendChild(list);
      }
      list.appendChild(ui.jobRow(j, { pill: false }));
    });

    if (done.length) {
      root.appendChild(ui.label('Recently done'));
      var doneList = h('div', { class: 'list' });
      done.forEach(function (j) { doneList.appendChild(ui.jobRow(j, { showDate: true, pill: false })); });   /* the label says they are done */
      root.appendChild(doneList);
    }
  }

  /* ================= Notifications ================= */

  /* A notice is saved as a sentence. Ones written before the system used the app's own way of writing a day,
     a time and an amount are shown that way here: "Thu, Nov 19 at 9:30 AM" and "$1,250.00". */
  function noticeText(text) {
    return String(text == null ? '' : text)
      .replace(/\b(Sun|Mon|Tue|Wed|Thu|Fri|Sat) (Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec) (\d{1,2}), (\d{1,2}:\d{2} [AP]M)/g, '$1, $2 $3 at $4')
      .replace(/\. Booked (?=(Sun|Mon|Tue|Wed|Thu|Fri|Sat), )/g, '. Booked for ')
      .replace(/\$(\d{4,})(?=\.\d{2}(?!\d))/g, function (m, digits) { return '$' + digits.replace(/\B(?=(\d{3})+(?!\d))/g, ','); });
  }

  /* What a notice opens, or null when there is nothing to open. A notice about a client opens that client
     (the one whose name it carries: the longest name wins, and never the name the sentence starts with, which
     is who did it); a paused sign-in opens that person; someone reading the standards opens Team. */
  function noticeTarget(n) {
    var d = App.data, text = String(n.text || '');
    if (n.type === 'signin') {
      var who = /wrong PIN for (.+) \d+ times\./.exec(text);
      var m = who ? App.people().filter(function (x) { return x.name === who[1]; })[0] : null;
      return m ? function () { openPerson(m.id); } : App.actions.openTeam;
    }
    if (n.type === 'standards') return App.actions.openTeam;
    if (n.type !== 'booking' && n.type !== 'sale' && n.type !== 'done') return null;
    var c = n.clientId ? App.client(n.clientId) : null;
    if (!c) {
      (d.clients || []).forEach(function (x) {
        if (x.name && text.indexOf(x.name, 1) > 0 && (!c || x.name.length > c.name.length)) c = x;
      });
    }
    return c ? function () { openClient(c.id); } : null;
  }

  App.actions.openNotices = function () {
    var me = App.me();
    if (!me || me.role !== 'owner') return;
    var seenAt = me.noticesSeenAt || 0, marking = false;   /* what was new when the sheet opened stays marked while it is open */

    function markRead() {
      var now = App.me();
      if (marking || !now) return;
      var unread = (App.data.notices || []).some(function (n) { return n.at > (now.noticesSeenAt || 0); });
      if (!unread) return;
      marking = true;
      App.api.send('readNotices', {}).then(function () { marking = false; });
    }

    var sheet = App.sheet.open({
      title: 'Notifications',
      update: function (sh) { sh.rebuild(); markRead(); },
      onClose: function () { if (stopClock) stopClock(); },
      body: function (el) {
        var list = ((App.data && App.data.notices) || []).slice().sort(function (a, b) { return (b.at || 0) - (a.at || 0); });
        if (!list.length) {
          el.appendChild(ui.empty({ title: 'No notifications yet.', text: 'New sales, appointments and finished jobs show up here.' }));
          return;
        }
        var rows = h('div', { class: 'list' });
        list.forEach(function (n) {
          var fresh = n.at > seenAt;
          rows.appendChild(ui.row({
            lead: h('span', { class: 'notice-dot' + (fresh ? ' is-new' : ''), role: fresh ? 'img' : null, 'aria-label': fresh ? 'New' : null }),
            title: noticeText(n.text),
            sub: fmt.ago(n.at),
            cls: 'notice' + (fresh ? ' is-new' : ''),
            onTap: noticeTarget(n)
          }));
        });
        el.appendChild(rows);
      }
    });
    var stopClock = App.on('tick', function () { sheet.rebuild(); });   /* "5 min ago" keeps up while the sheet is open */
    markRead();
  };

  /* ================= Team ================= */

  function readLine(m) {
    if (!m || m.role === 'owner') return null;
    if (App.hasRead(m)) return h('span', { class: 'good' }, 'Read the standards ' + fmt.date(m.standardsAckAt));
    return h('span', { class: 'warn' }, m.standardsAckAt ? 'Has not read the changed standards yet' : 'Standards not read yet');
  }

  function nameProblem(name, exceptId) {
    if (!name) return 'Add a name.';
    var clash = App.people().some(function (t) { return t.id !== exceptId && norm(t.name) === norm(name); });
    return clash ? NAME_TAKEN : '';
  }

  /* The new PIN, shown once. Six digits are easier to read out as two threes, so there is a small gap in the
     middle; the text itself is still the six digits in a row. */
  function pinBox(name, pin) {
    var digits = pin.length === 6 ? [h('span', null, pin.slice(0, 3)), h('span', null, pin.slice(3))] : pin;
    return h('div', { class: 'callout callout-ice' },
      h('p', { class: 'callout-title' }, 'PIN for ' + name),
      h('p', { class: 'callout-big pin-shown' }, digits),
      h('p', { class: 'small muted' }, 'Tell them in person. It is not shown again.'));
  }

  function drawTeam(el) {
    var me = App.me();
    [['owner', 'Owners'], ['rep', 'Sales reps'], ['tech', 'Techs']].forEach(function (group) {
      var people = App.people([group[0]]).sort(byName);
      el.appendChild(ui.label(group[1]));
      if (!people.length) { el.appendChild(h('p', { class: 'muted' }, 'Nobody yet.')); return; }
      var list = h('div', { class: 'list' });
      people.forEach(function (m) {
        list.appendChild(ui.row({
          lead: h('span', { class: 'avatar' }, fmt.initials(m.name)),
          title: m.name, sub: readLine(m),
          right: m.id === me.id ? ui.pill('You', 'ice') : null,
          onTap: function () { openPerson(m.id); }
        }));
      });
      el.appendChild(list);
    });
  }

  App.actions.openTeam = function () {
    if (App.role() !== 'owner') return;
    App.sheet.open({
      title: 'Team',
      update: function (sh) { sh.rebuild(); },
      body: drawTeam,
      footer: { label: 'Add person', onTap: function () { openAddPerson(); } }
    });
  };

  function openAddPerson() {
    var name, pin, role, roleHint, added = null;

    function form(el, sh) {
      role = 'rep';
      name = ui.field({ label: 'Name', name: 'new-name', maxlength: 40, autocapitalize: 'words', hint: 'This is the name they type to sign in.' });
      roleHint = h('p', { class: 'field-hint' }, ROLE_HELP[role]);
      var seg = ui.segmented({ label: 'Role', value: role,
        options: ROLE_ORDER.map(function (r) { return { value: r, label: ROLE_WORDS[r] }; }),
        onChange: function (v) { role = v; roleHint.textContent = ROLE_HELP[v]; } });
      pin = ui.field({ label: 'PIN', name: 'new-pin', optional: true, inputmode: 'numeric', maxlength: 6,
        hint: '6 digits. Leave it blank and one is made for them.' });
      clear(el);
      el.appendChild(name);
      el.appendChild(h('div', { class: 'field' }, h('span', { class: 'field-label' }, 'Role'), seg, roleHint));
      el.appendChild(pin);
      sh.setTitle('Add person');
      sh.setButton('Add person');
    }

    /* Saved: the same view as "Sale saved", built from the same pieces (.sold-head and .sold-title are that
       view's own classes). A big check and what was saved, the one more thing to do as a quiet button, and
       Done as the sheet's button. */
    function done(el, sh) {
      clear(el);
      el.appendChild(h('div', { class: 'sold-head' }, App.icon('check-circle', 40), h('h3', { class: 'sold-title' }, 'Person added')));
      el.appendChild(h('p', { class: 'muted' }, added.name + ' is on the team. They sign in with the name ' + added.name + ' and this PIN.'));
      el.appendChild(pinBox(added.name, added.pin));
      el.appendChild(ui.button('Add another person', { block: true, icon: 'plus', onTap: function () { added = null; form(el, sh); } }));
      sh.setButton('Done');
      sh.body.scrollTop = 0;
    }

    App.sheet.open({
      title: 'Add person',
      body: function (el, sh) { form(el, sh); },
      footer: { label: 'Add person', onTap: function (sh) {
        if (added) { sh.close(); return; }
        var n = oneLine(name.val()), p = pin.val();
        var problem = nameProblem(n, null);
        if (problem) { name.setError(problem); sh.reveal(name); return; }
        if (p && !/^\d{6}$/.test(p)) { pin.setError(PIN_HELP); sh.reveal(pin); return; }
        sh.send('saveMember', { member: { name: n, role: role, pin: p } }).then(function (res) {
          if (!res.ok) return;
          added = { name: n, pin: String((res.result && res.result.pin) || p) };
          done(sh.body, sh);
        });
      } }
    });
  }

  function openPin(name, pin) {
    App.sheet.open({
      title: 'New PIN', small: true,
      body: function (el) {
        el.appendChild(h('p', { class: 'muted' }, 'The old PIN no longer works. ' + name + ' signs in again with this one.'));
        el.appendChild(pinBox(name, pin));
      },
      footer: { label: 'Done', onTap: function (sh) { sh.close(); } }
    });
  }

  function resetPin(m, rowEl, errorEl) {
    App.confirm({
      title: 'Reset the PIN for ' + m.name + '?',
      text: 'Their old PIN stops working and they are signed out. You get a new one to give them.',
      yes: 'Reset PIN'
    }).then(function (yes) {
      if (!yes) return;
      ui.save(rowEl, 'resetPin', { id: m.id }, { errorEl: errorEl }).then(function (res) {
        if (res.ok && res.result && res.result.pin) openPin(m.name, String(res.result.pin));
      });
    });
  }

  function removePerson(m, btn, errorEl, sh) {
    var open = App.data.jobs.filter(function (j) { return j.assignedTo === m.id && j.status === 'scheduled'; }).length;
    App.confirm({
      title: 'Remove ' + m.name + ' from the team?',
      text: 'They can no longer sign in. Their sales history stays. ' + (open
        ? 'Their ' + fmt.plural(open, 'open job') + (open === 1 ? ' becomes' : ' become') + ' unassigned.'
        : 'Any open jobs they have become unassigned.'),
      yes: 'Remove', danger: true
    }).then(function (yes) {
      if (!yes) return;
      ui.save(btn, 'removeMember', { id: m.id }, { errorEl: errorEl }).then(function (res) {
        if (!res.ok) return;
        sh.close();
        App.toast(m.name + ' is no longer on the team.' + (open ? ' ' + fmt.plural(open, 'job') + (open === 1 ? ' needs' : ' need') + ' someone new.' : ''));
      });
    });
  }

  function openRename(id) {
    var m = App.member(id);
    if (!m) return;
    var mine = id === App.me().id;
    var box = ui.field({ label: 'Name', name: 'person-name', value: m.name, maxlength: 40, autocapitalize: 'words',
      hint: mine ? 'This is the name you type to sign in.' : 'This is the name they type to sign in.' });
    App.sheet.open({
      title: 'Change name', small: true,
      body: function (el) { el.appendChild(box); },
      footer: { label: 'Save', onTap: function (sh) {
        var now = App.member(id), n = oneLine(box.val());
        if (!now || !now.active) { sh.close(); return; }
        var problem = nameProblem(n, id);
        if (problem) { box.setError(problem); return; }
        if (n === now.name) { sh.close(); return; }
        sh.send('saveMember', { member: { id: id, name: n, role: now.role } }).then(function (res) {
          if (!res.ok) return;
          sh.close();
          App.toast('Name changed.');
        });
      } }
    });
  }

  function openRole(id) {
    App.sheet.open({
      title: 'Change role', small: true,
      update: function (sh) { sh.rebuild(); },
      body: function (el, sh) {
        var m = App.member(id);
        if (!m || !m.active) { el.appendChild(h('p', { class: 'muted' }, 'That person is no longer on the team.')); return; }
        var list = h('div', { class: 'list' });
        ROLE_ORDER.forEach(function (r) {
          list.appendChild(ui.row({
            title: ROLE_WORDS[r], sub: ROLE_HELP[r], chevron: false,
            right: m.role === r ? h('span', { class: 'ice' }, App.icon('check', 22)) : null,
            onTap: function (e, rowEl) {
              if (m.role === r) { sh.close(); return; }
              /* A sales rep is never given jobs, so the ones this person still has go back to nobody. Say so first. */
              var open = r === 'rep' ? App.data.jobs.filter(function (j) { return j.assignedTo === id && j.status === 'scheduled'; }).length : 0;
              function change() {
                sh.send('saveMember', { member: { id: id, name: m.name, role: r } }, { button: rowEl }).then(function (res) {
                  if (!res.ok) return;
                  sh.close();
                  App.toast(m.name + ' is now ' + (r === 'owner' ? 'an owner' : r === 'rep' ? 'a sales rep' : 'a tech') + '. ' +
                    (open ? fmt.plural(open, 'job') + (open === 1 ? ' needs' : ' need') + ' someone new.' : 'They need to sign in again.'));
                });
              }
              if (!open) { change(); return; }
              App.confirm({
                title: 'Make ' + m.name + ' a sales rep?',
                text: 'Sales reps are not given jobs. Their ' + fmt.plural(open, 'open job') + (open === 1 ? ' becomes' : ' become') + ' unassigned.',
                yes: 'Change role'
              }).then(function (yes) { if (yes) change(); });
            }
          }));
        });
        el.appendChild(list);
        el.appendChild(h('p', { class: 'hint' }, 'Changing the role signs them out. Their PIN stays the same.'));
      }
    });
  }

  function openPerson(id) {
    var first = App.member(id);
    if (!first || !first.active) { App.toast('That person is no longer on the team.'); return; }
    App.sheet.open({
      title: first.name,
      update: function (sh) {
        var now = App.member(id);
        if (!now || !now.active) { sh.close(); return; }
        sh.setTitle(now.name);
        sh.rebuild();
      },
      body: function (el, sh) {
        var m = App.member(id), me = App.me();
        if (!m || !me) return;
        var mine = m.id === me.id, read = readLine(m);
        el.appendChild(h('div', { class: 'me-head' },
          h('span', { class: 'avatar avatar-lg' }, fmt.initials(m.name)),
          h('div', { class: 'stack-xs' },
            h('p', { class: 'me-name' }, m.name),
            h('p', { class: 'muted' }, ROLE_WORDS[m.role] || ''),
            read ? h('p', { class: 'small strong' }, read) : null)));

        var list = h('div', { class: 'list' });
        var error = h('p', { class: 'form-error', role: 'alert', hidden: true });
        list.appendChild(ui.row({ icon: 'edit', title: 'Change name', onTap: function () { openRename(id); } }));
        if (!mine) {
          list.appendChild(ui.row({ icon: 'user', title: 'Change role', right: ROLE_WORDS[m.role] || '', onTap: function () { openRole(id); } }));
          list.appendChild(ui.row({ icon: 'key', title: 'Reset PIN', chevron: false, onTap: function (e, rowEl) { resetPin(m, rowEl, error); } }));
        }
        el.appendChild(list);
        el.appendChild(error);

        if (mine) {
          el.appendChild(h('p', { class: 'hint' }, 'This is you. To change your own PIN, tap your initials at the top left, then Change PIN.'));
          return;
        }
        el.appendChild(h('p', { class: 'hint' }, 'Lost phone? Reset their PIN. It signs them out everywhere.'));
        var removeError = h('p', { class: 'form-error', role: 'alert', hidden: true });
        el.appendChild(ui.button('Remove from team', { kind: 'danger', block: true, onTap: function (e, btn) { removePerson(m, btn, removeError, sh); } }));
        el.appendChild(removeError);
      }
    });
  }

  /* ================= Settings ================= */

  function slotsText(slots) { return (slots || []).map(fmt.time).join(', '); }

  App.actions.openSettings = function () {
    if (App.role() !== 'owner') return;
    App.sheet.open({
      title: 'Settings',
      update: function (sh) { sh.rebuild(); },
      body: function (el) {
        var s = App.data.settings, crew = App.people(['rep', 'tech']), read = crew.filter(App.hasRead).length;
        var list = h('div', { class: 'list' });
        list.appendChild(ui.row({ icon: 'schedule', title: 'Services', cls: 'row-clip',
          sub: (s.services || []).map(function (x) { return x.name; }).join(', '), onTap: openServices }));
        list.appendChild(ui.row({ icon: 'dollar', title: 'Commission', cls: 'row-clip',
          sub: pctText(s.firstPct) + ' on a new sale, ' + pctText(s.monthlyPct) + ' each month after', onTap: openCommission }));
        list.appendChild(ui.row({ icon: 'clock', title: 'Usual appointment times', cls: 'row-clip',
          sub: slotsText(s.defaultSlots), onTap: openTimes }));
        list.appendChild(ui.row({ icon: 'user', title: 'Give new jobs to', cls: 'row-clip',
          sub: App.people().some(function (m) { return m.id === s.defaultTechId; }) ? App.nameOf(s.defaultTechId) : 'Nobody. You assign each job.',
          onTap: openDefaultTech }));
        list.appendChild(ui.row({ icon: 'mail', title: 'Email alerts', cls: 'row-clip',
          sub: s.emailOnBooking ? (s.notifyEmail ? 'On, sent to ' + s.notifyEmail : 'On') : 'Off', onTap: openEmail }));
        list.appendChild(ui.row({ icon: 'standards', title: 'Company standards', cls: 'row-clip',
          sub: crew.length ? read + ' of ' + crew.length + ' have read these' : 'What your team reads and confirms',
          onTap: function () { App.actions.editStandards(); } }));
        el.appendChild(list);
      }
    });
  };

  /* ----- Services: one line each (name, usual price, remove) ----- */

  function openServices() {
    var draft = (App.data.settings.services || []).map(function (s) {
      return { id: s.id, name: s.name, price: s.priceCents ? (s.priceCents / 100).toFixed(2) : '' };
    });
    var rows = [], listEl = h('div', { class: 'stack-sm' });
    var addBtn = ui.button('Add a service', { icon: 'plus', block: true, onTap: function () {
      read();
      draft.push({ name: '', price: '' });
      draw();
      var last = rows[rows.length - 1];
      try { last.name.input.focus(); } catch (e) { /* fine */ }
    } });

    function read() {
      rows.forEach(function (r) { r.item.name = r.name.input.value; r.item.price = r.price.input.value; });
    }
    /* The price box is narrow, so what is wrong with a price is said in a line of its own under the whole row. */
    function priceError(r, message) {
      r.price.classList.toggle('has-error', !!message);
      r.error.textContent = message || '';
      r.error.hidden = !message;
      if (message) { r.price.input.setAttribute('aria-invalid', 'true'); r.price.input.setAttribute('aria-describedby', r.error.id); }
      else { r.price.input.removeAttribute('aria-invalid'); r.price.input.removeAttribute('aria-describedby'); }
    }
    function draw() {
      clear(listEl);
      rows = [];
      draft.forEach(function (item, i) {
        var name = ui.field({ name: 'svc-name-' + i, value: item.name, maxlength: 40, placeholder: 'Service name', autocapitalize: 'sentences' });
        var row = { item: item };
        var price = ui.field({ name: 'svc-price-' + i, value: item.price, prefix: '$', inputmode: 'decimal', maxlength: 10,
          onInput: function () { if (!row.error.hidden) priceError(row, ''); } });
        name.input.setAttribute('aria-label', 'Service name');
        price.input.setAttribute('aria-label', 'Usual price');
        var remove = h('button', { type: 'button', class: 'iconbtn', 'aria-label': 'Remove ' + (oneLine(item.name) || 'this service'),
          disabled: draft.length < 2, onclick: function () {
            read();
            draft.splice(draft.indexOf(item), 1);
            draw();
          } }, App.icon('trash', 20));
        row.name = name;
        row.price = price;
        row.error = h('p', { class: 'field-error', id: price.input.id + '-row-err', role: 'alert', hidden: true });
        rows.push(row);
        listEl.appendChild(h('div', { class: 'stack-xs' }, h('div', { class: 'svc-row' }, name, price, remove), row.error));
      });
      addBtn.hidden = draft.length >= LIMITS.services;
    }

    App.sheet.open({
      title: 'Services',
      body: function (el) {
        el.appendChild(h('p', { class: 'muted' }, 'These are the choices on a new sale. The usual price fills in when a rep picks one. Leave it blank if the price changes from job to job.'));
        el.appendChild(h('div', { class: 'stack-sm' },
          h('div', { class: 'svc-row svc-head', 'aria-hidden': 'true' }, h('span', null, 'Service'), h('span', null, 'Usual price'), h('span')),
          listEl));
        el.appendChild(addBtn);
        draw();
      },
      footer: { label: 'Save', onTap: function (sh) {
        read();
        var seen = Object.create(null), bad = null, out = [];   /* not {}: a service may be called "constructor" */
        rows.forEach(function (r) {
          var name = oneLine(r.item.name), text = String(r.item.price || '').trim(), cents = text ? fmt.toCents(text) : 0;
          if (!name) { r.name.setError('Add a name.'); bad = bad || r.name; }
          else if (seen[norm(name)]) { r.name.setError('Already on the list.'); bad = bad || r.name; }
          seen[norm(name)] = true;
          if (cents == null) { priceError(r, PRICE_HELP); bad = bad || r.price; }
          else if (cents > LIMITS.maxCents) { priceError(r, 'That price is too high.'); bad = bad || r.price; }
          var item = { name: name, priceCents: cents };
          if (r.item.id) item.id = r.item.id;
          out.push(item);
        });
        if (bad) { sh.reveal(bad); return; }
        sh.send('saveSettings', { settings: { services: out } }).then(function (res) {
          if (!res.ok) return;
          sh.close();
          App.toast('Services saved.');
        });
      } }
    });
  }

  /* ----- Commission ----- */

  var PCT_HELP = 'Enter a number from 0 to 100, like 30 or 12.5.';

  function parsePct(text) {
    var s = String(text == null ? '' : text).replace(/[%\s]/g, '');
    if (!/^(\d{1,3}(\.\d{0,2})?|\.\d{1,2})$/.test(s)) return null;
    var n = parseFloat(s);
    return n >= 0 && n <= 100 ? n : null;
  }

  function openCommission() {
    var s = App.data.settings;
    var example = h('p', { class: 'muted' });
    function paint() {
      var a = parsePct(first.val()), b = parsePct(monthly.val());
      example.hidden = a == null || b == null;
      if (a == null || b == null) return;
      example.textContent = 'On a $200.00 monthly sale a rep earns ' + fmt.money(share(20000, a)) + ', then ' +
        fmt.money(share(20000, b)) + ' every month the client stays.';
    }
    var first = withSuffix(ui.field({ label: 'On a new sale', name: 'pct-first', value: String(s.firstPct), inputmode: 'decimal', maxlength: 6, onInput: paint }), '%');
    var monthly = withSuffix(ui.field({ label: 'Each month after, for monthly clients', name: 'pct-monthly', value: String(s.monthlyPct), inputmode: 'decimal', maxlength: 6, onInput: paint }), '%');
    paint();
    App.sheet.open({
      title: 'Commission', small: true,
      body: function (el) {
        el.appendChild(first);
        el.appendChild(monthly);
        el.appendChild(example);
        el.appendChild(h('p', { class: 'hint' }, 'Sales already made keep the rates they were sold at.'));
      },
      footer: { label: 'Save', onTap: function (sh) {
        var a = parsePct(first.val()), b = parsePct(monthly.val());
        if (a == null) { first.setError(PCT_HELP); sh.reveal(first); return; }
        if (b == null) { monthly.setError(PCT_HELP); sh.reveal(monthly); return; }
        sh.send('saveSettings', { settings: { firstPct: a, monthlyPct: b } }).then(function (res) {
          if (!res.ok) return;
          sh.close();
          App.toast('Commission saved.');
        });
      } }
    });
  }

  /* ----- Usual appointment times ----- */

  /* "Add a time" works the same here as in a day's sheet in Calendar: a time box with Add beside it, and a time
     that was picked goes on the list as soon as the box is left. */
  function openTimes() {
    var draft = (App.data.settings.defaultSlots || []).slice().sort();
    var chips = h('div', { class: 'stack-sm' });
    var error = h('p', { class: 'form-error', role: 'alert', hidden: true });
    var box = ui.field({ label: 'Add a time', name: 'slot-new', type: 'time', onInput: function () { say(''); } });
    var closed = false, timer = null;

    function say(message) { error.textContent = message || ''; error.hidden = !message; }
    function draw() {
      clear(chips);
      if (!draft.length) { chips.appendChild(h('p', { class: 'muted' }, 'No times yet. Add at least one.')); return; }
      var list = h('div', { class: 'chips', role: 'group', 'aria-label': 'Usual times' });
      draft.forEach(function (t) {
        list.appendChild(h('button', { type: 'button', class: 'chip chip-x', 'aria-label': 'Remove ' + fmt.time(t), onclick: function () {
          draft.splice(draft.indexOf(t), 1);
          say('');
          draw();
        } }, fmt.time(t), App.icon('close', 16)));
      });
      chips.appendChild(list);
      chips.appendChild(h('p', { class: 'hint' }, 'Tap a time to remove it.'));
    }
    /* Puts the time in the box on the list. Answers false when it cannot go on (the words under the box say
       why). With `quiet`, an empty box, or a time that is already on the list, is nothing to stop for. */
    function add(quiet) {
      clearTimeout(timer);
      var input = box.input, m = /^(\d{1,2}):(\d{2})/.exec(input.value || '');
      var t = m ? (m[1].length < 2 ? '0' : '') + m[1] + ':' + m[2] : '';
      if (!t) {
        if (input.validity && input.validity.badInput) { say('That is not a time.'); return false; }   /* half typed */
        if (!quiet) say('Pick a time first.');
        return !!quiet;
      }
      if (!D.isHM(t)) { say('That is not a time.'); return false; }
      if (draft.indexOf(t) >= 0) {
        input.value = '';
        if (!quiet) say(fmt.time(t) + ' is already on the list.');
        return !!quiet;
      }
      if (draft.length >= LIMITS.slotsPerDay) { say('That is the most times a day can hold.'); return false; }
      draft.push(t);
      draft.sort();
      input.value = '';
      say('');
      draw();
      return true;
    }
    /* It waits a moment after the box is left, so the tap that took the finger off it (Add, Save, a time to
       remove) lands before the list is drawn again. */
    box.input.addEventListener('blur', function () {
      clearTimeout(timer);
      timer = setTimeout(function () {
        if (!closed && document.activeElement !== box.input) add(true);
      }, 250);
    });

    App.sheet.open({
      title: 'Usual appointment times', small: true,
      body: function (el) {
        el.appendChild(h('p', { class: 'muted' }, 'A day you open starts with these times. Days you have already set up keep their own.'));
        el.appendChild(chips);
        el.appendChild(h('div', { class: 'add-row' }, box, ui.button('Add', { onTap: function () { add(false); } })));
        el.appendChild(error);
        draw();
      },
      onClose: function () { closed = true; clearTimeout(timer); },
      footer: { label: 'Save', onTap: function (sh) {
        if (!add(true)) return;                     /* a time still in the box goes in too */
        if (!draft.length) { say('Keep at least one time.'); return; }
        sh.send('saveSettings', { settings: { defaultSlots: draft.slice() } }).then(function (res) {
          if (!res.ok) return;
          sh.close();
          App.toast('Usual times saved.');
        });
      } }
    });
  }

  /* ----- Give new jobs to ----- */

  function openDefaultTech() {
    App.sheet.open({
      title: 'Give new jobs to', small: true,
      update: function (sh) { sh.rebuild(); },
      body: function (el, sh) {
        var cur = App.data.settings.defaultTechId || null;
        if (!App.people().some(function (m) { return m.id === cur; })) cur = null;
        var order = { tech: 0, owner: 1 };
        var people = App.people(['tech', 'owner']).sort(function (a, b) { return (order[a.role] - order[b.role]) || byName(a, b); });
        var list = h('div', { class: 'list' });
        function pick(id, name, rowEl) {
          if (id === cur) { sh.close(); return; }
          sh.send('saveSettings', { settings: { defaultTechId: id } }, { button: rowEl }).then(function (res) {
            if (!res.ok) return;
            sh.close();
            App.toast(id ? 'New jobs go to ' + name + '.' : 'New jobs start with nobody assigned.');
          });
        }
        /* The same two rows as "Assign to" on a job: Nobody first, then the people. */
        list.appendChild(ui.nobodyRow({ sub: 'You assign each job yourself', selected: !cur, onTap: function (e, rowEl) { pick(null, '', rowEl); } }));
        people.forEach(function (m) {
          list.appendChild(ui.personRow(m, { selected: cur === m.id, onTap: function (e, rowEl) { pick(m.id, m.name, rowEl); } }));
        });
        el.appendChild(h('p', { class: 'muted' }, 'Every new job goes to this person straight away. You can still change it job by job.'));
        el.appendChild(list);
      }
    });
  }

  /* ----- Email alerts ----- */

  function openEmail() {
    var s = App.data.settings;
    var toggle = ui.toggle({ label: 'Email me when an appointment is booked', checked: !!s.emailOnBooking });
    var email = ui.field({ label: 'Send it to', name: 'notify-email', type: 'email', value: s.notifyEmail || '', optional: true, maxlength: 120,
      placeholder: 'you@example.com', autocapitalize: 'none',
      hint: 'Leave it blank and the emails go to the Gmail you set this up with.' });
    App.sheet.open({
      title: 'Email alerts', small: true,
      body: function (el) {
        el.appendChild(toggle);
        el.appendChild(email);
        if (App.mode === 'sample') {
          el.appendChild(h('div', { class: 'callout' }, h('p', { class: 'small' }, 'Emails start once the system is connected. Nothing is sent while you are looking at sample data.')));
        }
      },
      footer: { label: 'Save', onTap: function (sh) {
        var to = email.val();
        if (to && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(to)) { email.setError('That email address does not look right.'); sh.reveal(email); return; }
        sh.send('saveSettings', { settings: { emailOnBooking: toggle.get(), notifyEmail: to } }).then(function (res) {
          if (!res.ok) return;
          sh.close();
          App.toast(toggle.get() ? 'Email alerts are on.' : 'Email alerts are off.');
        });
      } }
    });
  }

  /* ================= Edit standards ================= */

  /* Each standard has a box of its own, so it is plain where one ends and the next begins, however long it runs. */

  function linesOf(text) {
    return String(text == null ? '' : text).split(/\r\n?|\n/);
  }
  function itemsOf(list) {
    var out = [];
    (list || []).forEach(function (text) {
      linesOf(text).map(oneLine).forEach(function (x) { if (x) out.push(x); });
    });
    return out;
  }
  function grow(box) {
    box.style.height = 'auto';
    box.style.height = (box.scrollHeight + 2) + 'px';
  }

  function openStandardsEditor(start) {
    var draft = start || (App.data.settings.standards || []).map(function (s) {
      return { id: s.id, title: s.title, ordered: !!s.ordered, items: (s.items || []).slice() };
    });
    var blocks = [], saved = false, listEl = h('div', { class: 'stack' });

    function read() {
      blocks.forEach(function (b) {
        b.sec.title = b.title.input.value;
        b.sec.ordered = b.toggle.get();
        b.sec.items = b.rows.map(function (r) { return r.input.value; });
      });
    }
    function cleaned() {
      return draft.map(function (s) {
        var out = { title: oneLine(s.title), ordered: !!s.ordered, items: itemsOf(s.items) };
        if (s.id) out.id = s.id;
        return out;
      });
    }
    function changed() {
      if (!App.data) return false;
      var now = (App.data.settings.standards || []).map(function (s) {
        return { title: s.title, ordered: !!s.ordered, items: s.items || [], id: s.id };
      });
      return JSON.stringify(cleaned()) !== JSON.stringify(now);
    }
    /* Put the cursor in one standard's box (after a draw), and bring the box into view if it is not. */
    function focusRow(sec, at) {
      var b = blocks[draft.indexOf(sec)], row = b && b.rows[at];
      if (!row) return;
      try { row.input.focus({ preventScroll: true }); row.input.setSelectionRange(0, 0); } catch (e) { /* fine */ }
      var top = row.getBoundingClientRect().top, body = sheet.body.getBoundingClientRect();
      if (top < body.top + 8 || top > body.bottom - 80) sheet.reveal(row);
    }

    function itemRow(sec, k, i) {
      /* No maxlength here: a list pasted into one box must arrive whole so it can be dealt out, one line to a box.
         A standard that is too long is caught, in words, on Save. */
      var box = ui.field({ name: 'std-item-' + i + '-' + k, type: 'textarea', rows: 1, value: sec.items[k], autocapitalize: 'sentences' });
      box.input.classList.add('std-line');
      box.input.setAttribute('aria-label', 'Standard ' + (k + 1));
      box.input.setAttribute('enterkeyhint', 'enter');
      box.input.addEventListener('input', function () {
        var parts = linesOf(box.input.value);
        if (parts.length < 2) { grow(box.input); return; }
        /* A new line starts a new standard: Enter gives the next box, and a pasted list lands one to a box. */
        read();
        var room = LIMITS.standardItems - sec.items.length;
        if (room < 1) {
          box.input.value = parts.join(' ');
          grow(box.input);
          return;
        }
        var add = parts.slice(1);
        if (add.length > 1) {                         /* a pasted list: its blank lines are not standards */
          add = add.filter(function (x) { return oneLine(x); });
          if (!add.length) add = [''];
        }
        if (add.length > room) add.splice(room - 1, add.length, add.slice(room - 1).join(' '));   /* no room for more boxes: the rest share the last */
        sec.items.splice.apply(sec.items, [k, 1, parts[0]].concat(add));
        draw();
        focusRow(sec, k + add.length);
      });
      var remove = h('button', { type: 'button', class: 'iconbtn', 'aria-label': 'Remove standard ' + (k + 1), onclick: function () {
        read();
        if (sec.items.length > 1) sec.items.splice(k, 1);
        else sec.items[0] = '';                       /* a section always keeps one box to type in */
        draw();
      } }, App.icon('trash', 20));
      var row = h('div', { class: 'std-row' }, box, remove);
      row.input = box.input;
      row.setError = box.setError;
      return row;
    }

    function draw() {
      clear(listEl);
      blocks = [];
      draft.forEach(function (sec, i) {
        if (!sec.items || !sec.items.length) sec.items = [''];
        var title = ui.field({ label: 'Section title', name: 'std-title-' + i, value: sec.title, maxlength: 60, autocapitalize: 'sentences' });
        var toggle = ui.toggle({ label: 'Numbered steps', hint: 'For things done in order', checked: sec.ordered });
        var rows = sec.items.map(function (text, k) { return itemRow(sec, k, i); });
        var more = ui.button('Add a standard', { icon: 'plus', small: true, block: true, onTap: function () {
          read();
          sec.items.push('');
          draw();
          focusRow(sec, sec.items.length - 1);
        } });
        more.hidden = sec.items.length >= LIMITS.standardItems;
        var remove = ui.button('Remove section', { kind: 'text', small: true, onTap: function () { removeSection(sec); } });
        remove.classList.add('btn-danger');
        var block = { sec: sec, title: title, toggle: toggle, rows: rows, el: h('div', { class: 'card' }, title, toggle,
          h('div', { class: 'field', role: 'group', 'aria-label': 'Standards in this section' },
            h('span', { class: 'field-label' }, 'Standards, one in each box'), h('div', { class: 'stack-sm' }, rows, more)),
          h('div', { class: 'std-remove' }, remove)) };
        blocks.push(block);
        listEl.appendChild(block.el);
      });
      if (!draft.length) listEl.appendChild(h('p', { class: 'muted' }, 'No sections yet. Add the first one.'));
      blocks.forEach(function (b) { b.rows.forEach(function (r) { grow(r.input); }); });
      addBtn.hidden = draft.length >= LIMITS.standardSections;
    }
    function removeSection(sec) {
      read();
      var count = itemsOf(sec.items).length, name = oneLine(sec.title);
      function go() {
        read();
        var i = draft.indexOf(sec);
        if (i >= 0) draft.splice(i, 1);
        draw();
      }
      if (!name && !count) { go(); return; }
      App.confirm({
        title: 'Remove this section?',
        text: (name ? '"' + name + '"' : 'This section') + (count ? ' and its ' + fmt.plural(count, 'standard') : '') + ' will be gone once you save.',
        yes: 'Remove section', danger: true
      }).then(function (yes) { if (yes) go(); });
    }
    var addBtn = ui.button('Add a section', { icon: 'plus', block: true, onTap: function () {
      read();
      draft.push({ title: '', ordered: false, items: [''] });
      draw();
      var last = blocks[blocks.length - 1];
      sheet.reveal(last.el);
      try { last.title.input.focus({ preventScroll: true }); } catch (e) { /* fine */ }
    } });

    var sheet = App.sheet.open({
      title: 'Edit standards',
      body: function (el) {
        el.appendChild(listEl);
        el.appendChild(addBtn);
        draw();
      },
      onClose: function () {
        if (saved) return;
        read();
        if (!changed()) return;
        App.toast('Your changes were not saved.', { action: { label: 'Keep editing', onTap: function () { openStandardsEditor(draft); } } });
      },
      footer: { label: 'Save', onTap: function (sh) {
        read();
        var bad = null;
        blocks.forEach(function (b) {
          var items = itemsOf(b.sec.items);
          if (!oneLine(b.sec.title)) { b.title.setError('Every section needs a title.'); bad = bad || b.title; }
          if (!items.length) { b.rows[0].setError('Add at least one standard, or remove this section.'); bad = bad || b.rows[0]; }
          else if (items.length > LIMITS.standardItems) {
            b.rows[b.rows.length - 1].setError('Keep a section to ' + LIMITS.standardItems + ' standards or fewer.');
            bad = bad || b.rows[b.rows.length - 1];
          }
          b.rows.forEach(function (r) {
            if (oneLine(r.input.value).length <= LIMITS.standardLine) return;
            r.setError('This one is too long. Keep it under ' + LIMITS.standardLine + ' letters.');
            bad = bad || r;
          });
        });
        if (bad) { sh.reveal(bad); return; }
        if (!changed()) { saved = true; sh.close(); App.toast('Nothing was changed.'); return; }
        sh.send('saveSettings', { settings: { standards: cleaned() } }).then(function (res) {
          if (!res.ok) return;
          saved = true;
          sh.close();
          App.toast(App.people(['rep', 'tech']).length ? 'Standards saved. Your team will be asked to read them again.' : 'Standards saved.');
        });
      } }
    });
    /* The promise that goes with Save sits under the button, where the brief puts it. */
    if (sheet.button && sheet.button.parentNode) {
      sheet.button.parentNode.appendChild(h('p', { class: 'form-note' }, 'Saving a change asks everyone to read these again and confirm.'));
    }
    return sheet;
  }

  App.actions.editStandards = function () {
    if (App.role() !== 'owner') return;
    openStandardsEditor(null);
  };

  /* ================= registering ================= */

  App.screen('dashboard', { roles: ['owner'], title: 'Dashboard', render: renderDashboard });
  App.screen('schedule', { roles: ['tech'], title: 'Schedule', render: renderSchedule });
})();
