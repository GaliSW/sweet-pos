import { NextResponse } from "next/server";
import type { PublishShiftsInput } from "@/lib/backend/api-types";
import { requireRole } from "@/lib/auth/guards";
import { monthRange } from "@/lib/backend/query-helpers";
import { createSupabaseAdminClient, hasSupabaseAdminEnv } from "@/lib/db/server";
import { detectShiftConflicts } from "@/lib/domain/pos-rules";

export async function POST(request: Request) {
  const guard = await requireRole("manager");

  if (guard.failure) return guard.failure;

  const input = (await request.json()) as PublishShiftsInput;

  if (!input.month || !/^\d{4}-\d{2}$/.test(input.month)) {
    return NextResponse.json({ ok: false, error: "月份格式必須是 YYYY-MM" }, { status: 400 });
  }

  if (!hasSupabaseAdminEnv()) {
    return NextResponse.json({
      ok: true,
      data: {
        publishedCount: 0,
        conflicts: [],
        source: "demo"
      }
    });
  }

  const supabase = createSupabaseAdminClient();
  const [startDate, endDate] = monthRange(input.month);

  const { data: shifts, error } = await supabase
    .from("shifts")
    .select("id, counter_id, staff_id, shift_date, shift_code, starts_at, ends_at, published")
    .gte("shift_date", startDate)
    .lt("shift_date", endDate);

  if (error) {
    return NextResponse.json({ ok: false, error: error.message }, { status: 500 });
  }

  const conflicts = detectShiftConflicts(
    (shifts ?? []).map((shift) => ({
      id: shift.id as string,
      staffId: shift.staff_id as string,
      counterId: shift.counter_id as string,
      date: shift.shift_date as string,
      shiftCode: shift.shift_code as string,
      startsAt: shift.starts_at as string,
      endsAt: shift.ends_at as string
    }))
  );

  if (conflicts.length > 0) {
    return NextResponse.json(
      { ok: false, error: "班表有衝突,請先修正再發布", conflicts },
      { status: 400 }
    );
  }

  const targetIds = (shifts ?? [])
    .filter((shift) => !shift.published)
    .filter((shift) => !input.counterId || shift.counter_id === input.counterId)
    .map((shift) => shift.id as string);

  if (targetIds.length > 0) {
    const { error: updateError } = await supabase
      .from("shifts")
      .update({ published: true })
      .in("id", targetIds);

    if (updateError) {
      return NextResponse.json({ ok: false, error: updateError.message }, { status: 400 });
    }
  }

  return NextResponse.json({
    ok: true,
    data: {
      publishedCount: targetIds.length,
      conflicts: [],
      source: "supabase"
    }
  });
}
