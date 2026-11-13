import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, writeFile, utimes } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { slugify, locateSession, locateChain, subagentMetaPath } from '../cli/src/transcript/locate.mjs';

test('slugify turns an absolute cwd into the ~/.claude/projects folder slug', () => {
  assert.equal(slugify('/Users/nalaj/Development/AI/metafyl'), '-Users-nalaj-Development-AI-metafyl');
});

test('slugify also replaces dots, matching Claude Code’s real project folder naming', () => {
  // Verified against a real ~/.claude/projects folder: cwd "/Users/nalaj/Projects/own.ai/ai-harlequins"
  // is stored as "-Users-nalaj-Projects-own-ai-ai-harlequins" -- the "." in "own.ai" becomes "-" too.
  assert.equal(
    slugify('/Users/nalaj/Projects/own.ai/ai-harlequins'),
    '-Users-nalaj-Projects-own-ai-ai-harlequins'
  );
});

test('slugify replaces every non-alphanumeric character, so a Windows cwd finds its folder too', () => {
  assert.equal(slugify('C:\\Users\\dev\\my_app'), 'C--Users-dev-my-app');
  assert.equal(slugify('/home/dev/todo app'), '-home-dev-todo-app');
});

async function makeClaudeDir() {
  const root = await mkdtemp(path.join(tmpdir(), 'claude-test-'));
  return path.join(root, 'projects');
}

test('locateSession with --latest returns the most recently modified transcript for the cwd', async () => {
  const claudeDir = await makeClaudeDir();
  const cwd = '/proj';
  const slugDir = path.join(claudeDir, slugify(cwd));
  await mkdir(slugDir, { recursive: true });
  const older = path.join(slugDir, 'session-a.jsonl');
  const newer = path.join(slugDir, 'session-b.jsonl');
  await writeFile(older, '{}\n');
  await writeFile(newer, '{}\n');
  const now = new Date();
  await utimes(older, now, new Date(now.getTime() - 60000));
  await utimes(newer, now, now);

  const result = await locateSession({ claudeDir, cwd, latest: true });

  assert.equal(result.transcriptPath, newer);
  assert.equal(result.sessionId, 'session-b');
});

test('locateSession with a specific sessionId returns that file directly', async () => {
  const claudeDir = await makeClaudeDir();
  const cwd = '/proj';
  const slugDir = path.join(claudeDir, slugify(cwd));
  await mkdir(slugDir, { recursive: true });
  await writeFile(path.join(slugDir, 'abc-123.jsonl'), '{}\n');

  const result = await locateSession({ claudeDir, cwd, sessionId: 'abc-123' });

  assert.equal(result.transcriptPath, path.join(slugDir, 'abc-123.jsonl'));
});

test('locateSession throws a clear error listing available project slugs when the cwd has none', async () => {
  const claudeDir = await makeClaudeDir();
  await mkdir(path.join(claudeDir, '-Users-nalaj-other-project'), { recursive: true });

  await assert.rejects(
    () => locateSession({ claudeDir, cwd: '/no/such/project', latest: true }),
    (err) => {
      assert.match(err.message, /-Users-nalaj-other-project/);
      return true;
    }
  );
});

test('locateSubagents returns a map of agentId -> transcript path for a session', async () => {
  const claudeDir = await makeClaudeDir();
  const cwd = '/proj';
  const slugDir = path.join(claudeDir, slugify(cwd));
  const subDir = path.join(slugDir, 'sess-1', 'subagents');
  await mkdir(subDir, { recursive: true });
  await writeFile(path.join(subDir, 'agent-ad8ff631be07e1ecc.jsonl'), '{}\n');
  await writeFile(path.join(subDir, 'agent-a857f2cbeaf39bf9e.jsonl'), '{}\n');

  const { locateSubagents } = await import('../cli/src/transcript/locate.mjs');
  const result = await locateSubagents({ claudeDir, cwd, sessionId: 'sess-1' });

  assert.deepEqual(Object.keys(result).sort(), ['a857f2cbeaf39bf9e', 'ad8ff631be07e1ecc']);
  assert.equal(result['ad8ff631be07e1ecc'], path.join(subDir, 'agent-ad8ff631be07e1ecc.jsonl'));
});

test('locateSubagents returns an empty map when the session has no subagents folder', async () => {
  const claudeDir = await makeClaudeDir();
  const cwd = '/proj';
  await mkdir(path.join(claudeDir, slugify(cwd)), { recursive: true });

  const { locateSubagents } = await import('../cli/src/transcript/locate.mjs');
  const result = await locateSubagents({ claudeDir, cwd, sessionId: 'sess-1' });

  assert.deepEqual(result, {});
});

/**
 * A session transcript that opens with a /clear, exactly as Claude Code
 * records one: a meta caveat record, then the slash-command record, then
 * the first real prompt.
 */
function clearedTranscript(at, prompt) {
  return [
    JSON.stringify({ type: 'mode', mode: 'normal' }),
    JSON.stringify({ type: 'user', isMeta: true, timestamp: at, message: { role: 'user', content: '<local-command-caveat>Caveat</local-command-caveat>' } }),
    JSON.stringify({ type: 'user', timestamp: at, message: { role: 'user', content: '<command-name>/clear</command-name>\n<command-message>clear</command-message>' } }),
    JSON.stringify({ type: 'user', timestamp: at, message: { role: 'user', content: prompt } }),
    '',
  ].join('\n');
}

async function chainFixture() {
  const claudeDir = await makeClaudeDir();
  const cwd = '/proj';
  const slugDir = path.join(claudeDir, slugify(cwd));
  await mkdir(slugDir, { recursive: true });
  return { claudeDir, cwd, slugDir };
}

test('locateChain follows a /clear back to the session it cleared, oldest first', async () => {
  const { claudeDir, cwd, slugDir } = await chainFixture();
  const clearedAt = new Date('2026-09-14T11:56:45.000Z');
  await writeFile(path.join(slugDir, 'older.jsonl'), '{"type":"user","message":{"role":"user","content":"first"}}\n');
  await writeFile(path.join(slugDir, 'newer.jsonl'), clearedTranscript(clearedAt.toISOString(), 'second'));
  // Claude Code flushes a final record into the old transcript as it clears,
  // so the predecessor's mtime lands on the /clear timestamp.
  await utimes(path.join(slugDir, 'older.jsonl'), clearedAt, clearedAt);

  const chain = await locateChain({ claudeDir, cwd, sessionId: 'newer' });

  assert.deepEqual(chain.map((c) => c.sessionId), ['older', 'newer']);
  assert.equal(chain[1].transcriptPath, path.join(slugDir, 'newer.jsonl'));
});

test('locateChain follows more than one /clear back through the day', async () => {
  const { claudeDir, cwd, slugDir } = await chainFixture();
  const firstClear = new Date('2026-09-14T09:00:00.000Z');
  const secondClear = new Date('2026-09-14T11:00:00.000Z');
  await writeFile(path.join(slugDir, 'a.jsonl'), '{"type":"user","message":{"role":"user","content":"first"}}\n');
  await writeFile(path.join(slugDir, 'b.jsonl'), clearedTranscript(firstClear.toISOString(), 'second'));
  await writeFile(path.join(slugDir, 'c.jsonl'), clearedTranscript(secondClear.toISOString(), 'third'));
  await utimes(path.join(slugDir, 'a.jsonl'), firstClear, firstClear);
  await utimes(path.join(slugDir, 'b.jsonl'), secondClear, secondClear);

  const chain = await locateChain({ claudeDir, cwd, sessionId: 'c' });

  assert.deepEqual(chain.map((c) => c.sessionId), ['a', 'b', 'c']);
});

test('locateChain returns the session alone when it did not start with a /clear', async () => {
  const { claudeDir, cwd, slugDir } = await chainFixture();
  const at = new Date('2026-09-14T11:56:45.000Z');
  await writeFile(path.join(slugDir, 'older.jsonl'), '{"type":"user","message":{"role":"user","content":"first"}}\n');
  await writeFile(path.join(slugDir, 'newer.jsonl'), '{"type":"user","timestamp":"2026-09-14T11:56:45.000Z","message":{"role":"user","content":"second"}}\n');
  await utimes(path.join(slugDir, 'older.jsonl'), at, at);

  const chain = await locateChain({ claudeDir, cwd, sessionId: 'newer' });

  assert.deepEqual(chain.map((c) => c.sessionId), ['newer']);
});

test('locateChain stops when no transcript matches the /clear moment', async () => {
  const { claudeDir, cwd, slugDir } = await chainFixture();
  const clearedAt = new Date('2026-09-14T11:56:45.000Z');
  const unrelated = new Date('2026-09-14T08:00:00.000Z');
  await writeFile(path.join(slugDir, 'older.jsonl'), '{"type":"user","message":{"role":"user","content":"first"}}\n');
  await writeFile(path.join(slugDir, 'newer.jsonl'), clearedTranscript(clearedAt.toISOString(), 'second'));
  await utimes(path.join(slugDir, 'older.jsonl'), unrelated, unrelated);

  const chain = await locateChain({ claudeDir, cwd, sessionId: 'newer' });

  assert.deepEqual(chain.map((c) => c.sessionId), ['newer']);
});

test('locateChain does not loop when two transcripts point at each other', async () => {
  const { claudeDir, cwd, slugDir } = await chainFixture();
  const at = new Date('2026-09-14T11:56:45.000Z');
  await writeFile(path.join(slugDir, 'a.jsonl'), clearedTranscript(at.toISOString(), 'one'));
  await writeFile(path.join(slugDir, 'b.jsonl'), clearedTranscript(at.toISOString(), 'two'));
  await utimes(path.join(slugDir, 'a.jsonl'), at, at);
  await utimes(path.join(slugDir, 'b.jsonl'), at, at);

  const chain = await locateChain({ claudeDir, cwd, sessionId: 'b' });

  assert.deepEqual(chain.map((c) => c.sessionId), ['a', 'b']);
});

test('subagent meta path is the transcript path with .meta.json in place of .jsonl', () => {
  assert.equal(subagentMetaPath('/x/subagents/agent-ab12.jsonl'), '/x/subagents/agent-ab12.meta.json');
});
