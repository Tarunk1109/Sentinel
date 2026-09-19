import { defineConfig } from "vitest/config";
import { fileURLToPath } from "node:url";

export default defineConfig({
  resolve: { alias: { "@": fileURLToPath(new URL("./src", import.meta.url)) } },
  // Default stays "node" for every existing (.test.ts) suite - server/domain logic needs
  // no DOM. React hook/component tests (.test.tsx) opt into jsdom per-file via a
  // `// @vitest-environment jsdom` pragma instead of switching this default, so this
  // change adds coverage without altering how any existing test runs.
  test: { environment: "node", include: ["tests/**/*.test.ts", "tests/**/*.test.tsx"] },
});
