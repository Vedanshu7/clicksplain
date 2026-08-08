import { streamText, tool } from "ai";
import { z } from "zod";
import { createModel, type Provider } from "./gateway";
import {
  buildChatMessages,
  buildChatSystemPrompt,
  buildExplainMessages,
  buildSystemPrompt,
  MAX_TOOL_ROUNDS,
  parseRequestBody,
  type ChatRequestBody,
  type ExplainRequestBody,
} from "./promptBuilder";

export const config = { runtime: "edge" };

const MAX_TOKENS = 400;

const INSPECT_CHILDREN_DESCRIPTION =
  "Look at the direct contents of the element being explained — useful for containers like " +
  "forms, menus, dropdowns, or lists whose own text doesn't say what's inside them (e.g. a " +
  "form's fields). Returns a short, read-only summary of each direct child: what kind of " +
  "thing it is and its label or text. Never modifies the page. Only use this if the element's " +
  "own info wasn't enough to answer confidently.";

// No `execute` — this proxy has no DOM access at all. The model's tool-call
// pauses the stream (verified: finishes cleanly with finishReason "tool-calls",
// no hang/error) and we relay it to the client as a "tool-call" frame; the
// client is the one with the DOM, so it runs the query and re-POSTs with the
// result in `toolExchange` to resume the conversation.
const inspectChildrenTool = tool({
  description: INSPECT_CHILDREN_DESCRIPTION,
  inputSchema: z.object({}),
});

export default async function handler(request: Request): Promise<Response> {
  const allowedOrigin = process.env.ALLOWED_ORIGIN ?? "*";

  if (request.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders(allowedOrigin) });
  }

  if (request.method !== "POST") {
    return jsonError("Method not allowed", 405, allowedOrigin);
  }

  const widgetToken = process.env.WIDGET_TOKEN;
  if (widgetToken) {
    if (request.headers.get("x-widget-token") !== widgetToken) {
      return jsonError("Unauthorized", 401, allowedOrigin);
    }
  } else {
    console.warn(
      "[clicksplain proxy] WIDGET_TOKEN is not set — this endpoint accepts unauthenticated " +
        "requests from anyone who finds the URL. Fine for local testing; set WIDGET_TOKEN " +
        "before deploying to production. See README.md."
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

  const provider = (process.env.PROVIDER as Provider | undefined) ?? "anthropic";
  const apiKey = process.env.API_KEY;
  if (!apiKey) {
    return jsonError("Server misconfigured: API_KEY not set", 500, allowedOrigin);
  }

  const isChat = body.mode === "chat";
  const systemPrompt = isChat ? buildChatSystemPrompt() : buildSystemPrompt();
  const messages = isChat ? buildChatMessages(body as ChatRequestBody) : buildExplainMessages(body as ExplainRequestBody);
  const modelId = isChat ? process.env.CHAT_MODEL ?? process.env.MODEL : process.env.MODEL;
  const roundsUsed = body.toolExchange?.length ?? 0;

  let model;
  try {
    model = createModel(provider, modelId, apiKey);
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
// provider (or which AI SDK version) the proxy calls internally.
//
// Deliberately iterates result.stream, not result.textStream — per the AI SDK's own
// docs, textStream excludes error parts entirely (a mid-stream provider error, e.g.
// a bad model id or rate limit, ends it silently with zero chunks and no thrown
// exception). result.stream carries error parts explicitly, which we translate into
// the canonical error frame below instead of letting them vanish. A tool-call part
// similarly ends the stream (no `done`) so the client knows to execute the tool and
// resume with a follow-up request rather than treating this as a finished answer.
//
// Error messages sent to the client are always a fixed generic string, never the
// raw provider/SDK error — that upstream text can include internal details (exact
// model id, provider-side rate-limit/account text) that aren't meant for whoever is
// calling this endpoint, which — since WIDGET_TOKEN is the only gate — may not
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
            console.error("[clicksplain proxy] stream error:", part.error);
            controller.enqueue(encoder.encode(sseLine({ type: "error", message: GENERIC_ERROR })));
            return;
          }
        }
        controller.enqueue(encoder.encode(sseLine({ type: "done" })));
      } catch (err) {
        console.error("[clicksplain proxy] stream failed:", err);
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
