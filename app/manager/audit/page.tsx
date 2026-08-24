import { AuditLogView } from "@/components/manager/AuditLogView";
import { ManagerShell } from "@/components/shared/ManagerShell";

export default function ManagerAuditPage() {
  return (
    <ManagerShell>
      <AuditLogView />
    </ManagerShell>
  );
}
