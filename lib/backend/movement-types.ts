import type { InventoryMovementTypeOption } from "@/lib/backend/api-types";
import type { createSupabaseAdminClient } from "@/lib/db/server";

export const movementTypeSelect =
  "code, name, direction, note_required, needs_review, is_system, is_active, sort_order";

export function mapMovementType(row: Record<string, unknown>): InventoryMovementTypeOption {
  return {
    code: String(row.code),
    name: String(row.name),
    direction: row.direction as InventoryMovementTypeOption["direction"],
    noteRequired: Boolean(row.note_required),
    needsReview: Boolean(row.needs_review),
    isSystem: Boolean(row.is_system),
    isActive: Boolean(row.is_active),
    sortOrder: Number(row.sort_order)
  };
}

export async function fetchMovementTypes(
  supabase: ReturnType<typeof createSupabaseAdminClient>
): Promise<InventoryMovementTypeOption[]> {
  const { data, error } = await supabase
    .from("inventory_movement_types")
    .select(movementTypeSelect)
    .order("sort_order")
    .order("created_at");

  if (error) throw new Error(error.message);
  return (data ?? []).map(mapMovementType);
}
