/**
 * Deterministic session metrics, derived from the Story IR (turns, totals)
 * and its trace events. Every leaf is a number or null; null means the
 * transcript did not carry the information, and is never written as 0.
 *
 * Definitions (also in schemas/story.schema.json):
 * - retry: a Bash run whose normalized command text equals the most recent
 *   earlier run of that text, and that earlier run ended in `error`.
 * - validation: Bash runs classified test|lint|build; final_state comes from
 *   the last one (ok -> passed, error -> failed, none -> none, else unknown).
 * - reads: Read|Glob|Grep events; files_read = distinct ok Read targets.
 * - turns[]: per turn, its duration and main-thread tokens, the tokens of the
 *   subagents it spawned, and its share of the session's output tokens,
 *   input tokens (incl. cache) and duration. A share is null when either
 *   side is unknown; shares need not sum to 1.
 * - active_ms: session time without idle gaps over five minutes between
 *   records (src/ir/trace.mjs activeMs); null for stories extracted before
 *   it was recorded.
 * - cache_breaks: API calls that sent over 100k input tokens past the prompt
 *   cache (src/ir/trace.mjs CACHE_BREAK_TOKENS), counted from the transcript
 *   even when the token totals come from cost-state records.
 */

import { msBetween } from './trace.mjs';
import { VALIDATION_CATEGORIES } from './selectors.mjs';

export const FINAL_STATES = ['passed', 'failed', 'none', 'unknown'];
export const METRIC_GROUPS = ['execution', 'code', 'validation', 'reads', 'usage'];
const READ_TOOLS = new Set(['Read', 'Glob', 'Grep']);

/** A command's first line, capped like an event summary, for display. */
function firstLine(command) {
  const line = String(command || '').split('\n')[0].trim();
  return line.length > 200 ? line.slice(0, 200) : line;
}

export function normalizeCommand(command) {
  return String(command || '').replace(/\s+/g, ' ').replace(/;\s*$/, '').trim();
}

/** Bash runs in trace order (falling back to turn order), each with its event status. */
function bashRuns(story) {
  const events = (story.trace && Array.isArray(story.trace.events)) ? story.trace.events : [];
  const order = new Map(events.map((e, i) => [e.id, i]));
  const statusOf = new Map(events.map((e) => [e.id, e.status]));
  const runs = [];
  for (const turn of story.turns || []) {
    for (const b of turn.bash || []) {
      runs.push({
        command: b.command,
        category: b.category,
        status: statusOf.get(b.id) || legacyStatus(b),
        order: order.has(b.id) ? order.get(b.id) : Number.MAX_SAFE_INTEGER,
        index: runs.length,
      });
    }
  }
  runs.sort((a, b) => (a.order - b.order) || (a.index - b.index));
  return runs.map(({ command, category, status }) => ({ command, category, status }));
}

function legacyStatus(b) {
  if (b.rejected) return 'rejected';
  if (b.interrupted) return 'interrupted';
  if (b.ok === null || b.ok === undefined) return 'unknown';
  return b.ok ? 'ok' : 'error';
}

export function countRetries(runs) {
  const lastStatus = new Map();
  let retries = 0;
  for (const r of runs) {
    const key = normalizeCommand(r.command);
    if (!key) continue;
    if (lastStatus.get(key) === 'error') retries++;
    lastStatus.set(key, r.status);
  }
  return retries;
}

export function validationState(runs) {
  const v = runs.filter((r) => VALIDATION_CATEGORIES.has(r.category));
  const last = v.length > 0 ? v[v.length - 1] : null;
  let final_state = 'none';
  if (last) final_state = last.status === 'ok' ? 'passed' : last.status === 'error' ? 'failed' : 'unknown';
  return {
    commands: v.length,
    passed: v.filter((r) => r.status === 'ok').length,
    failed: v.filter((r) => r.status === 'error').length,
    final_state,
    last_command: last ? firstLine(last.command) : null,
  };
}

function codeMetrics(story) {
  const totals = story.totals || {};
  const counts = new Map();
  const outside = new Set();
  const inside = [];
  for (const turn of story.turns || []) {
    for (const edit of turn.edits || []) {
      if (edit.combined_into) continue;
      counts.set(edit.rel, (counts.get(edit.rel) || 0) + 1);
      if (edit.outside_cwd) outside.add(edit.rel);
      else inside.push(edit);
    }
  }
  const files_edited_repeatedly = [...counts]
    .filter(([, n]) => n > 1)
    .map(([rel, edits]) => (outside.has(rel) ? { rel, edits, outside_cwd: true } : { rel, edits }))
    .sort((a, b) => (b.edits - a.edits) || a.rel.localeCompare(b.rel));
  const num = (v) => (Number.isFinite(v) ? v : null);
  return {
    files_changed: num(totals.files),
    lines_added: num(totals.added),
    lines_removed: num(totals.removed),
    edits: num(totals.edits),
    // The same counts without files outside the project, for the
    // "Project files only" view (the header does the same split).
    in_project: {
      files_changed: new Set(inside.map((e) => e.rel)).size,
      lines_added: inside.reduce((n, e) => n + ((e.stats && e.stats.added) || 0), 0),
      lines_removed: inside.reduce((n, e) => n + ((e.stats && e.stats.removed) || 0), 0),
      edits: inside.length,
    },
    files_edited_repeatedly,
  };
}

function readMetrics(toolEvents) {
  const reads = toolEvents.filter((e) => READ_TOOLS.has(e.tool));
  const files = new Set(reads.filter((e) => e.tool === 'Read' && e.status === 'ok').map((e) => e.summary));
  return { files_read: files.size, tool_calls: reads.length };
}

const NO_USAGE = Object.freeze({
  input_tokens: null, output_tokens: null, cache_read_tokens: null, cache_creation_tokens: null,
  total_cost_usd: null, models: [], source: 'none', complete: false,
});

// Cost-state records are running totals, so a process that writes several
// (same session and start time) counts only through its last one. Records
// without those fields, from older story JSON, each count on their own.
function latestCostStates(states) {
  const latest = new Map();
  states.forEach((s, i) => {
    const key = s.session_id && s.start_time !== null && s.start_time !== undefined
      ? `${s.session_id}@${s.start_time}` : `#${i}`;
    latest.set(key, s);
  });
  return [...latest.values()];
}

// One entry per session in the chain, in chain order, with the cost and
// models of its cost-states (a resumed session can have several processes).
// A session with no cost-state yet gets a null cost. Empty when a state
// carries no session id, as in older story JSON, since it cannot be placed.
function costBySession(states, chain) {
  if (states.some((s) => !s.session_id)) return [];
  const ids = [...chain];
  for (const s of states) if (!ids.includes(s.session_id)) ids.push(s.session_id);
  return ids.map((id) => {
    const own = states.filter((s) => s.session_id === id);
    const models = new Set(own.flatMap((s) => Object.keys(s.model_usage || {})));
    return {
      session_id: id,
      cost_usd: own.length ? own.reduce((n, s) => n + (s.total_cost_usd || 0), 0) : null,
      models: [...models].sort(),
    };
  });
}

function usageFromCostStates(allStates, chain) {
  const states = latestCostStates(allStates);
  const links = chain.length || 1;
  const sessions = costBySession(states, chain);
  const totals = { input_tokens: 0, output_tokens: 0, cache_read_tokens: 0, cache_creation_tokens: 0 };
  const models = new Set();
  let cost = 0;
  for (const s of states) {
    cost += s.total_cost_usd || 0;
    for (const [model, u] of Object.entries(s.model_usage || {})) {
      models.add(model);
      totals.input_tokens += u.inputTokens || 0;
      totals.output_tokens += u.outputTokens || 0;
      totals.cache_read_tokens += u.cacheReadInputTokens || 0;
      totals.cache_creation_tokens += u.cacheCreationInputTokens || 0;
    }
  }
  return {
    ...totals,
    total_cost_usd: cost,
    models: [...models].sort(),
    source: 'cost-state',
    complete: (sessions.length ? sessions.every((s) => s.cost_usd !== null) : states.length === links)
      && states.every((s) => !s.has_unknown_model_cost),
    sessions,
  };
}

function usageMetrics(story) {
  const trace = story.trace || {};
  const costStates = Array.isArray(trace.cost_states) ? trace.cost_states : [];
  const chain = (story.session && Array.isArray(story.session.chain)) ? story.session.chain : [];
  if (costStates.length > 0) return usageFromCostStates(costStates, chain);

  const turnUsage = (story.turns || []).map((t) => t.usage).filter(Boolean);
  const subagents = (Array.isArray(trace.events) ? trace.events : []).filter((e) => e.kind === 'subagent');
  const subUsage = subagents.map((e) => e.usage).filter(Boolean);
  const all = [...turnUsage, ...subUsage];
  if (all.length === 0) return { ...NO_USAGE };
  const sum = (key) => all.reduce((n, u) => n + (u[key] || 0), 0);
  return {
    input_tokens: sum('input_tokens'),
    output_tokens: sum('output_tokens'),
    cache_read_tokens: sum('cache_read_tokens'),
    cache_creation_tokens: sum('cache_creation_tokens'),
    total_cost_usd: null,
    models: [...new Set(all.flatMap((u) => u.models || []))].sort(),
    source: 'transcript',
    complete: all.every((u) => u.complete) && subUsage.length === subagents.length,
  };
}

const TOKEN_KEYS = ['input_tokens', 'output_tokens', 'cache_read_tokens', 'cache_creation_tokens'];
const isNum = (v) => typeof v === 'number' && Number.isFinite(v);

/** num / den rounded to 3 decimals, or null when either is unknown or den is 0. */
export function shareOf(num, den) {
  if (!isNum(num) || !isNum(den) || den <= 0) return null;
  return Math.round((num / den) * 1000) / 1000;
}

/** Input including cache reads and writes, or null if any part is unknown. */
function inputTotal(u) {
  if (!u) return null;
  const parts = [u.input_tokens, u.cache_read_tokens, u.cache_creation_tokens];
  return parts.every(isNum) ? parts.reduce((a, b) => a + b, 0) : null;
}

/** a + b where either may be null; null only when both are. */
function plus(a, b) {
  if (!isNum(a) && !isNum(b)) return null;
  return (isNum(a) ? a : 0) + (isNum(b) ? b : 0);
}

function subagentTotals(agents) {
  if (agents.length === 0) return null;
  const withUsage = agents.map((e) => e.usage).filter(Boolean);
  const out = { count: agents.length, with_usage: withUsage.length };
  for (const key of [...TOKEN_KEYS, 'cache_breaks']) {
    out[key] = withUsage.length ? sumKnown(withUsage.map((u) => u[key])) : null;
  }
  return out;
}

/** The sum of the numbers among `values`, or null when none is a number. */
function sumKnown(values) {
  const nums = values.filter(isNum);
  return nums.length ? nums.reduce((a, b) => a + b, 0) : null;
}

/** Cache breaks across every turn and subagent, from the transcript; null when none recorded the count. */
function cacheBreaks(story) {
  const events = (story.trace && Array.isArray(story.trace.events)) ? story.trace.events : [];
  return sumKnown([
    ...(story.turns || []).map((t) => t.usage && t.usage.cache_breaks),
    ...events.filter((e) => e.kind === 'subagent').map((e) => e.usage && e.usage.cache_breaks),
  ]);
}

function turnMetrics(story, usage, sessionMs) {
  const events = (story.trace && Array.isArray(story.trace.events)) ? story.trace.events : [];
  const agentsByTurn = new Map();
  for (const e of events) {
    if (e.kind !== 'subagent') continue;
    if (!agentsByTurn.has(e.turn)) agentsByTurn.set(e.turn, []);
    agentsByTurn.get(e.turn).push(e);
  }
  const sessionInput = inputTotal(usage);
  return (story.turns || []).map((turn) => {
    const u = turn.usage || null;
    const sub = subagentTotals(agentsByTurn.get(turn.index) || []);
    const entry = {
      index: turn.index,
      duration_ms: isNum(turn.duration_ms) ? turn.duration_ms : null,
      duration_source: turn.duration_source || 'unknown',
    };
    for (const key of TOKEN_KEYS) entry[key] = u && isNum(u[key]) ? u[key] : null;
    entry.api_calls = u && isNum(u.api_calls) ? u.api_calls : null;
    entry.cache_breaks = sumKnown([u && u.cache_breaks, sub && sub.cache_breaks]);
    entry.complete = u ? !!u.complete : null;
    entry.subagents = sub;
    entry.share = {
      output: shareOf(plus(entry.output_tokens, sub && sub.output_tokens), usage.output_tokens),
      input: shareOf(plus(inputTotal(u), sub && inputTotal(sub)), sessionInput),
      duration: shareOf(entry.duration_ms, sessionMs),
    };
    return entry;
  });
}

/**
 * @param {object} story - a Story IR, with or without `trace`
 * @returns {{execution: object, code: object, validation: object, reads: object, usage: object}}
 */
export function computeMetrics(story) {
  const hasTrace = !!(story.trace && Array.isArray(story.trace.events));
  const toolEvents = hasTrace ? story.trace.events.filter((e) => e.kind !== 'prompt') : [];
  const runs = bashRuns(story);
  const session = story.session || {};
  const durationMs = msBetween(session.started_at, session.ended_at);
  const usage = usageMetrics(story);
  usage.cache_read_share = shareOf(usage.cache_read_tokens, inputTotal(usage));
  usage.cache_breaks = cacheBreaks(story);
  return {
    execution: {
      duration_ms: durationMs,
      active_ms: isNum(session.active_ms) ? Math.min(session.active_ms, isNum(durationMs) ? durationMs : Infinity) : null,
      turns: (story.turns || []).length,
      tool_calls: hasTrace ? toolEvents.length : null,
      failed_tool_calls: hasTrace ? toolEvents.filter((e) => e.status === 'error').length : null,
      rejected_tool_calls: hasTrace ? toolEvents.filter((e) => e.status === 'rejected').length : null,
      commands: runs.length,
      failed_commands: runs.filter((r) => r.status === 'error').length,
      retries: countRetries(runs),
    },
    code: codeMetrics(story),
    validation: validationState(runs),
    reads: hasTrace ? readMetrics(toolEvents) : { files_read: null, tool_calls: null },
    usage,
    turns: turnMetrics(story, usage, durationMs),
  };
}
