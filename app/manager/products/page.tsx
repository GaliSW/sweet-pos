import { ProductSettings } from "@/components/manager/ProductSettings";
import { ManagerShell } from "@/components/shared/ManagerShell";

export default function ManagerProductsPage() {
  return (
    <ManagerShell>
      <ProductSettings />
    </ManagerShell>
  );
}
