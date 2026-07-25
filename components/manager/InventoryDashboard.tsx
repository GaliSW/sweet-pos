"use client";

import type { TouchEvent as ReactTouchEvent } from "react";
import { useEffect, useMemo, useRef, useState } from "react";
import type { InventoryMovementType } from "@/lib/backend/api-types";
import { PurchaseModal } from "@/components/shared/PurchaseModal";
import { counters as fallbackCounters } from "@/lib/domain/sample-data";

type Movement = {
  id: string;
  counterName: string;
  itemName: string;
  itemSpec: string;
  movementType: InventoryMovementType;
  movementLabel: string;
  quantity: number;
  countedQuantity: number | null;
  note: string | null;
  createdByName: string;
  createdAt: string;
  updatedByName: string;
  updatedAt: string | null;
  reviewedByName: string;
  reviewedAt: string | null;
};

type SummaryRow = {
  counterName: string;
  itemKey: string;
  productId: string | null;
  flavorId: string | null;
  itemName: string;
  itemSpec: string;
  stock: number;
};

const reviewTypes = new Set<InventoryMovementType>(["waste", "adjustment", "sampling"]);

export function InventoryDashboard() {
  const [counters, setCounters] = useState(fallbackCounters);
  const [counterId, setCounterId] = useState("all");
  const [search, setSearch] = useState("");
  const [movements, setMovements] = useState<Movement[]>([]);
  const [summary, setSummary] = useState<SummaryRow[]>([]);
  const [status, setStatus] = useState("讀取庫存資料中...");
  const [working, setWorking] = useState(false);
  const [purchaseOpen, setPurchaseOpen] = useState(false);
  const [dragKey, setDragKey] = useState<string | null>(null);
  const summaryRef = useRef<SummaryRow[]>([]);

  // 選定單一櫃位時才能拖曳排序(「全部」檢視混多櫃,順序無意義)
  const canReorder = counterId !== "all";

  useEffect(() => {
    summaryRef.current = summary;
  }, [summary]);

  const visibleMovements = useMemo(() => {
    const keyword = search.trim().toLowerCase();

    if (!keyword) return movements;

    return movements.filter((movement) =>
      [
        movement.counterName,
        movement.itemName,
        movement.itemSpec,
        movement.movementLabel,
        movement.note ?? "",
        movement.createdByName,
        movement.updatedByName,
        movement.reviewedByName
      ]
        .join(" ")
        .toLowerCase()
        .includes(keyword)
    );
  }, [movements, search]);

  useEffect(() => {
    void loadCounters();
  }, []);

  useEffect(() => {
    void loadInventory();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [counterId]);

  async function loadCounters() {
    const result = await fetch("/api/catalog")
      .then((response) => response.json())
      .catch(() => null);

    if (result?.ok) setCounters(result.data.counters ?? fallbackCounters);
  }

  async function loadInventory() {
    const params = counterId === "all" ? "" : `?counterId=${counterId}`;
    const response = await fetch(`/api/inventory${params}`);
    const result = await response.json();

    if (!result.ok) {
      setStatus(result.error);
      return;
    }

    setMovements(result.data.movements ?? []);
    setSummary(result.data.summary ?? []);
    setStatus(result.data.source === "supabase" ? "已連線本地資料庫" : "Demo 模式");
  }

  // 手機觸控:按住 ⠿ 把手上下滑即時換位,放開儲存
  function handleTouchMove(event: ReactTouchEvent) {
    if (!dragKey) return;

    const touch = event.touches[0];
    const element = document.elementFromPoint(touch.clientX, touch.clientY);
    const targetKey = element?.closest("tr[data-item-key]")?.getAttribute("data-item-key");

    if (!targetKey || targetKey === dragKey) return;

    setSummary((current) => {
      const rows = [...current];
      const from = rows.findIndex((row) => row.itemKey === dragKey);
      const to = rows.findIndex((row) => row.itemKey === targetKey);

      if (from < 0 || to < 0) return current;

      const [moved] = rows.splice(from, 1);
      rows.splice(to, 0, moved);
      return rows;
    });
  }

  function handleTouchEnd() {
    if (!dragKey) return;

    setDragKey(null);
    void persistSortOrder(summaryRef.current);
  }

  // 拖曳調整庫存摘要順序:順序存於商品/口味(全店共用),POS 與品項清單同步套用
  function handleSortDrop(targetKey: string) {
    if (!dragKey || dragKey === targetKey) {
      setDragKey(null);
      return;
    }

    const rows = [...summary];
    const from = rows.findIndex((row) => row.itemKey === dragKey);
    const to = rows.findIndex((row) => row.itemKey === targetKey);

    setDragKey(null);

    if (from < 0 || to < 0) return;

    const [moved] = rows.splice(from, 1);
    rows.splice(to, 0, moved);
    setSummary(rows);
    void persistSortOrder(rows);
  }

  async function persistSortOrder(rows: SummaryRow[]) {
    const response = await fetch("/api/inventory/sort", {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        items: rows.map((row) => ({ productId: row.productId, flavorId: row.flavorId }))
      })
    });
    const result = await response.json();

    setStatus(result.ok ? "排序已儲存（POS 與品項清單同步套用）" : result.error);
  }

  async function reviewMovement(movement: Movement) {
    setWorking(true);
    const response = await fetch("/api/inventory", {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ movementId: movement.id, action: "review" })
    });
    const result = await response.json();
    setWorking(false);

    if (!result.ok) {
      setStatus(result.error);
      return;
    }

    setStatus(`已覆核「${movement.movementLabel} / ${movement.itemName}」`);
    await loadInventory();
  }

  async function deleteMovement(movement: Movement) {
    if (!window.confirm(`確定刪除這筆「${movement.movementLabel} / ${movement.itemName}」紀錄？`)) {
      return;
    }

    setWorking(true);
    const response = await fetch("/api/inventory", {
      method: "DELETE",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ movementId: movement.id })
    });
    const result = await response.json();
    setWorking(false);

    if (!result.ok) {
      setStatus(result.error);
      return;
    }

    setStatus("紀錄已刪除");
    await loadInventory();
  }

  return (
    <>
      <section className="section-title">
        <div>
          <h1>庫存管理</h1>
          <p>跨櫃位庫存彙總、低庫存警示與異常覆核。</p>
        </div>
        <div className="toolbar">
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
          <label className="field compact">
            <span>搜尋</span>
            <input
              placeholder="品項 / 備註 / 人員 / 類型..."
              value={search}
              onChange={(event) => setSearch(event.target.value)}
            />
          </label>
          <button
            className="secondary-action"
            disabled={counterId === "all"}
            onClick={() => setPurchaseOpen(true)}
            title={counterId === "all" ? "請先選擇櫃位再進貨" : undefined}
            type="button"
          >
            進貨
          </button>
          <span className="pill">{status}</span>
        </div>
      </section>

      <section className="panel data-card">
        <div className="panel-header">
          <h2>庫存摘要</h2>
          <span className="pill">
            {canReorder ? "拖曳列可自訂排序" : "選擇單一櫃位即可拖曳排序"}
          </span>
        </div>
        <div className="table-scroll">
          <table>
            <thead>
              <tr>
                <th>櫃位</th>
                <th>品項</th>
                <th>推估庫存</th>
                <th>狀態</th>
              </tr>
            </thead>
            <tbody>
              {summary.map((row) => {
                const label = row.stock <= 0 ? "待盤點 / 缺貨" : row.stock <= 10 ? "低庫存" : "正常";

                return (
                  <tr
                    className={canReorder ? `drag-row ${dragKey === row.itemKey ? "dragging" : ""}` : ""}
                    data-item-key={row.itemKey}
                    draggable={canReorder}
                    key={`${row.counterName}-${row.itemKey}`}
                    onDragEnd={() => setDragKey(null)}
                    onDragOver={(event) => {
                      if (canReorder) event.preventDefault();
                    }}
                    onDragStart={() => {
                      if (canReorder) setDragKey(row.itemKey);
                    }}
                    onDrop={() => {
                      if (canReorder) handleSortDrop(row.itemKey);
                    }}
                  >
                    <td>{row.counterName}</td>
                    <td>
                      {canReorder ? (
                        <span
                          aria-hidden
                          className="drag-handle"
                          onTouchEnd={handleTouchEnd}
                          onTouchMove={handleTouchMove}
                          onTouchStart={() => setDragKey(row.itemKey)}
                        >
                          ⠿
                        </span>
                      ) : null}
                      {row.itemName}（{row.itemSpec}）
                    </td>
                    <td>{row.stock}</td>
                    <td>
                      <span className={label === "正常" ? "status" : "status warn"}>{label}</span>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </section>

      <section className="panel data-card">
        <h2>異動紀錄</h2>
        <div className="table-scroll">
          <table>
            <thead>
              <tr>
                <th>時間</th>
                <th>櫃位</th>
                <th>類型</th>
                <th>品項</th>
                <th>數量</th>
                <th>備註</th>
                <th>建立 / 更新</th>
                <th>覆核</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {visibleMovements.map((movement) => (
                <tr key={movement.id}>
                  <td>{formatTime(movement.createdAt)}</td>
                  <td>{movement.counterName}</td>
                  <td>{movement.movementLabel}</td>
                  <td>{movement.itemName}</td>
                  <td>{movement.countedQuantity ?? movement.quantity}</td>
                  <td>{movement.note ?? "-"}</td>
                  <td>
                    {movement.createdByName}
                    {movement.updatedByName ? `（${movement.updatedByName} 更新）` : ""}
                  </td>
                  <td>
                    {movement.reviewedAt ? (
                      <span className="status">{movement.reviewedByName} 已覆核</span>
                    ) : reviewTypes.has(movement.movementType) ? (
                      <span className="status warn">待覆核</span>
                    ) : (
                      "-"
                    )}
                  </td>
                  <td>
                    <div className="toolbar">
                      {!movement.reviewedAt && reviewTypes.has(movement.movementType) ? (
                        <button
                          className="secondary-action"
                          disabled={working}
                          onClick={() => reviewMovement(movement)}
                          type="button"
                        >
                          覆核
                        </button>
                      ) : null}
                      <button
                        className="secondary-action"
                        disabled={working}
                        onClick={() => deleteMovement(movement)}
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

      {purchaseOpen && counterId !== "all" ? (
        <PurchaseModal
          counterId={counterId}
          counterName={counters.find((counter) => counter.id === counterId)?.name ?? ""}
          onClose={() => setPurchaseOpen(false)}
          onSaved={(message) => {
            setPurchaseOpen(false);
            setStatus(message);
            void loadInventory();
          }}
        />
      ) : null}
    </>
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
