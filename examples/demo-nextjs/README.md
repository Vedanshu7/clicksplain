# clicksplain + Next.js example

A minimal Next.js (App Router) app showing `clicksplain` mounted end to end:
the server half via a Route Handler, the client half via the widget's
pre-built script, both configured entirely from `.env.local`.

## Server-side: `src/app/api/clicksplain/route.ts`

```ts
import { createClicksplainHandler, type Provider } from "clicksplain/server";

const handler = createClicksplainHandler({
  apiKey: process.env.API_KEY ?? "",
  provider: process.env.PROVIDER as Provider | undefined,
  model: process.env.MODEL,
  chatModel: process.env.CHAT_MODEL,
  widgetToken: process.env.WIDGET_TOKEN,
  allowedOrigin: process.env.ALLOWED_ORIGIN,
  portkeyGatewayUrl: process.env.PORTKEY_GATEWAY_URL,
  portkeyProvider: process.env.PORTKEY_PROVIDER,
});

export const POST = handler;
export const OPTIONS = handler;
```

Route Handlers already speak the standard Fetch API (`Request` in, `Response`
out), so `createClicksplainHandler` mounts directly: no adapter needed, same
as Cloudflare Workers or Vercel Edge Functions.

## Client-side: `src/app/ClicksplainWidget.tsx`

Loads the pre-built widget bundle (`clicksplain.global.js`, copied from
`node_modules/clicksplain/dist` into `public/` by the `predev`/`prebuild`
scripts in `package.json`) via `next/script`, then calls `Clicksplain.init()`
once it's loaded, pointed at the Route Handler above. Mounted once in
`src/app/layout.tsx` so it's active across the whole app.

## Setup

```bash
npm install
cp .env.local.example .env.local   # then fill in your real key
npm run dev
```

Open `http://localhost:3000`, click the "?" button bottom-right, then click
the export button or the invite form.

## Configuration: all through `.env.local`

| Variable | Used by | Notes |
|---|---|---|
| `API_KEY` | server | Real, billable. Never exposed to the browser. |
| `PROVIDER` | server | `"anthropic"` (default), `"openai"`, or `"portkey"`. |
| `MODEL` / `CHAT_MODEL` | server | `MODEL` also used for chat if `CHAT_MODEL` is unset. |
| `PORTKEY_GATEWAY_URL` / `PORTKEY_PROVIDER` | server | Only used when `PROVIDER=portkey`: your self-hosted [Portkey AI Gateway](https://github.com/Portkey-AI/gateway)'s base URL, and which underlying provider it should route to. See `examples/proxy-node-http/README.md`'s Provider config section for details. |
| `ALLOWED_ORIGIN` | server | CORS only, largely moot here since the widget calls the same origin. |
| `WIDGET_TOKEN` | server | The real access control: see Security below. |
| `NEXT_PUBLIC_CLICKSPLAIN_TOKEN` | client | Must match `WIDGET_TOKEN`. `NEXT_PUBLIC_*` vars are inlined into the browser bundle at build time, same visibility as any client-embedded token. |

## Security: read before deploying to production

Same considerations as every other `clicksplain` server integration: see
`examples/proxy-node-http/README.md`'s Security section for the full
explanation of why `WIDGET_TOKEN` (not `ALLOWED_ORIGIN`) is the real access
control, and the pre-deploy checklist. Set `WIDGET_TOKEN` and
`NEXT_PUBLIC_CLICKSPLAIN_TOKEN` to the same real value, and put a rate limiter
in front of this in production; none is built in.

## Deploy

Deploys like any other Next.js app (Vercel, or `npm run build && npm run
start` anywhere that runs Node). Set the environment variables above as real
env vars on whatever platform you use.
