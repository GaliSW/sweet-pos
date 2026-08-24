import { NextResponse } from "next/server";
import { requireRole } from "@/lib/auth/guards";
import { writeAuditLog } from "@/lib/backend/audit";
import { createSupabaseAdminClient, hasSupabaseAdminEnv } from "@/lib/db/server";
import { planFlavorDeletion } from "@/lib/domain/soft-delete";
import { flavors as sampleFlavors } from "@/lib/domain/sample-data";

// 禮盒口味管理:口味清單不再寫死,後台可增修停用;
// 已被訂單 / 庫存 / 固定禮盒引用的口味刪除時轉停用(保留歷史資料)。

export async function GET(request: Request) {
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
  const includeDeleted =
    new URL(request.url).searchParams.get("includeDeleted") === "1";
  const flavorsQuery = supabase.from("flavors").select("*").order("name");
  const { data, error } = await (includeDeleted
    ? flavorsQuery
    : flavorsQuery.is("deleted_at", null));

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
        isActive: flavor.is_active,
        deletedAt: flavor.deleted_at ?? null
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

  await writeAuditLog(supabase, {
    actor: guard.profile ?? null,
    action: "create",
    entity: "flavors",
    entityId: data.id as string,
    entityLabel: input.name.trim(),
    after: await fetchFlavorSnapshot(supabase, data.id as string)
  });

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

  if (!hasSupabaseAdminEnv()) {
    return NextResponse.json({ ok: true, data: { flavorId: input.id, source: "demo" } });
  }

  const supabase = createSupabaseAdminClient();
  const beforeSnapshot = await fetchFlavorSnapshot(supabase, input.id);

  if (beforeSnapshot?.deleted_at) {
    return NextResponse.json(
      { ok: false, error: "口味已刪除，請先復原後再編輯" },
      { status: 400 }
    );
  }

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

  await writeAuditLog(supabase, {
    actor: guard.profile ?? null,
    action: "update",
    entity: "flavors",
    entityId: input.id,
    entityLabel: input.name.trim(),
    before: beforeSnapshot,
    after: await fetchFlavorSnapshot(supabase, input.id)
  });

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

  // PostgREST 的嵌入關聯在型別上被推成陣列,實際多對一時回傳物件,兩種都要能吃。
  const giftBoxNames = (rows: unknown[] | null) =>
    (rows ?? []).flatMap((row) => {
      const embedded = (row as { products?: unknown }).products;
      const list = Array.isArray(embedded) ? embedded : embedded ? [embedded] : [];

      return list
        .map((item) => (item as { name?: string } | null)?.name)
        .filter((name): name is string => Boolean(name));
    });

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
