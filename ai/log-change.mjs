#!/usr/bin/env node

/**
 * AI Changelog Helper Script
 * Usage: node ai/log-change.mjs --files "file1,file2" --summary "..." --rationale "..." [--notes "..."]
 */

import { readFileSync, appendFileSync, writeFileSync } from 'fs';
import { resolve } from 'path';

const args = process.argv.slice(2);

function getArg(name) {
  const index = args.indexOf(name);
  return index !== -1 && index + 1 < args.length ? args[index + 1] : null;
}

const files = getArg('--files');
const summary = getArg('--summary');
const rationale = getArg('--rationale');
const notes = getArg('--notes') || '';

if (!files || !summary || !rationale) {
  console.error('Usage: node ai/log-change.mjs --files "file1,file2" --summary "..." --rationale "..." [--notes "..."]');
  process.exit(1);
}

const timestamp = new Date().toISOString();
const filesArray = files.split(',').map(f => f.trim());

// Create JSONL entry
const jsonlEntry = JSON.stringify({
  timestamp,
  files: filesArray,
  summary,
  rationale,
  notes: notes || undefined
});

// Create markdown entry
const mdEntry = `
## ${timestamp}

**Files:** ${filesArray.join(', ')}

**Summary:** ${summary}

**Rationale:** ${rationale}

${notes ? `**Notes:** ${notes}\n` : ''}
---
`;

// Append to JSONL
const jsonlPath = resolve('ai/ai_changelog.jsonl');
try {
  appendFileSync(jsonlPath, jsonlEntry + '\n', 'utf8');
} catch (err) {
  // File doesn't exist, create it
  writeFileSync(jsonlPath, jsonlEntry + '\n', 'utf8');
}

// Append to markdown
const mdPath = resolve('AI_CHANGELOG.md');
try {
  const existing = readFileSync(mdPath, 'utf8');
  writeFileSync(mdPath, existing + mdEntry, 'utf8');
} catch (err) {
  // File doesn't exist, create it with header
  const header = `# AI Changelog

This file tracks all changes made by AI during development.

---
`;
  writeFileSync(mdPath, header + mdEntry, 'utf8');
}

console.log('✓ Changelog updated successfully');
