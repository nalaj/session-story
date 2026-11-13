import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spliceFullFile, renderFullFile, FULL_VIEW_MAX_LINES } from '../cli/src/render/full-view.mjs';

test('spliceFullFile surrounds each hunk with the file lines it never touched', () => {
  const rows = spliceFullFile('l1\nl2\nl3\nl4\nl5\n', [
    { oldStart: 3, oldLines: 1, newStart: 3, newLines: 1, lines: ['-l3', '+L3'] },
  ]);

  assert.deepEqual(rows.map((r) => [r.kind, r.oldNo, r.newNo, r.text]), [
    ['ctx', 1, 1, 'l1'],
    ['ctx', 2, 2, 'l2'],
    ['del', 3, null, 'l3'],
    ['add', null, 3, 'L3'],
    ['ctx', 4, 4, 'l4'],
    ['ctx', 5, 5, 'l5'],
  ]);
});

test('spliceFullFile handles hunks on the very first and very last line', () => {
  const rows = spliceFullFile('a\nb\nc\n', [
    { oldStart: 1, oldLines: 1, newStart: 1, newLines: 1, lines: ['-a', '+A'] },
    { oldStart: 3, oldLines: 1, newStart: 3, newLines: 1, lines: ['-c', '+C'] },
  ]);

  assert.deepEqual(rows.map((r) => r.kind), ['del', 'add', 'ctx', 'del', 'add']);
  assert.deepEqual(rows.map((r) => r.text), ['a', 'A', 'b', 'c', 'C']);
});

test('spliceFullFile renders a created file as all additions', () => {
  const rows = spliceFullFile('', [{ oldStart: 0, oldLines: 0, newStart: 1, newLines: 2, lines: ['+x', '+y'] }]);

  assert.deepEqual(rows.map((r) => [r.kind, r.newNo, r.text]), [['add', 1, 'x'], ['add', 2, 'y']]);
});

test('spliceFullFile returns null without a base text and for a file past the size cap', () => {
  assert.equal(spliceFullFile(null, []), null);
  assert.equal(spliceFullFile('x\n'.repeat(FULL_VIEW_MAX_LINES + 1), []), null);
});

test('renderFullFile emits one hunk-styled row per file line, marked as the full view', () => {
  const html = renderFullFile('a\nb\n', [
    { oldStart: 1, oldLines: 1, newStart: 1, newLines: 1, lines: ['-a', '+A'] },
  ]);

  assert.match(html, /<table class="hunk full">/);
  assert.equal((html.match(/class="hunk-line/g) || []).length, 3);
  assert.match(html, /class="hunk-line del"/);
});

test('renderFullFile escapes the untouched file content it copies in', () => {
  const html = renderFullFile('<b>\n', []);

  assert.match(html, /&lt;b&gt;/);
  assert.doesNotMatch(html, /<b>/);
});

test('a full view built from the file as it stands on disk is marked approximate', async () => {
  const { renderViews } = await import('../cli/src/render/diff.mjs');

  const html = renderViews('d1', { base: 'b1' }, true);

  assert.match(html, /class="approx-note"/);
  assert.match(html, /current contents/i);
});

test('spliceFullFile refuses a base whose sheer size would bloat the page', async () => {
  const { FULL_VIEW_MAX_CHARS } = await import('../cli/src/render/full-view.mjs');

  // few lines, but enormous: line caps alone would let this through
  assert.equal(spliceFullFile(`${'x'.repeat(FULL_VIEW_MAX_CHARS + 1)}\n`, []), null);
});

test('spliceFullFile refuses a result too large for the page, even when the base is empty', async () => {
  const { FULL_VIEW_MAX_CHARS } = await import('../cli/src/render/full-view.mjs');

  // A created file starts from '' so only the result can show its size.
  const huge = Array.from({ length: FULL_VIEW_MAX_LINES + 1 }, () => '+x');
  assert.equal(spliceFullFile('', [{ oldStart: 0, oldLines: 0, newStart: 1, newLines: huge.length, lines: huge }]), null);
  const heavy = [`+${'x'.repeat(FULL_VIEW_MAX_CHARS + 1)}`];
  assert.equal(spliceFullFile('', [{ oldStart: 0, oldLines: 0, newStart: 1, newLines: 1, lines: heavy }]), null);
});

test('renderViews leaves code out of the markup: placeholders name the diff and base in the story data', async () => {
  const { renderViews } = await import('../cli/src/render/diff.mjs');

  const html = renderViews('d1', { base: 'b"1' });

  assert.match(html, /<div class="view view-hunks" data-diff="d1"><\/div>/);
  assert.match(html, /<div class="view view-full" data-diff="d1" data-base="b&quot;1"><\/div>/);
  assert.doesNotMatch(html, /<table/);
  assert.doesNotMatch(html, /approx-note/);
});

test('renderViews says why a full view is missing, and Story gets the hunks pane only', async () => {
  const { renderViews } = await import('../cli/src/render/diff.mjs');

  assert.match(renderViews('d1', ''), /did not record its contents/);
  assert.match(renderViews('d1', 'budget'), /left out to keep the page small/i);
  assert.match(renderViews('d1', 'combined'), /turn this diff is counted under/i);
  assert.equal(renderViews('d1', false), '<div class="view view-hunks" data-diff="d1"></div>');
  assert.equal(renderViews(null, false), '<div class="view view-hunks"></div>');
});

test('renderViews shows a note instead of a full-view placeholder when told to skip', async () => {
  const { renderViews } = await import('../cli/src/render/diff.mjs');

  const html = renderViews('d1', 'skip');

  assert.match(html, /class="view view-full"/);
  assert.doesNotMatch(html, /data-base/);
  assert.match(html, /outside the project/i);
});
