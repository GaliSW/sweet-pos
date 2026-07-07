import { OrdersExplorer } from "@/components/shared/OrdersExplorer";
import { ManagerShell } from "@/components/shared/ManagerShell";

export default function ManagerOrdersPage() {
  return (
    <ManagerShell>
      <OrdersExplorer variant="manager" />
    </ManagerShell>
  );
}
