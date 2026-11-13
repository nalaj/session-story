#!/usr/bin/env node
/**
 * Builds the GitHub Pages site into `_site/` (or the directory given as the
 * first argument): the static start page from `site/`, plus a live example
 * library rendered from the synthetic demo session with the skill's own CLI.
 * Also refreshes `examples/story.html`, the standalone example in the repo.
 */
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { renderDemo } from './demo-session.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const bin = path.join(root, 'cli', 'bin', 'story.mjs');
const outDir = path.resolve(process.argv[2] ?? path.join(root, '_site'));

await fs.rm(outDir, { recursive: true, force: true });
await fs.cp(path.join(root, 'site'), outDir, { recursive: true });
await renderDemo({ bin, library: path.join(outDir, 'example') });
await fs.writeFile(path.join(outDir, '.nojekyll'), '');

await fs.mkdir(path.join(root, 'examples'), { recursive: true });
await renderDemo({ bin, out: path.join(root, 'examples', 'story.html') });

console.log(`site → ${path.relative(root, outDir) || '.'}`);
