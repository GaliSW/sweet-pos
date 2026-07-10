"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { managerNavLinks as links } from "./nav-links";

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
