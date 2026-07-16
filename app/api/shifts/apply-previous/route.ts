import { NextResponse } from "next/server";
import type { ApplyPreviousScheduleInput } from "@/lib/backend/api-types";
import { requireRole } from "@/lib/auth/guards";
import { monthRange, previousMonth } from "@/lib/backend/query-helpers";
import { createSupabaseAdminClient, hasSupabaseAdminEnv } from "@/lib/db/server";

export async function POST(request: Request) {
  const guard = await requireRole("manager");

  if (guard.failure) return guard.failure;

  const input = (await request.json()) as ApplyPreviousScheduleInput;

  if (!input.counterId) {
    return NextResponse.json({ ok: false, error: "缺少櫃位" }, { status: 400 });
  }

  if (!input.month || !/^\d{4}-\d{2}$/.test(input.month)) {
    return NextResponse.json({ ok: false, error: "月份格式必須是 YYYY-MM" }, { status: 400 });
  }

  if (!hasSupabaseAdminEnv()) {
    return NextResponse.json({
      ok: true,
      data: {
        appliedCount: 0,
        source: "demo"
      }
    });
  }

  const supabase = createSupabaseAdminClient();
  const sourceMonth = previousMonth(input.month);
  const [startDate, endDate] = monthRange(sourceMonth);

  const { data: previousShifts, error } = await supabase
    .from("shifts")
    .select("staff_id, shift_date, shift_code, starts_at, ends_at")
    .eq("counter_id", input.counterId)
    .gte("shift_date", startDate)
    .lt("shift_date", endDate);

  if (error) {
    return NextResponse.json({ ok: false, error: error.message }, { status: 500 });
  }

  const targetDays = daysInMonth(input.month);
  const rows = (previousShifts ?? [])
    .map((shift) => {
      const dayOfMonth = String(shift.shift_date).slice(8, 10);

      if (Number(dayOfMonth) > targetDays) return null;

      return {
        counter_id: input.counterId,
        staff_id: shift.staff_id,
        shift_date: `${input.month}-${dayOfMonth}`,
        shift_code: shift.shift_code,
        starts_at: shift.starts_at,
        ends_at: shift.ends_at,
        published: false
      };
    })
    .filter((row) => row !== null);

  if (rows.length === 0) {
    return NextResponse.json({ ok: false, error: `上月(${sourceMonth})沒有班表可套用` }, { status: 400 });
  }

  const { error: upsertError } = await supabase
    .from("shifts")
    .upsert(rows, { onConflict: "counter_id,shift_date,shift_code,staff_id" });

  if (upsertError) {
    return NextResponse.json({ ok: false, error: upsertError.message }, { status: 400 });
  }

  return NextResponse.json({
    ok: true,
    data: {
      appliedCount: rows.length,
      sourceMonth,
      source: "supabase"
    }
  });
}

function daysInMonth(month: string) {
  const [year, monthIndex] = month.split("-").map(Number);
  return new Date(Date.UTC(year, monthIndex, 0)).getUTCDate();
}
