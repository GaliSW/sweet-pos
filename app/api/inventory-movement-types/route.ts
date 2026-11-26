import { NextResponse } from "next/server";
import type { UpsertInventoryMovementTypeInput } from "@/lib/backend/api-types";
import { requireRole } from "@/lib/auth/guards";
import { writeAuditLog } from "@/lib/backend/audit";
import { fetchMovementTypes, movementTypeSelect } from "@/lib/backend/movement-types";
import { createSupabaseAdminClient, hasSupabaseAdminEnv } from "@/lib/db/server";
import { defaultInventoryMovementTypes } from "@/lib/domain/inventory";

// 所有登入者可讀(庫存表單需要);新增 / 修改限店長。
export async function GET() {
  const guard = await requireRole();
  if (guard.failure) return guard.failure;

  if (!hasSupabaseAdminEnv()) {
    return NextResponse.json({
      ok: true,
      data: { movementTypes: defaultInventoryMovementTypes, source: "demo" }
    });
  }

  try {
    const movementTypes = await fetchMovementTypes(createSupabaseAdminClient());
    return NextResponse.json({ ok: true, data: { movementTypes, source: "supabase" } });
  } catch (error) {
    return NextResponse.json({ ok: false, error: (error as Error).message }, { status: 500 });
  }
}

export async function POST(request: Request) {
  const guard = await requireRole("manager");
  if (guard.failure) return guard.failure;

  const input = (await request.json()) as UpsertInventoryMovementTypeInput;
  const validation = validateInput(input);
  if (!validation.ok) return NextResponse.json(validation, { status: 400 });

  // 自訂類型只能加或扣庫存;盤點會重設庫存基準,只保留系統內建的三種。
  if (input.direction !== "increase" && input.direction !== "decrease") {
    return NextResponse.json(
      { ok: false, error: "庫存方向必須是增加或扣除" },
      { status: 400 }
    );
  }

  const code = `custom_${crypto.randomUUID().replaceAll("-", "")}`;

  if (!hasSupabaseAdminEnv()) {
    return NextResponse.json({ ok: true, data: { code, source: "demo" } });
  }

  const supabase = createSupabaseAdminClient();
  const { data: last } = await supabase
    .from("inventory_movement_types")
    .select("sort_order")
    .lt("sort_order", 900) // 銷售固定排最後,新類型排在它前面
    .order("sort_order", { ascending: false })
    .limit(1)
    .maybeSingle();
  const { error } = await supabase.from("inventory_movement_types").insert({
    code,
    name: input.name.trim(),
    direction: input.direction,
    note_required: input.noteRequired ?? false,
    needs_review: input.needsReview ?? false,
    is_active: input.isActive ?? true,
    sort_order: input.sortOrder ?? Number(last?.sort_order ?? 0) + 10
  });

  if (error) return NextResponse.json({ ok: false, error: error.message }, { status: 400 });

  await writeAuditLog(supabase, {
    actor: guard.profile ?? null,
    action: "create",
    entity: "inventory_movement_types",
    entityId: code,
    entityLabel: input.name.trim(),
    after: await fetchSnapshot(supabase, code)
  });

  return NextResponse.json({ ok: true, data: { code, source: "supabase" } });
}

export async function PATCH(request: Request) {
  const guard = await requireRole("manager");
  if (guard.failure) return guard.failure;

  const input = (await request.json()) as UpsertInventoryMovementTypeInput;
  if (!input.code) {
    return NextResponse.json({ ok: false, error: "缺少異動類型編號" }, { status: 400 });
  }
  const validation = validateInput(input);
  if (!validation.ok) return NextResponse.json(validation, { status: 400 });

  if (!hasSupabaseAdminEnv()) {
    return NextResponse.json({ ok: true, data: { code: input.code, source: "demo" } });
  }

  const supabase = createSupabaseAdminClient();
  const before = await fetchSnapshot(supabase, input.code);

  if (!before) {
    return NextResponse.json({ ok: false, error: "找不到異動類型" }, { status: 404 });
  }

  // 系統內建類型由程式邏輯引用,只允許調整排序。
  // 方向建立後不可改:既有紀錄的數量正負已經寫死,改方向會讓舊紀錄與新紀錄不一致。
  const update = before.is_system
    ? { sort_order: input.sortOrder ?? before.sort_order }
    : {
        name: input.name.trim(),
        note_required: input.noteRequired ?? before.note_required,
        needs_review: input.needsReview ?? before.needs_review,
        is_active: input.isActive ?? before.is_active,
        sort_order: input.sortOrder ?? before.sort_order
      };

  const { error } = await supabase
    .from("inventory_movement_types")
    .update({ ...update, updated_at: new Date().toISOString() })
    .eq("code", input.code);

  if (error) return NextResponse.json({ ok: false, error: error.message }, { status: 400 });

  await writeAuditLog(supabase, {
    actor: guard.profile ?? null,
    action: "update",
    entity: "inventory_movement_types",
    entityId: input.code,
    entityLabel: String(before.name),
    before,
    after: await fetchSnapshot(supabase, input.code)
  });

  return NextResponse.json({ ok: true, data: { code: input.code, source: "supabase" } });
}

function validateInput(input: UpsertInventoryMovementTypeInput) {
  if (!input.name?.trim()) return { ok: false as const, error: "類型名稱不可空白" };
  if (input.name.trim().length > 20) {
    return { ok: false as const, error: "類型名稱不可超過 20 個字" };
  }
  if (input.sortOrder != null && !Number.isInteger(input.sortOrder)) {
    return { ok: false as const, error: "排序必須是整數" };
  }
  return { ok: true as const };
}

async function fetchSnapshot(supabase: ReturnType<typeof createSupabaseAdminClient>, code: string) {
  const { data } = await supabase
    .from("inventory_movement_types")
    .select(movementTypeSelect)
    .eq("code", code)
    .maybeSingle();

  return data ?? null;
}
