import { readdir, readFile } from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';

/**
 * Claude Code keeps one `<pid>.json` per running session here, naming the
 * session it holds. A file outlives a crashed process, so the pid is the
 * real test. STORY_CLAUDE_SESSIONS_DIR points it elsewhere, for tests.
 */
export function defaultSessionsDir() {
  return process.env.STORY_CLAUDE_SESSIONS_DIR || path.join(os.homedir(), '.claude', 'sessions');
}

function pidAlive(pid) {
  try {
    process.kill(pid, 0);
    return true;
  } catch (err) {
    // EPERM: the process exists, it just isn't ours to signal
    return err.code === 'EPERM';
  }
}

/**
 * Ids of the sessions a Claude Code process is running right now. Damaged
 * or unreadable files are skipped, and a missing folder means none.
 * @param {{dir?: string, isAlive?: (pid: number) => boolean}} [opts]
 * @returns {Promise<Set<string>>}
 */
export async function liveSessionIds({ dir = defaultSessionsDir(), isAlive = pidAlive } = {}) {
  const live = new Set();
  let names;
  try {
    names = await readdir(dir);
  } catch {
    return live;
  }
  for (const name of names) {
    if (!name.endsWith('.json')) continue;
    try {
      const { pid, sessionId } = JSON.parse(await readFile(path.join(dir, name), 'utf8'));
      if (Number.isInteger(pid) && pid > 0 && typeof sessionId === 'string' && sessionId && isAlive(pid)) {
        live.add(sessionId);
      }
    } catch {
      // half-written or foreign file
    }
  }
  return live;
}
