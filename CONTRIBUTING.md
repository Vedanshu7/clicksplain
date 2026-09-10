# Contributing to Clicksplain

Thanks for wanting to help. This is a small, focused project (a client-side
widget, a runtime-agnostic server handler, and a reference proxy example), so
the process is deliberately lightweight.

Before writing code, read [CODE_STYLE.md](./CODE_STYLE.md). It describes how
the existing code is actually written, not an aspirational standard, so a
change that matches it will look like it belongs.

## Ways to contribute

- **Bug reports**: open an issue. Include the connector mode you're using
  (BYOK or byo-endpoint), browser, and a minimal repro if you can.
- **Feature requests / design discussion**: open an issue before writing
  code for anything non-trivial (new connector type, new middleware
  dependency, wire-protocol changes). Small fixes and clear bugs can go
  straight to a PR.
- **Docs**: typos and clarity fixes are always welcome, no issue needed.

## Development setup

```bash
git clone https://github.com/Vedanshu7/clicksplain.git
cd clicksplain
npm install
npm run build      # dist/: widget (clicksplain*.global.js, .mjs, .cjs), byok, server entries
npm run dev        # tsup --watch, rebuilds on save
npm test           # vitest
npm run typecheck
npm run lint
npm run prepublishOnly   # everything CI runs: the above plus size and package checks
```

The two server examples (`examples/proxy-node-http`, `examples/demo-nextjs`)
each have their own `package.json` and are developed independently:

```bash
cd examples/proxy-node-http && npm install && npm run dev   # tsx --watch, port 8788
cd examples/demo-nextjs && npm install && npm run dev       # next dev, port 3000
```

Each has an `.env.local.example`: copy it, fill in a real API key, and don't
commit the copy (already gitignored).

Both depend on the root package via `"clicksplain": "file:../.."`. Run
`npm run build` at the repo root first (and again after any change to
`src/shared/`, `src/server/`, or `src/connectors/`), since `file:` dependencies
don't rebuild automatically.

## Testing your change

`npm test` runs the vitest suite in `test/`: the wire protocol, the server
handler (against a stubbed provider stream), the Node adapter (against a real
`node:http` server), the SSE parser, the cache, and the BYOK origin guard.
Add a test with any change to those. CI (`.github/workflows/ci.yml`) runs the
same checks as `npm run prepublishOnly`, typechecks both server examples, and
scans the history for committed secrets.

UI behavior is verified by hand in a browser:

1. Build the widget (`npm run build`).
2. Serve the repo root locally (any static file server, e.g.
   `python3 -m http.server`, which serves on port 8000), then open
   `examples/demo-host-page/`.
3. Open `demo-byo-endpoint.html` (with `examples/proxy-node-http` running),
   `demo-puter.html`, or `demo-byok.html` (paste a test key into its form),
   click the "?" fab, and click around, including `fixtures.html`, which exists
   specifically to stress-test Shadow DOM isolation against hostile host-page
   CSS (colliding class names, `z-index` traps, `* { all: revert }`). If you
   touch positioning, Shadow DOM boundaries, or theming, check this page.
4. If your change touches `src/shared/` or `src/server/`, also hit
   `examples/proxy-node-http` with `curl` for the error paths (disallowed
   origin, oversized body, wrong token, rate limit), not only the happy path
   through the widget.

## Pull requests

- Keep PRs scoped to one change. A bug fix doesn't need a drive-by refactor
  riding along with it.
- Write the PR description around *why*, not a restatement of the diff.
- `npm run typecheck` and `npm run build` must both pass.
- Wire-protocol behavior (validation, auth, error shape) lives in
  `src/shared/` and `src/server/createHandler.ts`, not in
  `examples/proxy-node-http`: fix it there, not in the example.
- Commit messages: short, single-line, imperative ("Fix popover clipping on
  narrow viewports", not "Fixed a bug where...").

## Reporting a security issue

Please don't open a public issue for a vulnerability that affects a live
deployment pattern (e.g. something that would let an unauthenticated caller
drain an adopter's LLM budget). Email the maintainer directly instead (see
the GitHub profile for contact info), and open a public issue once a fix
is available.

## Code of conduct

This project follows the guidelines in [CODE_OF_CONDUCT.md](./CODE_OF_CONDUCT.md).
