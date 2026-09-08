import { tool } from "ai";
import { INSPECT_CHILDREN_DESCRIPTION, inspectChildrenInputSchema } from "../../shared/tools";
import { inspectChildren } from "../../context/inspectChildren";

/** Real client-side execution: the browser has the DOM, so this runs immediately, no relay needed. */
export function createInspectChildrenTool(element: Element) {
  return tool({
    description: INSPECT_CHILDREN_DESCRIPTION,
    inputSchema: inspectChildrenInputSchema,
    execute: async () => inspectChildren(element),
  });
}
