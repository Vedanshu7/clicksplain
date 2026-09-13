import type { AgentConnector, ChatRequest, ExplainRequest } from "../types";
import { buildChatMessages, buildChatSystemPrompt, buildSystemPrompt, buildUserMessage } from "../../shared/promptBuilder";
import {
  INSPECT_CHILDREN_DESCRIPTION,
  INSPECT_CHILDREN_NAME,
  INSPECT_CHILDREN_PARAMETERS,
  MAX_TOOL_ROUNDS,
} from "../../shared/wire";
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
    name: INSPECT_CHILDREN_NAME,
    description: INSPECT_CHILDREN_DESCRIPTION,
    parameters: INSPECT_CHILDREN_PARAMETERS,
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
  constructor(private readonly config: PuterConnectorConfig) {}

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

      const puter = await waitForPuter(signal);
      const stream = await untilAborted(
        puter.ai.chat(messages, false, {
          model,
          stream: true,
          // Force text-only on the final allowed step, mirroring the server
          // handler's own toolChoice:"none" once MAX_TOOL_ROUNDS is reached.
          tools: step < MAX_TOOL_STEPS - 1 ? [inspectChildrenTool] : undefined,
        }),
        signal
      ).catch((err: unknown) => {
        throw toError(err);
      });

      let pendingToolCall: { id: string; input: Record<string, unknown> } | null = null;
      // Same "let me check..." / blank-line / real-answer separation used by
      // every other connector: see ByokConnector.ts's textDeltasOrThrow.
      let isFirstChunkOfStep = step > 0;
      let stepText = "";
      try {
        for await (const part of stream) {
          if (signal.aborted) return;
          if (part.type === "text") {
            stepText += part.text;
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
      } catch (err) {
        throw toError(err);
      }

      if (!pendingToolCall) return;

      const result = inspectChildren(element);
      messages.push(
        {
          role: "assistant",
          // What it already said ("Let me check..."), so the next step
          // continues from it instead of repeating it.
          content: stepText,
          tool_calls: [
            { id: pendingToolCall.id, type: "function", function: { name: "inspect_children", arguments: "{}" } },
          ],
        },
        { role: "tool", tool_call_id: pendingToolCall.id, content: JSON.stringify(result) }
      );
    }
  }
}

const PUTER_LOAD_TIMEOUT_MS = 10_000;

// Pages often load Puter.js with async/defer, so it may not exist yet when the
// first pick happens: wait briefly rather than failing outright.
async function waitForPuter(signal: AbortSignal): Promise<NonNullable<Window["puter"]>> {
  const deadline = Date.now() + PUTER_LOAD_TIMEOUT_MS;
  while (!window.puter?.ai) {
    if (signal.aborted) throw new DOMException("Aborted", "AbortError");
    if (Date.now() > deadline) {
      throw new Error(
        '[clicksplain] "puter" connector requires Puter.js: add ' +
          '<script src="https://js.puter.com/v2/"></script> to the page.'
      );
    }
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  return window.puter;
}

// puter.ai.chat() takes no AbortSignal, and while its sign-in popup is open the
// promise may never settle: stop waiting on abort so a closed popover or a new
// pick doesn't leave this generator suspended forever.
function untilAborted<T>(promise: Promise<T>, signal: AbortSignal): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const onAbort = () => reject(new DOMException("Aborted", "AbortError"));
    if (signal.aborted) return onAbort();
    signal.addEventListener("abort", onAbort, { once: true });
    promise.then(resolve, reject).finally(() => signal.removeEventListener("abort", onAbort));
  });
}

// Puter rejects with plain objects (e.g. {error: {message}}), not Errors, so
// without this the user would only ever see the generic fallback message.
function toError(err: unknown): Error {
  if (err instanceof Error) return err;
  if (typeof err === "object" && err !== null) {
    const record = err as { message?: unknown; error?: { message?: unknown } };
    const message = record.message ?? record.error?.message;
    if (typeof message === "string" && message) return new Error(message);
  }
  return new Error("Puter request failed. Please try again.");
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
