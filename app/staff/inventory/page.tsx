import { InventoryMovementForm } from "@/components/staff/InventoryMovementForm";

export default function StaffInventoryPage() {
  return (
    <main className="stack">
      <section className="section-title">
        <div>
          <h1>櫃位庫存</h1>
          <p>登記開班、下班、進貨、試吃、報廢與調整。</p>
        </div>
        <span className="pill">試吃 / 報廢 / 調整必填備註</span>
      </section>

      <InventoryMovementForm />
    </main>
  );
}
