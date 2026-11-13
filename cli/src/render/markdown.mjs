/**
 * Markdown export: the session as text to paste into a pull request
 * description (`pr`) or into a fresh Claude Code session as a handoff
 * (`handoff`). Everything comes from story.json; a field the story does not
 * carry is left out, never written as 0 or null.
 */

import { storyTitle, OUTCOME_LABELS, plural } from './lenses.mjs';
import { allErrors, validationRuns, lastValidation, shortSha } from '../ir/selectors.mjs';

export const TEMPLATES = ['pr', 'handoff'];
const OUTPUT_MAX = 600;
const TURN_FILES_MAX = 5;
const COMMAND_MAX = 120;

/** A table cell: pipes escaped, newlines folded into spaces. */
export function mdCell(text) {
  return String(text ?? '').replace(/\|/g, '\\|').replace(/\s*\n\s*/g, ' ');
}

/** An inline code span that survives backticks in the text. */
export function mdCode(text) {
  const s = String(text ?? '');
  return s.includes('`') ? `\`\` ${s} \`\`` : `\`${s}\``;
}

/** The first line of a text, cut to `max` characters with an ellipsis. */
export function firstLine(text, max = 100) {
  const line = String(text ?? '').split('\n')[0].trim();
  return line.length > max ? `${line.slice(0, max - 1)}…` : line;
}

function fence(text) {
  const marker = text.includes('```') ? '~~~~' : '```';
  return `${marker}\n${text}\n${marker}`;
}

function section(title, body) {
  return body ? `## ${title}\n\n${body}` : null;
}

function list(items) {
  const kept = items.filter(Boolean);
  return kept.length ? kept.map((i) => `- ${i}`).join('\n') : '';
}

function emptyReport() {
  return { plan: '', decisions: [], outcome: null, outcome_note: null, dependencies: null, git: null };
}

function runResult(run) {
  return run.ok === true ? 'passed' : run.ok === false ? 'failed' : 'result unknown';
}

function describeRun(run) {
  return `${mdCode(firstLine(run.command, COMMAND_MAX))} — ${runResult(run)} (turn ${run.turnIndex})`;
}

/**
 * Errors in the final turn that nobody wrote a resolution for: what may
 * still be wrong. Earlier ones are left out, since the summary step leaves
 * noise (a grep that found nothing) unresolved on purpose and later turns
 * usually fixed the rest; rejections were the user's own choice.
 */
function openErrors(ctx) {
  const last = ctx.turns.length ? ctx.turns[ctx.turns.length - 1].index : null;
  return allErrors(ctx.turns)
    .filter((e) => e.turnIndex === last && !e.resolution && e.kind !== 'rejected')
    .map((e) => {
      const target = e.target ? ` ${mdCode(firstLine(e.target, 120))}` : '';
      const verb = e.kind === 'rejected' ? 'was rejected' : 'failed';
      return `${e.tool || 'Tool'}${target} ${verb} in turn ${e.turnIndex}: ${firstLine(e.message, 200)}`;
    });
}

function unknownEdits(ctx) {
  return ctx.turns.flatMap((t) => (t.edits || [])
    .filter((e) => e.result === 'unknown' && (ctx.allFiles || !e.outside_cwd))
    .map((e) => `Edit to ${mdCode(e.rel)} attempted, result unknown (turn ${t.index})`));
}

// ---- sections -------------------------------------------------------------

function title(ctx) {
  return `# ${firstLine(storyTitle(ctx.story), 120)}`;
}

function summary(ctx) {
  return ctx.story.session.summary || null;
}

function outcome(ctx) {
  const { outcome: value, outcome_note: note } = ctx.report;
  if (!value) return null;
  return `**Outcome:** ${OUTCOME_LABELS[value] || value}${note ? ` — ${note}` : ''}`;
}

function whereThingsStand(ctx) {
  const last = lastValidation(ctx.turns);
  return section('Where things stand', list([
    ctx.report.outcome_note,
    last ? `Last validation: ${mdCode(firstLine(last.command, COMMAND_MAX))} ${runResult(last)} (turn ${last.turnIndex})` : null,
    ...openErrors(ctx),
    ...unknownEdits(ctx),
  ]));
}

function whatChanged(ctx) {
  const files = ctx.story.files || [];
  const shown = ctx.allFiles ? files : files.filter((f) => !f.outside_cwd);
  const hidden = files.length - shown.length;
  const note = hidden > 0
    ? `_${hidden} ${plural(hidden, 'file')} outside the project omitted (\`--all-files\` includes ${hidden === 1 ? 'it' : 'them'})._`
    : '';
  let body;
  if (files.length === 0) {
    body = '_No files edited in this session._';
  } else if (shown.length === 0) {
    body = `_No project files edited._\n\n${note}`;
  } else {
    const rows = shown.map((f) => {
      const stats = f.stats || { added: 0, removed: 0 };
      const name = mdCell(mdCode(f.rel)) + (f.outside_cwd ? ' (outside project)' : '');
      return `| ${name} | +${stats.added} -${stats.removed} | ${(f.turns || []).join(', ')} |`;
    });
    body = ['| File | Lines | Turns |', '| --- | --- | --- |', ...rows].join('\n') + (note ? `\n\n${note}` : '');
  }
  return section('What changed', body);
}

function turnByTurn(ctx) {
  const lines = ctx.turns.map((t) => {
    const seen = new Map();
    for (const e of t.edits || []) {
      if (!ctx.allFiles && e.outside_cwd) continue;
      const label = e.combined_into ? `${mdCode(e.rel)} (diff shared with turn ${e.combined_into})` : mdCode(e.rel);
      if (!seen.has(e.rel)) seen.set(e.rel, label);
    }
    const labels = [...seen.values()];
    const more = labels.length > TURN_FILES_MAX ? ` and ${labels.length - TURN_FILES_MAX} more` : '';
    const files = labels.length ? `files: ${labels.slice(0, TURN_FILES_MAX).join(', ')}${more}` : 'no files';
    return `${t.index}. **${firstLine(t.summary || t.prompt)}** — ${files}`;
  });
  return section('Turn by turn', lines.join('\n'));
}

function why(ctx) {
  return section('Why', ctx.report.plan || '');
}

function decisions(ctx) {
  return section('Decisions', list(ctx.report.decisions || []));
}

function validation(ctx) {
  const last = lastValidation(ctx.turns);
  if (!last) return null;
  let body = describeRun(last);
  if (ctx.template === 'handoff' && last.ok === false && last.output_tail) {
    body += `\n\n${fence(last.output_tail.slice(-OUTPUT_MAX).replace(/\n+$/, ''))}`;
  }
  return section('Validation', body);
}

function dependencies(ctx) {
  const deps = ctx.report.dependencies || {};
  return section('Dependencies', list([
    ...(deps.manifests || []).map((m) => {
      const changes = [...(m.added || []).map((d) => `+${d}`), ...(m.removed || []).map((d) => `-${d}`)];
      return `${mdCode(m.rel)}${changes.length ? `: ${changes.join(', ')}` : ''}`;
    }),
    ...(deps.installs || []).map((i) => `Installed: ${mdCode(firstLine(i.command, COMMAND_MAX))}${i.turn ? ` (turn ${i.turn})` : ''}`),
    ...(deps.config_files || []).map((c) => `Config changed: ${mdCode(c.rel)}`),
  ]));
}

function git(ctx) {
  const g = ctx.report.git || {};
  const branch = g.branch || ctx.story.session.git_branch;
  const chain = ctx.story.session.chain || [];
  const status = g.status;
  return section('Git', list([
    branch ? `Branch: ${mdCode(branch)}` : null,
    g.start_commit && g.end_commit
      ? `Commits: ${mdCode(shortSha(g.start_commit.sha))} → ${mdCode(shortSha(g.end_commit.sha))}`
      : null,
    ...(g.commits || []).map((c) => `${mdCode(shortSha(c.sha))} ${c.subject}${c.turn ? ` (turn ${c.turn})` : ''}`),
    status
      ? `Working tree: ${status.modified || 0} modified, ${status.added || 0} added, ${status.deleted || 0} deleted, ${status.untracked || 0} untracked`
      : null,
    chain.length > 1 ? `Joins ${chain.length} sessions across /clear: ${chain.map((id) => id.slice(0, 8)).join(', ')}` : null,
  ]));
}

function knownGaps(ctx) {
  const edited = ctx.turns.some((t) => (t.edits || []).length > 0);
  return section('Known gaps', list([
    ...(ctx.story.session.blind_spots || []),
    ...openErrors(ctx),
    ...unknownEdits(ctx),
    edited && validationRuns(ctx.turns).length === 0 ? 'No test, lint or build command was run.' : null,
  ]));
}

function notVerified(ctx) {
  return section('Not verified', list(ctx.story.session.blind_spots || []));
}

const SECTIONS = {
  pr: [title, summary, outcome, whatChanged, why, decisions, validation, dependencies, knownGaps],
  handoff: [title, summary, outcome, whereThingsStand, whatChanged, turnByTurn, why, decisions, validation, dependencies, git, notVerified],
};

/**
 * @param {object} story - Story IR (summaries and report optional)
 * @param {{template?: 'pr'|'handoff', allFiles?: boolean}} [options]
 * @returns {string} markdown ending in one newline
 */
export function renderMarkdown(story, { template = 'pr', allFiles = false } = {}) {
  if (!TEMPLATES.includes(template)) throw new Error(`template must be one of: ${TEMPLATES.join(', ')}`);
  const ctx = {
    story,
    template,
    allFiles,
    turns: story.turns || [],
    report: { ...emptyReport(), ...(story.report || {}) },
  };
  return `${SECTIONS[template].map((s) => s(ctx)).filter(Boolean).join('\n\n')}\n`;
}
