import { fromClaudeStream } from './claude-stream.mjs';
import { fromCursor } from './cursor.mjs';
import { fromOpenCode } from './opencode.mjs';
import { fromCodexExec } from './codex-exec.mjs';
import { fromCodexRollout } from './codex-rollout.mjs';

const ADAPTERS = {
  'claude-code': fromClaudeStream,
  cursor: fromCursor,
  opencode: fromOpenCode,
  codex: fromCodexExec,
  'codex-rollout': fromCodexRollout,
};

export const AGENT_DIALECTS = Object.keys(ADAPTERS);

/**
 * Which agent CLI printed these events, from shapes only that agent emits.
 * @param {{event: object}[]} events
 * @returns {string|null}
 */
export function detectDialect(events) {
  for (const { event } of events) {
    if (event.type === 'session_meta' || event.type === 'response_item' || event.type === 'event_msg') return 'codex-rollout';
    // OpenCode stamps every event with a sessionID; a run that fails at once prints only an error.
    if (event.type === 'step_start' || event.type === 'step_finish' || (event.sessionID && event.part !== undefined) || (event.type === 'error' && event.sessionID)) return 'opencode';
    if (event.type === 'thread.started' || event.type === 'turn.started' || (typeof event.type === 'string' && event.type.startsWith('item.'))) return 'codex';
    if (event.type === 'tool_call' || event.type === 'thinking') return 'cursor';
    if (event.type === 'system' && event.subtype === 'init') return event.claude_code_version ? 'claude-code' : 'cursor';
  }
  return null;
}

/**
 * Translate an agent's printed event stream into Claude Code records.
 * @param {{event: object, ts: string|null}[]} events
 * @param {{dialect?: string, prompt: string, startedAt?: string|null, model?: string|null}} opts
 */
export function recordsFromEvents(events, opts) {
  const dialect = opts.dialect || detectDialect(events);
  const adapter = ADAPTERS[dialect];
  if (!adapter) {
    throw new Error(
      `Could not tell which agent wrote this log${dialect ? ` (unsupported: ${dialect})` : ''}. ` +
      `Pass --agent with one of: ${AGENT_DIALECTS.join(', ')}`
    );
  }
  return { dialect, ...adapter(events, opts) };
}
