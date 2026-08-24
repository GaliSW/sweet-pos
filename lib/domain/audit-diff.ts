// 後台稽核紀錄的變更明細計算。UI 與測試共用同一份邏輯,不放任何 I/O。

export type AuditAction = "create" | "update" | "delete";

export type AuditFieldChange = {
  field: string;
  label: string;
  before: string | null;
  after: string | null;
};

const ENTITY_LABELS: Record<string, string> = {
  products: "商品",
  flavors: "口味",
  bundles: "組合價",
  discounts: "折扣",
  counters: "櫃位",
  profiles: "員工",
  payment_methods: "付款方式",
  commission_tiers: "抽成"
};

const FIELD_LABELS: Record<string, string> = {
  // 共用
  name: "名稱",
  spec: "規格",
  price: "價格",
  is_active: "啟用",
  sort_order: "排序",
  created_at: "建立時間",
  updated_at: "更新時間",
  // products
  category: "類別",
  is_popular: "熱門",
  stock_source_product_id: "庫存來源商品",
  giftRule: "禮盒規則",
  // bundles
  productIds: "商品",
  tiers: "級距",
  // discounts
  discount_type: "折扣類型",
  value: "折扣值",
  min_order_amount: "最低消費",
  // counters
  location: "地點",
  monthlyTargets: "月目標",
  // profiles
  display_name: "姓名",
  role: "角色",
  salary_type: "薪資類型",
  hourly_wage: "時薪",
  monthly_salary: "月薪",
  commission_mode: "抽成模式",
  // commission
  commissionMode: "抽成模式",
  // payment_methods
  code: "代碼"
};

export function auditEntityLabel(entity: string): string {
  return ENTITY_LABELS[entity] ?? entity;
}

export function auditFieldLabel(field: string): string {
  return FIELD_LABELS[field] ?? field;
}

export function formatAuditValue(value: unknown): string | null {
  if (value === null || value === undefined) return null;
  if (typeof value === "boolean") return value ? "是" : "否";
  if (typeof value === "number") return String(value);
  if (typeof value === "string") return value;

  return JSON.stringify(value);
}

function isNumericLike(value: unknown): boolean {
  if (typeof value === "number") return Number.isFinite(value);
  if (typeof value !== "string") return false;

  return value.trim() !== "" && Number.isFinite(Number(value));
}

// 鍵順序無關的深層序列化,用來比對巢狀物件與陣列。
function stableStringify(value: unknown): string {
  if (value === null || value === undefined) return "null";
  if (Array.isArray(value)) return `[${value.map(stableStringify).join(",")}]`;

  if (typeof value === "object") {
    const entries = Object.entries(value as Record<string, unknown>)
      .filter(([, entryValue]) => entryValue !== undefined)
      .sort(([left], [right]) => (left < right ? -1 : left > right ? 1 : 0));

    return `{${entries
      .map(([key, entryValue]) => `${JSON.stringify(key)}:${stableStringify(entryValue)}`)
      .join(",")}}`;
  }

  return JSON.stringify(value);
}

export function auditValuesEqual(left: unknown, right: unknown): boolean {
  if (left === null || left === undefined) return right === null || right === undefined;
  if (right === null || right === undefined) return false;

  // Postgres numeric 經 PostgREST 可能回字串(如 "450.00"),與程式端的 450 是同一個值。
  // 只在其中一邊確實是 number 時才做數值比對,避免把 "0050" 與 "50" 誤判成相同名稱。
  if (typeof left === "number" || typeof right === "number") {
    if (isNumericLike(left) && isNumericLike(right)) {
      return Number(left) === Number(right);
    }
  }

  return stableStringify(left) === stableStringify(right);
}

function toRecord(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) return {};

  return value as Record<string, unknown>;
}

export function diffRecords(before: unknown, after: unknown): AuditFieldChange[] {
  const beforeRecord = toRecord(before);
  const afterRecord = toRecord(after);
  const fields = Array.from(
    new Set([...Object.keys(beforeRecord), ...Object.keys(afterRecord)])
  ).sort();
  const changes: AuditFieldChange[] = [];

  for (const field of fields) {
    const beforeValue = beforeRecord[field] ?? null;
    const afterValue = afterRecord[field] ?? null;

    if (auditValuesEqual(beforeValue, afterValue)) continue;

    changes.push({
      field,
      label: auditFieldLabel(field),
      before: formatAuditValue(beforeValue),
      after: formatAuditValue(afterValue)
    });
  }

  return changes;
}
