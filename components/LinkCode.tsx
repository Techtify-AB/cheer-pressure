"use client";

// A link as a QR code to scan with a phone's camera, and as text with a Copy button. The QR
// code is drawn on this device by the bundled `qrcode` package: the link is never sent to any
// other service to make the picture.

import { useEffect, useState } from "react";

export function LinkCode({ url, label }: { url: string; label: string }) {
  const [src, setSrc] = useState<string | null>(null);
  const [copied, setCopied] = useState<"no" | "yes" | "failed">("no");

  useEffect(() => {
    let alive = true;
    import("qrcode")
      .then((q) => q.toDataURL(url, { margin: 1, width: 360, errorCorrectionLevel: "M", color: { dark: "#24302c", light: "#ffffff" } }))
      .then((d) => {
        if (alive) setSrc(d);
      })
      .catch(() => {
        if (alive) setSrc(null);
      });
    return () => {
      alive = false;
    };
  }, [url]);

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(url);
      setCopied("yes");
    } catch {
      setCopied("failed");
    }
  };

  return (
    <div className="link-code">
      <div className="qr" aria-hidden={!src}>
        {/* A data: URL made on this device; next/image would add nothing here. */}
        {/* eslint-disable-next-line @next/next/no-img-element */}
        {src ? <img src={src} alt={`QR code: ${label}`} width={168} height={168} /> : <span className="qr-wait" />}
      </div>
      <div className="link-row">
        <input
          type="text"
          readOnly
          aria-label={label}
          value={url}
          onFocus={(e) => e.currentTarget.select()}
          className="link-text"
        />
        <button type="button" className="btn btn-secondary" onClick={copy}>
          {copied === "yes" ? "Copied" : "Copy link"}
        </button>
      </div>
      {copied === "failed" && <p className="small muted field-note">Copying did not work here. Select the link and copy it.</p>}
    </div>
  );
}
