import { NextResponse } from "next/server";
import { requireRole } from "@/lib/auth/guards";
import { writeAuditLog } from "@/lib/backend/audit";
import { fetchCommissionTierSets } from "@/lib/backend/commission";
import { createSupabaseAdminClient, hasSupabaseAdminEnv } from "@/lib/db/server";
import { defaultCommissionTiers, type CommissionTier } from "@/lib/domain/pos-rules";

export async function GET(request: Request) {
  const guard = await requireRole("manager");

  if (guard.failure) return guard.failure;

  const { searchParams } = new URL(request.url);
  const staffId = searchParams.get("staffId");

  if (!hasSupabaseAdminEnv()) {
    return NextResponse.json({
      ok: true,
      data: { tiers: defaultCommissionTiers, staffId, staffTiers: null, source: "demo" }
    });
  }

  const supabase = createSupabaseAdminClient();
  const sets = await fetchCommissionTierSets(supabase);
  let commissionMode: "daily" | "monthly" = "daily";

  if (staffId) {
    const { data: profile } = await supabase
      .from("profiles")
      .select("commission_mode")
      .eq("id", staffId)
      .maybeSingle();

    commissionMode = (profile?.commission_mode as "daily" | "monthly") ?? "daily";
  }

  return NextResponse.json({
    ok: true,
    data: {
      tiers: sets.global,
      staffId,
      // 個人覆寫級距;null = 未設定(套用全域)
      staffTiers: staffId ? sets.byStaff.get(staffId) ?? null : null,
      commissionMode,
      source: "supabase"
    }
  });
}

export async function PUT(request: Request) {
  const guard = await requireRole("manager");

  if (guard.failure) return guard.failure;

  const input = (await request.json()) as {
    tiers?: CommissionTier[];
    staffId?: string | null;
    commissionMode?: "daily" | "monthly";
  };
  const tiers = input.tiers ?? [];
  const staffId = input.staffId ?? null;

  if (input.commissionMode && !["daily", "monthly"].includes(input.commissionMode)) {
    return NextResponse.json({ ok: false, error: "抽成模式必須是日結或月結" }, { status: 400 });
  }

  // 個人覆寫允許空陣列 = 清除覆寫、回到全域級距;全域至少要有一個級距
  if (!staffId && tiers.length === 0) {
    return NextResponse.json({ ok: false, error: "至少需要一個抽成級距" }, { status: 400 });
  }

  const thresholds = new Set<number>();

  for (const tier of tiers) {
    const minDailySales = Number(tier.minDailySales);
    const rate = Number(tier.rate);

    if (!Number.isFinite(minDailySales) || minDailySales < 0) {
      return NextResponse.json({ ok: false, error: "門檻金額不可為負數" }, { status: 400 });
    }
    if (!Number.isFinite(rate) || rate <= 0 || rate >= 1) {
      return NextResponse.json(
        { ok: false, error: "抽成比例必須介於 0 與 1 之間，例如 2% 填 0.02" },
        { status: 400 }
      );
    }
    if (thresholds.has(minDailySales)) {
      return NextResponse.json({ ok: false, error: "門檻金額不可重複" }, { status: 400 });
    }
    thresholds.add(minDailySales);
  }

  if (!hasSupabaseAdminEnv()) {
    return NextResponse.json({
      ok: true,
      data: { tiers, source: "demo" }
    });
  }

  const supabase = createSupabaseAdminClient();
  const beforeSnapshot = await fetchCommissionSnapshot(supabase, staffId);

  // 個人抽成模式(日結/月結)存在 profiles 上
  if (staffId && input.commissionMode) {
    const { error: modeError } = await supabase
      .from("profiles")
      .update({ commission_mode: input.commissionMode })
      .eq("id", staffId);

    if (modeError) {
      return NextResponse.json({ ok: false, error: modeError.message }, { status: 400 });
    }
  }

  let deleteQuery = supabase.from("commission_tiers").delete();

  deleteQuery = staffId ? deleteQuery.eq("staff_id", staffId) : deleteQuery.is("staff_id", null);

  const { error: deleteError } = await deleteQuery;

  if (deleteError) {
    return NextResponse.json({ ok: false, error: deleteError.message }, { status: 400 });
  }

  if (tiers.length > 0) {
    const { error: insertError } = await supabase.from("commission_tiers").insert(
      tiers.map((tier) => ({
        staff_id: staffId,
        min_daily_sales: Number(tier.minDailySales),
        rate: Number(tier.rate)
      }))
    );

    if (insertError) {
      return NextResponse.json({ ok: false, error: insertError.message }, { status: 400 });
    }
  }

  await writeAuditLog(supabase, {
    actor: guard.profile ?? null,
    action: "update",
    entity: "commission_tiers",
    entityId: staffId ?? "global",
    entityLabel: await fetchCommissionLabel(supabase, staffId),
    before: beforeSnapshot,
    after: await fetchCommissionSnapshot(supabase, staffId)
  });

  const sets = await fetchCommissionTierSets(supabase);

  return NextResponse.json({
    ok: true,
    data: {
      tiers: sets.global,
      staffId,
      staffTiers: staffId ? sets.byStaff.get(staffId) ?? null : null,
      commissionMode: input.commissionMode ?? "daily",
      source: "supabase"
    }
  });
}

// 抽成不是單一資料列,而是一組級距加上該員工的抽成模式。
// 包成物件而非裸陣列,diffRecords() 才能逐欄位比對。
async function fetchCommissionSnapshot(
  supabase: ReturnType<typeof createSupabaseAdminClient>,
  staffId: string | null
) {
  const { data: tierRows } = staffId
    ? await supabase
        .from("commission_tiers")
        .select("min_daily_sales, rate")
        .eq("staff_id", staffId)
        .order("min_daily_sales")
    : await supabase
        .from("commission_tiers")
        .select("min_daily_sales, rate")
        .is("staff_id", null)
        .order("min_daily_sales");

  let commissionMode: string | null = null;

  if (staffId) {
    const { data: profile } = await supabase
      .from("profiles")
      .select("commission_mode")
      .eq("id", staffId)
      .maybeSingle();

    commissionMode = (profile?.commission_mode as string) ?? null;
  }

  return {
    tiers: (tierRows ?? []).map(
      (tier: { min_daily_sales: number | string; rate: number | string }) => ({
        minDailySales: Number(tier.min_daily_sales),
        rate: Number(tier.rate)
      })
    ),
    commissionMode
  };
}

// 個人覆寫顯示員工姓名,全域設定顯示「全域」。
async function fetchCommissionLabel(
  supabase: ReturnType<typeof createSupabaseAdminClient>,
  staffId: string | null
) {
  if (!staffId) return "全域";

  const { data } = await supabase
    .from("profiles")
    .select("display_name")
    .eq("id", staffId)
    .maybeSingle();

  return (data?.display_name as string) ?? staffId;
}
