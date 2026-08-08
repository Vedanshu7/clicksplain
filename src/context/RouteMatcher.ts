/**
 * Normalizes the current page's route for use as part of the tier-2 composite
 * lookup key. Prefers hash-based routing (`#/settings/team`) when present and
 * path-shaped, falling back to `pathname`: covers the common SPA and
 * multi-page-site cases with zero configuration.
 *
 * Path-parameter matching (e.g. `/users/:id`) is a v2 refinement; v1 matches
 * the normalized route exactly.
 */
export function getCurrentRoute(): string {
  const hash = window.location.hash;
  if (hash.length > 1) {
    const hashPath = hash.slice(1).split("?")[0] ?? "";
    if (hashPath.startsWith("/")) return normalizePath(hashPath);
  }
  return normalizePath(window.location.pathname);
}

function normalizePath(path: string): string {
  if (path.length > 1 && path.endsWith("/")) {
    return path.slice(0, -1);
  }
  return path || "/";
}
