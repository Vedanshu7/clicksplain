# clicksplain reference proxy: plain node:http

This is the recommended production backend for `clicksplain`'s `byo-endpoint`
connector. It holds your LLM API key server-side (via the [Vercel AI
SDK](https://ai-sdk.dev), supporting Anthropic or OpenAI) and implements the
canonical streaming protocol the client library expects. You deploy and own
this; nothing here talks to any service run by clicksplain itself.

No framework: plain `node:http`, to keep the example runnable anywhere Node
runs. `src/server.ts` is `createClicksplainHandler` from
`clicksplain/server` wrapped in `toNodeHandler` from
`clicksplain/server/node` and handed to `http.createServer`. All the actual
request handling (validation, auth, prompt building, streaming) lives in the
`clicksplain` package itself, so it's identical to what you'd get on
Cloudflare Workers, Vercel Edge, or any other Fetch-API runtime, mounting
`createClicksplainHandler` directly with zero adapter code there. The same
`toNodeHandler` adapter works for Express or any other Node-callback-style
server too: swap `http.createServer(toNodeHandler(handler))` for
`app.post("/", toNodeHandler(handler))`-style wiring. The only other code in
it is a small in-memory rate limiter passed as `onRequest` (see Security).

## Setup

Requires Node 22 or later. This example installs the package from the repo
root (`"clicksplain": "file:../.."`), so build that first:

```bash
(cd ../.. && npm install && npm run build)
npm install
```

Copying this example out of the repo? Replace `file:../..` with a real
version (`npm install clicksplain`).

### Provider config

Only one provider is active at a time, picked via `PROVIDER` (`"anthropic"` by
default, `"openai"`, or `"portkey"`). `API_KEY` always holds the key for
*whichever* provider is currently selected. `MODEL` is optional for anthropic
(defaults to `claude-haiku-4-5`) but required for openai and portkey: the
model catalog changes too often to safely hardcode a default. `CHAT_MODEL` is
optional for all three and falls back to `MODEL`.

`PROVIDER=portkey` routes through a self-hosted, open-source [Portkey AI
Gateway](https://github.com/Portkey-AI/gateway) instead of calling a provider
directly, giving access to Portkey's much wider provider catalog (Google,
Groq, Mistral, Bedrock, and more) without this package needing per-provider
code. It requires two extra env vars: `PORTKEY_GATEWAY_URL` (your running
gateway's base URL, e.g. `http://localhost:8787/v1` for `npx
@portkey-ai/gateway` run locally) and `PORTKEY_PROVIDER` (which underlying
provider Portkey should route to, e.g. `"anthropic"`). `API_KEY` still holds
that underlying provider's own real key: Portkey's self-hosted gateway
forwards it, it doesn't require a Portkey account of its own. That means the
gateway sees your key on every request, so `PORTKEY_GATEWAY_URL` must be
`https://` unless it's on localhost (the handler refuses a plain-http remote
gateway), and it should be a gateway you run yourself.

### Local key

Copy `.env.local.example` to `.env.local` and fill in your real key:

```bash
cp .env.local.example .env.local
```

`.env.local` is gitignored and auto-loaded via Node's `--env-file` flag (see
the `dev` script in `package.json`).

### Production key

Set `API_KEY` (and the rest of the variables below) as real environment
variables on whatever host runs this. There's no platform-specific secrets
mechanism here, it's plain `process.env`.

## Security: read before deploying to production

This endpoint holds a real, billable LLM API key. The key itself never leaves
the server: the widget only ever talks to this endpoint, error responses are
always a fixed generic message, and logs carry only the error's name, status
and message. What needs protecting is the endpoint, because anyone who can
call it can spend your key. Its URL is not a secret (it ships in your page),
so set up all three of these:

**`ALLOWED_ORIGINS`: which websites may call it.** Comma-separated exact
origins (`https://app.example.com`). Any other origin, or a request with no
`Origin` header, gets `403`. Browsers can't fake `Origin`, so this stops
other websites from spending your key through their visitors. It does not
stop a script that sets the header by hand, which is what the rate limit is
for. Unset allows every origin, which is only fine locally.

**A rate limit (`onRequest`).** `src/server.ts` passes a small fixed-window,
per-IP limiter (`RATE_LIMIT_PER_MINUTE`, default 20) as `onRequest`; anything
it returns (here a `429`) is sent instead of calling the model. It keeps
counts in memory, so it only works for a single process: behind a load
balancer or on serverless, back it with a shared store (Redis, Upstash, your
platform's rate limiting) or use a limit at your proxy/CDN instead.

**`WIDGET_TOKEN`: a speed bump, not a secret.** Set it here and pass the same
value to the widget:

```js
Clicksplain.init({
  connector: "byo-endpoint",
  endpoint: "https://your-server.example.com",
  token: "the-same-value-you-set-above",
});
```

Requests without a matching `x-widget-token` header get `401`. The token is
in your page, so anyone who opens DevTools can read it; it only stops scripts
that crawl for open, tokenless endpoints. If any of these three are unset,
the server logs one warning at startup.

**Cost per request is capped regardless:** answers are limited to 400 output
tokens, request bodies to 64 KiB (`413` beyond that), every text field has a
length cap, and at most one tool round-trip is allowed per question.

**Client-supplied tool results:** the DOM reasoning loop (see below) has the
client send back what it found, and this stateless handler can't prove that
came from a real tool call. It's validated as exactly the same element-info
shape as `elementInfo`, so a forged one is no more powerful than forging
`elementInfo` itself; model output is only ever rendered as plain text.

**Pre-deploy checklist:**
- [ ] `ALLOWED_ORIGINS` set to your real site's origin(s)
- [ ] A rate limit that works for how you deploy (the in-memory one is single-process only)
- [ ] `WIDGET_TOKEN` set, and the same value passed to `Clicksplain.init()`

## Local development

```bash
npm run dev
```

Runs on `http://localhost:8788` by default (`PORT` in `.env.local`). Point the
client at it:

```js
Clicksplain.init({
  connector: "byo-endpoint",
  endpoint: "http://localhost:8788",
});
```

## Protocol

Two request shapes, discriminated by `mode`, both served from the same `POST /`:

```
POST /
Content-Type: application/json

// mode: "explain" (mode may also be omitted, defaults to "explain"); uses MODEL
// pageLanguage is optional: the page's <html lang>, so the answer uses that language
{ "mode": "explain", "elementInfo": {...}, "docsContext": "...", "route": "/dashboard", "pageLanguage": "en" }

// mode: "chat": a follow-up question in an existing popover thread, uses CHAT_MODEL
{
  "mode": "chat",
  "elementInfo": {...}, "docsContext": "...", "route": "/dashboard",
  "baseExplanation": "This button invites teammates.",
  "history": [{"role":"user","text":"..."},{"role":"assistant","text":"..."}],
  "question": "Does this send an email right away?"
}
```

Response is `text/event-stream` in both cases, one JSON object per `data:` line:

```
data: {"type":"delta","text":"This button..."}
data: {"type":"delta","text":" invites teammates."}
data: {"type":"done"}
```

or on failure: `data: {"type":"error","message":"..."}`.

Every field is validated server-side (`clicksplain`'s `src/shared/protocol.ts`
zod schema): missing/wrong-typed fields, or free-text fields exceeding a
generous size cap, get a clean `400 {"type":"error","message":"Invalid
request: ..."}` instead of an unhandled crash. If the client disconnects
mid-answer, the call to the model is aborted. Error messages returned to the
client are always a fixed generic string (the real error is logged
server-side), so they never leak upstream provider details (model ids,
account-level restriction text) to whoever is calling the endpoint.

### Read-only DOM reasoning loop

For container elements (forms, menus, lists) whose own text doesn't say what's
inside them, the model can ask to look at the element's direct children before
answering. Since this server has no DOM access at all, that lookup has to
happen client-side; the stream ends early with a `tool-call` frame instead of
`done`:

```
data: {"type":"tool-call","toolCallId":"...","toolName":"inspect_children","input":{}}
```

The client (which has the DOM) executes the read-only query itself and re-POSTs
the *original* request body plus a `toolExchange` array carrying the result:

```json
{
  "mode": "explain", "elementInfo": {...}, "docsContext": null, "route": "/signup",
  "toolExchange": [
    { "toolCallId": "...", "toolName": "inspect_children", "input": {}, "result": [ /* ElementInfo[] */ ] }
  ]
}
```

At most one such round-trip is allowed per request (`MAX_TOOL_ROUNDS` in
`clicksplain`'s `src/shared/wire.ts`, enforced both by the schema, which
rejects a `toolExchange` array longer than this with `400`, and by forcing a
text-only finish once one entry is already present) so a click can never turn
into an unbounded loop, even from a request that bypasses the real widget
entirely.
