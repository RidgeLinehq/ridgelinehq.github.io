#!/usr/bin/env node
/*
 * A local stand-in for the Google Apps Script web app, for trying the page's real mode on this
 * computer. It runs the same core (src/core.js) on data kept in memory, so everything is gone
 * when the server stops.
 *
 *   node tools/dev-server.js [port]          default port 8787
 *
 * It starts with three people and the next 14 days open:
 *   Grayson (owner) PIN 1234     Mason (sales rep) PIN 2222     Cole (tech) PIN 3333
 *
 * POST /   body: the request as JSON text (the page sends it as text/plain)  ->  the core's answer as JSON
 * GET  /   -> { ok: true, service: 'ridgeline-wash-team', version }   (same as opening the real link)
 *
 * Two test knobs, as a query string on the POST address:
 *   ?delay=1500   wait that many milliseconds before answering (a slow connection)
 *   ?fail=1       answer HTTP 500 with an HTML page, the way Google does when a script crashes.
 *                 The request is not run, so nothing is saved.
 *
 * Like the real web app, it does not answer a preflight (OPTIONS). If the page ever sends one,
 * the page is sending something other than a plain text body and would fail against Google too.
 */
'use strict';
const http = require('http');
const path = require('path');
const crypto = require('crypto');
const RidgelineCore = require(path.join(__dirname, '..', 'src', 'core.js'));

const TIME_ZONE = 'America/Chicago';
const DEFAULT_PORT = 8787;
const MAX_BODY = 5 * 1024 * 1024;
const MAX_DELAY = 60000;
const PEOPLE = [
  { name: 'Grayson', role: 'owner', pin: '1234' },
  { name: 'Mason', role: 'rep', pin: '2222' },
  { name: 'Cole', role: 'tech', pin: '3333' }
];
const OPEN_DAYS = 14;

const portArg = process.argv[2];
const port = portArg === undefined ? DEFAULT_PORT : Number(portArg);
if (!Number.isInteger(port) || port < 1 || port > 65535) {
  console.error('Usage: node tools/dev-server.js [port]   (the port must be a number from 1 to 65535)');
  process.exit(1);
}

/* ---------- the same env the real backend gives the core ---------- */

const clock = new Intl.DateTimeFormat('en-US', {
  timeZone: TIME_ZONE, year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hourCycle: 'h23'
});
function clockParts(ms) {
  const out = {};
  clock.formatToParts(new Date(ms)).forEach((p) => { out[p.type] = p.value; });
  return out;
}
const env = {
  now: () => Date.now(),
  dayKey: (ms) => { const p = clockParts(ms); return p.year + '-' + p.month + '-' + p.day; },
  hm: (ms) => { const p = clockParts(ms); return p.hour + ':' + p.minute; },
  uuid: () => crypto.randomUUID(),
  notify: (m) => { log('email to the owner: ' + m.subject); }
};

function log(text) { console.log(new Date().toTimeString().slice(0, 8) + '  ' + text); }

/* ---------- starting data ---------- */

const store = RidgelineCore.memoryStore();
const core = RidgelineCore.create(store, env);

function must(res, what) {
  if (!res || !res.ok) throw new Error(what + ' failed: ' + (res && res.error ? res.error.message : 'no answer'));
  return res;
}

function seed() {
  const owner = PEOPLE[0];
  const boot = core.bootstrap({ name: owner.name, pin: owner.pin });
  if (!boot.created || boot.pin !== owner.pin) throw new Error('Could not make the owner.');
  const token = must(core.handle({ action: 'login', name: owner.name, pin: owner.pin }), 'Owner sign-in').result.token;
  PEOPLE.slice(1).forEach((p) => {
    must(core.handle({ action: 'saveMember', token: token, member: { name: p.name, role: p.role, pin: p.pin } }), 'Adding ' + p.name);
  });
  const today = env.dayKey(env.now()), days = [];
  for (let i = 0; i < OPEN_DAYS; i++) days.push({ date: RidgelineCore.dates.addDays(today, i), open: true });
  must(core.handle({ action: 'setDays', token: token, days: days }), 'Opening days');
  must(core.handle({ action: 'logout', token: token }), 'Owner sign-out');
  return { first: days[0].date, last: days[days.length - 1].date };
}

/* ---------- answering ---------- */

const JSON_TYPE = 'application/json; charset=utf-8';
const CRASH_PAGE = '<!DOCTYPE html><html><head><title>Error</title></head><body>' +
  '<div style="text-align:center;font-family:monospace;margin:50px auto 0;max-width:600px">' +
  'Exception: Service error (dev-server ?fail=1). The script completed but did not return anything.</div></body></html>';

function send(res, status, type, body, cors) {
  const headers = { 'Content-Type': type, 'Content-Length': Buffer.byteLength(body), 'Cache-Control': 'no-store' };
  if (cors) headers['Access-Control-Allow-Origin'] = '*';
  res.writeHead(status, headers);
  res.end(body);
}

/* Mirrors doPost in src/gas.js: whatever arrives, the answer is JSON the phone can read. */
function answerPost(text) {
  let req = null;
  try { req = JSON.parse(text); } catch (e) { req = null; }
  if (!req || typeof req !== 'object' || Array.isArray(req) || typeof req.action !== 'string') {
    return { ok: false, error: { code: 'invalid', message: 'Bad request.' } };
  }
  try { return core.handle(req); }
  catch (e) {
    log('the core threw: ' + (e && e.stack ? e.stack : e));
    return { ok: false, error: { code: 'server', message: 'Something went wrong on our side. Nothing was saved. Try again.' } };
  }
}

function outcome(answer) {
  if (!answer.ok) return 'refused (' + answer.error.code + ': ' + answer.error.message + ')';
  if (answer.replay) return 'ok (a retry of something already saved)';
  if (answer.sync && answer.sync.same) return 'ok (nothing new)';
  return 'ok';
}

function actionOf(text) {
  try { const a = JSON.parse(text).action; return typeof a === 'string' ? a.slice(0, 40) : '(no action)'; } catch (e) { return '(not JSON)'; }
}

const server = http.createServer((req, res) => {
  let url;
  try { url = new URL(req.url, 'http://localhost'); } catch (e) { return send(res, 400, 'text/plain; charset=utf-8', 'Bad address.', true); }

  if (req.method === 'OPTIONS') {
    log('OPTIONS (a preflight). The real web app cannot answer this. Send the body as text/plain with no extra headers.');
    return send(res, 405, 'text/plain; charset=utf-8', 'Preflight requests are not answered, the same as the real web app.', false);
  }
  if (req.method === 'GET') {
    return send(res, 200, JSON_TYPE, JSON.stringify({ ok: true, service: 'ridgeline-wash-team', version: RidgelineCore.VERSION }), true);
  }
  if (req.method !== 'POST') return send(res, 405, 'text/plain; charset=utf-8', 'Use POST.', true);

  const chunks = [];
  let size = 0, tooBig = false;
  req.on('data', (c) => {
    size += c.length;
    if (size > MAX_BODY) tooBig = true; else chunks.push(c);
  });
  req.on('error', () => { /* the phone hung up */ });
  req.on('end', () => {
    const text = tooBig ? '' : Buffer.concat(chunks).toString('utf8');
    const delay = Math.min(MAX_DELAY, Math.max(0, parseInt(url.searchParams.get('delay'), 10) || 0));
    const fail = url.searchParams.get('fail') === '1';
    const started = Date.now();
    setTimeout(() => {
      if (res.destroyed) return log(actionOf(text) + '  the phone gave up before the answer');
      if (fail) {
        log(actionOf(text) + '  answered HTTP 500 with an error page (?fail=1), nothing was run');
        return send(res, 500, 'text/html; charset=utf-8', CRASH_PAGE, true);
      }
      const answer = answerPost(text);
      log(actionOf(text) + '  ' + outcome(answer) + (delay ? '  after ' + (Date.now() - started) + ' ms' : ''));
      send(res, 200, JSON_TYPE, JSON.stringify(answer), true);
    }, delay);
  });
});

server.on('error', (e) => {
  if (e && e.code === 'EADDRINUSE') console.error('Port ' + port + ' is already in use. Stop the other server or pick another port: node tools/dev-server.js ' + (port + 1));
  else console.error('The server could not start: ' + (e && e.message ? e.message : e));
  process.exit(1);
});

let opened;
try { opened = seed(); } catch (e) { console.error(e.message); process.exit(1); }

server.listen(port, () => {
  const at = 'http://localhost:' + port + '/';
  console.log('Ridgeline team backend (local stand-in, core ' + RidgelineCore.VERSION + ') is listening on ' + at);
  console.log('');
  PEOPLE.forEach((p) => console.log('  ' + (p.name + '        ').slice(0, 9) + (p.role + '      ').slice(0, 6) + 'PIN ' + p.pin));
  console.log('  Open days: ' + opened.first + ' to ' + opened.last + ' (' + TIME_ZONE + ')');
  console.log('');
  console.log('Point the page at it by adding this to the end of its address (works on localhost or a file):');
  console.log('  ?backend=' + encodeURIComponent(at));
  console.log('Slow connection:  ?backend=' + encodeURIComponent(at + '?delay=1500'));
  console.log('Crashing backend: ?backend=' + encodeURIComponent(at + '?fail=1'));
  console.log('');
  console.log('Data is kept in memory only. Press Ctrl+C to stop.');
});

function stop() { server.close(() => process.exit(0)); setTimeout(() => process.exit(0), 500).unref(); }
process.on('SIGINT', stop);
process.on('SIGTERM', stop);
