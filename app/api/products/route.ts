import { NextResponse } from "next/server";
import type { UpsertProductInput } from "@/lib/backend/api-types";
import { requireRole } from "@/lib/auth/guards";
import { writeAuditLog } from "@/lib/backend/audit";
import { createSupabaseAdminClient, hasSupabaseAdminEnv } from "@/lib/db/server";
import { planProductDeletion } from "@/lib/domain/soft-delete";
import { products as sampleProducts } from "@/lib/domain/sample-data";

export async function GET(request: Request) {
  const guard = await requireRole("manager");

  if (guard.failure) return guard.failure;

  if (!hasSupabaseAdminEnv()) {
    return NextResponse.json({
      ok: true,
      data: {
        products: sampleProducts.map((product) => ({
          id: product.id,
          category: product.category,
          name: product.name,
          spec: product.spec,
          price: product.price,
          isActive: true,
          isPopular: Boolean(product.popular),
          giftRule: product.giftRule
            ? {
                selectionMode: product.giftRule.mode,
                requiredFlavorCount: product.giftRule.requiredFlavorCount ?? 0,
                includesScallionCracker: product.giftRule.includesScallionCracker ?? false
              }
            : null
        })),
        source: "demo"
      }
    });
  }

  const supabase = createSupabaseAdminClient();
  const [productsResult, rulesResult, allowedResult] = await Promise.all([
    buildProductsQuery(supabase, request),
    supabase.from("gift_box_rules").select("*"),
    supabase.from("gift_box_allowed_flavors").select("product_id, flavor_id")
  ]);

  const error = productsResult.error ?? rulesResult.error ?? allowedResult.error;

  if (error) {
    return NextResponse.json({ ok: false, error: error.message }, { status: 500 });
  }

  const ruleByProductId = new Map(
    (rulesResult.data ?? []).map((rule) => [rule.product_id as string, rule])
  );
  const allowedByProductId = new Map<string, string[]>();

  for (const row of allowedResult.data ?? []) {
    const list = allowedByProductId.get(row.product_id as string) ?? [];
    list.push(row.flavor_id as string);
    allowedByProductId.set(row.product_id as string, list);
  }

  return NextResponse.json({
    ok: true,
    data: {
      products: (productsResult.data ?? []).map((product) => {
        const rule = ruleByProductId.get(product.id as string);

        return {
          id: product.id,
          category: product.category,
          name: product.name,
          spec: product.spec,
          price: Number(product.price),
          isActive: product.is_active,
          isPopular: Boolean(product.is_popular),
          stockSourceProductId: product.stock_source_product_id ?? null,
          deletedAt: product.deleted_at ?? null,
          giftRule: rule
            ? {
                selectionMode: rule.selection_mode,
                requiredFlavorCount: rule.required_flavor_count,
                includesScallionCracker: rule.includes_scallion_cracker,
                allowedFlavorIds: allowedByProductId.get(product.id as string) ?? []
              }
            : null
        };
      }),
      source: "supabase"
    }
  });
}

export async function POST(request: Request) {
  const guard = await requireRole("manager");

  if (guard.failure) return guard.failure;

  const input = (await request.json()) as UpsertProductInput;
  const validation = validateProductInput(input);

  if (!validation.ok) {
    return NextResponse.json(validation, { status: 400 });
  }

  if (!hasSupabaseAdminEnv()) {
    return NextResponse.json({
      ok: true,
      data: { productId: crypto.randomUUID(), source: "demo" }
    });
  }

  const supabase = createSupabaseAdminClient();

  const { data, error } = await supabase
    .from("products")
    .insert({
      category: input.category,
      name: input.name.trim(),
      spec: input.spec.trim(),
      price: input.price,
      is_active: input.isActive ?? true,
      is_popular: input.isPopular ?? false,
      stock_source_product_id: resolveStockSource(input)
    })
    .select("id")
    .single();

  if (error) {
    return NextResponse.json({ ok: false, error: error.message }, { status: 400 });
  }

  const ruleError = await upsertGiftRule(supabase, data.id, input);

  if (ruleError) {
    return NextResponse.json({ ok: false, error: ruleError }, { status: 400 });
  }

  await writeAuditLog(supabase, {
    actor: guard.profile ?? null,
    action: "create",
    entity: "products",
    entityId: data.id as string,
    entityLabel: input.name.trim(),
    after: await fetchProductSnapshot(supabase, data.id as string)
  });

  return NextResponse.json({
    ok: true,
    data: { productId: data.id, source: "supabase" }
  });
}

export async function PATCH(request: Request) {
  const guard = await requireRole("manager");

  if (guard.failure) return guard.failure;

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

  if (!validation.ok) {
    return NextResponse.json(validation, { status: 400 });
  }

  if (!hasSupabaseAdminEnv()) {
    return NextResponse.json({
      ok: true,
      data: { productId: input.id, source: "demo" }
    });
  }

  const supabase = createSupabaseAdminClient();
  const beforeSnapshot = await fetchProductSnapshot(supabase, input.id);

  if (beforeSnapshot?.deleted_at) {
    return NextResponse.json(
      { ok: false, error: "商品已刪除，請先復原後再編輯" },
      { status: 400 }
    );
  }

  const { data, error } = await supabase
    .from("products")
    .update({
      category: input.category,
      name: input.name.trim(),
      spec: input.spec.trim(),
      price: input.price,
      is_active: input.isActive ?? true,
      is_popular: input.isPopular ?? false,
      stock_source_product_id: resolveStockSource(input)
    })
    .eq("id", input.id)
    .select("id")
    .single();

  if (error) {
    return NextResponse.json({ ok: false, error: error.message }, { status: 400 });
  }

  const ruleError = await upsertGiftRule(supabase, data.id, input);

  if (ruleError) {
    return NextResponse.json({ ok: false, error: ruleError }, { status: 400 });
  }

  await writeAuditLog(supabase, {
    actor: guard.profile ?? null,
    action: "update",
    entity: "products",
    entityId: data.id as string,
    entityLabel: input.name.trim(),
    before: beforeSnapshot,
    after: await fetchProductSnapshot(supabase, data.id as string)
  });

  return NextResponse.json({
    ok: true,
    data: { productId: data.id, source: "supabase" }
  });
}

export async function DELETE(request: Request) {
  const guard = await requireRole("manager");

  if (guard.failure) return guard.failure;

  const input = (await request.json()) as { id?: string };

  if (!input.id) {
    return NextResponse.json({ ok: false, error: "缺少商品編號" }, { status: 400 });
  }

  if (!hasSupabaseAdminEnv()) {
    return NextResponse.json({
      ok: true,
      data: { productId: input.id, mode: "deleted", source: "demo" }
    });
  }

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

  // PostgREST 的嵌入關聯在型別上被推成陣列,實際多對一時回傳物件,兩種都要能吃。
  const bundleNames = (bundlesResult.data ?? []).flatMap((row) => {
    const embedded = (row as { bundles?: unknown }).bundles;
    const list = Array.isArray(embedded) ? embedded : embedded ? [embedded] : [];

    return list
      .map((item) => (item as { name?: string } | null)?.name)
      .filter((name): name is string => Boolean(name));
  });

  const plan = planProductDeletion({
    name: beforeSnapshot.name as string,
    stockSourceDependents: (dependentsResult.data ?? []).map((row) => row.name as string),
    bundleNames
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

async function upsertGiftRule(
  supabase: ReturnType<typeof createSupabaseAdminClient>,
  productId: string,
  input: UpsertProductInput
) {
  if (input.category !== "gift_box" || !input.giftRule) return null;

  const { error } = await supabase.from("gift_box_rules").upsert(
    {
      product_id: productId,
      selection_mode: input.giftRule.selectionMode,
      required_flavor_count: input.giftRule.requiredFlavorCount ?? 0,
      includes_scallion_cracker: input.giftRule.includesScallionCracker ?? false
    },
    { onConflict: "product_id" }
  );

  if (error) return error.message;

  // 可選口味整組重寫(空 = 全部口味可選)
  const { error: clearError } = await supabase
    .from("gift_box_allowed_flavors")
    .delete()
    .eq("product_id", productId);

  if (clearError) return clearError.message;

  const allowedFlavorIds = Array.from(new Set(input.giftRule.allowedFlavorIds ?? []));

  if (allowedFlavorIds.length > 0) {
    const { error: insertError } = await supabase.from("gift_box_allowed_flavors").insert(
      allowedFlavorIds.map((flavorId) => ({ product_id: productId, flavor_id: flavorId }))
    );

    if (insertError) return insertError.message;
  }

  return null;
}

// 庫存來源僅適用「非自選」禮盒(自選禮盒扣口味庫存),且不可指向自己
function resolveStockSource(input: UpsertProductInput) {
  if (input.category !== "gift_box") return null;
  if (input.giftRule?.selectionMode === "select") return null;
  if (!input.stockSourceProductId || input.stockSourceProductId === input.id) return null;

  return input.stockSourceProductId;
}

function validateProductInput(input: UpsertProductInput) {
  if (input.category !== "bag" && input.category !== "gift_box") {
    return { ok: false as const, error: "商品類型必須是袋裝或禮盒" };
  }
  if (!input.name?.trim()) return { ok: false as const, error: "缺少品名" };
  if (!input.spec?.trim()) return { ok: false as const, error: "缺少規格" };
  if (!Number.isFinite(Number(input.price)) || Number(input.price) <= 0) {
    return { ok: false as const, error: "售價必須大於 0" };
  }
  if (input.giftRule) {
    if (input.giftRule.selectionMode !== "select" && input.giftRule.selectionMode !== "fixed") {
      return { ok: false as const, error: "禮盒規則必須是自選或固定" };
    }
    if (
      input.giftRule.selectionMode === "select" &&
      (!input.giftRule.requiredFlavorCount || input.giftRule.requiredFlavorCount <= 0)
    ) {
      return { ok: false as const, error: "自選禮盒需要設定口味數" };
    }
  }

  return { ok: true as const };
}

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
