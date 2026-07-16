import { NextResponse } from "next/server";
import { requireRole } from "@/lib/auth/guards";
import { getOnDutySellers } from "@/lib/backend/on-duty";
import { createSupabaseAdminClient, hasSupabaseAdminEnv } from "@/lib/db/server";

// 此刻在指定櫃位當班的人員(供 POS 顯示銷售歸屬;訂單成立時後端會再判定一次)
export async function GET(request: Request) {
  const guard = await requireRole();

  if (guard.failure) return guard.failure;

  const { searchParams } = new URL(request.url);
  const counterId = searchParams.get("counterId");

  if (!counterId) {
    return NextResponse.json({ ok: false, error: "缺少櫃位" }, { status: 400 });
  }

  if (!hasSupabaseAdminEnv()) {
    return NextResponse.json({
      ok: true,
      data: { sellers: [], source: "demo" }
    });
  }

  const supabase = createSupabaseAdminClient();
  const sellers = await getOnDutySellers(supabase, counterId);

  return NextResponse.json({
    ok: true,
    data: { sellers, source: "supabase" }
  });
}
