import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const html = readFileSync(join(root, "index.html"), "utf8");
const css = readFileSync(join(root, "styles.css"), "utf8");
const animationJs = readFileSync(
  join(root, "js/sineduck-intro-animation.js"),
  "utf8",
);
const uiJs = readFileSync(join(root, "js/ui.js"), "utf8");
const serviceWorkerJs = readFileSync(join(root, "service-worker.js"), "utf8");

test("SineDuck Discover keeps the paced show and its composed final frame", () => {
  assert.match(
    html,
    /src="\/assets\/sineducks\/SineDuck15@3x\.png"\s+width="174"\s+height="88"/,
  );
  assert.doesNotMatch(html, /SineDuck14@3x\.png/);

  for (const [phase, phrase] of [
    ["hello", "Hello, I’m SineDuck."],
    [
      "wave",
      "I’m here to help you notice the wave already moving through your days.",
    ],
    [
      "movement",
      "Some moments rise, while others soften and carry you inward.",
    ],
    [
      "alignment",
      "That movement is why SineDay says: Alignment Creates Lift.",
    ],
    ["not-top", "But lift doesn’t mean staying at the top of the wave."],
    [
      "within",
      "It begins with seeing the natural flow already moving within you.",
    ],
    [
      "perspective",
      "SineDay doesn’t create that flow — it gives you a perspective for noticing what is already yours.",
    ],
    [
      "meeting",
      "When you can meet the movement as it is, you don’t have to fight every high or low.",
    ],
    [
      "awareness",
      "You can experience the moment with more awareness — and that awareness is lift.",
    ],
    [
      "companion",
      "Highs or lows, I’m always here — offering a perspective free of judgment.",
    ],
  ]) {
    assert.match(html, new RegExp(`data-sineduck-phrase="${phase}"`));
    assert.ok(html.includes(phrase));
    assert.match(css, new RegExp(`data-sineduck-phase="${phase}"`));
  }

  assert.doesNotMatch(html, /discover-sineduck__final-copy/);
  assert.doesNotMatch(css, /discover-sineduck__final-copy/);
  assert.match(
    html,
    /class="discover-sineduck__fallback">Highs or lows, I’m always here — offering a perspective free of judgment\.<\/p>/,
  );
  assert.match(
    html,
    /class="sr-only">SineDuck rides the changing wave as a reminder to notice your natural flow without judging the highs or lows\.<\/p>/,
  );

  assert.match(html, /class="discover-sineduck__stars" aria-hidden="true"/);
  assert.match(css, /@keyframes discoverSineDuckStarsMid/);
  assert.match(css, /@keyframes discoverSineDuckStarsAccent/);
  assert.match(css, /opacity 900ms cubic-bezier\(0\.22, 0\.61, 0\.36, 1\)/);
  assert.match(css, /transform: translateY\(2px\)/);
  assert.match(animationJs, /HELLO_START: 1600/);
  assert.match(animationJs, /WAVE_COPY_START: 7200/);
  assert.match(animationJs, /MOVEMENT_START: 13200/);
  assert.match(animationJs, /ALIGNMENT_START: 19200/);
  assert.match(animationJs, /NOT_TOP_START: 25200/);
  assert.match(animationJs, /WITHIN_START: 31200/);
  assert.match(animationJs, /PERSPECTIVE_START: 37400/);
  assert.match(animationJs, /MEETING_START: 43800/);
  assert.match(animationJs, /AWARENESS_START: 50200/);
  assert.match(animationJs, /COMPANION_START: 56600/);
  assert.match(animationJs, /RIDE_START: 2800/);
  assert.match(animationJs, /RIDE_END: 59200/);
  assert.match(animationJs, /COMPLETE_AT: 62000/);
  assert.match(animationJs, /WAVE_PHASE_SPEED = \(Math\.PI \* 3\) \/ 12000/);
  assert.match(animationJs, /rideElapsed \* WAVE_PHASE_SPEED/);
  assert.doesNotMatch(animationJs, /RIDE_PHASE_SPAN/);
  assert.doesNotMatch(animationJs, /rideProgress \* /);
  assert.match(
    animationJs,
    /complete\(\) \{[\s\S]*this\.root\.classList\.add\('is-sineduck-complete'\);[\s\S]*this\.setPhase\('companion'\);[\s\S]*\}/,
  );
  assert.match(
    animationJs,
    /showStatic\(\) \{[\s\S]*classList\.add\('is-sineduck-complete', 'is-sineduck-static'\);[\s\S]*this\.setPhase\('companion'\);[\s\S]*\}/,
  );
  assert.doesNotMatch(animationJs, /setPhase\('complete'\)/);
  assert.match(
    css,
    /\.is-sineduck-complete:not\(\.is-sineduck-static\)[\s\S]*discoverSineDuckIdle/,
  );
  assert.match(
    uiJs,
    /new SineDuckIntroAnimation\(\s*this\.elements\.discoverSineDuckSlide\s*\)/,
  );
  assert.match(uiJs, /setFocusProgress\(sineDuckProgress\)/);

  assert.match(serviceWorkerJs, /CACHE_NAME = 'sineday-v18'/);
  assert.match(serviceWorkerJs, /\/assets\/sineducks\/SineDuck15@3x\.png/);
  assert.doesNotMatch(serviceWorkerJs, /SineDuck14@3x\.png/);
  assert.match(serviceWorkerJs, /'\/styles\.css'/);
  assert.match(serviceWorkerJs, /'\/js\/ui\.js'/);
  assert.match(serviceWorkerJs, /\/js\/sineduck-intro-animation\.js/);
});