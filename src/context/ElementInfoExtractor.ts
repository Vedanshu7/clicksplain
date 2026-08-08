import type { ElementInfo } from "../connectors/types";

const MAX_TEXT_LENGTH = 200;

// Fallback ARIA role by tag, used when no explicit role/aria-label exists so the
// LLM still gets some semantic signal for plain unlabeled markup.
const IMPLICIT_ROLE_BY_TAG: Record<string, string> = {
  button: "button",
  a: "link",
  nav: "navigation",
  input: "textbox",
  textarea: "textbox",
  select: "listbox",
  form: "form",
  header: "banner",
  footer: "contentinfo",
  main: "main",
  table: "table",
  dialog: "dialog",
};

/**
 * Tier-1 zero-config context: pulls whatever semantic signal is already on the
 * element (ARIA, labels, nearby text, tag) without requiring any developer setup.
 * Never reads input `.value` (only placeholder/label text), so user-entered
 * data is never sent as context.
 */
export function extractElementInfo(element: Element): ElementInfo {
  return {
    tagName: element.tagName.toLowerCase(),
    role: element.getAttribute("role") ?? implicitRole(element),
    ariaLabel: resolveAriaLabel(element),
    id: element.id || null,
    classes: Array.from(element.classList),
    nearbyText: resolveNearbyText(element),
    placeholder: resolvePlaceholder(element),
    agentId: element.getAttribute("data-agent-id"),
  };
}

function implicitRole(element: Element): string | null {
  return IMPLICIT_ROLE_BY_TAG[element.tagName.toLowerCase()] ?? null;
}

function resolvePlaceholder(element: Element): string | null {
  if (element instanceof HTMLInputElement || element instanceof HTMLTextAreaElement) {
    return element.placeholder || null;
  }
  return null;
}

function resolveAriaLabel(element: Element): string | null {
  const direct = element.getAttribute("aria-label");
  if (direct) return truncate(direct);

  const labelledBy = element.getAttribute("aria-labelledby");
  if (labelledBy) {
    const text = labelledBy
      .split(/\s+/)
      .map((id) => document.getElementById(id)?.textContent?.trim())
      .filter((value): value is string => Boolean(value))
      .join(" ");
    if (text) return truncate(text);
  }

  if (
    element instanceof HTMLInputElement ||
    element instanceof HTMLTextAreaElement ||
    element instanceof HTMLSelectElement
  ) {
    if (element.id) {
      const label = document.querySelector(`label[for="${cssEscape(element.id)}"]`);
      const labelText = label?.textContent?.trim();
      if (labelText) return truncate(labelText);
    }
    const wrappingLabel = element.closest("label");
    const wrappingText = wrappingLabel?.textContent?.trim();
    if (wrappingText) return truncate(wrappingText);
  }

  return null;
}

function resolveNearbyText(element: Element): string | null {
  const own = directOwnText(element);
  if (own) return truncate(own);

  const siblingText = element.previousElementSibling?.textContent?.trim();
  if (siblingText) return truncate(siblingText);

  const parentText = element.parentElement ? directOwnText(element.parentElement) : null;
  if (parentText) return truncate(parentText);

  return null;
}

// Only text nodes that are direct children: avoids pulling in unrelated text
// from deeply nested descendants.
function directOwnText(element: Element): string | null {
  let text = "";
  for (const node of element.childNodes) {
    if (node.nodeType === Node.TEXT_NODE) {
      text += node.textContent ?? "";
    }
  }
  text = text.trim();
  return text || null;
}

function truncate(text: string): string {
  return text.length > MAX_TEXT_LENGTH ? `${text.slice(0, MAX_TEXT_LENGTH)}…` : text;
}

function cssEscape(value: string): string {
  return typeof CSS !== "undefined" && CSS.escape ? CSS.escape(value) : value;
}
