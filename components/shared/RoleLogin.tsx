"use client";

import { useRouter } from "next/navigation";

export function RoleLogin() {
  const router = useRouter();

  function enter(role: "staff" | "manager") {
    document.cookie = `pos-cloud-role=${role}; path=/; max-age=86400; SameSite=Lax`;
    router.push(role === "manager" ? "/manager" : "/pos");
  }

  return (
    <div className="login-actions">
      <button className="primary-action" onClick={() => enter("staff")} type="button">
        員工入口
      </button>
      <button className="secondary-action" onClick={() => enter("manager")} type="button">
        店長入口
      </button>
    </div>
  );
}
