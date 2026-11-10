import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import {folder,theme,generate} from '../scripts/generate-violet-ash-mailers.mjs';
const mask = s => s.replace(/(<style\b[^>]*>)[\s\S]*?(<\/style>)/gi,'$1STYLE$2').replace(/\b(style|bgcolor)="[^"]*"/gi,'$1="STYLE"');
test('all 20 live snapshots transform without changing content, URLs, variables, or layout',()=>{
 assert.equal(generate(true).length,20);
 for(const file of fs.readdirSync(path.join(folder,'source'))){
  const s=JSON.parse(fs.readFileSync(path.join(folder,'source',file),'utf8'));
  const before=s.parts.find(p=>p.startsWith('HTML:\n')).slice(6),after=theme(before);
  assert.equal(mask(before),mask(after));
  const noColor = x=>x.replace(/#[\da-f]{6}\b/gi,'COLOR');
  assert.equal(noColor(before),noColor(after),s.alias);
  assert(!/#(?:7AA7FF|05060A|0D111B|AFC9FF)/i.test(after));
 }
});
const lum=h=>{const c=h.match(/\w\w/g).map(x=>parseInt(x,16)/255).map(v=>v<=.04045?v/12.92:((v+.055)/1.055)**2.4);return .2126*c[0]+.7152*c[1]+.0722*c[2]};
const contrast=(a,b)=>{const l=[lum(a),lum(b)].sort((x,y)=>y-x);return (l[0]+.05)/(l[1]+.05)};
test('body, muted, link, CTA, and image fallback colors meet WCAG AA normal text contrast',()=>{
 for(const bg of ['24232C','3B3948']) for(const fg of ['F6EEDF','C7C2D1','C8B7DC']) assert(contrast(fg,bg)>=4.5,`${fg}/${bg}`);
 assert(contrast('2E2429','EDAC9E')>=4.5);
});
