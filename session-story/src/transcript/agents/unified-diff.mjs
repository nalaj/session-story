const HUNK_HEADER = /^@@ -(\d+)(?:,(\d+))? \+(\d+)(?:,(\d+))? @@/;

/**
 * Parse a unified diff (one file) into the `structuredPatch` hunk shape
 * Claude Code records: {oldStart, oldLines, newStart, newLines, lines}.
 * File headers, `Index:` banners and "\ No newline" markers are dropped.
 * @param {string} text
 * @returns {{oldStart:number, oldLines:number, newStart:number, newLines:number, lines:string[]}[]}
 */
export function parseUnifiedDiff(text) {
  const hunks = [];
  let hunk = null;
  for (const line of String(text).split('\n')) {
    const header = HUNK_HEADER.exec(line);
    if (header) {
      hunk = {
        oldStart: Number(header[1]),
        oldLines: header[2] === undefined ? 1 : Number(header[2]),
        newStart: Number(header[3]),
        newLines: header[4] === undefined ? 1 : Number(header[4]),
        lines: [],
      };
      hunks.push(hunk);
      continue;
    }
    if (!hunk) continue;
    if (line.startsWith('+') || line.startsWith('-') || line.startsWith(' ')) hunk.lines.push(line);
    else if (line === '') {
      // A context line for an empty source line can lose its leading space
      // in transport; keep it only while the hunk still expects lines.
      const seenOld = hunk.lines.filter((l) => !l.startsWith('+')).length;
      if (seenOld < hunk.oldLines) hunk.lines.push(' ');
    }
  }
  return hunks;
}
