"use client";

import { useEffect, useState } from "react";
import type {
  InventoryMovementDirection,
  InventoryMovementTypeOption
} from "@/lib/backend/api-types";

const directionLabels: Record<InventoryMovementDirection, string> = {
  increase: "增加庫存",
  decrease: "扣除庫存",
  count: "盤點"
};

export function InventoryMovementTypeSettings() {
  const [types, setTypes] = useState<InventoryMovementTypeOption[]>([]);
  const [newName, setNewName] = useState("");
  const [newDirection, setNewDirection] = useState<"increase" | "decrease">("decrease");
  const [newNoteRequired, setNewNoteRequired] = useState(true);
  const [newNeedsReview, setNewNeedsReview] = useState(true);
  const [status, setStatus] = useState("讀取異動類型中...");
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    void loadTypes();
  }, []);

  async function loadTypes() {
    const result = await fetch("/api/inventory-movement-types").then((response) =>
      response.json()
    );
    if (!result.ok) {
      setStatus(result.error);
      return;
    }
    // 銷售只由 POS 結帳寫入,不在這裡列出。
    setTypes(
      ((result.data.movementTypes ?? []) as InventoryMovementTypeOption[]).filter(
        (type) => type.code !== "sale"
      )
    );
    setStatus(result.data.source === "supabase" ? "異動類型已同步" : "Demo 模式");
  }

  async function addType() {
    if (!newName.trim()) {
      setStatus("請輸入類型名稱");
      return;
    }
    setSaving(true);
    const result = await fetch("/api/inventory-movement-types", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        name: newName.trim(),
        direction: newDirection,
        noteRequired: newNoteRequired,
        needsReview: newNeedsReview
      })
    }).then((response) => response.json());
    setSaving(false);
    if (!result.ok) {
      setStatus(result.error);
      return;
    }
    setNewName("");
    setStatus("異動類型已新增");
    await loadTypes();
  }

  async function saveType(type: InventoryMovementTypeOption) {
    setSaving(true);
    const result = await updateType(type);
    setSaving(false);
    if (!result.ok) {
      setStatus(result.error);
      await loadTypes();
      return;
    }
    setStatus(`「${type.name}」已更新`);
    await loadTypes();
  }

  async function moveType(index: number, direction: -1 | 1) {
    const otherIndex = index + direction;
    if (otherIndex < 0 || otherIndex >= types.length) return;

    const current = types[index];
    const other = types[otherIndex];
    setSaving(true);
    const [currentResult, otherResult] = await Promise.all([
      updateType({ ...current, sortOrder: other.sortOrder }),
      updateType({ ...other, sortOrder: current.sortOrder })
    ]);
    setSaving(false);

    if (!currentResult.ok || !otherResult.ok) {
      setStatus(currentResult.error ?? otherResult.error ?? "排序更新失敗");
    } else {
      setStatus("異動類型排序已更新");
    }
    await loadTypes();
  }

  function editLocal(code: string, partial: Partial<InventoryMovementTypeOption>) {
    setTypes((current) =>
      current.map((type) => (type.code === code ? { ...type, ...partial } : type))
    );
  }

  return (
    <>
      <section className="section-title">
        <div>
          <h1>庫存異動類型</h1>
          <p>
            設定店員登記庫存時可選的類型。系統內建類型只能調整順序；停用不會影響歷史紀錄。
          </p>
        </div>
        <span className="pill">{status}</span>
      </section>

      <section className="content-grid">
        <article className="panel data-card type-settings">
          <h2>類型清單</h2>
          <div className="table-scroll">
            <table>
              <thead>
                <tr>
                  <th>順序</th>
                  <th>名稱</th>
                  <th>庫存方向</th>
                  <th className="check-cell">必填備註</th>
                  <th className="check-cell">店長覆核</th>
                  <th>狀態</th>
                  <th />
                </tr>
              </thead>
              <tbody>
                {types.map((type, index) => (
                  <tr key={type.code}>
                    <td>
                      <div className="order-buttons">
                        <button
                          aria-label="上移"
                          className="secondary-action"
                          disabled={saving || index === 0}
                          onClick={() => moveType(index, -1)}
                          type="button"
                        >
                          ↑
                        </button>
                        <button
                          aria-label="下移"
                          className="secondary-action"
                          disabled={saving || index === types.length - 1}
                          onClick={() => moveType(index, 1)}
                          type="button"
                        >
                          ↓
                        </button>
                      </div>
                    </td>
                    <td>
                      {type.isSystem ? (
                        <>
                          {type.name} <span className="pill">系統</span>
                        </>
                      ) : (
                        <input
                          aria-label="類型名稱"
                          type="text"
                          value={type.name}
                          onChange={(event) => editLocal(type.code, { name: event.target.value })}
                        />
                      )}
                    </td>
                    <td>
                      <span className={`direction-tag ${type.direction}`}>
                        {directionLabels[type.direction]}
                      </span>
                    </td>
                    <td className="check-cell">
                      <input
                        aria-label="必填備註"
                        checked={type.noteRequired}
                        disabled={type.isSystem}
                        onChange={(event) =>
                          editLocal(type.code, { noteRequired: event.target.checked })
                        }
                        type="checkbox"
                      />
                    </td>
                    <td className="check-cell">
                      <input
                        aria-label="店長覆核"
                        checked={type.needsReview}
                        disabled={type.isSystem}
                        onChange={(event) =>
                          editLocal(type.code, { needsReview: event.target.checked })
                        }
                        type="checkbox"
                      />
                    </td>
                    <td>
                      <select
                        aria-label="狀態"
                        disabled={type.isSystem}
                        value={type.isActive ? "active" : "inactive"}
                        onChange={(event) =>
                          editLocal(type.code, { isActive: event.target.value === "active" })
                        }
                      >
                        <option value="active">啟用</option>
                        <option value="inactive">停用</option>
                      </select>
                    </td>
                    <td>
                      {type.isSystem ? null : (
                        <button
                          className="primary-action slim"
                          disabled={saving}
                          onClick={() => saveType(type)}
                          type="button"
                        >
                          儲存
                        </button>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </article>

        <article className="panel data-card form-stack type-settings">
          <h2>新增異動類型</h2>
          <label className="field">
            <span>顯示名稱</span>
            <input
              placeholder="例如：公關試吃"
              value={newName}
              onChange={(event) => setNewName(event.target.value)}
            />
          </label>
          <label className="field">
            <span>庫存方向（建立後不可更改）</span>
            <select
              value={newDirection}
              onChange={(event) => setNewDirection(event.target.value as "increase" | "decrease")}
            >
              <option value="decrease">扣除庫存</option>
              <option value="increase">增加庫存</option>
            </select>
          </label>
          <div className="check-options">
            <label className="check-chip">
              <input
                checked={newNoteRequired}
                onChange={(event) => setNewNoteRequired(event.target.checked)}
                type="checkbox"
              />
              必填原因 / 備註
            </label>
            <label className="check-chip">
              <input
                checked={newNeedsReview}
                onChange={(event) => setNewNeedsReview(event.target.checked)}
                type="checkbox"
              />
              列入店長覆核
            </label>
          </div>
          <div className="form-actions">
            <button
              className="primary-action slim"
              disabled={saving}
              onClick={addType}
              type="button"
            >
              新增異動類型
            </button>
          </div>
        </article>
      </section>
    </>
  );
}

async function updateType(type: InventoryMovementTypeOption) {
  return fetch("/api/inventory-movement-types", {
    method: "PATCH",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(type)
  }).then((response) => response.json());
}
