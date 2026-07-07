"use client";

import { useEffect, useState } from "react";
import type { UpsertCounterInput } from "@/lib/backend/api-types";

type CounterRow = {
  id: string;
  name: string;
  location: string | null;
  isActive: boolean;
  targetAmount: number;
  achievedAmount: number;
  achievementRate: number;
};

const emptyCounter: UpsertCounterInput = {
  name: "",
  location: "",
  isActive: true,
  monthlyTarget: null
};

export function CounterSettings() {
  const [month, setMonth] = useState(() => new Date().toISOString().slice(0, 7));
  const [counters, setCounters] = useState<CounterRow[]>([]);
  const [form, setForm] = useState<UpsertCounterInput>(emptyCounter);
  const [targetAmount, setTargetAmount] = useState("");
  const [status, setStatus] = useState("讀取櫃位資料中...");
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    void loadCounters();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [month]);

  async function loadCounters() {
    setStatus("讀取櫃位資料中...");
    const response = await fetch(`/api/counters?month=${month}`);
    const result = await response.json();

    if (!result.ok) {
      setStatus(result.error);
      return;
    }

    setCounters(result.data.counters);
    setStatus(result.data.source === "supabase" ? "已連線本地資料庫" : "Demo 模式");
  }

  function editCounter(counter: CounterRow) {
    setForm({
      id: counter.id,
      name: counter.name,
      location: counter.location ?? "",
      isActive: counter.isActive,
      monthlyTarget: null
    });
    setTargetAmount(counter.targetAmount > 0 ? String(counter.targetAmount) : "");
  }

  async function saveCounter() {
    setSaving(true);
    setStatus("儲存櫃位中...");

    const payload: UpsertCounterInput = {
      ...form,
      monthlyTarget:
        targetAmount !== ""
          ? {
              month,
              targetAmount: Number(targetAmount)
            }
          : null
    };

    const response = await fetch("/api/counters", {
      method: form.id ? "PATCH" : "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(payload)
    });
    const result = await response.json();

    setSaving(false);

    if (!result.ok) {
      setStatus(result.error);
      return;
    }

    setStatus(form.id ? "櫃位已更新" : "櫃位已新增");
    setForm(emptyCounter);
    setTargetAmount("");
    await loadCounters();
  }

  async function deleteCounter(counter: CounterRow) {
    if (!window.confirm(`確定刪除「${counter.name}」？已有紀錄的櫃位會改為停用。`)) return;

    setSaving(true);
    setStatus("刪除櫃位中...");

    const response = await fetch("/api/counters", {
      method: "DELETE",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ id: counter.id })
    });
    const result = await response.json();

    setSaving(false);

    if (!result.ok) {
      setStatus(result.error);
      return;
    }

    setStatus(
      result.data.mode === "deactivated" ? result.data.message : `「${counter.name}」已刪除`
    );
    if (form.id === counter.id) {
      setForm(emptyCounter);
      setTargetAmount("");
    }
    await loadCounters();
  }

  return (
    <>
      <section className="section-title">
        <div>
          <h1>櫃位設定</h1>
          <p>管理櫃位狀態與每月業績目標。</p>
        </div>
        <div className="toolbar">
          <label className="field compact">
            <span>月份</span>
            <input type="month" value={month} onChange={(event) => setMonth(event.target.value)} />
          </label>
          <span className="pill">{status}</span>
        </div>
      </section>

      <section className="content-grid">
        <article className="panel data-card">
          <table>
            <thead>
              <tr>
                <th>櫃位</th>
                <th>位置</th>
                <th>月目標</th>
                <th>實收</th>
                <th>達成率</th>
                <th>狀態</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {counters.map((counter) => (
                <tr key={counter.id}>
                  <td>{counter.name}</td>
                  <td>{counter.location ?? "—"}</td>
                  <td>{counter.targetAmount > 0 ? formatCurrency(counter.targetAmount) : "未設定"}</td>
                  <td>{formatCurrency(counter.achievedAmount)}</td>
                  <td>{Math.round(counter.achievementRate * 100)}%</td>
                  <td>{counter.isActive ? "啟用" : "停用"}</td>
                  <td>
                    <div className="toolbar">
                      <button
                        className="secondary-action"
                        onClick={() => editCounter(counter)}
                        type="button"
                      >
                        編輯
                      </button>
                      <button
                        className="secondary-action"
                        disabled={saving}
                        onClick={() => deleteCounter(counter)}
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
          <h2>{form.id ? "編輯櫃位" : "新增櫃位"}</h2>
          <label className="field">
            <span>櫃位名稱</span>
            <input
              value={form.name}
              onChange={(event) => setForm({ ...form, name: event.target.value })}
            />
          </label>
          <label className="field">
            <span>位置</span>
            <input
              value={form.location ?? ""}
              onChange={(event) => setForm({ ...form, location: event.target.value })}
            />
          </label>
          <div className="field-row">
            <label className="field">
              <span>{month} 目標(可空)</span>
              <input
                type="number"
                min={0}
                value={targetAmount}
                onChange={(event) => setTargetAmount(event.target.value)}
              />
            </label>
            <label className="field">
              <span>狀態</span>
              <select
                value={form.isActive ? "active" : "inactive"}
                onChange={(event) => setForm({ ...form, isActive: event.target.value === "active" })}
              >
                <option value="active">啟用</option>
                <option value="inactive">停用</option>
              </select>
            </label>
          </div>
          <div className="form-actions">
            {form.id ? (
              <button
                className="secondary-action"
                onClick={() => {
                  setForm(emptyCounter);
                  setTargetAmount("");
                }}
                type="button"
              >
                取消編輯
              </button>
            ) : null}
            <button className="primary-action slim" disabled={saving} onClick={saveCounter} type="button">
              {form.id ? "更新櫃位" : "新增櫃位"}
            </button>
          </div>
        </article>
      </section>
    </>
  );
}

function formatCurrency(value: number) {
  return `$${Math.round(value).toLocaleString("en-US")}`;
}
