import { fileURLToPath } from "node:url";
import { defineConfig } from "tsup";

const vercelOidcStub = fileURLToPath(new URL("src/stubs/vercel-oidc-stub.ts", import.meta.url));

const browserConfig = defineConfig({
  entry: { "clicksplain": "src/index.ts" },
  format: ["iife", "esm", "cjs"],
  globalName: "Clicksplain",
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
    // for consumers' own bundlers): @vercel/oidc (a Node-only, unused-by-us
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

// Server entries: no IIFE (nothing runs it as a <script> tag), no DOM/browser
// concerns, so a separate config keeps them from sharing the browser build's
// globalName/alias/minify choices. clean:false since this runs alongside
// browserConfig in the same `tsup` invocation (an array export) and must not
// wipe its output.
const serverConfig = defineConfig({
  entry: { server: "src/server/index.ts", "server-node": "src/server/node.ts" },
  format: ["esm", "cjs"],
  outExtension({ format }) {
    return format === "esm" ? { js: ".mjs" } : { js: ".cjs" };
  },
  sourcemap: true,
  dts: true,
  clean: false,
});

export default [browserConfig, serverConfig];
