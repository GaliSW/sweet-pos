import { NextResponse } from "next/server";
import { requireRole } from "@/lib/auth/guards";
import { createSupabaseAdminClient, hasSupabaseAdminEnv } from "@/lib/db/server";
import { flavors as sampleFlavors } from "@/lib/domain/sample-data";

// 禮盒口味管理:口味清單不再寫死,後台可增修停用;
// 已被訂單 / 庫存 / 固定禮盒引用的口味刪除時轉停用(保留歷史資料)。

export async function GET() {
  const guard = await requireRole("manager");

  if (guard.failure) return guard.failure;

  if (!hasSupabaseAdminEnv()) {
    return NextResponse.json({
      ok: true,
      data: {
        flavors: sampleFlavors.map((name, index) => ({
          id: `demo-${index}`,
          name,
          spec: "6入/袋",
          isActive: true
        })),
        source: "demo"
      }
    });
  }

  const supabase = createSupabaseAdminClient();
  const { data, error } = await supabase.from("flavors").select("*").order("name");

  if (error) {
    return NextResponse.json({ ok: false, error: error.message }, { status: 500 });
  }

  return NextResponse.json({
    ok: true,
    data: {
      flavors: (data ?? []).map((flavor) => ({
        id: flavor.id,
        name: flavor.name,
        spec: flavor.spec,
        isActive: flavor.is_active
      })),
      source: "supabase"
    }
  });
}

export async function POST(request: Request) {
  const guard = await requireRole("manager");

  if (guard.failure) return guard.failure;

  const input = (await request.json()) as { name?: string; spec?: string };

  if (!input.name?.trim()) {
    return NextResponse.json({ ok: false, error: "缺少口味名稱" }, { status: 400 });
  }

  if (!hasSupabaseAdminEnv()) {
    return NextResponse.json({
      ok: true,
      data: { flavorId: crypto.randomUUID(), source: "demo" }
    });
  }

  const supabase = createSupabaseAdminClient();
  const { data, error } = await supabase
    .from("flavors")
    .insert({
      name: input.name.trim(),
      spec: input.spec?.trim() || "6入/袋"
    })
    .select("id")
    .single();

  if (error) {
    return NextResponse.json({ ok: false, error: error.message }, { status: 400 });
  }

  return NextResponse.json({ ok: true, data: { flavorId: data.id, source: "supabase" } });
}

export async function PATCH(request: Request) {
  const guard = await requireRole("manager");

  if (guard.failure) return guard.failure;

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

  if (!hasSupabaseAdminEnv()) {
    return NextResponse.json({ ok: true, data: { flavorId: input.id, source: "demo" } });
  }

  const supabase = createSupabaseAdminClient();
  const { error } = await supabase
    .from("flavors")
    .update({
      name: input.name.trim(),
      spec: input.spec?.trim() || "6入/袋",
      is_active: input.isActive ?? true
    })
    .eq("id", input.id);

  if (error) {
    return NextResponse.json({ ok: false, error: error.message }, { status: 400 });
  }

  return NextResponse.json({ ok: true, data: { flavorId: input.id, source: "supabase" } });
}

export async function DELETE(request: Request) {
  const guard = await requireRole("manager");

  if (guard.failure) return guard.failure;

  const input = (await request.json()) as { id?: string };

  if (!input.id) {
    return NextResponse.json({ ok: false, error: "缺少口味編號" }, { status: 400 });
  }

  if (!hasSupabaseAdminEnv()) {
    return NextResponse.json({
      ok: true,
      data: { flavorId: input.id, mode: "deleted", source: "demo" }
    });
  }

  const supabase = createSupabaseAdminClient();
  const [giftFlavorsResult, movementsResult, fixedResult] = await Promise.all([
    supabase
      .from("order_item_gift_flavors")
      .select("id", { count: "exact", head: true })
      .eq("flavor_id", input.id),
    supabase
      .from("inventory_movements")
      .select("id", { count: "exact", head: true })
      .eq("flavor_id", input.id),
    supabase
      .from("gift_box_fixed_flavors")
      .select("id", { count: "exact", head: true })
      .eq("flavor_id", input.id)
  ]);

  const countError = giftFlavorsResult.error ?? movementsResult.error ?? fixedResult.error;

  if (countError) {
    return NextResponse.json({ ok: false, error: countError.message }, { status: 500 });
  }

  const referenceCount =
    (giftFlavorsResult.count ?? 0) + (movementsResult.count ?? 0) + (fixedResult.count ?? 0);

  if (referenceCount > 0) {
    const { error } = await supabase
      .from("flavors")
      .update({ is_active: false })
      .eq("id", input.id);

    if (error) {
      return NextResponse.json({ ok: false, error: error.message }, { status: 400 });
    }

    return NextResponse.json({
      ok: true,
      data: {
        flavorId: input.id,
        mode: "deactivated",
        message: "口味已有訂單、庫存或固定禮盒紀錄，已改為停用（保留歷史資料）",
        source: "supabase"
      }
    });
  }

  const { error } = await supabase.from("flavors").delete().eq("id", input.id);

  if (error) {
    return NextResponse.json({ ok: false, error: error.message }, { status: 400 });
  }

  return NextResponse.json({
    ok: true,
    data: { flavorId: input.id, mode: "deleted", source: "supabase" }
  });
}
