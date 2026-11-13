/**
 * Trace events: the normalized, chronological record of what a session did
 * (prompts, tool calls, subagents) with timing, status and provenance.
 * Pure helpers only. The Claude Code adapter (src/transcript/claude-code.mjs)
 * builds events while it walks the records; src/ir/metrics.mjs counts them.
 *
 * A tool event's duration_ms is the tool_result record's timestamp minus the
 * tool_use record's: it includes permission prompts and hook time, so it is a
 * latency, not the tool's own runtime.
 */

import { relativeTo } from '../transcript/paths.mjs';
import { isRejection } from './commands.mjs';

export const EVENT_KINDS = ['prompt', 'tool', 'subagent'];
export const EVENT_STATUSES = ['ok', 'error', 'rejected', 'interrupted', 'unknown'];
export const DURATION_SOURCES = ['transcript', 'derived', 'unknown'];
const SUMMARY_MAX = 200;
const FILE_TOOLS = new Set(['Edit', 'Write', 'NotebookEdit', 'Read']);

/** Positive difference in ms between two ISO timestamps, or null if either is missing/unparseable. */
export function msBetween(startIso, endIso) {
  if (typeof startIso !== 'string' || typeof endIso !== 'string') return null;
  const start = Date.parse(startIso);
  const end = Date.parse(endIso);
  if (!Number.isFinite(start) || !Number.isFinite(end)) return null;
  return Math.max(0, end - start);
}

export function newEvent({
  id, kind, turn, parentId = null, tool = null, category = null, summary = '', startedAt = null, agentId = null,
}) {
  const event = {
    id,
    kind,
    turn,
    parent_id: parentId,
    tool,
    category,
    status: kind === 'prompt' ? 'ok' : 'unknown',
    summary,
    started_at: startedAt,
    ended_at: null,
    duration_ms: null,
    source: 'transcript',
  };
  if (agentId) event.agent_id = agentId;
  return event;
}

export function finishEvent(event, endedAt, status) {
  event.ended_at = typeof endedAt === 'string' ? endedAt : null;
  event.duration_ms = msBetween(event.started_at, event.ended_at);
  event.status = status;
  return event;
}

/** rejected > interrupted > error > ok, from a tool_result's is_error flag and toolUseResult. */
export function resultStatus(isError, toolUseResult) {
  if (isRejection(toolUseResult)) return 'rejected';
  if (toolUseResult && typeof toolUseResult === 'object' && toolUseResult.interrupted) return 'interrupted';
  return isError ? 'error' : 'ok';
}

function firstLine(text) {
  const line = String(text || '').split('\n')[0].trim();
  return line.length > SUMMARY_MAX ? line.slice(0, SUMMARY_MAX) : line;
}

function rel(filePath, cwd) {
  if (!filePath) return '';
  return relativeTo(filePath, cwd);
}

/** One short line naming what a tool call acted on; '' when the input says nothing useful. */
export function eventSummary(name, input, cwd) {
  const i = input || {};
  if (name === 'Bash') return firstLine(i.command);
  if (FILE_TOOLS.has(name)) return firstLine(rel(i.file_path || i.notebook_path, cwd));
  if (name === 'Glob' || name === 'Grep') return firstLine(i.path ? `${i.pattern} in ${rel(i.path, cwd)}` : i.pattern);
  if (name === 'Agent' || name === 'Task') return firstLine(i.description);
  if (name === 'WebFetch' || name === 'WebSearch') return firstLine(i.url || i.query);
  return firstLine(i.description || '');
}

/**
 * How long a turn took. The harness writes `system/turn_duration` records
 * (summed per turn by the adapter); without them, wall clock from the prompt
 * to the last finished event; without that, unknown — never 0.
 */
export function turnDuration({ harnessMs, promptAt, lastEndedAt }) {
  if (Number.isFinite(harnessMs) && harnessMs > 0) return { duration_ms: harnessMs, duration_source: 'transcript' };
  const ms = msBetween(promptAt, lastEndedAt);
  if (ms === null) return { duration_ms: null, duration_source: 'unknown' };
  return { duration_ms: ms, duration_source: 'derived' };
}

/** Stable sort by started_at; an event with no timestamp keeps its place after the last dated one. */
export function sortEvents(events) {
  let lastT = -Infinity;
  const keyed = events.map((event, i) => {
    const t = Date.parse(event.started_at);
    if (Number.isFinite(t)) lastT = t;
    return { event, i, t: lastT };
  });
  keyed.sort((a, b) => (a.t - b.t) || (a.i - b.i));
  return keyed.map((k) => k.event);
}

/** Accumulator for message.usage across the assistant records of one turn (or one subagent). */
export function newUsageAcc() {
  return { byMessage: new Map(), noUsage: new Set(), models: new Set() };
}

/**
 * Claude Code writes one assistant record per content block, and every
 * record of the same API call repeats its usage object, so the usage is
 * keyed by message.id and counted once. The earlier records of a streamed
 * call can carry a stale output count, so the largest one is kept. Ids in
 * `skip` (the main thread's, when a subagent transcript replays them) are
 * not counted again.
 */
export function noteUsage(acc, record, skip = null) {
  if (!record || record.type !== 'assistant' || !record.message) return;
  const { id, usage, model } = record.message;
  if (typeof model === 'string' && model) acc.models.add(model);
  const key = id || record.uuid;
  if (skip && id && skip.has(id)) return;
  if (!usage || typeof usage !== 'object') {
    acc.noUsage.add(key);
    return;
  }
  const prev = acc.byMessage.get(key);
  if (prev && (prev.output_tokens || 0) > (usage.output_tokens || 0)) return;
  acc.byMessage.set(key, usage);
}

/**
 * An API call that sent more than this many input tokens without reading
 * them from the prompt cache re-sent most of the context: after a
 * compaction, a model switch, or an idle gap long enough for the cache to
 * expire.
 */
export const CACHE_BREAK_TOKENS = 100000;

/** Totals for the accumulator, or null when it saw no assistant records at all. */
export function usageTotals(acc) {
  if (acc.byMessage.size === 0 && acc.noUsage.size === 0) return null;
  const totals = { input_tokens: 0, output_tokens: 0, cache_read_tokens: 0, cache_creation_tokens: 0 };
  let cacheBreaks = 0;
  for (const u of acc.byMessage.values()) {
    totals.input_tokens += u.input_tokens || 0;
    totals.output_tokens += u.output_tokens || 0;
    totals.cache_read_tokens += u.cache_read_input_tokens || 0;
    totals.cache_creation_tokens += u.cache_creation_input_tokens || 0;
    if ((u.input_tokens || 0) + (u.cache_creation_input_tokens || 0) > CACHE_BREAK_TOKENS) cacheBreaks++;
  }
  const complete = [...acc.noUsage].every((key) => acc.byMessage.has(key));
  return {
    ...totals,
    api_calls: acc.byMessage.size,
    cache_breaks: cacheBreaks,
    models: [...acc.models].sort(),
    complete,
  };
}

/** A gap between records longer than this is time away, not time working. */
export const IDLE_GAP_MS = 5 * 60 * 1000;

/**
 * Time the session was active: the gaps between consecutive record
 * timestamps (main thread and subagents together), leaving out any gap
 * longer than IDLE_GAP_MS. null when fewer than two records are dated.
 */
export function activeMs(timestamps) {
  const times = timestamps
    .map((t) => (typeof t === 'string' ? Date.parse(t) : NaN))
    .filter(Number.isFinite)
    .sort((a, b) => a - b);
  if (times.length < 2) return null;
  let total = 0;
  for (let i = 1; i < times.length; i++) {
    const gap = times[i] - times[i - 1];
    if (gap <= IDLE_GAP_MS) total += gap;
  }
  return total;
}

/**
 * The session-level totals Claude Code writes in a `cost-state` record. A
 * process can write several, each a running total since its `startTime`.
 */
export function pickCostState(record) {
  const num = (v) => (typeof v === 'number' && Number.isFinite(v) ? v : null);
  return {
    total_cost_usd: num(record.totalCostUSD),
    total_api_duration_ms: num(record.totalAPIDuration),
    total_tool_duration_ms: num(record.totalToolDuration),
    model_usage: record.modelUsage && typeof record.modelUsage === 'object' ? record.modelUsage : {},
    has_unknown_model_cost: !!record.hasUnknownModelCost,
    session_id: typeof record.sessionId === 'string' ? record.sessionId : null,
    start_time: num(record.startTime),
  };
}

const NOTIFICATION_RE = /<task-notification>([\s\S]*?)<\/task-notification>/g;

function tagText(block, name) {
  const match = new RegExp(`<${name}>([\\s\\S]*?)</${name}>`).exec(block);
  return match ? match[1].trim() : null;
}

/**
 * The harness tells the main session a background agent finished by
 * injecting a <task-notification> block (into a queue-operation record or a
 * user record). Its <tool-use-id> is the Agent tool_use that launched it.
 */
export function parseTaskNotifications(text) {
  if (typeof text !== 'string') return [];
  const out = [];
  for (const match of text.matchAll(NOTIFICATION_RE)) {
    const block = match[1];
    const toolUseId = tagText(block, 'tool-use-id');
    if (!toolUseId) continue;
    const duration = tagText(block, 'duration_ms');
    out.push({
      toolUseId,
      status: tagText(block, 'status') || 'completed',
      duration_ms: duration === null || !Number.isFinite(Number(duration)) ? null : Number(duration),
    });
  }
  return out;
}
