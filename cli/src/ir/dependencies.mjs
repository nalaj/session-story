/**
 * What a session added, removed, or installed.
 *
 * Three sources, none of which need the transcript to say anything special:
 *   - manifest edits (package.json, requirements.txt, ...): diff the
 *     dependency keys before/after the edit
 *   - bash commands already classified as `install` (src/ir/commands.mjs)
 *   - edits to files that look like project configuration
 */

import path from 'node:path';
import { buildFileBases, applyReplacement } from './file-state.mjs';

const JSON_MANIFESTS = new Map([
  ['package.json', ['dependencies', 'devDependencies', 'peerDependencies', 'optionalDependencies']],
  ['composer.json', ['require', 'require-dev']],
]);

const LINE_MANIFEST_NAMES = new Set(['pyproject.toml', 'Cargo.toml', 'go.mod', 'Gemfile']);
const REQUIREMENTS_RE = /^requirements.*\.txt$/i;

function manifestRule(rel) {
  const base = path.basename(rel);
  if (JSON_MANIFESTS.has(base)) return { kind: 'json', keys: JSON_MANIFESTS.get(base) };
  if (LINE_MANIFEST_NAMES.has(base) || REQUIREMENTS_RE.test(base)) return { kind: 'lines' };
  return null;
}

function safeParseJson(text) {
  if (typeof text !== 'string') return null;
  try {
    return JSON.parse(text);
  } catch {
    return null;
  }
}

/** The edit's full after-text: from the tool result directly, or by
 * replaying its replacement on top of the reconstructed before-text. */
function editAfterText(edit, beforeText) {
  if (typeof edit.after === 'string') return edit.after;
  if (edit.kind === 'delete') return null;
  if (typeof edit.old_string === 'string') {
    return applyReplacement(beforeText, edit.old_string, edit.new_string || '', edit.replace_all);
  }
  return null;
}

function diffJsonDeps(beforeText, afterText, keys, entry) {
  const before = safeParseJson(beforeText) || {};
  const after = safeParseJson(afterText) || {};
  const beforeKeys = new Set();
  const afterKeys = new Set();
  for (const key of keys) {
    for (const dep of Object.keys(before[key] || {})) beforeKeys.add(dep);
    for (const dep of Object.keys(after[key] || {})) afterKeys.add(dep);
  }
  for (const dep of afterKeys) if (!beforeKeys.has(dep)) entry.added.add(dep);
  for (const dep of beforeKeys) if (!afterKeys.has(dep)) entry.removed.add(dep);
}

// A `+`/`-` hunk line that looks like a dependency declaration: a leading
// name token, optionally followed by a version operator or separator.
const DEP_LINE_RE = /^([+-])\s*([A-Za-z0-9_.][A-Za-z0-9_.\-[\]@/]*)\s*(?:==|>=|<=|~=|!=|=|\s|$)/;

function diffLineDeps(hunks, entry) {
  for (const hunk of hunks || []) {
    for (const line of hunk.lines || []) {
      if (line.startsWith('+++') || line.startsWith('---')) continue;
      const match = DEP_LINE_RE.exec(line);
      if (!match) continue;
      const [, sign, name] = match;
      if (!name || name.startsWith('#')) continue;
      if (sign === '+') entry.added.add(name);
      else entry.removed.add(name);
    }
  }
}

const CONFIG_PATTERNS = [
  /\.config\.[jt]s$/i,
  /^\.[a-z0-9]+rc(\.(json|ya?ml|js))?$/i,
  /^tsconfig(\..+)?\.json$/i,
  /^\.env(\..+)?$/i,
  /^Dockerfile(\..+)?$/i,
  /^Makefile$/i,
  /^\.gitignore$/i,
  /^settings.*\.json$/i,
];

function isConfigFile(rel) {
  const base = path.basename(rel);
  if (CONFIG_PATTERNS.some((re) => re.test(base))) return true;
  if (rel.startsWith('.github/') && /\.ya?ml$/i.test(base)) return true;
  // A bare *.toml/*.yaml/*.yml at the project root, not nested, not already
  // one of the manifests above.
  if (path.dirname(rel) === '.' && /\.(toml|ya?ml|yml)$/i.test(base)) return true;
  return false;
}

function sortedArray(set) {
  return [...set].sort();
}

/**
 * @param {object} story - Story IR
 * @returns {{manifests: Array, installs: Array, config_files: Array}}
 */
export function buildDependencies(story) {
  const bases = buildFileBases(story);
  const manifestEntries = new Map(); // rel -> { turns: Set, added: Set, removed: Set }
  const configEntries = new Map(); // rel -> Set(turns)

  for (const turn of story.turns || []) {
    for (const edit of turn.edits || []) {
      if (edit.result === 'error') continue;
      const rel = edit.rel;
      if (!rel) continue;

      const rule = manifestRule(rel);
      if (rule) {
        const entry = manifestEntries.get(rel) || { rel, turns: new Set(), added: new Set(), removed: new Set() };
        entry.turns.add(turn.index);
        if (rule.kind === 'json') {
          const beforeText = typeof edit.before === 'string' ? edit.before : bases.get(edit.id);
          const afterText = editAfterText(edit, beforeText);
          diffJsonDeps(beforeText, afterText, rule.keys, entry);
        } else {
          diffLineDeps(edit.hunks, entry);
        }
        manifestEntries.set(rel, entry);
        continue;
      }

      if (isConfigFile(rel)) {
        const turns = configEntries.get(rel) || new Set();
        turns.add(turn.index);
        configEntries.set(rel, turns);
      }
    }
  }

  const manifests = [...manifestEntries.values()]
    .map((entry) => ({
      rel: entry.rel,
      turns: [...entry.turns].sort((a, b) => a - b),
      added: sortedArray(entry.added),
      removed: sortedArray(entry.removed),
    }))
    .filter((entry) => entry.added.length > 0 || entry.removed.length > 0);

  const installs = [];
  for (const turn of story.turns || []) {
    for (const entry of turn.bash || []) {
      if (entry.category === 'install') {
        installs.push({ turn: turn.index, command: entry.command, ok: entry.ok });
      }
    }
  }

  const config_files = [...configEntries.entries()]
    .map(([rel, turns]) => ({ rel, turns: [...turns].sort((a, b) => a - b) }));

  return { manifests, installs, config_files };
}
