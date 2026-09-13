import js from "@eslint/js";
import tseslint from "typescript-eslint";

export default tseslint.config(
  // evals/run-eval.mjs is the eval runner scaffold, vendored as shipped so
// later updates to it stay a clean diff.
  { ignores: ["dist/", "examples/", "node_modules/", "evals/run-eval.mjs"] },
  js.configs.recommended,
  ...tseslint.configs.recommended,
  {
    rules: {
      "@typescript-eslint/no-explicit-any": "error",
      "@typescript-eslint/consistent-type-imports": ["error", { fixStyle: "inline-type-imports" }],
    },
  }
);
