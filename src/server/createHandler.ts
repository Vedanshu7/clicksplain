import { streamText, tool } from "ai";
import {
  buildChatMessages,
  buildChatSystemPrompt,
  buildExplainMessages,
  buildSystemPrompt,
} from "../shared/promptBuilder";
import { MAX_TOOL_ROUNDS, parseRequestBody, type ChatRequestBody, type ExplainRequestBody } from "../shared/protocol";
import { createModel, MAX_TOKENS, type Provider } from "../shared/gateway";
import { INSPECT_CHILDREN_DESCRIPTION, inspectChildrenInputSchema } from "../shared/tools";

export interface ClicksplainHandlerConfig {
  /** Key for whichever provider `provider` selects: only one provider is ever active at a time. */
  apiKey: string;
  provider?: Provider;
  model?: string;
  /** Independently configurable from `model`: falls back to it if unset. */
  chatModel?: string;
  /**
   * Shared secret the client must send as x-widget-token. Optional: unset means
   * this endpoint accepts unauthenticated requests from anyone who finds the URL
   * (fine for local testing, not for production). Note allowedOrigin/CORS does
   * NOT provide this protection: CORS only restricts which origins a *browser*
   * will let JS read the response from, it does nothing to stop curl/scripts
   * from calling this endpoint directly.
   */
  widgetToken?: string;
  allowedOrigin?: string;
  /** portkey only: base URL of the adopter's self-hosted Portkey AI Gateway. */
  portkeyGatewayUrl?: string;
  /** portkey only: which underlying provider Portkey should route this request to. */
  portkeyProvider?: string;
}

// No `execute`: a server handler has no DOM access at all. The model's tool-call
// pauses the stream (verified: finishes cleanly with finishReason "tool-calls",
// no hang/error) and we relay it to the client as a "tool-call" frame; the
// client is the one with the DOM, so it runs the query and re-POSTs with the
// result in `toolExchange` to resume the conversation.
const inspectChildrenTool = tool({
  description: INSPECT_CHILDREN_DESCRIPTION,
  inputSchema: inspectChildrenInputSchema,
});

/**
 * Runtime-agnostic core of a clicksplain "byo-endpoint" server: takes a standard
 * Web Request, returns a standard Web Response. Works unmodified on any runtime
 * that speaks the Fetch API natively (Cloudflare Workers, Vercel Edge Functions,
 * Next.js Route Handlers, Deno, Bun, Hono, ...): mount it directly as the
 * platform's handler. For classic Node-callback servers (Express, plain
 * node:http), wrap it with `toNodeHandler` from "clicksplain/server/node".
 *
 * Deliberately takes a fully-resolved config object rather than reading
 * `process.env` (or any other platform global) itself: some runtimes (e.g.
 * Cloudflare Workers) have no `process.env` at all, so env access is always the
 * caller's responsibility, keeping this function itself 100% portable.
 */
export function createClicksplainHandler(config: ClicksplainHandlerConfig): (request: Request) => Promise<Response> {
  const allowedOrigin = config.allowedOrigin ?? "*";

  return async (request: Request): Promise<Response> => {
    if (request.method === "OPTIONS") {
      return new Response(null, { headers: corsHeaders(allowedOrigin) });
    }

    if (request.method !== "POST") {
      return jsonError("Method not allowed", 405, allowedOrigin);
    }

    if (config.widgetToken) {
      if (request.headers.get("x-widget-token") !== config.widgetToken) {
        return jsonError("Unauthorized", 401, allowedOrigin);
      }
    } else {
      console.warn(
        "[clicksplain] widgetToken is not set: this endpoint accepts unauthenticated " +
          "requests from anyone who finds the URL. Fine for local testing; set widgetToken " +
          "before deploying to production."
      );
    }

    let rawBody: unknown;
    try {
      rawBody = await request.json();
    } catch {
      return jsonError("Invalid JSON body", 400, allowedOrigin);
    }

    const parsed = parseRequestBody(rawBody);
    if (!parsed.ok) {
      return jsonError(parsed.message, 400, allowedOrigin);
    }
    const body = parsed.body;

    const provider: Provider = config.provider ?? "anthropic";
    if (!config.apiKey) {
      return jsonError("Server misconfigured: apiKey not set", 500, allowedOrigin);
    }

    const isChat = body.mode === "chat";
    const systemPrompt = isChat ? buildChatSystemPrompt() : buildSystemPrompt();
    const messages = isChat
      ? buildChatMessages(body as ChatRequestBody)
      : buildExplainMessages(body as ExplainRequestBody);
    const modelId = isChat ? (config.chatModel ?? config.model) : config.model;
    const roundsUsed = body.toolExchange?.length ?? 0;

    let model;
    try {
      model = createModel(provider, modelId, config.apiKey, {
        portkeyGatewayUrl: config.portkeyGatewayUrl,
        portkeyProvider: config.portkeyProvider,
      });
    } catch (err) {
      return jsonError(err instanceof Error ? err.message : "model configuration error", 500, allowedOrigin);
    }

    const result = streamText({
      model,
      system: systemPrompt,
      messages,
      tools: { inspect_children: inspectChildrenTool },
      toolChoice: roundsUsed >= MAX_TOOL_ROUNDS ? "none" : undefined,
      maxOutputTokens: MAX_TOKENS,
    });

    return new Response(translateAiSdkStream(result), {
      headers: {
        "content-type": "text/event-stream",
        "cache-control": "no-cache",
        ...corsHeaders(allowedOrigin),
      },
    });
  };
}

function corsHeaders(allowedOrigin: string): HeadersInit {
  return {
    "access-control-allow-origin": allowedOrigin,
    "access-control-allow-methods": "POST, OPTIONS",
    "access-control-allow-headers": "content-type, x-widget-token",
  };
}

function jsonError(message: string, status: number, allowedOrigin: string): Response {
  return new Response(JSON.stringify({ type: "error", message }), {
    status,
    headers: { "content-type": "application/json", ...corsHeaders(allowedOrigin) },
  });
}

// Reshapes the AI SDK's stream into the canonical {"type":"delta"|"done"|"error"|"tool-call"}
// protocol the clicksplain client expects, so the client never needs to know which
// provider (or which AI SDK version) the server calls internally.
//
// Deliberately iterates result.stream, not result.textStream: per the AI SDK's own
// docs, textStream excludes error parts entirely (a mid-stream provider error, e.g.
// a bad model id or rate limit, ends it silently with zero chunks and no thrown
// exception). result.stream carries error parts explicitly, which we translate into
// the canonical error frame below instead of letting them vanish. A tool-call part
// similarly ends the stream (no `done`) so the client knows to execute the tool and
// resume with a follow-up request rather than treating this as a finished answer.
//
// Error messages sent to the client are always a fixed generic string, never the
// raw provider/SDK error: that upstream text can include internal details (exact
// model id, provider-side rate-limit/account text) that aren't meant for whoever is
// calling this endpoint, which (since widgetToken is the only gate) may not
// always be the real widget. The real error is still logged server-side.
function translateAiSdkStream(result: {
  stream: AsyncIterable<{
    type: string;
    text?: string;
    error?: unknown;
    toolCallId?: string;
    toolName?: string;
    input?: unknown;
  }>;
}): ReadableStream<Uint8Array> {
  const encoder = new TextEncoder();
  const GENERIC_ERROR = "Something went wrong generating a response. Please try again.";

  return new ReadableStream({
    async start(controller) {
      try {
        for await (const part of result.stream) {
          if (part.type === "text-delta") {
            controller.enqueue(encoder.encode(sseLine({ type: "delta", text: part.text })));
          } else if (part.type === "tool-call") {
            controller.enqueue(
              encoder.encode(
                sseLine({
                  type: "tool-call",
                  toolCallId: part.toolCallId,
                  toolName: part.toolName,
                  input: part.input,
                })
              )
            );
            return; // `finally` below closes the controller exactly once.
          } else if (part.type === "error") {
            console.error("[clicksplain] stream error:", part.error);
            controller.enqueue(encoder.encode(sseLine({ type: "error", message: GENERIC_ERROR })));
            return;
          }
        }
        controller.enqueue(encoder.encode(sseLine({ type: "done" })));
      } catch (err) {
        console.error("[clicksplain] stream failed:", err);
        controller.enqueue(encoder.encode(sseLine({ type: "error", message: GENERIC_ERROR })));
      } finally {
        controller.close();
      }
    },
  });
}

function sseLine(payload: unknown): string {
  return `data: ${JSON.stringify(payload)}\n\n`;
}
