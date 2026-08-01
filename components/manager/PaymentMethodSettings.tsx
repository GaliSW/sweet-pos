"use client";

import { useEffect, useState } from "react";
import type { PaymentMethodOption } from "@/lib/domain/payment-methods";

export function PaymentMethodSettings() {
  const [methods, setMethods] = useState<PaymentMethodOption[]>([]);
  const [newName, setNewName] = useState("");
  const [status, setStatus] = useState("讀取付款方式中...");
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    void loadMethods();
  }, []);

  async function loadMethods() {
    const result = await fetch("/api/payment-methods").then((response) => response.json());
    if (!result.ok) {
      setStatus(result.error);
      return;
    }
    setMethods(result.data.paymentMethods ?? []);
    setStatus(result.data.source === "supabase" ? "付款方式已同步" : "Demo 模式");
  }

  async function addMethod() {
    if (!newName.trim()) {
      setStatus("請輸入付款方式名稱");
      return;
    }
    setSaving(true);
    const result = await fetch("/api/payment-methods", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ name: newName.trim() })
    }).then((response) => response.json());
    setSaving(false);
    if (!result.ok) {
      setStatus(result.error);
      return;
    }
    setNewName("");
    setStatus("付款方式已新增");
    await loadMethods();
  }

  async function saveMethod(method: PaymentMethodOption) {
    setSaving(true);
    const result = await updateMethod(method);
    setSaving(false);
    if (!result.ok) {
      setStatus(result.error);
      await loadMethods();
      return;
    }
    setStatus(`「${method.name}」已更新`);
    await loadMethods();
  }

  async function moveMethod(index: number, direction: -1 | 1) {
    const otherIndex = index + direction;
    if (otherIndex < 0 || otherIndex >= methods.length) return;

    const current = methods[index];
    const other = methods[otherIndex];
    setSaving(true);
    const [currentResult, otherResult] = await Promise.all([
      updateMethod({ ...current, sortOrder: other.sortOrder }),
      updateMethod({ ...other, sortOrder: current.sortOrder })
    ]);
    setSaving(false);

    if (!currentResult.ok || !otherResult.ok) {
      setStatus(currentResult.error ?? otherResult.error ?? "排序更新失敗");
    } else {
      setStatus("付款方式排序已更新");
    }
    await loadMethods();
  }

  function editLocal(code: string, partial: Partial<PaymentMethodOption>) {
    setMethods((current) =>
      current.map((method) => (method.code === code ? { ...method, ...partial } : method))
    );
  }

  return (
    <>
      <section className="section-title">
        <div>
          <h1>付款方式</h1>
          <p>調整 POS 可選的付款名稱、順序與啟用狀態；停用不會影響歷史訂單。</p>
        </div>
        <span className="pill">{status}</span>
      </section>

      <section className="content-grid">
        <article className="panel data-card">
          <h2>付款方式清單</h2>
          <div className="table-scroll">
            <table>
              <thead>
                <tr>
                  <th>順序</th>
                  <th>名稱</th>
                  <th>狀態</th>
                  <th />
                </tr>
              </thead>
              <tbody>
                {methods.map((method, index) => (
                  <tr key={method.code}>
                    <td>
                      <div className="toolbar">
                        <button
                          className="secondary-action"
                          disabled={saving || index === 0}
                          onClick={() => moveMethod(index, -1)}
                          type="button"
                        >
                          ↑
                        </button>
                        <button
                          className="secondary-action"
                          disabled={saving || index === methods.length - 1}
                          onClick={() => moveMethod(index, 1)}
                          type="button"
                        >
                          ↓
                        </button>
                      </div>
                    </td>
                    <td>
                      <input
                        value={method.name}
                        onChange={(event) => editLocal(method.code, { name: event.target.value })}
                      />
                    </td>
                    <td>
                      <select
                        value={method.isActive ? "active" : "inactive"}
                        onChange={(event) =>
                          editLocal(method.code, { isActive: event.target.value === "active" })
                        }
                      >
                        <option value="active">啟用</option>
                        <option value="inactive">停用</option>
                      </select>
                    </td>
                    <td>
                      <button
                        className="primary-action slim"
                        disabled={saving}
                        onClick={() => saveMethod(method)}
                        type="button"
                      >
                        儲存
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </article>

        <article className="panel data-card form-stack">
          <h2>新增付款方式</h2>
          <label className="field">
            <span>顯示名稱</span>
            <input
              placeholder="例如：禮券"
              value={newName}
              onChange={(event) => setNewName(event.target.value)}
            />
          </label>
          <div className="form-actions">
            <button
              className="primary-action slim"
              disabled={saving}
              onClick={addMethod}
              type="button"
            >
              新增付款方式
            </button>
          </div>
        </article>
      </section>
    </>
  );
}

async function updateMethod(method: PaymentMethodOption) {
  return fetch("/api/payment-methods", {
    method: "PATCH",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(method)
  }).then((response) => response.json());
}
