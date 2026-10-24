/**
 * Ridgeline Instant: the free always-on server (Google Apps Script, inside the Ridgeline Gmail).
 *
 * Every minute it looks for new website form emails and answers them on the spot:
 *  - "Free AI check request — <business>"  -> asks ChatGPT + Gemini now and emails the check (about 1-3 min).
 *  - "Onboarding — <business>"              -> emails the welcome + the starting AI visibility score now.
 * The Claude reply desk (hourly) still does everything deeper (Google profile fixes, review kit,
 * database records) and is the backup: anything this script didn't finish, the desk does.
 *
 * Setup (phone, once): SETUP_NEEDED.md "Instant server". Script properties needed:
 *   OPENAI_API_KEY, GEMINI_API_KEY   (optional: OPENAI_MODEL, GEMINI_MODEL)
 * Then run setup() once and allow access. Nothing else.
 *
 * Score formula = office/tools/ai_score.py = guarantee.html (1 point named in the first three,
 * 0.5 named lower, 0 not named; score = points / answers * 100).
 */

var CFG = {
  ME: 'ridgelinemarketinghq@gmail.com',
  SIGNATURE: 'Grayson\nRidgeline Local',
  OPT_OUT: "If you'd rather not hear from me, reply 'no thanks' and I'll stop.",
  ADDRESS: '150 Sedgewood Dr Smithville, TN  37166 United States',
  SITE: 'https://ridgelinehq.github.io',
  LABEL_DONE: 'RL-Instant-Sent',
  LABEL_FAIL: 'RL-Instant-Failed',
  MAX_PER_RUN: 3,
  OPENAI_MODELS: ['gpt-5.5', 'gpt-5.5-mini', 'gpt-5-mini', 'gpt-4.1-mini'],
  GEMINI_MODELS: ['gemini-3.6-flash', 'gemini-3.8-flash', 'gemini-3.5-flash-lite', 'gemini-2.5-flash'],
  STYLE: ' Answer the way you would for a local customer: name the specific local businesses you\'d recommend and why. Keep it under 200 words.'
};

// ---------------------------------------------------------------- setup + trigger

function setup() {
  var p = PropertiesService.getScriptProperties();
  var missing = ['OPENAI_API_KEY', 'GEMINI_API_KEY'].filter(function (k) { return !p.getProperty(k); });
  if (missing.length) throw new Error('Add these in Project Settings > Script properties first: ' + missing.join(', '));
  label_(CFG.LABEL_DONE); label_(CFG.LABEL_FAIL);
  ScriptApp.getProjectTriggers().forEach(function (t) {
    if (t.getHandlerFunction() === 'processInbox') ScriptApp.deleteTrigger(t);
  });
  ScriptApp.newTrigger('processInbox').timeBased().everyMinutes(1).create();
  var probe = askBoth_('Who are the best coffee shops in Tulsa, OK?', 'Tulsa', 'Oklahoma');
  GmailApp.sendEmail(CFG.ME, '✅ Ridgeline Instant is ON',
    'The instant server is running and checks the inbox every minute.\n\n' +
    'Test question "best coffee shops in Tulsa": ChatGPT ' + (probe.chatgpt.ok ? 'answered (' + probe.chatgpt.model + ')' : 'FAILED: ' + probe.chatgpt.error) +
    ', Gemini ' + (probe.gemini.ok ? 'answered (' + probe.gemini.model + ')' : 'FAILED: ' + probe.gemini.error) + '.\n\n' +
    'Free checks and new-client welcomes now go out within about 1 to 3 minutes.');
  return 'ok';
}

function processInbox() {
  var lock = LockService.getScriptLock();
  if (!lock.tryLock(1000)) return;
  try {
    var q = '(subject:"Free AI check request" OR subject:"Onboarding —") newer_than:2d -label:' + CFG.LABEL_DONE +
            ' -label:' + CFG.LABEL_FAIL + ' -label:Ridgeline-Handled -in:sent';
    var threads = GmailApp.search(q, 0, CFG.MAX_PER_RUN);
    threads.forEach(function (th) {
      try {
        handleThread_(th);
      } catch (e) {
        fail_(th, 'error: ' + e.message);
      }
    });
    PropertiesService.getScriptProperties().setProperty('lastRunAt', new Date().toISOString());
  } finally {
    lock.releaseLock();
  }
}

function handleThread_(th) {
  var msg = th.getMessages()[0];
  var subject = msg.getSubject();
  var f = parseFields_(msg.getPlainBody() || '');
  if (!f.email) {
    var rt = (msg.getReplyTo() || '').match(/[^\s<>"]+@[^\s<>"]+\.[^\s<>"]+/);
    if (rt && rt[0].toLowerCase() !== CFG.ME) f.email = rt[0];
  }
  if (/test ignore/i.test(f.business || '')) { th.addLabel(label_(CFG.LABEL_DONE)); return; }
  if (!f.business || !f.email || !(f.town || f.city)) { fail_(th, 'could not read business/email/town from the form'); return; }
  if (/^Free AI check request/i.test(subject)) return freeCheck_(th, f);
  if (/^Onboarding/i.test(subject)) return onboarding_(th, f);
}

// ---------------------------------------------------------------- the free AI check

function freeCheck_(th, f) {
  var place = splitTown_(f.town || f.city);
  var trade = tradePhrase_(f.type || f.services || 'local business');
  var question = 'Who are the best ' + trade.plural + ' in ' + place.label + '?';
  var r = askBoth_(question, place.town, place.region);
  if (!r.chatgpt.ok && !r.gemini.ok) { fail_(th, 'ChatGPT and Gemini both failed: ' + r.chatgpt.error + ' | ' + r.gemini.error); return; }
  var vars = nameVariants_(f.business);
  var res = {};
  ['chatgpt', 'gemini'].forEach(function (tool) {
    var a = r[tool];
    res[tool] = a.ok ? { ok: true, model: a.model, rank: rankOf_(a.text, vars), names: competitors_(a.text, vars), text: a.text, live: a.live }
                     : { ok: false, error: a.error };
  });
  var fixes = pickFixes_(res);
  var spots = foundingSpots_();
  var biz = f.business;
  var lines = [];
  lines.push('Hi there,', '');
  lines.push('Here\'s your free AI check for ' + biz + '. Today I asked ChatGPT and Gemini the question a customer would ask: "' + question + '"', '');
  ['chatgpt', 'gemini'].forEach(function (tool) {
    var label = tool === 'chatgpt' ? 'ChatGPT' : 'Gemini';
    var x = res[tool];
    if (!x.ok) { lines.push(label + ' didn\'t answer today.', ''); return; }
    lines.push(label + ' (' + x.model + (x.live ? ', live web search' : '') + ') named: ' + (x.names.length ? x.names.join(', ') : 'a few local businesses (its words below)') + '.');
    lines.push(biz + ': ' + (x.rank === null ? 'not named.' : 'named' + (x.rank <= 3 ? ' (in its top 3).' : '.')));
    lines.push('Its words: "' + excerpt_(x.text, 450) + '"', '');
  });
  lines.push('The 3 fixes I\'d make first:');
  fixes.forEach(function (fx, i) { lines.push((i + 1) + '. ' + fx); });
  lines.push('');
  lines.push('Want us to do it for you? Plans start at $75 a month, month to month. Most businesses pick Growth ($125): we fix all of the above and send you leads, and if your first month brings zero tracked leads and no improvement in your AI visibility, your second month is free (terms: ' + CFG.SITE + '/guarantee.html).');
  if (spots > 0) lines.push(spots + ' founding spots left: the first 20 clients keep their price for life.');
  lines.push('See the plans: ' + CFG.SITE + '/#pricing', '');
  lines.push('Or just reply with any question.', '', CFG.SIGNATURE, '', CFG.OPT_OUT, CFG.ADDRESS);
  GmailApp.sendEmail(f.email, 'Your free AI check: ' + biz + ' in ' + place.town, lines.join('\n'), { name: 'Grayson at Ridgeline Local', replyTo: CFG.ME });
  log_('freecheck', biz, { business: biz, email: f.email, phone: f.phone || '', town: place.label, type: f.type || '', question: question, fixes: fixes,
    chatgpt: strip_(res.chatgpt), gemini: strip_(res.gemini), sentAt: new Date().toISOString() });
  th.addLabel(label_(CFG.LABEL_DONE));
}

function pickFixes_(res) {
  var c = res.chatgpt, g = res.gemini;
  var cn = c.ok && c.rank !== null, gn = g.ok && g.rank !== null;
  var fixes = [];
  if (!cn && !gn) fixes.push('Your Google Business Profile needs your exact services and a description that says what you do and the towns you serve; both tools lean on it.');
  else if (cn !== gn) fixes.push('The tool that missed you is reading a thin or inconsistent profile; the same name, address and phone on Google, Yelp and Facebook fixes most of that.');
  else fixes.push('You\'re named, so keep the lead: post a Google update every week and keep your hours and services current so the tools keep picking you.');
  fixes.push('Ask every happy customer for a Google review with a text and a QR card; both tools quote review counts and recent reviews.');
  fixes.push('Add 10 or more real photos of your work and your place to Google, and reply to every review by first name within a week; both are signals these tools read.');
  return fixes;
}

// ---------------------------------------------------------------- onboarding: welcome + starting score

function onboarding_(th, f) {
  var place = splitTown_(f.city || f.town);
  var trade = tradePhrase_(f.type || 'local business');
  var slug = slugify_(place.town) + '-' + slugify_(place.st) + '-' + slugify_(trade.singular);
  var qs = [
    { key: slug + '-q1', question: 'Who are the best ' + trade.plural + ' in ' + place.label + '?' },
    { key: slug + '-q2', question: 'Can you recommend a good ' + trade.singular + ' in ' + place.label + '?' },
    { key: slug + '-q3', question: 'Which ' + trade.plural + ' in ' + place.label + ' have the best reviews?' }
  ];
  var answers = askMany_(qs.map(function (q) { return q.question; }), place.town, place.region);
  var vars = nameVariants_(f.business);
  var points = 0, detail = [], anyOk = false;
  qs.forEach(function (q, i) {
    ['chatgpt', 'gemini'].forEach(function (tool) {
      var a = answers[i][tool];
      var rank = a.ok ? rankOf_(a.text, vars) : null;
      if (a.ok) anyOk = true;
      var p = rank === null ? 0 : (rank <= 3 ? 1 : 0.5);
      points += p;
      detail.push({ key: q.key, tool: tool, ok: a.ok, model: a.model || '', named: rank !== null, rank: rank, points: p,
                    competitors: a.ok ? competitors_(a.text, vars) : [], error: a.ok ? '' : a.error });
    });
  });
  var score = Math.round(points / 6 * 100);
  var plan = (f.plan || '').toLowerCase();
  var planName = { starter: 'Starter', growth: 'Growth', pro: 'Pro' }[plan] || 'your plan';
  var biz = f.business;
  var L = [];
  L.push('Hi there,', '');
  L.push('Welcome to Ridgeline Local, and thank you. ' + biz + ' is set up on ' + planName + ' and the work has started.', '');
  if (anyOk) {
    L.push('YOUR STARTING AI VISIBILITY SCORE: ' + score + ' / 100', '');
    L.push('We asked ChatGPT and Gemini three questions a customer in ' + place.town + ' would ask:');
    qs.forEach(function (q) {
      var c = detail.filter(function (d) { return d.key === q.key && d.tool === 'chatgpt'; })[0];
      var g = detail.filter(function (d) { return d.key === q.key && d.tool === 'gemini'; })[0];
      L.push('- "' + q.question + '"  ChatGPT: ' + say_(c) + ' · Gemini: ' + say_(g));
    });
    var comp = {};
    detail.forEach(function (d) { (d.competitors || []).forEach(function (n) { comp[n] = (comp[n] || 0) + 1; }); });
    var top = Object.keys(comp).sort(function (a, b) { return comp[b] - comp[a]; }).slice(0, 4);
    if (top.length) L.push('', 'The businesses they named most: ' + top.join(', ') + '.');
    L.push('', 'This is your day-1 number. We re-check every week and show you the trend in your monthly report.');
  } else {
    L.push('Your starting AI visibility score is running now; it will follow in a separate email shortly.');
  }
  L.push('', 'WHAT HAPPENS NEXT (nothing for you to chase):');
  L.push('1. Within the hour: your Google profile fixes, written out and ready to paste (about 10 minutes for you).');
  L.push('2. Within the hour: your review kit (a ready-to-send text and a QR card for your counter).');
  if (plan === 'pro') L.push('3. Within 24 hours: your own lead page with tracking links. Leads from it reach you the moment they come in.');
  if (plan === 'growth' || plan === 'pro') L.push((plan === 'pro' ? '4' : '3') + '. Leads we find go straight to this email, and every one is logged.');
  if (plan === 'growth' || plan === 'pro') L.push('', 'Your Second Month Free Guarantee is on: if your first month brings zero tracked leads and no improvement in your AI visibility, your second month is free. Terms: ' + CFG.SITE + '/guarantee.html');
  L.push('', 'Optional, 3 minutes: add ' + CFG.ME + ' as a Manager on your Google Business Profile (Google Maps app > your profile > ⋯ > Business Profile settings > People and access > Add > Manager). It lets us log the messages and calls your profile gets. Never a password.');
  L.push('', 'Questions? Just reply to this email.', '', CFG.SIGNATURE);
  GmailApp.sendEmail(f.email, 'Welcome to Ridgeline Local' + (anyOk ? ': your starting AI score is ' + score + '/100' : ''), L.join('\n'),
                     { name: 'Grayson at Ridgeline Local', replyTo: CFG.ME });
  log_('onboarding', biz, { business: biz, email: f.email, phone: f.phone || '', city: place.label, services: f.services || '', type: f.type || '',
    googleProfile: f.google || '', plan: plan, billing: f.billing || '', stripeSession: f.session || '', questions: qs,
    baseline: anyOk ? { score: score, points: points, answers: 6, at: new Date().toISOString(), by: 'ridgeline-instant', detail: detail } : null,
    sentAt: new Date().toISOString() });
  th.addLabel(label_(CFG.LABEL_DONE));
  if (!anyOk) alert_('baseline-' + slug, 'Starting AI score failed for ' + biz + ' (ChatGPT and Gemini both errored). Welcome was sent; the reply desk will run the score through the gateway within the hour.');
}

function say_(d) { return !d.ok ? 'no answer' : (d.rank === null ? 'not named' : (d.rank <= 3 ? 'named, top 3' : 'named')); }

// ---------------------------------------------------------------- AI calls

function askBoth_(question, city, region) { return askMany_([question], city, region)[0]; }

/** Ask every question to both tools in parallel (first model each), then fall back model by model for failures. */
function askMany_(questions, city, region) {
  var p = PropertiesService.getScriptProperties();
  var oKey = p.getProperty('OPENAI_API_KEY'), gKey = p.getProperty('GEMINI_API_KEY');
  var oModels = [p.getProperty('OPENAI_MODEL')].filter(function (x) { return !!x; }).concat(CFG.OPENAI_MODELS);
  var gModels = [p.getProperty('GEMINI_MODEL')].filter(function (x) { return !!x; }).concat(CFG.GEMINI_MODELS);
  var out = questions.map(function () { return { chatgpt: { ok: false, error: 'not asked' }, gemini: { ok: false, error: 'not asked' } }; });
  var reqs = [], map = [];
  questions.forEach(function (q, i) {
    reqs.push(openaiReq_(q, oModels[0], oKey, city, region)); map.push([i, 'chatgpt', oModels[0]]);
    reqs.push(geminiReq_(q, gModels[0], gKey, true)); map.push([i, 'gemini', gModels[0]]);
  });
  var resps = UrlFetchApp.fetchAll(reqs);
  resps.forEach(function (r, k) {
    var m = map[k];
    out[m[0]][m[1]] = m[1] === 'chatgpt' ? readOpenai_(r, m[2]) : readGemini_(r, m[2], true);
  });
  questions.forEach(function (q, i) {
    if (!out[i].chatgpt.ok && !/401|quota|billing/i.test(out[i].chatgpt.error || '')) {
      for (var a = 1; a < oModels.length && !out[i].chatgpt.ok; a++) out[i].chatgpt = readOpenai_(fetchOne_(openaiReq_(q, oModels[a], oKey, city, region)), oModels[a]);
    }
    if (!out[i].gemini.ok) {
      var tries = [[gModels[0], false]];
      for (var b = 1; b < gModels.length; b++) { tries.push([gModels[b], true]); tries.push([gModels[b], false]); }
      for (var t = 0; t < tries.length && !out[i].gemini.ok; t++) {
        var rq = geminiReq_(q, tries[t][0], gKey, tries[t][1]);
        out[i].gemini = readGemini_(fetchOne_(rq), tries[t][0], tries[t][1]);
        if (/API key/i.test(out[i].gemini.error || '')) break;
      }
    }
  });
  return out;
}

function fetchOne_(req) {
  var params = {};
  Object.keys(req).forEach(function (k) { if (k !== 'url') params[k] = req[k]; });
  return UrlFetchApp.fetch(req.url, params);
}

function openaiReq_(q, model, key, city, region) {
  return { url: 'https://api.openai.com/v1/responses', method: 'post', contentType: 'application/json', muteHttpExceptions: true,
    headers: { Authorization: 'Bearer ' + key },
    payload: JSON.stringify({ model: model, input: q + CFG.STYLE,
      tools: [{ type: 'web_search', user_location: { type: 'approximate', country: 'US', city: city || '', region: region || '' } }] }) };
}

function readOpenai_(r, model) {
  var code = r.getResponseCode(), d = {};
  try { d = JSON.parse(r.getContentText()); } catch (e) {}
  if (code !== 200) return { ok: false, error: model + ': ' + code + ' ' + ((d.error && d.error.message) || '').slice(0, 200) };
  var text = '';
  (d.output || []).forEach(function (it) { if (it.type === 'message') (it.content || []).forEach(function (c) { text += c.text || ''; }); });
  return text ? { ok: true, model: model, live: true, text: text.trim() } : { ok: false, error: model + ': empty answer' };
}

function geminiReq_(q, model, key, grounded) {
  var body = { contents: [{ parts: [{ text: q + CFG.STYLE }] }] };
  if (grounded) body.tools = [{ google_search: {} }];
  return { url: 'https://generativelanguage.googleapis.com/v1beta/models/' + model + ':generateContent', method: 'post',
    contentType: 'application/json', muteHttpExceptions: true, headers: { 'x-goog-api-key': key }, payload: JSON.stringify(body) };
}

function readGemini_(r, model, grounded) {
  var code = r.getResponseCode(), d = {};
  try { d = JSON.parse(r.getContentText()); } catch (e) {}
  if (code !== 200) return { ok: false, error: model + ': ' + code + ' ' + ((d.error && d.error.message) || '').slice(0, 200) };
  var cand = (d.candidates || [{}])[0], text = '';
  ((cand.content || {}).parts || []).forEach(function (p) { text += p.text || ''; });
  return text ? { ok: true, model: model, live: grounded, text: text.trim() } : { ok: false, error: model + ': empty answer' };
}

// ---------------------------------------------------------------- reading answers (port of office/tools/ai_score.py)

var GENERIC_ = ['the', 'a', 'an', 'and', '&', 'of', 'llc', 'inc', 'co', 'company', 'corp', 'ltd', 'services', 'service', 'group', 'pllc', 'pc', 'dds', 'md'];

function norm_(s) { return String(s || '').toLowerCase().replace(/’/g, "'").replace(/[^a-z0-9&' ]+/g, ' ').replace(/\s+/g, ' ').trim(); }

function nameVariants_(name) {
  var n = norm_(name), words = n.split(' ').filter(function (w) { return GENERIC_.indexOf(w) < 0; });
  var v = [n];
  if (words.length >= 2) v.push(words.slice(0, 2).join(' '));
  else if (words.length === 1 && words[0].length >= 6) v.push(words[0]);
  return v.filter(String);
}

function entries_(text) {
  var out = [];
  String(text).split('\n').forEach(function (line) { var m = line.match(/^\s*(?:\d+[.)]|[-*•])\s+(.*)/); if (m) out.push(m[1]); });
  if (out.length < 2) {
    var bold = [], re = /\*\*([^*]{2,80})\*\*/g, m;
    while ((m = re.exec(text))) bold.push(m[1]);
    if (bold.length >= 2) out = bold;
  }
  return out;
}

function hasAny_(t, vars) { return vars.some(function (v) { return t.indexOf(v) >= 0; }); }

function rankOf_(text, vars) {
  if (!hasAny_(norm_(text), vars)) return null;
  var e = entries_(text);
  for (var i = 0; i < e.length; i++) if (hasAny_(norm_(e[i]), vars)) return i + 1;
  return 99;
}

function competitors_(text, vars) {
  var names = [];
  entries_(text).forEach(function (e) {
    var head = e.replace(/\*\*/g, '').split(/\s[—–-]\s|:|\(|,/)[0].trim();
    if (head && head.length < 70 && !hasAny_(norm_(head), vars) && names.indexOf(head) < 0) names.push(head);
  });
  return names.slice(0, 5);
}

// ---------------------------------------------------------------- helpers

var KEYS_ = {
  business: ['business', 'business name'],
  town: ['town', 'town state', 'town and state'],
  city: ['city', 'city and state'],
  type: ['type of business', 'type_of_business', 'kind of business', 'service'],
  services: ['services'],
  email: ['email'],
  phone: ['phone'],
  google: ['google profile', 'google_profile'],
  plan: ['plan'],
  billing: ['billing'],
  session: ['stripe session', 'stripe_session']
};

function parseFields_(text) {
  var canon = {};
  Object.keys(KEYS_).forEach(function (k) { KEYS_[k].forEach(function (a) { canon[a.replace(/_/g, ' ')] = k; }); });
  var key = function (s) { return canon[String(s).toLowerCase().replace(/[_\/]+/g, ' ').replace(/\s+/g, ' ').replace(/[:：]$/, '').trim()]; };
  var lines = String(text).split(/\r?\n/).map(function (s) { return s.trim(); }).filter(String);
  var f = {};
  for (var i = 0; i < lines.length; i++) {
    var L = lines[i], m;
    if ((m = L.match(/^([A-Za-z _\/]{2,40}?)\s*(?:[:：]|\t+)\s*(.+)$/)) && key(m[1])) { if (!f[key(m[1])]) f[key(m[1])] = m[2].trim(); continue; }
    if (key(L) && i + 1 < lines.length && !key(lines[i + 1])) { if (!f[key(L)]) f[key(L)] = lines[i + 1]; i++; }
  }
  Object.keys(f).forEach(function (k) { if (/^(not given|none|unknown)$/i.test(f[k])) delete f[k]; });
  if (f.email) { var em = f.email.match(/[^\s<>"]+@[^\s<>"]+\.[^\s<>"]+/); f.email = em ? em[0] : ''; }
  return f;
}

var STATES_ = { AL: 'Alabama', AK: 'Alaska', AZ: 'Arizona', AR: 'Arkansas', CA: 'California', CO: 'Colorado', CT: 'Connecticut', DE: 'Delaware', FL: 'Florida', GA: 'Georgia', HI: 'Hawaii', ID: 'Idaho', IL: 'Illinois', IN: 'Indiana', IA: 'Iowa', KS: 'Kansas', KY: 'Kentucky', LA: 'Louisiana', ME: 'Maine', MD: 'Maryland', MA: 'Massachusetts', MI: 'Michigan', MN: 'Minnesota', MS: 'Mississippi', MO: 'Missouri', MT: 'Montana', NE: 'Nebraska', NV: 'Nevada', NH: 'New Hampshire', NJ: 'New Jersey', NM: 'New Mexico', NY: 'New York', NC: 'North Carolina', ND: 'North Dakota', OH: 'Ohio', OK: 'Oklahoma', OR: 'Oregon', PA: 'Pennsylvania', RI: 'Rhode Island', SC: 'South Carolina', SD: 'South Dakota', TN: 'Tennessee', TX: 'Texas', UT: 'Utah', VT: 'Vermont', VA: 'Virginia', WA: 'Washington', WV: 'West Virginia', WI: 'Wisconsin', WY: 'Wyoming', DC: 'District of Columbia' };

function splitTown_(s) {
  var parts = String(s || '').split(',').map(function (x) { return x.trim(); });
  var town = parts[0] || String(s), st = (parts[1] || '').toUpperCase().replace(/[^A-Z]/g, '').slice(0, 2);
  return { town: town, st: st, region: STATES_[st] || (parts[1] || ''), label: st ? town + ', ' + st : town };
}

var TRADES_ = { barber: ['barbers', 'barber'], barbershop: ['barbershops', 'barbershop'], salon: ['hair salons', 'hair salon'], 'hair salon': ['hair salons', 'hair salon'],
  restaurant: ['restaurants', 'restaurant'], gym: ['gyms', 'gym'], dentist: ['dentists', 'dentist'], contractor: ['contractors', 'contractor'],
  'cleaning service': ['cleaning services', 'cleaning service'], 'house cleaning': ['house cleaning services', 'house cleaning service'],
  'auto shop': ['auto repair shops', 'auto repair shop'], 'auto repair': ['auto repair shops', 'auto repair shop'], plumber: ['plumbers', 'plumber'],
  hvac: ['HVAC companies', 'HVAC company'], 'med spa': ['med spas', 'med spa'], landscaping: ['landscaping companies', 'landscaping company'],
  'pet grooming': ['pet groomers', 'pet groomer'], roofing: ['roofers', 'roofer'], 'tree service': ['tree services', 'tree service'],
  electrician: ['electricians', 'electrician'], chiropractor: ['chiropractors', 'chiropractor'], bakery: ['bakeries', 'bakery'], 'coffee shop': ['coffee shops', 'coffee shop'] };

function tradePhrase_(t) {
  var k = String(t || '').toLowerCase().split(/[,;\n]/)[0].trim();
  if (TRADES_[k]) return { plural: TRADES_[k][0], singular: TRADES_[k][1] };
  if (/ing$/.test(k)) return { plural: k + ' companies', singular: k + ' company' };
  if (/ss$/.test(k)) return { plural: k + 'es', singular: k };
  if (/s$/.test(k)) return { plural: k, singular: k.replace(/ies$/, 'y').replace(/s$/, '') };
  if (/[^aeiou]y$/.test(k)) return { plural: k.slice(0, -1) + 'ies', singular: k };
  return { plural: k + 's', singular: k };
}

function slugify_(s) { return String(s || '').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 30) || 'x'; }
function excerpt_(t, n) { var s = String(t).replace(/\*\*/g, '').replace(/\s+/g, ' ').trim(); return s.length > n ? s.slice(0, n).replace(/\s\S*$/, '') + '…' : s; }
function strip_(x) { return x.ok ? { ok: true, model: x.model, live: x.live, rank: x.rank, names: x.names, text: excerpt_(x.text, 600) } : x; }

function foundingSpots_() {
  try { var d = JSON.parse(UrlFetchApp.fetch(CFG.SITE + '/data/founding.json', { muteHttpExceptions: true }).getContentText()); return Math.max(0, +d.spotsLeft || 0); }
  catch (e) { return 0; }
}

function label_(name) { return GmailApp.getUserLabelByName(name) || GmailApp.createLabel(name); }

/** A copy for the Claude reply desk: it records these in the office database and never re-sends them. */
function log_(kind, biz, data) {
  data.kind = kind;
  GmailApp.sendEmail(CFG.ME, 'RL-INSTANT-LOG ' + kind + ' — ' + biz, JSON.stringify(data, null, 1));
}

function fail_(th, why) {
  th.addLabel(label_(CFG.LABEL_FAIL));
  alert_('fail-' + th.getId(), 'Instant server could not handle "' + th.getFirstMessageSubject() + '": ' + why + '. The reply desk will handle it within the hour; nothing for you to do unless this repeats.');
}

function alert_(key, text) {
  var p = PropertiesService.getScriptProperties(), k = 'alert-' + key + '-' + new Date().toISOString().slice(0, 10);
  if (p.getProperty(k)) return;
  p.setProperty(k, '1');
  GmailApp.sendEmail(CFG.ME, '🚨 Ridgeline: instant server problem', text + '\n\nIf it keeps happening: open script.google.com > Ridgeline Instant > Executions to see the error, or open the Claude app and say: fix the instant server.');
}
