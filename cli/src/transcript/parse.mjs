import { readFile } from 'node:fs/promises';

/**
 * Parse a Claude Code session transcript (JSONL) into an array of records.
 * Tolerant by design: blank lines are skipped, and a line that fails to
 * parse as JSON is recorded as a warning rather than throwing, since a
 * transcript may be truncated or interrupted mid-write.
 *
 * @param {string} filePath
 * @returns {Promise<{records: object[], warnings: string[]}>}
 */
export async function parseTranscript(filePath) {
  const text = await readFile(filePath, 'utf8');
  const lines = text.split('\n');
  const records = [];
  const warnings = [];

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i].trim();
    if (line === '') continue;
    try {
      records.push(JSON.parse(line));
    } catch (err) {
      warnings.push(`line ${i + 1}: could not parse JSON (${err.message})`);
    }
  }

  return { records, warnings };
}
