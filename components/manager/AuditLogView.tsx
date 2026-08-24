"use client";

import { useCallback, useEffect, useState } from "react";
import { auditEntityLabel, diffRecords, type AuditAction } from "@/lib/domain/audit-diff";

type AuditLog = {
  id: string;
  actorId: string | null;
  actorName: string;
  action: AuditAction;
  entity: string;
  entityId: string | null;
  entityLabel: string | null;
  before: unknown;
  after: unknown;
  createdAt: string;
};

type StaffOption = { id: string; displayName: string };

const ACTION_LABELS: Record<AuditAction, string> = {
  create: "新增",
  update: "修改",
  delete: "刪除"
};

const ENTITY_OPTIONS = [
  "products",
  "flavors",
  "bundles",
  "discounts",
  "counters",
  "profiles",
  "payment_methods",
  "commission_tiers"
];

function formatTimestamp(value: string) {
  return new Date(value).toLocaleString("zh-TW", { timeZone: "Asia/Taipei", hour12: false });
}

export function AuditLogView() {
  const [logs, setLogs] = useState<AuditLog[]>([]);
  const [staff, setStaff] = useState<StaffOption[]>([]);
  const [entity, setEntity] = useState("");
  const [actorId, setActorId] = useState("");
  const [from, setFrom] = useState("");
  const [to, setTo] = useState("");
  const [page, setPage] = useState(0);
  const [total, setTotal] = useState(0);
  const [pageSize, setPageSize] = useState(50);
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [status, setStatus] = useState("讀取操作紀錄中...");

  const loadLogs = useCallback(async () => {
    const params = new URLSearchParams();

    if (entity) params.set("entity", entity);
    if (actorId) params.set("actorId", actorId);
    if (from) params.set("from", from);
    if (to) params.set("to", to);
    params.set("page", String(page));

    const result = await fetch(`/api/audit?${params.toString()}`).then((response) =>
      response.json()
    );

    if (!result.ok) {
      setStatus(result.error);
      return;
    }

    setLogs(result.data.logs ?? []);
    setTotal(result.data.total ?? 0);
    setPageSize(result.data.pageSize ?? 50);
    setStatus(
      result.data.source === "supabase"
        ? `共 ${result.data.total ?? 0} 筆紀錄`
        : "Demo 模式，無紀錄"
    );
  }, [entity, actorId, from, to, page]);

  useEffect(() => {
    void loadLogs();
  }, [loadLogs]);

  useEffect(() => {
    void fetch("/api/staff")
      .then((response) => response.json())
      .then((result) => {
        if (!result.ok) return;
        setStaff(
          (result.data.staff ?? []).map((member: { id: string; displayName: string }) => ({
            id: member.id,
            displayName: member.displayName
          }))
        );
      });
  }, []);

  const lastPage = Math.max(0, Math.ceil(total / pageSize) - 1);

  return (
    <section className="panel data-card">
      <div className="panel-header">
        <div>
          <h2>操作紀錄</h2>
          <p>
            後台設定的新增、修改、刪除紀錄。POS 訂單與庫存異動的操作人記在各自的資料裡，不在這裡重複顯示。
          </p>
        </div>
        <span className="pill">{status}</span>
      </div>

      <div className="field-row">
        <label>
          類別
          <select
            onChange={(event) => {
              setPage(0);
              setEntity(event.target.value);
            }}
            value={entity}
          >
            <option value="">全部</option>
            {ENTITY_OPTIONS.map((option) => (
              <option key={option} value={option}>
                {auditEntityLabel(option)}
              </option>
            ))}
          </select>
        </label>

        <label>
          操作人
          <select
            onChange={(event) => {
              setPage(0);
              setActorId(event.target.value);
            }}
            value={actorId}
          >
            <option value="">全部</option>
            {staff.map((member) => (
              <option key={member.id} value={member.id}>
                {member.displayName}
              </option>
            ))}
          </select>
        </label>

        <label>
          起
          <input
            onChange={(event) => {
              setPage(0);
              setFrom(event.target.value);
            }}
            type="date"
            value={from}
          />
        </label>

        <label>
          迄
          <input
            onChange={(event) => {
              setPage(0);
              setTo(event.target.value);
            }}
            type="date"
            value={to}
          />
        </label>
      </div>

      <div className="table-scroll">
        <table>
          <thead>
            <tr>
              <th>時間</th>
              <th>操作人</th>
              <th>動作</th>
              <th>類別</th>
              <th>對象</th>
              <th />
            </tr>
          </thead>
          <tbody>
            {logs.map((log) => {
              const changes = diffRecords(log.before, log.after);
              const expanded = expandedId === log.id;

              return (
                <tr key={log.id}>
                  <td>{formatTimestamp(log.createdAt)}</td>
                  <td>{log.actorName}</td>
                  <td>{ACTION_LABELS[log.action] ?? log.action}</td>
                  <td>{auditEntityLabel(log.entity)}</td>
                  <td>
                    {log.entityLabel ?? "—"}
                    {expanded ? (
                      <ul className="audit-changes">
                        {changes.length === 0 ? (
                          <li>無欄位變更</li>
                        ) : (
                          changes.map((change) => (
                            <li key={change.field}>
                              {change.label}：{change.before ?? "—"} → {change.after ?? "—"}
                            </li>
                          ))
                        )}
                      </ul>
                    ) : null}
                  </td>
                  <td>
                    <button
                      className="secondary-action slim"
                      onClick={() => setExpandedId(expanded ? null : log.id)}
                      type="button"
                    >
                      {expanded ? "收合" : `明細 (${changes.length})`}
                    </button>
                  </td>
                </tr>
              );
            })}
            {logs.length === 0 ? (
              <tr>
                <td colSpan={6}>沒有符合條件的紀錄</td>
              </tr>
            ) : null}
          </tbody>
        </table>
      </div>

      <div className="field-row">
        <button
          className="secondary-action slim"
          disabled={page <= 0}
          onClick={() => setPage(page - 1)}
          type="button"
        >
          上一頁
        </button>
        <span>
          第 {page + 1} / {lastPage + 1} 頁
        </span>
        <button
          className="secondary-action slim"
          disabled={page >= lastPage}
          onClick={() => setPage(page + 1)}
          type="button"
        >
          下一頁
        </button>
      </div>
    </section>
  );
}
