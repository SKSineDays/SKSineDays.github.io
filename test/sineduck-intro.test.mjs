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

test("SineDuck Discover refinement keeps its copy, timeline, stars, and PWA contract", () => {
  assert.match(
    html,
    /src="\/assets\/sineducks\/SineDuck15@3x\.png"\s+width="174"\s+height="88"/,
  );
  assert.doesNotMatch(html, /SineDuck14@3x\.png/);

  for (const [phase, phrase] of [
    ["hello", "Hello, I’m SineDuck."],
    ["wave", "I’m here to show you the wave."],
    ["rhythm", "Some moments rise. Some moments soften."],
    ["alignment", "Alignment Creates Lift."],
    ["not-top", "Lift doesn’t mean staying at the top of the wave."],
    ["within", "It means seeing the natural flow already moving within you."],
    [
      "yours",
      "SineDay doesn’t create that flow. If it’s there, it’s yours to notice.",
    ],
    [
      "experience",
      "When you can experience the movement as it is, you can meet the moment instead of fighting it.",
    ],
    ["lift", "That awareness is lift."],
    [
      "perspective",
      "Highs or lows, I’m always here — offering a perspective free of judgment.",
    ],
  ]) {
    assert.match(html, new RegExp(`data-sineduck-phrase="${phase}"`));
    assert.ok(html.includes(phrase));
    assert.match(css, new RegExp(`data-sineduck-phase="${phase}"`));
  }

  assert.equal(
    completedCopy,
    "Hello, I’m SineDuck. I’m here to show you the wave. Some moments rise and some moments soften. Alignment Creates Lift — but lift doesn’t mean staying at the top of the wave. It means seeing the natural flow already moving within you. SineDay doesn’t create that flow. If it’s there, it’s yours to notice. When you can experience the movement as it is, you can meet the moment instead of fighting it. That awareness is lift. Highs or lows, I’m always here — offering a perspective free of judgment.",
  );

  assert.match(html, /class="discover-sineduck__stars" aria-hidden="true"/);
  assert.match(css, /@keyframes discoverSineDuckStarsMid/);
  assert.match(css, /@keyframes discoverSineDuckStarsAccent/);
  assert.match(animationJs, /RIDE_START: 2800/);
  assert.match(animationJs, /RIDE_END: 14800/);
  assert.match(animationJs, /COMPLETE_AT: 18400/);
  assert.match(animationJs, /RIDE_PHASE_SPAN = Math\.PI \* 3/);

  assert.match(serviceWorkerJs, /CACHE_NAME = 'sineday-v15'/);
  assert.match(serviceWorkerJs, /\/assets\/sineducks\/SineDuck15@3x\.png/);
  assert.doesNotMatch(serviceWorkerJs, /SineDuck14@3x\.png/);
  assert.match(serviceWorkerJs, /\/js\/sineduck-intro-animation\.js/);
});
