"use client";

import { usePathname } from "next/navigation";
import { useEffect, useState } from "react";
import { getSelectedCounterId, setSelectedCounterId } from "@/lib/shared/counter-preference";

type CounterOption = {
  id: string;
  name: string;
};

export function CounterSwitcher() {
  const pathname = usePathname();
  const [counters, setCounters] = useState<CounterOption[]>([]);
  const [counterId, setCounterId] = useState("");
  const [role, setRole] = useState<"staff" | "manager" | null>(null);
  const [fromShift, setFromShift] = useState(false);

  useEffect(() => {
    if (pathname === "/login") return;

    void load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pathname === "/login"]);

  async function load() {
    try {
      const [catalogResult, meResult] = await Promise.all([
        fetch("/api/catalog").then((response) => response.json()),
        fetch("/api/me").then((response) => response.json())
      ]);

      if (!catalogResult.ok) return;

      const list: CounterOption[] = (catalogResult.data.counters ?? []).map(
        (counter: { id: string; name: string }) => ({ id: counter.id, name: counter.name })
      );
      setCounters(list);

      const me = meResult?.ok ? meResult.data : null;
      setRole(me?.role ?? null);

      const saved = getSelectedCounterId();
      let initial = list.some((counter) => counter.id === saved) ? saved : list[0]?.id ?? "";

      // 一般員工鎖定今日班表的櫃位,只有店長可自由切換。
      if (me?.role === "staff" && me.todayCounterId) {
        initial = me.todayCounterId;
        setFromShift(true);
      }

      setCounterId(initial);

      if (initial && initial !== saved) {
        setSelectedCounterId(initial);
      }
    } catch {
      /* keep defaults */
    }
  }

  if (pathname === "/login" || counters.length === 0) return null;

  function switchCounter(nextId: string) {
    setCounterId(nextId);
    setSelectedCounterId(nextId);
  }

  if (role === "staff") {
    const name = counters.find((counter) => counter.id === counterId)?.name ?? "";

    return (
      <span className="counter-switcher">
        <span>目前櫃位</span>
        <strong>{name || "未指定"}</strong>
        <span>{fromShift ? "（今日班表）" : "（今日未排班）"}</span>
      </span>
    );
  }

  return (
    <label className="counter-switcher">
      <span>目前櫃位</span>
      <select value={counterId} onChange={(event) => switchCounter(event.target.value)}>
        {counters.map((counter) => (
          <option key={counter.id} value={counter.id}>
            {counter.name}
          </option>
        ))}
      </select>
    </label>
  );
}
