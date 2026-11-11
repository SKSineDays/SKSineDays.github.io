/** Community share kit. Uses only canonical local brand files, never account data.
 * node scripts/generate-group-affiliate-assets.mjs [--check]
 * The US Letter PDF includes editable group name/link fields. Fill, save and test
 * the link before printing. An approved active group affiliate account is required.
 */
import assert from 'node:assert/strict';
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
const require = createRequire(import.meta.url);
const sharp = require('sharp');
const { PDFDocument, StandardFonts, rgb } = require('pdf-lib');
const root = new URL('../', import.meta.url);
const output = new URL('assets/affiliate/groups/', root);
const brand = await readFile(new URL('assets/brand/sineday-wordmark-light.png', root));
const duck = await readFile(new URL('assets/sineducks/SineDuck8.svg', root));
assert(!/(?:href|url)\s*[=(]\s*["']?https?:/i.test(duck.toString()), 'Duck must be offline');
const brandMeta = await sharp(brand).metadata();
const wordmarkData = `data:image/png;base64,${brand.toString('base64')}`;
const duckData = `data:image/svg+xml;base64,${duck.toString('base64')}`;
const c = { ash:'#3B3948', deep:'#24232C', ivory:'#F6EEDF', apricot:'#EDAC9E', lavender:'#C8B7DC', ink:'#332D3B', rule:'#D8CED5' };
const disclosure = 'Our group may earn a commission on qualifying SineDay Premium payments.';
const cta = 'Explore SineDay through our group link.';
const assets = [
 ['square','Square community post','Feed posts',1080,1080,'Pair with the approved group affiliate link and keep the commission disclosure in the post.'],
 ['story','Community story','Stories · 9:16',1080,1920,'Place the approved group affiliate link sticker in the open space below the invitation. Keep the disclosure visible.'],
 ['newsletter','Newsletter image','Newsletters · Wide posts',1200,628,'Include a clickable approved group affiliate link and the disclosure in the surrounding email text.'],
 ['flyer','Community flyer','Print · US Letter',1275,1650,'Add the approved group name and full group affiliate link to the blank fields before printing; test the link. Use the fillable PDF for typed text.'],
].map(([id,title,placement,width,height,usage]) => ({id:`group-affiliate-${id}`,title,format:'PNG',dimensions:`${width} × ${height}`,width,height,path:`/assets/affiliate/groups/sineday-group-${id}.png`,placement,usage,altText:`SineDay community invitation: A little reflection. A shared purpose. A journal for your day. Overlapping journal cards with SineDuck. ${cta} ${disclosure}${id === 'flyer' ? ' Blank fields for an approved group name and affiliate link must be completed before printing.' : ''}`}));
assets.push({id:'pta-information-notice',title:'PTA information notice',format:'PNG',dimensions:'1200 × 628',width:1200,height:628,path:'/assets/affiliate/groups/pta/sineday-pta-information-notice.png',placement:'PTA information · Newsletter',usage:'Share only after the PTA has approved factual subscription information and an active group affiliate account. Include the approved link and visible disclosure. No endorsement is implied.',altText:'SineDay. Optional subscription information. SineDay is a digital journal for daily reflection. View subscription details through our group link. '+disclosure+' Participation is optional. No PTA endorsement is implied.'});
const pdfFile = new URL('sineday-group-flyer.pdf',output);
const esc = s => s.replaceAll('&','&amp;').replaceAll('<','&lt;').replaceAll('>','&gt;');
function text(x,y,s,size,fill=c.ivory,weight=400,tracking=0){return `<text x="${x}" y="${y}" fill="${fill}" font-size="${size}" font-weight="${weight}" letter-spacing="${tracking}">${esc(s)}</text>`;}
function image(href,x,y,w,h){return `<image href="${href}" x="${x}" y="${y}" width="${w}" height="${h}" preserveAspectRatio="xMidYMid meet"/>`;}
function logo(x,y,w){return image(wordmarkData,x,y,w,w*brandMeta.height/brandMeta.width);}
function rect(x,y,w,h,fill,r=0){return `<rect x="${x}" y="${y}" width="${w}" height="${h}" rx="${r}" fill="${fill}"/>`;}
function line(x,y,w,color=c.rule){return `<path d="M${x} ${y}h${w}" stroke="${color}" stroke-width="2"/>`;}
function papers(x,y,scale=1){return `<g transform="translate(${x} ${y}) scale(${scale})">
 <g transform="rotate(-10 160 145)">${rect(0,20,280,280,c.lavender,14)}${line(26,63,206,c.ash)}${line(26,206,208,c.ash)}${line(26,238,176,c.ash)}</g>
 <g transform="rotate(9 430 155)">${rect(294,28,280,280,c.apricot,14)}${line(320,72,206,c.ash)}${line(320,217,206,c.ash)}${line(320,249,165,c.ash)}</g>
 ${rect(137,0,300,302,c.ivory,14)}${text(162,43,'A MOMENT TO NOTICE',13,c.ink,700,1.4)}${image(duckData,170,69,234,117)}${text(162,228,'What stood out today?',18,c.ink)}${line(162,263,250)}
 </g>`;}
function frame(w,h,body,bg=c.ash){return `<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}" viewBox="0 0 ${w} ${h}">${rect(0,0,w,h,bg)}<g font-family="Arial, Helvetica, sans-serif">${body}</g></svg>`;}
function foot(x,y,size=24){return text(x,y,'Our group may earn a commission on qualifying',size)+text(x,y+size*1.4,'SineDay Premium payments.',size);}
function square(){return frame(1080,1080,`${logo(70,45,300)}${text(73,174,'SMALL MOMENTS. SHARED CONNECTION.',17,c.lavender,700,2)}${text(70,265,'A little reflection.',75,c.ivory,700,-2)}${text(70,350,'A shared purpose.',75,c.ivory,700,-2)}${text(73,409,'A journal for your day.',29,c.ivory)}${papers(162,464,1.3)}${text(73,933,cta,31,c.apricot,700)}${foot(73,994,23)}`);}
function story(){return frame(1080,1920,`${logo(80,170,340)}${text(84,327,'SMALL MOMENTS.',21,c.lavender,700,3)}${text(84,362,'SHARED CONNECTION.',21,c.lavender,700,3)}${text(80,481,'A little',101,c.ivory,700,-3)}${text(80,590,'reflection.',101,c.ivory,700,-3)}${text(80,725,'A shared',101,c.ivory,700,-3)}${text(80,834,'purpose.',101,c.ivory,700,-3)}${text(84,911,'A journal for your day.',36)}${papers(146,1020,1.36)}${text(84,1510,'Explore SineDay through',36,c.apricot,700)}${text(84,1559,'our group link.',36,c.apricot,700)}${foot(84,1780,25)}`);}
function newsletter(){return frame(1200,628,`${logo(56,32,260)}${text(60,143,'SMALL MOMENTS. SHARED CONNECTION.',14,c.lavender,700,1.5)}${text(56,230,'A little reflection.',58,c.ivory,700,-1.5)}${text(56,297,'A shared purpose.',58,c.ivory,700,-1.5)}${text(60,353,'A journal for your day.',26)}${papers(686,165,.77)}${text(60,490,cta,29,c.apricot,700)}${line(60,524,1080,c.lavender)}${text(60,572,disclosure,23)}`);}
function flyer(){return frame(1275,1650,`${rect(0,0,1275,255,c.ash)}${logo(80,56,385)}${text(80,207,'SMALL MOMENTS. SHARED CONNECTION.',21,c.lavender,700,2.5)}${text(80,383,'A little reflection.',87,c.ink,700,-2)}${text(80,481,'A shared purpose.',87,c.ink,700,-2)}${text(84,552,'A journal for your day.',36,c.ink)}${papers(228,628,1.42)}${text(84,1153,cta,39,c.ink,700)}${text(84,1224,'GROUP NAME',20,c.ink,700,2)}${line(84,1290,1107,c.ash)}${text(84,1347,'GROUP AFFILIATE LINK',20,c.ink,700,2)}${line(84,1420,1107,c.ash)}${text(84,1524,'Our group may earn a commission on qualifying',27,c.ink)}${text(84,1562,'SineDay Premium payments.',27,c.ink)}`,c.ivory);}
function notice(){return frame(1200,628,`${logo(60,32,270)}${text(60,195,'Optional subscription',53,c.ivory,700,-1)}${text(60,257,'information',53,c.ivory,700,-1)}${text(60,331,'SineDay is a digital journal for daily reflection.',28)}${text(60,410,'View subscription details through our group link.',28,c.apricot,700)}${line(60,452,1080,c.lavender)}${text(60,497,disclosure,23)}${text(60,552,'Participation is optional. No PTA endorsement is implied.',23)}`);}
const renders=[square(),story(),newsletter(),flyer(),notice()];
const fileFor = a => new URL(a.path.slice('/assets/affiliate/groups/'.length),output);
if(!process.argv.includes('--check')){
 await mkdir(output,{recursive:true});
 await mkdir(new URL('pta/',output),{recursive:true});
 for(let i=0;i<renders.length;i++) await sharp(Buffer.from(renders[i])).png({compressionLevel:9}).toFile(fileURLToPath(fileFor(assets[i])));
 const pdf = await PDFDocument.create(); pdf.setTitle('SineDay community share flyer');
 const page = pdf.addPage([612,792]); const png=await pdf.embedPng(await readFile(fileFor(assets[3]))); page.drawImage(png,{x:0,y:0,width:612,height:792});
 const font=await pdf.embedFont(StandardFonts.Helvetica); const form=pdf.getForm();
 for(const [name,top,h] of [['Group name',1236,49],['Group affiliate link',1360,54]]){
  const field=form.createTextField(name); field.addToPage(page,{x:84*.48,y:792-(top+h)*.48,width:1107*.48,height:h*.48,borderWidth:0,textColor:rgb(.2,.176,.231)}); field.setFontSize(name === 'Group name' ? 16 : 11);
 }
 form.updateFieldAppearances(font);
 await writeFile(pdfFile,await pdf.save());
 await writeFile(new URL('assets.json',output),`${JSON.stringify(assets,null,2)}\n`);
}
const manifest=JSON.parse(await readFile(new URL('assets.json',output),'utf8'));
assert.deepEqual(manifest,assets,'Manifest must match approved formats, copy and placement');
for(let i=0;i<5;i++){
 const a=manifest[i]; const bytes=await readFile(fileFor(a)); const m=await sharp(bytes).metadata();
 assert.equal(m.width,a.width);assert.equal(m.height,a.height);assert.equal(m.format,'png');
 // Rasterization varies with the host font renderer. Check committed dimensions
 // and source composition here; review all rendered images after regenerating.
 assert(a.altText.includes(disclosure));if(i<4) assert(a.altText.includes(cta));
 assert(!/href="(?!data:)/.test(renders[i]),'All images must be locally embedded');
}
const pdf=await PDFDocument.load(await readFile(pdfFile));assert.equal(pdf.getPageCount(),1);assert.equal(pdf.getPage(0).getWidth(),612);assert.equal(pdf.getPage(0).getHeight(),792);
assert.deepEqual(pdf.getForm().getFields().map(f=>f.getName()),['Group name','Group affiliate link']);
console.log('Group share kit validated: 5 offline PNGs, matching manifest and 1 fillable US Letter PDF.');
