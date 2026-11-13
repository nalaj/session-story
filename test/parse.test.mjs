import { test } from 'node:test';
import assert from 'node:assert/strict';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { parseTranscript } from '../cli/src/transcript/parse.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const fixture = path.join(__dirname, 'fixtures', 'simple-session.jsonl');

test('parses each non-blank JSONL line into a record, skipping blank lines', async () => {
  const { records, warnings } = await parseTranscript(fixture);
  // 8 lines in the fixture, one is blank -> 7 records
  assert.equal(records.length, 7);
  assert.equal(warnings.length, 0);
  assert.equal(records[0].type, 'user');
  assert.equal(records[0].uuid, 'u1');
  assert.equal(records[6].type, 'mode');
});

test('records a warning instead of throwing on a malformed JSON line', async () => {
  const { records, warnings } = await parseTranscript(
    path.join(__dirname, 'fixtures', 'malformed-line.jsonl')
  );
  assert.equal(records.length, 1);
  assert.equal(warnings.length, 1);
  assert.match(warnings[0], /line 2/);
});
