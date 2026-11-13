import path from 'node:path';

const EXT_LANGUAGE = {
  '.ts': 'typescript',
  '.tsx': 'typescript',
  '.js': 'javascript',
  '.jsx': 'javascript',
  '.mjs': 'javascript',
  '.cjs': 'javascript',
  '.json': 'json',
  '.md': 'markdown',
  '.css': 'css',
  '.html': 'html',
  '.py': 'python',
  '.java': 'java',
  '.sh': 'shell',
  '.bash': 'shell',
  '.yml': 'yaml',
  '.yaml': 'yaml',
  '.go': 'go',
  '.rs': 'rust',
};

function guessLanguage(rel) {
  const ext = path.extname(rel).toLowerCase();
  return EXT_LANGUAGE[ext] || null;
}

/**
 * Build a per-file index across turns: which turns touched each file,
 * whether it was touched by more than one turn (churn), summed stats,
 * and a best-guess language for syntax highlighting.
 *
 * @param {Array<{index: number, edits: Array<{rel: string, stats: {added: number, removed: number}}>}>} turns
 * @returns {Array<{rel: string, language: string|null, turns: number[], churn: boolean, stats: {added: number, removed: number}}>}
 */
export function crossIndexFiles(turns) {
  const byFile = new Map();

  for (const turn of turns) {
    for (const edit of turn.edits) {
      if (!byFile.has(edit.rel)) {
        byFile.set(edit.rel, {
          rel: edit.rel,
          language: guessLanguage(edit.rel),
          outside_cwd: !!edit.outside_cwd,
          turns: [],
          stats: { added: 0, removed: 0 },
        });
      }
      const entry = byFile.get(edit.rel);
      entry.outside_cwd = entry.outside_cwd || !!edit.outside_cwd;
      if (!entry.turns.includes(turn.index)) entry.turns.push(turn.index);
      // A `combined_into` edit shares another turn's diff (see
      // src/ir/git-edits.mjs): it is churn on this file, but its lines were
      // already counted on the turn that owns them.
      if (edit.combined_into) continue;
      entry.stats.added += edit.stats.added;
      entry.stats.removed += edit.stats.removed;
    }
  }

  return Array.from(byFile.values()).map((entry) => ({
    ...entry,
    churn: entry.turns.length > 1,
  }));
}
