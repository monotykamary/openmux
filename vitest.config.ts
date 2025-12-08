import { defineConfig } from "vitest/config"

export default defineConfig({
  test: {
    include: ["src/**/*.test.ts", "tests/**/*.test.ts"],
    globals: false,
    environment: "node",
    testTimeout: 10000,
  },
  esbuild: {
    jsx: "automatic",
    jsxImportSource: "@opentui/react",
  },
})
