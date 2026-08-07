import { fileURLToPath } from "node:url";
import { defineConfig } from "tsup";

const vercelOidcStub = fileURLToPath(new URL("src/stubs/vercel-oidc-stub.ts", import.meta.url));

export default defineConfig({
  entry: { "docent": "src/index.ts" },
  format: ["iife", "esm", "cjs"],
  globalName: "Docent",
  outExtension({ format }) {
    if (format === "iife") return { js: ".global.js" };
    if (format === "esm") return { js: ".mjs" };
    return { js: ".cjs" };
  },
  minify: true,
  sourcemap: true,
  dts: true,
  clean: true,
  loader: {
    ".css": "text",
  },
  esbuildOptions(options, context) {
    // Only the IIFE build fully bundles dependencies (ESM/CJS keep them external
    // for consumers' own bundlers) — @vercel/oidc (a Node-only, unused-by-us
    // transitive dep of `ai` -> @ai-sdk/gateway) only needs stubbing there. See
    // src/stubs/vercel-oidc-stub.ts for why this is safe.
    if (context.format === "iife") {
      options.alias = {
        ...options.alias,
        "@vercel/oidc": vercelOidcStub,
      };
    }
  },
});
