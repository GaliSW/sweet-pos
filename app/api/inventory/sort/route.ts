import { NextResponse } from "next/server";
import { requireRole } from "@/lib/auth/guards";
import { createSupabaseAdminClient, hasSupabaseAdminEnv } from "@/lib/db/server";

// 儲存庫存列表的自訂排序(拖曳後整組回寫):
// items 依顯示順序帶 productId 或 flavorId,寫入 products/flavors.sort_order。
// 順序為全店共用,員工與店長皆可調整。
export async function PATCH(request: Request) {
  const guard = await requireRole();

  if (guard.failure) return guard.failure;

  const input = (await request.json()) as {
    items?: Array<{ productId?: string | null; flavorId?: string | null }>;
  };

  if (!input.items || input.items.length === 0) {
    return NextResponse.json({ ok: false, error: "缺少排序內容" }, { status: 400 });
  }

  for (const item of input.items) {
    if (Boolean(item.productId) === Boolean(item.flavorId)) {
      return NextResponse.json(
        { ok: false, error: "品項必須是袋裝商品或禮盒口味其中一種" },
        { status: 400 }
      );
    }
  }

  if (!hasSupabaseAdminEnv()) {
    return NextResponse.json({ ok: true, data: { count: input.items.length, source: "demo" } });
  }

  const supabase = createSupabaseAdminClient();
  const updates = input.items.map((item, index) =>
    item.productId
      ? supabase.from("products").update({ sort_order: index }).eq("id", item.productId)
      : supabase.from("flavors").update({ sort_order: index }).eq("id", item.flavorId)
  );

  const results = await Promise.all(updates);
  const error = results.find((result) => result.error)?.error;

  if (error) {
    return NextResponse.json({ ok: false, error: error.message }, { status: 400 });
  }

  return NextResponse.json({
    ok: true,
    data: { count: input.items.length, source: "supabase" }
  });
}
