/**
 * Build the customer-facing affiliate share kit from the canonical local brand
 * assets. No remote files, photo generation, or affiliate/account data is used.
 *
 * node scripts/generate-affiliate-assets.mjs
 * node scripts/generate-affiliate-assets.mjs --check
 *
 * --check validates the committed kit without rewriting it. Regeneration uses
 * sharp (already a dev dependency) and the renderer's installed sans-serif font.
 */
import assert from "node:assert/strict";
import { readFile, writeFile } from "node:fs/promises";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";

const require = createRequire(import.meta.url);
const sharp = require("sharp");
const root = new URL("../", import.meta.url);
const output = new URL("assets/affiliate/", root);
const brand = await readFile(new URL("assets/brand/sineday-wordmark-light.png", root));
const duck = await readFile(new URL("assets/sineducks/SineDuck8.svg", root));
const wordmarkData = `data:image/png;base64,${brand.toString("base64")}`;
const duckData = `data:image/svg+xml;base64,${duck.toString("base64")}`;
const colors = {
  canvas: "#24232C", card: "#3B3948", text: "#F6EEDF", muted: "#C7C2D1",
  action: "#EDAC9E", detail: "#C8B7DC", ink: "#332D3B", rule: "#D8CED5",
};

const assets = [
  {
    id: "affiliate-square", title: "Square post", format: "PNG",
    dimensions: "1080 × 1080", width: 1080, height: 1080,
    path: "/assets/affiliate/sineday-affiliate-square.png", placement: "Feed posts",
    usage: "Pair with your full post so your affiliate link and disclosure stay together.",
    altText: "SineDay: Your day, in your words. A journal built around an 18-day personal wave. SineDuck appears on an ivory journal card. Explore SineDay with my link. Affiliate link: I may earn a commission.",
  },
  {
    id: "affiliate-story", title: "Story", format: "PNG",
    dimensions: "1080 × 1920", width: 1080, height: 1920,
    path: "/assets/affiliate/sineday-affiliate-story.png", placement: "Stories · 9:16",
    usage: "Add your affiliate link using the platform's link sticker. Keep the disclosure visible.",
    altText: "SineDay: Your day, in your words. A journal built around an 18-day personal wave. SineDuck appears on an ivory journal card. Explore SineDay. Affiliate link: I may earn a commission.",
  },
  {
    id: "affiliate-landscape", title: "Landscape post", format: "PNG",
    dimensions: "1200 × 628", width: 1200, height: 628,
    path: "/assets/affiliate/sineday-affiliate-landscape.png", placement: "Wide posts · Email",
    usage: "Use in a wide post or email alongside your affiliate link and clear disclosure.",
    altText: "SineDay: Your day, in your words. A journal built around an 18-day personal wave. SineDuck appears on an ivory journal card. Explore SineDay with my link. Affiliate link: I may earn a commission.",
  },
  {
    id: "affiliate-wordmark", title: "Affiliate wordmark", format: "SVG",
    dimensions: "700 × 240", width: 700, height: 240,
    path: "/assets/affiliate/sineday-affiliate-wordmark.svg", placement: "Brand asset",
    usage: "Use at its original proportions with a clear affiliate disclosure. The file works offline.",
    altText: "SineDay Affiliate wordmark on a Violet Ash background",
  },
];

function text(x, y, value, size, { fill = colors.text, weight = 400, tracking = 0 } = {}) {
  return `<text x="${x}" y="${y}" fill="${fill}" font-size="${size}" font-weight="${weight}" letter-spacing="${tracking}">${value}</text>`;
}

function image(href, x, y, width, height) {
  return `<image href="${href}" x="${x}" y="${y}" width="${width}" height="${height}" preserveAspectRatio="xMidYMid meet"/>`;
}

function frame(width, height, body) {
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}">
    <rect width="${width}" height="${height}" fill="${colors.canvas}"/>
    <g font-family="Arial, Helvetica, sans-serif">${body}</g>
  </svg>`;
}

function journalCard(x, y, width, height, { compact = false } = {}) {
  const padding = compact ? 26 : 36;
  const artWidth = compact ? width - 72 : Math.min(width - 120, 470);
  const artHeight = artWidth / 2;
  const artY = y + (compact ? 70 : 68);
  return `<rect x="${x}" y="${y}" width="${width}" height="${height}" rx="24" fill="${colors.text}"/>
    ${text(x + padding, y + (compact ? 38 : 43), "A MOMENT TO NOTICE", compact ? 14 : 17, { fill: colors.ink, weight: 700, tracking: 3 })}
    ${image(duckData, x + (width - artWidth) / 2, artY, artWidth, artHeight)}
    ${text(x + padding, y + height - (compact ? 67 : 70), "What do you want to remember?", compact ? 18 : 23, { fill: colors.ink })}
    <path d="M ${x + padding} ${y + height - 41} H ${x + width - padding}" stroke="${colors.rule}" stroke-width="2"/>`;
}

function square() {
  return frame(1080, 1080, `
    ${image(wordmarkData, 72, 46, 340, 340 * 190 / 700)}
    ${text(76, 190, "A SPACE FOR DAILY REFLECTION", 19, { fill: colors.detail, weight: 700, tracking: 3 })}
    ${text(72, 286, "Your day,", 86, { weight: 700, tracking: -3 })}
    ${text(72, 380, "in your words.", 86, { weight: 700, tracking: -3 })}
    ${text(76, 439, "A journal built around an 18-day personal wave.", 29, { fill: colors.muted })}
    ${journalCard(76, 488, 928, 394)}
    ${text(76, 946, "Explore SineDay with my link.", 30, { fill: colors.action, weight: 700 })}
    ${text(76, 1005, "Affiliate link: I may earn a commission.", 23, { fill: colors.muted })}
  `);
}

function story() {
  return frame(1080, 1920, `
    ${image(wordmarkData, 80, 174, 390, 390 * 190 / 700)}
    ${text(84, 353, "A SPACE FOR DAILY REFLECTION", 21, { fill: colors.detail, weight: 700, tracking: 3 })}
    ${text(80, 470, "Your day,", 104, { weight: 700, tracking: -4 })}
    ${text(80, 586, "in your words.", 104, { weight: 700, tracking: -4 })}
    ${text(84, 674, "A journal built around an", 38, { fill: colors.muted })}
    ${text(84, 727, "18-day personal wave.", 38, { fill: colors.muted })}
    ${journalCard(80, 813, 920, 408)}
    ${text(84, 1300, "Explore SineDay", 40, { fill: colors.action, weight: 700 })}
    <path d="M 84 1345 H 996" stroke="${colors.card}" stroke-width="2"/>
    ${text(84, 1610, "Affiliate link: I may earn a commission.", 27, { fill: colors.muted })}
  `);
}

function landscape() {
  return frame(1200, 628, `
    ${image(wordmarkData, 56, 36, 290, 290 * 190 / 700)}
    ${text(60, 155, "A SPACE FOR DAILY REFLECTION", 15, { fill: colors.detail, weight: 700, tracking: 2 })}
    ${text(56, 240, "Your day,", 67, { weight: 700, tracking: -2 })}
    ${text(56, 314, "in your words.", 67, { weight: 700, tracking: -2 })}
    ${text(60, 369, "A journal built around an", 26, { fill: colors.muted })}
    ${text(60, 408, "18-day personal wave.", 26, { fill: colors.muted })}
    ${journalCard(738, 122, 406, 350, { compact: true })}
    ${text(60, 494, "Explore SineDay with my link.", 27, { fill: colors.action, weight: 700 })}
    <path d="M 60 534 H 1144" stroke="${colors.card}" stroke-width="2"/>
    ${text(60, 579, "Affiliate link: I may earn a commission.", 22, { fill: colors.muted })}
  `);
}

const wordmark = `<svg xmlns="http://www.w3.org/2000/svg" width="700" height="240" viewBox="0 0 700 240" role="img" aria-labelledby="title desc">
  <title id="title">SineDay Affiliate</title>
  <desc id="desc">The approved SineDay wordmark with an Affiliate label.</desc>
  <rect width="700" height="240" rx="24" fill="${colors.canvas}"/>
  ${image(wordmarkData, 35, 26, 630, 171)}
  <text x="350" y="220" fill="${colors.action}" font-family="Arial, Helvetica, sans-serif" font-size="22" font-weight="700" letter-spacing="8" text-anchor="middle">AFFILIATE</text>
</svg>
`;

if (!process.argv.includes("--check")) {
  const renders = [square(), story(), landscape()];
  for (let index = 0; index < renders.length; index += 1) {
    const asset = assets[index];
    await sharp(Buffer.from(renders[index])).png({ compressionLevel: 9 }).toFile(
      fileURLToPath(new URL(asset.path.slice("/assets/affiliate/".length), output)),
    );
  }
  await writeFile(new URL("sineday-affiliate-wordmark.svg", output), wordmark);
  await writeFile(new URL("assets.json", output), `${JSON.stringify(assets, null, 2)}\n`);
}

const manifest = JSON.parse(await readFile(new URL("assets.json", output), "utf8"));
assert.deepEqual(manifest, assets, "Manifest must match the approved formats, copy and placement hints.");
for (const asset of manifest) {
  const file = new URL(asset.path.slice("/assets/affiliate/".length), output);
  const metadata = await sharp(await readFile(file)).metadata();
  assert.equal(metadata.width, asset.width, `${asset.id}: width`);
  assert.equal(metadata.height, asset.height, `${asset.id}: height`);
  assert.equal(metadata.format, asset.format.toLowerCase(), `${asset.id}: format`);
}
assert.equal(await readFile(new URL("sineday-affiliate-wordmark.svg", output), "utf8"), wordmark,
  "Affiliate wordmark must embed the canonical local raster and work without a network request.");
console.log("Affiliate share kit validated: 3 customer-facing PNGs and 1 self-contained wordmark.");
