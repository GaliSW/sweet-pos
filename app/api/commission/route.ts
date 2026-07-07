import { NextResponse } from "next/server";
import { requireRole } from "@/lib/auth/guards";
import { fetchCommissionTiers } from "@/lib/backend/commission";
import { createSupabaseAdminClient, hasSupabaseAdminEnv } from "@/lib/db/server";
import { defaultCommissionTiers, type CommissionTier } from "@/lib/domain/pos-rules";

export async function GET() {
  const guard = await requireRole("manager");

  if (guard.failure) return guard.failure;

  if (!hasSupabaseAdminEnv()) {
    return NextResponse.json({
      ok: true,
      data: { tiers: defaultCommissionTiers, source: "demo" }
    });
  }

  const supabase = createSupabaseAdminClient();
  const tiers = await fetchCommissionTiers(supabase);

  return NextResponse.json({
    ok: true,
    data: { tiers, source: "supabase" }
  });
}

export async function PUT(request: Request) {
  const guard = await requireRole("manager");

  if (guard.failure) return guard.failure;

  const input = (await request.json()) as { tiers?: CommissionTier[] };
  const tiers = input.tiers ?? [];

  if (tiers.length === 0) {
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
  const { error: deleteError } = await supabase
    .from("commission_tiers")
    .delete()
    .gte("min_daily_sales", 0);

  if (deleteError) {
    return NextResponse.json({ ok: false, error: deleteError.message }, { status: 400 });
  }

  const { error: insertError } = await supabase.from("commission_tiers").insert(
    tiers.map((tier) => ({
      min_daily_sales: Number(tier.minDailySales),
      rate: Number(tier.rate)
    }))
  );

  if (insertError) {
    return NextResponse.json({ ok: false, error: insertError.message }, { status: 400 });
  }

  return NextResponse.json({
    ok: true,
    data: {
      tiers: await fetchCommissionTiers(supabase),
      source: "supabase"
    }
  });
}
