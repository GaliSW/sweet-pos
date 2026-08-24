import type { SessionProfile } from "@/lib/auth/session";
import type { createSupabaseAdminClient } from "@/lib/db/server";
import type { AuditAction } from "@/lib/domain/audit-diff";

export type AuditClient = ReturnType<typeof createSupabaseAdminClient>;

export type AuditParams = {
  actor: SessionProfile | null;
  action: AuditAction;
  entity: string;
  entityId: string | null;
  entityLabel: string | null;
  before?: unknown;
  after?: unknown;
};

// 稽核紀錄寫失敗不可讓主操作失敗:商品已經建好了卻回 500,比漏一筆 log 糟得多。
// 因此這裡吞掉所有錯誤,只留 console.error 供排查。
export async function writeAuditLog(
  supabase: AuditClient,
  params: AuditParams
): Promise<void> {
  try {
    const { error } = await supabase.from("audit_logs").insert({
      actor_id: params.actor?.id ?? null,
      actor_name: params.actor?.displayName ?? "未知",
      action: params.action,
      entity: params.entity,
      entity_id: params.entityId,
      entity_label: params.entityLabel,
      before: params.before ?? null,
      after: params.after ?? null
    });

    if (error) {
      console.error("[audit] 寫入稽核紀錄失敗", {
        entity: params.entity,
        action: params.action,
        entityId: params.entityId,
        error: error.message
      });
    }
  } catch (cause) {
    console.error("[audit] 寫入稽核紀錄發生例外", {
      entity: params.entity,
      action: params.action,
      entityId: params.entityId,
      cause
    });
  }
}
