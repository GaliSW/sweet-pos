import type { InventoryMovementDirection, InventoryMovementTypeOption } from "@/lib/backend/api-types";

// Demo 模式與前端讀取失敗時的預設類型,內容與 202611240001 migration 的種子資料一致。
export const defaultInventoryMovementTypes: InventoryMovementTypeOption[] = [
  { code: "opening_count", name: "開班盤點", direction: "count", noteRequired: false, needsReview: false, isSystem: true, isActive: true, sortOrder: 10 },
  { code: "handover_count", name: "交班盤點", direction: "count", noteRequired: false, needsReview: false, isSystem: true, isActive: true, sortOrder: 20 },
  { code: "closing_count", name: "下班盤點", direction: "count", noteRequired: false, needsReview: false, isSystem: true, isActive: true, sortOrder: 30 },
  { code: "purchase", name: "進貨", direction: "increase", noteRequired: false, needsReview: false, isSystem: true, isActive: true, sortOrder: 40 },
  { code: "sampling", name: "試吃", direction: "decrease", noteRequired: true, needsReview: true, isSystem: false, isActive: true, sortOrder: 50 },
  { code: "waste", name: "報廢", direction: "decrease", noteRequired: true, needsReview: true, isSystem: false, isActive: true, sortOrder: 60 },
  { code: "adjustment", name: "轉調", direction: "decrease", noteRequired: true, needsReview: true, isSystem: false, isActive: true, sortOrder: 70 },
  { code: "preorder_pickup", name: "預購取貨", direction: "decrease", noteRequired: false, needsReview: false, isSystem: true, isActive: true, sortOrder: 80 },
  { code: "sale", name: "銷售", direction: "decrease", noteRequired: false, needsReview: false, isSystem: true, isActive: true, sortOrder: 900 }
];

// 銷售異動只由 POS 結帳寫入,不出現在手動異動表單。
export const SALE_MOVEMENT_CODE = "sale";

export function normalizeInventoryQuantity(direction: InventoryMovementDirection, quantity: number) {
  if (direction === "count") return 0;
  if (direction === "decrease") return -Math.abs(Number(quantity));
  return Math.abs(Number(quantity));
}
