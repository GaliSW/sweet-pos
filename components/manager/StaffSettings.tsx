"use client";

import { useEffect, useState } from "react";
import type { UpsertStaffInput } from "@/lib/backend/api-types";

type StaffRow = {
  id: string;
  email: string;
  displayName: string;
  role: "staff" | "manager";
  hourlyWage: number;
  isActive: boolean;
};

const emptyStaff: UpsertStaffInput = {
  email: "",
  password: "",
  displayName: "",
  role: "staff",
  hourlyWage: 190,
  isActive: true
};

export function StaffSettings() {
  const [staff, setStaff] = useState<StaffRow[]>([]);
  const [form, setForm] = useState<UpsertStaffInput>(emptyStaff);
  const [status, setStatus] = useState("讀取員工資料中...");
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    void loadStaff();
  }, []);

  async function loadStaff() {
    const response = await fetch("/api/staff");
    const result = await response.json();

    if (!result.ok) {
      setStatus(result.error);
      return;
    }

    setStaff(result.data.staff);
    setStatus(result.data.source === "supabase" ? "已連線本地資料庫" : "Demo 模式");
  }

  function editStaff(row: StaffRow) {
    setForm({
      id: row.id,
      email: row.email,
      password: "",
      displayName: row.displayName,
      role: row.role,
      hourlyWage: row.hourlyWage,
      isActive: row.isActive
    });
  }

  async function saveStaff() {
    setSaving(true);
    setStatus(form.id ? "更新員工中..." : "建立員工帳號中...");

    const payload: UpsertStaffInput = {
      ...form,
      password: form.password || undefined
    };

    const response = await fetch("/api/staff", {
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

    setStatus(form.id ? "員工資料已更新" : "員工帳號已建立");
    setForm(emptyStaff);
    await loadStaff();
  }

  async function deleteStaff(row: StaffRow) {
    if (!window.confirm(`確定要刪除 ${row.displayName} 的帳號？`)) return;

    setSaving(true);
    setStatus("刪除員工中...");

    const response = await fetch("/api/staff", {
      method: "DELETE",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ id: row.id })
    });
    const result = await response.json();

    setSaving(false);

    if (!result.ok) {
      setStatus(result.error);
      return;
    }

    setStatus(
      result.data.mode === "deactivated"
        ? result.data.message
        : `${row.displayName} 的帳號已刪除`
    );
    await loadStaff();
  }

  return (
    <>
      <section className="section-title">
        <div>
          <h1>員工管理</h1>
          <p>新增員工帳號、設定角色與時薪，刪除或停用離職員工。</p>
        </div>
        <span className="pill">{status}</span>
      </section>

      <section className="content-grid">
        <article className="panel data-card">
          <h2>員工清單</h2>
          <table>
            <thead>
              <tr>
                <th>姓名</th>
                <th>Email</th>
                <th>角色</th>
                <th>時薪</th>
                <th>狀態</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {staff.map((row) => (
                <tr key={row.id}>
                  <td>{row.displayName}</td>
                  <td>{row.email || "—"}</td>
                  <td>{row.role === "manager" ? "店長" : "員工"}</td>
                  <td>${row.hourlyWage}</td>
                  <td>{row.isActive ? "啟用" : "停用"}</td>
                  <td>
                    <div className="toolbar">
                      <button className="secondary-action" onClick={() => editStaff(row)} type="button">
                        編輯
                      </button>
                      <button
                        className="secondary-action"
                        disabled={saving}
                        onClick={() => deleteStaff(row)}
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
          <h2>{form.id ? "編輯員工" : "新增員工"}</h2>
          <label className="field">
            <span>姓名</span>
            <input
              value={form.displayName}
              onChange={(event) => setForm({ ...form, displayName: event.target.value })}
            />
          </label>
          <label className="field">
            <span>Email{form.id ? "（不可修改）" : ""}</span>
            <input
              disabled={Boolean(form.id)}
              type="email"
              value={form.email ?? ""}
              onChange={(event) => setForm({ ...form, email: event.target.value })}
            />
          </label>
          <label className="field">
            <span>{form.id ? "重設密碼（留空表示不變更）" : "密碼（至少 8 個字元）"}</span>
            <input
              autoComplete="new-password"
              type="password"
              value={form.password ?? ""}
              onChange={(event) => setForm({ ...form, password: event.target.value })}
            />
          </label>
          <div className="field-row">
            <label className="field">
              <span>角色</span>
              <select
                value={form.role}
                onChange={(event) =>
                  setForm({ ...form, role: event.target.value as "staff" | "manager" })
                }
              >
                <option value="staff">員工</option>
                <option value="manager">店長</option>
              </select>
            </label>
            <label className="field">
              <span>時薪</span>
              <input
                type="number"
                min={0}
                value={form.hourlyWage || ""}
                onChange={(event) => setForm({ ...form, hourlyWage: Number(event.target.value) })}
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
              <button className="secondary-action" onClick={() => setForm(emptyStaff)} type="button">
                取消編輯
              </button>
            ) : null}
            <button className="primary-action slim" disabled={saving} onClick={saveStaff} type="button">
              {form.id ? "更新員工" : "新增員工"}
            </button>
          </div>
        </article>
      </section>
    </>
  );
}
