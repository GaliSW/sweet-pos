"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

const links = [
  { href: "/manager", label: "總覽" },
  { href: "/manager/reports", label: "報表" },
  { href: "/manager/orders", label: "訂單" },
  { href: "/manager/schedule", label: "排班" },
  { href: "/manager/payroll", label: "薪資" },
  { href: "/manager/inventory", label: "庫存" },
  { href: "/manager/products", label: "商品" },
  { href: "/manager/counters", label: "櫃位" },
  { href: "/manager/staff", label: "員工" }
] as const;

export function ManagerShell({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();

  return (
    <div className="admin-layout">
      <aside className="panel admin-nav" aria-label="店長功能">
        {links.map((link) => {
          const active =
            link.href === "/manager" ? pathname === "/manager" : pathname.startsWith(link.href);

          return (
            <Link
              aria-current={active ? "page" : undefined}
              className={`nav-button ${active ? "active" : ""}`}
              href={link.href}
              key={link.href}
            >
              {link.label}
            </Link>
          );
        })}
      </aside>
      <main className="admin-main">{children}</main>
    </div>
  );
}
