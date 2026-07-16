import { NextResponse } from "next/server";
import type {
  CreateInventoryMovementInput,
  InventoryMovementType,
  UpdateInventoryMovementInput
} from "@/lib/backend/api-types";
import { requireRole } from "@/lib/auth/guards";
import { relationDisplayName } from "@/lib/backend/query-helpers";
import { createSupabaseAdminClient, hasSupabaseAdminEnv } from "@/lib/db/server";

const defaultStaffId = "00000000-0000-4000-8000-000000000001";
const countTypes = new Set<InventoryMovementType>([
  "opening_count",
  "closing_count",
  "handover_count"
]);
const deductionTypes = new Set<InventoryMovementType>(["sampling", "waste", "sale"]);
const noteRequiredTypes = new Set<InventoryMovementType>(["sampling", "waste", "adjustment"]);

const movementLabels: Record<InventoryMovementType, string> = {
  opening_count: "開班盤點",
  closing_count: "下班盤點",
  handover_count: "交班盤點",
  purchase: "進貨",
  sampling: "試吃",
  waste: "報廢",
  adjustment: "調整",
  sale: "銷售"
};

const movementSelect =
  "id, counter_id, product_id, flavor_id, movement_type, quantity, counted_quantity, note, created_by, created_at, updated_at, reviewed_at, counters(name), products(name, spec), flavors(name, spec), created_profile:profiles!inventory_movements_created_by_fkey(display_name), updated_profile:profiles!inventory_movements_updated_by_fkey(display_name), reviewed_profile:profiles!inventory_movements_reviewed_by_fkey(display_name)";

export async function GET(request: Request) {
  const guard = await requireRole();

  if (guard.failure) return guard.failure;

  const { searchParams } = new URL(request.url);
  const counterId = searchParams.get("counterId");

  if (!hasSupabaseAdminEnv()) {
    return NextResponse.json({
      ok: true,
      data: {
        movements: [],
        summary: [],
        source: "demo"
      }
    });
  }

  const supabase = createSupabaseAdminClient();

  let query = supabase
    .from("inventory_movements")
    .select(movementSelect)
    .order("created_at", { ascending: false })
    .limit(150);

  if (counterId) {
    query = query.eq("counter_id", counterId);
  }

  const { data, error } = await query;

  if (error) {
    return NextResponse.json({ ok: false, error: error.message }, { status: 500 });
  }

  const movements = (data ?? []).map((movement) => {
    const isFlavor = Boolean(movement.flavor_id);

    return {
      id: movement.id,
      counterId: movement.counter_id,
      counterName: relationName(movement.counters),
      productId: movement.product_id,
      flavorId: movement.flavor_id,
      itemKey: isFlavor ? `flavor:${movement.flavor_id}` : `product:${movement.product_id}`,
      itemName: isFlavor ? relationName(movement.flavors) : relationName(movement.products),
      itemSpec: isFlavor ? relationSpec(movement.flavors) : relationSpec(movement.products),
      movementType: movement.movement_type as InventoryMovementType,
      movementLabel: movementLabels[movement.movement_type as InventoryMovementType],
      quantity: movement.quantity,
      countedQuantity: movement.counted_quantity,
      note: movement.note,
      createdById: movement.created_by,
      createdByName: relationDisplayName(movement.created_profile),
      createdAt: movement.created_at,
      updatedByName: relationDisplayName(movement.updated_profile),
      updatedAt: movement.updated_at,
      reviewedByName: relationDisplayName(movement.reviewed_profile),
      reviewedAt: movement.reviewed_at
    };
  });

  return NextResponse.json({
    ok: true,
    data: {
      movements,
      summary: buildInventorySummary(movements),
      source: "supabase"
    }
  });
}

export async function POST(request: Request) {
  const guard = await requireRole();

  if (guard.failure) return guard.failure;

  const input = (await request.json()) as CreateInventoryMovementInput;
  const createdBy =
    guard.profile?.id ?? input.createdBy ?? process.env.DEMO_CASHIER_ID ?? defaultStaffId;

  // 批次進貨:一次寫入多個品項(僅進貨用)
  if (input.items && input.items.length > 0) {
    if (!input.counterId) {
      return NextResponse.json({ ok: false, error: "缺少櫃位" }, { status: 400 });
    }

    const rows = input.items
      .map((item) => ({
        productId: item.productId ?? null,
        flavorId: item.flavorId ?? null,
        quantity: Math.floor(Number(item.quantity))
      }))
      .filter((item) => item.quantity > 0);

    if (rows.length === 0) {
      return NextResponse.json(
        { ok: false, error: "請至少輸入一個品項的進貨數量" },
        { status: 400 }
      );
    }

    for (const row of rows) {
      if (Boolean(row.productId) === Boolean(row.flavorId)) {
        return NextResponse.json(
          { ok: false, error: "品項必須是袋裝商品或禮盒口味其中一種" },
          { status: 400 }
        );
      }
    }

    if (!hasSupabaseAdminEnv()) {
      return NextResponse.json({
        ok: true,
        data: { movementCount: rows.length, source: "demo" }
      });
    }

    const supabase = createSupabaseAdminClient();
    const { error } = await supabase.from("inventory_movements").insert(
      rows.map((row) => ({
        counter_id: input.counterId,
        product_id: row.productId,
        flavor_id: row.flavorId,
        movement_type: "purchase",
        quantity: row.quantity,
        note: input.note?.trim() || null,
        created_by: createdBy
      }))
    );

    if (error) {
      return NextResponse.json({ ok: false, error: error.message }, { status: 400 });
    }

    return NextResponse.json({
      ok: true,
      data: { movementCount: rows.length, source: "supabase" }
    });
  }

  const validation = validateInventoryInput(input);

  if (!validation.ok) {
    return NextResponse.json(validation, { status: 400 });
  }

  if (!hasSupabaseAdminEnv()) {
    return NextResponse.json({
      ok: true,
      data: {
        movementId: crypto.randomUUID(),
        source: "demo"
      }
    });
  }

  const supabase = createSupabaseAdminClient();
  const normalizedQuantity = normalizeQuantity(input.movementType, input.quantity);

  const { data, error } = await supabase
    .from("inventory_movements")
    .insert({
      counter_id: input.counterId,
      product_id: input.productId ?? null,
      flavor_id: input.flavorId ?? null,
      movement_type: input.movementType,
      quantity: normalizedQuantity,
      counted_quantity: input.countedQuantity ?? null,
      note: input.note?.trim() || null,
      created_by: createdBy
    })
    .select("id")
    .single();

  if (error) {
    return NextResponse.json({ ok: false, error: error.message }, { status: 400 });
  }

  return NextResponse.json({
    ok: true,
    data: {
      movementId: data.id,
      source: "supabase"
    }
  });
}

export async function PATCH(request: Request) {
  const guard = await requireRole();

  if (guard.failure) return guard.failure;

  const input = (await request.json()) as UpdateInventoryMovementInput;

  if (!input.movementId) {
    return NextResponse.json({ ok: false, error: "缺少異動紀錄" }, { status: 400 });
  }

  if (!hasSupabaseAdminEnv()) {
    return NextResponse.json({
      ok: true,
      data: { movementId: input.movementId, source: "demo" }
    });
  }

  const supabase = createSupabaseAdminClient();

  if (input.action === "review") {
    if (guard.profile && guard.profile.role !== "manager") {
      return NextResponse.json({ ok: false, error: "需要店長權限" }, { status: 403 });
    }

    const { data, error } = await supabase
      .from("inventory_movements")
      .update({
        reviewed_by: guard.profile?.id ?? null,
        reviewed_at: new Date().toISOString()
      })
      .eq("id", input.movementId)
      .select("id")
      .single();

    if (error) {
      return NextResponse.json({ ok: false, error: error.message }, { status: 400 });
    }

    return NextResponse.json({
      ok: true,
      data: { movementId: data.id, source: "supabase" }
    });
  }

  const permission = await checkMovementPermission(supabase, input.movementId, guard.profile);

  if (!permission.ok) {
    return NextResponse.json({ ok: false, error: permission.error }, { status: permission.status });
  }

  if (!input.movementType) {
    return NextResponse.json({ ok: false, error: "缺少異動類型" }, { status: 400 });
  }

  if (!Number.isFinite(Number(input.quantity))) {
    return NextResponse.json({ ok: false, error: "異動數量必須是數字" }, { status: 400 });
  }

  if (countTypes.has(input.movementType) && !Number.isFinite(Number(input.countedQuantity))) {
    return NextResponse.json(
      { ok: false, error: "盤點類異動需要填實際盤點庫存" },
      { status: 400 }
    );
  }

  if (noteRequiredTypes.has(input.movementType) && !input.note?.trim()) {
    return NextResponse.json(
      { ok: false, error: "試吃、報廢與調整需要填寫原因 / 備註" },
      { status: 400 }
    );
  }

  const { data, error } = await supabase
    .from("inventory_movements")
    .update({
      movement_type: input.movementType,
      quantity: normalizeQuantity(input.movementType, Number(input.quantity)),
      counted_quantity: input.countedQuantity ?? null,
      note: input.note?.trim() || null,
      updated_by: guard.profile?.id ?? null,
      updated_at: new Date().toISOString()
    })
    .eq("id", input.movementId)
    .select("id")
    .single();

  if (error) {
    return NextResponse.json({ ok: false, error: error.message }, { status: 400 });
  }

  return NextResponse.json({
    ok: true,
    data: { movementId: data.id, source: "supabase" }
  });
}

export async function DELETE(request: Request) {
  const guard = await requireRole();

  if (guard.failure) return guard.failure;

  const input = (await request.json()) as { movementId?: string };

  if (!input.movementId) {
    return NextResponse.json({ ok: false, error: "缺少異動紀錄" }, { status: 400 });
  }

  if (!hasSupabaseAdminEnv()) {
    return NextResponse.json({
      ok: true,
      data: { movementId: input.movementId, source: "demo" }
    });
  }

  const supabase = createSupabaseAdminClient();
  const permission = await checkMovementPermission(supabase, input.movementId, guard.profile);

  if (!permission.ok) {
    return NextResponse.json({ ok: false, error: permission.error }, { status: permission.status });
  }

  const { error } = await supabase
    .from("inventory_movements")
    .delete()
    .eq("id", input.movementId);

  if (error) {
    return NextResponse.json({ ok: false, error: error.message }, { status: 400 });
  }

  return NextResponse.json({
    ok: true,
    data: { movementId: input.movementId, source: "supabase" }
  });
}

async function checkMovementPermission(
  supabase: ReturnType<typeof createSupabaseAdminClient>,
  movementId: string,
  profile: { id: string; role: "staff" | "manager" } | null
) {
  const { data: movement, error } = await supabase
    .from("inventory_movements")
    .select("id, created_by")
    .eq("id", movementId)
    .single();

  if (error || !movement) {
    return { ok: false as const, error: "找不到異動紀錄", status: 404 };
  }

  if (profile && profile.role !== "manager" && movement.created_by !== profile.id) {
    return { ok: false as const, error: "只能修改自己建立的紀錄", status: 403 };
  }

  return { ok: true as const, status: 200 };
}

function validateInventoryInput(input: CreateInventoryMovementInput) {
  if (!input.counterId) return { ok: false as const, error: "缺少櫃位" };

  const hasProduct = Boolean(input.productId);
  const hasFlavor = Boolean(input.flavorId);

  if (hasProduct === hasFlavor) {
    return { ok: false as const, error: "品項必須是袋裝商品或禮盒口味其中一種" };
  }

  if (!input.movementType) return { ok: false as const, error: "缺少異動類型" };
  if (!Number.isFinite(Number(input.quantity))) {
    return { ok: false as const, error: "異動數量必須是數字" };
  }
  if (countTypes.has(input.movementType) && !Number.isFinite(Number(input.countedQuantity))) {
    return { ok: false as const, error: "盤點類異動需要填實際盤點庫存" };
  }
  if (noteRequiredTypes.has(input.movementType) && !input.note?.trim()) {
    return { ok: false as const, error: "試吃、報廢與調整需要填寫原因 / 備註" };
  }

  return { ok: true as const };
}

function normalizeQuantity(type: InventoryMovementType, quantity: number) {
  if (countTypes.has(type)) return 0;
  if (deductionTypes.has(type)) return -Math.abs(Number(quantity));
  return Math.abs(Number(quantity));
}

function buildInventorySummary(
  movements: Array<{
    counterId: string;
    counterName: string;
    itemKey: string;
    productId: string | null;
    flavorId: string | null;
    itemName: string;
    itemSpec: string;
    quantity: number;
    countedQuantity: number | null;
  }>
) {
  const sorted = [...movements].reverse();
  const summary = new Map<
    string,
    {
      counterId: string;
      counterName: string;
      itemKey: string;
      productId: string | null;
      flavorId: string | null;
      itemName: string;
      itemSpec: string;
      stock: number;
    }
  >();

  for (const movement of sorted) {
    const key = `${movement.counterId}-${movement.itemKey}`;
    const current =
      summary.get(key) ??
      {
        counterId: movement.counterId,
        counterName: movement.counterName,
        itemKey: movement.itemKey,
        productId: movement.productId,
        flavorId: movement.flavorId,
        itemName: movement.itemName,
        itemSpec: movement.itemSpec,
        stock: 0
      };

    summary.set(key, {
      ...current,
      stock: movement.countedQuantity ?? current.stock + movement.quantity
    });
  }

  return Array.from(summary.values()).sort((left, right) =>
    `${left.counterName}${left.itemName}`.localeCompare(`${right.counterName}${right.itemName}`)
  );
}

function relationName(value: unknown) {
  if (Array.isArray(value)) return value[0]?.name ?? "";
  if (value && typeof value === "object" && "name" in value) return String(value.name);
  return "";
}

function relationSpec(value: unknown) {
  if (Array.isArray(value)) return value[0]?.spec ?? "";
  if (value && typeof value === "object" && "spec" in value) return String(value.spec);
  return "";
}
