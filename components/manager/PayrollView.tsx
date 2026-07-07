"use client";

import { useEffect, useState } from "react";
import type { MonthlyPerformanceRow, PayrollRow } from "@/lib/backend/api-types";
import type { CommissionTier } from "@/lib/domain/pos-rules";

type ShiftRow = {
  id: string;
  counterName: string;
  staffName: string;
  shiftDate: string;
  shiftLabel: string;
  startsAt: string;
  endsAt: string;
  published: boolean;
};

export function PayrollView() {
  const [month, setMonth] = useState(() => new Date().toISOString().slice(0, 7));
  const [payroll, setPayroll] = useState<PayrollRow[]>([]);
  const [monthly, setMonthly] = useState<MonthlyPerformanceRow[]>([]);
  const [shifts, setShifts] = useState<ShiftRow[]>([]);
  const [tiers, setTiers] = useState<CommissionTier[]>([]);
  const [savingTiers, setSavingTiers] = useState(false);
  const [status, setStatus] = useState("讀取薪資資料中...");

  useEffect(() => {
    void loadTiers();
  }, []);

  useEffect(() => {
    void loadData();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [month]);

  async function loadTiers() {
    const result = await fetch("/api/commission")
      .then((response) => response.json())
      .catch(() => null);

    if (result?.ok) setTiers(result.data.tiers ?? []);
  }

  function updateTier(index: number, partial: Partial<CommissionTier>) {
    setTiers((current) =>
      current.map((tier, tierIndex) => (tierIndex === index ? { ...tier, ...partial } : tier))
    );
  }

  async function saveTiers() {
    setSavingTiers(true);
    setStatus("儲存抽成級距中...");

    const response = await fetch("/api/commission", {
      method: "PUT",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ tiers })
    });
    const result = await response.json();

    setSavingTiers(false);

    if (!result.ok) {
      setStatus(result.error);
      return;
    }

    setTiers(result.data.tiers ?? tiers);
    setStatus("抽成級距已更新，報表與薪資即時生效");
    await loadData();
  }

  async function loadData() {
    setStatus("讀取薪資資料中...");

    const [startDate, endDate] = monthDateRange(month);
    const [payrollResult, reportsResult, shiftsResult] = await Promise.all([
      fetch(`/api/payroll?month=${month}`).then((response) => response.json()),
      fetch(`/api/reports?from=${startDate}&to=${endDate}`).then((response) => response.json()),
      fetch(`/api/shifts?month=${month}`).then((response) => response.json())
    ]);

    if (!payrollResult.ok) {
      setStatus(payrollResult.error);
      return;
    }

    setPayroll(payrollResult.data.payroll ?? []);
    setMonthly(reportsResult.ok ? reportsResult.data.monthly ?? [] : []);
    setShifts(shiftsResult.ok ? shiftsResult.data.shifts ?? [] : []);
    setStatus(payrollResult.data.source === "supabase" ? "已連線本地資料庫" : "Demo 模式");
  }

  const totalPay = payroll.reduce((total, row) => total + row.estimatedTotal, 0);

  return (
    <>
      <section className="section-title">
        <div>
          <h1>薪資試算</h1>
          <p>依排班時數與時薪計算底薪，依每日個人業績計算抽成。</p>
        </div>
        <div className="toolbar">
          <label className="field compact">
            <span>月份</span>
            <input type="month" value={month} onChange={(event) => setMonth(event.target.value)} />
          </label>
          <span className="pill">{status}</span>
        </div>
      </section>

      <section className="panel data-card">
        <h2>{month} 薪資試算（合計 {formatCurrency(totalPay)}）</h2>
        <table>
          <thead>
            <tr>
              <th>員工</th>
              <th>班數</th>
              <th>時數</th>
              <th>時薪</th>
              <th>底薪</th>
              <th>抽成</th>
              <th>預估合計</th>
            </tr>
          </thead>
          <tbody>
            {payroll.map((row) => (
              <tr key={row.staffId}>
                <td>{row.staffName}</td>
                <td>{row.shiftCount}</td>
                <td>{row.scheduledHours}h</td>
                <td>${row.hourlyWage}</td>
                <td>{formatCurrency(row.basePay)}</td>
                <td>{formatCurrency(row.commission)}</td>
                <td>{formatCurrency(row.estimatedTotal)}</td>
              </tr>
            ))}
            {payroll.length === 0 ? (
              <tr>
                <td colSpan={7}>本月沒有排班或業績資料</td>
              </tr>
            ) : null}
          </tbody>
        </table>
      </section>

      <section className="panel data-card form-stack">
        <h2>抽成級距設定</h2>
        <p className="form-status">
          當日個人業績達到門檻時，整筆業績依該級距比例抽成（取符合的最高門檻）。例如 2% 填 0.02。
        </p>
        {tiers.map((tier, index) => (
          <div className="field-row" key={index}>
            <label className="field">
              <span>日業績門檻</span>
              <input
                type="number"
                min={0}
                value={tier.minDailySales}
                onChange={(event) =>
                  updateTier(index, { minDailySales: Number(event.target.value) })
                }
              />
            </label>
            <label className="field">
              <span>抽成比例（0-1）</span>
              <input
                type="number"
                min={0}
                max={1}
                step={0.005}
                value={tier.rate}
                onChange={(event) => updateTier(index, { rate: Number(event.target.value) })}
              />
            </label>
            <label className="field">
              <span>&nbsp;</span>
              <button
                className="secondary-action"
                onClick={() =>
                  setTiers((current) => current.filter((_, tierIndex) => tierIndex !== index))
                }
                type="button"
              >
                移除
              </button>
            </label>
          </div>
        ))}
        <div className="form-actions">
          <button
            className="secondary-action"
            onClick={() =>
              setTiers((current) => [...current, { minDailySales: 0, rate: 0.01 }])
            }
            type="button"
          >
            新增級距
          </button>
          <button
            className="primary-action slim"
            disabled={savingTiers}
            onClick={saveTiers}
            type="button"
          >
            儲存級距
          </button>
        </div>
      </section>

      <section className="content-grid">
        <article className="panel data-card">
          <h2>業績紀錄（{month}）</h2>
          <table>
            <thead>
              <tr>
                <th>員工</th>
                <th>訂單數</th>
                <th>實收</th>
                <th>抽成</th>
              </tr>
            </thead>
            <tbody>
              {monthly.map((row) => (
                <tr key={`${row.month}-${row.sellerId}`}>
                  <td>{row.sellerName}</td>
                  <td>{row.orderCount}</td>
                  <td>{formatCurrency(row.receivedAmount)}</td>
                  <td>{formatCurrency(row.commission)}</td>
                </tr>
              ))}
              {monthly.length === 0 ? (
                <tr>
                  <td colSpan={4}>本月沒有訂單</td>
                </tr>
              ) : null}
            </tbody>
          </table>
        </article>

        <article className="panel data-card">
          <h2>上班紀錄（{month}）</h2>
          <table>
            <thead>
              <tr>
                <th>日期</th>
                <th>員工</th>
                <th>櫃位</th>
                <th>班別</th>
                <th>時段</th>
                <th>狀態</th>
              </tr>
            </thead>
            <tbody>
              {shifts.map((shift) => (
                <tr key={shift.id}>
                  <td>{shift.shiftDate}</td>
                  <td>{shift.staffName}</td>
                  <td>{shift.counterName}</td>
                  <td>{shift.shiftLabel}</td>
                  <td>
                    {shift.startsAt}-{shift.endsAt}
                  </td>
                  <td>
                    <span className={shift.published ? "status" : "status warn"}>
                      {shift.published ? "已發布" : "草稿"}
                    </span>
                  </td>
                </tr>
              ))}
              {shifts.length === 0 ? (
                <tr>
                  <td colSpan={6}>本月沒有排班</td>
                </tr>
              ) : null}
            </tbody>
          </table>
        </article>
      </section>
    </>
  );
}

function monthDateRange(month: string) {
  const [year, monthIndex] = month.split("-").map(Number);
  const lastDay = new Date(Date.UTC(year, monthIndex, 0)).getUTCDate();

  return [`${month}-01`, `${month}-${String(lastDay).padStart(2, "0")}`] as const;
}

function formatCurrency(value: number) {
  return `$${Math.round(value).toLocaleString("en-US")}`;
}
