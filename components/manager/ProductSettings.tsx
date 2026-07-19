"use client";

import { useEffect, useState } from "react";
import type {
  UpsertBundleInput,
  UpsertDiscountInput,
  UpsertProductInput
} from "@/lib/backend/api-types";

type ProductRow = {
  id: string;
  category: "bag" | "gift_box";
  name: string;
  spec: string;
  price: number;
  isActive: boolean;
  isPopular: boolean;
  giftRule: {
    selectionMode: "select" | "fixed";
    requiredFlavorCount: number;
    includesScallionCracker: boolean;
    allowedFlavorIds?: string[];
  } | null;
};

type FlavorRow = {
  id: string;
  name: string;
  spec: string;
  isActive: boolean;
};

type BundleRow = {
  id: string;
  name: string;
  isActive: boolean;
  productIds: string[];
  tiers: Array<{ quantity: number; price: number }>;
};

type DiscountRow = {
  id: string;
  name: string;
  discountType: "percentage" | "fixed_amount";
  value: number;
  minOrderAmount: number | null;
  isActive: boolean;
};

const emptyProduct: UpsertProductInput = {
  category: "bag",
  name: "",
  spec: "",
  price: 0,
  isActive: true,
  isPopular: false,
  giftRule: null
};

const emptyDiscount: UpsertDiscountInput = {
  name: "",
  discountType: "percentage",
  value: 0.9,
  minOrderAmount: null,
  isActive: true
};

const emptyFlavor = { name: "", spec: "6入/袋", isActive: true };

const emptyBundle: UpsertBundleInput = {
  name: "",
  isActive: true,
  productIds: [],
  tiers: [{ quantity: 2, price: 0 }]
};

export function ProductSettings() {
  const [products, setProducts] = useState<ProductRow[]>([]);
  const [discounts, setDiscounts] = useState<DiscountRow[]>([]);
  const [flavors, setFlavors] = useState<FlavorRow[]>([]);
  const [bundles, setBundles] = useState<BundleRow[]>([]);
  const [productForm, setProductForm] = useState<UpsertProductInput>(emptyProduct);
  const [discountForm, setDiscountForm] = useState<UpsertDiscountInput>(emptyDiscount);
  const [flavorForm, setFlavorForm] = useState<{
    id?: string;
    name: string;
    spec: string;
    isActive: boolean;
  }>(emptyFlavor);
  const [bundleForm, setBundleForm] = useState<UpsertBundleInput>(emptyBundle);
  const [status, setStatus] = useState("讀取商品資料中...");
  const [saving, setSaving] = useState(false);
  // 新增/編輯共用彈窗:null = 關閉
  const [modal, setModal] = useState<null | "product" | "discount" | "flavor" | "bundle">(null);

  useEffect(() => {
    void loadData();
  }, []);

  async function loadData() {
    const [productsResult, discountsResult, flavorsResult, bundlesResult] = await Promise.all([
      fetch("/api/products").then((response) => response.json()),
      fetch("/api/discounts").then((response) => response.json()),
      fetch("/api/flavors").then((response) => response.json()),
      fetch("/api/bundles").then((response) => response.json())
    ]);

    if (!productsResult.ok || !discountsResult.ok) {
      setStatus(productsResult.error ?? discountsResult.error);
      return;
    }

    setProducts(productsResult.data.products);
    setDiscounts(discountsResult.data.discounts);
    setFlavors(flavorsResult.ok ? flavorsResult.data.flavors ?? [] : []);
    setBundles(bundlesResult.ok ? bundlesResult.data.bundles ?? [] : []);
    setStatus(productsResult.data.source === "supabase" ? "已連線本地資料庫" : "Demo 模式");
  }

  function editProduct(product: ProductRow) {
    setProductForm({
      id: product.id,
      category: product.category,
      name: product.name,
      spec: product.spec,
      price: product.price,
      isActive: product.isActive,
      isPopular: product.isPopular,
      giftRule: product.giftRule
        ? {
            selectionMode: product.giftRule.selectionMode,
            requiredFlavorCount: product.giftRule.requiredFlavorCount,
            includesScallionCracker: product.giftRule.includesScallionCracker,
            allowedFlavorIds: product.giftRule.allowedFlavorIds ?? []
          }
        : null
    });
    setModal("product");
  }

  async function saveProduct() {
    setSaving(true);
    setStatus("儲存商品中...");

    const response = await fetch("/api/products", {
      method: productForm.id ? "PATCH" : "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(productForm)
    });
    const result = await response.json();

    setSaving(false);

    if (!result.ok) {
      setStatus(result.error);
      return;
    }

    setStatus(productForm.id ? "商品已更新" : "商品已新增");
    setProductForm(emptyProduct);
    setModal(null);
    await loadData();
  }

  async function deleteProduct(product: ProductRow) {
    if (!window.confirm(`確定刪除「${product.name}」？已有訂單或庫存紀錄的商品會改為停用。`)) {
      return;
    }

    setSaving(true);
    setStatus("刪除商品中...");

    const response = await fetch("/api/products", {
      method: "DELETE",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ id: product.id })
    });
    const result = await response.json();

    setSaving(false);

    if (!result.ok) {
      setStatus(result.error);
      return;
    }

    setStatus(result.data.mode === "deactivated" ? result.data.message : `「${product.name}」已刪除`);
    if (productForm.id === product.id) setProductForm(emptyProduct);
    await loadData();
  }

  function editDiscount(discount: DiscountRow) {
    setDiscountForm({
      id: discount.id,
      name: discount.name,
      discountType: discount.discountType,
      value: discount.value,
      minOrderAmount: discount.minOrderAmount,
      isActive: discount.isActive
    });
    setModal("discount");
  }

  async function saveDiscount() {
    setSaving(true);
    setStatus("儲存折扣中...");

    const response = await fetch("/api/discounts", {
      method: discountForm.id ? "PATCH" : "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(discountForm)
    });
    const result = await response.json();

    setSaving(false);

    if (!result.ok) {
      setStatus(result.error);
      return;
    }

    setStatus(discountForm.id ? "折扣已更新" : "折扣已新增");
    setDiscountForm(emptyDiscount);
    setModal(null);
    await loadData();
  }

  function updateGiftRule(partial: Partial<NonNullable<UpsertProductInput["giftRule"]>>) {
    setProductForm((current) => ({
      ...current,
      giftRule: {
        selectionMode: current.giftRule?.selectionMode ?? "select",
        requiredFlavorCount: current.giftRule?.requiredFlavorCount ?? 3,
        includesScallionCracker: current.giftRule?.includesScallionCracker ?? false,
        allowedFlavorIds: current.giftRule?.allowedFlavorIds ?? [],
        ...partial
      }
    }));
  }

  function toggleAllowedFlavor(flavorId: string) {
    const current = productForm.giftRule?.allowedFlavorIds ?? [];
    updateGiftRule({
      allowedFlavorIds: current.includes(flavorId)
        ? current.filter((id) => id !== flavorId)
        : [...current, flavorId]
    });
  }

  async function saveFlavor() {
    if (!flavorForm.name.trim()) {
      setStatus("請填口味名稱");
      return;
    }

    setSaving(true);
    setStatus("儲存口味中...");

    const response = await fetch("/api/flavors", {
      method: flavorForm.id ? "PATCH" : "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(flavorForm)
    });
    const result = await response.json();

    setSaving(false);

    if (!result.ok) {
      setStatus(result.error);
      return;
    }

    setStatus(flavorForm.id ? "口味已更新" : "口味已新增");
    setFlavorForm(emptyFlavor);
    setModal(null);
    await loadData();
  }

  async function deleteFlavor(flavor: FlavorRow) {
    if (!window.confirm(`確定刪除口味「${flavor.name}」？已有紀錄的口味會改為停用。`)) return;

    setSaving(true);
    const response = await fetch("/api/flavors", {
      method: "DELETE",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ id: flavor.id })
    });
    const result = await response.json();
    setSaving(false);

    if (!result.ok) {
      setStatus(result.error);
      return;
    }

    setStatus(
      result.data.mode === "deactivated" ? result.data.message : `口味「${flavor.name}」已刪除`
    );
    if (flavorForm.id === flavor.id) setFlavorForm(emptyFlavor);
    await loadData();
  }

  function updateBundleTier(index: number, partial: Partial<{ quantity: number; price: number }>) {
    setBundleForm((current) => ({
      ...current,
      tiers: current.tiers.map((tier, tierIndex) =>
        tierIndex === index ? { ...tier, ...partial } : tier
      )
    }));
  }

  function toggleBundleProduct(productId: string) {
    setBundleForm((current) => ({
      ...current,
      productIds: current.productIds.includes(productId)
        ? current.productIds.filter((id) => id !== productId)
        : [...current.productIds, productId]
    }));
  }

  async function saveBundle() {
    setSaving(true);
    setStatus("儲存組合價中...");

    const response = await fetch("/api/bundles", {
      method: bundleForm.id ? "PATCH" : "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(bundleForm)
    });
    const result = await response.json();

    setSaving(false);

    if (!result.ok) {
      setStatus(result.error);
      return;
    }

    setStatus(bundleForm.id ? "組合價已更新" : "組合價已新增");
    setBundleForm(emptyBundle);
    setModal(null);
    await loadData();
  }

  async function deleteBundle(bundle: BundleRow) {
    if (!window.confirm(`確定刪除組合價「${bundle.name}」？`)) return;

    setSaving(true);
    const response = await fetch("/api/bundles", {
      method: "DELETE",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ id: bundle.id })
    });
    const result = await response.json();
    setSaving(false);

    if (!result.ok) {
      setStatus(result.error);
      return;
    }

    setStatus(`組合價「${bundle.name}」已刪除`);
    if (bundleForm.id === bundle.id) setBundleForm(emptyBundle);
    await loadData();
  }

  return (
    <>
      <section className="section-title">
        <div>
          <h1>商品與折扣</h1>
          <p>管理袋裝商品、禮盒價格、口味規則、組合價與折扣。</p>
        </div>
        <span className="pill">{status}</span>
      </section>

      <section className="panel data-card">
        <div className="panel-header">
          <h2>商品</h2>
          <button
            className="primary-action slim"
            onClick={() => {
              setProductForm(emptyProduct);
              setModal("product");
            }}
            type="button"
          >
            新增商品
          </button>
        </div>
        <div className="table-scroll">
          <table>
            <thead>
              <tr>
                <th>品名</th>
                <th>類型</th>
                <th>規格</th>
                <th>售價</th>
                <th>常用</th>
                <th>狀態</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {products.map((product) => (
                <tr key={product.id}>
                  <td>{product.name}</td>
                  <td>{product.category === "bag" ? "袋裝" : "禮盒"}</td>
                  <td>{product.spec}</td>
                  <td>${product.price}</td>
                  <td>{product.isPopular ? <span className="status">常用</span> : "—"}</td>
                  <td>{product.isActive ? "啟用" : "停用"}</td>
                  <td>
                    <div className="toolbar">
                      <button
                        className="secondary-action"
                        onClick={() => editProduct(product)}
                        type="button"
                      >
                        編輯
                      </button>
                      <button
                        className="secondary-action"
                        disabled={saving}
                        onClick={() => deleteProduct(product)}
                        type="button"
                      >
                        刪除
                      </button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>

      <section className="panel data-card">
        <div className="panel-header">
          <h2>禮盒口味管理</h2>
          <button
            className="primary-action slim"
            onClick={() => {
              setFlavorForm(emptyFlavor);
              setModal("flavor");
            }}
            type="button"
          >
            新增口味
          </button>
        </div>
        <div className="table-scroll">
          <table>
            <thead>
              <tr>
                <th>口味</th>
                <th>規格</th>
                <th>狀態</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {flavors.map((flavor) => (
                <tr key={flavor.id}>
                  <td>{flavor.name}</td>
                  <td>{flavor.spec}</td>
                  <td>{flavor.isActive ? "啟用" : "停用"}</td>
                  <td>
                    <div className="toolbar">
                      <button
                        className="secondary-action"
                        onClick={() => {
                          setFlavorForm({
                            id: flavor.id,
                            name: flavor.name,
                            spec: flavor.spec,
                            isActive: flavor.isActive
                          });
                          setModal("flavor");
                        }}
                        type="button"
                      >
                        編輯
                      </button>
                      <button
                        className="secondary-action"
                        disabled={saving}
                        onClick={() => deleteFlavor(flavor)}
                        type="button"
                      >
                        刪除
                      </button>
                    </div>
                  </td>
                </tr>
              ))}
              {flavors.length === 0 ? (
                <tr>
                  <td colSpan={4}>尚未建立口味</td>
                </tr>
              ) : null}
            </tbody>
          </table>
        </div>
      </section>

      <section className="panel data-card">
        <div className="panel-header">
          <h2>折扣</h2>
          <button
            className="primary-action slim"
            onClick={() => {
              setDiscountForm(emptyDiscount);
              setModal("discount");
            }}
            type="button"
          >
            新增折扣
          </button>
        </div>
        <div className="table-scroll">
          <table>
            <thead>
              <tr>
                <th>名稱</th>
                <th>規則</th>
                <th>最低消費</th>
                <th>狀態</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {discounts.map((discount) => (
                <tr key={discount.id}>
                  <td>{discount.name}</td>
                  <td>
                    {discount.discountType === "percentage"
                      ? `${Math.round(discount.value * 100) / 10} 折`
                      : `折 $${discount.value}`}
                  </td>
                  <td>{discount.minOrderAmount ? `$${discount.minOrderAmount}` : "—"}</td>
                  <td>{discount.isActive ? "啟用" : "停用"}</td>
                  <td>
                    <button
                      className="secondary-action"
                      onClick={() => editDiscount(discount)}
                      type="button"
                    >
                      編輯
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>

      <section className="panel data-card">
        <div className="panel-header">
          <h2>組合價（任選 N 件 $X）</h2>
          <button
            className="primary-action slim"
            onClick={() => {
              setBundleForm(emptyBundle);
              setModal("bundle");
            }}
            type="button"
          >
            新增組合價
          </button>
        </div>
        <div className="table-scroll">
          <table>
            <thead>
              <tr>
                <th>名稱</th>
                <th>商品數</th>
                <th>級距</th>
                <th>狀態</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {bundles.map((bundle) => (
                <tr key={bundle.id}>
                  <td>{bundle.name}</td>
                  <td>{bundle.productIds.length}</td>
                  <td>
                    {bundle.tiers.map((tier) => `${tier.quantity}件$${tier.price}`).join("、")}
                  </td>
                  <td>{bundle.isActive ? "啟用" : "停用"}</td>
                  <td>
                    <div className="toolbar">
                      <button
                        className="secondary-action"
                        onClick={() => {
                          setBundleForm({
                            id: bundle.id,
                            name: bundle.name,
                            isActive: bundle.isActive,
                            productIds: [...bundle.productIds],
                            tiers: bundle.tiers.map((tier) => ({ ...tier }))
                          });
                          setModal("bundle");
                        }}
                        type="button"
                      >
                        編輯
                      </button>
                      <button
                        className="secondary-action"
                        disabled={saving}
                        onClick={() => deleteBundle(bundle)}
                        type="button"
                      >
                        刪除
                      </button>
                    </div>
                  </td>
                </tr>
              ))}
              {bundles.length === 0 ? (
                <tr>
                  <td colSpan={5}>尚未建立組合價</td>
                </tr>
              ) : null}
            </tbody>
          </table>
        </div>
      </section>

      {modal === "product" ? (
        <div className="modal-backdrop" onClick={() => setModal(null)} role="presentation">
          <section
            aria-label={productForm.id ? "編輯商品" : "新增商品"}
            className="modal order-modal"
            onClick={(event) => event.stopPropagation()}
          >
            <div className="panel-header">
              <h2>{productForm.id ? "編輯商品" : "新增商品"}</h2>
            </div>
            <div className="order-modal-body form-stack">
              <label className="field">
                <span>品名</span>
                <input
                  value={productForm.name}
                  onChange={(event) => setProductForm({ ...productForm, name: event.target.value })}
                />
              </label>
              <div className="field-row">
                <label className="field">
                  <span>類型</span>
                  <select
                    value={productForm.category}
                    onChange={(event) =>
                      setProductForm({
                        ...productForm,
                        category: event.target.value as "bag" | "gift_box",
                        giftRule: event.target.value === "gift_box" ? productForm.giftRule : null
                      })
                    }
                  >
                    <option value="bag">袋裝</option>
                    <option value="gift_box">禮盒</option>
                  </select>
                </label>
                <label className="field">
                  <span>規格</span>
                  <input
                    value={productForm.spec}
                    onChange={(event) =>
                      setProductForm({ ...productForm, spec: event.target.value })
                    }
                  />
                </label>
              </div>
              <div className="field-row">
                <label className="field">
                  <span>售價</span>
                  <input
                    type="number"
                    min={0}
                    value={productForm.price || ""}
                    onChange={(event) =>
                      setProductForm({ ...productForm, price: Number(event.target.value) })
                    }
                  />
                </label>
                <label className="field">
                  <span>狀態</span>
                  <select
                    value={productForm.isActive ? "active" : "inactive"}
                    onChange={(event) =>
                      setProductForm({ ...productForm, isActive: event.target.value === "active" })
                    }
                  >
                    <option value="active">啟用</option>
                    <option value="inactive">停用</option>
                  </select>
                </label>
              </div>
              <label className="field">
                <span>顯示在 POS「常用」分類</span>
                <select
                  value={productForm.isPopular ? "yes" : "no"}
                  onChange={(event) =>
                    setProductForm({ ...productForm, isPopular: event.target.value === "yes" })
                  }
                >
                  <option value="no">否</option>
                  <option value="yes">是(前台常用分類會列出)</option>
                </select>
              </label>

              {productForm.category === "gift_box" ? (
                <div className="field-row">
                  <label className="field">
                    <span>禮盒規則</span>
                    <select
                      value={productForm.giftRule?.selectionMode ?? ""}
                      onChange={(event) =>
                        event.target.value
                          ? updateGiftRule({
                              selectionMode: event.target.value as "select" | "fixed"
                            })
                          : setProductForm({ ...productForm, giftRule: null })
                      }
                    >
                      <option value="">無</option>
                      <option value="select">自選口味</option>
                      <option value="fixed">固定口味</option>
                    </select>
                  </label>
                  {productForm.giftRule?.selectionMode === "select" ? (
                    <>
                      <label className="field">
                        <span>口味數</span>
                        <input
                          type="number"
                          min={1}
                          value={productForm.giftRule?.requiredFlavorCount ?? 3}
                          onChange={(event) =>
                            updateGiftRule({ requiredFlavorCount: Number(event.target.value) })
                          }
                        />
                      </label>
                      <label className="field">
                        <span>含蔥餅</span>
                        <select
                          value={productForm.giftRule?.includesScallionCracker ? "yes" : "no"}
                          onChange={(event) =>
                            updateGiftRule({
                              includesScallionCracker: event.target.value === "yes"
                            })
                          }
                        >
                          <option value="no">否</option>
                          <option value="yes">是</option>
                        </select>
                      </label>
                    </>
                  ) : null}
                </div>
              ) : null}

              {productForm.category === "gift_box" &&
              productForm.giftRule?.selectionMode === "select" ? (
                <div className="field">
                  <span>可選口味（都不勾 = 全部口味可選）</span>
                  <div className="check-chip-list">
                    {flavors
                      .filter((flavor) => flavor.isActive)
                      .map((flavor) => {
                        const checked =
                          productForm.giftRule?.allowedFlavorIds?.includes(flavor.id) ?? false;

                        return (
                          <label key={flavor.id} className="check-chip">
                            <input
                              checked={checked}
                              onChange={() => toggleAllowedFlavor(flavor.id)}
                              type="checkbox"
                            />{" "}
                            {flavor.name}
                          </label>
                        );
                      })}
                  </div>
                </div>
              ) : null}
            </div>
            <div className="modal-actions">
              <button className="secondary-action" onClick={() => setModal(null)} type="button">
                取消
              </button>
              <button
                className="primary-action"
                disabled={saving}
                onClick={saveProduct}
                type="button"
              >
                {saving ? "儲存中..." : productForm.id ? "更新商品" : "新增商品"}
              </button>
            </div>
          </section>
        </div>
      ) : null}

      {modal === "discount" ? (
        <div className="modal-backdrop" onClick={() => setModal(null)} role="presentation">
          <section
            aria-label={discountForm.id ? "編輯折扣" : "新增折扣"}
            className="modal order-modal"
            onClick={(event) => event.stopPropagation()}
          >
            <div className="panel-header">
              <h2>{discountForm.id ? "編輯折扣" : "新增折扣"}</h2>
            </div>
            <div className="order-modal-body form-stack">
              <label className="field">
                <span>名稱</span>
                <input
                  value={discountForm.name}
                  onChange={(event) =>
                    setDiscountForm({ ...discountForm, name: event.target.value })
                  }
                />
              </label>
              <div className="field-row">
                <label className="field">
                  <span>類型</span>
                  <select
                    value={discountForm.discountType}
                    onChange={(event) =>
                      setDiscountForm({
                        ...discountForm,
                        discountType: event.target.value as "percentage" | "fixed_amount"
                      })
                    }
                  >
                    <option value="percentage">百分比(9 折填 0.9)</option>
                    <option value="fixed_amount">固定金額</option>
                  </select>
                </label>
                <label className="field">
                  <span>折扣值</span>
                  <input
                    type="number"
                    min={0}
                    step={discountForm.discountType === "percentage" ? 0.05 : 10}
                    value={discountForm.value || ""}
                    onChange={(event) =>
                      setDiscountForm({ ...discountForm, value: Number(event.target.value) })
                    }
                  />
                </label>
              </div>
              <div className="field-row">
                <label className="field">
                  <span>最低消費(可空)</span>
                  <input
                    type="number"
                    min={0}
                    value={discountForm.minOrderAmount ?? ""}
                    onChange={(event) =>
                      setDiscountForm({
                        ...discountForm,
                        minOrderAmount:
                          event.target.value === "" ? null : Number(event.target.value)
                      })
                    }
                  />
                </label>
                <label className="field">
                  <span>狀態</span>
                  <select
                    value={discountForm.isActive ? "active" : "inactive"}
                    onChange={(event) =>
                      setDiscountForm({
                        ...discountForm,
                        isActive: event.target.value === "active"
                      })
                    }
                  >
                    <option value="active">啟用</option>
                    <option value="inactive">停用</option>
                  </select>
                </label>
              </div>
            </div>
            <div className="modal-actions">
              <button className="secondary-action" onClick={() => setModal(null)} type="button">
                取消
              </button>
              <button
                className="primary-action"
                disabled={saving}
                onClick={saveDiscount}
                type="button"
              >
                {saving ? "儲存中..." : discountForm.id ? "更新折扣" : "新增折扣"}
              </button>
            </div>
          </section>
        </div>
      ) : null}

      {modal === "flavor" ? (
        <div className="modal-backdrop" onClick={() => setModal(null)} role="presentation">
          <section
            aria-label={flavorForm.id ? "編輯口味" : "新增口味"}
            className="modal order-modal"
            onClick={(event) => event.stopPropagation()}
          >
            <div className="panel-header">
              <h2>{flavorForm.id ? "編輯口味" : "新增口味"}</h2>
            </div>
            <div className="order-modal-body form-stack">
              <div className="field-row">
                <label className="field">
                  <span>口味名稱</span>
                  <input
                    value={flavorForm.name}
                    onChange={(event) =>
                      setFlavorForm({ ...flavorForm, name: event.target.value })
                    }
                  />
                </label>
                <label className="field">
                  <span>規格</span>
                  <input
                    value={flavorForm.spec}
                    onChange={(event) =>
                      setFlavorForm({ ...flavorForm, spec: event.target.value })
                    }
                  />
                </label>
                <label className="field">
                  <span>狀態</span>
                  <select
                    value={flavorForm.isActive ? "active" : "inactive"}
                    onChange={(event) =>
                      setFlavorForm({ ...flavorForm, isActive: event.target.value === "active" })
                    }
                  >
                    <option value="active">啟用</option>
                    <option value="inactive">停用</option>
                  </select>
                </label>
              </div>
              <p className="form-status">
                口味供自選禮盒挑選並各自管理庫存;停用後 POS 不再顯示,歷史紀錄保留。
              </p>
            </div>
            <div className="modal-actions">
              <button className="secondary-action" onClick={() => setModal(null)} type="button">
                取消
              </button>
              <button
                className="primary-action"
                disabled={saving}
                onClick={saveFlavor}
                type="button"
              >
                {saving ? "儲存中..." : flavorForm.id ? "更新口味" : "新增口味"}
              </button>
            </div>
          </section>
        </div>
      ) : null}

      {modal === "bundle" ? (
        <div className="modal-backdrop" onClick={() => setModal(null)} role="presentation">
          <section
            aria-label={bundleForm.id ? "編輯組合價" : "新增組合價"}
            className="modal order-modal"
            onClick={(event) => event.stopPropagation()}
          >
            <div className="panel-header">
              <div>
                <h2>{bundleForm.id ? "編輯組合價" : "新增組合價"}</h2>
                <p>同群商品自動以最划算組合計價,訂單折扣(如 9 折)以組合後金額計算。</p>
              </div>
            </div>
            <div className="order-modal-body form-stack">
              <div className="field-row">
                <label className="field">
                  <span>名稱</span>
                  <input
                    value={bundleForm.name}
                    onChange={(event) =>
                      setBundleForm({ ...bundleForm, name: event.target.value })
                    }
                  />
                </label>
                <label className="field">
                  <span>狀態</span>
                  <select
                    value={bundleForm.isActive ? "active" : "inactive"}
                    onChange={(event) =>
                      setBundleForm({ ...bundleForm, isActive: event.target.value === "active" })
                    }
                  >
                    <option value="active">啟用</option>
                    <option value="inactive">停用</option>
                  </select>
                </label>
              </div>
              <div className="field">
                <span>適用商品</span>
                <div className="check-chip-list">
                  {products
                    .filter((product) => product.isActive)
                    .map((product) => (
                      <label key={product.id} className="check-chip">
                        <input
                          checked={bundleForm.productIds.includes(product.id)}
                          onChange={() => toggleBundleProduct(product.id)}
                          type="checkbox"
                        />{" "}
                        {product.name}
                      </label>
                    ))}
                </div>
              </div>
              {bundleForm.tiers.map((tier, index) => (
                <div className="field-row" key={index}>
                  <label className="field">
                    <span>件數</span>
                    <input
                      type="number"
                      min={2}
                      value={tier.quantity || ""}
                      onChange={(event) =>
                        updateBundleTier(index, { quantity: Number(event.target.value) })
                      }
                    />
                  </label>
                  <label className="field">
                    <span>組合價</span>
                    <input
                      type="number"
                      min={0}
                      value={tier.price || ""}
                      onChange={(event) =>
                        updateBundleTier(index, { price: Number(event.target.value) })
                      }
                    />
                  </label>
                  <label className="field">
                    <span>&nbsp;</span>
                    <button
                      className="secondary-action"
                      onClick={() =>
                        setBundleForm((current) => ({
                          ...current,
                          tiers: current.tiers.filter((_, tierIndex) => tierIndex !== index)
                        }))
                      }
                      type="button"
                    >
                      移除
                    </button>
                  </label>
                </div>
              ))}
              <div className="form-actions">
                <button
                  className="secondary-action"
                  onClick={() =>
                    setBundleForm((current) => ({
                      ...current,
                      tiers: [...current.tiers, { quantity: 2, price: 0 }]
                    }))
                  }
                  type="button"
                >
                  新增級距
                </button>
              </div>
            </div>
            <div className="modal-actions">
              <button className="secondary-action" onClick={() => setModal(null)} type="button">
                取消
              </button>
              <button
                className="primary-action"
                disabled={saving}
                onClick={saveBundle}
                type="button"
              >
                {saving ? "儲存中..." : bundleForm.id ? "更新組合價" : "新增組合價"}
              </button>
            </div>
          </section>
        </div>
      ) : null}
    </>
  );
}
