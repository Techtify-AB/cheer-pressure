"use client";

// The mascot window in the desktop app: only the character, on a transparent page.
// Drag it to move the window; click it to open the main window. In a browser the
// click goes to the home page instead.

import { useRouter } from "next/navigation";
import { useEffect, useRef } from "react";
import { Companion } from "@/components/companion/Companion";
import { useDesktopTyping } from "@/components/desktop";
import { openMainWindow, pageReady, startWindowDrag } from "@/lib/platform";

const DRAG_START_PX = 4;

export default function MascotPage() {
  const router = useRouter();
  const { desktop, status, live } = useDesktopTyping();
  const press = useRef<{ x: number; y: number; dragging: boolean } | null>(null);

  useEffect(() => {
    if (desktop) pageReady(window.location.pathname);
  }, [desktop]);

  const open = () => {
    if (desktop) void openMainWindow();
    else router.push("/");
  };

  // It listens while someone types, if measuring is on.
  const state = live?.typing && status && !status.paused ? "listening" : "idle";

  return (
    <div className="mascot-page">
      <button
        type="button"
        className="mascot-button"
        aria-label="Open Cheer Pressure"
        title="Open Cheer Pressure. Drag to move."
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
        <Companion state={state} size={140} />
      </button>
    </div>
  );
}
