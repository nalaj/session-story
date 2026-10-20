import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { mkdtemp, mkdir, writeFile, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { buildStory } from '../session-story/src/transcript/claude-code.mjs';
import { parseUnifiedDiff } from '../session-story/src/transcript/agents/unified-diff.mjs';
import { readEventLog } from '../session-story/src/transcript/agents/run-log.mjs';
import { detectDialect, recordsFromEvents } from '../session-story/src/transcript/agents/index.mjs';
import { computeMetrics } from '../session-story/src/ir/metrics.mjs';

const run = promisify(execFile);
const binPath = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'session-story', 'bin', 'story.mjs');

const T0 = Date.parse('2026-10-18T12:00:00.000Z');
const at = (s) => T0 + s * 1000;
const iso = (s) => new Date(at(s)).toISOString();
const wrap = (events) => events.map((event, i) => ({ event, ts: iso(i) }));

function story(events, opts = {}) {
  const t = recordsFromEvents(wrap(events), { prompt: 'Fix the parser', startedAt: iso(0), ...opts });
  const s = buildStory(t.records, { sessionId: 'run-1', cwd: '/proj', subagents: {} });
  s.metrics = computeMetrics(s);
  return { ...t, story: s };
}

const DIFF = [
  'Index: /proj/src/a.js',
  '===================================================================',
  '--- /proj/src/a.js',
  '+++ /proj/src/a.js',
  '@@ -1,3 +1,3 @@',
  ' const a = 1;',
  '-const b = 2;',
  '+const b = 3;',
  ' export { a, b };',
  '\\ No newline at end of file',
].join('\n');

test('parseUnifiedDiff keeps hunk lines and drops headers and no-newline markers', () => {
  assert.deepEqual(parseUnifiedDiff(DIFF), [{
    oldStart: 1, oldLines: 3, newStart: 1, newLines: 3,
    lines: [' const a = 1;', '-const b = 2;', '+const b = 3;', ' export { a, b };'],
  }]);
  assert.deepEqual(parseUnifiedDiff('@@ -5 +5 @@\n-x\n+y')[0].oldLines, 1);
});

test('readEventLog re-joins a Paperclip run log whose events were split across chunks', async () => {
  const dir = await mkdtemp(path.join(tmpdir(), 'agents-log-'));
  const file = path.join(dir, 'agent-1', 'run-9.ndjson');
  await mkdir(path.dirname(file), { recursive: true });
  const line = JSON.stringify({ type: 'thread.started', thread_id: 't1' });
  const chunks = [
    { ts: iso(0), stream: 'stdout', chunk: '[paperclip] Using workspace\n' + line.slice(0, 10), seq: 1 },
    { ts: iso(1), stream: 'stderr', chunk: 'noise\n', seq: 2 },
    { ts: iso(2), stream: 'stdout', chunk: line.slice(10) + '\n{"type":"turn.started"}\n', seq: 3 },
  ];
  await writeFile(file, chunks.map((c) => JSON.stringify(c)).join('\n'));

  const log = await readEventLog(file);
  assert.equal(log.id, 'run-9');
  assert.deepEqual(log.paperclip, { run_id: 'run-9', agent_id: 'agent-1' });
  assert.deepEqual(log.events.map((e) => e.event.type), ['thread.started', 'turn.started']);
  // an event keeps the time of the chunk it started in
  assert.equal(log.events[0].ts, iso(0));
  assert.equal(log.events[1].ts, iso(2));
});

test('readEventLog reads an agent\'s own JSON event file with each event\'s timestamp', async () => {
  const dir = await mkdtemp(path.join(tmpdir(), 'agents-raw-'));
  const file = path.join(dir, 'rollout-abc.jsonl');
  await writeFile(file, [
    JSON.stringify({ timestamp: iso(3), type: 'session_meta', payload: { id: 's1', cwd: '/proj' } }),
    '{"truncated',
  ].join('\n'));
  const log = await readEventLog(file);
  assert.equal(log.id, 'rollout-abc');
  assert.equal(log.paperclip, null);
  assert.equal(log.events.length, 1);
  assert.equal(log.events[0].ts, iso(3));
});

test('detectDialect tells each agent apart from the events it prints', () => {
  const d = (event) => detectDialect([{ event }]);
  assert.equal(d({ type: 'system', subtype: 'init', claude_code_version: '2.1.0' }), 'claude-code');
  assert.equal(d({ type: 'system', subtype: 'init', model: 'Composer 2.5' }), 'cursor');
  assert.equal(d({ type: 'step_start', part: {} }), 'opencode');
  assert.equal(d({ type: 'error', sessionID: 'ses1', error: { name: 'APIError' } }), 'opencode');
  assert.equal(d({ type: 'thread.started' }), 'codex');
  assert.equal(d({ type: 'session_meta', payload: {} }), 'codex-rollout');
  assert.equal(d({ type: 'something-else' }), null);
  assert.throws(() => recordsFromEvents([{ event: { type: 'x' } }], { prompt: 'p' }), /--agent/);
});

test('OpenCode: edits keep their diff, a failed command and its exit code count, tokens and cost add up', () => {
  const tool = (tool, input, state) => ({
    type: 'tool_use', timestamp: at(2), part: { type: 'tool', tool, callID: `c-${tool}`, messageID: 'm1', state: { input, time: { start: at(1), end: at(2) }, ...state } },
  });
  const { story: s, agent, promptRecorded } = story([
    { type: 'step_start', timestamp: at(0), sessionID: 'ses1', part: { messageID: 'm1', type: 'step-start' } },
    tool('edit', { filePath: '/proj/src/a.js', oldString: 'const b = 2;', newString: 'const b = 3;' }, { status: 'completed', output: 'ok', metadata: { diff: DIFF } }),
    tool('write', { filePath: '/proj/src/new.js', content: 'x\ny\n' }, { status: 'completed', metadata: { exists: false } }),
    tool('bash', { command: 'npm test' }, { status: 'completed', output: '1 failing', metadata: { exit: 1 } }),
    tool('read', { filePath: '/proj/missing.js' }, { status: 'error', error: 'File not found' }),
    { type: 'text', timestamp: at(3), part: { messageID: 'm1', text: 'Done.', time: { end: at(3) } } },
    { type: 'step_finish', timestamp: at(4), part: { messageID: 'm1', tokens: { input: 100, output: 20, reasoning: 5, cache: { read: 900, write: 0 } }, cost: 0.01 } },
  ], { model: 'deepseek-v4' });

  assert.equal(agent.name, 'OpenCode');
  assert.equal(promptRecorded, false);
  const turn = s.turns[0];
  assert.equal(turn.prompt, 'Fix the parser');
  const edit = turn.edits.find((e) => e.rel === 'src/a.js');
  assert.deepEqual(edit.stats, { added: 1, removed: 1 });
  assert.equal(edit.old_string, 'const b = 2;');
  const created = turn.edits.find((e) => e.rel === 'src/new.js');
  assert.equal(created.kind, 'create');
  assert.deepEqual(created.stats, { added: 2, removed: 0 });
  assert.equal(turn.bash[0].ok, false);
  assert.equal(turn.bash[0].exit_code, 1);
  assert.equal(turn.bash[0].category, 'test');
  assert.deepEqual(turn.errors.map((e) => [e.tool, e.message]), [['Bash', 'Exit code 1\n1 failing'], ['Read', 'File not found']]);
  assert.deepEqual(turn.replies.map((r) => r.text), ['Done.']);
  assert.equal(s.metrics.usage.total_cost_usd, 0.01);
  assert.equal(s.metrics.usage.output_tokens, 25);
  assert.equal(s.metrics.usage.cache_read_tokens, 900);
  assert.deepEqual(s.environment.models, ['deepseek-v4']);
});

test('Cursor: the recorded prompt wins, edits keep before/after, shell exit codes and tool errors show', () => {
  const call = (id, key, args, result) => [
    { type: 'tool_call', subtype: 'started', call_id: id, tool_call: { [key]: { args }, startedAtMs: String(at(1)) } },
    { type: 'tool_call', subtype: 'completed', call_id: id, tool_call: { [key]: { args, result }, startedAtMs: String(at(1)), completedAtMs: String(at(2)) } },
  ];
  const { story: s, agent, promptRecorded } = story([
    { type: 'system', subtype: 'init', model: 'Composer 2.5', cwd: '/proj', session_id: 'cs1' },
    { type: 'user', message: { role: 'user', content: [{ type: 'text', text: 'Rename the helper' }] } },
    { type: 'assistant', message: { content: [{ type: 'text', text: 'On it.' }] }, timestamp_ms: at(1) },
    ...call('t1', 'editToolCall', { path: '/proj/src/a.js' }, { success: { diffString: DIFF, beforeFullFileContent: 'old', afterFullFileContent: 'new' } }),
    ...call('t2', 'editToolCall', { path: '/proj/src/b.js' }, { success: { diffString: '--- /dev/null\n+++ b/proj/src/b.js\n@@ -1,0 +1,1 @@\n+hi', afterFullFileContent: 'hi\n' } }),
    ...call('t3', 'shellToolCall', { command: 'npm run lint' }, { success: { exitCode: 2, stdout: '', stderr: 'lint failed' } }),
    ...call('t4', 'readToolCall', { path: '/proj/secret' }, { error: { errorMessage: 'Permission denied' } }),
    { type: 'result', subtype: 'success', usage: { inputTokens: 10, outputTokens: 5, cacheReadTokens: 50, cacheWriteTokens: 0 } },
  ], { prompt: 'ignored: the log has its own' });

  assert.equal(agent.name, 'Cursor Agent');
  assert.equal(promptRecorded, true);
  const turn = s.turns[0];
  assert.equal(turn.prompt, 'Rename the helper');
  assert.equal(turn.edits[0].tool, 'Edit');
  assert.equal(turn.edits[0].before, 'old');
  assert.equal(turn.edits[0].after, 'new');
  assert.equal(turn.edits[1].kind, 'create');
  assert.equal(turn.bash[0].exit_code, 2);
  assert.equal(turn.bash[0].ok, false);
  assert.ok(turn.errors.some((e) => e.tool === 'Read' && e.message === 'Permission denied'));
  assert.equal(s.metrics.usage.output_tokens, 5);
  assert.deepEqual(s.environment.models, ['Composer 2.5']);
});

test('Codex exec: commands and MCP calls show; file changes show without hunks and say why', () => {
  const { story: s, spots } = story([
    { type: 'thread.started', thread_id: 'th1' },
    { type: 'item.started', item: { id: 'i1', type: 'command_execution', command: 'pytest -q', status: 'in_progress' } },
    { type: 'item.completed', item: { id: 'i1', type: 'command_execution', command: 'pytest -q', aggregated_output: 'FAILED', exit_code: 1, status: 'failed' } },
    { type: 'item.completed', item: { id: 'i2', type: 'mcp_tool_call', server: 'tasks', tool: 'comment', arguments: { body: 'hi' }, result: { content: [{ type: 'text', text: 'ok' }] }, status: 'completed' } },
    { type: 'item.completed', item: { id: 'i3', type: 'file_change', changes: [{ path: '/proj/src/a.py', kind: 'update' }], status: 'completed' } },
    { type: 'item.completed', item: { id: 'i4', type: 'agent_message', text: 'Tests still fail.' } },
    { type: 'turn.completed', usage: { input_tokens: 1000, cached_input_tokens: 800, output_tokens: 50 } },
  ]);
  const turn = s.turns[0];
  assert.equal(turn.bash[0].exit_code, 1);
  assert.equal(turn.bash[0].category, 'test');
  assert.deepEqual(turn.edits.map((e) => [e.rel, e.result, e.hunks.length]), [['src/a.py', 'ok', 0]]);
  assert.match(spots[0], /no diff/);
  assert.equal(s.metrics.usage.input_tokens, 200);
  assert.equal(s.metrics.usage.cache_read_tokens, 800);
  assert.ok(s.trace.events.some((e) => e.tool === 'mcp__tasks__comment'));
});

test('Codex rollout: real prompts, the shell script out of its argv, diffs and per-call tokens', () => {
  const ev = (type, payload, s) => ({ type, payload, timestamp: iso(s) });
  const done = (item, s) => ev('event_msg', { type: 'item_completed', item, started_at_ms: at(s), completed_at_ms: at(s + 1) }, s);
  const { story: s, agent, promptRecorded } = story([
    ev('session_meta', { id: 'roll-1', cwd: '/proj', cli_version: '0.162.0' }, 0),
    ev('turn_context', { model: 'gpt-5.6' }, 0),
    done({ type: 'UserMessage', id: 'u1', content: [{ type: 'text', text: 'Bump the limit' }] }, 1),
    done({ type: 'CommandExecution', id: 'c1', command: ['/bin/zsh', '-lc', 'git diff --stat'], exit_code: 0, aggregated_output: '', status: 'completed' }, 2),
    done({ type: 'FileChange', id: 'f1', changes: { '/proj/src/a.js': { type: 'update', unified_diff: DIFF.split('\n').slice(4).join('\n') } }, status: 'completed' }, 3),
    done({ type: 'McpToolCall', id: 'm1', server: 'apps', tool: 'notion.update', arguments: {}, status: 'failed', error: { message: 'validation_error' } }, 4),
    ev('token_usage_record', { response_id: 'r1', usage: { input_tokens: 300, cached_input_tokens: 100, output_tokens: 40 } }, 5),
    done({ type: 'AgentMessage', id: 'a1', content: [{ type: 'Text', text: 'Bumped and verified.' }] }, 6),
    done({ type: 'UserMessage', id: 'u2', content: [{ type: 'text', text: 'Now add a test' }] }, 8),
  ]);
  assert.equal(agent.version, '0.162.0');
  assert.equal(promptRecorded, true);
  assert.deepEqual(s.turns.map((t) => t.prompt), ['Bump the limit', 'Now add a test']);
  const turn = s.turns[0];
  assert.equal(turn.bash[0].command, 'git diff --stat');
  assert.deepEqual(turn.edits[0].stats, { added: 1, removed: 1 });
  assert.deepEqual(turn.errors.map((e) => [e.tool, e.message]), [['mcp__apps__notion.update', 'validation_error']]);
  assert.deepEqual(turn.replies.map((r) => r.text), ['Bumped and verified.']);
  assert.equal(s.metrics.usage.input_tokens, 200);
  assert.deepEqual(s.environment.models, ['gpt-5.6']);
});

test('Claude Code stream-json: tool results are read, subagent records stay out of the replies, cost comes from the result', () => {
  const { story: s, promptRecorded } = story([
    { type: 'system', subtype: 'init', claude_code_version: '2.1.302', session_id: 'cc1', cwd: '/proj', model: 'claude-opus-5-5' },
    { type: 'assistant', timestamp: iso(1), uuid: 'a1', message: { id: 'msg1', model: 'claude-opus-5-5', content: [{ type: 'tool_use', id: 'tu1', name: 'Edit', input: { file_path: '/proj/src/a.js' } }], usage: { input_tokens: 5, output_tokens: 7 } } },
    { type: 'user', timestamp: iso(2), uuid: 'u1', message: { content: [{ type: 'tool_result', tool_use_id: 'tu1', content: 'ok' }] }, tool_use_result: { filePath: '/proj/src/a.js', structuredPatch: parseUnifiedDiff(DIFF) } },
    { type: 'assistant', timestamp: iso(3), uuid: 'a2', parent_tool_use_id: 'agent1', message: { id: 'msg2', content: [{ type: 'text', text: 'subagent chatter' }] } },
    { type: 'assistant', timestamp: iso(4), uuid: 'a3', message: { id: 'msg3', content: [{ type: 'text', text: 'Edited a.js.' }] } },
    { type: 'result', session_id: 'cc1', total_cost_usd: 0.42, modelUsage: { 'claude-opus-5-5': { inputTokens: 5, outputTokens: 7, costUSD: 0.42 } } },
  ]);
  assert.equal(promptRecorded, false);
  assert.equal(s.turns[0].prompt, 'Fix the parser');
  assert.deepEqual(s.turns[0].edits[0].stats, { added: 1, removed: 1 });
  assert.deepEqual(s.turns[0].replies.map((r) => r.text), ['Edited a.js.']);
  assert.equal(s.metrics.usage.total_cost_usd, 0.42);
});

test('CLI extract --log turns a Paperclip run log into a valid story that names the agent and the gap', async () => {
  const dir = await mkdtemp(path.join(tmpdir(), 'agents-cli-'));
  const file = path.join(dir, 'agent-7', 'run-42.ndjson');
  await mkdir(path.dirname(file), { recursive: true });
  const events = [
    { type: 'step_start', timestamp: at(0), sessionID: 'ses1', part: { messageID: 'm1' } },
    { type: 'tool_use', timestamp: at(1), part: { type: 'tool', tool: 'bash', callID: 'c1', messageID: 'm1', state: { status: 'completed', input: { command: 'ls' }, output: 'a', metadata: { exit: 0 }, time: { start: at(1), end: at(1) } } } },
    { type: 'step_finish', timestamp: at(2), part: { messageID: 'm1', tokens: { input: 1, output: 1, cache: { read: 0, write: 0 } }, cost: 0.001 } },
  ];
  await writeFile(file, events.map((e, i) => JSON.stringify({ ts: iso(i), stream: 'stdout', chunk: JSON.stringify(e) + '\n', seq: i })).join('\n'));

  const out = path.join(dir, 'story.json');
  await run('node', [binPath, 'extract', '--log', file, '--cwd', dir, '--no-git', '--prompt', 'ASG-1: check the disk', '-o', out]);
  const s = JSON.parse(await readFile(out, 'utf8'));
  assert.equal(s.session.id, 'run-42');
  assert.equal(s.environment.agent.name, 'OpenCode');
  assert.deepEqual(s.session.source, { format: 'opencode', agent_session_id: 'ses1', paperclip: { run_id: 'run-42', agent_id: 'agent-7' } });
  assert.equal(s.turns[0].prompt, 'ASG-1: check the disk');
  assert.match(s.session.blind_spots[0], /does not include the prompt OpenCode was given; turn 1 shows the one supplied/);
  const validated = await run('node', [binPath, 'validate', out]);
  assert.match(validated.stdout + validated.stderr, /valid/);
});

test('OpenCode: a run that fails before any work still makes a story that shows the error', () => {
  const { story: s } = story([
    { type: 'error', timestamp: at(1), sessionID: 'ses1', error: { name: 'APIError', data: { message: 'This API key has expired.' } } },
  ]);
  assert.equal(s.turns.length, 1);
  assert.deepEqual(s.turns[0].replies.map((r) => r.text), ['OpenCode error: This API key has expired.']);
});
