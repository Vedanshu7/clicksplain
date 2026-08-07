import { tool } from "ai";
import { z } from "zod";
import { inspectChildren } from "../../context/inspectChildren";

export const INSPECT_CHILDREN_DESCRIPTION =
  "Look at the direct contents of the element being explained — useful for containers like " +
  "forms, menus, dropdowns, or lists whose own text doesn't say what's inside them (e.g. a " +
  "form's fields). Returns a short, read-only summary of each direct child: what kind of " +
  "thing it is and its label or text. Never modifies the page. Only use this if the element's " +
  "own info wasn't enough to answer confidently.";

/** Real client-side execution — the browser has the DOM, so this runs immediately, no relay needed. */
export function createInspectChildrenTool(element: Element) {
  return tool({
    description: INSPECT_CHILDREN_DESCRIPTION,
    inputSchema: z.object({}),
    execute: async () => inspectChildren(element),
  });
}
