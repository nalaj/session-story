import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildDependencies } from '../cli/src/ir/dependencies.mjs';

function story(turns) {
  return { session: { id: 's', cwd: '/proj' }, turns };
}

function turn(index, edits = [], bash = []) {
  return { index, id: `t${index}`, prompt: 'p', summary: '', edits, bash };
}

test('detects added and removed package.json dependencies from a Write (full before/after content)', () => {
  const before = JSON.stringify({ name: 'x', dependencies: { lodash: '^4.0.0' } });
  const after = JSON.stringify({ name: 'x', dependencies: { react: '^18.0.0' } });
  const s = story([
    turn(1, [{
      id: 'e1', tool: 'Write', rel: 'package.json', file: '/proj/package.json',
      kind: 'update', result: 'ok', hunks: [], before, after,
      old_string: null, new_string: null, replace_all: false,
    }]),
  ]);

  const deps = buildDependencies(s);

  assert.equal(deps.manifests.length, 1);
  const [m] = deps.manifests;
  assert.equal(m.rel, 'package.json');
  assert.deepEqual(m.turns, [1]);
  assert.deepEqual(m.added, ['react']);
  assert.deepEqual(m.removed, ['lodash']);
});

test('reconstructs package.json before/after from an Edit\'s old_string/new_string when no full content is present', () => {
  const before = '{\n  "dependencies": {\n    "lodash": "^4.0.0"\n  }\n}\n';
  const oldStr = '"lodash": "^4.0.0"';
  const newStr = '"lodash": "^4.0.0",\n    "zod": "^3.0.0"';
  const s = story([
    turn(1, [{
      id: 'e1', tool: 'Edit', rel: 'package.json', file: '/proj/package.json',
      kind: 'update', result: 'ok', hunks: [], before, after: null,
      old_string: oldStr, new_string: newStr, replace_all: false,
    }]),
  ]);

  const deps = buildDependencies(s);

  assert.deepEqual(deps.manifests[0].added, ['zod']);
});

test('detects added and removed requirements.txt entries from hunk lines', () => {
  const s = story([
    turn(1, [{
      id: 'e1', tool: 'Edit', rel: 'requirements.txt', file: '/proj/requirements.txt',
      kind: 'update', result: 'ok', before: null, after: null,
      old_string: null, new_string: null, replace_all: false,
      hunks: [{
        oldStart: 1, oldLines: 2, newStart: 1, newLines: 2,
        lines: [' flask==2.0.0', '-requests==2.25.0', '+httpx==0.23.0'],
      }],
    }]),
  ]);

  const deps = buildDependencies(s);

  const [m] = deps.manifests;
  assert.equal(m.rel, 'requirements.txt');
  assert.deepEqual(m.added, ['httpx']);
  assert.deepEqual(m.removed, ['requests']);
});

test('collects install commands from bash entries', () => {
  const s = story([
    turn(1, [], [
      { id: 'b1', command: 'npm install react', category: 'install', ok: true },
      { id: 'b2', command: 'ls -la', category: 'other', ok: true },
    ]),
  ]);

  const deps = buildDependencies(s);

  assert.equal(deps.installs.length, 1);
  assert.equal(deps.installs[0].command, 'npm install react');
  assert.equal(deps.installs[0].turn, 1);
  assert.equal(deps.installs[0].ok, true);
});

test('collects config file edits, excluding manifests', () => {
  const s = story([
    turn(1, [
      { id: 'e1', tool: 'Edit', rel: 'tsconfig.json', file: '/proj/tsconfig.json', kind: 'update', result: 'ok', hunks: [], before: null, after: null, old_string: null, new_string: null, replace_all: false },
      { id: 'e2', tool: 'Edit', rel: '.github/workflows/ci.yml', file: '/proj/.github/workflows/ci.yml', kind: 'update', result: 'ok', hunks: [], before: null, after: null, old_string: null, new_string: null, replace_all: false },
      { id: 'e3', tool: 'Edit', rel: 'src/index.js', file: '/proj/src/index.js', kind: 'update', result: 'ok', hunks: [], before: null, after: null, old_string: null, new_string: null, replace_all: false },
    ]),
  ]);

  const deps = buildDependencies(s);

  const rels = deps.config_files.map((c) => c.rel).sort();
  assert.deepEqual(rels, ['.github/workflows/ci.yml', 'tsconfig.json']);
});

test('returns empty arrays for a story with no manifest, install or config edits', () => {
  const s = story([turn(1, [
    { id: 'e1', tool: 'Edit', rel: 'src/index.js', file: '/proj/src/index.js', kind: 'update', result: 'ok', hunks: [], before: null, after: null, old_string: null, new_string: null, replace_all: false },
  ])]);

  const deps = buildDependencies(s);

  assert.deepEqual(deps, { manifests: [], installs: [], config_files: [] });
});

test('skips errored edits when scanning manifests and config files', () => {
  const s = story([turn(1, [
    { id: 'e1', tool: 'Edit', rel: 'package.json', file: '/proj/package.json', kind: 'update', result: 'error', error: 'boom', hunks: [], before: null, after: null, old_string: null, new_string: null, replace_all: false },
  ])]);

  const deps = buildDependencies(s);

  assert.deepEqual(deps.manifests, []);
});
