import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    environment: "node",
    include: ["tests/**/*.test.ts"],
    // e2e 需要本地 dev server + Supabase,獨立用 npm run test:e2e 執行
    exclude: ["tests/e2e/**", "**/node_modules/**"]
  },
  resolve: {
    alias: {
      "@": new URL(".", import.meta.url).pathname
    }
  }
});
