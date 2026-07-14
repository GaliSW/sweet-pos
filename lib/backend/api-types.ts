export type GiftFlavorInput = {
  flavorId: string | null;
  flavorName: string;
  spec: string;
  quantity: number;
};

export type CreateOrderItemInput = {
  productId: string;
  quantity: number;
  giftFlavors?: GiftFlavorInput[];
};

export type CreateOrderInput = {
  counterId: string;
  sellerId: string;
  cashierId?: string;
  discountId: string | null;
  paymentMethod: "cash" | "credit_card" | "line_pay" | "jkopay";
  items: CreateOrderItemInput[];
};

export type ApiResult<T> =
  | {
      ok: true;
      data: T;
    }
  | {
      ok: false;
      error: string;
    };

export type InventoryMovementType =
  | "opening_count"
  | "closing_count"
  | "purchase"
  | "sampling"
  | "waste"
  | "adjustment"
  | "sale";

export type CreateInventoryMovementInput = {
  counterId: string;
  productId?: string | null;
  flavorId?: string | null;
  movementType: InventoryMovementType;
  quantity: number;
  countedQuantity?: number | null;
  note?: string;
  createdBy?: string;
};

export type UpdateInventoryMovementInput = {
  movementId: string;
  action?: "update" | "review";
  movementType?: InventoryMovementType;
  quantity?: number;
  countedQuantity?: number | null;
  note?: string;
};

export type ShiftCode = "morning" | "evening";

export type UpsertShiftInput = {
  counterId: string;
  staffId: string | null;
  shiftDate: string;
  shiftCode: ShiftCode;
  startsAt: string;
  endsAt: string;
  published?: boolean;
};

export type PublishShiftsInput = {
  month: string;
  counterId?: string | null;
};

export type ApplyPreviousScheduleInput = {
  counterId: string;
  month: string;
};

export type DailyPerformanceRow = {
  date: string;
  sellerId: string;
  sellerName: string;
  counterId: string;
  counterName: string;
  orderCount: number;
  salesAmount: number;
  discountAmount: number;
  receivedAmount: number;
  commission: number;
};

export type MonthlyPerformanceRow = {
  month: string;
  sellerId: string;
  sellerName: string;
  orderCount: number;
  salesAmount: number;
  discountAmount: number;
  receivedAmount: number;
  commission: number;
};

export type ReportSummary = {
  orderCount: number;
  salesAmount: number;
  discountAmount: number;
  receivedAmount: number;
  averageOrderValue: number;
};

export type CounterTargetRow = {
  counterId: string;
  counterName: string;
  month: string;
  targetAmount: number;
  achievedAmount: number;
  achievementRate: number;
};

export type PayrollRow = {
  staffId: string;
  staffName: string;
  hourlyWage: number;
  shiftCount: number;
  scheduledHours: number;
  basePay: number;
  commission: number;
  estimatedTotal: number;
};

export type UpsertProductInput = {
  id?: string;
  category: "bag" | "gift_box";
  name: string;
  spec: string;
  price: number;
  isActive?: boolean;
  isPopular?: boolean;
  giftRule?: {
    selectionMode: "select" | "fixed";
    requiredFlavorCount?: number;
    includesScallionCracker?: boolean;
  } | null;
};

export type UpsertDiscountInput = {
  id?: string;
  name: string;
  discountType: "percentage" | "fixed_amount";
  value: number;
  minOrderAmount?: number | null;
  isActive?: boolean;
};

export type UpsertStaffInput = {
  id?: string;
  email?: string;
  password?: string;
  displayName: string;
  role: "staff" | "manager";
  hourlyWage: number;
  isActive?: boolean;
};

export type UpsertCounterInput = {
  id?: string;
  name: string;
  location?: string | null;
  isActive?: boolean;
  monthlyTarget?: {
    month: string;
    targetAmount: number;
  } | null;
};
