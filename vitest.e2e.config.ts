import { defineConfig } from "vitest/config";

// e2e:對本地 dev server(http://localhost:3000)+ 本地 Supabase 打真實 API。
// 前置條件:npm run db:start、npm run dev 先跑起來。
// 測試資料建立在專用測試櫃位,結束以「強制刪除櫃位」清除,不污染本地資料。
export default defineConfig({
  test: {
    environment: "node",
    include: ["tests/e2e/**/*.e2e.ts"],
    testTimeout: 30000,
    hookTimeout: 30000,
    // 測試共用同一組資料(櫃位/班表),必須依序執行
    fileParallelism: false
  },
  resolve: {
    alias: {
      "@": new URL(".", import.meta.url).pathname
    }
  }
});
