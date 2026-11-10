/** Palette-only transformation of read-only Resend snapshots. Never sends or publishes. */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createHash } from 'node:crypto';
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
export const folder = path.join(root, 'docs/email-templates/20261110-violet-ash');
export const palette = Object.freeze({
 '#05060A':'#24232C', '#0D111B':'#3B3948', '#0A0D14':'#24232C',
 '#121826':'#3B3948', '#101725':'#24232C', '#080A10':'#24232C',
 '#7AA7FF':'#EDAC9E', '#9BB9FF':'#C8B7DC', '#F5F7FF':'#F6EEDF',
 '#E8ECF7':'#F6EEDF', '#C3CEE1':'#C7C2D1', '#B7C2D9':'#C7C2D1',
 '#A5B0C6':'#C7C2D1', '#AFC9FF':'#C8B7DC', '#263146':'#9790AA',
 '#172238':'#F6EEDF', '#C4C4C4':'#C7C2D1'
});
export function theme(html) {
 // Only touch inline style / bgcolor attributes and style sheets, never text or URLs.
 const replace = s => s.replace(/#[\da-f]{6}\b/gi, c => {
   const replacement = palette[c.toUpperCase()];
   if (!replacement) throw new Error(`Unmapped color ${c}`);
   return replacement;
 });
 return html.replace(/<style\b[^>]*>[\s\S]*?<\/style>|\b(?:style|bgcolor)="[^"]*"/gi, replace)
   // Primary CTA ink has its own token, while hidden preheaders retain canvas ink.
   .replace(/<a\b[^>]*>/gi, tag => tag.replace(/color:#24232C/g, 'color:#2E2429'));
}
export const hash = s => createHash('sha256').update(s).digest('hex');
export function generate(check = false) {
 const manifest = [];
 for (const file of fs.readdirSync(path.join(folder,'source')).sort()) {
  const source = JSON.parse(fs.readFileSync(path.join(folder,'source',file),'utf8'));
  const html = source.parts.find(p=>p.startsWith('HTML:\n'))?.slice(6);
  if (!html) throw new Error(`Missing HTML ${file}`);
  const result = theme(html);
  const text = source.parts.find(p=>p.startsWith('Text:\n'))?.slice(6);
  const outputs = {[`${source.alias}.html`]: result};
  if (text !== undefined) outputs[`${source.alias}.txt`] = text;
  for (const [name,content] of Object.entries(outputs)) {
   const target = path.join(folder,name);
   if(check) {if(fs.readFileSync(target,'utf8')!==content) throw new Error(`Stale ${name}`);}
   else fs.writeFileSync(target,content);
  }
  manifest.push({alias:source.alias,id:source.id,retrieved_at:source.retrieved_at,source_html_sha256:hash(html),html_sha256:hash(result),text_sha256:text===undefined?null:hash(text),status:'review-only; not published'});
 }
 const json = JSON.stringify(manifest,null,2)+'\n';
 if(check) {if(fs.readFileSync(path.join(folder,'manifest.json'),'utf8')!==json) throw new Error('Stale manifest');}
 else fs.writeFileSync(path.join(folder,'manifest.json'),json);
 return manifest;
}
if(process.argv[1]===fileURLToPath(import.meta.url)) console.log(`Validated ${generate(process.argv.includes('--check')).length} Violet Ash mailers`);
