import { jsonSchema, tool } from "ai";
import { INSPECT_CHILDREN_DESCRIPTION, INSPECT_CHILDREN_PARAMETERS } from "../../shared/wire";
import { inspectChildren } from "../../context/inspectChildren";

/** Real client-side execution: the browser has the DOM, so this runs immediately, no relay needed. */
export function createInspectChildrenTool(element: Element) {
  return tool({
    description: INSPECT_CHILDREN_DESCRIPTION,
    inputSchema: jsonSchema<Record<string, never>>(INSPECT_CHILDREN_PARAMETERS),
    execute: async () => inspectChildren(element),
  });
}
