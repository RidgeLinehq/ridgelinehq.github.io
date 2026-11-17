#!/usr/bin/env node
/*
 * Builds the two things people actually use from the files in team/src:
 *   team/index.html        the app: one self-contained page (styles, logic and logo inline)
 *   team/backend/Code.gs   the Google Apps Script backend: core.js + gas.js in one file to paste
 *
 *   node tools/build.js                       build both
 *   node tools/build.js --no-backend          page only
 *   node tools/build.js --backend-only        Code.gs only
 *   node tools/build.js --out /tmp/x.html     write the page somewhere else (leaves index.html alone)
 *   node tools/build.js --only screens-sales  include only the named screens-* files (comma separated)
 *   node tools/build.js --preview out.html [--preview-photo small.jpg]
 *                                             also write a body-only copy for a Claude artifact preview
 */
const fs = require('fs');
const path = require('path');

const root = path.join(__dirname, '..');
const src = (name) => path.join(root, 'src', name);
const read = (name) => fs.readFileSync(src(name), 'utf8');
const has = (name) => fs.existsSync(src(name));
const list = (re) => fs.readdirSync(path.join(root, 'src')).filter((f) => re.test(f)).sort();

const arg = (name) => { const i = process.argv.indexOf(name); return i > -1 ? process.argv[i + 1] : null; };
const flag = (name) => process.argv.includes(name);
const only = arg('--only') ? arg('--only').split(',').map((s) => s.trim()) : null;
const wanted = (f) => !only || only.includes(f.replace(/\.(js|css)$/, ''));

function buildPage() {
  if (!has('shell.html')) return null;
  const css = ['app.css', ...list(/^screens-.*\.css$/).filter(wanted)].filter(has).map((f) => `/* ---- ${f} ---- */\n${read(f)}`).join('\n');
  const js = ['core.js', 'sample.js', 'app.js', ...list(/^screens-.*\.js$/).filter(wanted)].filter(has)
    .map((f) => `/* ---- ${f} ---- */\n${read(f)}`).join('\n;\n');
  if (/<\/script/i.test(js)) throw new Error('A source file contains "</script", which would end the inline script early.');
  const logo = has('logo.svg') ? read('logo.svg').replace(/<\?xml[^>]*\?>/, '').trim() : '';
  let html = read('shell.html');
  for (const token of ['/*__CSS__*/', '/*__JS__*/']) {
    if (!html.includes(token)) throw new Error(`shell.html is missing the ${token} placeholder`);
  }
  html = html.split('/*__CSS__*/').join(css).split('/*__JS__*/').join(js).split('<!--__LOGO__-->').join(logo);
  fs.writeFileSync(arg('--out') || path.join(root, 'index.html'), html);
  return html;
}

function buildBackend() {
  if (!has('gas.js')) return null;
  const head = [
    '/*',
    ' * Ridgeline Wash Co. team system: the backend. BUILT FILE, do not edit here.',
    ' * Source: team/src/core.js + team/src/gas.js, joined by team/tools/build.js.',
    ' * Setup steps for Grayson: team/SETUP.md',
    ' */',
    ''
  ].join('\n');
  const out = head + read('core.js') + '\n\n' + read('gas.js');
  fs.mkdirSync(path.join(root, 'backend'), { recursive: true });
  fs.writeFileSync(path.join(root, 'backend', 'Code.gs'), out);
  return out;
}

/* A Claude artifact wraps the file in its own <html><head><body>, so the preview is body content only. */
function buildPreview(html, outPath) {
  const pick = (re) => (html.match(re) || []).join('\n');
  const title = pick(/<title>[\s\S]*?<\/title>/i);
  const fonts = pick(/<link[^>]+fonts\.googleapis\.com[^>]*>/gi);
  const styles = pick(/<style[\s\S]*?<\/style>/gi);
  let body = (html.match(/<body[^>]*>([\s\S]*)<\/body>/i) || [])[1] || '';
  /* The preview has no config.js beside it, so tell the page inline that this is sample mode. */
  body = body.replace(/<script[^>]+src=["'][^"']*config\.js["'][^>]*><\/script>/gi, '<script>window.RIDGELINE_BACKEND = "";<\/script>');
  let out = [title, '<meta name="claude:viewport-fit-sides" content="cover">', fonts, styles, body].join('\n');
  /* The preview has no files beside it, so the one photo travels inside the page. */
  const small = arg('--preview-photo');
  if (small && fs.existsSync(small)) {
    out = out.split('photo-standard.jpg').join('data:image/jpeg;base64,' + fs.readFileSync(small).toString('base64'));
  }
  fs.writeFileSync(outPath, out);
}

const page = flag('--backend-only') ? null : buildPage();
const backend = flag('--no-backend') || arg('--out') ? null : buildBackend();
if (arg('--preview') && page) buildPreview(page, arg('--preview'));
console.log(`page: ${page ? (page.length / 1024).toFixed(0) + ' KB -> ' + (arg('--out') || 'index.html') : 'skipped'}`);
console.log(`backend/Code.gs: ${backend ? (backend.length / 1024).toFixed(0) + ' KB' : 'skipped'}`);
