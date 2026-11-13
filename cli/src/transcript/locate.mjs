import { readdir, stat, open } from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';

/**
 * Convert an absolute cwd into the folder slug Claude Code uses under
 * ~/.claude/projects: every "/" and "." becomes "-" (verified against real
 * project folders, e.g. cwd ".../own.ai/ai-harlequins" -> "...-own-ai-ai-harlequins").
 * @param {string} cwd
 * @returns {string}
 */
export function slugify(cwd) {
  return cwd.replace(/[^A-Za-z0-9]/g, '-');
}

export function defaultClaudeDir() {
  return path.join(os.homedir(), '.claude', 'projects');
}

/**
 * Find a session transcript file.
 * @param {{claudeDir?: string, cwd: string, sessionId?: string, latest?: boolean}} opts
 * @returns {Promise<{transcriptPath: string, sessionId: string, projectSlug: string}>}
 */
export async function locateSession({ claudeDir = defaultClaudeDir(), cwd, sessionId, latest }) {
  const slug = slugify(cwd);
  const slugDir = path.join(claudeDir, slug);

  if (sessionId) {
    const transcriptPath = path.join(slugDir, `${sessionId}.jsonl`);
    await stat(transcriptPath).catch(() => {
      throw new Error(`No transcript found for session "${sessionId}" in ${slugDir}`);
    });
    return { transcriptPath, sessionId, projectSlug: slug };
  }

  let entries;
  try {
    entries = await readdir(slugDir);
  } catch {
    entries = null;
  }

  if (!entries) {
    let available = [];
    try {
      available = await readdir(claudeDir);
    } catch {
      // claudeDir itself doesn't exist; leave available empty
    }
    const list = available.length > 0 ? available.join(', ') : '(none found)';
    throw new Error(
      `No transcripts found for cwd "${cwd}" (looked in ${slugDir}). ` +
      `Available project folders: ${list}`
    );
  }

  const jsonlFiles = entries.filter((f) => f.endsWith('.jsonl'));
  if (jsonlFiles.length === 0) {
    throw new Error(`No .jsonl transcripts found in ${slugDir}`);
  }

  const withStats = await Promise.all(
    jsonlFiles.map(async (f) => {
      const p = path.join(slugDir, f);
      const s = await stat(p);
      return { file: f, path: p, mtimeMs: s.mtimeMs };
    })
  );

  withStats.sort((a, b) => b.mtimeMs - a.mtimeMs);
  const chosen = withStats[0];

  return {
    transcriptPath: chosen.path,
    sessionId: chosen.file.replace(/\.jsonl$/, ''),
    projectSlug: slug,
  };
}

/**
 * Find subagent transcript files for a session:
 * <claudeDir>/<slug>/<sessionId>/subagents/agent-<agentId>.jsonl
 * @param {{claudeDir?: string, cwd: string, sessionId: string}} opts
 * @returns {Promise<Record<string, string>>} agentId -> transcript path
 */
export async function locateSubagents({ claudeDir = defaultClaudeDir(), cwd, sessionId }) {
  const slug = slugify(cwd);
  const subDir = path.join(claudeDir, slug, sessionId, 'subagents');

  let entries;
  try {
    entries = await readdir(subDir);
  } catch {
    return {};
  }

  const result = {};
  for (const entry of entries) {
    const match = entry.match(/^agent-(.+)\.jsonl$/);
    if (match) {
      result[match[1]] = path.join(subDir, entry);
    }
  }
  return result;
}

/** The `agent-<id>.meta.json` the harness writes beside a subagent transcript. */
export function subagentMetaPath(transcriptPath) {
  return transcriptPath.replace(/\.jsonl$/, '.meta.json');
}

/**
 * Sessions split by /clear.
 *
 * `/clear` does not continue a session, it starts a new transcript file, so
 * a story extracted from the current session shows only the work done since
 * the last clear. The two files are linked by one observable fact: Claude
 * Code flushes a final record into the old transcript as it clears, so the
 * predecessor's mtime lands on the /clear record's timestamp. Verified
 * against real transcripts (e.g. a predecessor's mtime 13:56:45 against the
 * successor's /clear record at 11:56:45Z, same instant).
 */

const CLEAR_MARKER = '<command-name>/clear</command-name>';
// How far the predecessor's mtime may sit from the /clear timestamp. The two
// are written within the same operation; a couple of seconds is slack, not a
// window wide enough to catch an unrelated transcript.
const CLEAR_TOLERANCE_MS = 2000;
// Enough of a transcript to cover the records a session opens with.
const HEAD_BYTES = 64 * 1024;

/** The first `bytes` of a file as text, without reading a large transcript in full. */
async function readHead(filePath, bytes = HEAD_BYTES) {
  const handle = await open(filePath, 'r');
  try {
    const buffer = Buffer.alloc(bytes);
    const { bytesRead } = await handle.read(buffer, 0, bytes, 0);
    return buffer.subarray(0, bytesRead).toString('utf8');
  } finally {
    await handle.close();
  }
}

/** Text content of a record's message, when it has any. */
function messageText(record) {
  const content = record && record.message && record.message.content;
  if (typeof content === 'string') return content;
  if (Array.isArray(content)) {
    return content.filter((b) => b && b.type === 'text').map((b) => b.text || '').join('\n');
  }
  return '';
}

/**
 * When a transcript opens with a /clear, the timestamp of that record.
 * Scanning stops at the session's first real prompt: a /clear later in a
 * session ends that session's transcript rather than starting this one.
 * @returns {Promise<number|null>} epoch ms, or null
 */
async function clearedAt(transcriptPath) {
  let head;
  try {
    head = await readHead(transcriptPath);
  } catch {
    return null;
  }

  for (const line of head.split('\n')) {
    if (line.trim() === '') continue;
    let record;
    try {
      record = JSON.parse(line);
    } catch {
      continue; // a line truncated by the byte limit, or mid-write
    }
    const text = messageText(record);
    if (text.includes(CLEAR_MARKER)) {
      const at = Date.parse(record.timestamp || '');
      return Number.isFinite(at) ? at : null;
    }
    // A real prompt before any /clear: this session stands on its own.
    if (record.type === 'user' && !record.isMeta && text !== '' && !text.includes('<command-name>')) {
      return null;
    }
  }
  return null;
}

/** The transcript in `slugDir` whose mtime marks it as the one that was cleared. */
async function transcriptClearedAt(slugDir, at, exclude) {
  let entries;
  try {
    entries = await readdir(slugDir);
  } catch {
    return null;
  }

  let best = null;
  for (const entry of entries) {
    if (!entry.endsWith('.jsonl')) continue;
    const sessionId = entry.replace(/\.jsonl$/, '');
    if (exclude.has(sessionId)) continue;
    const filePath = path.join(slugDir, entry);
    let mtimeMs;
    try {
      ({ mtimeMs } = await stat(filePath));
    } catch {
      continue;
    }
    const distance = Math.abs(mtimeMs - at);
    if (distance > CLEAR_TOLERANCE_MS) continue;
    if (best === null || distance < best.distance) best = { sessionId, transcriptPath: filePath, distance };
  }
  return best ? { sessionId: best.sessionId, transcriptPath: best.transcriptPath } : null;
}

/**
 * A session together with the sessions it was split from by /clear.
 * @param {{claudeDir?: string, cwd: string, sessionId: string, transcriptPath?: string, maxDepth?: number}} opts
 * @returns {Promise<Array<{sessionId: string, transcriptPath: string}>>} oldest first, the named session last
 */
export async function locateChain({
  claudeDir = defaultClaudeDir(),
  cwd,
  sessionId,
  transcriptPath,
  maxDepth = 20,
} = {}) {
  const slugDir = path.join(claudeDir, slugify(cwd));
  const current = transcriptPath || path.join(slugDir, `${sessionId}.jsonl`);
  const chain = [{ sessionId, transcriptPath: current }];
  const seen = new Set([sessionId]);

  for (let depth = 0; depth < maxDepth; depth++) {
    const at = await clearedAt(chain[0].transcriptPath);
    if (at === null) break;
    const previous = await transcriptClearedAt(slugDir, at, seen);
    if (!previous) break;
    chain.unshift(previous);
    seen.add(previous.sessionId);
  }

  return chain;
}
