import { test } from 'node:test';
import assert from 'node:assert/strict';
import { validateStory } from '../cli/src/ir/validate.mjs';

function minimalStory(overrides = {}) {
  return {
    schema_version: 1,
    session: { id: 's1', cwd: '/proj', started_at: null, ended_at: null, duration_ms: 0, summary: '' },
    turns: [
      { index: 1, id: 'u1', at: null, prompt: 'do a thing', summary: '', edits: [] },
    ],
    files: [],
    totals: { turns: 1, files: 0, added: 0, removed: 0, edits: 0 },
    ...overrides,
  };
}

test('accepts a structurally valid story in non-strict mode even with empty summaries', () => {
  const result = validateStory(minimalStory());
  assert.equal(result.valid, true);
  assert.deepEqual(result.errors, []);
});

test('reports a clear error when a required top-level field is missing', () => {
  const story = minimalStory();
  delete story.turns;

  const result = validateStory(story);

  assert.equal(result.valid, false);
  assert.ok(result.errors.some((e) => /turns/.test(e)));
});

test('reports a clear error when an edit is missing a required field', () => {
  const story = minimalStory();
  story.turns[0].edits.push({ id: 'e1', tool: 'Edit', file: '/proj/a.ts' /* missing rel, hunks, stats */ });

  const result = validateStory(story);

  assert.equal(result.valid, false);
  assert.ok(result.errors.some((e) => /turns\[0\]\.edits\[0\]/.test(e)));
});

test('strict mode requires the session summary and every turn summary to be non-empty', () => {
  const result = validateStory(minimalStory(), { strict: true });

  assert.equal(result.valid, false);
  assert.ok(result.errors.some((e) => /session\.summary/.test(e)));
  assert.ok(result.errors.some((e) => /turns\[0\]\.summary/.test(e)));
});

test('non-strict mode tolerates a story with no report field at all', () => {
  const story = minimalStory();
  assert.equal(story.report, undefined);

  const result = validateStory(story);

  assert.equal(result.valid, true);
});

test('strict mode requires report.plan, report.outcome, and report.decisions', () => {
  const story = minimalStory();
  story.session.summary = 'Refactored the Panel component.';
  story.turns[0].summary = 'Added a title prop.';

  const result = validateStory(story, { strict: true });

  assert.equal(result.valid, false);
  assert.ok(result.errors.some((e) => /report\.plan/.test(e)));
  assert.ok(result.errors.some((e) => /report\.outcome/.test(e)));
  assert.ok(result.errors.some((e) => /report\.decisions/.test(e)));
});

test('strict mode rejects an outcome outside the known set', () => {
  const story = minimalStory({
    report: { plan: 'Fix the bug.', decisions: [], outcome: 'done', outcome_note: null },
  });
  story.session.summary = 's';
  story.turns[0].summary = 't';

  const result = validateStory(story, { strict: true });

  assert.equal(result.valid, false);
  assert.ok(result.errors.some((e) => /report\.outcome/.test(e)));
});

test('strict mode passes once every summary and every report field is filled in', () => {
  const story = minimalStory({
    report: { plan: 'Add a title prop to Panel.', decisions: ['Kept the existing prop pattern.'], outcome: 'completed', outcome_note: null },
  });
  story.session.title = 'Panel title prop';
  story.session.summary = 'Refactored the Panel component.';
  story.turns[0].summary = 'Added a title prop.';

  const result = validateStory(story, { strict: true });

  assert.equal(result.valid, true);
  assert.deepEqual(result.errors, []);
});

test('strict mode requires a session title', () => {
  const story = minimalStory({
    report: { plan: 'p', decisions: [], outcome: 'completed', outcome_note: null },
  });
  story.session.summary = 'Refactored the Panel component.';
  story.turns[0].summary = 'Added a title prop.';

  const result = validateStory(story, { strict: true });

  assert.equal(result.valid, false);
  assert.ok(result.errors.some((e) => /session\.title/.test(e)));
});

test('strict mode rejects an overlong session title or summary', () => {
  const story = minimalStory({
    report: { plan: 'p', decisions: [], outcome: 'completed', outcome_note: null },
  });
  story.session.title = 'T'.repeat(61);
  story.session.summary = 'S'.repeat(241);
  story.turns[0].summary = 'Added a title prop.';

  const result = validateStory(story, { strict: true });

  assert.equal(result.valid, false);
  assert.ok(result.errors.some((e) => /session\.title.*60/.test(e)));
  assert.ok(result.errors.some((e) => /session\.summary.*240/.test(e)));
});

test('accepts a story with no trace, metrics or environment (older story.json)', () => {
  assert.equal(validateStory(minimalStory()).valid, true);
});

test('accepts a well-formed trace and metrics', () => {
  const story = minimalStory({
    trace: { events: [{ id: 'u1', kind: 'prompt', turn: 1, status: 'ok' }, { id: 't1', kind: 'tool', turn: 1, status: 'unknown' }], cost_states: [] },
    metrics: { execution: {}, code: {}, validation: { final_state: 'none' }, reads: {}, usage: {} },
  });
  story.turns[0].duration_source = 'derived';
  assert.deepEqual(validateStory(story).errors, []);
});

test('rejects an event with an unknown kind or status, and a non-array events list', () => {
  const bad = minimalStory({ trace: { events: [{ id: 'x', kind: 'command', turn: 1, status: 'ok' }, { id: 'y', kind: 'tool', turn: 1, status: 'crashed' }] } });
  const result = validateStory(bad);
  assert.equal(result.valid, false);
  assert.ok(result.errors.some((e) => /trace\.events\[0\]\.kind/.test(e)));
  assert.ok(result.errors.some((e) => /trace\.events\[1\]\.status/.test(e)));
  assert.ok(validateStory(minimalStory({ trace: { events: 'nope' } })).errors.some((e) => /trace\.events must be an array/.test(e)));
});

test('rejects metrics missing a group or with an unknown final_state, and a bad duration_source', () => {
  const result = validateStory(minimalStory({ metrics: { execution: {}, code: {}, validation: { final_state: 'green' }, usage: {} } }));
  assert.ok(result.errors.some((e) => /metrics\.reads/.test(e)));
  assert.ok(result.errors.some((e) => /final_state/.test(e)));
  const story = minimalStory();
  story.turns[0].duration_source = 'guess';
  assert.ok(validateStory(story).errors.some((e) => /turns\[0\]\.duration_source/.test(e)));
});

test('accepts metrics with or without a per-turn list, and rejects a malformed one', () => {
  const groups = { execution: {}, code: {}, validation: { final_state: 'none' }, reads: {}, usage: {} };
  assert.deepEqual(validateStory(minimalStory({ metrics: { ...groups } })).errors, []);
  assert.deepEqual(validateStory(minimalStory({ metrics: { ...groups, turns: [{ index: 1, duration_source: 'derived' }] } })).errors, []);
  assert.ok(validateStory(minimalStory({ metrics: { ...groups, turns: 'x' } })).errors.some((e) => /metrics\.turns must be an array/.test(e)));
  const bad = validateStory(minimalStory({ metrics: { ...groups, turns: [{ index: 'one', duration_source: 'guess' }] } })).errors;
  assert.ok(bad.some((e) => /metrics\.turns\[0\]\.index/.test(e)));
  assert.ok(bad.some((e) => /metrics\.turns\[0\]\.duration_source/.test(e)));
});

test("strict mode requires an answer on turns that have replies, and caps its length", () => {
  const story = minimalStory({
    report: { plan: 'p', decisions: [], outcome: 'completed', outcome_note: null },
  });
  story.session.title = 'Title';
  story.session.summary = 'Summary.';
  story.turns[0].summary = 'Did it.';
  story.turns[0].replies = [{ at: null, text: 'Done.' }];

  assert.match(validateStory(story, { strict: true }).errors.join('\n'), /turns\[0\]\.answer is required in strict mode/);
  // Non-strict stories (and older ones) render without an answer.
  assert.equal(validateStory(story).valid, true);

  story.turns[0].answer = 'Made the change and the tests pass.';
  assert.deepEqual(validateStory(story, { strict: true }).errors, []);

  story.turns[0].answer = 'x'.repeat(401);
  assert.match(validateStory(story).errors.join('\n'), /turns\[0\]\.answer must be at most 400 characters/);
});
