"use client";

import { useEffect, useMemo, useState } from "react";
import type { InventoryMovementType } from "@/lib/backend/api-types";
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
          <span className="pill">{status}</span>
        </div>
      </section>

      <section className="panel data-card">
        <h2>庫存摘要</h2>
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
                  <tr key={`${row.counterName}-${row.itemName}-${row.itemSpec}`}>
                    <td>{row.counterName}</td>
                    <td>
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
