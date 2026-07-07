"use client";

import { useEffect, useState } from "react";
import type {
  DailyPerformanceRow,
  MonthlyPerformanceRow,
  ReportSummary
} from "@/lib/backend/api-types";

type CounterOption = {
  id: string;
  name: string;
};

type ReportData = {
  daily: DailyPerformanceRow[];
  monthly: MonthlyPerformanceRow[];
  summary: ReportSummary;
  productSales: Array<{
    productName: string;
    spec: string;
    category: string;
    quantity: number;
    revenue: number;
    revenueShare: number;
  }>;
  categorySales: Array<{
    category: string;
    quantity: number;
    revenue: number;
    revenueShare: number;
  }>;
  flavorSales: Array<{ flavorName: string; spec: string; quantity: number }>;
  discountUsage: Array<{
    discountName: string;
    orderCount: number;
    discountAmount: number;
    receivedAmount: number;
  }>;
  preorders: Array<{ itemName: string; spec: string; quantity: number; orderCount: number }>;
  source: "demo" | "supabase";
};

export function ReportsView() {
  const today = new Date().toISOString().slice(0, 10);
  const [from, setFrom] = useState(`${today.slice(0, 7)}-01`);
  const [to, setTo] = useState(today);
  const [counterId, setCounterId] = useState("all");
  const [counters, setCounters] = useState<CounterOption[]>([]);
  const [report, setReport] = useState<ReportData | null>(null);
  const [status, setStatus] = useState("讀取報表中...");

  useEffect(() => {
    void loadCounters();
  }, []);

  useEffect(() => {
    void loadReport();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [from, to, counterId]);

  async function loadCounters() {
    const response = await fetch("/api/catalog");
    const result = await response.json();

    if (result.ok) {
      setCounters(result.data.counters ?? []);
    }
  }

  async function loadReport() {
    setStatus("讀取報表中...");
    const params = new URLSearchParams({ from, to });

    if (counterId !== "all") {
      params.set("counterId", counterId);
    }

    const response = await fetch(`/api/reports?${params.toString()}`);
    const result = await response.json();

    if (!result.ok) {
      setStatus(result.error);
      return;
    }

    setReport(result.data);
    setStatus(result.data.source === "supabase" ? "已連線本地資料庫" : "Demo 模式");
  }

  return (
    <>
      <section className="section-title">
        <div>
          <h1>報表</h1>
          <p>依日期、櫃位與銷售人員檢視折扣後業績。</p>
        </div>
        <div className="toolbar">
          <label className="field compact">
            <span>起日</span>
            <input type="date" value={from} onChange={(event) => setFrom(event.target.value)} />
          </label>
          <label className="field compact">
            <span>迄日</span>
            <input type="date" value={to} onChange={(event) => setTo(event.target.value)} />
          </label>
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
          <span className="pill">{status}</span>
        </div>
      </section>

      <section className="kpi-grid">
        <article className="panel kpi">
          <span>訂單數</span>
          <strong>{report?.summary.orderCount ?? 0}</strong>
          <small>
            {from} ~ {to}
          </small>
        </article>
        <article className="panel kpi">
          <span>銷售金額</span>
          <strong>{formatCurrency(report?.summary.salesAmount ?? 0)}</strong>
          <small>折扣前</small>
        </article>
        <article className="panel kpi">
          <span>實收金額</span>
          <strong>{formatCurrency(report?.summary.receivedAmount ?? 0)}</strong>
          <small>折扣 {formatCurrency(report?.summary.discountAmount ?? 0)}</small>
        </article>
        <article className="panel kpi">
          <span>平均客單價</span>
          <strong>{formatCurrency(report?.summary.averageOrderValue ?? 0)}</strong>
          <small>實收 / 訂單數</small>
        </article>
      </section>

      <section className="panel data-card">
        <h2>每日員工業績</h2>
        <table>
          <thead>
            <tr>
              <th>日期</th>
              <th>銷售人員</th>
              <th>櫃位</th>
              <th>訂單數</th>
              <th>銷售金額</th>
              <th>折扣</th>
              <th>實收</th>
              <th>抽成</th>
            </tr>
          </thead>
          <tbody>
            {(report?.daily ?? []).map((row) => (
              <tr key={`${row.date}-${row.sellerId}-${row.counterId}`}>
                <td>{row.date}</td>
                <td>{row.sellerName}</td>
                <td>{row.counterName}</td>
                <td>{row.orderCount}</td>
                <td>{formatCurrency(row.salesAmount)}</td>
                <td>{formatCurrency(row.discountAmount)}</td>
                <td>{formatCurrency(row.receivedAmount)}</td>
                <td>{formatCurrency(row.commission)}</td>
              </tr>
            ))}
            {report && report.daily.length === 0 ? (
              <tr>
                <td colSpan={8}>此區間沒有訂單</td>
              </tr>
            ) : null}
          </tbody>
        </table>
      </section>

      <section className="panel data-card">
        <h2>每月員工業績</h2>
        <table>
          <thead>
            <tr>
              <th>月份</th>
              <th>銷售人員</th>
              <th>訂單數</th>
              <th>銷售金額</th>
              <th>折扣</th>
              <th>實收</th>
              <th>抽成</th>
            </tr>
          </thead>
          <tbody>
            {(report?.monthly ?? []).map((row) => (
              <tr key={`${row.month}-${row.sellerId}`}>
                <td>{row.month}</td>
                <td>{row.sellerName}</td>
                <td>{row.orderCount}</td>
                <td>{formatCurrency(row.salesAmount)}</td>
                <td>{formatCurrency(row.discountAmount)}</td>
                <td>{formatCurrency(row.receivedAmount)}</td>
                <td>{formatCurrency(row.commission)}</td>
              </tr>
            ))}
            {report && report.monthly.length === 0 ? (
              <tr>
                <td colSpan={7}>此區間沒有訂單</td>
              </tr>
            ) : null}
          </tbody>
        </table>
      </section>

      <section className="content-grid">
        <article className="panel data-card">
          <h2>商品銷售</h2>
          <table>
            <thead>
              <tr>
                <th>商品</th>
                <th>類型</th>
                <th>數量</th>
                <th>營收</th>
                <th>營收佔比</th>
              </tr>
            </thead>
            <tbody>
              {(report?.productSales ?? []).map((row) => (
                <tr key={`${row.productName}-${row.spec}`}>
                  <td>
                    {row.productName}（{row.spec}）
                  </td>
                  <td>{row.category === "bag" ? "袋裝" : "禮盒"}</td>
                  <td>{row.quantity}</td>
                  <td>{formatCurrency(row.revenue)}</td>
                  <td>{Math.round(row.revenueShare * 100)}%</td>
                </tr>
              ))}
              {report && report.productSales.length === 0 ? (
                <tr>
                  <td colSpan={5}>此區間沒有銷售資料</td>
                </tr>
              ) : null}
            </tbody>
          </table>
        </article>

        <article className="panel data-card">
          <h2>袋裝 / 禮盒分析</h2>
          <table>
            <thead>
              <tr>
                <th>類別</th>
                <th>數量</th>
                <th>營收</th>
                <th>營收佔比</th>
              </tr>
            </thead>
            <tbody>
              {(report?.categorySales ?? []).map((row) => (
                <tr key={row.category}>
                  <td>{row.category === "bag" ? "袋裝" : "禮盒"}</td>
                  <td>{row.quantity}</td>
                  <td>{formatCurrency(row.revenue)}</td>
                  <td>{Math.round(row.revenueShare * 100)}%</td>
                </tr>
              ))}
            </tbody>
          </table>

          <h2>口味銷售數量</h2>
          <table>
            <thead>
              <tr>
                <th>口味</th>
                <th>規格</th>
                <th>數量</th>
              </tr>
            </thead>
            <tbody>
              {(report?.flavorSales ?? []).map((row) => (
                <tr key={`${row.flavorName}-${row.spec}`}>
                  <td>{row.flavorName}</td>
                  <td>{row.spec}</td>
                  <td>{row.quantity}</td>
                </tr>
              ))}
              {report && report.flavorSales.length === 0 ? (
                <tr>
                  <td colSpan={3}>此區間沒有禮盒口味銷售</td>
                </tr>
              ) : null}
            </tbody>
          </table>
        </article>
      </section>

      <section className="content-grid">
        <article className="panel data-card">
          <h2>折扣使用分析</h2>
          <table>
            <thead>
              <tr>
                <th>折扣</th>
                <th>使用次數</th>
                <th>折讓金額</th>
                <th>折後實收</th>
              </tr>
            </thead>
            <tbody>
              {(report?.discountUsage ?? []).map((row) => (
                <tr key={row.discountName}>
                  <td>{row.discountName}</td>
                  <td>{row.orderCount}</td>
                  <td>{formatCurrency(row.discountAmount)}</td>
                  <td>{formatCurrency(row.receivedAmount)}</td>
                </tr>
              ))}
              {report && report.discountUsage.length === 0 ? (
                <tr>
                  <td colSpan={4}>此區間沒有折扣使用</td>
                </tr>
              ) : null}
            </tbody>
          </table>
        </article>

        <article className="panel data-card">
          <h2>預購紀錄</h2>
          <table>
            <thead>
              <tr>
                <th>品項</th>
                <th>規格</th>
                <th>預購數量</th>
                <th>訂單數</th>
              </tr>
            </thead>
            <tbody>
              {(report?.preorders ?? []).map((row) => (
                <tr key={`${row.itemName}-${row.spec}`}>
                  <td>{row.itemName}</td>
                  <td>{row.spec}</td>
                  <td>{row.quantity}</td>
                  <td>{row.orderCount}</td>
                </tr>
              ))}
              {report && report.preorders.length === 0 ? (
                <tr>
                  <td colSpan={4}>此區間沒有預購</td>
                </tr>
              ) : null}
            </tbody>
          </table>
        </article>
      </section>
    </>
  );
}

function formatCurrency(value: number) {
  return `$${Math.round(value).toLocaleString("en-US")}`;
}
