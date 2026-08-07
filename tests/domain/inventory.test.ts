import { describe, expect, it } from "vitest";
import { normalizeInventoryQuantity } from "@/lib/domain/inventory";

describe("normalizeInventoryQuantity", () => {
  it("deducts stock for transfers", () => {
    expect(normalizeInventoryQuantity("adjustment", 2)).toBe(-2);
    expect(normalizeInventoryQuantity("adjustment", -2)).toBe(-2);
  });

  it("keeps purchases positive and count movements neutral", () => {
    expect(normalizeInventoryQuantity("purchase", -3)).toBe(3);
    expect(normalizeInventoryQuantity("opening_count", 10)).toBe(0);
  });

  it("keeps other deduction movements negative", () => {
    expect(normalizeInventoryQuantity("sampling", 1)).toBe(-1);
    expect(normalizeInventoryQuantity("waste", 1)).toBe(-1);
    expect(normalizeInventoryQuantity("sale", 1)).toBe(-1);
  });
});
