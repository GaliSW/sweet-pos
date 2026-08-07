import type { InventoryMovementType } from "@/lib/backend/api-types";

const countTypes = new Set<InventoryMovementType>([
  "opening_count",
  "closing_count",
  "handover_count"
]);

const deductionTypes = new Set<InventoryMovementType>([
  "sampling",
  "waste",
  "adjustment",
  "sale"
]);

export function normalizeInventoryQuantity(type: InventoryMovementType, quantity: number) {
  if (countTypes.has(type)) return 0;
  if (deductionTypes.has(type)) return -Math.abs(Number(quantity));
  return Math.abs(Number(quantity));
}
