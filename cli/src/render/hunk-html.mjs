/**
 * The diff table markup, shared by Node and the page. The page renders code
 * on demand from the story's embedded data (see story-data.mjs), so it runs
 * these same functions: CLIENT_SOURCE is their source text, spliced into the
 * page script.
 *
 * That only works if every function here is a plain declaration that refers
 * to nothing at module scope but the others in CLIENT_SOURCE (the escape map
 * lives inside escapeHtml for that reason), and sticks to syntax the page
 * script already relies on. test/hunk-html.test.mjs runs CLIENT_SOURCE in a
 * fresh VM context to hold that line.
 */

export function escapeHtml(str) {
  var map = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' };
  return String(str).replace(/[&<>"']/g, function (ch) { return map[ch]; });
}

export function lineKind(line) {
  if (line.charAt(0) === '+') return 'add';
  if (line.charAt(0) === '-') return 'del';
  return 'ctx';
}

export function hunkRow(kind, oldNo, newNo, text) {
  return (
    '<tr class="hunk-line ' + kind + '">' +
    '<td class="ln old">' + (oldNo === null ? '' : oldNo) + '</td>' +
    '<td class="ln new">' + (newNo === null ? '' : newNo) + '</td>' +
    '<td class="code">' + escapeHtml(text) + '</td>' +
    '</tr>'
  );
}

/**
 * One structuredPatch hunk as a <table> of lines, tracking old/new line
 * numbers as it walks the hunk.
 * @param {{oldStart: number, newStart: number, lines: string[]}} hunk
 */
export function hunkTableHtml(hunk) {
  var oldLine = hunk.oldStart;
  var newLine = hunk.newStart;
  var rows = '';
  for (var i = 0; i < hunk.lines.length; i++) {
    var line = hunk.lines[i];
    var kind = lineKind(line);
    var oldCell = null;
    var newCell = null;
    if (kind !== 'add') oldCell = oldLine++;
    if (kind !== 'del') newCell = newLine++;
    rows += hunkRow(kind, oldCell, newCell, line.slice(1));
  }
  return '<table class="hunk">' + rows + '</table>';
}

/** Every hunk of one edit, table after table. */
export function hunksHtml(hunks) {
  var out = '';
  for (var i = 0; i < (hunks || []).length; i++) out += hunkTableHtml(hunks[i]);
  return out;
}

/**
 * Splice each hunk into the file's pre-edit text at the line it applies to,
 * giving the whole file with the changes in place. No diff algorithm is
 * involved, so the result is exact. Size caps live in full-view.mjs.
 * @returns {Array<{kind: string, oldNo: number|null, newNo: number|null, text: string}>}
 */
export function spliceRows(baseText, hunks) {
  var oldLines = baseText.split('\n');
  if (oldLines.length > 0 && oldLines[oldLines.length - 1] === '') oldLines.pop();
  var ordered = (hunks || []).slice().sort(function (a, b) { return a.oldStart - b.oldStart; });
  var rows = [];
  var cursor = 1; // next untouched old line to copy across (1-based)
  var newNo = 1;
  for (var h = 0; h < ordered.length; h++) {
    var hunk = ordered[h];
    var start = Math.max(1, hunk.oldStart);
    for (; cursor < start; cursor++) {
      var kept = oldLines[cursor - 1];
      rows.push({ kind: 'ctx', oldNo: cursor, newNo: newNo++, text: kept === undefined ? '' : kept });
    }
    var oldNo = start;
    newNo = hunk.newStart;
    for (var i = 0; i < hunk.lines.length; i++) {
      var line = hunk.lines[i];
      var kind = lineKind(line);
      var text = line.slice(1);
      if (kind === 'add') rows.push({ kind: 'add', oldNo: null, newNo: newNo++, text: text });
      else if (kind === 'del') rows.push({ kind: 'del', oldNo: oldNo++, newNo: null, text: text });
      else rows.push({ kind: 'ctx', oldNo: oldNo++, newNo: newNo++, text: text });
    }
    cursor = Math.max(cursor, hunk.oldStart + hunk.oldLines);
  }
  for (; cursor <= oldLines.length; cursor++) {
    rows.push({ kind: 'ctx', oldNo: cursor, newNo: newNo++, text: oldLines[cursor - 1] });
  }
  return rows;
}

/** The spliced whole file as one table, with the same row markup as a hunk. */
export function fullTableHtml(rows) {
  var body = '';
  for (var i = 0; i < rows.length; i++) body += hunkRow(rows[i].kind, rows[i].oldNo, rows[i].newNo, rows[i].text);
  return '<table class="hunk full">' + body + '</table>';
}

export const CLIENT_SOURCE = [escapeHtml, lineKind, hunkRow, hunkTableHtml, hunksHtml, spliceRows, fullTableHtml]
  .map((fn) => fn.toString())
  .join('\n');
