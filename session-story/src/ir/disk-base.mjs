/**
 * Last-resort base for the full-file view.
 *
 * Some transcripts record no snapshot at all for a file (Claude Code omits
 * `originalFile` for larger files). The file itself is usually still on
 * disk right after a session, so its current text can serve as the end of
 * the chain and the edits can be reversed back from there.
 *
 * This is only accepted when every reversal applies exactly, which is also
 * the evidence that the file still matches what the session produced. Even
 * then it is marked `base_source: 'disk'` — the file may have been changed
 * after the session in a place no edit mentions — and the page labels those
 * views as approximate.
 */

import { readFileSync } from 'node:fs';
import { chainFileStates } from './file-state.mjs';
import { FULL_VIEW_MAX_LINES } from '../render/full-view.mjs';

function groupByFile(story) {
  const byFile = new Map();
  for (const turn of story.turns) {
    for (const edit of turn.edits) {
      const key = edit.file || edit.rel;
      if (!byFile.has(key)) byFile.set(key, []);
      byFile.get(key).push(edit);
    }
  }
  return byFile;
}

function hasSnapshot(edits) {
  return edits.some((e) => typeof e.before === 'string' || typeof e.after === 'string');
}

/**
 * @param {object} story - Story IR, mutated in place
 * @param {(path: string) => string} [readText] - injectable for tests
 * @returns {number} how many files gained a base
 */
export function fillBasesFromDisk(story, readText) {
  const read = readText || ((file) => readFileSync(file, 'utf8'));
  let filled = 0;

  for (const [file, edits] of groupByFile(story)) {
    if (edits.length === 0 || hasSnapshot(edits)) continue;
    // Never read a file outside the project from disk.
    if (edits.some((e) => e.outside_cwd)) continue;

    let text;
    try {
      text = read(file);
    } catch {
      continue; // moved, deleted, or unreadable
    }
    if (typeof text !== 'string') continue;
    if (text.split('\n').length > FULL_VIEW_MAX_LINES + 1) continue; // too big to render in full anyway

    const last = edits[edits.length - 1];
    last.after = text;
    const bases = chainFileStates(edits);
    if (bases.get(last.id) === null) {
      last.after = null; // the reversal did not apply: this is not that file's history
      continue;
    }

    for (const edit of edits) {
      if (bases.get(edit.id) !== null) edit.base_source = 'disk';
    }
    filled++;
  }

  return filled;
}
