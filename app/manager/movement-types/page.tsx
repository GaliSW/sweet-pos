import { InventoryMovementTypeSettings } from "@/components/manager/InventoryMovementTypeSettings";
import { ManagerShell } from "@/components/shared/ManagerShell";

export default function ManagerMovementTypesPage() {
  return (
    <ManagerShell>
      <InventoryMovementTypeSettings />
    </ManagerShell>
  );
}
