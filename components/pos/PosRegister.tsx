"use client";

import { useEffect, useMemo, useState } from "react";
import {
  currentShiftStaff as fallbackStaff,
  counters as fallbackCounters,
  discounts as fallbackDiscounts,
  flavors as fallbackFlavors,
  products as fallbackProducts,
  type DiscountOption,
  type Product
} from "@/lib/domain/sample-data";
import { calculateOrderTotals, validateGiftBoxSelection } from "@/lib/domain/pos-rules";
import { COUNTER_CHANGED_EVENT, getSelectedCounterId } from "@/lib/shared/counter-preference";

type Category = "popular" | "bag" | "gift_box";

type CartItem = {
  key: string;
  product: Product;
  quantity: number;
  includedItems: string[];
  giftFlavors: Array<{
    flavorId: string | null;
    flavorName: string;
    spec: string;
    quantity: number;
  }>;
};

const categoryLabels: Record<Category, string> = {
  popular: "常用",
  bag: "袋裝",
  gift_box: "禮盒"
};

type FlavorOption = {
  id: string | null;
  name: string;
  spec: string;
};

const crackerName = "經典原味蔥軋餅";

export function PosRegister() {
  const [category, setCategory] = useState<Category>("popular");
  const [cart, setCart] = useState<CartItem[]>([]);
  const [selectedDiscountId, setSelectedDiscountId] = useState("none");
  const [paymentMethod, setPaymentMethod] = useState("cash");
  const [products, setProducts] = useState<Product[]>(fallbackProducts);
  const [discounts, setDiscounts] = useState<DiscountOption[]>(fallbackDiscounts);
  const [flavors, setFlavors] = useState<FlavorOption[]>(
    fallbackFlavors.map((name) => ({ id: null, name, spec: "6入/袋" }))
  );
  const [stockByKey, setStockByKey] = useState<Record<string, number> | null>(null);
  const [staffOptions, setStaffOptions] = useState(
    fallbackStaff.map((staff) => ({ id: staff.id, name: staff.name }))
  );
  const [counters, setCounters] = useState(
    fallbackCounters.map((counter) => ({ id: counter.id, name: counter.name }))
  );
  const [counterId, setCounterId] = useState("");
  const [sellerId, setSellerId] = useState(fallbackStaff[0]?.id ?? "");
  const [pendingGift, setPendingGift] = useState<Product | null>(null);
  const [selectedFlavors, setSelectedFlavors] = useState<string[]>([]);
  const [flavorNotice, setFlavorNotice] = useState("");
  const [notice, setNotice] = useState("待建立訂單");
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    setCounterId((current) => current || getSelectedCounterId());

    const onCounterChanged = (event: Event) => {
      setCounterId((event as CustomEvent<string>).detail);
      setCart([]);
      setNotice("已切換櫃位，購物車已清空");
    };

    window.addEventListener(COUNTER_CHANGED_EVENT, onCounterChanged);
    void loadCatalog();

    return () => window.removeEventListener(COUNTER_CHANGED_EVENT, onCounterChanged);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    if (counterId) void loadStock(counterId);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [counterId]);

  async function loadStock(targetCounterId: string) {
    try {
      const result = await fetch(`/api/inventory?counterId=${targetCounterId}`).then((response) =>
        response.json()
      );

      if (!result.ok || result.data.source !== "supabase") {
        setStockByKey(null);
        return;
      }

      const next: Record<string, number> = {};

      for (const row of result.data.summary ?? []) {
        next[row.itemKey] = row.stock;

        if (row.flavorId) {
          next[`flavorName:${row.itemName}`] = row.stock;
        }
        if (row.productId) {
          next[`productName:${row.itemName}`] = row.stock;
        }
      }

      setStockByKey(next);
    } catch {
      setStockByKey(null);
    }
  }

  async function loadCatalog() {
    try {
      const [catalogResult, meResult] = await Promise.all([
        fetch("/api/catalog").then((response) => response.json()),
        fetch("/api/me")
          .then((response) => response.json())
          .catch(() => null)
      ]);

      if (!catalogResult.ok) {
        setNotice(catalogResult.error);
        return;
      }

      if (catalogResult.data.source !== "supabase") return;

      const mapped = mapSupabaseCatalog(catalogResult.data);
      setProducts(mapped.products);
      setDiscounts(mapped.discounts);
      setFlavors(mapped.flavors);
      setStaffOptions(mapped.staff);
      setCounters(mapped.counters);
      setCounterId((current) =>
        mapped.counters.some((counter) => counter.id === current)
          ? current
          : mapped.counters[0]?.id ?? ""
      );
      setSellerId((current) => {
        const meId = meResult?.ok ? (meResult.data.id as string) : null;

        if (meId && mapped.staff.some((staff) => staff.id === meId)) return meId;
        if (mapped.staff.some((staff) => staff.id === current)) return current;
        return mapped.staff[0]?.id ?? "";
      });
    } catch {
      setNotice("無法載入商品資料，使用示範資料");
    }
  }

  const currentCounterName =
    counters.find((counter) => counter.id === counterId)?.name ?? counters[0]?.name ?? "";

  const visibleProducts = products.filter((product) => {
    if (category === "popular") return product.popular;
    return product.category === category;
  });

  const selectedDiscount = discounts.find((discount) => discount.id === selectedDiscountId);
  const totals = useMemo(
    () =>
      calculateOrderTotals({
        items: cart.map((item) => ({
          unitPrice: item.product.price,
          quantity: item.quantity
        })),
        discount: toDomainDiscount(selectedDiscount)
      }),
    [cart, selectedDiscount]
  );

  function flavorStockKey(flavor: { flavorId: string | null; flavorName: string }) {
    return flavor.flavorId ? `flavor:${flavor.flavorId}` : `flavorName:${flavor.flavorName}`;
  }

  // 目前購物車已占用的庫存(袋裝商品、禮盒口味、大禮盒附贈蔥餅)。
  function cartUsage() {
    const usage = new Map<string, number>();
    const add = (key: string, quantity: number) =>
      usage.set(key, (usage.get(key) ?? 0) + quantity);

    for (const item of cart) {
      if (item.product.category === "bag") {
        add(`product:${item.product.id}`, item.quantity);
        continue;
      }

      for (const flavor of item.giftFlavors) {
        add(flavorStockKey(flavor), flavor.quantity * item.quantity);
      }

      if (item.product.giftRule?.includesScallionCracker) {
        const cracker = products.find((candidate) => candidate.name === crackerName);

        if (cracker) add(`product:${cracker.id}`, item.quantity);
      }
    }

    return usage;
  }

  // 扣掉購物車占用後,還能再取用的庫存;庫存資料未載入時回傳 null(交給後端擋)。
  function availableFor(key: string): number | null {
    if (!stockByKey) return null;
    return (stockByKey[key] ?? 0) - (cartUsage().get(key) ?? 0);
  }

  function giftBoxShortage(
    product: Product,
    giftFlavors: CartItem["giftFlavors"],
    boxes: number
  ): string | null {
    const needs = new Map<string, { name: string; needed: number }>();

    for (const flavor of giftFlavors) {
      const key = flavorStockKey(flavor);
      const current = needs.get(key) ?? { name: flavor.flavorName, needed: 0 };
      current.needed += flavor.quantity * boxes;
      needs.set(key, current);
    }

    if (product.giftRule?.includesScallionCracker) {
      const cracker = products.find((candidate) => candidate.name === crackerName);

      if (cracker) {
        const key = `product:${cracker.id}`;
        const current = needs.get(key) ?? { name: cracker.name, needed: 0 };
        current.needed += boxes;
        needs.set(key, current);
      }
    }

    for (const [key, need] of needs) {
      const available = availableFor(key);

      if (available != null && need.needed > available) {
        return `${need.name} 庫存不足（可再用 ${Math.max(0, available)}）`;
      }
    }

    return null;
  }

  function addProduct(product: Product) {
    if (product.giftRule?.mode === "select") {
      setSelectedFlavors([]);
      setFlavorNotice("");
      setPendingGift(product);
      return;
    }

    if (product.giftRule?.mode === "fixed") {
      const result = validateGiftBoxSelection({
        name: product.name,
        mode: "fixed",
        fixedFlavors: product.giftRule.fixedFlavors
      });

      if (result.valid) {
        const giftFlavors =
          product.giftRule.fixedFlavorItems ?? createGiftFlavorInputs(result.includedItems);
        const shortage = giftBoxShortage(product, giftFlavors, 1);

        addCartItem(product, result.includedItems, giftFlavors);

        if (shortage) {
          setNotice(`${shortage}，超出部分將以預購出單`);
        }
      }
      return;
    }

    const available = availableFor(`product:${product.id}`);

    addCartItem(product, [], []);

    if (available != null && available < 1) {
      setNotice(`${product.name} 現貨不足，超出部分將以預購出單`);
    }
  }

  function addCartItem(
    product: Product,
    includedItems: string[],
    giftFlavors: CartItem["giftFlavors"]
  ) {
    const key = `${product.id}:${includedItems.join("|")}`;
    setCart((current) => {
      const existing = current.find((item) => item.key === key);
      if (existing) {
        return current.map((item) =>
          item.key === key ? { ...item, quantity: item.quantity + 1 } : item
        );
      }

      return [...current, { key, product, quantity: 1, includedItems, giftFlavors }];
    });
    setNotice(`${product.name} 已加入訂單`);
  }

  function updateQuantity(key: string, delta: number) {
    const item = cart.find((candidate) => candidate.key === key);

    if (!item) return;

    setQuantityTo(key, item.quantity + delta);
  }

  function setQuantityTo(key: string, nextQuantity: number) {
    const item = cart.find((candidate) => candidate.key === key);

    if (!item) return;

    const quantity = Math.max(0, Math.floor(Number.isFinite(nextQuantity) ? nextQuantity : 0));
    const delta = quantity - item.quantity;

    if (delta > 0) {
      const shortage =
        item.product.category === "bag"
          ? (() => {
              const available = availableFor(`product:${item.product.id}`);
              return available != null && available < delta
                ? `${item.product.name} 現貨不足`
                : null;
            })()
          : giftBoxShortage(item.product, item.giftFlavors, delta);

      if (shortage) {
        setNotice(`${shortage}，超出部分將以預購出單`);
      }
    }

    setCart((current) =>
      current
        .map((candidate) =>
          candidate.key === key ? { ...candidate, quantity } : candidate
        )
        .filter((candidate) => candidate.quantity > 0)
    );
  }

  function toggleFlavor(flavor: string) {
    const requiredFlavorCount = pendingGift?.giftRule?.requiredFlavorCount ?? 0;
    const option = flavors.find((candidate) => candidate.name === flavor);
    const key = flavorStockKey({ flavorId: option?.id ?? null, flavorName: flavor });
    const available = availableFor(key);
    const alreadySelected = selectedFlavors.filter((name) => name === flavor).length;

    if (available != null && alreadySelected + 1 > available) {
      setFlavorNotice(`${flavor} 現貨不足，超出部分將以預購出單`);
    } else {
      setFlavorNotice("");
    }

    setSelectedFlavors((current) => {
      if (current.length >= requiredFlavorCount) return current;
      return [...current, flavor];
    });
  }

  function removeFlavor(flavor: string) {
    setSelectedFlavors((current) => {
      const index = current.lastIndexOf(flavor);
      if (index < 0) return current;

      return current.filter((_, currentIndex) => currentIndex !== index);
    });
  }

  function confirmGiftBox() {
    if (!pendingGift?.giftRule) return;

    const result = validateGiftBoxSelection({
      name: pendingGift.name,
      mode: "select",
      requiredFlavorCount: pendingGift.giftRule.requiredFlavorCount,
      includesScallionCracker: pendingGift.giftRule.includesScallionCracker,
      selectedFlavors
    });

    if (!result.valid) {
      setFlavorNotice(result.message);
      return;
    }

    const giftFlavors = summarizeFlavors(selectedFlavors).map((item) => {
      const flavor = flavors.find((option) => option.name === item.flavor);

      return {
        flavorId: flavor?.id ?? null,
        flavorName: item.flavor,
        spec: flavor?.spec ?? "6入/袋",
        quantity: item.quantity
      };
    });

    const shortage = giftBoxShortage(pendingGift, giftFlavors, 1);

    addCartItem(pendingGift, result.includedItems, giftFlavors);
    setPendingGift(null);
    setSelectedFlavors([]);
    setFlavorNotice("");

    if (shortage) {
      setNotice(`${shortage}，超出部分將以預購出單`);
    }
  }

  // 整車彙總後,超出庫存的部分即為預購數量(與後端拆單邏輯一致)。
  function preorderSummaryForCart(): string[] {
    if (!stockByKey) return [];

    const needs = new Map<string, { name: string; needed: number; stock: number }>();

    const addNeed = (key: string, name: string, quantity: number) => {
      const current = needs.get(key) ?? { name, needed: 0, stock: stockByKey[key] ?? 0 };
      current.needed += quantity;
      needs.set(key, current);
    };

    for (const item of cart) {
      if (item.product.category === "bag") {
        addNeed(`product:${item.product.id}`, item.product.name, item.quantity);
        continue;
      }

      for (const flavor of item.giftFlavors) {
        const key = flavor.flavorId
          ? `flavor:${flavor.flavorId}`
          : `flavorName:${flavor.flavorName}`;
        addNeed(key, flavor.flavorName, flavor.quantity * item.quantity);
      }

      if (item.product.giftRule?.includesScallionCracker) {
        const cracker = products.find((product) => product.name === crackerName);

        if (cracker) addNeed(`product:${cracker.id}`, cracker.name, item.quantity);
      }
    }

    return Array.from(needs.values())
      .filter((need) => need.needed > Math.max(0, need.stock))
      .map((need) => `${need.name} x${need.needed - Math.max(0, need.stock)}`);
  }

  async function completeOrder() {
    if (cart.length === 0) return;

    const preorderParts = preorderSummaryForCart();

    if (preorderParts.length > 0) {
      const confirmed = window.confirm(
        `此訂單包含預購項目（現貨不足）：\n${preorderParts.join("、")}\n\n預購部分不扣庫存，確定送出訂單？`
      );

      if (!confirmed) return;
    }

    setSubmitting(true);
    const seller = staffOptions.find((staff) => staff.id === sellerId)?.name ?? "未指定";

    try {
      const response = await fetch("/api/orders", {
        method: "POST",
        headers: {
          "Content-Type": "application/json"
        },
        body: JSON.stringify({
          counterId: counterId || counters[0]?.id,
          sellerId,
          discountId: selectedDiscountId === "none" ? null : selectedDiscountId,
          paymentMethod,
          items: cart.map((item) => ({
            productId: item.product.id,
            quantity: item.quantity,
            giftFlavors: item.giftFlavors
          }))
        })
      });
      const result = await response.json();

      if (!response.ok || !result.ok) {
        setNotice(result.error ?? "訂單建立失敗");
        return;
      }

      setNotice(
        `訂單完成：${seller} / ${paymentLabel(paymentMethod)} / 應收 $${totals.receivableAmount}`
      );
      setCart([]);
      void loadStock(counterId);
    } catch {
      setNotice("訂單建立失敗，請稍後再試");
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <>
      <section className="pos-layout" aria-label="前台 POS">
        <aside className="panel category-rail" aria-label="商品分類">
          {(Object.keys(categoryLabels) as Category[]).map((item) => (
            <button
              className={`category-btn ${category === item ? "active" : ""}`}
              key={item}
              onClick={() => setCategory(item)}
              type="button"
            >
              {categoryLabels[item]}
            </button>
          ))}
        </aside>

        <main className="panel product-panel">
          <div className="panel-header">
            <div>
              <h2>{categoryLabels[category]}</h2>
              <p>{currentCounterName} 今日啟用商品</p>
            </div>
            <span className="pill">{notice}</span>
          </div>
          <div className="product-grid">
            {visibleProducts.map((product) => {
              const available =
                product.category === "bag" ? availableFor(`product:${product.id}`) : null;
              const soldOut = available != null && available <= 0;

              return (
                <button
                  className="product-btn"
                  key={product.id}
                  onClick={() => addProduct(product)}
                  type="button"
                >
                  <span>
                    <span className="product-name">{product.name}</span>
                    <span className="product-rule">
                      {soldOut ? "現貨不足・可預購" : describeRule(product)}
                    </span>
                  </span>
                  <span className="product-meta">
                    <span>
                      {product.spec}
                      {product.category === "bag" && stockByKey
                        ? `｜庫存 ${stockByKey[`product:${product.id}`] ?? 0}`
                        : ""}
                    </span>
                    <strong className="price">${product.price}</strong>
                  </span>
                </button>
              );
            })}
          </div>
        </main>

        <aside className="panel cart-panel" aria-label="購物車">
          <div className="panel-header">
            <h2>訂單</h2>
            <span className="pill">{cart.length} 項</span>
          </div>
          <div className="cart-list">
            {cart.length === 0 ? (
              <div className="empty-state">點選商品開始建立訂單</div>
            ) : (
              cart.map((item) => (
                <article className="cart-row" key={item.key}>
                  <div className="cart-row-top">
                    <strong>{item.product.name}</strong>
                    <div className="qty-control">
                      <button
                        aria-label={`減少 ${item.product.name}`}
                        className="icon-btn"
                        onClick={() => updateQuantity(item.key, -1)}
                        type="button"
                      >
                        -
                      </button>
                      <input
                        aria-label={`${item.product.name} 數量`}
                        className="qty-input"
                        inputMode="numeric"
                        value={item.quantity}
                        onChange={(event) => setQuantityTo(item.key, Number(event.target.value))}
                      />
                      <button
                        aria-label={`增加 ${item.product.name}`}
                        className="icon-btn"
                        onClick={() => updateQuantity(item.key, 1)}
                        type="button"
                      >
                        +
                      </button>
                    </div>
                  </div>
                  {item.includedItems.length > 0 ? (
                    <p className="cart-components">{item.includedItems.join("、")}</p>
                  ) : null}
                  <div className="cart-row-bottom">
                    <span>{item.product.spec}</span>
                    <strong>${item.product.price * item.quantity}</strong>
                  </div>
                </article>
              ))
            )}
          </div>
          <div className="checkout">
            <div className="field-row">
              <label className="field">
                <span>折扣</span>
                <select
                  value={selectedDiscountId}
                  onChange={(event) => setSelectedDiscountId(event.target.value)}
                >
                  {discounts.map((discount) => (
                    <option key={discount.id} value={discount.id}>
                      {discount.name}
                    </option>
                  ))}
                </select>
              </label>
              <label className="field">
                <span>付款</span>
                <select
                  value={paymentMethod}
                  onChange={(event) => setPaymentMethod(event.target.value)}
                >
                  <option value="cash">現金</option>
                  <option value="credit_card">信用卡</option>
                  <option value="line_pay">LINE Pay</option>
                  <option value="jkopay">街口支付</option>
                </select>
              </label>
            </div>
            <label className="field">
              <span>銷售人員</span>
              <select value={sellerId} onChange={(event) => setSellerId(event.target.value)}>
                {staffOptions.map((staff) => (
                  <option key={staff.id} value={staff.id}>
                    {staff.name}
                  </option>
                ))}
              </select>
            </label>
            <div className="totals">
              <div className="total-line">
                <span>銷售金額</span>
                <strong>${totals.salesAmount}</strong>
              </div>
              <div className="total-line">
                <span>折扣金額</span>
                <strong>-${totals.discountAmount}</strong>
              </div>
              <div className="total-line grand">
                <span>應收</span>
                <strong>${totals.receivableAmount}</strong>
              </div>
              <div className="total-line">
                <span>實收</span>
                <strong>${totals.receivedAmount}</strong>
              </div>
            </div>
            <button
              className="primary-action"
              disabled={cart.length === 0 || submitting}
              onClick={completeOrder}
              type="button"
            >
              {submitting ? "建立訂單中" : "完成訂單"}
            </button>
          </div>
        </aside>
      </section>

      {pendingGift ? (
        <div className="modal-backdrop" role="presentation">
          <section className="modal" aria-label={`${pendingGift.name} 口味選擇`}>
            <div className="panel-header">
              <div>
                <h2>{pendingGift.name}</h2>
                <p>選擇 {pendingGift.giftRule?.requiredFlavorCount} 個口味</p>
              </div>
              <span className="pill">{selectedFlavors.length} 已選</span>
            </div>
            <div className="flavor-grid">
              {flavors.map((flavor) => {
                const stock = stockByKey
                  ? stockByKey[flavor.id ? `flavor:${flavor.id}` : `flavorName:${flavor.name}`] ?? 0
                  : null;

                return (
                  <button
                    className={`flavor-btn ${selectedFlavors.includes(flavor.name) ? "active" : ""}`}
                    key={flavor.name}
                    onClick={() => toggleFlavor(flavor.name)}
                    type="button"
                  >
                    <span>
                      {flavor.name}
                      {stock != null ? `（庫存 ${stock}）` : ""}
                    </span>
                    <strong>{countFlavor(selectedFlavors, flavor.name)}</strong>
                  </button>
                );
              })}
            </div>
            {flavorNotice ? <span className="status warn">{flavorNotice}</span> : null}
            <div className="selected-flavor-list">
              {selectedFlavors.length === 0 ? (
                <span>可重複選取同一口味</span>
              ) : (
                summarizeFlavors(selectedFlavors).map((item) => (
                  <button
                    className="selected-flavor-chip"
                    key={item.flavor}
                    onClick={() => removeFlavor(item.flavor)}
                    type="button"
                  >
                    {item.flavor} x {item.quantity}
                  </button>
                ))
              )}
            </div>
            <div className="modal-actions">
              <button
                className="secondary-action"
                onClick={() => setPendingGift(null)}
                type="button"
              >
                取消
              </button>
              <button className="primary-action" onClick={confirmGiftBox} type="button">
                加入訂單
              </button>
            </div>
          </section>
        </div>
      ) : null}
    </>
  );
}

type SupabaseCatalog = {
  products: Array<{
    id: string;
    category: "bag" | "gift_box";
    name: string;
    spec: string;
    price: number | string;
    is_popular?: boolean;
  }>;
  giftRules?: Array<{
    product_id: string;
    selection_mode: "select" | "fixed";
    required_flavor_count: number;
    includes_scallion_cracker: boolean;
  }>;
  fixedFlavors?: Array<{ product_id: string; quantity: number; flavors: unknown }>;
  flavors: Array<{ id: string; name: string; spec?: string }>;
  staff: Array<{ id: string; display_name?: string; name?: string }>;
  discounts: Array<{
    id: string;
    name: string;
    discount_type: "percentage" | "fixed_amount";
    value: number | string;
    min_order_amount: number | string | null;
  }>;
  counters: Array<{ id: string; name: string }>;
};

function mapSupabaseCatalog(data: SupabaseCatalog) {
  const rules = new Map((data.giftRules ?? []).map((rule) => [rule.product_id, rule]));
  const fixedNamesByProduct = new Map<string, string[]>();
  const fixedItemsByProduct = new Map<
    string,
    Array<{ flavorId: string | null; flavorName: string; spec: string; quantity: number }>
  >();

  for (const row of data.fixedFlavors ?? []) {
    const flavor = readFlavorRelation(row.flavors);

    if (!flavor) continue;

    const names = fixedNamesByProduct.get(row.product_id) ?? [];

    for (let index = 0; index < Math.max(1, row.quantity); index += 1) {
      names.push(flavor.name);
    }

    fixedNamesByProduct.set(row.product_id, names);

    const items = fixedItemsByProduct.get(row.product_id) ?? [];
    items.push({
      flavorId: flavor.id,
      flavorName: flavor.name,
      spec: flavor.spec,
      quantity: Math.max(1, row.quantity)
    });
    fixedItemsByProduct.set(row.product_id, items);
  }

  const products: Product[] = data.products.map((product) => {
    const rule = rules.get(product.id);

    return {
      id: product.id,
      category: product.category,
      name: product.name,
      spec: product.spec,
      price: Number(product.price),
      popular: Boolean(product.is_popular),
      giftRule: rule
        ? {
            mode: rule.selection_mode,
            requiredFlavorCount: rule.required_flavor_count,
            includesScallionCracker: rule.includes_scallion_cracker,
            fixedFlavors: fixedNamesByProduct.get(product.id),
            fixedFlavorItems: fixedItemsByProduct.get(product.id)
          }
        : undefined
    };
  });

  const discounts: DiscountOption[] = [
    { id: "none", name: "無折扣", type: "fixed_amount", value: 0 },
    ...data.discounts.map((discount) => ({
      id: discount.id,
      name: discount.name,
      type: discount.discount_type,
      value: Number(discount.value),
      minOrderAmount:
        discount.min_order_amount == null ? undefined : Number(discount.min_order_amount)
    }))
  ];

  return {
    products,
    discounts,
    flavors: data.flavors.map((flavor) => ({
      id: flavor.id,
      name: flavor.name,
      spec: flavor.spec ?? "6入/袋"
    })),
    staff: data.staff.map((staff) => ({
      id: staff.id,
      name: staff.display_name ?? staff.name ?? "未命名員工"
    })),
    counters: data.counters.map((counter) => ({ id: counter.id, name: counter.name }))
  };
}

function readFlavorRelation(value: unknown): FlavorOption | null {
  const record = Array.isArray(value) ? value[0] : value;

  if (!record || typeof record !== "object" || !("name" in record)) return null;

  const entry = record as { id?: string; name: string; spec?: string };

  return {
    id: entry.id ?? null,
    name: String(entry.name),
    spec: entry.spec ?? "6入/袋"
  };
}

function countFlavor(selectedFlavors: string[], flavor: string) {
  return selectedFlavors.filter((item) => item === flavor).length;
}

function summarizeFlavors(selectedFlavors: string[]) {
  return selectedFlavors.reduce<Array<{ flavor: string; quantity: number }>>((summary, flavor) => {
    const existing = summary.find((item) => item.flavor === flavor);
    if (existing) {
      existing.quantity += 1;
      return summary;
    }

    return [...summary, { flavor, quantity: 1 }];
  }, []);
}

function createGiftFlavorInputs(includedItems: string[]) {
  return summarizeFlavors(includedItems).map((item) => {
    const { flavorName, spec } = parseIncludedItem(item.flavor);

    return {
      flavorId: null,
      flavorName,
      spec,
      quantity: item.quantity
    };
  });
}

function parseIncludedItem(item: string) {
  const match = item.match(/^(.*) ([^ ]+)$/);

  return {
    flavorName: match?.[1] ?? item,
    spec: match?.[2] ?? "6入/袋"
  };
}

function toDomainDiscount(discount?: DiscountOption) {
  if (!discount || discount.id === "none") return null;
  return {
    type: discount.type,
    value: discount.value,
    minOrderAmount: discount.minOrderAmount
  };
}

function describeRule(product: Product) {
  if (product.giftRule?.mode === "select") {
    const suffix = product.giftRule.includesScallionCracker ? " + 蔥餅" : "";
    return `需選 ${product.giftRule.requiredFlavorCount} 個口味${suffix}`;
  }

  if (product.giftRule?.mode === "fixed") {
    return `固定：${product.giftRule.fixedFlavors?.join("、")}`;
  }

  return "單品計價";
}

function paymentLabel(method: string) {
  const labels: Record<string, string> = {
    cash: "現金",
    credit_card: "信用卡",
    line_pay: "LINE Pay",
    jkopay: "街口支付"
  };

  return labels[method] ?? method;
}
