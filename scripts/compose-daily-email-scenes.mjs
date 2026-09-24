import { createHash } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import sharp from "sharp";
import { duckPlacementOnDayArtwork } from "../js/sineducks.js";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const OUTPUT_DIR = join(ROOT, "assets/email/20260924/scenes");
const MANIFEST_PATH = join(ROOT, "docs/email-templates/20260924/asset-manifest.json");
const SCENE_SIZE = 752;
const DUCK_WIDTH = 555;
const DUCK_HEIGHT = 312;
const DUCK_LEFT = 99;
const DUCK_TOP = Object.freeze({ top: 84, bottom: 356 });

function sha256(bytes) {
  return createHash("sha256").update(bytes).digest("hex");
}

function requireHash(bytes, expected, label) {
  const actual = sha256(bytes);
  if (actual !== expected) {
    throw new Error(`${label} hash mismatch: expected ${expected}, received ${actual}`);
  }
  return actual;
}

async function readJson(path) {
  return JSON.parse(await readFile(path, "utf8"));
}

export async function composeDailyEmailScenes() {
  const natureManifest = await readJson(
    join(ROOT, "docs/art-direction/day-background-assets.json"),
  );
  const finaleManifest = await readJson(
    join(ROOT, "docs/email-templates/20260923/asset-manifest.json"),
  );
  const finaleByDay = new Map(
    finaleManifest.assets
      .filter((asset) => /SineDuckFinale\d+\.png$/.test(asset.file))
      .map((asset) => [Number(asset.file.match(/Finale(\d+)\.png$/)[1]), asset]),
  );

  if (natureManifest.length !== 18 || finaleByDay.size !== 18) {
    throw new Error("Canonical manifests must contain exactly 18 numbered sources");
  }

  await mkdir(OUTPUT_DIR, { recursive: true });
  await mkdir(dirname(MANIFEST_PATH), { recursive: true });
  const assets = [];

  for (let day = 1; day <= 18; day += 1) {
    const nature = natureManifest.find((asset) => asset.day === day);
    const finale = finaleByDay.get(day);
    if (!nature || !finale) throw new Error(`Missing canonical source for Day ${day}`);

    const natureBytes = await readFile(join(ROOT, nature.file));
    const finaleBytes = await readFile(join(ROOT, finale.file));
    const natureSha256 = requireHash(natureBytes, nature.sha256, `Day ${day} nature`);
    const finaleSha256 = requireHash(finaleBytes, finale.sha256, `Day ${day} Finale`);
    const placement = duckPlacementOnDayArtwork(day);
    const top = DUCK_TOP[placement];
    if (!Number.isInteger(top)) throw new Error(`Invalid Day ${day} placement: ${placement}`);

    const background = await sharp(natureBytes)
      .resize(SCENE_SIZE, SCENE_SIZE, { fit: "fill" })
      .png()
      .toBuffer();
    const duck = await sharp(finaleBytes)
      .resize(DUCK_WIDTH, DUCK_HEIGHT, {
        fit: "contain",
        background: { r: 0, g: 0, b: 0, alpha: 0 },
      })
      .png()
      .toBuffer();
    const output = await sharp(background)
      .composite([{ input: duck, left: DUCK_LEFT, top }])
      .png({ compressionLevel: 9, adaptiveFiltering: true })
      .toBuffer();
    const metadata = await sharp(output).metadata();
    if (metadata.width !== SCENE_SIZE || metadata.height !== SCENE_SIZE) {
      throw new Error(`Day ${day} output dimensions are not ${SCENE_SIZE}x${SCENE_SIZE}`);
    }

    const relativeFile = `assets/email/20260924/scenes/SineDayScene${day}.png`;
    await writeFile(join(ROOT, relativeFile), output);
    assets.push({
      day,
      file: relativeFile,
      production_url: `https://sineday.app/${relativeFile}`,
      width: SCENE_SIZE,
      height: SCENE_SIZE,
      bytes: output.length,
      sha256: sha256(output),
      nature_source: nature.file,
      nature_sha256: natureSha256,
      finale_source: finale.file,
      finale_sha256: finaleSha256,
      placement,
      composite: {
        left: DUCK_LEFT,
        top,
        width: DUCK_WIDTH,
        height: DUCK_HEIGHT,
      },
    });
  }

  const manifest = {
    renderer: `sharp ${sharp.versions.sharp}`,
    geometry: {
      scene: `${SCENE_SIZE}x${SCENE_SIZE}`,
      duck: `${DUCK_WIDTH}x${DUCK_HEIGHT}`,
      left: DUCK_LEFT,
      top: DUCK_TOP.top,
      bottom_top: DUCK_TOP.bottom,
    },
    assets,
  };
  await writeFile(MANIFEST_PATH, `${JSON.stringify(manifest, null, 2)}\n`);
  return manifest;
}

if (import.meta.url === new URL(process.argv[1], "file:").href) {
  const manifest = await composeDailyEmailScenes();
  console.log(`Composed ${manifest.assets.length} deterministic daily email scenes.`);
}
