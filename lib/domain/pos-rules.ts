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
  discountAmount: number;
  receivableAmount: number;
  receivedAmount: number;
};

export function calculateOrderTotals(input: {
  items: OrderLineInput[];
  discount?: Discount | null;
}): OrderTotals {
  const salesAmount = roundCurrency(
    input.items.reduce((total, item) => total + item.unitPrice * item.quantity, 0)
  );
  const discountAmount = calculateDiscountAmount(salesAmount, input.discount);
  const receivableAmount = Math.max(0, roundCurrency(salesAmount - discountAmount));

  return {
    salesAmount,
    discountAmount,
    receivableAmount,
    receivedAmount: receivableAmount
  };
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

  for (let index = 0; index < shifts.length; index += 1) {
    for (let compareIndex = index + 1; compareIndex < shifts.length; compareIndex += 1) {
      const first = shifts[index];
      const second = shifts[compareIndex];

      if (
        first.counterId === second.counterId &&
        first.date === second.date &&
        first.shiftCode != null &&
        first.shiftCode === second.shiftCode
      ) {
        conflicts.push({
          type: "duplicate_counter_shift",
          shiftIds: [first.id, second.id],
          message: `同一櫃位在 ${first.date} 的 ${first.shiftCode} 班別重複排班`
        });
      }

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
