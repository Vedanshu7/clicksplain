import type { ElementInfo } from "../connectors/types";

/**
 * Derives a stable per-element cache key. Prefers data-agent-id when present
 * (a developer has explicitly promised it's stable); otherwise hashes a subset
 * of ElementInfo fields chosen for run-to-run stability — deliberately excludes
 * DOM `id` (often framework-generated, can churn across renders) and `placeholder`
 * (can legitimately vary, e.g. localized or dynamic hint text).
 */
export function deriveElementSignature(elementInfo: ElementInfo): string {
  if (elementInfo.agentId) return `id:${elementInfo.agentId}`;

  const stable = [
    elementInfo.tagName,
    elementInfo.role ?? "",
    elementInfo.ariaLabel ?? "",
    [...elementInfo.classes].sort().join(","),
    elementInfo.nearbyText ?? "",
  ].join("|");

  return `sig:${djb2(stable)}`;
}

// Non-cryptographic string hash — only used to keep cache keys short and avoid
// storing raw page text twice (once as a key), not for any security purpose.
function djb2(input: string): string {
  let hash = 5381;
  for (let i = 0; i < input.length; i++) {
    hash = (hash * 33) ^ input.charCodeAt(i);
  }
  return (hash >>> 0).toString(36);
}
