// Dependency-free half of the wire contract: imported by the browser core, so
// it must never pull in zod or the AI SDK. The runtime validation of these same
// shapes lives in ./protocol.ts, which only the server and BYOK entries load.

export interface ElementInfo {
  tagName: string;
  role: string | null;
  ariaLabel: string | null;
  id: string | null;
  classes: string[];
  nearbyText: string | null;
  placeholder: string | null;
  agentId: string | null;
}

export interface ChatTurn {
  role: "user" | "assistant";
  text: string;
}

/** One resolved round of the read-only DOM reasoning loop: see inspectChildren.ts. */
export interface ToolExchangeEntry {
  toolCallId: string;
  toolName: "inspect_children";
  input: Record<string, never>;
  result: ElementInfo[];
}

// At most one inspect_children round-trip per explain/chat call, shared by every
// connector and enforced again server-side, so a click can never turn into an
// unbounded loop of requests.
export const MAX_TOOL_ROUNDS = 1;
export const MAX_CHILDREN = 20;

export const INSPECT_CHILDREN_NAME = "inspect_children";

export const INSPECT_CHILDREN_DESCRIPTION =
  "Look at the direct contents of the element being explained: useful for containers like " +
  "forms, menus, dropdowns, or lists whose own text doesn't say what's inside them (e.g. a " +
  "form's fields). Returns a short, read-only summary of each direct child: what kind of " +
  "thing it is and its label or text. Never modifies the page. Only use this if the element's " +
  "own info wasn't enough to answer confidently.";

export const INSPECT_CHILDREN_PARAMETERS = {
  type: "object",
  properties: {},
  additionalProperties: false,
} as const;
