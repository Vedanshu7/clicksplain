import { createServer } from "node:http";
import { createClicksplainHandler, type Provider } from "clicksplain/server";
import { toNodeHandler } from "clicksplain/server/node";

// Fixed-window limit per client IP, in memory: enough for a single-process
// server. Behind a load balancer or on serverless, back this with a shared
// store (Redis, Upstash, Cloudflare's rate limiting binding) instead.
const RATE_LIMIT = Number(process.env.RATE_LIMIT_PER_MINUTE ?? 20);
const hits = new Map<string, { count: number; windowStart: number }>();

function rateLimit(request: Request): Response | void {
  const ip = request.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ?? "local";
  const now = Date.now();
  const entry = hits.get(ip);
  if (!entry || now - entry.windowStart > 60_000) {
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

const port = Number(process.env.PORT ?? 8788);
createServer(toNodeHandler(handler)).listen(port, () => {
  console.log(`clicksplain proxy listening on http://localhost:${port}`);
});
