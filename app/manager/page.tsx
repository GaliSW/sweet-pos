import { ManagerDashboard } from "@/components/manager/ManagerDashboard";
import { ManagerShell } from "@/components/shared/ManagerShell";

export default function ManagerPage() {
  return (
    <ManagerShell>
      <ManagerDashboard />
    </ManagerShell>
  );
}
