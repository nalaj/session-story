import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { liveSessionIds } from '../cli/src/transcript/live.mjs';

test('liveSessionIds keeps only sessions whose process is alive', async () => {
  const dir = await mkdtemp(path.join(tmpdir(), 'story-live-'));
  await writeFile(path.join(dir, '100.json'), JSON.stringify({ pid: 100, sessionId: 'alive' }));
  await writeFile(path.join(dir, '200.json'), JSON.stringify({ pid: 200, sessionId: 'dead' }));
  await writeFile(path.join(dir, '300.json'), '{"pid": 300, "sessi');
  await writeFile(path.join(dir, '400.json'), JSON.stringify({ pid: 400 }));
  await writeFile(path.join(dir, '100.abc.key'), 'not json');
  const live = await liveSessionIds({ dir, isAlive: (pid) => pid !== 200 });
  assert.deepEqual([...live], ['alive']);
});

test('liveSessionIds checks real pids by default', async () => {
  const dir = await mkdtemp(path.join(tmpdir(), 'story-live-'));
  await writeFile(path.join(dir, 'me.json'), JSON.stringify({ pid: process.pid, sessionId: 'me' }));
  assert.deepEqual([...await liveSessionIds({ dir })], ['me']);
});

test('liveSessionIds treats a missing folder as no live sessions', async () => {
  const live = await liveSessionIds({ dir: path.join(tmpdir(), 'story-live-does-not-exist') });
  assert.equal(live.size, 0);
});
