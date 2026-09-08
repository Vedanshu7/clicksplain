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
  `createClicksplainHandler`: there's no separate logic in it to keep in
  sync. A fix belongs in `src/shared/` or `src/server/`, not the example.

## Security-sensitive code

This project's trust boundary is the client↔proxy wire protocol: the proxy
holds a real, billable LLM API key. When touching either proxy template:

- Validate the request body with `zod` before using any field from it
  (`promptBuilder.ts` in each proxy has the schemas).
- Never echo upstream provider error text back to the caller: log it
  server-side, return a generic message.
- Don't add a new field to the request/response shape without a length or
  array-size cap; unauthenticated callers can send anything.

## CSS (widget styles, `src/style/shadow.css`)

- Every themeable value is a CSS custom property with an `--oa-*` internal
  name backed by a `--clicksplain-*` public one (see the file's own header
  comment for the full theme API). Don't hardcode a color, radius, or font
  that should be themeable.
- `@property` registrations must live in the light-DOM style tag
  (`shadowHost.ts`), not inside the shadow root's stylesheet: property
  registration is document-scoped, and registering it inside the shadow root
  silently fails. See the comment in `shadowHost.ts` if you need the details.
- Respect `prefers-reduced-motion` for anything animated.

## Tooling

There's no ESLint/Prettier config yet: consistency is currently maintained
by matching surrounding code and by review. If you're setting one up, open an
issue first so the config matches what's described here rather than a
generic default.

- `npm run typecheck`: must pass with zero errors before a PR.
- `npm run build`: must succeed and produce output in `dist/`.

There's no automated test suite yet either. Changes are verified manually
against `examples/demo-host-page/` (see CONTRIBUTING.md for how). If you're
adding the first test harness, open an issue to discuss the framework choice
first.
