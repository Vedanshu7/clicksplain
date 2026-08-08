import type { AgentConnector, ChatRequest, ExplainChunk, ExplainRequest, ToolExchangeEntry } from "../types";
import { parseSseStream } from "../sse";
import { inspectChildren } from "../../context/inspectChildren";

export interface ByoEndpointConnectorConfig {
  endpoint: string;
  /**
   * Shared secret matching the proxy's WIDGET_TOKEN, sent as x-widget-token.
   * Defense-in-depth, not a cryptographic guarantee — it's visible in the
   * client bundle/network to a sufficiently determined attacker, same as any
   * client-embedded credential — but it stops the realistic threat here
   * (scripts crawling for open, unauthenticated proxy endpoints). Optional:
   * unset matches the proxy's own default open/advisory-warning behavior.
   */
  token?: string;
}

interface PendingToolCall {
  toolCallId: string;
  toolName: string;
  input: unknown;
}

// At most one inspect_children round-trip per explain/chat call — matches the
// proxy's own MAX_TOOL_ROUNDS bound (see examples/proxy-*/src/index.ts), so a
// click can never turn into an unbounded loop of requests.
const MAX_TOOL_ROUNDS = 1;

/**
 * Streams from an adopter-owned proxy (e.g. the reference Cloudflare Worker or
 * Vercel Edge templates in examples/) implementing the canonical delta/done/error
 * SSE protocol. This is the recommended production path — the real LLM key never
 * reaches the browser.
 *
 * The proxy has no DOM access, so when the model wants to inspect a container's
 * children it pauses (a "tool-call" frame instead of "done") and this connector
 * — which does have the DOM — executes the read-only query itself and resumes
 * the conversation with a follow-up request carrying the result.
 */
export class ByoEndpointConnector implements AgentConnector {
  constructor(private readonly config: ByoEndpointConnectorConfig) {}

  explain(element: Element, req: ExplainRequest, signal: AbortSignal): AsyncIterable<string> {
    return this.runWithToolLoop(element, (toolExchange) => ({ mode: "explain", ...req, toolExchange }), signal);
  }

  chat(element: Element, req: ChatRequest, signal: AbortSignal): AsyncIterable<string> {
    return this.runWithToolLoop(element, (toolExchange) => ({ mode: "chat", ...req, toolExchange }), signal);
  }

  private async *runWithToolLoop(
    element: Element,
    buildBody: (toolExchange: ToolExchangeEntry[]) => unknown,
    signal: AbortSignal
  ): AsyncIterable<string> {
    const toolExchange: ToolExchangeEntry[] = [];

    for (let round = 0; round <= MAX_TOOL_ROUNDS; round++) {
      // Round > 0 means the previous round paused on a tool-call — its answer
      // resumes in a brand new HTTP response here. Prompting the model to leave
      // a blank line after its "let me check..." preamble proved unreliable
      // (verified against the live API — it runs them together with no
      // separator), so we inject the break here instead, at the one point we
      // can detect precisely: the first chunk of a resumed round.
      const inner = this.postAndStream(buildBody(toolExchange), signal);
      let isFirstChunkOfRound = round > 0;
      let toolCall: PendingToolCall | null = null;

      while (true) {
        const step = await inner.next();
        if (step.done) {
          toolCall = step.value.toolCall;
          break;
        }
        if (isFirstChunkOfRound) {
          isFirstChunkOfRound = false;
          yield `\n\n${step.value}`;
        } else {
          yield step.value;
        }
      }

      if (!toolCall) return; // finished normally, no tool needed (or none left)

      // Defensive backstop — the proxy forces a text-only finish once toolExchange
      // already has MAX_TOOL_ROUNDS entries, so this should be unreachable in
      // practice, but degrade gracefully rather than looping if it ever happens.
      if (round === MAX_TOOL_ROUNDS) {
        throw new Error(
          "I wasn't able to figure this out with confidence — feel free to ask a follow-up question!"
        );
      }

      if (toolCall.toolName !== "inspect_children") {
        throw new Error(`clicksplain: unsupported tool "${toolCall.toolName}"`);
      }

      const result = inspectChildren(element);
      toolExchange.push({
        toolCallId: toolCall.toolCallId,
        toolName: "inspect_children",
        input: toolCall.input as Record<string, never>,
        result,
      });
    }
  }

  /** Yields text deltas; returns the pending tool call (if any) once the stream pauses or ends. */
  private async *postAndStream(
    body: unknown,
    signal: AbortSignal
  ): AsyncGenerator<string, { toolCall: PendingToolCall | null }, void> {
    const response = await fetch(this.config.endpoint, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        ...(this.config.token ? { "x-widget-token": this.config.token } : {}),
      },
      body: JSON.stringify(body),
      signal,
    });

    if (!response.ok || !response.body) {
      throw new Error(`clicksplain proxy error (${response.status})`);
    }

    for await (const frame of parseSseStream(response.body)) {
      const message = parseCanonicalMessage(safeJsonParse(frame.data));
      if (!message) continue;

      if (message.type === "delta") {
        yield message.text;
      } else if (message.type === "error") {
        throw new Error(message.message);
      } else if (message.type === "tool-call") {
        return { toolCall: { toolCallId: message.toolCallId, toolName: message.toolName, input: message.input } };
      } else if (message.type === "done") {
        return { toolCall: null };
      }
    }

    return { toolCall: null };
  }
}

function parseCanonicalMessage(value: unknown): ExplainChunk | null {
  if (typeof value !== "object" || value === null) return null;
  const record = value as Record<string, unknown>;

  if (record.type === "delta" && typeof record.text === "string") {
    return { type: "delta", text: record.text };
  }
  if (record.type === "done") {
    return { type: "done" };
  }
  if (record.type === "error" && typeof record.message === "string") {
    return { type: "error", message: record.message };
  }
  if (record.type === "tool-call" && typeof record.toolCallId === "string" && typeof record.toolName === "string") {
    return { type: "tool-call", toolCallId: record.toolCallId, toolName: record.toolName, input: record.input };
  }
  return null;
}

function safeJsonParse(raw: string): unknown {
  try {
    return JSON.parse(raw);
  } catch {
    return null;
  }
}
