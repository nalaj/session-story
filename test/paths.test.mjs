import { test } from 'node:test';
import assert from 'node:assert/strict';
import { relativeTo, resolveIn, isOutsideRel } from '../cli/src/transcript/paths.mjs';

test('relativeTo uses the session cwd\'s path style, never the host\'s, and always "/"', () => {
  assert.equal(relativeTo('/proj/src/Panel.tsx', '/proj'), 'src/Panel.tsx');
  assert.equal(relativeTo('C:\\proj\\src\\Panel.tsx', 'C:\\proj'), 'src/Panel.tsx');
  assert.equal(relativeTo('c:/proj/src/a.js', 'C:\\proj'), 'src/a.js');
  assert.equal(relativeTo('/tmp/scratch.md', '/proj'), '../tmp/scratch.md');
  assert.equal(relativeTo('D:\\other\\x.txt', 'C:\\proj'), 'D:/other/x.txt');
});

test('relativeTo returns the input when there is no cwd or the path is the cwd itself', () => {
  assert.equal(relativeTo('/proj/a.js', null), '/proj/a.js');
  assert.equal(relativeTo('/proj', '/proj'), '/proj');
  assert.equal(relativeTo('', '/proj'), '');
});

test('resolveIn joins a git-style relative path onto the cwd in the cwd\'s own style', () => {
  assert.equal(resolveIn('/proj', 'src/app.py'), '/proj/src/app.py');
  assert.equal(resolveIn('C:\\proj', 'src/app.py'), 'C:\\proj\\src\\app.py');
  assert.equal(resolveIn(null, 'src/app.py'), 'src/app.py');
});

test('isOutsideRel flags paths that climb out of the project or stay absolute', () => {
  assert.equal(isOutsideRel('src/a.js'), false);
  assert.equal(isOutsideRel('..foo/a.js'), false);
  assert.equal(isOutsideRel('../tmp/a.js'), true);
  assert.equal(isOutsideRel('..'), true);
  assert.equal(isOutsideRel('/tmp/a.js'), true);
  assert.equal(isOutsideRel('D:/other/x.txt'), true);
  assert.equal(isOutsideRel(''), false);
});
