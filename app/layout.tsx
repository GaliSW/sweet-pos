import type { Metadata, Viewport } from "next";
import Link from "next/link";
import { CounterSwitcher } from "@/components/shared/CounterSwitcher";
import { MainNavigation } from "@/components/shared/MainNavigation";
import "./globals.css";

export const metadata: Metadata = {
  title: "POS Cloud",
  description: "Cloud POS and operations console for counter teams"
};

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  viewportFit: "cover" // 內容延伸至瀏海/手勢區,由 CSS safe-area inset 留白
};

export default function RootLayout({
  children
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="zh-Hant">
      <body>
        <div className="app-shell">
          <header className="topbar">
            <Link className="brand" href="/pos">
              <span className="brand-mark">PC</span>
              <span>
                <strong>POS Cloud</strong>
                <small>雲端櫃位系統</small>
              </span>
            </Link>
            <CounterSwitcher />
            <MainNavigation />
          </header>
          <div className="workspace">{children}</div>
        </div>
      </body>
    </html>
  );
}
