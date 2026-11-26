import { InventoryMovementForm } from "@/components/staff/InventoryMovementForm";

export default function StaffInventoryPage() {
  return (
    <main className="stack">
      <section className="section-title">
        <div>
          <h1>櫃位庫存</h1>
          <p>登記盤點、進貨、試吃、報廢等庫存異動，類型由店長在後台設定。</p>
        </div>
        <span className="pill">部分類型必填備註</span>
      </section>

      <InventoryMovementForm />
    </main>
  );
}
