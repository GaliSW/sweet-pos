import { NextResponse } from "next/server";
import type { ShiftCode, UpsertShiftInput } from "@/lib/backend/api-types";
import { requireRole } from "@/lib/auth/guards";
import { createSupabaseAdminClient, hasSupabaseAdminEnv } from "@/lib/db/server";
import { staffShifts } from "@/lib/domain/sample-data";

const shiftLabels: Record<ShiftCode, string> = {
  morning: "早班",
  evening: "晚班"
};

export async function GET(request: Request) {
  const guard = await requireRole();

  if (guard.failure) return guard.failure;

  const { searchParams } = new URL(request.url);
  const isStaff = guard.profile?.role === "staff";
  const staffId = isStaff ? guard.profile?.id ?? null : searchParams.get("staffId");
  const counterId = searchParams.get("counterId");
  const month = searchParams.get("month") ?? new Date().toISOString().slice(0, 7);
  const [startDate, endDate] = monthRange(month);

  if (!hasSupabaseAdminEnv()) {
    return NextResponse.json({
      ok: true,
      data: {
        shifts: staffShifts,
        source: "demo"
      }
    });
  }

  const supabase = createSupabaseAdminClient();
  let query = supabase
    .from("shifts")
    .select("id, counter_id, staff_id, shift_date, shift_code, starts_at, ends_at, published, counters(name), profiles(display_name)")
    .gte("shift_date", startDate)
    .lt("shift_date", endDate)
    .order("shift_date", { ascending: true })
    .order("starts_at", { ascending: true });

  if (staffId) query = query.eq("staff_id", staffId);
  if (counterId) query = query.eq("counter_id", counterId);
  if (isStaff) query = query.eq("published", true);

  const { data, error } = await query;

  if (error) {
    return NextResponse.json({ ok: false, error: error.message }, { status: 500 });
  }

  return NextResponse.json({
    ok: true,
    data: {
      shifts: (data ?? []).map((shift) => ({
        id: shift.id,
        counterId: shift.counter_id,
        counterName: relationName(shift.counters),
        staffId: shift.staff_id,
        staffName: relationDisplayName(shift.profiles),
        shiftDate: shift.shift_date,
        shiftCode: shift.shift_code as ShiftCode,
        shiftLabel: shiftLabels[shift.shift_code as ShiftCode],
        startsAt: trimSeconds(shift.starts_at),
        endsAt: trimSeconds(shift.ends_at),
        published: shift.published
      })),
      source: "supabase"
    }
  });
}

export async function POST(request: Request) {
  const guard = await requireRole("manager");

  if (guard.failure) return guard.failure;

  const input = (await request.json()) as UpsertShiftInput;
  const validation = validateShiftInput(input);

  if (!validation.ok) {
    return NextResponse.json(validation, { status: 400 });
  }

  if (!hasSupabaseAdminEnv()) {
    return NextResponse.json({
      ok: true,
      data: {
        shiftId: crypto.randomUUID(),
        source: "demo"
      }
    });
  }

  const supabase = createSupabaseAdminClient();

  if (!input.staffId) {
    const { error } = await supabase
      .from("shifts")
      .delete()
      .match({
        counter_id: input.counterId,
        shift_date: input.shiftDate,
        shift_code: input.shiftCode
      });

    if (error) {
      return NextResponse.json({ ok: false, error: error.message }, { status: 400 });
    }

    return NextResponse.json({
      ok: true,
      data: {
        shiftId: null,
        source: "supabase"
      }
    });
  }

  const { data, error } = await supabase
    .from("shifts")
    .upsert(
      {
        counter_id: input.counterId,
        staff_id: input.staffId,
        shift_date: input.shiftDate,
        shift_code: input.shiftCode,
        starts_at: input.startsAt,
        ends_at: input.endsAt,
        published: input.published ?? false
      },
      {
        onConflict: "counter_id,shift_date,shift_code"
      }
    )
    .select("id")
    .single();

  if (error) {
    return NextResponse.json({ ok: false, error: error.message }, { status: 400 });
  }

  return NextResponse.json({
    ok: true,
    data: {
      shiftId: data.id,
      source: "supabase"
    }
  });
}

function validateShiftInput(input: UpsertShiftInput) {
  if (!input.counterId) return { ok: false as const, error: "缺少櫃位" };
  if (!input.shiftDate) return { ok: false as const, error: "缺少日期" };
  if (!input.shiftCode) return { ok: false as const, error: "缺少班別" };
  if (!input.startsAt || !input.endsAt) return { ok: false as const, error: "缺少上下班時間" };
  if (input.startsAt === input.endsAt) {
    return { ok: false as const, error: "上下班時間不能相同" };
  }

  return { ok: true as const };
}

function monthRange(month: string) {
  const [year, monthIndex] = month.split("-").map(Number);
  const start = new Date(Date.UTC(year, monthIndex - 1, 1));
  const end = new Date(Date.UTC(year, monthIndex, 1));

  return [start.toISOString().slice(0, 10), end.toISOString().slice(0, 10)] as const;
}

function trimSeconds(time: string) {
  return time.slice(0, 5);
}

function relationName(value: unknown) {
  if (Array.isArray(value)) return value[0]?.name ?? "";
  if (value && typeof value === "object" && "name" in value) return String(value.name);
  return "";
}

function relationDisplayName(value: unknown) {
  if (Array.isArray(value)) return value[0]?.display_name ?? "";
  if (value && typeof value === "object" && "display_name" in value) {
    return String(value.display_name);
  }
  return "";
}
