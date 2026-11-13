/**
 * Report lens: the story of the session itself, not just its diffs -
 * intent, commands, tests, errors, decisions, dependencies, git state,
 * outcome, and the session metrics (where the tokens and time went).
 * Everything here is either read straight off `turns[].bash` /
 * `turns[].errors` / `metrics` (deterministic) or off `report.*` (Claude's
 * judgement, seeded by the `--brief` hints - see SKILL.md).
 */

import { escapeHtml } from './diff.mjs';
import { icon } from './icons.mjs';
import { inert } from './inert.mjs';
import { plural, OUTCOME_LABELS } from './lenses.mjs';
import { renderScorecard, renderWhereItWent, renderMetrics } from './metrics-blocks.mjs';
import { allCommands, allErrors, validationRuns, shortSha, VALIDATION_CATEGORIES } from '../ir/selectors.mjs';

/**
 * Longest command shown in full. Shell commands often carry a whole script
 * as a heredoc; the opening is enough to say what ran, and story.json keeps
 * the rest.
 */
export const COMMAND_SHOWN_MAX = 400;
/** Command rows shown before "Show all"; the rest are carried inert. */
export const COMMANDS_SHOWN = 100;

function commandText(command) {
  const text = String(command || '');
  if (text.length <= COMMAND_SHOWN_MAX) return escapeHtml(text);
  const more = text.length - COMMAND_SHOWN_MAX;
  return `${escapeHtml(text.slice(0, COMMAND_SHOWN_MAX))}<span class="cmd-more">… ${more} more ${plural(more, 'character')}</span>`;
}


function emptyReport() {
  return {
    plan: '', decisions: [], outcome: null, outcome_note: null,
    dependencies: { manifests: [], installs: [], config_files: [] },
    git: null,
  };
}

function noneRecorded() {
  return `<p class="report-empty">None recorded.</p>`;
}

function section(iconName, title, body) {
  return (
    `<section class="report-block">` +
    `<h2>${icon(iconName)}<span>${title}</span></h2>` +
    body +
    `</section>`
  );
}

function statusDot(ok) {
  if (ok === true) return `<span class="cmd-status ok">${icon('check')}</span>`;
  if (ok === false) return `<span class="cmd-status fail">${icon('cross')}</span>`;
  return `<span class="cmd-status unknown">${icon('warning')}</span>`;
}

function renderOutcome(report, story) {
  const outcome = report.outcome;
  const pill = outcome
    ? `<span class="outcome-pill outcome-${escapeHtml(outcome)}">${OUTCOME_LABELS[outcome] || escapeHtml(outcome)}</span>`
    : `<span class="outcome-pill outcome-unknown">Outcome not recorded</span>`;
  const note = report.outcome_note ? `<p class="outcome-note">${escapeHtml(report.outcome_note)}</p>` : '';
  const summary = story.session && story.session.summary
    ? `<p class="report-summary">${escapeHtml(story.session.summary)}</p>`
    : noneRecorded();
  return section('report', 'Outcome & summary', `${pill}${note}${summary}`);
}

function renderPlan(report, turns) {
  const planHtml = report.plan
    ? `<p class="report-plan-text">${escapeHtml(report.plan)}</p>`
    : noneRecorded();
  const turnPlans = turns.filter((t) => t.plan && t.plan.text);
  const detailsHtml = turnPlans
    .map((t) => {
      const status = t.plan.approved ? 'approved' : 'not approved';
      return (
        `<details class="report-turn-plan">` +
        `<summary>${icon('plan')}Plan proposed in turn ${t.index} (${status})</summary>` +
        `<pre>${escapeHtml(t.plan.text)}</pre>` +
        `</details>`
      );
    })
    .join('');
  return section('plan', 'Plan / intent', `${planHtml}${detailsHtml}`);
}

function renderDecisions(report) {
  const decisions = report.decisions || [];
  const body = decisions.length
    ? `<ul class="report-decisions">${decisions.map((d) => `<li>${escapeHtml(d)}</li>`).join('')}</ul>`
    : noneRecorded();
  return section('decision', 'Decisions', body);
}

/**
 * One command. A failed test, lint or build run's output is shown once,
 * under Tests & validation; its row under Commands points there.
 */
function commandRow(entry, { showOutcome = false, outputHere = true } = {}) {
  const exit = entry.exit_code !== null && entry.exit_code !== undefined
    ? `<span class="cmd-exit">exit ${entry.exit_code}</span>`
    : '';
  const statusText = showOutcome
    ? `<span class="cmd-exit">${entry.ok === true ? 'passed' : entry.ok === false ? 'failed' : 'unknown'}</span>`
    : exit;
  const failedWithOutput = entry.ok === false && entry.output_tail;
  const output = failedWithOutput && outputHere
    ? `<details class="report-test-output"><summary>output</summary><pre>${escapeHtml(entry.output_tail)}</pre></details>`
    : '';
  const outputElsewhere = failedWithOutput && !outputHere
    ? `<span class="cmd-exit">output under Tests &amp; validation</span>`
    : '';
  return (
    `<div class="cmd-row">` +
    statusDot(entry.rejected ? false : entry.ok) +
    `<span class="cmd-turn">turn ${entry.turnIndex}</span>` +
    `<span class="badge cmd-category">${escapeHtml(entry.category || 'other')}</span>` +
    `<code class="cmd-text">${commandText(entry.command)}</code>` +
    statusText +
    outputElsewhere +
    `</div>` +
    output
  );
}

function renderCommands(turns) {
  const commands = allCommands(turns);
  if (commands.length === 0) return section('terminal', 'Commands executed', noneRecorded());
  const failed = commands.filter((c) => c.ok === false).length;
  const row = (c) => commandRow(c, { outputHere: !VALIDATION_CATEGORIES.has(c.category) });
  const rows = commands.slice(0, COMMANDS_SHOWN).map(row).join('');
  const rest = commands.slice(COMMANDS_SHOWN);
  // A long session runs hundreds of commands; the rest stay inert until asked for.
  const more = rest.length > 0
    ? `<div class="cmd-rest">${inert(rest.map(row).join(''))}` +
      `<button type="button" class="show-more">Show all ${commands.length} commands</button></div>`
    : '';
  const summary = `<p class="report-count">${commands.length} ${plural(commands.length, 'command')}, ${failed} failed</p>`;
  return section('terminal', 'Commands executed', `${summary}${rows}${more}`);
}

function renderTests(turns) {
  const validation = validationRuns(turns);
  if (validation.length === 0) return section('check', 'Tests & validation', noneRecorded());
  const last = validation[validation.length - 1];
  const lastLine = last.ok === true ? 'last run: passed' : last.ok === false ? 'last run: failed' : 'last run: unknown';
  const rows = validation.map((c) => commandRow(c, { showOutcome: true })).join('');
  return section('check', 'Tests & validation', `<p class="report-count">${lastLine}</p>${rows}`);
}

function renderErrors(turns) {
  const errors = allErrors(turns);
  if (errors.length === 0) return section('warning', 'Errors encountered', noneRecorded());
  const rows = errors
    .map((e) => (
      `<div class="error-row">` +
      `<span class="badge ${e.kind === 'rejected' ? 'badge-rejected' : 'badge-error'}">${e.kind === 'rejected' ? 'rejected' : 'error'}</span>` +
      `<span class="cmd-turn">turn ${e.turnIndex}</span>` +
      `<span class="error-tool">${escapeHtml(e.tool)}</span>` +
      (e.target ? `<code class="cmd-text">${escapeHtml(e.target)}</code>` : '') +
      `<p class="error-message">${escapeHtml(e.message)}</p>` +
      (e.resolution ? `<p class="error-resolution">${icon('check')}${escapeHtml(e.resolution)}</p>` : '') +
      `</div>`
    ))
    .join('');
  return section('warning', 'Errors encountered', rows);
}

function renderDependencies(report) {
  const deps = report.dependencies || { manifests: [], installs: [], config_files: [] };
  const hasAny = deps.manifests.length > 0 || deps.installs.length > 0 || deps.config_files.length > 0;
  if (!hasAny) return section('package', 'Dependencies', noneRecorded());

  const manifestsHtml = deps.manifests
    .map((m) => (
      `<div class="dep-manifest">` +
      `<span class="dep-rel">${escapeHtml(m.rel)}</span>` +
      (m.added.length ? `<span class="dep-added">+${m.added.map(escapeHtml).join(', ')}</span>` : '') +
      (m.removed.length ? `<span class="dep-removed">−${m.removed.map(escapeHtml).join(', ')}</span>` : '') +
      `</div>`
    ))
    .join('');
  const installsHtml = deps.installs.length
    ? `<ul class="dep-installs">${deps.installs.map((i) => `<li><code>${escapeHtml(i.command)}</code> <span class="cmd-turn">turn ${i.turn}</span></li>`).join('')}</ul>`
    : '';
  const configHtml = deps.config_files.length
    ? `<ul class="dep-config">${deps.config_files.map((c) => `<li>${escapeHtml(c.rel)}</li>`).join('')}</ul>`
    : '';
  return section('package', 'Dependencies', `${manifestsHtml}${installsHtml}${configHtml}`);
}

function renderGit(report) {
  const git = report.git;
  if (!git) return section('commit', 'Git state', noneRecorded());

  const branch = git.branch ? `<p class="git-branch">${icon('branch')}${escapeHtml(git.branch)}</p>` : '';
  const range = git.start_commit && git.end_commit
    ? `<p class="git-range">${icon('commit')}<code>${shortSha(git.start_commit.sha)}</code> → <code>${shortSha(git.end_commit.sha)}</code></p>`
    : '';
  const commitsHtml = git.commits && git.commits.length
    ? `<ul class="git-commits">${git.commits.map((c) => (
        `<li><code>${shortSha(c.sha)}</code> ${escapeHtml(c.subject)}` +
        (c.turn ? ` <span class="cmd-turn">turn ${c.turn}</span>` : '') +
        `</li>`
      )).join('')}</ul>`
    : '';
  const status = git.status || {};
  const statusLine = `<p class="git-status">${status.modified || 0} modified, ${status.added || 0} added, ` +
    `${status.deleted || 0} deleted, ${status.untracked || 0} untracked</p>`;

  return section('commit', 'Git state', `${branch}${range}${commitsHtml}${statusLine}`);
}

/** Scorecard and "Where it went"; left out when the story has neither. */
function renderSessionMetrics(story) {
  const body = renderScorecard(story.metrics) + renderWhereItWent(story);
  return body ? section('sparkle', 'Session metrics', body) : '';
}

/** The metrics groups; left out for a story extracted before metrics existed. */
function renderMetricsSection(story) {
  const body = renderMetrics(story);
  return body ? section('trace', 'Metrics', body) : '';
}

/**
 * @param {object} story - Story IR
 * @returns {string}
 */
export function renderReportLens(story) {
  const report = story.report || emptyReport();
  const turns = story.turns || [];
  return (
    `<div class="report-lens">` +
    renderOutcome(report, story) +
    renderSessionMetrics(story) +
    renderPlan(report, turns) +
    renderDecisions(report) +
    renderCommands(turns) +
    renderTests(turns) +
    renderErrors(turns) +
    renderDependencies(report) +
    renderGit(report) +
    renderMetricsSection(story) +
    `</div>`
  );
}
