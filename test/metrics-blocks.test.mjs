import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  formatLatency, formatTokens, formatCost, renderScorecard, renderMetrics, renderWhereItWent,
} from '../session-story/src/render/metrics-blocks.mjs';

function metrics(overrides = {}) {
  return {
    execution: { duration_ms: 18500, turns: 1, tool_calls: 4, failed_tool_calls: 1, rejected_tool_calls: 0, commands: 2, failed_commands: 1, retries: 1 },
    code: { files_changed: 1, lines_added: 1, lines_removed: 1, edits: 1, files_edited_repeatedly: [{ rel: 'src/a.js', edits: 3 }] },
    validation: { commands: 2, passed: 1, failed: 1, final_state: 'passed', last_command: 'npm test' },
    reads: { files_read: 1, tool_calls: 1 },
    usage: { input_tokens: 30, output_tokens: 178700, cache_read_tokens: 1100, cache_creation_tokens: 100, total_cost_usd: 0.05, models: ['claude-opus-5-5'], source: 'cost-state', complete: true },
    ...overrides,
  };
}

test('formatters render latency, tokens and cost, and return null for unknown', () => {
  assert.equal(formatLatency(420), '420 ms');
  assert.equal(formatLatency(7000), '7.0 s');
  assert.equal(formatLatency(112000), '1m 52s');
  assert.equal(formatLatency(4498209), '1h 14m');
  assert.equal(formatLatency(null), null);
  assert.equal(formatTokens(860), '860');
  assert.equal(formatTokens(178717), '178.7k');
  assert.equal(formatTokens(15908759), '15.9M');
  assert.equal(formatTokens(null), null);
  assert.equal(formatCost(4.2226), '$4.22');
  assert.equal(formatCost(0.004), '<$0.01');
  assert.equal(formatCost(null), null);
});

test('scorecard shows only what the header lacks: tool calls, failures, validation and retries', () => {
  const html = renderScorecard(metrics());
  for (const text of ['4', 'tool calls', 'failed', '1/2', 'validation, last passed', 'retry']) {
    assert.ok(html.includes(text), `missing ${text}`);
  }
  // Duration, files, tokens and cost are already in the page header.
  for (const text of ['18.5 s', 'file changed', 'output tokens', '$0.05']) {
    assert.ok(!html.includes(text), `repeats the header: ${text}`);
  }
});

test('scorecard omits tiles for unknown values instead of showing 0, and is empty when none are known', () => {
  const html = renderScorecard(metrics({
    execution: { duration_ms: null, turns: 1, tool_calls: null, failed_tool_calls: null, rejected_tool_calls: null, commands: 0, failed_commands: 0, retries: 2 },
    validation: { commands: 0, passed: 0, failed: 0, final_state: 'none', last_command: null },
  }));
  assert.doesNotMatch(html, /tool calls|failed|validation/);
  assert.match(html, /retries/);
  assert.equal(renderScorecard(metrics({ execution: {}, validation: {} })), '');
  assert.equal(renderScorecard(undefined), '');
});

test('code counts render both scopes so the "Project files only" toggle picks one, like the header', () => {
  const code = {
    files_changed: 30, lines_added: 900, lines_removed: 40, edits: 60,
    in_project: { files_changed: 28, lines_added: 850, lines_removed: 38, edits: 55 },
    files_edited_repeatedly: [{ rel: '~/.claude/x.md', edits: 2, outside_cwd: true }, { rel: 'src/a.js', edits: 3 }],
  };
  const panel = renderMetrics({ metrics: metrics({ code }) });
  for (const [inV, allV] of [[28, 30], [850, 900], [38, 40], [55, 60]]) {
    assert.ok(panel.includes(`<span class="v-in">${inV}</span><span class="v-all">${allV}</span>`), `missing ${inV}/${allV}`);
  }
  assert.match(panel, /<li data-outside="1"><code>~\/\.claude\/x\.md<\/code>/);
  assert.match(panel, /<li><code>src\/a\.js<\/code>/);
});

test('code counts from metrics without in_project show the single total', () => {
  const panel = renderMetrics({ metrics: metrics() });
  assert.doesNotMatch(panel, /v-in/);
  assert.match(panel, /<dt>Files changed<\/dt><dd>1<\/dd>/);
});

test('metrics panel groups execution, code, validation, reads and usage, and marks nulls as not recorded', () => {
  const story = {
    metrics: metrics({ reads: { files_read: null, tool_calls: null }, usage: { ...metrics().usage, total_cost_usd: null, source: 'transcript' } }),
    environment: { agent: { name: 'Claude Code', version: '2.1.292' }, models: ['claude-opus-5-5'] },
  };
  const html = renderMetrics(story);
  for (const h of ['Execution', 'Code', 'Validation', 'Reads', 'Usage']) assert.match(html, new RegExp(`<h3>${h}</h3>`));
  assert.match(html, /src\/a\.js<\/code> ×3/);
  assert.match(html, /not recorded/);
  assert.match(html, /Claude Code writes cost when a session ends/);
  assert.match(html, /summed from the transcript/);
  assert.match(html, /<p class="metrics-env">Claude Code 2\.1\.292<\/p>/);
  assert.match(html, /^<div class="metrics-groups">/);
});

test('metrics panel labels cost as an API-equivalent estimate and breaks it down per joined session', () => {
  const sessions = [
    { session_id: 'b5ca3d8b-0000', cost_usd: 1.49, models: ['claude-opus-5-5'] },
    { session_id: 'cdb6ec93-0000', cost_usd: 10.12, models: ['claude-fable-5-1', 'claude-haiku-5-5'] },
    { session_id: '22805d54-0000', cost_usd: null, models: [] },
  ];
  const html = renderMetrics({ metrics: metrics({ usage: { ...metrics().usage, sessions } }) });
  assert.match(html, /\$0\.05<\/span> <span class="metrics-note">API-equivalent estimate<\/span>/);
  assert.match(html, /<dt>Cost by session<\/dt>/);
  assert.match(html, /<li><code>b5ca3d8b<\/code> \$1\.49 <span class="metrics-note"><code>opus-5-5<\/code><\/span><\/li>/);
  assert.match(html, /<code>fable-5-1<\/code>, <code>haiku-5-5<\/code>/);
  assert.match(html, /<code>22805d54<\/code> <span class="metrics-na">not recorded<\/span> <span class="metrics-note">still running/);
});

test('metrics panel leaves out Cost by session for a single session or an older story', () => {
  const one = [{ session_id: 's1', cost_usd: 0.05, models: ['claude-opus-5-5'] }];
  assert.doesNotMatch(renderMetrics({ metrics: metrics({ usage: { ...metrics().usage, sessions: one } }) }), /Cost by session/);
  assert.doesNotMatch(renderMetrics({ metrics: metrics() }), /Cost by session/);
});

test('metrics panel leaves out Usage when nothing carried usage, and is empty without metrics', () => {
  const html = renderMetrics({ metrics: metrics({ usage: { input_tokens: null, output_tokens: null, cache_read_tokens: null, cache_creation_tokens: null, total_cost_usd: null, models: [], source: 'none', complete: false } }) });
  assert.doesNotMatch(html, /<h3>Usage<\/h3>/);
  assert.equal(renderMetrics({}), '');
});

function whereStory() {
  const pt = (index, output, duration_ms, duration_source, subagents = null) => ({
    index, duration_ms, duration_source,
    input_tokens: output === null ? null : 1, output_tokens: output, cache_read_tokens: output === null ? null : 0, cache_creation_tokens: output === null ? null : 0,
    api_calls: 1, complete: true, subagents, share: { output: null, input: null, duration: null },
  });
  return {
    session: { id: 's1' },
    turns: [
      { index: 1, prompt: 'Plan it', summary: 'Planned the <work>.', edits: [] },
      { index: 2, prompt: 'Build it', summary: 'Built it.', edits: [] },
      { index: 3, prompt: 'Check it\nsecond line', summary: '', edits: [] },
    ],
    metrics: metrics({ turns: [
      pt(1, 5000, 60000, 'transcript'),
      pt(2, 40000, 300000, 'derived', { count: 1, with_usage: 1, input_tokens: 1, output_tokens: 45100, cache_read_tokens: 0, cache_creation_tokens: 0 }),
      pt(3, null, 120000, 'transcript'),
    ] }),
  };
}

test('Where it went ranks turns by output tokens (main plus subagents) and by duration, each with a jump', () => {
  const html = renderWhereItWent(whereStory());
  assert.match(html, /^<div class="where-went"><h3 class="where-title">Where it went<\/h3>/);
  const [byTokens, byTime] = html.split('<h3>By duration</h3>');
  assert.match(byTokens, /<h3>By output tokens<\/h3>/);
  const order = (part) => [...part.matchAll(/class="where-row" data-turn="(\d+)"/g)].map((m) => m[1]);
  assert.deepEqual(order(byTokens), ['2', '1']);
  assert.deepEqual(order(byTime), ['2', '3', '1']);
  assert.match(byTokens, /title="40\.0k main \+ 45\.1k in 1 agent">85\.1k</);
  assert.match(byTime, /title="estimated from timestamps">5m 0s</);
  assert.match(byTime, /title="reported by Claude Code">2m 0s</);
  assert.match(html, /Planned the &lt;work&gt;\./);
  assert.match(byTime, /Check it</);
  assert.doesNotMatch(byTime, /second line/);
  assert.equal((html.match(/class="metrics-jump" data-jump-turn="2"/g) || []).length, 2);
  assert.match(byTokens, /<span class="where-bar"><span style="width:100%"><\/span><\/span>/);
});

test('Where it went is left out for one turn and without metrics.turns', () => {
  const one = whereStory();
  one.metrics.turns = one.metrics.turns.slice(0, 1);
  assert.equal(renderWhereItWent(one), '');
  assert.equal(renderWhereItWent({ metrics: metrics() }), '');
  assert.equal(renderWhereItWent({}), '');
});

test('metrics panel shows active time, the share read from cache and cache breaks when known', () => {
  const html = renderMetrics({ metrics: metrics({
    execution: { ...metrics().execution, active_ms: 12000 },
    usage: { ...metrics().usage, cache_read_share: 0.894, cache_breaks: 2 },
  }) });
  assert.match(html, /<dt>Active<\/dt><dd><span title="[^"]+">12\.0 s<\/span><\/dd>/);
  assert.match(html, /<dt>Read from cache<\/dt><dd>89% of input<\/dd>/);
  assert.match(html, /<dt>Cache breaks<\/dt><dd><span title="[^"]+">2<\/span><\/dd>/);
  const older = renderMetrics({ metrics: metrics() });
  assert.doesNotMatch(older, /<dt>Active<\/dt>|Read from cache|Cache breaks/);
});

test('Where it went lists turns with cache breaks, even a single one', () => {
  const story = whereStory();
  story.metrics.turns[2].cache_breaks = 1;
  const html = renderWhereItWent(story);
  const [, breaks] = html.split('<h3>By cache breaks</h3>');
  assert.deepEqual([...breaks.matchAll(/class="where-row" data-turn="(\d+)"/g)].map((m) => m[1]), ['3']);
  const one = whereStory();
  one.metrics.turns = one.metrics.turns.slice(0, 1);
  one.metrics.turns[0].cache_breaks = 1;
  assert.match(renderWhereItWent(one), /By cache breaks/);
  assert.doesNotMatch(renderWhereItWent(whereStory()), /By cache breaks/);
});

test('metrics panel names the agent that ran a non-Claude session when it reported no cost', () => {
  const story = {
    metrics: metrics({ usage: { ...metrics().usage, total_cost_usd: null, source: 'transcript' } }),
    environment: { agent: { name: 'Cursor Agent', version: null }, models: ['Composer 2.5'] },
  };
  const html = renderMetrics(story);
  assert.match(html, /Cursor Agent reported no cost/);
  assert.doesNotMatch(html, /Claude Code writes cost/);
});
