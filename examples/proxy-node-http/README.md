# clicksplain reference proxy: plain node:http

This is the recommended production backend for `clicksplain`'s `byo-endpoint`
connector. It holds your LLM API key server-side (via the [Vercel AI
SDK](https://ai-sdk.dev), supporting Anthropic or OpenAI) and implements the
canonical streaming protocol the client library expects. You deploy and own
this; nothing here talks to any service run by clicksplain itself.

No framework: plain `node:http`, to keep the example runnable anywhere Node
runs. `src/server.ts` is ~15 lines: `createClicksplainHandler` from
`clicksplain/server` wrapped in `toNodeHandler` from
`clicksplain/server/node` and handed to `http.createServer`. All the actual
request handling (validation, auth, prompt building, streaming) lives in the
`clicksplain` package itself, so it's identical to what you'd get on
Cloudflare Workers, Vercel Edge, or any other Fetch-API runtime, mounting
`createClicksplainHandler` directly with zero adapter code there. The same
`toNodeHandler` adapter works for Express or any other Node-callback-style
server too: swap `http.createServer(toNodeHandler(handler))` for
`app.post("/", toNodeHandler(handler))`-style wiring.

## Setup

```bash
npm install
```

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
forwards it, it doesn't require a Portkey account of its own. This is a
different trust model from BYOK/direct providers only in that requests pass
through one more hop (your own self-hosted gateway) before reaching the
provider.

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

This endpoint holds a real, billable LLM API key. Two things you need before
going live:

**`ALLOWED_ORIGIN` is CORS, not access control.** CORS is enforced by
*browsers*: it stops a browser from letting JS on a disallowed origin read
the response. It does **not** stop `curl`, a script, or any non-browser client
from calling this endpoint directly and getting billed. The endpoint URL also
isn't a secret: it ships verbatim in your site's client-side bundle
(`Clicksplain.init({ endpoint: "..." })`), visible to anyone via view-source.
Still set `ALLOWED_ORIGIN` to your real site's origin before deploying (it's
a real, if partial, restriction), but don't treat it as the security boundary.

**Set `WIDGET_TOKEN`, the actual access control**, as a real environment
variable, then pass the same value on the client:

```js
Clicksplain.init({
  connector: "byo-endpoint",
  endpoint: "https://your-server.example.com",
  token: "the-same-value-you-set-above",
});
```

The proxy rejects any request missing a matching `x-widget-token` header with
`401`. This is defense-in-depth, not a cryptographic guarantee: the token is
visible in your site's client bundle to a sufficiently determined attacker,
same as any client-embedded credential, but it stops the realistic threat
here (scripts crawling for open, unauthenticated proxy endpoints). Left
optional so local development keeps working with zero config; if unset, the
server logs a warning on every request reminding you it's open.

**Rate limiting is not built in.** Even with `WIDGET_TOKEN` set, someone who
obtains the token (or an authenticated-but-malicious caller) could still send
requests in volume. Put a real rate limiter (your hosting platform's, or a
reverse proxy in front of this) in production; dashboard-configured limits
are easier to tune than code you'd have to redeploy.

**Known residual limitation:** the DOM-reasoning-loop's `toolExchange` field
(see below) is client-supplied and only size/shape-validated, not
cryptographically tied to a real prior tool call; an authenticated caller
could still fabricate its contents. Full protection would require server-side
session state, which this stateless handler deliberately doesn't keep. In
practice the LLM's own output is only ever rendered as plain text on the
client (never HTML), so the impact of this is cost/content-policy risk, not
code execution.

**Pre-deploy checklist:**
- [ ] `ALLOWED_ORIGIN` set to your real origin, not `*`
- [ ] `WIDGET_TOKEN` set, and the same value passed to `Clicksplain.init()`
- [ ] A real rate limiter in front of this in production

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
{ "mode": "explain", "elementInfo": {...}, "docsContext": "...", "route": "/dashboard" }

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
request: ..."}` instead of an unhandled crash. Error messages returned to the
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
`clicksplain`'s `src/shared/protocol.ts`, enforced both by the schema, which
rejects a `toolExchange` array longer than this with `400`, and by forcing a
text-only finish once one entry is already present) so a click can never turn
into an unbounded loop, even from a request that bypasses the real widget
entirely.
