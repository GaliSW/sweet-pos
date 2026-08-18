"use client";

import { useEffect, useState } from "react";
import { taipeiDate } from "@/lib/backend/query-helpers";

type StaffShift = {
  id: string;
  shiftDate: string;
  shiftLabel: string;
  startsAt: string;
  endsAt: string;
  counterName: string;
  published: boolean;
};

const defaultStaffId = "00000000-0000-4000-8000-000000000001";

type PerformanceRow = {
  sellerId: string;
  date?: string;
  orderCount: number;
  receivedAmount: number;
  commission: number;
  commissionMode?: "daily" | "monthly";
};

type Performance = {
  todayOrders: number;
  todayAmount: number;
  todayCommission: number;
  monthOrders: number;
  monthAmount: number;
  monthCommission: number;
  commissionMode: "daily" | "monthly";
};

export function StaffScheduleTable() {
  const [shifts, setShifts] = useState<StaffShift[]>([]);
  const [performance, setPerformance] = useState<Performance | null>(null);
  const [status, setStatus] = useState("讀取班表中...");

  useEffect(() => {
    void load();
  }, []);

  async function load() {
    const meResult = await fetch("/api/me")
      .then((response) => response.json())
      .catch(() => null);
    const staffId = meResult?.ok ? meResult.data.id : defaultStaffId;

    await Promise.all([loadShifts(staffId), loadPerformance(staffId)]);
  }

  // 業績一律只算登入者本人:店長也會排班,這頁對他同樣是「我的」。
  // 後端 rows 已是每人一列、共班訂單各分一半,過濾後直接加總即為本人數字。
  async function loadPerformance(staffId: string) {
    const today = taipeiDate(new Date().toISOString());
    const result = await fetch(`/api/reports?from=${today.slice(0, 7)}-01&to=${today}`)
      .then((response) => response.json())
      .catch(() => null);

    if (!result?.ok) return;

    const mine = (rows: PerformanceRow[]) => rows.filter((row) => row.sellerId === staffId);
    const monthRows = mine(result.data.monthly ?? []);
    const todayRows = mine(result.data.daily ?? []).filter((row) => row.date === today);
    const sum = (
      rows: PerformanceRow[],
      field: "orderCount" | "receivedAmount" | "commission"
    ) => rows.reduce((total, row) => total + row[field], 0);

    setPerformance({
      todayOrders: sum(todayRows, "orderCount"),
      todayAmount: sum(todayRows, "receivedAmount"),
      todayCommission: sum(todayRows, "commission"),
      monthOrders: sum(monthRows, "orderCount"),
      monthAmount: sum(monthRows, "receivedAmount"),
      monthCommission: sum(monthRows, "commission"),
      commissionMode: monthRows[0]?.commissionMode ?? "daily"
    });
  }

  async function loadShifts(staffId: string) {
    const month = taipeiDate(new Date().toISOString()).slice(0, 7);
    const response = await fetch(`/api/shifts?staffId=${staffId}&month=${month}`);
    const result = await response.json();

    if (!result.ok) {
      setStatus(result.error);
      return;
    }

    const publishedShifts = (result.data.shifts ?? []).filter((shift: StaffShift) => shift.published);
    setShifts(publishedShifts);
    setStatus(publishedShifts.length > 0 ? "已載入本月已發布班表" : "目前沒有已發布班次");
  }

  return (
    <>
      <section className="kpi-grid">
        <article className="panel kpi">
          <span>今日業績</span>
          <strong>{formatCurrency(performance?.todayAmount ?? 0)}</strong>
          <small>{performance?.todayOrders ?? 0} 筆訂單</small>
        </article>
        {/* 月結員工每日抽成固定為 0,整張卡不顯示 */}
        {performance?.commissionMode === "monthly" ? null : (
          <article className="panel kpi">
            <span>今日抽成</span>
            <strong>{formatCurrency(performance?.todayCommission ?? 0)}</strong>
            <small>依當日個人業績級距</small>
          </article>
        )}
        <article className="panel kpi">
          <span>本月業績</span>
          <strong>{formatCurrency(performance?.monthAmount ?? 0)}</strong>
          <small>{performance?.monthOrders ?? 0} 筆訂單</small>
        </article>
        <article className="panel kpi">
          <span>本月抽成</span>
          <strong>{formatCurrency(performance?.monthCommission ?? 0)}</strong>
          <small>
            {performance?.commissionMode === "monthly" ? "依本月總業績級距" : "逐日累計"}
          </small>
        </article>
      </section>

      <section className="data-card panel">
      <div className="table-heading">
        <h2>本月班表</h2>
        <span className="pill">{status}</span>
      </div>
      <div className="table-scroll">
        <table>
          <thead>
            <tr>
              <th>日期</th>
              <th>班別</th>
              <th>時段</th>
              <th>櫃位</th>
              <th>提醒</th>
            </tr>
          </thead>
          <tbody>
            {shifts.map((shift) => (
              <tr key={shift.id}>
                <td>{shift.shiftDate}</td>
                <td>{shift.shiftLabel}</td>
                <td>
                  {shift.startsAt}-{shift.endsAt}
                </td>
                <td>{shift.counterName}</td>
                <td>
                  <span className="status">開班盤點</span>{" "}
                  <span className="status warn">下班盤點</span>
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

function formatCurrency(value: number) {
  return `$${Math.round(value).toLocaleString("en-US")}`;
}
