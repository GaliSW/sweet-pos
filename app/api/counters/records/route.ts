import { NextResponse } from "next/server";
import { requireRole } from "@/lib/auth/guards";
import { relationDisplayName, relationName } from "@/lib/backend/query-helpers";
import { createSupabaseAdminClient, hasSupabaseAdminEnv } from "@/lib/db/server";

// 匯出指定櫃位的全部歷史紀錄(訂單/品項/班表/庫存異動),
// 供「永久刪除櫃位」前先下載備份。
export async function GET(request: Request) {
  const guard = await requireRole("manager");

  if (guard.failure) return guard.failure;

  const { searchParams } = new URL(request.url);
  const counterId = searchParams.get("counterId");

  if (!counterId) {
    return NextResponse.json({ ok: false, error: "缺少櫃位" }, { status: 400 });
  }

  if (!hasSupabaseAdminEnv()) {
    return NextResponse.json({
      ok: true,
      data: { orders: [], orderItems: [], shifts: [], movements: [], source: "demo" }
    });
  }

  const supabase = createSupabaseAdminClient();
  const [ordersResult, shiftsResult, movementsResult] = await Promise.all([
    supabase
      .from("orders")
      .select(
        "id, order_no, created_at, payment_method, sales_amount, bundle_discount_amount, discount_amount, received_amount, status, void_reason, seller:profiles!orders_seller_id_fkey(display_name), seller2:profiles!orders_seller2_id_fkey(display_name)"
      )
      .eq("counter_id", counterId)
      .order("created_at"),
    supabase
      .from("shifts")
      .select("shift_date, shift_code, starts_at, ends_at, published, profiles(display_name)")
      .eq("counter_id", counterId)
      .order("shift_date"),
    supabase
      .from("inventory_movements")
      .select(
        "created_at, movement_type, quantity, counted_quantity, note, products(name), flavors(name), created_profile:profiles!inventory_movements_created_by_fkey(display_name)"
      )
      .eq("counter_id", counterId)
      .order("created_at")
  ]);

  const error = ordersResult.error ?? shiftsResult.error ?? movementsResult.error;

  if (error) {
    return NextResponse.json({ ok: false, error: error.message }, { status: 500 });
  }

  const orderIds = (ordersResult.data ?? []).map((order) => order.id as string);
  let orderItems: Array<{
    orderNo: string;
    productName: string;
    spec: string;
    unitPrice: number;
    quantity: number;
    lineTotal: number;
  }> = [];

  if (orderIds.length > 0) {
    const orderNoById = new Map(
      (ordersResult.data ?? []).map((order) => [order.id as string, order.order_no as string])
    );
    const { data: items, error: itemsError } = await supabase
      .from("order_items")
      .select("order_id, product_name, spec, unit_price, quantity, line_total")
      .in("order_id", orderIds);

    if (itemsError) {
      return NextResponse.json({ ok: false, error: itemsError.message }, { status: 500 });
    }

    orderItems = (items ?? []).map((item) => ({
      orderNo: orderNoById.get(item.order_id as string) ?? "",
      productName: item.product_name as string,
      spec: item.spec as string,
      unitPrice: Number(item.unit_price),
      quantity: item.quantity as number,
      lineTotal: Number(item.line_total)
    }));
  }

  return NextResponse.json({
    ok: true,
    data: {
      orders: (ordersResult.data ?? []).map((order) => ({
        orderNo: order.order_no,
        createdAt: order.created_at,
        sellerName: relationDisplayName(order.seller),
        seller2Name: relationDisplayName(order.seller2),
        paymentMethod: order.payment_method,
        salesAmount: Number(order.sales_amount),
        bundleDiscountAmount: Number(order.bundle_discount_amount ?? 0),
        discountAmount: Number(order.discount_amount),
        receivedAmount: Number(order.received_amount),
        status: order.status,
        voidReason: order.void_reason
      })),
      orderItems,
      shifts: (shiftsResult.data ?? []).map((shift) => ({
        shiftDate: shift.shift_date,
        shiftCode: shift.shift_code,
        staffName: relationDisplayName(shift.profiles),
        startsAt: shift.starts_at,
        endsAt: shift.ends_at,
        published: shift.published
      })),
      movements: (movementsResult.data ?? []).map((movement) => ({
        createdAt: movement.created_at,
        movementType: movement.movement_type,
        itemName: relationName(movement.products) || relationName(movement.flavors),
        quantity: movement.quantity,
        countedQuantity: movement.counted_quantity,
        note: movement.note,
        createdByName: relationDisplayName(movement.created_profile)
      })),
      source: "supabase"
    }
  });
}
