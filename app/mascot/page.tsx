"use client";

// The mascot window in the desktop app: only the character, on a transparent page.
// Drag it to move the window; click it to open the main window. When the companion
// would like to ask how the person is doing (lib/passive.ts), it shows a gentle
// visual cue: a soft glow and a small speech bubble. No sound, no badge count.
// Clicking then opens the proposed check-in. In a browser the click navigates here.

import { useRouter } from "next/navigation";
import { useEffect, useRef } from "react";
import { Companion } from "@/components/companion/Companion";
import { useDesktopTyping } from "@/components/desktop";
import { usePassive } from "@/components/hooks";
import { useData } from "@/lib/storage";
import { openMainWindow, pageReady, startWindowDrag } from "@/lib/platform";

const DRAG_START_PX = 4;

export default function MascotPage() {
  const router = useRouter();
  const { desktop, status, live } = useDesktopTyping();
  const press = useRef<{ x: number; y: number; dragging: boolean } | null>(null);
  // Same storage as the main window, so this updates when new data arrives there.
  const data = useData();
  const passive = usePassive(data?.profile ? data : null);
  const cue = !!passive?.askNow;

  useEffect(() => {
    if (desktop) pageReady(window.location.pathname);
  }, [desktop]);

  const open = () => {
    const path = cue ? "/prompt/" : undefined;
    if (desktop) void openMainWindow(path);
    else router.push(path ?? "/");
  };

  // It listens while someone types, if measuring is on.
  const state = live?.typing && status && !status.paused ? "listening" : "idle";

  return (
    <div className="mascot-page" data-cue={cue || undefined}>
      <button
        type="button"
        className="mascot-button"
        aria-label={cue ? "Cheer Pressure would like to ask how you're doing" : "Open Cheer Pressure"}
        title={cue ? "Something looks different from your usual. Click to have a look." : "Open Cheer Pressure. Drag to move."}
        onPointerDown={(e) => {
          if (e.button !== 0) return;
          press.current = { x: e.clientX, y: e.clientY, dragging: false };
        }}
        onPointerMove={(e) => {
          const p = press.current;
          if (!p || p.dragging || !desktop) return;
          if (Math.hypot(e.clientX - p.x, e.clientY - p.y) >= DRAG_START_PX) {
            p.dragging = true;
            void startWindowDrag();
          }
        }}
        onPointerUp={() => {
          const p = press.current;
          press.current = null;
          if (p && !p.dragging) open();
        }}
        onKeyDown={(e) => {
          if (e.key === "Enter" || e.key === " ") {
            e.preventDefault();
            open();
          }
        }}
      >
        {cue && (
          <span className="mascot-bubble" aria-hidden="true">
            <span />
            <span />
            <span />
          </span>
        )}
        <Companion state={state} size={140} />
      </button>
    </div>
  );
}
