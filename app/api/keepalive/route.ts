import { NextResponse } from "next/server";
import { createSupabaseAdminClient, hasSupabaseAdminEnv } from "@/lib/db/server";

// Supabase Free 專案連續 7 天無資料庫活動會被暫停。
// 由 Vercel Cron(vercel.json)每天呼叫一次,做一筆極小查詢維持活動狀態。
export async function GET(request: Request) {
  // Vercel Cron 會自動帶 Authorization: Bearer <CRON_SECRET>(若有設定該環境變數)
  const cronSecret = process.env.CRON_SECRET;

  if (cronSecret && request.headers.get("authorization") !== `Bearer ${cronSecret}`) {
    return NextResponse.json({ ok: false, error: "unauthorized" }, { status: 401 });
  }

  if (!hasSupabaseAdminEnv()) {
    return NextResponse.json({ ok: true, data: { source: "demo" } });
  }

  const supabase = createSupabaseAdminClient();
  const { error } = await supabase.from("counters").select("id").limit(1);

  if (error) {
    return NextResponse.json({ ok: false, error: error.message }, { status: 500 });
  }

  return NextResponse.json({ ok: true, data: { pingedAt: new Date().toISOString() } });
}
