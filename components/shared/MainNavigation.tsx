"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useState } from "react";
import { createPortal } from "react-dom";
import { createClient } from "@/lib/db/supabase";
import { managerNavLinks, staffNavItems } from "./nav-links";

const hasAuthEnv = Boolean(
  process.env.NEXT_PUBLIC_SUPABASE_URL && process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY
);

type Me = {
  displayName: string;
  role: "staff" | "manager";
};

export function MainNavigation() {
  const pathname = usePathname();
  const [me, setMe] = useState<Me | null>(null);
  const [menuOpen, setMenuOpen] = useState(false);

  useEffect(() => {
    if (pathname === "/login") return;

    void fetch("/api/me")
      .then((response) => response.json())
      .then((result) => {
        if (result.ok) setMe(result.data);
      })
      .catch(() => undefined);
  }, [pathname]);

  // 換頁時自動收合行動選單
  useEffect(() => {
    setMenuOpen(false);
  }, [pathname]);

  useEffect(() => {
    if (!menuOpen) return;

    function onKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape") setMenuOpen(false);
    }

    // 視窗放大回桌面尺寸時收合,避免抽屜被隱藏卻仍鎖住捲動
    const desktop = window.matchMedia("(min-width: 721px)");

    function onWidthChange(event: MediaQueryListEvent) {
      if (event.matches) setMenuOpen(false);
    }

    document.addEventListener("keydown", onKeyDown);
    desktop.addEventListener("change", onWidthChange);
    document.body.style.overflow = "hidden";

    return () => {
      document.removeEventListener("keydown", onKeyDown);
      desktop.removeEventListener("change", onWidthChange);
      document.body.style.overflow = "";
    };
  }, [menuOpen]);

  if (pathname === "/login") return null;

  // middleware 已限制 /manager 僅店長可進入,me 尚未載入時以路徑判斷
  const showManagerLinks = me?.role === "manager" || pathname.startsWith("/manager");

  async function logout() {
    if (hasAuthEnv) {
      const supabase = createClient();
      await supabase.auth.signOut();
    }

    document.cookie = "pos-cloud-role=; path=/; max-age=0; SameSite=Lax";
    window.location.assign("/login");
  }

  function isManagerLinkActive(href: string) {
    return href === "/manager" ? pathname === "/manager" : pathname.startsWith(href);
  }

  const drawer = (
    <div className="nav-drawer-scrim" onClick={() => setMenuOpen(false)}>
      <aside
        aria-label="導覽選單"
        className="nav-drawer"
        id="mobile-nav-drawer"
        onClick={(event) => event.stopPropagation()}
      >
        <header className="nav-drawer-head">
          {me ? <span className="user-chip">{me.displayName}</span> : <strong>選單</strong>}
          <button
            aria-label="關閉選單"
            className="icon-btn"
            onClick={() => setMenuOpen(false)}
            type="button"
          >
            <svg
              aria-hidden="true"
              fill="none"
              height="18"
              stroke="currentColor"
              strokeLinecap="round"
              strokeWidth="2.2"
              viewBox="0 0 24 24"
              width="18"
            >
              <path d="M5 5l14 14M19 5L5 19" />
            </svg>
          </button>
        </header>
        <nav aria-label="行動導覽" className="nav-drawer-body">
          <span className="nav-drawer-label">工作區</span>
          {staffNavItems.map((item) => {
            const active = pathname === item.href;

            return (
              <Link
                aria-current={active ? "page" : undefined}
                className={`drawer-link ${active ? "active" : ""}`}
                href={item.href}
                key={item.href}
              >
                {item.label}
              </Link>
            );
          })}
          {showManagerLinks ? (
            <>
              <span className="nav-drawer-label">店長後台</span>
              {managerNavLinks.map((link) => {
                const active = isManagerLinkActive(link.href);

                return (
                  <Link
                    aria-current={active ? "page" : undefined}
                    className={`drawer-link ${active ? "active" : ""}`}
                    href={link.href}
                    key={link.href}
                  >
                    {link.label}
                  </Link>
                );
              })}
            </>
          ) : null}
          <button className="drawer-link logout" onClick={logout} type="button">
            登出
          </button>
        </nav>
      </aside>
    </div>
  );

  return (
    <>
      <nav className="top-actions" aria-label="主要導覽">
        {me ? <span className="user-chip">{me.displayName}</span> : null}
        {staffNavItems.map((item) => {
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
        <button
          aria-controls="mobile-nav-drawer"
          aria-expanded={menuOpen}
          aria-label="開啟選單"
          className="menu-toggle"
          onClick={() => setMenuOpen(true)}
          type="button"
        >
          <svg
            aria-hidden="true"
            fill="none"
            height="22"
            stroke="currentColor"
            strokeLinecap="round"
            strokeWidth="2.2"
            viewBox="0 0 24 24"
            width="22"
          >
            <path d="M4 6h16M4 12h16M4 18h16" />
          </svg>
        </button>
      </nav>
      {menuOpen ? createPortal(drawer, document.body) : null}
    </>
  );
}
