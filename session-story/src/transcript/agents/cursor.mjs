import {
  isoAt, promptRecord, textRecord, toolUseRecord, toolResultRecord, usageRecord, shellResult, editResult,
} from './records.mjs';

/**
 * Cursor Agent CLI `--output-format stream-json`. Tool calls arrive as a
 * `started`/`completed` pair whose `tool_call` holds one `<kind>ToolCall`
 * key; edits carry a unified diff and the file before and after.
 */
export function fromCursor(events, { prompt, startedAt }) {
  const records = [];
  let init = null;
  let sawPrompt = false;
  let n = 0;
  const started = new Map(); // call_id -> started ms

  for (const { event, ts } of events) {
    const at = isoAt(event.timestamp_ms) || isoAt(ts);
    if (event.type === 'system' && event.subtype === 'init') {
      init = event;
      continue;
    }
    if (event.type === 'user') {
      const text = textOf(event.message);
      if (!text) continue;
      sawPrompt = true;
      records.push(promptRecord({ id: `prompt-${n++}`, at, text }));
      continue;
    }
    if (event.type === 'assistant') {
      const text = textOf(event.message);
      if (text) records.push(textRecord({ id: `text-${n++}`, at, model: init?.model, text }));
      continue;
    }
    if (event.type === 'tool_call') {
      const id = event.call_id || event.tool_call?.toolCallId;
      const [kind, call] = toolEntry(event.tool_call);
      if (!id || !kind) continue;
      if (event.subtype === 'started') {
        started.set(id, true);
        records.push(toolUseRecord({ id, at: isoAt(event.tool_call.startedAtMs) || at, model: init?.model, ...mapTool(kind, call.args || {}, null) }));
        continue;
      }
      if (event.subtype !== 'completed') continue;
      const mapped = mapTool(kind, call.args || {}, call.result);
      if (!started.has(id)) {
        records.push(toolUseRecord({ id, at: isoAt(event.tool_call.startedAtMs) || at, model: init?.model, ...mapped }));
      }
      records.push(toolResultRecord({ id, at: isoAt(event.tool_call.completedAtMs) || at, ...resultOf(kind, mapped, call.result) }));
      continue;
    }
    if (event.type === 'result' && event.usage) {
      const u = event.usage;
      records.push(usageRecord({
        id: `usage-${n++}`,
        at,
        model: init?.model,
        usage: { input: u.inputTokens, output: u.outputTokens, cacheRead: u.cacheReadTokens, cacheWrite: u.cacheWriteTokens },
      }));
    }
  }
  if (!sawPrompt) {
    const at = (records.find((r) => r.timestamp) || {}).timestamp || isoAt(startedAt);
    records.unshift(promptRecord({ id: 'prompt', at, text: prompt }));
  }
  return {
    records,
    agent: { name: 'Cursor Agent', version: null },
    sessionId: init?.session_id || null,
    cwd: init?.cwd || null,
    promptRecorded: sawPrompt,
  };
}

function textOf(message) {
  const content = message && message.content;
  if (typeof content === 'string') return content.trim();
  if (!Array.isArray(content)) return '';
  return content.filter((b) => b.type === 'text' && typeof b.text === 'string').map((b) => b.text).join('\n').trim();
}

function toolEntry(toolCall) {
  if (!toolCall) return [null, null];
  const key = Object.keys(toolCall).find((k) => k.endsWith('ToolCall'));
  return key ? [key.slice(0, -'ToolCall'.length), toolCall[key]] : [null, null];
}

/** Cursor's tool kinds mapped onto the Claude Code names the extractor understands. */
function mapTool(kind, args, result) {
  switch (kind) {
    case 'shell':
      return { name: 'Bash', input: { command: args.command || '', description: args.description || '' } };
    case 'edit': {
      const success = result?.success;
      const created = success ? success.beforeFullFileContent === undefined && /^--- \/dev\/null/m.test(success.diffString || '') : false;
      return { name: created ? 'Write' : 'Edit', input: { file_path: args.path } };
    }
    case 'delete':
      return { name: 'Bash', input: { command: `rm ${args.path || ''}`.trim(), description: 'delete file' } };
    case 'read':
      return { name: 'Read', input: { file_path: args.path } };
    case 'glob':
      return { name: 'Glob', input: { pattern: args.globPattern, path: args.targetDirectory } };
    case 'grep':
      return { name: 'Grep', input: { pattern: args.pattern, path: args.path } };
    case 'webFetch':
      return { name: 'WebFetch', input: { url: args.url } };
    case 'webSearch':
      return { name: 'WebSearch', input: { query: args.query || args.searchTerm } };
    case 'mcp':
      return { name: `mcp__${args.providerIdentifier || args.serverIdentifier || 'mcp'}__${args.toolName || args.name}`, input: args.args || {} };
    default:
      return { name: kind, input: args };
  }
}

function resultOf(kind, mapped, result) {
  const error = result?.error;
  if (error) return { isError: true, text: error.errorMessage || error.message || JSON.stringify(error) };
  const success = result?.success || {};
  if (mapped.name === 'Bash' && kind === 'shell') {
    const { isError, result: r } = shellResult({ exitCode: success.exitCode, stdout: success.stdout || '', stderr: success.stderr || '' });
    return { isError, text: r.stdout + r.stderr, result: r };
  }
  if (mapped.name === 'Edit' || mapped.name === 'Write') {
    return {
      isError: false,
      text: success.message || '',
      result: editResult({
        diff: success.diffString,
        before: success.beforeFullFileContent ?? null,
        after: success.afterFullFileContent ?? null,
        created: mapped.name === 'Write',
      }),
    };
  }
  return { isError: false, text: typeof success === 'string' ? success : '' };
}
