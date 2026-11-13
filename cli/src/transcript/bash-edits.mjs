/**
 * Reading file mutations out of Bash commands.
 *
 * Edit/Write tool results carry their own diff; a Bash result carries only
 * stdout, so a shell-driven change leaves no trace of *what* it changed.
 * All this module does is read the command text and answer two questions
 * the git pass (src/ir/git-edits.mjs) then uses to attribute real diffs to
 * the turn that caused them:
 *
 *   writes   - paths this command plausibly wrote
 *   bulk     - the command runs a whole-tree tool (a formatter, an install)
 *              that changes files it never names
 *   mentions - paths the command merely referred to
 *
 * It is deliberately generous: git decides which files actually changed, so
 * a path named here that git reports as untouched costs nothing. The only
 * thing at stake is which turn a real change is credited to, which is why
 * the three tiers stay separate rather than collapsing into one list.
 */

// A command that writes through a variable (`p = '...'; open(p, 'w')`) never
// names its target at the write call, so any of these constructs promotes
// *every* path in the command to a write candidate rather than trying to
// track the path to the call.
const WRITE_CONSTRUCTS = [
  /\bsed\s+(?:-[a-zA-Z]*i|--in-place)/,
  /\bperl\s+-[a-zA-Z]*i/,
  /\bawk\s+-i\s+inplace/,
  /\btee\b/,
  /\b(?:mv|cp|rm|touch|mkdir|ln|rsync|patch)\s/,
  /\bgit\s+(?:apply|checkout|restore|stash|revert|merge|rebase|pull|mv|rm)\b/,
  // python
  /\bopen\s*\([^)]*,\s*['"][^'"]*[wax]/,
  /\.write_text\s*\(|\.write_bytes\s*\(|\.writelines\s*\(|\.write\s*\(/,
  /\bshutil\.(?:copy|copy2|move|copytree)|\bos\.(?:rename|replace|remove|unlink|makedirs|mkdir)/,
  // node
  /\bwriteFileSync|\bappendFileSync|\bcreateWriteStream|\bfs\.(?:writeFile|appendFile|rename|rm|unlink|mkdir)|\brenameSync|\brmSync|\bunlinkSync|\bmkdirSync/,
];

// Tools that rewrite whatever they find. They name directories, or nothing
// at all, so their changed files can only be identified by git.
const BULK_CONSTRUCTS = [
  /\bprettier\b[^|;&]*--write/,
  /\beslint\b[^|;&]*--fix/,
  /\b(?:black|isort|autopep8|yapf)\b/,
  /\bruff\s+(?:format|check[^|;&]*--fix)/,
  /\bgofmt\s+-w|\bgo\s+fmt\b/,
  /\bcargo\s+fmt\b|\brustfmt\b/,
  /\b(?:npm|pnpm|yarn|bun)\s+(?:i|install|ci|add|remove|update|upgrade)\b/,
  /\bpip3?\s+install\b|\bpoetry\s+(?:add|install|lock|remove)\b|\buv\s+(?:add|sync|pip)\b/,
  /\balembic\s+(?:upgrade|downgrade|revision)\b|\bmanage\.py\s+(?:makemigrations|migrate)\b/,
  /\bprisma\s+(?:migrate|generate|db)\b/,
  /\b(?:make|rake)\b/,
  /\b(?:npm|pnpm|yarn|bun)\s+run\s+(?:build|format|lint:fix|codegen|generate)\b/,
];

// A shell redirect writing to a file. The leading whitespace requirement
// keeps `=>` out, and the captured target is filtered through isPathLike so
// a bare comparison (`x > 1`) and `2>&1` are not mistaken for one.
const REDIRECT = /(?:^|\s)\d?>>?\s*(['"]?)((?:\.{0,2}\/)?[A-Za-z0-9_@.+~/-]+)\1/g;

// Bare filenames are only recognised as paths when the extension says so —
// otherwise every `s.replace(...)` in a heredoc reads as a file. Paths
// containing a slash need no such help. Extend freely; a missing extension
// only means a top-level file is credited to a turn one tier lower.
const KNOWN_EXTENSIONS = new Set([
  'ts', 'tsx', 'js', 'jsx', 'mjs', 'cjs', 'json', 'jsonc', 'py', 'rb', 'go', 'rs', 'java',
  'kt', 'swift', 'c', 'h', 'cc', 'cpp', 'hpp', 'cs', 'php', 'sh', 'bash', 'zsh', 'sql',
  'html', 'htm', 'css', 'scss', 'sass', 'less', 'vue', 'svelte', 'md', 'mdx', 'txt', 'rst',
  'yml', 'yaml', 'toml', 'ini', 'cfg', 'conf', 'env', 'lock', 'xml', 'svg', 'csv', 'tsv',
  'proto', 'graphql', 'gql', 'tf', 'tfvars', 'dockerfile', 'gradle', 'ipynb',
]);

// Split on whitespace and on the punctuation that wraps arguments in both
// shell and the script languages that ride inside heredocs.
const TOKEN_SEPARATORS = /[\s'"`(),;|&<>{}[\]]+/;

function isPathLike(token) {
  if (!token || token.startsWith('-')) return false;
  if (/[*?]/.test(token)) return false; // a glob, not a path
  if (/^[a-z][a-z0-9+.-]*:\/\//i.test(token)) return false; // URL
  if (token.startsWith('/dev/')) return false;
  if (/^\.{1,2}$/.test(token)) return false;
  if (/^\d*[sy]\/.*\/.*\/[a-z0-9]*$/.test(token)) return false; // a sed/perl script, not a path
  // `.read`, `.replace`: a leading dot is a method call unless it starts a path.
  if (token.startsWith('.') && !token.startsWith('./') && !token.startsWith('../')) return false;
  if (token.includes('/')) return true;
  const dot = token.lastIndexOf('.');
  if (dot <= 0) return false;
  return KNOWN_EXTENSIONS.has(token.slice(dot + 1).toLowerCase());
}

/** Every path-looking token in the command, in order, without duplicates. */
function pathLiterals(command) {
  const seen = new Set();
  for (const raw of command.split(TOKEN_SEPARATORS)) {
    const token = raw.replace(/^\.\//, '').replace(/[.,;:]+$/, '');
    if (isPathLike(token)) seen.add(token);
  }
  return [...seen];
}

function hasRedirectToFile(command) {
  REDIRECT.lastIndex = 0;
  let match;
  while ((match = REDIRECT.exec(command)) !== null) {
    if (isPathLike(match[2].replace(/^\.\//, ''))) return true;
  }
  return false;
}

function matchesAny(patterns, command) {
  return patterns.some((re) => re.test(command));
}

/**
 * @param {string} command - the Bash tool call's command text, heredoc body included
 * @returns {{writes: string[], mentions: string[], bulk: boolean}}
 */
export function analyzeBashCommand(command) {
  if (typeof command !== 'string' || command.trim() === '') {
    return { writes: [], mentions: [], bulk: false };
  }
  const paths = pathLiterals(command);
  const bulk = matchesAny(BULK_CONSTRUCTS, command);
  const writing = matchesAny(WRITE_CONSTRUCTS, command) || hasRedirectToFile(command);
  return {
    writes: writing ? paths : [],
    mentions: writing ? [] : paths,
    bulk,
  };
}
