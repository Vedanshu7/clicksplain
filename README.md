# clicksplain

[![npm version](https://img.shields.io/npm/v/clicksplain.svg)](https://www.npmjs.com/package/clicksplain)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](./LICENSE)

A drop-in, AI-powered "explain this UI" widget. Click the "?" button, then click any element on the page to get an LLM-generated explanation of what it does: rendered in an animated popover anchored to the element.

100% client-side library, no backend we run. Ships two ways to connect an LLM:

- **BYOK**: pass a raw API key directly (dev/prototyping only, key is visible in the browser).
- **BYO-endpoint**: point at your own tiny proxy (recommended for production). `clicksplain/server` ships the actual handler; mount it in whatever server you already run (see below) or copy the reference example in `examples/proxy-node-http`.

## Quick start

```html
<script src="https://cdn.jsdelivr.net/npm/clicksplain@latest/dist/clicksplain.global.js"
        data-connector="byo-endpoint"
        data-endpoint="https://yoursite.com/api/agent"></script>
```

Or via npm:

```bash
npm install clicksplain
```

See `examples/demo-host-page/` for a working local demo of both connector modes.

## Server-side (byo-endpoint backend)

`clicksplain/server` exports `createClicksplainHandler`, a runtime-agnostic
`(Request) => Promise<Response>` implementing the full byo-endpoint protocol
(validation, auth, prompt building, streaming). Anything that speaks the
standard Fetch API needs zero adapter code: Cloudflare Workers, Vercel Edge
Functions, Next.js Route Handlers, Deno, Bun, Hono.

```ts
// app/api/clicksplain/route.ts (Next.js), or any other Fetch-API runtime
import { createClicksplainHandler } from "clicksplain/server";

export const POST = createClicksplainHandler({
  apiKey: process.env.CLICKSPLAIN_API_KEY!,
  widgetToken: process.env.CLICKSPLAIN_WIDGET_TOKEN, // optional but recommended
});
```

For classic Node-callback servers (Express, plain `node:http`), wrap it with
`toNodeHandler` from `clicksplain/server/node`:

```ts
import { createServer } from "node:http";
import { createClicksplainHandler } from "clicksplain/server";
import { toNodeHandler } from "clicksplain/server/node";

const handler = createClicksplainHandler({ apiKey: process.env.API_KEY! });
createServer(toNodeHandler(handler)).listen(8788);
```

`createClicksplainHandler` never reads `process.env` (or any platform global)
itself: every config value is passed in explicitly, since some runtimes
(Cloudflare Workers) have no `process.env` at all. See
`examples/proxy-node-http` for the Node-adapter path end-to-end; the same
handler mounts with zero adapter code on Cloudflare Workers, Vercel Edge
Functions, or any other Fetch-API runtime, as shown in the snippet above.

## Theming

Every color, radius, and font in the widget (fab, cursor badge, hover highlight
box, popover, chat) is a CSS custom property, and custom properties inherit
through the widget's Shadow DOM boundary, so your site's own CSS can restyle
it with zero JavaScript:

```css
/* your site's own stylesheet: no clicksplain-specific setup needed */
:root {
  --clicksplain-accent: #16a34a;         /* fab, active states, links, send button */
  --clicksplain-accent-active: #15803d;  /* hover/active shade of the accent */
  --clicksplain-accent-contrast: #fff;   /* text/icon color drawn on top of the accent */
  --clicksplain-surface: #052e16;        /* popover/panel background */
  --clicksplain-border: rgba(34, 197, 94, 0.35); /* hairlines, dividers, subtle fills */
  --clicksplain-text: #dcfce7;           /* body text color */
  --clicksplain-danger: #dc2626;         /* error text */
  --clicksplain-radius: 4px;             /* popover corner radius: chat/highlight
                                        radii scale proportionally from this */
  --clicksplain-font-family: "Inter", sans-serif;
}
```

Any property you don't set keeps its default (and its own light/dark-mode
default, matched to `prefers-color-scheme`).

If you're using `Clicksplain.init()` rather than the plain `<script data-*>`
tag, you can also set the same properties programmatically: useful for
per-tenant branding fetched at runtime. A JS `theme` value always wins over a
host-page CSS override of the same property, which in turn wins over the
built-in default:

```js
Clicksplain.init({
  connector: "byo-endpoint",
  endpoint: "https://yoursite.com/api/agent",
  theme: {
    accent: tenantBrandColor, // e.g. fetched from an API
    surface: "#18181b",
  },
});
```

`theme` isn't available via the `<script data-*>` auto-init path: use
host-page CSS custom properties there instead, which need no JS either way.

## Status

Core widget, chat follow-ups, multi-provider gateway, and the read-only DOM
reasoning loop are built and verified against both connector modes.

## Contributing

Bug reports, feature discussion, and PRs are welcome: see
[CONTRIBUTING.md](./CONTRIBUTING.md) for the dev setup and process, and
[CODE_STYLE.md](./CODE_STYLE.md) for how the code here is written.

## License

[MIT](./LICENSE)
