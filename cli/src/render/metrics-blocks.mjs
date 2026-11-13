/**
 * Session metrics shown in the Report lens: a scorecard of the counts the
 * header does not already show, "Where it went" (the turns that took the
 * most output tokens and time), and the metrics groups. Everything reads
 * `story.metrics` (see src/ir/metrics.mjs). Unknown values are omitted or
 * marked "not recorded", never shown as 0. Each renderer returns '' when
 * the story carries nothing for it, so an older story.json loses nothing.
 */

import { escapeHtml } from './diff.mjs';
import {
  statTile, plural, dual, formatTokens, formatCost, inputWithCache, formatLatency, DURATION_SOURCE_LABEL,
  ACTIVE_TITLE, CACHE_BREAK_TITLE,
} from './lenses.mjs';

// Shared with the header and the library page.
export { formatTokens, formatCost, formatLatency };

const USAGE_SOURCE_LABEL = {
  'cost-state': "Claude Code's session cost record",
  transcript: 'summed from the transcript, once per API call',
};

const isNum = (v) => typeof v === 'number' && Number.isFinite(v);

function na(reason) {
  return `<span class="metrics-na">not recorded</span>` + (reason ? ` <span class="metrics-note">${reason}</span>` : '');
}

function num(v) {
  return isNum(v) ? String(v) : na();
}

/**
 * A code count in both scopes, like the header: the page shows the
 * project-only value unless "Project files only" is switched off.
 * Stories whose metrics predate `in_project` show the one total.
 */
function scoped(c, key, format) {
  const all = c[key];
  const inside = c.in_project ? c.in_project[key] : undefined;
  if (!isNum(all)) return format(all);
  return isNum(inside) ? dual(format(inside), format(all)) : format(all);
}

const COST_NOTE = 'API-equivalent estimate';
const COST_TITLE = "Claude Code's estimate at API list prices. A Pro or Max subscription does not bill this amount.";

function costValue(usd) {
  const cost = formatCost(usd);
  if (!cost) return na('Claude Code writes cost when a session ends');
  return `<span title="${escapeHtml(COST_TITLE)}">${cost}</span> <span class="metrics-note">${COST_NOTE}</span>`;
}

/** Each joined session's cost, in chain order, so a reader sees where a total came from. */
function costBySession(sessions) {
  const items = sessions.map((s) => {
    const models = s.models.map((m) => `<code>${escapeHtml(m.replace(/^claude-/, ''))}</code>`).join(', ');
    const cost = formatCost(s.cost_usd) || na('still running when this page was made');
    return `<li><code>${escapeHtml(s.session_id.slice(0, 8))}</code> ${cost}${models ? ` <span class="metrics-note">${models}</span>` : ''}</li>`;
  });
  return `<ul class="metrics-list">${items.join('')}</ul>`;
}

function row(label, valueHtml) {
  return `<dt>${label}</dt><dd>${valueHtml}</dd>`;
}

/**
 * The counts the header leaves out: tool calls, failures, validation and
 * retries. Duration, turns, files, lines, tokens and cost are in the header.
 */
export function renderScorecard(metrics) {
  if (!metrics) return '';
  const x = metrics.execution || {};
  const v = metrics.validation || {};
  const tiles = [];
  if (isNum(x.tool_calls)) tiles.push(statTile('terminal', x.tool_calls, plural(x.tool_calls, 'tool call')));
  if (isNum(x.failed_tool_calls)) tiles.push(statTile('cross', x.failed_tool_calls, 'failed', x.failed_tool_calls > 0 ? 'removed' : ''));
  if (isNum(v.commands) && v.commands > 0) {
    const cls = v.final_state === 'passed' ? 'added' : v.final_state === 'failed' ? 'removed' : '';
    tiles.push(statTile('check', `${v.passed}/${v.commands}`, `validation, last ${escapeHtml(v.final_state)}`, cls));
  }
  if (isNum(x.retries)) tiles.push(statTile('retry', x.retries, x.retries === 1 ? 'retry' : 'retries'));
  return tiles.length ? `<div class="metrics-scorecard">${tiles.join('')}</div>` : '';
}

function group(title, rows) {
  return `<section class="metrics-group"><h3>${title}</h3><dl>${rows.join('')}</dl></section>`;
}

/** The Execution, Code, Validation, Reads and Usage groups; '' without metrics. */
export function renderMetrics(story) {
  const m = story && story.metrics;
  if (!m) return '';
  const x = m.execution || {};
  const c = m.code || {};
  const v = m.validation || {};
  const r = m.reads || {};
  const u = m.usage || {};
  const repeated = c.files_edited_repeatedly || [];
  const groups = [
    group('Execution', [
      row('Duration', formatLatency(x.duration_ms) || na()),
      ...(isNum(x.active_ms) ? [row('Active', `<span title="${ACTIVE_TITLE}">${formatLatency(x.active_ms)}</span>`)] : []),
      row('Turns', num(x.turns)),
      row('Tool calls', num(x.tool_calls)),
      row('Failed', num(x.failed_tool_calls)),
      row('Rejected', num(x.rejected_tool_calls)),
      row('Commands', num(x.commands)),
      row('Failed commands', num(x.failed_commands)),
      row('Retries', num(x.retries)),
    ]),
    group('Code', [
      row('Files changed', scoped(c, 'files_changed', num)),
      row('Lines added', scoped(c, 'lines_added', num)),
      row('Lines removed', scoped(c, 'lines_removed', num)),
      row('Edits', scoped(c, 'edits', num)),
      row('Edited more than once', repeated.length
        ? `<ul class="metrics-list">${repeated.map((f) => `<li${f.outside_cwd ? ' data-outside="1"' : ''}><code>${escapeHtml(f.rel)}</code> ×${f.edits}</li>`).join('')}</ul>`
        : 'none'),
    ]),
    group('Validation', [
      row('Test, lint, build runs', num(v.commands)),
      row('Passed', num(v.passed)),
      row('Failed', num(v.failed)),
      row('Last result', escapeHtml(v.final_state || 'unknown')),
      row('Last command', v.last_command ? `<code>${escapeHtml(v.last_command)}</code>` : na()),
    ]),
    group('Reads', [
      row('Files read', num(r.files_read)),
      row('Read, Glob, Grep calls', num(r.tool_calls)),
    ]),
  ];
  if (u.source && u.source !== 'none') {
    groups.push(group('Usage', [
      row('Input tokens', formatTokens(u.input_tokens) || na()),
      row('Output tokens', formatTokens(u.output_tokens) || na()),
      row('Cache read', formatTokens(u.cache_read_tokens) || na()),
      row('Cache write', formatTokens(u.cache_creation_tokens) || na()),
      ...(isNum(u.cache_read_share) ? [row('Read from cache', `${Math.round(u.cache_read_share * 100)}% of input`)] : []),
      ...(isNum(u.cache_breaks) ? [row('Cache breaks', `<span title="${CACHE_BREAK_TITLE}">${u.cache_breaks}</span>`)] : []),
      row('Cost', costValue(u.total_cost_usd)),
      ...((u.sessions || []).length > 1 ? [row('Cost by session', costBySession(u.sessions))] : []),
      row('Models', (u.models || []).map((model) => `<code>${escapeHtml(model)}</code>`).join(', ') || na()),
      row('Source', USAGE_SOURCE_LABEL[u.source] || escapeHtml(u.source)),
      ...(u.complete ? [] : [row('Complete', 'no, some API calls carried no usage')]),
    ]));
  }
  const env = story.environment && story.environment.agent;
  const envLine = env
    ? `<p class="metrics-env">${escapeHtml(env.name || 'Agent')} ${escapeHtml(env.version || 'version not recorded')}</p>`
    : '';
  return `<div class="metrics-groups">${groups.join('')}</div>${envLine}`;
}

function jumpButton(turn, label) {
  return `<button type="button" class="metrics-jump" data-jump-turn="${turn}">${label}</button>`;
}

const WHERE_TOP = 5;

function oneLine(text, max = 120) {
  const line = String(text || '').split('\n')[0].trim();
  return line.length > max ? `${line.slice(0, max - 1)}…` : line;
}

function rankBy(rows, key) {
  return rows
    .filter((r) => isNum(r[key]))
    .sort((a, b) => (b[key] - a[key]) || (a.index - b.index))
    .slice(0, WHERE_TOP);
}

function whereList(title, rows, key, format, titleOf, minRows = 2) {
  if (rows.length < minRows) return '';
  const max = rows[0][key];
  const items = rows.map((r) => {
    const width = max > 0 ? Math.max(1, Math.round((r[key] / max) * 100)) : 0;
    const tip = titleOf(r);
    return (
      `<li class="where-row" data-turn="${r.index}">` +
      `<span class="where-turn">Turn ${r.index}</span>` +
      `<span class="where-text">${escapeHtml(r.text)}</span>` +
      `<span class="where-bar"><span style="width:${width}%"></span></span>` +
      `<span class="where-value"${tip ? ` title="${escapeHtml(tip)}"` : ''}>${format(r[key])}</span>` +
      jumpButton(r.index, 'Open') +
      `</li>`
    );
  });
  return `<section class="where-group"><h3>${title}</h3><ol class="where-list">${items.join('')}</ol></section>`;
}

/**
 * The turns that took the most output tokens (main thread plus the
 * subagents they spawned) and the most time, from `metrics.turns`. A list
 * needs two ranked turns to say anything, except the cache-break list,
 * which shows any turn that had one; '' when none has anything to show.
 */
export function renderWhereItWent(story) {
  const perTurn = story && story.metrics && Array.isArray(story.metrics.turns) ? story.metrics.turns : [];
  const turns = new Map(((story && story.turns) || []).map((t) => [t.index, t]));
  const rows = perTurn.map((pt) => {
    const turn = turns.get(pt.index) || {};
    const sub = pt.subagents && isNum(pt.subagents.output_tokens) ? pt.subagents : null;
    const output = isNum(pt.output_tokens) || sub ? (pt.output_tokens || 0) + (sub ? sub.output_tokens : 0) : null;
    return { ...pt, output, text: oneLine(turn.summary || turn.prompt) };
  });
  const tokens = whereList('By output tokens', rankBy(rows, 'output'), 'output', formatTokens, (r) => {
    const sub = r.subagents && isNum(r.subagents.output_tokens) ? r.subagents : null;
    if (!sub) return '';
    const n = sub.with_usage;
    return `${formatTokens(r.output_tokens || 0)} main + ${formatTokens(sub.output_tokens)} in ${n} ${plural(n, 'agent')}`;
  });
  const time = whereList('By duration', rankBy(rows, 'duration_ms'), 'duration_ms', formatLatency,
    (r) => DURATION_SOURCE_LABEL[r.duration_source] || '');
  // A single cache break is worth pointing at, so this list needs only one turn.
  const breaks = whereList('By cache breaks', rankBy(rows.filter((r) => r.cache_breaks > 0), 'cache_breaks'), 'cache_breaks',
    String, () => CACHE_BREAK_TITLE, 1);
  if (!tokens && !time && !breaks) return '';
  return `<div class="where-went"><h3 class="where-title">Where it went</h3><div class="where-lists">${tokens}${time}${breaks}</div></div>`;
}

export const METRICS_CSS = `
.metrics-scorecard { display: grid; grid-template-columns: repeat(auto-fill, minmax(170px, 1fr)); gap: 10px; }
.metrics-scorecard + .where-went { margin-top: 16px; }
.metrics-groups { display: grid; grid-template-columns: repeat(auto-fit, minmax(240px, 1fr)); gap: 12px; align-items: start; }
.metrics-group, .where-group { background: var(--surface-2); border: 1px solid var(--border); border-radius: var(--radius-sm); padding: 12px 14px; }
.metrics-group h3, .where-group h3, .where-title { margin: 0 0 8px; font-size: 11px; text-transform: uppercase; letter-spacing: .05em; color: var(--text-2); }
.metrics-group dl { display: grid; grid-template-columns: max-content minmax(0, 1fr); gap: 4px 12px; margin: 0; font-size: 12px; }
.metrics-group dt { color: var(--text-3); }
.metrics-group dd { margin: 0; min-width: 0; overflow-wrap: anywhere; text-align: right; font-family: var(--mono); }
.metrics-list { margin: 0; padding: 0; list-style: none; }
.metrics-na, .metrics-note { color: var(--text-3); font-style: italic; }
.metrics-env { margin: 10px 0 0; font-size: 11px; color: var(--text-3); }
.where-lists { display: grid; grid-template-columns: repeat(auto-fit, minmax(280px, 1fr)); gap: 12px; }
.where-list { list-style: none; margin: 0; padding: 0; }
.where-row { display: flex; align-items: center; gap: 8px; padding: 4px 0; font-size: 12px; min-width: 0; }
.where-turn { font-family: var(--mono); font-size: 11px; color: var(--accent-ink); white-space: nowrap; }
.where-text { flex: 1; min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.where-bar { flex: none; width: 64px; height: 4px; background: var(--surface-3); border-radius: 2px; overflow: hidden; }
.where-bar span { display: block; height: 100%; background: var(--accent); }
.where-value { min-width: 48px; text-align: right; font-family: var(--mono); font-size: 11px; color: var(--text-3); font-variant-numeric: tabular-nums; white-space: nowrap; }
.metrics-jump { padding: 2px 8px; border: 1px solid var(--border); border-radius: 6px; background: var(--surface); color: var(--accent-ink); font: inherit; font-size: 11px; cursor: pointer; white-space: nowrap; }
.metrics-jump:hover { border-color: var(--accent-ring); }
html:not(.js) .metrics-jump { display: none; }
@media print { .metrics-jump { display: none !important; } }
`;
