import { NextResponse } from "next/server";
import type { UpsertBundleInput } from "@/lib/backend/api-types";
import { requireRole } from "@/lib/auth/guards";
import { createSupabaseAdminClient, hasSupabaseAdminEnv } from "@/lib/db/server";

// 組合價(量販):指定商品群任選 N 件 $X,可設多個級距(2件500、4件900),
// POS 結帳自動套最划算組合,之後的訂單折扣以組合後金額計算。

export async function GET() {
  const guard = await requireRole("manager");

  if (guard.failure) return guard.failure;

  if (!hasSupabaseAdminEnv()) {
    return NextResponse.json({ ok: true, data: { bundles: [], source: "demo" } });
  }

  const supabase = createSupabaseAdminClient();
  const { data, error } = await supabase
    .from("bundles")
    .select("id, name, is_active, bundle_products(product_id), bundle_tiers(quantity, price)")
    .order("created_at");

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
  const { error } = await supabase.from("bundles").delete().eq("id", input.id);

  if (error) {
    return NextResponse.json({ ok: false, error: error.message }, { status: 400 });
  }

  return NextResponse.json({ ok: true, data: { bundleId: input.id, source: "supabase" } });
}

async function upsertBundle(request: Request, mode: "create" | "update") {
  const guard = await requireRole("manager");

  if (guard.failure) return guard.failure;

  const input = (await request.json()) as UpsertBundleInput;

  if (mode === "update" && !input.id) {
    return NextResponse.json({ ok: false, error: "缺少組合編號" }, { status: 400 });
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

  return NextResponse.json({ ok: true, data: { bundleId, source: "supabase" } });
}
