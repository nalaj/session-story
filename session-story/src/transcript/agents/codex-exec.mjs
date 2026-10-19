import {
  isoAt, promptRecord, textRecord, toolUseRecord, toolResultRecord, usageRecord, shellResult, editResult,
} from './records.mjs';

/**
 * Codex `exec --json`. Work arrives as `item.started` / `item.completed`
 * pairs; events carry no timestamps, so each takes the time Paperclip
 * logged it. A `file_change` item names the files but carries no diff, so
 * those edits show without hunks.
 */
export function fromCodexExec(events, { prompt, startedAt, model }) {
  const records = [];
  let sessionId = null;
  let n = 0;
  let changedFiles = false;
  const started = new Set();

  for (const { event, ts } of events) {
    const at = isoAt(ts);
    if (event.type === 'thread.started') {
      sessionId = event.thread_id || sessionId;
      continue;
    }
    if (event.type === 'turn.completed' && event.usage) {
      const u = event.usage;
      const cached = u.cached_input_tokens || 0;
      records.push(usageRecord({
        id: `usage-${n++}`,
        at,
        model,
        usage: { input: Math.max(0, (u.input_tokens || 0) - cached), output: u.output_tokens, cacheRead: cached, cacheWrite: u.cache_write_input_tokens },
      }));
      continue;
    }
    if (event.type === 'turn.failed' || event.type === 'error') {
      const message = event.error?.message || event.message || 'error';
      records.push(textRecord({ id: `error-${n++}`, at, model, text: `Codex error: ${message}` }));
      continue;
    }
    const item = event.item;
    if (!item || (event.type !== 'item.started' && event.type !== 'item.completed')) continue;

    if (item.type === 'agent_message') {
      if (event.type === 'item.completed' && item.text?.trim()) records.push(textRecord({ id: item.id, at, model, text: item.text.trim() }));
      continue;
    }
    if (item.type === 'file_change') {
      if (event.type !== 'item.completed') continue;
      changedFiles = changedFiles || (item.changes || []).length > 0;
      for (const [i, change] of (item.changes || []).entries()) {
        const id = `${item.id}:${i}`;
        const name = change.kind === 'add' ? 'Write' : 'Edit';
        records.push(toolUseRecord({ id, at, model, name, input: { file_path: change.path } }));
        records.push(toolResultRecord({
          id,
          at,
          isError: item.status === 'failed',
          text: change.kind,
          result: item.status === 'failed' ? `patch failed: ${change.path}` : editResult({ created: false }),
        }));
      }
      continue;
    }
    const mapped = mapItem(item);
    if (!mapped) continue;
    if (!started.has(item.id)) {
      started.add(item.id);
      records.push(toolUseRecord({ id: item.id, at, model, ...mapped }));
    }
    if (event.type === 'item.completed') records.push(toolResultRecord({ id: item.id, at, ...resultOf(item) }));
  }

  const at = (records.find((r) => r.timestamp) || {}).timestamp || isoAt(startedAt);
  records.unshift(promptRecord({ id: 'prompt', at, text: prompt }));
  const spots = changedFiles
    ? ['Codex names the files it changed but prints no diff, so its edits show without line changes.']
    : [];
  return { records, agent: { name: 'Codex', version: null }, sessionId, cwd: null, spots, promptRecorded: false };
}

function mapItem(item) {
  switch (item.type) {
    case 'command_execution':
      return { name: 'Bash', input: { command: item.command || '' } };
    case 'mcp_tool_call':
      return { name: `mcp__${item.server}__${item.tool}`, input: item.arguments || {} };
    case 'web_search':
      return { name: 'WebSearch', input: { query: item.query } };
    default:
      return null; // reasoning, todo_list: not tool calls
  }
}

function resultOf(item) {
  if (item.type === 'command_execution') {
    const { isError, result } = shellResult({ exitCode: item.exit_code, stdout: item.aggregated_output || '' });
    return { isError: isError || item.status === 'failed', text: result.stdout, result };
  }
  if (item.error) return { isError: true, text: item.error.message || JSON.stringify(item.error) };
  const text = (item.result?.content || []).filter((c) => c.type === 'text').map((c) => c.text).join('\n');
  return { isError: item.status === 'failed', text };
}
