#!/usr/bin/env node
import { writeFile, readFile, mkdir, rename, unlink } from 'node:fs/promises';
import path from 'node:path';
import { execFile } from 'node:child_process';
import { parseTranscript } from '../src/transcript/parse.mjs';
import { liveSessionIds } from '../src/transcript/live.mjs';
import { locateSession, locateSubagents, locateChain, defaultClaudeDir, subagentMetaPath } from '../src/transcript/locate.mjs';
import { buildStory, refreshDerived } from '../src/transcript/claude-code.mjs';
import { fillBashEditsFromGit } from '../src/ir/git-edits.mjs';
import { computeMetrics } from '../src/ir/metrics.mjs';
import { fillBasesFromDisk } from '../src/ir/disk-base.mjs';
import { buildDependencies } from '../src/ir/dependencies.mjs';
import { fillGitState } from '../src/ir/git-state.mjs';
import { validateStory } from '../src/ir/validate.mjs';
import { renderPage } from '../src/render/template.mjs';
import { renderMarkdown, TEMPLATES } from '../src/render/markdown.mjs';
import {
  storyFileName, libraryEntry, upsertEntry, renderSessionsJs, renderIndexPage, selectEntries, isLiveEntry,
  LIBRARY_DIR, MANIFEST_FILE, SESSIONS_FILE, INDEX_FILE,
} from '../src/render/library.mjs';

function parseArgs(argv) {
  const [command, ...rest] = argv;
  const opts = { _: [] };
  for (let i = 0; i < rest.length; i++) {
    const arg = rest[i];
    if (arg.startsWith('--no-')) {
      // A negated flag never takes a value, so it must not eat the next arg.
      opts[arg.slice(5)] = false;
    } else if (arg.startsWith('--')) {
      const key = arg.slice(2);
      const next = rest[i + 1];
      // `-o` is the only short flag; it starts the next option rather than
      // being this one's value (`--latest -o story.json`).
      if (next !== undefined && !next.startsWith('--') && next !== '-o') {
        opts[key] = next;
        i++;
      } else {
        opts[key] = true;
      }
    } else if (arg === '-o') {
      opts.output = rest[i + 1];
      i++;
    } else {
      opts._.push(arg);
    }
  }
  return { command, opts };
}

/**
 * A rough signal for `report.outcome`, from the last test/lint/build
 * command's exit status: Claude reads this alongside the brief and writes
 * the actual field, this is not written to story.json itself.
 */
function outcomeHints(story) {
  const validation = story.turns.flatMap((t) => (t.bash || []).filter((b) => ['test', 'lint', 'build'].includes(b.category)));
  const last = validation[validation.length - 1];
  const outcome = !last || last.ok === null ? null : last.ok ? 'completed' : 'partial';
  const failed_validations = validation
    .filter((b) => b.ok === false)
    .map((b) => ({ command: b.command, output_excerpt: (b.output_tail || '').slice(-600) }));
  return { outcome, failed_validations };
}

/** Tool calls (any tool, main or subagent) the trace attributes to one turn. */
function toolCallsInTurn(story, index) {
  const events = (story.trace && story.trace.events) || null;
  if (!events) return null;
  return events.filter((e) => e.turn === index && e.kind !== 'prompt').length;
}

/**
 * Claude's replies in a turn, as source for `turns[N].answer`. The last one
 * usually carries the answer, so it keeps more text; earlier ones are
 * progress notes and are cut short.
 */
function briefReplies(replies) {
  return replies.map((r, i) => {
    const max = i === replies.length - 1 ? 2000 : 300;
    return r.text.length > max ? `${r.text.slice(0, max)}…` : r.text;
  });
}

function briefProjection(story) {
  const perTurn = new Map(((story.metrics && story.metrics.turns) || []).map((t) => [t.index, t]));
  return {
    session: {
      id: story.session.id,
      cwd: story.session.cwd,
      chain: story.session.chain,
      ai_title: story.session.ai_title,
      summary: story.session.summary,
    },
    report: {
      git: story.report.git,
      dependencies: story.report.dependencies,
    },
    hints: outcomeHints(story),
    environment: story.environment || null,
    metrics: story.metrics
      ? {
        ...story.metrics,
        turns: undefined, // per-turn figures ride on brief.turns instead
        code: {
          ...story.metrics.code,
          files_edited_repeatedly: (story.metrics.code.files_edited_repeatedly || []).slice(0, 5),
        },
      }
      : null,
    turns: story.turns.map((t) => ({
      index: t.index,
      prompt: t.prompt,
      edits: t.edits.map((e) => (e.combined_into
        ? { rel: e.rel, kind: e.kind, stats: e.stats, combined_into: e.combined_into }
        : { rel: e.rel, kind: e.kind, stats: e.stats })),
      commands: (t.bash || []).map((b) => ({ command: b.command, category: b.category, ok: b.ok, exit_code: b.exit_code })),
      errors: (t.errors || []).map((e) => ({ tool: e.tool, target: e.target, message: e.message })),
      plan: t.plan ? { approved: t.plan.approved, excerpt: t.plan.text.slice(0, 1500) } : null,
      replies: briefReplies(t.replies || []),
      duration_ms: t.duration_ms === undefined ? null : t.duration_ms,
      tool_calls: toolCallsInTurn(story, t.index),
      output_tokens: perTurn.has(t.index) ? perTurn.get(t.index).output_tokens : null,
      share: perTurn.has(t.index) ? perTurn.get(t.index).share : null,
      skills: t.skills || [],
      cache_breaks: perTurn.has(t.index) ? perTurn.get(t.index).cache_breaks : null,
    })),
  };
}

/**
 * What this story cannot see, stated plainly on the page. Shell-driven
 * changes come from git rather than the transcript, so their limits differ
 * from the Edit/Write ones and are worth naming.
 */
function blindSpots({ ranShell, recovered, commits = 0, chain = [] }) {
  const spots = [];
  if (chain.length > 1) {
    const earlier = chain.slice(0, -1);
    spots.push(
      `Includes ${earlier.length} earlier session${earlier.length === 1 ? '' : 's'} joined across ` +
      `/clear (${earlier.map((id) => id.slice(0, 8)).join(', ')}): /clear starts a new transcript, ` +
      'so the work before it would otherwise be missing.'
    );
  }
  if (recovered > 0) {
    const base = commits > 0
      ? `git (the commit the session started from, through ${commits} commit${commits === 1 ? '' : 's'} ` +
        'made during it, to the working tree)'
      : 'git (working tree vs HEAD)';
    spots.push(
      `Changes made by shell commands were reconstructed from ${base}, ` +
      'not from the transcript: they may include edits made outside this session.'
    );
  } else if (ranShell) {
    spots.push(
      'This session ran shell commands, which carry no diff in the transcript. Git reported no ' +
      'matching changes since the session started, so any files they changed are not shown.'
    );
  }
  return spots;
}

async function cmdExtract(opts) {
  const cwd = opts.cwd || process.cwd();
  const claudeDir = opts['claude-dir'] || defaultClaudeDir();
  const located = await locateSession({
    claudeDir,
    cwd,
    sessionId: typeof opts.session === 'string' ? opts.session : undefined,
    latest: opts.latest === true || opts.session === undefined,
  });

  // `/clear` starts a new transcript rather than continuing the session, so
  // the work before it lives in another file. Read the whole chain unless
  // asked not to (see src/transcript/locate.mjs).
  const chain = opts.chain === false
    ? [{ sessionId: located.sessionId, transcriptPath: located.transcriptPath }]
    : await locateChain({
      claudeDir,
      cwd,
      sessionId: located.sessionId,
      transcriptPath: located.transcriptPath,
    });

  const records = [];
  const subagents = {};
  for (const link of chain) {
    const parsed = await parseTranscript(link.transcriptPath);
    for (const w of parsed.warnings) process.stderr.write(`warning: ${link.sessionId}: ${w}\n`);
    records.push(...parsed.records);

    const subagentPaths = await locateSubagents({ claudeDir, cwd, sessionId: link.sessionId });
    for (const [agentId, filePath] of Object.entries(subagentPaths)) {
      const sub = await parseTranscript(filePath);
      let meta = null;
      try {
        meta = JSON.parse(await readFile(subagentMetaPath(filePath), 'utf8'));
      } catch {
        meta = null; // older harness versions wrote no meta file
      }
      subagents[agentId] = { records: sub.records, meta };
    }
  }

  const story = buildStory(records, { sessionId: located.sessionId, cwd, subagents });
  story.session.chain = chain.map((link) => link.sessionId);
  // Bash carries no diff in the transcript; git does. Recover those changes
  // and re-derive the counts around them (see src/ir/git-edits.mjs).
  const ranShell = story.turns.some((t) => (t.bash || []).length > 0);
  const recovered = opts.git === false ? 0 : fillBashEditsFromGit(story);
  if (recovered > 0) refreshDerived(story);
  // Files the transcript never snapshotted can often still be read from
  // disk; only verified reversals are kept (see src/ir/disk-base.mjs).
  fillBasesFromDisk(story);
  story.report.dependencies = buildDependencies(story);
  if (opts.git !== false) fillGitState(story);
  // Metrics come last: the git pass above can add edits and change totals.
  story.metrics = computeMetrics(story);
  story.generator = { name: 'session-story', version: '0.4.0' };
  const gitCommits = (story.report.git && story.report.git.commits) || [];
  story.session.blind_spots = blindSpots({
    ranShell,
    recovered,
    commits: gitCommits.length,
    chain: story.session.chain,
  });
  story.session.title = null;

  const outPath = opts.output || 'story.json';
  await writeFile(outPath, JSON.stringify(story, null, 2));
  const joined = chain.length > 1 ? `, ${chain.length} sessions joined across /clear` : '';
  process.stderr.write(`Wrote ${outPath} (${story.turns.length} turns, ${story.files.length} files${joined})\n`);

  if (opts.brief) {
    process.stdout.write(JSON.stringify(briefProjection(story), null, 2) + '\n');
  }
}

async function cmdValidate(opts) {
  const file = opts._[0];
  if (!file) {
    process.stderr.write('usage: story.mjs validate <story.json> [--strict]\n');
    process.exitCode = 1;
    return;
  }
  const story = JSON.parse(await readFile(file, 'utf8'));
  const result = validateStory(story, { strict: opts.strict === true });
  if (result.valid) {
    process.stdout.write('valid\n');
  } else {
    process.stderr.write('invalid:\n');
    for (const err of result.errors) process.stderr.write(`  - ${err}\n`);
    process.exitCode = 1;
  }
}

/**
 * Where this render goes. A story is one self-contained page either way;
 * the library just keeps every session instead of overwriting last one.
 * `-o` still means "that exact file, on its own", so existing scripts and
 * one-off renders behave as they always did.
 */
function renderTarget(story, opts) {
  if (opts.library === false) return { mode: 'single', outPath: opts.output || 'story.html' };
  if (typeof opts.library === 'string') return { mode: 'library', dir: path.resolve(opts.library) };
  if (opts.output) return { mode: 'single', outPath: opts.output };
  const base = story.session.cwd || process.cwd();
  return { mode: 'library', dir: path.resolve(base, LIBRARY_DIR) };
}

/**
 * The manifest is the library's memory. A damaged one is not fatal, but it
 * does mean the index loses the sessions it listed (their pages are still
 * on disk), so keep the broken file rather than overwriting it quietly.
 */
async function readManifest(dir) {
  const manifestPath = path.join(dir, MANIFEST_FILE);
  try {
    const parsed = JSON.parse(await readFile(manifestPath, 'utf8'));
    if (Array.isArray(parsed.entries)) return parsed.entries;
    throw new Error('no entries array');
  } catch (err) {
    if (err.code === 'ENOENT') return [];
    const kept = `${manifestPath}.broken`;
    await rename(manifestPath, kept).catch(() => {});
    process.stderr.write(
      `warning: ${MANIFEST_FILE} is unreadable (${err.message}); kept it as ` +
      `${path.basename(kept)} and started a new index — earlier sessions will drop off it ` +
      `until they are rendered again.\n`
    );
    return [];
  }
}

async function writeLibrary(story, dir) {
  await mkdir(dir, { recursive: true });

  const file = storyFileName(story);
  // One stamp for the page and its index entry, so the two agree.
  const generatedAt = new Date().toISOString();
  const html = renderPage(story, {
    library: { indexHref: INDEX_FILE, manifestHref: SESSIONS_FILE },
    generatedAt,
  });
  const outPath = path.join(dir, file);
  await writeFile(outPath, html);

  const entries = upsertEntry(await readManifest(dir), libraryEntry(story, { file, generatedAt }));
  await writeLibraryIndex(dir, entries, story.session.cwd || '');

  return { outPath, indexPath: path.join(dir, INDEX_FILE), count: entries.length };
}

/**
 * The manifest and the two files regenerated from it. The library folder
 * keys what a browser hides, and the sessions still running when this is
 * written show as live, so their cards can't be hidden.
 */
async function writeLibraryIndex(dir, entries, cwd, live) {
  await writeFile(path.join(dir, MANIFEST_FILE), JSON.stringify({ version: 1, cwd, entries }, null, 2));
  await writeFile(path.join(dir, SESSIONS_FILE), renderSessionsJs(entries, { library: dir }));
  await writeFile(path.join(dir, INDEX_FILE), renderIndexPage(entries, { cwd, library: dir, live: live || await liveSessionIds() }));
}

async function cmdRender(opts) {
  const file = opts._[0];
  if (!file) {
    process.stderr.write('usage: story.mjs render <story.json> [-o out.html] [--library <dir>] [--no-library] [--open]\n');
    process.exitCode = 1;
    return;
  }
  const story = JSON.parse(await readFile(file, 'utf8'));
  const target = renderTarget(story, opts);

  let outPath;
  if (target.mode === 'library') {
    const written = await writeLibrary(story, target.dir);
    outPath = written.outPath;
    process.stderr.write(
      `Wrote ${outPath}\nIndex: ${written.indexPath} (${written.count} ${written.count === 1 ? 'session' : 'sessions'})\n`
    );
  } else {
    outPath = target.outPath;
    await mkdir(path.dirname(path.resolve(outPath)), { recursive: true });
    await writeFile(outPath, renderPage(story));
    process.stderr.write(`Wrote ${outPath}\n`);
  }

  if (opts.open) {
    // No shell: the path is passed as one argument, never parsed as a command.
    const target = path.resolve(outPath);
    const [cmd, args] = process.platform === 'darwin' ? ['open', [target]]
      : process.platform === 'win32' ? ['cmd', ['/c', 'start', '', target]]
      : ['xdg-open', [target]];
    execFile(cmd, args, () => {});
  }
}

/**
 * Remove sessions from a library: each one's page and its manifest entry,
 * then rewrite the index and switcher without them. Every id must name
 * exactly one session or nothing is removed. A session Claude Code is
 * still running is refused unless --force; --all passes over it.
 */
async function cmdDelete(opts) {
  // --all and --force take no value, so a word after one is an id it swallowed
  const keys = [...opts._];
  for (const flag of ['all', 'force']) {
    if (typeof opts[flag] === 'string') { keys.push(opts[flag]); opts[flag] = true; }
  }
  if (!opts.all && !keys.length) {
    process.stderr.write('usage: story.mjs delete <session-id|id-prefix|file>... [--library <dir>] [--force]\n       story.mjs delete --all [--library <dir>] [--force]\n');
    process.exitCode = 1;
    return;
  }
  const dir = path.resolve(typeof opts.library === 'string' ? opts.library : LIBRARY_DIR);
  const manifestPath = path.join(dir, MANIFEST_FILE);
  let manifest;
  try {
    manifest = JSON.parse(await readFile(manifestPath, 'utf8'));
    if (!Array.isArray(manifest.entries)) throw new Error('no entries array');
  } catch (err) {
    process.stderr.write(err.code === 'ENOENT'
      ? `error: no session library at ${dir} (pass --library <dir>)\n`
      : `error: ${manifestPath} is unreadable (${err.message})\n`);
    process.exitCode = 1;
    return;
  }

  const live = await liveSessionIds();
  const selected = opts.all
    ? { removed: manifest.entries, kept: [], unknown: [], ambiguous: [] }
    : selectEntries(manifest.entries, keys);
  const { unknown, ambiguous } = selected;
  const running = opts.force === true ? [] : selected.removed.filter((e) => isLiveEntry(e, live));
  if (unknown.length || ambiguous.length || (running.length && !opts.all)) {
    for (const key of unknown) process.stderr.write(`error: no session matches ${key}\n`);
    for (const key of ambiguous) process.stderr.write(`error: ${key} matches more than one session; use more of its id\n`);
    for (const e of running) process.stderr.write(`error: ${e.title || e.id} (${e.id}) is still running; pass --force to delete it anyway\n`);
    process.stderr.write('Nothing was deleted.\n');
    process.exitCode = 1;
    return;
  }
  const removed = selected.removed.filter((e) => !running.includes(e));
  const kept = manifest.entries.filter((e) => !removed.includes(e));
  if (running.length) {
    process.stderr.write(`Kept ${running.length} running ${running.length === 1 ? 'session' : 'sessions'}: ${running.map((e) => e.title || e.id).join(', ')}\n`);
  }

  for (const entry of removed) {
    // basename: the manifest is a file on disk, so never let it point outside the library
    await unlink(path.join(dir, path.basename(entry.file))).catch((err) => {
      if (err.code !== 'ENOENT') throw err;
    });
  }
  await writeLibraryIndex(dir, kept, manifest.cwd || '', live);
  process.stderr.write(
    `Deleted ${removed.length} ${removed.length === 1 ? 'session' : 'sessions'}` +
    (removed.length ? `: ${removed.map((e) => e.title || e.id).join(', ')}` : '') +
    `\nIndex: ${path.join(dir, INDEX_FILE)} (${kept.length} ${kept.length === 1 ? 'session' : 'sessions'})\n`
  );
}

/**
 * Markdown for a pull request description or a handoff to a fresh session.
 * Stdout by default so it pipes into `pbcopy` or `gh pr create --body-file -`.
 */
async function cmdExport(opts) {
  const file = opts._[0];
  if (!file) {
    process.stderr.write(`usage: story.mjs export <story.json> [--template ${TEMPLATES.join('|')}] [-o out.md] [--all-files]\n`);
    process.exitCode = 1;
    return;
  }
  const template = typeof opts.template === 'string' ? opts.template : 'pr';
  if (!TEMPLATES.includes(template)) {
    process.stderr.write(`error: --template must be one of: ${TEMPLATES.join(', ')}\n`);
    process.exitCode = 1;
    return;
  }
  const story = JSON.parse(await readFile(file, 'utf8'));
  const markdown = renderMarkdown(story, { template, allFiles: opts['all-files'] === true });
  if (opts.output) {
    await mkdir(path.dirname(path.resolve(opts.output)), { recursive: true });
    await writeFile(opts.output, markdown);
    process.stderr.write(`Wrote ${opts.output}\n`);
  } else {
    process.stdout.write(markdown);
  }
}

async function main() {
  const { command, opts } = parseArgs(process.argv.slice(2));
  switch (command) {
    case 'extract':
      await cmdExtract(opts);
      break;
    case 'validate':
      await cmdValidate(opts);
      break;
    case 'render':
      await cmdRender(opts);
      break;
    case 'export':
      await cmdExport(opts);
      break;
    case 'delete':
      await cmdDelete(opts);
      break;
    default:
      process.stderr.write('usage: story.mjs <extract|validate|render|export|delete> [options]\n');
      process.exitCode = 1;
  }
}

main().catch((err) => {
  process.stderr.write(`error: ${err.message}\n`);
  process.exitCode = 1;
});
