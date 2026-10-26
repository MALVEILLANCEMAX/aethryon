import { defineConfig } from "vitest/config";

export default defineConfig({
  esbuild: { jsx: "automatic", jsxImportSource: "preact" },
  test: { environment: "node", include: ["tests/unit/**/*.test.ts"], testTimeout: 20000 },
});
