/**
 * Whole-file diff view: the same changes as the hunk view, but shown in
 * place inside the complete source file. Built by splicing each hunk into
 * the file's pre-edit text at the line it applies to, so no diff algorithm
 * is involved and the result is exact.
 */

import { spliceRows, fullTableHtml } from './hunk-html.mjs';

/**
 * Bounds on the full-file view, so opting into it cannot bloat a shareable
 * artifact without limit. A file is skipped when it is too long *or* too
 * heavy (minified or data files have few lines but huge ones), before or
 * after the edit, and the page as a whole carries a fixed budget of pre-edit
 * text for these views (see planFullBases in story-data.mjs).
 */
export const FULL_VIEW_MAX_LINES = 2000;
export const FULL_VIEW_MAX_CHARS = 80000;
export const FULL_VIEW_BUDGET_CHARS = 1000000;

/**
 * @param {string|null} baseText - the file as it stood before the edit
 * @param {Array<object>} hunks - structuredPatch hunks for that edit
 * @returns {Array<{kind: string, oldNo: number|null, newNo: number|null, text: string}>|null}
 */
export function spliceFullFile(baseText, hunks) {
  if (typeof baseText !== 'string') return null;
  if (baseText.length > FULL_VIEW_MAX_CHARS) return null;
  if (baseText.split('\n').length - (baseText.endsWith('\n') ? 1 : 0) > FULL_VIEW_MAX_LINES) return null;
  const rows = spliceRows(baseText, hunks);

  // The base check alone lets a large new file through: it starts from ''.
  if (rows.length > FULL_VIEW_MAX_LINES) return null;
  if (rows.reduce((sum, row) => sum + row.text.length, 0) > FULL_VIEW_MAX_CHARS) return null;
  return rows;
}

/**
 * Render the spliced whole-file view, reusing the hunk table markup so it
 * inherits the same diff styling.
 * @returns {string} HTML, or '' when no full view can be produced
 */
export function renderFullFile(baseText, hunks) {
  const rows = spliceFullFile(baseText, hunks);
  if (!rows) return '';

  return fullTableHtml(rows);
}
