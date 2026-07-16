import type { createSupabaseAdminClient } from "@/lib/db/server";
import { defaultCommissionTiers, type CommissionTier } from "@/lib/domain/pos-rules";

export type CommissionTierSets = {
  global: CommissionTier[];
  byStaff: Map<string, CommissionTier[]>;
};

// 全域級距 + 個人覆寫(staff_id null = 全域)。個人沒設定時套全域。
export async function fetchCommissionTierSets(
  supabase: ReturnType<typeof createSupabaseAdminClient>
): Promise<CommissionTierSets> {
  const { data, error } = await supabase
    .from("commission_tiers")
    .select("staff_id, min_daily_sales, rate")
    .order("min_daily_sales");

  if (error || !data) {
    return { global: defaultCommissionTiers, byStaff: new Map() };
  }

  const global: CommissionTier[] = [];
  const byStaff = new Map<string, CommissionTier[]>();

  for (const row of data) {
    const tier = { minDailySales: Number(row.min_daily_sales), rate: Number(row.rate) };

    if (!row.staff_id) {
      global.push(tier);
      continue;
    }

    const staffId = String(row.staff_id);
    const tiers = byStaff.get(staffId) ?? [];
    tiers.push(tier);
    byStaff.set(staffId, tiers);
  }

  return { global: global.length > 0 ? global : defaultCommissionTiers, byStaff };
}

export function resolveTiers(sets: CommissionTierSets, staffId: string): CommissionTier[] {
  return sets.byStaff.get(staffId) ?? sets.global;
}

export async function fetchCommissionTiers(
  supabase: ReturnType<typeof createSupabaseAdminClient>
): Promise<CommissionTier[]> {
  const sets = await fetchCommissionTierSets(supabase);
  return sets.global;
}
