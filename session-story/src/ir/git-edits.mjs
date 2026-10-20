/**
 * Recovering file changes that a session made through Bash.
 *
 * An Edit or Write tool result carries its own diff; a Bash result carries
 * only stdout, so a `sed -i` or a heredoc that rewrites a file leaves the
 * transcript with nothing to show. Git has what the transcript lacks: it
 * knows exactly which files in the project differ from HEAD and how. This
 * pass asks git what changed, then uses the session's Bash commands (see
 * src/transcript/bash-edits.mjs) to decide which turn to credit.
 *
 * The diff runs from the commit the repo was on when the session started
 * (`sessionStartCommit`) to the working tree, so changes the session made
 * *and then committed* are included; when the session made no commits that
 * base is just HEAD.
 *
 * What this is honest about, because git sees the repository and not the
 * session:
 *   - files that were already dirty before the session are filtered out by
 *     mtime, but a file the session touched *and* someone edited afterwards
 *     still shows both changes, and a commit made during the session by
 *     someone other than the session is indistinguishable from its own.
 *     Every edit from here is marked `base_source: 'git'` and the page
 *     labels it approximate.
 *   - when several turns touched one file, git only has the net change, so
 *     there is one diff to show and more than one turn that earned it. Every
 *     turn that wrote the file carries it, and all but the last are marked
 *     `combined_into: <turn>` so the page can say the diff is the combined
 *     work of those turns rather than that turn's alone. Reporting nothing
 *     for the earlier ones read as "this prompt changed no files", which is
 *     false; reporting an empty diff read the same way. Their stats are not
 *     counted again in the session totals (src/transcript/claude-code.mjs)
 *     or the file index (src/ir/cross-index.mjs).
 *   - `attribution` records how firm the link to the turn is: 'command'
 *     (that turn's command names the file), 'bulk' (that turn ran a
 *     formatter or installer that rewrites files it never names), or
 *     'mention' (the file was only named by a read-only command).
 *
 * Files the transcript already recorded are left alone: a real Edit result
 * beats a reconstruction.
 */

import { resolveIn } from '../transcript/paths.mjs';
import { readFileSync, statSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { analyzeBashCommand } from '../transcript/bash-edits.mjs';

const BINARY_MARKER = /^Binary files .* differ$/m;

export function gitRunner(cwd) {
  return (args) => execFileSync('git', ['-C', cwd, ...args], { encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 });
}

/** `git status --porcelain=v1` lines -> {rel, status} in a stable order. */
export function parseStatus(text) {
  const entries = [];
  for (const line of text.split('\n')) {
    if (line.length < 4) continue;
    const code = line.slice(0, 2);
    let rel = line.slice(3);
    // Paths with unusual characters come back C-quoted.
    if (rel.startsWith('"') && rel.endsWith('"')) rel = JSON.parse(rel);
    entries.push({ rel, status: code });
  }
  return entries;
}

/**
 * `git diff --name-status` lines -> {rel, status} in a stable order. The
 * single-letter codes it prints (M/A/D) read the same way as the porcelain
 * status codes `statusKind` already understands.
 */
export function parseNameStatus(text) {
  const entries = [];
  for (const line of text.split('\n')) {
    if (line.trim() === '') continue;
    const tab = line.indexOf('\t');
    if (tab === -1) continue;
    const code = line.slice(0, tab).trim();
    let rel = line.slice(tab + 1).trim();
    if (rel.startsWith('"') && rel.endsWith('"')) rel = JSON.parse(rel);
    if (rel !== '') entries.push({ rel, status: code });
  }
  return entries;
}

/**
 * The commit the repository was on when the session started. Used both as
 * the base for recovering shell edits and, in src/ir/git-state.mjs, as the
 * start of the session's commit range.
 * @param {(args: string[]) => string} git
 * @param {string|null|undefined} startedAt - ISO timestamp
 * @returns {string|null} full sha, or null when it cannot be determined
 */
export function sessionStartCommit(git, startedAt) {
  if (!startedAt) return null;
  const at = new Date(startedAt);
  if (Number.isNaN(at.getTime())) return null;
  const sha = safe(() => git(['rev-list', '-1', `--before=${at.toISOString()}`, 'HEAD']));
  const trimmed = sha === null ? '' : sha.trim();
  return trimmed === '' ? null : trimmed;
}

function statusKind(code) {
  if (code === '??' || code.includes('A')) return 'create';
  if (code.includes('D')) return 'delete';
  return 'update';
}

/** Parse `git diff` output into the structuredPatch hunks the page renders. */
export function parseUnifiedDiff(text) {
  const hunks = [];
  let current = null;
  for (const line of text.split('\n')) {
    const header = /^@@ -(\d+)(?:,(\d+))? \+(\d+)(?:,(\d+))? @@/.exec(line);
    if (header) {
      current = {
        oldStart: Number(header[1]),
        oldLines: header[2] === undefined ? 1 : Number(header[2]),
        newStart: Number(header[3]),
        newLines: header[4] === undefined ? 1 : Number(header[4]),
        lines: [],
      };
      hunks.push(current);
      continue;
    }
    if (!current) continue;
    if (line.startsWith('\\')) continue; // "\ No newline at end of file"
    if (line === '' || /^[ +-]/.test(line)) current.lines.push(line === '' ? ' ' : line);
    else current = null; // past this hunk, into the next file's header
  }
  return hunks;
}

function wholeFileHunk(text, sign) {
  const lines = text.replace(/\n$/, '').split('\n');
  if (lines.length === 1 && lines[0] === '') return [];
  const count = lines.length;
  return [{
    oldStart: sign === '-' ? 1 : 0,
    oldLines: sign === '-' ? count : 0,
    newStart: sign === '+' ? 1 : 0,
    newLines: sign === '+' ? count : 0,
    lines: lines.map((l) => `${sign}${l}`),
  }];
}

function hunkStats(hunks) {
  let added = 0;
  let removed = 0;
  for (const hunk of hunks) {
    for (const line of hunk.lines) {
      if (line.startsWith('+')) added++;
      else if (line.startsWith('-')) removed++;
    }
  }
  return { added, removed };
}

/**
 * A path as a command named it, in the shape git reports: commands often
 * spell out an absolute path inside the project for a file git calls by its
 * repository-relative name.
 */
function toRepoRelative(claimed, cwd) {
  if (!cwd || !claimed.startsWith(`${cwd}/`)) return claimed;
  return claimed.slice(cwd.length + 1);
}

/**
 * Whether a claimed path covers a path git reported, by suffix. Bash keeps
 * its working directory between calls, so a command run after `cd api`
 * names `tests/x.py` for what git calls `api/tests/x.py`. A claim with a
 * directory component is specific enough to match that way; a bare filename
 * is not, and only ever matches exactly.
 *
 * This is strictly a fallback: a turn that named the path exactly always
 * wins over a later turn that merely matches its tail, since a quoted path
 * inside a script is a far weaker claim than a written one.
 */
function suffixCovers(claimed, rel) {
  for (const candidate of claimed) {
    if (candidate.includes('/') && rel.endsWith(`/${candidate}`)) return true;
  }
  return false;
}

// Evidence for a claim, strongest first: an exact write, a write that only
// matches by suffix, a whole-tree tool, then the same two for a mere mention.
const CLAIM_TIERS = [
  ['command', 'exact'],
  ['command', 'suffix'],
  ['bulk', 'exact'],
  ['mention', 'exact'],
  ['mention', 'suffix'],
];

// The tiers that count as writing the file, as opposed to only naming it.
const WRITE_TIERS = CLAIM_TIERS.filter(([tier]) => tier !== 'mention');

/**
 * Which turn gets credit for each changed path, best evidence first. A file
 * several turns wrote goes to the last of them, since git only has the net
 * change.
 */
function attribute(turns, rels, cwd) {
  // One claim set per turn, collected once: the paths its commands wrote,
  // the paths they only named, and whether it ran a whole-tree tool.
  const claimsByTurn = turns.map((turn) => {
    const claim = { command: new Set(), mention: new Set(), bulk: false };
    for (const call of turn.bash || []) {
      const { writes, mentions, bulk } = analyzeBashCommand(call.command);
      for (const p of writes) claim.command.add(toRepoRelative(p, cwd));
      for (const p of mentions) claim.mention.add(toRepoRelative(p, cwd));
      if (bulk) claim.bulk = true;
    }
    return claim;
  });

  // Does turn `i` claim `rel` at this tier?
  const claims = (i, rel, [tier, mode]) => {
    const claim = claimsByTurn[i];
    if (tier === 'bulk') return claim.bulk;
    return mode === 'exact' ? claim[tier].has(rel) : suffixCovers(claim[tier], rel);
  };
  const wrote = (i, rel) => WRITE_TIERS.some((t) => claims(i, rel, t));

  const owners = new Map();
  for (const rel of rels) {
    for (const [tier, mode] of CLAIM_TIERS) {
      // Later turns win: the last write is what git's net diff reflects.
      for (let i = turns.length - 1; i >= 0; i--) {
        if (!claims(i, rel, [tier, mode])) continue;
        owners.set(rel, {
          turn: turns[i],
          attribution: tier,
          // Earlier turns that also wrote this file. A mere mention is not a
          // write, so it never makes one.
          contributors: tier === 'mention' ? [] : turns.filter((t, j) => j < i && wrote(j, rel)),
        });
        break;
      }
      if (owners.has(rel)) break;
    }
  }
  return owners;
}

/**
 * @param {object} story - Story IR, mutated in place
 * @param {{git?: (args: string[]) => string, readText?: (file: string) => string}} [deps]
 * @returns {number} how many Bash-driven edits were recovered
 */
export function fillBashEditsFromGit(story, deps = {}) {
  const cwd = story.session && story.session.cwd;
  const turns = story.turns || [];
  if (!turns.some((t) => (t.bash || []).length > 0)) return 0;

  const git = deps.git || gitRunner(cwd);
  const readText = deps.readText || ((file) => readFileSync(file, 'utf8'));
  const mtime = deps.mtime || ((file) => statSync(file).mtimeMs);

  let status;
  try {
    status = git(['status', '--porcelain=v1', '-uall', '--no-renames']);
  } catch {
    return 0; // not a git repo, or git unavailable: nothing to recover from
  }

  // Diff from where the repo stood when the session started, so changes it
  // made and then committed are not lost. With no commits since, that is
  // HEAD and this is the plain working-tree diff.
  // Git reports paths from the repository root. When the project is a
  // subfolder of a larger repo, keep only files inside it and make their
  // paths project-relative, so nothing outside the project is read.
  const prefix = (safe(() => git(['rev-parse', '--show-prefix'])) || '').trim();
  const inProject = (entries) => entries
    .filter((c) => c.rel.startsWith(prefix))
    .map((c) => ({ ...c, rel: c.rel.slice(prefix.length) }));

  const head = (safe(() => git(['rev-parse', 'HEAD'])) || '').trim() || null;
  const startSha = sessionStartCommit(git, story.session && story.session.started_at);
  const base = startSha && startSha !== head ? startSha : 'HEAD';

  // A file the transcript already described needs no reconstruction.
  const recorded = new Set();
  for (const turn of turns) for (const edit of turn.edits) recorded.add(edit.rel);

  // A working tree can be dirty for reasons that predate the session. Only
  // files written while it was running can be its doing.
  const startedAt = Date.parse((story.session && story.session.started_at) || '');
  const touchedDuringSession = ({ rel, status: code }) => {
    if (!Number.isFinite(startedAt) || statusKind(code) === 'delete') return true;
    const at = safe(() => mtime(resolveIn(cwd, rel)), null, 'number');
    return at === null || at >= startedAt;
  };

  // Tracked files: everything that differs between the base and the working
  // tree (committed or not). Untracked files have no base to diff against,
  // so they still come from the status listing.
  const tracked = inProject(base === 'HEAD'
    ? parseStatus(status).filter((c) => c.status !== '??')
    : parseNameStatus(safe(() => git(['diff', '--name-status', '--no-renames', base]), '') || ''));
  const untracked = inProject(parseStatus(status).filter((c) => c.status === '??'));
  const seen = new Set();

  const changes = [...tracked, ...untracked]
    .filter((c) => (seen.has(c.rel) ? false : seen.add(c.rel)))
    .filter((c) => !recorded.has(c.rel))
    .filter(touchedDuringSession);
  if (changes.length === 0) return 0;

  const claims = attribute(turns, changes.map((c) => c.rel), cwd);
  let added = 0;

  for (const { rel, status: code } of changes) {
    const claim = claims.get(rel);
    if (!claim) continue; // no turn plausibly caused it; do not invent a link
    const kind = statusKind(code);
    const edit = buildEdit({ rel, kind, cwd, git, readText, claim, base, prefix });
    claim.turn.edits.push(edit);
    added++;

    // Earlier turns wrote this file too, and git cannot separate their work
    // from the net change. They get the same diff, labelled as shared.
    for (const turn of claim.contributors || []) {
      turn.edits.push(combinedEdit(edit, { turn, into: claim.turn.index, cwd, rel }));
      added++;
    }
  }

  return added;
}

function safe(fn, fallback = null, type = 'string') {
  try {
    const value = fn();
    return typeof value === type ? value : fallback;
  } catch {
    return fallback;
  }
}

function buildEdit({ rel, kind, cwd, git, readText, claim, base = 'HEAD', prefix = '' }) {
  const file = resolveIn(cwd, rel);
  const command = lastWritingCommand(claim.turn, rel, cwd);
  const edit = {
    id: `bash:${rel}`,
    tool: 'Bash',
    file,
    rel,
    outside_cwd: false,
    kind,
    result: 'ok',
    hunks: [],
    stats: { added: 0, removed: 0 },
    before: null,
    after: null,
    old_string: null,
    new_string: null,
    replace_all: false,
    base_source: 'git',
    attribution: claim.attribution,
    command,
  };

  if (kind === 'create') {
    const after = safe(() => readText(file), null);
    if (after === null) return edit;
    edit.before = '';
    edit.after = after;
    edit.hunks = wholeFileHunk(after, '+');
  } else if (kind === 'delete') {
    const before = safe(() => git(['show', `${base}:${prefix}${rel}`]), null);
    if (before === null) return edit;
    edit.before = before;
    edit.after = '';
    edit.hunks = wholeFileHunk(before, '-');
  } else {
    const diff = safe(() => git(['diff', base, '-U3', '--no-color', '--', rel]), '');
    if (BINARY_MARKER.test(diff)) {
      edit.binary = true;
      return edit;
    }
    edit.hunks = parseUnifiedDiff(diff);
    edit.before = safe(() => git(['show', `${base}:${prefix}${rel}`]), null);
    edit.after = safe(() => readText(file), null);
  }

  edit.stats = hunkStats(edit.hunks);
  return edit;
}

/**
 * A turn that wrote a file whose diff git can only produce once, for the
 * whole session. It shows the same hunks as the owning turn's edit - a turn
 * that rewrote a component should show the code, not an empty panel - with
 * `combined_into` naming the turn the diff is shared with so the page can
 * say so and the totals can skip it.
 *
 * The full-file text is left off: the diff is the shared part, and three
 * copies of a file's before/after in the IR buy nothing the hunks don't.
 * The page's full-file view borrows the owning turn's pre-edit text instead
 * (planFullBases in render/story-data.mjs).
 */
function combinedEdit(owner, { turn, into, cwd, rel }) {
  return {
    ...owner,
    id: `bash:${rel}:t${turn.index}`,
    before: null,
    after: null,
    combined_into: into,
    command: lastWritingCommand(turn, rel, cwd),
  };
}

/** The command text to show alongside the edit: the last one that wrote it. */
function lastWritingCommand(turn, rel, cwd) {
  let exact = null;
  let loose = null;
  for (const call of turn.bash || []) {
    const { writes, bulk } = analyzeBashCommand(call.command);
    const claimed = new Set(writes.map((p) => toRepoRelative(p, cwd)));
    if (claimed.has(rel)) exact = call.command;
    else if (suffixCovers(claimed, rel)) loose = call.command;
    else if (bulk && loose === null) loose = call.command;
  }
  return exact || loose;
}
