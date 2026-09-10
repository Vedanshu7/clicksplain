export type { ElementInfo, ChatTurn, ToolExchangeEntry } from "../shared/wire";
import type { ElementInfo, ChatTurn, ToolExchangeEntry } from "../shared/wire";

export interface ExplainRequest {
  elementInfo: ElementInfo;
  docsContext: string | null;
  route: string;
  /** The page's `<html lang>`, so the answer comes back in the page's language. */
  pageLanguage: string | null;
  /** Accumulated tool round-trips already resolved for this request (byo-endpoint only). */
  toolExchange?: ToolExchangeEntry[];
}

export interface ChatRequest {
  elementInfo: ElementInfo;
  docsContext: string | null;
  route: string;
  pageLanguage: string | null;
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
