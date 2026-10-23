import { stepCountIs, streamText } from "ai";
import type { AgentConnector, ChatRequest, ExplainRequest } from "../types";
import { createModel, MAX_TOKENS, type Provider } from "./gateway";
import { buildChatMessages, buildChatSystemPrompt, buildExplainMessages, buildSystemPrompt } from "../../shared/promptBuilder";
import { MAX_TOOL_ROUNDS } from "../../shared/wire";
import { createInspectChildrenTool } from "./tools";

export interface ByokConnectorConfig {
  apiKey: string;
  provider?: Provider;
  model?: string;
  /** Independently configurable from `model`: falls back to it if unset. */
  chatModel?: string;
  /**
   * Hostnames this connector may run on. Without it, BYOK only runs on local
   * dev hosts (localhost, 127.0.0.1, *.local) unless `dangerouslyAllowBrowser`
   * is set: anywhere else, every visitor can read the key from DevTools.
   */
  strictOrigins?: string[];
  /** Run on any host without a strictOrigins list. For internal tools behind auth only. */
  dangerouslyAllowBrowser?: boolean;
}

// 1 initial step + 1 tool-augmented follow-up: bounds cost/latency to at most
// one inspect_children round-trip per explain/chat call. Derived from the same
// MAX_TOOL_ROUNDS the byo-endpoint relay loop enforces (see ByoEndpointConnector.ts)
// for consistent behavior regardless of which connector is configured.
const MAX_TOOL_STEPS = MAX_TOOL_ROUNDS + 1;
const DEV_HOSTNAME_PATTERNS = [/^localhost$/, /^127\.0\.0\.1$/, /\.local$/];

// `result.textStream` deliberately excludes error parts (per the AI SDK's own
// docs on StreamTextResult): a mid-stream provider error (bad model id, rate
// limit, etc.) ends that stream silently with zero chunks and zero thrown
// exception. We iterate the full `result.stream` instead and throw explicitly
// on an error part, so AgentConnector's error contract (callers wrap explain/
// chat in try/catch to show popover.setError/setChatError) actually holds.
async function* textDeltasOrThrow(
  result: { stream: AsyncIterable<{ type: string; text?: string; error?: unknown }> }
): AsyncIterable<string> {
  // The model runs its "let me check..." preamble and the real answer together
  // even when asked not to, so the break goes in here, at the one point we can
  // detect precisely: the first text-delta right after a tool-call.
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
    if (!config.apiKey) throw new Error('[clicksplain] "byok" connector requires apiKey');
    this.guardAgainstUnsafeOrigin();
    const provider = config.provider ?? "anthropic";
    this.model = createModel(provider, config.model, config.apiKey);
    this.chatModel = createModel(provider, config.chatModel ?? config.model, config.apiKey);
  }

  async *explain(element: Element, req: ExplainRequest, signal: AbortSignal): AsyncIterable<string> {
    const result = streamText({
      model: this.model,
      system: buildSystemPrompt(),
      messages: buildExplainMessages(req),
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
    if (!this.config.strictOrigins && !looksLikeDevHost && !this.config.dangerouslyAllowBrowser) {
      throw new Error(
        `[clicksplain] BYOK connector refused to initialize on "${hostname}": it would expose ` +
          "your API key to every visitor. Use the byo-endpoint connector for public sites, or " +
          "set strictOrigins (or dangerouslyAllowBrowser) for an internal tool behind auth."
      );
    }

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
