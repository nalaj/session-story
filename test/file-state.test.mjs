import { test } from 'node:test';
import assert from 'node:assert/strict';
import { chainFileStates, buildFileBases } from '../cli/src/ir/file-state.mjs';

function edit(id, extra = {}) {
  return {
    id, tool: 'Edit', file: '/p/a.txt', rel: 'a.txt', kind: 'update', result: 'ok',
    hunks: [], stats: { added: 0, removed: 0 }, before: null, after: null,
    old_string: null, new_string: null, replace_all: false, ...extra,
  };
}

test('chainFileStates carries a known snapshot forward to later edits of the same file', () => {
  const bases = chainFileStates([
    edit('e1', { before: 'a\nb\n', old_string: 'a', new_string: 'A' }),
    edit('e2', { old_string: 'b', new_string: 'B' }),
  ]);

  assert.equal(bases.get('e1'), 'a\nb\n');
  assert.equal(bases.get('e2'), 'A\nb\n');
});

test('chainFileStates reverses a later snapshot to recover an earlier pre-edit state', () => {
  const bases = chainFileStates([
    edit('e1', { old_string: 'a', new_string: 'A' }),
    edit('e2', { before: 'A\nb\n', old_string: 'b', new_string: 'B' }),
  ]);

  assert.equal(bases.get('e1'), 'a\nb\n');
  assert.equal(bases.get('e2'), 'A\nb\n');
});

test('chainFileStates treats a created file as empty beforehand and uses its content for later edits', () => {
  const bases = chainFileStates([
    edit('e1', { kind: 'create', after: 'x\ny\n' }),
    edit('e2', { old_string: 'x', new_string: 'X' }),
  ]);

  assert.equal(bases.get('e1'), '');
  assert.equal(bases.get('e2'), 'x\ny\n');
});

test('chainFileStates yields null when the transcript carried no snapshot for the file at all', () => {
  const bases = chainFileStates([edit('e1', { old_string: 'a', new_string: 'A' })]);

  assert.equal(bases.get('e1'), null);
});

test('chainFileStates stops chaining rather than guessing when a replacement is ambiguous', () => {
  const bases = chainFileStates([
    edit('e1', { before: 'a\na\n', old_string: 'a', new_string: 'A' }),
    edit('e2', { old_string: 'x', new_string: 'X' }),
  ]);

  assert.equal(bases.get('e1'), 'a\na\n');
  assert.equal(bases.get('e2'), null);
});

test('buildFileBases chains each file of a story independently', () => {
  const story = { turns: [
    { index: 1, edits: [edit('e1', { before: 'a\n', old_string: 'a', new_string: 'A' })] },
    { index: 2, edits: [
      edit('e2', { old_string: 'A', new_string: 'AA' }),
      edit('o1', { rel: 'b.txt', file: '/p/b.txt', before: 'z\n' }),
    ] },
  ] };

  const bases = buildFileBases(story);

  assert.equal(bases.get('e2'), 'A\n');
  assert.equal(bases.get('o1'), 'z\n');
});
