import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
const css=readFileSync('styles.css','utf8');
const luminance=hex=>{const c=hex.match(/\w\w/g).map(v=>parseInt(v,16)/255).map(v=>v<=.04045?v/12.92:((v+.055)/1.055)**2.4);return c[0]*.2126+c[1]*.7152+c[2]*.0722;};
const contrast=(a,b)=>{const l=[luminance(a),luminance(b)].sort((a,b)=>b-a);return(l[0]+.05)/(l[1]+.05);};
test('official Violet Ash tokens retain approved palette and accessible role contrast',()=>{
 for(const [role,hex] of Object.entries({canvas:'24232C',card:'3B3948',text:'F6EEDF',muted:'C7C2D1',action:'EDAC9E',detail:'C8B7DC',border:'9790AA',ink:'2E2429'}))assert.ok(css.includes(`--va-${role}: #${hex}`));
 for(const [a,b,min] of [['F6EEDF','3B3948',7],['C7C2D1','3B3948',4.5],['2E2429','EDAC9E',7],['9790AA','3B3948',3],['654A73','F6EEDF',4.5]])assert.ok(contrast(a,b)>=min,`${a}/${b}`);
 assert.match(css,/color-scheme: dark/);
});
test('homepage theme preserves original art and exact wave alignment; mailer gets requested card',()=>{
 const s=readFileSync('css/homepage.css','utf8');assert.match(s,/assets\/og-hero\.png/);assert.ok(s.includes('calc(62.3vh - max(12.8vh, 19.2vw) - 124px)'));assert.ok(s.includes('calc(48vh - max(.52vh, .78vw) - 100px)'));
 assert.match(s,/\.home-daily \{[^}]*background: var\(--va-card\)/);assert.match(s,/\.home-daily__action a \{[^}]*background: var\(--va-action\)/);
 const manifest=JSON.parse(readFileSync('site.webmanifest'));assert.equal(manifest.theme_color,'#24232C');assert.equal(manifest.background_color,'#24232C');
});
