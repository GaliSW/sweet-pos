import { ManagerShell } from "@/components/shared/ManagerShell";
import { SchedulePlanner } from "@/components/manager/SchedulePlanner";

export default function ManagerSchedulePage() {
  return (
    <ManagerShell>
      <section className="section-title">
        <div>
          <h1>月排班</h1>
          <p>每日早班 10:00-16:00、晚班 16:00-22:00。</p>
        </div>
        <div className="toolbar">
          <button className="secondary-action" type="button">
            套用上月
          </button>
          <button className="primary-action slim" type="button">
            發布班表
          </button>
        </div>
      </section>

      <SchedulePlanner />
    </ManagerShell>
  );
}
