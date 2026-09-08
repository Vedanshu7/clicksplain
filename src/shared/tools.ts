import { z } from "zod";

export const INSPECT_CHILDREN_DESCRIPTION =
  "Look at the direct contents of the element being explained: useful for containers like " +
  "forms, menus, dropdowns, or lists whose own text doesn't say what's inside them (e.g. a " +
  "form's fields). Returns a short, read-only summary of each direct child: what kind of " +
  "thing it is and its label or text. Never modifies the page. Only use this if the element's " +
  "own info wasn't enough to answer confidently.";

export const inspectChildrenInputSchema = z.object({});
