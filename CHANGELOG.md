# Changelog

## 2.1.0 (2026-10-23)

- `verbose` option (`data-verbose`): developer diagnostics in the console, off by default. A failed endpoint call no longer logs unless it is on.
- The inspect-mode cursor uses the theme's accent color instead of always the default purple.
- An error message now repositions the popover, so a long one no longer runs off screen.
- With reduced motion on, the "?" button no longer scales or tilts.
- A request cancelled before it started is no longer sent anyway.
- `examples/proxy-node-http`: the rate limiter uses the connection's address and only trusts `X-Forwarded-For` with `TRUST_PROXY=1`, so callers can't dodge it with a made-up header; stale entries are cleaned up.

## 2.0.0 (2026-10-23)

First npm release. Major version because it breaks the `v1.0.0` GitHub tag: `<script data-api-key>` is gone (use `byo-endpoint`, or BYOK through `clicksplain/byok`), and the BYOK connector moved out of the default bundle.

### Widget

- Three connectors: `byo-endpoint` (your own server, recommended), `puter` (no key, no backend), and BYOK via the separate `clicksplain/byok` entry.
- The default bundle no longer ships the AI SDK: `clicksplain.global.js` is about 18 KB brotlied; BYOK lives in `clicksplain-byok.global.js`.
- BYOK refuses to start on non-local hosts unless `strictOrigins` or `dangerouslyAllowBrowser` is set, and is no longer available through `<script data-api-key>`.
- Picking an element ends inspect mode, like a DevTools picker: the page stays usable while the explanation is open.
- Presses during inspect mode no longer reach the page (pointer/mouse events, not just click); pick works inside open shadow roots, on disabled controls, through browser page translation, and from the keyboard.
- `data-clicksplain-ignore` and `data-clicksplain-redact` let adopters keep regions out of explanations or out of the prompt.
- Answers come back in the page's `<html lang>` language.
- An element with no text of its own no longer borrows the text of a neighboring button or link as its description (a form next to an "Export report" button was being explained as an export form).
- New options: `siteContext` (what your site is, so jargon is explained in the right domain), `timeoutMs`, `position`, `labels`.
- Clicking a field's label explains the field it labels; inputs are described by their real role (slider, checkbox, button) instead of always "text box".
- Text right beside an element (a label before it, a hint or status after it, such as "Descale due in 12 shots") and a dropdown's choices now reach the model.
- After looking inside a container, the answer no longer repeats its "Let me check..." opener.
- Works under a strict Content-Security-Policy (no `'unsafe-inline'` styles needed).
- Accessibility: focus moves into the popover and back, visible focus rings, quieter screen reader announcements, larger close target.

### Server (`clicksplain/server`)

- `allowedOrigins` (403 for any other origin), `onRequest` hook for rate limiting, `maxBodyBytes` (413).
- Client disconnects abort the upstream LLM call.
- Tool results from the client are validated as element info, not opaque JSON.
- Logs never include the raw provider error object (page content, provider response).
- `toNodeHandler` streams the request body, honors backpressure, and no longer crashes the process on a mid-stream error.
- Portkey gateway URLs must be `https://` unless on localhost.
- `systemPrompts` option to replace the built-in instructions (e.g. your product's voice).

### Quality

- `evals/`: 41 cases run through the real widget and server against the live model, graded by code checks and a Claude judge; `evals/gepa.ts` optimizes the explanation prompt (GEPA-style reflective search) on a train/validation/test split.
