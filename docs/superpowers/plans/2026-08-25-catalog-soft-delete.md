# 商品／口味／組合價軟刪除 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 讓商品、口味、組合價的「刪除」真的能刪，且與「停用」成為兩個並存、互不干擾的狀態，歷史訂單與報表完全不受影響。

**Architecture:** 三張表各加一個 `deleted_at` 欄位。**刪除時同時寫 `deleted_at = now()` 與 `is_active = false`**——這個「順帶停用」讓 POS 端既有的每一處 `is_active` 過濾自動排除已刪除項目，POS、結帳、訂單 RPC、組合價計算一行都不用改。軟刪除不會觸發 cascade，所以三個 DELETE handler 各自負責「擋下危險刪除」與「一併清掉關聯」，判斷邏輯抽成純函式以便測試。

**Tech Stack:** Next.js 15 App Router、TypeScript、Supabase（PostgREST + RLS）、Vitest。

這是 [2026-08-25 spec](../specs/2026-08-25-audit-log-and-soft-delete-design.md) 的**階段二**。階段一（稽核紀錄）已完成並驗收，見 [2026-08-25-admin-audit-log.md](2026-08-25-admin-audit-log.md)。本階段依賴階段一的 `writeAuditLog`。

## Global Constraints

- **刪除一律同時寫 `deleted_at` 與 `is_active = false`**。這是整個方案的安全基礎，任何路徑都不得只寫其中一個。
- **不改任何 POS 端查詢**。訂單 RPC、`/api/catalog`、`lib/backend/bundles.ts` 都已有 `is_active` 過濾，一律不動。
- **不改 `order_items` 等歷史表結構**，不做商品名稱快照。外鍵原封不動。
- **已刪除的項目不得被一般 PATCH 編輯**（否則可能把 `is_active` 改回 true 讓它重回 POS）。一般編輯遇到已刪除項目要回 400，要求先復原。
- **復原走 `{ id, restore: true }` 專用分支**：只把 `deleted_at` 設回 null，其他欄位一律不動，也不跑欄位驗證，且**維持 `is_active = false`**。
- 每個刪除／復原都要寫稽核紀錄（階段一的 `writeAuditLog`），刪除記 `delete`、復原記 `update`。
- 不對 `discounts` / `counters` / `payment_methods` 加軟刪除。
- 既有程式碼風格：雙引號、`export async function GET/POST/PATCH/DELETE`。不重排、不改寫既有邏輯。

---

### Task 1: 刪除前置判斷純函式

**Files:**
- Create: `lib/domain/soft-delete.ts`
- Test: `tests/domain/soft-delete.test.ts`

**Interfaces:**
- Consumes: 無
- Produces:
  - `type SoftDeletePlan = { ok: true; clearedRelation: string | null } | { ok: false; error: string }`
  - `function planProductDeletion(params: { name: string; stockSourceDependents: string[]; bundleNames: string[] }): SoftDeletePlan`
  - `function planFlavorDeletion(params: { name: string; fixedGiftBoxNames: string[]; allowedGiftBoxNames: string[] }): SoftDeletePlan`

- [ ] **Step 1: 寫失敗的測試**

建立 `tests/domain/soft-delete.test.ts`：

```ts
import { describe, expect, it } from "vitest";
import { planFlavorDeletion, planProductDeletion } from "@/lib/domain/soft-delete";

describe("planProductDeletion", () => {
  it("被其他商品當作庫存來源時擋下,並列出是哪些商品", () => {
    const plan = planProductDeletion({
      name: "蔥餅袋",
      stockSourceDependents: ["9入蔥餅禮盒", "12入蔥餅禮盒"],
      bundleNames: []
    });

    expect(plan.ok).toBe(false);
    if (plan.ok) throw new Error("預期擋下");
    expect(plan.error).toContain("蔥餅袋");
    expect(plan.error).toContain("9入蔥餅禮盒");
    expect(plan.error).toContain("12入蔥餅禮盒");
  });

  it("在組合價裡時放行,並告知會從哪些組合價移除", () => {
    const plan = planProductDeletion({
      name: "原味袋",
      stockSourceDependents: [],
      bundleNames: ["袋裝任選"]
    });

    expect(plan.ok).toBe(true);
    if (!plan.ok) throw new Error("預期放行");
    expect(plan.clearedRelation).toContain("袋裝任選");
  });

  it("沒有任何關聯時放行且不需要清理", () => {
    const plan = planProductDeletion({
      name: "測試商品",
      stockSourceDependents: [],
      bundleNames: []
    });

    expect(plan).toEqual({ ok: true, clearedRelation: null });
  });

  it("庫存來源優先於組合價:兩者都有時仍然擋下", () => {
    const plan = planProductDeletion({
      name: "蔥餅袋",
      stockSourceDependents: ["9入蔥餅禮盒"],
      bundleNames: ["袋裝任選"]
    });

    expect(plan.ok).toBe(false);
  });

  it("重複名稱只列一次", () => {
    const plan = planProductDeletion({
      name: "原味袋",
      stockSourceDependents: [],
      bundleNames: ["袋裝任選", "袋裝任選"]
    });

    expect(plan.ok).toBe(true);
    if (!plan.ok) throw new Error("預期放行");
    expect(plan.clearedRelation).toBe("已從組合價「袋裝任選」移除此商品");
  });
});

describe("planFlavorDeletion", () => {
  it("是固定禮盒的內容物時擋下,並列出是哪些禮盒", () => {
    const plan = planFlavorDeletion({
      name: "原味",
      fixedGiftBoxNames: ["發禮盒"],
      allowedGiftBoxNames: []
    });

    expect(plan.ok).toBe(false);
    if (plan.ok) throw new Error("預期擋下");
    expect(plan.error).toContain("原味");
    expect(plan.error).toContain("發禮盒");
  });

  it("只被自選禮盒列為可選時放行,並告知會從哪些禮盒移除", () => {
    const plan = planFlavorDeletion({
      name: "草莓",
      fixedGiftBoxNames: [],
      allowedGiftBoxNames: ["小禮盒"]
    });

    expect(plan.ok).toBe(true);
    if (!plan.ok) throw new Error("預期放行");
    expect(plan.clearedRelation).toContain("小禮盒");
  });

  it("沒有任何關聯時放行且不需要清理", () => {
    const plan = planFlavorDeletion({
      name: "測試口味",
      fixedGiftBoxNames: [],
      allowedGiftBoxNames: []
    });

    expect(plan).toEqual({ ok: true, clearedRelation: null });
  });

  it("固定禮盒優先於自選禮盒:兩者都有時仍然擋下", () => {
    const plan = planFlavorDeletion({
      name: "原味",
      fixedGiftBoxNames: ["發禮盒"],
      allowedGiftBoxNames: ["小禮盒"]
    });

    expect(plan.ok).toBe(false);
  });
});
```

- [ ] **Step 2: 執行測試確認失敗**

Run: `npx vitest run tests/domain/soft-delete.test.ts`
Expected: FAIL，訊息為 `Cannot find module '@/lib/domain/soft-delete'`。

- [ ] **Step 3: 實作**

建立 `lib/domain/soft-delete.ts`：

```ts
// 軟刪除的前置判斷。軟刪除不會觸發資料庫 cascade,
// 所以要自己決定哪些情況「擋下」、哪些關聯要「一併清掉」。純邏輯,不放 I/O。

export type SoftDeletePlan =
  | { ok: true; clearedRelation: string | null }
  | { ok: false; error: string };

function joinNames(names: string[]) {
  return Array.from(new Set(names)).join("、");
}

// 擋下條件:有其他商品以它為庫存來源。放行的話那些商品賣出時會去扣一個已刪除商品的庫存。
export function planProductDeletion(params: {
  name: string;
  stockSourceDependents: string[];
  bundleNames: string[];
}): SoftDeletePlan {
  if (params.stockSourceDependents.length > 0) {
    return {
      ok: false,
      error: `「${params.name}」是這些商品的庫存來源，請先改掉它們的庫存來源再刪除：${joinNames(
        params.stockSourceDependents
      )}`
    };
  }

  return {
    ok: true,
    clearedRelation: params.bundleNames.length
      ? `已從組合價「${joinNames(params.bundleNames)}」移除此商品`
      : null
  };
}

// 擋下條件:被固定禮盒當作內容物。放行的話禮盒內容會指向不存在的口味。
export function planFlavorDeletion(params: {
  name: string;
  fixedGiftBoxNames: string[];
  allowedGiftBoxNames: string[];
}): SoftDeletePlan {
  if (params.fixedGiftBoxNames.length > 0) {
    return {
      ok: false,
      error: `「${params.name}」是這些固定禮盒的內容物，請先調整禮盒內容再刪除：${joinNames(
        params.fixedGiftBoxNames
      )}`
    };
  }

  return {
    ok: true,
    clearedRelation: params.allowedGiftBoxNames.length
      ? `已從自選禮盒「${joinNames(params.allowedGiftBoxNames)}」的可選口味中移除`
      : null
  };
}
```

- [ ] **Step 4: 執行測試確認通過**

Run: `npx vitest run tests/domain/soft-delete.test.ts`
Expected: PASS，9 個測試全綠。

- [ ] **Step 5: Commit**

```bash
git add lib/domain/soft-delete.ts tests/domain/soft-delete.test.ts
git commit -m "feat: add soft delete planners"
```

---

### Task 2: `deleted_at` 欄位 migration

**Files:**
- Create: `supabase/migrations/202608250002_soft_delete_catalog.sql`
- Modify: `lib/domain/audit-diff.ts`（`FIELD_LABELS` 加一個欄位）

**Interfaces:**
- Consumes: 無
- Produces: `public.products.deleted_at`、`public.flavors.deleted_at`、`public.bundles.deleted_at`，型別皆為 `timestamptz`、可為 null

- [ ] **Step 1: 建立 migration**

建立 `supabase/migrations/202608250002_soft_delete_catalog.sql`：

```sql
-- 商品/口味/組合價改為軟刪除,讓「刪除」與「停用」成為兩個並存的狀態。
--
-- 關鍵:刪除時應用層會同時寫 deleted_at 與 is_active = false。
-- 因為 POS 端每一處查詢本來就有 is_active 過濾(訂單 RPC、/api/catalog、組合價計算),
-- 已刪除項目會自動從 POS 消失,這些查詢一行都不用改。
--
-- 表都只有數十列,不加索引。RLS policy 也不動,理由同上。
alter table public.products add column if not exists deleted_at timestamptz;
alter table public.flavors  add column if not exists deleted_at timestamptz;
alter table public.bundles  add column if not exists deleted_at timestamptz;
```

- [ ] **Step 2: 套用到本機資料庫**

> 本專案有 link 到正式區，**所有指令都必須加 `--local`**，不得使用 `supabase db push`。

Run: `npx supabase migration up --local`
Expected: 輸出含 `Applying migration 202608250002_soft_delete_catalog.sql...` 與 `"message":"Migrations applied"`。

- [ ] **Step 3: 確認欄位存在**

Run:
```bash
docker exec supabase_db_sweet-pos psql -U postgres -d postgres -c \
"select table_name, column_name, data_type, is_nullable
 from information_schema.columns
 where table_schema='public' and column_name='deleted_at' order by table_name;"
```
Expected: 三列，`bundles` / `flavors` / `products`，型別皆為 `timestamp with time zone`，`is_nullable` 皆為 `YES`。

- [ ] **Step 4: 稽核明細加上欄位中文名**

修改 `lib/domain/audit-diff.ts`，在 `FIELD_LABELS` 的 `updated_at: "更新時間",` 之後加入一行：

```ts
  deleted_at: "刪除時間",
```

（快照用 `select("*")`，刪除與復原的變更明細會出現這個欄位，沒有對照表會顯示原始欄位名。）

- [ ] **Step 5: 測試與型別檢查**

Run: `npm run test && npx tsc --noEmit; echo "exit=$?"`
Expected: 測試全綠，`exit=0`。

- [ ] **Step 6: Commit**

```bash
git add supabase/migrations/202608250002_soft_delete_catalog.sql lib/domain/audit-diff.ts
git commit -m "feat: add deleted_at to catalog tables"
```

---

### Task 3: products 路由改為軟刪除

**Files:**
- Modify: `app/api/products/route.ts`

**Interfaces:**
- Consumes: `planProductDeletion`（Task 1）、`writeAuditLog` 與 `fetchProductSnapshot`（皆已存在於本檔）
- Produces: `GET /api/products?includeDeleted=1`；回應的每個 product 多一個 `deletedAt: string | null`；`PATCH` 接受 `{ id, restore: true }`；`DELETE` 回應 `mode: "deleted"` 並可能帶 `message`

- [ ] **Step 1: 加入 import**

在 `app/api/products/route.ts` 的 import 區塊，於 `import { products as sampleProducts }` 之前加入：

```ts
import { planProductDeletion } from "@/lib/domain/soft-delete";
```

- [ ] **Step 2: GET 支援 includeDeleted 並回傳 deletedAt**

把 `export async function GET() {` 改成：

```ts
export async function GET(request: Request) {
```

把既有的這一行：

```ts
    supabase.from("products").select("*").order("category").order("name"),
```

替換為（先取出參數再組查詢）：

```ts
    buildProductsQuery(supabase, request),
```

在 `products: (productsResult.data ?? []).map((product) => {` 區塊內，於 `stockSourceProductId: product.stock_source_product_id ?? null,` 之後加入一行：

```ts
          deletedAt: product.deleted_at ?? null,
```

並在檔案最下方加入查詢建構函式：

```ts
// 後台清單預設不顯示已刪除商品;帶 includeDeleted=1 才顯示(供「顯示已刪除」勾選框使用)。
function buildProductsQuery(
  supabase: ReturnType<typeof createSupabaseAdminClient>,
  request: Request
) {
  const includeDeleted =
    new URL(request.url).searchParams.get("includeDeleted") === "1";
  const query = supabase.from("products").select("*").order("category").order("name");

  return includeDeleted ? query : query.is("deleted_at", null);
}
```

- [ ] **Step 3: PATCH 加入復原分支並拒絕編輯已刪除商品**

在 PATCH 內，把這段：

```ts
  const input = (await request.json()) as UpsertProductInput;

  if (!input.id) {
    return NextResponse.json({ ok: false, error: "缺少商品編號" }, { status: 400 });
  }

  const validation = validateProductInput(input);
```

替換為：

```ts
  const input = (await request.json()) as UpsertProductInput & { restore?: boolean };

  if (!input.id) {
    return NextResponse.json({ ok: false, error: "缺少商品編號" }, { status: 400 });
  }

  // 復原:只把 deleted_at 設回 null,其他欄位一律不動,也不跑欄位驗證。
  // 維持 is_active = false,要不要重新啟用由店長另外決定。
  if (input.restore) {
    if (!hasSupabaseAdminEnv()) {
      return NextResponse.json({
        ok: true,
        data: { productId: input.id, mode: "restored", source: "demo" }
      });
    }

    const supabase = createSupabaseAdminClient();
    const beforeSnapshot = await fetchProductSnapshot(supabase, input.id);
    const { error } = await supabase
      .from("products")
      .update({ deleted_at: null })
      .eq("id", input.id);

    if (error) {
      return NextResponse.json({ ok: false, error: error.message }, { status: 400 });
    }

    await writeAuditLog(supabase, {
      actor: guard.profile ?? null,
      action: "update",
      entity: "products",
      entityId: input.id,
      entityLabel: (beforeSnapshot?.name as string) ?? null,
      before: beforeSnapshot,
      after: await fetchProductSnapshot(supabase, input.id)
    });

    return NextResponse.json({
      ok: true,
      data: { productId: input.id, mode: "restored", source: "supabase" }
    });
  }

  const validation = validateProductInput(input);
```

接著在 PATCH 既有的這一行之後：

```ts
  const beforeSnapshot = await fetchProductSnapshot(supabase, input.id);
```

加入已刪除防呆（不擋的話可能把 `is_active` 改回 true，讓已刪除商品重回 POS）：

```ts
  if (beforeSnapshot?.deleted_at) {
    return NextResponse.json(
      { ok: false, error: "商品已刪除，請先復原後再編輯" },
      { status: 400 }
    );
  }
```

- [ ] **Step 4: DELETE 改寫為軟刪除**

把 DELETE 內從 `const supabase = createSupabaseAdminClient();` 開始到函式結束的整段（即參照計數、停用分支、硬刪除）替換為：

```ts
  const supabase = createSupabaseAdminClient();
  const beforeSnapshot = await fetchProductSnapshot(supabase, input.id);

  if (!beforeSnapshot) {
    return NextResponse.json({ ok: false, error: "找不到商品" }, { status: 404 });
  }

  const [dependentsResult, bundlesResult] = await Promise.all([
    supabase
      .from("products")
      .select("name")
      .eq("stock_source_product_id", input.id)
      .is("deleted_at", null),
    supabase.from("bundle_products").select("bundles(name)").eq("product_id", input.id)
  ]);

  const lookupError = dependentsResult.error ?? bundlesResult.error;

  if (lookupError) {
    return NextResponse.json({ ok: false, error: lookupError.message }, { status: 500 });
  }

  const plan = planProductDeletion({
    name: beforeSnapshot.name as string,
    stockSourceDependents: (dependentsResult.data ?? []).map((row) => row.name as string),
    bundleNames: (bundlesResult.data ?? [])
      .map((row) => (row.bundles as { name: string } | null)?.name)
      .filter((name): name is string => Boolean(name))
  });

  if (!plan.ok) {
    return NextResponse.json({ ok: false, error: plan.error }, { status: 400 });
  }

  // 軟刪除不會觸發 cascade,組合價關聯要自己清掉(效果等同原本的 on delete cascade,但改成明示)。
  if (plan.clearedRelation) {
    const { error: clearError } = await supabase
      .from("bundle_products")
      .delete()
      .eq("product_id", input.id);

    if (clearError) {
      return NextResponse.json({ ok: false, error: clearError.message }, { status: 400 });
    }
  }

  // 同時停用是關鍵:POS 端既有的 is_active 過濾因此自動排除已刪除商品。
  const { error } = await supabase
    .from("products")
    .update({ deleted_at: new Date().toISOString(), is_active: false })
    .eq("id", input.id);

  if (error) {
    return NextResponse.json({ ok: false, error: error.message }, { status: 400 });
  }

  await writeAuditLog(supabase, {
    actor: guard.profile ?? null,
    action: "delete",
    entity: "products",
    entityId: input.id,
    entityLabel: beforeSnapshot.name as string,
    before: beforeSnapshot,
    after: await fetchProductSnapshot(supabase, input.id)
  });

  return NextResponse.json({
    ok: true,
    data: {
      productId: input.id,
      mode: "deleted",
      message: plan.clearedRelation ?? undefined,
      source: "supabase"
    }
  });
}
```

- [ ] **Step 5: 型別檢查與建置**

Run: `npx tsc --noEmit; echo "tsc=$?"`
Expected: `tsc=0`。

Run: `npm run build 2>&1 | grep -E "Compiled successfully|error"`
Expected: `✓ Compiled successfully`。

- [ ] **Step 6: 確認舊的硬刪除路徑已消失**

Run: `grep -n 'from("products").delete()\|mode: "deactivated"' app/api/products/route.ts`
Expected: **沒有任何輸出**。有輸出代表舊路徑還在。

- [ ] **Step 7: Commit**

```bash
git add app/api/products/route.ts
git commit -m "feat: soft delete products"
```

---

### Task 4: flavors 路由改為軟刪除

**Files:**
- Modify: `app/api/flavors/route.ts`

**Interfaces:**
- Consumes: `planFlavorDeletion`（Task 1）、`writeAuditLog` 與 `fetchFlavorSnapshot`（皆已存在於本檔）
- Produces: `GET /api/flavors?includeDeleted=1`；回應的每個 flavor 多一個 `deletedAt: string | null`；`PATCH` 接受 `{ id, restore: true }`；`DELETE` 回應 `mode: "deleted"` 並可能帶 `message`

- [ ] **Step 1: 加入 import**

在 `app/api/flavors/route.ts` 的 import 區塊，於 `import { flavors as sampleFlavors }` 之前加入：

```ts
import { planFlavorDeletion } from "@/lib/domain/soft-delete";
```

- [ ] **Step 2: GET 支援 includeDeleted 並回傳 deletedAt**

把 `export async function GET() {` 改成 `export async function GET(request: Request) {`。

把這一行：

```ts
  const { data, error } = await supabase.from("flavors").select("*").order("name");
```

替換為：

```ts
  const includeDeleted =
    new URL(request.url).searchParams.get("includeDeleted") === "1";
  const flavorsQuery = supabase.from("flavors").select("*").order("name");
  const { data, error } = await (includeDeleted
    ? flavorsQuery
    : flavorsQuery.is("deleted_at", null));
```

在回傳的 `.map((flavor) => ({ ... }))` 內，於 `isActive: flavor.is_active` 之後加上逗號並新增一行：

```ts
        isActive: flavor.is_active,
        deletedAt: flavor.deleted_at ?? null
```

- [ ] **Step 3: PATCH 加入復原分支並拒絕編輯已刪除口味**

在 PATCH 內，把這段：

```ts
  const input = (await request.json()) as {
    id?: string;
    name?: string;
    spec?: string;
    isActive?: boolean;
  };

  if (!input.id) {
    return NextResponse.json({ ok: false, error: "缺少口味編號" }, { status: 400 });
  }

  if (!input.name?.trim()) {
    return NextResponse.json({ ok: false, error: "缺少口味名稱" }, { status: 400 });
  }
```

替換為：

```ts
  const input = (await request.json()) as {
    id?: string;
    name?: string;
    spec?: string;
    isActive?: boolean;
    restore?: boolean;
  };

  if (!input.id) {
    return NextResponse.json({ ok: false, error: "缺少口味編號" }, { status: 400 });
  }

  // 復原:只把 deleted_at 設回 null,不動其他欄位,也不要求帶名稱。
  if (input.restore) {
    if (!hasSupabaseAdminEnv()) {
      return NextResponse.json({
        ok: true,
        data: { flavorId: input.id, mode: "restored", source: "demo" }
      });
    }

    const supabase = createSupabaseAdminClient();
    const beforeSnapshot = await fetchFlavorSnapshot(supabase, input.id);
    const { error } = await supabase
      .from("flavors")
      .update({ deleted_at: null })
      .eq("id", input.id);

    if (error) {
      return NextResponse.json({ ok: false, error: error.message }, { status: 400 });
    }

    await writeAuditLog(supabase, {
      actor: guard.profile ?? null,
      action: "update",
      entity: "flavors",
      entityId: input.id,
      entityLabel: (beforeSnapshot?.name as string) ?? null,
      before: beforeSnapshot,
      after: await fetchFlavorSnapshot(supabase, input.id)
    });

    return NextResponse.json({
      ok: true,
      data: { flavorId: input.id, mode: "restored", source: "supabase" }
    });
  }

  if (!input.name?.trim()) {
    return NextResponse.json({ ok: false, error: "缺少口味名稱" }, { status: 400 });
  }
```

在 PATCH 既有的 `const beforeSnapshot = await fetchFlavorSnapshot(supabase, input.id);` 之後加入：

```ts
  if (beforeSnapshot?.deleted_at) {
    return NextResponse.json(
      { ok: false, error: "口味已刪除，請先復原後再編輯" },
      { status: 400 }
    );
  }
```

- [ ] **Step 4: DELETE 改寫為軟刪除**

把 DELETE 內從 `const supabase = createSupabaseAdminClient();` 開始到函式結束的整段替換為：

```ts
  const supabase = createSupabaseAdminClient();
  const beforeSnapshot = await fetchFlavorSnapshot(supabase, input.id);

  if (!beforeSnapshot) {
    return NextResponse.json({ ok: false, error: "找不到口味" }, { status: 404 });
  }

  const [fixedResult, allowedResult] = await Promise.all([
    supabase.from("gift_box_fixed_flavors").select("products(name)").eq("flavor_id", input.id),
    supabase.from("gift_box_allowed_flavors").select("products(name)").eq("flavor_id", input.id)
  ]);

  const lookupError = fixedResult.error ?? allowedResult.error;

  if (lookupError) {
    return NextResponse.json({ ok: false, error: lookupError.message }, { status: 500 });
  }

  const giftBoxNames = (rows: Array<{ products: unknown }> | null) =>
    (rows ?? [])
      .map((row) => (row.products as { name: string } | null)?.name)
      .filter((name): name is string => Boolean(name));

  const plan = planFlavorDeletion({
    name: beforeSnapshot.name as string,
    fixedGiftBoxNames: giftBoxNames(fixedResult.data),
    allowedGiftBoxNames: giftBoxNames(allowedResult.data)
  });

  if (!plan.ok) {
    return NextResponse.json({ ok: false, error: plan.error }, { status: 400 });
  }

  // 軟刪除不會觸發 cascade,自選禮盒的可選口味關聯要自己清掉。
  if (plan.clearedRelation) {
    const { error: clearError } = await supabase
      .from("gift_box_allowed_flavors")
      .delete()
      .eq("flavor_id", input.id);

    if (clearError) {
      return NextResponse.json({ ok: false, error: clearError.message }, { status: 400 });
    }
  }

  // 同時停用是關鍵:POS 型錄既有的 is_active 過濾因此自動排除已刪除口味。
  const { error } = await supabase
    .from("flavors")
    .update({ deleted_at: new Date().toISOString(), is_active: false })
    .eq("id", input.id);

  if (error) {
    return NextResponse.json({ ok: false, error: error.message }, { status: 400 });
  }

  await writeAuditLog(supabase, {
    actor: guard.profile ?? null,
    action: "delete",
    entity: "flavors",
    entityId: input.id,
    entityLabel: beforeSnapshot.name as string,
    before: beforeSnapshot,
    after: await fetchFlavorSnapshot(supabase, input.id)
  });

  return NextResponse.json({
    ok: true,
    data: {
      flavorId: input.id,
      mode: "deleted",
      message: plan.clearedRelation ?? undefined,
      source: "supabase"
    }
  });
}
```

- [ ] **Step 5: 型別檢查與建置**

Run: `npx tsc --noEmit; echo "tsc=$?"`
Expected: `tsc=0`。

Run: `npm run build 2>&1 | grep -E "Compiled successfully|error"`
Expected: `✓ Compiled successfully`。

- [ ] **Step 6: 確認舊的硬刪除路徑已消失**

Run: `grep -n 'from("flavors").delete()\|mode: "deactivated"' app/api/flavors/route.ts`
Expected: **沒有任何輸出**。

- [ ] **Step 7: Commit**

```bash
git add app/api/flavors/route.ts
git commit -m "feat: soft delete flavors"
```

---

### Task 5: bundles 路由改為軟刪除

**Files:**
- Modify: `app/api/bundles/route.ts`

**Interfaces:**
- Consumes: `writeAuditLog` 與 `fetchBundleSnapshot`（皆已存在於本檔）
- Produces: `GET /api/bundles?includeDeleted=1`；回應的每個 bundle 多一個 `deletedAt: string | null`；`PATCH` 接受 `{ id, restore: true }`；`DELETE` 回應 `mode: "deleted"`

> 組合價**沒有擋下條件也沒有要清的外部關聯**：`bundle_products` 與 `bundle_tiers` 是它自己的子表，軟刪除後它們留著正好讓復原能還原完整內容。

- [ ] **Step 1: GET 支援 includeDeleted 並回傳 deletedAt**

把 `export async function GET() {` 改成 `export async function GET(request: Request) {`。

把這段：

```ts
  const { data, error } = await supabase
    .from("bundles")
    .select("id, name, is_active, bundle_products(product_id), bundle_tiers(quantity, price)")
    .order("created_at");
```

替換為：

```ts
  const includeDeleted =
    new URL(request.url).searchParams.get("includeDeleted") === "1";
  const bundlesQuery = supabase
    .from("bundles")
    .select(
      "id, name, is_active, deleted_at, bundle_products(product_id), bundle_tiers(quantity, price)"
    )
    .order("created_at");
  const { data, error } = await (includeDeleted
    ? bundlesQuery
    : bundlesQuery.is("deleted_at", null));
```

在回傳的 `.map((bundle) => ({ ... }))` 內，於 `isActive: bundle.is_active,` 之後加入一行：

```ts
        deletedAt: bundle.deleted_at ?? null,
```

- [ ] **Step 2: `upsertBundle` 加入復原分支並拒絕編輯已刪除組合價**

在 `upsertBundle` 內，把這段：

```ts
  const input = (await request.json()) as UpsertBundleInput;

  if (mode === "update" && !input.id) {
    return NextResponse.json({ ok: false, error: "缺少組合編號" }, { status: 400 });
  }
  if (!input.name?.trim()) {
    return NextResponse.json({ ok: false, error: "缺少組合名稱" }, { status: 400 });
  }
```

替換為：

```ts
  const input = (await request.json()) as UpsertBundleInput & { restore?: boolean };

  if (mode === "update" && !input.id) {
    return NextResponse.json({ ok: false, error: "缺少組合編號" }, { status: 400 });
  }

  // 復原:只把 deleted_at 設回 null,不動名稱/商品群/級距,也不跑欄位驗證。
  if (mode === "update" && input.restore && input.id) {
    if (!hasSupabaseAdminEnv()) {
      return NextResponse.json({
        ok: true,
        data: { bundleId: input.id, mode: "restored", source: "demo" }
      });
    }

    const supabase = createSupabaseAdminClient();
    const beforeSnapshot = await fetchBundleSnapshot(supabase, input.id);
    const { error } = await supabase
      .from("bundles")
      .update({ deleted_at: null })
      .eq("id", input.id);

    if (error) {
      return NextResponse.json({ ok: false, error: error.message }, { status: 400 });
    }

    await writeAuditLog(supabase, {
      actor: guard.profile ?? null,
      action: "update",
      entity: "bundles",
      entityId: input.id,
      entityLabel: (beforeSnapshot?.name as string) ?? null,
      before: beforeSnapshot,
      after: await fetchBundleSnapshot(supabase, input.id)
    });

    return NextResponse.json({
      ok: true,
      data: { bundleId: input.id, mode: "restored", source: "supabase" }
    });
  }

  if (!input.name?.trim()) {
    return NextResponse.json({ ok: false, error: "缺少組合名稱" }, { status: 400 });
  }
```

在 `upsertBundle` 既有的這一行之後：

```ts
  const beforeSnapshot =
    mode === "update" && input.id ? await fetchBundleSnapshot(supabase, input.id) : null;
```

加入已刪除防呆：

```ts
  if (beforeSnapshot?.deleted_at) {
    return NextResponse.json(
      { ok: false, error: "組合價已刪除，請先復原後再編輯" },
      { status: 400 }
    );
  }
```

- [ ] **Step 3: `fetchBundleSnapshot` 納入 deleted_at**

上一步的防呆需要快照帶有 `deleted_at`。修改檔案下方的 `fetchBundleSnapshot`：

把 `.select("id, name, is_active, bundle_products(product_id), bundle_tiers(quantity, price)")` 改成：

```ts
    .select(
      "id, name, is_active, deleted_at, bundle_products(product_id), bundle_tiers(quantity, price)"
    )
```

並在回傳物件的 `is_active: data.is_active,` 之後加入一行：

```ts
    deleted_at: data.deleted_at ?? null,
```

- [ ] **Step 4: DELETE 改寫為軟刪除**

把 DELETE 內從 `const supabase = createSupabaseAdminClient();` 開始到函式結束的整段替換為：

```ts
  const supabase = createSupabaseAdminClient();
  const beforeSnapshot = await fetchBundleSnapshot(supabase, input.id);

  if (!beforeSnapshot) {
    return NextResponse.json({ ok: false, error: "找不到組合價" }, { status: 404 });
  }

  // 同時停用是關鍵:組合價折抵計算既有的 is_active 過濾因此自動排除已刪除組合價。
  // bundle_products / bundle_tiers 是它自己的子表,保留著讓復原能還原完整內容。
  const { error } = await supabase
    .from("bundles")
    .update({ deleted_at: new Date().toISOString(), is_active: false })
    .eq("id", input.id);

  if (error) {
    return NextResponse.json({ ok: false, error: error.message }, { status: 400 });
  }

  await writeAuditLog(supabase, {
    actor: guard.profile ?? null,
    action: "delete",
    entity: "bundles",
    entityId: input.id,
    entityLabel: beforeSnapshot.name as string,
    before: beforeSnapshot,
    after: await fetchBundleSnapshot(supabase, input.id)
  });

  return NextResponse.json({
    ok: true,
    data: { bundleId: input.id, mode: "deleted", source: "supabase" }
  });
}
```

- [ ] **Step 5: 型別檢查與建置**

Run: `npx tsc --noEmit; echo "tsc=$?"`
Expected: `tsc=0`。

Run: `npm run build 2>&1 | grep -E "Compiled successfully|error"`
Expected: `✓ Compiled successfully`。

- [ ] **Step 6: 確認舊的硬刪除路徑已消失**

Run: `grep -n 'from("bundles").delete()' app/api/bundles/route.ts`
Expected: **沒有任何輸出**。

- [ ] **Step 7: Commit**

```bash
git add app/api/bundles/route.ts
git commit -m "feat: soft delete bundles"
```

---

### Task 6: 後台 UI —— 顯示已刪除與復原

**Files:**
- Modify: `components/manager/ProductSettings.tsx`

**Interfaces:**
- Consumes: Task 3–5 的 `includeDeleted=1` 參數、回應中的 `deletedAt`、`{ id, restore: true }` 的 PATCH
- Produces: 無（頁面內部狀態）

> **與 spec 的一處刻意偏離：** spec 寫「三張表的後台清單各加一個勾選框」。商品、口味、組合價三個清單都在同一頁（`/manager/products`），三個勾選框重複且雜亂，改為**頁面層級一個共用勾選框**同時控制三張清單。

- [ ] **Step 1: 型別加上 deletedAt**

在 `components/manager/ProductSettings.tsx` 上方的三個型別各加一個欄位。

`ProductRow` 的 `stockSourceProductId: string | null;` 之後：

```ts
  deletedAt: string | null;
```

`FlavorRow` 的 `isActive: boolean;` 之後：

```ts
  deletedAt: string | null;
```

`BundleRow` 的 `isActive: boolean;` 之後：

```ts
  deletedAt: string | null;
```

- [ ] **Step 2: 加入 showDeleted 狀態並讓 loadData 帶參數**

在 `const [saving, setSaving] = useState(false);` 之後加入：

```ts
  const [showDeleted, setShowDeleted] = useState(false);
```

把既有的：

```ts
  useEffect(() => {
    void loadData();
  }, []);
```

改成（切換勾選框要重新載入）：

```ts
  useEffect(() => {
    void loadData();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [showDeleted]);
```

把 `loadData` 內的四個 fetch 改成：

```ts
  async function loadData() {
    const suffix = showDeleted ? "?includeDeleted=1" : "";
    const [productsResult, discountsResult, flavorsResult, bundlesResult] = await Promise.all([
      fetch(`/api/products${suffix}`).then((response) => response.json()),
      fetch("/api/discounts").then((response) => response.json()),
      fetch(`/api/flavors${suffix}`).then((response) => response.json()),
      fetch(`/api/bundles${suffix}`).then((response) => response.json())
    ]);
```

（折扣沒有軟刪除，維持原樣。）

- [ ] **Step 3: 加入復原函式**

在 `deleteProduct` 函式之後加入三個復原函式：

```ts
  async function restoreItem(
    endpoint: "/api/products" | "/api/flavors" | "/api/bundles",
    id: string,
    name: string
  ) {
    setSaving(true);
    setStatus(`復原「${name}」中...`);

    const response = await fetch(endpoint, {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ id, restore: true })
    });
    const result = await response.json();

    setSaving(false);

    if (!result.ok) {
      setStatus(result.error);
      return;
    }

    setStatus(`「${name}」已復原，目前為停用狀態，需要的話再手動啟用`);
    await loadData();
  }
```

- [ ] **Step 4: 更新三個刪除確認訊息**

刪除不再會靜默降級成停用，確認文字要改掉。

把：

```ts
    if (!window.confirm(`確定刪除「${product.name}」？已有訂單或庫存紀錄的商品會改為停用。`)) {
```

改成：

```ts
    if (
      !window.confirm(
        `確定刪除「${product.name}」？刪除後 POS 與後台清單都不再顯示，歷史訂單與報表不受影響，可從「顯示已刪除」復原。`
      )
    ) {
```

把：

```ts
    if (!window.confirm(`確定刪除口味「${flavor.name}」？已有紀錄的口味會改為停用。`)) return;
```

改成：

```ts
    if (
      !window.confirm(
        `確定刪除口味「${flavor.name}」？刪除後 POS 與後台清單都不再顯示，歷史紀錄不受影響，可從「顯示已刪除」復原。`
      )
    )
      return;
```

把：

```ts
    if (!window.confirm(`確定刪除組合價「${bundle.name}」？`)) return;
```

改成：

```ts
    if (
      !window.confirm(
        `確定刪除組合價「${bundle.name}」？刪除後不再套用，可從「顯示已刪除」復原。`
      )
    )
      return;
```

- [ ] **Step 5: 刪除結果訊息改掉降級判斷**

把 `deleteProduct` 內的：

```ts
    setStatus(result.data.mode === "deactivated" ? result.data.message : `「${product.name}」已刪除`);
```

改成（`message` 只在有清掉組合價關聯時才有）：

```ts
    setStatus(
      result.data.message
        ? `「${product.name}」已刪除，${result.data.message}`
        : `「${product.name}」已刪除`
    );
```

把口味刪除內的：

```ts
      result.data.mode === "deactivated" ? result.data.message : `口味「${flavor.name}」已刪除`
```

改成：

```ts
      result.data.message
        ? `口味「${flavor.name}」已刪除，${result.data.message}`
        : `口味「${flavor.name}」已刪除`
```

- [ ] **Step 6: 加入「顯示已刪除」勾選框**

在最外層第一個 `<section>` 內、顯示 `{status}` 的 `<span className="pill">` 之前加入：

```tsx
        <label className="inline-check">
          <input
            checked={showDeleted}
            onChange={(event) => setShowDeleted(event.target.checked)}
            type="checkbox"
          />
          顯示已刪除
        </label>
```

在 `app/globals.css` 末尾加入樣式：

```css
.inline-check {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  margin-right: 12px;
  font-size: 13px;
  color: var(--muted);
}
```

- [ ] **Step 7: 三個清單顯示已刪除狀態與復原按鈕**

三個清單的「狀態」欄與「操作」欄都要改。已刪除的列只顯示「復原」，不顯示編輯與刪除。

**商品表格。** 把：

```tsx
                  <td>{product.isActive ? "啟用" : "停用"}</td>
                  <td>
                    <div className="toolbar">
                      <button
                        className="secondary-action"
                        onClick={() => editProduct(product)}
                        type="button"
                      >
                        編輯
                      </button>
                      <button
                        className="secondary-action"
                        disabled={saving}
                        onClick={() => deleteProduct(product)}
                        type="button"
                      >
                        刪除
                      </button>
                    </div>
                  </td>
```

替換為：

```tsx
                  <td>{product.deletedAt ? "已刪除" : product.isActive ? "啟用" : "停用"}</td>
                  <td>
                    <div className="toolbar">
                      {product.deletedAt ? (
                        <button
                          className="secondary-action"
                          disabled={saving}
                          onClick={() => restoreItem("/api/products", product.id, product.name)}
                          type="button"
                        >
                          復原
                        </button>
                      ) : (
                        <>
                          <button
                            className="secondary-action"
                            onClick={() => editProduct(product)}
                            type="button"
                          >
                            編輯
                          </button>
                          <button
                            className="secondary-action"
                            disabled={saving}
                            onClick={() => deleteProduct(product)}
                            type="button"
                          >
                            刪除
                          </button>
                        </>
                      )}
                    </div>
                  </td>
```

**口味表格。** 把：

```tsx
                  <td>{flavor.isActive ? "啟用" : "停用"}</td>
                  <td>
                    <div className="toolbar">
                      <button
                        className="secondary-action"
                        onClick={() => {
                          setFlavorForm({
                            id: flavor.id,
                            name: flavor.name,
                            spec: flavor.spec,
                            isActive: flavor.isActive
                          });
                          setModal("flavor");
                        }}
                        type="button"
                      >
                        編輯
                      </button>
                      <button
                        className="secondary-action"
                        disabled={saving}
                        onClick={() => deleteFlavor(flavor)}
                        type="button"
                      >
                        刪除
                      </button>
                    </div>
                  </td>
```

替換為：

```tsx
                  <td>{flavor.deletedAt ? "已刪除" : flavor.isActive ? "啟用" : "停用"}</td>
                  <td>
                    <div className="toolbar">
                      {flavor.deletedAt ? (
                        <button
                          className="secondary-action"
                          disabled={saving}
                          onClick={() => restoreItem("/api/flavors", flavor.id, flavor.name)}
                          type="button"
                        >
                          復原
                        </button>
                      ) : (
                        <>
                          <button
                            className="secondary-action"
                            onClick={() => {
                              setFlavorForm({
                                id: flavor.id,
                                name: flavor.name,
                                spec: flavor.spec,
                                isActive: flavor.isActive
                              });
                              setModal("flavor");
                            }}
                            type="button"
                          >
                            編輯
                          </button>
                          <button
                            className="secondary-action"
                            disabled={saving}
                            onClick={() => deleteFlavor(flavor)}
                            type="button"
                          >
                            刪除
                          </button>
                        </>
                      )}
                    </div>
                  </td>
```

**組合價表格。** 把：

```tsx
                  <td>{bundle.isActive ? "啟用" : "停用"}</td>
                  <td>
                    <div className="toolbar">
                      <button
                        className="secondary-action"
                        onClick={() => {
                          setBundleForm({
                            id: bundle.id,
                            name: bundle.name,
                            isActive: bundle.isActive,
                            productIds: [...bundle.productIds],
                            tiers: bundle.tiers.map((tier) => ({ ...tier }))
                          });
                          setModal("bundle");
                        }}
                        type="button"
                      >
                        編輯
                      </button>
                      <button
                        className="secondary-action"
                        disabled={saving}
                        onClick={() => deleteBundle(bundle)}
                        type="button"
                      >
                        刪除
                      </button>
                    </div>
                  </td>
```

替換為：

```tsx
                  <td>{bundle.deletedAt ? "已刪除" : bundle.isActive ? "啟用" : "停用"}</td>
                  <td>
                    <div className="toolbar">
                      {bundle.deletedAt ? (
                        <button
                          className="secondary-action"
                          disabled={saving}
                          onClick={() => restoreItem("/api/bundles", bundle.id, bundle.name)}
                          type="button"
                        >
                          復原
                        </button>
                      ) : (
                        <>
                          <button
                            className="secondary-action"
                            onClick={() => {
                              setBundleForm({
                                id: bundle.id,
                                name: bundle.name,
                                isActive: bundle.isActive,
                                productIds: [...bundle.productIds],
                                tiers: bundle.tiers.map((tier) => ({ ...tier }))
                              });
                              setModal("bundle");
                            }}
                            type="button"
                          >
                            編輯
                          </button>
                          <button
                            className="secondary-action"
                            disabled={saving}
                            onClick={() => deleteBundle(bundle)}
                            type="button"
                          >
                            刪除
                          </button>
                        </>
                      )}
                    </div>
                  </td>
```

- [ ] **Step 8: 型別檢查與建置**

Run: `npx tsc --noEmit; echo "tsc=$?"`
Expected: `tsc=0`。

Run: `npm run build 2>&1 | grep -E "Compiled successfully|error"`
Expected: `✓ Compiled successfully`。

- [ ] **Step 9: Commit**

```bash
git add components/manager/ProductSettings.tsx app/globals.css
git commit -m "feat: show and restore soft deleted catalog items"
```

---

### Task 7: 端對端驗證

**Files:**
- Modify: `docs/superpowers/plans/2026-08-25-catalog-soft-delete.md`（勾選完成項）

**Interfaces:**
- Consumes: Task 1–6 的全部產出
- Produces: 無

> 需要本機 Supabase 與 dev server。**本專案有 link 到正式區，任何資料庫指令都必須加 `--local`。**

- [ ] **Step 1: 全套測試與建置**

Run: `npm run test && npm run build 2>&1 | grep -E "Compiled successfully|error"`
Expected: 測試全綠（含 Task 1 的 9 個新測試），`✓ Compiled successfully`。

- [ ] **Step 2: 啟動環境並取得店長 session**

Run:
```bash
npx supabase start
npm run dev &
```

以 `manager@example.local` / `password123` 登入取得 cookie（種子帳號密碼見 `supabase/seed.sql`）。

- [ ] **Step 3: 驗證賣過的商品可以真的刪除**

先挑一個有訂單紀錄的商品，刪除它，然後確認：

```bash
docker exec supabase_db_sweet-pos psql -U postgres -d postgres -c \
"select name, is_active, deleted_at is not null as deleted from public.products where id='<商品ID>';"
```
Expected: `is_active = f` 且 `deleted = t`。這是本次的核心目標——**賣過的商品不再只能停用**。

- [ ] **Step 4: 驗證歷史資料完好**

```bash
docker exec supabase_db_sweet-pos psql -U postgres -d postgres -c \
"select count(*) from public.order_items where product_id='<商品ID>';"
```
Expected: 筆數與刪除前相同（外鍵未動、歷史訂單完整）。

同時開啟 `/manager/reports`，確認該商品的歷史數字沒有變化、訂單明細仍顯示商品名稱。

- [ ] **Step 5: 驗證已刪除商品從 POS 消失**

```bash
curl -s -H "cookie: <店長cookie>" http://127.0.0.1:3000/api/catalog | grep -c '<商品ID>'
```
Expected: `0`。已刪除商品不再出現在 POS 型錄。

- [ ] **Step 6: 驗證庫存來源會擋下刪除**

建立商品 A，再建立商品 B 並把 B 的庫存來源設為 A，然後刪除 A。
Expected: 回 400，錯誤訊息指出「A」是 B 的庫存來源，並列出 B 的名稱。

- [ ] **Step 7: 驗證組合價關聯會被清掉且有告知**

把某商品加入一個組合價後刪除該商品。
Expected: 刪除成功，回應的 `message` 含「已從組合價「<組合名>」移除此商品」；該組合價本身仍存在。

- [ ] **Step 8: 驗證固定禮盒口味會擋下刪除**

刪除一個被固定禮盒使用的口味（種子資料中「發禮盒」有固定口味）。
Expected: 回 400，訊息列出該禮盒名稱。

- [ ] **Step 9: 驗證顯示已刪除與復原**

在 `/manager/products` 勾選「顯示已刪除」。
Expected: 已刪除項目出現、狀態顯示「已刪除」、只有「復原」按鈕。

按「復原」。
Expected: 項目回到清單，狀態為「停用」（不是「啟用」），訊息提示需要時再手動啟用。

- [ ] **Step 10: 驗證已刪除項目不可直接編輯**

對一個已刪除的商品送出一般 PATCH（不帶 `restore`）：

```bash
curl -s -X PATCH http://127.0.0.1:3000/api/products \
  -H 'content-type: application/json' -H "cookie: <店長cookie>" \
  -d '{"id":"<已刪除商品ID>","category":"bag","name":"試圖復活","spec":"1入","price":100,"isActive":true}'
```
Expected: `ok: false`，錯誤為「商品已刪除，請先復原後再編輯」。這道防呆擋住的是「把已刪除商品的 `is_active` 改回 true 讓它重回 POS」。

- [ ] **Step 11: 驗證刪除與復原都有稽核紀錄**

```bash
docker exec supabase_db_sweet-pos psql -U postgres -d postgres -c \
"select action, entity, entity_label from public.audit_logs
 where entity in ('products','flavors','bundles') order by created_at desc limit 10;"
```
Expected: 看得到 `delete` 與復原產生的 `update`，`entity_label` 正確。

- [ ] **Step 12: 勾選計畫並 commit**

```bash
git add docs/superpowers/plans/2026-08-25-catalog-soft-delete.md
git commit -m "docs: mark soft delete plan complete"
```

---

## 已知限制（實作完成後仍成立）

- 訂單 RPC 依 `flavorId` 找不到口味時，會退回用**名稱查詢且不過濾 `is_active`**（[202607280001:128-132](../../../supabase/migrations/202607280001_stock_source_product.sql#L128-L132)）。理論上已刪除的口味仍可能被這條路徑解析到。依 spec 議定不在本次範圍——它只在 client 沒帶 `flavorId` 時觸發，而 POS 型錄只提供啟用中的口味。
- 庫存總表（`inventory_stock_summary`）由歷史異動推導，已刪除商品若有殘留庫存仍會出現在庫存頁。這反映的是真實庫存，不視為缺陷。
- 不提供「永久清除」已刪除項目的功能。真的要清只能進 SQL Editor。
- `discounts` / `counters` / `payment_methods` 的刪除行為維持現狀（有紀錄時靜默降級成停用），不在本次範圍。
