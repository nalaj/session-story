import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  allCommands, allErrors, shortSha, inProject, VALIDATION_CATEGORIES, validationRuns, lastValidation,
} from '../cli/src/ir/selectors.mjs';

const turns = [
  { index: 1, bash: [{ command: 'ls', category: 'other', ok: true }, { command: 'npm test', category: 'test', ok: false }], errors: [{ tool: 'Bash', message: 'x' }] },
  { index: 2, bash: [{ command: 'npm run lint', category: 'lint', ok: true }] },
  { index: 3 },
];

test('allCommands and allErrors flatten turns and tag each entry with its turn', () => {
  assert.deepEqual(allCommands(turns).map((c) => [c.command, c.turnIndex]), [['ls', 1], ['npm test', 1], ['npm run lint', 2]]);
  assert.deepEqual(allErrors(turns), [{ tool: 'Bash', message: 'x', turnIndex: 1 }]);
});

test('validationRuns keeps test, lint and build commands; lastValidation is the last one or null', () => {
  assert.deepEqual([...VALIDATION_CATEGORIES].sort(), ['build', 'lint', 'test']);
  assert.deepEqual(validationRuns(turns).map((c) => c.command), ['npm test', 'npm run lint']);
  assert.equal(lastValidation(turns).command, 'npm run lint');
  assert.equal(lastValidation([{ index: 1, bash: [] }]), null);
});

test('shortSha and inProject', () => {
  assert.equal(shortSha('abcdef1234'), 'abcdef1');
  assert.equal(shortSha(null), '');
  assert.deepEqual(inProject([{ rel: 'a' }, { rel: 'b', outside_cwd: true }]), [{ rel: 'a' }]);
});
