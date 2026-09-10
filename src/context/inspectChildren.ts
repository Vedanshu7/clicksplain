import type { ElementInfo } from "../connectors/types";
import { MAX_CHILDREN } from "../shared/wire";
import { extractElementInfo } from "./ElementInfoExtractor";
import { isIgnored } from "./privacy";

/**
 * Read-only summary of a container element's direct children: used by the
 * inspect_children tool so the model can answer about things like a form's
 * fields without their info being in the container's own text. Deliberately
 * scoped to direct element children only (no page-wide queries, no arbitrary
 * selectors, no recursion into grandchildren) and reuses extractElementInfo's
 * existing heuristics per child, which already never reads input `.value`.
 */
export function inspectChildren(element: Element): ElementInfo[] {
  const children = Array.from(element.children)
    .filter((child) => !isIgnored(child))
    .slice(0, MAX_CHILDREN);
  return children.map((child) => extractElementInfo(child));
}
