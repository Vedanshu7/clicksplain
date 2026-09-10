// Adopter-controlled opt-outs, honored on the element itself or any ancestor so
// a whole region (an account panel, a table of customer rows) can be marked once.

/** Not pickable at all: inspect mode swallows the press but never explains it. */
export function isIgnored(element: Element): boolean {
  return element.closest("[data-clicksplain-ignore]") !== null;
}

/**
 * Pickable, but no text read from the page's content is sent: only structural
 * signal (tag, role, classes) and developer-authored attributes (aria-label,
 * placeholder, data-agent-id) leave the page.
 */
export function isRedacted(element: Element): boolean {
  return element.closest("[data-clicksplain-redact]") !== null;
}
