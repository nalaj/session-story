/**
 * Reconstruct the full text of each file as it stood *before* each edit.
 *
 * The transcript only sometimes carries a snapshot (`originalFile` on an
 * Edit, `content` on a Write). Every Edit does carry its old/new strings,
 * so a single snapshot anywhere in a file's chain of edits is enough: the
 * replacements can be applied forward and reversed backward from it. A
 * state that cannot be derived exactly stays null — the renderer then says
 * the full file is unavailable rather than showing a guess.
 */

/**
 * Apply one replacement, insisting it is unambiguous: `from` must occur
 * exactly once unless the edit was a replace-all. Returns null when the
 * result cannot be trusted.
 */
export function applyReplacement(text, from, to, replaceAll) {
  if (typeof text !== 'string' || typeof from !== 'string' || typeof to !== 'string') return null;
  if (from === '') return null;
  const first = text.indexOf(from);
  if (first === -1) return null;
  if (replaceAll) return text.split(from).join(to);
  if (text.indexOf(from, first + from.length) !== -1) return null;
  return text.slice(0, first) + to + text.slice(first + from.length);
}

/**
 * @param {Array<object>} edits - one file's edits, in session order
 * @returns {Map<string, string|null>} edit id -> pre-edit file text
 */
export function chainFileStates(edits) {
  const n = edits.length;
  const before = new Array(n).fill(null);
  const after = new Array(n).fill(null);

  edits.forEach((edit, i) => {
    if (typeof edit.before === 'string') before[i] = edit.before;
    if (typeof edit.after === 'string') after[i] = edit.after;
    if (edit.kind === 'create' && before[i] === null) before[i] = '';
  });

  // Learn states until nothing new can be derived: inside an edit through
  // its own replacement, and between neighbours, where one edit's result is
  // the next edit's starting point.
  let learned = true;
  while (learned) {
    learned = false;
    for (let i = 0; i < n; i++) {
      const { old_string: from, new_string: to, replace_all: all } = edits[i];
      if (after[i] === null && before[i] !== null) {
        const next = applyReplacement(before[i], from, to, all);
        if (next !== null) { after[i] = next; learned = true; }
      }
      if (before[i] === null && after[i] !== null) {
        const prev = applyReplacement(after[i], to, from, all);
        if (prev !== null) { before[i] = prev; learned = true; }
      }
      if (i + 1 < n) {
        if (before[i + 1] === null && after[i] !== null) { before[i + 1] = after[i]; learned = true; }
        if (after[i] === null && before[i + 1] !== null) { after[i] = before[i + 1]; learned = true; }
      }
    }
  }

  const bases = new Map();
  edits.forEach((edit, i) => bases.set(edit.id, before[i]));
  return bases;
}

/**
 * Chain every file in a story, so the renderer can look a pre-edit text up
 * by edit id.
 * @param {{turns: Array<{edits: Array<object>}>}} story
 * @returns {Map<string, string|null>}
 */
export function buildFileBases(story) {
  const byFile = new Map();
  for (const turn of story.turns) {
    for (const edit of turn.edits) {
      const key = edit.file || edit.rel;
      if (!byFile.has(key)) byFile.set(key, []);
      byFile.get(key).push(edit);
    }
  }

  const bases = new Map();
  for (const edits of byFile.values()) {
    for (const [id, text] of chainFileStates(edits)) bases.set(id, text);
  }
  return bases;
}
