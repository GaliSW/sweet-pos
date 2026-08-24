import { NextResponse } from "next/server";
import { requireRole } from "@/lib/auth/guards";
import { createSupabaseAdminClient, hasSupabaseAdminEnv } from "@/lib/db/server";

const PAGE_SIZE = 50;

const SELECT_COLUMNS =
  "id, actor_id, actor_name, action, entity, entity_id, entity_label, before, after, created_at";

// 稽核紀錄是 append-only,這支路由只有 GET。
export async function GET(request: Request) {
  const guard = await requireRole("manager");

  if (guard.failure) return guard.failure;

  if (!hasSupabaseAdminEnv()) {
    return NextResponse.json({
      ok: true,
      data: { logs: [], total: 0, page: 0, pageSize: PAGE_SIZE, source: "demo" }
    });
  }

  const params = new URL(request.url).searchParams;
  const entity = params.get("entity");
  const actorId = params.get("actorId");
  const from = params.get("from");
  const to = params.get("to");
  const page = Math.max(0, Math.trunc(Number(params.get("page") ?? 0)) || 0);

  const supabase = createSupabaseAdminClient();
  let query = supabase
    .from("audit_logs")
    .select(SELECT_COLUMNS, { count: "exact" })
    .order("created_at", { ascending: false })
    .range(page * PAGE_SIZE, page * PAGE_SIZE + PAGE_SIZE - 1);

  if (entity) query = query.eq("entity", entity);
  if (actorId) query = query.eq("actor_id", actorId);
  // 日期以台北時區的整日為界,與報表的 taipeiDate 一致。
  if (from) query = query.gte("created_at", `${from}T00:00:00+08:00`);
  if (to) query = query.lte("created_at", `${to}T23:59:59.999+08:00`);

  const { data, error, count } = await query;

  if (error) {
    return NextResponse.json({ ok: false, error: error.message }, { status: 500 });
  }

  return NextResponse.json({
    ok: true,
    data: {
      logs: (data ?? []).map((row) => ({
        id: row.id,
        actorId: row.actor_id,
        actorName: row.actor_name,
        action: row.action,
        entity: row.entity,
        entityId: row.entity_id,
        entityLabel: row.entity_label,
        before: row.before,
        after: row.after,
        createdAt: row.created_at
      })),
      total: count ?? 0,
      page,
      pageSize: PAGE_SIZE,
      source: "supabase"
    }
  });
}
