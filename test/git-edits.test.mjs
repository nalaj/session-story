import { test } from 'node:test';
import assert from 'node:assert/strict';
import { fillBashEditsFromGit, sessionStartCommit } from '../session-story/src/ir/git-edits.mjs';

const DIFF = [
  'diff --git a/app.py b/app.py',
  'index 111..222 100644',
  '--- a/app.py',
  '+++ b/app.py',
  '@@ -1,3 +1,3 @@',
  ' keep',
  '-old',
  '+new',
  ' tail',
].join('\n');

/** A git double: `plan` maps the first two argv words to canned stdout. */
function fakeGit(plan) {
  const calls = [];
  const git = (args) => {
    calls.push(args);
    const key = args.slice(0, 2).join(' ');
    if (key in plan) return plan[key];
    if (args[0] === 'show') return plan[args.join(' ')] ?? '';
    if (args[0] === 'diff') return plan.diff ?? '';
    throw new Error(`unexpected git ${args.join(' ')}`);
  };
  git.calls = calls;
  return git;
}

function story(turns, cwd = '/proj') {
  return { session: { id: 's', cwd }, turns, files: [], totals: {} };
}
function turn(index, bash, edits = []) {
  return { index, id: `t${index}`, prompt: 'p', summary: '', edits, bash };
}

test('credits a git-detected change to the turn whose command wrote that path', () => {
  const s = story([
    turn(1, [{ id: 'b1', command: 'cat app.py' }]),
    turn(2, [{ id: 'b2', command: "python3 -c \"open('app.py','w').write(x)\"" }]),
  ]);
  const git = fakeGit({ 'status --porcelain=v1': ' M app.py\n', diff: DIFF, 'show HEAD:app.py': 'keep\nold\ntail\n' });

  const added = fillBashEditsFromGit(s, { git, readText: () => 'keep\nnew\ntail\n' });

  assert.equal(added, 1);
  assert.equal(s.turns[0].edits.length, 0);
  const [edit] = s.turns[1].edits;
  assert.equal(edit.tool, 'Bash');
  assert.equal(edit.rel, 'app.py');
  assert.equal(edit.file, '/proj/app.py');
  assert.equal(edit.kind, 'update');
  assert.equal(edit.attribution, 'command');
  assert.equal(edit.base_source, 'git');
  assert.equal(edit.command, "python3 -c \"open('app.py','w').write(x)\"");
  assert.deepEqual(edit.stats, { added: 1, removed: 1 });
  assert.deepEqual(edit.hunks, [
    { oldStart: 1, oldLines: 3, newStart: 1, newLines: 3, lines: [' keep', '-old', '+new', ' tail'] },
  ]);
  assert.equal(edit.before, 'keep\nold\ntail\n');
  assert.equal(edit.after, 'keep\nnew\ntail\n');
});

test('leaves files the transcript already recorded to the transcript', () => {
  const s = story([
    turn(1, [{ id: 'b1', command: "sed -i '' s/a/b/ app.py" }], [
      { id: 'e1', tool: 'Edit', file: '/proj/app.py', rel: 'app.py', hunks: [], stats: { added: 0, removed: 0 } },
    ]),
  ]);
  const git = fakeGit({ 'status --porcelain=v1': ' M app.py\n', diff: DIFF });

  assert.equal(fillBashEditsFromGit(s, { git, readText: () => '' }), 0);
  assert.equal(s.turns[0].edits.length, 1);
});

test('credits a whole-tree tool over a turn that merely read the file', () => {
  const s = story([
    turn(1, [{ id: 'b1', command: 'grep -n x api/other.py' }]),
    turn(2, [{ id: 'b2', command: 'npx prettier --write .' }]),
  ]);
  const git = fakeGit({ 'status --porcelain=v1': ' M app.py\n M api/other.py\n', diff: DIFF, 'show HEAD:app.py': '', 'show HEAD:api/other.py': '' });

  fillBashEditsFromGit(s, { git, readText: () => '' });

  assert.deepEqual(s.turns[0].edits, []);
  assert.deepEqual(
    s.turns[1].edits.map((e) => [e.rel, e.attribution]),
    [['app.py', 'bulk'], ['api/other.py', 'bulk']],
  );
});

test('falls back to the turn that only named the file when nothing wrote it', () => {
  const s = story([
    turn(1, [{ id: 'b1', command: 'grep -n x api/other.py' }]),
    turn(2, [{ id: 'b2', command: 'npx tsc --noEmit' }]),
  ]);
  const git = fakeGit({ 'status --porcelain=v1': ' M api/other.py\n', diff: DIFF, 'show HEAD:api/other.py': '' });

  fillBashEditsFromGit(s, { git, readText: () => '' });

  assert.deepEqual(s.turns[0].edits.map((e) => [e.rel, e.attribution]), [['api/other.py', 'mention']]);
  assert.deepEqual(s.turns[1].edits, []);
});

test('credits a path named relative to a subdirectory the shell had cd-ed into', () => {
  // `cd api && sed -i '' ... tests/x.py` names a path git reports as api/tests/x.py
  const s = story([turn(1, [{ id: 'b1', command: "cd api && sed -i '' s/a/b/ tests/x.py" }])]);
  const git = fakeGit({ 'status --porcelain=v1': ' M api/tests/x.py\n', diff: DIFF, 'show HEAD:api/tests/x.py': '' });

  fillBashEditsFromGit(s, { git, readText: () => '' });

  assert.deepEqual(s.turns[0].edits.map((e) => [e.rel, e.attribution]), [['api/tests/x.py', 'command']]);
});

test('prefers the turn that named the path exactly over a later turn matching only by suffix', () => {
  const s = story([
    turn(1, [{ id: 'b1', command: "python3 -c \"open('api/app/prompts.py','w').write(x)\"" }]),
    // a later turn writes an unrelated file while quoting the shorter path
    turn(2, [{ id: 'b2', command: "node -e \"fs.writeFileSync('notes.md', 'see app/prompts.py')\"" }]),
  ]);
  const git = fakeGit({ 'status --porcelain=v1': ' M api/app/prompts.py\n', diff: DIFF, 'show HEAD:api/app/prompts.py': '' });

  fillBashEditsFromGit(s, { git, readText: () => '' });

  assert.deepEqual(s.turns[0].edits.map((e) => e.rel), ['api/app/prompts.py']);
  assert.deepEqual(s.turns[1].edits, []);
});

test('matches a path a command named absolutely against the relative path git reports', () => {
  const s = story([turn(1, [{ id: 'b1', command: 'node build.js -o /proj/out/report.html' }])]);
  const git = fakeGit({ 'status --porcelain=v1': '?? out/report.html\n' });

  fillBashEditsFromGit(s, { git, readText: () => 'x\n' });

  assert.deepEqual(s.turns[0].edits.map((e) => [e.rel, e.attribution]), [['out/report.html', 'mention']]);
});

test('does not suffix-match a bare filename, which is too weak a claim', () => {
  const s = story([turn(1, [{ id: 'b1', command: "sed -i '' s/a/b/ x.py" }])]);
  const git = fakeGit({ 'status --porcelain=v1': ' M api/tests/x.py\n' });

  assert.equal(fillBashEditsFromGit(s, { git, readText: () => '' }), 0);
});

test('leaves a changed file alone when no turn plausibly caused it', () => {
  const s = story([turn(1, [{ id: 'b1', command: 'cat README.md' }])]);
  const git = fakeGit({ 'status --porcelain=v1': ' M unrelated.py\n' });

  assert.equal(fillBashEditsFromGit(s, { git, readText: () => '' }), 0);
  assert.deepEqual(s.turns[0].edits, []);
});

test('an untracked file is a create, built from its contents on disk', () => {
  const s = story([turn(1, [{ id: 'b1', command: 'echo hi > new.py' }])]);
  const git = fakeGit({ 'status --porcelain=v1': '?? new.py\n' });

  fillBashEditsFromGit(s, { git, readText: () => 'a\nb\n' });

  const [edit] = s.turns[0].edits;
  assert.equal(edit.kind, 'create');
  assert.equal(edit.before, '');
  assert.deepEqual(edit.stats, { added: 2, removed: 0 });
  assert.deepEqual(edit.hunks[0].lines, ['+a', '+b']);
});

test('a deleted file is a delete, built from its contents at HEAD', () => {
  const s = story([turn(1, [{ id: 'b1', command: 'rm old.py' }])]);
  const git = fakeGit({ 'status --porcelain=v1': ' D old.py\n', 'show HEAD:old.py': 'a\nb\n' });

  fillBashEditsFromGit(s, { git, readText: () => { throw new Error('gone'); } });

  const [edit] = s.turns[0].edits;
  assert.equal(edit.kind, 'delete');
  assert.equal(edit.after, '');
  assert.deepEqual(edit.stats, { added: 0, removed: 2 });
});

test('does nothing when the session ran no shell commands', () => {
  const s = story([turn(1, [])]);
  const git = fakeGit({ 'status --porcelain=v1': ' M app.py\n' });

  assert.equal(fillBashEditsFromGit(s, { git, readText: () => '' }), 0);
  assert.equal(git.calls.length, 0);
});

test('does nothing outside a git repository instead of failing the extract', () => {
  const s = story([turn(1, [{ id: 'b1', command: 'echo hi > a.py' }])]);
  const git = () => { throw new Error('not a git repository'); };

  assert.equal(fillBashEditsFromGit(s, { git, readText: () => '' }), 0);
});

test('records a binary change without pretending to have a diff', () => {
  const s = story([turn(1, [{ id: 'b1', command: 'cp a.png web/logo.png' }])]);
  const git = fakeGit({
    'status --porcelain=v1': ' M web/logo.png\n',
    diff: 'diff --git a/web/logo.png b/web/logo.png\nBinary files a/web/logo.png and b/web/logo.png differ\n',
    'show HEAD:web/logo.png': '',
  });

  fillBashEditsFromGit(s, { git, readText: () => '' });

  const [edit] = s.turns[0].edits;
  assert.equal(edit.binary, true);
  assert.deepEqual(edit.hunks, []);
  assert.deepEqual(edit.stats, { added: 0, removed: 0 });
});

test('ignores files that were already dirty before the session started', () => {
  const s = story([turn(1, [{ id: 'b1', command: 'npx prettier --write .' }])]);
  s.session.started_at = '2026-09-11T12:00:00.000Z';
  const git = fakeGit({
    'status --porcelain=v1': ' M stale.py\n M fresh.py\n',
    diff: DIFF,
    'show HEAD:fresh.py': '',
  });
  const mtimes = {
    '/proj/stale.py': Date.parse('2026-09-10T09:00:00.000Z'),
    '/proj/fresh.py': Date.parse('2026-09-11T12:05:00.000Z'),
  };

  fillBashEditsFromGit(s, { git, readText: () => '', mtime: (f) => mtimes[f] });

  assert.deepEqual(s.turns[0].edits.map((e) => e.rel), ['fresh.py']);
});

test('recovers a change the session committed by diffing from the session start commit', () => {
  const s = story([turn(1, [{ id: 'b1', command: "sed -i '' s/old/new/ app.py" }])]);
  s.session.started_at = '2026-09-11T12:00:00.000Z';
  const git = fakeGit({
    'rev-parse HEAD': 'head0head0head0head0head0head0head0head0\n',
    'rev-list -1': 'base0base0base0base0base0base0base0base0\n',
    // the working tree is clean: the change now lives in a commit
    'status --porcelain=v1': '',
    'diff --name-status': 'M\tapp.py\n',
    diff: DIFF,
    'show base0base0base0base0base0base0base0base0:app.py': 'keep\nold\ntail\n',
  });

  const added = fillBashEditsFromGit(s, {
    git,
    readText: () => 'keep\nnew\ntail\n',
    mtime: () => Date.parse('2026-09-11T12:05:00.000Z'),
  });

  assert.equal(added, 1);
  const [edit] = s.turns[0].edits;
  assert.equal(edit.rel, 'app.py');
  assert.equal(edit.kind, 'update');
  assert.equal(edit.base_source, 'git');
  assert.deepEqual(edit.stats, { added: 1, removed: 1 });
  assert.equal(edit.before, 'keep\nold\ntail\n');
  assert.equal(edit.after, 'keep\nnew\ntail\n');
});

test('merges a committed change and a still-untracked file into one set of edits', () => {
  const s = story([turn(1, [{ id: 'b1', command: "sed -i '' s/a/b/ app.py && echo hi > new.py" }])]);
  s.session.started_at = '2026-09-11T12:00:00.000Z';
  const git = fakeGit({
    'rev-parse HEAD': 'head0head0head0head0head0head0head0head0\n',
    'rev-list -1': 'base0base0base0base0base0base0base0base0\n',
    'status --porcelain=v1': '?? new.py\n',
    'diff --name-status': 'M\tapp.py\n',
    diff: DIFF,
    'show base0base0base0base0base0base0base0base0:app.py': 'keep\nold\ntail\n',
  });

  fillBashEditsFromGit(s, {
    git,
    readText: () => 'x\n',
    mtime: () => Date.parse('2026-09-11T12:05:00.000Z'),
  });

  assert.deepEqual(s.turns[0].edits.map((e) => [e.rel, e.kind]), [['app.py', 'update'], ['new.py', 'create']]);
});

test('stays on HEAD when the session made no commits, so nothing is diffed twice', () => {
  const s = story([turn(1, [{ id: 'b1', command: "sed -i '' s/old/new/ app.py" }])]);
  s.session.started_at = '2026-09-11T12:00:00.000Z';
  const sha = 'head0head0head0head0head0head0head0head0';
  const git = fakeGit({
    'rev-parse HEAD': `${sha}\n`,
    'rev-list -1': `${sha}\n`, // start commit is HEAD: no commits during the session
    'status --porcelain=v1': ' M app.py\n',
    diff: DIFF,
    'show HEAD:app.py': 'keep\nold\ntail\n',
  });

  const added = fillBashEditsFromGit(s, {
    git,
    readText: () => 'keep\nnew\ntail\n',
    mtime: () => Date.parse('2026-09-11T12:05:00.000Z'),
  });

  assert.equal(added, 1);
  assert.equal(s.turns[0].edits[0].before, 'keep\nold\ntail\n');
});

test('sessionStartCommit returns the sha before the session, or null when unknowable', () => {
  const git = fakeGit({ 'rev-list -1': 'base0base0base0base0base0base0base0base0\n' });
  assert.equal(sessionStartCommit(git, '2026-09-11T12:00:00.000Z'), 'base0base0base0base0base0base0base0base0');
  assert.equal(sessionStartCommit(git, null), null);
  assert.equal(sessionStartCommit(git, 'not a date'), null);
  assert.equal(sessionStartCommit(fakeGit({ 'rev-list -1': '\n' }), '2026-09-11T12:00:00.000Z'), null);
});

test('keeps a change whose mtime cannot be read', () => {
  const s = story([turn(1, [{ id: 'b1', command: 'rm old.py' }])]);
  s.session.started_at = '2026-09-11T12:00:00.000Z';
  const git = fakeGit({ 'status --porcelain=v1': ' D old.py\n', 'show HEAD:old.py': 'a\n' });

  fillBashEditsFromGit(s, { git, readText: () => '', mtime: () => null });

  assert.deepEqual(s.turns[0].edits.map((e) => e.rel), ['old.py']);
});

test('shows the combined diff on every turn that wrote the file, counted once', () => {
  // Three turns rewrite the same file through the shell. Git has only the net
  // change, but a turn that wrote the file did change code, and the story
  // said "no edits" for the first two.
  const write = (n) => `python3 - <<'EOF'\np='app.py'\ns=open(p).read().replace('a','${n}')\nopen(p,'w').write(s)\nEOF`;
  const s = story([
    turn(1, [{ id: 'b1', command: write(1) }]),
    turn(2, [{ id: 'b2', command: 'cat app.py' }]),
    turn(3, [{ id: 'b3', command: write(3) }]),
  ]);
  const git = fakeGit({ 'status --porcelain=v1': ' M app.py\n', diff: DIFF, 'show HEAD:app.py': 'keep\nold\ntail\n' });

  fillBashEditsFromGit(s, { git, readText: () => 'keep\nnew\ntail\n' });

  // The net diff stays on the last writer, where git's numbers are true.
  const [last] = s.turns[2].edits;
  assert.equal(last.combined_into, undefined);
  assert.deepEqual(last.stats, { added: 1, removed: 1 });

  // The earlier writer shows the same code, marked as shared with turn 3 and
  // credited to the command it actually ran.
  const [first] = s.turns[0].edits;
  assert.equal(first.rel, 'app.py');
  assert.equal(first.kind, 'update');
  assert.equal(first.combined_into, 3);
  assert.deepEqual(first.hunks, last.hunks);
  assert.deepEqual(first.stats, { added: 1, removed: 1 });
  assert.equal(first.command, write(1));
  // The shared record carries no file text of its own.
  assert.equal(first.before, null);
  assert.equal(first.after, null);

  // A turn that only read the file is not a writer and stays empty.
  assert.deepEqual(s.turns[1].edits, []);
});

test('does not invent co-edits when the file was only ever mentioned', () => {
  const s = story([
    turn(1, [{ id: 'b1', command: 'grep -n x api/other.py' }]),
    turn(2, [{ id: 'b2', command: 'cat api/other.py' }]),
  ]);
  const git = fakeGit({ 'status --porcelain=v1': ' M api/other.py\n', diff: DIFF, 'show HEAD:api/other.py': '' });

  fillBashEditsFromGit(s, { git, readText: () => '' });

  assert.equal(s.turns.flatMap((t) => t.edits).length, 1);
});

test('in a subfolder of a larger repo, only reads files inside the project, by project-relative path', () => {
  const s = story([turn(1, [{ id: 'b1', command: 'npx prettier --write .' }])], '/repo/proj');
  const git = fakeGit({
    'rev-parse --show-prefix': 'proj/\n',
    'status --porcelain=v1': ' M other/notes.txt\n M proj/app.py\n',
    diff: DIFF,
    'show HEAD:proj/app.py': 'keep\nold\ntail\n',
  });
  const read = [];

  fillBashEditsFromGit(s, { git, readText: (f) => { read.push(f); return 'keep\nnew\ntail\n'; }, mtime: () => Date.now() });

  assert.deepEqual(s.turns[0].edits.map((e) => e.rel), ['app.py']);
  assert.equal(s.turns[0].edits[0].file, '/repo/proj/app.py');
  assert.equal(s.turns[0].edits[0].before, 'keep\nold\ntail\n');
  assert.deepEqual(read, ['/repo/proj/app.py']);
  assert.ok(!git.calls.some((args) => args.join(' ').includes('other/notes.txt')));
});
