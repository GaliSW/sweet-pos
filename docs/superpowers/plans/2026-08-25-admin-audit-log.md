# 後台操作稽核紀錄 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 讓後台八組設定路由的每一次新增／修改／刪除都留下「誰、什麼時候、改了什麼」的紀錄，並提供店長專用的查詢頁。

**Architecture:** 新增一張 append-only 的 `public.audit_logs` 表（只有 service_role 寫得進去，店長唯讀）。因為八組路由都用 service_role 寫入、資料庫層抓不到 `auth.uid()`，所以由應用層寫入：一個 `writeAuditLog()` helper 接在每個 mutation 後面，操作人取自各路由 `requireRole()` 已經拿到的 `guard.profile`。變更明細由純函式 `diffRecords()` 從 `before` / `after` 兩份 JSON 快照算出來，UI 與測試共用同一份邏輯。

**Tech Stack:** Next.js 15 App Router、TypeScript、Supabase（PostgREST + RLS）、Vitest。

這是 [2026-08-25 spec](../specs/2026-08-25-audit-log-and-soft-delete-design.md) 的**階段一**。階段二（軟刪除）在本階段驗證通過後另出計畫。

## Global Constraints

- 稽核紀錄寫入失敗**絕不可**讓主操作失敗。`writeAuditLog` 內部吞掉所有錯誤，只 `console.error`。
- `audit_logs` 只有 select policy，**不得**新增 insert / update / delete policy，API 層也**不得**提供任何寫入或刪除紀錄的端點。
- staff 路由的快照只能來自 `profiles` 資料列，**絕不可**放入 request input（input 帶有 `password`）。
- 各路由 `!hasSupabaseAdminEnv()` 的 demo 分支直接 return，不呼叫 `writeAuditLog`。
- 快照範圍原則：**涵蓋該次請求會寫到的全部內容**。例如商品路由同時會寫 `gift_box_rules`，快照就要含禮盒規則，否則只改禮盒規則時會顯示「無變更」。
- 時區一律 Asia/Taipei（`+08:00`），與 `lib/backend/query-helpers.ts` 的 `taipeiDate` 一致。
- 既有程式碼風格：雙引號、無分號省略、`export async function GET/POST/PATCH/DELETE`。不重排、不改寫既有邏輯。

---

### Task 1: 變更明細純函式 `diffRecords`

**Files:**
- Create: `lib/domain/audit-diff.ts`
- Test: `tests/domain/audit-diff.test.ts`

**Interfaces:**
- Consumes: 無
- Produces:
  - `type AuditAction = "create" | "update" | "delete"`
  - `type AuditFieldChange = { field: string; label: string; before: string | null; after: string | null }`
  - `function diffRecords(before: unknown, after: unknown): AuditFieldChange[]`
  - `function formatAuditValue(value: unknown): string | null`
  - `function auditEntityLabel(entity: string): string`
  - `function auditFieldLabel(field: string): string`
  - `function auditValuesEqual(left: unknown, right: unknown): boolean`

- [x] **Step 1: 寫失敗的測試**

建立 `tests/domain/audit-diff.test.ts`：

```ts
import { describe, expect, it } from "vitest";
import {
  auditEntityLabel,
  auditFieldLabel,
  diffRecords,
  formatAuditValue
} from "@/lib/domain/audit-diff";

describe("diffRecords", () => {
  it("新增時列出 after 的每一個欄位", () => {
    expect(diffRecords(null, { name: "匠心(原/草/巧)", price: 450 })).toEqual([
      { field: "name", label: "名稱", before: null, after: "匠心(原/草/巧)" },
      { field: "price", label: "價格", before: null, after: "450" }
    ]);
  });

  it("刪除時列出 before 的每一個欄位", () => {
    expect(diffRecords({ name: "匠心(原/草/巧)", price: 450 }, null)).toEqual([
      { field: "name", label: "名稱", before: "匠心(原/草/巧)", after: null },
      { field: "price", label: "價格", before: "450", after: null }
    ]);
  });

  it("修改時只列出真正變動的欄位", () => {
    expect(
      diffRecords(
        { name: "匠心", price: 450, is_active: true },
        { name: "匠心", price: 480, is_active: true }
      )
    ).toEqual([{ field: "price", label: "價格", before: "450", after: "480" }]);
  });

  it("Postgres numeric 回傳字串時不算變更", () => {
    expect(diffRecords({ price: "450.00" }, { price: 450 })).toEqual([]);
  });

  it("兩邊都是字串時不做數值正規化", () => {
    expect(diffRecords({ name: "0050" }, { name: "50" })).toHaveLength(1);
  });

  it("布林值顯示為是／否", () => {
    expect(diffRecords({ is_active: true }, { is_active: false })).toEqual([
      { field: "is_active", label: "啟用", before: "是", after: "否" }
    ]);
  });

  it("巢狀物件的鍵順序不影響比對", () => {
    expect(
      diffRecords(
        { giftRule: { selectionMode: "select", requiredFlavorCount: 3 } },
        { giftRule: { requiredFlavorCount: 3, selectionMode: "select" } }
      )
    ).toEqual([]);
  });

  it("巢狀物件內容變動會被抓到", () => {
    expect(
      diffRecords(
        { giftRule: { requiredFlavorCount: 3 } },
        { giftRule: { requiredFlavorCount: 4 } }
      )
    ).toHaveLength(1);
  });

  it("陣列內容變動會被抓到", () => {
    expect(
      diffRecords(
        { tiers: [{ minDailySales: 0, rate: 0.02 }] },
        { tiers: [{ minDailySales: 0, rate: 0.03 }] }
      )
    ).toHaveLength(1);
  });

  it("null 與 undefined 視為相同", () => {
    expect(diffRecords({ location: null }, { location: undefined })).toEqual([]);
  });

  it("兩邊皆空時沒有任何變更", () => {
    expect(diffRecords(null, null)).toEqual([]);
  });

  it("未知欄位退回顯示原始欄位名", () => {
    expect(diffRecords(null, { some_new_column: "x" })[0].label).toBe("some_new_column");
  });
});

describe("formatAuditValue", () => {
  it("空值回傳 null", () => {
    expect(formatAuditValue(null)).toBeNull();
    expect(formatAuditValue(undefined)).toBeNull();
  });

  it("布林值轉成是／否", () => {
    expect(formatAuditValue(true)).toBe("是");
    expect(formatAuditValue(false)).toBe("否");
  });

  it("數字與字串原樣輸出", () => {
    expect(formatAuditValue(450)).toBe("450");
    expect(formatAuditValue("匠心")).toBe("匠心");
  });

  it("物件輸出 JSON", () => {
    expect(formatAuditValue({ a: 1 })).toBe('{"a":1}');
  });
});

describe("label 對照", () => {
  it("已知的 entity 顯示中文", () => {
    expect(auditEntityLabel("products")).toBe("商品");
    expect(auditEntityLabel("commission_tiers")).toBe("抽成");
  });

  it("未知的 entity 原樣顯示", () => {
    expect(auditEntityLabel("unknown_table")).toBe("unknown_table");
  });

  it("已知的欄位顯示中文", () => {
    expect(auditFieldLabel("hourly_wage")).toBe("時薪");
  });
});
```

- [x] **Step 2: 執行測試確認失敗**

Run: `npx vitest run tests/domain/audit-diff.test.ts`
Expected: FAIL，訊息為 `Failed to resolve import "@/lib/domain/audit-diff"`。

- [x] **Step 3: 實作**

建立 `lib/domain/audit-diff.ts`：

```ts
// 後台稽核紀錄的變更明細計算。UI 與測試共用同一份邏輯,不放任何 I/O。

export type AuditAction = "create" | "update" | "delete";

export type AuditFieldChange = {
  field: string;
  label: string;
  before: string | null;
  after: string | null;
};

const ENTITY_LABELS: Record<string, string> = {
  products: "商品",
  flavors: "口味",
  bundles: "組合價",
  discounts: "折扣",
  counters: "櫃位",
  profiles: "員工",
  payment_methods: "付款方式",
  commission_tiers: "抽成"
};

const FIELD_LABELS: Record<string, string> = {
  // 共用
  name: "名稱",
  spec: "規格",
  price: "價格",
  is_active: "啟用",
  sort_order: "排序",
  created_at: "建立時間",
  updated_at: "更新時間",
  // products
  category: "類別",
  is_popular: "熱門",
  stock_source_product_id: "庫存來源商品",
  giftRule: "禮盒規則",
  // bundles
  productIds: "商品",
  tiers: "級距",
  // discounts
  discount_type: "折扣類型",
  value: "折扣值",
  min_order_amount: "最低消費",
  // counters
  location: "地點",
  monthlyTargets: "月目標",
  // profiles
  display_name: "姓名",
  role: "角色",
  salary_type: "薪資類型",
  hourly_wage: "時薪",
  monthly_salary: "月薪",
  commission_mode: "抽成模式",
  // commission
  commissionMode: "抽成模式",
  // payment_methods
  code: "代碼"
};

export function auditEntityLabel(entity: string): string {
  return ENTITY_LABELS[entity] ?? entity;
}

export function auditFieldLabel(field: string): string {
  return FIELD_LABELS[field] ?? field;
}

export function formatAuditValue(value: unknown): string | null {
  if (value === null || value === undefined) return null;
  if (typeof value === "boolean") return value ? "是" : "否";
  if (typeof value === "number") return String(value);
  if (typeof value === "string") return value;

  return JSON.stringify(value);
}

function isNumericLike(value: unknown): boolean {
  if (typeof value === "number") return Number.isFinite(value);
  if (typeof value !== "string") return false;

  return value.trim() !== "" && Number.isFinite(Number(value));
}

// 鍵順序無關的深層序列化,用來比對巢狀物件與陣列。
function stableStringify(value: unknown): string {
  if (value === null || value === undefined) return "null";
  if (Array.isArray(value)) return `[${value.map(stableStringify).join(",")}]`;

  if (typeof value === "object") {
    const entries = Object.entries(value as Record<string, unknown>)
      .filter(([, entryValue]) => entryValue !== undefined)
      .sort(([left], [right]) => (left < right ? -1 : left > right ? 1 : 0));

    return `{${entries
      .map(([key, entryValue]) => `${JSON.stringify(key)}:${stableStringify(entryValue)}`)
      .join(",")}}`;
  }

  return JSON.stringify(value);
}

export function auditValuesEqual(left: unknown, right: unknown): boolean {
  if (left === null || left === undefined) return right === null || right === undefined;
  if (right === null || right === undefined) return false;

  // Postgres numeric 經 PostgREST 可能回字串(如 "450.00"),與程式端的 450 是同一個值。
  // 只在其中一邊確實是 number 時才做數值比對,避免把 "0050" 與 "50" 誤判成相同名稱。
  if (typeof left === "number" || typeof right === "number") {
    if (isNumericLike(left) && isNumericLike(right)) {
      return Number(left) === Number(right);
    }
  }

  return stableStringify(left) === stableStringify(right);
}

function toRecord(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) return {};

  return value as Record<string, unknown>;
}

export function diffRecords(before: unknown, after: unknown): AuditFieldChange[] {
  const beforeRecord = toRecord(before);
  const afterRecord = toRecord(after);
  const fields = Array.from(
    new Set([...Object.keys(beforeRecord), ...Object.keys(afterRecord)])
  ).sort();
  const changes: AuditFieldChange[] = [];

  for (const field of fields) {
    const beforeValue = beforeRecord[field] ?? null;
    const afterValue = afterRecord[field] ?? null;

    if (auditValuesEqual(beforeValue, afterValue)) continue;

    changes.push({
      field,
      label: auditFieldLabel(field),
      before: formatAuditValue(beforeValue),
      after: formatAuditValue(afterValue)
    });
  }

  return changes;
}
```

- [x] **Step 4: 執行測試確認通過**

Run: `npx vitest run tests/domain/audit-diff.test.ts`
Expected: PASS，19 個測試全綠（`diffRecords` 12 個、`formatAuditValue` 4 個、label 對照 3 個）。

- [x] **Step 5: Commit**

```bash
git add lib/domain/audit-diff.ts tests/domain/audit-diff.test.ts
git commit -m "feat: add audit diff helpers"
```

---

### Task 2: `audit_logs` 資料表 migration

**Files:**
- Create: `supabase/migrations/202608250001_audit_logs.sql`

**Interfaces:**
- Consumes: `private.is_manager()`（來自 `20260807132637_harden_function_privileges_and_index_foreign_keys.sql`）
- Produces: `public.audit_logs` 表，欄位 `id / actor_id / actor_name / action / entity / entity_id / entity_label / before / after / created_at`

- [x] **Step 1: 建立 migration**

建立 `supabase/migrations/202608250001_audit_logs.sql`：

```sql
-- 後台設定變更的稽核紀錄。八組管理路由都用 service_role 寫入、資料庫層抓不到 auth.uid(),
-- 因此由應用層的 writeAuditLog() 帶入操作人。這張表是 append-only:
-- 只有 select policy,沒有 insert/update/delete policy,只有 service_role 寫得進去。
create table if not exists public.audit_logs (
  id           uuid primary key default gen_random_uuid(),
  actor_id     uuid references public.profiles(id) on delete set null,
  actor_name   text not null,
  action       text not null check (action in ('create', 'update', 'delete')),
  entity       text not null,
  entity_id    text,
  entity_label text,
  before       jsonb,
  after        jsonb,
  created_at   timestamptz not null default now()
);

create index if not exists audit_logs_created_at_idx on public.audit_logs (created_at desc);
create index if not exists audit_logs_entity_idx on public.audit_logs (entity, entity_id);
create index if not exists audit_logs_actor_id_idx on public.audit_logs (actor_id);

alter table public.audit_logs enable row level security;

drop policy if exists "managers read audit logs" on public.audit_logs;
create policy "managers read audit logs" on public.audit_logs
  for select to authenticated
  using ((select private.is_manager()));

grant select on public.audit_logs to authenticated;
grant all on public.audit_logs to service_role;
```

- [ ] **Step 2: 套用並驗證**  ⚠️ 需本機 Supabase／瀏覽器，尚未執行

Run: `npm run db:start && npm run db:reset`
Expected: 所有 migration 套用成功，最後一行不含 error。

接著確認表與 policy 都在：

```bash
npx supabase db diff --schema public 2>&1 | tail -5
```
Expected: 沒有偵測到差異（migration 已完整反映結構）。

- [ ] **Step 3: 確認 append-only**  ⚠️ 需本機 Supabase／瀏覽器，尚未執行

Run:
```bash
npx supabase db query "select polname, polcmd from pg_policy where polrelid = 'public.audit_logs'::regclass;"
```
Expected: 只有一列，`polname` 為 `managers read audit logs`、`polcmd` 為 `r`（select）。若出現 `a`/`w`/`d` 就是多開了寫入權限，必須移除。

> 若本機 Supabase 未啟動導致上述指令失敗，改用 Supabase Dashboard 的 SQL Editor 執行同一段查詢。

- [x] **Step 4: Commit**

```bash
git add supabase/migrations/202608250001_audit_logs.sql
git commit -m "feat: add audit_logs table"
```

---

### Task 3: `writeAuditLog` 寫入 helper

**Files:**
- Create: `lib/backend/audit.ts`

**Interfaces:**
- Consumes: `AuditAction`（Task 1）、`createSupabaseAdminClient`（`lib/db/server.ts`）、`SessionProfile`（`lib/auth/session.ts`）、`public.audit_logs`（Task 2）
- Produces:
  - `type AuditClient = ReturnType<typeof createSupabaseAdminClient>`
  - `function writeAuditLog(supabase: AuditClient, params: AuditParams): Promise<void>` — 永不 throw、永不回傳失敗
  - `type AuditParams = { actor: SessionProfile | null; action: AuditAction; entity: string; entityId: string | null; entityLabel: string | null; before?: unknown; after?: unknown }`

- [x] **Step 1: 實作**

建立 `lib/backend/audit.ts`：

```ts
import type { SessionProfile } from "@/lib/auth/session";
import type { createSupabaseAdminClient } from "@/lib/db/server";
import type { AuditAction } from "@/lib/domain/audit-diff";

export type AuditClient = ReturnType<typeof createSupabaseAdminClient>;

export type AuditParams = {
  actor: SessionProfile | null;
  action: AuditAction;
  entity: string;
  entityId: string | null;
  entityLabel: string | null;
  before?: unknown;
  after?: unknown;
};

// 稽核紀錄寫失敗不可讓主操作失敗:商品已經建好了卻回 500,比漏一筆 log 糟得多。
// 因此這裡吞掉所有錯誤,只留 console.error 供排查。
export async function writeAuditLog(
  supabase: AuditClient,
  params: AuditParams
): Promise<void> {
  try {
    const { error } = await supabase.from("audit_logs").insert({
      actor_id: params.actor?.id ?? null,
      actor_name: params.actor?.displayName ?? "未知",
      action: params.action,
      entity: params.entity,
      entity_id: params.entityId,
      entity_label: params.entityLabel,
      before: params.before ?? null,
      after: params.after ?? null
    });

    if (error) {
      console.error("[audit] 寫入稽核紀錄失敗", {
        entity: params.entity,
        action: params.action,
        entityId: params.entityId,
        error: error.message
      });
    }
  } catch (cause) {
    console.error("[audit] 寫入稽核紀錄發生例外", {
      entity: params.entity,
      action: params.action,
      entityId: params.entityId,
      cause
    });
  }
}
```

- [x] **Step 2: 型別檢查**

Run: `npx tsc --noEmit`
Expected: 無錯誤。

- [x] **Step 3: Commit**

```bash
git add lib/backend/audit.ts
git commit -m "feat: add writeAuditLog helper"
```

---

### Task 4: 接上 products 路由

**Files:**
- Modify: `app/api/products/route.ts`

**Interfaces:**
- Consumes: `writeAuditLog`（Task 3）
- Produces: 本檔內部的 `fetchProductSnapshot(supabase, productId)`，回傳 `products` 資料列加上 `giftRule` 子物件

- [x] **Step 1: 加入 import**

在 `app/api/products/route.ts` 既有 import 區塊，於 `import { requireRole }` 之後加入一行：

```ts
import { writeAuditLog } from "@/lib/backend/audit";
```

- [x] **Step 2: 加入快照函式**

在檔案最下方（既有的 `validateProductInput` 之後）加入：

```ts
// 稽核快照:涵蓋這支路由同一次請求會寫到的全部內容(商品本身 + 禮盒規則),
// 否則只改禮盒規則時,變更明細會顯示「無變更」。
async function fetchProductSnapshot(
  supabase: ReturnType<typeof createSupabaseAdminClient>,
  productId: string
) {
  const [productResult, ruleResult, allowedResult] = await Promise.all([
    supabase.from("products").select("*").eq("id", productId).maybeSingle(),
    supabase.from("gift_box_rules").select("*").eq("product_id", productId).maybeSingle(),
    supabase.from("gift_box_allowed_flavors").select("flavor_id").eq("product_id", productId)
  ]);

  const product = productResult.data;

  if (!product) return null;

  return {
    ...product,
    giftRule: ruleResult.data
      ? {
          selectionMode: ruleResult.data.selection_mode,
          requiredFlavorCount: ruleResult.data.required_flavor_count,
          includesScallionCracker: ruleResult.data.includes_scallion_cracker,
          allowedFlavorIds: (allowedResult.data ?? [])
            .map((row) => row.flavor_id as string)
            .sort()
        }
      : null
  };
}
```

- [x] **Step 3: POST 記錄新增**

在 POST 內，`upsertGiftRule` 的錯誤檢查之後、`return NextResponse.json` 之前插入：

```ts
  await writeAuditLog(supabase, {
    actor: guard.profile ?? null,
    action: "create",
    entity: "products",
    entityId: data.id as string,
    entityLabel: input.name.trim(),
    after: await fetchProductSnapshot(supabase, data.id as string)
  });
```

- [x] **Step 4: PATCH 記錄修改**

在 PATCH 內，`const supabase = createSupabaseAdminClient();` 的**下一行**插入（必須在 update 之前取得 before）：

```ts
  const beforeSnapshot = await fetchProductSnapshot(supabase, input.id);
```

再於 `upsertGiftRule` 的錯誤檢查之後、`return NextResponse.json` 之前插入：

```ts
  await writeAuditLog(supabase, {
    actor: guard.profile ?? null,
    action: "update",
    entity: "products",
    entityId: data.id as string,
    entityLabel: input.name.trim(),
    before: beforeSnapshot,
    after: await fetchProductSnapshot(supabase, data.id as string)
  });
```

- [x] **Step 5: DELETE 記錄刪除與降級**

在 DELETE 內，`const supabase = createSupabaseAdminClient();` 的**下一行**插入：

```ts
  const beforeSnapshot = await fetchProductSnapshot(supabase, input.id);
```

在 `referenceCount > 0` 分支內，`update({ is_active: false })` 的錯誤檢查之後、該分支的 `return` 之前插入（此分支實際行為是停用而非刪除，因此記為 `update`）：

```ts
    await writeAuditLog(supabase, {
      actor: guard.profile ?? null,
      action: "update",
      entity: "products",
      entityId: input.id,
      entityLabel: (beforeSnapshot?.name as string) ?? null,
      before: beforeSnapshot,
      after: await fetchProductSnapshot(supabase, input.id)
    });
```

在真正 `delete()` 的錯誤檢查之後、函式最後的 `return` 之前插入：

```ts
  await writeAuditLog(supabase, {
    actor: guard.profile ?? null,
    action: "delete",
    entity: "products",
    entityId: input.id,
    entityLabel: (beforeSnapshot?.name as string) ?? null,
    before: beforeSnapshot
  });
```

- [x] **Step 6: 型別檢查與建置**

Run: `npx tsc --noEmit && npm run build`
Expected: 兩者皆無錯誤。

- [ ] **Step 7: 手動驗證**  ⚠️ 需本機 Supabase／瀏覽器，尚未執行

啟動 `npm run dev`，以店長身分登入 `/manager/products`，新增一個測試商品、改價格、再刪除，然後查：

```bash
npx supabase db query "select actor_name, action, entity, entity_label, created_at from public.audit_logs order by created_at desc limit 5;"
```
Expected: 三列，`actor_name` 是登入的店長姓名，`action` 依序為 `delete` / `update` / `create`，`entity_label` 是該測試商品名稱。

- [x] **Step 8: Commit**

```bash
git add app/api/products/route.ts
git commit -m "feat: audit product changes"
```

---

### Task 5: 接上 flavors 與 bundles 路由

**Files:**
- Modify: `app/api/flavors/route.ts`
- Modify: `app/api/bundles/route.ts`

**Interfaces:**
- Consumes: `writeAuditLog`（Task 3）
- Produces: `app/api/bundles/route.ts` 內部的 `fetchBundleSnapshot(supabase, bundleId)`，回傳 `{ id, name, is_active, productIds, tiers }`

- [x] **Step 1: flavors — 加入 import 與快照函式**

在 `app/api/flavors/route.ts` 的 import 區塊加入：

```ts
import { writeAuditLog } from "@/lib/backend/audit";
```

在檔案最下方加入：

```ts
// 口味沒有子表,快照即資料列本身。
async function fetchFlavorSnapshot(
  supabase: ReturnType<typeof createSupabaseAdminClient>,
  flavorId: string
) {
  const { data } = await supabase
    .from("flavors")
    .select("*")
    .eq("id", flavorId)
    .maybeSingle();

  return data ?? null;
}
```

- [x] **Step 2: flavors — 三個 mutation 接線**

POST：在成功取得新增資料列、`return` 之前插入：

```ts
  await writeAuditLog(supabase, {
    actor: guard.profile ?? null,
    action: "create",
    entity: "flavors",
    entityId: data.id as string,
    entityLabel: input.name.trim(),
    after: await fetchFlavorSnapshot(supabase, data.id as string)
  });
```

PATCH：在 `const supabase = createSupabaseAdminClient();` 下一行插入 `const beforeSnapshot = await fetchFlavorSnapshot(supabase, input.id);`，並在 `return` 之前插入：

```ts
  await writeAuditLog(supabase, {
    actor: guard.profile ?? null,
    action: "update",
    entity: "flavors",
    entityId: input.id,
    entityLabel: input.name.trim(),
    before: beforeSnapshot,
    after: await fetchFlavorSnapshot(supabase, input.id)
  });
```

DELETE：在 `const supabase = createSupabaseAdminClient();` 下一行插入 `const beforeSnapshot = await fetchFlavorSnapshot(supabase, input.id);`。在 `referenceCount > 0` 的停用分支 `return` 之前插入：

```ts
    await writeAuditLog(supabase, {
      actor: guard.profile ?? null,
      action: "update",
      entity: "flavors",
      entityId: input.id,
      entityLabel: (beforeSnapshot?.name as string) ?? null,
      before: beforeSnapshot,
      after: await fetchFlavorSnapshot(supabase, input.id)
    });
```

在真正刪除後的 `return` 之前插入：

```ts
  await writeAuditLog(supabase, {
    actor: guard.profile ?? null,
    action: "delete",
    entity: "flavors",
    entityId: input.id,
    entityLabel: (beforeSnapshot?.name as string) ?? null,
    before: beforeSnapshot
  });
```

- [x] **Step 3: bundles — 加入 import 與快照函式**

在 `app/api/bundles/route.ts` 的 import 區塊加入：

```ts
import { writeAuditLog } from "@/lib/backend/audit";
```

在檔案最下方加入：

```ts
// 組合價的商品群與級距存在兩張子表,快照要含兩者才看得出改了什麼。
// 排序後再存,避免子表回傳順序不同被誤判成變更。
async function fetchBundleSnapshot(
  supabase: ReturnType<typeof createSupabaseAdminClient>,
  bundleId: string
) {
  const { data } = await supabase
    .from("bundles")
    .select("id, name, is_active, bundle_products(product_id), bundle_tiers(quantity, price)")
    .eq("id", bundleId)
    .maybeSingle();

  if (!data) return null;

  return {
    id: data.id,
    name: data.name,
    is_active: data.is_active,
    productIds: (data.bundle_products ?? [])
      .map((row: { product_id: string }) => row.product_id)
      .sort(),
    tiers: (data.bundle_tiers ?? [])
      .map((tier: { quantity: number; price: number | string }) => ({
        quantity: tier.quantity,
        price: Number(tier.price)
      }))
      .sort(
        (left: { quantity: number }, right: { quantity: number }) =>
          left.quantity - right.quantity
      )
  };
}
```

- [x] **Step 4: bundles — `upsertBundle` 與 DELETE 接線**

在 `upsertBundle` 內，`const supabase = createSupabaseAdminClient();` 的下一行插入：

```ts
  const beforeSnapshot =
    mode === "update" && input.id ? await fetchBundleSnapshot(supabase, input.id) : null;
```

在子表 `bundle_products` / `bundle_tiers` 寫入完成、函式最後的 `return` 之前插入：

```ts
  await writeAuditLog(supabase, {
    actor: guard.profile ?? null,
    action: mode === "create" ? "create" : "update",
    entity: "bundles",
    entityId: bundleId,
    entityLabel: input.name.trim(),
    before: beforeSnapshot,
    after: bundleId ? await fetchBundleSnapshot(supabase, bundleId) : null
  });
```

在 DELETE 內，`const supabase = createSupabaseAdminClient();` 下一行插入 `const beforeSnapshot = await fetchBundleSnapshot(supabase, input.id);`，並在 `delete()` 的錯誤檢查之後、`return` 之前插入：

```ts
  await writeAuditLog(supabase, {
    actor: guard.profile ?? null,
    action: "delete",
    entity: "bundles",
    entityId: input.id,
    entityLabel: (beforeSnapshot?.name as string) ?? null,
    before: beforeSnapshot
  });
```

- [x] **Step 5: 型別檢查與建置**

Run: `npx tsc --noEmit && npm run build`
Expected: 兩者皆無錯誤。

- [ ] **Step 6: 手動驗證**  ⚠️ 需本機 Supabase／瀏覽器，尚未執行

`npm run dev` 後在 `/manager/products` 的口味與組合價區塊各新增、修改、刪除一次，然後查：

```bash
npx supabase db query "select entity, action, entity_label from public.audit_logs where entity in ('flavors','bundles') order by created_at desc;"
```
Expected: 六列，兩個 entity 各三種 action。

- [x] **Step 7: Commit**

```bash
git add app/api/flavors/route.ts app/api/bundles/route.ts
git commit -m "feat: audit flavor and bundle changes"
```

---

### Task 6: 接上 discounts、payment-methods、counters 路由

**Files:**
- Modify: `app/api/discounts/route.ts`
- Modify: `app/api/payment-methods/route.ts`
- Modify: `app/api/counters/route.ts`

**Interfaces:**
- Consumes: `writeAuditLog`（Task 3）
- Produces: `app/api/counters/route.ts` 內部的 `fetchCounterSnapshot(supabase, counterId)`，回傳 `counters` 資料列加上 `monthlyTargets` 陣列

- [x] **Step 1: discounts 接線**

在 import 區塊加入 `import { writeAuditLog } from "@/lib/backend/audit";`。

在檔案最下方加入：

```ts
async function fetchDiscountSnapshot(
  supabase: ReturnType<typeof createSupabaseAdminClient>,
  discountId: string
) {
  const { data } = await supabase
    .from("discounts")
    .select("*")
    .eq("id", discountId)
    .maybeSingle();

  return data ?? null;
}
```

POST：在 `return` 之前插入：

```ts
  await writeAuditLog(supabase, {
    actor: guard.profile ?? null,
    action: "create",
    entity: "discounts",
    entityId: data.id as string,
    entityLabel: input.name.trim(),
    after: await fetchDiscountSnapshot(supabase, data.id as string)
  });
```

PATCH：在 `const supabase = createSupabaseAdminClient();` 下一行插入 `const beforeSnapshot = await fetchDiscountSnapshot(supabase, input.id);`，並在 `return` 之前插入：

```ts
  await writeAuditLog(supabase, {
    actor: guard.profile ?? null,
    action: "update",
    entity: "discounts",
    entityId: input.id,
    entityLabel: input.name.trim(),
    before: beforeSnapshot,
    after: await fetchDiscountSnapshot(supabase, input.id)
  });
```

- [x] **Step 2: payment-methods 接線**

在 import 區塊加入 `import { writeAuditLog } from "@/lib/backend/audit";`。

在檔案最下方加入：

```ts
// payment_methods 的主鍵是 code(text),不是 uuid。
async function fetchPaymentMethodSnapshot(
  supabase: ReturnType<typeof createSupabaseAdminClient>,
  code: string
) {
  const { data } = await supabase
    .from("payment_methods")
    .select("code, name, is_active, sort_order")
    .eq("code", code)
    .maybeSingle();

  return data ?? null;
}
```

POST：在 `return NextResponse.json({ ok: true, data: { code, source: "supabase" } });` 之前插入：

```ts
  await writeAuditLog(supabase, {
    actor: guard.profile ?? null,
    action: "create",
    entity: "payment_methods",
    entityId: code,
    entityLabel: input.name.trim(),
    after: await fetchPaymentMethodSnapshot(supabase, code)
  });
```

PATCH：在 `const supabase = createSupabaseAdminClient();` 下一行插入：

```ts
  const beforeSnapshot = await fetchPaymentMethodSnapshot(supabase, input.code);
```

並在最後的 `return` 之前插入：

```ts
  await writeAuditLog(supabase, {
    actor: guard.profile ?? null,
    action: "update",
    entity: "payment_methods",
    entityId: input.code,
    entityLabel: input.name.trim(),
    before: beforeSnapshot,
    after: await fetchPaymentMethodSnapshot(supabase, input.code)
  });
```

- [x] **Step 3: counters 接線**

在 import 區塊加入 `import { writeAuditLog } from "@/lib/backend/audit";`。

在檔案最下方加入：

```ts
// 櫃位的月目標與櫃位在同一次請求寫入(upsertMonthlyTarget),快照要含兩者。
async function fetchCounterSnapshot(
  supabase: ReturnType<typeof createSupabaseAdminClient>,
  counterId: string
) {
  const [counterResult, targetsResult] = await Promise.all([
    supabase.from("counters").select("*").eq("id", counterId).maybeSingle(),
    supabase
      .from("counter_monthly_targets")
      .select("month, target_amount")
      .eq("counter_id", counterId)
      .order("month")
  ]);

  if (!counterResult.data) return null;

  return {
    ...counterResult.data,
    monthlyTargets: (targetsResult.data ?? []).map(
      (row: { month: string; target_amount: number | string }) => ({
        month: row.month,
        targetAmount: Number(row.target_amount)
      })
    )
  };
}
```

POST：在 `upsertMonthlyTarget` 的錯誤檢查之後、`return` 之前插入：

```ts
  await writeAuditLog(supabase, {
    actor: guard.profile ?? null,
    action: "create",
    entity: "counters",
    entityId: data.id as string,
    entityLabel: input.name.trim(),
    after: await fetchCounterSnapshot(supabase, data.id as string)
  });
```

PATCH：在 `const supabase = createSupabaseAdminClient();` 下一行插入 `const beforeSnapshot = await fetchCounterSnapshot(supabase, input.id);`，並在 `upsertMonthlyTarget` 的錯誤檢查之後、`return` 之前插入：

```ts
  await writeAuditLog(supabase, {
    actor: guard.profile ?? null,
    action: "update",
    entity: "counters",
    entityId: input.id,
    entityLabel: input.name.trim(),
    before: beforeSnapshot,
    after: await fetchCounterSnapshot(supabase, input.id)
  });
```

DELETE：在 `const supabase = createSupabaseAdminClient();` 下一行插入 `const beforeSnapshot = await fetchCounterSnapshot(supabase, input.id);`。在停用分支的 `return` 之前插入：

```ts
    await writeAuditLog(supabase, {
      actor: guard.profile ?? null,
      action: "update",
      entity: "counters",
      entityId: input.id,
      entityLabel: (beforeSnapshot?.name as string) ?? null,
      before: beforeSnapshot,
      after: await fetchCounterSnapshot(supabase, input.id)
    });
```

在真正刪除後的 `return` 之前插入：

```ts
  await writeAuditLog(supabase, {
    actor: guard.profile ?? null,
    action: "delete",
    entity: "counters",
    entityId: input.id,
    entityLabel: (beforeSnapshot?.name as string) ?? null,
    before: beforeSnapshot
  });
```

- [x] **Step 4: 型別檢查與建置**

Run: `npx tsc --noEmit && npm run build`
Expected: 兩者皆無錯誤。

- [ ] **Step 5: 手動驗證**  ⚠️ 需本機 Supabase／瀏覽器，尚未執行

`npm run dev` 後在 `/manager/products` 折扣區塊、`/manager/payment-methods`、`/manager/counters` 各做一次新增與修改，然後查：

```bash
npx supabase db query "select entity, action, entity_label from public.audit_logs where entity in ('discounts','payment_methods','counters') order by created_at desc;"
```
Expected: 至少六列，三個 entity 都有 `create` 與 `update`。

- [x] **Step 6: Commit**

```bash
git add app/api/discounts/route.ts app/api/payment-methods/route.ts app/api/counters/route.ts
git commit -m "feat: audit discount, payment method and counter changes"
```

---

### Task 7: 接上 staff 與 commission 路由

**Files:**
- Modify: `app/api/staff/route.ts`
- Modify: `app/api/commission/route.ts`

**Interfaces:**
- Consumes: `writeAuditLog`（Task 3）
- Produces:
  - `app/api/staff/route.ts` 內部的 `fetchStaffSnapshot(supabase, staffId)`，**只讀 `profiles` 資料列**
  - `app/api/commission/route.ts` 內部的 `fetchCommissionSnapshot(supabase, staffId)`，回傳 `{ tiers, commissionMode }`

> **安全要求：** staff 快照只能來自 `profiles` 資料列。`UpsertStaffInput` 帶有 `password`，任何情況下都不得把 request input 放進 `before` / `after`。

- [x] **Step 1: staff — 加入 import 與快照函式**

在 import 區塊加入 `import { writeAuditLog } from "@/lib/backend/audit";`。

在檔案最下方加入：

```ts
// 只讀 profiles 資料列。這張表沒有密碼欄位,所以快照天然不含密碼;
// 絕不可改成把 UpsertStaffInput 存進去 —— 那裡面有 password。
async function fetchStaffSnapshot(
  supabase: ReturnType<typeof createSupabaseAdminClient>,
  staffId: string
) {
  const { data } = await supabase
    .from("profiles")
    .select("id, display_name, role, salary_type, hourly_wage, monthly_salary, is_active, commission_mode")
    .eq("id", staffId)
    .maybeSingle();

  return data ?? null;
}
```

- [x] **Step 2: staff — 三個 mutation 接線**

POST：在 `profileError` 檢查之後、`return` 之前插入：

```ts
  await writeAuditLog(supabase, {
    actor: guard.profile ?? null,
    action: "create",
    entity: "profiles",
    entityId: created.user.id,
    entityLabel: input.displayName.trim(),
    after: await fetchStaffSnapshot(supabase, created.user.id)
  });
```

PATCH：在 `const supabase = createSupabaseAdminClient();` 下一行插入 `const beforeSnapshot = await fetchStaffSnapshot(supabase, input.id);`，並在密碼更新區塊之後、`return` 之前插入：

```ts
  await writeAuditLog(supabase, {
    actor: guard.profile ?? null,
    action: "update",
    entity: "profiles",
    entityId: input.id,
    entityLabel: input.displayName.trim(),
    before: beforeSnapshot,
    after: await fetchStaffSnapshot(supabase, input.id)
  });
```

DELETE：在 `const supabase = createSupabaseAdminClient();` 下一行插入 `const beforeSnapshot = await fetchStaffSnapshot(supabase, input.id);`。在停用分支的 `return` 之前插入：

```ts
    await writeAuditLog(supabase, {
      actor: guard.profile ?? null,
      action: "update",
      entity: "profiles",
      entityId: input.id,
      entityLabel: (beforeSnapshot?.display_name as string) ?? null,
      before: beforeSnapshot,
      after: await fetchStaffSnapshot(supabase, input.id)
    });
```

在真正刪除帳號後的 `return` 之前插入：

```ts
  await writeAuditLog(supabase, {
    actor: guard.profile ?? null,
    action: "delete",
    entity: "profiles",
    entityId: input.id,
    entityLabel: (beforeSnapshot?.display_name as string) ?? null,
    before: beforeSnapshot
  });
```

- [x] **Step 3: commission — 加入 import 與快照函式**

在 import 區塊加入 `import { writeAuditLog } from "@/lib/backend/audit";`。

在檔案最下方加入：

```ts
// 抽成不是單一資料列,而是一組級距加上該員工的抽成模式。
// 包成物件而非裸陣列,diffRecords() 才能逐欄位比對。
async function fetchCommissionSnapshot(
  supabase: ReturnType<typeof createSupabaseAdminClient>,
  staffId: string | null
) {
  const { data: tierRows } = staffId
    ? await supabase
        .from("commission_tiers")
        .select("min_daily_sales, rate")
        .eq("staff_id", staffId)
        .order("min_daily_sales")
    : await supabase
        .from("commission_tiers")
        .select("min_daily_sales, rate")
        .is("staff_id", null)
        .order("min_daily_sales");

  let commissionMode: string | null = null;

  if (staffId) {
    const { data: profile } = await supabase
      .from("profiles")
      .select("commission_mode")
      .eq("id", staffId)
      .maybeSingle();

    commissionMode = (profile?.commission_mode as string) ?? null;
  }

  return {
    tiers: (tierRows ?? []).map(
      (tier: { min_daily_sales: number | string; rate: number | string }) => ({
        minDailySales: Number(tier.min_daily_sales),
        rate: Number(tier.rate)
      })
    ),
    commissionMode
  };
}

// 個人覆寫顯示員工姓名,全域設定顯示「全域」。
async function fetchCommissionLabel(
  supabase: ReturnType<typeof createSupabaseAdminClient>,
  staffId: string | null
) {
  if (!staffId) return "全域";

  const { data } = await supabase
    .from("profiles")
    .select("display_name")
    .eq("id", staffId)
    .maybeSingle();

  return (data?.display_name as string) ?? staffId;
}
```

- [x] **Step 4: commission — PUT 接線**

在 PUT 內，`const supabase = createSupabaseAdminClient();` 的下一行插入：

```ts
  const beforeSnapshot = await fetchCommissionSnapshot(supabase, staffId);
```

在 `const sets = await fetchCommissionTierSets(supabase);` 之前插入：

```ts
  await writeAuditLog(supabase, {
    actor: guard.profile ?? null,
    action: "update",
    entity: "commission_tiers",
    entityId: staffId ?? "global",
    entityLabel: await fetchCommissionLabel(supabase, staffId),
    before: beforeSnapshot,
    after: await fetchCommissionSnapshot(supabase, staffId)
  });
```

- [x] **Step 5: 型別檢查與建置**

Run: `npx tsc --noEmit && npm run build`
Expected: 兩者皆無錯誤。

- [ ] **Step 6: 驗證快照不含密碼**  ⚠️ 需本機 Supabase／瀏覽器，尚未執行

`npm run dev` 後在 `/manager/staff` 新增一位測試員工（需填密碼），然後查：

```bash
npx supabase db query "select after from public.audit_logs where entity = 'profiles' order by created_at desc limit 1;"
```
Expected: JSON 內容為 `id / display_name / role / salary_type / hourly_wage / monthly_salary / is_active / commission_mode`，**不含任何 password 欄位**。這一步不通過就不能往下走。

- [ ] **Step 7: 驗證抽成紀錄**  ⚠️ 需本機 Supabase／瀏覽器，尚未執行

在 `/manager/staff` 調整抽成級距後查：

```bash
npx supabase db query "select entity_id, entity_label, before, after from public.audit_logs where entity = 'commission_tiers' order by created_at desc limit 1;"
```
Expected: `entity_id` 為 `global` 或員工 uuid，`entity_label` 為「全域」或員工姓名，`before` / `after` 都是 `{"tiers": [...], "commissionMode": ...}` 形狀的物件。

- [x] **Step 8: Commit**

```bash
git add app/api/staff/route.ts app/api/commission/route.ts
git commit -m "feat: audit staff and commission changes"
```

---

### Task 8: `/api/audit` 唯讀查詢端點

**Files:**
- Create: `app/api/audit/route.ts`

**Interfaces:**
- Consumes: `requireRole`、`createSupabaseAdminClient`、`public.audit_logs`（Task 2）
- Produces: `GET /api/audit` 回傳 `{ ok: true, data: { logs, total, page, pageSize, source } }`，其中每筆 log 為 `{ id, actorId, actorName, action, entity, entityId, entityLabel, before, after, createdAt }`

> **只實作 GET。** 不得加入 POST / PATCH / DELETE。

- [x] **Step 1: 實作**

建立 `app/api/audit/route.ts`：

```ts
import { NextResponse } from "next/server";
import { requireRole } from "@/lib/auth/guards";
import { createSupabaseAdminClient, hasSupabaseAdminEnv } from "@/lib/db/server";

const PAGE_SIZE = 50;

const SELECT_COLUMNS =
  "id, actor_id, actor_name, action, entity, entity_id, entity_label, before, after, created_at";

// 稽核紀錄是 append-only,這支路由只有 GET。
export async function GET(request: Request) {
  const guard = await requireRole("manager");

  if (guard.failure) return guard.failure;

  if (!hasSupabaseAdminEnv()) {
    return NextResponse.json({
      ok: true,
      data: { logs: [], total: 0, page: 0, pageSize: PAGE_SIZE, source: "demo" }
    });
  }

  const params = new URL(request.url).searchParams;
  const entity = params.get("entity");
  const actorId = params.get("actorId");
  const from = params.get("from");
  const to = params.get("to");
  const page = Math.max(0, Math.trunc(Number(params.get("page") ?? 0)) || 0);

  const supabase = createSupabaseAdminClient();
  let query = supabase
    .from("audit_logs")
    .select(SELECT_COLUMNS, { count: "exact" })
    .order("created_at", { ascending: false })
    .range(page * PAGE_SIZE, page * PAGE_SIZE + PAGE_SIZE - 1);

  if (entity) query = query.eq("entity", entity);
  if (actorId) query = query.eq("actor_id", actorId);
  // 日期以台北時區的整日為界,與報表的 taipeiDate 一致。
  if (from) query = query.gte("created_at", `${from}T00:00:00+08:00`);
  if (to) query = query.lte("created_at", `${to}T23:59:59.999+08:00`);

  const { data, error, count } = await query;

  if (error) {
    return NextResponse.json({ ok: false, error: error.message }, { status: 500 });
  }

  return NextResponse.json({
    ok: true,
    data: {
      logs: (data ?? []).map((row) => ({
        id: row.id,
        actorId: row.actor_id,
        actorName: row.actor_name,
        action: row.action,
        entity: row.entity,
        entityId: row.entity_id,
        entityLabel: row.entity_label,
        before: row.before,
        after: row.after,
        createdAt: row.created_at
      })),
      total: count ?? 0,
      page,
      pageSize: PAGE_SIZE,
      source: "supabase"
    }
  });
}
```

- [x] **Step 2: 型別檢查與建置**

Run: `npx tsc --noEmit && npm run build`
Expected: 兩者皆無錯誤。

- [ ] **Step 3: 驗證權限與篩選**  ⚠️ 需本機 Supabase／瀏覽器，尚未執行

`npm run dev`，以**店員**身分登入後於瀏覽器 console 執行 `await fetch("/api/audit").then((r) => r.status)`。
Expected: `403`。

改以**店長**身分登入後執行 `await fetch("/api/audit?entity=products").then((r) => r.json())`。
Expected: `ok: true`，`data.logs` 只含 `entity` 為 `products` 的紀錄，且依 `createdAt` 由新到舊。

- [x] **Step 4: Commit**

```bash
git add app/api/audit/route.ts
git commit -m "feat: add read-only audit log API"
```

---

### Task 9: `/manager/audit` 查詢頁

**Files:**
- Create: `app/manager/audit/page.tsx`
- Create: `components/manager/AuditLogView.tsx`
- Modify: `components/shared/nav-links.ts`

**Interfaces:**
- Consumes: `GET /api/audit`（Task 8）、`GET /api/staff`（既有，用來填操作人下拉選單）、`diffRecords` / `auditEntityLabel` / `formatAuditValue`（Task 1）
- Produces: 導覽列新增 `{ href: "/manager/audit", label: "紀錄" }`

- [x] **Step 1: 加入導覽列項目**

修改 `components/shared/nav-links.ts`，在 `managerNavLinks` 的 `{ href: "/manager/staff", label: "員工" }` 之後加入一行：

```ts
  { href: "/manager/audit", label: "紀錄" }
```

- [x] **Step 2: 建立頁面**

建立 `app/manager/audit/page.tsx`：

```tsx
import { AuditLogView } from "@/components/manager/AuditLogView";
import { ManagerShell } from "@/components/shared/ManagerShell";

export default function ManagerAuditPage() {
  return (
    <ManagerShell>
      <AuditLogView />
    </ManagerShell>
  );
}
```

- [x] **Step 3: 建立元件**

建立 `components/manager/AuditLogView.tsx`：

```tsx
"use client";

import { useCallback, useEffect, useState } from "react";
import {
  auditEntityLabel,
  diffRecords,
  type AuditAction
} from "@/lib/domain/audit-diff";

type AuditLog = {
  id: string;
  actorId: string | null;
  actorName: string;
  action: AuditAction;
  entity: string;
  entityId: string | null;
  entityLabel: string | null;
  before: unknown;
  after: unknown;
  createdAt: string;
};

type StaffOption = { id: string; displayName: string };

const ACTION_LABELS: Record<AuditAction, string> = {
  create: "新增",
  update: "修改",
  delete: "刪除"
};

const ENTITY_OPTIONS = [
  "products",
  "flavors",
  "bundles",
  "discounts",
  "counters",
  "profiles",
  "payment_methods",
  "commission_tiers"
];

function formatTimestamp(value: string) {
  return new Date(value).toLocaleString("zh-TW", { timeZone: "Asia/Taipei", hour12: false });
}

export function AuditLogView() {
  const [logs, setLogs] = useState<AuditLog[]>([]);
  const [staff, setStaff] = useState<StaffOption[]>([]);
  const [entity, setEntity] = useState("");
  const [actorId, setActorId] = useState("");
  const [from, setFrom] = useState("");
  const [to, setTo] = useState("");
  const [page, setPage] = useState(0);
  const [total, setTotal] = useState(0);
  const [pageSize, setPageSize] = useState(50);
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [status, setStatus] = useState("讀取操作紀錄中...");

  const loadLogs = useCallback(async () => {
    const params = new URLSearchParams();

    if (entity) params.set("entity", entity);
    if (actorId) params.set("actorId", actorId);
    if (from) params.set("from", from);
    if (to) params.set("to", to);
    params.set("page", String(page));

    const result = await fetch(`/api/audit?${params.toString()}`).then((response) =>
      response.json()
    );

    if (!result.ok) {
      setStatus(result.error);
      return;
    }

    setLogs(result.data.logs ?? []);
    setTotal(result.data.total ?? 0);
    setPageSize(result.data.pageSize ?? 50);
    setStatus(
      result.data.source === "supabase"
        ? `共 ${result.data.total ?? 0} 筆紀錄`
        : "Demo 模式，無紀錄"
    );
  }, [entity, actorId, from, to, page]);

  useEffect(() => {
    void loadLogs();
  }, [loadLogs]);

  useEffect(() => {
    void fetch("/api/staff")
      .then((response) => response.json())
      .then((result) => {
        if (!result.ok) return;
        setStaff(
          (result.data.staff ?? []).map((member: { id: string; displayName: string }) => ({
            id: member.id,
            displayName: member.displayName
          }))
        );
      });
  }, []);

  const lastPage = Math.max(0, Math.ceil(total / pageSize) - 1);

  return (
    <section className="panel data-card">
      <div className="panel-header">
        <div>
          <h2>操作紀錄</h2>
          <p>
            後台設定的新增、修改、刪除紀錄。POS 訂單與庫存異動的操作人記在各自的資料裡，不在這裡重複顯示。
          </p>
        </div>
        <span className="pill">{status}</span>
      </div>

      <div className="field-row">
        <label>
          類別
          <select
            onChange={(event) => {
              setPage(0);
              setEntity(event.target.value);
            }}
            value={entity}
          >
            <option value="">全部</option>
            {ENTITY_OPTIONS.map((option) => (
              <option key={option} value={option}>
                {auditEntityLabel(option)}
              </option>
            ))}
          </select>
        </label>

        <label>
          操作人
          <select
            onChange={(event) => {
              setPage(0);
              setActorId(event.target.value);
            }}
            value={actorId}
          >
            <option value="">全部</option>
            {staff.map((member) => (
              <option key={member.id} value={member.id}>
                {member.displayName}
              </option>
            ))}
          </select>
        </label>

        <label>
          起
          <input
            onChange={(event) => {
              setPage(0);
              setFrom(event.target.value);
            }}
            type="date"
            value={from}
          />
        </label>

        <label>
          迄
          <input
            onChange={(event) => {
              setPage(0);
              setTo(event.target.value);
            }}
            type="date"
            value={to}
          />
        </label>
      </div>

      <div className="table-scroll">
        <table>
          <thead>
            <tr>
              <th>時間</th>
              <th>操作人</th>
              <th>動作</th>
              <th>類別</th>
              <th>對象</th>
              <th />
            </tr>
          </thead>
          <tbody>
            {logs.map((log) => {
              const changes = diffRecords(log.before, log.after);
              const expanded = expandedId === log.id;

              return (
                <tr key={log.id}>
                  <td>{formatTimestamp(log.createdAt)}</td>
                  <td>{log.actorName}</td>
                  <td>{ACTION_LABELS[log.action] ?? log.action}</td>
                  <td>{auditEntityLabel(log.entity)}</td>
                  <td>
                    {log.entityLabel ?? "—"}
                    {expanded ? (
                      <ul className="audit-changes">
                        {changes.length === 0 ? (
                          <li>無欄位變更</li>
                        ) : (
                          changes.map((change) => (
                            <li key={change.field}>
                              {change.label}：{change.before ?? "—"} → {change.after ?? "—"}
                            </li>
                          ))
                        )}
                      </ul>
                    ) : null}
                  </td>
                  <td>
                    <button
                      className="secondary-action slim"
                      onClick={() => setExpandedId(expanded ? null : log.id)}
                      type="button"
                    >
                      {expanded ? "收合" : `明細 (${changes.length})`}
                    </button>
                  </td>
                </tr>
              );
            })}
            {logs.length === 0 ? (
              <tr>
                <td colSpan={6}>沒有符合條件的紀錄</td>
              </tr>
            ) : null}
          </tbody>
        </table>
      </div>

      <div className="field-row">
        <button
          className="secondary-action slim"
          disabled={page <= 0}
          onClick={() => setPage(page - 1)}
          type="button"
        >
          上一頁
        </button>
        <span>
          第 {page + 1} / {lastPage + 1} 頁
        </span>
        <button
          className="secondary-action slim"
          disabled={page >= lastPage}
          onClick={() => setPage(page + 1)}
          type="button"
        >
          下一頁
        </button>
      </div>
    </section>
  );
}
```

- [x] **Step 4: 驗證 `/api/staff` 的回傳形狀未變**

Step 3 的 `.map()` 依賴 `/api/staff` GET 回傳 `data.staff` 陣列、每項含 `id` 與 `displayName`（已於撰寫本計畫時確認，見 `app/api/staff/route.ts` GET 的回傳映射）。

Run: `grep -n "displayName: profile.display_name" app/api/staff/route.ts`
Expected: 有一列命中。若沒有命中代表該路由回傳形狀已改，請依實際欄位名調整 Step 3 的 `.map()`，**不要**反過來修改 `app/api/staff/route.ts` 去遷就這個頁面。

- [x] **Step 5: 補上 `.audit-changes` 樣式**

本頁使用的 `panel` / `data-card` / `panel-header` / `pill` / `field-row` / `table-scroll` / `secondary-action` / `slim` 都是專案既有類名，不需新增。只有展開明細用的 `audit-changes` 是新的。

在 `app/globals.css` 末尾加入：

```css
.audit-changes {
  margin: 6px 0 0;
  padding-left: 18px;
  color: var(--muted);
  font-size: 12.5px;
  line-height: 1.7;
}
```

Run: `grep -c "audit-changes" app/globals.css`
Expected: `1`。

- [x] **Step 6: 建置與手動驗證**  ⚠️ 建置已通過；瀏覽器驗證尚未執行

Run: `npx tsc --noEmit && npm run build`
Expected: 兩者皆無錯誤。

`npm run dev` 後以店長身分開啟 `/manager/audit`：
- 導覽列出現「紀錄」且可進入
- 前面幾個 Task 產生的紀錄都列出來，時間為台北時間
- 點「明細」展開，修改類的紀錄只列出真正變動的欄位
- 切換「類別」與「操作人」下拉選單，列表會跟著篩選

以店員身分開啟 `/manager/audit`。
Expected: 被既有的 manager 權限機制擋下（與其他 `/manager/*` 頁一致）。

- [x] **Step 7: Commit**

```bash
git add app/manager/audit/page.tsx components/manager/AuditLogView.tsx components/shared/nav-links.ts app/globals.css
git commit -m "feat: add manager audit log page"
```

---

### Task 10: 全域回歸與收尾

**Files:**
- Modify: `docs/superpowers/plans/2026-08-25-admin-audit-log.md`（勾選完成項）

**Interfaces:**
- Consumes: Task 1–9 的全部產出
- Produces: 無新介面

- [x] **Step 1: 全套測試**

Run: `npm run test`
Expected: 全綠，含 Task 1 新增的 `audit-diff.test.ts`。

- [x] **Step 2: 建置**

Run: `npm run build`
Expected: 成功，無型別錯誤與 lint 錯誤。

- [x] **Step 3: 確認八組路由都接上了**

Run:
```bash
grep -L "writeAuditLog" app/api/products/route.ts app/api/flavors/route.ts app/api/bundles/route.ts app/api/discounts/route.ts app/api/counters/route.ts app/api/staff/route.ts app/api/payment-methods/route.ts app/api/commission/route.ts
```
Expected: **沒有任何輸出**。有輸出就代表該檔案漏接。

- [x] **Step 4: 確認沒有意外開放寫入**

Run: `grep -rn "audit_logs" app/api/ | grep -v "app/api/audit/route.ts"`
Expected: **沒有任何輸出**。除了 `lib/backend/audit.ts` 之外，不應有其他地方直接操作 `audit_logs`。

Run: `grep -n "export async function" app/api/audit/route.ts`
Expected: 只有 `export async function GET`。

- [ ] **Step 5: 端對端手動驗收**  ⚠️ 需本機 Supabase／瀏覽器，尚未執行

`npm run db:reset && npm run dev`，以店長身分依序執行並在 `/manager/audit` 確認：

1. 新增商品 → 出現一筆「新增／商品」，操作人正確，明細列出所有欄位。
2. 只改該商品的價格 → 出現「修改／商品」，明細**只有**一列「價格：X → Y」。
3. 只改該商品的禮盒規則（不動其他欄位）→ 明細顯示「禮盒規則」有變更，**不是**「無欄位變更」。
4. 刪除該商品 → 出現「刪除／商品」，明細列出刪除前的完整內容。
5. 新增員工（含密碼）→ 明細**不含**任何密碼欄位。
6. 調整抽成級距 → 出現「修改／抽成」，對象顯示員工姓名或「全域」。
7. 以店員身分呼叫 `/api/audit` → 403。

- [x] **Step 6: 勾選計畫並 commit**

把本計畫檔中已完成的項目打勾，然後：

```bash
git add docs/superpowers/plans/2026-08-25-admin-audit-log.md
git commit -m "docs: mark audit log plan complete"
```

---

## 已知限制（實作完成後仍成立）

- **無法回溯。** 「匠心(原/草/巧)」是誰建立的，做完這階段依然查不到。稽核只對上線之後的操作有效。
- **極端情況可能漏記。** `writeAuditLog` 刻意吞掉錯誤以保護主操作，資料庫寫入失敗時只留 `console.error`。
- **未涵蓋** `app/api/counters/records/route.ts`（櫃位月目標的獨立端點）與 `app/api/inventory/sort/route.ts`（排序），依 spec 議定不在本次範圍。
- **`products` / `flavors` / `counters` / `profiles` 的 DELETE 仍會靜默降級成停用。** 本階段只如實記錄該行為（記為 `update`），修正留給階段二的軟刪除。

---

## 執行狀態（2026-08-25）

程式碼九個 Task 全數實作完成。自動化驗證全通過：

- `npm run test` — 50 passed（含新增的 `audit-diff.test.ts` 19 個）
- `npm run build` — Compiled successfully
- `npx tsc --noEmit` — exit 0
- 八組路由接線檢查（`grep -L writeAuditLog`）— 無漏接
- `audit_logs` 未被 `app/api/audit` 以外的路由碰觸 — 通過
- `/api/audit` 只有 `GET` — 通過

**尚未執行的 9 個步驟全部需要本機 Supabase（Docker）或瀏覽器登入**，執行環境不具備，留給人工驗收：

1. `npm run db:start && npm run db:reset` 套用 `202608250001_audit_logs.sql`
2. 確認 `audit_logs` 只有一條 select policy（`polcmd = 'r'`）
3. 商品新增／改價／刪除後，`audit_logs` 出現三筆且操作人正確
4. 口味與組合價各三種 action 各留一筆
5. 折扣／付款方式／櫃位各留 create 與 update
6. **新增員工後，`after` 不含任何密碼欄位**（此步不通過即為安全問題，須立即停止）
7. 抽成紀錄的 `entity_id` 為 `global` 或員工 uuid，`before`/`after` 為 `{tiers, commissionMode}` 形狀
8. 店員呼叫 `/api/audit` 得到 403
9. `/manager/audit` 頁面：導覽列「紀錄」可進入、明細只列變動欄位、只改禮盒規則時不顯示「無欄位變更」、篩選可用
