/** route -> data-agent-id -> doc snippet or doc URL */
export type DocsConfig = Record<string, Record<string, string>>;

/**
 * v2: a non-null return is a full short-circuit of the LLM call (see
 * ExplanationResolver.ts) — in v1 this was only ever passed as LLM context.
 *
 * Resolves a doc snippet for a tagged element using a composite key of
 * (route, data-agent-id), so the same tag name can mean different things on
 * different pages without colliding. `route` is threaded in by the caller
 * (matching ExplanationCache.get's shape) rather than recomputed internally,
 * so every tier of the priority chain agrees on the same route value.
 */
export function resolveDocsContext(
  agentId: string | null,
  docsConfig: DocsConfig | undefined,
  route: string
): string | null {
  if (!agentId || !docsConfig) return null;
  return docsConfig[route]?.[agentId] ?? null;
}
