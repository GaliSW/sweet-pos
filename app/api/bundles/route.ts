import { NextResponse } from "next/server";
import type { UpsertBundleInput } from "@/lib/backend/api-types";
import { requireRole } from "@/lib/auth/guards";
import { writeAuditLog } from "@/lib/backend/audit";
import { createSupabaseAdminClient, hasSupabaseAdminEnv } from "@/lib/db/server";

// 組合價(量販):指定商品群任選 N 件 $X,可設多個級距(2件500、4件900),
// POS 結帳自動套最划算組合,之後的訂單折扣以組合後金額計算。

export async function GET(request: Request) {
  const guard = await requireRole("manager");

  if (guard.failure) return guard.failure;

  if (!hasSupabaseAdminEnv()) {
    return NextResponse.json({ ok: true, data: { bundles: [], source: "demo" } });
  }

  const supabase = createSupabaseAdminClient();
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

  if (error) {
    return NextResponse.json({ ok: false, error: error.message }, { status: 500 });
  }

  return NextResponse.json({
    ok: true,
    data: {
      bundles: (data ?? []).map((bundle) => ({
        id: bundle.id,
        name: bundle.name,
        isActive: bundle.is_active,
        deletedAt: bundle.deleted_at ?? null,
        productIds: (bundle.bundle_products ?? []).map(
          (row: { product_id: string }) => row.product_id
        ),
        tiers: (bundle.bundle_tiers ?? [])
          .map((tier: { quantity: number; price: number | string }) => ({
            quantity: tier.quantity,
            price: Number(tier.price)
          }))
          .sort(
            (left: { quantity: number }, right: { quantity: number }) =>
              left.quantity - right.quantity
          )
      })),
      source: "supabase"
    }
  });
}

export async function POST(request: Request) {
  return upsertBundle(request, "create");
}

export async function PATCH(request: Request) {
  return upsertBundle(request, "update");
}

export async function DELETE(request: Request) {
  const guard = await requireRole("manager");

  if (guard.failure) return guard.failure;

  const input = (await request.json()) as { id?: string };

  if (!input.id) {
    return NextResponse.json({ ok: false, error: "缺少組合編號" }, { status: 400 });
  }

  if (!hasSupabaseAdminEnv()) {
    return NextResponse.json({ ok: true, data: { bundleId: input.id, source: "demo" } });
  }

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

async function upsertBundle(request: Request, mode: "create" | "update") {
  const guard = await requireRole("manager");

  if (guard.failure) return guard.failure;

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

  const productIds = Array.from(new Set(input.productIds ?? []));

  if (productIds.length === 0) {
    return NextResponse.json({ ok: false, error: "至少要勾選一個商品" }, { status: 400 });
  }

  const tiers = (input.tiers ?? []).map((tier) => ({
    quantity: Math.floor(Number(tier.quantity)),
    price: Number(tier.price)
  }));

  if (tiers.length === 0) {
    return NextResponse.json({ ok: false, error: "至少要設定一個件數級距" }, { status: 400 });
  }

  const quantities = new Set<number>();

  for (const tier of tiers) {
    if (!Number.isFinite(tier.quantity) || tier.quantity < 2) {
      return NextResponse.json({ ok: false, error: "件數必須是 2 以上的整數" }, { status: 400 });
    }
    if (!Number.isFinite(tier.price) || tier.price <= 0) {
      return NextResponse.json({ ok: false, error: "組合價必須大於 0" }, { status: 400 });
    }
    if (quantities.has(tier.quantity)) {
      return NextResponse.json({ ok: false, error: "件數不可重複" }, { status: 400 });
    }
    quantities.add(tier.quantity);
  }

  if (!hasSupabaseAdminEnv()) {
    return NextResponse.json({
      ok: true,
      data: { bundleId: input.id ?? crypto.randomUUID(), source: "demo" }
    });
  }

  const supabase = createSupabaseAdminClient();
  const beforeSnapshot =
    mode === "update" && input.id ? await fetchBundleSnapshot(supabase, input.id) : null;

  if (beforeSnapshot?.deleted_at) {
    return NextResponse.json(
      { ok: false, error: "組合價已刪除，請先復原後再編輯" },
      { status: 400 }
    );
  }
  let bundleId = input.id ?? null;

  if (mode === "create") {
    const { data, error } = await supabase
      .from("bundles")
      .insert({ name: input.name.trim(), is_active: input.isActive ?? true })
      .select("id")
      .single();

    if (error) {
      return NextResponse.json({ ok: false, error: error.message }, { status: 400 });
    }

    bundleId = data.id as string;
  } else {
    const { error } = await supabase
      .from("bundles")
      .update({ name: input.name.trim(), is_active: input.isActive ?? true })
      .eq("id", bundleId);

    if (error) {
      return NextResponse.json({ ok: false, error: error.message }, { status: 400 });
    }

    const [clearProducts, clearTiers] = await Promise.all([
      supabase.from("bundle_products").delete().eq("bundle_id", bundleId),
      supabase.from("bundle_tiers").delete().eq("bundle_id", bundleId)
    ]);
    const clearError = clearProducts.error ?? clearTiers.error;

    if (clearError) {
      return NextResponse.json({ ok: false, error: clearError.message }, { status: 400 });
    }
  }

  const [productsInsert, tiersInsert] = await Promise.all([
    supabase
      .from("bundle_products")
      .insert(productIds.map((productId) => ({ bundle_id: bundleId, product_id: productId }))),
    supabase
      .from("bundle_tiers")
      .insert(tiers.map((tier) => ({ bundle_id: bundleId, ...tier })))
  ]);
  const insertError = productsInsert.error ?? tiersInsert.error;

  if (insertError) {
    return NextResponse.json({ ok: false, error: insertError.message }, { status: 400 });
  }

  await writeAuditLog(supabase, {
    actor: guard.profile ?? null,
    action: mode === "create" ? "create" : "update",
    entity: "bundles",
    entityId: bundleId,
    entityLabel: input.name.trim(),
    before: beforeSnapshot,
    after: bundleId ? await fetchBundleSnapshot(supabase, bundleId) : null
  });

  return NextResponse.json({ ok: true, data: { bundleId, source: "supabase" } });
}

// 組合價的商品群與級距存在兩張子表,快照要含兩者才看得出改了什麼。
// 排序後再存,避免子表回傳順序不同被誤判成變更。
async function fetchBundleSnapshot(
  supabase: ReturnType<typeof createSupabaseAdminClient>,
  bundleId: string
) {
  const { data } = await supabase
    .from("bundles")
    .select(
      "id, name, is_active, deleted_at, bundle_products(product_id), bundle_tiers(quantity, price)"
    )
    .eq("id", bundleId)
    .maybeSingle();

  if (!data) return null;

  return {
    id: data.id,
    name: data.name,
    is_active: data.is_active,
    deleted_at: data.deleted_at ?? null,
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
