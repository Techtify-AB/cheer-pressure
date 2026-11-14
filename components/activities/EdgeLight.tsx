"use client";

// A soft, warm glow around the edge of the screen. It fades in slowly when switched on and out
// when switched off; with reduced motion it is simply a fixed colour, on or off. It lives on
// top of the page (never catching taps), and is removed with the view, so the screen is always
// back to normal when the person leaves.

import { createPortal } from "react-dom";

// Only rendered after the stored data has loaded (never during hydration), so the portal can
// go straight to the body.
export function EdgeLight({ on, fadeMs = 6000 }: { on: boolean; fadeMs?: number }) {
  if (typeof document === "undefined") return null;
  return createPortal(
    <div
      className="act-edge-light"
      data-on={on ? "" : undefined}
      aria-hidden="true"
      style={{ "--act-light-fade": `${fadeMs}ms` } as React.CSSProperties}
    />,
    document.body,
  );
}
