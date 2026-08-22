/**
 * Renders the X post banners in docs/brand/ to PNG at 1x and 2x.
 *
 *   node docs/brand/render-x-posts.mjs            # all of them
 *   NAMES=ladder node docs/brand/render-x-posts.mjs
 *
 * Needs a chromium binary. CHROME= overrides the path if yours differs.
 * The sources pull webfonts from Google, so this wants network access.
 */
import { chromium } from 'playwright-core';
// Sources live beside this file; override with SP= to render from elsewhere.
const SP=process.env.SP||new URL(".",import.meta.url).pathname;
const names=(process.env.NAMES||'ladder,punnett,receipt,fair,specimen').split(',');
const b=await chromium.launch({executablePath:process.env.CHROME||'/opt/pw-browsers/chromium-1194/chrome-linux/chrome',args:['--no-sandbox','--font-render-hinting=none']});
for (const n of names) {
  for (const [scale,suffix] of [[1,''],[2,'@2x']]) {
    const c=await b.newContext({viewport:{width:1600,height:900},deviceScaleFactor:scale});
    const p=await c.newPage();
    await p.goto('file://'+SP+'/x-'+n+'.src.html',{waitUntil:'networkidle'});
    await p.evaluate(()=>document.fonts.ready);
    await new Promise(r=>setTimeout(r,1000));
    await (await p.$('.b')).screenshot({path:SP+'/export/x-'+n+suffix+'.png'});
    await c.close();
  }
  console.log('rendered',n);
}
await b.close();
