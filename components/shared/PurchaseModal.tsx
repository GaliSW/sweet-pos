"use client";

import { useEffect, useState } from "react";

type ItemOption = {
  key: string;
  productId: string | null;
  flavorId: string | null;
  label: string;
};

// 批次進貨:列出全部品項(袋裝商品 + 禮盒口味),一次輸入多品項進貨數量
export function PurchaseModal({
  counterId,
  counterName,
  onClose,
  onSaved
}: {
  counterId: string;
  counterName: string;
  onClose: () => void;
  onSaved: (message: string) => void;
}) {
  const [items, setItems] = useState<ItemOption[]>([]);
  const [quantities, setQuantities] = useState<Record<string, string>>({});
  const [note, setNote] = useState("");
  const [status, setStatus] = useState("讀取品項中...");
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    void loadItems();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function loadItems() {
    const result = await fetch("/api/catalog")
      .then((response) => response.json())
      .catch(() => null);

    if (!result?.ok || result.data.source !== "supabase") {
      setStatus("無法載入品項（Demo 模式不支援批次進貨）");
      return;
    }

    const data = result.data;
    // 可進貨的商品:袋裝 + 固定口味禮盒(自選禮盒進的是口味庫存)
    const selectModeIds = new Set(
      (data.giftRules ?? [])
        .filter((rule: { selection_mode: string }) => rule.selection_mode === "select")
        .map((rule: { product_id: string }) => rule.product_id)
    );
    const nextItems: ItemOption[] = [
      ...(data.products ?? [])
        .filter(
          (product: { id: string; category: string }) =>
            product.category === "bag" || !selectModeIds.has(product.id)
        )
        .map((product: { id: string; category: string; name: string; spec: string }) => ({
          key: `product:${product.id}`,
          productId: product.id,
          flavorId: null,
          label: `${product.name}（${product.spec}${product.category === "gift_box" ? "・禮盒" : ""}）`
        })),
      ...(data.flavors ?? []).map((flavor: { id: string; name: string; spec: string }) => ({
        key: `flavor:${flavor.id}`,
        productId: null,
        flavorId: flavor.id,
        label: `${flavor.name}（${flavor.spec}・禮盒口味）`
      }))
    ];

    setItems(nextItems);
    setStatus("");
  }

  async function submitPurchase() {
    const rows = items
      .map((item) => ({
        productId: item.productId,
        flavorId: item.flavorId,
        quantity: Math.floor(Number(quantities[item.key] || 0))
      }))
      .filter((row) => row.quantity > 0);

    if (rows.length === 0) {
      setStatus("請至少輸入一個品項的進貨數量");
      return;
    }

    setSubmitting(true);
    setStatus("儲存進貨中...");

    const response = await fetch("/api/inventory", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        counterId,
        movementType: "purchase",
        quantity: 0,
        note,
        items: rows
      })
    });
    const result = await response.json();

    setSubmitting(false);

    if (!result.ok) {
      setStatus(result.error);
      return;
    }

    onSaved(`已新增 ${rows.length} 筆進貨紀錄`);
  }

  return (
    <div className="modal-backdrop" onClick={onClose} role="presentation">
      <section
        aria-label={`${counterName} 批次進貨`}
        className="modal order-modal"
        onClick={(event) => event.stopPropagation()}
      >
        <div className="panel-header">
          <div>
            <h2>進貨</h2>
            <p>{counterName}｜輸入各品項進貨數量，留空或 0 表示不進貨。</p>
          </div>
          {status ? <span className="pill">{status}</span> : null}
        </div>

        <div className="order-modal-body">
          <div className="table-scroll">
            <table>
              <thead>
                <tr>
                  <th>品項</th>
                  <th>進貨數量</th>
                </tr>
              </thead>
              <tbody>
                {items.map((item) => (
                  <tr key={item.key}>
                    <td>{item.label}</td>
                    <td>
                      <input
                        className="qty-input"
                        inputMode="numeric"
                        min={0}
                        placeholder="0"
                        type="number"
                        value={quantities[item.key] ?? ""}
                        onChange={(event) =>
                          setQuantities((current) => ({
                            ...current,
                            [item.key]: event.target.value
                          }))
                        }
                      />
                    </td>
                  </tr>
                ))}
                {items.length === 0 ? (
                  <tr>
                    <td colSpan={2}>沒有可進貨的品項</td>
                  </tr>
                ) : null}
              </tbody>
            </table>
          </div>

          <label className="field">
            <span>備註（選填，套用到本次全部進貨）</span>
            <input
              placeholder="例如：倉庫補貨、廠商到貨"
              value={note}
              onChange={(event) => setNote(event.target.value)}
            />
          </label>
        </div>

        <div className="modal-actions">
          <button className="secondary-action" onClick={onClose} type="button">
            取消
          </button>
          <button
            className="primary-action"
            disabled={submitting || items.length === 0}
            onClick={submitPurchase}
            type="button"
          >
            {submitting ? "儲存中..." : "送出進貨"}
          </button>
        </div>
      </section>
    </div>
  );
}
