import { test } from 'node:test';
import assert from 'node:assert/strict';
import { fillGitState } from '../cli/src/ir/git-state.mjs';

/** A git double driven by a table of exact argv matches. */
function fakeGit(table) {
  return (args) => {
    const key = args.join(' ');
    for (const [prefix, output] of table) {
      if (key.startsWith(prefix)) {
        if (output instanceof Error) throw output;
        return output;
      }
    }
    throw new Error(`unexpected git ${key}`);
  };
}

function story(overrides = {}) {
  return {
    session: { id: 's', cwd: '/proj', git_branch: null, started_at: '2026-09-14T10:00:00.000Z', ended_at: '2026-09-14T11:00:00.000Z' },
    turns: [],
    report: { git: null },
    ...overrides,
  };
}

test('fills branch, start/end commits, commit log, and dirty status', () => {
  const s = story();
  const git = fakeGit([
    ['status --porcelain=v1 -uall --no-renames', ' M src/x.js\n?? new.txt\n'],
    ['rev-parse --abbrev-ref HEAD', 'main\n'],
    ['rev-parse HEAD', 'deadbeefcafedeadbeefcafedeadbeefcafedead\n'],
    ['log -1 --format=%s deadbeefcafedeadbeefcafedeadbeefcafedead', 'End commit subject\n'],
    ['rev-list -1 --before=', 'abc1230abc1230abc1230abc1230abc1230abcd\n'],
    ['log -1 --format=%s abc1230abc1230abc1230abc1230abc1230abcd', 'Start commit subject\n'],
    ['log --format=%H%x09%s abc1230abc1230abc1230abc1230abc1230abcd..deadbeefcafedeadbeefcafedeadbeefcafedead', 'deadbeefcafedeadbeefcafedeadbeefcafedead\tEnd commit subject\n'],
  ]);

  const ok = fillGitState(s, { git });

  assert.equal(ok, true);
  assert.equal(s.report.git.branch, 'main');
  assert.equal(s.report.git.end_commit.sha, 'deadbeefcafedeadbeefcafedeadbeefcafedead');
  assert.equal(s.report.git.end_commit.subject, 'End commit subject');
  assert.equal(s.report.git.start_commit.sha, 'abc1230abc1230abc1230abc1230abc1230abcd');
  assert.equal(s.report.git.commits.length, 1);
  assert.equal(s.report.git.commits[0].subject, 'End commit subject');
  assert.equal(s.report.git.dirty, true);
  assert.deepEqual(s.report.git.status, { modified: 1, added: 0, deleted: 0, untracked: 1 });
});

test('prefers session.git_branch over asking git for the branch', () => {
  const s = story({ session: { id: 's', cwd: '/proj', git_branch: 'feature/x', started_at: null, ended_at: null } });
  // rev-parse HEAD is allowed to fail (no commits yet); branch should
  // already be known from the session and not asked of git.
  const okGit = (args) => {
    if (args.join(' ') === 'status --porcelain=v1 -uall --no-renames') return '';
    if (args.join(' ') === 'rev-parse HEAD') throw new Error('no commits');
    throw new Error(`unexpected git ${args.join(' ')}`);
  };

  fillGitState(s, { git: okGit });

  assert.equal(s.report.git.branch, 'feature/x');
  assert.equal(s.report.git.end_commit, null);
  assert.equal(s.report.git.start_commit, null);
  assert.deepEqual(s.report.git.commits, []);
  assert.equal(s.report.git.dirty, false);
});

test('attributes a commit to the turn whose git command produced it', () => {
  const s = story({
    turns: [
      { index: 1, id: 't1', prompt: 'p', summary: '', edits: [], bash: [
        { id: 'b1', command: 'git commit -m "add feature"', category: 'git', ok: true, output_tail: '[main abc1234] add feature\n 1 file changed' },
      ] },
    ],
  });
  const git = fakeGit([
    ['status --porcelain=v1 -uall --no-renames', ''],
    ['rev-parse --abbrev-ref HEAD', 'main\n'],
    ['rev-parse HEAD', 'abc1234abc1234abc1234abc1234abc1234abcd\n'],
    ['log -1 --format=%s abc1234abc1234abc1234abc1234abc1234abcd', 'add feature\n'],
    ['rev-list -1 --before=', 'zzzzzz0zzzzzz0zzzzzz0zzzzzz0zzzzzz0zzzz\n'],
    ['log -1 --format=%s zzzzzz0zzzzzz0zzzzzz0zzzzzz0zzzzzz0zzzz', 'older commit\n'],
    ['log --format=%H%x09%s zzzzzz0zzzzzz0zzzzzz0zzzzzz0zzzzzz0zzzz..abc1234abc1234abc1234abc1234abc1234abcd', 'abc1234abc1234abc1234abc1234abc1234abcd\tadd feature\n'],
  ]);

  fillGitState(s, { git });

  assert.equal(s.report.git.commits[0].turn, 1);
});

test('gives up cleanly (report.git stays null) when the repo is not a git repo', () => {
  const s = story();
  const git = () => { throw new Error('not a git repository'); };

  const ok = fillGitState(s, { git });

  assert.equal(ok, false);
  assert.equal(s.report.git, null);
});
