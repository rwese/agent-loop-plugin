import { defineConfig } from "vitest/config"
export default defineConfig({
  test: {
    include: ["**/*.test.ts"],
    exclude: ["**/node_modules/**", "**/dist/**", "**/example.ts"],
    coverage: {
      provider: "v8",
      reporter: ["text", "json", "html"],
      thresholds: {
        lines: 80,
        functions: 80,
        branches: 80,
        statements: 80,
      },
      exclude: [
        "**/node_modules/**",
        "**/dist/**",
        "**/*.config.ts",
        "**/example.ts",
        "**/index.ts",
      ],
    },
  },
})
//# sourceMappingURL=vitest.config.js.map
