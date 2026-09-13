import { NextResponse } from "next/server";
import type {
  CounterTargetRow,
  DailyPerformanceRow,
  MonthlyPerformanceRow,
  ReportSummary
} from "@/lib/backend/api-types";
import {
  nextDay,
  relationDisplayName,
  relationName,
  roundCurrency,
  taipeiDate,
  taipeiDayStart
} from "@/lib/backend/query-helpers";
import { requireRole } from "@/lib/auth/guards";
import { fetchCommissionTierSets, resolveTiers } from "@/lib/backend/commission";
import { createSupabaseAdminClient, hasSupabaseAdminEnv } from "@/lib/db/server";
import {
  calculateCommissionByTiers,
  calculateDailyCommission
} from "@/lib/domain/pos-rules";

export async function GET(request: Request) {
  // 店長看全部;一般員工僅回傳自己的業績(不含櫃位目標)。
  const guard = await requireRole();

  if (guard.failure) return guard.failure;

  const isStaff = guard.profile?.role === "staff";
  const { searchParams } = new URL(request.url);
  const today = taipeiDate(new Date().toISOString());
  const from = searchParams.get("from") ?? `${today.slice(0, 7)}-01`;
  const to = searchParams.get("to") ?? today;
  const counterId = searchParams.get("counterId");

  if (!isIsoDate(from) || !isIsoDate(to)) {
    return NextResponse.json({ ok: false, error: "日期格式必須是 YYYY-MM-DD" }, { status: 400 });
  }

  if (from > to) {
    return NextResponse.json({ ok: false, error: "起日不可晚於迄日" }, { status: 400 });
  }

  if (!hasSupabaseAdminEnv()) {
    return NextResponse.json({ ok: true, data: buildDemoReport(to) });
  }

  const supabase = createSupabaseAdminClient();

  // PostgREST 單次最多回 max_rows(正式區為 1000)且不會報錯,超過就靜默截斷。
  // 訂單彙總必須拿到完整資料,所以分頁撈到完為止;排序固定才不會分頁錯位。
  const buildOrdersQuery = () => {
    let query = supabase
      .from("orders")
      .select(
        "id, created_at, seller_id, seller2_id, counter_id, discount_id, sales_amount, bundle_discount_amount, discount_amount, manual_discount_amount, received_amount, seller:profiles!orders_seller_id_fkey(display_name), seller2:profiles!orders_seller2_id_fkey(display_name), counters(name)"
      )
      .eq("status", "completed")
      .gte("created_at", taipeiDayStart(from))
      .lt("created_at", taipeiDayStart(nextDay(to)))
      .order("created_at")
      .order("id");

    if (counterId) {
      query = query.eq("counter_id", counterId);
    }

    if (isStaff && guard.profile) {
      query = query.or(`seller_id.eq.${guard.profile.id},seller2_id.eq.${guard.profile.id}`);
    }

    return query;
  };

  let targetsQuery = supabase
    .from("counter_monthly_targets")
    .select("counter_id, month, target_amount, counters(name)")
    .in(
      "month",
      monthsBetween(from, to).map((month) => `${month}-01`)
    );

  if (counterId) {
    targetsQuery = targetsQuery.eq("counter_id", counterId);
  }

  const [orderRowsResult, targetsResult, tierSets, modesResult] = await Promise.all([
    fetchAllPages(buildOrdersQuery),
    targetsQuery,
    fetchCommissionTierSets(supabase),
    supabase.from("profiles").select("id, commission_mode")
  ]);
  const error = orderRowsResult.error ?? targetsResult.error ?? modesResult.error;

  if (error) {
    return NextResponse.json({ ok: false, error: error.message }, { status: 500 });
  }

  const orders = (orderRowsResult.data ?? []).map((order) => ({
    id: order.id as string,
    date: taipeiDate(order.created_at),
    // 共班訂單掛兩位銷售,業績金額由兩人均分
    sellers: [
      { id: order.seller_id as string, name: relationDisplayName(order.seller) },
      ...(order.seller2_id
        ? [{ id: order.seller2_id as string, name: relationDisplayName(order.seller2) }]
        : [])
    ],
    counterId: order.counter_id as string,
    counterName: relationName(order.counters),
    discountId: order.discount_id as string | null,
    salesAmount: Number(order.sales_amount),
    // 折讓 = 組合價折抵 + 訂單折扣 + 手動扣款
    discountAmount:
      Number(order.discount_amount) +
      Number(order.bundle_discount_amount ?? 0) +
      Number(order.manual_discount_amount ?? 0),
    receivedAmount: Number(order.received_amount)
  }));

  const commissionModeById = new Map(
    (modesResult.data ?? []).map((profile) => [
      profile.id as string,
      (profile.commission_mode as "daily" | "monthly") ?? "daily"
    ])
  );

  const daily = new Map<string, DailyPerformanceRow>();
  const monthly = new Map<string, MonthlyPerformanceRow>();
  const sellerDayReceived = new Map<string, number>();
  const counterMonthReceived = new Map<string, number>();

  for (const order of orders) {
    const month = order.date.slice(0, 7);
    const share = 1 / order.sellers.length;

    for (const seller of order.sellers) {
      const salesShare = roundCurrency(order.salesAmount * share);
      const discountShare = roundCurrency(order.discountAmount * share);
      const receivedShare = roundCurrency(order.receivedAmount * share);

      const dailyKey = `${order.date}|${seller.id}|${order.counterId}`;
      const dailyRow =
        daily.get(dailyKey) ??
        {
          date: order.date,
          sellerId: seller.id,
          sellerName: seller.name,
          counterId: order.counterId,
          counterName: order.counterName,
          orderCount: 0,
          salesAmount: 0,
          discountAmount: 0,
          receivedAmount: 0,
          commission: 0
        };

      dailyRow.orderCount += 1;
      dailyRow.salesAmount = roundCurrency(dailyRow.salesAmount + salesShare);
      dailyRow.discountAmount = roundCurrency(dailyRow.discountAmount + discountShare);
      dailyRow.receivedAmount = roundCurrency(dailyRow.receivedAmount + receivedShare);
      daily.set(dailyKey, dailyRow);

      const monthlyKey = `${month}|${seller.id}`;
      const monthlyRow =
        monthly.get(monthlyKey) ??
        {
          month,
          sellerId: seller.id,
          sellerName: seller.name,
          orderCount: 0,
          salesAmount: 0,
          discountAmount: 0,
          receivedAmount: 0,
          commission: 0
        };

      monthlyRow.orderCount += 1;
      monthlyRow.salesAmount = roundCurrency(monthlyRow.salesAmount + salesShare);
      monthlyRow.discountAmount = roundCurrency(monthlyRow.discountAmount + discountShare);
      monthlyRow.receivedAmount = roundCurrency(monthlyRow.receivedAmount + receivedShare);
      monthly.set(monthlyKey, monthlyRow);

      const sellerDayKey = `${order.date}|${seller.id}`;
      sellerDayReceived.set(
        sellerDayKey,
        roundCurrency((sellerDayReceived.get(sellerDayKey) ?? 0) + receivedShare)
      );
    }

    const counterMonthKey = `${order.counterId}|${month}`;
    counterMonthReceived.set(
      counterMonthKey,
      roundCurrency((counterMonthReceived.get(counterMonthKey) ?? 0) + order.receivedAmount)
    );
  }

  // 抽成:日結員工「當日 × 個人」合計(共班已各半)套級距後按列分攤;
  // 月結員工(commission_mode = monthly)以月總實收套級距,每日列只標示「月結」。
  for (const row of daily.values()) {
    row.commissionMode = commissionModeById.get(row.sellerId) ?? "daily";

    if (row.commissionMode === "monthly") {
      row.commission = 0;
      continue;
    }

    const dayTotal = sellerDayReceived.get(`${row.date}|${row.sellerId}`) ?? 0;
    const dayCommission = calculateCommissionByTiers(dayTotal, resolveTiers(tierSets, row.sellerId));

    row.commission =
      dayTotal > 0 ? Math.round((dayCommission * row.receivedAmount) / dayTotal) : 0;
  }

  for (const [key, received] of sellerDayReceived) {
    const sellerId = key.split("|")[1];

    if ((commissionModeById.get(sellerId) ?? "daily") === "monthly") continue;

    const month = key.slice(0, 7);
    const monthlyRow = monthly.get(`${month}|${sellerId}`);

    if (monthlyRow) {
      monthlyRow.commission += calculateCommissionByTiers(
        received,
        resolveTiers(tierSets, sellerId)
      );
    }
  }

  for (const row of monthly.values()) {
    row.commissionMode = commissionModeById.get(row.sellerId) ?? "daily";

    if (row.commissionMode === "monthly") {
      row.commission = calculateCommissionByTiers(
        row.receivedAmount,
        resolveTiers(tierSets, row.sellerId)
      );
    }
  }

  let dailyRows = sortDaily(Array.from(daily.values()));
  let monthlyRows = sortMonthly(Array.from(monthly.values()));

  // 員工只看到自己的列(共班訂單只顯示自己的那一半)
  if (isStaff && guard.profile) {
    const selfId = guard.profile.id;
    dailyRows = dailyRows.filter((row) => row.sellerId === selfId);
    monthlyRows = monthlyRows.filter((row) => row.sellerId === selfId);
  }

  const summary =
    isStaff && guard.profile ? buildSummaryFromDaily(dailyRows) : buildSummary(orders);

  const targets: CounterTargetRow[] = (isStaff ? [] : targetsResult.data ?? []).map((target) => {
    const month = String(target.month).slice(0, 7);
    const targetAmount = Number(target.target_amount);
    const achievedAmount = counterMonthReceived.get(`${target.counter_id}|${month}`) ?? 0;

    return {
      counterId: target.counter_id as string,
      counterName: relationName(target.counters),
      month,
      targetAmount,
      achievedAmount,
      achievementRate: targetAmount > 0 ? roundCurrency(achievedAmount / targetAmount) : 0
    };
  });

  const analytics = isStaff
    ? emptyAnalytics()
    : await buildSalesAnalytics(supabase, orders, { from, to, counterId });

  if ("error" in analytics) {
    return NextResponse.json({ ok: false, error: analytics.error }, { status: 500 });
  }

  return NextResponse.json({
    ok: true,
    data: {
      daily: dailyRows,
      monthly: monthlyRows,
      summary,
      targets,
      ...analytics,
      source: "supabase"
    }
  });
}

type SalesAnalytics = {
  productSales: Array<{
    productName: string;
    spec: string;
    category: string;
    quantity: number;
    revenue: number;
    revenueShare: number;
  }>;
  categorySales: Array<{
    category: string;
    quantity: number;
    revenue: number;
    revenueShare: number;
  }>;
  flavorSales: Array<{ flavorName: string; spec: string; quantity: number }>;
  discountUsage: Array<{
    discountName: string;
    orderCount: number;
    discountAmount: number;
    receivedAmount: number;
  }>;
  preorders: Array<{ itemName: string; spec: string; quantity: number; orderCount: number }>;
};

function emptyAnalytics(): SalesAnalytics {
  return {
    productSales: [],
    categorySales: [],
    flavorSales: [],
    discountUsage: [],
    preorders: []
  };
}

async function buildSalesAnalytics(
  supabase: ReturnType<typeof createSupabaseAdminClient>,
  orders: Array<{
    id: string;
    discountId: string | null;
    discountAmount: number;
    receivedAmount: number;
  }>,
  range: { from: string; to: string; counterId: string | null }
): Promise<SalesAnalytics | { error: string }> {
  if (orders.length === 0) return emptyAnalytics();

  // 商品/類別/口味/預購的彙總改由資料庫算(report_sales_analytics),
  // 原本把整區間的 order_items 撈回來彙總會被 PostgREST 的 max_rows 截斷。
  const [analyticsResult, discountsResult] = await Promise.all([
    supabase.rpc("report_sales_analytics", {
      p_from: range.from,
      p_to: range.to,
      p_counter_id: range.counterId
    }),
    supabase.from("discounts").select("id, name")
  ]);

  const error = analyticsResult.error ?? discountsResult.error;

  if (error) return { error: error.message };

  const aggregates = (analyticsResult.data ?? {}) as {
    totalRevenue?: number | string;
    productSales?: Array<{
      productName: string;
      spec: string;
      category: string;
      quantity: number | string;
      revenue: number | string;
    }>;
    categorySales?: Array<{
      category: string;
      quantity: number | string;
      revenue: number | string;
    }>;
    flavorSales?: Array<{ flavorName: string; spec: string; quantity: number | string }>;
    preorders?: Array<{
      itemName: string;
      spec: string;
      quantity: number | string;
      orderCount: number | string;
    }>;
  };

  const totalRevenue = Number(aggregates.totalRevenue ?? 0);
  const share = (revenue: number) =>
    totalRevenue > 0 ? roundCurrency(revenue / totalRevenue) : 0;

  const discountNameById = new Map(
    (discountsResult.data ?? []).map((discount) => [discount.id as string, discount.name as string])
  );
  const discountMap = new Map<
    string,
    { discountName: string; orderCount: number; discountAmount: number; receivedAmount: number }
  >();

  for (const order of orders) {
    if (!order.discountId || order.discountAmount <= 0) continue;

    const row =
      discountMap.get(order.discountId) ??
      {
        discountName: discountNameById.get(order.discountId) ?? "未知折扣",
        orderCount: 0,
        discountAmount: 0,
        receivedAmount: 0
      };
    row.orderCount += 1;
    row.discountAmount = roundCurrency(row.discountAmount + order.discountAmount);
    row.receivedAmount = roundCurrency(row.receivedAmount + order.receivedAmount);
    discountMap.set(order.discountId, row);
  }

  // RPC 已依營收/數量排序,這裡只補上佔比與型別轉換(numeric 經 jsonb 會是字串)。
  return {
    productSales: (aggregates.productSales ?? []).map((row) => {
      const revenue = Number(row.revenue);

      return {
        productName: row.productName,
        spec: row.spec,
        category: row.category,
        quantity: Number(row.quantity),
        revenue,
        revenueShare: share(revenue)
      };
    }),
    categorySales: (aggregates.categorySales ?? []).map((row) => {
      const revenue = Number(row.revenue);

      return {
        category: row.category,
        quantity: Number(row.quantity),
        revenue,
        revenueShare: share(revenue)
      };
    }),
    flavorSales: (aggregates.flavorSales ?? []).map((row) => ({
      flavorName: row.flavorName,
      spec: row.spec,
      quantity: Number(row.quantity)
    })),
    discountUsage: Array.from(discountMap.values()).sort(
      (left, right) => right.orderCount - left.orderCount
    ),
    preorders: (aggregates.preorders ?? []).map((row) => ({
      itemName: row.itemName,
      spec: row.spec,
      quantity: Number(row.quantity),
      orderCount: Number(row.orderCount)
    }))
  };
}

const PAGE_SIZE = 1000;

// PostgREST 超過 max_rows 會直接截斷且不報錯(正式區上限 1000),
// 區間一拉長就會靜默少算。這裡逐頁撈到不滿一頁為止。
async function fetchAllPages<Row>(
  build: () => {
    range: (
      from: number,
      to: number
    ) => PromiseLike<{ data: Row[] | null; error: { message: string } | null }>;
  }
): Promise<{ data: Row[]; error: { message: string } | null }> {
  const rows: Row[] = [];

  for (let offset = 0; ; offset += PAGE_SIZE) {
    const { data, error } = await build().range(offset, offset + PAGE_SIZE - 1);

    if (error) return { data: rows, error };

    const page = data ?? [];
    rows.push(...page);

    if (page.length < PAGE_SIZE) break;
  }

  return { data: rows, error: null };
}

function buildSummaryFromDaily(rows: DailyPerformanceRow[]): ReportSummary {
  const orderCount = rows.reduce((total, row) => total + row.orderCount, 0);
  const salesAmount = roundCurrency(rows.reduce((total, row) => total + row.salesAmount, 0));
  const discountAmount = roundCurrency(
    rows.reduce((total, row) => total + row.discountAmount, 0)
  );
  const receivedAmount = roundCurrency(
    rows.reduce((total, row) => total + row.receivedAmount, 0)
  );

  return {
    orderCount,
    salesAmount,
    discountAmount,
    receivedAmount,
    averageOrderValue: orderCount > 0 ? roundCurrency(receivedAmount / orderCount) : 0
  };
}

function buildSummary(
  orders: Array<{ salesAmount: number; discountAmount: number; receivedAmount: number }>
): ReportSummary {
  const salesAmount = roundCurrency(orders.reduce((total, order) => total + order.salesAmount, 0));
  const discountAmount = roundCurrency(
    orders.reduce((total, order) => total + order.discountAmount, 0)
  );
  const receivedAmount = roundCurrency(
    orders.reduce((total, order) => total + order.receivedAmount, 0)
  );

  return {
    orderCount: orders.length,
    salesAmount,
    discountAmount,
    receivedAmount,
    averageOrderValue: orders.length > 0 ? roundCurrency(receivedAmount / orders.length) : 0
  };
}

function sortDaily(rows: DailyPerformanceRow[]) {
  return rows.sort(
    (left, right) =>
      right.date.localeCompare(left.date) ||
      left.counterName.localeCompare(right.counterName) ||
      left.sellerName.localeCompare(right.sellerName)
  );
}

function sortMonthly(rows: MonthlyPerformanceRow[]) {
  return rows.sort(
    (left, right) =>
      right.month.localeCompare(left.month) || left.sellerName.localeCompare(right.sellerName)
  );
}

function monthsBetween(from: string, to: string) {
  const months: string[] = [];
  let cursor = from.slice(0, 7);
  const last = to.slice(0, 7);

  while (cursor <= last) {
    months.push(cursor);
    const [year, month] = cursor.split("-").map(Number);
    cursor = new Date(Date.UTC(year, month, 1)).toISOString().slice(0, 7);
  }

  return months;
}

function isIsoDate(value: string) {
  return /^\d{4}-\d{2}-\d{2}$/.test(value);
}

function buildDemoReport(to: string) {
  const daily: DailyPerformanceRow[] = [
    {
      date: to,
      sellerId: "00000000-0000-4000-8000-000000000001",
      sellerName: "林小芸",
      counterId: "00000000-0000-4000-8000-000000000401",
      counterName: "信義 A11",
      orderCount: 12,
      salesAmount: 15840,
      discountAmount: 560,
      receivedAmount: 15280,
      commission: calculateDailyCommission(15280)
    },
    {
      date: to,
      sellerId: "00000000-0000-4000-8000-000000000002",
      sellerName: "陳柏宇",
      counterId: "00000000-0000-4000-8000-000000000401",
      counterName: "信義 A11",
      orderCount: 9,
      salesAmount: 11280,
      discountAmount: 400,
      receivedAmount: 10880,
      commission: calculateDailyCommission(10880)
    },
    {
      date: to,
      sellerId: "00000000-0000-4000-8000-000000000003",
      sellerName: "黃品安",
      counterId: "00000000-0000-4000-8000-000000000402",
      counterName: "南西誠品",
      orderCount: 9,
      salesAmount: 12980,
      discountAmount: 500,
      receivedAmount: 12480,
      commission: calculateDailyCommission(12480)
    }
  ];

  const month = to.slice(0, 7);
  const monthly: MonthlyPerformanceRow[] = daily.map((row) => ({
    month,
    sellerId: row.sellerId,
    sellerName: row.sellerName,
    orderCount: row.orderCount,
    salesAmount: row.salesAmount,
    discountAmount: row.discountAmount,
    receivedAmount: row.receivedAmount,
    commission: row.commission
  }));

  const targets: CounterTargetRow[] = [
    {
      counterId: "00000000-0000-4000-8000-000000000401",
      counterName: "信義 A11",
      month,
      targetAmount: 500000,
      achievedAmount: 380000,
      achievementRate: 0.76
    },
    {
      counterId: "00000000-0000-4000-8000-000000000402",
      counterName: "南西誠品",
      month,
      targetAmount: 420000,
      achievedAmount: 268800,
      achievementRate: 0.64
    }
  ];

  const orderCount = daily.reduce((total, row) => total + row.orderCount, 0);
  const receivedAmount = roundCurrency(daily.reduce((total, row) => total + row.receivedAmount, 0));
  const summary: ReportSummary = {
    orderCount,
    salesAmount: roundCurrency(daily.reduce((total, row) => total + row.salesAmount, 0)),
    discountAmount: roundCurrency(daily.reduce((total, row) => total + row.discountAmount, 0)),
    receivedAmount,
    averageOrderValue: orderCount > 0 ? roundCurrency(receivedAmount / orderCount) : 0
  };

  return {
    daily,
    monthly,
    summary,
    targets,
    ...emptyAnalytics(),
    source: "demo"
  };
}
