import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildStory } from '../cli/src/transcript/claude-code.mjs';

test('extracts one turn per real user prompt, in order, with empty edits when no tool calls follow', () => {
  const records = [
    { type: 'user', uuid: 'u1', parentUuid: null, timestamp: '2026-09-10T10:00:00.000Z', sessionId: 's1', cwd: '/proj', gitBranch: 'main', version: '2.1.266', message: { role: 'user', content: 'Add a title prop to Panel' } },
  ];

  const story = buildStory(records, { sessionId: 's1' });

  assert.equal(story.turns.length, 1);
  assert.equal(story.turns[0].index, 1);
  assert.equal(story.turns[0].prompt, 'Add a title prop to Panel');
  assert.deepEqual(story.turns[0].edits, []);
});

test('skips slash-command noise records so they are not counted as turns', () => {
  const records = [
    { type: 'user', uuid: 'n1', message: { role: 'user', content: '<local-command-caveat>Caveat: ...</local-command-caveat>' } },
    { type: 'user', uuid: 'n2', message: { role: 'user', content: '<command-name>/model</command-name>' } },
    { type: 'user', uuid: 'n3', message: { role: 'user', content: '<local-command-stdout>Set model to Fable</local-command-stdout>' } },
    { type: 'user', uuid: 'n4', message: { role: 'user', content: '<command-message>session-story</command-message>\n<command-name>/session-story</command-name>' } },
    { type: 'user', uuid: 'real1', timestamp: '2026-09-10T10:00:00.000Z', message: { role: 'user', content: 'Add a title prop to Panel' } },
  ];

  const story = buildStory(records, { sessionId: 's1' });

  assert.equal(story.turns.length, 1);
  assert.equal(story.turns[0].id, 'real1');
});

test('skips harness-injected synthetic records: task notifications, system reminders, meta and compact-summary entries', () => {
  const records = [
    { type: 'user', uuid: 'real1', timestamp: '2026-09-10T10:00:00.000Z', message: { role: 'user', content: 'Add a title prop to Panel' } },
    { type: 'user', uuid: 'n1', message: { role: 'user', content: '<task-notification>\n<task-id>a3c62</task-id>\n<status>completed</status>\n<result>Findings from the repo.</result>\n</task-notification>' } },
    { type: 'user', uuid: 'n2', message: { role: 'user', content: '<system-reminder>\nYour todo list has changed.\n</system-reminder>' } },
    { type: 'user', uuid: 'n3', isMeta: true, message: { role: 'user', content: 'Caveat: local command output' } },
    { type: 'user', uuid: 'n4', isCompactSummary: true, message: { role: 'user', content: 'This session is being continued from a previous conversation.' } },
    { type: 'user', uuid: 'n5', message: { role: 'user', content: '<user-prompt-submit-hook>rtk hook ran</user-prompt-submit-hook>' } },
  ];

  const story = buildStory(records, { sessionId: 's1' });

  assert.equal(story.turns.length, 1);
  assert.equal(story.turns[0].id, 'real1');
  assert.equal(story.totals.turns, 1);
});

test('keeps a real prompt wrapped in system reminders and shows only the human text', () => {
  const records = [
    {
      type: 'user',
      uuid: 'u1',
      timestamp: '2026-09-10T10:00:00.000Z',
      message: {
        role: 'user',
        content: '<system-reminder>\nCodebase instructions below.\n</system-reminder>Add a title prop to Panel<system-reminder>git status snapshot</system-reminder>',
      },
    },
  ];

  const story = buildStory(records, { sessionId: 's1' });

  assert.equal(story.turns.length, 1);
  assert.equal(story.turns[0].prompt, 'Add a title prop to Panel');
});

test('attributes edits that follow a filtered task notification to the preceding real prompt', () => {
  const records = [
    { type: 'user', uuid: 'u1', timestamp: '2026-09-10T10:00:00.000Z', message: { role: 'user', content: 'Add a title prop to Panel' } },
    { type: 'user', uuid: 'n1', message: { role: 'user', content: '<task-notification>\n<task-id>a3c62</task-id>\n<status>completed</status>\n</task-notification>' } },
    {
      type: 'assistant',
      uuid: 'a1',
      message: { role: 'assistant', content: [{ type: 'tool_use', id: 'tu1', name: 'Edit', input: { file_path: '/proj/src/Panel.tsx', old_string: 'a', new_string: 'b' } }] },
    },
    {
      type: 'user',
      uuid: 'r1',
      message: { role: 'user', content: [{ type: 'tool_result', tool_use_id: 'tu1' }] },
      toolUseResult: {
        filePath: '/proj/src/Panel.tsx',
        structuredPatch: [{ oldStart: 1, oldLines: 1, newStart: 1, newLines: 1, lines: ['-a', '+b'] }],
      },
    },
  ];

  const story = buildStory(records, { sessionId: 's1', cwd: '/proj' });

  assert.equal(story.turns.length, 1);
  assert.equal(story.turns[0].id, 'u1');
  assert.equal(story.turns[0].edits.length, 1);
  assert.equal(story.turns[0].edits[0].rel, 'src/Panel.tsx');
});

test('attaches an Edit tool call and its result to the turn that issued it, with hunks and stats', () => {
  const records = [
    { type: 'user', uuid: 'u1', timestamp: '2026-09-10T10:00:00.000Z', message: { role: 'user', content: 'Add a title prop to Panel' } },
    { type: 'assistant', uuid: 'a1', parentUuid: 'u1', message: { role: 'assistant', content: [
      { type: 'tool_use', id: 'toolu_1', name: 'Edit', input: { file_path: '/proj/src/Panel.tsx', old_string: 'a', new_string: 'b', replace_all: false } },
    ] } },
    { type: 'user', uuid: 'r1', parentUuid: 'a1', message: { role: 'user', content: [{ type: 'tool_result', tool_use_id: 'toolu_1', content: 'ok' }] },
      toolUseResult: {
        filePath: '/proj/src/Panel.tsx',
        oldString: 'a', newString: 'b', originalFile: 'a\n',
        replaceAll: false, userModified: false,
        structuredPatch: [{ oldStart: 1, oldLines: 1, newStart: 1, newLines: 1, lines: ['-a', '+b'] }],
      } },
  ];

  const story = buildStory(records, { sessionId: 's1', cwd: '/proj' });

  assert.equal(story.turns.length, 1);
  const edits = story.turns[0].edits;
  assert.equal(edits.length, 1);
  assert.equal(edits[0].tool, 'Edit');
  assert.equal(edits[0].file, '/proj/src/Panel.tsx');
  assert.equal(edits[0].rel, 'src/Panel.tsx');
  assert.equal(edits[0].result, 'ok');
  assert.equal(edits[0].hunks.length, 1);
  assert.deepEqual(edits[0].hunks[0].lines, ['-a', '+b']);
  assert.deepEqual(edits[0].stats, { added: 1, removed: 1 });
});

test('synthesizes an all-added hunk for a Write that creates a new file', () => {
  const records = [
    { type: 'user', uuid: 'u1', message: { role: 'user', content: 'Create a README' } },
    { type: 'assistant', uuid: 'a1', parentUuid: 'u1', message: { role: 'assistant', content: [
      { type: 'tool_use', id: 'toolu_2', name: 'Write', input: { file_path: '/proj/README.md', content: '# Proj\nHello\n' } },
    ] } },
    { type: 'user', uuid: 'r1', parentUuid: 'a1', message: { role: 'user', content: [{ type: 'tool_result', tool_use_id: 'toolu_2', content: 'ok' }] },
      toolUseResult: { type: 'create', filePath: '/proj/README.md', content: '# Proj\nHello\n', originalFile: '', structuredPatch: [], userModified: false } },
  ];

  const story = buildStory(records, { sessionId: 's1', cwd: '/proj' });

  const edit = story.turns[0].edits[0];
  assert.equal(edit.tool, 'Write');
  assert.equal(edit.kind, 'create');
  assert.equal(edit.hunks.length, 1);
  assert.deepEqual(edit.hunks[0].lines, ['+# Proj', '+Hello']);
  assert.deepEqual(edit.stats, { added: 2, removed: 0 });
});

test("attributes a subagent's edits to the turn that spawned the Agent call", () => {
  const records = [
    { type: 'user', uuid: 'u1', message: { role: 'user', content: 'Find and fix the bug' } },
    { type: 'assistant', uuid: 'a1', parentUuid: 'u1', message: { role: 'assistant', content: [
      { type: 'tool_use', id: 'toolu_agent', name: 'Agent', input: { description: 'Fix the bug' } },
    ] } },
    { type: 'user', uuid: 'r1', parentUuid: 'a1', message: { role: 'user', content: [{ type: 'tool_result', tool_use_id: 'toolu_agent', content: 'done' }] },
      toolUseResult: { agentId: 'ag-1', status: 'completed' } },
  ];

  const subagentRecords = [
    { type: 'user', isSidechain: true, agentId: 'ag-1', parentUuid: null },
    { type: 'assistant', isSidechain: true, agentId: 'ag-1', message: { role: 'assistant', content: [
      { type: 'tool_use', id: 'toolu_sub1', name: 'Edit', input: { file_path: '/proj/src/bug.ts', old_string: 'a', new_string: 'b' } },
    ] } },
    { type: 'user', isSidechain: true, agentId: 'ag-1', toolUseResult: {
      filePath: '/proj/src/bug.ts', structuredPatch: [{ oldStart: 1, oldLines: 1, newStart: 1, newLines: 1, lines: ['-a', '+b'] }],
    }, message: { role: 'user', content: [{ type: 'tool_result', tool_use_id: 'toolu_sub1', content: 'ok' }] } },
  ];

  const story = buildStory(records, { sessionId: 's1', cwd: '/proj', subagents: { 'ag-1': subagentRecords } });

  assert.equal(story.turns.length, 1);
  const edits = story.turns[0].edits;
  assert.equal(edits.length, 1);
  assert.equal(edits[0].file, '/proj/src/bug.ts');
  assert.equal(edits[0].by_subagent, 'ag-1');
});

test('marks an edit as result "unknown" when no matching tool_result record follows (interrupted session)', () => {
  const records = [
    { type: 'user', uuid: 'u1', message: { role: 'user', content: 'Refactor the parser' } },
    { type: 'assistant', uuid: 'a1', parentUuid: 'u1', message: { role: 'assistant', content: [
      { type: 'tool_use', id: 'toolu_x', name: 'Edit', input: { file_path: '/proj/src/parser.ts', old_string: 'a', new_string: 'b' } },
    ] } },
    // session ends here, no tool_result record
  ];

  const story = buildStory(records, { sessionId: 's1', cwd: '/proj' });

  const edit = story.turns[0].edits[0];
  assert.equal(edit.result, 'unknown');
  assert.deepEqual(edit.hunks, []);
});

test('computes session started_at/ended_at/duration and totals across turns', () => {
  const records = [
    { type: 'user', uuid: 'u1', timestamp: '2026-09-10T10:00:00.000Z', message: { role: 'user', content: 'Add a title prop to Panel' } },
    { type: 'assistant', uuid: 'a1', parentUuid: 'u1', message: { role: 'assistant', content: [
      { type: 'tool_use', id: 'toolu_1', name: 'Edit', input: { file_path: '/proj/src/Panel.tsx', old_string: 'a', new_string: 'b' } },
    ] } },
    { type: 'user', uuid: 'r1', parentUuid: 'a1', message: { role: 'user', content: [{ type: 'tool_result', tool_use_id: 'toolu_1', content: 'ok' }] },
      toolUseResult: { filePath: '/proj/src/Panel.tsx', structuredPatch: [{ oldStart: 1, oldLines: 1, newStart: 1, newLines: 1, lines: ['-a', '+b'] }] } },
    { type: 'user', uuid: 'u2', timestamp: '2026-09-10T10:05:30.000Z', message: { role: 'user', content: 'Now add a subtitle too' } },
    { type: 'assistant', uuid: 'a2', parentUuid: 'u2', message: { role: 'assistant', content: [
      { type: 'tool_use', id: 'toolu_2', name: 'Edit', input: { file_path: '/proj/src/Panel.tsx', old_string: 'b', new_string: 'c' } },
    ] } },
    { type: 'user', uuid: 'r2', parentUuid: 'a2', timestamp: '2026-09-10T10:06:00.000Z', message: { role: 'user', content: [{ type: 'tool_result', tool_use_id: 'toolu_2', content: 'ok' }] },
      toolUseResult: { filePath: '/proj/src/Panel.tsx', structuredPatch: [{ oldStart: 1, oldLines: 1, newStart: 1, newLines: 1, lines: ['-b', '+c'] }] } },
    // work continues after the last prompt, and the session ends with it
    { type: 'system', subtype: 'turn_duration', timestamp: '2026-09-10T10:07:30.000Z' },
  ];

  const story = buildStory(records, { sessionId: 's1', cwd: '/proj' });

  assert.equal(story.session.started_at, '2026-09-10T10:00:00.000Z');
  assert.equal(story.session.ended_at, '2026-09-10T10:07:30.000Z');
  assert.equal(story.session.duration_ms, 450000);
  assert.deepEqual(story.totals, { turns: 2, files: 1, added: 2, removed: 2, edits: 2 });
});

test('a single-turn session still has a duration: it ends at the last record, not the prompt', () => {
  const records = [
    { type: 'user', uuid: 'u1', timestamp: '2026-09-10T10:00:00.000Z', message: { role: 'user', content: 'Look into the failing test' } },
    { type: 'assistant', uuid: 'a1', parentUuid: 'u1', timestamp: '2026-09-10T10:02:00.000Z', message: { role: 'assistant', content: [
      { type: 'tool_use', id: 'toolu_1', name: 'Bash', input: { command: 'npm test' } },
    ] } },
    { type: 'user', uuid: 'r1', parentUuid: 'a1', timestamp: '2026-09-10T10:20:00.000Z', message: { role: 'user', content: [{ type: 'tool_result', tool_use_id: 'toolu_1', content: 'ok' }] },
      toolUseResult: { stdout: 'ok', stderr: '' } },
  ];

  const story = buildStory(records, { sessionId: 's1', cwd: '/proj' });

  assert.equal(story.session.ended_at, '2026-09-10T10:20:00.000Z');
  assert.equal(story.session.duration_ms, 1200000);
});

test("includes a files[] cross-index built from the turns' edits", () => {
  const records = [
    { type: 'user', uuid: 'u1', timestamp: '2026-09-10T10:00:00.000Z', message: { role: 'user', content: 'Add a title prop to Panel' } },
    { type: 'assistant', uuid: 'a1', parentUuid: 'u1', message: { role: 'assistant', content: [
      { type: 'tool_use', id: 'toolu_1', name: 'Edit', input: { file_path: '/proj/src/Panel.tsx', old_string: 'a', new_string: 'b' } },
    ] } },
    { type: 'user', uuid: 'r1', parentUuid: 'a1', message: { role: 'user', content: [{ type: 'tool_result', tool_use_id: 'toolu_1', content: 'ok' }] },
      toolUseResult: { filePath: '/proj/src/Panel.tsx', structuredPatch: [{ oldStart: 1, oldLines: 1, newStart: 1, newLines: 1, lines: ['-a', '+b'] }] } },
  ];

  const story = buildStory(records, { sessionId: 's1', cwd: '/proj' });

  assert.equal(story.files.length, 1);
  assert.equal(story.files[0].rel, 'src/Panel.tsx');
  assert.equal(story.files[0].language, 'typescript');
  assert.equal(story.files[0].churn, false);
});

test('captures the pre-edit text, replacement strings, and whether each file sits outside the project', () => {
  const records = [
    { type: 'user', uuid: 'u1', timestamp: '2026-09-10T10:00:00.000Z', message: { role: 'user', content: 'Fix it' } },
    { type: 'assistant', uuid: 'a1', parentUuid: 'u1', message: { role: 'assistant', content: [
      { type: 'tool_use', id: 'toolu_1', name: 'Edit', input: { file_path: '/proj/src/a.ts' } },
      { type: 'tool_use', id: 'toolu_2', name: 'Edit', input: { file_path: '/tmp/scratch/story.json' } },
    ] } },
    { type: 'user', uuid: 'r1', parentUuid: 'a1', message: { role: 'user', content: [{ type: 'tool_result', tool_use_id: 'toolu_1' }] },
      toolUseResult: { oldString: 'a', newString: 'b', originalFile: 'a\n', replaceAll: false,
        structuredPatch: [{ oldStart: 1, oldLines: 1, newStart: 1, newLines: 1, lines: ['-a', '+b'] }] } },
    { type: 'user', uuid: 'r2', parentUuid: 'a1', message: { role: 'user', content: [{ type: 'tool_result', tool_use_id: 'toolu_2' }] },
      toolUseResult: { oldString: 'x', newString: 'y', originalFile: null, replaceAll: true, structuredPatch: [] } },
  ];

  const story = buildStory(records, { sessionId: 's1', cwd: '/proj' });
  const [inside, outside] = story.turns[0].edits;

  assert.equal(inside.before, 'a\n');
  assert.equal(inside.old_string, 'a');
  assert.equal(inside.new_string, 'b');
  assert.equal(inside.replace_all, false);
  assert.equal(inside.outside_cwd, false);
  assert.equal(outside.outside_cwd, true);
  assert.equal(outside.before, null);
  assert.equal(outside.replace_all, true);
});

test('a Write that creates a file records an empty pre-edit text and keeps its full content', () => {
  const records = [
    { type: 'user', uuid: 'u1', timestamp: '2026-09-10T10:00:00.000Z', message: { role: 'user', content: 'Make it' } },
    { type: 'assistant', uuid: 'a1', parentUuid: 'u1', message: { role: 'assistant', content: [
      { type: 'tool_use', id: 'toolu_1', name: 'Write', input: { file_path: '/proj/new.ts' } },
    ] } },
    { type: 'user', uuid: 'r1', parentUuid: 'a1', message: { role: 'user', content: [{ type: 'tool_result', tool_use_id: 'toolu_1' }] },
      toolUseResult: { type: 'create', filePath: '/proj/new.ts', content: 'x\ny\n' } },
  ];

  const story = buildStory(records, { sessionId: 's1', cwd: '/proj' });

  assert.equal(story.turns[0].edits[0].before, '');
  assert.equal(story.turns[0].edits[0].after, 'x\ny\n');
});

function userRecord({ uuid, ts, toolUseId, content, isError = false }) {
  return {
    type: 'user',
    uuid,
    timestamp: ts,
    toolUseResult: content,
    message: {
      role: 'user',
      content: [{ type: 'tool_result', tool_use_id: toolUseId, is_error: isError, content: typeof content === 'string' ? content : JSON.stringify(content) }],
    },
  };
}

function assistantBash({ uuid, ts, id, command, description }) {
  return {
    type: 'assistant',
    uuid,
    timestamp: ts,
    gitBranch: 'main',
    message: { role: 'assistant', content: [{ type: 'tool_use', id, name: 'Bash', input: { command, description } }] },
  };
}

test('captures a successful Bash command as an ok bash entry with category, exit code and output tail', () => {
  const records = [
    { type: 'user', uuid: 'u1', timestamp: '2026-09-10T10:00:00.000Z', message: { role: 'user', content: 'run the tests' } },
    assistantBash({ uuid: 'a1', ts: '2026-09-10T10:00:01.000Z', id: 'tu1', command: 'npm test', description: 'run tests' }),
    userRecord({ uuid: 'r1', ts: '2026-09-10T10:00:02.000Z', toolUseId: 'tu1', content: { stdout: '# pass 5\n', stderr: '', interrupted: false } }),
  ];

  const story = buildStory(records, { sessionId: 's1' });

  const [bash] = story.turns[0].bash;
  assert.equal(bash.command, 'npm test');
  assert.equal(bash.description, 'run tests');
  assert.equal(bash.category, 'test');
  assert.equal(bash.ok, true);
  assert.equal(bash.rejected, false);
  assert.match(bash.output_tail, /pass 5/);
});

test('captures a failing Bash command with exit code and marks it not ok', () => {
  const records = [
    { type: 'user', uuid: 'u1', timestamp: '2026-09-10T10:00:00.000Z', message: { role: 'user', content: 'run the tests' } },
    assistantBash({ uuid: 'a1', ts: '2026-09-10T10:00:01.000Z', id: 'tu1', command: 'npm test', description: 'run tests' }),
    userRecord({ uuid: 'r1', ts: '2026-09-10T10:00:02.000Z', toolUseId: 'tu1', content: 'Error: Exit code 1\n5 failing', isError: true }),
  ];

  const story = buildStory(records, { sessionId: 's1' });

  const [bash] = story.turns[0].bash;
  assert.equal(bash.ok, false);
  assert.equal(bash.exit_code, 1);
  assert.match(bash.output_tail, /5 failing/);
  assert.equal(story.turns[0].errors.length, 1);
  assert.equal(story.turns[0].errors[0].tool, 'Bash');
  assert.equal(story.turns[0].errors[0].target, 'npm test');
  assert.equal(story.turns[0].errors[0].kind, 'error');
});

test('captures a rejected Bash command distinctly from an error', () => {
  const records = [
    { type: 'user', uuid: 'u1', timestamp: '2026-09-10T10:00:00.000Z', message: { role: 'user', content: 'delete everything' } },
    assistantBash({ uuid: 'a1', ts: '2026-09-10T10:00:01.000Z', id: 'tu1', command: 'rm -rf /', description: 'cleanup' }),
    userRecord({ uuid: 'r1', ts: '2026-09-10T10:00:02.000Z', toolUseId: 'tu1', content: 'User rejected tool use', isError: true }),
  ];

  const story = buildStory(records, { sessionId: 's1' });

  const [bash] = story.turns[0].bash;
  assert.equal(bash.rejected, true);
  assert.equal(bash.ok, false);
  assert.equal(story.turns[0].errors[0].kind, 'rejected');
});

test('marks an errored Edit as result "error" with a message, instead of a false "ok"', () => {
  const records = [
    { type: 'user', uuid: 'u1', timestamp: '2026-09-10T10:00:00.000Z', message: { role: 'user', content: 'fix the typo' } },
    {
      type: 'assistant',
      uuid: 'a1',
      timestamp: '2026-09-10T10:00:01.000Z',
      message: { role: 'assistant', content: [{ type: 'tool_use', id: 'tu1', name: 'Edit', input: { file_path: '/proj/missing.txt', old_string: 'a', new_string: 'b' } }] },
    },
    userRecord({ uuid: 'r1', ts: '2026-09-10T10:00:02.000Z', toolUseId: 'tu1', content: 'Error: File does not exist.', isError: true }),
  ];

  const story = buildStory(records, { sessionId: 's1', cwd: '/proj' });

  const [edit] = story.turns[0].edits;
  assert.equal(edit.result, 'error');
  assert.match(edit.error, /File does not exist/);
  assert.deepEqual(edit.hunks, []);
  assert.equal(story.turns[0].errors.length, 1);
  assert.equal(story.turns[0].errors[0].tool, 'Edit');
  assert.equal(story.turns[0].errors[0].target, 'missing.txt');
});

test('captures an approved plan from ExitPlanMode on the turn', () => {
  const records = [
    { type: 'user', uuid: 'u1', timestamp: '2026-09-10T10:00:00.000Z', message: { role: 'user', content: 'plan the feature' } },
    {
      type: 'assistant',
      uuid: 'a1',
      timestamp: '2026-09-10T10:00:01.000Z',
      message: { role: 'assistant', content: [{ type: 'tool_use', id: 'tu1', name: 'ExitPlanMode', input: { plan: '# Plan\nDo the thing', planFilePath: '/plans/x.md' } }] },
    },
    userRecord({ uuid: 'r1', ts: '2026-09-10T10:00:02.000Z', toolUseId: 'tu1', content: { plan: '# Plan\nDo the thing', isAgent: false, filePath: '/plans/x.md' } }),
  ];

  const story = buildStory(records, { sessionId: 's1' });

  assert.deepEqual(story.turns[0].plan, { text: '# Plan\nDo the thing', approved: true, file: '/plans/x.md' });
});

test('captures a rejected plan from ExitPlanMode as not approved', () => {
  const records = [
    { type: 'user', uuid: 'u1', timestamp: '2026-09-10T10:00:00.000Z', message: { role: 'user', content: 'plan the feature' } },
    {
      type: 'assistant',
      uuid: 'a1',
      timestamp: '2026-09-10T10:00:01.000Z',
      message: { role: 'assistant', content: [{ type: 'tool_use', id: 'tu1', name: 'ExitPlanMode', input: { plan: '# Plan', planFilePath: '/plans/x.md' } }] },
    },
    userRecord({ uuid: 'r1', ts: '2026-09-10T10:00:02.000Z', toolUseId: 'tu1', content: 'User rejected tool use', isError: true }),
  ];

  const story = buildStory(records, { sessionId: 's1' });

  assert.equal(story.turns[0].plan.approved, false);
});

test('reads session.git_branch from the transcript records', () => {
  const records = [
    { type: 'user', uuid: 'u1', timestamp: '2026-09-10T10:00:00.000Z', gitBranch: 'feature/x', message: { role: 'user', content: 'do a thing' } },
  ];

  const story = buildStory(records, { sessionId: 's1' });

  assert.equal(story.session.git_branch, 'feature/x');
});

test('initializes an empty report skeleton on every story', () => {
  const story = buildStory([], { sessionId: 's1' });

  assert.deepEqual(story.report, {
    plan: '',
    decisions: [],
    outcome: null,
    outcome_note: null,
    dependencies: { manifests: [], installs: [], config_files: [] },
    git: null,
  });
});

test('subagent Bash errors and edit errors bubble up to the spawning turn', () => {
  const records = [
    { type: 'user', uuid: 'u1', timestamp: '2026-09-10T10:00:00.000Z', message: { role: 'user', content: 'delegate the search' } },
    {
      type: 'assistant',
      uuid: 'a1',
      timestamp: '2026-09-10T10:00:01.000Z',
      message: { role: 'assistant', content: [{ type: 'tool_use', id: 'agent1', name: 'Agent', input: { prompt: 'find it' } }] },
    },
    userRecord({ uuid: 'r1', ts: '2026-09-10T10:00:05.000Z', toolUseId: 'agent1', content: { agentId: 'sub-1', status: 'completed' } }),
  ];
  const subagents = {
    'sub-1': [
      assistantBash({ uuid: 'sa1', ts: '2026-09-10T10:00:02.000Z', id: 'stu1', command: 'grep -r foo .', description: 'search' }),
      userRecord({ uuid: 'sr1', ts: '2026-09-10T10:00:03.000Z', toolUseId: 'stu1', content: 'Error: Exit code 1\nno matches', isError: true }),
    ],
  };

  const story = buildStory(records, { sessionId: 's1', subagents });

  assert.equal(story.turns[0].errors.length, 1);
  assert.equal(story.turns[0].errors[0].tool, 'Bash');
  assert.equal(story.turns[0].bash[0].by_subagent, 'sub-1');
  assert.equal(story.turns[0].bash[0].ok, false);
});

test('carries the harness-generated session title as session.ai_title, keeping the last one written', () => {
  const records = [
    { type: 'ai-title', aiTitle: 'First guess at the session', sessionId: 's1' },
    { type: 'user', uuid: 'u1', timestamp: '2026-09-10T10:00:00.000Z', message: { role: 'user', content: 'Add a title prop to Panel' } },
    { type: 'ai-title', aiTitle: 'Panel title prop', sessionId: 's1' },
  ];

  const story = buildStory(records, { sessionId: 's1' });

  assert.equal(story.session.ai_title, 'Panel title prop');
  // Claude still writes session.title itself; the harness title is only a fallback.
  assert.equal(story.session.title, null);
});

test('leaves session.ai_title null when the transcript has no ai-title record', () => {
  const records = [
    { type: 'user', uuid: 'u1', timestamp: '2026-09-10T10:00:00.000Z', message: { role: 'user', content: 'Add a title prop to Panel' } },
  ];

  const story = buildStory(records, { sessionId: 's1' });

  assert.equal(story.session.ai_title, null);
});

function assistantTool({ uuid, ts, id, name, input, messageId, usage, model, version }) {
  const record = {
    type: 'assistant', uuid, timestamp: ts, gitBranch: 'main',
    message: { role: 'assistant', content: [{ type: 'tool_use', id, name, input }] },
  };
  if (messageId) record.message.id = messageId;
  if (usage) record.message.usage = usage;
  if (model) record.message.model = model;
  if (version) record.version = version;
  return record;
}

test('trace: emits a prompt event per turn whose id is the turn id', () => {
  const records = [
    { type: 'user', uuid: 'u1', timestamp: '2026-10-08T10:00:00.000Z', message: { role: 'user', content: 'first' } },
    { type: 'user', uuid: 'u2', timestamp: '2026-10-08T10:05:00.000Z', message: { role: 'user', content: 'second' } },
  ];
  const story = buildStory(records, { sessionId: 's1', cwd: '/proj' });
  const prompts = story.trace.events.filter((e) => e.kind === 'prompt');
  assert.deepEqual(prompts.map((e) => e.id), ['u1', 'u2']);
  assert.deepEqual(prompts.map((e) => e.turn), [1, 2]);
  assert.equal(prompts[0].summary, 'first');
});

test('trace: every tool call becomes a tool event with latency and status, including Read and Grep', () => {
  const records = [
    { type: 'user', uuid: 'u1', timestamp: '2026-10-08T10:00:00.000Z', message: { role: 'user', content: 'look around' } },
    assistantTool({ uuid: 'a1', ts: '2026-10-08T10:00:01.000Z', id: 'tu1', name: 'Read', input: { file_path: '/proj/src/a.js' } }),
    userRecord({ uuid: 'r1', ts: '2026-10-08T10:00:01.400Z', toolUseId: 'tu1', content: { type: 'text', file: { filePath: '/proj/src/a.js', content: 'x', numLines: 1 } } }),
    assistantTool({ uuid: 'a2', ts: '2026-10-08T10:00:02.000Z', id: 'tu2', name: 'Grep', input: { pattern: 'foo', path: '/proj/src' } }),
    userRecord({ uuid: 'r2', ts: '2026-10-08T10:00:02.250Z', toolUseId: 'tu2', content: 'No matches found', isError: true }),
    assistantBash({ uuid: 'a3', ts: '2026-10-08T10:00:03.000Z', id: 'tu3', command: 'npm test', description: 'run tests' }),
    userRecord({ uuid: 'r3', ts: '2026-10-08T10:00:10.000Z', toolUseId: 'tu3', content: 'Error: Exit code 1\n1 failing', isError: true }),
  ];
  const story = buildStory(records, { sessionId: 's1', cwd: '/proj' });
  const tools = story.trace.events.filter((e) => e.kind === 'tool');
  assert.deepEqual(tools.map((e) => [e.id, e.tool, e.category, e.status, e.summary, e.duration_ms]), [
    ['tu1', 'Read', null, 'ok', 'src/a.js', 400],
    ['tu2', 'Grep', null, 'error', 'foo in src', 250],
    ['tu3', 'Bash', 'test', 'error', 'npm test', 7000],
  ]);
  assert.ok(tools.every((e) => e.turn === 1 && e.parent_id === null && e.source === 'transcript'));
});

test('trace: a rejected tool use is rejected and an interrupted Bash is interrupted, not error', () => {
  const records = [
    { type: 'user', uuid: 'u1', timestamp: '2026-10-08T10:00:00.000Z', message: { role: 'user', content: 'go' } },
    assistantBash({ uuid: 'a1', ts: '2026-10-08T10:00:01.000Z', id: 'tu1', command: 'rm -rf build' }),
    userRecord({ uuid: 'r1', ts: '2026-10-08T10:00:02.000Z', toolUseId: 'tu1', content: 'User rejected tool use', isError: true }),
    assistantBash({ uuid: 'a2', ts: '2026-10-08T10:00:03.000Z', id: 'tu2', command: 'npm run dev' }),
    userRecord({ uuid: 'r2', ts: '2026-10-08T10:00:33.000Z', toolUseId: 'tu2', content: { stdout: '', stderr: '', interrupted: true }, isError: true }),
  ];
  const story = buildStory(records, { sessionId: 's1', cwd: '/proj' });
  const byId = Object.fromEntries(story.trace.events.map((e) => [e.id, e]));
  assert.equal(byId.tu1.status, 'rejected');
  assert.equal(byId.tu2.status, 'interrupted');
});

test('trace: a tool call whose result never arrives stays unknown with no end and no latency', () => {
  const records = [
    { type: 'user', uuid: 'u1', timestamp: '2026-10-08T10:00:00.000Z', message: { role: 'user', content: 'go' } },
    assistantTool({ uuid: 'a1', ts: '2026-10-08T10:00:01.000Z', id: 'tu1', name: 'Edit', input: { file_path: '/proj/a.js', old_string: 'a', new_string: 'b' } }),
  ];
  const story = buildStory(records, { sessionId: 's1', cwd: '/proj' });
  const ev = story.trace.events.find((e) => e.id === 'tu1');
  assert.equal(ev.status, 'unknown');
  assert.equal(ev.ended_at, null);
  assert.equal(ev.duration_ms, null);
});

test('trace: events are in chronological order with the prompt first', () => {
  const records = [
    { type: 'user', uuid: 'u1', timestamp: '2026-10-08T10:00:00.000Z', message: { role: 'user', content: 'go' } },
    assistantBash({ uuid: 'a1', ts: '2026-10-08T10:00:05.000Z', id: 'tu1', command: 'ls' }),
    assistantBash({ uuid: 'a2', ts: '2026-10-08T10:00:01.000Z', id: 'tu2', command: 'pwd' }),
  ];
  const story = buildStory(records, { sessionId: 's1', cwd: '/proj' });
  assert.deepEqual(story.trace.events.map((e) => e.id), ['u1', 'tu2', 'tu1']);
});

test('trace: a result for an unknown tool_use id is ignored', () => {
  const records = [
    { type: 'user', uuid: 'u1', timestamp: '2026-10-08T10:00:00.000Z', message: { role: 'user', content: 'go' } },
    userRecord({ uuid: 'r1', ts: '2026-10-08T10:00:02.000Z', toolUseId: 'ghost', content: 'ok' }),
  ];
  const story = buildStory(records, { sessionId: 's1', cwd: '/proj' });
  assert.equal(story.trace.events.length, 1);
});

function turnDurationRecord({ uuid, ts, durationMs }) {
  return { type: 'system', subtype: 'turn_duration', uuid, timestamp: ts, durationMs, isMeta: false };
}

test('turn duration sums the harness turn_duration records of the turn and marks the source transcript', () => {
  const records = [
    { type: 'user', uuid: 'u1', timestamp: '2026-10-08T10:00:00.000Z', message: { role: 'user', content: 'go' } },
    assistantBash({ uuid: 'a1', ts: '2026-10-08T10:00:01.000Z', id: 'tu1', command: 'ls' }),
    userRecord({ uuid: 'r1', ts: '2026-10-08T10:00:02.000Z', toolUseId: 'tu1', content: { stdout: 'a', stderr: '', interrupted: false } }),
    turnDurationRecord({ uuid: 's1', ts: '2026-10-08T10:00:02.100Z', durationMs: 1000 }),
    turnDurationRecord({ uuid: 's2', ts: '2026-10-08T10:00:30.000Z', durationMs: 2000 }),
    { type: 'user', uuid: 'u2', timestamp: '2026-10-08T10:01:00.000Z', message: { role: 'user', content: 'next' } },
  ];
  const story = buildStory(records, { sessionId: 's1', cwd: '/proj' });
  assert.equal(story.turns[0].duration_ms, 3000);
  assert.equal(story.turns[0].duration_source, 'transcript');
  const prompt = story.trace.events.find((e) => e.id === 'u1');
  assert.equal(prompt.duration_ms, 3000);
});

test('turn duration falls back to wall clock up to the last finished event when the harness wrote none', () => {
  const records = [
    { type: 'user', uuid: 'u1', timestamp: '2026-10-08T10:00:00.000Z', message: { role: 'user', content: 'go' } },
    assistantBash({ uuid: 'a1', ts: '2026-10-08T10:00:01.000Z', id: 'tu1', command: 'ls' }),
    userRecord({ uuid: 'r1', ts: '2026-10-08T10:00:18.000Z', toolUseId: 'tu1', content: { stdout: 'a', stderr: '', interrupted: false } }),
  ];
  const story = buildStory(records, { sessionId: 's1', cwd: '/proj' });
  assert.equal(story.turns[0].duration_ms, 18000);
  assert.equal(story.turns[0].duration_source, 'derived');
  assert.equal(story.trace.events.find((e) => e.id === 'u1').ended_at, '2026-10-08T10:00:18.000Z');
});

test('turn with no finished events and no turn_duration has an unknown duration, never 0', () => {
  const records = [
    { type: 'user', uuid: 'u1', timestamp: '2026-10-08T10:00:00.000Z', message: { role: 'user', content: 'go' } },
    assistantBash({ uuid: 'a1', ts: '2026-10-08T10:00:01.000Z', id: 'tu1', command: 'ls' }),
  ];
  const story = buildStory(records, { sessionId: 's1', cwd: '/proj' });
  assert.equal(story.turns[0].duration_ms, null);
  assert.equal(story.turns[0].duration_source, 'unknown');
});

test('a turn_duration record before any prompt is ignored', () => {
  const records = [
    turnDurationRecord({ uuid: 's0', ts: '2026-10-08T09:59:00.000Z', durationMs: 5000 }),
    { type: 'user', uuid: 'u1', timestamp: '2026-10-08T10:00:00.000Z', message: { role: 'user', content: 'go' } },
  ];
  const story = buildStory(records, { sessionId: 's1', cwd: '/proj' });
  assert.equal(story.turns[0].duration_ms, null);
});

test('each turn carries its deduped usage, and the story its environment', () => {
  const usage = { input_tokens: 10, output_tokens: 5, cache_creation_input_tokens: 100, cache_read_input_tokens: 200 };
  const records = [
    { type: 'user', uuid: 'u1', timestamp: '2026-10-08T10:00:00.000Z', version: '2.1.288', message: { role: 'user', content: 'go' } },
    assistantTool({ uuid: 'a1', ts: '2026-10-08T10:00:01.000Z', id: 'tu1', name: 'Read', input: { file_path: '/proj/a.js' }, messageId: 'm1', usage, model: 'claude-opus-5-5', version: '2.1.288' }),
    { type: 'assistant', uuid: 'a1b', timestamp: '2026-10-08T10:00:01.100Z', version: '2.1.288',
      message: { id: 'm1', role: 'assistant', model: 'claude-opus-5-5', usage, content: [{ type: 'text', text: 'reading' }] } },
    { type: 'user', uuid: 'u2', timestamp: '2026-10-08T10:01:00.000Z', message: { role: 'user', content: 'again' } },
    assistantTool({ uuid: 'a2', ts: '2026-10-08T10:01:01.000Z', id: 'tu2', name: 'Read', input: { file_path: '/proj/b.js' }, messageId: 'm2', usage: { input_tokens: 1, output_tokens: 2 }, model: 'claude-haiku-4-5-20251001', version: '2.1.289' }),
    { type: 'user', uuid: 'u3', timestamp: '2026-10-08T10:02:00.000Z', message: { role: 'user', content: 'unanswered' } },
  ];
  const story = buildStory(records, { sessionId: 's1', cwd: '/proj' });
  assert.deepEqual(story.turns[0].usage, { input_tokens: 10, output_tokens: 5, cache_read_tokens: 200, cache_creation_tokens: 100, api_calls: 1, cache_breaks: 0, models: ['claude-opus-5-5'], complete: true });
  assert.equal(story.turns[1].usage.models[0], 'claude-haiku-4-5-20251001');
  assert.equal(story.turns[2].usage, null);
  assert.deepEqual(story.environment, { agent: { name: 'Claude Code', version: '2.1.289' }, models: ['claude-haiku-4-5-20251001', 'claude-opus-5-5'] });
});

test('a cost-state record lands on trace.cost_states and is not an event', () => {
  const records = [
    { type: 'user', uuid: 'u1', timestamp: '2026-10-08T10:00:00.000Z', message: { role: 'user', content: 'go' } },
    { type: 'cost-state', sessionId: 's1', totalCostUSD: 0.05, totalAPIDuration: 9000, totalToolDuration: 11000,
      modelUsage: { 'claude-opus-5-5': { inputTokens: 30, outputTokens: 65, cacheReadInputTokens: 1100, cacheCreationInputTokens: 100, costUSD: 0.05 } },
      hasUnknownModelCost: false },
  ];
  const story = buildStory(records, { sessionId: 's1', cwd: '/proj' });
  assert.equal(story.trace.events.length, 1);
  assert.equal(story.trace.cost_states.length, 1);
  assert.equal(story.trace.cost_states[0].total_cost_usd, 0.05);
  assert.equal(story.trace.cost_states[0].total_api_duration_ms, 9000);
});

test('environment has a null version and no models when the records carry none', () => {
  const story = buildStory([
    { type: 'user', uuid: 'u1', timestamp: '2026-10-08T10:00:00.000Z', message: { role: 'user', content: 'go' } },
  ], { sessionId: 's1', cwd: '/proj' });
  assert.deepEqual(story.environment, { agent: { name: 'Claude Code', version: null }, models: [] });
});

function agentLaunch({ uuid, ts, id, description }) {
  return assistantTool({ uuid, ts, id, name: 'Agent', input: { description, prompt: 'look', subagent_type: 'Explore' } });
}

function agentAsyncResult({ uuid, ts, toolUseId, agentId }) {
  return userRecord({ uuid, ts, toolUseId, content: { isAsync: true, status: 'async_launched', agentId, description: 'd' } });
}

function notification({ uuid, ts, toolUseId, status = 'completed' }) {
  return {
    type: 'queue-operation', operation: 'enqueue', uuid, timestamp: ts, sessionId: 's1',
    content: `<task-notification><task-id>${toolUseId}</task-id><tool-use-id>${toolUseId}</tool-use-id><status>${status}</status><usage><duration_ms>5000</duration_ms></usage></task-notification>`,
  };
}

const SUB_RECORDS = [
  { type: 'user', uuid: 'su1', parentUuid: null, isSidechain: true, agentId: 'ag1', timestamp: '2026-10-08T10:00:03.000Z', message: { role: 'user', content: 'look' } },
  { type: 'assistant', uuid: 'sa1', isSidechain: true, agentId: 'ag1', timestamp: '2026-10-08T10:00:04.000Z',
    message: { id: 'sm1', role: 'assistant', model: 'claude-opus-5-5', usage: { input_tokens: 5, output_tokens: 7 }, content: [{ type: 'tool_use', id: 'stu1', name: 'Read', input: { file_path: '/proj/src/a.js' } }] } },
  { type: 'user', uuid: 'sr1', isSidechain: true, agentId: 'ag1', timestamp: '2026-10-08T10:00:04.400Z',
    toolUseResult: { type: 'text', file: { filePath: '/proj/src/a.js', content: 'x', numLines: 1 } },
    message: { role: 'user', content: [{ type: 'tool_result', tool_use_id: 'stu1', is_error: false, content: 'x' }] } },
];

test('an async Agent becomes a subagent event closed by its task notification, with its children attached', () => {
  const records = [
    { type: 'user', uuid: 'u1', timestamp: '2026-10-08T10:00:00.000Z', message: { role: 'user', content: 'go' } },
    agentLaunch({ uuid: 'a1', ts: '2026-10-08T10:00:01.000Z', id: 'tu1', description: 'Explore IR' }),
    agentAsyncResult({ uuid: 'r1', ts: '2026-10-08T10:00:02.000Z', toolUseId: 'tu1', agentId: 'ag1' }),
    notification({ uuid: 'q1', ts: '2026-10-08T10:00:20.000Z', toolUseId: 'tu1' }),
  ];
  const subagents = { ag1: { records: SUB_RECORDS, meta: { agentType: 'Explore', description: 'Explore IR', toolUseId: 'tu1' } } };
  const story = buildStory(records, { sessionId: 's1', cwd: '/proj', subagents });
  const agent = story.trace.events.find((e) => e.id === 'tu1');
  assert.equal(agent.kind, 'subagent');
  assert.equal(agent.status, 'ok');
  assert.equal(agent.ended_at, '2026-10-08T10:00:20.000Z');
  assert.equal(agent.duration_ms, 19000);
  assert.equal(agent.ended_source, 'notification');
  assert.equal(agent.agent_id, 'ag1');
  assert.equal(agent.agent_type, 'Explore');
  assert.equal(agent.usage.output_tokens, 7);
  const child = story.trace.events.find((e) => e.id === 'stu1');
  assert.equal(child.kind, 'tool');
  assert.equal(child.parent_id, 'tu1');
  assert.equal(child.agent_id, 'ag1');
  assert.equal(child.turn, 1);
  assert.equal(child.duration_ms, 400);
  assert.equal(story.turns[0].duration_ms, 20000);
  assert.deepEqual(story.environment.models, ['claude-opus-5-5']);
});

test('subagents passed as plain record arrays still work, typed from the Agent call (no meta)', () => {
  const records = [
    { type: 'user', uuid: 'u1', timestamp: '2026-10-08T10:00:00.000Z', message: { role: 'user', content: 'go' } },
    agentLaunch({ uuid: 'a1', ts: '2026-10-08T10:00:01.000Z', id: 'tu1', description: 'Explore IR' }),
    agentAsyncResult({ uuid: 'r1', ts: '2026-10-08T10:00:02.000Z', toolUseId: 'tu1', agentId: 'ag1' }),
  ];
  const story = buildStory(records, { sessionId: 's1', cwd: '/proj', subagents: { ag1: SUB_RECORDS } });
  const agent = story.trace.events.find((e) => e.id === 'tu1');
  assert.equal(agent.agent_type, 'Explore');
  assert.equal(agent.status, 'unknown');
  assert.equal(agent.ended_at, '2026-10-08T10:00:04.400Z');
  assert.equal(agent.ended_source, 'subagent_transcript');
});

test('two Agent calls in one turn match notifications by tool-use-id, and a missing sidechain file leaves no children', () => {
  const records = [
    { type: 'user', uuid: 'u1', timestamp: '2026-10-08T10:00:00.000Z', message: { role: 'user', content: 'go' } },
    agentLaunch({ uuid: 'a1', ts: '2026-10-08T10:00:01.000Z', id: 'tu1', description: 'first' }),
    agentLaunch({ uuid: 'a2', ts: '2026-10-08T10:00:01.500Z', id: 'tu2', description: 'second' }),
    agentAsyncResult({ uuid: 'r1', ts: '2026-10-08T10:00:02.000Z', toolUseId: 'tu1', agentId: 'ag1' }),
    agentAsyncResult({ uuid: 'r2', ts: '2026-10-08T10:00:02.500Z', toolUseId: 'tu2', agentId: 'ag-missing' }),
    notification({ uuid: 'q2', ts: '2026-10-08T10:00:10.000Z', toolUseId: 'tu2', status: 'failed' }),
    notification({ uuid: 'q1', ts: '2026-10-08T10:00:20.000Z', toolUseId: 'tu1' }),
  ];
  const story = buildStory(records, { sessionId: 's1', cwd: '/proj', subagents: { ag1: SUB_RECORDS } });
  const first = story.trace.events.find((e) => e.id === 'tu1');
  const second = story.trace.events.find((e) => e.id === 'tu2');
  assert.equal(first.status, 'ok');
  assert.equal(first.ended_at, '2026-10-08T10:00:20.000Z');
  assert.equal(second.status, 'error');
  assert.equal(second.ended_at, '2026-10-08T10:00:10.000Z');
  assert.equal(second.usage, null);
  assert.equal(story.trace.events.filter((e) => e.parent_id === 'tu2').length, 0);
  assert.equal(story.trace.events.filter((e) => e.parent_id === 'tu1').length, 1);
});

test('a task notification embedded in a real prompt still closes its agent and the prompt is still a turn', () => {
  const records = [
    { type: 'user', uuid: 'u1', timestamp: '2026-10-08T10:00:00.000Z', message: { role: 'user', content: 'go' } },
    agentLaunch({ uuid: 'a1', ts: '2026-10-08T10:00:01.000Z', id: 'tu1', description: 'first' }),
    agentAsyncResult({ uuid: 'r1', ts: '2026-10-08T10:00:02.000Z', toolUseId: 'tu1', agentId: 'ag1' }),
    { type: 'user', uuid: 'u2', timestamp: '2026-10-08T10:00:30.000Z', message: { role: 'user',
      content: '<task-notification><tool-use-id>tu1</tool-use-id><status>completed</status></task-notification>now continue' } },
  ];
  const story = buildStory(records, { sessionId: 's1', cwd: '/proj', subagents: {} });
  assert.equal(story.turns.length, 2);
  assert.equal(story.turns[1].prompt, 'now continue');
  const agent = story.trace.events.find((e) => e.id === 'tu1');
  assert.equal(agent.status, 'ok');
  assert.equal(agent.ended_at, '2026-10-08T10:00:30.000Z');
});

test('a synchronous Agent result closes the subagent event from the result itself', () => {
  const records = [
    { type: 'user', uuid: 'u1', timestamp: '2026-10-08T10:00:00.000Z', message: { role: 'user', content: 'go' } },
    agentLaunch({ uuid: 'a1', ts: '2026-10-08T10:00:01.000Z', id: 'tu1', description: 'first' }),
    userRecord({ uuid: 'r1', ts: '2026-10-08T10:00:12.000Z', toolUseId: 'tu1', content: { agentId: 'ag1', content: [{ type: 'text', text: 'done' }] } }),
  ];
  const story = buildStory(records, { sessionId: 's1', cwd: '/proj', subagents: { ag1: SUB_RECORDS } });
  const agent = story.trace.events.find((e) => e.id === 'tu1');
  assert.equal(agent.status, 'ok');
  assert.equal(agent.ended_source, 'result');
  assert.equal(agent.duration_ms, 11000);
});

test("keeps Claude's text replies on the turn, in order, skipping thinking, empty text and subagent records", () => {
  const records = [
    { type: 'user', uuid: 'u1', timestamp: '2026-09-10T10:00:00.000Z', message: { role: 'user', content: 'Add a title prop' } },
    { type: 'assistant', uuid: 'a1', timestamp: '2026-09-10T10:00:01.000Z', message: { role: 'assistant', content: [
      { type: 'thinking', thinking: 'private reasoning' },
      { type: 'text', text: "  I'll look at Panel first.  " },
      { type: 'tool_use', id: 't1', name: 'Read', input: { file_path: '/proj/Panel.tsx' } },
    ] } },
    { type: 'assistant', uuid: 'a2', timestamp: '2026-09-10T10:00:02.000Z', isSidechain: true, message: { role: 'assistant', content: [
      { type: 'text', text: 'subagent chatter' },
    ] } },
    { type: 'assistant', uuid: 'a3', timestamp: '2026-09-10T10:00:03.000Z', message: { role: 'assistant', content: [
      { type: 'text', text: '   ' },
      { type: 'text', text: 'Done. The prop is added.' },
    ] } },
    { type: 'user', uuid: 'u2', timestamp: '2026-09-10T10:01:00.000Z', message: { role: 'user', content: 'Thanks' } },
  ];

  const story = buildStory(records, { sessionId: 's1' });

  assert.deepEqual(story.turns[0].replies, [
    { at: '2026-09-10T10:00:01.000Z', text: "I'll look at Panel first." },
    { at: '2026-09-10T10:00:03.000Z', text: 'Done. The prop is added.' },
  ]);
  assert.deepEqual(story.turns[1].replies, []);
});

const prompt = (uuid, ts, content) => ({ type: 'user', uuid, timestamp: ts, message: { role: 'user', content } });
const skillBody = (uuid, ts, name) => ({
  type: 'user', uuid, timestamp: ts, isMeta: true,
  message: { role: 'user', content: [{ type: 'text', text: `Base directory for this skill: /skills/${name}\n\n# ${name}` }] },
});

test('a turn lists the skills it loaded through the Skill tool and through slash commands, not built-in commands', () => {
  const records = [
    prompt('u1', '2026-10-08T10:00:00.000Z', 'plan the feature'),
    assistantTool({ uuid: 'a1', ts: '2026-10-08T10:00:01.000Z', id: 'tu1', name: 'Skill', input: { skill: 'superpowers:brainstorming' } }),
    userRecord({ uuid: 'r1', ts: '2026-10-08T10:00:02.000Z', toolUseId: 'tu1', content: 'loaded' }),
    assistantTool({ uuid: 'a2', ts: '2026-10-08T10:00:03.000Z', id: 'tu2', name: 'Skill', input: { skill: 'superpowers:brainstorming' } }),
    prompt('u2', '2026-10-08T10:01:00.000Z', '<command-message>session-story</command-message>\n<command-name>/session-story</command-name>\n<command-args>for the team</command-args>'),
    skillBody('m2', '2026-10-08T10:01:00.100Z', 'session-story'),
    prompt('u3', '2026-10-08T10:02:00.000Z', 'thanks'),
    prompt('c3', '2026-10-08T10:02:30.000Z', '<command-name>/model</command-name>\n<command-message>model</command-message>\n<command-args></command-args>'),
    prompt('o3', '2026-10-08T10:02:30.100Z', '<local-command-stdout>Set model to Opus</local-command-stdout>'),
  ];
  const story = buildStory(records, { sessionId: 's1', cwd: '/proj' });
  // A slash command is not a turn of its own (its tags are stripped), so its
  // skill lands on the turn its work is credited to.
  assert.deepEqual(story.turns.map((t) => t.skills), [['superpowers:brainstorming', 'session-story'], []]);
});

test('a slash-command skill run without arguments is listed on the turn its work lands in', () => {
  const records = [
    prompt('u1', '2026-10-08T10:00:00.000Z', 'fix it'),
    prompt('c1', '2026-10-08T10:05:00.000Z', '<command-message>session-story</command-message>\n<command-name>/session-story</command-name>'),
    skillBody('m1', '2026-10-08T10:05:00.100Z', 'session-story'),
  ];
  const story = buildStory(records, { sessionId: 's1', cwd: '/proj' });
  assert.equal(story.turns.length, 1);
  assert.deepEqual(story.turns[0].skills, ['session-story']);
});

test('a legacy Task call is a subagent typed from its subagent_type, and its Skill calls land on the spawning turn', () => {
  const sub = [
    { type: 'user', uuid: 'su1', isSidechain: true, timestamp: '2026-10-08T10:00:03.000Z', message: { role: 'user', content: 'look' } },
    { type: 'assistant', uuid: 'sa1', isSidechain: true, timestamp: '2026-10-08T10:00:04.000Z',
      message: { id: 'sm1', role: 'assistant', usage: { input_tokens: 5, output_tokens: 7 }, content: [{ type: 'tool_use', id: 'stu1', name: 'Skill', input: { skill: 'frontend-design' } }] } },
  ];
  const records = [
    prompt('u1', '2026-10-08T10:00:00.000Z', 'go'),
    assistantTool({ uuid: 'a1', ts: '2026-10-08T10:00:01.000Z', id: 'tu1', name: 'Task', input: { description: 'Look around', prompt: 'p', subagent_type: 'general-purpose' } }),
    userRecord({ uuid: 'r1', ts: '2026-10-08T10:00:05.000Z', toolUseId: 'tu1', content: { agentId: 'ag1', status: 'completed' } }),
  ];
  const story = buildStory(records, { sessionId: 's1', cwd: '/proj', subagents: { ag1: sub } });
  const agent = story.trace.events.find((e) => e.id === 'tu1');
  assert.equal(agent.kind, 'subagent');
  assert.equal(agent.agent_type, 'general-purpose');
  assert.equal(agent.summary, 'Look around');
  assert.equal(agent.usage.output_tokens, 7);
  assert.deepEqual(story.turns[0].skills, ['frontend-design']);
});

test('a subagent transcript that replays a main-thread API call does not count its usage twice', () => {
  const replayed = { type: 'assistant', uuid: 'sa0', isSidechain: true, timestamp: '2026-10-08T10:00:02.500Z',
    message: { id: 'msg_main', role: 'assistant', usage: { input_tokens: 9, output_tokens: 100 }, content: [{ type: 'text', text: 'earlier' }] } };
  const records = [
    prompt('u1', '2026-10-08T10:00:00.000Z', 'go'),
    { ...assistantTool({ uuid: 'a1', ts: '2026-10-08T10:00:01.000Z', id: 'tu1', name: 'Agent', input: { description: 'd', prompt: 'p' } }),
      message: { id: 'msg_main', role: 'assistant', usage: { input_tokens: 9, output_tokens: 100 }, content: [{ type: 'tool_use', id: 'tu1', name: 'Agent', input: { description: 'd', prompt: 'p' } }] } },
    userRecord({ uuid: 'r1', ts: '2026-10-08T10:00:05.000Z', toolUseId: 'tu1', content: { agentId: 'ag1', status: 'completed' } }),
  ];
  const story = buildStory(records, { sessionId: 's1', cwd: '/proj', subagents: { ag1: [replayed, ...SUB_RECORDS.slice(1)] } });
  const agent = story.trace.events.find((e) => e.id === 'tu1');
  assert.equal(story.turns[0].usage.output_tokens, 100);
  assert.equal(agent.usage.output_tokens, 7);
  assert.equal(agent.usage.api_calls, 1);
});

test('session.active_ms leaves out idle gaps over five minutes and counts subagent records', () => {
  const records = [
    prompt('u1', '2026-10-08T10:00:00.000Z', 'go'),
    { type: 'assistant', uuid: 'a1', timestamp: '2026-10-08T10:02:00.000Z', message: { role: 'assistant', content: [{ type: 'text', text: 'ok' }] } },
    prompt('u2', '2026-10-08T12:00:00.000Z', 'again'),
    { type: 'assistant', uuid: 'a2', timestamp: '2026-10-08T12:01:00.000Z', message: { role: 'assistant', content: [{ type: 'text', text: 'ok' }] } },
  ];
  const sub = [{ type: 'assistant', uuid: 's1', timestamp: '2026-10-08T12:04:00.000Z', message: { role: 'assistant', content: [] } }];
  const story = buildStory(records, { sessionId: 's1', cwd: '/proj', subagents: { ag1: { records: sub, meta: null } } });
  assert.equal(story.session.duration_ms, 2 * 3600000 + 60000);
  assert.equal(story.session.active_ms, 2 * 60000 + 4 * 60000);
});
