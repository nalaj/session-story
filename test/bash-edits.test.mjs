import { test } from 'node:test';
import assert from 'node:assert/strict';
import { analyzeBashCommand } from '../cli/src/transcript/bash-edits.mjs';

test('a heredoc script that rewrites a file marks its paths as writes', () => {
  // The real shape auto-mode sessions produce: the path is bound to a
  // variable, so the write call itself names no literal path.
  const a = analyzeBashCommand([
    "python3 - <<'EOF'",
    "p='web/src/components/charts/ScatterPlotVQ.tsx'",
    "s=open(p).read()",
    "s=s.replace('a','b')",
    "open(p,'w').write(s)",
    'EOF',
  ].join('\n'));

  assert.deepEqual(a.writes, ['web/src/components/charts/ScatterPlotVQ.tsx']);
  assert.equal(a.bulk, false);
});

test('a read-only command contributes mentions, never writes', () => {
  const a = analyzeBashCommand('cat web/src/components/charts/ScatterPlotVQ.tsx');

  assert.deepEqual(a.writes, []);
  assert.deepEqual(a.mentions, ['web/src/components/charts/ScatterPlotVQ.tsx']);
});

test('an arrow function inside a quoted script is not read as a redirect', () => {
  // `=>` and ` > ` appear constantly in JS/TSX payloads; neither writes a file.
  const a = analyzeBashCommand('grep -n "formatter={(v) => Number(v)}" web/app.tsx');

  assert.deepEqual(a.writes, []);
  assert.deepEqual(a.mentions, ['web/app.tsx']);
});

test('a comparison in a heredoc is not a redirect, but a real redirect is', () => {
  assert.deepEqual(analyzeBashCommand('node -e "if (x > 1) log()"').writes, []);
  assert.deepEqual(analyzeBashCommand('echo hi > notes/out.txt').writes, ['notes/out.txt']);
  assert.deepEqual(analyzeBashCommand('npx tsc --noEmit 2>&1 | head -20').writes, []);
});

test('discards flags, URLs and /dev sinks when collecting paths', () => {
  const a = analyzeBashCommand('grep -ril "q" --include=*.tsx . | grep -v node_modules > /dev/null');

  assert.deepEqual(a.writes, []);
  assert.deepEqual(a.mentions, []);
});

test('in-place editors, moves and deletes count as writes', () => {
  assert.deepEqual(analyzeBashCommand("sed -i '' 's/a/b/' src/app.py").writes, ['src/app.py']);
  assert.deepEqual(analyzeBashCommand('mv src/old.ts src/new.ts').writes, ['src/old.ts', 'src/new.ts']);
  assert.deepEqual(analyzeBashCommand('rm -rf build/out.js').writes, ['build/out.js']);
  assert.deepEqual(analyzeBashCommand("node -e \"fs.writeFileSync('a/b.json', x)\"").writes, ['a/b.json']);
});

test('whole-tree tools are bulk writers: they change files they never name', () => {
  for (const cmd of ['npx prettier --write .', 'npm install', 'cargo fmt', 'ruff format api/']) {
    assert.equal(analyzeBashCommand(cmd).bulk, true, cmd);
  }
  assert.equal(analyzeBashCommand('cat README.md').bulk, false);
});
