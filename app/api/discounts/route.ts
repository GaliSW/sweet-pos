import { NextResponse } from "next/server";
import type { UpsertDiscountInput } from "@/lib/backend/api-types";
import { requireRole } from "@/lib/auth/guards";
import { createSupabaseAdminClient, hasSupabaseAdminEnv } from "@/lib/db/server";
import { discounts as sampleDiscounts } from "@/lib/domain/sample-data";

export async function GET() {
  const guard = await requireRole("manager");

  if (guard.failure) return guard.failure;

  if (!hasSupabaseAdminEnv()) {
    return NextResponse.json({
      ok: true,
      data: {
        discounts: sampleDiscounts
          .filter((discount) => discount.id !== "none")
          .map((discount) => ({
            id: discount.id,
            name: discount.name,
            discountType: discount.type,
            value: discount.value,
            minOrderAmount: discount.minOrderAmount ?? null,
            isActive: true
          })),
        source: "demo"
      }
    });
  }

  const supabase = createSupabaseAdminClient();
  const { data, error } = await supabase.from("discounts").select("*").order("name");

  if (error) {
    return NextResponse.json({ ok: false, error: error.message }, { status: 500 });
  }

  return NextResponse.json({
    ok: true,
    data: {
      discounts: (data ?? []).map((discount) => ({
        id: discount.id,
        name: discount.name,
        discountType: discount.discount_type,
        value: Number(discount.value),
        minOrderAmount: discount.min_order_amount == null ? null : Number(discount.min_order_amount),
        isActive: discount.is_active
      })),
      source: "supabase"
    }
  });
}

export async function POST(request: Request) {
  const guard = await requireRole("manager");

  if (guard.failure) return guard.failure;

  const input = (await request.json()) as UpsertDiscountInput;
  const validation = validateDiscountInput(input);

  if (!validation.ok) {
    return NextResponse.json(validation, { status: 400 });
  }

  if (!hasSupabaseAdminEnv()) {
    return NextResponse.json({
      ok: true,
      data: { discountId: crypto.randomUUID(), source: "demo" }
    });
  }

  const supabase = createSupabaseAdminClient();
  const { data, error } = await supabase
    .from("discounts")
    .insert(toRow(input))
    .select("id")
    .single();

  if (error) {
    return NextResponse.json({ ok: false, error: error.message }, { status: 400 });
  }

  return NextResponse.json({
    ok: true,
    data: { discountId: data.id, source: "supabase" }
  });
}

export async function PATCH(request: Request) {
  const guard = await requireRole("manager");

  if (guard.failure) return guard.failure;

  const input = (await request.json()) as UpsertDiscountInput;

  if (!input.id) {
    return NextResponse.json({ ok: false, error: "缺少折扣編號" }, { status: 400 });
  }

  const validation = validateDiscountInput(input);

  if (!validation.ok) {
    return NextResponse.json(validation, { status: 400 });
  }

  if (!hasSupabaseAdminEnv()) {
    return NextResponse.json({
      ok: true,
      data: { discountId: input.id, source: "demo" }
    });
  }

  const supabase = createSupabaseAdminClient();
  const { data, error } = await supabase
    .from("discounts")
    .update(toRow(input))
    .eq("id", input.id)
    .select("id")
    .single();

  if (error) {
    return NextResponse.json({ ok: false, error: error.message }, { status: 400 });
  }

  return NextResponse.json({
    ok: true,
    data: { discountId: data.id, source: "supabase" }
  });
}

function toRow(input: UpsertDiscountInput) {
  return {
    name: input.name.trim(),
    discount_type: input.discountType,
    value: input.value,
    min_order_amount: input.minOrderAmount ?? null,
    is_active: input.isActive ?? true
  };
}

function validateDiscountInput(input: UpsertDiscountInput) {
  if (!input.name?.trim()) return { ok: false as const, error: "缺少折扣名稱" };
  if (input.discountType !== "percentage" && input.discountType !== "fixed_amount") {
    return { ok: false as const, error: "折扣類型必須是百分比或固定金額" };
  }

  const value = Number(input.value);

  if (!Number.isFinite(value) || value <= 0) {
    return { ok: false as const, error: "折扣值必須大於 0" };
  }

  if (input.discountType === "percentage" && value >= 1) {
    return { ok: false as const, error: "百分比折扣請填 0-1 之間,例如 9 折填 0.9" };
  }

  if (input.minOrderAmount != null && Number(input.minOrderAmount) < 0) {
    return { ok: false as const, error: "最低消費金額不可為負數" };
  }

  return { ok: true as const };
}
