import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildStoryData, planFullBases, inertJson, renderStoryData, contentKey } from '../cli/src/render/story-data.mjs';

const HUNKS = [{ oldStart: 1, oldLines: 1, newStart: 1, newLines: 1, lines: ['-a', '+A'] }];

function edit(id, extra = {}) {
  return { id, rel: `${id}.txt`, result: 'ok', hunks: HUNKS, ...extra };
}

function story(turnEdits) {
  return { turns: turnEdits.map((edits, i) => ({ index: i + 1, edits })) };
}

test('edits with the same hunks share one diff entry, so a combined shell diff is carried once', () => {
  const s = story([
    [edit('bash:a.txt:t1', { combined_into: 2, tool: 'Bash' })],
    [edit('bash:a.txt', { tool: 'Bash' }), edit('other', { hunks: [{ ...HUNKS[0], lines: ['+x'] }] })],
  ]);

  const { diffKeyOf, data } = buildStoryData(s, new Map());

  assert.equal(diffKeyOf.get('bash:a.txt:t1'), diffKeyOf.get('bash:a.txt'));
  assert.notEqual(diffKeyOf.get('other'), diffKeyOf.get('bash:a.txt'));
  assert.equal(Object.keys(data.diffs).length, 2);
  assert.match(diffKeyOf.get('other'), /^[0-9a-f]{12}$/);
  assert.deepEqual(data.diffs[diffKeyOf.get('other')][0].lines, ['+x']);
});

test('edits without hunks have no diff entry', () => {
  const { diffKeyOf, data } = buildStoryData(story([[edit('failed', { result: 'error', hunks: [] })]]), new Map());
  assert.equal(diffKeyOf.has('failed'), false);
  assert.deepEqual(data.diffs, {});
});

test('planFullBases spends the budget on the newest turns first, charged by base text', () => {
  const s = story([[edit('old')], [edit('mid')], [edit('new')]]);
  const bases = new Map([
    ['old', 'a\n' + 'old line\n'.repeat(100)],
    ['mid', 'a\n' + 'mid line\n'.repeat(100)],
    ['new', 'a\n' + 'new line\n'.repeat(100)],
  ]);

  const { plan, texts } = planFullBases(s, bases, bases.get('new').length * 2);

  assert.equal(plan.get('new'), contentKey(bases.get('new')));
  assert.equal(plan.get('mid'), contentKey(bases.get('mid')));
  assert.equal(plan.get('old'), null, 'out of budget');
  assert.deepEqual(Object.keys(texts).sort(), [plan.get('new'), plan.get('mid')].sort());
});

test('planFullBases charges a repeated base text once', () => {
  const base = 'a\n' + 'same\n'.repeat(100);
  const s = story([[edit('one')], [edit('two')]]);
  const { plan, texts } = planFullBases(s, new Map([['one', base], ['two', base]]), base.length);
  assert.equal(plan.get('one'), plan.get('two'));
  assert.equal(Object.keys(texts).length, 1);
});

test('planFullBases leaves out edits that never get a full view, and records "unavailable" as an empty string', () => {
  const s = story([[
    edit('outside', { outside_cwd: true }),
    edit('failed', { result: 'error' }),
    edit('nobase'),
    edit('huge'),
  ]]);
  const { plan } = planFullBases(s, new Map([['huge', 'x\n'.repeat(5000)]]));
  assert.equal(plan.has('outside'), false);
  assert.equal(plan.has('failed'), false);
  assert.equal(plan.get('nobase'), '');
  assert.equal(plan.get('huge'), '', 'over the line cap');
});

test('a shell edit shared with a later turn borrows that turn\'s base, so Full file works on both', () => {
  const base = 'a\n';
  const s = story([
    [edit('bash:a.txt:t1', { rel: 'a.txt', tool: 'Bash', combined_into: 2 })],
    [edit('bash:a.txt', { rel: 'a.txt', tool: 'Bash' })],
  ]);
  const { plan, texts } = planFullBases(s, new Map([['bash:a.txt', base]]));
  assert.equal(plan.get('bash:a.txt'), contentKey(base));
  assert.equal(plan.get('bash:a.txt:t1'), contentKey(base));
  assert.equal(Object.keys(texts).length, 1, 'the base is carried once');
});

test('a shared shell edit follows its owner when the owner has no full view either', () => {
  const s = story([
    [edit('bash:a.txt:t1', { rel: 'a.txt', tool: 'Bash', combined_into: 2 }), edit('bash:b.txt:t1', { rel: 'b.txt', tool: 'Bash', combined_into: 3 })],
    [edit('bash:a.txt', { rel: 'a.txt', tool: 'Bash' })],
  ]);
  const { plan } = planFullBases(s, new Map());
  assert.equal(plan.get('bash:a.txt:t1'), '', 'owner has no base');
  assert.equal(plan.has('bash:b.txt:t1'), false, 'no owner in the story');
});

test('inertJson cannot close or derail the script element, and parses back unchanged', () => {
  const value = { lines: ['+</script><!--<script>', '+</SCRIPT>', 'a\r\nb', ' '] };
  const text = inertJson(value);
  assert.doesNotMatch(text, /<\//);
  assert.doesNotMatch(text, /<!--/);
  assert.doesNotMatch(text, /\r/);
  assert.deepEqual(JSON.parse(text), value);

  const element = renderStoryData(value);
  assert.match(element, /^<script type="application\/json" id="story-data">/);
  assert.equal(element.match(/<\/script>/gi).length, 1);
});
