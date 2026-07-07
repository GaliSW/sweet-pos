import { InventoryDashboard } from "@/components/manager/InventoryDashboard";
import { ManagerShell } from "@/components/shared/ManagerShell";

export default function ManagerInventoryPage() {
  return (
    <ManagerShell>
      <InventoryDashboard />
    </ManagerShell>
  );
}
