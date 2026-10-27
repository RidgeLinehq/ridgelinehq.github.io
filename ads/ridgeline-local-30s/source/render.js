// Frame-by-frame renderer: loads composition.html, calls window.seek(t) per frame, screenshots PNG.
// Usage: node render.js <htmlPath> <outDir> <fps> <durationSec> <workers> [startFrame] [endFrame]
const { chromium } = require('playwright');
const path = require('path'); const fs = require('fs');
(async () => {
  const [html, outDir, fpsS, durS, workersS, sfS, efS] = process.argv.slice(2);
  const fps = +fpsS, dur = +durS, workers = +workersS || 3;
  const total = Math.round(fps * dur);
  const start = sfS ? +sfS : 0, end = efS ? +efS : total; // [start, end)
  fs.mkdirSync(outDir, { recursive: true });
  const browser = await chromium.launch({ args: ['--disable-gpu', '--font-render-hinting=none', '--disable-lcd-text', '--force-color-profile=srgb', '--hide-scrollbars'] });
  const frames = []; for (let f = start; f < end; f++) frames.push(f);
  let next = 0; const t0 = Date.now();
  async function worker(id) {
    const ctx = await browser.newContext({ viewport: { width: 1080, height: 1920 }, deviceScaleFactor: 1 });
    const page = await ctx.newPage();
    page.on('pageerror', e => console.error('PAGE ERROR', e.message));
    await page.goto('file://' + path.resolve(html), { waitUntil: 'load' });
    await page.evaluate(() => (document.fonts ? document.fonts.ready : Promise.resolve()));
    await page.waitForFunction(() => window.__ready === true, null, { timeout: 60000 });
    while (true) {
      const i = next++; if (i >= frames.length) break;
      const f = frames[i]; const t = f / fps;
      await page.evaluate((t) => window.seek(t), t);
      await page.evaluate(() => new Promise(r => requestAnimationFrame(() => requestAnimationFrame(r))));
      await page.screenshot({ path: path.join(outDir, `f${String(f).padStart(5, '0')}.png`), type: 'png', clip: { x: 0, y: 0, width: 1080, height: 1920 } });
      if (i % 60 === 0) console.log(`worker${id} frame ${f}/${total} t=${t.toFixed(2)} elapsed ${((Date.now() - t0) / 1000).toFixed(0)}s`);
    }
    await ctx.close();
  }
  await Promise.all(Array.from({ length: workers }, (_, i) => worker(i)));
  await browser.close();
  console.log('done', frames.length, 'frames in', ((Date.now() - t0) / 1000).toFixed(0), 's');
})().catch(e => { console.error(e); process.exit(1); });
