import { test } from 'node:test';
import assert from 'node:assert/strict';
import { fillBasesFromDisk } from '../session-story/src/ir/disk-base.mjs';

function story(edits) {
  return { turns: [{ index: 1, edits }] };
}
function edit(id, extra = {}) {
  return {
    id, tool: 'Edit', file: '/proj/a.txt', rel: 'a.txt', kind: 'update', result: 'ok',
    hunks: [], stats: { added: 1, removed: 1 }, before: null, after: null,
    old_string: null, new_string: null, replace_all: false, ...extra,
  };
}

test('recovers a base from the file on disk by reversing the edits that led to it', () => {
  const s = story([
    edit('e1', { old_string: 'a', new_string: 'A' }),
    edit('e2', { old_string: 'b', new_string: 'B' }),
  ]);

  const filled = fillBasesFromDisk(s, () => 'A\nB\n');

  assert.equal(filled, 1);
  assert.equal(s.turns[0].edits[1].after, 'A\nB\n');
  assert.equal(s.turns[0].edits[1].base_source, 'disk');
});

test('leaves the story untouched when the file on disk no longer matches the session', () => {
  const s = story([edit('e1', { old_string: 'a', new_string: 'A' })]);

  const filled = fillBasesFromDisk(s, () => 'something else entirely\n');

  assert.equal(filled, 0);
  assert.equal(s.turns[0].edits[0].after, null);
  assert.equal(s.turns[0].edits[0].base_source, undefined);
});

test('leaves files alone when the transcript already carried a snapshot', () => {
  const s = story([edit('e1', { before: 'a\n', old_string: 'a', new_string: 'A' })]);

  const filled = fillBasesFromDisk(s, () => { throw new Error('should not read disk'); });

  assert.equal(filled, 0);
  assert.equal(s.turns[0].edits[0].base_source, undefined);
});

test('skips a file that cannot be read and one too large to render in full', () => {
  const missing = story([edit('e1', { old_string: 'a', new_string: 'A' })]);
  assert.equal(fillBasesFromDisk(missing, () => { throw new Error('ENOENT'); }), 0);

  const huge = story([edit('e1', { old_string: 'a', new_string: 'A' })]);
  assert.equal(fillBasesFromDisk(huge, () => 'x\n'.repeat(9000)), 0);
});

test('never reads a file outside the project from disk', () => {
  const s = story([edit('e1', { file: '/home/me/.zshrc', rel: '../home/me/.zshrc', outside_cwd: true, old_string: 'a', new_string: 'A' })]);
  let read = false;

  const filled = fillBasesFromDisk(s, () => { read = true; return 'A\n'; });

  assert.equal(filled, 0);
  assert.equal(read, false);
  assert.equal(s.turns[0].edits[0].after, null);
});
