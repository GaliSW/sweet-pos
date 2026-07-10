"use client";

import { useEffect, useMemo, useState } from "react";

type CounterOption = {
  id: string;
  name: string;
};

type StaffOption = {
  id: string;
  name: string;
};

type DiscountOption = {
  id: string;
  name: string;
};

type GiftFlavor = {
  flavorId: string | null;
  flavorName: string;
  spec: string;
  quantity: number;
};

type OrderItem = {
  id: string;
  productId: string;
  productName: string;
  spec: string;
  unitPrice: number;
  quantity: number;
  lineTotal: number;
  giftFlavors: GiftFlavor[];
};

type PreorderItem = {
  itemName: string;
  spec: string;
  quantity: number;
};

type OrderRow = {
  id: string;
  orderNo: string;
  createdAt: string;
  counterId: string;
  counterName: string;
  sellerId: string;
  sellerName: string;
  cashierName: string;
  discountId: string | null;
  paymentMethod: string;
  paymentLabel: string;
  salesAmount: number;
  discountAmount: number;
  receivedAmount: number;
  status: "completed" | "voided";
  voidReason: string | null;
  voidedByName: string;
  editedByName: string;
  hasPreorder: boolean;
  preorderItems: PreorderItem[];
  canVoid: boolean;
  canEdit: boolean;
  items: OrderItem[];
};

type EditDraft = {
  orderId: string;
  orderNo: string;
  sellerId: string;
  discountId: string;
  paymentMethod: string;
  createdAt: string;
  items: Array<{
    productId: string;
    productName: string;
    spec: string;
    quantity: number;
    giftFlavors: GiftFlavor[];
  }>;
};

const crackerName = "經典原味蔥軋餅";

const paymentOptions = [
  { value: "cash", label: "現金" },
  { value: "credit_card", label: "信用卡" },
  { value: "line_pay", label: "LINE Pay" },
  { value: "jkopay", label: "街口支付" }
];

export function OrdersExplorer({ variant }: { variant: "manager" | "staff" }) {
  const today = new Date().toISOString().slice(0, 10);
  const [from, setFrom] = useState(`${today.slice(0, 7)}-01`);
  const [to, setTo] = useState(today);
  const [counterId, setCounterId] = useState("all");
  const [search, setSearch] = useState("");
  const [counters, setCounters] = useState<CounterOption[]>([]);
  const [staffOptions, setStaffOptions] = useState<StaffOption[]>([]);
  const [discountOptions, setDiscountOptions] = useState<DiscountOption[]>([]);
  const [bagProducts, setBagProducts] = useState<Array<{ id: string; name: string }>>([]);
  const [orders, setOrders] = useState<OrderRow[]>([]);
  const [detailOrder, setDetailOrder] = useState<OrderRow | null>(null);
  const [editDraft, setEditDraft] = useState<EditDraft | null>(null);
  const [status, setStatus] = useState("讀取訂單中...");
  const [working, setWorking] = useState(false);

  useEffect(() => {
    if (variant === "manager") void loadCatalog();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    void loadOrders();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [from, to, counterId]);

  const visibleOrders = useMemo(() => {
    const keyword = search.trim().toLowerCase();

    if (!keyword) return orders;

    return orders.filter((order) => {
      const haystack = [
        order.orderNo,
        order.counterName,
        order.sellerName,
        order.cashierName,
        order.paymentLabel,
        order.status === "voided" ? "已作廢" : "完成",
        order.voidReason ?? "",
        order.hasPreorder ? "預購" : "",
        ...order.items.map((item) => `${item.productName} ${item.spec}`),
        ...order.items.flatMap((item) => item.giftFlavors.map((flavor) => flavor.flavorName))
      ]
        .join(" ")
        .toLowerCase();

      return haystack.includes(keyword);
    });
  }, [orders, search]);

  async function loadCatalog() {
    const result = await fetch("/api/catalog")
      .then((response) => response.json())
      .catch(() => null);

    if (!result?.ok) return;

    setCounters(result.data.counters ?? []);
    setStaffOptions(
      (result.data.staff ?? []).map((staff: { id: string; display_name?: string; name?: string }) => ({
        id: staff.id,
        name: staff.display_name ?? staff.name ?? "未命名員工"
      }))
    );
    setDiscountOptions(
      (result.data.discounts ?? [])
        .filter((discount: { id: string }) => discount.id !== "none")
        .map((discount: { id: string; name: string }) => ({ id: discount.id, name: discount.name }))
    );
    setBagProducts(
      (result.data.products ?? [])
        .filter((product: { category: string }) => product.category === "bag")
        .map((product: { id: string; name: string }) => ({ id: product.id, name: product.name }))
    );
  }

  async function loadOrders() {
    setStatus("讀取訂單中...");
    const params = new URLSearchParams({ from, to });

    if (variant === "manager" && counterId !== "all") params.set("counterId", counterId);

    const response = await fetch(`/api/orders?${params.toString()}`);
    const result = await response.json();

    if (!result.ok) {
      setStatus(result.error);
      return;
    }

    setOrders(result.data.orders ?? []);
    setStatus(
      result.data.source === "supabase" ? `共 ${result.data.orders.length} 筆訂單` : "Demo 模式"
    );
  }

  async function voidOrder(order: OrderRow) {
    const reason = window.prompt(`作廢訂單 ${order.orderNo}，請輸入原因：`);

    if (!reason?.trim()) return;

    setWorking(true);
    const response = await fetch("/api/orders", {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ orderId: order.id, action: "void", reason: reason.trim() })
    });
    const result = await response.json();
    setWorking(false);

    if (!result.ok) {
      setStatus(result.error);
      return;
    }

    setStatus(`訂單 ${order.orderNo} 已作廢，庫存已回補`);
    await loadOrders();
  }

  function startEdit(order: OrderRow) {
    setEditDraft({
      orderId: order.id,
      orderNo: order.orderNo,
      sellerId: order.sellerId,
      discountId: order.discountId ?? "",
      paymentMethod: order.paymentMethod,
      createdAt: toDatetimeLocal(order.createdAt),
      items: order.items.map((item) => ({
        productId: item.productId,
        productName: item.productName,
        spec: item.spec,
        quantity: item.quantity,
        // 蔥軋餅是規則附贈,後端會自動補回,送出時不可重複帶入。
        giftFlavors: item.giftFlavors.filter(
          (flavor) => !(flavor.flavorId === null && flavor.flavorName === crackerName)
        )
      }))
    });
  }

  function updateDraftQuantity(index: number, quantity: number) {
    setEditDraft((current) => {
      if (!current) return current;

      const next = Math.max(0, Math.floor(Number.isFinite(quantity) ? quantity : 0));

      return {
        ...current,
        items: current.items
          .map((item, itemIndex) => (itemIndex === index ? { ...item, quantity: next } : item))
          .filter((item) => item.quantity > 0)
      };
    });
  }

  function addDraftProduct(productId: string) {
    const product = bagProducts.find((candidate) => candidate.id === productId);

    if (!product) return;

    setEditDraft((current) => {
      if (!current) return current;

      const existingIndex = current.items.findIndex(
        (item) => item.productId === productId && item.giftFlavors.length === 0
      );

      if (existingIndex >= 0) {
        return {
          ...current,
          items: current.items.map((item, index) =>
            index === existingIndex ? { ...item, quantity: item.quantity + 1 } : item
          )
        };
      }

      return {
        ...current,
        items: [
          ...current.items,
          { productId, productName: product.name, spec: "", quantity: 1, giftFlavors: [] }
        ]
      };
    });
  }

  async function saveEdit() {
    if (!editDraft) return;

    if (editDraft.items.length === 0) {
      setStatus("訂單至少需要一個商品，若要取消整筆訂單請改用作廢");
      return;
    }

    setWorking(true);
    const response = await fetch("/api/orders", {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        orderId: editDraft.orderId,
        action: "update",
        sellerId: editDraft.sellerId,
        discountId: editDraft.discountId || null,
        paymentMethod: editDraft.paymentMethod,
        createdAt: editDraft.createdAt ? new Date(editDraft.createdAt).toISOString() : null,
        items: editDraft.items.map((item) => ({
          productId: item.productId,
          quantity: item.quantity,
          giftFlavors: item.giftFlavors
        }))
      })
    });
    const result = await response.json();
    setWorking(false);

    if (!result.ok) {
      setStatus(result.error);
      return;
    }

    setStatus(`訂單 ${editDraft.orderNo} 已更新，金額與庫存已重算`);
    setEditDraft(null);
    await loadOrders();
  }

  return (
    <>
      <section className="section-title">
        <div>
          <h1>{variant === "manager" ? "訂單紀錄" : "我的訂單"}</h1>
          <p>
            {variant === "manager"
              ? "依日期與櫃位檢視訂單；店長可直接修改訂單內容或作廢。"
              : "查看自己經手的訂單。打錯的訂單可在當日作廢後重新結帳，歷史訂單請聯絡店長。"}
          </p>
        </div>
        <div className="toolbar">
          <label className="field compact">
            <span>起日</span>
            <input type="date" value={from} onChange={(event) => setFrom(event.target.value)} />
          </label>
          <label className="field compact">
            <span>迄日</span>
            <input type="date" value={to} onChange={(event) => setTo(event.target.value)} />
          </label>
          {variant === "manager" ? (
            <label className="field compact">
              <span>櫃位</span>
              <select value={counterId} onChange={(event) => setCounterId(event.target.value)}>
                <option value="all">全部</option>
                {counters.map((counter) => (
                  <option key={counter.id} value={counter.id}>
                    {counter.name}
                  </option>
                ))}
              </select>
            </label>
          ) : null}
          <label className="field compact">
            <span>搜尋</span>
            <input
              placeholder="單號 / 品項 / 人員 / 預購..."
              value={search}
              onChange={(event) => setSearch(event.target.value)}
            />
          </label>
          <span className="pill">{status}</span>
        </div>
      </section>

      <section className="panel data-card">
        <div className="table-scroll">
          <table>
            <thead>
              <tr>
                <th>時間</th>
                <th>單號</th>
                <th>櫃位</th>
                <th>明細</th>
                <th>銷售 / 收銀</th>
                <th>付款</th>
                <th>實收</th>
                <th>狀態</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {visibleOrders.map((order) => (
                <tr key={order.id}>
                  <td>{formatTime(order.createdAt)}</td>
                  <td>{order.orderNo}</td>
                  <td>{order.counterName}</td>
                  <td>
                    <button
                      className="as-link"
                      onClick={() => setDetailOrder(order)}
                      type="button"
                    >
                      {order.items.reduce((total, item) => total + item.quantity, 0)} 件（
                      {order.items.length} 項）
                    </button>
                  </td>
                  <td>
                    {order.sellerName}
                    {order.cashierName !== order.sellerName ? ` / ${order.cashierName}` : ""}
                  </td>
                  <td>{order.paymentLabel}</td>
                  <td>{formatCurrency(order.receivedAmount)}</td>
                  <td>
                    <span className={order.status === "voided" ? "status warn" : "status"}>
                      {order.status === "voided" ? "已作廢" : "完成"}
                    </span>{" "}
                    {order.hasPreorder ? <span className="status warn">含預購</span> : null}
                    {order.editedByName ? (
                      <span className="status">{order.editedByName} 改單</span>
                    ) : null}
                  </td>
                  <td>
                    <div className="toolbar">
                      {variant === "manager" && order.canEdit ? (
                        <button
                          className="secondary-action"
                          disabled={working}
                          onClick={() => startEdit(order)}
                          type="button"
                        >
                          編輯
                        </button>
                      ) : null}
                      {order.canVoid ? (
                        <button
                          className="secondary-action"
                          disabled={working}
                          onClick={() => voidOrder(order)}
                          type="button"
                        >
                          作廢
                        </button>
                      ) : null}
                    </div>
                  </td>
                </tr>
              ))}
              {visibleOrders.length === 0 ? (
                <tr>
                  <td colSpan={9}>沒有符合條件的訂單</td>
                </tr>
              ) : null}
            </tbody>
          </table>
        </div>
      </section>

      {detailOrder ? (
        <div className="modal-backdrop" onClick={() => setDetailOrder(null)} role="presentation">
          <section
            aria-label={`訂單 ${detailOrder.orderNo} 明細`}
            className="modal order-modal"
            onClick={(event) => event.stopPropagation()}
          >
            <div className="panel-header">
              <div>
                <h2>訂單明細</h2>
                <p>
                  {detailOrder.orderNo}｜{formatFullTime(detailOrder.createdAt)}｜
                  {detailOrder.counterName}｜銷售：{detailOrder.sellerName}
                </p>
              </div>
              <span className={detailOrder.status === "voided" ? "status warn" : "status"}>
                {detailOrder.status === "voided"
                  ? `已作廢（${detailOrder.voidedByName}：${detailOrder.voidReason}）`
                  : detailOrder.hasPreorder
                    ? "完成・含預購"
                    : "完成"}
              </span>
            </div>

            <div className="order-modal-body">
            <div className="table-scroll">
              <table>
                <thead>
                  <tr>
                    <th>品項</th>
                    <th>單價</th>
                    <th>數量</th>
                    <th>小計</th>
                  </tr>
                </thead>
                <tbody>
                  {detailOrder.items.map((item) => (
                    <tr key={item.id}>
                      <td>
                        {item.productName}（{item.spec}）
                        {item.giftFlavors.length > 0 ? (
                          <p className="cart-components">
                            {item.giftFlavors
                              .map((flavor) => `${flavor.flavorName} x${flavor.quantity}`)
                              .join("、")}
                          </p>
                        ) : null}
                      </td>
                      <td>${item.unitPrice}</td>
                      <td>{item.quantity}</td>
                      <td>{formatCurrency(item.lineTotal)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            {detailOrder.preorderItems.length > 0 ? (
              <div className="split-example">
                <strong>預購項目（現貨不足，不計入庫存）</strong>
                <span>
                  {detailOrder.preorderItems
                    .map((item) => `${item.itemName}（${item.spec}）x${item.quantity}`)
                    .join("、")}
                </span>
              </div>
            ) : null}

            <div className="totals">
              <div className="total-line">
                <span>銷售金額</span>
                <strong>{formatCurrency(detailOrder.salesAmount)}</strong>
              </div>
              <div className="total-line">
                <span>折扣金額</span>
                <strong>-{formatCurrency(detailOrder.discountAmount)}</strong>
              </div>
              <div className="total-line grand">
                <span>實收（{detailOrder.paymentLabel}）</span>
                <strong>{formatCurrency(detailOrder.receivedAmount)}</strong>
              </div>
            </div>
            </div>

            <div className="modal-actions">
              <button className="secondary-action" onClick={() => setDetailOrder(null)} type="button">
                關閉
              </button>
            </div>
          </section>
        </div>
      ) : null}

      {editDraft ? (
        <div className="modal-backdrop" onClick={() => setEditDraft(null)} role="presentation">
          <section
            aria-label={`編輯訂單 ${editDraft.orderNo}`}
            className="modal order-modal"
            onClick={(event) => event.stopPropagation()}
          >
            <div className="panel-header">
              <div>
                <h2>編輯訂單</h2>
                <p>{editDraft.orderNo}｜修改後金額與庫存會整單重算；新增自選禮盒請改用作廢重開。</p>
              </div>
            </div>

            <div className="order-modal-body">
            <div className="field-row">
              <label className="field">
                <span>業績歸屬</span>
                <select
                  value={editDraft.sellerId}
                  onChange={(event) =>
                    setEditDraft({ ...editDraft, sellerId: event.target.value })
                  }
                >
                  {staffOptions.map((staff) => (
                    <option key={staff.id} value={staff.id}>
                      {staff.name}
                    </option>
                  ))}
                </select>
              </label>
              <label className="field">
                <span>付款方式</span>
                <select
                  value={editDraft.paymentMethod}
                  onChange={(event) =>
                    setEditDraft({ ...editDraft, paymentMethod: event.target.value })
                  }
                >
                  {paymentOptions.map((option) => (
                    <option key={option.value} value={option.value}>
                      {option.label}
                    </option>
                  ))}
                </select>
              </label>
            </div>
            <div className="field-row">
              <label className="field">
                <span>折扣</span>
                <select
                  value={editDraft.discountId}
                  onChange={(event) =>
                    setEditDraft({ ...editDraft, discountId: event.target.value })
                  }
                >
                  <option value="">無折扣</option>
                  {discountOptions.map((discount) => (
                    <option key={discount.id} value={discount.id}>
                      {discount.name}
                    </option>
                  ))}
                </select>
              </label>
              <label className="field">
                <span>訂單時間（影響業績歸屬日）</span>
                <input
                  type="datetime-local"
                  value={editDraft.createdAt}
                  onChange={(event) =>
                    setEditDraft({ ...editDraft, createdAt: event.target.value })
                  }
                />
              </label>
            </div>

            <div className="table-scroll">
              <table>
                <thead>
                  <tr>
                    <th>品項</th>
                    <th>數量</th>
                    <th />
                  </tr>
                </thead>
                <tbody>
                  {editDraft.items.map((item, index) => (
                    <tr key={`${item.productId}-${index}`}>
                      <td>
                        {item.productName}
                        {item.giftFlavors.length > 0 ? (
                          <p className="cart-components">
                            {item.giftFlavors
                              .map((flavor) => `${flavor.flavorName} x${flavor.quantity}`)
                              .join("、")}
                          </p>
                        ) : null}
                      </td>
                      <td>
                        <div className="qty-control">
                          <button
                            className="icon-btn"
                            onClick={() => updateDraftQuantity(index, item.quantity - 1)}
                            type="button"
                          >
                            -
                          </button>
                          <input
                            className="qty-input"
                            inputMode="numeric"
                            value={item.quantity}
                            onChange={(event) =>
                              updateDraftQuantity(index, Number(event.target.value))
                            }
                          />
                          <button
                            className="icon-btn"
                            onClick={() => updateDraftQuantity(index, item.quantity + 1)}
                            type="button"
                          >
                            +
                          </button>
                        </div>
                      </td>
                      <td>
                        <button
                          className="secondary-action"
                          onClick={() => updateDraftQuantity(index, 0)}
                          type="button"
                        >
                          移除
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            <label className="field">
              <span>新增袋裝商品</span>
              <select
                value=""
                onChange={(event) => {
                  if (event.target.value) addDraftProduct(event.target.value);
                }}
              >
                <option value="">選擇商品加入...</option>
                {bagProducts.map((product) => (
                  <option key={product.id} value={product.id}>
                    {product.name}
                  </option>
                ))}
              </select>
            </label>
            </div>

            <div className="modal-actions">
              <button className="secondary-action" onClick={() => setEditDraft(null)} type="button">
                取消
              </button>
              <button
                className="primary-action"
                disabled={working}
                onClick={saveEdit}
                type="button"
              >
                {working ? "儲存中..." : "儲存修改"}
              </button>
            </div>
          </section>
        </div>
      ) : null}
    </>
  );
}

function toDatetimeLocal(value: string) {
  const date = new Date(value);
  const pad = (input: number) => String(input).padStart(2, "0");

  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}T${pad(date.getHours())}:${pad(date.getMinutes())}`;
}

function formatCurrency(value: number) {
  return `$${Math.round(value).toLocaleString("en-US")}`;
}

function formatTime(value: string) {
  return new Intl.DateTimeFormat("zh-TW", {
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit"
  }).format(new Date(value));
}

function formatFullTime(value: string) {
  return new Intl.DateTimeFormat("zh-TW", {
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false
  }).format(new Date(value));
}
