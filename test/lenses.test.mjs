import { test } from 'node:test';
import assert from 'node:assert/strict';
import { renderHeader, formatRange, renderReviewLens, renderStoryLens, renderTurnUsage } from '../cli/src/render/lenses.mjs';

function sampleStory(overrides = {}) {
  return {
    schema_version: 1,
    session: {
      id: 's1', cwd: '/Users/nalaj/proj', git_branch: 'main',
      started_at: '2026-09-10T10:00:00.000Z', ended_at: '2026-09-10T10:05:30.000Z', duration_ms: 330000,
      summary: 'Added a title and subtitle to Panel.',
      title: 'Panel title/subtitle',
      blind_spots: ['shell-made changes are not tracked'],
    },
    turns: [{ index: 1, id: 'u1', at: '2026-09-10T10:00:00.000Z', prompt: 'Add a title prop', summary: 'Added title prop.', edits: [] }],
    files: [{ rel: 'src/Panel.tsx', language: 'typescript', turns: [1], churn: false, stats: { added: 3, removed: 1 } }],
    totals: { turns: 1, files: 1, added: 3, removed: 1, edits: 1 },
    ...overrides,
  };
}

test('renderHeader says when the page was generated, as a machine-readable time', () => {
  const html = renderHeader(sampleStory(), { generatedAt: '2026-10-14T09:12:33.000Z' });
  assert.match(html, /class="generated"[^>]*>.*Generated <time class="local-time" datetime="2026-10-14T09:12:33.000Z">2026-10-14 09:12 UTC<\/time>/);
});

test('renderHeader leaves the generation stamp out when none is given', () => {
  assert.doesNotMatch(renderHeader(sampleStory()), /class="generated"/);
});

test('renderHeader shows title, cwd, branch, totals, session summary, and blind spots', () => {
  const html = renderHeader(sampleStory());

  assert.match(html, /Panel title\/subtitle/);
  assert.match(html, /\/Users\/nalaj\/proj/);
  assert.match(html, /main/);
  assert.match(html, /Added a title and subtitle to Panel\./);
  assert.match(html, /shell-made changes are not tracked/);
  // totals: 1 turn, 1 file, +3/-1
  assert.match(html, /\b1\b.*turn/i);
  assert.match(html, /\+3/);
  assert.match(html, /-1|−1/);
});

test('renderHeader falls back to a truncated first prompt as the title when none was set', () => {
  const story = sampleStory();
  story.session.title = null;
  story.turns[0].prompt = 'This is the very first prompt of the session and it is the fallback title';

  const html = renderHeader(story);

  assert.match(html, /This is the very first prompt/);
});

test('renderReviewLens lists one timeline entry per turn with prompt, summary and file count', async () => {
  const { renderReviewLens } = await import('../cli/src/render/lenses.mjs');
  const story = sampleStory({
    turns: [
      { index: 1, id: 'u1', at: null, prompt: 'Add a title prop', summary: 'Added title prop.', edits: [
        { id: 'e1', tool: 'Edit', file: '/p/src/Panel.tsx', rel: 'src/Panel.tsx', kind: 'update', by_subagent: null, result: 'ok',
          hunks: [{ oldStart: 1, oldLines: 1, newStart: 1, newLines: 1, lines: ['-a', '+b'] }], stats: { added: 1, removed: 1 } },
      ] },
    ],
    files: [{ rel: 'src/Panel.tsx', language: 'typescript', turns: [1, 2], churn: true, stats: { added: 2, removed: 1 } }],
  });

  const html = renderReviewLens(story);

  assert.match(html, /data-turn="1"/);
  // The prompt itself must render as visible text, not only as a title tooltip.
  assert.match(html, /<blockquote class="turn-prompt">Add a title prop<\/blockquote>/);
  assert.match(html, /<p class="turn-summary">Added title prop\.<\/p>/);
  assert.match(html, /<p class="turn-filecount">[^]*?1 file changed/);
  assert.match(html, /class="view view-hunks" data-diff="[0-9a-f]+"/); // edit panel placeholder via renderEdit
});

test('renderReviewLens counts distinct files on the left instead of listing them, following the project toggle', async () => {
  const { renderReviewLens } = await import('../cli/src/render/lenses.mjs');
  const story = sampleStory({
    turns: [
      { index: 1, id: 'u1', at: null, prompt: 'Add a title prop', summary: '', edits: [
        { id: 'e1', tool: 'Edit', file: '/p/src/Panel.tsx', rel: 'src/Panel.tsx', kind: 'update', by_subagent: null, result: 'ok', hunks: [], stats: { added: 1, removed: 1 } },
        // a second edit to the same file is still one file
        { id: 'e2', tool: 'Edit', file: '/p/src/Panel.tsx', rel: 'src/Panel.tsx', kind: 'update', by_subagent: null, result: 'ok', hunks: [], stats: { added: 1, removed: 0 } },
        { id: 'e3', tool: 'Edit', file: '/tmp/s.json', rel: '../../tmp/s.json', outside_cwd: true, kind: 'update', by_subagent: null, result: 'ok', hunks: [], stats: { added: 1, removed: 0 } },
      ] },
      { index: 2, id: 'u2', at: null, prompt: 'Just asking', summary: '', edits: [] },
    ],
    files: [{ rel: 'src/Panel.tsx', language: 'typescript', turns: [1], churn: true, stats: { added: 2, removed: 1 } }],
  });

  const html = renderReviewLens(story);
  const timeline = html.slice(0, html.indexOf('turn-panels'));

  assert.doesNotMatch(timeline, /class="chip/);
  assert.doesNotMatch(timeline, /src\/Panel\.tsx/);
  assert.match(timeline, /<span class="v-in">1 file changed<\/span><span class="v-all">2 files changed<\/span>/);
  // a turn with no edits gets no count line
  assert.equal((timeline.match(/turn-filecount/g) || []).length, 1);
});

test('renderReviewLens gives a multi-file turn panel a file filter: "All changes" plus one button per file', async () => {
  const { renderReviewLens } = await import('../cli/src/render/lenses.mjs');
  const story = sampleStory({
    turns: [
      { index: 1, id: 'u1', at: null, prompt: 'Two files', summary: '', edits: [
        { id: 'e1', tool: 'Edit', file: '/p/src/a.ts', rel: 'src/a.ts', kind: 'update', by_subagent: null, result: 'ok', hunks: [], stats: { added: 2, removed: 1 } },
        { id: 'e2', tool: 'Edit', file: '/p/src/a.ts', rel: 'src/a.ts', kind: 'update', by_subagent: null, result: 'ok', hunks: [], stats: { added: 3, removed: 0 } },
        { id: 'e3', tool: 'Edit', file: '/tmp/s.json', rel: '../../tmp/s.json', outside_cwd: true, kind: 'update', by_subagent: null, result: 'ok', hunks: [], stats: { added: 1, removed: 0 } },
      ] },
      { index: 2, id: 'u2', at: null, prompt: 'One file', summary: '', edits: [
        { id: 'e4', tool: 'Edit', file: '/p/src/a.ts', rel: 'src/a.ts', kind: 'update', by_subagent: null, result: 'ok', hunks: [], stats: { added: 1, removed: 0 } },
      ] },
    ],
    files: [],
  });

  const html = renderReviewLens(story);
  const panel1 = html.slice(html.indexOf('data-turn-panel="1"'), html.indexOf('data-turn-panel="2"'));
  const panel2 = html.slice(html.indexOf('data-turn-panel="2"'));

  assert.match(panel1, /<div class="file-filter" role="group" aria-label="Show changes for">/);
  // Nothing is picked when a turn opens: the code stays hidden until the
  // reader chooses "All changes" or a file.
  assert.match(panel1, /<button type="button" class="file-filter-btn" data-file-filter="" aria-pressed="false">[^]*?All changes/);
  assert.match(panel1, /class="pick-hint"/);
  // "All changes" totals follow the scope toggle, like the panel meta
  assert.match(panel1, /All changes<\/span><span class="v-in">[^]*?\+5[^]*?<span class="v-all">[^]*?\+6/);
  // one button per distinct file, carrying that file's summed stats
  const fileButtons = panel1.match(/data-file-filter="src\/a\.ts"/g) || [];
  assert.equal(fileButtons.length, 1);
  assert.match(panel1, /data-file-filter="src\/a\.ts" aria-pressed="false"[^>]*>[^]*?\+5/);
  // an outside-project file's button hides with the scope toggle like its edits do
  assert.match(panel1, /data-file-filter="\.\.\/\.\.\/tmp\/s\.json" aria-pressed="false" data-outside="1"/);
  // a single-file turn still needs the bar, or its code could not be opened
  assert.match(panel2, /data-file-filter="" aria-pressed="false"/);
  assert.match(panel2, /data-file-filter="src\/a\.ts" aria-pressed="false"/);
});

test("renderReviewLens escapes quotes in an edit's file key", async () => {
  const { renderReviewLens } = await import('../cli/src/render/lenses.mjs');
  const story = sampleStory({
    turns: [{ index: 1, id: 'u1', at: null, prompt: 'p', summary: '', edits: [
      { id: 'e1', tool: 'Edit', file: '/p/a', rel: 'a"><img src=x>.ts', kind: 'update', by_subagent: null, result: 'ok', hunks: [], stats: { added: 0, removed: 0 } },
    ] }],
    files: [],
  });

  const html = renderReviewLens(story);

  assert.match(html, /data-file="a&quot;&gt;&lt;img src=x&gt;\.ts"/);
  assert.doesNotMatch(html, /<img src=x>/);
});

test('renderReviewLens omits the summary paragraph when a turn has no summary yet, but still shows the prompt', async () => {
  const { renderReviewLens } = await import('../cli/src/render/lenses.mjs');
  const story = sampleStory({
    turns: [{ index: 1, id: 'u1', at: null, prompt: 'Investigate the flaky test', summary: '', edits: [] }],
  });

  const html = renderReviewLens(story);

  assert.match(html, /<blockquote class="turn-prompt">Investigate the flaky test<\/blockquote>/);
  assert.doesNotMatch(html, /class="turn-summary"/);
});

test('renderDiffLens lists a file tree entry and a panel per file, with each hunk tagged by its turn', async () => {
  const { renderDiffLens } = await import('../cli/src/render/lenses.mjs');
  const story = sampleStory({
    turns: [
      { index: 1, id: 'u1', prompt: 'Add a title prop', summary: 'Added title.', edits: [
        { id: 'e1', tool: 'Edit', file: '/p/src/Panel.tsx', rel: 'src/Panel.tsx', kind: 'update', by_subagent: null, result: 'ok',
          hunks: [{ oldStart: 1, oldLines: 1, newStart: 1, newLines: 1, lines: ['-a', '+b'] }], stats: { added: 1, removed: 1 } },
      ] },
      { index: 2, id: 'u2', prompt: 'Also add a subtitle', summary: 'Added subtitle.', edits: [
        { id: 'e2', tool: 'Edit', file: '/p/src/Panel.tsx', rel: 'src/Panel.tsx', kind: 'update', by_subagent: null, result: 'ok',
          hunks: [{ oldStart: 2, oldLines: 1, newStart: 2, newLines: 1, lines: ['-b', '+c'] }], stats: { added: 1, removed: 1 } },
      ] },
    ],
    files: [{ rel: 'src/Panel.tsx', language: 'typescript', turns: [1, 2], churn: true, stats: { added: 2, removed: 2 } }],
  });

  const html = renderDiffLens(story);

  assert.match(html, /data-file="src\/Panel\.tsx"/);
  assert.match(html, /data-file-panel="src\/Panel\.tsx"/);
  assert.match(html, /data-file-panel="src\/Panel\.tsx"><template data-inert><div class="panel-head">/);
  const turnTagMatches = html.match(/class="turn-tag"/g) || [];
  assert.equal(turnTagMatches.length, 2);
  assert.match(html, /title="Add a title prop/);
  assert.match(html, /title="Also add a subtitle/);
  assert.match(html, /data-jump-turn="1"/);
  assert.match(html, /data-jump-turn="2"/);
  assert.match(html, /class="jump-arrow">↗<\/span>/);
});

test('renderStoryLens renders one card per turn with prompt, summary, file count, and collapsed code', async () => {
  const { renderStoryLens } = await import('../cli/src/render/lenses.mjs');
  const story = sampleStory({
    turns: [{ index: 1, id: 'u1', prompt: 'Add a title prop', summary: 'Added a title prop to Panel.', edits: [
      { id: 'e1', tool: 'Edit', file: '/p/src/Panel.tsx', rel: 'src/Panel.tsx', kind: 'update', by_subagent: null, result: 'ok',
        hunks: [{ oldStart: 1, oldLines: 1, newStart: 1, newLines: 1, lines: ['-a', '+b'] }], stats: { added: 1, removed: 1 } },
    ] }],
  });

  const html = renderStoryLens(story);

  assert.match(html, /Add a title prop/);
  assert.match(html, /Added a title prop to Panel\./);
  assert.match(html, /1 file/);
  assert.match(html, /<details/);
  assert.match(html, /class="view view-hunks" data-diff="[0-9a-f]+"/);
});

test('renderHeader renders the counts as stat tiles with icons, a decorative motif, and a per-turn session strip', () => {
  const story = sampleStory({
    turns: [
      { index: 1, id: 'u1', prompt: 'a', summary: 'A.', edits: [{ id: 'e1', tool: 'Edit', file: '/p/a', rel: 'a', kind: 'update', by_subagent: null, result: 'ok', hunks: [], stats: { added: 3, removed: 1 } }] },
      { index: 2, id: 'u2', prompt: 'b', summary: 'B.', edits: [] },
    ],
    totals: { turns: 2, files: 1, added: 3, removed: 1, edits: 1 },
  });

  const html = renderHeader(story);

  assert.equal((html.match(/class="stat-tile/g) || []).length, 4);
  assert.match(html, /<span class="stat-value">2<\/span>\s*<span class="stat-label">turns<\/span>/);
  assert.match(html, /class="stat-value"><span class="v-in">\+3<\/span>/);
  assert.match(html, /class="header-motif"/);
  assert.equal((html.match(/class="strip-seg/g) || []).length, 4); // one strip per scope
  assert.match(html, /class="strip-seg empty"/); // turn 2 made no edits
  assert.match(html, /title="Turn 1: \+3 −1"/);
});

test('renderReviewLens gives each timeline item an added/removed activity bar scaled to the busiest turn', async () => {
  const { renderReviewLens } = await import('../cli/src/render/lenses.mjs');
  const story = sampleStory({
    turns: [
      { index: 1, id: 'u1', at: null, prompt: 'a', summary: 'A.', edits: [{ id: 'e1', tool: 'Edit', file: '/p/a', rel: 'a', kind: 'update', by_subagent: null, result: 'ok', hunks: [], stats: { added: 4, removed: 0 } }] },
      { index: 2, id: 'u2', at: null, prompt: 'b', summary: 'B.', edits: [{ id: 'e2', tool: 'Edit', file: '/p/b', rel: 'b', kind: 'update', by_subagent: null, result: 'ok', hunks: [], stats: { added: 1, removed: 1 } }] },
    ],
  });

  const html = renderReviewLens(story);

  // turn 1: 4 of max 4 -> 100% add, no del segment; turn 2: 25% add, 25% del
  assert.match(html, /<span class="bar-add" style="width:100%"><\/span>/);
  assert.match(html, /<span class="bar-add" style="width:25%"><\/span><span class="bar-del" style="width:25%"><\/span>/);
  assert.match(html, /<span class="bar-label"><span class="v-in">\+4 −0<\/span><span class="v-all">\+4 −0<\/span><\/span>/);
});

test('renderStoryLens cards carry the same activity bar as the review timeline', async () => {
  const { renderStoryLens } = await import('../cli/src/render/lenses.mjs');
  const story = sampleStory({
    turns: [{ index: 1, id: 'u1', prompt: 'a', summary: 'A.', edits: [{ id: 'e1', tool: 'Edit', file: '/p/a', rel: 'a', kind: 'update', by_subagent: null, result: 'ok', hunks: [], stats: { added: 2, removed: 2 } }] }],
  });

  const html = renderStoryLens(story);

  assert.match(html, /class="turn-bars"/);
  assert.match(html, /\+2 −2/);
});

function outsideStory() {
  const inside = { id: 'e1', tool: 'Edit', file: '/p/a.ts', rel: 'a.ts', kind: 'update', by_subagent: null, result: 'ok', outside_cwd: false, before: 'a\n', hunks: [{ oldStart: 1, oldLines: 1, newStart: 1, newLines: 1, lines: ['-a', '+A'] }], stats: { added: 2, removed: 0 } };
  const outside = { id: 'e2', tool: 'Edit', file: '/tmp/s.json', rel: '../../tmp/s.json', kind: 'update', by_subagent: null, result: 'ok', outside_cwd: true, before: null, hunks: [], stats: { added: 5, removed: 5 } };
  return sampleStory({
    turns: [
      { index: 1, id: 'u1', at: null, prompt: 'p1', summary: 'S1.', edits: [inside, outside] },
      { index: 2, id: 'u2', at: null, prompt: 'p2', summary: 'S2.', edits: [outside] },
    ],
    files: [
      { rel: 'a.ts', language: 'typescript', turns: [1], churn: false, outside_cwd: false, stats: { added: 2, removed: 0 } },
      { rel: '../../tmp/s.json', language: 'json', turns: [1, 2], churn: true, outside_cwd: true, stats: { added: 10, removed: 10 } },
    ],
    totals: { turns: 2, files: 2, added: 7, removed: 5, edits: 3 },
  });
}

test('renderHeader carries both in-project and overall counts, two session strips, and a note about what is hidden', () => {
  const html = renderHeader(outsideStory());

  assert.match(html, /<span class="v-in">1<\/span><span class="v-all">2<\/span>/); // files
  assert.match(html, /<span class="v-in">\+2<\/span><span class="v-all">\+7<\/span>/); // added
  assert.match(html, /class="session-strip" data-scope="in"/);
  assert.match(html, /class="session-strip" data-scope="all"/);
  assert.match(html, /class="outside-note only-when-filtered"/);
  assert.match(html, /outside the project/i);
});

test('renderHeader skips combined_into shares in its project-only counts, as the session totals do', () => {
  const story = outsideStory();
  const inside = story.turns[0].edits[0];
  const outside = story.turns[0].edits[1];
  story.turns[1].edits = [{ ...inside, id: 'e3', combined_into: 1 }, { ...outside, id: 'e4', combined_into: 1 }];
  story.totals = { turns: 2, files: 2, added: 7, removed: 5, edits: 2 };

  const html = renderHeader(story);

  assert.match(html, /<span class="v-in">\+2<\/span><span class="v-all">\+7<\/span>/);
  assert.match(html, /<span class="v-in">−0<\/span><span class="v-all">−5<\/span>/);
  assert.match(html, /\(1 edit\) hidden/);
});

test('renderReviewLens marks out-of-project edits, and explains a turn left empty by the filter', async () => {
  const { renderReviewLens } = await import('../cli/src/render/lenses.mjs');

  const html = renderReviewLens(outsideStory());

  assert.match(html, /<div class="edit" data-file="[^"]*" data-outside="1">/);
  assert.match(html, /<div class="edit" data-file="a\.ts">/); // the in-project edit is not marked
  // turn 2 only touched a file outside the project
  assert.match(html, /class="no-edits only-when-filtered"/);
});

test('renderDiffLens marks the out-of-project file in the tree and its panel', async () => {
  const { renderDiffLens } = await import('../cli/src/render/lenses.mjs');

  const html = renderDiffLens(outsideStory());

  assert.match(html, /<li class="file-tree-item[^"]*" data-file="\.\.\/\.\.\/tmp\/s\.json" data-outside="1"/);
  assert.match(html, /<section class="file-panel" data-file-panel="\.\.\/\.\.\/tmp\/s\.json" data-outside="1"/);
});

test('renderReviewLens points each edit at its reconstructed pre-edit text so the full-file view can render', async () => {
  const { renderReviewLens, storyDataFor } = await import('../cli/src/render/lenses.mjs');
  const story = outsideStory();

  const html = renderReviewLens(story);

  // the in-project edit had a before snapshot, carried once in the story data
  const key = html.match(/class="view view-full" data-diff="[0-9a-f]+" data-base="([0-9a-f]+)"/)[1];
  assert.equal(typeof storyDataFor(story).data.bases[key], 'string');
  assert.match(html, /outside the project/i); // the outside edit gets a skip note, not a splice attempt
});

test('renderStoryLens keeps its collapsed code as hunks only, so the full-file toggle cannot empty it', async () => {
  const { renderStoryLens } = await import('../cli/src/render/lenses.mjs');

  const html = renderStoryLens(outsideStory());

  assert.match(html, /class="view view-hunks"/);
  assert.doesNotMatch(html, /class="view view-full"/);
});

test('renderReviewLens and renderDiffLens skip splicing the full file for out-of-project edits, to save the page budget for project files', async () => {
  const { renderReviewLens, renderDiffLens } = await import('../cli/src/render/lenses.mjs');
  const story = outsideStory();

  const reviewHtml = renderReviewLens(story);
  const diffHtml = renderDiffLens(story);

  // the outside edit (e2, no `before`) never gets a spliced attempt logged as unavailable;
  // it gets the dedicated skip note instead.
  assert.match(reviewHtml, /outside the project/i);
  assert.match(diffHtml, /outside the project/i);
});

test('renderHeader shows an outcome pill and the start/end commit range when report data is present', () => {
  const story = sampleStory({
    report: {
      plan: 'p', decisions: [], outcome: 'completed', outcome_note: null,
      dependencies: { manifests: [], installs: [], config_files: [] },
      git: {
        branch: 'main',
        start_commit: { sha: 'abc1234abc1234abc1234abc1234abc1234abcd', subject: 'Initial commit' },
        end_commit: { sha: 'def5678def5678def5678def5678def5678defg', subject: 'Add feature' },
        commits: [],
        dirty: false,
        status: { modified: 0, added: 0, deleted: 0, untracked: 0 },
      },
    },
  });

  const html = renderHeader(story);

  assert.match(html, /outcome-pill outcome-completed/);
  assert.match(html, /Completed/);
  assert.match(html, /abc1234/);
  assert.match(html, /def5678/);
});

test('renderHeader omits the outcome pill and commit range when report is absent', () => {
  const story = sampleStory();
  delete story.report;

  const html = renderHeader(story);

  assert.doesNotMatch(html, /outcome-pill/);
});

test('the fallback title uses only the first line of the prompt, clamped to 60 chars', () => {
  const story = sampleStory();
  story.session.title = null;
  story.turns[0].prompt = 'Extend session story so that includes also:\nTo add:\nPlan / intent';

  const html = renderHeader(story);

  assert.match(html, /<h1>Extend session story so that includes also:<\/h1>/);
  assert.doesNotMatch(html, /To add:/);
});

test('a long single-line fallback title is truncated to 60 characters plus an ellipsis', () => {
  const story = sampleStory();
  story.session.title = null;
  story.turns[0].prompt = 'a'.repeat(120);

  const html = renderHeader(story);

  const [, heading] = html.match(/<h1>([^<]*)<\/h1>/);
  assert.equal(heading, `${'a'.repeat(60)}…`);
});

test('the header prefers the harness ai_title over the first prompt when Claude wrote no title', () => {
  const story = sampleStory();
  story.session.title = null;
  story.session.ai_title = 'Panel title prop';
  story.turns[0].prompt = 'Add a title prop to Panel and then also write up a README for it';

  const html = renderHeader(story);

  assert.match(html, /<h1>Panel title prop<\/h1>/);
});

test('a Claude-written title still wins over ai_title', () => {
  const story = sampleStory();
  story.session.ai_title = 'Harness guess';

  const html = renderHeader(story);

  assert.match(html, /<h1>Panel title\/subtitle<\/h1>/);
});

test('formatRange shows the start and end time, with the date once when both fall on the same day', () => {
  assert.equal(
    formatRange('2026-09-10T10:00:00.000Z', '2026-09-10T10:05:30.000Z'),
    '2026-09-10 10:00 → 10:05 UTC'
  );
});

test('formatRange repeats the date when the session crosses midnight', () => {
  assert.equal(
    formatRange('2026-09-10T23:50:00.000Z', '2026-09-11T00:20:00.000Z'),
    '2026-09-10 23:50 → 2026-09-11 00:20 UTC'
  );
});

test('formatRange falls back to the start alone without a usable end', () => {
  assert.equal(formatRange('2026-09-10T10:00:00.000Z', null), '2026-09-10 10:00 UTC');
  assert.equal(formatRange('2026-09-10T10:00:00.000Z', 'nope'), '2026-09-10 10:00 UTC');
  assert.equal(formatRange(null, null), '');
});

test('renderHeader shows when the session started and ended', () => {
  const html = renderHeader(sampleStory());
  assert.match(html, /2026-09-10 10:00 → 10:05 UTC/);
});

test('renderHeader shows input tokens incl. cache, output tokens and cost when the story has usage', () => {
  const html = renderHeader(sampleStory({
    metrics: { usage: { input_tokens: 1200, cache_read_tokens: 150000, cache_creation_tokens: 27517, output_tokens: 860, total_cost_usd: 4.2226 } },
  }));
  assert.equal((html.match(/class="stat-tile/g) || []).length, 7);
  assert.match(html, /<span class="stat-value">178\.7k<\/span>\s*<span class="stat-label">input tokens incl\. cache<\/span>/);
  assert.match(html, /<span class="stat-value">860<\/span>\s*<span class="stat-label">output tokens<\/span>/);
  assert.match(html, /<span class="stat-value">\$4\.22<\/span>\s*<span class="stat-label">est\. API cost<\/span>/);
});

test('renderHeader leaves out usage tiles it has no numbers for', () => {
  const transcriptOnly = renderHeader(sampleStory({
    metrics: { usage: { input_tokens: 10, cache_read_tokens: 0, cache_creation_tokens: 0, output_tokens: 5, total_cost_usd: null } },
  }));
  assert.equal((transcriptOnly.match(/class="stat-tile/g) || []).length, 6);
  assert.doesNotMatch(transcriptOnly, /API cost</);
  assert.equal((renderHeader(sampleStory()).match(/class="stat-tile/g) || []).length, 4);
});

test('renderReviewLens stamps each timeline item and turn panel with when the prompt was sent', async () => {
  const { renderReviewLens } = await import('../cli/src/render/lenses.mjs');
  const html = renderReviewLens(sampleStory());
  assert.match(html, /<time class="turn-time" datetime="2026-09-10T10:00:00\.000Z">2026-09-10 10:00 UTC<\/time>/);
  assert.equal(html.match(/class="turn-time"/g).length, 2);
});

test('renderReviewLens omits the timestamp for a turn without one', async () => {
  const { renderReviewLens } = await import('../cli/src/render/lenses.mjs');
  const story = sampleStory();
  story.turns[0].at = null;
  assert.doesNotMatch(renderReviewLens(story), /turn-time/);
});

test('renderStoryLens offers no "Show code" for a turn whose edits carry no diff', async () => {
  const { renderStoryLens } = await import('../cli/src/render/lenses.mjs');
  const story = sampleStory({
    turns: [{ index: 1, id: 'u1', prompt: 'p', summary: 'S.', edits: [
      { id: 'e1', tool: 'Edit', file: '/p/a.ts', rel: 'a.ts', kind: 'update', by_subagent: null, result: 'error', error: 'old_string not found', hunks: [], stats: { added: 0, removed: 0 } },
      { id: 'e2', tool: 'Bash', file: '/p/logo.png', rel: 'logo.png', kind: 'update', by_subagent: null, result: 'ok', binary: true, hunks: [], stats: { added: 0, removed: 0 } },
    ] }],
  });

  assert.doesNotMatch(renderStoryLens(story), /Show code/);
});

test('renderStoryLens shows only edits with a diff under "Show code"', async () => {
  const { renderStoryLens } = await import('../cli/src/render/lenses.mjs');
  const story = sampleStory({
    turns: [{ index: 1, id: 'u1', prompt: 'p', summary: 'S.', edits: [
      { id: 'e1', tool: 'Edit', file: '/p/a.ts', rel: 'a.ts', kind: 'update', by_subagent: null, result: 'error', error: 'old_string not found', hunks: [], stats: { added: 0, removed: 0 } },
      { id: 'e2', tool: 'Edit', file: '/p/b.ts', rel: 'b.ts', kind: 'update', by_subagent: null, result: 'ok',
        hunks: [{ oldStart: 1, oldLines: 1, newStart: 1, newLines: 1, lines: ['-a', '+b'] }], stats: { added: 1, removed: 1 } },
    ] }],
  });

  const html = renderStoryLens(story);

  assert.match(html, /<details class="story-code">/);
  assert.match(html, /data-file="b\.ts"/);
  assert.doesNotMatch(html, /data-file="a\.ts"/);
});

test('renderStoryLens hides "Show code" with the project filter when every change is outside the project', async () => {
  const { renderStoryLens } = await import('../cli/src/render/lenses.mjs');
  const story = outsideStory();
  const hunks = [{ oldStart: 1, oldLines: 1, newStart: 1, newLines: 1, lines: ['-x', '+y'] }];
  for (const turn of story.turns) turn.edits = turn.edits.map((e) => (e.outside_cwd ? { ...e, hunks } : e));
  const html = renderStoryLens(story);
  const turn2 = html.slice(html.lastIndexOf('<article'));

  // turn 2 only touched ../../tmp/s.json, so its toggle hides while "Project files only" is on
  assert.match(turn2, /<details class="story-code" data-outside="1">/);
  // turn 1 has a project change, so its toggle always shows
  assert.match(html.slice(0, html.lastIndexOf('<article')), /<details class="story-code">/);
});

test("renderReviewLens shows Claude's output above the diffs, folding all but the final reply", async () => {
  const { renderReviewLens } = await import('../cli/src/render/lenses.mjs');
  const story = sampleStory({
    turns: [
      { index: 1, id: 'u1', at: null, prompt: 'p1', summary: '', edits: [], replies: [
        { at: null, text: 'First <look>' },
        { at: null, text: 'Second step' },
        { at: '2026-09-10T10:00:03.000Z', text: 'All done & tested' },
      ] },
      { index: 2, id: 'u2', at: null, prompt: 'p2', summary: '', edits: [], replies: [{ at: null, text: 'Only reply' }] },
      { index: 3, id: 'u3', at: null, prompt: 'p3', summary: '', edits: [] },
    ],
    files: [],
  });

  const html = renderReviewLens(story);
  const panel = (n) => html.split(`data-turn-panel="${n}"`)[1].split('</section>')[0];

  assert.match(panel(1), /class="turn-replies"/);
  assert.match(panel(1), /<summary>2 earlier messages<\/summary>/);
  assert.match(panel(1), /First &lt;look&gt;/);
  assert.match(panel(1), /class="reply reply-final"[^>]*>(?:<time[^>]*>[^<]*<\/time>)?All done &amp; tested<\/div>/);
  // Claude's output comes before the edit list.
  assert.ok(panel(1).indexOf('turn-replies') < panel(1).indexOf('no-edits'));

  assert.match(panel(2), /Only reply/);
  assert.doesNotMatch(panel(2), /<details/);

  assert.doesNotMatch(panel(3), /turn-replies/);
});

test("Review and Story show the turn's answer as Claude's output and fold every original reply", async () => {
  const { renderReviewLens, renderStoryLens } = await import('../cli/src/render/lenses.mjs');
  const story = sampleStory({
    turns: [
      { index: 1, id: 'u1', at: null, prompt: 'p1', summary: 's1', answer: 'Fixed <it>; tests pass.', edits: [], replies: [
        { at: null, text: 'Looking around' },
        { at: null, text: 'All done' },
      ] },
      { index: 2, id: 'u2', at: null, prompt: 'p2', summary: 's2', answer: 'Only an answer', edits: [] },
    ],
    files: [],
  });

  const panel = renderReviewLens(story).split('data-turn-panel="1"')[1].split('</section>')[0];
  const card = renderStoryLens(story).split('<article class="story-card">')[1];
  for (const html of [panel, card]) {
    assert.match(html, /class="reply reply-final reply-answer">Fixed &lt;it&gt;; tests pass\.<\/div>/);
    assert.match(html, /<summary>2 original messages<\/summary>/);
    // Both replies sit inside the fold, after the answer.
    const fold = html.split('<details class="replies-earlier">')[1].split('</details>')[0];
    assert.match(fold, /Looking around/);
    assert.match(fold, /All done/);
    assert.ok(html.indexOf('reply-answer') < html.indexOf('replies-earlier'));
  }

  const panel2 = renderReviewLens(story).split('data-turn-panel="2"')[1].split('</section>')[0];
  assert.match(panel2, /Only an answer/);
  assert.doesNotMatch(panel2, /<details class="replies-earlier"/);
});

test("renderStoryLens shows Claude's output on a card, and nothing extra when a turn has no replies", async () => {
  const { renderStoryLens } = await import('../cli/src/render/lenses.mjs');
  const story = sampleStory({
    turns: [
      { index: 1, id: 'u1', at: null, prompt: 'p1', summary: 's1', edits: [], replies: [
        { at: null, text: 'Looking around' },
        { at: null, text: 'Finished <ok>' },
      ] },
      { index: 2, id: 'u2', at: null, prompt: 'p2', summary: 's2', edits: [] },
    ],
    files: [],
  });

  const cards = renderStoryLens(story).split('<article class="story-card">').slice(1);

  assert.match(cards[0], /class="turn-replies"/);
  assert.match(cards[0], /<summary>1 earlier message<\/summary>/);
  assert.match(cards[0], /Finished &lt;ok&gt;/);
  assert.doesNotMatch(cards[1], /turn-replies/);
});

test("renderReviewLens repeats the turn's prompt at the top of its panel, before Claude's output", async () => {
  const { renderReviewLens } = await import('../cli/src/render/lenses.mjs');
  const story = sampleStory({
    turns: [
      { index: 1, id: 'u1', at: null, prompt: 'Fix <the> bug', summary: '', edits: [], replies: [{ at: null, text: 'Fixed' }] },
    ],
    files: [],
  });

  const panel = renderReviewLens(story).split('data-turn-panel="1"')[1];

  assert.match(panel, /<blockquote class="panel-prompt">Fix &lt;the&gt; bug<\/blockquote>/);
  assert.ok(panel.indexOf('panel-prompt') > panel.indexOf('panel-head'));
  assert.ok(panel.indexOf('panel-prompt') < panel.indexOf('turn-replies'));
});

test('Review and Diff point at the same full-file base, which the story data carries once', async () => {
  const { renderReviewLens, renderDiffLens, storyDataFor } = await import('../cli/src/render/lenses.mjs');
  const story = sampleStory({
    turns: [
      { index: 1, id: 'u1', at: null, prompt: 'p', summary: '', edits: [
        { id: 'e1', tool: 'Write', file: '/p/a.ts', rel: 'a.ts', kind: 'create', by_subagent: null, result: 'ok', before: '',
          hunks: [{ oldStart: 0, oldLines: 0, newStart: 1, newLines: 1, lines: ['+one'] }], stats: { added: 1, removed: 0 } },
      ] },
    ],
    files: [{ rel: 'a.ts', language: 'typescript', turns: [1], churn: false, stats: { added: 1, removed: 0 } }],
  });

  const review = renderReviewLens(story);
  const diff = renderDiffLens(story);

  const slot = /<div class="view view-full" data-diff="[0-9a-f]+" data-base="([0-9a-f]+)"><\/div>/;
  const key = review.match(slot)[1];
  assert.equal(diff.match(slot)[1], key);
  assert.doesNotMatch(review + diff, /<table/);
  assert.deepEqual(storyDataFor(story).data.bases, { [key]: '' });
});

test('combined shell edits that repeat one git diff point at a single story-data entry', async () => {
  const { renderReviewLens, storyDataFor } = await import('../cli/src/render/lenses.mjs');
  const hunks = [{ oldStart: 1, oldLines: 1, newStart: 1, newLines: 1, lines: ['-a', '+b'] }];
  const shell = (id, turn, extra) => ({ id, tool: 'Bash', file: '/p/a.ts', rel: 'a.ts', kind: 'update', result: 'ok',
    hunks, stats: { added: 1, removed: 1 }, attribution: 'command', ...extra });
  const story = sampleStory({
    turns: [
      { index: 1, id: 'u1', at: null, prompt: 'p', summary: '', edits: [shell('bash:a.ts:t1', 1, { combined_into: 2 })] },
      { index: 2, id: 'u2', at: null, prompt: 'q', summary: '', edits: [shell('bash:a.ts', 2, {})] },
    ],
    files: [{ rel: 'a.ts', language: 'typescript', turns: [1, 2], churn: false, stats: { added: 1, removed: 1 } }],
  });

  const keys = [...renderReviewLens(story).matchAll(/class="view view-hunks" data-diff="([0-9a-f]+)"/g)].map((m) => m[1]);

  assert.equal(keys.length, 2);
  assert.equal(keys[0], keys[1]);
  assert.deepEqual(Object.keys(storyDataFor(story).data.diffs), [keys[0]]);
});

test('a combined shell edit shows the full file from the turn it is shared with', async () => {
  const { renderReviewLens, storyDataFor } = await import('../cli/src/render/lenses.mjs');
  const hunks = [{ oldStart: 1, oldLines: 1, newStart: 1, newLines: 1, lines: ['-a', '+b'] }];
  const shell = (id, extra) => ({ id, tool: 'Bash', file: '/p/a.ts', rel: 'a.ts', kind: 'update', result: 'ok',
    hunks, stats: { added: 1, removed: 1 }, attribution: 'command', before: null, after: null, ...extra });
  const story = sampleStory({
    turns: [
      { index: 1, id: 'u1', at: null, prompt: 'p', summary: '', edits: [shell('bash:a.ts:t1', { combined_into: 2 })] },
      { index: 2, id: 'u2', at: null, prompt: 'q', summary: '', edits: [shell('bash:a.ts', { before: 'a\n', after: 'b\n' })] },
    ],
    files: [{ rel: 'a.ts', language: 'typescript', turns: [1, 2], churn: false, stats: { added: 1, removed: 1 } }],
  });

  const html = renderReviewLens(story);
  const fulls = [...html.matchAll(/class="view view-full"([^>]*)>/g)].map((m) => m[1]);
  const [key] = Object.keys(storyDataFor(story).data.bases);

  assert.equal(fulls.length, 2);
  assert.ok(fulls.every((attrs) => attrs.includes(`data-base="${key}"`)), fulls.join(' | '));
  assert.doesNotMatch(html, /counted under/);
});

test('a combined shell edit still says where the diff is counted when no turn has the file', async () => {
  const { renderReviewLens } = await import('../cli/src/render/lenses.mjs');
  const hunks = [{ oldStart: 1, oldLines: 1, newStart: 1, newLines: 1, lines: ['-a', '+b'] }];
  const shell = (id, extra) => ({ id, tool: 'Bash', file: '/p/a.ts', rel: 'a.ts', kind: 'update', result: 'ok',
    hunks, stats: { added: 1, removed: 1 }, attribution: 'command', before: null, after: null, ...extra });
  const story = sampleStory({
    turns: [
      { index: 1, id: 'u1', at: null, prompt: 'p', summary: '', edits: [shell('bash:a.ts:t1', { combined_into: 3 })] },
    ],
    files: [{ rel: 'a.ts', language: 'typescript', turns: [1], churn: false, stats: { added: 1, removed: 1 } }],
  });

  assert.match(renderReviewLens(story), /counted under/);
});

test('renderDiffLens puts a name filter above the file tree', async () => {
  const { renderDiffLens } = await import('../cli/src/render/lenses.mjs');
  const story = sampleStory({
    turns: [{ index: 1, id: 'u1', prompt: 'Edit', edits: [
      { id: 'e1', tool: 'Edit', file: '/p/a.js', rel: 'a.js', kind: 'update', by_subagent: null, result: 'ok',
        hunks: [{ oldStart: 1, oldLines: 1, newStart: 1, newLines: 1, lines: ['-a', '+b'] }], stats: { added: 1, removed: 1 } },
    ] }],
    files: [{ rel: 'a.js', language: 'javascript', turns: [1], churn: false, stats: { added: 1, removed: 1 } }],
  });

  const html = renderDiffLens(story);

  assert.match(html, /<div class="file-nav"><label class="file-search">.*<input type="search"[^>]*aria-label="Filter files by name".*<ul class="file-tree">/);
  assert.match(html, /<p class="file-search-empty" hidden>No files match\.<\/p>/);
});

function perTurn(overrides = {}) {
  return {
    index: 1, duration_ms: 134000, duration_source: 'transcript',
    input_tokens: 2000, output_tokens: 12300, cache_read_tokens: 1078000, cache_creation_tokens: 20000, api_calls: 9, complete: true,
    subagents: null, share: { output: 0.42, input: 0.3, duration: 0.2 },
    ...overrides,
  };
}

test('renderTurnUsage shows duration with its source, output and input tokens with the cache share, and a share bar', () => {
  const html = renderTurnUsage(perTurn());
  assert.match(html, /^<p class="turn-usage">/);
  assert.match(html, /<span class="tu-dur" title="reported by Claude Code">2m 14s<\/span>/);
  assert.match(html, /12\.3k out/);
  assert.match(html, /1\.1M in/);
  assert.match(html, /\(98% cache\)/);
  assert.match(html, /<span class="share-track" title="42% of the session’s output tokens"><span class="share-fill" style="width:42%"><\/span><\/span>/);
});

test('renderTurnUsage names subagent tokens apart from the main thread, and says when they were not recorded', () => {
  const sub = (count, withUsage) => perTurn({ subagents: { count, with_usage: withUsage, input_tokens: withUsage ? 10 : null, output_tokens: withUsage ? 45100 : null, cache_read_tokens: withUsage ? 0 : null, cache_creation_tokens: withUsage ? 0 : null } });
  assert.match(renderTurnUsage(sub(2, 2)), /<span class="tu-sub">\+ 45\.1k out in 2 agents<\/span>/);
  assert.match(renderTurnUsage(sub(1, 1)), /\+ 45\.1k out in 1 agent</);
  assert.match(renderTurnUsage(sub(2, 1)), /\+ 45\.1k out in 1 of 2 agents/);
  assert.match(renderTurnUsage(sub(2, 0)), /2 agents, tokens not recorded/);
});

test('renderTurnUsage leaves out what is unknown instead of showing 0', () => {
  const durationOnly = renderTurnUsage(perTurn({ input_tokens: null, output_tokens: null, cache_read_tokens: null, cache_creation_tokens: null, api_calls: null, complete: null, share: { output: null, input: null, duration: 0.2 } }));
  assert.match(durationOnly, /2m 14s/);
  assert.doesNotMatch(durationOnly, /out|share-track|undefined|null/);
  assert.equal(renderTurnUsage(perTurn({ duration_ms: null, duration_source: 'unknown', input_tokens: null, output_tokens: null, cache_read_tokens: null, cache_creation_tokens: null, complete: null, share: { output: null, input: null, duration: null } })), '');
  assert.equal(renderTurnUsage(undefined), '');
  const noDuration = renderTurnUsage(perTurn({ duration_ms: null, duration_source: 'unknown' }));
  assert.doesNotMatch(noDuration, /tu-dur|—/);
  assert.match(renderTurnUsage(perTurn({ complete: false })), /<span class="tu-partial" title="[^"]+">partial<\/span>/);
  assert.doesNotMatch(renderTurnUsage(perTurn({ cache_read_tokens: null })), /cache\)/);
  assert.doesNotMatch(renderTurnUsage(perTurn(), { bar: false }), /share-track/);
});

test('Review and Story show each turn’s usage line from metrics.turns; only the timeline carries the bar', () => {
  const story = sampleStory({ metrics: { turns: [perTurn()] } });
  const review = renderReviewLens(story);
  assert.equal((review.match(/class="turn-usage"/g) || []).length, 2);
  assert.equal((review.match(/class="share-track"/g) || []).length, 1);
  const timeline = review.slice(review.indexOf('<ol class="timeline">'), review.indexOf('</ol>'));
  assert.match(timeline, /share-track/);
  const card = renderStoryLens(story);
  assert.match(card, /class="turn-usage"/);
  assert.doesNotMatch(card, /share-track/);
});

test('a story without metrics.turns renders no usage line', () => {
  assert.doesNotMatch(renderReviewLens(sampleStory()), /turn-usage/);
  assert.doesNotMatch(renderStoryLens(sampleStory()), /turn-usage/);
});

test('turn panels and Story code carry their bodies inert inside a live shell', () => {
  const story = sampleStory();
  const review = renderReviewLens(story);
  assert.match(review, /<section class="turn-panel" data-turn-panel="1"><template data-inert><div class="panel-head">/);
  const storyHtml = renderStoryLens(story);
  if (storyHtml.includes('story-code')) {
    assert.match(storyHtml, /Show code<\/summary><template data-inert>/);
  }
});

test('renderReviewLens adds floating previous/next step buttons with a step counter', () => {
  const turn = (index) => ({ index, id: `u${index}`, at: null, prompt: `Prompt ${index}`, summary: null, edits: [] });
  const html = renderReviewLens(sampleStory({ turns: [turn(1), turn(2), turn(3)] }));
  const nav = html.slice(html.indexOf('<nav class="step-nav"'));
  assert.match(nav, /<button type="button" class="step-btn" data-step="-1" aria-label="Previous step"[^>]*>/);
  assert.match(nav, /<button type="button" class="step-btn" data-step="1" aria-label="Next step"[^>]*>/);
  assert.match(nav, /<span class="step-pos"[^>]*>1 \/ 3<\/span>/);
});

test('renderReviewLens leaves out the step buttons when there is only one turn', () => {
  assert.doesNotMatch(renderReviewLens(sampleStory()), /step-nav/);
});

test('renderHeader adds active time when idle gaps change the duration shown, and not otherwise', () => {
  const withActive = (active_ms) => sampleStory({ metrics: { execution: { active_ms } } });
  assert.match(renderHeader(withActive(120000)), /6m <span class="active-time" title="[^"]+">\(2m active\)<\/span>/);
  assert.doesNotMatch(renderHeader(withActive(330000)), /active-time/);
  assert.doesNotMatch(renderHeader(sampleStory()), /active-time/);
});

test('renderTurnUsage counts cache breaks and leaves them out when there were none', () => {
  assert.match(renderTurnUsage(perTurn({ cache_breaks: 2 })), /<span class="tu-break" title="[^"]+">2 cache breaks<\/span>/);
  assert.match(renderTurnUsage(perTurn({ cache_breaks: 1 })), />1 cache break</);
  assert.doesNotMatch(renderTurnUsage(perTurn({ cache_breaks: 0 })), /tu-break/);
  assert.doesNotMatch(renderTurnUsage(perTurn()), /tu-break/);
});

test('Review and Story show the skills a turn loaded as chips, escaped, and nothing for a turn without any', () => {
  const story = sampleStory({
    turns: [
      { index: 1, id: 'u1', at: '2026-09-10T10:00:00.000Z', prompt: 'a', summary: 's', edits: [], skills: ['superpowers:brainstorming', '<x>'] },
      { index: 2, id: 'u2', at: '2026-09-10T10:01:00.000Z', prompt: 'b', summary: 's', edits: [] },
    ],
  });
  const review = renderReviewLens(story);
  assert.equal((review.match(/class="turn-skills"/g) || []).length, 2); // timeline item and panel of turn 1
  assert.match(review, /<span class="skill-chip">superpowers:brainstorming<\/span><span class="skill-chip">&lt;x&gt;<\/span>/);
  const cards = renderStoryLens(story).split('<article class="story-card">');
  assert.match(cards[1], /class="turn-skills"/);
  assert.doesNotMatch(cards[2], /class="turn-skills"/);
});
