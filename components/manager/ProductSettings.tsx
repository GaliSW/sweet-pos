"use client";

import { useEffect, useState } from "react";
import type { UpsertDiscountInput, UpsertProductInput } from "@/lib/backend/api-types";

type ProductRow = {
  id: string;
  category: "bag" | "gift_box";
  name: string;
  spec: string;
  price: number;
  isActive: boolean;
  giftRule: {
    selectionMode: "select" | "fixed";
    requiredFlavorCount: number;
    includesScallionCracker: boolean;
  } | null;
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
  giftRule: null
};

const emptyDiscount: UpsertDiscountInput = {
  name: "",
  discountType: "percentage",
  value: 0.9,
  minOrderAmount: null,
  isActive: true
};

export function ProductSettings() {
  const [products, setProducts] = useState<ProductRow[]>([]);
  const [discounts, setDiscounts] = useState<DiscountRow[]>([]);
  const [productForm, setProductForm] = useState<UpsertProductInput>(emptyProduct);
  const [discountForm, setDiscountForm] = useState<UpsertDiscountInput>(emptyDiscount);
  const [status, setStatus] = useState("讀取商品資料中...");
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    void loadData();
  }, []);

  async function loadData() {
    const [productsResponse, discountsResponse] = await Promise.all([
      fetch("/api/products"),
      fetch("/api/discounts")
    ]);
    const productsResult = await productsResponse.json();
    const discountsResult = await discountsResponse.json();

    if (!productsResult.ok || !discountsResult.ok) {
      setStatus(productsResult.error ?? discountsResult.error);
      return;
    }

    setProducts(productsResult.data.products);
    setDiscounts(discountsResult.data.discounts);
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
      giftRule: product.giftRule
        ? {
            selectionMode: product.giftRule.selectionMode,
            requiredFlavorCount: product.giftRule.requiredFlavorCount,
            includesScallionCracker: product.giftRule.includesScallionCracker
          }
        : null
    });
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
    await loadData();
  }

  function updateGiftRule(partial: Partial<NonNullable<UpsertProductInput["giftRule"]>>) {
    setProductForm((current) => ({
      ...current,
      giftRule: {
        selectionMode: current.giftRule?.selectionMode ?? "select",
        requiredFlavorCount: current.giftRule?.requiredFlavorCount ?? 3,
        includesScallionCracker: current.giftRule?.includesScallionCracker ?? false,
        ...partial
      }
    }));
  }

  return (
    <>
      <section className="section-title">
        <div>
          <h1>商品與折扣</h1>
          <p>管理袋裝商品、禮盒價格、口味規則與折扣。</p>
        </div>
        <span className="pill">{status}</span>
      </section>

      <section className="content-grid">
        <article className="panel data-card">
          <h2>商品</h2>
          <table>
            <thead>
              <tr>
                <th>品名</th>
                <th>類型</th>
                <th>規格</th>
                <th>售價</th>
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
        </article>

        <article className="panel data-card form-stack">
          <h2>{productForm.id ? "編輯商品" : "新增商品"}</h2>
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
                onChange={(event) => setProductForm({ ...productForm, spec: event.target.value })}
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
                        updateGiftRule({ includesScallionCracker: event.target.value === "yes" })
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

          <div className="form-actions">
            {productForm.id ? (
              <button
                className="secondary-action"
                onClick={() => setProductForm(emptyProduct)}
                type="button"
              >
                取消編輯
              </button>
            ) : null}
            <button className="primary-action slim" disabled={saving} onClick={saveProduct} type="button">
              {productForm.id ? "更新商品" : "新增商品"}
            </button>
          </div>
        </article>
      </section>

      <section className="content-grid">
        <article className="panel data-card">
          <h2>折扣</h2>
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
        </article>

        <article className="panel data-card form-stack">
          <h2>{discountForm.id ? "編輯折扣" : "新增折扣"}</h2>
          <label className="field">
            <span>名稱</span>
            <input
              value={discountForm.name}
              onChange={(event) => setDiscountForm({ ...discountForm, name: event.target.value })}
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
                    minOrderAmount: event.target.value === "" ? null : Number(event.target.value)
                  })
                }
              />
            </label>
            <label className="field">
              <span>狀態</span>
              <select
                value={discountForm.isActive ? "active" : "inactive"}
                onChange={(event) =>
                  setDiscountForm({ ...discountForm, isActive: event.target.value === "active" })
                }
              >
                <option value="active">啟用</option>
                <option value="inactive">停用</option>
              </select>
            </label>
          </div>
          <div className="form-actions">
            {discountForm.id ? (
              <button
                className="secondary-action"
                onClick={() => setDiscountForm(emptyDiscount)}
                type="button"
              >
                取消編輯
              </button>
            ) : null}
            <button className="primary-action slim" disabled={saving} onClick={saveDiscount} type="button">
              {discountForm.id ? "更新折扣" : "新增折扣"}
            </button>
          </div>
        </article>
      </section>
    </>
  );
}
