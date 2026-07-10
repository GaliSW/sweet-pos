export const staffNavItems = [
  { href: "/pos", label: "POS" },
  { href: "/staff/orders", label: "訂單" },
  { href: "/staff/schedule", label: "我的班表" },
  { href: "/staff/inventory", label: "庫存" }
] as const;

export const managerNavLinks = [
  { href: "/manager", label: "總覽" },
  { href: "/manager/reports", label: "報表" },
  { href: "/manager/orders", label: "訂單" },
  { href: "/manager/schedule", label: "排班" },
  { href: "/manager/payroll", label: "薪資" },
  { href: "/manager/inventory", label: "庫存" },
  { href: "/manager/products", label: "商品" },
  { href: "/manager/counters", label: "櫃位" },
  { href: "/manager/staff", label: "員工" }
] as const;
