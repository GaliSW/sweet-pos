import { StaffScheduleTable } from "@/components/staff/StaffScheduleTable";

export default function StaffSchedulePage() {
  return (
    <main className="stack">
      <section className="section-title">
        <div>
          <h1>我的班表</h1>
          <p>只顯示已發布且屬於登入員工的班次。</p>
        </div>
        <span className="pill">開班與下班請完成庫存盤點</span>
      </section>

      <StaffScheduleTable />
    </main>
  );
}
