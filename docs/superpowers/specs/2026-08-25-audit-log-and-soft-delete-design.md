# 後台操作稽核紀錄 + 商品／口味／組合價軟刪除

日期：2026-08-25

兩項調整，共用一次實作。

起因是正式區有一個商品「匠心(原/草/巧)」，想查是誰建立的，結果查不到——系統從來沒有記錄過。第二項則是查證過程中發現的：後台的「刪除」在多數情況下會被靜默降級成「停用」。

---

## 一、後台操作稽核紀錄

### 問題

後台八組 CRUD 路由全部沒有留下任何操作痕跡，`products` 等表也沒有 `created_by` 欄位，所以「誰在什麼時候改了什麼」完全無從查起。

成因有三層：

1. **表上沒欄位。** [`products`](../../../supabase/migrations/202607050001_initial_pos_cloud.sql#L28-L36) 只有 `created_at`，沒有任何操作人欄位；後續二十個 migration 也沒補。
2. **沒有稽核表。** 全部 migration 掃過，只有 `inventory_movements` 有 `created_by`。商品、口味、組合價、折扣、櫃位、員工、付款方式、抽成的變更都不留痕。
3. **連資料庫層都追不到。** 八組路由一律用 `createSupabaseAdminClient()`（service_role）寫入，繞過 RLS，`auth.uid()` 是 null。這代表**資料庫 trigger 自動記錄的做法行不通**——trigger 抓不到操作人。

第 3 點是整個設計的關鍵限制。曾考慮用 `set_config('app.actor_id', ...)` 把操作人塞進連線再由 trigger 讀取，但 supabase-js 走 PostgREST、連線是 pooled 的，沒有可靠方式保證單一請求內的 GUC 不被其他請求看到。那會產出「看起來有 actor、其實可能記錯人」的紀錄，比沒有還糟。因此採用應用層寫入。

### 資料表

新增一次 migration：

```sql
create table public.audit_logs (
  id           uuid primary key default gen_random_uuid(),
  actor_id     uuid references public.profiles(id) on delete set null,
  actor_name   text not null,
  action       text not null check (action in ('create','update','delete')),
  entity       text not null,
  entity_id    text,
  entity_label text,
  before       jsonb,
  after        jsonb,
  created_at   timestamptz not null default now()
);

create index audit_logs_created_at_idx on public.audit_logs (created_at desc);
create index audit_logs_entity_idx     on public.audit_logs (entity, entity_id);
create index audit_logs_actor_idx      on public.audit_logs (actor_id);
```

四個刻意的選擇：

- **`actor_name` 冗餘存字串**，不只靠 FK。員工離職被刪掉後，稽核紀錄仍要讀得出是誰。搭配 `on delete set null`——刪員工不會被 FK 擋住，也不會連帶毀掉紀錄。
- **`entity_id` 用 `text` 不是 `uuid`。** [`payment_methods`](../../../supabase/migrations/202608010002_configurable_payment_methods.sql#L1-L8) 的主鍵是 `code`（text），抽成設定則沒有單一 id（用 `staffId ?? 'global'`）。統一 text 才裝得下。
- **`entity_label`** 存當下的人類可讀名稱（例如 `匠心(原/草/巧)`）。列表不必 join，而且對象被刪除後仍看得到它叫什麼——正是本次起因的情境。
- **`before` / `after` 都可為空。** 新增只有 after、刪除只有 before、修改兩者都有。

RLS 依 [20260807132637](../../../supabase/migrations/20260807132637_harden_function_privileges_and_index_foreign_keys.sql) 的慣例：

```sql
alter table public.audit_logs enable row level security;

create policy "managers read audit logs" on public.audit_logs
  for select to authenticated
  using ((select private.is_manager()));

grant select on public.audit_logs to authenticated;
grant all    on public.audit_logs to service_role;
```

**只有 select policy，沒有 insert / update / delete policy。** 只有 service_role 寫得進去，前端完全改不動。API 層也不會有任何修改或刪除紀錄的路徑——這張表是 append-only。

### 寫入路徑

新增 `lib/backend/audit.ts`：

```ts
export type AuditAction = "create" | "update" | "delete";

export async function writeAuditLog(
  supabase: ReturnType<typeof createSupabaseAdminClient>,
  params: {
    actor: SessionProfile | null;
    action: AuditAction;
    entity: string;
    entityId: string | null;
    entityLabel: string | null;
    before?: unknown;
    after?: unknown;
  }
): Promise<void>;
```

`actor` 直接用各路由 `requireRole()` 已經拿到的 `guard.profile`，不必多查一次。`actor_name` 取 `actor.displayName`，`actor` 為 null 時（demo 模式）不會走到這裡。

接上的八組路由與 `entity` 值：

| 路由 | entity | 動作 |
| --- | --- | --- |
| [app/api/products/route.ts](../../../app/api/products/route.ts) | `products` | POST / PATCH / DELETE |
| [app/api/flavors/route.ts](../../../app/api/flavors/route.ts) | `flavors` | POST / PATCH / DELETE |
| [app/api/bundles/route.ts](../../../app/api/bundles/route.ts) | `bundles` | POST / PATCH / DELETE |
| [app/api/discounts/route.ts](../../../app/api/discounts/route.ts) | `discounts` | POST / PATCH |
| [app/api/counters/route.ts](../../../app/api/counters/route.ts) | `counters` | POST / PATCH / DELETE |
| [app/api/staff/route.ts](../../../app/api/staff/route.ts) | `profiles` | POST / PATCH / DELETE |
| [app/api/payment-methods/route.ts](../../../app/api/payment-methods/route.ts) | `payment_methods` | POST / PATCH |
| [app/api/commission/route.ts](../../../app/api/commission/route.ts) | `commission_tiers` | PUT（記為 `update`） |

兩個路由形狀特殊：

- **`commission` 的 PUT** 不是單列而是整組級距。`entity_id` 用 `staffId ?? 'global'`，`entity_label` 用該員工的 `display_name`（全域設定則為 `全域`），`before` / `after` 存級距陣列。
- **`bundles`** 有 `bundle_products` / `bundle_tiers` 兩張子表。`before` / `after` 存組合後的完整結構，形狀與 [GET 回傳](../../../app/api/bundles/route.ts#L29-L48) 一致。

`update` 與 `delete` 需要先讀一次原始資料才有 `before`，等於每次修改多一次 query。後台操作頻率極低，可接受。

### 三個判斷

**1. log 寫入失敗不影響主操作。** `writeAuditLog` 內部吞掉錯誤，只 `console.error`，不回傳失敗。理由：商品明明建好了，卻因為稽核紀錄寫不進去而回 500，比漏一筆 log 糟得多。代價是極端情況下 log 可能有缺漏。

**2. staff 路由絕不記密碼。** `after` 存的是實際寫入 `profiles` 的那一列（該表本來就沒有密碼欄位），**不是** request 的 input——[POST 的 input 帶有 `password`](../../../app/api/staff/route.ts#L85)。這要在程式碼裡明確處理，不能靠「剛好沒帶到」。

**3. demo 模式不寫 log。** 各路由 `!hasSupabaseAdminEnv()` 的分支直接 return，不呼叫 `writeAuditLog`。

### 查詢頁

**API** — 新增 `app/api/audit/route.ts`，**只有 GET**，`requireRole("manager")`。支援 `entity` / `actorId` / `from` / `to` 與分頁參數，預設最近 50 筆、`created_at` 由新到舊。沒有 POST / PATCH / DELETE——這張表在 API 層也是唯讀。

**頁面** — `app/manager/audit/page.tsx` 照 [payment-methods/page.tsx](../../../app/manager/payment-methods/page.tsx) 的模式包 `<ManagerShell>`；元件 `components/manager/AuditLogView.tsx` 照 [PaymentMethodSettings.tsx](../../../components/manager/PaymentMethodSettings.tsx) 的寫法（`useEffect` 載入 + `status` 字串狀態）。導覽列在 [nav-links.ts](../../../components/shared/nav-links.ts) 的 `managerNavLinks` 最後加一項 `{ href: "/manager/audit", label: "紀錄" }`。

**列表** — 時間 / 操作人 / 動作 / 類別 / 對象名稱，可展開看變更明細。明細只列**真正有變動的欄位**，格式為「欄位：舊值 → 新值」；新增列出 `after` 全部欄位，刪除列出 `before`。

`entity` 與欄位名經過一個扁平的 `Record<string, string>` 中文對照表（`is_active` → 啟用、`price` → 價格、`products` → 商品……），查不到就原樣顯示原欄位名。不做每個 entity 各一份的巢狀設定。

### 不做

- **不回溯歷史。** 沒有資料可補，「匠心(原/草/巧)」是誰建的，做完這次依然查不到。此功能只對上線之後的操作有效。
- 不記錄讀取行為，只記寫入。
- 不碰 POS 訂單與庫存異動——[`orders`](../../../supabase/migrations/202607050001_initial_pos_cloud.sql#L69-L85) 已有 `cashier_id` / `edited_by`，[`inventory_movements`](../../../supabase/migrations/202607050001_initial_pos_cloud.sql#L119-L131) 已有 `created_by`，重複記沒有意義。
- **不涵蓋** [app/api/counters/records/route.ts](../../../app/api/counters/records/route.ts)（櫃位月目標）與 [app/api/inventory/sort/route.ts](../../../app/api/inventory/sort/route.ts)（排序）。這兩個不在本次議定的八組內。
- 不做保留期自動清理、不做 CSV 匯出。

---

## 二、商品／口味／組合價軟刪除

### 問題

「刪除」目前會被靜默降級成「停用」。以商品為例，[products/route.ts:217-258](../../../app/api/products/route.ts#L217-L258) 先數 `order_items` 與 `inventory_movements` 有無參照，沒有就真的 `delete`，有就改成 `is_active = false` 並回 `mode: "deactivated"`。正式區的商品幾乎都賣過，於是等同永遠刪不掉。口味（[flavors/route.ts:166-190](../../../app/api/flavors/route.ts#L166-L190)）是同樣的邏輯。

現行硬刪除路徑另有三個缺口：

1. 商品的參照檢查漏了 [`order_preorder_items.product_id`](../../../supabase/migrations/202607070006_preorders_and_order_edit.sql#L12)。
2. 也漏了自我參照的 [`stock_source_product_id`](../../../supabase/migrations/202607280001_stock_source_product.sql#L5)。硬刪一個被當作庫存來源的商品會直接噴 FK 錯誤，把原始 Postgres 訊息丟到前端。
3. [`bundle_products`](../../../supabase/migrations/202607190001_bundles_flavors_commission_mode.sql#L14) 是 `on delete cascade`，硬刪商品會**靜默**把它從組合價移除，店長不會收到任何提示。

改成軟刪除後，第 1、2 點自然消失（不再硬刪就不會有 FK 問題），第 3 點改為明示處理。

### 做法

**核心：刪除時同時寫 `deleted_at = now()` 和 `is_active = false`。**

這個「順帶停用」是整個方案的關鍵。POS 端每一處查詢本來就都有 `is_active` 過濾：

| 位置 | 現有過濾 |
| --- | --- |
| 訂單 RPC 查商品 | [`products.is_active = true`](../../../supabase/migrations/202607280001_stock_source_product.sql#L53-L54) |
| POS 型錄查商品 | [`.eq("is_active", true)`](../../../app/api/catalog/route.ts#L44) |
| POS 型錄查口味 | [`.eq("is_active", true)`](../../../app/api/catalog/route.ts#L51-L55) |
| 組合價折抵計算 | [`.eq("is_active", true)`](../../../lib/backend/bundles.ts#L13) |

所以已刪除的項目**自動**從 POS、結帳、組合價計算中消失，這些地方一行都不用改。

Migration：

```sql
alter table public.products add column deleted_at timestamptz;
alter table public.flavors  add column deleted_at timestamptz;
alter table public.bundles  add column deleted_at timestamptz;
```

不加索引——三張表都只有數十列，加了是浪費。RLS policy 也不動，理由同上（已刪除必定 `is_active = false`）。

需要加 `deleted_at is null` 過濾的只有三處後台清單：

- [products/route.ts:39](../../../app/api/products/route.ts#L39)
- [flavors/route.ts:30](../../../app/api/flavors/route.ts#L30)
- [bundles/route.ts:20-22](../../../app/api/bundles/route.ts#L20-L22)

### 兩個狀態的語意

| | POS | 後台清單 | 歷史訂單／報表 |
| --- | --- | --- | --- |
| 停用 | 不賣 | 看得到，可改回啟用 | 正常 |
| 刪除 | 不賣 | 看不到（除非勾選「顯示已刪除」） | 正常 |

歷史資料完全不受影響——`order_items.product_id` 等外鍵原封不動，報表 join 得到名稱與金額。

### 三張表的差異

DELETE handler 一律改為軟刪除，回應固定 `mode: "deleted"`，不再有靜默降級。但軟刪除下 cascade 不會觸發，各表需要不同的前置處理：

| 表 | 要擋下的情況 | 要一併清掉的關聯 |
| --- | --- | --- |
| `products` | 有其他商品的 `stock_source_product_id` 指向它 | `bundle_products` 中的關聯 |
| `flavors` | 被固定禮盒使用（[`gift_box_fixed_flavors`](../../../supabase/migrations/202607050001_initial_pos_cloud.sql#L52-L58)，無 cascade） | [`gift_box_allowed_flavors`](../../../supabase/migrations/202607190001_bundles_flavors_commission_mode.sql#L12-L18) 中的關聯 |
| `bundles` | 無 | 無（`bundle_products` / `bundle_tiers` 是它自己的子表） |

「要擋下的情況」一律拒絕刪除並在錯誤訊息中列出是哪些商品／禮盒，讓店長知道要先處理什麼。放行的話，那些商品賣出時會去扣一個已刪除商品的庫存，或固定禮盒的內容物會指向不存在的口味。

「要一併清掉的關聯」在同一次操作中移除，並在回應中明講清掉了什麼。效果等同現行 cascade，差別是改成明示而非靜默。

### 復原

三張表的後台清單各加一個「顯示已刪除」勾選框，勾了才看得到已刪除項目，可按「復原」——清掉 `deleted_at`，但**維持 `is_active = false`**，要不要重新啟用由店長另外決定。

理由：軟刪除若沒有 UI 復原路徑，誤刪只能進 SQL Editor 撈，等於把風險轉嫁給使用者，而這個成本很小。

API 上以 GET 的 `includeDeleted=1` 參數控制是否含已刪除項目。

復原**不走既有的 PATCH**。現行 PATCH 會跑完整的 `validateProductInput` 並覆寫所有欄位（[products/route.ts:142-198](../../../app/api/products/route.ts#L142-L198)），而 `UpsertProductInput` 裡沒有 `deleted_at` 的概念，硬塞會讓「復原」意外覆寫掉商品內容。改為在 PATCH 收到 `{ id, restore: true }` 時走一條獨立分支：只把 `deleted_at` 設回 null，其他欄位一律不動，也不跑欄位驗證。三張表一致。

### 與稽核紀錄的搭配

刪除會寫一筆 `action: "delete"` 的 audit log，`before` 是完整內容。刪掉的商品長什麼樣、是誰刪的、什麼時候刪的，都查得到。

### 已知限制

訂單 RPC 依 `flavorId` 找不到口味時，會退回**用名稱查詢且不過濾 `is_active`**（[202607280001:128-132](../../../supabase/migrations/202607280001_stock_source_product.sql#L128-L132)）。理論上已刪除的口味仍可能被這條路徑解析到。

本次**不改**這段：它只在 client 沒帶 `flavorId` 時觸發，而 POS 型錄只會提供啟用中的口味，正常流程走不到。改動訂單 RPC 的風險與本次目標不成比例。列在這裡備查。

### 不做

- 不改 `order_items` 等歷史表的結構，不做商品名稱快照。
- 不對其他表（`discounts` / `counters` / `payment_methods`）加軟刪除。它們目前的刪除行為不在本次議題內。
- 不做已刪除項目的永久清除功能。

---

## 實作順序

兩項調整彼此獨立，但有先後價值，分兩階段做：

1. **先做稽核紀錄**（migration、`writeAuditLog`、八組路由接線、`/api/audit`、`/manager/audit` 頁）。理由：稽核追蹤不能回溯，早一天上線就早一天有資料。這階段結束後可以獨立驗證與上線。
2. **再做軟刪除**（三張表的 `deleted_at`、三個 DELETE handler 改寫、前置檢查、「顯示已刪除」與復原）。此時刪除操作已經會被稽核紀錄捕捉，`before` 快照能保住被刪內容，等於自帶一層保險。

反過來做也能動，但第 2 階段期間發生的刪除就沒有紀錄可查。

## 驗證

**單元測試**（`tests/domain/`，沿用現有的純函式測試慣例）

- `audit-diff.test.ts` — diff 邏輯抽成純函式 `lib/domain/audit-diff.ts` 的 `diffRecords(before, after)`：
  - 新增（`before` 為 null）列出 after 全欄位
  - 刪除（`after` 為 null）列出 before 全欄位
  - 修改只列出真正變動的欄位
  - **數值型別正規化**：`products.price` 是 `numeric(10,2)`，supabase-js 可能回字串——[products/route.ts:70](../../../app/api/products/route.ts#L70) 的 `Number(product.price)` 就是在擦這個屁股。若不處理，`450` 與 `"450"` 會被誤判成「有人改了價格」，整個功能的可信度就毀了。
  - 巢狀結構（禮盒規則、抽成級距、組合價層級）做深層比對
- `soft-delete.test.ts` — 刪除前置檢查抽成純函式（輸入是參照計數，輸出是「可刪 / 擋下並附原因」），涵蓋上表三種表的規則。

**手動驗證**（本機 `npm run db:reset` 後）

1. 以店長身分新增一個商品 → `/manager/audit` 出現一筆 `create`，操作人正確、`after` 內容正確。
2. 改該商品價格 → 出現 `update`，明細只顯示「價格：X → Y」一列，不出現其他欄位。
3. 刪除該商品 → 出現 `delete`（`before` 完整）；商品從後台清單與 POS 型錄消失；勾「顯示已刪除」看得到，可復原。
4. 建一個商品 A 並把商品 B 的庫存來源設為 A → 刪除 A 被擋下，訊息指出是 B 擋住的。
5. 把某商品放進組合價後刪除它 → 刪除成功，回應告知已從該組合價移除，組合價本身仍在。
6. 賣過的商品刪除後，`/manager/reports` 的歷史數字不變、訂單明細仍顯示商品名稱。
7. 新增員工 → audit log 的 `after` **不含**任何密碼欄位。
8. 以店員身分呼叫 `/api/audit` → 403。

**回歸**

`npm run test` 全綠、`npm run build` 通過。
