"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { DesktopBridge } from "@/components/desktop";
import { TrustedBridge } from "@/components/TrustedBridge";
import { CameraBridge, CameraOnSign } from "@/components/CameraBridge";
import { clearDemo, hasDemo, useData } from "@/lib/storage";

export function AppShell({ children }: { children: React.ReactNode }) {
  const data = useData();
  const pathname = usePathname();
  const onHelp = pathname?.startsWith("/help");
  const onSettings = pathname?.startsWith("/settings") || pathname?.startsWith("/demo");
  // Made-up data is marked on every screen, for as long as any of it is stored.
  const demo = !!data && (hasDemo(data) || !!data.settings.simulatedChangeAt);

  // The mascot window shows only the character: no header, no page frame.
  if (pathname?.startsWith("/mascot")) return <>{children}</>;

  return (
    <>
      <a href="#main" className="sr-only skip-link">
        Skip to content
      </a>
      <header className="shell-header">
        <div className="shell-header-inner">
          <Link href="/" className="brand">
            Cheer Pressure
          </Link>
          <CameraOnSign />
          {data?.profile && (
            <Link href="/settings/" className="settings-link" aria-current={onSettings ? "page" : undefined}>
              Settings
            </Link>
          )}
          <Link href="/help/" className="help-link" aria-current={onHelp ? "page" : undefined}>
            Need help now?
          </Link>
        </div>
        {demo && (
          <div className="demo-banner" role="note">
            <span className="placeholder-tag">Demo</span>
            <span>You are looking at made-up demo data.</span>
            <button type="button" className="demo-banner-clear" onClick={clearDemo}>
              Clear it
            </button>
          </div>
        )}
      </header>
      <DesktopBridge />
      <TrustedBridge />
      <CameraBridge />
      <main id="main" className="page">
        {children}
      </main>
    </>
  );
}
