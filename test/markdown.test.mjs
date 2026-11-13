import { test } from 'node:test';
import assert from 'node:assert/strict';
import { renderMarkdown, mdCell, mdCode, firstLine, TEMPLATES } from '../cli/src/render/markdown.mjs';

function sampleStory(overrides = {}) {
  return {
    schema_version: 1,
    session: {
      id: 'sess-1', cwd: '/proj', git_branch: 'feat/panel', chain: ['sess-1'],
      title: 'Panel title prop', summary: 'Panel now takes a title prop.',
      blind_spots: [],
    },
    turns: [
      {
        index: 1, prompt: 'Add a title prop to Panel', summary: 'Added a title prop to Panel.',
        edits: [
          { id: 'e1', rel: 'src/Panel.tsx', kind: 'edit', stats: { added: 3, removed: 1 } },
          { id: 'e2', rel: '../notes/todo.md', kind: 'edit', outside_cwd: true, stats: { added: 1, removed: 0 } },
        ],
        bash: [{ command: 'npm test', category: 'test', ok: false, exit_code: 1, output_tail: '1 failing' }],
        errors: [{ tool: 'Bash', target: 'npm test', message: 'Exit code 1', resolution: 'Fixed the assertion.' }],
      },
      {
        index: 2, prompt: 'Run the tests again', summary: 'Fixed the test and reran it.',
        edits: [{ id: 'e3', rel: 'src/Panel.tsx', kind: 'edit', stats: { added: 1, removed: 1 } }],
        bash: [{ command: 'npm test', category: 'test', ok: true, exit_code: 0 }],
        errors: [],
      },
    ],
    files: [
      { rel: 'src/Panel.tsx', turns: [1, 2], stats: { added: 4, removed: 2 } },
      { rel: '../notes/todo.md', turns: [1], outside_cwd: true, stats: { added: 1, removed: 0 } },
    ],
    totals: { turns: 2, files: 2, added: 5, removed: 2, edits: 3 },
    report: {
      plan: 'Give Panel a title prop and cover it with a test.',
      decisions: ['Kept the existing prop pattern.'],
      outcome: 'completed', outcome_note: null,
      dependencies: { manifests: [], installs: [], config_files: [] },
      git: {
        branch: 'feat/panel', start_commit: { sha: 'aaaaaaa1111' }, end_commit: { sha: 'bbbbbbb2222' },
        commits: [{ sha: 'bbbbbbb2222', subject: 'feat: title prop', turn: 2 }],
        status: { modified: 1, added: 0, deleted: 0, untracked: 0 },
      },
    },
    ...overrides,
  };
}

test('helpers escape table cells and code spans and keep one line', () => {
  assert.equal(mdCell('a|b.md'), 'a\\|b.md');
  assert.equal(mdCell('two\nlines'), 'two lines');
  assert.equal(mdCode('npm test'), '`npm test`');
  assert.equal(mdCode('echo `x`'), '`` echo `x` ``');
  assert.equal(firstLine('one\ntwo'), 'one');
  assert.equal(firstLine('x'.repeat(300)).length, 100);
  assert.ok(firstLine('x'.repeat(300)).endsWith('…'));
  assert.deepEqual(TEMPLATES, ['pr', 'handoff']);
});

test('the PR template has the title, summary, outcome, changes, why, decisions and validation', () => {
  const md = renderMarkdown(sampleStory());
  assert.ok(md.startsWith('# Panel title prop\n\nPanel now takes a title prop.\n\n**Outcome:** Completed\n'));
  assert.match(md, /## What changed\n\n\| File \| Lines \| Turns \|\n\| --- \| --- \| --- \|\n\| `src\/Panel\.tsx` \| \+4 -2 \| 1, 2 \|/);
  assert.match(md, /## Why\n\nGive Panel a title prop and cover it with a test\./);
  assert.match(md, /## Decisions\n\n- Kept the existing prop pattern\./);
  assert.match(md, /## Validation\n\n`npm test` — passed \(turn 2\)/);
  assert.doesNotMatch(md, /## Turn by turn|## Git|## Where things stand/);
  assert.ok(md.endsWith('\n') && !md.endsWith('\n\n'));
});

test('files outside the project are left out with a note unless allFiles is set', () => {
  const md = renderMarkdown(sampleStory());
  assert.doesNotMatch(md, /todo\.md/);
  assert.match(md, /_1 file outside the project omitted/);
  const all = renderMarkdown(sampleStory(), { allFiles: true });
  assert.match(all, /\| `\.\.\/notes\/todo\.md` \(outside project\) \| \+1 -0 \| 1 \|/);
  assert.doesNotMatch(all, /omitted/);
});

test('a backtick or pipe in a path keeps the table to three cells', () => {
  const story = sampleStory();
  story.files = [{ rel: 'a|b`c.md', turns: [1], stats: { added: 1, removed: 0 } }];
  const row = renderMarkdown(story).split('\n').find((l) => l.includes('b`c'));
  assert.equal(row, '| `` a\\|b`c.md `` | +1 -0 | 1 |');
});

test('unknown or empty fields are left out, never written as 0 or null', () => {
  const story = sampleStory({ report: undefined });
  story.session.summary = '';
  story.session.title = null;
  story.turns.forEach((t) => { t.bash = []; });
  const md = renderMarkdown(story);
  assert.ok(md.startsWith('# Add a title prop to Panel\n'));
  assert.doesNotMatch(md, /Outcome|## Why|## Decisions|## Validation|## Dependencies|null|undefined/);
  assert.match(md, /## Known gaps\n\n- No test, lint or build command was run\./);
});

test('no edits says so instead of an empty table', () => {
  const md = renderMarkdown(sampleStory({ files: [] }));
  assert.match(md, /## What changed\n\n_No files edited in this session\._/);
});

test('known gaps carry blind spots and errors left without a resolution', () => {
  const story = sampleStory();
  story.session.blind_spots = ['Changes made by shell commands were reconstructed from git.'];
  story.turns[1].errors = [{ tool: 'Edit', target: 'src/x.ts', message: 'File not found', resolution: null }];
  const md = renderMarkdown(story);
  assert.match(md, /## Known gaps\n\n- Changes made by shell commands were reconstructed from git\.\n- Edit `src\/x\.ts` failed in turn 2: File not found/);
  assert.doesNotMatch(md, /Exit code 1/);
});

test('dependencies list manifest changes, installs and config files', () => {
  const story = sampleStory();
  story.report.dependencies = {
    manifests: [{ rel: 'package.json', added: ['zod'], removed: ['lodash'] }],
    installs: [{ command: 'npm install zod', turn: 1 }],
    config_files: [{ rel: 'tsconfig.json' }],
  };
  const md = renderMarkdown(story);
  assert.match(md, /## Dependencies\n\n- `package\.json`: \+zod, -lodash\n- Installed: `npm install zod` \(turn 1\)\n- Config changed: `tsconfig\.json`/);
});

test('the handoff template adds where things stand, turn by turn and git, and shows a failing run’s output', () => {
  const story = sampleStory();
  story.report.outcome = 'partial';
  story.report.outcome_note = 'The Storybook story is still missing.';
  story.turns[1].bash[0].ok = false;
  story.turns[1].bash[0].output_tail = 'Expected 2 to equal 3';
  story.turns[1].edits.push({ id: 'e4', rel: 'src/gen.ts', kind: 'edit', stats: { added: 0, removed: 0 }, combined_into: 1 });
  story.turns[1].prompt = `${'Very long prompt '.repeat(20)}\nsecond line`;
  story.turns[1].summary = '';
  story.session.chain = ['sess-0', 'sess-1'];
  const md = renderMarkdown(story, { template: 'handoff' });
  assert.match(md, /\*\*Outcome:\*\* Partial — The Storybook story is still missing\./);
  assert.match(md, /## Where things stand\n\n- The Storybook story is still missing\.\n- Last validation: `npm test` failed \(turn 2\)/);
  assert.match(md, /## Turn by turn\n\n1\. \*\*Added a title prop to Panel\.\*\* — files: `src\/Panel\.tsx`\n2\. \*\*Very long prompt/);
  assert.match(md, /`src\/gen\.ts` \(diff shared with turn 1\)/);
  assert.doesNotMatch(md, /second line/);
  assert.match(md, /## Validation\n\n`npm test` — failed \(turn 2\)\n\n```\nExpected 2 to equal 3\n```/);
  assert.match(md, /## Git\n\n- Branch: `feat\/panel`\n- Commits: `aaaaaaa` → `bbbbbbb`\n- `bbbbbbb` feat: title prop \(turn 2\)\n- Working tree: 1 modified, 0 added, 0 deleted, 0 untracked\n- Joins 2 sessions across \/clear: sess-0, sess-1/);
  assert.doesNotMatch(md, /## Known gaps/);
});

test('an unknown template throws', () => {
  assert.throws(() => renderMarkdown(sampleStory(), { template: 'xml' }), /template must be one of: pr, handoff/);
});

test('only the last turn’s unresolved errors count as open; earlier ones and rejections are left out', () => {
  const story = sampleStory();
  story.turns[0].errors = [{ tool: 'Bash', target: 'grep foo', message: 'Exit code 1', resolution: null }];
  story.turns[1].errors = [
    { tool: 'ExitPlanMode', kind: 'rejected', message: 'User rejected tool use', resolution: null },
    { tool: 'Edit', target: 'src/x.ts', message: 'File not found', resolution: null },
  ];
  const md = renderMarkdown(story, { template: 'handoff' });
  assert.match(md, /Edit `src\/x\.ts` failed in turn 2: File not found/);
  assert.doesNotMatch(md, /grep foo|ExitPlanMode/);
});

test('turn by turn names at most five files, then a count', () => {
  const story = sampleStory();
  story.turns[0].edits = Array.from({ length: 7 }, (_, i) => ({ id: `f${i}`, rel: `src/f${i}.ts`, stats: { added: 1, removed: 0 } }));
  const md = renderMarkdown(story, { template: 'handoff' });
  assert.match(md, /`src\/f4\.ts` and 2 more\n/);
  assert.doesNotMatch(md, /f5\.ts/);
});
