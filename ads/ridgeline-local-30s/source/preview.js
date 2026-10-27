const { chromium } = require('playwright'); const path=require('path'); const fs=require('fs');
(async()=>{ const times=process.argv[2].split(',').map(Number); const out=process.argv[3]; fs.mkdirSync(out,{recursive:true});
  const browser=await chromium.launch({args:['--disable-gpu','--font-render-hinting=none','--force-color-profile=srgb','--hide-scrollbars']});
  const page=await (await browser.newContext({viewport:{width:1080,height:1920}})).newPage();
  page.on('pageerror',e=>console.error('PAGE ERROR',e.message)); page.on('console',m=>{if(m.type()==='error')console.error('CONSOLE',m.text());});
  await page.goto('file://'+path.resolve('composition.html'),{waitUntil:'load'});
  await page.waitForFunction(()=>window.__ready===true,null,{timeout:60000});
  for(const t of times){ await page.evaluate(t=>window.seek(t),t); await page.evaluate(()=>new Promise(r=>requestAnimationFrame(()=>requestAnimationFrame(r))));
    await page.screenshot({path:path.join(out,`t${t.toFixed(2)}.png`)}); }
  await browser.close(); console.log('ok',times.length);
})().catch(e=>{console.error(e);process.exit(1);});
