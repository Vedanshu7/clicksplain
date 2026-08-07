# onboard-agent

A drop-in, AI-powered "explain this UI" widget. Click the "?" button, then click any element on the page to get an LLM-generated explanation of what it does — rendered in an animated popover anchored to the element.

100% client-side library, no backend we run. Ships two ways to connect an LLM:

- **BYOK** — pass a raw API key directly (dev/prototyping only, key is visible in the browser).
- **BYO-endpoint** — point at your own tiny proxy (recommended for production). Reference templates for Cloudflare Workers and Vercel Edge Functions are in `examples/`.

## Quick start

```html
<script src="https://cdn.jsdelivr.net/npm/onboard-agent@latest/dist/onboard-agent.global.js"
        data-connector="byo-endpoint"
        data-endpoint="https://yoursite.com/api/agent"></script>
```

See `examples/demo-host-page/` for a working local demo of both connector modes.

## Theming

Every color, radius, and font in the widget (fab, cursor badge, hover highlight
box, popover, chat) is a CSS custom property, and custom properties inherit
through the widget's Shadow DOM boundary — so your site's own CSS can restyle
it with zero JavaScript:

```css
/* your site's own stylesheet — no onboard-agent-specific setup needed */
:root {
  --onboard-agent-accent: #16a34a;         /* fab, active states, links, send button */
  --onboard-agent-accent-active: #15803d;  /* hover/active shade of the accent */
  --onboard-agent-accent-contrast: #fff;   /* text/icon color drawn on top of the accent */
  --onboard-agent-surface: #052e16;        /* popover/panel background */
  --onboard-agent-border: rgba(34, 197, 94, 0.35); /* hairlines, dividers, subtle fills */
  --onboard-agent-text: #dcfce7;           /* body text color */
  --onboard-agent-danger: #dc2626;         /* error text */
  --onboard-agent-radius: 4px;             /* popover corner radius — chat/highlight
                                               radii scale proportionally from this */
  --onboard-agent-font-family: "Inter", sans-serif;
}
```

Any property you don't set keeps its default (and its own light/dark-mode
default, matched to `prefers-color-scheme`).

If you're using `OnboardAgent.init()` rather than the plain `<script data-*>`
tag, you can also set the same properties programmatically — useful for
per-tenant branding fetched at runtime. A JS `theme` value always wins over a
host-page CSS override of the same property, which in turn wins over the
built-in default:

```js
OnboardAgent.init({
  connector: "byo-endpoint",
  endpoint: "https://yoursite.com/api/agent",
  theme: {
    accent: tenantBrandColor, // e.g. fetched from an API
    surface: "#18181b",
  },
});
```

`theme` isn't available via the `<script data-*>` auto-init path — use
host-page CSS custom properties there instead, which need no JS either way.

## Status

v1 in progress — see the plan for the full roadmap.
