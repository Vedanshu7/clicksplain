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
  allowedOrigins: process.env.ALLOWED_ORIGINS?.split(",").map((origin) => origin.trim()),
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

Loads the pre-built widget bundle (`clicksplain/global`, copied into
`public/` by the `predev`/`prebuild` scripts in `package.json`) via `next/script`, then calls `Clicksplain.init()`
once it's loaded, pointed at the Route Handler above. Mounted once in
`src/app/layout.tsx` so it's active across the whole app.

## Setup

Requires Node 22 or later. This example installs the package from the repo
root (`"clicksplain": "file:../.."`), so build that first:

```bash
(cd ../.. && npm install && npm run build)
npm install
cp .env.local.example .env.local   # then fill in your real key
npm run dev
```

Copying this example out of the repo? Replace `file:../..` with a real
version (`npm install clicksplain`) and drop the `turbopack.root` setting in
`next.config.ts`, which only exists to follow that local link.

Open `http://localhost:3000`, click the "?" button bottom-right, then click
the export button or the invite form.

## Configuration: all through `.env.local`

| Variable | Used by | Notes |
|---|---|---|
| `API_KEY` | server | Real, billable. Never exposed to the browser. |
| `PROVIDER` | server | `"anthropic"` (default), `"openai"`, or `"portkey"`. |
| `MODEL` / `CHAT_MODEL` | server | `MODEL` also used for chat if `CHAT_MODEL` is unset. |
| `PORTKEY_GATEWAY_URL` / `PORTKEY_PROVIDER` | server | Only used when `PROVIDER=portkey`: your self-hosted [Portkey AI Gateway](https://github.com/Portkey-AI/gateway)'s base URL, and which underlying provider it should route to. See `examples/proxy-node-http/README.md`'s Provider config section for details. |
| `ALLOWED_ORIGINS` | server | Comma-separated origins allowed to call the route (`403` otherwise). Browsers send `Origin` on same-origin POSTs too, so in production set it to your own site's origin. |
| `WIDGET_TOKEN` | server | Shared token the widget must send. Visible in your page, so a speed bump, not a secret. |
| `NEXT_PUBLIC_CLICKSPLAIN_TOKEN` | client | Must match `WIDGET_TOKEN`. `NEXT_PUBLIC_*` vars are inlined into the browser bundle at build time, same visibility as any client-embedded token. |

## Security: read before deploying to production

Same considerations as every other `clicksplain` server integration: see
`examples/proxy-node-http/README.md`'s Security section for the full
picture and the pre-deploy checklist. In short: set `ALLOWED_ORIGINS` to your
site, add a rate limit through the handler's `onRequest` option (on Vercel,
backed by a shared store such as Upstash, since functions don't share
memory), and set `WIDGET_TOKEN` and `NEXT_PUBLIC_CLICKSPLAIN_TOKEN` to the
same value.

## Deploy

Deploys like any other Next.js app (Vercel, or `npm run build && npm run
start` anywhere that runs Node). Set the environment variables above as real
env vars on whatever platform you use.
