import {
  isoAt, promptRecord, textRecord, toolUseRecord, toolResultRecord, usageRecord, shellResult, editResult,
} from './records.mjs';

/**
 * Codex's own session file (`$CODEX_HOME/sessions/YYYY/MM/DD/rollout-*.jsonl`),
 * as interactive Codex and OpenRig Codex seats write it. Each line is
 * `{timestamp, type, payload}`. The `event_msg/item_completed` items are
 * the readable record of the session (user messages, replies, commands,
 * file changes with their diffs, MCP calls); `token_usage_record` lines
 * carry each model call's tokens.
 */
export function fromCodexRollout(events, { prompt, startedAt }) {
  const records = [];
  let meta = null;
  let model = null;
  let sawPrompt = false;
  let n = 0;

  for (const { event } of events) {
    const p = event.payload || {};
    const at = isoAt(event.timestamp);
    if (event.type === 'session_meta') {
      meta = p;
      continue;
    }
    if (event.type === 'turn_context' && typeof p.model === 'string') {
      model = p.model;
      continue;
    }
    if (event.type === 'token_usage_record' && p.usage) {
      const u = p.usage;
      const cached = u.cached_input_tokens || 0;
      records.push(usageRecord({
        id: `usage-${n++}`,
        at,
        messageId: p.response_id,
        model,
        usage: {
          input: Math.max(0, (u.input_tokens || 0) - cached),
          output: u.output_tokens,
          cacheRead: cached,
          cacheWrite: u.cache_write_input_tokens,
        },
      }));
      continue;
    }
    if (event.type !== 'event_msg' || p.type !== 'item_completed' || !p.item) continue;

    const item = p.item;
    const startAt = isoAt(p.started_at_ms) || at;
    const endAt = isoAt(p.completed_at_ms) || at;
    switch (item.type) {
      case 'UserMessage': {
        const text = contentText(item.content);
        if (!text) break;
        sawPrompt = true;
        records.push(promptRecord({ id: item.id || `prompt-${n++}`, at: startAt, text }));
        break;
      }
      case 'AgentMessage': {
        const text = contentText(item.content);
        if (text) records.push(textRecord({ id: item.id || `text-${n++}`, at: endAt, model, text }));
        break;
      }
      case 'CommandExecution': {
        const command = Array.isArray(item.command) ? shellCommand(item.command) : String(item.command || '');
        records.push(toolUseRecord({ id: item.id, at: startAt, model, name: 'Bash', input: { command } }));
        const { isError, result } = shellResult({ exitCode: item.exit_code, stdout: item.aggregated_output || '' });
        records.push(toolResultRecord({ id: item.id, at: endAt, isError: isError || item.status === 'failed', text: result.stdout, result }));
        break;
      }
      case 'FileChange': {
        const failed = item.status === 'failed';
        for (const [i, [filePath, change]] of Object.entries(item.changes || {}).entries()) {
          const id = `${item.id}:${i}`;
          const created = change.type === 'add';
          records.push(toolUseRecord({ id, at: startAt, model, name: created ? 'Write' : 'Edit', input: { file_path: filePath } }));
          records.push(toolResultRecord({
            id,
            at: endAt,
            isError: failed,
            text: failed ? (item.stderr || 'patch failed') : (item.stdout || ''),
            result: failed
              ? (item.stderr || 'patch failed')
              : editResult(created
                ? { created: true, after: change.content ?? addedText(change.unified_diff) }
                : { diff: change.unified_diff }),
          }));
        }
        break;
      }
      case 'McpToolCall': {
        records.push(toolUseRecord({ id: item.id, at: startAt, model, name: `mcp__${item.server}__${item.tool}`, input: item.arguments || {} }));
        const text = (item.result?.content || []).filter((c) => c.type === 'text').map((c) => c.text).join('\n');
        records.push(toolResultRecord({ id: item.id, at: endAt, isError: item.status === 'failed' || !!item.error, text: item.error?.message || text }));
        break;
      }
      case 'WebSearch': {
        records.push(toolUseRecord({ id: item.id, at: startAt, model, name: 'WebSearch', input: { query: item.query } }));
        records.push(toolResultRecord({ id: item.id, at: endAt, isError: false, text: '' }));
        break;
      }
      default:
        break; // Reasoning and the like: not shown
    }
  }

  if (!sawPrompt) {
    const at = (records.find((r) => r.timestamp) || {}).timestamp || isoAt(startedAt);
    records.unshift(promptRecord({ id: 'prompt', at, text: prompt }));
  }
  return {
    records,
    agent: { name: 'Codex', version: meta?.cli_version || null },
    sessionId: meta?.id || meta?.session_id || null,
    cwd: meta?.cwd || null,
    promptRecorded: sawPrompt,
  };
}

function contentText(content) {
  if (typeof content === 'string') return content.trim();
  if (!Array.isArray(content)) return '';
  return content.map((c) => (typeof c.text === 'string' ? c.text : '')).join('\n').trim();
}

/** `["/bin/zsh", "-lc", "<script>"]` reads better as just the script. */
function shellCommand(argv) {
  const flag = argv.findIndex((a) => /^-l?c$/.test(a));
  return flag >= 0 && argv[flag + 1] !== undefined ? argv[flag + 1] : argv.join(' ');
}

function addedText(diff) {
  if (typeof diff !== 'string') return '';
  return diff.split('\n').filter((l) => l.startsWith('+') && !l.startsWith('+++')).map((l) => l.slice(1)).join('\n');
}
