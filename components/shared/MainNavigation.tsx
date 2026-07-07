"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useState } from "react";
import { createClient } from "@/lib/db/supabase";

const hasAuthEnv = Boolean(
  process.env.NEXT_PUBLIC_SUPABASE_URL && process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY
);

const navItems = [
  { href: "/pos", label: "POS" },
  { href: "/staff/orders", label: "訂單" },
  { href: "/staff/schedule", label: "我的班表" },
  { href: "/staff/inventory", label: "庫存" }
] as const;

type Me = {
  displayName: string;
  role: "staff" | "manager";
};

export function MainNavigation() {
  const pathname = usePathname();
  const [me, setMe] = useState<Me | null>(null);

  useEffect(() => {
    if (pathname === "/login") return;

    void fetch("/api/me")
      .then((response) => response.json())
      .then((result) => {
        if (result.ok) setMe(result.data);
      })
      .catch(() => undefined);
  }, [pathname]);

  if (pathname === "/login") return null;

  async function logout() {
    if (hasAuthEnv) {
      const supabase = createClient();
      await supabase.auth.signOut();
    }

    document.cookie = "pos-cloud-role=; path=/; max-age=0; SameSite=Lax";
    window.location.assign("/login");
  }

  return (
    <nav className="top-actions" aria-label="主要導覽">
      {me ? <span className="user-chip">{me.displayName}</span> : null}
      {navItems.map((item) => {
        const active = pathname === item.href;

        return (
          <Link
            aria-current={active ? "page" : undefined}
            className={`nav-link ${active ? "active" : ""}`}
            href={item.href}
            key={item.href}
          >
            {item.label}
          </Link>
        );
      })}
      {me?.role === "manager" ? (
        <Link
          aria-current={pathname.startsWith("/manager") ? "page" : undefined}
          className={`manager-entry ${pathname.startsWith("/manager") ? "active" : ""}`}
          href="/manager"
        >
          店長後台
        </Link>
      ) : null}
      <button className="nav-link" onClick={logout} type="button">
        登出
      </button>
    </nav>
  );
}
