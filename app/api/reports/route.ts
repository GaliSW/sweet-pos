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

  let ordersQuery = supabase
    .from("orders")
    .select(
      "id, created_at, seller_id, seller2_id, counter_id, discount_id, sales_amount, discount_amount, received_amount, seller:profiles!orders_seller_id_fkey(display_name), seller2:profiles!orders_seller2_id_fkey(display_name), counters(name)"
    )
    .eq("status", "completed")
    .gte("created_at", taipeiDayStart(from))
    .lt("created_at", taipeiDayStart(nextDay(to)));

  if (counterId) {
    ordersQuery = ordersQuery.eq("counter_id", counterId);
  }

  if (isStaff && guard.profile) {
    ordersQuery = ordersQuery.or(
      `seller_id.eq.${guard.profile.id},seller2_id.eq.${guard.profile.id}`
    );
  }

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

  const [ordersResult, targetsResult, tierSets] = await Promise.all([
    ordersQuery,
    targetsQuery,
    fetchCommissionTierSets(supabase)
  ]);
  const error = ordersResult.error ?? targetsResult.error;

  if (error) {
    return NextResponse.json({ ok: false, error: error.message }, { status: 500 });
  }

  const orders = (ordersResult.data ?? []).map((order) => ({
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
    discountAmount: Number(order.discount_amount),
    receivedAmount: Number(order.received_amount)
  }));

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

  // 抽成一日一算:以「當日 × 個人」合計(共班已各半)套該員工的級距(個人覆寫優先),
  // 再按各櫃位列的實收比例分攤,避免跨列或跨日累積業績造成級距誤判。
  for (const row of daily.values()) {
    const dayTotal = sellerDayReceived.get(`${row.date}|${row.sellerId}`) ?? 0;
    const dayCommission = calculateCommissionByTiers(dayTotal, resolveTiers(tierSets, row.sellerId));

    row.commission =
      dayTotal > 0 ? Math.round((dayCommission * row.receivedAmount) / dayTotal) : 0;
  }

  for (const [key, received] of sellerDayReceived) {
    const sellerId = key.split("|")[1];
    const month = key.slice(0, 7);
    const monthlyRow = monthly.get(`${month}|${sellerId}`);

    if (monthlyRow) {
      monthlyRow.commission += calculateCommissionByTiers(
        received,
        resolveTiers(tierSets, sellerId)
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

  const analytics = isStaff ? emptyAnalytics() : await buildSalesAnalytics(supabase, orders);

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
  }>
): Promise<SalesAnalytics | { error: string }> {
  if (orders.length === 0) return emptyAnalytics();

  const orderIds = orders.map((order) => order.id);
  const [itemsResult, preordersResult, discountsResult] = await Promise.all([
    supabase
      .from("order_items")
      .select(
        "order_id, product_name, spec, quantity, line_total, products(category), order_item_gift_flavors(flavor_name, spec, quantity)"
      )
      .in("order_id", orderIds),
    supabase
      .from("order_preorder_items")
      .select("order_id, item_name, spec, quantity")
      .in("order_id", orderIds),
    supabase.from("discounts").select("id, name")
  ]);

  const error = itemsResult.error ?? preordersResult.error ?? discountsResult.error;

  if (error) return { error: error.message };

  const productMap = new Map<
    string,
    { productName: string; spec: string; category: string; quantity: number; revenue: number }
  >();
  const categoryMap = new Map<string, { quantity: number; revenue: number }>();
  const flavorMap = new Map<string, { flavorName: string; spec: string; quantity: number }>();
  let totalRevenue = 0;

  for (const item of itemsResult.data ?? []) {
    const category = relationCategory(item.products);
    const revenue = Number(item.line_total);
    totalRevenue = roundCurrency(totalRevenue + revenue);

    const productKey = `${item.product_name}|${item.spec}`;
    const product =
      productMap.get(productKey) ??
      { productName: item.product_name, spec: item.spec, category, quantity: 0, revenue: 0 };
    product.quantity += item.quantity;
    product.revenue = roundCurrency(product.revenue + revenue);
    productMap.set(productKey, product);

    const categoryRow = categoryMap.get(category) ?? { quantity: 0, revenue: 0 };
    categoryRow.quantity += item.quantity;
    categoryRow.revenue = roundCurrency(categoryRow.revenue + revenue);
    categoryMap.set(category, categoryRow);

    for (const flavor of item.order_item_gift_flavors ?? []) {
      const flavorKey = `${flavor.flavor_name}|${flavor.spec}`;
      const flavorRow =
        flavorMap.get(flavorKey) ??
        { flavorName: flavor.flavor_name, spec: flavor.spec, quantity: 0 };
      flavorRow.quantity += flavor.quantity * item.quantity;
      flavorMap.set(flavorKey, flavorRow);
    }
  }

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

  const preorderMap = new Map<
    string,
    { itemName: string; spec: string; quantity: number; orders: Set<string> }
  >();

  for (const preorder of preordersResult.data ?? []) {
    const key = `${preorder.item_name}|${preorder.spec}`;
    const row =
      preorderMap.get(key) ??
      { itemName: preorder.item_name, spec: preorder.spec, quantity: 0, orders: new Set<string>() };
    row.quantity += preorder.quantity;
    row.orders.add(preorder.order_id as string);
    preorderMap.set(key, row);
  }

  return {
    productSales: Array.from(productMap.values())
      .map((row) => ({
        ...row,
        revenueShare: totalRevenue > 0 ? roundCurrency(row.revenue / totalRevenue) : 0
      }))
      .sort((left, right) => right.revenue - left.revenue),
    categorySales: Array.from(categoryMap.entries())
      .map(([category, row]) => ({
        category,
        quantity: row.quantity,
        revenue: row.revenue,
        revenueShare: totalRevenue > 0 ? roundCurrency(row.revenue / totalRevenue) : 0
      }))
      .sort((left, right) => right.revenue - left.revenue),
    flavorSales: Array.from(flavorMap.values()).sort(
      (left, right) => right.quantity - left.quantity
    ),
    discountUsage: Array.from(discountMap.values()).sort(
      (left, right) => right.orderCount - left.orderCount
    ),
    preorders: Array.from(preorderMap.values())
      .map((row) => ({
        itemName: row.itemName,
        spec: row.spec,
        quantity: row.quantity,
        orderCount: row.orders.size
      }))
      .sort((left, right) => right.quantity - left.quantity)
  };
}

function relationCategory(value: unknown) {
  if (Array.isArray(value)) return String(value[0]?.category ?? "bag");
  if (value && typeof value === "object" && "category" in value) return String(value.category);
  return "bag";
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
