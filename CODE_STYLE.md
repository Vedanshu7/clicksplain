# Code style

This describes how the code in this repo is actually written. It's here so
contributions read as if one person wrote them. When in doubt, match the file
you're editing over anything written here.

## TypeScript

- Strict mode is on (`tsconfig.json`) and stays on. Don't add `// @ts-ignore`
  or loosen a compiler flag to get around a type error: fix the type.
- No `any`. If a shape is genuinely unknown, use `unknown` and narrow it.
- Prefer explicit types on public/exported function signatures. Let inference
  handle local variables.
- Double quotes, no semicolon omission: follow the existing files, there's
  no formatter enforcing this yet (see "Tooling" below).
- One class or cohesive unit per file, named to match (`PopoverRenderer.ts`
  exports `PopoverRenderer`). Utility modules that export functions rather
  than a class use camelCase filenames (`shadowHost.ts`, `elementSignature.ts`).

## Comments

- Default to no comments. Names should do the explaining.
- Write a comment only when it captures a WHY that the code can't express:
  a browser quirk, a deliberate tradeoff, a constraint from another file, a
  non-obvious ordering requirement. If deleting the comment wouldn't confuse
  the next reader, delete it.
- Never write a comment that restates what the code does, references a
  specific past task/fix/PR, or explains what a well-named function already
  says. Comments rot; the code doesn't.
- JSDoc (`/** ... */`) is reserved for the one-line "what this does and why
  you'd reach for it" summary on a class or exported function: see
  `PopoverRenderer.ts` or `ChatPanel.ts` for the expected length and tone.
  Not every export needs one; add it when the name alone doesn't make the
  contract obvious.

## Structure and scope

- Don't add abstraction ahead of a second real use case. Three similar lines
  beat a premature helper.
- Don't add error handling, fallbacks, or config flags for scenarios that
  can't happen given how the code is actually called. Validate at real
  boundaries (the client↔proxy wire protocol, user-supplied config), not
  everywhere defensively.
- No backwards-compatibility shims for removed code. If something is dead,
  delete it outright rather than deprecating it in place.
- The wire protocol (validation, auth, prompt building, model calls, SSE
  streaming) lives once, in `src/shared/` and `src/server/createHandler.ts`.
  `examples/proxy-node-http` is a thin wrapper around
  `createClicksplainHandler`: its only logic of its own is a sample rate
  limiter passed in through the `onRequest` hook. A fix belongs in `src/shared/` or `src/server/`, not the example.

## Security-sensitive code

This project's trust boundary is the client↔server wire protocol: the server
holds a real, billable LLM API key. When touching `src/server/` or
`src/shared/`:

- Validate the request body with `zod` before using any field from it (the
  schemas are in `src/shared/protocol.ts`).
- Keep `src/shared/wire.ts` free of dependencies: the browser core imports it,
  so pulling `zod` or the AI SDK into it puts them back in the default bundle.
- Never echo upstream provider error text back to the caller: return a
  generic message, and log only the error's name, status and message (the raw
  AI SDK error object carries the request body and the provider's response).
- Don't add a new field to the request/response shape without a length or
  array-size cap; unauthenticated callers can send anything.

## CSS (widget styles, `src/style/shadow.css`)

- Every themeable value is a CSS custom property with an `--oa-*` internal
  name backed by a `--clicksplain-*` public one (see the file's own header
  comment for the full theme API). Don't hardcode a color, radius, or font
  that should be themeable.
- Custom property registrations go through `CSS.registerProperty` in
  `shadowHost.ts`, not an `@property` rule in `shadow.css`: registration is
  document-scoped, and registering inside the shadow root silently fails.
- Styles are applied as constructable stylesheets (`adoptedStyleSheets`), so
  the widget works under a strict CSP. Don't add `<style>` elements or inline
  `style="..."` attributes; setting `element.style` from script is fine.
- Respect `prefers-reduced-motion` for anything animated.

## Tooling

- `npm run lint`: ESLint (`eslint.config.js`, typescript-eslint recommended,
  no `any`, type-only imports marked as such). There's no formatter: match
  the surrounding code.
- `npm run typecheck`: covers `src/`, `test/` and `evals/`, zero errors.
- `npm test`: vitest, tests live in `test/`. DOM-dependent tests opt into
  happy-dom with a `// @vitest-environment happy-dom` first line.
- `npm run size`: the widget bundles have size budgets in `.size-limit.json`.
  Raising one should be a deliberate decision, called out in the PR.

`npm run prepublishOnly` runs all of these plus the build and package checks,
same as CI.
