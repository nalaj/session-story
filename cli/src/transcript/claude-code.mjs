/**
 * Adapter: Claude Code transcript records -> Story IR.
 * See docs/superpowers/specs/2026-09-10-session-story-design.md for the
 * record shapes this relies on and the IR shape it produces.
 */

import { relativeTo, isOutsideRel } from './paths.mjs';
import { crossIndexFiles } from '../ir/cross-index.mjs';
import { classifyCommand, parseExitCode, isRejection } from '../ir/commands.mjs';
import {
  newEvent, finishEvent, resultStatus, eventSummary, sortEvents, turnDuration,
  newUsageAcc, noteUsage, usageTotals, pickCostState, parseTaskNotifications, msBetween, activeMs,
} from '../ir/trace.mjs';

// Wrapper tags the harness injects into user-role records. None of this text
// was typed by the human, so it is stripped before a record is considered a
// prompt. A record made up entirely of these blocks is not a turn at all.
const SYNTHETIC_TAGS = [
  'local-command-caveat',
  'command-message',
  'command-name',
  'command-args',
  'local-command-stdout',
  'local-command-stderr',
  'system-reminder',
  'task-notification',
  'user-prompt-submit-hook',
];
const TAG_ALTERNATION = SYNTHETIC_TAGS.join('|');
// Balanced <tag>...</tag> spans, non-greedy, newlines included.
const SYNTHETIC_BLOCK = new RegExp(`<(${TAG_ALTERNATION})>[\\s\\S]*?</\\1>`, 'g');
// An unbalanced opening tag (truncated injection): drop it and everything after.
const SYNTHETIC_TAIL = new RegExp(`<(${TAG_ALTERNATION})>[\\s\\S]*$`);

const FILE_EDIT_TOOLS = new Set(['Edit', 'Write', 'NotebookEdit']);
// Older Claude Code versions named the subagent tool `Task`.
const AGENT_TOOLS = new Set(['Agent', 'Task']);
const SKILL_TOOL = 'Skill';
// A slash command that loads a skill is followed by a meta record carrying
// the skill's text; a built-in command (/model, /clear) is not.
const SKILL_BODY_PREFIX = 'Base directory for this skill';
const COMMAND_NAME = /<command-name>\/?([^<]+)<\/command-name>/;
// Bash results carry no diff, so a shell-driven change cannot be read out
// of the transcript. The commands are kept per turn anyway: git can supply
// the diff later, and the commands say which turn to credit it to
// (src/ir/git-edits.mjs).
const BASH_TOOL = 'Bash';
const PLAN_TOOL = 'ExitPlanMode';

/** Remove harness-injected wrapper blocks, leaving only human-authored text. */
function stripSyntheticBlocks(text) {
  return text.replace(SYNTHETIC_BLOCK, '').replace(SYNTHETIC_TAIL, '').trim();
}

function isRealUserPrompt(record) {
  if (record.type !== 'user') return false;
  // Record-level flags the harness sets on non-human turns.
  if (record.isMeta || record.isCompactSummary || record.isSidechain) return false;
  if (record.isVisibleInTranscript === false) return false;
  if (record.toolUseResult !== undefined) return false;
  const content = record.message && record.message.content;
  if (typeof content !== 'string') return false;
  return stripSyntheticBlocks(content) !== '';
}

function toolUseCalls(record) {
  if (record.type !== 'assistant') return [];
  const content = record.message && record.message.content;
  if (!Array.isArray(content)) return [];
  return content.filter((block) => block.type === 'tool_use' && FILE_EDIT_TOOLS.has(block.name));
}

/**
 * A Bash tool_use turned into a turn's bash entry, before its result
 * arrives. `category` is knowable from the command text alone; the rest
 * (`ok`, `exit_code`, `output_tail`, ...) is filled in by `finishBash` once
 * the tool_result shows up (see `pendingBash` in `buildStory`).
 */
function bashCalls(record) {
  if (record.type !== 'assistant') return [];
  const content = record.message && record.message.content;
  if (!Array.isArray(content)) return [];
  return content
    .filter((block) => block.type === 'tool_use' && block.name === BASH_TOOL)
    .map((block) => {
      const command = (block.input && block.input.command) || '';
      return {
        id: block.id,
        command,
        description: (block.input && block.input.description) || '',
        at: record.timestamp || null,
        category: classifyCommand(command),
        ok: null,
        exit_code: null,
        rejected: false,
        interrupted: false,
        output_tail: '',
      };
    });
}

/**
 * Claude's own words in a main-thread assistant record: its non-empty text
 * blocks, trimmed. Thinking blocks and subagent (sidechain) records are left
 * out; the turn panel shows what Claude told the user.
 */
function assistantTexts(record) {
  if (record.type !== 'assistant' || record.isSidechain) return [];
  const content = record.message && record.message.content;
  if (!Array.isArray(content)) return [];
  return content
    .filter((block) => block.type === 'text' && typeof block.text === 'string')
    .map((block) => block.text.trim())
    .filter((text) => text !== '');
}

/** Every tool_use block in a record, regardless of which tool it names. */
function allToolUseCalls(record) {
  if (record.type !== 'assistant') return [];
  const content = record.message && record.message.content;
  if (!Array.isArray(content)) return [];
  return content.filter((block) => block.type === 'tool_use');
}

function agentToolUseCalls(record) {
  if (record.type !== 'assistant') return [];
  const content = record.message && record.message.content;
  if (!Array.isArray(content)) return [];
  return content.filter((block) => block.type === 'tool_use' && AGENT_TOOLS.has(block.name));
}

/** The skill a Skill tool_use loaded, or null for any other block. */
function skillName(block) {
  if (block.name !== SKILL_TOOL || !block.input || typeof block.input.skill !== 'string') return null;
  return block.input.skill.trim() || null;
}

/** Add a skill to a turn's list once, in first-use order. */
function addSkill(turn, name) {
  if (turn && name && !turn.skills.includes(name)) turn.skills.push(name);
}

/** The slash command a user record ran (without its slash), or null. */
function commandName(record) {
  if (record.type !== 'user' || record.isMeta) return null;
  const content = record.message && record.message.content;
  if (typeof content !== 'string') return null;
  const match = COMMAND_NAME.exec(content);
  return match ? match[1].trim() || null : null;
}

/** True for the meta record that carries a loaded skill's text. */
function isSkillBody(record) {
  if (record.type !== 'user' || !record.isMeta) return false;
  const content = record.message && record.message.content;
  const text = typeof content === 'string'
    ? content
    : (Array.isArray(content) && content[0] && content[0].type === 'text' ? content[0].text : '');
  return typeof text === 'string' && text.startsWith(SKILL_BODY_PREFIX);
}

/** The last `limit` characters of a result's text, or '' when there is none. */
function tail(text, limit = 1500) {
  if (typeof text !== 'string') return '';
  return text.length > limit ? text.slice(-limit) : text;
}

/**
 * Fill in a bash entry (created by `bashCalls`) once its tool_result has
 * arrived: whether it succeeded, its exit code (when the transcript prints
 * one), and a tail of its combined output for the page to show on failure.
 */
function finishBash(entry, isError, toolUseResult, block) {
  entry.ok = !isError;
  entry.rejected = isRejection(toolUseResult);
  if (toolUseResult && typeof toolUseResult === 'object') {
    const text = `${toolUseResult.stdout || ''}${toolUseResult.stderr || ''}`;
    entry.output_tail = tail(text);
    entry.exit_code = parseExitCode(text);
    entry.interrupted = !!toolUseResult.interrupted;
  } else if (typeof toolUseResult === 'string') {
    entry.output_tail = tail(toolUseResult);
    entry.exit_code = parseExitCode(toolUseResult);
  } else {
    const text = typeof (block && block.content) === 'string' ? block.content : '';
    entry.output_tail = tail(text);
    entry.exit_code = parseExitCode(text);
  }
}

/** Strip the harness's `<tool_use_error>` wrapper and cap the length. */
function errorMessage(block, toolUseResult) {
  let raw;
  if (typeof toolUseResult === 'string') raw = toolUseResult;
  else if (block && typeof block.content === 'string') raw = block.content;
  else raw = JSON.stringify((block && block.content) || '');
  raw = raw.replace(/<\/?tool_use_error>/g, '').trim();
  return raw.length > 400 ? raw.slice(0, 400) : raw;
}

/** What an errored tool call was acting on, for the turn's error list. */
function errorTarget(name, input, cwd) {
  if (!input) return null;
  if (FILE_EDIT_TOOLS.has(name)) return relativePath(input.file_path, cwd);
  if (name === BASH_TOOL) return input.command || null;
  return input.file_path || input.command || input.pattern || input.query || null;
}

/** Record an errored or rejected tool result onto its turn's error list. */
function pushError(turnRef, { id, tool, at, toolUseResult, block, target }) {
  if (!turnRef) return;
  turnRef.errors.push({
    id,
    tool,
    at,
    kind: isRejection(toolUseResult) ? 'rejected' : 'error',
    target: target || null,
    message: errorMessage(block, toolUseResult),
    resolution: null,
  });
}

/**
 * Extract file edits, commands, errors, trace events and token usage from a
 * subagent's own flat record stream (no turns: a subagent's records form one
 * sequence, all attributed to the turn that spawned it). Its tool events
 * point at the Agent tool_use that launched it through `parent_id`.
 */
function extractSubagent(subRecords, cwd, agentId, { parentId = null, turnIndex = null, mainMessageIds = null } = {}) {
  const edits = [];
  const skills = [];
  const bash = [];
  const errors = [];
  const events = [];
  const pending = new Map();
  const pendingBash = new Map();
  const pendingAny = new Map();
  const pendingEvents = new Map();
  const usage = newUsageAcc();
  // A container with an `errors` array so pushError can treat it exactly
  // like a turn; the entries end up on the spawning turn's own list.
  const errorSink = { errors };

  for (const record of subRecords) {
    // A forked subagent's transcript can replay main-thread records; their
    // usage is already counted on the turn.
    noteUsage(usage, record, mainMessageIds);
    for (const block of allToolUseCalls(record)) {
      const skill = skillName(block);
      if (skill && !skills.includes(skill)) skills.push(skill);
      pendingAny.set(block.id, { name: block.name, input: block.input });
      const command = block.name === BASH_TOOL ? ((block.input && block.input.command) || '') : null;
      const event = newEvent({
        id: block.id,
        kind: 'tool',
        turn: turnIndex,
        parentId,
        tool: block.name,
        category: command === null ? null : classifyCommand(command),
        summary: eventSummary(block.name, block.input, cwd),
        startedAt: record.timestamp || null,
        agentId,
      });
      events.push(event);
      pendingEvents.set(block.id, event);
    }

    const shell = bashCalls(record);
    for (const entry of shell) {
      entry.by_subagent = agentId;
      bash.push(entry);
      pendingBash.set(entry.id, entry);
    }

    const calls = toolUseCalls(record);
    for (const call of calls) {
      const edit = newEdit(call, cwd, agentId);
      edits.push(edit);
      pending.set(call.id, edit);
    }

    const toolResult = toolResultFor(record);
    if (!toolResult) continue;

    const event = pendingEvents.get(toolResult.toolUseId);
    if (event) {
      finishEvent(event, record.timestamp || null, resultStatus(toolResult.isError, toolResult.result));
      pendingEvents.delete(toolResult.toolUseId);
    }

    const info = pendingAny.get(toolResult.toolUseId);
    if (toolResult.isError && info) {
      pushError(errorSink, {
        id: toolResult.toolUseId,
        tool: info.name,
        at: record.timestamp || null,
        toolUseResult: toolResult.result,
        block: toolResult.block,
        target: errorTarget(info.name, info.input, cwd),
      });
    }
    pendingAny.delete(toolResult.toolUseId);

    if (pendingBash.has(toolResult.toolUseId)) {
      finishBash(pendingBash.get(toolResult.toolUseId), toolResult.isError, toolResult.result, toolResult.block);
      pendingBash.delete(toolResult.toolUseId);
    }

    if (pending.has(toolResult.toolUseId)) {
      const edit = pending.get(toolResult.toolUseId);
      if (toolResult.isError) {
        edit.result = 'error';
        edit.error = errorMessage(toolResult.block, toolResult.result);
      } else {
        const r = toolResult.result || {};
        edit.kind = r.type || null;
        captureFileContent(edit, r);
        const hunks = r.type === 'create'
          ? synthesizeCreateHunk(r.content || '')
          : (r.structuredPatch || []);
        edit.result = 'ok';
        edit.hunks = hunks;
        edit.stats = hunkStats(hunks);
      }
      pending.delete(toolResult.toolUseId);
    }
  }

  return { edits, bash, errors, events, skills, usage: usageTotals(usage), last_at: latestTimestamp(subRecords, null) };
}

function toolResultFor(record) {
  if (record.type !== 'user') return null;
  const content = record.message && record.message.content;
  if (!Array.isArray(content)) return null;
  const resultBlock = content.find((block) => block.type === 'tool_result');
  if (!resultBlock) return null;
  return {
    toolUseId: resultBlock.tool_use_id,
    result: record.toolUseResult,
    block: resultBlock,
    isError: !!resultBlock.is_error,
  };
}

function synthesizeCreateHunk(content) {
  const lines = content.replace(/\n$/, '').split('\n');
  if (lines.length === 1 && lines[0] === '') return [];
  return [{
    oldStart: 0,
    oldLines: 0,
    newStart: 1,
    newLines: lines.length,
    lines: lines.map((l) => `+${l}`),
  }];
}

function hunkStats(hunks) {
  let added = 0;
  let removed = 0;
  for (const hunk of hunks) {
    for (const line of hunk.lines) {
      if (line.startsWith('+')) added++;
      else if (line.startsWith('-')) removed++;
    }
  }
  return { added, removed };
}

function relativePath(filePath, cwd) {
  return relativeTo(filePath, cwd);
}

/**
 * True when the edited file lives outside the session's project directory
 * (a scratchpad or temp file, whose relative path climbs out of the repo).
 */
function isOutsideCwd(rel) {
  return isOutsideRel(rel);
}

/** The edit record as it stands before its tool result arrives. */
function newEdit(call, cwd, agentId) {
  const rel = relativePath(call.input.file_path, cwd);
  const edit = {
    id: call.id,
    tool: call.name,
    file: call.input.file_path,
    rel,
    outside_cwd: isOutsideCwd(rel),
    kind: null,
    result: 'unknown',
    error: null,
    hunks: [],
    stats: { added: 0, removed: 0 },
    before: null,
    after: null,
    old_string: null,
    new_string: null,
    replace_all: false,
  };
  if (agentId) edit.by_subagent = agentId;
  return edit;
}

/**
 * Record whatever full file content and replacement strings the tool result
 * carried, so the renderer can rebuild the whole file around the hunks.
 */
function captureFileContent(edit, result) {
  if (typeof result.originalFile === 'string') edit.before = result.originalFile;
  if (typeof result.content === 'string') edit.after = result.content;
  if (result.type === 'create' && edit.before === null) edit.before = '';
  if (typeof result.oldString === 'string') {
    edit.old_string = result.oldString;
    edit.new_string = typeof result.newString === 'string' ? result.newString : '';
    edit.replace_all = !!result.replaceAll;
  }
}

export function buildStory(records, { sessionId, cwd, subagents } = {}) {
  const turns = [];
  // toolUseId -> edit, for edits whose result hasn't arrived yet
  const pending = new Map();
  const pendingAgents = new Map(); // agent tool_use id -> spawning turn
  const pendingBash = new Map(); // bash tool_use id -> its bash entry
  const pendingPlan = new Map(); // ExitPlanMode tool_use id -> { turnRef, text, file }
  // Every tool_use id -> { name, input }, so an is_error result of any kind
  // (not just edits and bash) can be recorded on the turn it happened in.
  const pendingAny = new Map();
  const events = [];
  // tool_use id -> its trace event, until the tool_result arrives
  const pendingEvents = new Map();
  const harnessMs = new Map(); // turn index -> summed system/turn_duration ms
  const lastEnded = new Map(); // turn index -> latest ended_at among its events
  const promptEvents = new Map(); // turn index -> its prompt event
  // Agent tool_use id -> its subagent event, while a background agent runs
  const awaitingAgents = new Map();
  const usageAcc = new Map(); // turn index -> usage accumulator
  const costStates = [];
  const models = new Set();
  let version = null;
  let currentTurn = null;
  // A slash command waiting for its skill text, which says it loaded a skill.
  let pendingCommand = null;
  // Every main-thread API call, so a subagent replaying one is not counted twice.
  const mainMessageIds = new Set();
  for (const record of records) {
    if (record.type === 'assistant' && record.message && typeof record.message.id === 'string') {
      mainMessageIds.add(record.message.id);
    }
  }

  function noteEnd(event) {
    if (!event.ended_at) return;
    const prev = lastEnded.get(event.turn);
    if (!prev || Date.parse(event.ended_at) > Date.parse(prev)) lastEnded.set(event.turn, event.ended_at);
  }

  // Settle a turn's duration once no more of its records can arrive.
  function closeTurn(turn) {
    if (!turn) return;
    const { duration_ms, duration_source } = turnDuration({
      harnessMs: harnessMs.get(turn.index),
      promptAt: turn.at,
      lastEndedAt: lastEnded.get(turn.index) || null,
    });
    turn.duration_ms = duration_ms;
    turn.duration_source = duration_source;
    turn.usage = usageAcc.has(turn.index) ? usageTotals(usageAcc.get(turn.index)) : null;
    const prompt = promptEvents.get(turn.index);
    if (prompt) {
      prompt.ended_at = lastEnded.get(turn.index) || null;
      prompt.duration_ms = duration_ms;
    }
  }
  let gitBranch = null;
  // The harness writes an `ai-title` record whenever it (re)names the session;
  // the last one is the current name, and the header falls back to it when
  // Claude has not written a title of its own.
  let aiTitle = null;

  for (const record of records) {
    if (gitBranch === null && typeof record.gitBranch === 'string' && record.gitBranch) {
      gitBranch = record.gitBranch;
    }

    if (record.type === 'ai-title' && typeof record.aiTitle === 'string' && record.aiTitle.trim()) {
      aiTitle = record.aiTitle.trim();
      continue;
    }

    if (typeof record.version === 'string' && record.version) version = record.version;
    if (record.type === 'cost-state') {
      costStates.push(pickCostState(record));
      continue;
    }
    if (record.type === 'assistant') {
      if (record.message && typeof record.message.model === 'string') models.add(record.message.model);
      if (currentTurn) {
        if (!usageAcc.has(currentTurn.index)) usageAcc.set(currentTurn.index, newUsageAcc());
        noteUsage(usageAcc.get(currentTurn.index), record);
        for (const text of assistantTexts(record)) {
          currentTurn.replies.push({ at: record.timestamp || null, text });
        }
      }
    }

    // A background agent's completion arrives later as a <task-notification>
    // block, in a queue-operation record or folded into a user record.
    const notificationText = record.type === 'queue-operation'
      ? record.content
      : (record.type === 'user' && record.message && typeof record.message.content === 'string'
        ? record.message.content
        : null);
    for (const note of parseTaskNotifications(notificationText)) {
      const agentEvent = awaitingAgents.get(note.toolUseId);
      if (!agentEvent) continue;
      finishEvent(agentEvent, record.timestamp || null, note.status === 'completed' ? 'ok' : 'error');
      agentEvent.ended_source = 'notification';
      noteEnd(agentEvent);
    }
    if (record.type === 'queue-operation') continue;

    // The harness reports how long the agent worked on a turn. A turn can
    // carry several (a background agent's notification absorbed mid-turn).
    if (record.type === 'system' && record.subtype === 'turn_duration') {
      if (currentTurn && Number.isFinite(record.durationMs)) {
        harnessMs.set(currentTurn.index, (harnessMs.get(currentTurn.index) || 0) + record.durationMs);
      }
      continue;
    }

    if (isSkillBody(record)) {
      if (pendingCommand) addSkill(currentTurn, pendingCommand);
      pendingCommand = null;
      continue;
    }
    if (record.type === 'user' && !record.isMeta && typeof (record.message && record.message.content) === 'string') {
      pendingCommand = commandName(record);
    }

    if (isRealUserPrompt(record)) {
      closeTurn(currentTurn);
      currentTurn = {
        index: turns.length + 1,
        id: record.uuid,
        at: record.timestamp,
        prompt: stripSyntheticBlocks(record.message.content),
        summary: '',
        replies: [],
        edits: [],
        bash: [],
        errors: [],
        skills: [],
        plan: null,
        duration_ms: null,
        duration_source: 'unknown',
        usage: null,
      };
      turns.push(currentTurn);
      const promptEvent = newEvent({
        id: record.uuid,
        kind: 'prompt',
        turn: currentTurn.index,
        summary: currentTurn.prompt.length > 200 ? currentTurn.prompt.slice(0, 200) : currentTurn.prompt,
        startedAt: record.timestamp || null,
      });
      events.push(promptEvent);
      promptEvents.set(currentTurn.index, promptEvent);
      continue;
    }

    for (const block of allToolUseCalls(record)) {
      if (!currentTurn) continue;
      addSkill(currentTurn, skillName(block));
      pendingAny.set(block.id, { name: block.name, input: block.input, turnRef: currentTurn });
      const command = block.name === BASH_TOOL ? ((block.input && block.input.command) || '') : null;
      const event = newEvent({
        id: block.id,
        kind: AGENT_TOOLS.has(block.name) ? 'subagent' : 'tool',
        turn: currentTurn.index,
        tool: block.name,
        category: command === null ? null : classifyCommand(command),
        summary: eventSummary(block.name, block.input, cwd),
        startedAt: record.timestamp || null,
      });
      events.push(event);
      pendingEvents.set(block.id, event);
    }

    const shell = bashCalls(record);
    if (shell.length > 0 && currentTurn) {
      currentTurn.bash.push(...shell);
      for (const entry of shell) pendingBash.set(entry.id, entry);
    }

    const agentCalls = agentToolUseCalls(record);
    if (agentCalls.length > 0 && currentTurn) {
      for (const call of agentCalls) {
        pendingAgents.set(call.id, currentTurn);
      }
    }

    if (currentTurn) {
      const content = record.message && record.message.content;
      const planCalls = Array.isArray(content)
        ? content.filter((block) => block.type === 'tool_use' && block.name === PLAN_TOOL)
        : [];
      for (const call of planCalls) {
        pendingPlan.set(call.id, {
          turnRef: currentTurn,
          text: (call.input && call.input.plan) || '',
          file: (call.input && call.input.planFilePath) || null,
        });
      }
    }

    const calls = toolUseCalls(record);
    if (calls.length > 0 && currentTurn) {
      for (const call of calls) {
        const edit = newEdit(call, cwd, null);
        currentTurn.edits.push(edit);
        pending.set(call.id, edit);
      }
      continue;
    }

    const toolResult = toolResultFor(record);
    if (!toolResult) continue;

    const event = pendingEvents.get(toolResult.toolUseId);
    if (event) {
      const r = toolResult.result;
      if (event.kind === 'subagent') {
        const spawn = pendingAny.get(toolResult.toolUseId);
        event.agent_id = (r && typeof r === 'object' && r.agentId) || null;
        event.agent_type = requestedAgentType(spawn);
        event.usage = null;
        event.ended_source = null;
        if (r && typeof r === 'object' && r.isAsync) {
          // Launched in the background: it ends when its notification arrives.
          awaitingAgents.set(event.id, event);
        } else {
          finishEvent(event, record.timestamp || null, resultStatus(toolResult.isError, r));
          event.ended_source = 'result';
          noteEnd(event);
        }
      } else {
        finishEvent(event, record.timestamp || null, resultStatus(toolResult.isError, r));
        noteEnd(event);
      }
      pendingEvents.delete(toolResult.toolUseId);
    }

    const info = pendingAny.get(toolResult.toolUseId);
    if (toolResult.isError && info) {
      pushError(info.turnRef, {
        id: toolResult.toolUseId,
        tool: info.name,
        at: record.timestamp || null,
        toolUseResult: toolResult.result,
        block: toolResult.block,
        target: errorTarget(info.name, info.input, cwd),
      });
    }
    pendingAny.delete(toolResult.toolUseId);

    if (pendingPlan.has(toolResult.toolUseId)) {
      const p = pendingPlan.get(toolResult.toolUseId);
      p.turnRef.plan = { text: p.text, approved: !toolResult.isError, file: p.file };
      pendingPlan.delete(toolResult.toolUseId);
    }

    if (pendingAgents.has(toolResult.toolUseId)) {
      const spawningTurn = pendingAgents.get(toolResult.toolUseId);
      const r = toolResult.result || {};
      const agentId = r.agentId;
      // Each subagent is either its record array (older callers) or
      // { records, meta } with the harness's agent-<id>.meta.json.
      const entry = (subagents && subagents[agentId]) || null;
      const subRecords = Array.isArray(entry) ? entry : (entry && entry.records) || [];
      const meta = Array.isArray(entry) ? null : (entry && entry.meta) || null;
      const sub = extractSubagent(subRecords, cwd, agentId, {
        parentId: toolResult.toolUseId,
        turnIndex: spawningTurn.index,
        mainMessageIds,
      });
      spawningTurn.edits.push(...sub.edits);
      for (const skill of sub.skills) addSkill(spawningTurn, skill);
      spawningTurn.bash.push(...sub.bash);
      spawningTurn.errors.push(...sub.errors);
      events.push(...sub.events);
      for (const child of sub.events) noteEnd(child);
      for (const model of (sub.usage && sub.usage.models) || []) models.add(model);
      if (event && event.kind === 'subagent') {
        event.agent_type = (meta && meta.agentType) || requestedAgentType(info);
        event.usage = sub.usage;
        // Until a notification says otherwise, the agent ran at least until
        // its own transcript's last record.
        if (event.ended_at === null && sub.last_at) {
          event.ended_at = sub.last_at;
          event.duration_ms = msBetween(event.started_at, sub.last_at);
          event.ended_source = 'subagent_transcript';
          noteEnd(event);
        }
      }
      pendingAgents.delete(toolResult.toolUseId);
    }

    if (pendingBash.has(toolResult.toolUseId)) {
      finishBash(pendingBash.get(toolResult.toolUseId), toolResult.isError, toolResult.result, toolResult.block);
      pendingBash.delete(toolResult.toolUseId);
    }

    if (pending.has(toolResult.toolUseId)) {
      const edit = pending.get(toolResult.toolUseId);
      if (toolResult.isError) {
        edit.result = 'error';
        edit.error = errorMessage(toolResult.block, toolResult.result);
      } else {
        const r = toolResult.result || {};
        edit.kind = r.type || null;
        captureFileContent(edit, r);
        const hunks = r.type === 'create'
          ? synthesizeCreateHunk(r.content || '')
          : (r.structuredPatch || []);
        edit.result = 'ok';
        edit.hunks = hunks;
        edit.stats = hunkStats(hunks);
      }
      pending.delete(toolResult.toolUseId);
    }
  }

  closeTurn(currentTurn);

  const startedAt = turns.length > 0 ? turns[0].at : null;
  // The session runs until its last record, not its last prompt: a turn that
  // ends in twenty minutes of tool calls is twenty minutes long.
  const endedAt = latestTimestamp(records, startedAt)
    || (turns.length > 0 ? turns[turns.length - 1].at : null);
  const durationMs = startedAt && endedAt
    ? new Date(endedAt).getTime() - new Date(startedAt).getTime()
    : 0;
  const startMs = startedAt ? Date.parse(startedAt) : NaN;
  const stamps = [records, ...Object.values(subagents || {}).map((e) => (Array.isArray(e) ? e : (e && e.records) || []))]
    .flatMap((list) => list.map((r) => r.timestamp))
    .filter((t) => typeof t === 'string' && !(Date.parse(t) < startMs));

  return {
    schema_version: 1,
    session: {
      id: sessionId,
      cwd,
      git_branch: gitBranch,
      title: null,
      ai_title: aiTitle,
      started_at: startedAt,
      ended_at: endedAt,
      duration_ms: durationMs,
      active_ms: activeMs(stamps),
    },
    turns,
    files: crossIndexFiles(turns),
    totals: countTotals(turns),
    report: {
      plan: '',
      decisions: [],
      outcome: null,
      outcome_note: null,
      dependencies: { manifests: [], installs: [], config_files: [] },
      git: null,
    },
    trace: { events: sortEvents(events), cost_states: costStates },
    environment: { agent: { name: 'Claude Code', version }, models: [...models].sort() },
  };
}

/** The subagent_type an Agent call asked for, from its pending tool_use info. */
function requestedAgentType(info) {
  const type = info && info.input && info.input.subagent_type;
  return typeof type === 'string' && type ? type : null;
}

/** The latest parseable `timestamp` across all records, at or after `floor`. */
function latestTimestamp(records, floor) {
  const floorMs = floor ? new Date(floor).getTime() : -Infinity;
  let bestMs = -Infinity;
  let best = null;
  for (const record of records) {
    if (typeof record.timestamp !== 'string') continue;
    const ms = new Date(record.timestamp).getTime();
    if (!Number.isFinite(ms) || ms < floorMs || ms <= bestMs) continue;
    bestMs = ms;
    best = record.timestamp;
  }
  return best;
}

/**
 * Recompute the per-story counts and file cross-index. Passes that add
 * edits after the fact (src/ir/git-edits.mjs) call this so the summary
 * numbers keep matching the turns.
 * @param {object} story - mutated in place
 */
export function refreshDerived(story) {
  story.files = crossIndexFiles(story.turns);
  story.totals = countTotals(story.turns);
  return story;
}

function countTotals(turns) {
  // A `combined_into` edit is one turn's share of a diff another turn
  // already carries (src/ir/git-edits.mjs). It is shown on both turns and
  // counted on neither twice.
  const allEdits = turns.flatMap((t) => t.edits).filter((e) => !e.combined_into);
  const files = new Set(allEdits.map((e) => e.rel));
  return allEdits.reduce(
    (acc, e) => ({
      turns: turns.length,
      files: files.size,
      added: acc.added + e.stats.added,
      removed: acc.removed + e.stats.removed,
      edits: acc.edits + 1,
    }),
    { turns: turns.length, files: files.size, added: 0, removed: 0, edits: 0 }
  );
}
