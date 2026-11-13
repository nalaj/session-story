#!/usr/bin/env node
/**
 * Proves both shipped pieces work on their own:
 *
 * 1. The plugin payload `session-story/` (what `npx skills add` and
 *    `/plugin install` copy) holds only file types the Claude Code plugin
 *    directory accepts from unverified publishers: Markdown, text, JSON,
 *    YAML and images, none starting with `#!`. Its SKILL.md pins the CLI
 *    version it runs through `npx`.
 * 2. The npm package `cli/`, packed with `npm pack` and unpacked to a temp
 *    dir, runs the full extract → validate → render flow on the demo session.
 */
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { renderDemo } from './demo-session.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const payload = path.join(root, 'session-story');
const cli = path.join(root, 'cli');

// --- 1. plugin payload ------------------------------------------------------
const ALLOWED = new Set(['.md', '.txt', '.json', '.yaml', '.yml', '.png', '.jpg', '.jpeg', '.gif', '.webp', '.ico']);
const ALLOWED_NAMES = new Set(['LICENSE']);
async function walk(dir) {
  const out = [];
  for (const entry of await fs.readdir(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) out.push(...(await walk(full)));
    else out.push(full);
  }
  return out;
}
for (const file of await walk(payload)) {
  const rel = path.relative(payload, file);
  const base = path.basename(file);
  if (base === '.DS_Store') continue; // gitignored, never committed
  if (!ALLOWED.has(path.extname(base).toLowerCase()) && !ALLOWED_NAMES.has(base)) {
    throw new Error(`plugin payload must hold only Markdown, text, JSON, YAML or images: ${rel}`);
  }
  const head = await fs.readFile(file);
  if (head.subarray(0, 2).toString() === '#!') throw new Error(`plugin payload file starts with #!: ${rel}`);
}
for (const forbidden of ['bin', 'src', 'package.json', 'test', 'node_modules']) {
  if (await fs.stat(path.join(payload, forbidden)).catch(() => null)) {
    throw new Error(`plugin payload must not ship ${forbidden}`);
  }
}
const pluginFiles = await fs.readdir(path.join(payload, '.claude-plugin'));
for (const f of pluginFiles) {
  if (f !== 'plugin.json' && !/\.(png|jpe?g|gif|webp|ico)$/i.test(f)) {
    throw new Error(`.claude-plugin/ may hold only plugin.json and images: ${f}`);
  }
}

const skill = await fs.readFile(path.join(payload, 'SKILL.md'), 'utf8');
const pkg = JSON.parse(await fs.readFile(path.join(cli, 'package.json'), 'utf8'));
const pluginJson = JSON.parse(await fs.readFile(path.join(payload, '.claude-plugin', 'plugin.json'), 'utf8'));
const skillVersion = skill.match(/^\s+version:\s*"([^"]+)"/m)?.[1];
if (!/^name: session-story$/m.test(skill)) throw new Error('SKILL.md name must be session-story');
if (skillVersion !== pkg.version) throw new Error(`SKILL.md version ${skillVersion} != cli/package.json ${pkg.version}`);
if (pluginJson.version !== pkg.version) throw new Error(`plugin.json version ${pluginJson.version} != cli/package.json ${pkg.version}`);
const pins = [...skill.matchAll(/npx -y session-story@([^\s`]+)/g)].map((m) => m[1]);
if (!pins.length) throw new Error('SKILL.md must run the CLI with npx -y session-story@<version>');
for (const pin of pins) {
  if (pin !== pkg.version) throw new Error(`SKILL.md pins session-story@${pin}, cli/package.json is ${pkg.version}`);
}
if (/<skill-dir>|bin\/story\.mjs/.test(skill)) throw new Error('SKILL.md must not run code from the skill folder');

const marketplace = JSON.parse(await fs.readFile(path.join(root, '.claude-plugin', 'marketplace.json'), 'utf8'));
const plugin = marketplace.plugins.find((p) => p.name === 'session-story');
if (plugin?.source !== './session-story') throw new Error('marketplace.json must list session-story with source ./session-story');
if (plugin.version !== pkg.version) throw new Error(`marketplace.json version ${plugin.version} != cli/package.json ${pkg.version}`);

// --- 2. npm package -----------------------------------------------------------
const tmp = await fs.mkdtemp(path.join(os.tmpdir(), 'session-story-smoke-'));
const npm = process.platform === 'win32' ? 'npm.cmd' : 'npm';
const tarball = execFileSync(npm, ['pack', '--silent', '--pack-destination', tmp], {
  cwd: cli,
  encoding: 'utf8',
  shell: process.platform === 'win32',
}).trim().split(/\r?\n/).pop();
execFileSync('tar', ['-xzf', path.join(tmp, tarball), '-C', tmp]);
const installed = path.join(tmp, 'package');
for (const required of ['LICENSE', 'package.json', 'bin/story.mjs', 'src/render/template.mjs']) {
  await fs.access(path.join(installed, required));
}

const out = path.join(tmp, 'story.html');
await renderDemo({ bin: path.join(installed, 'bin', 'story.mjs'), out });
const html = await fs.readFile(out, 'utf8');
if (!html.includes('Due dates for todos')) throw new Error('rendered page is missing the demo title');
if (/<script[^>]+src="https?:/i.test(html) || /<link[^>]+href="https?:/i.test(html)) {
  throw new Error('rendered page must not load remote resources');
}

console.log(`ok — plugin payload is docs-only; npm package v${pkg.version} rendered ${path.basename(out)} (${(html.length / 1024).toFixed(0)} KB)`);
await fs.rm(tmp, { recursive: true, force: true });
