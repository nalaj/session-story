/**
 * Builders for the Claude Code record shapes `buildStory` consumes
 * (src/transcript/claude-code.mjs). Every non-Claude agent adapter
 * translates its own event stream into these records, so turns, edits,
 * commands, errors, trace events, usage and metrics all come out of the
 * one extractor instead of a parallel copy per agent.
 *
 * Tool names are mapped onto Claude Code's (Bash, Edit, Write, Read, Glob,
 * Grep, WebFetch, WebSearch, Skill, Agent) because the extractor and the
 * page key their behaviour off those names: a `Bash` call is a command, an
 * `Edit`/`Write` call is a file change. Anything else keeps its own name.
 */

import { parseUnifiedDiff } from './unified-diff.mjs';

/** ISO timestamp from epoch ms, an ISO string, or null. */
export function isoAt(value) {
  if (typeof value === 'string' && value) return Number.isFinite(Date.parse(value)) ? value : null;
  const ms = typeof value === 'string' ? Number(value) : value;
  return Number.isFinite(ms) && ms > 0 ? new Date(ms).toISOString() : null;
}

export function promptRecord({ id, at, text }) {
  return { type: 'user', uuid: id, timestamp: at, message: { role: 'user', content: text } };
}

export function textRecord({ id, at, messageId, model, text }) {
  return {
    type: 'assistant',
    uuid: id,
    timestamp: at,
    message: { id: messageId || id, model: model || undefined, role: 'assistant', content: [{ type: 'text', text }] },
  };
}

/**
 * One API call's token usage, in Claude's field names. `messageId` keys it
 * so the extractor counts each call once.
 */
export function usageRecord({ id, at, messageId, model, usage }) {
  return {
    type: 'assistant',
    uuid: id,
    timestamp: at,
    message: {
      id: messageId || id,
      model: model || undefined,
      role: 'assistant',
      content: [],
      usage: {
        input_tokens: usage.input || 0,
        output_tokens: usage.output || 0,
        cache_read_input_tokens: usage.cacheRead || 0,
        cache_creation_input_tokens: usage.cacheWrite || 0,
      },
    },
  };
}

export function toolUseRecord({ id, at, messageId, model, name, input }) {
  return {
    type: 'assistant',
    uuid: `${id}:use`,
    timestamp: at,
    message: {
      id: messageId || `${id}:use`,
      model: model || undefined,
      role: 'assistant',
      content: [{ type: 'tool_use', id, name, input: input || {} }],
    },
  };
}

/**
 * A tool's result. `result` becomes `toolUseResult`, which the extractor
 * reads for edit hunks ({type, structuredPatch, ...}) and command output
 * ({stdout, stderr, interrupted}).
 */
export function toolResultRecord({ id, at, isError, text, result }) {
  return {
    type: 'user',
    uuid: `${id}:result`,
    timestamp: at,
    message: { role: 'user', content: [{ type: 'tool_result', tool_use_id: id, is_error: !!isError, content: text || '' }] },
    toolUseResult: result === undefined ? (text || '') : result,
  };
}

/** A shell command's result, with a non-zero exit written the way Claude Code writes it. */
export function shellResult({ exitCode, stdout = '', stderr = '', interrupted = false }) {
  const failed = Number.isFinite(exitCode) && exitCode !== 0;
  return {
    isError: failed,
    result: { stdout: failed ? `Exit code ${exitCode}\n${stdout}` : stdout, stderr, interrupted },
  };
}

/**
 * An edit's result from whatever the agent recorded: a unified diff, the
 * file before and after, or only the new content of a created file. With
 * none of these the edit still shows, with no hunks.
 */
export function editResult({ diff = null, before = null, after = null, created = false }) {
  const hunks = typeof diff === 'string' && diff ? parseUnifiedDiff(diff) : [];
  if (created) {
    return { type: 'create', content: typeof after === 'string' ? after : '', structuredPatch: [], originalFile: null };
  }
  const result = { type: 'update', structuredPatch: hunks };
  if (typeof before === 'string') result.originalFile = before;
  if (typeof after === 'string') result.content = after;
  return result;
}

/** Totals for a cost-state record; only written when the agent reported a cost. */
export function costStateRecord({ sessionId, model, costUsd, usage }) {
  return {
    type: 'cost-state',
    sessionId,
    totalCostUSD: costUsd,
    modelUsage: {
      [model || 'unknown']: {
        inputTokens: usage.input || 0,
        outputTokens: usage.output || 0,
        cacheReadInputTokens: usage.cacheRead || 0,
        cacheCreationInputTokens: usage.cacheWrite || 0,
        costUSD: costUsd,
      },
    },
  };
}

export function addUsage(total, usage) {
  total.input += usage.input || 0;
  total.output += usage.output || 0;
  total.cacheRead += usage.cacheRead || 0;
  total.cacheWrite += usage.cacheWrite || 0;
  return total;
}

export function newUsage() {
  return { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 };
}
