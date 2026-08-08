// Stub for @vercel/oidc, aliased in tsup.config.ts for the browser IIFE build.
//
// `ai`'s single bundled dist/index.js unconditionally imports @ai-sdk/gateway
// (Vercel's own hosted multi-provider routing product) at module top-level,
// alongside the streamText export we actually use — and @ai-sdk/gateway in turn
// imports @vercel/oidc, which uses Node-only `path`/`fs` APIs. We never call
// createGateway/gateway from `ai`, so this whole subtree is dead code for us,
// but a plain ESM/CJS import can't be tree-shaken away without proof of no side
// effects. Aliasing to this stub removes the Node-only APIs from the browser
// bundle without changing any real behavior — these functions are never invoked.
export function getContext(): { headers?: Record<string, string> } {
  return {};
}

export function getVercelOidcToken(): never {
  throw new Error("[clicksplain] @vercel/oidc is stubbed out and not available in the browser build.");
}
