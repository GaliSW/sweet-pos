import { describe, expect, it } from "vitest";
import { defaultInventoryMovementTypes, normalizeInventoryQuantity } from "@/lib/domain/inventory";

describe("normalizeInventoryQuantity", () => {
  it("decrease 類型一律扣庫存", () => {
    expect(normalizeInventoryQuantity("decrease", 2)).toBe(-2);
    expect(normalizeInventoryQuantity("decrease", -2)).toBe(-2);
  });

  it("increase 類型一律加庫存", () => {
    expect(normalizeInventoryQuantity("increase", -3)).toBe(3);
    expect(normalizeInventoryQuantity("increase", 3)).toBe(3);
  });

  it("count 類型不異動數量", () => {
    expect(normalizeInventoryQuantity("count", 10)).toBe(0);
  });
});

describe("defaultInventoryMovementTypes", () => {
  it("程式直接引用的類型都是系統內建", () => {
    const system = new Set(
      defaultInventoryMovementTypes.filter((type) => type.isSystem).map((type) => type.code)
    );

    for (const code of [
      "opening_count",
      "handover_count",
      "closing_count",
      "purchase",
      "preorder_pickup",
      "sale"
    ]) {
      expect(system.has(code)).toBe(true);
    }
  });
});
