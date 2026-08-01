import { PaymentMethodSettings } from "@/components/manager/PaymentMethodSettings";
import { ManagerShell } from "@/components/shared/ManagerShell";

export default function ManagerPaymentMethodsPage() {
  return (
    <ManagerShell>
      <PaymentMethodSettings />
    </ManagerShell>
  );
}
