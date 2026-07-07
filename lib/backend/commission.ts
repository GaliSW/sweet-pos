import type { createSupabaseAdminClient } from "@/lib/db/server";
import { defaultCommissionTiers, type CommissionTier } from "@/lib/domain/pos-rules";

export async function fetchCommissionTiers(
  supabase: ReturnType<typeof createSupabaseAdminClient>
): Promise<CommissionTier[]> {
  const { data, error } = await supabase
    .from("commission_tiers")
    .select("min_daily_sales, rate")
    .order("min_daily_sales");

  if (error || !data || data.length === 0) {
    return defaultCommissionTiers;
  }

  return data.map((tier) => ({
    minDailySales: Number(tier.min_daily_sales),
    rate: Number(tier.rate)
  }));
}
