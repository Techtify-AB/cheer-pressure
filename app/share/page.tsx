"use client";

import { useState } from "react";
import { useReflection, useRequireProfile, useToday } from "@/components/hooks";
import { useData } from "@/lib/storage";
import { buildSummary } from "@/lib/summary";

export default function SharePage() {
  const data = useData();
  const ready = useRequireProfile(data);
  const today = useToday();
  const { levels, reflection } = useReflection(data);
  const [copied, setCopied] = useState<"idle" | "copied" | "failed">("idle");

  if (!data || !ready || !levels) return null;

  const text = buildSummary(data, levels, reflection?.say ?? "Nothing yet.");

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(text);
      setCopied("copied");
    } catch {
      setCopied("failed");
    }
  };

  const download = () => {
    const blob = new Blob([text], { type: "text/plain;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `companion-summary-${today}.txt`;
    document.body.appendChild(a);
    a.click();
    a.remove();
    window.setTimeout(() => URL.revokeObjectURL(url), 1000);
  };

  return (
    <div className="stack-lg">
      <div>
        <h1>Share with my clinic</h1>
        <p className="muted" style={{ marginBottom: 0 }}>
          This is exactly what would be shared. Nothing is sent from here: you can copy it or download it, and then
          decide yourself whether to give it to your clinic.
        </p>
      </div>

      <div className="card">
        <pre className="summary">{text}</pre>
      </div>

      <div className="btn-row">
        <button type="button" className="btn btn-secondary" onClick={copy}>
          Copy text
        </button>
        <button type="button" className="btn btn-secondary" onClick={download}>
          Download as a file
        </button>
      </div>
      <p className="small muted" aria-live="polite" style={{ marginBottom: 0 }}>
        {copied === "copied"
          ? "Copied. Nothing has been sent."
          : copied === "failed"
            ? "Copying didn't work in this browser. You can select the text above or download it instead."
            : "Your typed notes are not part of the summary."}
      </p>
    </div>
  );
}
