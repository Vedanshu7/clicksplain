import { jsonSchema, streamText, tool } from "ai";
import {
  buildChatMessages,
  buildChatSystemPrompt,
  buildExplainMessages,
  buildSystemPrompt,
} from "../shared/promptBuilder";
import { parseRequestBody, type ChatRequestBody, type ExplainRequestBody } from "../shared/protocol";
import { createModel, MAX_TOKENS, type Provider } from "../shared/gateway";
import { INSPECT_CHILDREN_DESCRIPTION, INSPECT_CHILDREN_PARAMETERS, MAX_TOOL_ROUNDS } from "../shared/wire";

const DEFAULT_MAX_BODY_BYTES = 64 * 1024;
const GENERIC_ERROR = "Something went wrong generating a response. Please try again.";

export interface ClicksplainHandlerConfig {
  /** Key for whichever provider `provider` selects: only one provider is ever active at a time. */
  apiKey: string;
  provider?: Provider;
  model?: string;
  /** Independently configurable from `model`: falls back to it if unset. */
  chatModel?: string;
  /**
   * Shared secret the client must send as x-widget-token. It ships inside your
   * page, so it is not a secret from anyone who opens DevTools: it only stops
   * scripts that crawl for open, tokenless endpoints. Pair it with
   * `allowedOrigins` and an `onRequest` rate limit for real protection.
   */
  widgetToken?: string;
  /**
   * Exact origins (e.g. "https://app.example.com") allowed to call this
   * endpoint; anything else gets a 403, including requests with no Origin
   * header. Browsers can't forge Origin, so this stops other websites from
   * spending your key through their visitors; it does not stop a script that
   * sets the header by hand (that's what `onRequest` rate limiting is for).
   * Unset allows every origin: fine for local testing, not for production.
   */
  allowedOrigins?: string[];
  /**
   * Runs after the origin and token checks, before the body is read. Return a
   * Response (e.g. a 429 from your rate limiter or budget check) to reject the
   * request; return nothing to let it through.
   */
  onRequest?: (request: Request) => Response | void | Promise<Response | void>;
  /** Requests with a larger body get a 413. Default 64 KiB. */
  maxBodyBytes?: number;
  /**
   * Replace the built-in instructions, e.g. to match your product's voice.
   * Keep the built-in rules you still want (plain language, 1-3 sentences,
   * when to use inspect_children): these replace the defaults entirely.
   */
  systemPrompts?: { explain?: string; chat?: string };
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
  inputSchema: jsonSchema<Record<string, never>>(INSPECT_CHILDREN_PARAMETERS),
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
  const maxBodyBytes = config.maxBodyBytes ?? DEFAULT_MAX_BODY_BYTES;
  warnAboutOpenEndpoint(config);

  return async (request: Request): Promise<Response> => {
    const origin = request.headers.get("origin");
    const allowOrigin = resolveAllowedOrigin(origin, config.allowedOrigins);
    if (allowOrigin === null) {
      return jsonError("Origin not allowed", 403, null);
    }

    if (request.method === "OPTIONS") {
      return new Response(null, { status: 204, headers: corsHeaders(allowOrigin) });
    }

    if (request.method !== "POST") {
      return jsonError("Method not allowed", 405, allowOrigin);
    }

    if (!config.apiKey) {
      console.error("[clicksplain] apiKey is not set");
      return jsonError("Server misconfigured", 500, allowOrigin);
    }

    if (config.widgetToken && !timingSafeEqual(request.headers.get("x-widget-token") ?? "", config.widgetToken)) {
      return jsonError("Unauthorized", 401, allowOrigin);
    }

    if (config.onRequest) {
      const rejection = await config.onRequest(request);
      if (rejection) return withCors(rejection, allowOrigin);
    }

    const read = await readJsonBody(request, maxBodyBytes);
    if (!read.ok) {
      return jsonError(read.message, read.status, allowOrigin);
    }

    const parsed = parseRequestBody(read.value);
    if (!parsed.ok) {
      return jsonError(parsed.message, 400, allowOrigin);
    }
    const body = parsed.body;

    const isChat = body.mode === "chat";
    const systemPrompt = isChat
      ? (config.systemPrompts?.chat ?? buildChatSystemPrompt())
      : (config.systemPrompts?.explain ?? buildSystemPrompt());
    const messages = isChat
      ? buildChatMessages(body as ChatRequestBody)
      : buildExplainMessages(body as ExplainRequestBody);
    const modelId = isChat ? (config.chatModel ?? config.model) : config.model;
    const roundsUsed = body.toolExchange?.length ?? 0;

    let model;
    try {
      model = createModel(config.provider ?? "anthropic", modelId, config.apiKey, {
        portkeyGatewayUrl: config.portkeyGatewayUrl,
        portkeyProvider: config.portkeyProvider,
      });
    } catch (err) {
      console.error("[clicksplain] model configuration error:", describeError(err));
      return jsonError("Server misconfigured", 500, allowOrigin);
    }

    // Aborted when the client disconnects (request.signal) or stops reading
    // (the response stream's cancel), so a closed tab stops the upstream LLM
    // call instead of letting it run, and bill, to completion.
    const upstream = new AbortController();
    request.signal?.addEventListener("abort", () => upstream.abort(), { once: true });

    const result = streamText({
      model,
      system: systemPrompt,
      messages,
      tools: { inspect_children: inspectChildrenTool },
      toolChoice: roundsUsed >= MAX_TOOL_ROUNDS ? "none" : undefined,
      maxOutputTokens: MAX_TOKENS,
      abortSignal: upstream.signal,
      // The SDK's default onError console.errors the raw error object; the same
      // error also arrives as a stream part, where describeError() logs it.
      onError: () => {},
    });

    return new Response(translateAiSdkStream(result, upstream), {
      headers: {
        "content-type": "text/event-stream",
        "cache-control": "no-cache",
        ...corsHeaders(allowOrigin),
      },
    });
  };
}

function warnAboutOpenEndpoint(config: ClicksplainHandlerConfig): void {
  const missing = [
    !config.allowedOrigins && "allowedOrigins",
    !config.widgetToken && "widgetToken",
    !config.onRequest && "onRequest (rate limiting)",
  ].filter(Boolean);
  if (missing.length === 0) return;
  console.warn(
    `[clicksplain] handler created without ${missing.join(", ")}: anyone who finds this ` +
      "endpoint can spend your LLM key. Fine for local testing; set these before deploying."
  );
}

/** The value for Access-Control-Allow-Origin, or null when the request must be rejected. */
function resolveAllowedOrigin(origin: string | null, allowedOrigins: string[] | undefined): string | null {
  if (!allowedOrigins) return "*";
  if (origin && allowedOrigins.includes(origin)) return origin;
  return null;
}

function corsHeaders(allowOrigin: string | null): Record<string, string> {
  if (allowOrigin === null) return {};
  return {
    "access-control-allow-origin": allowOrigin,
    "access-control-allow-methods": "POST, OPTIONS",
    "access-control-allow-headers": "content-type, x-widget-token",
    ...(allowOrigin === "*" ? {} : { vary: "Origin" }),
  };
}

function withCors(response: Response, allowOrigin: string): Response {
  const headers = new Headers(response.headers);
  for (const [name, value] of Object.entries(corsHeaders(allowOrigin))) headers.set(name, value);
  return new Response(response.body, { status: response.status, statusText: response.statusText, headers });
}

function jsonError(message: string, status: number, allowOrigin: string | null): Response {
  return new Response(JSON.stringify({ type: "error", message }), {
    status,
    headers: { "content-type": "application/json", ...corsHeaders(allowOrigin) },
  });
}

// Content-Length alone can't be trusted (chunked bodies have none, and a client
// can lie), so the cap is enforced on the bytes actually read: an oversized body
// is rejected without ever being fully buffered.
async function readJsonBody(
  request: Request,
  maxBytes: number
): Promise<{ ok: true; value: unknown } | { ok: false; status: number; message: string }> {
  const declared = Number(request.headers.get("content-length"));
  if (declared > maxBytes) return { ok: false, status: 413, message: "Request body too large" };
  if (!request.body) return { ok: false, status: 400, message: "Invalid JSON body" };

  const reader = request.body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    total += value.byteLength;
    if (total > maxBytes) {
      await reader.cancel();
      return { ok: false, status: 413, message: "Request body too large" };
    }
    chunks.push(value);
  }

  const bytes = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }

  try {
    return { ok: true, value: JSON.parse(new TextDecoder().decode(bytes)) };
  } catch {
    return { ok: false, status: 400, message: "Invalid JSON body" };
  }
}

// Length is not hidden (the token's length isn't the secret part), but the
// comparison time doesn't depend on how many leading characters match.
function timingSafeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

// Raw AI SDK errors carry requestBodyValues and responseBody (the user's page
// content and the provider's raw reply), which don't belong in server logs.
function describeError(err: unknown): string {
  if (!(err instanceof Error)) return String(err);
  const status = (err as { statusCode?: unknown }).statusCode;
  return `${err.name}: ${err.message}${typeof status === "number" ? ` (status ${status})` : ""}`;
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
// calling this endpoint. The real error is still logged server-side.
function translateAiSdkStream(
  result: {
    stream: AsyncIterable<{
      type: string;
      text?: string;
      error?: unknown;
      toolCallId?: string;
      toolName?: string;
      input?: unknown;
    }>;
  },
  upstream: AbortController
): ReadableStream<Uint8Array> {
  const encoder = new TextEncoder();
  let cancelled = false;

  return new ReadableStream({
    async start(controller) {
      const send = (payload: unknown) => {
        if (!cancelled) controller.enqueue(encoder.encode(`data: ${JSON.stringify(payload)}\n\n`));
      };
      try {
        for await (const part of result.stream) {
          if (cancelled) return;
          if (part.type === "text-delta") {
            send({ type: "delta", text: part.text });
          } else if (part.type === "tool-call") {
            send({ type: "tool-call", toolCallId: part.toolCallId, toolName: part.toolName, input: part.input });
            return;
          } else if (part.type === "error") {
            console.error("[clicksplain] stream error:", describeError(part.error));
            send({ type: "error", message: GENERIC_ERROR });
            return;
          }
        }
        send({ type: "done" });
      } catch (err) {
        if (cancelled) return;
        console.error("[clicksplain] stream failed:", describeError(err));
        send({ type: "error", message: GENERIC_ERROR });
      } finally {
        if (!cancelled) controller.close();
      }
    },
    cancel() {
      cancelled = true;
      upstream.abort();
    },
  });
}
