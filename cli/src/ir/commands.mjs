/**
 * Classifying Bash commands recorded in a session, and pulling small facts
 * (exit codes, commit hashes, rejection) out of their tool results.
 *
 * A command is classified segment by segment (split on shell operators) so
 * a compound line like `npm install && npm test` is credited to the more
 * specific thing it did, not the first thing. Priority when a line mixes
 * categories: test > lint > build > install > git > other.
 */

const SEGMENT_SEPARATORS = /&&|\|\||[;|]/;

const CATEGORY_PATTERNS = [
  ['test', [
    /\b(npm|pnpm|yarn|bun)\s+(run\s+)?test\b/,
    /\bnode\s+--test\b/,
    /\bpytest\b/,
    /\bpython[0-9.]*\s+-m\s+(pytest|unittest)\b/,
    /\bcargo\s+test\b/,
    /\bgo\s+test\b/,
    /\b(npx\s+)?jest\b/,
    /\b(npx\s+)?vitest\b/,
    /\b(npx\s+)?mocha\b/,
    /\brspec\b/,
    /\bdotnet\s+test\b/,
  ]],
  ['lint', [
    /\b(npx\s+)?eslint\b/,
    /\b(npx\s+)?prettier\b.*--check\b/,
    /\bruff\b/,
    /\bflake8\b/,
    /\bblack\b.*--check\b/,
    /\bmypy\b/,
    /\btsc\b.*--noEmit\b/,
    /\b(npm|pnpm|yarn|bun)\s+run\s+(lint|typecheck)\b/,
    /\bcargo\s+(clippy|fmt\s+--check)\b/,
    /\bgolangci-lint\b/,
  ]],
  ['build', [
    /\b(npm|pnpm|yarn|bun)\s+run\s+build\b/,
    /\btsc\b/,
    /\bcargo\s+build\b/,
    /\bgo\s+build\b/,
    /\bmake\b/,
    /\bdocker\s+build\b/,
    /\b(npx\s+)?(vite|next)\b.*\bbuild\b/,
    // webpack's CLI builds by default with no subcommand needed.
    /\b(npx\s+)?webpack\b/,
  ]],
  ['install', [
    /\b(npm|pnpm|yarn|bun)\s+(i|install|ci|add|uninstall|remove)\b/,
    /\bpip[0-9]*\s+install\b/,
    /\buv\s+(pip\s+install|add)\b/,
    /\bpoetry\s+(add|install)\b/,
    /\bcargo\s+add\b/,
    /\bgo\s+(get|mod\s+tidy)\b/,
    /\bbrew\s+install\b/,
  ]],
  ['git', [
    /^\s*git\b/,
    /^\s*gh\b/,
  ]],
];

/** Classify one shell segment (no `&&`/`;`/`|` inside it). */
function classifySegment(segment) {
  for (const [category, patterns] of CATEGORY_PATTERNS) {
    if (patterns.some((re) => re.test(segment))) return category;
  }
  return 'other';
}

const PRIORITY = ['test', 'lint', 'build', 'install', 'git', 'other'];

/**
 * Classify a full (possibly compound) command line into one category,
 * preferring the most specific category any segment matched.
 * @param {string} command
 * @returns {'test'|'lint'|'build'|'install'|'git'|'other'}
 */
export function classifyCommand(command) {
  if (!command) return 'other';
  const segments = command.split(SEGMENT_SEPARATORS);
  const found = new Set(segments.map(classifySegment));
  for (const category of PRIORITY) {
    if (found.has(category)) return category;
  }
  return 'other';
}

const EXIT_CODE_RE = /^(?:Error: )?Exit code (\d+)/;

/**
 * Read the exit code Claude Code prints at the head of a Bash result
 * (success or failure), or null when the text carries none.
 * @param {string} text
 * @returns {number|null}
 */
export function parseExitCode(text) {
  if (typeof text !== 'string') return null;
  const match = EXIT_CODE_RE.exec(text);
  return match ? Number(match[1]) : null;
}

const COMMIT_SHA_RE = /\[[^\]\s]+ (?:\(root-commit\) )?([0-9a-f]{7,40})\]/g;

/**
 * Pull commit hashes out of `git commit` output, e.g.
 * "[main abc1234] Add feature".
 * @param {string} text
 * @returns {string[]}
 */
export function parseCommitShas(text) {
  if (typeof text !== 'string') return [];
  const shas = [];
  for (const match of text.matchAll(COMMIT_SHA_RE)) shas.push(match[1]);
  return shas;
}

/**
 * True when a tool result is the harness's fixed "user rejected" string,
 * regardless of which tool it came from.
 * @param {unknown} toolUseResult
 * @returns {boolean}
 */
export function isRejection(toolUseResult) {
  return toolUseResult === 'User rejected tool use';
}
