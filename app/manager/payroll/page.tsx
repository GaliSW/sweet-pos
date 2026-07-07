import { PayrollView } from "@/components/manager/PayrollView";
import { ManagerShell } from "@/components/shared/ManagerShell";

export default function ManagerPayrollPage() {
  return (
    <ManagerShell>
      <PayrollView />
    </ManagerShell>
  );
}
