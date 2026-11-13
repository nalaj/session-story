import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { mkdtemp, mkdir, cp, readFile, writeFile, readdir } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const run = promisify(execFile);
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.join(__dirname, '..');
const binPath = path.join(repoRoot, 'cli', 'bin', 'story.mjs');

test('extract -> validate -> render produces a story.json and story.html matching the fixture transcript', async () => {
  const workdir = await mkdtemp(path.join(tmpdir(), 'story-cli-'));
  const cwd = '/proj';
  const claudeDir = path.join(workdir, 'claude-projects');
  const slugDir = path.join(claudeDir, '-proj');
  await mkdir(slugDir, { recursive: true });
  await cp(
    path.join(__dirname, 'fixtures', 'simple-session.jsonl'),
    path.join(slugDir, 'sess-1.jsonl')
  );

  const storyJsonPath = path.join(workdir, 'story.json');
  const extractResult = await run('node', [
    binPath, 'extract',
    '--claude-dir', claudeDir,
    '--cwd', cwd,
    '--session', 'sess-1',
    '-o', storyJsonPath,
    '--brief',
  ]);
  const brief = JSON.parse(extractResult.stdout);
  assert.equal(brief.turns.length, 2);
  assert.equal(brief.turns[0].edits[0].rel, 'src/Panel.tsx');
  // the brief carries the extracted report material Claude writes from
  assert.ok('report' in brief);
  assert.ok('git' in brief.report);
  assert.ok('dependencies' in brief.report);
  assert.ok('hints' in brief);
  assert.ok(Array.isArray(brief.turns[0].commands));
  assert.ok(Array.isArray(brief.turns[0].errors));
  // Claude's replies are the source for turns[N].answer
  assert.ok(Array.isArray(brief.turns[0].replies));

  // non-strict validate passes even though summaries and report are empty
  await run('node', [binPath, 'validate', storyJsonPath]);

  // strict validate fails until summaries and the report are filled
  await assert.rejects(() => run('node', [binPath, 'validate', storyJsonPath, '--strict']));

  const story = JSON.parse(await readFile(storyJsonPath, 'utf8'));
  story.session.title = 'Panel title prop and README';
  story.session.summary = 'Added a title prop and a README.';
  story.turns[0].summary = 'Added a title prop to Panel.';
  story.turns[1].summary = 'Created the README.';
  story.report.plan = 'Add a title prop to Panel and document the project with a README.';
  story.report.decisions = ['Kept the existing prop pattern instead of introducing a new component.'];
  story.report.outcome = 'completed';
  await import('node:fs/promises').then((fs) => fs.writeFile(storyJsonPath, JSON.stringify(story, null, 2)));

  await run('node', [binPath, 'validate', storyJsonPath, '--strict']);

  const storyHtmlPath = path.join(workdir, 'story.html');
  await run('node', [binPath, 'render', storyJsonPath, '-o', storyHtmlPath]);
  const html = await readFile(storyHtmlPath, 'utf8');

  assert.match(html, /Added a title prop to Panel\./);
  assert.match(html, /src\/Panel\.tsx/);
  assert.match(html, /README\.md/);
  assert.match(html, /id="lens-report"/);
  assert.match(html, /Add a title prop to Panel and document the project with a README\./);
  // hunk count in the page matches the IR: 1 Edit hunk + 1 synthesized create hunk.
  // Each is carried once in the story data and named by a placeholder in
  // each code lens (review, diff, story) = 2 * 3 = 6; the Report lens has none.
  const markup = html.replace(/<script[^>]*>[^]*?<\/script>/g, '');
  assert.equal((markup.match(/class="view view-hunks" data-diff="/g) || []).length, 6);
  assert.doesNotMatch(markup, /<table class="hunk/);
  const data = JSON.parse(html.match(/<script type="application\/json" id="story-data">([^]*?)<\/script>/)[1]);
  assert.equal(Object.values(data.diffs).flat().length, 2);
});

test('extract surfaces commands, errors, plan, and git branch from a session with a failed test, a failed edit, and an approved plan', async () => {
  const workdir = await mkdtemp(path.join(tmpdir(), 'story-cli-'));
  const cwd = '/proj';
  const claudeDir = path.join(workdir, 'claude-projects');
  const slugDir = path.join(claudeDir, '-proj');
  await mkdir(slugDir, { recursive: true });
  await cp(
    path.join(__dirname, 'fixtures', 'report-session.jsonl'),
    path.join(slugDir, 'sess-2.jsonl')
  );

  const storyJsonPath = path.join(workdir, 'story.json');
  const extractResult = await run('node', [
    binPath, 'extract',
    '--claude-dir', claudeDir,
    '--cwd', cwd,
    '--session', 'sess-2',
    '--no-git',
    '-o', storyJsonPath,
    '--brief',
  ]);
  const brief = JSON.parse(extractResult.stdout);

  assert.equal(brief.turns.length, 1);
  assert.equal(brief.turns[0].commands.length, 1);
  assert.equal(brief.turns[0].commands[0].category, 'test');
  assert.equal(brief.turns[0].commands[0].ok, false);
  assert.equal(brief.turns[0].commands[0].exit_code, 1);
  assert.equal(brief.turns[0].errors.length, 2);
  assert.equal(brief.turns[0].plan.approved, true);
  assert.equal(brief.hints.outcome, 'partial');
  assert.equal(brief.hints.failed_validations.length, 1);

  const story = JSON.parse(await readFile(storyJsonPath, 'utf8'));
  assert.equal(story.session.git_branch, 'main');
  assert.equal(story.turns[0].edits[0].result, 'error');
});

test('extract joins a session to the one it was split from by /clear, and --no-chain opts out', async () => {
  const workdir = await mkdtemp(path.join(tmpdir(), 'story-cli-'));
  const cwd = '/proj';
  const claudeDir = path.join(workdir, 'claude-projects');
  const slugDir = path.join(claudeDir, '-proj');
  await mkdir(slugDir, { recursive: true });

  // sess-0 is the work before the clear; sess-1 opens with the /clear record
  await cp(path.join(__dirname, 'fixtures', 'simple-session.jsonl'), path.join(slugDir, 'sess-0.jsonl'));
  const clearedAt = new Date('2026-09-14T11:56:45.000Z');
  const fs = await import('node:fs/promises');
  await fs.writeFile(path.join(slugDir, 'sess-1.jsonl'), [
    JSON.stringify({ type: 'user', timestamp: clearedAt.toISOString(), message: { role: 'user', content: '<command-name>/clear</command-name>' } }),
    JSON.stringify({ type: 'user', uuid: 'u9', timestamp: '2026-09-14T12:00:00.000Z', message: { role: 'user', content: 'Now check the tests' } }),
    '',
  ].join('\n'));
  await fs.utimes(path.join(slugDir, 'sess-0.jsonl'), clearedAt, clearedAt);

  const storyJsonPath = path.join(workdir, 'story.json');
  const chained = await run('node', [
    binPath, 'extract', '--claude-dir', claudeDir, '--cwd', cwd, '--session', 'sess-1',
    '-o', storyJsonPath, '--brief',
  ]);
  const brief = JSON.parse(chained.stdout);
  assert.deepEqual(brief.session.chain, ['sess-0', 'sess-1']);
  assert.equal(brief.turns.length, 3);
  assert.equal(brief.turns[2].prompt, 'Now check the tests');
  assert.deepEqual(brief.turns.map((t) => t.index), [1, 2, 3]);

  const story = JSON.parse(await readFile(storyJsonPath, 'utf8'));
  assert.match(story.session.blind_spots.join(' '), /\/clear/);

  const alonePath = path.join(workdir, 'alone.json');
  const alone = await run('node', [
    binPath, 'extract', '--claude-dir', claudeDir, '--cwd', cwd, '--session', 'sess-1',
    '--no-chain', '-o', alonePath, '--brief',
  ]);
  const aloneBrief = JSON.parse(alone.stdout);
  assert.deepEqual(aloneBrief.session.chain, ['sess-1']);
  assert.equal(aloneBrief.turns.length, 1);
});

/** A minimal, valid Story IR — enough for render to have something to write. */
function storyFixture({ id, title, startedAt }) {
  return {
    schema_version: 1,
    session: {
      id, cwd: '/proj', chain: [id], title,
      started_at: startedAt, ended_at: startedAt, duration_ms: 60000,
      summary: `Summary for ${title}.`, blind_spots: [],
    },
    turns: [{ index: 1, id: 'u1', at: startedAt, prompt: title, summary: `Did ${title}.`, edits: [] }],
    files: [],
    totals: { turns: 1, files: 0, added: 0, removed: 0, edits: 0 },
    report: { outcome: 'completed' },
  };
}

test('render builds a session library: one file per session, plus an index and a manifest', async () => {
  const workdir = await mkdtemp(path.join(tmpdir(), 'story-lib-'));
  const libDir = path.join(workdir, 'lib');

  const first = path.join(workdir, 'first.json');
  const second = path.join(workdir, 'second.json');
  await writeFile(first, JSON.stringify(storyFixture({
    id: 'aaaaaaaa-0000', title: 'Add a session browser', startedAt: '2026-09-14T10:00:00.000Z',
  })));
  await writeFile(second, JSON.stringify(storyFixture({
    id: 'bbbbbbbb-1111', title: 'Fix the diff lens', startedAt: '2026-09-12T09:00:00.000Z',
  })));

  await run('node', [binPath, 'render', first, '--library', libDir]);
  await run('node', [binPath, 'render', second, '--library', libDir]);

  const files = (await readdir(libDir)).sort();
  assert.deepEqual(files, [
    '2026-09-12-bbbbbbbb-fix-the-diff-lens.html',
    '2026-09-14-aaaaaaaa-add-a-session-browser.html',
    'index.html',
    'index.json',
    'sessions.js',
  ]);

  const index = await readFile(path.join(libDir, 'index.html'), 'utf8');
  assert.match(index, /href="2026-09-14-aaaaaaaa-add-a-session-browser\.html"/);
  assert.match(index, /href="2026-09-12-bbbbbbbb-fix-the-diff-lens\.html"/);
  assert.equal(index.match(/class="session-card"/g).length, 2);

  const sessions = await readFile(path.join(libDir, 'sessions.js'), 'utf8');
  assert.match(sessions, /window\.SESSION_STORY_LIBRARY/);
  assert.match(sessions, /aaaaaaaa-0000/);
  assert.match(sessions, /bbbbbbbb-1111/);

  const manifest = JSON.parse(await readFile(path.join(libDir, 'index.json'), 'utf8'));
  assert.equal(manifest.entries.length, 2);
  // newest session first
  assert.equal(manifest.entries[0].id, 'aaaaaaaa-0000');

  // a story written into the library carries the cross-session chrome
  const page = await readFile(path.join(libDir, '2026-09-14-aaaaaaaa-add-a-session-browser.html'), 'utf8');
  assert.match(page, /<script src="sessions\.js"><\/script>/);
  assert.match(page, /href="index\.html"/);
});

test('re-rendering a session overwrites its file and updates its index entry, not appends', async () => {
  const workdir = await mkdtemp(path.join(tmpdir(), 'story-lib-'));
  const libDir = path.join(workdir, 'lib');
  const storyPath = path.join(workdir, 'story.json');

  const story = storyFixture({ id: 'aaaaaaaa-0000', title: 'Add a session browser', startedAt: '2026-09-14T10:00:00.000Z' });
  await writeFile(storyPath, JSON.stringify(story));
  await run('node', [binPath, 'render', storyPath, '--library', libDir]);

  story.session.summary = 'Revised summary after another turn.';
  story.totals.turns = 4;
  await writeFile(storyPath, JSON.stringify(story));
  await run('node', [binPath, 'render', storyPath, '--library', libDir]);

  const manifest = JSON.parse(await readFile(path.join(libDir, 'index.json'), 'utf8'));
  assert.equal(manifest.entries.length, 1);
  assert.equal(manifest.entries[0].totals.turns, 4);

  const htmlFiles = (await readdir(libDir)).filter((f) => f.endsWith('.html') && f !== 'index.html');
  assert.deepEqual(htmlFiles, ['2026-09-14-aaaaaaaa-add-a-session-browser.html']);

  const index = await readFile(path.join(libDir, 'index.html'), 'utf8');
  assert.match(index, /Revised summary after another turn\./);
});

test('-o still writes a single standalone page, with no library and no sidecar chrome', async () => {
  const workdir = await mkdtemp(path.join(tmpdir(), 'story-solo-'));
  const storyPath = path.join(workdir, 'story.json');
  const outPath = path.join(workdir, 'out', 'story.html');
  await writeFile(storyPath, JSON.stringify(storyFixture({
    id: 'aaaaaaaa-0000', title: 'Add a session browser', startedAt: '2026-09-14T10:00:00.000Z',
  })));

  await run('node', [binPath, 'render', storyPath, '-o', outPath]);

  const html = await readFile(outPath, 'utf8');
  assert.match(html, /<!doctype html>/i);
  assert.doesNotMatch(html, /<script src=/);
  assert.deepEqual(await readdir(path.join(workdir, 'out')), ['story.html']);
});

test('--no-library keeps the old single-file default', async () => {
  const workdir = await mkdtemp(path.join(tmpdir(), 'story-solo-'));
  const storyPath = path.join(workdir, 'story.json');
  await writeFile(storyPath, JSON.stringify(storyFixture({
    id: 'aaaaaaaa-0000', title: 'Add a session browser', startedAt: '2026-09-14T10:00:00.000Z',
  })));

  await run('node', [binPath, 'render', storyPath, '--no-library'], { cwd: workdir });

  const html = await readFile(path.join(workdir, 'story.html'), 'utf8');
  assert.doesNotMatch(html, /<script src=/);
});

test('an unreadable manifest is kept aside rather than silently overwritten', async () => {
  const workdir = await mkdtemp(path.join(tmpdir(), 'story-lib-'));
  const libDir = path.join(workdir, 'lib');
  const storyPath = path.join(workdir, 'story.json');
  await writeFile(storyPath, JSON.stringify(storyFixture({
    id: 'aaaaaaaa-0000', title: 'Add a session browser', startedAt: '2026-09-14T10:00:00.000Z',
  })));

  await run('node', [binPath, 'render', storyPath, '--library', libDir]);
  await writeFile(path.join(libDir, 'index.json'), 'not json{');
  const { stderr } = await run('node', [binPath, 'render', storyPath, '--library', libDir]);

  assert.match(stderr, /unreadable/);
  assert.match(await readFile(path.join(libDir, 'index.json.broken'), 'utf8'), /not json\{/);
  const manifest = JSON.parse(await readFile(path.join(libDir, 'index.json'), 'utf8'));
  assert.equal(manifest.entries.length, 1);
});

test('extract writes trace, metrics and environment, and --brief carries metrics and per-turn timing', async () => {
  const workdir = await mkdtemp(path.join(tmpdir(), 'story-cli-trace-'));
  const claudeDir = path.join(workdir, 'claude-projects');
  const slugDir = path.join(claudeDir, '-proj');
  await mkdir(slugDir, { recursive: true });
  await cp(path.join(__dirname, 'fixtures', 'trace-session.jsonl'), path.join(slugDir, 'sess-trace.jsonl'));
  const storyJsonPath = path.join(workdir, 'story.json');

  const { stdout } = await run('node', [binPath, 'extract', '--claude-dir', claudeDir, '--cwd', '/proj', '--session', 'sess-trace', '-o', storyJsonPath, '--brief']);
  const brief = JSON.parse(stdout);
  const story = JSON.parse(await readFile(storyJsonPath, 'utf8'));

  assert.equal(story.trace.events.length, 5);
  assert.deepEqual(story.trace.events.map((e) => e.id), ['u1', 'tu1', 'tu2', 'tu3', 'tu4']);
  assert.equal(story.turns[0].duration_ms, 18000);
  assert.equal(story.turns[0].duration_source, 'transcript');
  assert.equal(story.turns[0].usage.api_calls, 4);
  assert.deepEqual(story.environment, { agent: { name: 'Claude Code', version: '2.1.288' }, models: ['claude-opus-5-5'] });
  assert.deepEqual(story.metrics.execution, { duration_ms: 18500, active_ms: 18500, turns: 1, tool_calls: 4, failed_tool_calls: 1, rejected_tool_calls: 0, commands: 2, failed_commands: 1, retries: 1 });
  assert.deepEqual(story.metrics.validation, { commands: 2, passed: 1, failed: 1, final_state: 'passed', last_command: 'npm test' });
  assert.deepEqual(story.metrics.reads, { files_read: 1, tool_calls: 1 });
  assert.equal(story.metrics.usage.source, 'cost-state');
  assert.equal(story.metrics.usage.total_cost_usd, 0.05);
  assert.equal(story.metrics.code.lines_added, 1);

  assert.equal(brief.metrics.execution.retries, 1);
  assert.equal(brief.metrics.usage.total_cost_usd, 0.05);
  assert.equal(brief.turns[0].duration_ms, 18000);
  assert.equal(brief.turns[0].tool_calls, 4);
  assert.equal(brief.environment.agent.version, '2.1.288');
  assert.deepEqual(story.metrics.turns, [{
    index: 1, duration_ms: 18000, duration_source: 'transcript',
    input_tokens: 30, output_tokens: 65, cache_read_tokens: 1100, cache_creation_tokens: 100, api_calls: 4, cache_breaks: 0, complete: true,
    subagents: null, share: { output: 1, input: 1, duration: 0.973 },
  }]);
  assert.equal(brief.turns[0].output_tokens, 65);
  assert.deepEqual(brief.turns[0].share, { output: 1, input: 1, duration: 0.973 });

  // non-strict validate accepts the new blocks; render still works, with four views and the metrics in Report
  await run('node', [binPath, 'validate', storyJsonPath]);
  const htmlPath = path.join(workdir, 'story.html');
  await run('node', [binPath, 'render', storyJsonPath, '-o', htmlPath]);
  const html = await readFile(htmlPath, 'utf8');
  assert.match(html, /id="lens-report"/);
  assert.doesNotMatch(html, /id="lens-trace"/);
  assert.equal((html.match(/class="lens-tab"/g) || []).length, 4);
  assert.match(html, /<span>Session metrics<\/span>/);
  assert.match(html, /<div class="metrics-groups">/);
  assert.match(html, /class="turn-usage"/);
  assert.match(html, /65 out/);
  assert.match(html, /1\.2k in/);
  assert.match(html, /\(89% cache\)/);
  // one turn: nothing to rank
  assert.doesNotMatch(html, /class="where-went"/);
});

test('extract --latest -o <file> writes to the given file (a boolean flag must not eat -o)', async () => {
  const workdir = await mkdtemp(path.join(tmpdir(), 'story-cli-latest-'));
  const claudeDir = path.join(workdir, 'claude-projects');
  const slugDir = path.join(claudeDir, '-proj');
  await mkdir(slugDir, { recursive: true });
  await cp(path.join(__dirname, 'fixtures', 'simple-session.jsonl'), path.join(slugDir, 'sess-1.jsonl'));
  const out = path.join(workdir, 'out.json');
  await run('node', [binPath, 'extract', '--claude-dir', claudeDir, '--cwd', '/proj', '--latest', '-o', out], { cwd: workdir });
  const story = JSON.parse(await readFile(out, 'utf8'));
  assert.equal(story.session.id, 'sess-1');
});

test('export writes PR or handoff markdown to stdout or to -o, and rejects an unknown template', async () => {
  const workdir = await mkdtemp(path.join(tmpdir(), 'story-cli-export-'));
  const claudeDir = path.join(workdir, 'claude-projects');
  const slugDir = path.join(claudeDir, '-proj');
  await mkdir(slugDir, { recursive: true });
  await cp(path.join(__dirname, 'fixtures', 'simple-session.jsonl'), path.join(slugDir, 'sess-1.jsonl'));
  const storyJsonPath = path.join(workdir, 'story.json');
  await run('node', [binPath, 'extract', '--claude-dir', claudeDir, '--cwd', '/proj', '--session', 'sess-1', '--no-git', '-o', storyJsonPath]);

  const pr = await run('node', [binPath, 'export', storyJsonPath]);
  assert.ok(pr.stdout.startsWith('# '));
  assert.match(pr.stdout, /## What changed/);
  assert.match(pr.stdout, /`src\/Panel\.tsx`/);
  assert.doesNotMatch(pr.stdout, /## Turn by turn/);

  const handoff = await run('node', [binPath, 'export', storyJsonPath, '--template', 'handoff']);
  assert.match(handoff.stdout, /## Turn by turn/);

  const out = path.join(workdir, 'out.md');
  const written = await run('node', [binPath, 'export', storyJsonPath, '-o', out]);
  assert.equal(written.stdout, '');
  assert.equal(await readFile(out, 'utf8'), pr.stdout);

  await assert.rejects(
    () => run('node', [binPath, 'export', storyJsonPath, '--template', 'xml']),
    (err) => err.code === 1 && /template must be one of: pr, handoff/.test(err.stderr),
  );
  await assert.rejects(() => run('node', [binPath, 'export']), (err) => err.code === 1 && /usage: story\.mjs export/.test(err.stderr));
});

async function twoSessionLibrary() {
  const workdir = await mkdtemp(path.join(tmpdir(), 'story-del-'));
  const libDir = path.join(workdir, 'lib');
  for (const [name, id, title, startedAt] of [
    ['first', 'aaaaaaaa-0000', 'Add a session browser', '2026-09-14T10:00:00.000Z'],
    ['second', 'bbbbbbbb-1111', 'Fix the diff lens', '2026-09-12T09:00:00.000Z'],
  ]) {
    const storyPath = path.join(workdir, `${name}.json`);
    await writeFile(storyPath, JSON.stringify(storyFixture({ id, title, startedAt })));
    await run('node', [binPath, 'render', storyPath, '--library', libDir]);
  }
  return { workdir, libDir };
}

test('the library index offers hide buttons keyed to its folder, and no command to run', async () => {
  const { libDir } = await twoSessionLibrary();
  const index = await readFile(path.join(libDir, 'index.html'), 'utf8');
  assert.ok(index.includes(`data-library="${libDir}"`));
  assert.equal(index.match(/class="card-hide"/g).length, 2);
  assert.ok(!index.includes('delete-command'));
});

test('delete refuses a running session unless --force, and --all keeps it', async () => {
  const { workdir, libDir } = await twoSessionLibrary();
  const sessionsDir = path.join(workdir, 'sessions');
  await mkdir(sessionsDir);
  // this test process stands in for the Claude Code process running the session
  await writeFile(path.join(sessionsDir, `${process.pid}.json`), JSON.stringify({ pid: process.pid, sessionId: 'bbbbbbbb-1111' }));
  const env = { ...process.env, STORY_CLAUDE_SESSIONS_DIR: sessionsDir };

  await assert.rejects(
    run('node', [binPath, 'delete', '--library', libDir, 'bbbbbbbb'], { env }),
    (err) => /is still running; pass --force/.test(err.stderr) && /Nothing was deleted/.test(err.stderr)
  );
  assert.equal((await readdir(libDir)).length, 5);

  const { stderr } = await run('node', [binPath, 'delete', '--library', libDir, '--all'], { env });
  assert.match(stderr, /Kept 1 running session: Fix the diff lens/);
  assert.match(stderr, /Deleted 1 session/);
  const manifest = JSON.parse(await readFile(path.join(libDir, 'index.json'), 'utf8'));
  assert.deepEqual(manifest.entries.map((e) => e.id), ['bbbbbbbb-1111']);
  assert.match(await readFile(path.join(libDir, 'index.html'), 'utf8'), /class="live-pill"/);

  await run('node', [binPath, 'delete', '--library', libDir, 'bbbbbbbb', '--force'], { env });
  assert.deepEqual(JSON.parse(await readFile(path.join(libDir, 'index.json'), 'utf8')).entries, []);
});

test('delete removes one session: its page, its manifest entry, and its card', async () => {
  const { libDir } = await twoSessionLibrary();
  const { stderr } = await run('node', [binPath, 'delete', '--library', libDir, 'bbbbbbbb']);
  assert.match(stderr, /Deleted 1 session/);

  const files = (await readdir(libDir)).sort();
  assert.deepEqual(files, ['2026-09-14-aaaaaaaa-add-a-session-browser.html', 'index.html', 'index.json', 'sessions.js']);
  const manifest = JSON.parse(await readFile(path.join(libDir, 'index.json'), 'utf8'));
  assert.deepEqual(manifest.entries.map((e) => e.id), ['aaaaaaaa-0000']);
  assert.equal(manifest.cwd, '/proj');
  const index = await readFile(path.join(libDir, 'index.html'), 'utf8');
  assert.equal(index.match(/class="session-card"/g).length, 1);
  assert.ok(!(await readFile(path.join(libDir, 'sessions.js'), 'utf8')).includes('bbbbbbbb'));
});

test('delete --all empties the library but keeps an index to come back to', async () => {
  const { libDir } = await twoSessionLibrary();
  await run('node', [binPath, 'delete', '--library', libDir, '--all']);
  assert.deepEqual((await readdir(libDir)).sort(), ['index.html', 'index.json', 'sessions.js']);
  const manifest = JSON.parse(await readFile(path.join(libDir, 'index.json'), 'utf8'));
  assert.deepEqual(manifest.entries, []);
  assert.match(await readFile(path.join(libDir, 'index.html'), 'utf8'), /No sessions yet/);
});

test('delete refuses an unknown id and changes nothing', async () => {
  const { libDir } = await twoSessionLibrary();
  await assert.rejects(
    run('node', [binPath, 'delete', '--library', libDir, 'aaaaaaaa', 'zzzzzzzz']),
    (err) => /no session matches zzzzzzzz/.test(err.stderr)
  );
  assert.equal((await readdir(libDir)).length, 5);
});

test('delete without ids or --all prints usage', async () => {
  const { libDir } = await twoSessionLibrary();
  await assert.rejects(
    run('node', [binPath, 'delete', '--library', libDir]),
    (err) => /usage: story\.mjs delete/.test(err.stderr)
  );
});
