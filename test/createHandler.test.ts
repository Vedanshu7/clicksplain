import { inspect } from "node:util";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createClicksplainHandler, type ClicksplainHandlerConfig } from "../src/server/createHandler";
import { explainBody } from "./fixtures";

const SENTINEL_KEY = "sk-ant-SENTINEL-must-never-leak";
const ORIGIN = "https://app.example.com";

function anthropicSse(events: Array<Record<string, unknown>>): Response {
  const body = events.map((event) => `event: ${event.type}\ndata: ${JSON.stringify(event)}\n\n`).join("");
  return new Response(body, { headers: { "content-type": "text/event-stream" } });
}

const messageStart = {
  type: "message_start",
  message: {
    id: "msg_1",
    type: "message",
    role: "assistant",
    model: "claude-haiku-4-5",
    content: [],
    stop_reason: null,
    stop_sequence: null,
    usage: { input_tokens: 10, output_tokens: 1 },
  },
};

const textAnswer = (...deltas: string[]) =>
  anthropicSse([
    messageStart,
    { type: "content_block_start", index: 0, content_block: { type: "text", text: "" } },
    ...deltas.map((text) => ({ type: "content_block_delta", index: 0, delta: { type: "text_delta", text } })),
    { type: "content_block_stop", index: 0 },
    { type: "message_delta", delta: { stop_reason: "end_turn", stop_sequence: null }, usage: { output_tokens: 5 } },
    { type: "message_stop" },
  ]);

const toolCallAnswer = () =>
  anthropicSse([
    messageStart,
    {
      type: "content_block_start",
      index: 0,
      content_block: { type: "tool_use", id: "toolu_1", name: "inspect_children", input: {} },
    },
    { type: "content_block_delta", index: 0, delta: { type: "input_json_delta", partial_json: "{}" } },
    { type: "content_block_stop", index: 0 },
    { type: "message_delta", delta: { stop_reason: "tool_use", stop_sequence: null }, usage: { output_tokens: 5 } },
    { type: "message_stop" },
  ]);

function handler(overrides: Partial<ClicksplainHandlerConfig> = {}) {
  return createClicksplainHandler({ apiKey: SENTINEL_KEY, allowedOrigins: [ORIGIN], widgetToken: "tok", ...overrides });
}

function post(body: unknown, headers: Record<string, string> = {}): Request {
  return new Request("http://localhost/api/clicksplain", {
    method: "POST",
    headers: { origin: ORIGIN, "x-widget-token": "tok", "content-type": "application/json", ...headers },
    body: typeof body === "string" ? body : JSON.stringify(body),
  });
}

async function frames(response: Response): Promise<unknown[]> {
  const text = await response.text();
  return text
    .split("\n\n")
    .filter(Boolean)
    .map((frame) => JSON.parse(frame.replace(/^data: /, "")));
}

let logged: string[];
let upstream: ReturnType<typeof vi.fn>;

beforeEach(() => {
  logged = [];
  // inspect, not String: Node's console prints an error object's own fields
  // (requestBodyValues, responseBody), and those are exactly what must not leak.
  const record = (...args: unknown[]) =>
    logged.push(args.map((arg) => (typeof arg === "string" ? arg : inspect(arg, { depth: 6 }))).join(" "));
  vi.spyOn(console, "error").mockImplementation(record);
  vi.spyOn(console, "warn").mockImplementation(record);
  upstream = vi.fn();
  vi.stubGlobal("fetch", upstream);
});

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe("createClicksplainHandler access control", () => {
  it("answers a preflight from an allowed origin", async () => {
    const response = await handler()(new Request("http://localhost/", { method: "OPTIONS", headers: { origin: ORIGIN } }));
    expect(response.status).toBe(204);
    expect(response.headers.get("access-control-allow-origin")).toBe(ORIGIN);
    expect(response.headers.get("vary")).toBe("Origin");
  });

  it("rejects other origins and requests with no Origin at all", async () => {
    expect((await handler()(post(explainBody, { origin: "https://evil.example" }))).status).toBe(403);
    const noOrigin = new Request("http://localhost/", { method: "POST", body: JSON.stringify(explainBody) });
    expect((await handler()(noOrigin)).status).toBe(403);
  });

  it("allows any origin when allowedOrigins is unset", async () => {
    upstream.mockResolvedValue(textAnswer("Hi"));
    const response = await handler({ allowedOrigins: undefined })(post(explainBody, { origin: "https://any.example" }));
    expect(response.status).toBe(200);
    expect(response.headers.get("access-control-allow-origin")).toBe("*");
    await response.text();
  });

  it("rejects a wrong widget token", async () => {
    expect((await handler()(post(explainBody, { "x-widget-token": "nope" }))).status).toBe(401);
  });

  it("rejects non-POST methods", async () => {
    const response = await handler()(new Request("http://localhost/", { headers: { origin: ORIGIN } }));
    expect(response.status).toBe(405);
  });

  it("lets onRequest short-circuit with its own response, keeping CORS headers", async () => {
    const limited = handler({ onRequest: () => new Response("slow down", { status: 429 }) });
    const response = await limited(post(explainBody));
    expect(response.status).toBe(429);
    expect(response.headers.get("access-control-allow-origin")).toBe(ORIGIN);
    expect(upstream).not.toHaveBeenCalled();
  });

  it("warns once, at creation, when the endpoint is left open", () => {
    createClicksplainHandler({ apiKey: SENTINEL_KEY });
    expect(logged.filter((line) => line.includes("allowedOrigins"))).toHaveLength(1);
  });
});

describe("createClicksplainHandler request validation", () => {
  it("rejects an oversized body by declared length", async () => {
    const response = await handler({ maxBodyBytes: 100 })(post({ ...explainBody, route: "/".repeat(200) }));
    expect(response.status).toBe(413);
  });

  it("rejects an oversized body that has no Content-Length", async () => {
    const encoder = new TextEncoder();
    const body = new ReadableStream<Uint8Array>({
      start(controller) {
        for (let i = 0; i < 10; i++) controller.enqueue(encoder.encode("x".repeat(50)));
        controller.close();
      },
    });
    const request = new Request("http://localhost/", {
      method: "POST",
      headers: { origin: ORIGIN, "x-widget-token": "tok" },
      body,
      duplex: "half",
    } as RequestInit);
    expect((await handler({ maxBodyBytes: 100 })(request)).status).toBe(413);
  });

  it("rejects malformed JSON and schema violations with 400", async () => {
    expect((await handler()(post("{oops"))).status).toBe(400);
    expect((await handler()(post({ route: "/" }))).status).toBe(400);
  });

  it("reports a missing apiKey without echoing configuration details", async () => {
    const response = await handler({ apiKey: "" })(post(explainBody));
    expect(response.status).toBe(500);
    expect(await response.json()).toEqual({ type: "error", message: "Server misconfigured" });
  });
});

describe("createClicksplainHandler streaming", () => {
  it("translates a streamed answer into delta frames and a final done", async () => {
    upstream.mockResolvedValue(textAnswer("Saves ", "your changes."));
    const response = await handler()(post(explainBody));
    expect(response.headers.get("content-type")).toBe("text/event-stream");
    expect(await frames(response)).toEqual([
      { type: "delta", text: "Saves " },
      { type: "delta", text: "your changes." },
      { type: "done" },
    ]);
  });

  it("relays a tool call to the client instead of finishing", async () => {
    upstream.mockResolvedValue(toolCallAnswer());
    const response = await handler()(post(explainBody));
    expect(await frames(response)).toEqual([
      { type: "tool-call", toolCallId: "toolu_1", toolName: "inspect_children", input: {} },
    ]);
  });

  it("offers the tool on the first round only, forcing a text answer once it's used", async () => {
    upstream.mockImplementation(async () => textAnswer("Done."));
    const toolExchange = [{ toolCallId: "toolu_1", toolName: "inspect_children", input: {}, result: [] }];
    await handler()(post(explainBody)).then((response) => response.text());
    await handler()(post({ ...explainBody, toolExchange })).then((response) => response.text());
    const [first, resumed] = upstream.mock.calls.map((call) => JSON.parse(String(call[1]?.body)));
    expect(first.tools).toHaveLength(1);
    // The Anthropic provider expresses toolChoice "none" by sending no tools.
    expect(resumed.tools).toBeUndefined();
  });

  it("uses systemPrompts in place of the built-in instructions", async () => {
    upstream.mockResolvedValue(textAnswer("Hi"));
    await handler({ systemPrompts: { explain: "Answer like a pirate." } })(post(explainBody)).then((r) => r.text());
    const sent = JSON.parse(String(upstream.mock.calls[0]?.[1]?.body));
    expect(JSON.stringify(sent.system)).toContain("Answer like a pirate.");
  });

  it("sends the key only to the provider, never to the client or the logs", async () => {
    upstream.mockResolvedValue(
      new Response(JSON.stringify({ type: "error", error: { type: "authentication_error", message: "invalid x-api-key" } }), {
        status: 401,
        headers: { "content-type": "application/json" },
      })
    );
    const response = await handler()(post(explainBody));
    const body = await response.text();

    expect(JSON.parse(body.replace(/^data: /, ""))).toEqual({
      type: "error",
      message: "Something went wrong generating a response. Please try again.",
    });
    expect(body).not.toContain(SENTINEL_KEY);
    expect(logged.join("\n")).not.toContain(SENTINEL_KEY);
    // The page content the model was asked about stays out of the logs too.
    expect(logged.join("\n")).not.toContain("btn-primary");
    const providerHeaders = new Headers(upstream.mock.calls[0]?.[1]?.headers);
    expect(providerHeaders.get("x-api-key")).toBe(SENTINEL_KEY);
  });

  it("aborts the provider call when the client disconnects", async () => {
    let providerSignal: AbortSignal | undefined;
    upstream.mockImplementation((_url: string, init: RequestInit) => {
      providerSignal = init.signal ?? undefined;
      return new Promise(() => {});
    });
    const client = new AbortController();
    const request = new Request(post(explainBody), { signal: client.signal });
    const response = await handler()(request);
    const reader = response.body!.getReader();
    const pending = reader.read();
    await vi.waitFor(() => expect(providerSignal).toBeDefined());
    client.abort();
    await vi.waitFor(() => expect(providerSignal?.aborted).toBe(true));
    await reader.cancel();
    void pending.catch(() => {});
  });
});
