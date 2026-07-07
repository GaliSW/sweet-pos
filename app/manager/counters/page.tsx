import { CounterSettings } from "@/components/manager/CounterSettings";
import { ManagerShell } from "@/components/shared/ManagerShell";

export default function CountersPage() {
  return (
    <ManagerShell>
      <CounterSettings />
    </ManagerShell>
  );
}
