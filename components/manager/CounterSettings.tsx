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

  async function toggleActive(counter: CounterRow) {
    setSaving(true);
    setStatus(counter.isActive ? "停用櫃位中..." : "啟用櫃位中...");

    const response = await fetch("/api/counters", {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        id: counter.id,
        name: counter.name,
        location: counter.location,
        isActive: !counter.isActive,
        monthlyTarget: null
      })
    });
    const result = await response.json();

    setSaving(false);

    if (!result.ok) {
      setStatus(result.error);
      return;
    }

    setStatus(counter.isActive ? `「${counter.name}」已停用` : `「${counter.name}」已啟用`);
    await loadCounters();
  }

  // 刪除前備份:匯出該櫃位全部訂單 / 品項 / 班表 / 庫存紀錄成 Excel
  async function exportRecords(counter: CounterRow) {
    setStatus("匯出紀錄中...");
    const response = await fetch(`/api/counters/records?counterId=${counter.id}`);
    const result = await response.json();

    if (!result.ok) {
      setStatus(result.error);
      return;
    }

    const XLSX = await import("xlsx");
    const workbook = XLSX.utils.book_new();
    const addSheet = (name: string, rows: Array<Record<string, unknown>>) => {
      const data = rows.length > 0 ? rows : [{ 備註: "沒有資料" }];
      XLSX.utils.book_append_sheet(workbook, XLSX.utils.json_to_sheet(data), name);
    };

    type ExportOrder = {
      orderNo: string;
      createdAt: string;
      sellerName: string;
      seller2Name: string;
      paymentMethod: string;
      salesAmount: number;
      bundleDiscountAmount: number;
      discountAmount: number;
      receivedAmount: number;
      status: string;
      voidReason: string | null;
    };
    type ExportOrderItem = {
      orderNo: string;
      productName: string;
      spec: string;
      unitPrice: number;
      quantity: number;
      lineTotal: number;
    };
    type ExportShift = {
      shiftDate: string;
      shiftCode: string;
      staffName: string;
      startsAt: string;
      endsAt: string;
      published: boolean;
    };
    type ExportMovement = {
      createdAt: string;
      movementType: string;
      itemName: string;
      quantity: number;
      countedQuantity: number | null;
      note: string | null;
      createdByName: string;
    };

    addSheet(
      "訂單",
      (result.data.orders as ExportOrder[]).map((order) => ({
        單號: order.orderNo,
        時間: order.createdAt,
        銷售: order.sellerName + (order.seller2Name ? `、${order.seller2Name}` : ""),
        付款: order.paymentMethod,
        銷售金額: order.salesAmount,
        組合折抵: order.bundleDiscountAmount,
        折扣金額: order.discountAmount,
        實收金額: order.receivedAmount,
        狀態: order.status,
        作廢原因: order.voidReason ?? ""
      }))
    );
    addSheet(
      "訂單品項",
      (result.data.orderItems as ExportOrderItem[]).map((item) => ({
        單號: item.orderNo,
        品項: item.productName,
        規格: item.spec,
        單價: item.unitPrice,
        數量: item.quantity,
        小計: item.lineTotal
      }))
    );
    addSheet(
      "班表",
      (result.data.shifts as ExportShift[]).map((shift) => ({
        日期: shift.shiftDate,
        班別: shift.shiftCode,
        員工: shift.staffName,
        開始: shift.startsAt,
        結束: shift.endsAt,
        已發布: shift.published ? "是" : "否"
      }))
    );
    addSheet(
      "庫存異動",
      (result.data.movements as ExportMovement[]).map((movement) => ({
        時間: movement.createdAt,
        類型: movement.movementType,
        品項: movement.itemName,
        數量: movement.quantity,
        盤點數: movement.countedQuantity ?? "",
        備註: movement.note ?? "",
        建立者: movement.createdByName
      }))
    );

    XLSX.writeFile(workbook, `櫃位紀錄_${counter.name}.xlsx`);
    setStatus(`已匯出「${counter.name}」全部紀錄`);
  }

  async function deleteCounter(counter: CounterRow) {
    const confirmed = window.confirm(
      `永久刪除「${counter.name}」會連同該櫃位的「訂單、班表、庫存紀錄」一併刪除,無法復原,報表與薪資的歷史數字也會消失。\n\n建議先按「匯出」下載紀錄備份。\n\n確定要繼續嗎？`
    );

    if (!confirmed) return;

    const typedName = window.prompt(`請輸入櫃位名稱「${counter.name}」以確認永久刪除:`);

    if (typedName !== counter.name) {
      if (typedName != null) setStatus("名稱不符，已取消刪除");
      return;
    }

    setSaving(true);
    setStatus("刪除櫃位中...");

    const response = await fetch("/api/counters", {
      method: "DELETE",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ id: counter.id, force: true })
    });
    const result = await response.json();

    setSaving(false);

    if (!result.ok) {
      setStatus(result.error);
      return;
    }

    setStatus(`「${counter.name}」與其全部紀錄已永久刪除`);
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
          <div className="table-scroll">
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
                          onClick={() => toggleActive(counter)}
                          type="button"
                        >
                          {counter.isActive ? "停用" : "啟用"}
                        </button>
                        <button
                          className="secondary-action"
                          disabled={saving}
                          onClick={() => exportRecords(counter)}
                          type="button"
                        >
                          匯出
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
          </div>
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
