import { defineConfig } from "vitest/config";
import path from "node:path";

export default defineConfig({
  test: {
    environment: "node",
    include: ["**/*.test.ts"],
    exclude: ["node_modules", ".next", "dist"],
    coverage: { provider: "v8", reporter: ["text", "html"] },
    setupFiles: ["./test/setup.ts"],
  },
  resolve: { alias: { "@": path.resolve(__dirname, ".") } },
});
