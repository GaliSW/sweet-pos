export type Discount =
  | {
      type: "percentage";
      value: number;
      minOrderAmount?: number | null;
    }
  | {
      type: "fixed_amount";
      value: number;
      minOrderAmount?: number | null;
    };

export type OrderLineInput = {
  unitPrice: number;
  quantity: number;
};

export type OrderTotals = {
  salesAmount: number;
  bundleDiscountAmount: number;
  discountAmount: number;
  receivableAmount: number;
  receivedAmount: number;
};

export function calculateOrderTotals(input: {
  items: OrderLineInput[];
  discount?: Discount | null;
  // 組合價折抵(先扣組合折抵,訂單折扣以組合後金額計算)
  bundleDiscount?: number;
}): OrderTotals {
  const salesAmount = roundCurrency(
    input.items.reduce((total, item) => total + item.unitPrice * item.quantity, 0)
  );
  const bundleDiscountAmount = Math.min(
    salesAmount,
    Math.max(0, roundCurrency(input.bundleDiscount ?? 0))
  );
  const discountAmount = calculateDiscountAmount(
    roundCurrency(salesAmount - bundleDiscountAmount),
    input.discount
  );
  const receivableAmount = Math.max(
    0,
    roundCurrency(salesAmount - bundleDiscountAmount - discountAmount)
  );

  return {
    salesAmount,
    bundleDiscountAmount,
    discountAmount,
    receivableAmount,
    receivedAmount: receivableAmount
  };
}

export type BundleTier = {
  quantity: number;
  price: number;
};

export type BundleDefinition = {
  id: string;
  name: string;
  productIds: string[];
  tiers: BundleTier[];
};

export type BundleLineInput = {
  productId: string;
  unitPrice: number;
  quantity: number;
};

export type AppliedBundleSet = {
  quantity: number;
  price: number;
  discount: number;
};

export type AppliedBundle = {
  bundleId: string;
  name: string;
  sets: AppliedBundleSet[];
  discount: number;
};

// 組合價(指定商品群任選 N 件 $X):同群商品件數自動湊組,大組合優先、
// 單價高的先入組(對客人最划算);湊不成組或組合價沒有比較便宜的部分照單價計。
// 回傳總折抵與套用明細;每件商品只會被一個組合使用一次。
export function calculateBundleDiscount(
  items: BundleLineInput[],
  bundles: BundleDefinition[]
): { totalDiscount: number; applied: AppliedBundle[] } {
  const units = items.flatMap((item) =>
    Array.from({ length: Math.max(0, Math.floor(item.quantity)) }, () => ({
      productId: item.productId,
      unitPrice: item.unitPrice,
      used: false
    }))
  );
  const applied: AppliedBundle[] = [];
  let totalDiscount = 0;

  for (const bundle of bundles) {
    if (bundle.tiers.length === 0 || bundle.productIds.length === 0) continue;

    const productSet = new Set(bundle.productIds);
    const candidates = units
      .filter((unit) => !unit.used && productSet.has(unit.productId))
      .sort((left, right) => right.unitPrice - left.unitPrice);
    const tiers = [...bundle.tiers].sort((left, right) => right.quantity - left.quantity);
    const sets: AppliedBundleSet[] = [];
    let cursor = 0;

    for (const tier of tiers) {
      while (candidates.length - cursor >= tier.quantity) {
        const chunk = candidates.slice(cursor, cursor + tier.quantity);
        const unitSum = roundCurrency(
          chunk.reduce((total, unit) => total + unit.unitPrice, 0)
        );
        const discount = roundCurrency(unitSum - tier.price);

        if (discount <= 0) break;

        chunk.forEach((unit) => {
          unit.used = true;
        });
        cursor += tier.quantity;
        sets.push({ quantity: tier.quantity, price: tier.price, discount });
        totalDiscount = roundCurrency(totalDiscount + discount);
      }
    }

    if (sets.length > 0) {
      applied.push({
        bundleId: bundle.id,
        name: bundle.name,
        sets,
        discount: roundCurrency(sets.reduce((total, set) => total + set.discount, 0))
      });
    }
  }

  return { totalDiscount, applied };
}

export function calculateDiscountAmount(
  salesAmount: number,
  discount?: Discount | null
): number {
  if (!discount) return 0;
  if (discount.minOrderAmount != null && salesAmount < discount.minOrderAmount) {
    return 0;
  }

  if (discount.type === "percentage") {
    return roundCurrency(salesAmount * (1 - discount.value));
  }

  return roundCurrency(Math.min(salesAmount, discount.value));
}

export type GiftBoxSelectionInput = {
  name: string;
  mode: "select" | "fixed";
  requiredFlavorCount?: number;
  includesScallionCracker?: boolean;
  selectedFlavors?: string[];
  fixedFlavors?: string[];
};

export type GiftBoxSelectionResult =
  | {
      valid: true;
      includedItems: string[];
    }
  | {
      valid: false;
      message: string;
    };

export function validateGiftBoxSelection(
  input: GiftBoxSelectionInput
): GiftBoxSelectionResult {
  if (input.mode === "fixed") {
    return {
      valid: true,
      includedItems: formatFlavorItems(input.fixedFlavors ?? [])
    };
  }

  const selectedFlavors = input.selectedFlavors ?? [];
  const requiredFlavorCount = input.requiredFlavorCount ?? 0;

  if (selectedFlavors.length !== requiredFlavorCount) {
    return {
      valid: false,
      message: `${input.name}需要選擇 ${requiredFlavorCount} 個口味`
    };
  }

  const includedItems = formatFlavorItems(selectedFlavors);

  if (input.includesScallionCracker) {
    includedItems.push("經典原味蔥軋餅 9入/袋");
  }

  return {
    valid: true,
    includedItems
  };
}

export function calculateDailyCommission(dailySales: number): number {
  if (dailySales > 5000) return Math.round(dailySales * 0.02);
  if (dailySales >= 3000) return Math.round(dailySales * 0.01);
  return 0;
}

export type CommissionTier = {
  minDailySales: number;
  rate: number;
};

export const defaultCommissionTiers: CommissionTier[] = [
  { minDailySales: 3000, rate: 0.01 },
  { minDailySales: 5001, rate: 0.02 }
];

export function calculateCommissionByTiers(
  dailySales: number,
  tiers: CommissionTier[]
): number {
  const tier = [...tiers]
    .sort((left, right) => right.minDailySales - left.minDailySales)
    .find((candidate) => dailySales >= candidate.minDailySales);

  return tier ? Math.round(dailySales * tier.rate) : 0;
}

export type ShiftInput = {
  id: string;
  staffId: string;
  counterId: string;
  date: string;
  shiftCode?: string;
  startsAt: string;
  endsAt: string;
};

export type ShiftConflict =
  | {
      type: "staff_overlap";
      shiftIds: [string, string];
      message: string;
    }
  | {
      type: "duplicate_counter_shift";
      shiftIds: [string, string];
      message: string;
    };

export function detectShiftConflicts(shifts: ShiftInput[]): ShiftConflict[] {
  const conflicts: ShiftConflict[] = [];

  // 共班允許同櫃同班段 2 人;超過 2 人才視為排班衝突。
  const slotShifts = new Map<string, ShiftInput[]>();

  for (const shift of shifts) {
    if (shift.shiftCode == null) continue;

    const key = `${shift.counterId}|${shift.date}|${shift.shiftCode}`;
    const list = slotShifts.get(key) ?? [];
    list.push(shift);
    slotShifts.set(key, list);
  }

  for (const list of slotShifts.values()) {
    if (list.length > 2) {
      conflicts.push({
        type: "duplicate_counter_shift",
        shiftIds: [list[0].id, list[2].id],
        message: `同一櫃位在 ${list[0].date} 的 ${list[0].shiftCode} 班別排超過 2 人`
      });
    }
  }

  for (let index = 0; index < shifts.length; index += 1) {
    for (let compareIndex = index + 1; compareIndex < shifts.length; compareIndex += 1) {
      const first = shifts[index];
      const second = shifts[compareIndex];

      if (
        first.staffId === second.staffId &&
        first.date === second.date &&
        timeRangesOverlap(first.startsAt, first.endsAt, second.startsAt, second.endsAt)
      ) {
        conflicts.push({
          type: "staff_overlap",
          shiftIds: [first.id, second.id],
          message: `同一員工在 ${first.date} 有重疊班次`
        });
      }
    }
  }

  return conflicts;
}

function formatFlavorItems(flavors: string[]): string[] {
  return flavors.map((flavor) => `${flavor} 6入/袋`);
}

function timeRangesOverlap(
  firstStart: string,
  firstEnd: string,
  secondStart: string,
  secondEnd: string
): boolean {
  const startA = timeToMinutes(firstStart);
  const endA = timeToMinutes(firstEnd);
  const startB = timeToMinutes(secondStart);
  const endB = timeToMinutes(secondEnd);

  return startA < endB && startB < endA;
}

function timeToMinutes(time: string): number {
  const [hours, minutes] = time.split(":").map(Number);
  return hours * 60 + minutes;
}

function roundCurrency(value: number): number {
  return Math.round((value + Number.EPSILON) * 100) / 100;
}
