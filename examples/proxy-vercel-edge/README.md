# onboard-agent reference proxy — Vercel Edge Function

Same canonical protocol and behavior as `examples/proxy-cloudflare-worker` (via
the [Vercel AI SDK](https://ai-sdk.dev), supporting Anthropic or OpenAI), for
teams that already deploy on Vercel. You own and deploy this yourself.

## Setup

```bash
npm install
```

Copy `api/`, `gateway.ts`, `promptBuilder.ts`, and `package.json` into a Vercel
project (works standalone, no Next.js required), or deploy this directory as
its own Vercel project directly.

### Provider config

Only one provider is active at a time, picked via `PROVIDER` (`"anthropic"` by
default, or `"openai"`). `API_KEY` always holds the key for *whichever*
provider is currently selected — there's no separate key per provider. `MODEL`
is optional for anthropic (defaults to `claude-haiku-4-5`) but required for
openai — the model catalog changes too often to safely hardcode a default.
`CHAT_MODEL` is optional for both and falls back to `MODEL`.

### Local key (for `vercel dev`)

Copy `.env.local.example` to `.env.local` and fill in your real key:

```bash
cp .env.local.example .env.local
```

`.env.local` is gitignored and auto-loaded by `vercel dev`.

### Production key (for real deploys)

Set these in your Vercel project's environment variables settings:
`API_KEY`, `PROVIDER` (optional), `MODEL`, `CHAT_MODEL` (optional),
`ALLOWED_ORIGIN`, and `WIDGET_TOKEN` — see **Security** below before deploying.

## Security — read before deploying to production

This endpoint holds a real, billable LLM API key. Two things you need before
going live:

**`ALLOWED_ORIGIN` is CORS, not access control.** CORS is enforced by
*browsers* — it stops a browser from letting JS on a disallowed origin read
the response. It does **not** stop `curl`, a script, or any non-browser client
from calling this endpoint directly and getting billed. The endpoint URL also
isn't a secret: it ships verbatim in your site's client-side bundle
(`OnboardAgent.init({ endpoint: "..." })`), visible to anyone via view-source.
Still set `ALLOWED_ORIGIN` to your real site's origin before deploying — it's
a real (if partial) restriction — but don't treat it as the security boundary.

**Set `WIDGET_TOKEN` — this is the actual access control.** Add it as a Vercel
environment variable, then pass the same value on the client:

```js
OnboardAgent.init({
  connector: "byo-endpoint",
  endpoint: "https://your-project.vercel.app/api/agent",
  token: "the-same-value-you-set-above",
});
```

The proxy rejects any request missing a matching `x-widget-token` header with
`401`. This is defense-in-depth, not a cryptographic guarantee — the token is
visible in your site's client bundle to a sufficiently determined attacker,
same as any client-embedded credential — but it stops the realistic threat
here (scripts crawling for open, unauthenticated proxy endpoints). Left
optional so local `vercel dev` keeps working with zero config; if unset, the
function logs a warning on every request reminding you it's open.

**Rate limiting is not built in.** Even with `WIDGET_TOKEN` set, someone who
obtains the token (or an authenticated-but-malicious caller) could still send
requests in volume. Use [Vercel's WAF/rate limiting](https://vercel.com/docs/security/vercel-waf/rate-limiting)
rather than hand-rolling one here — dashboard-configured limits are easier to
tune than code you'd have to redeploy.

**Known residual limitation:** the DOM-reasoning-loop's `toolExchange` field
(see below) is client-supplied and only size/shape-validated, not
cryptographically tied to a real prior tool call — an authenticated caller
could still fabricate its contents. Full protection would require server-side
session state, which this stateless function deliberately doesn't keep. In
practice the LLM's own output is only ever rendered as plain text on the
client (never HTML), so the impact of this is cost/content-policy risk, not
code execution.

**Before you deploy — checklist:**
- [ ] `ALLOWED_ORIGIN` set to your real origin, not `*`
- [ ] `WIDGET_TOKEN` set, and the same value passed to `OnboardAgent.init()`
- [ ] Rate limiting configured on the platform side (Vercel dashboard)

## Local development

```bash
npm i -g vercel
vercel dev
```

Point the client at the local URL vercel dev prints (typically `http://localhost:3000/api/agent`):

```js
OnboardAgent.init({
  connector: "byo-endpoint",
  endpoint: "http://localhost:3000/api/agent",
});
```

## Deploy

```bash
npm run deploy
```

## Protocol

Identical to the Cloudflare Worker template, including the `mode: "explain" | "chat"`
discriminator, zod-validated request bodies with generic client-facing error
messages, and the bounded read-only DOM reasoning loop — see
`examples/proxy-cloudflare-worker/README.md`.
