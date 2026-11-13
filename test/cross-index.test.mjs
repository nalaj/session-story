import { test } from 'node:test';
import assert from 'node:assert/strict';
import { crossIndexFiles } from '../cli/src/ir/cross-index.mjs';

function edit(rel, added, removed) {
  return { rel, stats: { added, removed } };
}

test('indexes files touched by a single turn with churn=false', () => {
  const turns = [
    { index: 1, edits: [edit('src/a.ts', 3, 1)] },
  ];

  const files = crossIndexFiles(turns);

  assert.equal(files.length, 1);
  assert.equal(files[0].rel, 'src/a.ts');
  assert.deepEqual(files[0].turns, [1]);
  assert.equal(files[0].churn, false);
  assert.deepEqual(files[0].stats, { added: 3, removed: 1 });
});

test('flags churn=true and sums stats for a file touched across multiple turns', () => {
  const turns = [
    { index: 1, edits: [edit('src/a.ts', 3, 1)] },
    { index: 2, edits: [edit('src/b.ts', 5, 0)] },
    { index: 3, edits: [edit('src/a.ts', 1, 1)] },
  ];

  const files = crossIndexFiles(turns);
  const a = files.find((f) => f.rel === 'src/a.ts');
  const b = files.find((f) => f.rel === 'src/b.ts');

  assert.deepEqual(a.turns, [1, 3]);
  assert.equal(a.churn, true);
  assert.deepEqual(a.stats, { added: 4, removed: 2 });
  assert.equal(b.churn, false);
});

test('guesses a language from the file extension', () => {
  const turns = [{ index: 1, edits: [edit('src/a.ts', 1, 0), edit('README.md', 1, 0), edit('Makefile', 1, 0)] }];

  const files = crossIndexFiles(turns);

  assert.equal(files.find((f) => f.rel === 'src/a.ts').language, 'typescript');
  assert.equal(files.find((f) => f.rel === 'README.md').language, 'markdown');
  assert.equal(files.find((f) => f.rel === 'Makefile').language, null);
});

test('carries the out-of-project flag onto the file entry', async () => {
  const { crossIndexFiles } = await import('../cli/src/ir/cross-index.mjs');
  const files = crossIndexFiles([
    { index: 1, edits: [
      { rel: 'src/a.ts', outside_cwd: false, stats: { added: 1, removed: 0 } },
      { rel: '../../tmp/s.json', outside_cwd: true, stats: { added: 2, removed: 0 } },
    ] },
  ]);

  assert.equal(files.find((f) => f.rel === 'src/a.ts').outside_cwd, false);
  assert.equal(files.find((f) => f.rel === '../../tmp/s.json').outside_cwd, true);
});
