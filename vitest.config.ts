import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    include: ["test/**/*.test.ts", ".github/scripts/*.test.ts"],
    environment: "node",
    clearMocks: true,
    restoreMocks: true,
  },
});
