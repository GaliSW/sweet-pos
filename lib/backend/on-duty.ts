import type { createSupabaseAdminClient } from "@/lib/db/server";
import { relationDisplayName, taipeiDate, timeToMinutes } from "@/lib/backend/query-helpers";

export type OnDutySeller = {
  id: string;
  displayName: string;
};

function taipeiTimeMinutes(at: Date) {
  const time = at.toLocaleTimeString("en-GB", { timeZone: "Asia/Taipei", hour12: false });
  return timeToMinutes(time);
}

function coversNow(startsAt: string, endsAt: string, nowMinutes: number) {
  const start = timeToMinutes(startsAt);
  const end = timeToMinutes(endsAt);

  if (end >= start) return nowMinutes >= start && nowMinutes < end;

  return nowMinutes >= start || nowMinutes < end;
}

// 依台北時間找出此刻在該櫃「已發布班表」的當班人員(最多 2 人,共班)。
export async function getOnDutySellers(
  supabase: ReturnType<typeof createSupabaseAdminClient>,
  counterId: string,
  at: Date = new Date()
): Promise<OnDutySeller[]> {
  const { data, error } = await supabase
    .from("shifts")
    .select("staff_id, starts_at, ends_at, profiles(display_name)")
    .eq("counter_id", counterId)
    .eq("shift_date", taipeiDate(at.toISOString()))
    .eq("published", true)
    .order("starts_at");

  if (error || !data) return [];

  const nowMinutes = taipeiTimeMinutes(at);
  const sellers: OnDutySeller[] = [];

  for (const shift of data) {
    if (!coversNow(String(shift.starts_at), String(shift.ends_at), nowMinutes)) continue;
    if (sellers.some((seller) => seller.id === shift.staff_id)) continue;

    sellers.push({
      id: shift.staff_id as string,
      displayName: relationDisplayName(shift.profiles)
    });
  }

  return sellers.slice(0, 2);
}
