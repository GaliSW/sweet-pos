export type ProductCategory = "bag" | "gift_box";

export type Product = {
  id: string;
  category: ProductCategory;
  name: string;
  spec: string;
  price: number;
  popular?: boolean;
  giftRule?: {
    mode: "select" | "fixed";
    requiredFlavorCount?: number;
    includesScallionCracker?: boolean;
    // 可選口味(空或未設定 = 全部口味可選)
    allowedFlavorIds?: string[];
    fixedFlavors?: string[];
    fixedFlavorItems?: Array<{
      flavorId: string | null;
      flavorName: string;
      spec: string;
      quantity: number;
    }>;
  };
};

export type DiscountOption = {
  id: string;
  name: string;
  type: "percentage" | "fixed_amount";
  value: number;
  minOrderAmount?: number;
};

export const flavors = [
  "包種烏龍",
  "蔓越莓",
  "草莓",
  "芒果",
  "經典原味",
  "黑芝麻",
  "咖啡",
  "抹茶",
  "可可",
  "花生"
];

export const products: Product[] = [
  {
    id: "00000000-0000-4000-8000-000000000101",
    category: "bag",
    name: "包種烏龍牛軋糖",
    spec: "10入/袋",
    price: 280,
    popular: true
  },
  {
    id: "00000000-0000-4000-8000-000000000102",
    category: "bag",
    name: "蔓越莓牛軋糖",
    spec: "10入/袋",
    price: 280,
    popular: true
  },
  {
    id: "00000000-0000-4000-8000-000000000103",
    category: "bag",
    name: "經典原味牛軋餅",
    spec: "10入/袋",
    price: 320
  },
  {
    id: "00000000-0000-4000-8000-000000000104",
    category: "bag",
    name: "經典原味蔥軋餅",
    spec: "9入/袋",
    price: 320,
    popular: true
  },
  {
    id: "00000000-0000-4000-8000-000000000201",
    category: "gift_box",
    name: "小禮盒",
    spec: "自選 3 袋",
    price: 880,
    popular: true,
    giftRule: {
      mode: "select",
      requiredFlavorCount: 3
    }
  },
  {
    id: "00000000-0000-4000-8000-000000000202",
    category: "gift_box",
    name: "大禮盒",
    spec: "自選 8 袋 + 蔥餅",
    price: 1680,
    giftRule: {
      mode: "select",
      requiredFlavorCount: 8,
      includesScallionCracker: true
    }
  },
  {
    id: "00000000-0000-4000-8000-000000000203",
    category: "gift_box",
    name: "發禮盒",
    spec: "固定 4 袋",
    price: 980,
    giftRule: {
      mode: "fixed",
      fixedFlavors: ["包種烏龍", "蔓越莓", "草莓", "芒果"]
    }
  },
  {
    id: "00000000-0000-4000-8000-000000000204",
    category: "gift_box",
    name: "財禮盒",
    spec: "固定 4 袋",
    price: 1180,
    giftRule: {
      mode: "fixed",
      fixedFlavors: ["經典原味", "黑芝麻", "咖啡", "抹茶"]
    }
  }
];

export const discounts: DiscountOption[] = [
  {
    id: "none",
    name: "無折扣",
    type: "fixed_amount",
    value: 0
  },
  {
    id: "00000000-0000-4000-8000-000000000301",
    name: "會員 9 折",
    type: "percentage",
    value: 0.9
  },
  {
    id: "00000000-0000-4000-8000-000000000302",
    name: "滿千折百",
    type: "fixed_amount",
    value: 100,
    minOrderAmount: 1000
  }
];

export const currentShiftStaff = [
  { id: "00000000-0000-4000-8000-000000000001", name: "林小芸" },
  { id: "00000000-0000-4000-8000-000000000002", name: "陳柏宇" },
  { id: "00000000-0000-4000-8000-000000000003", name: "黃品安" }
];

export const counters = [
  {
    id: "00000000-0000-4000-8000-000000000401",
    name: "信義 A11",
    location: "台北市信義區"
  },
  {
    id: "00000000-0000-4000-8000-000000000402",
    name: "南西誠品",
    location: "台北市中山區"
  }
];

export const managerKpis = [
  { label: "今日總業績", value: "$38,640", trend: "+12% vs 昨日" },
  { label: "平均客單價", value: "$1,288", trend: "30 筆訂單" },
  { label: "實際金流", value: "$38,640", trend: "現金 42% / 電子 58%" },
  { label: "目標達成率", value: "76%", trend: "信義 A11 / 2026-07" }
];

export const staffShifts = [
  { date: "2026-07-05", code: "早班", time: "10:00-16:00", counter: "信義 A11" },
  { date: "2026-07-08", code: "晚班", time: "16:00-22:00", counter: "南西誠品" },
  { date: "2026-07-12", code: "早班", time: "10:00-16:00", counter: "信義 A11" }
];
