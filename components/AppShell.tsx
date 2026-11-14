"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { saveSettings, useData } from "@/lib/storage";
import { stopSpeaking } from "@/lib/voice";

export function AppShell({ children }: { children: React.ReactNode }) {
  const data = useData();
  const pathname = usePathname();
  const muted = data?.settings.muted ?? false;
  const onHelp = pathname?.startsWith("/help");

  return (
    <>
      <a href="#main" className="sr-only">
        Skip to content
      </a>
      <header className="shell-header">
        <div className="shell-header-inner">
          <Link href="/" className="brand">
            Companion
          </Link>
          {data && (
            <button
              type="button"
              className="icon-button"
              title={muted ? "The companion won't read aloud. Tap to turn its voice on." : "The companion reads aloud. Tap to mute."}
              onClick={() => {
                if (!muted) stopSpeaking();
                saveSettings({ muted: !muted });
              }}
            >
              <SpeakerIcon muted={muted} />
              {muted ? "Voice off" : "Voice on"}
            </button>
          )}
          <Link href="/help/" className="help-link" aria-current={onHelp ? "page" : undefined}>
            Need help now?
          </Link>
        </div>
      </header>
      <main id="main" className="page">
        {children}
      </main>
    </>
  );
}

function SpeakerIcon({ muted }: { muted: boolean }) {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" aria-hidden="true" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M4 9v6h4l5 4V5L8 9H4z" fill="currentColor" stroke="none" />
      {muted ? (
        <path d="M17 9l5 6M22 9l-5 6" />
      ) : (
        <path d="M16.5 8.5a5 5 0 0 1 0 7M19 6a8.5 8.5 0 0 1 0 12" />
      )}
    </svg>
  );
}
