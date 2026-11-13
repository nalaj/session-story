/**
 * What git knows about the session's branch and commits: the branch, the
 * commit the repo was on when the session started and where it ended, any
 * commits made in between (credited to the turn whose `git commit` produced
 * them), and how dirty the working tree is now.
 *
 * Every step degrades gracefully: a repo with no commits yet, a plain
 * directory that isn't a git repo at all, or a git binary that isn't on
 * PATH all leave `report.git` as `null` rather than throwing.
 */

import { gitRunner, parseStatus, sessionStartCommit } from './git-edits.mjs';
import { parseCommitShas } from './commands.mjs';

function safe(fn) {
  try {
    return fn();
  } catch {
    return null;
  }
}

function subjectOf(git, sha) {
  const subject = safe(() => git(['log', '-1', '--format=%s', sha]));
  return subject === null ? null : subject.trim();
}

/** Which turn's `git commit` produced this sha, by matching its short hash
 * against the ones printed in that turn's `git` bash output. */
function attributeCommitTurn(turns, sha) {
  for (const turn of turns || []) {
    for (const entry of turn.bash || []) {
      if (entry.category !== 'git') continue;
      const shas = parseCommitShas(entry.output_tail || '');
      if (shas.some((short) => sha.startsWith(short))) return turn.index;
    }
  }
  return null;
}

function statusCounts(entries) {
  const counts = { modified: 0, added: 0, deleted: 0, untracked: 0 };
  for (const { status: code } of entries) {
    if (code === '??') counts.untracked++;
    else if (code.includes('A')) counts.added++;
    else if (code.includes('D')) counts.deleted++;
    else counts.modified++;
  }
  return counts;
}

/**
 * @param {object} story - Story IR, mutated in place (sets `report.git`)
 * @param {{git?: (args: string[]) => string}} [deps]
 * @returns {boolean} whether git state was recovered
 */
export function fillGitState(story, deps = {}) {
  const cwd = story.session && story.session.cwd;
  const git = deps.git || gitRunner(cwd);

  const statusText = safe(() => git(['status', '--porcelain=v1', '-uall', '--no-renames']));
  if (statusText === null) {
    story.report.git = null;
    return false;
  }

  const branch = (story.session && story.session.git_branch)
    || (safe(() => git(['rev-parse', '--abbrev-ref', 'HEAD'])) || '').trim()
    || null;

  const endShaRaw = safe(() => git(['rev-parse', 'HEAD']));
  const endSha = endShaRaw ? endShaRaw.trim() : null;
  const endCommit = endSha ? { sha: endSha, subject: subjectOf(git, endSha) } : null;

  let startCommit = null;
  const startedAt = story.session && story.session.started_at;
  if (endSha) {
    const startSha = sessionStartCommit(git, startedAt);
    if (startSha) startCommit = { sha: startSha, subject: subjectOf(git, startSha) };
  }

  let commits = [];
  if (endSha && startCommit) {
    const range = `${startCommit.sha}..${endSha}`;
    const log = safe(() => git(['log', '--format=%H%x09%s', range])) || '';
    commits = log
      .split('\n')
      .filter(Boolean)
      .map((line) => {
        const [sha, subject] = line.split('\t');
        return { sha, subject: subject || '', turn: attributeCommitTurn(story.turns, sha) };
      })
      .reverse();
  }

  const entries = parseStatus(statusText);

  story.report.git = {
    branch,
    start_commit: startCommit,
    end_commit: endCommit,
    commits,
    dirty: entries.length > 0,
    status: statusCounts(entries),
  };
  return true;
}
