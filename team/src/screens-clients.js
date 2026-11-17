/*
 * Ridgeline Wash Co. team app: the Clients screen (#clients) and everything that opens from it.
 *
 * The list: search (name, phone, address), status filters with counts, one row per client.
 * The Client sheet: quick actions, details with "Edit details" beside them (for a rep "Edit
 *   contact details"; for the owner it is also where a client is handed to another rep), payment
 *   (status and link, with where the link really goes), notes, jobs and "Book an appointment";
 *   for the owner also "Status" and "Remove client". A rep only ever holds their own clients, so
 *   that is all they see.
 *
 * Entry points for other screens:
 *   App.actions.openClient(id)         open the Client sheet. openClient({ id: id, show: 'jobs' })
 *                                      opens it at its Jobs, where "Book an appointment" is.
 *   App.actions.bookVisit(clientId)    open "Book an appointment" for a client
 *   App.needsAppointment(client)       true for a New or Active monthly client with no job booked
 *                                      from today on (the Dashboard lists them; so does the sheet)
 */
(function () {
  'use strict';

  var h = App.h, ui = App.ui, fmt = App.fmt;
  var Core = RidgelineCore, D = Core.dates, LIMITS = Core.LIMITS;

  var PAY = [{ value: 'unpaid', label: 'Not paid yet' }, { value: 'paid', label: 'Paid' }, { value: 'late', label: 'Late' }];
  var PAY_SAVED = { unpaid: 'Marked as not paid yet.', paid: 'Marked as paid.', late: 'Marked as late.' };
  var OTHER = '__other__';
  /* What this page checks before it sends a link or shows one as a link. The system has the last word on a
     link it is asked to save (it also refuses look-alikes), and its own words are shown when it says no. */
  var LINK_OK = /^https:\/\/[^\s<>"'`]+$/i;
  var PRICE_HELP = 'Enter the price in dollars, like 150 or 150.50.';

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
  /* The newest sale to this client: the one their service and price come from. */
  function newestSale(id) {
    var list = App.data.sales.filter(function (s) { return s.clientId === id; })
      .sort(function (a, b) { return ((b.soldAt || 0) - (a.soldAt || 0)) || (a.day < b.day ? 1 : a.day > b.day ? -1 : 0); });
    return list[0] || null;
  }
  /* A monthly client who is still with us (New or Active) and has nothing booked from today on. */
  function needsAppointment(c) {
    if (!c || !App.data || c.billing !== 'monthly' || (c.status !== 'New' && c.status !== 'Active')) return false;
    var today = App.today();
    return !App.data.jobs.some(function (j) { return j.clientId === c.id && j.status === 'scheduled' && j.date >= today; });
  }
  /* Where a link really goes: the host the phone would open, whatever the words in front of it say. '' when it is not a link. */
  function hostOf(link) {
    try {
      var u = new URL(String(link || ''));
      return u.protocol === 'https:' && u.hostname ? u.hostname : '';
    } catch (e) { return ''; }
  }

  /* Does the client read the way a change was sent? (How a try that got no answer is recognised as saved.) */
  function holds(id, patch) {
    var c = App.client(id);
    return !!c && Object.keys(patch).every(function (k) { return (c[k] == null ? '' : c[k]) === patch[k]; });
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

  /* The search box and the filter row are built once and stay on the page for as long as the screen does.
     When new data arrives only the list under them is drawn again (see `update` where the screen is
     registered): someone typing in the box keeps the keyboard, the cursor and every letter. */
  var listUi = null;      /* { who, listEl, draw } while the list is on screen */

  function render(root) {
    var me = App.me();
    if (viewer !== me.id) { viewer = me.id; query = ''; filter = ''; }
    listUi = null;
    root.appendChild(ui.title('Clients'));

    if (!(App.data.clients || []).length) {
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

    /* The filter row slides sideways: keep the chosen filter in view. */
    function showChosen() {
      var on = chips.querySelector('.chip.is-on');
      if (!on) return;
      var box = chips.getBoundingClientRect(), b = on.getBoundingClientRect();
      if (b.right > box.right - 16) chips.scrollLeft += b.right - box.right + 16;
      else if (b.left < box.left + 16) chips.scrollLeft -= box.left + 16 - b.left;
    }

    function draw() {
      var all = App.data.clients || [];
      var q = query.trim().toLowerCase();
      var found = all.filter(function (c) { return matches(c, q); });
      var counts = {};
      found.forEach(function (c) { counts[c.status] = (counts[c.status] || 0) + 1; });
      /* Only the counts on the chips change; the chips themselves stay as they are. */
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
    listUi = { who: me.id, listEl: listEl, draw: draw };
    draw();
  }

  /* New data while the screen is showing: draw the list again and leave the rest alone. Answers false when
     the whole screen has to be built again (the first client arrived, the last one went, someone else signed in). */
  function update(root) {
    var me = App.me();
    if (!listUi || !me || listUi.who !== me.id || !root.contains(listUi.listEl) || !(App.data.clients || []).length) return false;
    listUi.draw();
    return true;
  }

  /* ---------- the Client sheet ---------- */

  function openClient(arg) {
    var id = idOf(arg), first = App.client(id);
    if (!first) return gone();
    var show = arg && typeof arg === 'object' ? arg.show : null;
    var owner = App.role() === 'owner', sheet = null, deleting = false;

    /* The parts that are redrawn when the data changes. */
    var top = h('div', { class: 'stack-md' }), details = h('div', { class: 'kvs' }), pay = h('div', { class: 'stack-md' });
    var notesEl = h('div'), jobsEl = h('div', { class: 'stack-md' }), manage = h('div', { class: 'stack' });

    /* "Edit details" sits with the details it changes, on the line of their label. */
    var detailsHead = h('div', { class: 'sec-head' }, ui.label('Details'),
      ui.button(owner ? 'Edit details' : 'Edit contact details', { kind: 'text', onTap: function () { openEdit(id); } }));
    var jobsLabel = ui.label('Jobs');
    /* Notes are added the same way everywhere: the small Add note sheet. */
    var noteBtn = ui.button('Add note', { icon: 'note', small: true, block: true, onTap: function () { ui.addNote('client', id); } });

    var delErr = h('p', { class: 'form-error', role: 'alert', hidden: true });
    var delBtn = ui.button('Remove client', { kind: 'danger', block: true, onTap: removeClient });

    /* One tap: the control flips at once. While that is being saved nothing else in the sheet can be tapped
       and new data does not redraw it. If it cannot be saved, the control goes back to what the system holds
       and a red message says so until it is tapped, with Retry. */
    function quick(patch, savedText) {
      ui.save(null, 'updateClient', { clientId: id, patch: patch }, { sheet: sheet, saved: savedText,
        /* No answer came, and then the client reads the way it was tapped: it was saved. */
        landed: function () { return holds(id, patch); }, onLanded: function () { App.toast(savedText); }
      }).then(function (res) {
        if (res.ok) App.toast(savedText);
        else if (App.client(id)) draw();
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
        title: 'Remove this client?',
        text: c.name + ' will be removed for good. ' +
          (parts.length ? 'This also removes their ' + parts.join(' and ') + '.' : 'Their sales and jobs are removed too.'),
        yes: 'Remove client', no: 'Keep client', danger: true
      }).then(function (yes) {
        if (!yes) return;
        function removed() { sheet.close(); App.toast('Client removed.'); }
        deleting = true;
        ui.save(delBtn, 'deleteClient', { clientId: id }, { errorEl: delErr, saved: removed,
          landed: function () { return !App.client(id); }, onLanded: removed
        }).then(function (res) {
          if (res.skipped) return;
          if (res.ok) { removed(); return; }
          deleting = false;
          if (!App.client(id)) sheet.close(); else draw();
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
      if (c.repId && c.repId !== sellerId) details.appendChild(ui.kv('Their rep', repName(c.repId, true)));
    }

    function drawPay(c) {
      var link = c.stripeLink || '', host = LINK_OK.test(link) ? hostOf(link) : '';
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
      /* Only ever a real link when it starts with https:// and the phone can tell where it goes. Anything else is plain words. */
      pay.appendChild(h('div', { class: 'callout' }, h('p', { class: 'small' }, link)));
      if (host) {
        /* The words of a link can be dressed up to look like another site. This is where it really goes. */
        pay.appendChild(h('p', { class: 'pay-goes' }, 'Opens ', h('b', { class: 'pay-host' }, host)));
      } else {
        pay.appendChild(h('p', { class: 'hint' }, /^https:\/\//i.test(link)
          ? 'This does not look like a whole link, so it cannot be opened from here.'
          : 'This link does not start with https://, so it cannot be opened from here.'));
      }
      pay.appendChild(h('div', { class: 'btn-row' },
        host ? ui.button('Open', { icon: 'external', small: true, href: link, newTab: true }) : null,
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

    /* What to do next comes first (the reason, then the button), the history under it. */
    function drawJobs(c) {
      var jobs = jobsOf(id), waiting = waitingSale(id), due = !waiting && needsAppointment(c);
      clear(jobsEl);
      if (waiting) jobsEl.appendChild(h('p', { class: 'warn small strong' }, 'The sale from ' + fmt.day(waiting.day) + ' has no appointment yet.'));
      else if (due) jobsEl.appendChild(h('p', { class: 'warn small strong' }, 'This monthly client has no next appointment.'));
      jobsEl.appendChild(ui.button('Book an appointment', { icon: 'calendar', block: true, small: !(waiting || due),
        kind: waiting || due ? 'primary' : 'quiet', onTap: function () { bookVisit(id); } }));
      if (jobs.length) {
        var list = h('div', { class: 'list' });
        /* The shared job row, led by what was done: the client's name is already the title of this sheet. */
        jobs.forEach(function (job) { list.appendChild(ui.jobRow(job, { showDate: true, title: job.what || 'Job', sub: [] })); });
        jobsEl.appendChild(list);
      } else {
        jobsEl.appendChild(h('p', { class: 'muted' }, 'No jobs yet.'));
      }
    }

    function drawManage(c) {
      clear(manage);
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
      drawTop(c); drawDetails(c); drawPay(c); drawNotes(c); drawJobs(c); drawManage(c);
    }

    sheet = App.sheet.open({
      title: first.name,
      body: function (el) {
        var parts = [top, detailsHead, details, ui.label('Payment'), pay, ui.label('Notes'), noteBtn, notesEl, jobsLabel, jobsEl];
        if (owner) parts.push(ui.label('Manage this client'), manage);
        parts.forEach(function (part) { el.appendChild(part); });
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
    if (show === 'jobs') sheet.reveal(jobsLabel);
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
        var fields = { clientId: id, patch: { stripeLink: link } };
        /* Nothing was changed: close. Unless an earlier try from here got no answer: that one may have saved, so
           this goes out too (under the same id) and the system says which it was. */
        if (link === had && !sh.unanswered('updateClient', fields, 'link')) { sh.close(); return; }
        var said = link ? 'Payment link saved.' : 'Payment link removed.';
        sh.send('updateClient', fields, { attempt: 'link', saved: said, landed: function () { return link !== had && holds(id, fields.patch); } }).then(function (res) {
          if (!res.ok) return;
          sh.close();
          App.toast(said);
        });
      } }
    });
  }

  /* ---------- edit details (owner: everything; rep: contact details) ---------- */

  function openEdit(id) {
    var c = App.client(id);
    if (!c) return gone();
    var owner = App.role() === 'owner';

    var name = ui.field({ label: 'Name (person or business)', name: 'c-name', value: c.name, maxlength: LIMITS.name, autocapitalize: 'words' });
    var contact = ui.field({ label: 'Contact name', name: 'c-contact', value: c.contact, optional: true, maxlength: LIMITS.name, autocapitalize: 'words' });
    var phone = ui.field({ label: 'Phone', name: 'c-phone', type: 'tel', value: c.phone, maxlength: 30 });
    var email = ui.field({ label: 'Email', name: 'c-email', type: 'email', value: c.email, optional: true, maxlength: 120 });
    var address = ui.field({ label: 'Address', name: 'c-address', value: c.address, maxlength: LIMITS.line, autocapitalize: 'words' });
    var service, other, price, often, start, rep, saleNote;

    /* What the form opened with. Only what the person changed is sent, so a change someone else
       saved in the meantime (a rep fixing the phone number, a sale being fixed) is never put back. */
    var was = { name: c.name || '', contact: c.contact || '', phone: c.phone || '', email: c.email || '', address: c.address || '' };

    if (owner) {
      was.service = c.service || '';
      was.priceCents = c.priceCents || 0;
      was.billing = c.billing === 'monthly' ? 'monthly' : 'once';
      was.startDate = c.startDate || '';

      var names = (App.data.settings.services || []).map(function (s) { return s.name; });
      var options = names.map(function (n) { return { value: n, label: n }; });
      if (c.service && names.indexOf(c.service) < 0) options.unshift({ value: c.service, label: c.service });
      options.push({ value: OTHER, label: 'Other' });
      other = ui.field({ label: 'Service name', name: 'c-service-other', maxlength: 60, onInput: paintSaleNote });
      other.hidden = true;
      service = ui.field({ label: 'Service', name: 'c-service', type: 'select', options: options, value: c.service || options[0].value,
        onInput: function (v) { other.hidden = v !== OTHER; paintSaleNote(); } });
      price = ui.field({ label: 'Price', name: 'c-price', inputmode: 'decimal', prefix: '$', value: ((c.priceCents || 0) / 100).toFixed(2), maxlength: 12,
        onInput: paintSaleNote });
      often = ui.segmented({ label: 'How often', value: was.billing, onChange: paintSaleNote,
        options: [{ value: 'once', label: 'One-time' }, { value: 'monthly', label: 'Monthly' }] });
      start = ui.field({ label: 'Start date', name: 'c-start', type: 'date', value: c.startDate || '' });

      /* Changing these here changes the client, not a sale. Say so the moment one of them is changed, and
         offer the way to the sale itself (the newest one: it is where this service and price came from). */
      var sale = newestSale(id), toSale = null;
      if (sale && App.actions.openSale) {
        toSale = ui.button('Open the sale', { kind: 'text', onTap: function () { App.act('openSale', sale.id); } });
        toSale.classList.add('callout-btn');
      }
      saleNote = h('div', { class: 'callout', hidden: true },
        h('p', { class: 'small' }, 'This changes what the client pays from now on. To fix a sale that was entered wrong, open the sale.'),
        toSale);

      /* A client can be looked after by any sales rep or owner who is on the team. */
      var me = App.me(), people = [{ value: me.id, label: me.name + ' (you)' }].concat(App.people(['rep', 'owner']).filter(function (m) {
        return m.id !== me.id;
      }).sort(byName).map(function (m) { return { value: m.id, label: m.name }; }));
      if (c.repId && !people.some(function (o) { return o.value === c.repId; })) people.unshift({ value: c.repId, label: repName(c.repId, true) });
      rep = ui.field({ name: 'c-rep', type: 'select', options: people, value: c.repId || me.id,
        hint: 'This person sees the client and books their appointments. Sales already made stay with whoever made them.' });
      rep.input.setAttribute('aria-label', 'Their rep');
    }

    function typedService() { return service.input.value === OTHER ? other.val() : service.input.value; }
    function paintSaleNote() {
      if (!saleNote) return;
      saleNote.hidden = typedService() === was.service && fmt.toCents(price.val()) === was.priceCents && often.get() === was.billing;
    }

    return App.sheet.open({
      title: owner ? 'Edit details' : 'Edit contact details',
      body: function (el) {
        var parts = [name, contact, phone, email, address];
        if (owner) {
          parts = [ui.label('Contact details')].concat(parts, [ui.label('What they buy'), service, other, price,
            h('div', { class: 'field' }, h('span', { class: 'field-label' }, 'How often'), often), saleNote, start, ui.label('Their rep'), rep]);
        }
        parts.forEach(function (part) { el.appendChild(part); });
      },
      footer: { label: 'Save', onTap: function (sh) {
        var bad = [];
        function fail(field, message) { field.setError(message); bad.push(field); }
        var typed = { name: name.val(), contact: contact.val(), phone: phone.val(), email: email.val(), address: address.val() };
        if (!typed.name) fail(name, 'Add the client\'s name.');
        if (typed.email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(typed.email)) fail(email, 'That email address does not look right.');
        if (owner) {
          typed.service = typedService();
          if (!typed.service) fail(service.input.value === OTHER ? other : service, 'Type the name of the service.');
          typed.priceCents = fmt.toCents(price.val());
          if (typed.priceCents == null) fail(price, PRICE_HELP);
          else if (typed.priceCents > LIMITS.maxCents) fail(price, 'That price is too high.');
          typed.billing = often.get();
          typed.startDate = start.val();
          if (!D.isDay(typed.startDate)) fail(start, 'Pick the start date.');
        }
        if (bad.length) { sh.reveal(bad[0]); return; }

        var patch = {}, any = false, k;
        for (k in typed) if (typed[k] !== was[k]) { patch[k] = typed[k]; any = true; }
        if (owner && rep.input.value && rep.input.value !== c.repId) { patch.repId = rep.input.value; any = true; }   /* only when it is handed to someone new */
        var fields = { clientId: id, patch: patch };
        /* Nothing was changed: close. Unless an earlier try from here got no answer (see the payment link above). */
        if (!any && !sh.unanswered('updateClient', fields)) { sh.close(); return; }
        var said = patch.repId ? 'Saved. ' + App.nameOf(patch.repId, 'Their new rep') + ' looks after this client now.' : 'Saved.';
        sh.send('updateClient', fields, { saved: said, landed: function () { return any && holds(id, patch); } }).then(function (res) {
          if (!res.ok) return;
          sh.close();
          App.toast(said);
        });
      } }
    });
  }

  /* ---------- book an appointment ---------- */

  function bookVisit(arg) {
    var id = idOf(arg), c = App.client(id), picker = null;
    if (!c) return gone();
    var last = jobsOf(id)[0];
    var what = ui.field({ label: 'What needs to be done', name: 'visit-what', value: (last && last.what) || c.service || '', maxlength: LIMITS.line });

    function label(v) { return v ? 'Book ' + fmt.when(v.date, v.time) : 'Pick a day and a time'; }

    var sheet = App.sheet.open({
      title: 'Book an appointment',
      body: function (el, sh) {
        el.appendChild(h('p', { class: 'muted' }, 'A new appointment for ', h('b', { class: 'strong' }, c.name), '.'));
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
        function booked() { sh.close(); App.toast('Booked for ' + fmt.when(v.date, v.time) + '.'); }
        sh.send('bookJob', fields, { saved: booked,
          /* No answer, and then this client turns up booked at that time: it went through. Finish as booked. */
          landed: function () {
            return App.data.jobs.some(function (j) { return j.clientId === id && j.date === v.date && j.time === v.time && j.status === 'scheduled'; });
          }, onLanded: booked
        }).then(function (res) {
          if (res.ok) booked();
          else if (res.error.code === 'slot_taken' || res.error.code === 'slot_closed') {
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

  App.screen('clients', { roles: ['owner', 'rep'], title: 'Clients', render: render, update: update });
  App.actions.openClient = openClient;
  App.actions.bookVisit = bookVisit;
  App.needsAppointment = needsAppointment;
  /* Signing out: the next person on this phone starts with an empty search. */
  App.on('signout', function () { query = ''; filter = ''; viewer = null; listUi = null; });
})();
