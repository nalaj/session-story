/**
 * Small pure selectors over the Story IR, shared by the HTML lenses, the
 * markdown export and the metrics so each reads the same facts the same way.
 */

/** Command categories that count as validation. */
export const VALIDATION_CATEGORIES = new Set(['test', 'lint', 'build']);

/** Every bash entry across every turn, tagged with its turn index. */
export function allCommands(turns) {
  const out = [];
  for (const turn of turns || []) {
    for (const entry of turn.bash || []) out.push({ ...entry, turnIndex: turn.index });
  }
  return out;
}

/** Every recorded tool error/rejection across every turn. */
export function allErrors(turns) {
  const out = [];
  for (const turn of turns || []) {
    for (const entry of turn.errors || []) out.push({ ...entry, turnIndex: turn.index });
  }
  return out;
}

/** Test, lint and build runs, in turn order. */
export function validationRuns(turns) {
  return allCommands(turns).filter((c) => VALIDATION_CATEGORIES.has(c.category));
}

/** The last test, lint or build run, or null when none ran. */
export function lastValidation(turns) {
  const runs = validationRuns(turns);
  return runs.length ? runs[runs.length - 1] : null;
}

export function shortSha(sha) {
  return sha ? sha.slice(0, 7) : '';
}

/** Edits to files that live inside the project directory. */
export function inProject(edits) {
  return edits.filter((edit) => !edit.outside_cwd);
}
