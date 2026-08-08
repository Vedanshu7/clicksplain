# Contributing to Clicksplain

Thanks for wanting to help. This is a small, focused project — a client-side
widget plus two reference proxy templates — so the process is deliberately
lightweight.

Before writing code, read [CODE_STYLE.md](./CODE_STYLE.md). It describes how
the existing code is actually written, not an aspirational standard, so a
change that matches it will look like it belongs.

## Ways to contribute

- **Bug reports** — open an issue. Include the connector mode you're using
  (BYOK or byo-endpoint), browser, and a minimal repro if you can.
- **Feature requests / design discussion** — open an issue before writing
  code for anything non-trivial (new connector type, new middleware
  dependency, wire-protocol changes). Small fixes and clear bugs can go
  straight to a PR.
- **Docs** — typos and clarity fixes are always welcome, no issue needed.

## Development setup

```bash
git clone https://github.com/Vedanshu7/clicksplain.git
cd clicksplain
npm install
npm run build      # produces dist/clicksplain.global.js, .mjs, .cjs
npm run dev         # tsup --watch, rebuilds on save
npm run typecheck   # must be clean before you open a PR
```

The two reference proxies each have their own `package.json` and are
developed independently:

```bash
cd examples/proxy-cloudflare-worker && npm install && npm run dev   # wrangler dev, port 8787
cd examples/proxy-vercel-edge && npm install && npx vercel dev      # port 3000
```

Each has a `.dev.vars.example` / `.env.local.example` — copy it, fill in a
real API key, and don't commit the copy (already gitignored).

## Testing your change

There's no automated test suite yet (see CODE_STYLE.md's Tooling section —
if you want to add one, open an issue to agree on a framework first).
Changes are verified manually:

1. Build the widget (`npm run build`).
2. Serve `examples/demo-host-page/` locally (any static file server, e.g.
   `npx serve examples/demo-host-page` or `python3 -m http.server`).
3. Open `demo-byok.html` or `demo-byo-endpoint.html`, click the "?" fab, and
   click around — including `fixtures.html`, which exists specifically to
   stress-test Shadow DOM isolation against hostile host-page CSS
   (colliding class names, `z-index` traps, `* { all: revert }`). If you
   touch positioning, Shadow DOM boundaries, or theming, check this page.
4. If your change touches a proxy, hit it directly with `curl` for the
   error paths (missing fields, oversized payloads, wrong/missing token) —
   don't only test the happy path through the widget.

## Pull requests

- Keep PRs scoped to one change. A bug fix doesn't need a drive-by refactor
  riding along with it.
- Write the PR description around *why*, not a restatement of the diff.
- `npm run typecheck` and `npm run build` must both pass.
- If you touched one reference proxy's behavior (validation, auth, error
  shape), check whether the other one needs the same fix — they implement
  the same wire protocol and are expected to stay in sync.
- Commit messages: short, single-line, imperative ("Fix popover clipping on
  narrow viewports", not "Fixed a bug where...").

## Reporting a security issue

Please don't open a public issue for a vulnerability that affects a live
deployment pattern (e.g. something that would let an unauthenticated caller
drain an adopter's LLM budget). Email the maintainer directly instead —
see the GitHub profile for contact info — and open a public issue once a fix
is available.

## Code of conduct

This project follows the guidelines in [CODE_OF_CONDUCT.md](./CODE_OF_CONDUCT.md).
