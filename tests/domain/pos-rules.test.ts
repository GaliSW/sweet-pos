import { describe, expect, it } from "vitest";
import {
  calculateBundleDiscount,
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

  it("applies percentage discount on the bundle-discounted amount", () => {
    const totals = calculateOrderTotals({
      items: [{ unitPrice: 280, quantity: 2 }],
      discount: { type: "percentage", value: 0.9 },
      bundleDiscount: 60
    });

    expect(totals.salesAmount).toBe(560);
    expect(totals.bundleDiscountAmount).toBe(60);
    expect(totals.discountAmount).toBe(50);
    expect(totals.receivableAmount).toBe(450);
  });
});

describe("calculateBundleDiscount", () => {
  const bundles = [
    {
      id: "bundle-1",
      name: "袋裝任選",
      productIds: ["p-280", "p-320"],
      tiers: [
        { quantity: 2, price: 500 },
        { quantity: 4, price: 900 }
      ]
    }
  ];

  it("prefers the biggest tier and prices leftovers at unit price", () => {
    // 5 件(320x2 + 280x3):4件900 一組(單價合計 1200 → 折 300),剩 1 件原價
    const result = calculateBundleDiscount(
      [
        { productId: "p-320", unitPrice: 320, quantity: 2 },
        { productId: "p-280", unitPrice: 280, quantity: 3 }
      ],
      bundles
    );

    expect(result.totalDiscount).toBe(300);
    expect(result.applied[0].sets).toEqual([{ quantity: 4, price: 900, discount: 300 }]);
  });

  it("falls back to smaller tiers when the big tier cannot be formed", () => {
    // 2 件 280:2件500(合計 560 → 折 60)
    const result = calculateBundleDiscount(
      [{ productId: "p-280", unitPrice: 280, quantity: 2 }],
      bundles
    );

    expect(result.totalDiscount).toBe(60);
  });

  it("skips bundles that would cost more than unit prices", () => {
    // 2 件 200 元商品:2件500 反而變貴 → 不套用
    const result = calculateBundleDiscount(
      [{ productId: "p-280", unitPrice: 200, quantity: 2 }],
      [
        {
          id: "bundle-1",
          name: "袋裝任選",
          productIds: ["p-280"],
          tiers: [{ quantity: 2, price: 500 }]
        }
      ]
    );

    expect(result.totalDiscount).toBe(0);
    expect(result.applied).toEqual([]);
  });

  it("picks the cheapest combination instead of stacking small tiers", () => {
    // 4 件 280:4件900(付 900)優於 2件500x2(付 1000)→ 折 1120-900=220
    const result = calculateBundleDiscount(
      [{ productId: "p-280", unitPrice: 280, quantity: 4 }],
      bundles
    );

    expect(result.totalDiscount).toBe(220);
    expect(result.applied[0].sets).toEqual([{ quantity: 4, price: 900, discount: 220 }]);
  });

  it("merges tiers from separate bundles that share the same product group", () => {
    // 2件500 與 4件900 分成兩筆組合設定,同商品群應合併計算 → 4 件套 4件900
    const result = calculateBundleDiscount(
      [{ productId: "p-280", unitPrice: 280, quantity: 4 }],
      [
        {
          id: "bundle-a",
          name: "2件優惠",
          productIds: ["p-280", "p-320"],
          tiers: [{ quantity: 2, price: 500 }]
        },
        {
          id: "bundle-b",
          name: "4件優惠",
          productIds: ["p-280", "p-320"],
          tiers: [{ quantity: 4, price: 900 }]
        }
      ]
    );

    expect(result.totalDiscount).toBe(220);
  });

  it("combines tiers when that beats a single tier (6 items → 4+2)", () => {
    // 6 件 280:4件900 + 2件500 = 1400,單價合計 1680 → 折 280
    const result = calculateBundleDiscount(
      [{ productId: "p-280", unitPrice: 280, quantity: 6 }],
      bundles
    );

    expect(result.totalDiscount).toBe(280);
    expect(result.applied[0].sets).toEqual([
      { quantity: 4, price: 900, discount: 220 },
      { quantity: 2, price: 500, discount: 60 }
    ]);
  });

  it("ignores products outside the bundle group", () => {
    const result = calculateBundleDiscount(
      [
        { productId: "p-280", unitPrice: 280, quantity: 1 },
        { productId: "other", unitPrice: 880, quantity: 1 }
      ],
      bundles
    );

    expect(result.totalDiscount).toBe(0);
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

  it("allows two staff on the same slot (shared shift) but flags a third", () => {
    const sharedShift = [
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
    ];

    expect(detectShiftConflicts(sharedShift)).toEqual([]);

    const withThird = [
      ...sharedShift,
      {
        id: "shift-3",
        staffId: "staff-3",
        counterId: "counter-a",
        date: "2026-07-05",
        shiftCode: "morning",
        startsAt: "10:00",
        endsAt: "16:00"
      }
    ];

    expect(detectShiftConflicts(withThird)).toEqual([
      {
        type: "duplicate_counter_shift",
        shiftIds: ["shift-1", "shift-3"],
        message: "同一櫃位在 2026-07-05 的 morning 班別排超過 2 人"
      }
    ]);
  });
});
