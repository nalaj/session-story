#!/usr/bin/env node
/**
 * Records one loop of the start page's hero demo (`site/index.html?record`)
 * to `docs/assets/session-story-demo.mp4` and `.gif`, for the README, where
 * the live page can't run. Frames come from Chrome's screencast; ffmpeg turns
 * them into a constant-rate video.
 *
 * Needs Playwright with Chromium and ffmpeg, neither of which the repo
 * depends on:
 *   npm i --no-save playwright && npx playwright install chromium
 *   node scripts/record-demo.mjs [--theme light|dark]
 */
import { execFileSync } from 'node:child_process';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const theme = process.argv.includes('--theme') ? process.argv[process.argv.indexOf('--theme') + 1] : 'light';
const base = path.join(root, 'docs', 'assets', `session-story-demo${theme === 'dark' ? '-dark' : ''}`);

let chromium;
try {
  ({ chromium } = await import('playwright'));
} catch {
  console.error('Playwright is not installed. Run: npm i --no-save playwright && npx playwright install chromium');
  process.exit(1);
}

// Record mode pads the stage by 40px, so 1120px wide draws the 1040×640 canvas at scale 1.
const scale = 2;
const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1120, height: 720 }, deviceScaleFactor: scale, colorScheme: theme });
await page.goto(`${pathToFileURL(path.join(root, 'site', 'index.html'))}?record`);
await page.evaluate(() => document.fonts.ready);
await page.waitForTimeout(500);

const frames = [];
const cdp = await page.context().newCDPSession(page);
cdp.on('Page.screencastFrame', ({ data, metadata, sessionId }) => {
  frames.push({ data, t: metadata.timestamp });
  cdp.send('Page.screencastFrameAck', { sessionId }).catch(() => {});
});
await cdp.send('Page.startScreencast', { format: 'jpeg', quality: 92, maxWidth: 1120 * scale, maxHeight: 720 * scale });
await page.waitForTimeout(300);

const t0 = Date.now() / 1000;
const looped = page.evaluate(() => new Promise((r) => addEventListener('demo:loop', r, { once: true })));
await page.evaluate(() => window.demoStart());
await looped;
await page.waitForTimeout(700);
await cdp.send('Page.stopScreencast');
await browser.close();

// Keep the frame showing when the demo started, then everything after it.
const first = Math.max(0, frames.findIndex((f) => f.t >= t0) - 1);
const kept = frames.slice(first);
if (kept.length < 2) throw new Error(`recorded only ${kept.length} frames`);

const work = await fs.mkdtemp(path.join(os.tmpdir(), 'session-story-record-'));
const list = [];
for (const [i, f] of kept.entries()) {
  const file = path.join(work, `${String(i).padStart(5, '0')}.jpg`);
  await fs.writeFile(file, Buffer.from(f.data, 'base64'));
  const next = kept[i + 1];
  list.push(`file '${file}'`, `duration ${next ? (next.t - f.t).toFixed(4) : 0.5}`);
}
list.push(`file '${path.join(work, `${String(kept.length - 1).padStart(5, '0')}.jpg`)}'`);
const concat = path.join(work, 'frames.txt');
await fs.writeFile(concat, `${list.join('\n')}\n`);

const ffmpeg = (...args) => execFileSync('ffmpeg', ['-loglevel', 'error', '-y', '-f', 'concat', '-safe', '0', '-i', concat, ...args], { stdio: 'inherit' });
ffmpeg('-vf', 'fps=30,scale=1280:-2:flags=lanczos', '-c:v', 'libx264', '-pix_fmt', 'yuv420p', '-crf', '20', '-movflags', '+faststart', `${base}.mp4`);
ffmpeg('-vf', 'fps=10,scale=800:-1:flags=lanczos,split[a][b];[a]palettegen=max_colors=96:stats_mode=diff[p];[b][p]paletteuse=dither=bayer:bayer_scale=5:diff_mode=rectangle', `${base}.gif`);
await fs.rm(work, { recursive: true, force: true });

for (const ext of ['mp4', 'gif']) {
  const { size } = await fs.stat(`${base}.${ext}`);
  console.log(`${path.relative(root, `${base}.${ext}`)}  ${(size / 1024 / 1024).toFixed(2)} MB`);
}
