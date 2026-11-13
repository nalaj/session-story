import { test } from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import { CLIENT_SOURCE, hunksHtml, spliceRows, fullTableHtml } from '../cli/src/render/hunk-html.mjs';
import { renderHunk } from '../cli/src/render/diff.mjs';
import { renderFullFile } from '../cli/src/render/full-view.mjs';

// The page runs CLIENT_SOURCE on its own, so load it the same way: a fresh
// context with nothing else defined.
function client() {
  return vm.runInNewContext(`${CLIENT_SOURCE}\n;({ hunksHtml, hunkTableHtml, spliceRows, fullTableHtml })`, {});
}

const TRICKY = [
  { oldStart: 1, oldLines: 3, newStart: 1, newLines: 4, lines: [
    ' const a = "<b>" & \'c\';',
    '-</script><!--<script>',
    '+</script>\r',
    '+naïve — 日本語',
    ' end',
  ] },
  { oldStart: 9, oldLines: 1, newStart: 10, newLines: 1, lines: ['-x', '+y'] },
];

test('CLIENT_SOURCE has no module syntax and runs in an empty context', () => {
  assert.doesNotMatch(CLIENT_SOURCE, /^\s*(import|export)\b/m);
  const fns = client();
  for (const name of ['hunksHtml', 'hunkTableHtml', 'spliceRows', 'fullTableHtml']) {
    assert.equal(typeof fns[name], 'function', name);
  }
});

test('the page renders hunks byte-for-byte as the Node renderer does', () => {
  const fns = client();
  assert.equal(fns.hunksHtml(TRICKY), TRICKY.map(renderHunk).join(''));
  assert.equal(fns.hunksHtml(TRICKY), hunksHtml(TRICKY));
  assert.match(fns.hunksHtml(TRICKY), /&lt;\/script&gt;&lt;!--&lt;script&gt;/);
});

test('the page splices full files byte-for-byte as the Node renderer does', () => {
  const fns = client();
  const base = 'line1\n const a = "<b>" & \'c\';\n</script><!--<script>\n end\n5\n6\n7\n8\nx\n10\n';
  const hunks = [
    { oldStart: 2, oldLines: 3, newStart: 2, newLines: 4, lines: TRICKY[0].lines },
    { oldStart: 9, oldLines: 1, newStart: 10, newLines: 1, lines: ['-x', '+y'] },
  ];
  const expected = renderFullFile(base, hunks);
  assert.ok(expected.startsWith('<table class="hunk full">'));
  // Rows carry plain objects across the context boundary; render in-context.
  assert.equal(fns.fullTableHtml(fns.spliceRows(base, hunks)), expected);
  assert.equal(fullTableHtml(spliceRows(base, hunks)), expected);
});
