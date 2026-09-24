/** Rasterize approved SVGs without cropping, compositing, or changing their artwork.
 * Run with sharp available locally, or pass its module path as the first argument.
 */
import { createRequire } from 'node:module';
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { createHash } from 'node:crypto';
const sharp = createRequire(import.meta.url)(process.argv[2] || 'sharp');
const output = 'assets/email/20260923/sineducks';
const sourceDirectory = 'docs/email-templates/20260923';
await mkdir(output, { recursive: true });
await mkdir(sourceDirectory, { recursive: true });
const hash = bytes => createHash('sha256').update(bytes).digest('hex');
const manifest = [];
for (const mark of [...Array.from({ length: 18 }, (_, i) => `Finale${i + 1}`), ' Celebrity']) {
  const source = `assets/sineducks/SineDuck${mark}.svg`;
  const svg = await readFile(source);
  if (!svg.toString().includes('viewBox="0 0 1920 1080"')) throw new Error(`Unexpected geometry: ${source}`);
  const file = `${output}/SineDuck${mark.trim().replace(' ', '')}.png`;
  const png = await sharp(svg).resize(1920, 1080, { fit: 'contain' }).png().toBuffer();
  await writeFile(file, png);
  manifest.push({ source, source_sha256: hash(svg), file, production_url: `https://sineday.app/${file}`, width: 1920, height: 1080, bytes: png.length, sha256: hash(png) });
}
await writeFile(`${sourceDirectory}/asset-manifest.json`, JSON.stringify({ renderer: `sharp ${sharp.versions.sharp} / librsvg ${sharp.versions.rsvg}`, assets: manifest }, null, 2) + '\n');
console.log(`Rasterized ${manifest.length} official marks at 1920 × 1080.`);
