/*
 * Ridgeline Wash Co. team app: sample data.
 *
 * Until the real backend is connected the page runs RidgelineCore right here on made-up data.
 * This file builds that data the honest way: by signing in as each sample person and calling the
 * same actions the app calls (core.handle), with a clock that is moved through the last two
 * months. So every sample sale, job, note and alert is something the real system could hold.
 *
 *   RidgelineSample.PEOPLE                 the sample team with their sign-in PINs
 *   RidgelineSample.build(clock) -> dump   a memoryStore dump ({ rev, data }) for "now"
 *     clock: { now: ms, dayKey(ms) -> 'YYYY-MM-DD', hm(ms) -> 'HH:MM', uuid() -> string }
 *
 * Everything is placed relative to today, so today always has four jobs (8:00 done, 9:30,
 * 12:00, 2:00 with nobody assigned), yesterday has one job that was never marked done, one
 * client is late paying, and the next three weeks have open days with a few times taken.
 */
var RidgelineSample = (function () {
  'use strict';

  var PEOPLE = [
    { name: 'Grayson', role: 'owner', pin: '1234' },
    { name: 'Mason', role: 'rep', pin: '2222' },
    { name: 'Avery', role: 'rep', pin: '3333' },
    { name: 'Cole', role: 'tech', pin: '4444' }
  ];
  var TOWN = ', Smithville, TN 37166';

  function build(clock) {
    var Core = RidgelineCore, D = Core.dates;
    var t = clock.now, today = clock.dayKey(clock.now);
    var store = Core.memoryStore();
    store.setClock(function () { return t; });
    var core = Core.create(store, {
      now: function () { return t; }, dayKey: clock.dayKey, hm: clock.hm, uuid: clock.uuid, notify: function () {}
    });

    /* ----- moving the clock ----- */
    function minutes(hm) { return +hm.slice(0, 2) * 60 + +hm.slice(3, 5); }
    function dayNumber(day) { return Date.UTC(+day.slice(0, 4), +day.slice(5, 7) - 1, +day.slice(8, 10)) / 86400000; }
    /* The moment that reads as `day` at `hm` on this phone (a few passes settle clock changes). */
    function moment(day, hm) {
      var ms = clock.now;
      for (var i = 0; i < 4; i++) {
        var off = (dayNumber(day) - dayNumber(clock.dayKey(ms))) * 1440 + minutes(hm) - minutes(clock.hm(ms));
        if (!off) break;
        ms += off * 60000;
      }
      return ms;
    }
    function day(offset) { return D.addDays(today, offset); }
    /* Set the clock to `offset` days from today at `hm`, but never later than right now. */
    function at(offset, hm) { t = Math.min(moment(day(offset), hm), clock.now); }

    /* ----- calling the core like the app does ----- */
    function call(token, action, fields) {
      var req = { action: action, token: token }, k;
      for (k in fields || {}) req[k] = fields[k];
      var res = core.handle(req);
      if (!res.ok) throw new Error('Sample data could not be built (' + action + '): ' + res.error.message);
      return res.result;
    }
    function signIn(person) { return call(null, 'login', { name: person.name, pin: person.pin }).token; }

    /* ----- the team ----- */
    at(-66, '08:00');
    core.bootstrap({ name: PEOPLE[0].name, pin: PEOPLE[0].pin });
    var owner = signIn(PEOPLE[0]);
    var ids = {}, tokens = { Grayson: owner };
    PEOPLE.slice(1).forEach(function (p) {
      ids[p.name] = call(owner, 'saveMember', { member: { name: p.name, role: p.role, pin: p.pin } }).id;
      tokens[p.name] = signIn(p);
    });
    call(owner, 'saveSettings', { settings: { services: [
      { id: 'windows', name: 'Window cleaning', priceCents: 15000 },
      { id: 'house', name: 'House wash', priceCents: 30000 },
      { id: 'pressure', name: 'Pressure wash', priceCents: 20000 }
    ] } });

    /* ----- availability: every past day was open; the next three weeks are weekdays, short Saturdays ----- */
    var past = [], i;
    for (i = -66; i < 0; i++) past.push({ date: day(i), open: true });
    call(owner, 'setDays', { days: past.slice(0, 40) });
    call(owner, 'setDays', { days: past.slice(40) });
    var ahead = [], openAhead = [], blockedOne = false;
    for (i = 0; i <= 21; i++) {
      var wd = D.weekday(day(i)), open = i === 0 || (wd >= 1 && wd <= 6);
      if (!blockedOne && i >= 9 && wd >= 2 && wd <= 4) { open = false; blockedOne = true; }   /* one day off */
      var entry = { date: day(i), open: open };
      if (open && wd === 6 && i !== 0) entry.slots = ['09:30', '12:00'];
      ahead.push(entry);
      if (open && wd >= 1 && wd <= 5) openAhead.push(i);
    }
    call(owner, 'setDays', { days: ahead });
    /* The first open weekday that is at least `min` days away. */
    function openDay(min) {
      for (var n = 0; n < openAhead.length; n++) if (openAhead[n] >= min) return day(openAhead[n]);
      return day(openAhead[openAhead.length - 1]);
    }

    /* ----- small helpers for the story below ----- */
    function sell(rep, client, service, cents, billing, what, visit, notes) {
      client.address += TOWN;
      return call(tokens[rep], 'createSale', {
        client: client, service: service, priceCents: cents, billing: billing, what: what, notes: notes || '',
        appointment: visit ? { date: visit[0], time: visit[1] } : null
      });
    }
    function assign(jobId) { call(owner, 'updateJob', { jobId: jobId, patch: { assignedTo: ids.Cole } }); }
    function finish(jobId) { call(tokens.Cole, 'setJobDone', { jobId: jobId, done: true }); }
    function paid(clientId, status) { call(owner, 'updateClient', { clientId: clientId, patch: { payStatus: status || 'paid' } }); }
    function visit(clientId, date, time, what) { return call(owner, 'bookJob', { clientId: clientId, date: date, time: time, what: what }).jobId; }

    /* ----- two months of business, oldest first ----- */
    at(-64, '10:15');
    var main = sell('Mason', { name: 'Main Street Storefront', contact: 'Dana Whitfield', phone: '615-555-0112', email: 'dana@example.com', address: '104 W Main St' },
      'Window cleaning', 15000, 'monthly', 'Storefront windows, inside and out', [day(-60), '08:00'], 'Wants the first slot of the day, before the shop opens.');
    assign(main.jobId);
    at(-60, '08:50'); finish(main.jobId);
    at(-59, '09:00'); paid(main.clientId);

    at(-41, '11:05');
    var cafe = sell('Mason', { name: 'Hilltop Cafe', contact: 'Luis Ortega', phone: '615-555-0127', email: '', address: '36 Hilltop Ave' },
      'Window cleaning', 12000, 'monthly', 'Front windows and the patio doors', [day(-38), '08:00']);
    assign(cafe.jobId);
    at(-38, '08:45'); finish(cafe.jobId);

    at(-34, '09:10');
    var mainSecond = visit(main.clientId, day(-30), '08:00', 'Storefront windows, inside and out');
    assign(mainSecond);
    at(-33, '15:40');
    var feed = sell('Avery', { name: 'County Line Feed Store', contact: 'Ray Dalton', phone: '615-555-0164', email: '', address: '2301 County Line Rd' },
      'Pressure wash', 40000, 'once', 'Loading dock and front walk', [day(-31), '12:00']);
    assign(feed.jobId);
    at(-31, '13:35'); finish(feed.jobId);
    at(-30, '08:55'); finish(mainSecond); paid(feed.clientId);

    at(-27, '13:20');
    var miller = sell('Avery', { name: 'Miller Family Home', contact: 'Beth Miller', phone: '615-555-0139', email: 'beth@example.com', address: '905 Miller Rd' },
      'House wash', 32500, 'once', 'Whole house wash, vinyl siding', [day(-24), '09:30'], 'Asked us to skip the back deck. It was just stained.');
    assign(miller.jobId);
    at(-24, '11:10'); finish(miller.jobId);
    at(-23, '09:00'); paid(miller.clientId);

    at(-20, '08:05'); call(tokens.Avery, 'ackStandards', {});

    at(-10, '09:00');
    var cafeSecond = visit(cafe.clientId, day(-8), '08:00', 'Front windows and the patio doors');
    assign(cafeSecond);
    var mainToday = visit(main.clientId, day(0), '08:00', 'Storefront windows, inside and out');
    assign(mainToday);
    var cafeNext = visit(cafe.clientId, openDay(5), '08:00', 'Front windows and the patio doors');
    assign(cafeNext);

    at(-9, '14:10');
    var dental = sell('Avery', { name: 'Lakeview Dental Office', contact: 'Priya Nair', phone: '615-555-0171', email: '', address: '1250 Lakeview Dr' },
      'Window cleaning', 18000, 'monthly', 'Lobby windows and the glass entry', [day(-1), '14:00']);
    assign(dental.jobId);
    call(tokens.Avery, 'addNote', { kind: 'job', id: dental.jobId, text: 'The front desk asked us to come after 1 PM.' });
    at(-8, '08:40'); finish(cafeSecond);

    at(-6, '16:30');
    var parker = sell('Mason', { name: 'Parker Residence', contact: 'Jamie Parker', phone: '615-555-0142', email: '', address: '218 Parker Ln' },
      'Window cleaning', 15000, 'once', 'Exterior window cleaning', [day(0), '09:30']);
    assign(parker.jobId);
    call(tokens.Mason, 'addNote', { kind: 'job', id: parker.jobId, text: 'The side gate sticks. Lift it and push.' });
    at(-5, '10:00'); paid(cafe.clientId, 'late');

    at(-4, '12:45');
    var cedar = sell('Avery', { name: 'Cedar Lane Home', contact: 'Tom Reyes', phone: '615-555-0158', email: '', address: '412 Cedar Ln' },
      'House wash', 30000, 'once', 'House wash', [day(0), '12:00']);
    assign(cedar.jobId);

    at(-3, '12:00'); call(owner, 'readNotices', {});
    var feedNext = visit(feed.clientId, openDay(8), '12:00', 'Parking lot pressure wash');
    assign(feedNext);

    at(-2, '17:15');
    sell('Mason', { name: 'Oak Hill Driveway', contact: 'Sam Carter', phone: '615-555-0183', email: '', address: '77 Oak Hill Rd' },
      'Pressure wash', 22500, 'once', 'Driveway and front walk', [day(0), '14:00']);   /* nobody assigned yet */

    at(-1, '16:20');
    sell('Avery', { name: 'Walnut Street Duplex', contact: 'Chris Lane', phone: '615-555-0196', email: '', address: '64 Walnut St' },
      'House wash', 26000, 'once', 'House wash', null, 'They will call back with a day that works.');

    at(0, '08:52'); finish(mainToday);

    t = clock.now - 10 * 60000;
    var cabin = sell('Mason', { name: 'Dry Creek Cabin', contact: 'Nora Bell', phone: '615-555-0105', email: '', address: '18 Dry Creek Rd' },
      'House wash', 28000, 'once', 'Cabin wash, wood siding, low pressure', [openDay(2), '09:30']);
    assign(cabin.jobId);

    /* Leave nobody signed in. */
    t = clock.now;
    PEOPLE.forEach(function (p) { call(tokens[p.name], 'logout', {}); });
    return store.dump();
  }

  return { PEOPLE: PEOPLE, build: build };
})();
