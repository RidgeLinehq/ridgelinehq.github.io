/*
 * Ridgeline Wash Co. team app: the Clients screen (#clients) and everything that opens from it.
 *
 * The list: search (name, phone, address), status filters with counts, one row per client.
 * The Client sheet: quick actions, details, payment (status and link), notes, jobs and "Book a
 *   visit"; for the owner also "Edit details" (which is also where a client is handed to another
 *   rep), "Status" and "Delete client"; for a rep "Edit contact details". A rep only ever holds
 *   their own clients, so that is all they see.
 *
 * Entry points for other screens:
 *   App.actions.openClient(id)         open the Client sheet
 *   App.actions.bookVisit(clientId)    open "Book a visit" for a client
 */
(function () {
  'use strict';

  var h = App.h, ui = App.ui, fmt = App.fmt;
  var Core = RidgelineCore, D = Core.dates, LIMITS = Core.LIMITS;

  var PAY = [{ value: 'unpaid', label: 'Not paid yet' }, { value: 'paid', label: 'Paid' }, { value: 'late', label: 'Late' }];
  var PAY_SAVED = { unpaid: 'Marked as not paid yet.', paid: 'Marked as paid.', late: 'Marked as late.' };
  var OTHER = '__other__';
  var LINK_OK = /^https:\/\/[^\s<>"'`]+$/i;      /* the same rule the system saves by */

  /* View state. It lives here because render runs again every time the data changes. */
  var query = '', filter = '', viewer = null;

  /* ---------- small helpers ---------- */

  function clear(el) { el.textContent = ''; return el; }
  function idOf(arg) { return arg && typeof arg === 'object' ? (arg.clientId || arg.id) : arg; }
  function gone() { App.toast('That client is no longer here.'); return null; }

  /* "Window cleaning, $150.00 a month" or "House wash, $300.00 one-time". The price stays in one piece when the line wraps. */
  function serviceLine(c) {
    var price = fmt.money(c.priceCents) + (c.billing === 'monthly' ? ' a month' : ' one-time');
    return h('span', null, c.service ? c.service + ', ' : null, h('span', { class: 'client-price' }, price));
  }
  function byName(a, b) {
    var x = String(a.name || '').toLowerCase(), y = String(b.name || '').toLowerCase();
    return x < y ? -1 : x > y ? 1 : 0;
  }
  function newestFirst(a, b) { return a.date > b.date ? -1 : a.date < b.date ? 1 : a.time > b.time ? -1 : a.time < b.time ? 1 : 0; }
  /* One visit in a client's own list: the same row as App.ui.jobRow, but led by what was done, not the client's name again. */
  function visitRow(job) {
    return ui.row({
      lead: h('span', { class: 'row-time' }, h('small', null, fmt.day(job.date)), fmt.time(job.time)),
      title: job.what || 'Visit', right: ui.jobPill(job), chevron: false,
      onTap: function () { ui.openJob(job.id); }
    });
  }
  /* A rep's name. For the rep a client belongs to now, it also says when they have left the team. */
  function repName(memberId, current) {
    var m = App.member(memberId);
    if (!m) return 'Someone who has left';
    return m.name + (current && !m.active ? ' (no longer on the team)' : '');
  }
  /* Is a monthly plan still paying for this client? (Only the owner holds every sale.) */
  function hasMonthlyPlan(id) {
    return App.data.sales.some(function (s) { return s.clientId === id && s.billing === 'monthly' && !s.endDay; });
  }
  function jobsOf(id) { return App.data.jobs.filter(function (j) { return j.clientId === id; }).sort(newestFirst); }
  /* A sale for this client that still has no appointment (the oldest one first). */
  function waitingSale(id) {
    var list = App.data.sales.filter(function (s) { return s.clientId === id && !s.jobId; })
      .sort(function (a, b) { return (a.soldAt || 0) - (b.soldAt || 0); });
    return list[0] || null;
  }

  function matches(c, q) {
    if (!q) return true;
    if ([c.name, c.contact, c.phone, c.address].join(' ').toLowerCase().indexOf(q) >= 0) return true;
    var digits = q.replace(/\D/g, '');      /* "6155550112" finds "615-555-0112" */
    return digits.length >= 3 && !/[^\d\s().+-]/.test(q) && String(c.phone || '').replace(/\D/g, '').indexOf(digits) >= 0;
  }

  function copyText(text) {
    function oldWay() {
      var box = h('textarea', { readonly: true, 'aria-hidden': 'true', tabindex: '-1' }), ok = false;
      box.value = text;
      box.style.cssText = 'position:fixed;left:0;top:0;width:1px;height:1px;opacity:0;';
      document.body.appendChild(box);
      try { box.select(); box.setSelectionRange(0, text.length); ok = document.execCommand('copy'); } catch (e) { ok = false; }
      document.body.removeChild(box);
      return ok;
    }
    try {
      if (navigator.clipboard && navigator.clipboard.writeText) {
        return navigator.clipboard.writeText(text).then(function () { return true; }, function () { return oldWay(); });
      }
    } catch (e) { /* fall through */ }
    return Promise.resolve(oldWay());
  }

  /* ---------- the list ---------- */

  function render(root) {
    var me = App.me(), all = App.data.clients || [];
    if (viewer !== me.id) { viewer = me.id; query = ''; filter = ''; }
    root.appendChild(ui.title('Clients'));

    if (!all.length) {
      root.appendChild(ui.empty({ title: 'No clients yet.',
        text: me.role === 'owner' ? 'A client is added here each time a sale is entered.' : 'Your clients show up here after your first sale.',
        button: { label: 'New sale', kind: 'primary', onTap: function () { App.act('newSale', {}); } } }));
      return;
    }

    var input = h('input', { class: 'input', type: 'text', name: 'client-search', inputmode: 'search', enterkeyhint: 'search',
      placeholder: 'Search name, phone or address', autocomplete: 'off', autocapitalize: 'none', autocorrect: 'off', spellcheck: 'false',
      'aria-label': 'Search clients' });
    input.value = query;
    input.addEventListener('input', function () { query = input.value; draw(); });
    root.appendChild(h('div', { class: 'search' }, App.icon('search', 20), input));

    var chips = ui.chips({ options: [], value: filter, scroll: true, label: 'Show', onChange: function (v) { filter = v || ''; draw(); } });
    root.appendChild(chips);
    var listEl = h('div', { class: 'stack' });
    root.appendChild(listEl);

    /* The filter row slides sideways and is redrawn on every change: keep the chosen filter in view. */
    function showChosen() {
      var on = chips.querySelector('.chip.is-on');
      if (!on) return;
      var box = chips.getBoundingClientRect(), b = on.getBoundingClientRect();
      if (b.right > box.right - 16) chips.scrollLeft += b.right - box.right + 16;
      else if (b.left < box.left + 16) chips.scrollLeft -= box.left + 16 - b.left;
    }

    function draw() {
      var q = query.trim().toLowerCase();
      var found = all.filter(function (c) { return matches(c, q); });
      var counts = {};
      found.forEach(function (c) { counts[c.status] = (counts[c.status] || 0) + 1; });
      chips.setOptions([{ value: '', label: 'All', count: found.length }].concat(Core.CLIENT_STATUSES.map(function (s) {
        return { value: s, label: s, count: counts[s] || 0 };
      })));

      showChosen();

      var shown = found.filter(function (c) { return !filter || c.status === filter; }).sort(byName);
      clear(listEl);
      if (!shown.length) {
        listEl.appendChild(ui.empty({
          title: q ? 'No clients match that search.' : 'No ' + filter.toLowerCase() + ' clients.',
          text: q ? 'Check the spelling, or try a phone number or a street name.' : null,
          button: { label: 'Show all clients', onTap: function () {
            query = ''; filter = '';
            input.value = '';
            chips.set('');
            draw();
          } }
        }));
        return;
      }
      var list = h('div', { class: 'list' });
      shown.forEach(function (c) {
        list.appendChild(ui.row({
          title: c.name, sub: serviceLine(c), chevron: false,
          right: [c.payStatus === 'late' ? ui.pill('Late', 'bad') : null, ui.clientPill(c.status)],
          onTap: function () { openClient(c.id); }
        }));
      });
      listEl.appendChild(list);
    }
    draw();
  }

  /* ---------- the Client sheet ---------- */

  function openClient(arg) {
    var id = idOf(arg), first = App.client(id);
    if (!first) return gone();
    var owner = App.role() === 'owner', sheet = null, deleting = false;

    /* The parts that are redrawn when the data changes. The note box is never touched, so nothing typed is lost. */
    var top = h('div', { class: 'stack-md' }), details = h('div', { class: 'kvs' }), pay = h('div', { class: 'stack-md' });
    var notesEl = h('div'), jobsEl = h('div', { class: 'stack-md' }), manage = h('div', { class: 'stack' });

    var noteBox = ui.field({ name: 'client-note', type: 'textarea', rows: 3, maxlength: LIMITS.text, placeholder: 'What should the team know about this client?' });
    noteBox.input.setAttribute('aria-label', 'New note');
    var noteErr = h('p', { class: 'form-error', role: 'alert', hidden: true });
    var noteBtn = ui.button('Add note', { icon: 'note', small: true, onTap: function () {
      var text = noteBox.val();
      if (!text) { noteBox.setError('Write the note first.'); return; }
      var fields = { kind: 'client', id: id, text: text };
      ui.save(noteBtn, 'addNote', fields, { errorEl: noteErr }).then(function (res) {
        if (!res.ok) return;
        noteBox.input.value = '';
        App.toast('Note saved.');
      });
    } });

    var delErr = h('p', { class: 'form-error', role: 'alert', hidden: true });
    var delBtn = ui.button('Delete client', { kind: 'danger', block: true, onTap: removeClient });

    /* One tap: the control flips at once, and goes back with a red message if the save fails. */
    function quick(patch, savedText, opId) {
      App.api.send('updateClient', { clientId: id, patch: patch }, { opId: opId }).then(function (res) {
        if (res.ok) { App.toast(savedText); return; }
        if (App.client(id)) draw();
        App.toast(res.error.message, { bad: true, retry: res.error.code === 'network' ? function () { quick(patch, savedText, res.opId); } : null });
      });
    }

    /* Cancelling ends a monthly plan for good (unless it is taken back the same day), so that one asks first. */
    function setStatus(status, monthly) {
      var saved = 'Status changed to ' + status + '.';
      if (status !== 'Cancelled' || !monthly) { quick({ status: status }, saved); return; }
      App.confirm({
        title: 'Cancel this client?',
        text: 'Their monthly plan ends today, and so does the monthly commission on it. Set them back to Active today and nothing is lost. After today the plan does not start again.',
        yes: 'Cancel client', no: 'Keep them', danger: true
      }).then(function (yes) {
        if (yes) quick({ status: status }, saved);
        else draw();
      });
    }

    function removeClient() {
      var c = App.client(id);
      if (!c) return;
      var sales = App.data.sales.filter(function (s) { return s.clientId === id; }).length;
      var jobs = App.data.jobs.filter(function (j) { return j.clientId === id; }).length, parts = [];
      if (sales) parts.push(fmt.plural(sales, 'sale'));
      if (jobs) parts.push(fmt.plural(jobs, 'job'));
      App.confirm({
        title: 'Delete this client?',
        text: c.name + ' will be removed for good. ' +
          (parts.length ? 'This also removes their ' + parts.join(' and ') + '.' : 'Their sales and jobs are removed too.'),
        yes: 'Delete client', no: 'Keep client', danger: true
      }).then(function (yes) {
        if (!yes) return;
        deleting = true;
        ui.save(delBtn, 'deleteClient', { clientId: id }, { errorEl: delErr }).then(function (res) {
          if (res.skipped) return;
          if (res.ok) { sheet.close(); App.toast('Client deleted.'); return; }
          deleting = false;
          if (!App.client(id)) sheet.close();
        });
      });
    }

    function drawTop(c) {
      var tel = fmt.tel(c.phone);
      clear(top);
      top.appendChild(h('div', { class: 'cluster' }, ui.clientPill(c.status), c.payStatus === 'late' ? ui.pill('Late', 'bad') : null));
      if (tel || c.address) {
        top.appendChild(h('div', { class: 'btn-row' },
          tel ? ui.button('Call', { icon: 'phone', small: true, href: tel }) : null,
          c.address ? ui.button('Directions', { icon: 'directions', small: true, href: fmt.maps(c.address), newTab: true }) : null));
      }
    }

    function drawDetails(c) {
      /* Who sold it is on the first sale; the client's own rep can be someone else once the owner hands them over. */
      var first = App.data.sales.filter(function (s) { return s.clientId === id; })
        .sort(function (a, b) { return (a.soldAt || 0) - (b.soldAt || 0); })[0];
      var sellerId = first ? first.repId : owner ? c.repId : null;
      var seller = sellerId ? repName(sellerId, sellerId === c.repId) : '';
      clear(details);
      if (c.contact) details.appendChild(ui.kv('Contact', c.contact));
      if (c.phone) details.appendChild(ui.kv('Phone', c.phone));
      if (c.email) details.appendChild(ui.kv('Email', c.email));
      if (c.address) details.appendChild(ui.kv('Address', c.address));
      details.appendChild(ui.kv('Service and price', serviceLine(c)));
      if (c.startDate) details.appendChild(ui.kv('Start date', fmt.day(c.startDate)));
      if (seller) details.appendChild(ui.kv('Sold by', seller));
      if (c.repId && c.repId !== sellerId) details.appendChild(ui.kv('Looked after by', repName(c.repId, true)));
    }

    function drawPay(c) {
      var link = c.stripeLink || '', safe = LINK_OK.test(link);
      clear(pay);
      if (owner) {
        pay.appendChild(ui.segmented({ label: 'Payment status', options: PAY, value: c.payStatus || 'unpaid',
          onChange: function (v) { quick({ payStatus: v }, PAY_SAVED[v]); } }));
      } else {
        pay.appendChild(h('div', { class: 'kvs' }, ui.kv('Status', ui.payPill(c.payStatus))));
      }
      if (!link) {
        pay.appendChild(h('p', { class: 'muted' }, 'No payment link yet.'));
        if (owner) pay.appendChild(ui.button('Add payment link', { icon: 'plus', small: true, onTap: function () { openLink(id); } }));
        return;
      }
      /* Only ever a real link when it starts with https://. Anything else is shown as plain words. */
      pay.appendChild(h('div', { class: 'callout' }, h('p', { class: 'small' }, link)));
      if (!safe) pay.appendChild(h('p', { class: 'hint' }, 'This link does not start with https://, so it cannot be opened from here.'));
      pay.appendChild(h('div', { class: 'btn-row' },
        safe ? ui.button('Open', { icon: 'external', small: true, href: link, newTab: true }) : null,
        ui.button('Copy', { icon: 'copy', small: true, onTap: function () {
          copyText(link).then(function (ok) {
            if (ok) App.toast('Payment link copied.');
            else App.toast('Could not copy it. Press and hold the link to copy it yourself.', { bad: true });
          });
        } }),
        owner ? ui.button('Edit', { icon: 'edit', small: true, onTap: function () { openLink(id); } }) : null));
    }

    function drawNotes(c) {
      clear(notesEl);
      notesEl.appendChild((c.notes || []).length ? ui.notes(c.notes) : h('p', { class: 'muted' }, 'No notes yet.'));
    }

    function drawJobs() {
      var jobs = jobsOf(id), waiting = waitingSale(id);
      clear(jobsEl);
      if (jobs.length) {
        var list = h('div', { class: 'list' });
        jobs.forEach(function (job) { list.appendChild(visitRow(job)); });
        jobsEl.appendChild(list);
      } else {
        jobsEl.appendChild(h('p', { class: 'muted' }, 'No visits yet.'));
      }
      if (waiting) jobsEl.appendChild(h('p', { class: 'warn small strong' }, 'The sale from ' + fmt.day(waiting.day) + ' has no appointment yet.'));
      jobsEl.appendChild(ui.button('Book a visit', { icon: 'calendar', block: true, kind: waiting ? 'primary' : 'quiet', onTap: function () { bookVisit(id); } }));
    }

    function drawManage(c) {
      clear(manage);
      manage.appendChild(h('div', { class: 'list' },
        ui.row({ icon: 'edit', title: owner ? 'Edit details' : 'Edit contact details', onTap: function () { openEdit(id); } })));
      if (!owner) return;
      var monthly = hasMonthlyPlan(id);
      manage.appendChild(h('div', { class: 'field' },
        h('span', { class: 'field-label' }, 'Status'),
        ui.segmented({ label: 'Client status', value: c.status,
          options: Core.CLIENT_STATUSES.map(function (s) { return { value: s, label: s }; }),
          onChange: function (v) { setStatus(v, monthly); } }),
        monthly ? h('p', { class: 'field-hint' }, 'Paused holds the monthly commission until they are active again. Cancelled ends the monthly plan.') : null));
      manage.appendChild(delBtn);
      manage.appendChild(delErr);
    }

    function draw() {
      var c = App.client(id);
      if (!c) return;
      drawTop(c); drawDetails(c); drawPay(c); drawNotes(c); drawJobs(); drawManage(c);
    }

    sheet = App.sheet.open({
      title: first.name,
      body: function (el) {
        [top, ui.label('Details'), details, ui.label('Payment'), pay, ui.label('Notes'), noteBox, noteBtn, noteErr, notesEl,
          ui.label('Jobs'), jobsEl, ui.label(owner ? 'Manage this client' : 'Change this client'), manage
        ].forEach(function (part) { el.appendChild(part); });
        draw();
      },
      update: function (sh) {
        if (deleting) return;
        var now = App.client(id);
        if (!now) { sh.close(); App.toast('That client is no longer on your list.'); return; }
        sh.setTitle(now.name);
        draw();
      }
    });
    return sheet;
  }

  /* ---------- the payment link (owner) ---------- */

  function linkProblem(link) {
    if (!link) return '';
    if (!/^https:\/\//i.test(link)) return 'A payment link must start with https://';
    if (link.length > 300) return 'That payment link is too long.';
    if (!LINK_OK.test(link)) return 'That does not look like a whole link. Copy it again and paste it here.';
    return '';
  }

  function openLink(id) {
    var c = App.client(id);
    if (!c) return gone();
    var had = c.stripeLink || '';
    var box = ui.field({ label: 'Payment link', name: 'pay-link', value: had, placeholder: 'https://', inputmode: 'url', autocapitalize: 'none',
      hint: had ? 'To remove the link, clear the box and save. A link has to start with https://' : 'Paste the link this client pays with. It has to start with https://' });
    return App.sheet.open({
      title: had ? 'Edit payment link' : 'Add payment link', small: true,
      body: function (el) { el.appendChild(box); },
      footer: { label: 'Save link', onTap: function (sh) {
        var link = box.val(), problem = linkProblem(link);
        if (problem) { box.setError(problem); return; }
        if (link === had) { sh.close(); return; }
        var fields = { clientId: id, patch: { stripeLink: link } };
        sh.send('updateClient', fields).then(function (res) {
          if (!res.ok) return;
          sh.close();
          App.toast(link ? 'Payment link saved.' : 'Payment link removed.');
        });
      } }
    });
  }

  /* ---------- edit details (owner: everything; rep: contact details) ---------- */

  function openEdit(id) {
    var c = App.client(id);
    if (!c) return gone();
    var owner = App.role() === 'owner';

    var name = ui.field({ label: 'Customer or business name', name: 'c-name', value: c.name, maxlength: LIMITS.name, autocapitalize: 'words' });
    var contact = ui.field({ label: 'Contact name', name: 'c-contact', value: c.contact, optional: true, maxlength: LIMITS.name, autocapitalize: 'words' });
    var phone = ui.field({ label: 'Phone', name: 'c-phone', type: 'tel', value: c.phone, maxlength: 30 });
    var email = ui.field({ label: 'Email', name: 'c-email', type: 'email', value: c.email, optional: true, maxlength: 120 });
    var address = ui.field({ label: 'Address', name: 'c-address', value: c.address, maxlength: LIMITS.line, autocapitalize: 'words' });
    var service, other, price, often, start, rep;

    if (owner) {
      var names = (App.data.settings.services || []).map(function (s) { return s.name; });
      var options = names.map(function (n) { return { value: n, label: n }; });
      if (c.service && names.indexOf(c.service) < 0) options.unshift({ value: c.service, label: c.service });
      options.push({ value: OTHER, label: 'Other' });
      other = ui.field({ label: 'Service name', name: 'c-service-other', maxlength: 60 });
      other.hidden = true;
      service = ui.field({ label: 'Service', name: 'c-service', type: 'select', options: options, value: c.service || options[0].value,
        onInput: function (v) { other.hidden = v !== OTHER; } });
      price = ui.field({ label: 'Price', name: 'c-price', inputmode: 'decimal', prefix: '$', value: ((c.priceCents || 0) / 100).toFixed(2), maxlength: 12 });
      often = ui.segmented({ label: 'How often', value: c.billing === 'monthly' ? 'monthly' : 'once',
        options: [{ value: 'once', label: 'One-time' }, { value: 'monthly', label: 'Monthly' }] });
      start = ui.field({ label: 'Start date', name: 'c-start', type: 'date', value: c.startDate || '' });

      /* A client can be looked after by any sales rep or owner who is on the team. */
      var me = App.me(), people = [{ value: me.id, label: me.name + ' (you)' }].concat(App.people(['rep', 'owner']).filter(function (m) {
        return m.id !== me.id;
      }).sort(byName).map(function (m) { return { value: m.id, label: m.name }; }));
      if (c.repId && !people.some(function (o) { return o.value === c.repId; })) people.unshift({ value: c.repId, label: repName(c.repId, true) });
      rep = ui.field({ label: 'Looked after by', name: 'c-rep', type: 'select', options: people, value: c.repId || me.id,
        hint: 'This person sees the client and books their visits. Sales already made stay with whoever made them.' });
    }

    return App.sheet.open({
      title: owner ? 'Edit details' : 'Edit contact details',
      body: function (el) {
        var parts = [name, contact, phone, email, address];
        if (owner) {
          parts = [ui.label('Contact details')].concat(parts, [ui.label('What they buy'), service, other, price,
            h('div', { class: 'field' }, h('span', { class: 'field-label' }, 'How often'), often), start, ui.label('Their rep'), rep]);
        }
        parts.forEach(function (part) { el.appendChild(part); });
      },
      footer: { label: 'Save', onTap: function (sh) {
        var bad = [];
        function fail(field, message) { field.setError(message); bad.push(field); }
        var patch = { name: name.val(), contact: contact.val(), phone: phone.val(), email: email.val(), address: address.val() };
        if (!patch.name) fail(name, 'Add the customer or business name.');
        if (patch.email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(patch.email)) fail(email, 'That email address does not look right.');
        if (owner) {
          patch.service = service.input.value === OTHER ? other.val() : service.input.value;
          if (!patch.service) fail(service.input.value === OTHER ? other : service, 'Type the name of the service.');
          patch.priceCents = fmt.toCents(price.val());
          if (patch.priceCents == null) fail(price, 'Enter the price, like 150 or 150.00.');
          else if (patch.priceCents > LIMITS.maxCents) fail(price, 'That price is too high.');
          patch.billing = often.get();
          patch.startDate = start.val();
          if (!D.isDay(patch.startDate)) fail(start, 'Pick the start date.');
          if (rep.input.value && rep.input.value !== c.repId) patch.repId = rep.input.value;     /* only when it is handed to someone new */
        }
        if (bad.length) { sh.reveal(bad[0]); return; }

        var now = App.client(id) || c, changed = false, k;
        for (k in patch) if (patch[k] !== (now[k] == null ? '' : now[k])) changed = true;
        if (!changed) { sh.close(); return; }

        var fields = { clientId: id, patch: patch };
        sh.send('updateClient', fields).then(function (res) {
          if (!res.ok) return;
          sh.close();
          App.toast(patch.repId ? 'Saved. ' + App.nameOf(patch.repId, 'Their new rep') + ' looks after this client now.' : 'Saved.');
        });
      } }
    });
  }

  /* ---------- book a visit ---------- */

  function bookVisit(arg) {
    var id = idOf(arg), c = App.client(id), picker = null;
    if (!c) return gone();
    var last = jobsOf(id)[0];
    var what = ui.field({ label: 'What needs to be done', name: 'visit-what', value: (last && last.what) || c.service || '', maxlength: LIMITS.line });

    function label(v) { return v ? 'Book ' + fmt.when(v.date, v.time) : 'Pick a day and a time'; }

    var sheet = App.sheet.open({
      title: 'Book a visit',
      body: function (el, sh) {
        el.appendChild(h('p', { class: 'muted' }, 'A new visit for ', h('b', { class: 'strong' }, c.name), '.'));
        el.appendChild(what);
        el.appendChild(ui.label('When'));
        picker = ui.slotPicker({
          emptyText: App.role() === 'owner' ? 'No open days yet. Open some in Calendar first.' : null,
          onChange: function (v) { sh.setButton(label(v), !v); }
        });
        el.appendChild(picker);
      },
      footer: { label: label(null), onTap: function (sh) {
        var v = picker.get(), waiting = waitingSale(id);
        if (!v) return;
        var fields = { clientId: id, date: v.date, time: v.time, what: what.val() };
        if (waiting) fields.saleId = waiting.id;
        sh.send('bookJob', fields).then(function (res) {
          if (res.ok) {
            sh.close();
            App.toast('Booked ' + fmt.when(v.date, v.time) + '.');
          } else if (res.error.code === 'slot_taken' || res.error.code === 'slot_closed') {
            sh.error('');
            picker.set(null);
            picker.setError(res.error.message);
            sh.setButton(label(null), true);
          }
        });
      } }
    });
    sheet.setButton(label(null), true);
    return sheet;
  }

  /* ---------- register ---------- */

  App.screen('clients', { roles: ['owner', 'rep'], title: 'Clients', render: render });
  App.actions.openClient = openClient;
  App.actions.bookVisit = bookVisit;
})();
