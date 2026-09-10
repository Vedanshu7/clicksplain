import type { ElementInfo } from "../connectors/types";
import { isRedacted } from "./privacy";

const MAX_TEXT_LENGTH = 200;
const INTERACTIVE_SELECTOR =
  "button, a[href], input, select, textarea, [role='button'], [role='link'], [role='menuitem'], [role='tab']";

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
 * Never reads input `.value` or contenteditable text (only placeholder/label
 * text), so user-entered data is never sent as context; see ./privacy.ts for
 * the attributes adopters can use to exclude more.
 */
export function extractElementInfo(element: Element): ElementInfo {
  const redacted = isRedacted(element);
  return {
    tagName: element.tagName.toLowerCase(),
    role: element.getAttribute("role") ?? implicitRole(element),
    ariaLabel: redacted ? attributeLabel(element) : resolveAriaLabel(element),
    id: element.id || null,
    classes: Array.from(element.classList),
    nearbyText: redacted ? null : resolveNearbyText(element),
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

function attributeLabel(element: Element): string | null {
  const direct = element.getAttribute("aria-label");
  return direct ? truncate(direct) : null;
}

function resolveAriaLabel(element: Element): string | null {
  const direct = attributeLabel(element);
  if (direct) return direct;

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
    const wrappingText = wrappingLabel ? labelTextWithoutControls(wrappingLabel) : null;
    if (wrappingText) return truncate(wrappingText);
  }

  return null;
}

function resolveNearbyText(element: Element): string | null {
  const own = directOwnText(element);
  if (own) return truncate(own);

  // A sibling's whole textContent could be an entire table row of names or
  // balances: only take its own text, or that of a lone wrapper's child
  // (`<span><b>Email</b></span>`), which is how labels are usually marked up.
  // A sibling that is itself a control is a different thing to explain, not
  // a label: a form right after an "Export report" button would otherwise be
  // described to the model as an export form.
  const sibling = element.previousElementSibling;
  const siblingText =
    sibling && !sibling.matches(INTERACTIVE_SELECTOR) ? directOwnText(sibling) ?? loneChildText(sibling) : null;
  if (siblingText) return truncate(siblingText);

  const parentText = element.parentElement ? directOwnText(element.parentElement) : null;
  if (parentText) return truncate(parentText);

  return null;
}

function loneChildText(element: Element): string | null {
  const child = element.firstElementChild;
  return element.childElementCount === 1 && child ? directOwnText(child) : null;
}

// A wrapping <label> also contains its control: a <select>'s option list or a
// <textarea>'s default text would otherwise be read as part of the label.
function labelTextWithoutControls(label: HTMLLabelElement): string | null {
  const copy = label.cloneNode(true) as HTMLLabelElement;
  copy.querySelectorAll("input, select, textarea, [contenteditable]").forEach((control) => control.remove());
  return copy.textContent?.trim() || null;
}

// Only text nodes that are direct children: avoids pulling in unrelated text
// from deeply nested descendants. Redacted regions and contenteditable areas
// (user-typed content, same as an input's value) yield nothing.
function directOwnText(element: Element): string | null {
  if (isRedacted(element) || (element instanceof HTMLElement && element.isContentEditable)) return null;
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
