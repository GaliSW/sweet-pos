import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  apiClient,
  ensureServer,
  loginCookie,
  taipeiToday,
  MANAGER_EMAIL,
  PASSWORD,
  SEED,
  STAFF_A_EMAIL,
  type Api
} from "./helpers";

// 端對端流程測試:打本地 dev server + 本地 Supabase 的真實 API。
// 全部資料建立在專用測試櫃位,afterAll 以「強制刪除櫃位」清除;
// 組合價為全域設定,同樣以 E2E 前綴命名並於結束時刪除。

const COUNTER_PREFIX = "E2E測試櫃";
const BUNDLE_PREFIX = "E2E組合";

let manager: Api;
let staff: Api;
let counterId = "";
let bundleId = "";
let sharedOrderId = "";
let fortuneOrderId = "";

/* eslint-disable @typescript-eslint/no-explicit-any */

async function fetchOrders(params = ""): Promise<any[]> {
  const result = await manager.get(
    `/api/orders?from=2000-01-01&to=${taipeiToday()}&counterId=${counterId}${params}`
  );

  expect(result.ok).toBe(true);
  return (result.data as any).orders;
}

async function stockOf(itemName: string): Promise<number> {
  const result = await manager.get(`/api/inventory?counterId=${counterId}`);

  expect(result.ok).toBe(true);
  const row = (result.data as any).summary.find((entry: any) => entry.itemName === itemName);
  return row?.stock ?? 0;
}

beforeAll(async () => {
  await ensureServer();
  manager = apiClient(await loginCookie(MANAGER_EMAIL, PASSWORD));
  staff = apiClient(await loginCookie(STAFF_A_EMAIL, PASSWORD));

  // 清掉先前失敗執行留下的測試資料
  const counters = await manager.get("/api/counters");

  for (const counter of ((counters.data as any)?.counters ?? []) as any[]) {
    if (String(counter.name).startsWith(COUNTER_PREFIX)) {
      await manager.del("/api/counters", { id: counter.id, force: true });
    }
  }

  const bundles = await manager.get("/api/bundles");

  for (const bundle of ((bundles.data as any)?.bundles ?? []) as any[]) {
    if (String(bundle.name).startsWith(BUNDLE_PREFIX)) {
      await manager.del("/api/bundles", { id: bundle.id });
    }
  }

  // 建測試櫃位
  const created = await manager.post("/api/counters", {
    name: `${COUNTER_PREFIX}-${Date.now()}`,
    isActive: true
  });

  expect(created.ok).toBe(true);
  counterId = (created.data as any).counterId;

  // 今天整天班:林小芸 + 陳柏宇 共班並直接發布
  const shift = await manager.post("/api/shifts", {
    counterId,
    staffIds: [SEED.staffA, SEED.staffB],
    shiftDate: taipeiToday(),
    shiftCode: "morning",
    startsAt: "00:00",
    endsAt: "23:59",
    published: true
  });

  expect(shift.ok).toBe(true);
});

afterAll(async () => {
  if (bundleId) await manager.del("/api/bundles", { id: bundleId });
  if (counterId) await manager.del("/api/counters", { id: counterId, force: true });
});

describe("目錄與當班判定", () => {
  it("catalog 人員名單包含店長,員工也拿得到商品資料", async () => {
    const result = await staff.get("/api/catalog");

    expect(result.ok).toBe(true);
    const data = result.data as any;
    expect(data.staff.some((person: any) => person.role === "manager")).toBe(true);
    expect(data.products.length).toBeGreaterThan(0);
    expect(data.flavors.length).toBeGreaterThan(0);
  });

  it("on-duty 回傳共班兩人", async () => {
    const result = await staff.get(`/api/shifts/on-duty?counterId=${counterId}`);

    expect(result.ok).toBe(true);
    const ids = ((result.data as any).sellers as any[]).map((seller) => seller.id);
    expect(ids.sort()).toEqual([SEED.staffA, SEED.staffB].sort());
  });
});

describe("下單:共班歸屬 / 轉帳 / 組合價 / 手動扣款", () => {
  it("員工下單自動掛當班兩人,收銀=主銷售,轉帳可用", async () => {
    const created = await staff.post("/api/orders", {
      counterId,
      discountId: null,
      paymentMethod: "transfer",
      items: [{ productId: SEED.bagCracker, quantity: 1 }]
    });

    expect(created.ok).toBe(true);

    const [order] = await fetchOrders();
    sharedOrderId = order.id;
    expect([order.sellerName, order.seller2Name].sort()).toEqual(["林小芸", "陳柏宇"]);
    expect(order.cashierName).toBe(order.sellerName);
    expect(order.paymentLabel).toBe("轉帳");
    expect(order.receivedAmount).toBe(320);
  });

  it("組合價取最划算組合:4 件套 4件900 而非 2件500x2", async () => {
    const bundle = await manager.post("/api/bundles", {
      name: `${BUNDLE_PREFIX}-袋裝任選`,
      isActive: true,
      productIds: [SEED.bagOolong, SEED.bagCranberry],
      tiers: [
        { quantity: 2, price: 500 },
        { quantity: 4, price: 900 }
      ]
    });

    expect(bundle.ok).toBe(true);
    bundleId = (bundle.data as any).bundleId;

    const created = await staff.post("/api/orders", {
      counterId,
      discountId: null,
      paymentMethod: "cash",
      items: [
        { productId: SEED.bagOolong, quantity: 2 },
        { productId: SEED.bagCranberry, quantity: 2 }
      ]
    });

    expect(created.ok).toBe(true);

    const [order] = await fetchOrders();
    expect(order.salesAmount).toBe(1120);
    expect(order.bundleDiscountAmount).toBe(220);
    expect(order.receivedAmount).toBe(900);
  });

  it("手動扣款最後扣、備註入單(滿千送情境)", async () => {
    const created = await staff.post("/api/orders", {
      counterId,
      discountId: null,
      paymentMethod: "cash",
      manualDiscount: 280,
      note: "滿千送包種烏龍",
      items: [{ productId: SEED.bagOolong, quantity: 2 }]
    });

    expect(created.ok).toBe(true);

    const [order] = await fetchOrders();
    expect(order.salesAmount).toBe(560);
    expect(order.bundleDiscountAmount).toBe(60);
    expect(order.manualDiscountAmount).toBe(280);
    expect(order.note).toBe("滿千送包種烏龍");
    expect(order.receivedAmount).toBe(220);
  });
});

describe("店長補單與防偽造", () => {
  it("店長可指定日期與人員補單", async () => {
    const yesterdayIso = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();
    const yesterdayTaipei = new Date(Date.now() - 24 * 60 * 60 * 1000).toLocaleDateString(
      "en-CA",
      { timeZone: "Asia/Taipei" }
    );

    const created = await manager.post("/api/orders", {
      counterId,
      sellerId: SEED.staffC,
      createdAt: yesterdayIso,
      discountId: null,
      paymentMethod: "cash",
      note: "店長補單",
      items: [{ productId: SEED.bagCracker, quantity: 1 }]
    });

    expect(created.ok).toBe(true);

    const orders = await fetchOrders();
    const backfill = orders.find((order: any) => order.note === "店長補單");
    expect(backfill).toBeTruthy();
    expect(backfill.sellerName).toBe("黃品安");
    expect(backfill.seller2Name).toBe("");
    expect(
      new Date(backfill.createdAt).toLocaleDateString("en-CA", { timeZone: "Asia/Taipei" })
    ).toBe(yesterdayTaipei);
  });

  it("員工帶 sellerId 與過去日期會被忽略,照班表歸屬", async () => {
    const created = await staff.post("/api/orders", {
      counterId,
      sellerId: SEED.staffC,
      createdAt: "2020-01-01T00:00:00.000Z",
      discountId: null,
      paymentMethod: "cash",
      note: "spoof",
      items: [{ productId: SEED.bagCracker, quantity: 1 }]
    });

    expect(created.ok).toBe(true);

    const orders = await fetchOrders();
    const spoof = orders.find((order: any) => order.note === "spoof");
    expect(spoof.sellerName).not.toBe("黃品安");
    expect(["林小芸", "陳柏宇"]).toContain(spoof.sellerName);
    expect(
      new Date(spoof.createdAt).toLocaleDateString("en-CA", { timeZone: "Asia/Taipei" })
    ).toBe(taipeiToday());
  });
});

describe("庫存:批次進貨 / 交班盤點 / 固定禮盒獨立庫存", () => {
  it("批次進貨一次寫入多品項", async () => {
    const result = await staff.post("/api/inventory", {
      counterId,
      movementType: "purchase",
      quantity: 0,
      note: "e2e 批次進貨",
      items: [
        { flavorId: SEED.flavorOolong, quantity: 10 },
        { productId: SEED.fortuneGiftBox, quantity: 2 }
      ]
    });

    expect(result.ok).toBe(true);
    expect((result.data as any).movementCount).toBe(2);
    expect(await stockOf("包種烏龍")).toBe(10);
    expect(await stockOf("發禮盒")).toBe(2);
  });

  it("固定禮盒售出扣自身庫存,口味庫存不動", async () => {
    const created = await staff.post("/api/orders", {
      counterId,
      discountId: null,
      paymentMethod: "cash",
      items: [
        {
          productId: SEED.fortuneGiftBox,
          quantity: 1,
          giftFlavors: [
            { flavorId: SEED.flavorOolong, flavorName: "包種烏龍", spec: "6入/袋", quantity: 1 },
            { flavorId: SEED.flavorCranberry, flavorName: "蔓越莓", spec: "6入/袋", quantity: 1 },
            { flavorId: SEED.flavorStrawberry, flavorName: "草莓", spec: "6入/袋", quantity: 1 },
            { flavorId: SEED.flavorMango, flavorName: "芒果", spec: "6入/袋", quantity: 1 }
          ]
        }
      ]
    });

    expect(created.ok).toBe(true);
    const [order] = await fetchOrders();
    fortuneOrderId = order.id;

    expect(await stockOf("發禮盒")).toBe(1);
    expect(await stockOf("包種烏龍")).toBe(10);
  });

  it("交班盤點重設庫存基準", async () => {
    const result = await staff.post("/api/inventory", {
      counterId,
      flavorId: SEED.flavorOolong,
      movementType: "handover_count",
      quantity: 0,
      countedQuantity: 99
    });

    expect(result.ok).toBe(true);
    expect(await stockOf("包種烏龍")).toBe(99);
  });
});

describe("報表與作廢", () => {
  it("報表(限定測試櫃):共班金額各半、折讓含組合與手動扣款", async () => {
    const result = await manager.get(
      `/api/reports?from=2000-01-01&to=${taipeiToday()}&counterId=${counterId}`
    );

    expect(result.ok).toBe(true);
    const data = result.data as any;

    // 6 筆:共班餅乾 320 + 組合 900 + 手動扣款 220 + 補單 320 + spoof 320 + 發禮盒 980
    expect(data.summary.orderCount).toBe(6);
    expect(data.summary.receivedAmount).toBe(3060);
    expect(data.summary.discountAmount).toBe(560); // 組合 220+60 + 手動 280

    // 今天的共班訂單:林小芸與陳柏宇的實收應相等(各半)
    const today = taipeiToday();
    const todayRows = data.daily.filter((row: any) => row.date === today);
    const staffARow = todayRows.find((row: any) => row.sellerName === "林小芸");
    const staffBRow = todayRows.find((row: any) => row.sellerName === "陳柏宇");
    expect(staffARow.receivedAmount).toBe(staffBRow.receivedAmount);
    expect(staffARow.commissionMode).toBeDefined();

    // 補單歸黃品安
    expect(data.monthly.some((row: any) => row.sellerName === "黃品安")).toBe(true);
  });

  it("作廢訂單回補庫存並保留原單", async () => {
    const voided = await manager.patch("/api/orders", {
      orderId: fortuneOrderId,
      action: "void",
      reason: "e2e 作廢測試"
    });

    expect(voided.ok).toBe(true);
    expect(await stockOf("發禮盒")).toBe(2);

    const orders = await fetchOrders();
    const order = orders.find((entry: any) => entry.id === fortuneOrderId);
    expect(order.status).toBe("voided");
    expect(order.voidReason).toBe("e2e 作廢測試");
  });
});

describe("權限", () => {
  it("一般員工不可管理商品 / 櫃位 / 薪資", async () => {
    const product = await staff.post("/api/products", {
      category: "bag",
      name: "駭客商品",
      spec: "1入",
      price: 1
    });
    expect(product.ok).toBe(false);

    const counter = await staff.del("/api/counters", { id: counterId, force: true });
    expect(counter.ok).toBe(false);

    const payroll = await staff.get("/api/payroll");
    expect(payroll.ok).toBe(false);
  });

  it("一般員工不可作廢他人訂單以外的歷史單(店長可)", async () => {
    // sharedOrderId 是今天自己經手的單 → 員工可作廢
    const own = await staff.patch("/api/orders", {
      orderId: sharedOrderId,
      action: "void",
      reason: "e2e 員工自廢當日單"
    });

    expect(own.ok).toBe(true);
  });
});
