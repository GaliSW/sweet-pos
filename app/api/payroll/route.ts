import { NextResponse } from "next/server";
import type { PayrollRow } from "@/lib/backend/api-types";
import {
  monthRange,
  shiftDurationHours,
  taipeiDate,
  taipeiDayStart
} from "@/lib/backend/query-helpers";
import { requireRole } from "@/lib/auth/guards";
import { fetchCommissionTierSets, resolveTiers } from "@/lib/backend/commission";
import { createSupabaseAdminClient, hasSupabaseAdminEnv } from "@/lib/db/server";
import { calculateBasePay, calculateCommissionByTiers } from "@/lib/domain/pos-rules";

export async function GET(request: Request) {
  const guard = await requireRole("manager");

  if (guard.failure) return guard.failure;

  const { searchParams } = new URL(request.url);
  const month = searchParams.get("month") ?? taipeiDate(new Date().toISOString()).slice(0, 7);
  const counterId = searchParams.get("counterId");

  if (!/^\d{4}-\d{2}$/.test(month)) {
    return NextResponse.json({ ok: false, error: "月份格式必須是 YYYY-MM" }, { status: 400 });
  }

  if (!hasSupabaseAdminEnv()) {
    return NextResponse.json({
      ok: true,
      data: {
        month,
        payroll: buildDemoPayroll(),
        source: "demo"
      }
    });
  }

  const supabase = createSupabaseAdminClient();
  const [startDate, endDate] = monthRange(month);

  let shiftsQuery = supabase
    .from("shifts")
    .select("staff_id, counter_id, starts_at, ends_at")
    .gte("shift_date", startDate)
    .lt("shift_date", endDate);

  let ordersQuery = supabase
    .from("orders")
    .select("seller_id, seller2_id, counter_id, received_amount, created_at")
    .eq("status", "completed")
    .gte("created_at", taipeiDayStart(startDate))
    .lt("created_at", taipeiDayStart(endDate));

  if (counterId) {
    shiftsQuery = shiftsQuery.eq("counter_id", counterId);
    ordersQuery = ordersQuery.eq("counter_id", counterId);
  }

  const [shiftsResult, ordersResult, profilesResult, tierSets] = await Promise.all([
    shiftsQuery,
    ordersQuery,
    supabase
      .from("profiles")
      .select("id, display_name, salary_type, hourly_wage, monthly_salary, commission_mode, is_active")
      .eq("role", "staff"),
    fetchCommissionTierSets(supabase)
  ]);

  const error = shiftsResult.error ?? ordersResult.error ?? profilesResult.error;

  if (error) {
    return NextResponse.json({ ok: false, error: error.message }, { status: 500 });
  }

  const profileById = new Map(
    (profilesResult.data ?? []).map((profile) => [
      profile.id as string,
      {
        name: profile.display_name as string,
        salaryType: (profile.salary_type as "hourly" | "monthly") ?? "hourly",
        hourlyWage: Number(profile.hourly_wage),
        monthlySalary: Number(profile.monthly_salary ?? 0),
        commissionMode: (profile.commission_mode as "daily" | "monthly") ?? "daily",
        isActive: Boolean(profile.is_active)
      }
    ])
  );

  const rows = new Map<string, PayrollRow>();

  function rowFor(staffId: string): PayrollRow {
    const existing = rows.get(staffId);

    if (existing) return existing;

    const profile = profileById.get(staffId);
    const row: PayrollRow = {
      staffId,
      staffName: profile?.name ?? "未命名員工",
      salaryType: profile?.salaryType ?? "hourly",
      hourlyWage: profile?.hourlyWage ?? 0,
      monthlySalary: profile?.monthlySalary ?? 0,
      shiftCount: 0,
      scheduledHours: 0,
      basePay: 0,
      commission: 0,
      estimatedTotal: 0
    };

    rows.set(staffId, row);
    return row;
  }

  // 在職月薪員工即使當月沒有排班或業績，也必須列入薪資試算。
  for (const [staffId, profile] of profileById) {
    if (profile.salaryType === "monthly" && profile.isActive) rowFor(staffId);
  }

  for (const shift of shiftsResult.data ?? []) {
    // 店長也能排班,但薪資試算只列員工
    if (!profileById.has(shift.staff_id as string)) continue;

    const row = rowFor(shift.staff_id as string);
    row.shiftCount += 1;
    row.scheduledHours += shiftDurationHours(shift.starts_at, shift.ends_at);
  }

  const sellerDayReceived = new Map<string, number>();
  const sellerMonthReceived = new Map<string, number>();

  for (const order of ordersResult.data ?? []) {
    // 共班訂單掛兩位銷售,實收金額均分計入各自的日業績
    const sellerIds = [order.seller_id, order.seller2_id].filter(Boolean) as string[];
    const share = Number(order.received_amount) / sellerIds.length;
    const date = taipeiDate(order.created_at);

    for (const sellerId of sellerIds) {
      const key = `${date}|${sellerId}`;
      sellerDayReceived.set(key, (sellerDayReceived.get(key) ?? 0) + share);
      sellerMonthReceived.set(sellerId, (sellerMonthReceived.get(sellerId) ?? 0) + share);
    }
  }

  // 日結:逐日套級距加總;月結:月總實收套級距一次計算
  for (const [key, received] of sellerDayReceived) {
    const staffId = key.split("|")[1];
    const profile = profileById.get(staffId);

    if (!profile || profile.commissionMode === "monthly") continue;

    const row = rowFor(staffId);
    row.commission += calculateCommissionByTiers(received, resolveTiers(tierSets, staffId));
  }

  for (const [staffId, received] of sellerMonthReceived) {
    if (profileById.get(staffId)?.commissionMode !== "monthly") continue;

    const row = rowFor(staffId);
    row.commission = calculateCommissionByTiers(received, resolveTiers(tierSets, staffId));
  }

  const payroll = Array.from(rows.values())
    .map((row) => {
      const scheduledHours = Number(row.scheduledHours.toFixed(1));
      const basePay = calculateBasePay({
        salaryType: row.salaryType,
        scheduledHours,
        hourlyWage: row.hourlyWage,
        monthlySalary: row.monthlySalary
      });

      return {
        ...row,
        scheduledHours,
        basePay,
        estimatedTotal: basePay + row.commission
      };
    })
    .sort((left, right) => left.staffName.localeCompare(right.staffName));

  return NextResponse.json({
    ok: true,
    data: {
      month,
      payroll,
      source: "supabase"
    }
  });
}

function buildDemoPayroll(): PayrollRow[] {
  return [
    {
      staffId: "00000000-0000-4000-8000-000000000001",
      staffName: "林小芸",
      salaryType: "monthly",
      hourlyWage: 190,
      monthlySalary: 36000,
      shiftCount: 12,
      scheduledHours: 72,
      basePay: 36000,
      commission: 1830,
      estimatedTotal: 37830
    },
    {
      staffId: "00000000-0000-4000-8000-000000000002",
      staffName: "陳柏宇",
      salaryType: "hourly",
      hourlyWage: 190,
      monthlySalary: 0,
      shiftCount: 11,
      scheduledHours: 66,
      basePay: 12540,
      commission: 1210,
      estimatedTotal: 13750
    },
    {
      staffId: "00000000-0000-4000-8000-000000000003",
      staffName: "黃品安",
      salaryType: "hourly",
      hourlyWage: 200,
      monthlySalary: 0,
      shiftCount: 12,
      scheduledHours: 72,
      basePay: 14400,
      commission: 1560,
      estimatedTotal: 15960
    }
  ];
}
