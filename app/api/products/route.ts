import { NextResponse } from "next/server";
import type { UpsertProductInput } from "@/lib/backend/api-types";
import { requireRole } from "@/lib/auth/guards";
import { createSupabaseAdminClient, hasSupabaseAdminEnv } from "@/lib/db/server";
import { products as sampleProducts } from "@/lib/domain/sample-data";

export async function GET() {
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
  const [productsResult, rulesResult] = await Promise.all([
    supabase.from("products").select("*").order("category").order("name"),
    supabase.from("gift_box_rules").select("*")
  ]);

  const error = productsResult.error ?? rulesResult.error;

  if (error) {
    return NextResponse.json({ ok: false, error: error.message }, { status: 500 });
  }

  const ruleByProductId = new Map(
    (rulesResult.data ?? []).map((rule) => [rule.product_id as string, rule])
  );

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
          giftRule: rule
            ? {
                selectionMode: rule.selection_mode,
                requiredFlavorCount: rule.required_flavor_count,
                includesScallionCracker: rule.includes_scallion_cracker
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
      is_popular: input.isPopular ?? false
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

  return NextResponse.json({
    ok: true,
    data: { productId: data.id, source: "supabase" }
  });
}

export async function PATCH(request: Request) {
  const guard = await requireRole("manager");

  if (guard.failure) return guard.failure;

  const input = (await request.json()) as UpsertProductInput;

  if (!input.id) {
    return NextResponse.json({ ok: false, error: "缺少商品編號" }, { status: 400 });
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

  const { data, error } = await supabase
    .from("products")
    .update({
      category: input.category,
      name: input.name.trim(),
      spec: input.spec.trim(),
      price: input.price,
      is_active: input.isActive ?? true,
      is_popular: input.isPopular ?? false
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
  const [orderItemsResult, movementsResult] = await Promise.all([
    supabase
      .from("order_items")
      .select("id", { count: "exact", head: true })
      .eq("product_id", input.id),
    supabase
      .from("inventory_movements")
      .select("id", { count: "exact", head: true })
      .eq("product_id", input.id)
  ]);

  const countError = orderItemsResult.error ?? movementsResult.error;

  if (countError) {
    return NextResponse.json({ ok: false, error: countError.message }, { status: 500 });
  }

  const referenceCount = (orderItemsResult.count ?? 0) + (movementsResult.count ?? 0);

  if (referenceCount > 0) {
    const { error } = await supabase
      .from("products")
      .update({ is_active: false })
      .eq("id", input.id);

    if (error) {
      return NextResponse.json({ ok: false, error: error.message }, { status: 400 });
    }

    return NextResponse.json({
      ok: true,
      data: {
        productId: input.id,
        mode: "deactivated",
        message: "商品已有訂單或庫存紀錄，已改為停用（保留歷史資料）",
        source: "supabase"
      }
    });
  }

  const { error } = await supabase.from("products").delete().eq("id", input.id);

  if (error) {
    return NextResponse.json({ ok: false, error: error.message }, { status: 400 });
  }

  return NextResponse.json({
    ok: true,
    data: { productId: input.id, mode: "deleted", source: "supabase" }
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

  return error?.message ?? null;
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
