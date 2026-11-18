/*
 * Ridgeline Wash Co. team app: Sales, the New sale sheet, the sale sheet and the Leaderboard.
 *
 * ============================ WHAT OTHER FILES MAY USE ============================
 * SCREENS    #sales (owner and reps) and #leaders (reps).
 *
 * App.actions.newSale({ date, clientId })      open the New sale sheet. Both are optional.
 *     date ('YYYY-MM-DD') shows that day's open times first; clientId starts on that existing client.
 *     App.act('newSale', { date: '2026-11-19' });        App.act('newSale', { clientId: c.id });
 * App.actions.openSale(saleId)                 open one sale: its details, its commission by date, booking its
 *     appointment if it has none yet, and for the owner "Fix this sale" (price, service, sold by) and "Remove sale".
 *
 * App.ui.leaderboard(container, { showCommission }) -> container
 *     Draws the period toggle (This week / This month / All time) and the ranked rows into `container`.
 *     Call it from your render with a container of your own; calling it again on the same container replaces
 *     what it drew last time. It keeps its own chosen period (across re-renders and across screens) and
 *     redraws by itself when new data arrives.
 *     showCommission: true adds each person's commission for the chosen period under their dollars. Only the
 *     owner's data holds everyone's sales, so only pass it on an owner screen.
 *     var box = App.h('div'); root.appendChild(box); App.ui.leaderboard(box, { showCommission: true });
 * ===================================================================================
 *
 * Commission is never worked out here. Every sale arrives with its dated `events`; this file only adds
 * them up. The one forecast ("You earn $45.00 on this sale") asks RidgelineCore.calc for the figure.
 */
(function () {
  'use strict';

  var Core = RidgelineCore, D = Core.dates, calc = Core.calc;
  var h = App.h, ui = App.ui, fmt = App.fmt, icon = App.icon;

  var OTHER = '__other';                     /* the "Other" service chip */
  var PAGE = 40;                             /* sales shown before "Show older sales" */
  var MATCHES = 6;                           /* clients shown in the "Existing client" pick */
  /* How long an unsaved New sale is kept on this phone: never longer than the system remembers a save by its id. */
  var DRAFT_MS = Math.min(12 * 3600, +Core.LIMITS.retrySeconds || 3600) * 1000;
  var LINK_OK = /^https:\/\/[^\s<>"'`]+$/i;  /* a payment link: https, and nothing in it that could break out of a link */
  var EMAIL_OK = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
  var PERIODS = [{ value: 'week', label: 'This week' }, { value: 'month', label: 'This month' }, { value: 'all', label: 'All time' }];

  /* View state. A screen is drawn again on every data change, so what the person chose lives here. */
  var repFilter = '';        /* Sales, owner: '' = everyone, or one seller's id */
  var shown = PAGE;          /* Sales: how many rows of the list are showing */
  var chipScroll = 0;        /* Sales, owner: how far the row of sellers is scrolled */
  var period = 'month';      /* the leaderboard's period, shared by Leaders and the Dashboard */
  var memDraft = {};         /* each person's unsaved New sale (by their id), also kept in localStorage */
  var formOpen = null;       /* the New sale sheet while it is open */

  /* ================= small helpers ================= */

  function clear(el) { el.textContent = ''; return el; }
  function byName(a, b) {
    var x = String(a.name || '').toLowerCase(), y = String(b.name || '').toLowerCase();
    return x < y ? -1 : x > y ? 1 : 0;
  }
  function newestFirst(a, b) { return ((b.soldAt || 0) - (a.soldAt || 0)) || (a.day < b.day ? 1 : a.day > b.day ? -1 : 0); }
  function pct(n) { return String(+n || 0) + '%'; }
  function owned(name) { return name + (/s$/i.test(name) ? "'" : "'s"); }
  function shortDay(day) {
    var s = fmt.dayShort(day);
    return day.slice(0, 4) === App.today().slice(0, 4) ? s : s + ', ' + day.slice(0, 4);
  }
  function priceWords(sale) { return fmt.money(sale.priceCents) + (sale.billing === 'monthly' ? ' a month' : ' one-time'); }
  function errLine() { return h('p', { class: 'field-error', role: 'alert', hidden: true }); }
  function uid() {
    try { if (window.crypto && crypto.randomUUID) return crypto.randomUUID(); } catch (e) { /* fall through */ }
    var s = '';
    while (s.length < 32) s += Math.floor(Math.random() * 16).toString(16);
    return s + Date.now().toString(16);
  }

  /* What a sale's events add up to: from..to inclusive (either may be left out), one kind or both. */
  function earned(sale, from, to, kind) {
    var total = 0;
    (sale.events || []).forEach(function (e) {
      if ((from && e.day < from) || (to && e.day > to) || (kind && e.kind !== kind)) return;
      total += e.cents;
    });
    return total;
  }

  /* A sale that pays no commission: both of its rates are nothing. Every sale an owner makes is saved that way. */
  function noCommission(sale) { return !(+sale.firstPct) && !(+sale.monthlyPct); }
  function isOwner(id) { var m = App.member(id); return !!m && m.role === 'owner'; }

  /* The money a sale brings in from `from` on: its price once for every payment in that time. Each of its
     events is one payment (the first, then each month the client stayed), so this is revenue, not just what was sold. */
  function paidIn(sale, from) {
    var times = 0;
    (sale.events || []).forEach(function (e) { if (!from || e.day >= from) times++; });
    return times * (sale.priceCents || 0);
  }

  /* A price as it is typed: 150 or 150.50. */
  function priceText(cents) { return cents % 100 ? (cents / 100).toFixed(2) : String(cents / 100); }

  /* What is wrong with a payment link, in words ('' when it is fine). This is the system's own check, so the
     form never passes a link the system then refuses: https, a real site name after it (a dot in it, and no
     "name@" in front), no spaces. */
  function linkProblem(link) {
    var check = Core.check && Core.check.payLink;
    if (typeof check === 'function') return check(link) || '';
    return LINK_OK.test(link) ? '' : 'A payment link must start with https://';
  }

  /* Who a sale can belong to, for the owner's "Sold by": themself first, then every sales rep and owner on the team. */
  function sellerOptions(me) {
    return [{ value: me.id, label: me.name + ' (you)' }].concat(App.people(['rep', 'owner'])
      .filter(function (m) { return m.id !== me.id; }).sort(byName).map(function (m) { return { value: m.id, label: m.name }; }));
  }

  /* The cut of a price at a rate, in cents, straight from the core's own commission maths. */
  function share(cents, rate) {
    var day = App.today();
    return calc.commissionEvents({ day: day, priceCents: cents, firstPct: rate, monthlyPct: 0, billing: 'once' }, null, day)[0].cents;
  }

  /* ================= the numbers card (Sales and Leaders share its look) ================= */

  function moneyLine(label, cents) {
    return h('div', { class: 'between' }, h('span', { class: 'muted' }, label), h('span', { class: 'num' }, fmt.money(cents)));
  }

  /* cells: [{ cents, words, more }] across the top (may be empty; `more` is a quiet line under the words).
     Then a label, one big ice number and small lines. */
  function numbersCard(cells, label, bigCents, lines) {
    var top = null;
    if (cells && cells.length) {
      top = h('div', { class: 'nums-top' });
      cells.forEach(function (c) {
        top.appendChild(h('div', { class: 'nums-cell' },
          h('span', { class: 'stat-num' }, fmt.moneyShort(c.cents)),
          h('span', { class: 'stat-label' }, c.words),
          c.more ? h('span', { class: 'nums-more' }, c.more) : null));
      });
    }
    var linesEl = h('div', { class: 'nums-lines' });
    lines.forEach(function (l) { linesEl.appendChild(moneyLine(l[0], l[1])); });
    return h('div', { class: 'card card-flush' }, top,
      h('div', { class: 'nums-main' },
        h('p', { class: 'nums-label' }, label),
        h('p', { class: 'big-num ice' }, fmt.moneyShort(bigCents)),
        linesEl));
  }

  /* ================= Sales ================= */

  function saleRow(sale, showRep) {
    var row = ui.row({
      title: sale.clientName || 'Client',
      sub: [
        sale.service + ', ' + shortDay(sale.day),
        showRep ? 'Sold by ' + App.nameOf(sale.repId, 'someone who has left') : null,
        sale.endDay ? 'Monthly plan ended ' + shortDay(sale.endDay) : null,
        sale.jobId ? null : h('span', { class: 'warn' }, 'No appointment yet')
      ],
      right: [
        h('span', { class: 'amt' }, fmt.money(sale.priceCents) + (sale.billing === 'monthly' ? '/mo' : '')),
        h('span', { class: 'small' }, noCommission(sale) ? 'No commission' : 'Earned ' + fmt.money(earned(sale)))
      ],
      chevron: false,
      onTap: function () { openSale(sale.id); }
    });
    row.querySelector('.row-right').classList.add('row-right-col');
    return row;
  }

  function renderSales(root) {
    var d = App.data, me = d.me, owner = me.role === 'owner', today = d.today;
    var wk = D.weekStart(today), mo = D.monthStart(today);
    var all = (d.sales || []).slice().sort(newestFirst), list = all, who = '';

    root.appendChild(ui.title('Sales'));
    root.appendChild(ui.button('New sale', { kind: 'primary', block: true, onTap: function () { openNewSale({}); } }));

    if (owner) {
      var seen = {}, sellers = [];
      all.forEach(function (s) { seen[s.repId] = 1; });
      App.people(['rep']).forEach(function (m) { seen[m.id] = 1; });
      Object.keys(seen).forEach(function (id) { sellers.push({ id: id, name: App.nameOf(id, 'Someone who has left') }); });
      sellers.sort(byName);
      if (repFilter && !seen[repFilter]) repFilter = '';
      if (sellers.length > 1) {
        var chips = ui.chips({
          label: 'Sold by', scroll: true, value: repFilter,
          options: [{ value: '', label: 'Everyone' }].concat(sellers.map(function (s) { return { value: s.id, label: s.name }; })),
          onChange: function (v) {
            chipScroll = chips.scrollLeft;
            repFilter = v || '';
            shown = PAGE;
            App.refresh();
          }
        });
        root.appendChild(chips);
        chips.scrollLeft = chipScroll;
      } else repFilter = '';
      if (repFilter) {
        list = all.filter(function (s) { return s.repId === repFilter; });
        who = App.nameOf(repFilter, 'Someone who has left');
      }
    }

    /* A rep's card says what they sold. The owner's says revenue: the money due in that time, which is every
       payment that fell in it (a new sale's first one, and each monthly client's payment for that month), the
       same sum as the Dashboard. The count beside it is always the sales made in that time. */
    var week = { count: 0, cents: 0, due: 0 }, month = { count: 0, cents: 0, due: 0 }, fromNew = 0, fromMonthly = 0;
    list.forEach(function (s) {
      if (s.day >= wk) { week.count++; week.cents += s.priceCents; }
      if (s.day >= mo) { month.count++; month.cents += s.priceCents; }
      week.due += paidIn(s, wk);
      month.due += paidIn(s, mo);
      fromNew += earned(s, mo, null, 'first');
      fromMonthly += earned(s, mo, null, 'monthly');
    });
    root.appendChild(ui.label(!owner ? 'My numbers' : who ? owned(who) + ' numbers' : 'Business numbers'));
    root.appendChild(numbersCard(
      owner
        ? [{ cents: week.due, words: 'Revenue this week', more: fmt.plural(week.count, 'new sale') },
           { cents: month.due, words: 'Revenue this month', more: fmt.plural(month.count, 'new sale') }]
        : [{ cents: week.cents, words: fmt.plural(week.count, 'sale') + ' this week' },
           { cents: month.cents, words: fmt.plural(month.count, 'sale') + ' this month' }],
      owner ? 'Commission owed this month' : 'Commission this month',
      fromNew + fromMonthly,
      [['From new sales', fromNew], ['From monthly clients', fromMonthly]]));

    root.appendChild(ui.label(!owner ? 'My sales' : who ? owned(who) + ' sales' : 'All sales', { count: list.length || null }));
    if (!list.length) {
      root.appendChild(ui.empty(who
        ? { title: who + ' has no sales yet.' }
        : { title: 'No sales yet.', text: 'Every sale shows up here as soon as it is saved, with what it earned.' }));
      return;
    }
    var rows = h('div', { class: 'list' });
    list.slice(0, shown).forEach(function (s) { rows.appendChild(saleRow(s, owner && !repFilter)); });
    root.appendChild(rows);
    if (list.length > shown) {
      root.appendChild(ui.button('Show older sales', { block: true, onTap: function () { shown += PAGE; App.refresh(); } }));
    }
  }

  /* ================= one sale: details, commission by date, Fix this sale, Remove sale ================= */

  /* The next day a monthly sale pays again: the same day of the month, the first one after today. */
  function nextDue(day, today) {
    for (var k = 1; k <= 600; k++) {
      var due = D.addMonths(day, k);
      if (due > today) return due;
    }
    return '';
  }

  function removeSale(saleId, btn, errorEl, sh, st) {
    var sale = App.sale(saleId);
    if (!sale) return;
    var job = sale.jobId ? App.job(sale.jobId) : null;
    var text = (sale.clientName || 'This client') + ', ' + sale.service + ', ' + priceWords(sale) + '.';
    if (job && job.status === 'scheduled') text += ' The appointment on ' + fmt.when(job.date, job.time) + ' has not happened yet, so it is removed too.';
    else if (job && job.status === 'done') text += ' The job is already done, so it stays on the schedule.';
    text += (noCommission(sale) ? '' : ' The commission on this sale goes with it.') + ' The client stays in Clients.';
    App.confirm({ title: 'Remove this sale?', text: text, yes: 'Remove sale', no: 'Keep it', danger: true }).then(function (yes) {
      if (!yes) return;
      /* While it is being removed the sheet is not redrawn, so the button and its message stay where they are. */
      function removed() { sh.close(); App.toast('Sale removed.'); }
      st.removing = true;
      ui.save(btn, 'deleteSale', { saleId: saleId }, { errorEl: errorEl, saved: removed,
        landed: function () { return !App.sale(saleId); }, onLanded: removed
      }).then(function (res) {
        if (res.skipped) return;
        if (res.ok) { removed(); return; }
        st.removing = false;
        if (!App.sale(saleId)) sh.close();       /* it is gone all the same (someone else removed it) */
      });
    });
  }

  function drawSale(el, sh, saleId, st) {
    var sale = App.sale(saleId), me = App.me();
    if (!sale || !me) return;
    var owner = me.role === 'owner', today = App.today();
    var job = sale.jobId ? App.job(sale.jobId) : null, client = App.client(sale.clientId);

    var none = noCommission(sale);
    var kvs = h('div', { class: 'kvs' });
    kvs.appendChild(ui.kv('Sold on', fmt.day(sale.day)));
    kvs.appendChild(ui.kv('Service', sale.service));
    kvs.appendChild(ui.kv('Price', priceWords(sale)));
    if (sale.endDay) kvs.appendChild(ui.kv('Monthly plan', 'Ended ' + fmt.day(sale.endDay)));
    if (owner) kvs.appendChild(ui.kv('Sold by', App.nameOf(sale.repId, 'Someone who has left')));
    if (!none) kvs.appendChild(ui.kv('Earned so far', h('span', { class: 'strong num' }, fmt.money(earned(sale)))));
    el.appendChild(kvs);

    el.appendChild(ui.label('Appointment'));
    /* The sheet's title is already the client, so the row says what is being done there. */
    if (job) el.appendChild(h('div', { class: 'list' }, ui.jobRow(job, { showDate: true, title: job.what || sale.service, sub: (job.client || {}).address || null })));
    else if (sale.jobId) el.appendChild(h('p', { class: 'muted' }, 'Booked.'));
    else {
      el.appendChild(h('p', { class: 'warn strong' }, 'No appointment yet.'));
      el.appendChild(ui.button('Book the appointment', { kind: 'primary', block: true, onTap: function () { openBook(saleId); } }));
    }

    el.appendChild(ui.label('Commission'));
    if (none) {
      el.appendChild(h('p', { class: 'muted' }, isOwner(sale.repId) ? 'No commission on the owner\'s own sales.' : 'No commission on this sale.'));
    } else {
      var list = h('div', { class: 'list' });
      (sale.events || []).slice().sort(function (a, b) { return a.day < b.day ? 1 : a.day > b.day ? -1 : 0; }).forEach(function (e) {
        list.appendChild(ui.row({
          title: fmt.day(e.day),
          sub: e.kind === 'monthly' ? 'Monthly client, ' + pct(sale.monthlyPct) + ' of the price' : 'New sale, ' + pct(sale.firstPct) + ' of the price',
          right: h('span', { class: 'amt' }, fmt.money(e.cents))
        }));
      });
      el.appendChild(list);
    }
    if (sale.billing === 'monthly' && !none) {
      var hint = '', due = nextDue(sale.day, today);
      if (sale.endDay) {
        hint = 'Monthly commission on this sale ended ' + fmt.day(sale.endDay) + (sale.endedBy ? ', when a new monthly plan took its place.' : ', when the client cancelled.');
      } else if (client && (client.status === 'New' || client.status === 'Active')) {
        if (due) hint = 'Next: ' + fmt.money(share(sale.priceCents, sale.monthlyPct)) + ' on ' + fmt.day(due) + ', if they are still a client.';
      } else if (client) {
        hint = 'Monthly commission is on hold while this client is ' + String(client.status).toLowerCase() + '.';
      }
      if (hint) el.appendChild(h('p', { class: 'hint' }, hint));
    }

    if (sale.notes) {
      el.appendChild(ui.label('Notes'));
      el.appendChild(h('p', { class: 'note-text' }, sale.notes));
    }

    if (owner) {
      var err = h('p', { class: 'form-error', role: 'alert', hidden: true });
      el.appendChild(ui.label('Manage this sale'));
      el.appendChild(ui.button('Fix this sale', { icon: 'edit', block: true, onTap: function () { openFix(saleId); } }));
      el.appendChild(ui.button('Remove sale', { kind: 'danger', block: true, onTap: function (e, btn) { removeSale(saleId, btn, err, sh, st); } }));
      el.appendChild(err);
    }
  }

  function openSale(saleId) {
    var sale = App.sale(saleId), st = { removing: false };
    if (!sale) { App.toast('That sale is no longer here.'); return null; }
    return App.sheet.open({
      title: sale.clientName || 'Sale', small: true,
      body: function (el, sh) { drawSale(el, sh, saleId, st); },
      update: function (sh) {
        if (st.removing) return;       /* this sheet is removing the sale itself: it says so when that is done */
        var now = App.sale(saleId);
        if (!now) { sh.close(); App.toast('That sale is no longer here.'); return; }
        sh.setTitle(now.clientName || 'Sale');
        sh.rebuild();
      }
    });
  }

  /* Fix this sale (owner): a sale that was entered wrong gets the right price, service or seller. Commission,
     the totals and the leaderboard follow by themselves, because they are worked out from the sale. One-time
     or monthly is not changed here: for that the sale is removed and entered again. */
  function openFix(saleId) {
    var sale = App.sale(saleId), me = App.me();
    if (!sale || !me || me.role !== 'owner') return null;

    var names = (App.data.settings.services || []).map(function (x) { return x.name; });
    var options = names.map(function (n) { return { value: n, label: n }; });
    if (sale.service && names.indexOf(sale.service) < 0) options.unshift({ value: sale.service, label: sale.service });
    options.push({ value: OTHER, label: 'Other' });
    var other = ui.field({ label: 'Service name', name: 'fix-other', maxlength: 60, autocapitalize: 'sentences' });
    other.hidden = true;
    var service = ui.field({ label: 'Service', name: 'fix-service', type: 'select', options: options, value: sale.service || options[0].value,
      onInput: function (v) { other.hidden = v !== OTHER; } });
    var price = ui.field({ label: sale.billing === 'monthly' ? 'Price each month' : 'Price', name: 'fix-price', inputmode: 'decimal', prefix: '$',
      value: priceText(sale.priceCents || 0), maxlength: 12 });

    var people = sellerOptions(me);
    if (!people.some(function (o) { return o.value === sale.repId; })) {
      /* Whoever made it has left (or no longer sells): they stay the answer until someone else is picked. */
      var gone = App.member(sale.repId);
      people.unshift({ value: sale.repId, label: !gone ? 'Someone who has left' : gone.name + (gone.active ? '' : ' (no longer on the team)') });
    }
    var repHint = h('p', { class: 'field-hint', hidden: true });
    var rep = ui.field({ label: 'Sold by', name: 'fix-rep', type: 'select', options: people, value: sale.repId, onInput: sayRep });
    function sayRep() {
      var id = rep.input.value, text = '';
      if (id !== sale.repId || noCommission(sale)) {
        /* Moved from one rep to another, a sale keeps the rates it was sold at. One an owner made had none, so it takes today's. */
        text = isOwner(id) ? 'No commission on the owner\'s own sales.'
          : id !== sale.repId ? App.nameOf(id, 'This rep') + ' gets the commission on this sale, ' +
            (isOwner(sale.repId) || noCommission(sale) ? 'at the rates in Settings today.' : 'at the rates it was sold at.') : '';
      }
      repHint.textContent = text;
      repHint.hidden = !text;
    }

    return App.sheet.open({
      title: 'Fix this sale', small: true,
      body: function (el) {
        el.appendChild(h('p', { class: 'muted' }, (sale.clientName || 'This client') + ', sold on ' + fmt.day(sale.day) + '. Commission and the totals follow what you change here.'));
        el.appendChild(service);
        el.appendChild(other);
        el.appendChild(price);
        el.appendChild(h('div', { class: 'stack-sm' }, rep, repHint));
        el.appendChild(h('p', { class: 'hint' }, 'One-time or monthly cannot be changed here. For that, remove the sale and enter it again.'));
        sayRep();
      },
      update: function (sh) {
        if (!App.sale(saleId)) { sh.close(); App.toast('That sale is no longer here.'); }
      },
      footer: { label: 'Save', onTap: function (sh) {
        var now = App.sale(saleId) || sale, bad = [], patch = {};
        function fail(field, message) { field.setError(message); bad.push(field); }
        var what = service.input.value === OTHER ? other.val() : service.input.value;
        var cents = fmt.toCents(price.val());
        if (!what) fail(service.input.value === OTHER ? other : service, 'Type the name of the service.');
        if (!price.val()) fail(price, 'Enter the price.');
        else if (cents == null) fail(price, 'Enter the price in dollars, like 150 or 150.50.');
        else if (cents <= 0) fail(price, 'Enter the price.');
        else if (cents > Core.LIMITS.maxCents) fail(price, 'That price is too high. Check it.');
        if (bad.length) { sh.error(''); sh.reveal(bad[0]); return; }

        if (what !== now.service) patch.service = what;
        if (cents !== now.priceCents) patch.priceCents = cents;
        if (rep.input.value && rep.input.value !== now.repId) patch.repId = rep.input.value;
        /* Nothing was changed: close. Unless an earlier try from here got no answer: that one may have saved, so
           this goes out too (under the same id) and the system says which it was. */
        if (!Object.keys(patch).length && !sh.unanswered('updateSale', { saleId: saleId })) { sh.close(); return; }
        sh.send('updateSale', { saleId: saleId, patch: patch }, { saved: 'Sale fixed.',
          /* A try that got no answer, and then the sale reads the way it was sent: it was fixed. */
          landed: function () {
            var s = App.sale(saleId), keys = Object.keys(patch);
            return !!s && keys.length > 0 && keys.every(function (k) { return s[k] === patch[k]; });
          }
        }).then(function (res) {
          if (!res.ok) return;
          sh.close();
          App.toast('Sale fixed.');
        });
      } }
    });
  }

  /* Does this client have an appointment at that day and time? */
  function hasJobAt(clientId, v) {
    return (App.data.jobs || []).some(function (j) { return j.clientId === clientId && j.date === v.date && j.time === v.time && j.status === 'scheduled'; });
  }

  /* Book the appointment for a sale that was saved with "Book later". */
  function openBook(saleId) {
    var sale = App.sale(saleId), picker;
    if (!sale) return;
    var idle = 'Pick a day and a time';
    var sh = App.sheet.open({
      title: 'Book the appointment',
      body: function (el, sheet) {
        el.appendChild(h('p', { class: 'muted' }, (sale.clientName || 'This client') + ', ' + sale.service + '.'));
        picker = ui.slotPicker({ onChange: function (v) { sheet.setButton(v ? 'Book ' + fmt.when(v.date, v.time) : idle, !v); } });
        el.appendChild(picker);
      },
      footer: { label: idle, onTap: function (sheet) {
        var v = picker.get();
        if (!v) return;
        function booked() { sheet.close(); App.toast('Booked for ' + fmt.when(v.date, v.time) + '.'); }
        sheet.send('bookJob', { clientId: sale.clientId, saleId: sale.id, date: v.date, time: v.time, what: sale.service }, { saved: booked,
          /* No answer, and then this client turns up booked at that time: it went through. */
          landed: function () { return hasJobAt(sale.clientId, v); }, onLanded: booked
        }).then(function (res) {
          if (res.ok) booked();
          else if (res.error.code === 'slot_taken' || res.error.code === 'slot_closed') {
            sheet.error('');
            picker.set(null);
            picker.setError(res.error.message);
            sheet.setButton(idle, true);
          }
        });
      } }
    });
    sh.setButton(idle, true);
  }

  /* ================= New sale: the draft that is never lost ================= */
  /*
   * Everything typed into New sale is kept as a draft: in memory and in localStorage, per person, for a
   * few hours. A back swipe, a closed tab or a dead battery does not lose it; opening New sale again
   * brings it back. A saved sale clears the draft.
   *
   * A draft holds a client's name, phone and address, so it does not outstay its person:
   *   - signing out on purpose deletes it;
   *   - so does the phone being told that its person is no longer on the team;
   *   - being signed out any other way (the owner reset the PIN, the sign-in ran out) keeps it: the same
   *     person signs in again and finds what they typed. Nobody else ever sees it, and it is deleted the
   *     moment anyone else signs in on the phone, or when its few hours are up.
   *
   * The draft is also what stops a sale being saved twice:
   *   - it carries the id (opId) of the save it tried. While that try has had no answer, every later try
   *     goes out under the same id, whatever was changed since (even after the sheet was closed, or the page
   *     was loaded again). The system saves an id once: it answers the same sale from memory, and a changed
   *     one with "your first try was saved". Once the system has answered, the next save takes a new id;
   *   - it remembers each try whose answer never came back (`tries`). Such a save may have gone through.
   *     If a sale just like it turns up in the data afterwards, the sheet shows it as saved instead of
   *     sending it again. Before a changed sale is sent after such a try, the sheet asks the system for
   *     the latest first, so it finds out.
   */

  function draftKey(id) { return 'ridgeline.' + App.mode + '.saleDraft.' + (id || ''); }

  function blankDraft(me) {
    return {
      v: 1, by: me.id, at: 0, mode: 'new',
      name: '', contact: '', phone: '', email: '', address: '',
      clientId: '', find: '', repId: me.id,
      service: '', other: '', price: '', priceAuto: false, billing: 'once', notes: '', link: '',
      appt: null, day: '', later: false,
      opId: '', sent: '', tries: [], lastSold: 0
    };
  }

  /* Is there anything here worth keeping? A client the sheet was simply opened on (given) does not count. */
  function hasContent(d, given) {
    return !!(d.name || d.contact || d.phone || d.email || d.address || (d.clientId && d.clientId !== given) ||
      d.service || d.other || d.price || d.notes || d.link || d.appt);
  }

  function fresh(raw) { return !!raw && typeof raw === 'object' && raw.v === 1 && Date.now() - raw.at < DRAFT_MS; }

  /* Keep this person's draft, or (with null) forget it. Each person has their own, so a shared phone never mixes them up. */
  function storeDraft(me, d) {
    var keepIt = !!d && hasContent(d);
    if (keepIt) memDraft[me.id] = JSON.parse(JSON.stringify(d)); else delete memDraft[me.id];
    try {
      if (keepIt) window.localStorage.setItem(draftKey(me.id), JSON.stringify(memDraft[me.id]));
      else window.localStorage.removeItem(draftKey(me.id));
    } catch (e) { /* no storage on this phone: the copy in memory still covers a closed sheet */ }
  }

  /* Throw away every draft on this phone, in memory and in storage, except (when given) one person's. */
  function dropDrafts(exceptId) {
    Object.keys(memDraft).forEach(function (id) { if (id !== exceptId) delete memDraft[id]; });
    try {
      var ls = window.localStorage, prefix = draftKey(''), keep = exceptId ? draftKey(exceptId) : null, gone = [], i, k;
      for (i = 0; i < ls.length; i++) {
        k = ls.key(i);
        if (k && k.indexOf(prefix) === 0 && k !== keep) gone.push(k);
      }
      gone.forEach(function (key) { ls.removeItem(key); });
    } catch (e) { /* nothing stored, nothing to remove */ }
  }
  /* The app says when the person on this phone is leaving it, just before it forgets who they were: `chosen`
     for a tap on Sign out (or a sample reset), `removed` when the system says they are no longer on the team.
     Only someone who was signed out and can sign back in keeps their draft. */
  var draftsOf = '';
  App.on('signout', function (why) {
    var me = App.me();
    var stays = !!me && !!why && !why.chosen && !why.removed;
    if (formOpen && formOpen.leave) formOpen.leave(stays);      /* the open sheet puts away what it holds (or does not), and keeps nothing after */
    dropDrafts(stays ? me.id : null);
    draftsOf = '';
  });

  /* When the app opens, and when someone signs in: drafts whose time is up go, and so does every draft that
     is not the signed-in person's. */
  function tidyDrafts() {
    var me = App.me();
    sweepDrafts();
    if (!me || me.id === draftsOf) return;
    draftsOf = me.id;
    dropDrafts(me.id);
  }
  function loadStored(id) {
    try { return JSON.parse(window.localStorage.getItem(draftKey(id)) || 'null'); } catch (e) { return null; }
  }
  App.on('route', tidyDrafts);
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', function () { setTimeout(tidyDrafts, 0); });
  else setTimeout(tidyDrafts, 50);

  /* Drafts nobody came back for are thrown away when their time is up, whoever they belonged to. */
  function sweepDrafts() {
    try {
      var ls = window.localStorage, prefix = draftKey(''), old = [], i, k;
      for (i = 0; i < ls.length; i++) {
        k = ls.key(i);
        if (k && k.indexOf(prefix) === 0) {
          var raw = null;
          try { raw = JSON.parse(ls.getItem(k)); } catch (e) { raw = null; }
          if (!fresh(raw)) old.push(k);
        }
      }
      old.forEach(function (key) { ls.removeItem(key); });
    } catch (e2) { /* nothing to tidy */ }
    Object.keys(memDraft).forEach(function (id) { if (!fresh(memDraft[id])) delete memDraft[id]; });
  }

  function loadDraft(me) {
    dropDrafts(me.id);
    sweepDrafts();
    var raw = memDraft[me.id] || loadStored(me.id);
    if (!fresh(raw) || raw.by !== me.id) return null;
    var d = blankDraft(me), k;
    for (k in d) {
      if (k !== 'appt' && k !== 'tries' && Object.prototype.hasOwnProperty.call(raw, k) && typeof raw[k] === typeof d[k]) d[k] = raw[k];
    }
    if (raw.appt && D.isDay(raw.appt.date) && D.isHM(raw.appt.time)) d.appt = { date: raw.appt.date, time: raw.appt.time };
    if (Array.isArray(raw.tries)) d.tries = raw.tries.filter(function (t) { return !!t && typeof t === 'object' && typeof t.priceCents === 'number'; }).slice(-6);
    if (d.mode !== 'existing') d.mode = 'new';
    if (d.billing !== 'monthly') d.billing = 'once';
    if (!D.isDay(d.day)) d.day = '';
    return hasContent(d) ? d : null;
  }

  /* ================= New sale: the sheet ================= */

  function openNewSale(arg) {
    var me = App.me();
    if (!me || (me.role !== 'owner' && me.role !== 'rep')) return null;
    if (formOpen) return formOpen;
    arg = arg && typeof arg === 'object' ? { date: D.isDay(arg.date) ? arg.date : '', clientId: arg.clientId ? String(arg.clientId) : '' } : { date: '', clientId: '' };

    var owner = me.role === 'owner';
    var d = loadDraft(me), restored = !!d;
    if (!d) d = blankDraft(me);
    var view = 'form', saving = false, closed = false, done = null, timer = null, f = null, sheet = null;
    var gone = false;          /* signed out while this sheet was open: nothing more is kept from it */
    var release = null;        /* lets the sheet go again after a save (see busy) */

    /* While a save is on its way the button says so, nothing in the form can be typed or tapped, and new
       data does not redraw the sheet. */
    function busy(on) {
      saving = on;
      if (on) {
        sheet.error('');
        sheet.setButton('Saving...', true);
        if (!release) release = sheet.hold();
      } else if (release) {
        var go = release;
        release = null;
        go();
      }
    }

    /* What the caller asked for goes on top of whatever was kept. */
    function applyArg() {
      if (arg.clientId && App.client(arg.clientId)) { d.mode = 'existing'; d.clientId = arg.clientId; }
      if (arg.date && arg.date >= App.today()) {
        if (d.appt && d.appt.date !== arg.date) d.appt = null;
        d.day = arg.date;
        d.later = false;
      }
    }
    applyArg();

    /* ----- reading the data ----- */
    function services() { return (App.data.settings.services || []); }
    function serviceById(id) {
      var list = services();
      for (var i = 0; i < list.length; i++) if (list[i].id === id) return list[i];
      return null;
    }
    function serviceOptions() {
      return services().map(function (s) { return { value: s.id, label: s.name }; }).concat([{ value: OTHER, label: 'Other' }]);
    }
    function repOptions() { return sellerOptions(me); }
    function sig(options) { return options.map(function (o) { return o.value + '\u0001' + o.label; }).join('\u0002'); }
    function sellerId() { return owner && f && f.rep ? (f.rep.input.value || me.id) : me.id; }
    function anyFreeDay() { return App.freeDays().length > 0; }
    function isFree(v) { return !!v && App.freeSlots(v.date).indexOf(v.time) >= 0; }
    function apptValue() { return d.later || !f ? null : f.picker.get(); }
    function norm(text) { return String(text == null ? '' : text).replace(/\s+/g, ' ').trim().toLowerCase(); }
    function newestSold() {
      var at = 0;
      (App.data.sales || []).forEach(function (s) { if (s.soldAt > at) at = s.soldAt; });
      return at;
    }
    /* The client's monthly plan that is still running, if this phone can see one. */
    function currentPlan(clientId) {
      return (App.data.sales || []).filter(function (s) { return s.clientId === clientId && s.billing === 'monthly' && !s.endDay; })[0] || null;
    }

    /* ----- keeping what was typed ----- */
    function collect() {
      if (!f || view !== 'form') return;
      d.name = f.name.val(); d.contact = f.contact.val(); d.phone = f.phone.val(); d.email = f.email.val(); d.address = f.address.val();
      d.find = f.find.val();
      d.repId = sellerId();
      d.other = f.other.val(); d.price = f.price.val(); d.billing = f.billing.get();
      d.notes = f.notes.val(); d.link = f.link.val();
      d.appt = f.picker.get();
      d.day = d.appt ? d.appt.date : (f.picker.getDay() || d.day);
    }
    function keep() {
      clearTimeout(timer);
      timer = null;
      if (view !== 'form' || gone) return;
      collect();
      d.at = Date.now();
      storeDraft(me, hasContent(d, arg.clientId) ? d : null);
    }
    function touch() {
      clearTimeout(timer);
      timer = setTimeout(keep, 300);
    }

    /* ----- the lines that follow what is typed ----- */
    function earnLine() {
      if (isOwner(sellerId())) { sheet.note('No commission on the owner\'s own sales.'); return; }
      var s = App.data.settings, cents = fmt.toCents(f.price.val()), monthly = f.billing.get() === 'monthly';
      var who = sellerId() === me.id ? 'You earn' : App.nameOf(sellerId(), 'The rep') + ' earns';
      var real = cents != null && cents > 0 && cents <= Core.LIMITS.maxCents;
      var first = real ? fmt.money(share(cents, s.firstPct)) + ' on this sale' : pct(s.firstPct) + ' of this sale';
      var each = real ? fmt.money(share(cents, s.monthlyPct)) : pct(s.monthlyPct);
      sheet.note(who + ' ' + first + (monthly ? ', then ' + each + ' every month they stay.' : '.'));
    }
    function paintButton() {
      if (view !== 'form' || saving) return;
      var v = apptValue();
      /* On a narrow phone the label breaks before the day, never in the middle of "9:30 AM". */
      sheet.setButton(v ? 'Save sale and book ' + fmt.when(v.date, v.time).replace(/ /g, '\u00a0') : 'Save sale', false);
    }

    /* A field of this form: remembers what is typed, and the keyboard's Enter moves to the next field. */
    function fld(o) {
      var own = o.onInput;
      o.onInput = function (value, el) { if (own) own(value, el); touch(); };
      var el = ui.field(o);
      if (o.type !== 'textarea' && o.type !== 'select') {
        el.input.setAttribute('enterkeyhint', 'next');
        el.input.addEventListener('keydown', function (e) {
          if (e.key !== 'Enter') return;
          e.preventDefault();
          var all = Array.prototype.filter.call(sheet.body.querySelectorAll('input, textarea, select'), function (x) { return x.offsetParent !== null; });
          var next = all[all.indexOf(el.input) + 1];
          if (next) next.focus(); else el.input.blur();
        });
      }
      return el;
    }

    /* ----- the form ----- */
    function drawForm(el) {
      f = {};
      if (d.service && d.service !== OTHER && !serviceById(d.service)) d.service = '';
      if (owner && !repOptions().some(function (o) { return o.value === d.repId; })) d.repId = me.id;
      if (d.appt && !isFree(d.appt)) d.appt = null;

      if (restored) {
        el.appendChild(h('div', { class: 'callout callout-ice' }, h('div', { class: 'between' },
          h('span', { class: 'strong' }, 'We kept what you typed.'),
          ui.button('Start over', { kind: 'text', small: true, onTap: startOver }))));
      }

      /* 1. Client: a new one, or one of the person's own. The lit half of the switch is the one on show. */
      el.appendChild(ui.label('Client'));
      f.mode = ui.segmented({ label: 'New or existing client', value: d.mode,
        options: [{ value: 'new', label: 'New client' }, { value: 'existing', label: 'Existing client' }],
        onChange: function (v) { setMode(v); } });
      el.appendChild(f.mode);

      f.name = fld({ label: 'Name (person or business)', name: 'sale-name', value: d.name, autocapitalize: 'words', maxlength: Core.LIMITS.name });
      f.contact = fld({ label: 'Contact name', optional: true, name: 'sale-contact', value: d.contact, autocapitalize: 'words', maxlength: Core.LIMITS.name });
      f.phone = fld({ label: 'Phone', name: 'sale-phone', type: 'tel', value: d.phone, maxlength: 30 });
      f.email = fld({ label: 'Email', optional: true, name: 'sale-email', type: 'email', value: d.email, maxlength: 120, autocapitalize: 'none' });
      f.address = fld({ label: 'Address', name: 'sale-address', value: d.address, autocapitalize: 'words', maxlength: Core.LIMITS.line });
      f.newBox = h('div', { class: 'stack' }, f.name, f.contact, f.phone, f.email, f.address);
      el.appendChild(f.newBox);

      f.find = fld({ name: 'sale-find', value: d.find, placeholder: 'Search name, phone or address', onInput: drawMatches });
      f.find.input.setAttribute('aria-label', 'Search your clients');
      f.find.input.setAttribute('enterkeyhint', 'search');
      f.findWrap = h('div', { class: 'search' }, icon('search', 20), f.find);
      f.picked = h('div', { class: 'card' });
      f.matches = h('div', { class: 'stack-sm' });
      f.oldBox = h('div', { class: 'stack-md' }, f.picked, f.findWrap, f.matches);
      el.appendChild(f.oldBox);

      if (owner) {
        f.rep = ui.field({ label: 'Sold by', name: 'sale-rep', type: 'select', options: repOptions(), value: d.repId, onInput: function () { earnLine(); touch(); } });
        el.appendChild(f.rep);
      }

      /* 2. What they bought */
      f.serviceLabel = ui.label('What they bought');
      el.appendChild(f.serviceLabel);
      f.service = ui.chips({ label: 'What they bought', options: serviceOptions(), value: d.service || null, onChange: pickService });
      f.serviceErr = errLine();
      f.serviceBox = h('div', { class: 'field' }, f.service, f.serviceErr);
      el.appendChild(f.serviceBox);
      f.other = fld({ label: 'What was sold', name: 'sale-other', value: d.other, maxlength: 60, autocapitalize: 'sentences' });
      f.other.hidden = d.service !== OTHER;
      el.appendChild(f.other);
      f.price = fld({ label: 'Price', name: 'sale-price', value: d.price, inputmode: 'decimal', prefix: '$', maxlength: 12,
        onInput: function () { d.priceAuto = false; earnLine(); } });
      el.appendChild(f.price);
      f.billing = ui.segmented({ label: 'How often', value: d.billing,
        options: [{ value: 'once', label: 'One-time' }, { value: 'monthly', label: 'Monthly' }],
        onChange: function () { earnLine(); planLine(); touch(); } });
      f.planHint = h('p', { class: 'field-hint', hidden: true });
      el.appendChild(h('div', { class: 'field' }, h('span', { class: 'field-label' }, 'How often'), f.billing, f.planHint));
      f.notes = fld({ label: 'Notes', optional: true, name: 'sale-notes', type: 'textarea', rows: 3, value: d.notes, maxlength: Core.LIMITS.text,
        placeholder: 'Anything the team should know' });
      el.appendChild(f.notes);
      f.link = fld({ label: 'Payment link', optional: true, name: 'sale-link', type: 'url', inputmode: 'url', value: d.link, maxlength: 300,
        autocapitalize: 'none', placeholder: 'https://' });
      el.appendChild(f.link);

      /* 3. Appointment */
      f.apptLabel = ui.label('Appointment');
      el.appendChild(f.apptLabel);
      f.picker = ui.slotPicker({
        value: d.appt, date: d.day || null,
        emptyText: owner ? 'No open days yet. Save the sale now and book once you open some in Calendar.'
          : 'No open days yet. Save the sale now and book once ' + App.ownerName() + ' opens some.',
        onChange: function (v) {
          d.appt = v;
          if (v) d.day = v.date;
          paintButton();
          touch();
        }
      });
      f.laterBtn = ui.button('Book later', { kind: 'text', onTap: function () { setLater(true); } });
      f.laterBtn.classList.add('btn-start');
      f.pickBox = h('div', { class: 'stack-sm' }, f.picker, f.laterBtn);
      var nowBtn = ui.button('Pick a time now', { kind: 'text', onTap: function () { setLater(false); } });
      nowBtn.classList.add('btn-start');
      f.laterBox = h('div', { class: 'callout' },
        h('p', { class: 'callout-title' }, 'No appointment yet'),
        h('p', { class: 'muted small' }, 'Save the sale now. When you know the day, open this sale in Sales and book it there.'),
        nowBtn);
      el.appendChild(f.pickBox);
      el.appendChild(f.laterBox);

      setMode(d.mode, true);
      setLater(d.later, true);
      earnLine();
      paintButton();
    }

    /* One monthly plan pays at a time: say so before a new one takes the place of the old. */
    function planLine() {
      var plan = d.mode === 'existing' && d.clientId && f.billing.get() === 'monthly' ? currentPlan(d.clientId) : null;
      f.planHint.textContent = plan ? 'This replaces the monthly plan they have now (' + plan.service + ', ' + fmt.money(plan.priceCents) + ' a month).' : '';
      f.planHint.hidden = !plan;
    }

    function setMode(mode, quiet) {
      var none = !(App.data.clients || []).length;
      if (mode === 'existing' && none && !d.clientId) mode = 'new';
      d.mode = mode;
      f.newBox.hidden = mode !== 'new';
      f.oldBox.hidden = mode !== 'existing';
      f.link.hidden = mode !== 'new';            /* a payment link is saved with a new client only */
      f.mode.set(mode);
      f.mode.hidden = mode === 'new' && none;     /* nobody to pick yet: no switch to show */
      if (mode === 'existing') drawPicked();
      planLine();
      if (!quiet) touch();
    }

    function drawPicked() {
      var c = d.clientId ? App.client(d.clientId) : null;
      if (d.clientId && !c) d.clientId = '';
      f.picked.hidden = !c;
      f.findWrap.hidden = !!c;
      f.matches.hidden = !!c;
      clear(f.picked);
      planLine();
      if (!c) { drawMatches(); return; }
      f.picked.appendChild(h('div', { class: 'between' },
        h('div', { class: 'stack-xs grow' },
          h('p', { class: 'strong' }, c.name),
          c.address ? h('p', { class: 'muted small' }, c.address) : null,
          c.phone ? h('p', { class: 'muted small num' }, c.phone) : null),
        ui.button('Change', { small: true, onTap: function () {
          d.clientId = '';
          drawPicked();
          touch();
        } })));
    }

    function drawMatches() {
      if (!f || d.mode !== 'existing' || d.clientId) return;
      clear(f.matches);
      var all = (App.data.clients || []).slice().sort(byName);
      var q = f.find.val().toLowerCase(), digits = q.replace(/\D/g, '');
      if (!all.length) { f.matches.appendChild(h('p', { class: 'muted' }, 'You have no clients yet. Add this one as a new client.')); return; }
      var hits = !q ? all : all.filter(function (c) {
        if ([c.name, c.contact, c.address, c.phone].join(' ').toLowerCase().indexOf(q) >= 0) return true;
        return digits.length >= 3 && String(c.phone || '').replace(/\D/g, '').indexOf(digits) >= 0;
      });
      if (!hits.length) { f.matches.appendChild(h('p', { class: 'muted' }, 'No client matches that.')); return; }
      var list = h('div', { class: 'list' });
      hits.slice(0, MATCHES).forEach(function (c) {
        list.appendChild(ui.row({ title: c.name, sub: c.address || c.phone || '', cls: 'row-clip', chevron: false, onTap: function () {
          d.clientId = c.id;
          f.find.setError('');
          drawPicked();
          touch();
        } }));
      });
      f.matches.appendChild(list);
      if (hits.length > MATCHES) f.matches.appendChild(h('p', { class: 'hint' }, 'Showing ' + MATCHES + ' of ' + hits.length + '. Type a few letters to find the rest.'));
    }

    function pickService(v) {
      d.service = v || '';
      f.serviceErr.hidden = true;
      f.other.hidden = v !== OTHER;
      var svc = serviceById(v);
      if (!f.price.val() || d.priceAuto) {             /* never write over a price someone typed */
        if (svc && svc.priceCents > 0) {
          f.price.input.value = priceText(svc.priceCents);
          f.price.setError('');
          d.priceAuto = true;
        } else if (d.priceAuto) {
          f.price.input.value = '';
          d.priceAuto = false;
        }
      }
      if (v === OTHER) { try { f.other.input.focus(); } catch (e) { /* fine */ } }
      earnLine();
      touch();
    }

    function setLater(on, quiet) {
      d.later = !!on && anyFreeDay();
      f.pickBox.hidden = d.later;
      f.laterBox.hidden = !d.later;
      f.laterBtn.hidden = !anyFreeDay();        /* with no open days there is nothing to skip */
      if (!d.later && !quiet) f.picker.setError('');
      paintButton();
      if (!quiet) touch();
    }

    function startOver() {
      collect();
      var old = JSON.parse(JSON.stringify(d));
      d = blankDraft(me);
      applyArg();
      restored = false;
      storeDraft(me, null);
      sheet.error('');
      sheet.rebuild();
      sheet.body.scrollTop = 0;
      App.toast('Cleared.', { action: { label: 'Undo', onTap: function () {
        if (view === 'form' && !closed && !saving) {
          d = old;
          restored = true;
          storeDraft(me, d);
          sheet.rebuild();
          sheet.body.scrollTop = 0;
        } else if (closed && !gone && App.me() && !memDraft[me.id]) storeDraft(me, old);
      } } });
    }

    /* ----- checking and saving ----- */

    /* Marks every problem and returns the first one, top to bottom: { el to scroll to, input to put the cursor in }. */
    function check() {
      var first = null, cents = fmt.toCents(d.price);
      function flag(field, message, target) {
        field.setError(message);
        if (!first) first = { el: target || field, input: target ? null : field.input };
      }
      [f.name, f.contact, f.phone, f.email, f.address, f.find, f.other, f.price, f.link].forEach(function (x) { x.setError(''); });
      f.serviceErr.hidden = true;

      if (d.mode === 'new') {
        if (!d.name) flag(f.name, 'Add the client\'s name.');
        if (!d.phone) flag(f.phone, 'Add a phone number.');
        else if (d.phone.replace(/\D/g, '').length < 7) flag(f.phone, 'That phone number looks too short.');
        if (d.email && !EMAIL_OK.test(d.email)) flag(f.email, 'That email address does not look right.');
        if (!d.address) flag(f.address, 'Add the address.');
      } else if (!App.client(d.clientId)) {
        d.clientId = '';
        drawPicked();
        flag(f.find, 'Pick the client.');
      }

      if (!d.service || (d.service !== OTHER && !serviceById(d.service))) {
        f.serviceErr.textContent = 'Pick what was sold.';
        f.serviceErr.hidden = false;
        if (!first) first = { el: f.serviceLabel, input: null };
      } else if (d.service === OTHER && !d.other) flag(f.other, 'Say what was sold.');

      if (!d.price) flag(f.price, 'Enter the price.');
      else if (cents == null) flag(f.price, 'Enter the price in dollars, like 150 or 150.50.');
      else if (cents <= 0) flag(f.price, 'Enter the price.');
      else if (cents > Core.LIMITS.maxCents) flag(f.price, 'That price is too high. Check it.');

      if (d.mode === 'new' && d.link && linkProblem(d.link)) flag(f.link, linkProblem(d.link));

      if (!d.later && !d.appt && anyFreeDay()) {
        f.picker.setError('Pick a time, or tap Book later.');
        if (!first) first = { el: f.apptLabel, input: null };
      }
      return first;
    }

    function request() {
      var svc = serviceById(d.service), v = apptValue();
      var req = {
        service: d.service === OTHER ? d.other : svc.name,
        priceCents: fmt.toCents(d.price), billing: d.billing, notes: d.notes,
        appointment: v ? { date: v.date, time: v.time } : null
      };
      if (d.mode === 'new') {
        req.client = { name: d.name, contact: d.contact, phone: d.phone, email: d.email, address: d.address };
        req.stripeLink = d.link;
      } else req.clientId = d.clientId;
      if (owner && d.repId !== me.id) req.repId = d.repId;
      return req;
    }

    /* Has a try whose answer never came back turned up as a sale after all? Then it is saved: show it, send nothing. */
    function adoptSaved(changedSince) {
      if (view !== 'form' || saving || !d.tries.length) return false;
      var hit = null;
      (App.data.sales || []).forEach(function (s) {
        if (hit || !(s.soldAt > d.lastSold)) return;
        d.tries.forEach(function (t) {
          if (hit || s.repId !== t.repId || s.priceCents !== t.priceCents || s.billing !== t.billing || norm(s.service) !== t.service) return;
          if (t.clientId ? s.clientId === t.clientId : norm(s.clientName) === t.name) hit = s;
        });
      });
      if (!hit) return false;
      saved({ saleId: hit.id, clientId: hit.clientId, jobId: hit.jobId },
        { service: hit.service, priceCents: hit.priceCents, billing: hit.billing, clientId: hit.clientId, appointment: null }, hit.repId, !!changedSince);
      return true;
    }

    function submit() {
      if (view === 'done') { sheet.close(); return; }   /* the saved view: the button reads Done */
      if (saving || view !== 'form') return;        /* a second tap while it is saving does nothing */
      if (adoptSaved()) return;
      collect();
      var bad = check();
      if (bad) {
        sheet.error('');
        sheet.reveal(bad.el);
        if (bad.input) { try { bad.input.focus({ preventScroll: true }); } catch (e) { /* fine */ } }
        return;
      }
      var req = request(), sent = JSON.stringify(req);
      if (d.opId && d.sent !== sent && d.tries.length) {
        /* Something was changed after a try whose answer never came back. That try may have gone through,
           so look first: if it did, show it as saved and send nothing. */
        busy(true);
        App.api.send('sync').then(function (res) {
          /* Look for the earlier try in what came back BEFORE the sheet is let go: letting it go draws the new
             data, and that must not find the sale first and then have this send it again. */
          saving = false;
          var early = res.ok && !gone && adoptSaved(true);
          busy(false);
          if (early || gone || (!res.ok && res.error.code === 'auth')) return;      /* shown as saved; or signed out, and the sign-in screen says why */
          if (closed || view !== 'form') return;
          if (!res.ok) {
            paintButton();
            sheet.error(res.error.message);
            return;
          }
          sendSale(req, sent);
        });
        return;
      }
      sendSale(req, sent);
    }

    function sendSale(req, sent) {
      var seller = sellerId(), known = newestSold();
      var tried = { name: norm(req.client ? req.client.name : ''), clientId: req.clientId || '', service: norm(req.service),
        priceCents: req.priceCents, billing: req.billing, repId: seller };
      /* One id for this attempt, kept until the system answers, whatever is changed between tries: a try
         that got no answer may have saved the sale, and the system will not save the same id twice. */
      if (!d.opId) d.opId = uid();
      d.sent = sent;
      keep();
      busy(true);
      App.api.send('createSale', req, { opId: d.opId }).then(function (res) {
        var code = res.ok ? '' : res.error.code;
        saving = false;
        if (res.ok) d.tries = [];                   /* answered: the redraw that follows has nothing left to look for */
        /* 'already_saved': the first try was saved and this one was not run. The data that came with the answer
           holds that sale. It is looked for before the sheet is let go, so it is shown with the note that says so. */
        var early = code === 'already_saved' && !gone && adoptSaved(true);
        busy(false);
        if (res.ok) { saved(res.result || {}, req, seller); return; }
        if (early || gone || code === 'auth') return;        /* shown as saved; or signed out, and the sign-in screen says why */
        if (view !== 'form') return;                /* new data that arrived meanwhile already showed an earlier try as saved */
        if (code === 'network') {                   /* no answer: it may have saved all the same, so remember what was sent */
          if (!d.tries.length) d.lastSold = known;
          if (!d.tries.some(function (t) { return JSON.stringify(t) === JSON.stringify(tried); })) d.tries = d.tries.concat([tried]).slice(-6);
          if (!closed || !formOpen) keep();
          setTimeout(function () { App.api.send('sync'); }, 0);      /* look straight away: if it did save, the sheet shows it as saved */
        } else if (code === 'already_saved') {
          /* The saved sale could not be picked out of the data: say so in the system's words and start clean. */
          d = blankDraft(me);
          storeDraft(me, null);
          if (!closed) sheet.close();
          App.toast(res.error.message, { bad: true, sticky: true });
          return;
        } else {
          /* The system answered and saved nothing, so no earlier try got through either: the next one is a new save. */
          d.opId = ''; d.sent = ''; d.tries = [];
          if (!closed || !formOpen) keep();
        }
        if (closed) {
          /* The sheet is gone: said where it cannot be missed, until it is tapped. */
          App.toast(res.error.message + ' What you typed is kept.', { bad: true, sticky: true, action: { label: 'Open', onTap: function () { openNewSale({}); } } });
          return;
        }
        paintButton();
        if (code === 'slot_taken' || code === 'slot_closed') {
          sheet.error('');
          f.picker.set(null);                       /* the times shown are already the fresh ones */
          d.appt = null;
          f.picker.setError(res.error.message);
          setLater(false, true);
          sheet.reveal(f.apptLabel);
          keep();
        } else sheet.error(res.error.message);
      });
    }

    function saved(result, req, seller, changedSince) {
      if (!App.data) {              /* the answer came back after the phone was signed out: it is saved, and there is nothing to show it on */
        clearTimeout(timer);
        storeDraft(me, null);
        App.toast('Sale saved.');
        return;
      }
      var sale = result.saleId ? App.sale(result.saleId) : null;
      var job = result.jobId ? App.job(result.jobId) : null;
      var price = sale ? sale.priceCents : req.priceCents, monthly = (sale ? sale.billing : req.billing) === 'monthly';
      var s = App.data.settings;
      done = {
        name: sale && sale.clientName ? sale.clientName : (req.client ? req.client.name : (App.client(req.clientId) || {}).name) || 'Client',
        sold: (sale ? sale.service : req.service) + ', ' + fmt.money(price) + (monthly ? ' a month' : ' one-time'),
        when: job ? fmt.when(job.date, job.time) : (req.appointment && result.jobId ? fmt.when(req.appointment.date, req.appointment.time) : ''),
        who: seller === me.id ? 'You earned' : App.nameOf(seller, 'The rep') + ' earned',
        none: isOwner(seller) || (!!sale && noCommission(sale)),      /* an owner's own sale: no earned amount to show */
        cents: sale && sale.events && sale.events.length ? sale.events[0].cents : (result.commissionCents || 0),
        each: monthly ? share(price, sale ? sale.monthlyPct : s.monthlyPct) : 0,
        early: !!changedSince
      };
      clearTimeout(timer);
      timer = null;
      d = blankDraft(me);
      restored = false;
      storeDraft(me, null);
      if (closed) {
        if (changedSince) App.toast('Your first try was saved, before your last changes. Check it in Sales.', { sticky: true });
        else App.toast('Sale saved.');
        return;
      }
      view = 'done';
      sheet.note('');
      sheet.error('');
      sheet.setButton('Done', false);
      sheet.rebuild();
      sheet.body.scrollTop = 0;
    }

    /* ----- the success view: saved, then do another (a quiet button) or finish (the footer's Done) ----- */
    function drawDone(el) {
      el.appendChild(ui.savedHead('Sale saved'));
      if (done.early) {
        el.appendChild(h('div', { class: 'callout callout-warn' },
          h('p', { class: 'callout-title' }, 'Your first try was saved.'),      /* the words the system uses for the same thing */
          h('p', { class: 'small' }, 'It was saved before your last changes, so those are not in it. Check the details below.')));
      }
      var kvs = h('div', { class: 'kvs' });
      kvs.appendChild(ui.kv('Client', done.name));
      kvs.appendChild(ui.kv('What they bought', done.sold));
      kvs.appendChild(ui.kv('Appointment', done.when || h('span', { class: 'warn strong' }, 'Not booked yet')));
      el.appendChild(kvs);
      if (!done.when) el.appendChild(h('p', { class: 'hint' }, 'When you know the day, open this sale in Sales and book it there.'));
      if (!done.none) {
        el.appendChild(h('div', { class: 'callout callout-ice' },
          h('p', { class: 'muted small' }, done.who),
          h('p', { class: 'big-num ice' }, fmt.money(done.cents)),
          done.each ? h('p', { class: 'small' }, 'Then ' + fmt.money(done.each) + ' every month they stay.') : null));
      }
      el.appendChild(ui.button('New sale', { icon: 'plus', block: true, onTap: function () {
        view = 'form';
        done = null;
        arg = { date: '', clientId: '' };
        sheet.setButton('Save sale', false);
        sheet.rebuild();
        sheet.body.scrollTop = 0;
      } }));
    }

    /* ----- new data while the sheet is open: change only what depends on it, never a typed field ----- */
    function refresh() {
      if (view !== 'form' || !f || adoptSaved()) return;
      if (sig(serviceOptions()) !== f.serviceSig) {
        f.serviceSig = sig(serviceOptions());
        f.service.setOptions(serviceOptions());
        if (d.service && d.service !== OTHER && !serviceById(d.service)) { d.service = ''; f.service.set(null); }
      }
      if (f.rep && sig(repOptions()) !== f.repSig) {
        var cur = f.rep.input.value, list = repOptions();
        f.repSig = sig(list);
        clear(f.rep.input);
        list.forEach(function (o) { f.rep.input.appendChild(h('option', { value: o.value }, o.label)); });
        f.rep.input.value = list.some(function (o) { return o.value === cur; }) ? cur : me.id;
      }
      setMode(d.mode, true);
      setLater(d.later, true);
      earnLine();
    }

    App.sheet.open({
      title: 'New sale',
      body: function (el, sh) {
        sheet = sh;
        if (view === 'done') { drawDone(el); return; }
        drawForm(el);
        f.serviceSig = sig(serviceOptions());
        if (f.rep) f.repSig = sig(repOptions());
        if (!restored && d.mode === 'new' && !hasContent(d)) { try { f.name.input.focus({ preventScroll: true }); } catch (e) { /* fine */ } }
      },
      footer: { label: 'Save sale', onTap: submit },
      update: refresh,
      onClose: function () {
        closed = true;
        formOpen = null;
        if (view === 'form') keep();       /* (nothing is kept once the person has been signed out: see leave) */
        clearTimeout(timer);
      }
    });
    /* The person is being signed out. `stays`: they can sign back in, so what is typed is put away for them. */
    sheet.leave = function (stays) {
      if (stays && view === 'form') keep(); else { clearTimeout(timer); timer = null; }
      gone = true;
    };
    formOpen = sheet;
    if (restored) adoptSaved();
    return sheet;
  }

  /* ================= the leaderboard ================= */

  ui.leaderboard = function (container, o) {
    o = o || {};
    if (!container) return null;
    if (container._board && container._board.parentNode === container) container.removeChild(container._board);

    var rows = h('div');
    var seg = ui.segmented({ label: 'Period', options: PERIODS, value: period, onChange: function (v) { period = v; draw(); } });
    var box = h('div', { class: 'stack' }, seg, rows);

    function commissionOf(id, from) {
      var total = 0;
      (App.data.sales || []).forEach(function (s) { if (s.repId === id) total += earned(s, from); });
      return total;
    }
    function draw() {
      var d = App.data, me = d.me;
      var from = period === 'week' ? D.weekStart(d.today) : period === 'month' ? D.monthStart(d.today) : null;
      var board = (d.board || []).map(function (r) { return { r: r, p: r[period] || { count: 0, cents: 0 } }; })
        .filter(function (x) { return x.p.count > 0 || (x.r.active && x.r.role === 'rep'); })   /* reps always show, even with nothing sold */
        .sort(function (a, b) { return (b.p.cents - a.p.cents) || (b.p.count - a.p.count) || byName(a.r, b.r); });
      clear(rows);
      if (!board.length) {
        rows.appendChild(ui.empty({ title: 'Nobody is on the board yet.',
          text: me.role === 'owner' ? 'Add your sales reps in Team and they show up here.' : null,
          button: me.role === 'owner' ? { label: 'Team', onTap: function () { App.act('openTeam'); } } : null }));
        return;
      }
      var list = h('div', { class: 'list' });
      board.forEach(function (x, i) {
        var mine = x.r.id === me.id;
        var right = [h('span', { class: 'amt' }, fmt.money(x.p.cents))];
        if (o.showCommission) {
          /* An owner's own sales earn nothing: say so in words instead of "$0.00 commission". */
          var got = commissionOf(x.r.id, from);
          right.push(h('span', { class: 'small' }, got || x.r.role !== 'owner' ? fmt.money(got) + ' commission' : 'No commission'));
        }
        var row = ui.row({
          lead: h('span', { class: 'rank' + (i === 0 && x.p.cents > 0 ? ' is-top' : '') }, String(i + 1)),
          title: mine ? h('span', { class: 'cluster' }, x.r.name, ui.pill('You', 'ice')) : x.r.name,
          sub: fmt.plural(x.p.count, 'sale'),
          right: right,
          cls: mine ? 'is-you' : null
        });
        if (right.length > 1) row.querySelector('.row-right').classList.add('row-right-col');
        list.appendChild(row);
      });
      rows.appendChild(list);
    }

    container._board = box;
    container.appendChild(box);
    draw();
    App.live(box, function () { seg.set(period); draw(); });
    return container;
  };

  /* ================= Leaders ================= */

  function renderLeaders(root) {
    var d = App.data, me = d.me, s = d.settings, mo = D.monthStart(d.today);
    var lastFrom = D.addMonths(mo, -1), lastTo = D.addDays(mo, -1);
    var thisMonth = 0, lastMonth = 0, allTime = 0;
    (d.sales || []).forEach(function (sale) {
      if (sale.repId !== me.id) return;
      thisMonth += earned(sale, mo);
      lastMonth += earned(sale, lastFrom, lastTo);
      allTime += earned(sale);
    });

    root.appendChild(ui.title('Leaderboard'));
    var box = h('div');
    root.appendChild(box);
    ui.leaderboard(box, { showCommission: false });

    root.appendChild(ui.label('My commission'));
    root.appendChild(numbersCard(null, 'This month', thisMonth, [['Last month', lastMonth], ['All time', allTime]]));
    root.appendChild(h('p', { class: 'muted' }, 'You earn ' + pct(s.firstPct) + ' of each sale, then ' + pct(s.monthlyPct) + ' every month a monthly client stays.'));
  }

  /* ================= registering ================= */

  App.screen('sales', { roles: ['owner', 'rep'], title: 'Sales', render: renderSales });
  App.screen('leaders', { roles: ['rep'], title: 'Leaderboard', render: renderLeaders });
  App.actions.newSale = openNewSale;
  App.actions.openSale = openSale;
})();
