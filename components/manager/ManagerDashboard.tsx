"use client";

import { useEffect, useState } from "react";
import type {
  CounterTargetRow,
  DailyPerformanceRow,
  ReportSummary
} from "@/lib/backend/api-types";

type ReportData = {
  daily: DailyPerformanceRow[];
  summary: ReportSummary;
  targets: CounterTargetRow[];
  source: "demo" | "supabase";
};

export function ManagerDashboard() {
  const [report, setReport] = useState<ReportData | null>(null);
  const [status, setStatus] = useState("讀取營運資料中...");
  const today = new Date().toISOString().slice(0, 10);

  useEffect(() => {
    void loadReport();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function loadReport() {
    const from = `${today.slice(0, 7)}-01`;
    const response = await fetch(`/api/reports?from=${from}&to=${today}`);
    const result = await response.json();

    if (!result.ok) {
      setStatus(result.error);
      return;
    }

    setReport(result.data);
    setStatus(result.data.source === "supabase" ? "已連線本地資料庫" : "Demo 模式");
  }

  const todayRows = (report?.daily ?? []).filter((row) => row.date === today);
  const todayReceived = todayRows.reduce((total, row) => total + row.receivedAmount, 0);
  const todayOrders = todayRows.reduce((total, row) => total + row.orderCount, 0);
  const averageOrderValue = todayOrders > 0 ? Math.round(todayReceived / todayOrders) : 0;
  const totalTarget = (report?.targets ?? []).reduce((total, row) => total + row.targetAmount, 0);
  const totalAchieved = (report?.targets ?? []).reduce(
    (total, row) => total + row.achievedAmount,
    0
  );
  const achievementRate = totalTarget > 0 ? totalAchieved / totalTarget : 0;

  const kpis = [
    { label: "今日總業績", value: formatCurrency(todayReceived), trend: `${todayOrders} 筆訂單` },
    {
      label: "平均客單價",
      value: formatCurrency(averageOrderValue),
      trend: todayOrders > 0 ? "今日訂單平均" : "今日尚無訂單"
    },
    {
      label: "本月累計實收",
      value: formatCurrency(report?.summary.receivedAmount ?? 0),
      trend: `${report?.summary.orderCount ?? 0} 筆訂單`
    },
    {
      label: "目標達成率",
      value: formatPercent(achievementRate),
      trend: `本月目標 ${formatCurrency(totalTarget)}`
    }
  ];

  return (
    <>
      <section className="section-title">
        <div>
          <h1>營運總覽</h1>
          <p>今日銷售、金流、目標達成與員工表現。</p>
        </div>
        <span className="pill">{status}</span>
      </section>

      <section className="kpi-grid">
        {kpis.map((kpi) => (
          <article className="panel kpi" key={kpi.label}>
            <span>{kpi.label}</span>
            <strong>{kpi.value}</strong>
            <small>{kpi.trend}</small>
          </article>
        ))}
      </section>

      <section className="content-grid">
        <article className="panel data-card">
          <h2>每日員工業績</h2>
          <div className="table-scroll">
            <table>
              <thead>
                <tr>
                  <th>日期</th>
                  <th>人員</th>
                  <th>櫃位</th>
                  <th>訂單</th>
                  <th>實收</th>
                  <th>抽成</th>
                </tr>
              </thead>
              <tbody>
                {(report?.daily ?? []).slice(0, 12).map((row) => (
                  <tr key={`${row.date}-${row.sellerId}-${row.counterId}`}>
                    <td>{row.date}</td>
                    <td>{row.sellerName}</td>
                    <td>{row.counterName}</td>
                    <td>{row.orderCount}</td>
                    <td>{formatCurrency(row.receivedAmount)}</td>
                    <td>{formatCurrency(row.commission)}</td>
                  </tr>
                ))}
                {report && report.daily.length === 0 ? (
                  <tr>
                    <td colSpan={6}>本月尚無訂單</td>
                  </tr>
                ) : null}
              </tbody>
            </table>
          </div>
        </article>
        <article className="panel data-card">
          <h2>櫃位目標</h2>
          <div className="target-list">
            {(report?.targets ?? []).map((target) => (
              <div key={`${target.counterId}-${target.month}`}>
                <strong>{target.counterName}</strong>
                <span>{formatPercent(target.achievementRate)}</span>
                <div className="bar-track">
                  <div
                    className="bar"
                    style={{ width: `${Math.min(100, Math.round(target.achievementRate * 100))}%` }}
                  />
                </div>
              </div>
            ))}
            {report && report.targets.length === 0 ? <p>本月尚未設定櫃位目標。</p> : null}
          </div>
        </article>
      </section>
    </>
  );
}

function formatCurrency(value: number) {
  return `$${Math.round(value).toLocaleString("en-US")}`;
}

function formatPercent(value: number) {
  return `${Math.round(value * 100)}%`;
}
