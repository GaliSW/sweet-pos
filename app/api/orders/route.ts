import { NextResponse } from "next/server";
import type { CreateOrderInput } from "@/lib/backend/api-types";
import { requireRole } from "@/lib/auth/guards";
import { getOnDutySellers } from "@/lib/backend/on-duty";
import {
  nextDay,
  relationDisplayName,
  relationName,
  taipeiDate,
  taipeiDayStart
} from "@/lib/backend/query-helpers";
import { createSupabaseAdminClient, hasSupabaseAdminEnv } from "@/lib/db/server";
import { discounts, products } from "@/lib/domain/sample-data";
import { calculateOrderTotals, validateGiftBoxSelection } from "@/lib/domain/pos-rules";

const defaultCashierId = "00000000-0000-4000-8000-000000000001";

const paymentLabels: Record<string, string> = {
  cash: "現金",
  credit_card: "信用卡",
  line_pay: "LINE Pay",
  jkopay: "街口支付",
  transfer: "轉帳"
};

export async function GET(request: Request) {
  // 店長看全部;一般員工只看得到自己經手(收銀或銷售)的訂單。
  const guard = await requireRole();

  if (guard.failure) return guard.failure;

  const { searchParams } = new URL(request.url);
  const today = taipeiDate(new Date().toISOString());
  const from = searchParams.get("from") ?? `${today.slice(0, 7)}-01`;
  const to = searchParams.get("to") ?? today;
  const counterId = searchParams.get("counterId");
  const isStaff = guard.profile?.role === "staff";

  if (!hasSupabaseAdminEnv()) {
    return NextResponse.json({
      ok: true,
      data: { orders: [], source: "demo" }
    });
  }

  const supabase = createSupabaseAdminClient();

  let query = supabase
    .from("orders")
    .select(
      "id, order_no, created_at, counter_id, seller_id, seller2_id, cashier_id, discount_id, payment_method, sales_amount, discount_amount, receivable_amount, received_amount, status, void_reason, counters(name), seller:profiles!orders_seller_id_fkey(display_name), seller2:profiles!orders_seller2_id_fkey(display_name), cashier:profiles!orders_cashier_id_fkey(display_name), voider:profiles!orders_voided_by_fkey(display_name), editor:profiles!orders_edited_by_fkey(display_name)"
    )
    .gte("created_at", taipeiDayStart(from))
    .lt("created_at", taipeiDayStart(nextDay(to)))
    .order("created_at", { ascending: false })
    .limit(200);

  if (counterId) {
    query = query.eq("counter_id", counterId);
  }

  if (isStaff && guard.profile) {
    query = query.or(
      `cashier_id.eq.${guard.profile.id},seller_id.eq.${guard.profile.id},seller2_id.eq.${guard.profile.id}`
    );
  }

  const { data: orders, error } = await query;

  if (error) {
    return NextResponse.json({ ok: false, error: error.message }, { status: 500 });
  }

  const orderIds = (orders ?? []).map((order) => order.id as string);

  type OrderItemRow = {
    id: string;
    productId: string;
    productName: string;
    spec: string;
    unitPrice: number;
    quantity: number;
    lineTotal: number;
    giftFlavors: Array<{ flavorId: string | null; flavorName: string; spec: string; quantity: number }>;
  };

  const itemsByOrder = new Map<string, OrderItemRow[]>();
  const preordersByOrder = new Map<
    string,
    Array<{ itemName: string; spec: string; quantity: number }>
  >();

  if (orderIds.length > 0) {
    const [itemsResult, preordersResult] = await Promise.all([
      supabase
        .from("order_items")
        .select(
          "id, order_id, product_id, product_name, spec, unit_price, quantity, line_total, order_item_gift_flavors(flavor_id, flavor_name, spec, quantity)"
        )
        .in("order_id", orderIds),
      supabase
        .from("order_preorder_items")
        .select("order_id, item_name, spec, quantity")
        .in("order_id", orderIds)
    ]);

    const detailError = itemsResult.error ?? preordersResult.error;

    if (detailError) {
      return NextResponse.json({ ok: false, error: detailError.message }, { status: 500 });
    }

    for (const item of itemsResult.data ?? []) {
      const list = itemsByOrder.get(item.order_id as string) ?? [];
      list.push({
        id: item.id,
        productId: item.product_id,
        productName: item.product_name,
        spec: item.spec,
        unitPrice: Number(item.unit_price),
        quantity: item.quantity,
        lineTotal: Number(item.line_total),
        giftFlavors: (item.order_item_gift_flavors ?? []).map(
          (flavor: { flavor_id: string | null; flavor_name: string; spec: string; quantity: number }) => ({
            flavorId: flavor.flavor_id,
            flavorName: flavor.flavor_name,
            spec: flavor.spec,
            quantity: flavor.quantity
          })
        )
      });
      itemsByOrder.set(item.order_id as string, list);
    }

    for (const preorder of preordersResult.data ?? []) {
      const list = preordersByOrder.get(preorder.order_id as string) ?? [];
      list.push({
        itemName: preorder.item_name,
        spec: preorder.spec,
        quantity: preorder.quantity
      });
      preordersByOrder.set(preorder.order_id as string, list);
    }
  }

  return NextResponse.json({
    ok: true,
    data: {
      orders: (orders ?? []).map((order) => ({
        id: order.id,
        orderNo: order.order_no,
        createdAt: order.created_at,
        counterId: order.counter_id,
        counterName: relationName(order.counters),
        sellerId: order.seller_id,
        sellerName: relationDisplayName(order.seller),
        seller2Id: order.seller2_id,
        seller2Name: relationDisplayName(order.seller2),
        cashierName: relationDisplayName(order.cashier),
        discountId: order.discount_id,
        paymentMethod: order.payment_method,
        paymentLabel: paymentLabels[order.payment_method as string] ?? order.payment_method,
        salesAmount: Number(order.sales_amount),
        discountAmount: Number(order.discount_amount),
        receivedAmount: Number(order.received_amount),
        status: order.status,
        voidReason: order.void_reason,
        voidedByName: relationDisplayName(order.voider),
        editedByName: relationDisplayName(order.editor),
        hasPreorder: (preordersByOrder.get(order.id as string) ?? []).length > 0,
        preorderItems: preordersByOrder.get(order.id as string) ?? [],
        canVoid:
          order.status === "completed" &&
          (!guard.profile ||
            guard.profile.role === "manager" ||
            ([order.cashier_id, order.seller_id, order.seller2_id].includes(guard.profile.id) &&
              taipeiDate(order.created_at as string) === today)),
        canEdit: order.status === "completed" && (!guard.profile || guard.profile.role === "manager"),
        items: itemsByOrder.get(order.id as string) ?? []
      })),
      source: "supabase"
    }
  });
}

export async function PATCH(request: Request) {
  const guard = await requireRole();

  if (guard.failure) return guard.failure;

  const input = (await request.json()) as {
    orderId?: string;
    action?: "void" | "update";
    reason?: string;
    sellerId?: string;
    seller2Id?: string | null;
    discountId?: string | null;
    paymentMethod?: string;
    createdAt?: string | null;
    items?: CreateOrderInput["items"];
  };

  if (!input.orderId) {
    return NextResponse.json({ ok: false, error: "缺少訂單編號" }, { status: 400 });
  }

  if (input.action === "update") {
    // 店長直接改單:品項/金額/折扣/付款/業績歸屬/日期整單重算。
    if (guard.profile && guard.profile.role !== "manager") {
      return NextResponse.json({ ok: false, error: "需要店長權限" }, { status: 403 });
    }

    if (!input.sellerId) {
      return NextResponse.json({ ok: false, error: "缺少銷售人員" }, { status: 400 });
    }

    if (!input.items?.length) {
      return NextResponse.json({ ok: false, error: "訂單至少需要一個商品" }, { status: 400 });
    }

    if (!hasSupabaseAdminEnv()) {
      return NextResponse.json({
        ok: true,
        data: { orderId: input.orderId, source: "demo" }
      });
    }

    const supabase = createSupabaseAdminClient();
    const editedBy =
      guard.profile?.id ?? process.env.DEMO_MANAGER_ID ?? "00000000-0000-4000-8000-000000000004";

    const { error } = await supabase.rpc("update_pos_order", {
      p_order_id: input.orderId,
      p_seller_id: input.sellerId,
      p_seller2_id: input.seller2Id ?? null,
      p_discount_id: input.discountId ?? null,
      p_payment_method: input.paymentMethod ?? "cash",
      p_items: input.items,
      p_edited_by: editedBy,
      p_created_at: input.createdAt ?? null
    });

    if (error) {
      return NextResponse.json({ ok: false, error: error.message }, { status: 400 });
    }

    return NextResponse.json({
      ok: true,
      data: { orderId: input.orderId, source: "supabase" }
    });
  }

  if (!input.reason?.trim()) {
    return NextResponse.json({ ok: false, error: "作廢需要填寫原因" }, { status: 400 });
  }

  if (!hasSupabaseAdminEnv()) {
    return NextResponse.json({
      ok: true,
      data: { orderId: input.orderId, source: "demo" }
    });
  }

  const supabase = createSupabaseAdminClient();
  const { data: order, error: orderError } = await supabase
    .from("orders")
    .select("id, order_no, cashier_id, seller_id, seller2_id, created_at, status")
    .eq("id", input.orderId)
    .single();

  if (orderError || !order) {
    return NextResponse.json({ ok: false, error: "找不到訂單" }, { status: 404 });
  }

  if (order.status !== "completed") {
    return NextResponse.json({ ok: false, error: "訂單已作廢，不可重複作廢" }, { status: 400 });
  }

  // 一般員工只能作廢「自己經手(銷售或收銀)、當日」的訂單;店長不受限。原單保留供稽核。
  if (guard.profile && guard.profile.role !== "manager") {
    if (![order.cashier_id, order.seller_id, order.seller2_id].includes(guard.profile.id)) {
      return NextResponse.json({ ok: false, error: "只能作廢自己經手的訂單" }, { status: 403 });
    }

    const today = taipeiDate(new Date().toISOString());

    if (taipeiDate(order.created_at as string) !== today) {
      return NextResponse.json(
        { ok: false, error: "只能作廢當日訂單，歷史訂單請聯絡店長處理" },
        { status: 403 }
      );
    }
  }

  const voidedBy =
    guard.profile?.id ?? process.env.DEMO_CASHIER_ID ?? defaultCashierId;

  const { error } = await supabase.rpc("void_pos_order", {
    p_order_id: input.orderId,
    p_voided_by: voidedBy,
    p_reason: input.reason.trim()
  });

  if (error) {
    return NextResponse.json({ ok: false, error: error.message }, { status: 400 });
  }

  return NextResponse.json({
    ok: true,
    data: {
      orderId: input.orderId,
      orderNo: order.order_no,
      source: "supabase"
    }
  });
}

export async function POST(request: Request) {
  const guard = await requireRole();

  if (guard.failure) return guard.failure;

  const input = (await request.json()) as CreateOrderInput;
  const validation = validateOrderInput(input, { validateCatalog: !hasSupabaseAdminEnv() });

  if (!validation.ok) {
    return NextResponse.json(validation, { status: 400 });
  }

  if (!hasSupabaseAdminEnv()) {
    return NextResponse.json({
      ok: true,
      data: {
        orderId: crypto.randomUUID(),
        orderNo: `DEMO-${Date.now()}`,
        totals: calculateDemoTotals(input),
        source: "demo"
      }
    });
  }

  const supabase = createSupabaseAdminClient();

  // 銷售人員不由前端指定:依訂單成立當下的已發布班表帶入當班人員(共班掛兩人),
  // 無人當班時記在登入者名下。收銀一律等於主銷售。
  const onDuty = await getOnDutySellers(supabase, input.counterId);
  const fallbackSellerId =
    guard.profile?.id ?? process.env.DEMO_CASHIER_ID ?? defaultCashierId;
  const sellerId = onDuty[0]?.id ?? fallbackSellerId;
  const seller2Id = onDuty[1]?.id ?? null;

  const { data, error } = await supabase.rpc("create_pos_order", {
    p_counter_id: input.counterId,
    p_seller_id: sellerId,
    p_seller2_id: seller2Id,
    p_cashier_id: sellerId,
    p_discount_id: input.discountId ?? null,
    p_payment_method: input.paymentMethod,
    p_items: input.items
  });

  if (error) {
    return NextResponse.json({ ok: false, error: error.message }, { status: 400 });
  }

  return NextResponse.json({
    ok: true,
    data: {
      orderId: data,
      sellers: onDuty.map((seller) => seller.displayName),
      source: "supabase"
    }
  });
}

function validateOrderInput(input: CreateOrderInput, options: { validateCatalog: boolean }) {
  if (!input.counterId) return { ok: false as const, error: "缺少櫃位" };
  if (!input.items?.length) return { ok: false as const, error: "訂單至少需要一個商品" };

  for (const item of input.items) {
    if (item.quantity <= 0) {
      return { ok: false as const, error: "商品數量必須大於 0" };
    }
  }

  // 連線 Supabase 時商品與禮盒規則由 create_pos_order RPC 依資料庫驗證,
  // 這裡的 sample-data 驗證只用在 demo 模式。
  if (!options.validateCatalog) {
    return { ok: true as const };
  }

  for (const item of input.items) {
    const product = products.find((candidate) => candidate.id === item.productId);

    if (!product) {
      return { ok: false as const, error: `找不到商品 ${item.productId}` };
    }

    if (product.giftRule?.mode === "select") {
      const selectedFlavors = (item.giftFlavors ?? []).flatMap((flavor) =>
        Array.from({ length: flavor.quantity }, () => flavor.flavorName)
      );
      const result = validateGiftBoxSelection({
        name: product.name,
        mode: "select",
        requiredFlavorCount: product.giftRule.requiredFlavorCount,
        includesScallionCracker: product.giftRule.includesScallionCracker,
        selectedFlavors
      });

      if (!result.valid) {
        return { ok: false as const, error: result.message };
      }
    }
  }

  return { ok: true as const };
}

function calculateDemoTotals(input: CreateOrderInput) {
  const discount = discounts.find((candidate) => candidate.id === input.discountId);

  return calculateOrderTotals({
    items: input.items.map((item) => {
      const product = products.find((candidate) => candidate.id === item.productId);

      return {
        unitPrice: product?.price ?? 0,
        quantity: item.quantity
      };
    }),
    discount:
      discount && discount.id !== "none"
        ? {
            type: discount.type,
            value: discount.value,
            minOrderAmount: discount.minOrderAmount
          }
        : null
  });
}
