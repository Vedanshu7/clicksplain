# clicksplain reference proxy — Cloudflare Worker

This is the recommended production backend for `clicksplain`'s `byo-endpoint`
connector. It holds your LLM API key server-side (via the [Vercel AI
SDK](https://ai-sdk.dev), supporting Anthropic or OpenAI) and implements the
canonical streaming protocol the client library expects. You deploy and own
this — nothing here talks to any service run by clicksplain itself.

## Setup

```bash
npm install
```

### Provider config

Only one provider is active at a time, picked via `PROVIDER` in `wrangler.toml`
(`"anthropic"` by default, or `"openai"`). `API_KEY` always holds the key for
*whichever* provider is currently selected — there's no separate
`ANTHROPIC_API_KEY`/`OPENAI_API_KEY` pair to keep in sync. `MODEL` is optional
for anthropic (defaults to `claude-haiku-4-5`) but required for openai — the
model catalog changes too often to safely hardcode a default. `CHAT_MODEL` is
optional for both and falls back to `MODEL` (see Protocol below for how it's used).

### Local key (for `wrangler dev`)

Copy `.dev.vars.example` to `.dev.vars` and fill in your real key:

```bash
cp .dev.vars.example .dev.vars
```

`.dev.vars` is gitignored and auto-loaded by `wrangler dev` — no `export`/`source`
step needed, and the key never gets committed or deployed. It can also override
`PROVIDER`/`MODEL`/`CHAT_MODEL` locally without touching `wrangler.toml`.

### Production key (for real deploys)

```bash
wrangler secret put API_KEY
```

This stores the key encrypted in your Cloudflare account, separate from
`.dev.vars`.

## Security — read before deploying to production

This endpoint holds a real, billable LLM API key. Two things you need before
going live:

**`ALLOWED_ORIGIN` is CORS, not access control.** CORS is enforced by
*browsers* — it stops a browser from letting JS on a disallowed origin read
the response. It does **not** stop `curl`, a script, or any non-browser client
from calling this endpoint directly and getting billed. The endpoint URL also
isn't a secret: it ships verbatim in your site's client-side bundle
(`Clicksplain.init({ endpoint: "..." })`), visible to anyone via view-source.
Still set `ALLOWED_ORIGIN` to your real site's origin before deploying — it's
a real (if partial) restriction — but don't treat it as the security boundary.

**Set `WIDGET_TOKEN` — this is the actual access control:**

```bash
wrangler secret put WIDGET_TOKEN
```

Then pass the same value on the client:

```js
Clicksplain.init({
  connector: "byo-endpoint",
  endpoint: "https://your-worker.workers.dev",
  token: "the-same-value-you-set-above",
});
```

The proxy rejects any request missing a matching `x-widget-token` header with
`401`. This is defense-in-depth, not a cryptographic guarantee — the token is
visible in your site's client bundle to a sufficiently determined attacker,
same as any client-embedded credential — but it stops the realistic threat
here (scripts crawling for open, unauthenticated proxy endpoints). Left
optional so local `wrangler dev` keeps working with zero config; if unset, the
Worker logs a warning on every request reminding you it's open.

**Rate limiting is not built in.** Even with `WIDGET_TOKEN` set, someone who
obtains the token (or an authenticated-but-malicious caller) could still send
requests in volume. Use your platform's own rate limiting rather than
hand-rolling one here — [Cloudflare's Rate Limiting
Rules](https://developers.cloudflare.com/waf/rate-limiting-rules/) is exactly
what this is for, and dashboard-configured limits are easier to tune than
code you'd have to redeploy.

**Known residual limitation:** the DOM-reasoning-loop's `toolExchange` field
(see below) is client-supplied and only size/shape-validated, not
cryptographically tied to a real prior tool call — an authenticated caller
could still fabricate its contents. Full protection would require server-side
session state, which this stateless proxy deliberately doesn't keep. In
practice the LLM's own output is only ever rendered as plain text on the
client (never HTML), so the impact of this is cost/content-policy risk, not
code execution.

**Before you deploy — checklist:**
- [ ] `ALLOWED_ORIGIN` set to your real origin, not `*`
- [ ] `WIDGET_TOKEN` set, and the same value passed to `Clicksplain.init()`
- [ ] Rate limiting configured on the platform side (Cloudflare dashboard)

## Local development

```bash
npm run dev
```

Runs on `http://localhost:8787` by default, using the key from `.dev.vars`.
Point the client at it:

```js
Clicksplain.init({
  connector: "byo-endpoint",
  endpoint: "http://localhost:8787",
});
```

## Deploy

```bash
npm run deploy
```

## Protocol

Two request shapes, discriminated by `mode`, both served from the same `POST /`:

```
POST /
Content-Type: application/json

// mode: "explain" (mode may also be omitted, defaults to "explain") — uses MODEL
{ "mode": "explain", "elementInfo": {...}, "docsContext": "...", "route": "/dashboard" }

// mode: "chat" — a follow-up question in an existing popover thread, uses CHAT_MODEL
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

Every field is validated server-side (`src/promptBuilder.ts`'s zod schema) —
missing/wrong-typed fields, or free-text fields exceeding a generous size cap,
get a clean `400 {"type":"error","message":"Invalid request: ..."}` instead of
an unhandled crash. Error messages returned to the client are always a fixed
generic string (the real error is logged server-side), so they never leak
upstream provider details (model ids, account-level restriction text) to
whoever is calling the endpoint.

### Read-only DOM reasoning loop

For container elements (forms, menus, lists) whose own text doesn't say what's
inside them, the model can ask to look at the element's direct children before
answering. Since this proxy has no DOM access at all, that lookup has to happen
client-side — the stream ends early with a `tool-call` frame instead of `done`:

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
`src/promptBuilder.ts`, enforced both by the schema — a `toolExchange` array
longer than this is rejected with `400` — and by forcing a text-only finish
once one entry is already present) so a click can never turn into an unbounded
loop, even from a request that bypasses the real widget entirely.
