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

/** One resolved round of the read-only DOM reasoning loop: see inspectChildren.ts. */
export interface ToolExchangeEntry {
  toolCallId: string;
  toolName: "inspect_children";
  input: Record<string, never>;
  result: ElementInfo[];
}

export interface ExplainRequest {
  elementInfo: ElementInfo;
  docsContext: string | null;
  route: string;
  /** Accumulated tool round-trips already resolved for this request (byo-endpoint only). */
  toolExchange?: ToolExchangeEntry[];
}

export interface ChatTurn {
  role: "user" | "assistant";
  text: string;
}

export interface ChatRequest {
  elementInfo: ElementInfo;
  docsContext: string | null;
  route: string;
  baseExplanation: string;
  history: ChatTurn[];
  question: string;
  /** Accumulated tool round-trips already resolved for this request (byo-endpoint only). */
  toolExchange?: ToolExchangeEntry[];
}

export type ExplainChunk =
  | { type: "delta"; text: string }
  | { type: "done" }
  | { type: "error"; message: string }
  | { type: "tool-call"; toolCallId: string; toolName: string; input: unknown };

export interface AgentConnector {
  /**
   * `element` is the live picked DOM element, used only for local read-only tool
   * execution (see inspect_children); never serialized into a wire request.
   */
  explain(element: Element, req: ExplainRequest, signal: AbortSignal): AsyncIterable<string>;
  /** Always a live call: chat turns are never cached or docsConfig-short-circuited. */
  chat(element: Element, req: ChatRequest, signal: AbortSignal): AsyncIterable<string>;
}
