import { readFile } from 'node:fs/promises';
import path from 'node:path';

/**
 * Read an agent event log: either a Paperclip heartbeat run log
 * (`data/run-logs/<company>/<agent>/<run>.ndjson`) or a file of the
 * agent's own JSON events, one per line (a Codex rollout, or the saved
 * output of `opencode run --format json`, `cursor-agent -p
 * --output-format stream-json`, `codex exec --json`, `claude -p
 * --output-format stream-json`).
 *
 * @param {string} filePath
 * @returns {Promise<{id: string, paperclip: {run_id: string, agent_id: string}|null, events: {event: object, ts: string|null}[], startedAt: string|null}>}
 */
export async function readEventLog(filePath) {
  const lines = [];
  for (const line of (await readFile(filePath, 'utf8')).split('\n')) {
    if (!line.trim()) continue;
    try {
      lines.push(JSON.parse(line));
    } catch {
      // a truncated final line: the agent was still writing
    }
  }
  const id = path.basename(filePath).replace(/\.(nd)?jsonl?$/, '');
  if (lines.length > 0 && lines.every((l) => l && typeof l.chunk === 'string' && 'stream' in l)) {
    return {
      id,
      paperclip: { run_id: id, agent_id: path.basename(path.dirname(filePath)) },
      ...unwrapRunLog(lines),
    };
  }
  const events = lines
    .filter((l) => l && typeof l === 'object')
    .map((event) => ({ event, ts: event.timestamp ?? event.timestamp_ms ?? null }));
  return { id, paperclip: null, events, startedAt: events.length ? events[0].ts : null };
}

/**
 * A Paperclip run log line is `{ts, stream, chunk, seq}` holding raw
 * process output, cut wherever the pipe flushed, so one JSON event can
 * span several chunks. Stdout is re-joined before it is split into lines;
 * each line keeps the timestamp of the chunk it started in, because some
 * agents (Codex) print events with no time of their own.
 */
function unwrapRunLog(chunks) {
  chunks.sort((a, b) => (a.seq ?? 0) - (b.seq ?? 0));
  const events = [];
  const flush = (text, ts) => {
    const trimmed = text.trim();
    if (!trimmed.startsWith('{')) return; // "[paperclip] ..." banners and plain output
    try {
      events.push({ event: JSON.parse(trimmed), ts });
    } catch {
      // not an event after all
    }
  };
  let pending = '';
  let pendingTs = null;
  for (const rec of chunks) {
    if (rec.stream !== 'stdout') continue;
    const parts = (pending + rec.chunk).split('\n');
    const firstTs = pending ? pendingTs : rec.ts;
    pending = parts.pop();
    parts.forEach((part, i) => flush(part, i === 0 ? firstTs : rec.ts));
    pendingTs = pending ? (parts.length > 0 ? rec.ts : firstTs) : null;
  }
  flush(pending, pendingTs);
  return { events, startedAt: chunks.length ? chunks[0].ts : null };
}
