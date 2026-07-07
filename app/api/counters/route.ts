import { NextResponse } from "next/server";
import type { UpsertCounterInput } from "@/lib/backend/api-types";
import {
  monthRange,
  roundCurrency,
  taipeiDate,
  taipeiDayStart
} from "@/lib/backend/query-helpers";
import { requireRole } from "@/lib/auth/guards";
import { createSupabaseAdminClient, hasSupabaseAdminEnv } from "@/lib/db/server";
import { counters as sampleCounters } from "@/lib/domain/sample-data";

export async function GET(request: Request) {
  const guard = await requireRole("manager");

  if (guard.failure) return guard.failure;

  const { searchParams } = new URL(request.url);
  const month = searchParams.get("month") ?? taipeiDate(new Date().toISOString()).slice(0, 7);

  if (!/^\d{4}-\d{2}$/.test(month)) {
    return NextResponse.json({ ok: false, error: "月份格式必須是 YYYY-MM" }, { status: 400 });
  }

  if (!hasSupabaseAdminEnv()) {
    return NextResponse.json({
      ok: true,
      data: {
        month,
        counters: sampleCounters.map((counter, index) => ({
          id: counter.id,
          name: counter.name,
          location: counter.location,
          isActive: true,
          targetAmount: index === 0 ? 500000 : 420000,
          achievedAmount: index === 0 ? 380000 : 268800,
          achievementRate: index === 0 ? 0.76 : 0.64
        })),
        source: "demo"
      }
    });
  }

  const supabase = createSupabaseAdminClient();
  const [startDate, endDate] = monthRange(month);

  const [countersResult, targetsResult, ordersResult] = await Promise.all([
    supabase.from("counters").select("*").order("name"),
    supabase
      .from("counter_monthly_targets")
      .select("counter_id, target_amount")
      .eq("month", `${month}-01`),
    supabase
      .from("orders")
      .select("counter_id, received_amount")
      .eq("status", "completed")
      .gte("created_at", taipeiDayStart(startDate))
      .lt("created_at", taipeiDayStart(endDate))
  ]);

  const error = countersResult.error ?? targetsResult.error ?? ordersResult.error;

  if (error) {
    return NextResponse.json({ ok: false, error: error.message }, { status: 500 });
  }

  const targetByCounter = new Map(
    (targetsResult.data ?? []).map((target) => [
      target.counter_id as string,
      Number(target.target_amount)
    ])
  );

  const achievedByCounter = new Map<string, number>();

  for (const order of ordersResult.data ?? []) {
    const key = order.counter_id as string;
    achievedByCounter.set(
      key,
      roundCurrency((achievedByCounter.get(key) ?? 0) + Number(order.received_amount))
    );
  }

  return NextResponse.json({
    ok: true,
    data: {
      month,
      counters: (countersResult.data ?? []).map((counter) => {
        const targetAmount = targetByCounter.get(counter.id as string) ?? 0;
        const achievedAmount = achievedByCounter.get(counter.id as string) ?? 0;

        return {
          id: counter.id,
          name: counter.name,
          location: counter.location,
          isActive: counter.is_active,
          targetAmount,
          achievedAmount,
          achievementRate: targetAmount > 0 ? roundCurrency(achievedAmount / targetAmount) : 0
        };
      }),
      source: "supabase"
    }
  });
}

export async function POST(request: Request) {
  const guard = await requireRole("manager");

  if (guard.failure) return guard.failure;

  const input = (await request.json()) as UpsertCounterInput;
  const validation = validateCounterInput(input);

  if (!validation.ok) {
    return NextResponse.json(validation, { status: 400 });
  }

  if (!hasSupabaseAdminEnv()) {
    return NextResponse.json({
      ok: true,
      data: { counterId: crypto.randomUUID(), source: "demo" }
    });
  }

  const supabase = createSupabaseAdminClient();
  const { data, error } = await supabase
    .from("counters")
    .insert({
      name: input.name.trim(),
      location: input.location?.trim() || null,
      is_active: input.isActive ?? true
    })
    .select("id")
    .single();

  if (error) {
    return NextResponse.json({ ok: false, error: error.message }, { status: 400 });
  }

  const targetError = await upsertMonthlyTarget(supabase, data.id, input);

  if (targetError) {
    return NextResponse.json({ ok: false, error: targetError }, { status: 400 });
  }

  return NextResponse.json({
    ok: true,
    data: { counterId: data.id, source: "supabase" }
  });
}

export async function PATCH(request: Request) {
  const guard = await requireRole("manager");

  if (guard.failure) return guard.failure;

  const input = (await request.json()) as UpsertCounterInput;

  if (!input.id) {
    return NextResponse.json({ ok: false, error: "缺少櫃位編號" }, { status: 400 });
  }

  const validation = validateCounterInput(input);

  if (!validation.ok) {
    return NextResponse.json(validation, { status: 400 });
  }

  if (!hasSupabaseAdminEnv()) {
    return NextResponse.json({
      ok: true,
      data: { counterId: input.id, source: "demo" }
    });
  }

  const supabase = createSupabaseAdminClient();
  const { data, error } = await supabase
    .from("counters")
    .update({
      name: input.name.trim(),
      location: input.location?.trim() || null,
      is_active: input.isActive ?? true
    })
    .eq("id", input.id)
    .select("id")
    .single();

  if (error) {
    return NextResponse.json({ ok: false, error: error.message }, { status: 400 });
  }

  const targetError = await upsertMonthlyTarget(supabase, data.id, input);

  if (targetError) {
    return NextResponse.json({ ok: false, error: targetError }, { status: 400 });
  }

  return NextResponse.json({
    ok: true,
    data: { counterId: data.id, source: "supabase" }
  });
}

export async function DELETE(request: Request) {
  const guard = await requireRole("manager");

  if (guard.failure) return guard.failure;

  const input = (await request.json()) as { id?: string };

  if (!input.id) {
    return NextResponse.json({ ok: false, error: "缺少櫃位編號" }, { status: 400 });
  }

  if (!hasSupabaseAdminEnv()) {
    return NextResponse.json({
      ok: true,
      data: { counterId: input.id, mode: "deleted", source: "demo" }
    });
  }

  const supabase = createSupabaseAdminClient();
  const [ordersResult, shiftsResult, movementsResult] = await Promise.all([
    supabase.from("orders").select("id", { count: "exact", head: true }).eq("counter_id", input.id),
    supabase.from("shifts").select("id", { count: "exact", head: true }).eq("counter_id", input.id),
    supabase
      .from("inventory_movements")
      .select("id", { count: "exact", head: true })
      .eq("counter_id", input.id)
  ]);

  const countError = ordersResult.error ?? shiftsResult.error ?? movementsResult.error;

  if (countError) {
    return NextResponse.json({ ok: false, error: countError.message }, { status: 500 });
  }

  const referenceCount =
    (ordersResult.count ?? 0) + (shiftsResult.count ?? 0) + (movementsResult.count ?? 0);

  if (referenceCount > 0) {
    const { error } = await supabase
      .from("counters")
      .update({ is_active: false })
      .eq("id", input.id);

    if (error) {
      return NextResponse.json({ ok: false, error: error.message }, { status: 400 });
    }

    return NextResponse.json({
      ok: true,
      data: {
        counterId: input.id,
        mode: "deactivated",
        message: "櫃位已有訂單 / 班表 / 庫存紀錄，已改為停用（保留歷史資料）",
        source: "supabase"
      }
    });
  }

  const { error: targetError } = await supabase
    .from("counter_monthly_targets")
    .delete()
    .eq("counter_id", input.id);

  if (targetError) {
    return NextResponse.json({ ok: false, error: targetError.message }, { status: 400 });
  }

  const { error } = await supabase.from("counters").delete().eq("id", input.id);

  if (error) {
    return NextResponse.json({ ok: false, error: error.message }, { status: 400 });
  }

  return NextResponse.json({
    ok: true,
    data: { counterId: input.id, mode: "deleted", source: "supabase" }
  });
}

async function upsertMonthlyTarget(
  supabase: ReturnType<typeof createSupabaseAdminClient>,
  counterId: string,
  input: UpsertCounterInput
) {
  if (!input.monthlyTarget) return null;

  const { error } = await supabase.from("counter_monthly_targets").upsert(
    {
      counter_id: counterId,
      month: `${input.monthlyTarget.month}-01`,
      target_amount: input.monthlyTarget.targetAmount
    },
    { onConflict: "counter_id,month" }
  );

  return error?.message ?? null;
}

function validateCounterInput(input: UpsertCounterInput) {
  if (!input.name?.trim()) return { ok: false as const, error: "缺少櫃位名稱" };

  if (input.monthlyTarget) {
    if (!/^\d{4}-\d{2}$/.test(input.monthlyTarget.month)) {
      return { ok: false as const, error: "目標月份格式必須是 YYYY-MM" };
    }
    if (
      !Number.isFinite(Number(input.monthlyTarget.targetAmount)) ||
      Number(input.monthlyTarget.targetAmount) <= 0
    ) {
      return { ok: false as const, error: "月目標金額必須大於 0" };
    }
  }

  return { ok: true as const };
}
