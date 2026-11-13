/**
 * Rendering for individual diff hunks: HTML escaping and a two-column
 * (old line / new line) table per hunk, one row per line.
 */

import { icon } from './icons.mjs';
import { escapeHtml, hunkTableHtml } from './hunk-html.mjs';
import { contentKey } from './story-data.mjs';

export { escapeHtml };

/**
 * Render one structuredPatch hunk as an HTML <table> of lines, tracking
 * old/new line numbers as it walks the hunk.
 * @param {{oldStart: number, oldLines: number, newStart: number, newLines: number, lines: string[]}} hunk
 * @returns {string}
 */
export function renderHunk(hunk) {
  return hunkTableHtml(hunk);
}

/**
 * The two ways of showing one edit's changes: just the hunks, or the whole
 * file with those same changes spliced in. Neither carries the code: each is
 * an empty placeholder naming an entry in the page's story data
 * (story-data.mjs), and the page script renders it the first time it is
 * shown. The "Full file" toggle decides which of the two is visible.
 * @param {string|null} diffKey - the edit's hunks in the story data, null
 *   when it has none
 * @param {false|string|{base: string}} [full] - the full-file pane: none at
 *   all (false, used by the Story lens); a placeholder for the base text
 *   under that key (`{base}`); '' when no pre-edit text is known or the file
 *   is too large; or a note saying why there is none (`'skip'` for
 *   out-of-project edits, `'combined'` for a diff shared across turns,
 *   `'budget'` when the page budget ran out)
 * @param {boolean} [approximate] - the base came from the file's current
 *   disk contents rather than the transcript, so it may include later changes
 * @returns {string}
 */
const SKIP_REASONS = {
  skip: 'Full file view is not shown for files outside the project.',
  combined: 'Full file view is shown on the turn this diff is counted under.',
  budget: 'Full file view was left out to keep the page small; newer turns get it first.',
};

export function renderViews(diffKey, full = '', approximate = false) {
  const diffAttr = diffKey ? ` data-diff="${escapeHtml(diffKey)}"` : '';
  const hunks = `<div class="view view-hunks"${diffAttr}></div>`;
  if (full === false) return hunks;
  // Every other case keeps the pane, so the hunks/full toggle behaves the
  // same on every edit.
  const skipped = SKIP_REASONS[full];
  if (skipped) {
    return hunks + `<div class="view view-full"><p class="edit-unknown">${icon('filter')}${skipped}</p></div>`;
  }
  if (full && typeof full === 'object' && full.base) {
    const note = approximate
      ? `<p class="approx-note">${icon('warning')}Reconstructed from the file's current contents; ` +
        `lines changed after the session may appear.</p>`
      : '';
    return hunks + `<div class="view view-full"${diffAttr} data-base="${escapeHtml(full.base)}">${note}</div>`;
  }
  return (
    hunks +
    `<div class="view view-full"><p class="edit-unknown">${icon('warning')}The full file is not available for this edit ` +
    `(the transcript did not record its contents).</p></div>`
  );
}

/**
 * Render one edit: a file header (name, create/update badge, subagent
 * badge, line counts) followed by its changes, or a note when the result
 * never arrived. Edits to files outside the project are marked so the
 * page's scope filter can hide them.
 * @param {object} edit
 * @param {{diffKey?: string|null, fullView?: false|string|object}} [opts] - the
 *   edit's hunks in the story data, and the full-file pane (see renderViews)
 * @returns {string}
 */
/**
 * Say where a shell-driven edit came from. These are reconstructed from git
 * rather than read out of the transcript, and the link to this particular
 * prompt is an inference from the commands it ran - both worth stating on
 * the page rather than only in the story's blind spots.
 */
function provenanceNote(edit) {
  if (edit.tool !== 'Bash') return '';
  if (edit.binary) {
    return `<p class="approx-note">${icon('warning')}Binary file changed by a shell command; ` +
      `no diff is shown.</p>`;
  }
  // Several turns wrote this file through the shell. Git has one net change
  // for all of them, so the same diff appears on each - say so, or the page
  // reads as though this turn alone made every line of it.
  if (edit.combined_into) {
    return `<p class="approx-note">${icon('terminal')}A shell command in this turn changed this ` +
      `file, and so did turn ${edit.combined_into}. Git keeps only the net change across the ` +
      `session, so the diff below is their combined work, shown on both turns and counted once ` +
      `(in turn ${edit.combined_into}'s totals).</p>`;
  }
  const how = edit.attribution === 'command'
    ? 'a shell command in this turn named this file'
    : edit.attribution === 'bulk'
      ? 'this turn ran a tool that rewrites files it does not name (a formatter or installer)'
      : 'this turn only referred to this file; no command here clearly wrote it';
  return `<p class="approx-note">${icon('terminal')}Changed by a shell command, so the diff comes ` +
    `from git (working tree vs HEAD) rather than the transcript - ${how}.</p>`;
}

/**
 * Whether to build a full-file view for this edit. The caller's choice wins:
 * a lens plans a shared shell diff with the base of the turn it is shared
 * with. Without one, a shared diff has no before/after of its own, so it
 * gets the pane with a reason rather than a file.
 */
function fullViewMode(edit, opts) {
  if ('fullView' in opts) return opts.fullView;
  return edit.combined_into ? 'combined' : '';
}

/** The edit's key in the story data: given by the lens, or derived the same way. */
function diffKeyOf(edit, opts) {
  if ('diffKey' in opts) return opts.diffKey;
  return edit.hunks && edit.hunks.length > 0 ? contentKey(edit.hunks) : null;
}

/** A tooltip, not the record: the Report lens lists the full command. */
const TITLE_MAX = 160;
function clampTitle(text) {
  return text.length > TITLE_MAX ? `${text.slice(0, TITLE_MAX)}…` : text;
}

export function renderEdit(edit, opts = {}) {
  const badges = [];
  if (edit.kind === 'create') badges.push(`<span class="badge create">${icon('sparkle')}new file</span>`);
  if (edit.kind === 'delete') badges.push(`<span class="badge delete">${icon('minus')}deleted</span>`);
  if (edit.tool === 'Bash') {
    // The command is the evidence for this edit, so keep it on the badge.
    const title = edit.command ? ` title="${escapeHtml(clampTitle(edit.command))}"` : '';
    badges.push(`<span class="badge shell"${title}>${icon('terminal')}via shell</span>`);
  }
  if (edit.by_subagent) badges.push(`<span class="badge subagent">${icon('robot')}by subagent</span>`);

  const stats = edit.stats || { added: 0, removed: 0 };
  const outside = edit.outside_cwd ? ' data-outside="1"' : '';
  // The file key lets a review-lens file chip find this block and scroll to it.
  const fileAttr = ` data-file="${escapeHtml(edit.rel)}"`;
  const header =
    `<div class="edit-header" data-edit-id="${escapeHtml(edit.id || '')}">` +
    `${icon('code')}` +
    `<span class="edit-file">${escapeHtml(edit.rel)}</span>` +
    badges.join('') +
    `<span class="edit-stats"><span class="add">+${stats.added}</span><span class="del">\u2212${stats.removed}</span></span>` +
    `</div>`;

  if (edit.result === 'unknown') {
    return (
      `<div class="edit"${fileAttr}${outside}>${header}` +
      `<p class="edit-unknown">${icon('warning')}Edit attempted, result unknown (session may have been interrupted).</p>` +
      `</div>`
    );
  }

  if (edit.result === 'error') {
    return (
      `<div class="edit"${fileAttr}${outside}>${header}` +
      `<p class="edit-unknown">${icon('warning')}Edit failed: ${escapeHtml(edit.error || 'unknown error')}</p>` +
      `</div>`
    );
  }

  return (
    `<div class="edit"${fileAttr}${outside}>${header}` +
    provenanceNote(edit) +
    renderViews(diffKeyOf(edit, opts), fullViewMode(edit, opts), edit.base_source === 'disk') +
    `</div>`
  );
}
