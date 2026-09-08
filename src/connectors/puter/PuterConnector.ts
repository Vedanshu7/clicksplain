import type { AgentConnector, ChatRequest, ExplainRequest } from "../types";
import { buildChatMessages, buildChatSystemPrompt, buildSystemPrompt, buildUserMessage } from "../../shared/promptBuilder";
import { INSPECT_CHILDREN_DESCRIPTION } from "../../shared/tools";
import { MAX_TOOL_ROUNDS } from "../../shared/protocol";
import { inspectChildren } from "../../context/inspectChildren";
import type { PuterChatMessage } from "./puterTypes";

export interface PuterConnectorConfig {
  model?: string;
  /** Independently configurable from `model`: falls back to it if unset. */
  chatModel?: string;
}

// 1 initial step + 1 tool-augmented follow-up: same bound as every other
// connector (see ByokConnector.ts, ByoEndpointConnector.ts), so a click can
// never turn into an unbounded loop regardless of which connector is active.
const MAX_TOOL_STEPS = MAX_TOOL_ROUNDS + 1;

const inspectChildrenTool = {
  type: "function" as const,
  function: {
    name: "inspect_children",
    description: INSPECT_CHILDREN_DESCRIPTION,
    parameters: { type: "object", properties: {}, additionalProperties: false },
  },
};

/**
 * Calls Puter.js (puter.com) directly from the browser: no API key, no
 * backend, free to the adopter (Puter bills usage to the visiting browser's
 * own free Puter identity via puter.com's own infrastructure and ToS, not the
 * adopter's account). Requires the host page to load Puter's own script tag
 * itself before clicksplain's: this connector never injects it, so pulling in
 * a third-party script is always something the adopter opted into explicitly.
 * See README's Puter connector section for setup and the tradeoffs.
 */
export class PuterConnector implements AgentConnector {
  constructor(private readonly config: PuterConnectorConfig) {
    if (typeof window === "undefined" || !window.puter?.ai) {
      throw new Error(
        '[clicksplain] "puter" connector requires Puter.js to be loaded first: add ' +
          '<script src="https://js.puter.com/v2/"></script> before the clicksplain script tag.'
      );
    }
  }

  async *explain(element: Element, req: ExplainRequest, signal: AbortSignal): AsyncIterable<string> {
    const messages: PuterChatMessage[] = [
      { role: "system", content: buildSystemPrompt() },
      { role: "user", content: buildUserMessage(req) },
    ];
    yield* this.runWithToolLoop(element, messages, this.config.model, signal);
  }

  async *chat(element: Element, req: ChatRequest, signal: AbortSignal): AsyncIterable<string> {
    const messages: PuterChatMessage[] = [
      { role: "system", content: buildChatSystemPrompt() },
      ...toPuterMessages(buildChatMessages(req)),
    ];
    yield* this.runWithToolLoop(element, messages, this.config.chatModel ?? this.config.model, signal);
  }

  /**
   * Puter's chat() streams one step at a time with no AI-SDK-style automatic
   * multi-step tool loop, so this drives the same bounded round-trip
   * manually: a `tool_use` chunk ends the current stream, the (real, local)
   * DOM query runs immediately since the browser has the DOM, and its result
   * is appended to `messages` before calling chat() again.
   */
  private async *runWithToolLoop(
    element: Element,
    messages: PuterChatMessage[],
    model: string | undefined,
    signal: AbortSignal
  ): AsyncIterable<string> {
    for (let step = 0; step < MAX_TOOL_STEPS; step++) {
      if (signal.aborted) return;

      const stream = await window.puter!.ai.chat(messages, false, {
        model,
        stream: true,
        // Force text-only on the final allowed step, mirroring the server
        // handler's own toolChoice:"none" once MAX_TOOL_ROUNDS is reached.
        tools: step < MAX_TOOL_STEPS - 1 ? [inspectChildrenTool] : undefined,
      });

      let pendingToolCall: { id: string; input: Record<string, unknown> } | null = null;
      // Same "let me check..." / blank-line / real-answer separation used by
      // every other connector: see ByokConnector.ts's textDeltasOrThrow.
      let isFirstChunkOfStep = step > 0;
      for await (const part of stream) {
        if (signal.aborted) return;
        if (part.type === "text") {
          if (isFirstChunkOfStep) {
            isFirstChunkOfStep = false;
            yield `\n\n${part.text}`;
          } else {
            yield part.text;
          }
        } else if (part.type === "tool_use") {
          pendingToolCall = { id: part.id, input: part.input };
        } else if (part.type === "error") {
          throw new Error(part.message);
        }
      }

      if (!pendingToolCall) return;

      const result = inspectChildren(element);
      messages.push(
        {
          role: "assistant",
          content: "",
          tool_calls: [
            { id: pendingToolCall.id, type: "function", function: { name: "inspect_children", arguments: "{}" } },
          ],
        },
        { role: "tool", tool_call_id: pendingToolCall.id, content: JSON.stringify(result) }
      );
    }
  }
}

// buildChatMessages's return type also covers the (never-populated, for this
// connector) toolExchange-derived shape from src/shared/promptBuilder.ts,
// whose `content` is a structured array rather than a string: this connector
// drives its own in-process tool loop instead of that HTTP-relay pattern, so
// req.toolExchange is always empty and content is always a string in
// practice; the runtime check makes that assumption explicit rather than
// silently mis-serializing if it's ever wrong.
function toPuterMessages(built: readonly { role: string; content: unknown }[]): PuterChatMessage[] {
  return built.map((m) => {
    if (typeof m.content !== "string") {
      throw new Error("[clicksplain] internal error: puter connector received a non-string message");
    }
    return { role: m.role as PuterChatMessage["role"], content: m.content };
  });
}
