"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { DesktopBridge } from "@/components/desktop";
import { TrustedBridge } from "@/components/TrustedBridge";
import { PhonePlan } from "@/components/PhonePlan";
import { CameraBridge, CameraOnSign } from "@/components/CameraBridge";
import { MicrophoneBridge, MicrophoneOnSign } from "@/components/MicrophoneBridge";
import { clearDemo, hasDemo, useData } from "@/lib/storage";

export function AppShell({ children }: { children: React.ReactNode }) {
  const data = useData();
  const pathname = usePathname();
  const onHelp = pathname?.startsWith("/help");
  const onSettings = pathname?.startsWith("/settings") || pathname?.startsWith("/demo");
  // The pitch films are for anyone with the link: a wider page, without Settings or the
  // made-up-data banner (the films show no data from this device).
  const onVideos = pathname?.startsWith("/demo/videos");
  // Made-up data is marked on every screen, for as long as any of it is stored.
  const demo = !!data && (hasDemo(data) || !!data.settings.simulatedChangeAt);

  // The mascot window shows only the character: no header, no page frame.
  if (pathname?.startsWith("/mascot")) return <>{children}</>;
  // The phone demo is a stage around the app, not a screen of it: the app is inside its frame.
  if (pathname?.startsWith("/demo/phone")) return <>{children}</>;

  return (
    <>
      <a href="#main" className="sr-only skip-link">
        Skip to content
      </a>
      {/* In the desktop app the header's empty parts drag the window (its title bar is glass) */}
      <header className="shell-header" data-tauri-drag-region="deep" data-wide={onVideos || undefined}>
        <div className="shell-header-inner">
          <Link href="/" className="brand">
            Cheer Pressure
          </Link>
          <CameraOnSign />
          <MicrophoneOnSign />
          {data?.profile && !onVideos && (
            <Link href="/settings/" className="settings-link" aria-current={onSettings ? "page" : undefined}>
              Settings
            </Link>
          )}
          <Link href="/help/" className="help-link" aria-current={onHelp ? "page" : undefined}>
            Need help now?
          </Link>
        </div>
        {demo && !onVideos && (
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
      <PhonePlan />
      <CameraBridge />
      <MicrophoneBridge />
      <main id="main" className="page" data-wide={onVideos || undefined}>
        {children}
      </main>
    </>
  );
}
