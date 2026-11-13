import { test } from 'node:test';
import assert from 'node:assert/strict';
import { escapeHtml, renderHunk, renderEdit } from '../cli/src/render/diff.mjs';
import { contentKey } from '../cli/src/render/story-data.mjs';

test('escapeHtml escapes <, >, &, and quotes', () => {
  assert.equal(escapeHtml('<script>a && b</script> "q" \'s\''), '&lt;script&gt;a &amp;&amp; b&lt;/script&gt; &quot;q&quot; &#39;s&#39;');
});

test('renderHunk produces one row per line with correct old/new line numbers and classes', () => {
  const hunk = {
    oldStart: 5, oldLines: 2, newStart: 5, newLines: 2,
    lines: [' context line', '-removed line', '+added line'],
  };

  const html = renderHunk(hunk);

  assert.match(html, /class="hunk-line ctx"/);
  assert.match(html, /class="hunk-line del"/);
  assert.match(html, /class="hunk-line add"/);
  // context line: old 5, new 5
  assert.match(html, /<td class="ln old">5<\/td>\s*<td class="ln new">5<\/td>/);
  // removed line: old 6, new blank
  assert.match(html, /<td class="ln old">6<\/td>\s*<td class="ln new"><\/td>/);
  // added line: old blank, new 6
  assert.match(html, /<td class="ln old"><\/td>\s*<td class="ln new">6<\/td>/);
});

test('renderHunk escapes HTML-significant characters in code content', () => {
  const hunk = { oldStart: 1, oldLines: 0, newStart: 1, newLines: 1, lines: ['+<div class="x">'] };

  const html = renderHunk(hunk);

  assert.match(html, /&lt;div class=&quot;x&quot;&gt;/);
  assert.doesNotMatch(html, /<div class="x">/);
});

test('renderEdit wraps a file header and all of its hunks, marking creates and subagent edits', async () => {
  const { renderEdit } = await import('../cli/src/render/diff.mjs');
  const edit = {
    rel: 'src/a.ts', kind: 'update', by_subagent: null, result: 'ok',
    hunks: [{ oldStart: 1, oldLines: 1, newStart: 1, newLines: 1, lines: ['-a', '+b'] }],
    stats: { added: 1, removed: 1 },
  };

  const html = renderEdit(edit);

  assert.match(html, /src\/a\.ts/);
  // The code itself is rendered by the page from the story data, keyed by content.
  assert.match(html, new RegExp(`<div class="view view-hunks" data-diff="${contentKey(edit.hunks)}"></div>`));
});

test('renderEdit shows a "no result" note for an edit with an unknown result', async () => {
  const { renderEdit } = await import('../cli/src/render/diff.mjs');
  const edit = { rel: 'src/a.ts', kind: null, by_subagent: null, result: 'unknown', hunks: [], stats: { added: 0, removed: 0 } };

  const html = renderEdit(edit);

  assert.match(html, /result unknown/i);
});

test('renderEdit shows the error message for an edit that failed', async () => {
  const { renderEdit } = await import('../cli/src/render/diff.mjs');
  const edit = { rel: 'src/a.ts', kind: null, by_subagent: null, result: 'error', error: 'File does not exist.', hunks: [], stats: { added: 0, removed: 0 } };

  const html = renderEdit(edit);

  assert.match(html, /Edit failed/i);
  assert.match(html, /File does not exist\./);
});

test('renderEdit points both panes at the story data when a full view is planned', async () => {
  const { renderEdit } = await import('../cli/src/render/diff.mjs');
  const edit = {
    id: 'e1', rel: 'a.txt', kind: 'update', by_subagent: null, result: 'ok',
    hunks: [{ oldStart: 2, oldLines: 1, newStart: 2, newLines: 1, lines: ['-b', '+B'] }],
    stats: { added: 1, removed: 1 },
  };

  const html = renderEdit(edit, { diffKey: 'd1', fullView: { base: 'b1' } });

  assert.match(html, /<div class="view view-hunks" data-diff="d1"><\/div>/);
  assert.match(html, /<div class="view view-full" data-diff="d1" data-base="b1"><\/div>/);
  assert.doesNotMatch(html, /<table/);
});

test('renderEdit says so when no pre-edit text could be reconstructed for the full view', async () => {
  const { renderEdit } = await import('../cli/src/render/diff.mjs');
  const edit = { id: 'e1', rel: 'a.txt', kind: 'update', by_subagent: null, result: 'ok', hunks: [], stats: { added: 0, removed: 0 } };

  const html = renderEdit(edit);

  assert.match(html, /class="view view-full"/);
  assert.match(html, /full file is not available/i);
});

test('renderEdit marks an edit whose file lives outside the project', async () => {
  const { renderEdit } = await import('../cli/src/render/diff.mjs');
  const edit = { id: 'e1', rel: '../../tmp/s.json', outside_cwd: true, kind: 'update', by_subagent: null, result: 'ok', hunks: [], stats: { added: 1, removed: 0 } };

  assert.match(renderEdit(edit), /<div class="edit" data-file="\.\.\/\.\.\/tmp\/s\.json" data-outside="1">/);
});

test('renderEdit tags every edit with its file so review-lens chips can scroll to it', async () => {
  const { renderEdit } = await import('../cli/src/render/diff.mjs');
  const base = { id: 'e1', rel: 'src/a.ts', kind: 'update', by_subagent: null, hunks: [], stats: { added: 0, removed: 0 } };

  assert.match(renderEdit({ ...base, result: 'ok' }), /<div class="edit" data-file="src\/a\.ts"/);
  // an interrupted edit still renders a block, so it needs the key too
  assert.match(renderEdit({ ...base, result: 'unknown' }), /<div class="edit" data-file="src\/a\.ts"/);
});

test('renderEdit escapes quotes in the file key attribute', async () => {
  const { renderEdit } = await import('../cli/src/render/diff.mjs');
  const edit = { id: 'e1', rel: 'a"><img src=x>.ts', kind: 'update', by_subagent: null, result: 'ok', hunks: [], stats: { added: 0, removed: 0 } };

  const html = renderEdit(edit);

  assert.match(html, /data-file="a&quot;&gt;&lt;img src=x&gt;\.ts"/);
  assert.doesNotMatch(html, /<img src=x>/);
});

test('a shell-driven edit is badged and says where its diff came from', () => {
  const html = renderEdit({
    tool: 'Bash', rel: 'app.py', kind: 'update', result: 'ok',
    hunks: [{ oldStart: 1, oldLines: 1, newStart: 1, newLines: 1, lines: ['-a', '+b'] }],
    stats: { added: 1, removed: 1 }, base_source: 'git', attribution: 'command',
    command: "sed -i '' s/a/b/ app.py",
  });

  assert.match(html, /badge shell/);
  assert.match(html, /via shell/);
  assert.match(html, /working tree vs HEAD/);
  assert.match(html, /named this file/);
  assert.match(html, /sed -i &#39;&#39; s\/a\/b\/ app\.py/);
});

test('a weakly attributed shell edit does not claim the turn wrote the file', () => {
  const html = renderEdit({
    tool: 'Bash', rel: 'app.py', kind: 'update', result: 'ok', hunks: [],
    stats: { added: 0, removed: 0 }, attribution: 'mention', command: null,
  });

  assert.match(html, /no command here clearly wrote it/);
});

test('a binary shell change says so instead of showing an empty diff', () => {
  const html = renderEdit({
    tool: 'Bash', rel: 'web/logo.png', kind: 'update', result: 'ok', hunks: [],
    stats: { added: 0, removed: 0 }, binary: true, attribution: 'command',
  });

  assert.match(html, /Binary file changed by a shell command/);
  assert.doesNotMatch(html, /working tree vs HEAD/);
});

test('a deleted file is badged as deleted', () => {
  const html = renderEdit({
    tool: 'Bash', rel: 'old.py', kind: 'delete', result: 'ok', hunks: [],
    stats: { added: 0, removed: 2 }, attribution: 'command',
  });

  assert.match(html, /badge delete/);
});

test('renderEdit shows a shell diff shared with another turn, and says it is shared', async () => {
  const { renderEdit } = await import('../cli/src/render/diff.mjs');
  const edit = {
    rel: 'web/src/Composer.tsx', kind: 'update', tool: 'Bash', result: 'ok',
    hunks: [{ oldStart: 1, oldLines: 1, newStart: 1, newLines: 1, lines: ['-a', '+b'] }],
    stats: { added: 1, removed: 1 }, attribution: 'command', combined_into: 4,
    command: "python3 - <<'EOF'\nopen(p,'w').write(s)\nEOF",
  };

  const html = renderEdit(edit);

  assert.match(html, /Composer\.tsx/);
  // The code is shown here, not a pointer to somewhere else.
  assert.match(html, /class="view view-hunks" data-diff="[0-9a-f]+"/);
  assert.match(html, /so did turn 4/);
  assert.doesNotMatch(html, /outside the project/);
  // With no plan given, the full pane only points at the owning turn.
  assert.match(html, /counted under/);

  // A lens that planned a base for the share gets the full file here too.
  const planned = renderEdit(edit, { fullView: { base: 'abc' } });
  assert.match(planned, /class="view view-full" data-diff="[0-9a-f]+" data-base="abc"/);
  assert.doesNotMatch(planned, /counted under/);
});

test('a shell badge keeps a long command short in its tooltip', () => {
  const html = renderEdit({
    tool: 'Bash', rel: 'a.py', kind: 'update', result: 'ok', hunks: [], stats: { added: 0, removed: 0 },
    attribution: 'command', command: `python3 - <<'EOF'\n${'x'.repeat(5000)}\nEOF`,
  });
  const title = html.match(/class="badge shell" title="([^"]*)"/)[1];
  assert.ok(title.length < 200, `title is ${title.length} chars`); // 160 chars, some escaped
  assert.match(title, /…$/);
});

test('renderEdit puts the edit id on its header so the Trace lens can jump to it', () => {
  assert.match(renderEdit({ id: 'tu3', tool: 'Edit', rel: 'src/a.ts', result: 'ok', hunks: [], stats: { added: 0, removed: 0 } }), /<div class="edit-header" data-edit-id="tu3">/);
});
