import { NextResponse } from "next/server";
import { getSessionProfile, hasAuthEnv } from "@/lib/auth/session";
import { relationName, taipeiDate, timeToMinutes } from "@/lib/backend/query-helpers";
import { createSupabaseAdminClient } from "@/lib/db/server";

export async function GET() {
  if (!hasAuthEnv()) {
    return NextResponse.json({
      ok: true,
      data: {
        id: "00000000-0000-4000-8000-000000000001",
        displayName: "示範帳號",
        role: "manager",
        source: "demo"
      }
    });
  }

  const profile = await getSessionProfile();

  if (!profile) {
    return NextResponse.json({ ok: false, error: "未登入" }, { status: 401 });
  }

  const supabase = createSupabaseAdminClient();
  const { data: todayShifts } = await supabase
    .from("shifts")
    .select("counter_id, starts_at, ends_at, counters(name)")
    .eq("staff_id", profile.id)
    .eq("shift_date", taipeiDate(new Date().toISOString()))
    .eq("published", true)
    .order("starts_at");

  // 優先取「現在時間所在班段」的班次,無則退回當日最早班次
  const nowMinutes = timeToMinutes(
    new Date().toLocaleTimeString("en-GB", { timeZone: "Asia/Taipei", hour12: false })
  );
  const currentShift = (todayShifts ?? []).find((shift) => {
    const start = timeToMinutes(String(shift.starts_at));
    const end = timeToMinutes(String(shift.ends_at));

    return end >= start
      ? nowMinutes >= start && nowMinutes < end
      : nowMinutes >= start || nowMinutes < end;
  });
  const todayShift = currentShift ?? (todayShifts ?? [])[0] ?? null;

  return NextResponse.json({
    ok: true,
    data: {
      ...profile,
      todayCounterId: todayShift?.counter_id ?? null,
      todayCounterName: todayShift ? relationName(todayShift.counters) : null,
      source: "supabase"
    }
  });
}
