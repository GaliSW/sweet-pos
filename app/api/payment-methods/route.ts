import { NextResponse } from "next/server";
import type { UpsertPaymentMethodInput } from "@/lib/backend/api-types";
import { requireRole } from "@/lib/auth/guards";
import { createSupabaseAdminClient, hasSupabaseAdminEnv } from "@/lib/db/server";
import { defaultPaymentMethods } from "@/lib/domain/payment-methods";

export async function GET() {
  const guard = await requireRole("manager");
  if (guard.failure) return guard.failure;

  if (!hasSupabaseAdminEnv()) {
    return NextResponse.json({
      ok: true,
      data: { paymentMethods: defaultPaymentMethods, source: "demo" }
    });
  }

  const supabase = createSupabaseAdminClient();
  const { data, error } = await supabase
    .from("payment_methods")
    .select("code, name, is_active, sort_order")
    .order("sort_order")
    .order("created_at");

  if (error) return NextResponse.json({ ok: false, error: error.message }, { status: 500 });

  return NextResponse.json({
    ok: true,
    data: {
      paymentMethods: (data ?? [])
        .filter((method) => !["line_pay", "jkopay"].includes(method.code))
        .map((method) => ({
          code: method.code,
          name: method.name,
          isActive: method.is_active,
          sortOrder: method.sort_order
        })),
      source: "supabase"
    }
  });
}

export async function POST(request: Request) {
  const guard = await requireRole("manager");
  if (guard.failure) return guard.failure;

  const input = (await request.json()) as UpsertPaymentMethodInput;
  const validation = validateInput(input);
  if (!validation.ok) return NextResponse.json(validation, { status: 400 });

  if (!hasSupabaseAdminEnv()) {
    return NextResponse.json({
      ok: true,
      data: { code: `custom_${crypto.randomUUID().replaceAll("-", "")}`, source: "demo" }
    });
  }

  const supabase = createSupabaseAdminClient();
  const { data: last } = await supabase
    .from("payment_methods")
    .select("sort_order")
    .order("sort_order", { ascending: false })
    .limit(1)
    .maybeSingle();
  const code = `custom_${crypto.randomUUID().replaceAll("-", "")}`;
  const { error } = await supabase.from("payment_methods").insert({
    code,
    name: input.name.trim(),
    is_active: input.isActive ?? true,
    sort_order: input.sortOrder ?? Number(last?.sort_order ?? 0) + 10
  });

  if (error) return NextResponse.json({ ok: false, error: error.message }, { status: 400 });
  return NextResponse.json({ ok: true, data: { code, source: "supabase" } });
}

export async function PATCH(request: Request) {
  const guard = await requireRole("manager");
  if (guard.failure) return guard.failure;

  const input = (await request.json()) as UpsertPaymentMethodInput;
  const validation = validateInput(input);
  if (!input.code) {
    return NextResponse.json({ ok: false, error: "缺少付款方式編號" }, { status: 400 });
  }
  if (!validation.ok) return NextResponse.json(validation, { status: 400 });

  if (!hasSupabaseAdminEnv()) {
    return NextResponse.json({ ok: true, data: { code: input.code, source: "demo" } });
  }

  const supabase = createSupabaseAdminClient();

  if (input.isActive === false) {
    const { count, error: countError } = await supabase
      .from("payment_methods")
      .select("code", { count: "exact", head: true })
      .eq("is_active", true)
      .neq("code", input.code);

    if (countError) {
      return NextResponse.json({ ok: false, error: countError.message }, { status: 500 });
    }
    if ((count ?? 0) === 0) {
      return NextResponse.json(
        { ok: false, error: "至少要保留一個啟用的付款方式" },
        { status: 400 }
      );
    }
  }

  const { data, error } = await supabase
    .from("payment_methods")
    .update({
      name: input.name.trim(),
      is_active: input.isActive ?? true,
      sort_order: input.sortOrder ?? 0,
      updated_at: new Date().toISOString()
    })
    .eq("code", input.code)
    .select("code")
    .single();

  if (error) return NextResponse.json({ ok: false, error: error.message }, { status: 400 });
  return NextResponse.json({ ok: true, data: { code: data.code, source: "supabase" } });
}

function validateInput(input: UpsertPaymentMethodInput) {
  if (!input.name?.trim()) return { ok: false as const, error: "付款方式名稱不可空白" };
  if (input.name.trim().length > 40) {
    return { ok: false as const, error: "付款方式名稱不可超過 40 個字" };
  }
  if (input.sortOrder != null && !Number.isInteger(input.sortOrder)) {
    return { ok: false as const, error: "排序必須是整數" };
  }
  return { ok: true as const };
}
