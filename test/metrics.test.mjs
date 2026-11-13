import { test } from 'node:test';
import assert from 'node:assert/strict';
import { computeMetrics, normalizeCommand, countRetries, validationState } from '../cli/src/ir/metrics.mjs';

function run(command, status, category = 'test') {
  return { command, status, category };
}

function story({ turns = [], events = [], costStates = [], totals, session } = {}) {
  return {
    schema_version: 1,
    session: session || { id: 's1', chain: ['s1'], started_at: '2026-10-08T10:00:00.000Z', ended_at: '2026-10-08T10:00:18.500Z' },
    turns,
    files: [],
    totals: totals || { turns: turns.length, files: 1, added: 1, removed: 1, edits: 1 },
    trace: { events, cost_states: costStates },
  };
}

test('normalizeCommand collapses whitespace and drops a trailing semicolon', () => {
  assert.equal(normalizeCommand('  npm   test ;'), 'npm test');
  assert.equal(normalizeCommand('npm test -- --watch'), 'npm test -- --watch');
  assert.equal(normalizeCommand(null), '');
});

test('countRetries counts a rerun of a failed command once and not a rerun after success', () => {
  assert.equal(countRetries([run('npm test', 'error'), run('npm  test', 'ok'), run('npm test', 'ok')]), 1);
  assert.equal(countRetries([run('npm test', 'error'), run('npm test', 'error'), run('npm test', 'ok')]), 2);
  assert.equal(countRetries([run('npm test', 'error'), run('npm test -- --watch', 'ok')]), 0);
  assert.equal(countRetries([run('npm test', 'interrupted'), run('npm test', 'ok')]), 0);
});

test('validationState reports the last test/lint/build command as passed, failed, unknown, or none', () => {
  assert.deepEqual(validationState([run('npm test', 'error'), run('ls', 'ok', 'other'), run('npm test', 'ok')]),
    { commands: 2, passed: 1, failed: 1, final_state: 'passed', last_command: 'npm test' });
  assert.equal(validationState([run('npm test', 'interrupted')]).final_state, 'unknown');
  assert.equal(validationState([run('npm run lint', 'error', 'lint')]).final_state, 'failed');
  assert.deepEqual(validationState([run('ls', 'ok', 'other')]), { commands: 0, passed: 0, failed: 0, final_state: 'none', last_command: null });
});

test('computeMetrics derives execution, code, validation and reads from turns and trace', () => {
  const turns = [{
    index: 1, id: 'u1', at: '2026-10-08T10:00:00.000Z', prompt: 'go', summary: '',
    edits: [
      { id: 'tu3', rel: 'src/a.js', stats: { added: 1, removed: 1 } },
      { id: 'tu5', rel: 'src/a.js', stats: { added: 1, removed: 0 } },
      { id: 'tu6', rel: 'src/b.js', stats: { added: 0, removed: 0 }, combined_into: 1 },
    ],
    bash: [
      { id: 'tu2', command: 'npm test', category: 'test', ok: false },
      { id: 'tu4', command: 'npm test', category: 'test', ok: true },
    ],
    errors: [], plan: null, usage: null,
  }];
  const events = [
    { id: 'u1', kind: 'prompt', turn: 1, status: 'ok', tool: null, summary: 'go' },
    { id: 'tu1', kind: 'tool', turn: 1, status: 'ok', tool: 'Read', summary: 'src/a.js' },
    { id: 'tu2', kind: 'tool', turn: 1, status: 'error', tool: 'Bash', category: 'test', summary: 'npm test' },
    { id: 'tu3', kind: 'tool', turn: 1, status: 'ok', tool: 'Edit', summary: 'src/a.js' },
    { id: 'tu4', kind: 'tool', turn: 1, status: 'ok', tool: 'Bash', category: 'test', summary: 'npm test' },
    { id: 'tu5', kind: 'tool', turn: 1, status: 'rejected', tool: 'Edit', summary: 'src/a.js' },
    { id: 'tu7', kind: 'tool', turn: 1, status: 'ok', tool: 'Read', summary: 'src/a.js' },
    { id: 'tu8', kind: 'tool', turn: 1, status: 'ok', tool: 'Grep', summary: 'foo in src' },
  ];
  const m = computeMetrics(story({ turns, events, totals: { turns: 1, files: 2, added: 2, removed: 1, edits: 2 } }));
  assert.deepEqual(m.execution, { duration_ms: 18500, active_ms: null, turns: 1, tool_calls: 7, failed_tool_calls: 1, rejected_tool_calls: 1, commands: 2, failed_commands: 1, retries: 1 });
  assert.deepEqual(m.code, { files_changed: 2, lines_added: 2, lines_removed: 1, edits: 2, in_project: { files_changed: 1, lines_added: 2, lines_removed: 1, edits: 2 }, files_edited_repeatedly: [{ rel: 'src/a.js', edits: 2 }] });
  assert.deepEqual(m.validation, { commands: 2, passed: 1, failed: 1, final_state: 'passed', last_command: 'npm test' });
  assert.deepEqual(m.reads, { files_read: 1, tool_calls: 3 });
});

test('code metrics split out project-only counts and flag repeated files outside the project', () => {
  const turns = [{
    index: 1, id: 'u1', prompt: 'go', bash: [],
    edits: [
      { id: 'e1', rel: 'src/a.js', stats: { added: 3, removed: 1 } },
      { id: 'e2', rel: '~/.claude/memory/x.md', outside_cwd: true, stats: { added: 5, removed: 0 } },
      { id: 'e3', rel: '~/.claude/memory/x.md', outside_cwd: true, stats: { added: 1, removed: 1 } },
    ],
  }];
  const m = computeMetrics(story({ turns, totals: { turns: 1, files: 2, added: 9, removed: 2, edits: 3 } }));
  assert.equal(m.code.files_changed, 2);
  assert.deepEqual(m.code.in_project, { files_changed: 1, lines_added: 3, lines_removed: 1, edits: 1 });
  assert.deepEqual(m.code.files_edited_repeatedly, [{ rel: '~/.claude/memory/x.md', edits: 2, outside_cwd: true }]);
});

test('computeMetrics orders runs by the trace, not by turn, so a retry across turns counts', () => {
  const turns = [
    { index: 1, id: 'u1', prompt: 'a', edits: [], bash: [{ id: 'b1', command: 'npm test', category: 'test', ok: false }] },
    { index: 2, id: 'u2', prompt: 'b', edits: [], bash: [{ id: 'b2', command: 'npm test', category: 'test', ok: true }] },
  ];
  const events = [
    { id: 'u1', kind: 'prompt', turn: 1, status: 'ok' }, { id: 'b1', kind: 'tool', turn: 1, status: 'error', tool: 'Bash', category: 'test' },
    { id: 'u2', kind: 'prompt', turn: 2, status: 'ok' }, { id: 'b2', kind: 'tool', turn: 2, status: 'ok', tool: 'Bash', category: 'test' },
  ];
  assert.equal(computeMetrics(story({ turns, events })).execution.retries, 1);
});

test('usage prefers cost-state totals and reports the cost', () => {
  const costStates = [{
    total_cost_usd: 0.05, total_api_duration_ms: 9000, total_tool_duration_ms: 11000, has_unknown_model_cost: false,
    model_usage: { 'claude-opus-5-5': { inputTokens: 30, outputTokens: 65, cacheReadInputTokens: 1100, cacheCreationInputTokens: 100, costUSD: 0.05 } },
  }];
  const m = computeMetrics(story({ costStates }));
  assert.deepEqual(m.usage, { input_tokens: 30, output_tokens: 65, cache_read_tokens: 1100, cache_creation_tokens: 100, total_cost_usd: 0.05, models: ['claude-opus-5-5'], source: 'cost-state', complete: true, sessions: [], cache_read_share: 0.894, cache_breaks: null });
});

test('usage counts only the last of several running-total cost-states from one process', () => {
  const state = (cost, out) => ({
    session_id: 's1', start_time: 100, total_cost_usd: cost, has_unknown_model_cost: false,
    model_usage: { 'claude-opus-5-5': { inputTokens: 10, outputTokens: out, cacheReadInputTokens: 0, cacheCreationInputTokens: 0 } },
  });
  const m = computeMetrics(story({ costStates: [state(40, 100), state(50, 150), state(64, 200)] }));
  assert.equal(m.usage.total_cost_usd, 64);
  assert.equal(m.usage.output_tokens, 200);
  assert.equal(m.usage.input_tokens, 10);
  assert.equal(m.usage.complete, true);
});

test('usage sums the cost-states of different sessions in a chain', () => {
  const state = (id, cost) => ({ session_id: id, start_time: 100, total_cost_usd: cost, model_usage: {} });
  const session = { id: 's2', chain: ['s1', 's2'], started_at: '2026-10-08T10:00:00.000Z', ended_at: '2026-10-08T10:00:18.500Z' };
  const m = computeMetrics(story({ session, costStates: [state('s1', 1), state('s2', 2)] }));
  assert.equal(m.usage.total_cost_usd, 3);
  assert.equal(m.usage.complete, true);
});

test('usage breaks cost down per session in chain order, null for a session not yet recorded', () => {
  const state = (id, start, cost, model) => ({
    session_id: id, start_time: start, total_cost_usd: cost, model_usage: { [model]: { outputTokens: 1 } },
  });
  const session = { id: 's3', chain: ['s1', 's2', 's3'], started_at: '2026-10-08T10:00:00.000Z', ended_at: '2026-10-08T10:00:18.500Z' };
  const costStates = [state('s2', 300, 2, 'claude-opus-5-5'), state('s1', 100, 1, 'claude-fable-5-1'), state('s1', 200, 0.5, 'claude-opus-5-5')];
  const m = computeMetrics(story({ session, costStates }));
  assert.deepEqual(m.usage.sessions, [
    { session_id: 's1', cost_usd: 1.5, models: ['claude-fable-5-1', 'claude-opus-5-5'] },
    { session_id: 's2', cost_usd: 2, models: ['claude-opus-5-5'] },
    { session_id: 's3', cost_usd: null, models: [] },
  ]);
  assert.equal(m.usage.total_cost_usd, 3.5);
  assert.equal(m.usage.complete, false);
});

test('usage sums cost-states that carry no session id, as older stories did', () => {
  const m = computeMetrics(story({ costStates: [{ total_cost_usd: 1, model_usage: {} }, { total_cost_usd: 2, model_usage: {} }] }));
  assert.equal(m.usage.total_cost_usd, 3);
  assert.deepEqual(m.usage.sessions, []);
});

test('usage sums turn and subagent usage with a null cost when there is no cost-state', () => {
  const turns = [
    { index: 1, id: 'u1', prompt: 'a', edits: [], bash: [], usage: { input_tokens: 1, output_tokens: 2, cache_read_tokens: 3, cache_creation_tokens: 4, api_calls: 1, models: ['claude-opus-5-5'], complete: true } },
    { index: 2, id: 'u2', prompt: 'b', edits: [], bash: [], usage: null },
  ];
  const events = [{ id: 'ag', kind: 'subagent', turn: 1, status: 'ok', tool: 'Agent', usage: { input_tokens: 10, output_tokens: 20, cache_read_tokens: 0, cache_creation_tokens: 0, api_calls: 2, models: ['claude-haiku-4-5-20251001'], complete: false } }];
  const m = computeMetrics(story({ turns, events }));
  assert.deepEqual(m.usage, { input_tokens: 11, output_tokens: 22, cache_read_tokens: 3, cache_creation_tokens: 4, total_cost_usd: null, models: ['claude-haiku-4-5-20251001', 'claude-opus-5-5'], source: 'transcript', complete: false, cache_read_share: 0.167, cache_breaks: null });
});

test('usage is all null with source none when nothing carried usage', () => {
  const m = computeMetrics(story({ turns: [{ index: 1, id: 'u1', prompt: 'a', edits: [], bash: [], usage: null }] }));
  assert.deepEqual(m.usage, { input_tokens: null, output_tokens: null, cache_read_tokens: null, cache_creation_tokens: null, total_cost_usd: null, models: [], source: 'none', complete: false, cache_read_share: null, cache_breaks: null });
});

test('an old story with no trace gets nulls for trace-derived counts, numbers for code, and no 0 for an unknown duration', () => {
  const old = { schema_version: 1, session: { id: 's1', started_at: null, ended_at: null }, turns: [{ index: 1, id: 'u1', prompt: 'a', edits: [], bash: [{ id: 'b1', command: 'npm test', category: 'test', ok: true }] }], files: [], totals: { turns: 1, files: 0, added: 0, removed: 0, edits: 0 } };
  const m = computeMetrics(old);
  assert.equal(m.execution.duration_ms, null);
  assert.equal(m.execution.tool_calls, null);
  assert.equal(m.execution.commands, 1);
  assert.equal(m.validation.final_state, 'passed');
  assert.deepEqual(m.reads, { files_read: null, tool_calls: null });
  assert.equal(m.code.files_changed, 0);
});

test('validationState reports only the first line of a multi-line last command, capped at 200 characters', () => {
  assert.equal(validationState([run("python3 - <<'EOF'\nprint(1)\nEOF\nnpm test", 'ok')]).last_command, "python3 - <<'EOF'");
  assert.equal(validationState([run(`npm test ${'x'.repeat(300)}`, 'ok')]).last_command.length, 200);
});

const U = (input_tokens, output_tokens, cache_read_tokens, cache_creation_tokens, api_calls = 1, complete = true) =>
  ({ input_tokens, output_tokens, cache_read_tokens, cache_creation_tokens, api_calls, models: ['claude-opus-5-5'], complete });

test('metrics.turns gives each turn its duration, tokens, subagent tokens and share of the session', () => {
  const turns = [
    { index: 1, id: 'u1', prompt: 'a', edits: [], bash: [], duration_ms: 9000, duration_source: 'transcript', usage: U(10, 100, 1000, 90, 3) },
    { index: 2, id: 'u2', prompt: 'b', edits: [], bash: [], duration_ms: 5000, duration_source: 'derived', usage: U(5, 300, 500, 0, 2) },
  ];
  const events = [
    { id: 'ag', kind: 'subagent', turn: 1, status: 'ok', tool: 'Agent', usage: U(5, 100, 0, 0, 4) },
  ];
  const costStates = [{
    total_cost_usd: 1, has_unknown_model_cost: false,
    model_usage: { 'claude-opus-5-5': { inputTokens: 20, outputTokens: 500, cacheReadInputTokens: 1500, cacheCreationInputTokens: 90 } },
  }];
  const m = computeMetrics(story({ turns, events, costStates }));
  assert.deepEqual(m.turns, [
    {
      index: 1, duration_ms: 9000, duration_source: 'transcript',
      input_tokens: 10, output_tokens: 100, cache_read_tokens: 1000, cache_creation_tokens: 90, api_calls: 3, cache_breaks: null, complete: true,
      subagents: { count: 1, with_usage: 1, input_tokens: 5, output_tokens: 100, cache_read_tokens: 0, cache_creation_tokens: 0, cache_breaks: null },
      share: { output: 0.4, input: 0.686, duration: 0.486 },
    },
    {
      index: 2, duration_ms: 5000, duration_source: 'derived',
      input_tokens: 5, output_tokens: 300, cache_read_tokens: 500, cache_creation_tokens: 0, api_calls: 2, cache_breaks: null, complete: true,
      subagents: null,
      share: { output: 0.6, input: 0.314, duration: 0.27 },
    },
  ]);
});

test('a turn with no usage gets null tokens and shares but keeps its duration', () => {
  const turns = [
    { index: 1, id: 'u1', prompt: 'a', edits: [], bash: [], duration_ms: 4000, duration_source: 'derived', usage: null },
    { index: 2, id: 'u2', prompt: 'b', edits: [], bash: [], duration_ms: null, duration_source: 'unknown', usage: U(1, 10, 0, 0) },
  ];
  const [t1, t2] = computeMetrics(story({ turns })).turns;
  assert.deepEqual(t1, {
    index: 1, duration_ms: 4000, duration_source: 'derived',
    input_tokens: null, output_tokens: null, cache_read_tokens: null, cache_creation_tokens: null, api_calls: null, cache_breaks: null, complete: null,
    subagents: null, share: { output: null, input: null, duration: 0.216 },
  });
  assert.equal(t2.share.output, 1);
  assert.equal(t2.share.duration, null);
});

test('a subagent without usage is counted but contributes no tokens', () => {
  const turns = [{ index: 1, id: 'u1', prompt: 'a', edits: [], bash: [], duration_ms: null, duration_source: 'unknown', usage: U(1, 10, 0, 0) }];
  const events = [
    { id: 'a1', kind: 'subagent', turn: 1, status: 'ok', tool: 'Agent', usage: null },
    { id: 'a2', kind: 'subagent', turn: 1, status: 'ok', tool: 'Agent', usage: null },
  ];
  const [t] = computeMetrics(story({ turns, events })).turns;
  assert.deepEqual(t.subagents, { count: 2, with_usage: 0, input_tokens: null, output_tokens: null, cache_read_tokens: null, cache_creation_tokens: null, cache_breaks: null });
  assert.equal(t.share.output, 1);
});

test('a turn whose only tokens came from subagents takes its share from them', () => {
  const turns = [
    { index: 1, id: 'u1', prompt: 'a', edits: [], bash: [], usage: null },
    { index: 2, id: 'u2', prompt: 'b', edits: [], bash: [], usage: U(0, 30, 0, 0) },
  ];
  const events = [{ id: 'a1', kind: 'subagent', turn: 1, status: 'ok', tool: 'Agent', usage: U(0, 10, 0, 0) }];
  const [t1] = computeMetrics(story({ turns, events })).turns;
  assert.equal(t1.output_tokens, null);
  assert.equal(t1.subagents.output_tokens, 10);
  assert.equal(t1.share.output, 0.25);
});

test('shares are null when the session totals are unknown', () => {
  const session = { id: 's1', chain: ['s1'], started_at: null, ended_at: null };
  const turns = [{ index: 1, id: 'u1', prompt: 'a', edits: [], bash: [], duration_ms: 1000, duration_source: 'derived', usage: null }];
  const [t] = computeMetrics(story({ turns, session })).turns;
  assert.deepEqual(t.share, { output: null, input: null, duration: null });
});

test('an old story with no trace still gets metrics.turns, with no subagents', () => {
  const old = { schema_version: 1, session: { id: 's1', started_at: null, ended_at: null }, turns: [{ index: 1, id: 'u1', prompt: 'a', edits: [], bash: [] }], files: [], totals: { turns: 1, files: 0, added: 0, removed: 0, edits: 0 } };
  const [t] = computeMetrics(old).turns;
  assert.equal(t.index, 1);
  assert.equal(t.duration_ms, null);
  assert.equal(t.duration_source, 'unknown');
  assert.equal(t.subagents, null);
});

test('cache breaks are summed over turns and subagents, per turn and for the session, even with cost-state totals', () => {
  const usage = (cache_breaks) => ({ input_tokens: 1, output_tokens: 1, cache_read_tokens: 0, cache_creation_tokens: 0, api_calls: 1, cache_breaks, models: [], complete: true });
  const turns = [
    { index: 1, id: 'u1', prompt: 'a', edits: [], bash: [], usage: usage(1) },
    { index: 2, id: 'u2', prompt: 'b', edits: [], bash: [], usage: usage(0) },
  ];
  const events = [{ id: 'ag', kind: 'subagent', turn: 2, status: 'ok', tool: 'Agent', usage: usage(2) }];
  const costStates = [{ total_cost_usd: 1, model_usage: { m: { inputTokens: 1 } }, has_unknown_model_cost: false }];
  const m = computeMetrics(story({ turns, events, costStates }));
  assert.equal(m.usage.source, 'cost-state');
  assert.equal(m.usage.cache_breaks, 3);
  assert.deepEqual(m.turns.map((t) => t.cache_breaks), [1, 2]);
  assert.equal(m.turns[1].subagents.cache_breaks, 2);
});

test('execution.active_ms comes from the session and never exceeds the wall-clock duration', () => {
  const base = { id: 's1', chain: ['s1'], started_at: '2026-10-08T10:00:00.000Z', ended_at: '2026-10-08T10:00:18.500Z' };
  assert.equal(computeMetrics(story({ session: { ...base, active_ms: 12000 } })).execution.active_ms, 12000);
  assert.equal(computeMetrics(story({ session: { ...base, active_ms: 99999 } })).execution.active_ms, 18500);
  assert.equal(computeMetrics(story({ session: base })).execution.active_ms, null);
});
