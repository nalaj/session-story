import { isoAt, promptRecord } from './records.mjs';

/**
 * Claude Code `--output-format stream-json`: the same records as its
 * transcript, except the tool result field is `tool_use_result`, subagent
 * records are interleaved (marked by `parent_tool_use_id`) instead of kept
 * in their own files, and the prompt is not echoed. The final `result`
 * event carries the run's cost.
 */
export function fromClaudeStream(events, { prompt, startedAt }) {
  const records = [];
  let init = null;
  let sawPrompt = false;
  for (const { event, ts } of events) {
    if (event.type === 'system' && event.subtype === 'init') {
      init = event;
      continue;
    }
    if (event.type === 'result') {
      if (typeof event.total_cost_usd === 'number') {
        records.push({
          type: 'cost-state',
          sessionId: event.session_id,
          totalCostUSD: event.total_cost_usd,
          totalAPIDuration: event.duration_api_ms,
          modelUsage: event.modelUsage || {},
        });
      }
      continue;
    }
    if (event.type !== 'user' && event.type !== 'assistant') continue;
    const record = { ...event, timestamp: event.timestamp || isoAt(ts) };
    if ('tool_use_result' in record) {
      record.toolUseResult = record.tool_use_result;
      delete record.tool_use_result;
    }
    if (event.parent_tool_use_id) record.isSidechain = true;
    if (record.type === 'user' && typeof record.message?.content === 'string' && !record.isSidechain) sawPrompt = true;
    records.push(record);
  }
  if (!sawPrompt) {
    const at = (records.find((r) => r.timestamp) || {}).timestamp || isoAt(startedAt);
    records.unshift(promptRecord({ id: 'prompt', at, text: prompt }));
  }
  return {
    records,
    agent: { name: 'Claude Code', version: init?.claude_code_version || null },
    sessionId: init?.session_id || null,
    cwd: init?.cwd || null,
    promptRecorded: sawPrompt,
  };
}
