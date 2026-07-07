import { StaffSettings } from "@/components/manager/StaffSettings";
import { ManagerShell } from "@/components/shared/ManagerShell";

export default function ManagerStaffPage() {
  return (
    <ManagerShell>
      <StaffSettings />
    </ManagerShell>
  );
}
