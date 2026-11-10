import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
const html = readFileSync(new URL('../index.html', import.meta.url), 'utf8');
const sw = readFileSync(new URL('../service-worker.js', import.meta.url), 'utf8');
const controller = readFileSync(new URL('../js/home-video.js',import.meta.url),'utf8');

test('two films use one opt-in accessible dialog and linked text, without transcript dropdowns', () => {
  assert.match(html, /id="watch-sineday"/);
  assert.equal((html.match(/\bdata-home-video(?:\s|>)/g) || []).length, 2);
  assert.equal((html.match(/<video\b/g) || []).length, 1);
  assert.match(html, /<dialog[^>]*id="home-video-dialog"[^>]*aria-labelledby="home-video-title"/);
  const video = html.match(/<video\b[^>]*>/)[0];
  assert.match(video, /controls playsinline preload="none"/);
  assert.match(video, /aria-labelledby="home-video-title"/);
  assert.doesNotMatch(video, /autoplay|\ssrc=/);
  for (const anchor of ['story', 'in-action']) assert.ok(html.includes(`/video-transcripts.html#${anchor}`));
  assert.doesNotMatch(html, /<details[^>]*intro-video|id="intro-video-transcript"/);
  assert.match(html, /data-video-close aria-label="Close video"/);
  assert.match(html, /id="home-video-direct"/);
});

test('video bypasses service worker cache, including byte ranges', () => {
  const handlers = {};
  vm.runInNewContext(sw, { self: { addEventListener: (n,fn) => handlers[n]=fn }, location: { origin:'https://www.sineday.app' }, URL, console });
  for (const file of ['sineday-intro-2026-11-09.mp4','sineday-story-2026-11-10.mp4']) {
    for (const destination of ['video', '']) {
      let intercepted = false;
      handlers.fetch({ request: { method:'GET', url:`https://www.sineday.app/assets/video/${file}`, destination, headers: new Headers({ Range:'bytes=0-1023' }) }, respondWith: () => intercepted = true });
      assert.equal(intercepted, false);
    }
  }
  assert.doesNotMatch(sw.slice(sw.indexOf('const ASSETS_TO_CACHE'), sw.indexOf('const OPTIONAL_ASSETS')), /assets\/video/);
});

function fixture({ supported=true }={}) {
  const listeners = new Map(), windowHandlers={};
  const make = (extra={}) => {
    const el={...extra, focusCount:0, focus(){this.focusCount++}, addEventListener(name,fn){const m=listeners.get(this)||{};m[name]=fn;listeners.set(this,m)}};
    el.fire=(name,event={})=>listeners.get(el)?.[name]?.(event);
    return el;
  };
  const close = make();
  const dialog = make({open:false, showCount:0, closeCount:0,
    querySelector:()=>close,
    getBoundingClientRect:()=>({left:100,right:500,top:100,bottom:700}),
    close(){this.closeCount++;this.open=false;this.fire('close')}
  });
  if(supported)dialog.showModal=function(){this.open=true;this.showCount++};
  const player=make({pauses:0,loads:0,attrs:{},pause(){this.pauses++},load(){this.loads++},removeAttribute(n){delete this.attrs[n];if(n==='src')delete this.src},setAttribute(n,v){this.attrs[n]=v}});
  const title={},text={},direct={};
  const links=['story','in-action'].map((name,i)=>make({href:`https://www.sineday.app/${name}.mp4`,dataset:{videoTitle:`Film ${i+1}`,videoPoster:`/${name}.jpg`,videoTranscript:`/video-transcripts.html#${name}`}}));
  const elements={'home-video-dialog':dialog,'home-video-player':player,'home-video-title':title,'home-video-text':text,'home-video-direct':direct};
  vm.runInNewContext(controller,{document:{getElementById:id=>elements[id],querySelectorAll:()=>links},window:{addEventListener:(name,fn)=>windowHandlers[name]=fn}});
  const click=(link,extra={})=>{const e={button:0,prevented:false,preventDefault(){this.prevented=true},...extra};link.fire('click',e);return e};
  return {dialog,player,title,text,direct,links,close,windowHandlers,click};
}

test('opening either film sets only the selected media, focuses close, and does not autoplay', () => {
  const f=fixture();
  assert.equal(f.player.loads,0);assert.equal(f.player.src,undefined);assert.equal(f.dialog.open,false);
  for(const link of f.links){
    assert.equal(f.click(link).prevented,true);
    assert.equal(f.dialog.open,true);
    assert.equal(f.player.src,link.href);
    assert.equal(f.player.poster,link.dataset.videoPoster);
    assert.equal(f.player.attrs['aria-label'],link.dataset.videoTitle);
    assert.equal(f.title.textContent,link.dataset.videoTitle);
    assert.equal(f.text.href,link.dataset.videoTranscript);
    assert.equal(f.direct.href,link.href);
    f.close.fire('click');
    assert.equal(f.player.src,undefined);
    assert.equal(link.focusCount,1);
  }
  assert.equal(f.close.focusCount,2);
});

test('modified link clicks and browsers without dialog support keep the direct MP4 fallback', () => {
  const f=fixture();
  for (const extra of [{ctrlKey:true},{metaKey:true},{shiftKey:true},{altKey:true},{button:1}]) assert.equal(f.click(f.links[0],extra).prevented,false);
  assert.equal(f.dialog.showCount,0);assert.equal(f.player.loads,0);
  const unsupported=fixture({supported:false});
  assert.equal(unsupported.click(unsupported.links[0]).prevented,false);
  assert.equal(unsupported.player.loads,0);
});

test('backdrop dismissal, native close/Escape and navigation stop and unload media', () => {
  const f=fixture();f.click(f.links[0]);
  f.dialog.fire('click',{target:f.dialog,clientX:200,clientY:200});assert.equal(f.dialog.open,true);
  f.dialog.fire('click',{target:f.dialog,clientX:50,clientY:200});assert.equal(f.dialog.open,false);assert.equal(f.player.src,undefined);
  f.click(f.links[1]);f.dialog.close();assert.equal(f.player.src,undefined);assert.equal(f.links[1].focusCount,1);
  f.click(f.links[0]);f.windowHandlers.pagehide();assert.equal(f.dialog.open,false);assert.equal(f.player.src,undefined);
  const pauses=f.player.pauses;f.windowHandlers.pagehide();assert.equal(f.player.pauses,pauses+1);
});
