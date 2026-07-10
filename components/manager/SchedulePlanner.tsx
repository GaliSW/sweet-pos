"use client";

import { useEffect, useMemo, useState } from "react";
import type { ShiftCode, UpsertShiftInput } from "@/lib/backend/api-types";
import { counters as fallbackCounters, currentShiftStaff } from "@/lib/domain/sample-data";

type ScheduleSlot = {
  date: string;
  shiftCode: ShiftCode;
};

type ShiftAssignment = {
  staffId: string | null;
  staffName: string;
  startsAt: string;
  endsAt: string;
  published: boolean;
};

type StaffOption = {
  id: string;
  name: string;
};

type CounterOption = {
  id: string;
  name: string;
};

const shiftLabels: Record<ShiftCode, string> = {
  morning: "早班",
  evening: "晚班"
};

const defaultShiftTimes: Record<ShiftCode, Pick<ShiftAssignment, "startsAt" | "endsAt">> = {
  morning: { startsAt: "10:30", endsAt: "14:30" },
  evening: { startsAt: "14:30", endsAt: "22:30" }
};

const defaultStaffOptions = currentShiftStaff.map((staff) => ({
  id: staff.id,
  name: staff.name
}));

export function SchedulePlanner() {
  const [month, setMonth] = useState(() => new Date().toISOString().slice(0, 7));
  const [counterId, setCounterId] = useState(fallbackCounters[0]?.id ?? "");
  const [counters, setCounters] = useState<CounterOption[]>(fallbackCounters);
  const [staffOptions, setStaffOptions] = useState<StaffOption[]>(defaultStaffOptions);
  const [selectedSlot, setSelectedSlot] = useState<ScheduleSlot>(() => ({
    date: `${new Date().toISOString().slice(0, 7)}-01`,
    shiftCode: "morning"
  }));
  const [assignments, setAssignments] = useState<Record<string, ShiftAssignment>>({});
  const [status, setStatus] = useState("讀取班表中...");
  const [saving, setSaving] = useState(false);
  const [editorOpen, setEditorOpen] = useState(false);

  const days = useMemo(() => daysInMonth(month), [month]);
  const selectedAssignment =
    assignments[slotKey(selectedSlot.date, selectedSlot.shiftCode)] ??
    createDefaultAssignment(selectedSlot.shiftCode);
  const missingCount = useMemo(
    () =>
      days.flatMap((date) => ["morning", "evening"].map((shiftCode) => slotKey(date, shiftCode as ShiftCode)))
        .filter((key) => !assignments[key]?.staffId).length,
    [assignments, days]
  );

  useEffect(() => {
    void loadCatalog();
  }, []);

  useEffect(() => {
    setSelectedSlot((current) => ({
      date: days.includes(current.date) ? current.date : days[0],
      shiftCode: current.shiftCode
    }));
  }, [days]);

  useEffect(() => {
    if (counterId) void loadShifts();
  }, [counterId, month]);

  // 手機版編輯面板為底部彈出:鎖定背景捲動並支援 Escape 關閉;桌面版編輯欄常駐不受影響
  useEffect(() => {
    if (!editorOpen) return;

    const mobile = window.matchMedia("(max-width: 720px)");

    function syncScrollLock() {
      document.body.style.overflow = mobile.matches ? "hidden" : "";
    }

    function onKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape") setEditorOpen(false);
    }

    syncScrollLock();
    document.addEventListener("keydown", onKeyDown);
    mobile.addEventListener("change", syncScrollLock);

    return () => {
      document.removeEventListener("keydown", onKeyDown);
      mobile.removeEventListener("change", syncScrollLock);
      document.body.style.overflow = "";
    };
  }, [editorOpen]);

  async function loadCatalog() {
    const response = await fetch("/api/catalog");
    const result = await response.json();

    if (!result.ok) return;

    const nextCounters = (result.data.counters ?? fallbackCounters).map((counter: { id: string; name: string }) => ({
      id: counter.id,
      name: counter.name
    }));
    const nextStaff = (result.data.staff ?? defaultStaffOptions).map(
      (staff: { id: string; name?: string; display_name?: string }) => ({
        id: staff.id,
        name: staff.name ?? staff.display_name ?? "未命名員工"
      })
    );

    setCounters(nextCounters);
    setStaffOptions(nextStaff);
    setCounterId((current) => current || nextCounters[0]?.id || "");
  }

  async function loadShifts() {
    setStatus("讀取班表中...");
    const response = await fetch(`/api/shifts?counterId=${counterId}&month=${month}`);
    const result = await response.json();

    if (!result.ok) {
      setStatus(result.error);
      return;
    }

    const nextAssignments: Record<string, ShiftAssignment> = {};

    for (const shift of result.data.shifts ?? []) {
      nextAssignments[slotKey(shift.shiftDate, shift.shiftCode)] = {
        staffId: shift.staffId,
        staffName: shift.staffName,
        startsAt: shift.startsAt,
        endsAt: shift.endsAt,
        published: shift.published
      };
    }

    setAssignments(nextAssignments);
    setStatus(result.data.source === "supabase" ? "已連線本地資料庫" : "Demo 模式");
  }

  function assignStaff(staffId: string) {
    const staff = staffOptions.find((option) => option.id === staffId);
    updateSelectedAssignment({
      staffId: staffId || null,
      staffName: staff?.name ?? "未排"
    });
  }

  function updateShiftTime(field: "startsAt" | "endsAt", value: string) {
    updateSelectedAssignment({ [field]: value });
  }

  function selectSlot(date: string, shiftCode: ShiftCode) {
    setSelectedSlot({ date, shiftCode });
    setEditorOpen(true);
  }

  function updateSelectedAssignment(partial: Partial<ShiftAssignment>) {
    setAssignments((current) => {
      const key = slotKey(selectedSlot.date, selectedSlot.shiftCode);
      const currentAssignment = current[key] ?? createDefaultAssignment(selectedSlot.shiftCode);

      return {
        ...current,
        [key]: {
          ...currentAssignment,
          ...partial
        }
      };
    });
  }

  async function saveSelectedShift(published: boolean) {
    setSaving(true);
    setStatus("儲存班次中...");

    const payload: UpsertShiftInput = {
      counterId,
      staffId: selectedAssignment.staffId,
      shiftDate: selectedSlot.date,
      shiftCode: selectedSlot.shiftCode,
      startsAt: selectedAssignment.startsAt,
      endsAt: selectedAssignment.endsAt,
      published
    };

    const response = await fetch("/api/shifts", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(payload)
    });
    const result = await response.json();

    setSaving(false);

    if (!result.ok) {
      setStatus(result.error);
      return;
    }

    setStatus(published ? "班次已儲存並發布" : "班次草稿已儲存");
    setEditorOpen(false);
    await loadShifts();
  }

  async function applyPreviousMonth() {
    setSaving(true);
    setStatus("套用上月班表中...");

    const response = await fetch("/api/shifts/apply-previous", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ counterId, month })
    });
    const result = await response.json();

    setSaving(false);

    if (!result.ok) {
      setStatus(result.error);
      return;
    }

    setStatus(
      result.data.source === "demo"
        ? "Demo 模式:未套用班表"
        : `已套用 ${result.data.sourceMonth} 班表(${result.data.appliedCount} 班,草稿)`
    );
    await loadShifts();
  }

  async function publishMonth() {
    setSaving(true);
    setStatus("檢查衝突並發布中...");

    const response = await fetch("/api/shifts/publish", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ month, counterId })
    });
    const result = await response.json();

    setSaving(false);

    if (!result.ok) {
      const conflictMessages = (result.conflicts ?? [])
        .map((conflict: { message: string }) => conflict.message)
        .join(";");
      setStatus(conflictMessages ? `${result.error}:${conflictMessages}` : result.error);
      return;
    }

    setStatus(
      result.data.source === "demo"
        ? "Demo 模式:未發布班表"
        : `已發布 ${result.data.publishedCount} 個班次`
    );
    await loadShifts();
  }

  return (
    <section className="schedule-workspace">
      <div className="schedule-controls">
        <label className="field">
          <span>月份</span>
          <input type="month" value={month} onChange={(event) => setMonth(event.target.value)} />
        </label>
        <label className="field">
          <span>櫃位</span>
          <select value={counterId} onChange={(event) => setCounterId(event.target.value)}>
            {counters.map((counter) => (
              <option key={counter.id} value={counter.id}>
                {counter.name}
              </option>
            ))}
          </select>
        </label>
        <button className="secondary-action" disabled={saving} onClick={applyPreviousMonth} type="button">
          套用上月班表
        </button>
        <button className="primary-action slim" disabled={saving} onClick={publishMonth} type="button">
          發布整月
        </button>
        <span className="pill">{status}</span>
      </div>

      <div className="calendar">
        {days.map((date) => {
          const displayDay = Number(date.slice(8, 10));

          return (
            <article className="day" key={date}>
              <span className="day-number">
                {Number(month.slice(5, 7))}/{displayDay} 週{weekdayOf(date)}
              </span>
              {(["morning", "evening"] as ShiftCode[]).map((shiftCode) => {
                const active = selectedSlot.date === date && selectedSlot.shiftCode === shiftCode;
                const assignment =
                  assignments[slotKey(date, shiftCode)] ?? createDefaultAssignment(shiftCode);

                return (
                  <button
                    className={`shift ${shiftCode} ${active ? "active" : ""}`}
                    key={shiftCode}
                    onClick={() => selectSlot(date, shiftCode)}
                    type="button"
                  >
                    <span>
                      {shiftLabels[shiftCode]}
                      {assignment.staffId ? (assignment.published ? " ✓已發布" : " ・草稿") : ""}
                    </span>
                    <strong>{assignment.staffName}</strong>
                    <small>
                      {assignment.startsAt}-{assignment.endsAt} / {calculateHours(assignment)}h
                    </small>
                  </button>
                );
              })}
            </article>
          );
        })}
      </div>

      {editorOpen ? (
        <div
          className="schedule-editor-scrim"
          onClick={() => setEditorOpen(false)}
          role="presentation"
        />
      ) : null}

      <aside className={`panel data-card schedule-editor ${editorOpen ? "open" : ""}`}>
        <div className="schedule-editor-head">
          <div>
            <h2>編輯班次</h2>
            <p>
              {selectedSlot.date} 週{weekdayOf(selectedSlot.date)}{" "}
              {shiftLabels[selectedSlot.shiftCode]} / {calculateHours(selectedAssignment)} 小時
            </p>
            <span className={selectedAssignment.published ? "status" : "status warn"}>
              {selectedAssignment.published ? "已發布" : "未發布"}
            </span>
          </div>
          <button
            aria-label="關閉編輯面板"
            className="icon-btn sheet-close"
            onClick={() => setEditorOpen(false)}
            type="button"
          >
            <svg
              aria-hidden="true"
              fill="none"
              height="18"
              stroke="currentColor"
              strokeLinecap="round"
              strokeWidth="2.2"
              viewBox="0 0 24 24"
              width="18"
            >
              <path d="M5 5l14 14M19 5L5 19" />
            </svg>
          </button>
        </div>

        <label className="field">
          <span>指派員工</span>
          <select
            value={selectedAssignment.staffId ?? ""}
            onChange={(event) => assignStaff(event.target.value)}
          >
            <option value="">未排</option>
            {staffOptions.map((staff) => (
              <option key={staff.id} value={staff.id}>
                {staff.name}
              </option>
            ))}
          </select>
        </label>

        <div className="field-row">
          <label className="field">
            <span>開始時間</span>
            <input
              type="time"
              value={selectedAssignment.startsAt}
              onChange={(event) => updateShiftTime("startsAt", event.target.value)}
            />
          </label>
          <label className="field">
            <span>結束時間</span>
            <input
              type="time"
              value={selectedAssignment.endsAt}
              onChange={(event) => updateShiftTime("endsAt", event.target.value)}
            />
          </label>
        </div>
        <div className="schedule-actions">
          <button className="secondary-action" onClick={() => assignStaff("")} type="button">
            清空此班
          </button>
          <button
            className="secondary-action"
            disabled={saving}
            onClick={() => saveSelectedShift(false)}
            type="button"
          >
            儲存草稿
          </button>
          <button
            className="primary-action slim"
            disabled={saving}
            onClick={() => saveSelectedShift(true)}
            type="button"
          >
            發布此班
          </button>
        </div>

        <div className="split-example">
          <strong>範例</strong>
          <span>10:30-14:30 排 A 4 小時，14:30-22:30 排 B 8 小時。</span>
          <span>發布後仍可修改：儲存草稿會把該班轉回未發布，需再次發布員工才看得到。</span>
        </div>

        <div className="schedule-summary">
          <span className={missingCount > 0 ? "status warn" : "status"}>
            {missingCount > 0 ? `${missingCount} 個班次未排` : "班表已排滿"}
          </span>
          <span className="pill">{status}</span>
        </div>
      </aside>
    </section>
  );
}

function slotKey(date: string, shiftCode: ShiftCode) {
  return `${date}-${shiftCode}`;
}

function weekdayOf(date: string) {
  const [year, month, day] = date.split("-").map(Number);
  return "日一二三四五六"[new Date(year, month - 1, day).getDay()];
}

function createDefaultAssignment(shiftCode: ShiftCode): ShiftAssignment {
  return {
    staffId: null,
    staffName: "未排",
    published: false,
    ...defaultShiftTimes[shiftCode]
  };
}

function calculateHours(assignment: Pick<ShiftAssignment, "startsAt" | "endsAt">) {
  const start = timeToMinutes(assignment.startsAt);
  const end = timeToMinutes(assignment.endsAt);
  const duration = end >= start ? end - start : end + 24 * 60 - start;

  return Number((duration / 60).toFixed(1));
}

function timeToMinutes(time: string) {
  const [hours, minutes] = time.split(":").map(Number);
  return hours * 60 + minutes;
}

function daysInMonth(month: string) {
  const [year, monthIndex] = month.split("-").map(Number);
  const total = new Date(year, monthIndex, 0).getDate();

  return Array.from({ length: total }, (_, index) => {
    const day = String(index + 1).padStart(2, "0");
    return `${month}-${day}`;
  });
}
