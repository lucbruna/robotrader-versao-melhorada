// Vitest config — runs TypeScript tests in src/**/*.test.ts
// alongside the existing ESLint setup. Tests are pure logic only
// (no DOM) so we use the default node environment.

import { defineConfig } from "vitest/config";
import tsconfigPaths from "vite-tsconfig-paths";

export default defineConfig({
  plugins: [tsconfigPaths()],
  test: {
    environment: "node",
    include: ["src/**/*.test.ts"],
    globals: false,
  },
});
