import { test } from 'node:test';
import assert from 'node:assert/strict';
import { renderReportLens } from '../cli/src/render/report.mjs';

function sampleStory(overrides = {}) {
  return {
    schema_version: 1,
    session: {
      id: 's1', cwd: '/proj', git_branch: 'main',
      started_at: '2026-09-10T10:00:00.000Z', ended_at: '2026-09-10T10:05:30.000Z', duration_ms: 330000,
      summary: 'Added a title prop to Panel and wrote a README.',
    },
    turns: [
      {
        index: 1, id: 'u1', at: '2026-09-10T10:00:00.000Z', prompt: 'Add a title prop', summary: 'Added title prop.',
        edits: [], bash: [], errors: [], plan: null,
      },
    ],
    files: [],
    totals: { turns: 1, files: 0, added: 0, removed: 0, edits: 0 },
    report: {
      plan: 'Add a title prop to the Panel component.',
      decisions: ['Reused the existing prop pattern instead of a new component.'],
      outcome: 'completed',
      outcome_note: null,
      dependencies: { manifests: [], installs: [], config_files: [] },
      git: null,
    },
    ...overrides,
  };
}

test('renders the outcome pill and session summary', () => {
  const html = renderReportLens(sampleStory());
  assert.match(html, /completed/i);
  assert.match(html, /Added a title prop to Panel and wrote a README\./);
});

test('renders the plan text and decisions list', () => {
  const html = renderReportLens(sampleStory());
  assert.match(html, /Add a title prop to the Panel component\./);
  assert.match(html, /Reused the existing prop pattern instead of a new component\./);
});

test('shows "None recorded." for decisions when the list is empty', () => {
  const story = sampleStory({ report: { plan: 'p', decisions: [], outcome: null, outcome_note: null, dependencies: { manifests: [], installs: [], config_files: [] }, git: null } });
  const html = renderReportLens(story);
  assert.match(html, /None recorded\./);
});

test('lists commands executed, grouped by turn, with status and category', () => {
  const story = sampleStory();
  story.turns[0].bash = [
    { id: 'b1', command: 'npm install', description: 'install deps', category: 'install', ok: true, exit_code: null, rejected: false, interrupted: false, output_tail: '' },
    { id: 'b2', command: 'npm test', description: 'run tests', category: 'test', ok: false, exit_code: 1, rejected: false, interrupted: false, output_tail: '5 failing\nsome trace' },
  ];
  const html = renderReportLens(story);

  assert.match(html, /npm install/);
  assert.match(html, /npm test/);
  assert.match(html, /install/i);
  assert.match(html, /test/i);
});

test('shows tests and validation runs with pass/fail and failure output', () => {
  const story = sampleStory();
  story.turns[0].bash = [
    { id: 'b1', command: 'npm test', description: '', category: 'test', ok: false, exit_code: 1, rejected: false, interrupted: false, output_tail: 'Expected 2 to equal 3' },
  ];
  const html = renderReportLens(story);

  assert.match(html, /npm test/);
  assert.match(html, /Expected 2 to equal 3/);
});

test('shows "None recorded." for tests and validation when no test/lint/build commands ran', () => {
  const html = renderReportLens(sampleStory());
  // The Commands section is empty too here, so there must be at least two
  // "None recorded." occurrences (commands + tests), not just one.
  const matches = renderReportLens(sampleStory()).match(/None recorded\./g) || [];
  assert.ok(matches.length >= 2);
});

test('lists errors encountered with tool, target, message and an optional resolution', () => {
  const story = sampleStory();
  story.turns[0].errors = [
    { id: 'e1', tool: 'Bash', at: null, kind: 'error', target: 'npm test', message: 'Exit code 1', resolution: 'Fixed a bad assertion.' },
    { id: 'e2', tool: 'Bash', at: null, kind: 'rejected', target: 'rm -rf /', message: 'User rejected tool use', resolution: null },
  ];
  const html = renderReportLens(story);

  assert.match(html, /npm test/);
  assert.match(html, /Fixed a bad assertion\./);
  assert.match(html, /rm -rf \//);
});

test('renders dependency additions/removals, installs, and config files', () => {
  const story = sampleStory({
    report: {
      plan: 'p', decisions: [], outcome: 'completed', outcome_note: null,
      dependencies: {
        manifests: [{ rel: 'package.json', turns: [1], added: ['zod'], removed: ['lodash'] }],
        installs: [{ turn: 1, command: 'npm install zod', ok: true }],
        config_files: [{ rel: 'tsconfig.json', turns: [1] }],
      },
      git: null,
    },
  });
  const html = renderReportLens(story);

  assert.match(html, /package\.json/);
  assert.match(html, /zod/);
  assert.match(html, /lodash/);
  assert.match(html, /npm install zod/);
  assert.match(html, /tsconfig\.json/);
});

test('renders git branch, commit range, commits made, and working tree status', () => {
  const story = sampleStory({
    report: {
      plan: 'p', decisions: [], outcome: 'completed', outcome_note: null,
      dependencies: { manifests: [], installs: [], config_files: [] },
      git: {
        branch: 'main',
        start_commit: { sha: 'abc1234abc1234abc1234abc1234abc1234abcd', subject: 'Initial commit' },
        end_commit: { sha: 'def5678def5678def5678def5678def5678defg', subject: 'Add feature' },
        commits: [{ sha: 'def5678def5678def5678def5678def5678defg', subject: 'Add feature', turn: 1 }],
        dirty: true,
        status: { modified: 2, added: 1, deleted: 0, untracked: 1 },
      },
    },
  });
  const html = renderReportLens(story);

  assert.match(html, /main/);
  assert.match(html, /abc1234/);
  assert.match(html, /def5678/);
  assert.match(html, /Add feature/);
});

test('never emits a hunk table, even with edits present', () => {
  const story = sampleStory();
  story.turns[0].edits = [{
    id: 'e1', tool: 'Edit', file: '/proj/a.ts', rel: 'a.ts', kind: 'update', result: 'ok',
    hunks: [{ oldStart: 1, oldLines: 1, newStart: 1, newLines: 1, lines: ['-a', '+b'] }],
    stats: { added: 1, removed: 1 },
  }];
  const html = renderReportLens(story);
  assert.doesNotMatch(html, /<table class="hunk">/);
});

test('degrades gracefully when report is missing entirely', () => {
  const story = sampleStory();
  delete story.report;
  const html = renderReportLens(story);
  assert.match(html, /None recorded\./);
});

test('a failed test run shows its output once, under Tests & validation, and its command row points there', () => {
  const story = sampleStory();
  story.turns[0].bash = [
    { id: 'b1', command: 'npm test', description: '', category: 'test', ok: false, exit_code: 1, rejected: false, interrupted: false, output_tail: 'Expected 2 to equal 3' },
    { id: 'b2', command: 'curl x', description: '', category: 'other', ok: false, exit_code: 7, rejected: false, interrupted: false, output_tail: 'Could not resolve host' },
  ];
  const html = renderReportLens(story);

  assert.equal(html.split('Expected 2 to equal 3').length - 1, 1);
  assert.ok(html.indexOf('Expected 2 to equal 3') > html.indexOf('Tests & validation'));
  assert.match(html, /output under Tests &amp; validation/);
  // Output of a failed command that is not a validation run stays with it.
  assert.equal(html.split('Could not resolve host').length - 1, 1);
});

test('a long command shows its opening and says how much was left out', async () => {
  const { COMMAND_SHOWN_MAX } = await import('../cli/src/render/report.mjs');
  const story = sampleStory();
  const command = `python3 - <<'EOF'\n${'x'.repeat(COMMAND_SHOWN_MAX + 500)}\nEOF`;
  story.turns[0].bash = [
    { id: 'b1', command, description: '', category: 'other', ok: true, exit_code: 0, rejected: false, interrupted: false, output_tail: '' },
  ];
  const html = renderReportLens(story);

  assert.match(html, /python3 - &lt;&lt;&#39;EOF&#39;/);
  assert.match(html, new RegExp(`… ${command.length - COMMAND_SHOWN_MAX} more characters`));
  assert.doesNotMatch(html, /x{1000}/);
});

test('a long command list shows the first rows and carries the rest inert behind "Show all"', async () => {
  const { COMMANDS_SHOWN } = await import('../cli/src/render/report.mjs');
  const story = sampleStory();
  const total = COMMANDS_SHOWN + 50;
  story.turns[0].bash = Array.from({ length: total }, (_, i) => (
    { id: `b${i}`, command: `echo cmd-${i}`, description: '', category: 'other', ok: true, exit_code: 0, rejected: false, interrupted: false, output_tail: '' }
  ));
  const html = renderReportLens(story);
  const [live, rest] = html.split('<div class="cmd-rest"><template data-inert>');

  assert.ok(rest, 'the overflow is wrapped in an inert template');
  assert.equal(live.split('class="cmd-row"').length - 1, COMMANDS_SHOWN);
  assert.match(live, new RegExp(`echo cmd-${COMMANDS_SHOWN - 1}<`));
  assert.match(rest, new RegExp(`echo cmd-${COMMANDS_SHOWN}<`));
  assert.match(rest, new RegExp(`<button type="button" class="show-more">Show all ${total} commands</button>`));
});

test('a short command list has no "Show all"', () => {
  const html = renderReportLens(sampleStory());
  assert.doesNotMatch(html, /show-more|cmd-rest/);
});

function withMetrics(story) {
  const pt = (index, output, duration_ms) => ({
    index, duration_ms, duration_source: 'transcript',
    input_tokens: 1, output_tokens: output, cache_read_tokens: 0, cache_creation_tokens: 0,
    api_calls: 1, complete: true, subagents: null, share: { output: null, input: null, duration: null },
  });
  story.turns.push({ index: 2, id: 'u2', prompt: 'Write a README', summary: 'Wrote the README.', edits: [], bash: [], errors: [], plan: null });
  story.metrics = {
    execution: { duration_ms: 330000, turns: 2, tool_calls: 9, failed_tool_calls: 1, rejected_tool_calls: 0, commands: 2, failed_commands: 1, retries: 1 },
    code: { files_changed: 1, lines_added: 3, lines_removed: 0, edits: 1, files_edited_repeatedly: [] },
    validation: { commands: 1, passed: 1, failed: 0, final_state: 'passed', last_command: 'npm test' },
    reads: { files_read: 2, tool_calls: 3 },
    usage: { input_tokens: 10, output_tokens: 3000, cache_read_tokens: 0, cache_creation_tokens: 0, total_cost_usd: 0.2, models: ['claude-opus-5-5'], source: 'cost-state', complete: true },
    turns: [pt(1, 1000, 60000), pt(2, 2000, 120000)],
  };
  return story;
}

const headings = (html) => [...html.matchAll(/<h2>[^]*?<span>([^<]+)<\/span><\/h2>/g)].map((m) => m[1]);

test('a story with metrics carries the session metrics after the outcome and the metrics groups at the end', () => {
  const html = renderReportLens(withMetrics(sampleStory()));
  assert.deepEqual(headings(html), [
    'Outcome & summary', 'Session metrics', 'Plan / intent', 'Decisions', 'Commands executed',
    'Tests & validation', 'Errors encountered', 'Dependencies', 'Git state', 'Metrics',
  ]);
  assert.match(html, /9<\/span> <span class="stat-label">tool calls/);
  assert.match(html, /Where it went/);
  assert.match(html, /class="metrics-jump" data-jump-turn="2"/);
  for (const h of ['Execution', 'Code', 'Validation', 'Reads', 'Usage']) assert.match(html, new RegExp(`<h3>${h}</h3>`));
  assert.doesNotMatch(html, /<table class="hunk">/);
});

test('a story without metrics renders the eight report sections and nothing more', () => {
  const html = renderReportLens(sampleStory());
  assert.equal(headings(html).length, 8);
  assert.doesNotMatch(html, /Session metrics|Where it went|metrics-groups/);
});
