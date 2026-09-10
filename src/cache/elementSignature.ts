import type { ElementInfo } from "../connectors/types";

/**
 * Derives a stable per-element cache key. Prefers data-agent-id when present
 * (a developer has explicitly promised it's stable); otherwise hashes every
 * ElementInfo field the prompt is built from, so two elements share a cached
 * answer only when the model would have been asked the exact same question.
 */
export function deriveElementSignature(elementInfo: ElementInfo, pageLanguage: string | null): string {
  // Same element, different page language: a different answer.
  const lang = pageLanguage ? `${pageLanguage}:` : "";
  if (elementInfo.agentId) return `${lang}id:${elementInfo.agentId}`;

  // JSON rather than a joined string: field values may themselves contain any
  // separator character, which would let two different elements collide.
  const stable = JSON.stringify([
    elementInfo.tagName,
    elementInfo.role,
    elementInfo.ariaLabel,
    elementInfo.id,
    [...elementInfo.classes].sort(),
    elementInfo.nearbyText,
    elementInfo.placeholder,
  ]);

  return `${lang}sig:${djb2(stable)}`;
}

// Non-cryptographic string hash: only used to keep cache keys short and avoid
// storing raw page text twice (once as a key), not for any security purpose.
function djb2(input: string): string {
  let hash = 5381;
  for (let i = 0; i < input.length; i++) {
    hash = (hash * 33) ^ input.charCodeAt(i);
  }
  return (hash >>> 0).toString(36);
}
