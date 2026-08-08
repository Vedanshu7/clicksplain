import type { ElementInfo } from "../connectors/types";
import { extractElementInfo } from "./ElementInfoExtractor";

const MAX_CHILDREN = 20;

/**
 * Read-only summary of a container element's direct children: used by the
 * inspect_children tool so the model can answer about things like a form's
 * fields without their info being in the container's own text. Deliberately
 * scoped to direct element children only (no page-wide queries, no arbitrary
 * selectors, no recursion into grandchildren) and reuses extractElementInfo's
 * existing heuristics per child, which already never reads input `.value`.
 */
export function inspectChildren(element: Element): ElementInfo[] {
  const children = Array.from(element.children).slice(0, MAX_CHILDREN);
  return children.map((child) => extractElementInfo(child));
}
