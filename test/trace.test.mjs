import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  msBetween, newEvent, finishEvent, resultStatus, eventSummary, turnDuration, sortEvents,
  newUsageAcc, noteUsage, usageTotals, pickCostState, parseTaskNotifications,
  CACHE_BREAK_TOKENS, IDLE_GAP_MS, activeMs,
} from '../cli/src/ir/trace.mjs';

test('msBetween returns the positive difference in ms, or null when either timestamp is missing or unparseable', () => {
  assert.equal(msBetween('2026-10-08T10:00:01.000Z', '2026-10-08T10:00:09.500Z'), 8500);
  assert.equal(msBetween('2026-10-08T10:00:09.000Z', '2026-10-08T10:00:01.000Z'), 0);
  assert.equal(msBetween(null, '2026-10-08T10:00:01.000Z'), null);
  assert.equal(msBetween('garbage', '2026-10-08T10:00:01.000Z'), null);
});

test('newEvent starts a tool event as unknown with no end, and a prompt event as ok', () => {
  const ev = newEvent({ id: 'toolu_1', kind: 'tool', turn: 1, tool: 'Read', summary: 'src/a.js', startedAt: '2026-10-08T10:00:01.000Z' });
  assert.deepEqual(ev, {
    id: 'toolu_1', kind: 'tool', turn: 1, parent_id: null, tool: 'Read', category: null,
    status: 'unknown', summary: 'src/a.js', started_at: '2026-10-08T10:00:01.000Z',
    ended_at: null, duration_ms: null, source: 'transcript',
  });
  assert.equal(newEvent({ id: 'u1', kind: 'prompt', turn: 1, summary: 'hi' }).status, 'ok');
  assert.equal(newEvent({ id: 'x', kind: 'tool', turn: 1, agentId: 'ag1' }).agent_id, 'ag1');
});

test('finishEvent sets ended_at, latency and status', () => {
  const ev = newEvent({ id: 't', kind: 'tool', turn: 1, tool: 'Bash', startedAt: '2026-10-08T10:00:01.000Z' });
  finishEvent(ev, '2026-10-08T10:00:09.500Z', 'error');
  assert.equal(ev.ended_at, '2026-10-08T10:00:09.500Z');
  assert.equal(ev.duration_ms, 8500);
  assert.equal(ev.status, 'error');
});

test('resultStatus ranks rejected over interrupted over error over ok', () => {
  assert.equal(resultStatus(true, 'User rejected tool use'), 'rejected');
  assert.equal(resultStatus(true, { stdout: '', stderr: '', interrupted: true }), 'interrupted');
  assert.equal(resultStatus(true, 'Error: Exit code 1'), 'error');
  assert.equal(resultStatus(false, { stdout: 'ok' }), 'ok');
});

test('eventSummary names the command, the relative file, the pattern, or the description', () => {
  assert.equal(eventSummary('Bash', { command: 'npm test\necho done' }, '/proj'), 'npm test');
  assert.equal(eventSummary('Read', { file_path: '/proj/src/a.js' }, '/proj'), 'src/a.js');
  assert.equal(eventSummary('Edit', { file_path: '/proj/src/a.js' }, '/proj'), 'src/a.js');
  assert.equal(eventSummary('Grep', { pattern: 'foo', path: '/proj/src' }, '/proj'), 'foo in src');
  assert.equal(eventSummary('Glob', { pattern: '**/*.mjs' }, '/proj'), '**/*.mjs');
  assert.equal(eventSummary('Agent', { description: 'Explore IR' }, '/proj'), 'Explore IR');
  assert.equal(eventSummary('WebFetch', { url: 'https://x.test' }, '/proj'), 'https://x.test');
  assert.equal(eventSummary('Skill', { skill: 'tdd' }, '/proj'), '');
  assert.equal(eventSummary('Bash', { command: 'x'.repeat(300) }, '/proj').length, 200);
});

test('turnDuration prefers the harness total, then wall clock to the last event, then unknown', () => {
  assert.deepEqual(turnDuration({ harnessMs: 3000, promptAt: 'a', lastEndedAt: 'b' }), { duration_ms: 3000, duration_source: 'transcript' });
  assert.deepEqual(
    turnDuration({ harnessMs: null, promptAt: '2026-10-08T10:00:00.000Z', lastEndedAt: '2026-10-08T10:00:18.000Z' }),
    { duration_ms: 18000, duration_source: 'derived' }
  );
  assert.deepEqual(turnDuration({ harnessMs: 0, promptAt: '2026-10-08T10:00:00.000Z', lastEndedAt: null }), { duration_ms: null, duration_source: 'unknown' });
});

test('sortEvents orders by started_at, keeps ties in insertion order, and keeps an undated event right after the dated one inserted before it', () => {
  const a = newEvent({ id: 'a', kind: 'tool', turn: 1, startedAt: '2026-10-08T10:00:05.000Z' });
  const b = newEvent({ id: 'b', kind: 'tool', turn: 1, startedAt: '2026-10-08T10:00:01.000Z' });
  const c = newEvent({ id: 'c', kind: 'tool', turn: 1, startedAt: null });
  const d = newEvent({ id: 'd', kind: 'tool', turn: 1, startedAt: '2026-10-08T10:00:01.000Z' });
  assert.deepEqual(sortEvents([a, b, c, d]).map((e) => e.id), ['b', 'c', 'd', 'a']);
});

test('usage is counted once per API call even though each content block is its own record', () => {
  const usage = { input_tokens: 2, output_tokens: 278, cache_creation_input_tokens: 18435, cache_read_input_tokens: 25520 };
  const acc = newUsageAcc();
  noteUsage(acc, { type: 'assistant', uuid: 'a1', message: { id: 'msg_1', model: 'claude-opus-5-5', usage } });
  noteUsage(acc, { type: 'assistant', uuid: 'a2', message: { id: 'msg_1', model: 'claude-opus-5-5', usage } });
  noteUsage(acc, { type: 'assistant', uuid: 'a3', message: { id: 'msg_2', model: 'claude-opus-5-5', usage: { input_tokens: 1, output_tokens: 22 } } });
  assert.deepEqual(usageTotals(acc), {
    input_tokens: 3, output_tokens: 300, cache_read_tokens: 25520, cache_creation_tokens: 18435,
    api_calls: 2, cache_breaks: 0, models: ['claude-opus-5-5'], complete: true,
  });
});

test('a streamed API call keeps its largest output count, whatever order its records come in', () => {
  const acc = newUsageAcc();
  noteUsage(acc, { type: 'assistant', uuid: 'a1', message: { id: 'msg_1', usage: { input_tokens: 5, output_tokens: 1 } } });
  noteUsage(acc, { type: 'assistant', uuid: 'a2', message: { id: 'msg_1', usage: { input_tokens: 5, output_tokens: 400 } } });
  noteUsage(acc, { type: 'assistant', uuid: 'a3', message: { id: 'msg_1', usage: { input_tokens: 5, output_tokens: 9 } } });
  assert.equal(usageTotals(acc).output_tokens, 400);
  assert.equal(usageTotals(acc).api_calls, 1);
});

test('usage skips message ids it is told are counted elsewhere', () => {
  const acc = newUsageAcc();
  noteUsage(acc, { type: 'assistant', uuid: 'a1', message: { id: 'msg_main', usage: { output_tokens: 50 } } }, new Set(['msg_main']));
  noteUsage(acc, { type: 'assistant', uuid: 'a2', message: { id: 'msg_sub', usage: { output_tokens: 7 } } }, new Set(['msg_main']));
  assert.equal(usageTotals(acc).output_tokens, 7);
  assert.equal(usageTotals(acc).api_calls, 1);
});

test('a call that sent over 100k input tokens past the cache is a cache break', () => {
  const acc = newUsageAcc();
  noteUsage(acc, { type: 'assistant', uuid: 'a1', message: { id: 'm1', usage: { input_tokens: 3, cache_creation_input_tokens: 150000, cache_read_input_tokens: 0 } } });
  noteUsage(acc, { type: 'assistant', uuid: 'a2', message: { id: 'm2', usage: { input_tokens: 3, cache_creation_input_tokens: 900, cache_read_input_tokens: 150000 } } });
  noteUsage(acc, { type: 'assistant', uuid: 'a3', message: { id: 'm3', usage: { input_tokens: 100000, cache_creation_input_tokens: 0 } } });
  assert.equal(CACHE_BREAK_TOKENS, 100000);
  assert.equal(usageTotals(acc).cache_breaks, 1);
});

test('activeMs sums the gaps between records and leaves out gaps over five minutes', () => {
  assert.equal(activeMs([
    '2026-10-08T10:00:00.000Z',
    '2026-10-08T10:02:00.000Z',
    '2026-10-08T11:00:00.000Z',
    '2026-10-08T11:05:00.000Z',
    'not a date',
  ]), 2 * 60000 + 5 * 60000);
  assert.equal(activeMs(['2026-10-08T10:00:01.000Z', '2026-10-08T10:00:00.000Z']), 1000);
  assert.equal(activeMs(['2026-10-08T10:00:00.000Z']), null);
  assert.equal(IDLE_GAP_MS, 300000);
});

test('usage is incomplete when an API call carried no usage, and null when there were no assistant records', () => {
  const acc = newUsageAcc();
  noteUsage(acc, { type: 'assistant', uuid: 'a1', message: { id: 'msg_1', model: 'claude-opus-5-5' } });
  assert.equal(usageTotals(acc).complete, false);
  assert.equal(usageTotals(newUsageAcc()), null);
  noteUsage(acc, { type: 'user', uuid: 'u1', message: { role: 'user', content: 'x' } });
  assert.equal(usageTotals(acc).api_calls, 0);
});

test('pickCostState keeps the totals and per-model usage, with nulls for missing numbers', () => {
  assert.deepEqual(pickCostState({ type: 'cost-state', totalCostUSD: 0.75, modelUsage: { 'claude-opus-5-5': { inputTokens: 1 } } }), {
    total_cost_usd: 0.75, total_api_duration_ms: null, total_tool_duration_ms: null,
    model_usage: { 'claude-opus-5-5': { inputTokens: 1 } }, has_unknown_model_cost: false,
    session_id: null, start_time: null,
  });
});

test('pickCostState keeps the session id and start time that identify the process', () => {
  const s = pickCostState({ type: 'cost-state', sessionId: 's1', startTime: 1789828455770, totalCostUSD: 1 });
  assert.equal(s.session_id, 's1');
  assert.equal(s.start_time, 1789828455770);
});

test('parseTaskNotifications reads every notification block, keyed by its tool-use-id', () => {
  const text = 'Prompt text <task-notification><task-id>ab</task-id><tool-use-id>toolu_09</tool-use-id>' +
    '<status>completed</status><usage><subagent_tokens>63021</subagent_tokens><tool_uses>15</tool_uses>' +
    '<duration_ms>90800</duration_ms></usage></task-notification>' +
    '<task-notification><tool-use-id>toolu_10</tool-use-id><status>failed</status></task-notification>';
  assert.deepEqual(parseTaskNotifications(text), [
    { toolUseId: 'toolu_09', status: 'completed', duration_ms: 90800 },
    { toolUseId: 'toolu_10', status: 'failed', duration_ms: null },
  ]);
  assert.deepEqual(parseTaskNotifications('no notification here'), []);
  assert.deepEqual(parseTaskNotifications(null), []);
});
