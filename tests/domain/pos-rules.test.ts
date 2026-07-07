import { describe, expect, it } from "vitest";
import {
  calculateCommissionByTiers,
  calculateDailyCommission,
  calculateOrderTotals,
  defaultCommissionTiers,
  detectShiftConflicts,
  validateGiftBoxSelection
} from "@/lib/domain/pos-rules";

describe("calculateOrderTotals", () => {
  it("sets received amount equal to receivable amount after discount", () => {
    const totals = calculateOrderTotals({
      items: [
        { unitPrice: 280, quantity: 2 },
        { unitPrice: 980, quantity: 1 }
      ],
      discount: { type: "percentage", value: 0.9 }
    });

    expect(totals.salesAmount).toBe(1540);
    expect(totals.discountAmount).toBe(154);
    expect(totals.receivableAmount).toBe(1386);
    expect(totals.receivedAmount).toBe(1386);
  });

  it("applies a fixed discount only when the minimum order amount is reached", () => {
    const belowMinimum = calculateOrderTotals({
      items: [{ unitPrice: 980, quantity: 1 }],
      discount: { type: "fixed_amount", value: 100, minOrderAmount: 1000 }
    });
    const reachedMinimum = calculateOrderTotals({
      items: [{ unitPrice: 1280, quantity: 1 }],
      discount: { type: "fixed_amount", value: 100, minOrderAmount: 1000 }
    });

    expect(belowMinimum.discountAmount).toBe(0);
    expect(belowMinimum.receivableAmount).toBe(980);
    expect(reachedMinimum.discountAmount).toBe(100);
    expect(reachedMinimum.receivableAmount).toBe(1180);
  });
});

describe("validateGiftBoxSelection", () => {
  it("requires small gift boxes to have exactly 3 selected flavors", () => {
    expect(
      validateGiftBoxSelection({
        name: "小禮盒",
        mode: "select",
        requiredFlavorCount: 3,
        selectedFlavors: ["經典原味", "蔓越莓", "草莓"]
      })
    ).toEqual({ valid: true, includedItems: ["經典原味 6入/袋", "蔓越莓 6入/袋", "草莓 6入/袋"] });

    expect(
      validateGiftBoxSelection({
        name: "小禮盒",
        mode: "select",
        requiredFlavorCount: 3,
        selectedFlavors: ["經典原味", "蔓越莓"]
      })
    ).toEqual({ valid: false, message: "小禮盒需要選擇 3 個口味" });
  });

  it("requires large gift boxes to have 8 selected flavors and includes scallion cracker", () => {
    const result = validateGiftBoxSelection({
      name: "大禮盒",
      mode: "select",
      requiredFlavorCount: 8,
      includesScallionCracker: true,
      selectedFlavors: ["A", "B", "C", "D", "E", "F", "G", "H"]
    });

    expect(result).toEqual({
      valid: true,
      includedItems: [
        "A 6入/袋",
        "B 6入/袋",
        "C 6入/袋",
        "D 6入/袋",
        "E 6入/袋",
        "F 6入/袋",
        "G 6入/袋",
        "H 6入/袋",
        "經典原味蔥軋餅 9入/袋"
      ]
    });
  });

  it("uses fixed flavors for fixed gift boxes", () => {
    expect(
      validateGiftBoxSelection({
        name: "發禮盒",
        mode: "fixed",
        fixedFlavors: ["包種烏龍", "蔓越莓", "草莓", "芒果"]
      })
    ).toEqual({
      valid: true,
      includedItems: ["包種烏龍 6入/袋", "蔓越莓 6入/袋", "草莓 6入/袋", "芒果 6入/袋"]
    });
  });
});

describe("calculateDailyCommission", () => {
  it("calculates tiered daily commission from personal sales", () => {
    expect(calculateDailyCommission(2999)).toBe(0);
    expect(calculateDailyCommission(3000)).toBe(30);
    expect(calculateDailyCommission(5000)).toBe(50);
    expect(calculateDailyCommission(5001)).toBe(100);
  });
});

describe("calculateCommissionByTiers", () => {
  it("matches the default hardcoded rules with the default tiers", () => {
    for (const sales of [0, 2999, 3000, 4500, 5000, 5001, 12000]) {
      expect(calculateCommissionByTiers(sales, defaultCommissionTiers)).toBe(
        calculateDailyCommission(sales)
      );
    }
  });

  it("uses the highest tier whose threshold is reached", () => {
    const tiers = [
      { minDailySales: 1000, rate: 0.05 },
      { minDailySales: 8000, rate: 0.1 }
    ];

    expect(calculateCommissionByTiers(500, tiers)).toBe(0);
    expect(calculateCommissionByTiers(2000, tiers)).toBe(100);
    expect(calculateCommissionByTiers(10000, tiers)).toBe(1000);
  });

  it("returns zero without tiers", () => {
    expect(calculateCommissionByTiers(99999, [])).toBe(0);
  });
});

describe("detectShiftConflicts", () => {
  it("detects the same employee assigned to overlapping shifts", () => {
    const conflicts = detectShiftConflicts([
      {
        id: "shift-1",
        staffId: "staff-1",
        counterId: "counter-a",
        date: "2026-07-05",
        startsAt: "10:00",
        endsAt: "16:00"
      },
      {
        id: "shift-2",
        staffId: "staff-1",
        counterId: "counter-b",
        date: "2026-07-05",
        startsAt: "15:30",
        endsAt: "22:00"
      }
    ]);

    expect(conflicts).toEqual([
      {
        type: "staff_overlap",
        shiftIds: ["shift-1", "shift-2"],
        message: "同一員工在 2026-07-05 有重疊班次"
      }
    ]);
  });

  it("detects duplicate counter shift slots", () => {
    const conflicts = detectShiftConflicts([
      {
        id: "shift-1",
        staffId: "staff-1",
        counterId: "counter-a",
        date: "2026-07-05",
        shiftCode: "morning",
        startsAt: "10:00",
        endsAt: "16:00"
      },
      {
        id: "shift-2",
        staffId: "staff-2",
        counterId: "counter-a",
        date: "2026-07-05",
        shiftCode: "morning",
        startsAt: "10:00",
        endsAt: "16:00"
      }
    ]);

    expect(conflicts).toEqual([
      {
        type: "duplicate_counter_shift",
        shiftIds: ["shift-1", "shift-2"],
        message: "同一櫃位在 2026-07-05 的 morning 班別重複排班"
      }
    ]);
  });
});
