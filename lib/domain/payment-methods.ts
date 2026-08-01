export type PaymentMethodOption = {
  code: string;
  name: string;
  isActive: boolean;
  sortOrder: number;
};

export const defaultPaymentMethods: PaymentMethodOption[] = [
  { code: "cash", name: "現金", isActive: true, sortOrder: 10 },
  { code: "credit_card", name: "信用卡", isActive: true, sortOrder: 20 },
  { code: "mobile_payment", name: "行動支付", isActive: true, sortOrder: 30 },
  { code: "easycard", name: "悠遊卡", isActive: true, sortOrder: 40 },
  { code: "transfer", name: "轉帳", isActive: true, sortOrder: 50 }
];

const legacyLabels: Record<string, string> = {
  line_pay: "行動支付",
  jkopay: "行動支付"
};

export function resolvePaymentLabel(
  code: string,
  methods: ReadonlyArray<Pick<PaymentMethodOption, "code" | "name">>
) {
  return methods.find((method) => method.code === code)?.name ?? legacyLabels[code] ?? code;
}
