# 我的班表個人業績 + 庫存預購取貨

日期：2026-08-18

兩項互相獨立的調整，共用一次實作。

## 一、我的班表只顯示個人業績

### 問題

[app/staff/schedule/page.tsx](../../../app/staff/schedule/page.tsx) 上的四張 KPI 卡（今日業績 / 今日抽成 / 本月業績 / 本月抽成）算出來的數字與標籤對不上，成因有三個：

1. **時區錯位。** [StaffScheduleTable.tsx:37](../../../components/staff/StaffScheduleTable.tsx#L37) 用 `new Date().toISOString().slice(0, 10)` 取「今天」，這是 UTC 日期；後端 `/api/reports` 的 daily row 日期是台北日期（[query-helpers.ts:30](../../../lib/backend/query-helpers.ts#L30) 的 `taipeiDate`）。台北時間 00:00–08:00 之間兩者差一天，「今日業績」比對到昨天的列；同時 `to` 參數也少一天，讓當日訂單整批被排除在月區間外。每月 1 號早上 `today.slice(0, 7)` 還會落在上個月，整頁顯示上個月的資料。

2. **範圍不是個人。** `/api/reports` 只在 `role === "staff"` 時把 rows 過濾成本人（[route.ts:241-245](../../../app/api/reports/route.ts#L241-L245)）。店長拿到的是全店所有銷售員的列，而頁面直接把所有列加總，於是店長看到的是全店數字。店長本身也會排班、也有個人業績，這頁對他而言應該同樣是「我的」。

3. **抽成模式標籤寫死。** 抽成有日結與月結兩種模式（`profiles.commission_mode`）。月結員工的每日抽成一律為 0（[route.ts:198-201](../../../app/api/reports/route.ts#L198-L201)），抽成在月底依整月總實收套級距一次算出（[route.ts:226-235](../../../app/api/reports/route.ts#L226-L235)）。但卡片小字寫死「依當日個人業績級距」與「逐日累計」，月結員工因此看到一張永遠是 $0、說明文字又不成立的「今日抽成」卡。

### 做法

只改 [components/staff/StaffScheduleTable.tsx](../../../components/staff/StaffScheduleTable.tsx)，後端與資料庫不動。

**時區。** 改用 `taipeiDate(new Date().toISOString())` 取今天。`taipeiDate` 是 `lib/backend/query-helpers.ts` 裡的純函式（內部用 `toLocaleDateString("en-CA", { timeZone: "Asia/Taipei" })`），該檔沒有任何 server-only import，client component 可直接引入。

**個人範圍。** 目前 `loadShifts()` 自己抓 `/api/me` 拿 `staffId`，`loadPerformance()` 沒有。把 `/api/me` 提到共用的 `load()`，兩者共用同一個 `staffId`；`loadPerformance()` 拿到 `daily` / `monthly` 後一律以 `sellerId === staffId` 過濾再加總。

後端回傳的 rows 本來就是「每人每日」與「每人每月」一列，`commission` 也是逐列按該人的級距與抽成模式算好的，共班訂單在 [route.ts:130-135](../../../app/api/reports/route.ts#L130-L135) 已按人數均分。所以過濾後直接加總就是本人的正確數字，不需要新增 API 參數。對 staff 而言這個過濾是 no-op（後端已濾過），兩種角色走同一條程式路徑。

**抽成模式。** rows 上已有 `commissionMode` 欄位（[route.ts:196](../../../app/api/reports/route.ts#L196)、[route.ts:227](../../../app/api/reports/route.ts#L227)），不需新增 API 欄位。過濾成本人後取 `monthly[0]?.commissionMode ?? "daily"`。

| 模式 | 今日抽成卡 | 本月抽成小字 |
| --- | --- | --- |
| `daily`（日結） | 顯示，小字維持「依當日個人業績級距」 | 「逐日累計」 |
| `monthly`（月結） | 整張隱藏，月結員工只看到三張卡 | 「依本月總業績級距」 |

業績兩張卡（今日 / 本月）的呈現不變。

### 不做

- 不改 `/api/reports`。店長在 `/manager/reports` 仍看全店，那是另一頁的行為。
- 不改抽成的計算邏輯本身，只改前端取用與呈現。

## 二、庫存調整新增「預購取貨」

### 背景

POS 結帳時若櫃位庫存不足，差額不會扣庫存，而是寫進 `order_preorder_items` 掛成預購（[202607280001_stock_source_product.sql:88-109](../../../supabase/migrations/202607280001_stock_source_product.sql#L88-L109)）。等貨到、客人來取貨時，需要一筆手動異動把庫存補扣掉。目前異動類型沒有對應選項，店員只能借用「轉調」，語意錯誤且會混進店長的覆核清單。

### 做法

新增 movement type `preorder_pickup`，標籤「預購取貨」，行為是扣庫存。

| 檔案 | 改動 |
| --- | --- |
| `supabase/migrations/2026081800001_preorder_pickup_movement.sql`（新增） | drop 後重建 `inventory_movements_movement_type_check`，加入 `'preorder_pickup'` |
| [lib/backend/api-types.ts:40-48](../../../lib/backend/api-types.ts#L40-L48) | `InventoryMovementType` union 加 `"preorder_pickup"` |
| [lib/domain/inventory.ts](../../../lib/domain/inventory.ts) | 加進 `deductionTypes`，`normalizeInventoryQuantity` 回傳負數 |
| [app/api/inventory/route.ts:20](../../../app/api/inventory/route.ts#L20) | `movementLabels` 加 `preorder_pickup: "預購取貨"` |
| [components/staff/InventoryMovementForm.tsx:44](../../../components/staff/InventoryMovementForm.tsx#L44) | `movementOptions` 加一項；新增表單的下拉與紀錄彈窗的類型篩選共用這份清單 |
| [tests/domain/inventory.test.ts](../../../tests/domain/inventory.test.ts) | 新增 `preorder_pickup` 的扣減測試 |

庫存推估由 `inventory_stock_summary` RPC 對上次盤點之後的 `quantity` 加總得出（[20260807131602_inventory_stock_summary_rpc.sql](../../../supabase/migrations/20260807131602_inventory_stock_summary_rpc.sql)），只看數量正負、不看型別，所以負數 quantity 自動反映到庫存摘要，RPC 不需修改。

### 兩個判斷

- **備註不必填。** 現有 `noteRequiredTypes` 是試吃 / 報廢 / 轉調，都是損耗或移出，需要理由。預購取貨是常態出貨，強制填備註只會讓店員亂打字。DB 的 note 約束（[初始 migration:133](../../../supabase/migrations/202607050001_initial_pos_cloud.sql#L133)）維持原樣。
- **不列入店長覆核。** [InventoryDashboard.tsx:37](../../../components/manager/InventoryDashboard.tsx#L37) 的 `reviewTypes` 同樣是那三種損耗型，預購取貨不算異常，不加。

### 已知限制

這是一筆純手動異動。系統不會核對 `order_preorder_items` 裡有沒有對應的未取貨紀錄，也不會把該筆預購標記成已取。店員可以重複登記，或登記沒有對應預購單的品項。「從未取貨預購清單挑一筆、取貨後自動結案」是另一個獨立功能，不在本次範圍。

## 驗證

1. `npm run test` → 既有測試全過，新增的 `preorder_pickup` 測試通過。
2. `npx tsc --noEmit` → 無型別錯誤（union 擴充後 `movementLabels` 的 `Record<InventoryMovementType, string>` 會強制要求補上新標籤，這是預期的編譯期檢查）。
3. `npx supabase db reset` → migration 套用成功，`preorder_pickup` 可寫入。
