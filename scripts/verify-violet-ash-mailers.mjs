// Offline layout smoke test, not a substitute for native inbox testing.
import { chromium } from 'playwright';
import fs from 'node:fs/promises';
import path from 'node:path';
import assert from 'node:assert/strict';
import {folder} from './generate-violet-ash-mailers.mjs';
const root=path.resolve(folder,'../../..');
const output='/tmp/violet-ash-mailer-review';
await fs.mkdir(output,{recursive:true});
const manifest=JSON.parse(await fs.readFile(path.join(folder,'manifest.json'),'utf8'));
const browser=await chromium.launch({executablePath:'/usr/bin/chromium',headless:true,args:['--no-sandbox']});
let checks=0;
try {
 for(const width of [320,390,640]) for(const colorScheme of ['light','dark']) {
  const page=await browser.newPage({viewport:{width,height:900},colorScheme});
  await page.route('**/*',async route=>{
   const u=new URL(route.request().url());
   if(u.hostname==='sineday.app' && u.pathname.startsWith('/assets/email/')) {
    try{return await route.fulfill({body:await fs.readFile(path.join(root,u.pathname)),contentType:'image/png'});}catch{}
   }
   await route.abort();
  });
  for(const item of manifest){
   await page.setContent(await fs.readFile(path.join(folder,item.alias+'.html'),'utf8'));
   assert(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),item.alias+' overflow '+width);
   assert.equal(await page.locator('h1').count(),1);
   if(width===390&&colorScheme==='light'&&['welcomeemail','dailyemailconfirmation','day01risinginitiation-1'].includes(item.alias)) await page.screenshot({path:path.join(output,item.alias+'.png'),fullPage:true});
   checks++;
  }
  await page.close();
 }
}finally{await browser.close();}
console.log(`${checks} offline viewport/color-scheme checks passed. Screenshots: ${output}`);
