import { createServer } from "node:http";
import { createClicksplainHandler, type Provider } from "clicksplain/server";
import { toNodeHandler } from "clicksplain/server/node";

// Fixed-window limit per client IP, in memory: enough for a single-process
// server. Behind a load balancer or on serverless, back this with a shared
// store (Redis, Upstash, Cloudflare's rate limiting binding) instead.
const RATE_LIMIT = Number(process.env.RATE_LIMIT_PER_MINUTE ?? 20);
const WINDOW_MS = 60_000;
// Only trust X-Forwarded-For behind a proxy that sets it: otherwise any caller
// can send a fresh made-up IP on every request and never hit the limit.
const TRUST_PROXY = process.env.TRUST_PROXY === "1";
const CLIENT_IP_HEADER = "x-clicksplain-client-ip";
const hits = new Map<string, { count: number; windowStart: number }>();

setInterval(() => {
  const now = Date.now();
  for (const [ip, entry] of hits) if (now - entry.windowStart > WINDOW_MS) hits.delete(ip);
}, WINDOW_MS).unref();

function rateLimit(request: Request): Response | void {
  const ip = request.headers.get(CLIENT_IP_HEADER) ?? "unknown";
  const now = Date.now();
  const entry = hits.get(ip);
  if (!entry || now - entry.windowStart > WINDOW_MS) {
    hits.set(ip, { count: 1, windowStart: now });
    return;
  }
  entry.count += 1;
  if (entry.count > RATE_LIMIT) {
    return new Response(JSON.stringify({ type: "error", message: "Too many requests" }), {
      status: 429,
      headers: { "content-type": "application/json", "retry-after": "60" },
    });
  }
}

const handler = createClicksplainHandler({
  apiKey: process.env.API_KEY ?? "",
  provider: process.env.PROVIDER as Provider | undefined,
  model: process.env.MODEL,
  chatModel: process.env.CHAT_MODEL,
  widgetToken: process.env.WIDGET_TOKEN,
  allowedOrigins: process.env.ALLOWED_ORIGINS?.split(",").map((origin) => origin.trim()),
  portkeyGatewayUrl: process.env.PORTKEY_GATEWAY_URL,
  portkeyProvider: process.env.PORTKEY_PROVIDER,
  onRequest: rateLimit,
});

const nodeHandler = toNodeHandler(handler);
const port = Number(process.env.PORT ?? 8788);
createServer((req, res) => {
  // The fetch-style handler can't see the socket, so the client IP is passed
  // in a header set here, overwriting anything the caller sent under that name.
  const forwarded = req.headers["x-forwarded-for"];
  const proxied = TRUST_PROXY && typeof forwarded === "string" ? forwarded.split(",")[0]?.trim() : undefined;
  req.headers[CLIENT_IP_HEADER] = proxied || req.socket.remoteAddress || "unknown";
  void nodeHandler(req, res);
}).listen(port, () => {
  console.log(`clicksplain proxy listening on http://localhost:${port}`);
});
