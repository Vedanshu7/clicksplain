import { readFileSync } from "node:fs";
import { defineConfig } from "vitest/config";

export default defineConfig({
  plugins: [
    {
      // Mirrors tsup's `loader: { ".css": "text" }`: the widget imports its
      // stylesheet as a string to adopt into the shadow root.
      name: "css-as-text",
      enforce: "pre",
      load(id) {
        if (!id.endsWith(".css")) return null;
        return `export default ${JSON.stringify(readFileSync(id, "utf8"))};`;
      },
    },
  ],
  test: {
    include: ["test/**/*.test.ts"],
  },
});
