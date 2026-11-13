/**
 * Path helpers that follow the session's own path style, not the host's.
 * A transcript recorded on Windows carries `C:\...` paths even when the story
 * is extracted elsewhere, and git always reports `/`-separated paths, so
 * relative paths are normalised to `/` to match git and stay stable keys.
 */
import path from 'node:path';

function flavour(cwd) {
  return /^[A-Za-z]:[\\/]/.test(cwd) || cwd.startsWith('\\\\') ? path.win32 : path.posix;
}

/** `filePath` relative to `cwd`, `/`-separated; the input itself when there is no cwd or nothing is left. */
export function relativeTo(filePath, cwd) {
  if (!cwd || !filePath) return filePath;
  const rel = flavour(cwd).relative(cwd, filePath);
  return rel ? rel.replace(/\\/g, '/') : filePath;
}

/** A `/`-separated relative path (as git reports it) made absolute under `cwd`, in cwd's style. */
export function resolveIn(cwd, rel) {
  if (!cwd) return rel;
  return flavour(cwd).resolve(cwd, rel);
}

/** True for a relative path that climbs out of the project, or one that stayed absolute. */
export function isOutsideRel(rel) {
  if (!rel) return false;
  return rel === '..' || rel.startsWith('../') || rel.startsWith('/') || /^[A-Za-z]:\//.test(rel);
}
