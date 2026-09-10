import { defineConfig } from "tsup";

// All three configs build into the same dist/ in parallel from one `tsup`
// invocation (an array export), so none of them may set `clean`: the build
// script wipes dist/ once up front instead.

// <script>-tag bundles: dependencies fully inlined. The byok bundle is a
// separate file so pages that don't use BYOK never download the AI SDK.
// platform "browser" makes esbuild pick each dependency's browser export
// condition (e.g. @vercel/oidc's no-op browser build, pulled in via `ai`).
const iifeConfig = defineConfig({
  entry: { clicksplain: "src/index.ts", "clicksplain-byok": "src/byok.global.ts" },
  format: ["iife"],
  platform: "browser",
  globalName: "Clicksplain",
  outExtension: () => ({ js: ".global.js" }),
  minify: true,
  sourcemap: true,
  loader: { ".css": "text" },
});

// npm entries for bundler users: dependencies stay external, and "./byok" is
// its own subpath so only importing it pulls in `ai`/`@ai-sdk/*`.
const browserModuleConfig = defineConfig({
  entry: { clicksplain: "src/index.ts", byok: "src/byok.ts" },
  format: ["esm", "cjs"],
  platform: "browser",
  outExtension: ({ format }) => ({ js: format === "esm" ? ".mjs" : ".cjs" }),
  minify: true,
  sourcemap: true,
  dts: true,
  loader: { ".css": "text" },
});

// Server entries: no DOM/browser concerns, so kept apart from the browser
// builds' platform/minify choices.
const serverConfig = defineConfig({
  entry: { server: "src/server/index.ts", "server-node": "src/server/node.ts" },
  format: ["esm", "cjs"],
  outExtension: ({ format }) => ({ js: format === "esm" ? ".mjs" : ".cjs" }),
  sourcemap: true,
  dts: true,
});

export default [iifeConfig, browserModuleConfig, serverConfig];
