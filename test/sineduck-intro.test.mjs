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
const serviceWorkerJs = readFileSync(join(root, "service-worker.js"), "utf8");

const completedCopy = html
  .match(/<p class="discover-sineduck__final-copy">([\s\S]*?)<\/p>/)?.[1]
  ?.replace(/<[^>]+>/g, " ")
  .replace(/\s+/g, " ")
  .trim();

test("SineDuck Discover speech stays connected while the wave keeps its current speed", () => {
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

  assert.equal(
    completedCopy,
    "Hello, I’m SineDuck. I’m here to help you notice the wave already moving through your days. Some moments rise, while others soften and carry you inward. That movement is why SineDay says: Alignment Creates Lift. But lift doesn’t mean staying at the top of the wave. It begins with seeing the natural flow already moving within you. SineDay doesn’t create that flow — it gives you a perspective for noticing what is already yours. When you can meet the movement as it is, you don’t have to fight every high or low. You can experience the moment with more awareness — and that awareness is lift. Highs or lows, I’m always here — offering a perspective free of judgment.",
  );

  assert.match(html, /class="discover-sineduck__stars" aria-hidden="true"/);
  assert.match(css, /@keyframes discoverSineDuckStarsMid/);
  assert.match(css, /@keyframes discoverSineDuckStarsAccent/);
  assert.match(css, /opacity 900ms cubic-bezier\(0\.22, 0\.61, 0\.36, 1\)/);
  assert.match(css, /transform: translateY\(2px\)/);
  assert.match(animationJs, /HELLO_START: 1600/);
  assert.match(animationJs, /WAVE_COPY_START: 4100/);
  assert.match(animationJs, /MOVEMENT_START: 6800/);
  assert.match(animationJs, /COMPANION_START: 26300/);
  assert.match(animationJs, /RIDE_START: 2800/);
  assert.match(animationJs, /RIDE_END: 27600/);
  assert.match(animationJs, /COMPLETE_AT: 29400/);
  assert.match(animationJs, /WAVE_PHASE_SPEED = \(Math\.PI \* 3\) \/ 12000/);
  assert.match(animationJs, /rideElapsed \* WAVE_PHASE_SPEED/);
  assert.doesNotMatch(animationJs, /RIDE_PHASE_SPAN/);
  assert.doesNotMatch(animationJs, /rideProgress \* /);

  assert.match(serviceWorkerJs, /CACHE_NAME = 'sineday-v15'/);
  assert.match(serviceWorkerJs, /\/assets\/sineducks\/SineDuck15@3x\.png/);
  assert.doesNotMatch(serviceWorkerJs, /SineDuck14@3x\.png/);
  assert.match(serviceWorkerJs, /\/js\/sineduck-intro-animation\.js/);
});
