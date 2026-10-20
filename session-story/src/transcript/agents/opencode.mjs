import {
  isoAt, promptRecord, textRecord, toolUseRecord, toolResultRecord, usageRecord, costStateRecord,
  shellResult, editResult, newUsage, addUsage,
} from './records.mjs';

/**
 * OpenCode `run --format json`. Events wrap message parts: `text`,
 * `tool_use` (a finished tool part with its input, output and timing) and
 * `step_finish` (one model call's tokens and cost). The prompt is not
 * printed, so it comes from the caller.
 */
export function fromOpenCode(events, { prompt, startedAt, model }) {
  const records = [];
  const total = newUsage();
  let cost = 0;
  let sawCost = false;
  let sessionId = null;
  let n = 0;

  for (const { event, ts } of events) {
    const part = event.part || {};
    sessionId = sessionId || event.sessionID || part.sessionID || null;
    const at = isoAt(event.timestamp) || isoAt(ts);
    if (event.type === 'text' && typeof part.text === 'string' && part.text.trim()) {
      records.push(textRecord({ id: part.id || `text-${n++}`, at: isoAt(part.time?.end) || at, messageId: part.messageID, model, text: part.text.trim() }));
      continue;
    }
    if (event.type === 'tool_use' && part.type === 'tool') {
      const state = part.state || {};
      const id = part.callID || part.id;
      const mapped = mapTool(part.tool, state.input || {}, state.metadata || {});
      records.push(toolUseRecord({ id, at: isoAt(state.time?.start) || at, messageId: part.messageID, model, ...mapped }));
      if (state.status === 'completed' || state.status === 'error') {
        records.push(toolResultRecord({ id, at: isoAt(state.time?.end) || at, ...resultOf(mapped, state) }));
      }
      continue;
    }
    if (event.type === 'step_finish' && part.tokens) {
      const t = part.tokens;
      const usage = { input: t.input, output: (t.output || 0) + (t.reasoning || 0), cacheRead: t.cache?.read, cacheWrite: t.cache?.write };
      addUsage(total, usage);
      if (typeof part.cost === 'number') {
        cost += part.cost;
        sawCost = true;
      }
      records.push(usageRecord({ id: part.id || `usage-${n++}`, at, messageId: part.messageID, model, usage }));
      continue;
    }
    if (event.type === 'error') {
      const message = event.error?.data?.message || event.error?.message || event.error?.name || 'error';
      records.push(textRecord({ id: `error-${n++}`, at, model, text: `OpenCode error: ${message}` }));
    }
  }

  const at = (records.find((r) => r.timestamp) || {}).timestamp || isoAt(startedAt);
  records.unshift(promptRecord({ id: 'prompt', at, text: prompt }));
  if (sawCost) records.push(costStateRecord({ sessionId, model, costUsd: cost, usage: total }));
  return { records, agent: { name: 'OpenCode', version: null }, sessionId, cwd: null, promptRecorded: false };
}

function mapTool(tool, input, metadata) {
  switch (tool) {
    case 'bash':
      return { name: 'Bash', input: { command: input.command || '', description: input.description || '' } };
    case 'edit':
    case 'multiedit':
      return { name: 'Edit', input: { file_path: input.filePath, old_string: input.oldString, new_string: input.newString } };
    case 'write':
      return { name: 'Write', input: { file_path: input.filePath, content: input.content }, created: metadata.exists === false };
    case 'patch':
    case 'apply_patch':
      return { name: 'Edit', input: { file_path: metadata.filediff?.file || input.filePath } };
    case 'read':
      return { name: 'Read', input: { file_path: input.filePath } };
    case 'glob':
      return { name: 'Glob', input: { pattern: input.pattern, path: input.path } };
    case 'grep':
      return { name: 'Grep', input: { pattern: input.pattern, path: input.path } };
    case 'webfetch':
      return { name: 'WebFetch', input: { url: input.url } };
    case 'websearch':
      return { name: 'WebSearch', input: { query: input.query } };
    case 'skill':
      return { name: 'Skill', input: { skill: input.name } };
    case 'task':
      return { name: 'Agent', input: { description: input.description, subagent_type: input.subagent_type } };
    default:
      return { name: tool, input };
  }
}

function resultOf(mapped, state) {
  const metadata = state.metadata || {};
  if (state.status === 'error') return { isError: true, text: state.error || 'error' };
  if (mapped.name === 'Bash') {
    const { isError, result } = shellResult({ exitCode: metadata.exit, stdout: state.output || metadata.output || '' });
    return { isError, text: result.stdout, result };
  }
  if (mapped.name === 'Edit' || mapped.name === 'Write') {
    const result = editResult({
      diff: metadata.diff || metadata.filediff?.patch || null,
      before: metadata.filediff?.before ?? null,
      after: metadata.filediff?.after ?? (mapped.name === 'Write' ? mapped.input.content : null),
      created: !!mapped.created,
    });
    if (mapped.name === 'Edit' && typeof mapped.input.old_string === 'string') {
      result.oldString = mapped.input.old_string;
      result.newString = mapped.input.new_string ?? '';
    }
    return { isError: false, text: state.output || '', result };
  }
  return { isError: false, text: state.output || '' };
}
