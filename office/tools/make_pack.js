#!/usr/bin/env node
/**
 * Ridgeline client deliverables as real, branded files: JSON -> HTML -> PDF (Playwright/Chromium).
 *
 * Usage: node office/tools/make_pack.js <spec.json> <out.pdf>
 *   writes <out.pdf> and <out>.html (the same design; the HTML also works as an email body).
 *
 * Spec: {"title": "Welcome Pack", "business": "Enjoy Ice Cream Shop", "date": "Oct 24, 2026",
 *        "plan": "Starter", "sections": [ ...blocks... ]}
 * Blocks (use any, in any order; every string is plain text, escaped here):
 *  {"type":"score", "score":50, "label":"Starting AI visibility score", "note":"...",
 *     "rows":[{"question":"Who are the best ...?", "chatgpt":"Named #1", "gemini":"Not named"}]}
 *  {"type":"heading", "text":"Your Google profile fixes", "sub":"About 10 minutes. Do the first 3 today."}
 *  {"type":"copy", "label":"DO FIRST", "title":"Description", "where":"Edit profile > Business information > Description", "text":"...paste me..."}
 *  {"type":"list", "title":"10 photo ideas", "items":["...", "..."], "numbered":true}
 *  {"type":"compare", "title":"Who AI recommends today", "you":"Enjoy Ice Cream Shop", "items":[{"name":"Webb's","by":"ChatGPT"}]}
 *  {"type":"stats", "items":[{"value":"4","label":"Leads sent"},{"value":"2","label":"Became jobs"}]}
 *  {"type":"steps", "title":"Your next 30 days", "items":[{"when":"This week","what":"..."}]}
 *  {"type":"note", "text":"..."}
 *  {"type":"pagebreak"}
 *  {"type":"heading", ..., "newpage":true}   (headings no longer force a new page unless asked)
 *  {"type":"audit", "title":"What we found", "rows":[{"item":"Yelp category","found":"Tree Services","fix":"Change to Plumbers","source":"yelp.com"}]}
 *  {"type":"image", "src":"https://ridgelinehq.github.io/cards/<slug>.png", "caption":"Your review QR card", "width":220}  (https only)
 *  {"type":"sources", "title":"Where these facts came from", "items":[{"label":"Birdeye","url":"https://..."}]}
 * Spec "footer": optional text replacing the default footer's first line.
 * Never put anything in a spec that isn't true (specs/quality.md "True").
 */
const fs = require('fs');
const path = require('path');

const esc = s => String(s == null ? '' : s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
const para = s => esc(s).split(/\n{2,}/).map(p => `<p>${p.replace(/\n/g, '<br>')}</p>`).join('');

function gauge(score) {
  const s = Math.max(0, Math.min(100, +score || 0));
  const a = Math.PI * (1 - s / 100), x = 100 + 80 * Math.cos(a), y = 100 - 80 * Math.sin(a);
  const big = 0;
  return `<svg viewBox="0 0 200 118" class="gauge" aria-hidden="true">
    <path d="M20 100 A80 80 0 0 1 180 100" fill="none" stroke="#e3ded0" stroke-width="16" stroke-linecap="round"/>
    ${s > 0 ? `<path d="M20 100 A80 80 0 ${big} 1 ${x.toFixed(1)} ${y.toFixed(1)}" fill="none" stroke="#d2b375" stroke-width="16" stroke-linecap="round"/>` : ''}
    <text x="100" y="92" text-anchor="middle" class="gnum">${s}</text>
    <text x="100" y="112" text-anchor="middle" class="gsub">out of 100</text></svg>`;
}

const tag = v => {
  const t = String(v || '');
  const cls = /not named|no answer|missing|0 /i.test(t) ? 'bad' : (/named|yes|done|live/i.test(t) ? 'good' : 'mid');
  return `<span class="tag ${cls}">${esc(t)}</span>`;
};

function block(b) {
  switch (b.type) {
    case 'score': return `<section class="score card">
      <div class="g">${gauge(b.score)}<div class="glabel">${esc(b.label || 'AI visibility score')}</div></div>
      <div class="sbody">${b.note ? para(b.note) : ''}
        ${(b.rows || []).length ? `<table><thead><tr><th>What a customer asks</th><th>ChatGPT</th><th>Gemini</th></tr></thead><tbody>
        ${b.rows.map(r => `<tr><td>“${esc(r.question)}”</td><td>${tag(r.chatgpt)}</td><td>${tag(r.gemini)}</td></tr>`).join('')}</tbody></table>` : ''}
      </div></section>`;
    case 'heading': return `<header class="h2${b.newpage ? ' np' : ''}"><h2>${esc(b.text)}</h2>${b.sub ? `<p>${esc(b.sub)}</p>` : ''}</header>`;
    case 'copy': return `<section class="copy card">${b.label ? `<span class="lbl">${esc(b.label)}</span>` : ''}<h3>${esc(b.title)}</h3>
      ${b.where ? `<div class="where">Where: ${esc(b.where)}</div>` : ''}<div class="paste">${para(b.text)}</div></section>`;
    case 'list': return `<section class="list card"><h3>${esc(b.title)}</h3><${b.numbered ? 'ol' : 'ul'}>${(b.items || []).map(i => `<li>${esc(i)}</li>`).join('')}</${b.numbered ? 'ol' : 'ul'}></section>`;
    case 'compare': return `<section class="cmp card"><h3>${esc(b.title || 'Who AI recommends today')}</h3><div class="chips">
      ${(b.items || []).map(i => `<span class="chip">${esc(i.name)}${i.by ? `<small>${esc(i.by)}</small>` : ''}</span>`).join('')}</div>
      ${b.you ? `<p class="you">Goal: get <b>${esc(b.you)}</b> on this list for both tools.</p>` : ''}</section>`;
    case 'stats': return `<section class="stats">${(b.items || []).map(i => `<div class="stat"><b>${esc(i.value)}</b><span>${esc(i.label)}</span></div>`).join('')}</section>`;
    case 'steps': return `<section class="steps card"><h3>${esc(b.title)}</h3>${(b.items || []).map(i => `<div class="step"><span>${esc(i.when)}</span><p>${esc(i.what)}</p></div>`).join('')}</section>`;
    case 'note': return `<aside class="note">${para(b.text)}</aside>`;
    case 'pagebreak': return '<div class="pb"></div>';
    case 'audit': return `<section class="audit card"><h3>${esc(b.title || 'What we found')}</h3>${(b.rows || []).map(r => `<div class="arow">
      <div class="aitem">${esc(r.item)}</div><div class="afound"><small>Found</small>${tag(r.found)}</div>
      <div class="afix"><small>Fix</small>${esc(r.fix)}</div>${r.source ? `<div class="asrc">Source: ${esc(r.source)}</div>` : ''}</div>`).join('')}</section>`;
    case 'image': return /^https:\/\//.test(String(b.src || '')) ? `<figure class="img card"><img src="${esc(b.src)}" alt="${esc(b.caption || '')}" style="width:${Math.min(600, +b.width || 260)}px;max-width:100%">${b.caption ? `<figcaption>${esc(b.caption)}</figcaption>` : ''}</figure>` : '';
    case 'sources': return `<section class="srcs"><h3>${esc(b.title || 'Where these facts came from')}</h3><ol>${(b.items || []).filter(i => /^https?:\/\//.test(String(i.url || ''))).map(i => `<li>${esc(i.label || '')} <a href="${esc(i.url)}">${esc(i.url)}</a></li>`).join('')}</ol></section>`;
    default: return '';
  }
}

function html(spec) {
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>${esc(spec.title)} · ${esc(spec.business)}</title><style>
@page{size:Letter;margin:14mm 0 12mm}@page :first{margin:0 0 12mm}
*{box-sizing:border-box}body{margin:0;background:#fffdf8;color:#15271f;font:15px/1.55 Arial,Helvetica,sans-serif;-webkit-print-color-adjust:exact;print-color-adjust:exact}
.cover{background:#142f27;color:#fff;padding:44px 48px 36px;position:relative;overflow:hidden}

.brand{display:flex;align-items:center;gap:10px;font-weight:800;letter-spacing:.16em;font-size:12px;text-transform:uppercase}
.brand svg{width:30px;height:30px}
.cover h1{font:400 40px/1.08 Georgia,"Times New Roman",serif;margin:26px 0 6px}
.cover h1 em{color:#d2b375}
.meta{color:#cfd9cf;font-size:13px}
main{padding:28px 48px 40px}
.card{background:#fff;border:1px solid #e3ded0;border-radius:14px;padding:20px 22px;margin:0 0 16px;break-inside:avoid}
h2{font:400 28px/1.15 Georgia,serif;margin:0}h3{margin:0 0 8px;font-size:17px}
.h2.np{break-before:page}.h2{break-after:avoid;margin:0 0 14px;border-top:2px solid #d2b375;padding-top:14px}.h2 p{margin:4px 0 0;color:#5a6a60}
.score{display:grid;grid-template-columns:200px 1fr;gap:22px;align-items:start}
.gauge{width:200px}.gnum{font:700 44px Georgia,serif;fill:#142f27}.gsub{font-size:11px;fill:#5a6a60}
.glabel{text-align:center;font-weight:700;font-size:13px;margin-top:2px}
table{width:100%;border-collapse:collapse;font-size:13px;margin-top:6px}th{text-align:left;color:#5a6a60;font-weight:600;padding:6px 6px;border-bottom:1px solid #e3ded0}
td{padding:8px 6px;border-bottom:1px solid #f0ece2;vertical-align:top}
.tag{display:inline-block;padding:3px 9px;border-radius:20px;font-size:12px;font-weight:700;white-space:nowrap}
.tag.good{background:#e3f1e8;color:#1f6b46}.tag.bad{background:#f8e4e0;color:#9a2f22}.tag.mid{background:#f2ecdc;color:#7f6233}
.lbl{display:inline-block;background:#142f27;color:#d2b375;font-size:10px;font-weight:800;letter-spacing:.14em;padding:4px 8px;border-radius:4px;margin-bottom:8px}
.where{font-size:12px;color:#5a6a60;margin-bottom:8px}
.paste{background:#f5f1e6;border-left:3px solid #d2b375;border-radius:8px;padding:12px 14px;font-size:14px}.paste p{margin:0 0 8px}.paste p:last-child{margin:0}
ol,ul{margin:0;padding-left:20px}li{margin:4px 0}
.chips{display:flex;flex-wrap:wrap;gap:8px}.chip{background:#f5f1e6;border:1px solid #e3ded0;border-radius:20px;padding:6px 12px;font-weight:600;font-size:13px}
.chip small{display:block;font-weight:500;color:#5a6a60;font-size:11px}.you{margin:12px 0 0;color:#5a6a60}
.stats{display:grid;grid-template-columns:repeat(auto-fit,minmax(120px,1fr));gap:12px;margin:0 0 16px}
.stat{background:#142f27;color:#fff;border-radius:14px;padding:16px}.stat b{display:block;font:700 32px Georgia,serif;color:#d2b375}.stat span{font-size:12px;color:#cfd9cf}
.step{display:grid;grid-template-columns:110px 1fr;gap:12px;padding:8px 0;border-top:1px solid #f0ece2}.step:first-of-type{border-top:0}
.step span{font-weight:700;color:#7f6233;font-size:13px}.step p{margin:0}
.note{background:#e9eee3;border-radius:12px;padding:14px 16px;margin:0 0 16px;font-size:14px}.note p{margin:0 0 6px}.note p:last-child{margin:0}
.pb{break-after:page}
.arow{display:grid;grid-template-columns:1.1fr 1fr 1.6fr;gap:8px 12px;padding:10px 0;border-top:1px solid #e3ded0;break-inside:avoid;font-size:13px}.arow:first-of-type{border-top:0}
.aitem{font-weight:700}.arow small{display:block;color:#5a6a60;font-size:10px;text-transform:uppercase;letter-spacing:.1em}.asrc{grid-column:1/-1;color:#5a6a60;font-size:11px}
.img{text-align:center}.img figcaption{color:#5a6a60;font-size:12px;margin-top:6px}
.srcs{font-size:11px;color:#5a6a60;margin:8px 0 16px;break-inside:avoid}.srcs h3{font-size:13px}.srcs a{color:#142f27;word-break:break-all}
@media (max-width:640px){.arow{grid-template-columns:1fr}}
@media print{body{background:#fff}}
footer{padding:16px 48px 28px;color:#5a6a60;font-size:11px;border-top:1px solid #e3ded0}
@media (max-width:640px){.cover,main,footer{padding-left:18px;padding-right:18px}.score{grid-template-columns:1fr}.gauge{margin:0 auto;display:block}.step{grid-template-columns:1fr}}
</style></head><body>
<div class="cover"><div class="brand"><svg viewBox="0 0 40 40"><path d="M2 31 13.5 11l6 9.5 5-7.5L38 31Z" fill="#fff"/><path d="M13.5 11 19.5 20.5 16.4 24.9 9.6 17.7Z" fill="#d2b375"/></svg>Ridgeline Local</div>
<h1>${esc(spec.title)}<br><em>${esc(spec.business)}</em></h1>
<div class="meta">${esc(spec.date || '')}${spec.plan ? ' · ' + esc(spec.plan) + ' plan' : ''}${spec.subtitle ? ' · ' + esc(spec.subtitle) : ''}</div></div>
<main>${(spec.sections || []).map(block).join('\n')}</main>
<footer>${spec.footer ? esc(spec.footer) : `Prepared for ${esc(spec.business)} by Ridgeline Local · ridgelinemarketinghq@gmail.com · Questions? Reply to the email this came with.`}<br>
AI answers change over time; every answer in this report is shown as ChatGPT or Gemini gave it on the date above.</footer>
</body></html>`;
}

async function main() {
  const [specPath, outPdf] = process.argv.slice(2);
  if (!specPath || !outPdf) { console.error('usage: node make_pack.js spec.json out.pdf'); process.exit(2); }
  const spec = JSON.parse(fs.readFileSync(specPath, 'utf8'));
  const page = html(spec);
  const outHtml = outPdf.replace(/\.pdf$/i, '') + '.html';
  fs.writeFileSync(outHtml, page);
  let chromium;
  try { ({ chromium } = require('playwright')); } catch (e) {
    console.error('playwright not available: send the HTML (' + outHtml + ') as the email body instead'); process.exit(3);
  }
  const browser = await chromium.launch(fs.existsSync('/opt/pw-browsers/chromium') ? {} : {});
  const p = await browser.newPage();
  await p.setContent(page, { waitUntil: 'load' });
  await p.pdf({ path: outPdf, format: 'Letter', printBackground: true, preferCSSPageSize: true });
  await browser.close();
  console.log('wrote', outPdf, 'and', outHtml, (fs.statSync(outPdf).size / 1024).toFixed(0) + ' KB');
}
main().catch(e => { console.error(e.message); process.exit(1); });
