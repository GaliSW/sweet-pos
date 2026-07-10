"use client";

import type { FormEvent } from "react";
import { useEffect, useMemo, useState } from "react";
import type { CreateInventoryMovementInput, InventoryMovementType } from "@/lib/backend/api-types";
import { counters as fallbackCounters, products as fallbackProducts } from "@/lib/domain/sample-data";
import { COUNTER_CHANGED_EVENT, getSelectedCounterId } from "@/lib/shared/counter-preference";

type ItemOption = {
  key: string;
  productId: string | null;
  flavorId: string | null;
  label: string;
};

type InventoryMovement = {
  id: string;
  counterName: string;
  itemKey: string;
  itemName: string;
  itemSpec: string;
  movementType: InventoryMovementType;
  movementLabel: string;
  quantity: number;
  countedQuantity: number | null;
  note: string | null;
  createdById: string;
  createdByName: string;
  createdAt: string;
  updatedByName: string;
};

type InventorySummary = {
  counterName: string;
  itemName: string;
  itemSpec: string;
  stock: number;
};

const movementOptions: Array<{ value: InventoryMovementType; label: string }> = [
  { value: "opening_count", label: "開班盤點" },
  { value: "closing_count", label: "下班盤點" },
  { value: "purchase", label: "進貨" },
  { value: "sampling", label: "試吃" },
  { value: "waste", label: "報廢" },
  { value: "adjustment", label: "調整" }
];

const countTypes = new Set<InventoryMovementType>(["opening_count", "closing_count"]);
const noteRequiredTypes = new Set<InventoryMovementType>(["sampling", "waste", "adjustment"]);

const fallbackItems: ItemOption[] = fallbackProducts
  .filter((product) => product.category === "bag")
  .map((product) => ({
    key: `product:${product.id}`,
    productId: product.id,
    flavorId: null,
    label: `${product.name}（${product.spec}）`
  }));

export function InventoryMovementForm() {
  const [items, setItems] = useState<ItemOption[]>(fallbackItems);
  const [counters, setCounters] = useState(fallbackCounters);
  const [movements, setMovements] = useState<InventoryMovement[]>([]);
  const [summary, setSummary] = useState<InventorySummary[]>([]);
  const [movementType, setMovementType] = useState<InventoryMovementType>("opening_count");
  const [itemKey, setItemKey] = useState(fallbackItems[0]?.key ?? "");
  const [counterId, setCounterId] = useState("");
  const [quantity, setQuantity] = useState("0");
  const [countedQuantity, setCountedQuantity] = useState("");
  const [note, setNote] = useState("");
  const [status, setStatus] = useState("讀取庫存資料中...");
  const [submitting, setSubmitting] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [me, setMe] = useState<{ id: string; role: "staff" | "manager" } | null>(null);

  const requiresCount = countTypes.has(movementType);
  const requiresNote = noteRequiredTypes.has(movementType);

  useEffect(() => {
    setCounterId(getSelectedCounterId());

    const onCounterChanged = (event: Event) => {
      setCounterId((event as CustomEvent<string>).detail);
    };

    window.addEventListener(COUNTER_CHANGED_EVENT, onCounterChanged);
    void loadCatalog();

    return () => window.removeEventListener(COUNTER_CHANGED_EVENT, onCounterChanged);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    if (counterId) void loadInventory();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [counterId]);

  useEffect(() => {
    if (requiresCount) setQuantity("0");
  }, [requiresCount]);

  const latestMovements = useMemo(() => movements.slice(0, 12), [movements]);
  const currentCounterName =
    counters.find((counter) => counter.id === counterId)?.name ?? counters[0]?.name ?? "";

  async function loadCatalog() {
    const [catalogResult, meResult] = await Promise.all([
      fetch("/api/catalog").then((response) => response.json()),
      fetch("/api/me")
        .then((response) => response.json())
        .catch(() => null)
    ]);

    if (meResult?.ok) {
      setMe({ id: meResult.data.id, role: meResult.data.role });
    }

    if (!catalogResult.ok) return;

    const data = catalogResult.data;
    setCounters(data.counters ?? fallbackCounters);
    setCounterId((current) => current || data.counters?.[0]?.id || "");

    if (data.source !== "supabase") return;

    const nextItems: ItemOption[] = [
      ...(data.products ?? [])
        .filter((product: { category: string }) => product.category === "bag")
        .map((product: { id: string; name: string; spec: string }) => ({
          key: `product:${product.id}`,
          productId: product.id,
          flavorId: null,
          label: `${product.name}（${product.spec}）`
        })),
      ...(data.flavors ?? []).map((flavor: { id: string; name: string; spec: string }) => ({
        key: `flavor:${flavor.id}`,
        productId: null,
        flavorId: flavor.id,
        label: `${flavor.name}（${flavor.spec}・禮盒口味）`
      }))
    ];

    setItems(nextItems);
    setItemKey((current) =>
      nextItems.some((item) => item.key === current) ? current : nextItems[0]?.key ?? ""
    );
  }

  async function loadInventory() {
    const response = await fetch(`/api/inventory?counterId=${counterId}`);
    const result = await response.json();

    if (!result.ok) {
      setStatus(result.error);
      return;
    }

    setMovements(result.data.movements ?? []);
    setSummary(result.data.summary ?? []);
    setStatus(result.data.source === "supabase" ? "已連線本地資料庫" : "Demo 模式");
  }

  function canEdit(movement: InventoryMovement) {
    if (!me) return false;
    if (me.role === "manager") return true;
    return movement.createdById === me.id;
  }

  function startEdit(movement: InventoryMovement) {
    setEditingId(movement.id);
    setMovementType(movement.movementType);
    setItemKey(movement.itemKey);
    setQuantity(String(Math.abs(movement.quantity)));
    setCountedQuantity(movement.countedQuantity == null ? "" : String(movement.countedQuantity));
    setNote(movement.note ?? "");
  }

  function cancelEdit() {
    setEditingId(null);
    setQuantity("0");
    setCountedQuantity("");
    setNote("");
  }

  async function deleteMovement(movement: InventoryMovement) {
    if (!window.confirm(`確定刪除這筆「${movement.movementLabel} / ${movement.itemName}」紀錄？`)) {
      return;
    }

    setSubmitting(true);
    const response = await fetch("/api/inventory", {
      method: "DELETE",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ movementId: movement.id })
    });
    const result = await response.json();
    setSubmitting(false);

    if (!result.ok) {
      setStatus(result.error);
      return;
    }

    setStatus("紀錄已刪除");
    if (editingId === movement.id) cancelEdit();
    await loadInventory();
  }

  async function submitMovement(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setSubmitting(true);
    setStatus("儲存中...");

    const item = items.find((candidate) => candidate.key === itemKey);

    let response: Response;

    if (editingId) {
      response = await fetch("/api/inventory", {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          movementId: editingId,
          action: "update",
          movementType,
          quantity: Number(quantity),
          countedQuantity: countedQuantity === "" ? null : Number(countedQuantity),
          note
        })
      });
    } else {
      const payload: CreateInventoryMovementInput = {
        counterId,
        productId: item?.productId,
        flavorId: item?.flavorId,
        movementType,
        quantity: Number(quantity),
        countedQuantity: countedQuantity === "" ? null : Number(countedQuantity),
        note
      };

      response = await fetch("/api/inventory", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(payload)
      });
    }

    const result = await response.json();

    setSubmitting(false);

    if (!result.ok) {
      setStatus(result.error);
      return;
    }

    setStatus(editingId ? "紀錄已更新" : "庫存異動已儲存");
    setEditingId(null);
    setNote("");
    setCountedQuantity("");
    setQuantity(requiresCount ? "0" : "1");
    await loadInventory();
  }

  return (
    <section className="content-grid">
      <form className="panel data-card inventory-form" onSubmit={submitMovement}>
        <h2>{editingId ? "編輯異動紀錄" : "新增異動"}</h2>
        <label className="field">
          <span>櫃位（由上方「目前櫃位」決定）</span>
          <input disabled value={currentCounterName} />
        </label>
        <label className="field">
          <span>異動類型</span>
          <select
            value={movementType}
            onChange={(event) => setMovementType(event.target.value as InventoryMovementType)}
          >
            {movementOptions.map((option) => (
              <option key={option.value} value={option.value}>
                {option.label}
              </option>
            ))}
          </select>
        </label>
        <label className="field">
          <span>品項（袋裝商品或禮盒口味）</span>
          <select
            disabled={Boolean(editingId)}
            value={itemKey}
            onChange={(event) => setItemKey(event.target.value)}
          >
            {items.map((item) => (
              <option key={item.key} value={item.key}>
                {item.label}
              </option>
            ))}
          </select>
        </label>
        <div className="field-row">
          <label className="field">
            <span>異動數量</span>
            <input
              disabled={requiresCount}
              inputMode="numeric"
              value={quantity}
              onChange={(event) => setQuantity(event.target.value)}
            />
            <small>盤點不需填異動量；試吃、報廢會自動扣庫存。</small>
          </label>
          <label className="field">
            <span>實際盤點庫存{requiresCount ? "" : "（可留空）"}</span>
            <input
              inputMode="numeric"
              placeholder={requiresCount ? "必填" : "非盤點異動可留空"}
              value={countedQuantity}
              onChange={(event) => setCountedQuantity(event.target.value)}
            />
            <small>只有開班、下班盤點一定要填目前架上實際數量。</small>
          </label>
        </div>
        <label className="field">
          <span>原因 / 備註{requiresNote ? "（必填）" : ""}</span>
          <input
            placeholder="例如：顧客試吃、包裝破損、倉庫補貨、盤點差異"
            value={note}
            onChange={(event) => setNote(event.target.value)}
          />
        </label>
        <div className="form-actions">
          {editingId ? (
            <button className="secondary-action" onClick={cancelEdit} type="button">
              取消編輯
            </button>
          ) : null}
          <button className="primary-action" disabled={submitting} type="submit">
            {submitting ? "儲存中" : editingId ? "更新紀錄" : "儲存異動"}
          </button>
        </div>
        <p className="form-status">{status}</p>
      </form>

      <section className="panel data-card">
        <h2>{currentCounterName} 最近紀錄</h2>
        <div className="table-scroll">
          <table>
            <thead>
              <tr>
                <th>時間</th>
                <th>類型</th>
                <th>品項</th>
                <th>數量</th>
                <th>備註</th>
                <th>建立 / 更新</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {latestMovements.map((movement) => (
                <tr key={movement.id}>
                  <td>{formatTime(movement.createdAt)}</td>
                  <td>{movement.movementLabel}</td>
                  <td>{movement.itemName}</td>
                  <td>{movement.countedQuantity ?? movement.quantity}</td>
                  <td>{movement.note ?? "-"}</td>
                  <td>
                    {movement.createdByName}
                    {movement.updatedByName ? `（${movement.updatedByName} 更新）` : ""}
                  </td>
                  <td>
                    {canEdit(movement) ? (
                      <div className="toolbar">
                        <button
                          className="secondary-action"
                          onClick={() => startEdit(movement)}
                          type="button"
                        >
                          編輯
                        </button>
                        <button
                          className="secondary-action"
                          disabled={submitting}
                          onClick={() => deleteMovement(movement)}
                          type="button"
                        >
                          刪除
                        </button>
                      </div>
                    ) : null}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>

      <section className="panel data-card inventory-summary-panel">
        <h2>庫存摘要</h2>
        <div className="table-scroll">
          <table>
            <thead>
              <tr>
                <th>櫃位</th>
                <th>品項</th>
                <th>推估庫存</th>
              </tr>
            </thead>
            <tbody>
              {summary.map((row) => (
                <tr key={`${row.counterName}-${row.itemName}-${row.itemSpec}`}>
                  <td>{row.counterName}</td>
                  <td>
                    {row.itemName}（{row.itemSpec}）
                  </td>
                  <td>
                    <span className={row.stock <= 10 ? "status warn" : "status"}>{row.stock}</span>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>
    </section>
  );
}

function formatTime(value: string) {
  return new Intl.DateTimeFormat("zh-TW", {
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit"
  }).format(new Date(value));
}
