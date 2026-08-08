import { stepCountIs, streamText } from "ai";
import type { AgentConnector, ChatRequest, ExplainRequest } from "../types";
import { createModel, type Provider } from "./gateway";
import { buildChatMessages, buildChatSystemPrompt, buildSystemPrompt, buildUserMessage } from "./promptBuilder";
import { createInspectChildrenTool } from "./tools";

export interface ByokConnectorConfig {
  apiKey: string;
  provider?: Provider;
  model?: string;
  /** Independently configurable from `model`: falls back to it if unset. */
  chatModel?: string;
  /**
   * If set, the connector refuses to initialize on any hostname not in this list.
   * Opt-in enforcement: we don't guess at what counts as "safe" by default.
   */
  strictOrigins?: string[];
}

const MAX_TOKENS = 400;
// 1 initial step + 1 tool-augmented follow-up: bounds cost/latency to at most
// one inspect_children round-trip per explain/chat call. Matches the byo-endpoint
// relay loop's own bound (see ByoEndpointConnector.ts) for consistent behavior
// regardless of which connector is configured.
const MAX_TOOL_STEPS = 2;
const DEV_HOSTNAME_PATTERNS = [/^localhost$/, /^127\.0\.0\.1$/, /\.local$/];

/**
 * `result.textStream` deliberately excludes error parts (per the AI SDK's own
 * docs on StreamTextResult): a mid-stream provider error (bad model id, rate
 * limit, etc.) ends that stream silently with zero chunks and zero thrown
 * exception. We iterate the full `result.stream` instead and throw explicitly
 * on an error part, so AgentConnector's error contract (callers wrap explain/
 * chat in try/catch to show popover.setError/setChatError) actually holds.
 */
async function* textDeltasOrThrow(
  result: { stream: AsyncIterable<{ type: string; text?: string; error?: unknown }> }
): AsyncIterable<string> {
  // Prompting the model to leave a blank line after its "let me check..." preamble
  // and before the real answer proved unreliable (verified against the live API,
  // it consistently runs them together with no separator). Injecting the break here
  // instead, at the one point we can detect precisely: the first text-delta of a new
  // step right after a tool-call is the start of the real answer.
  let justUsedTool = false;
  for await (const part of result.stream) {
    if (part.type === "tool-call") {
      justUsedTool = true;
    } else if (part.type === "text-delta" && typeof part.text === "string") {
      if (justUsedTool) {
        justUsedTool = false;
        yield `\n\n${part.text}`;
      } else {
        yield part.text;
      }
    } else if (part.type === "error") {
      throw part.error instanceof Error ? part.error : new Error(String(part.error));
    }
  }
}

/**
 * Calls the LLM provider directly from the browser using a raw API key.
 * Zero backend, but the key is fully visible via DevTools → Network: see the
 * console warning below. Intended for local dev, prototyping, and internal
 * tools behind auth, never a public production site (use ByoEndpointConnector there).
 */
export class ByokConnector implements AgentConnector {
  private readonly model: ReturnType<typeof createModel>;
  private readonly chatModel: ReturnType<typeof createModel>;

  constructor(private readonly config: ByokConnectorConfig) {
    const provider = config.provider ?? "anthropic";
    this.model = createModel(provider, config.model, config.apiKey);
    this.chatModel = createModel(provider, config.chatModel ?? config.model, config.apiKey);
    this.guardAgainstUnsafeOrigin();
  }

  async *explain(element: Element, req: ExplainRequest, signal: AbortSignal): AsyncIterable<string> {
    const result = streamText({
      model: this.model,
      system: buildSystemPrompt(),
      messages: [{ role: "user", content: buildUserMessage(req) }],
      tools: { inspect_children: createInspectChildrenTool(element) },
      stopWhen: stepCountIs(MAX_TOOL_STEPS),
      abortSignal: signal,
      maxOutputTokens: MAX_TOKENS,
    });

    yield* textDeltasOrThrow(result);
  }

  async *chat(element: Element, req: ChatRequest, signal: AbortSignal): AsyncIterable<string> {
    const result = streamText({
      model: this.chatModel,
      system: buildChatSystemPrompt(),
      messages: buildChatMessages(req),
      tools: { inspect_children: createInspectChildrenTool(element) },
      stopWhen: stepCountIs(MAX_TOOL_STEPS),
      abortSignal: signal,
      maxOutputTokens: MAX_TOKENS,
    });

    yield* textDeltasOrThrow(result);
  }

  private guardAgainstUnsafeOrigin(): void {
    const hostname = window.location.hostname;

    if (this.config.strictOrigins && !this.config.strictOrigins.includes(hostname)) {
      throw new Error(
        `[clicksplain] BYOK connector refused to initialize: "${hostname}" is not in ` +
          "strictOrigins. BYOK exposes your API key in the browser and must not run on " +
          "untrusted origins."
      );
    }

    const looksLikeDevHost = DEV_HOSTNAME_PATTERNS.some((pattern) => pattern.test(hostname));
    const hostWarning = looksLikeDevHost
      ? ""
      : `\n(Current host "${hostname}" does not look like a local dev host.)`;

    console.warn(
      "%c⚠️ clicksplain: BYOK mode is active",
      "font-weight:bold;font-size:13px;",
      "\nYour LLM API key is sent directly from this page and is fully visible to anyone " +
        "via DevTools → Network. Use BYOK only for local development, prototyping, or " +
        "internal tools behind auth, never on a public production site. For production, " +
        "use the 'byo-endpoint' connector instead." +
        hostWarning
    );
  }
}
