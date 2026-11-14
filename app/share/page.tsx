"use client";

import Link from "next/link";
import { useState } from "react";
import { Pager, Screen } from "@/components/Screen";
import { useReflection, useRequireProfile, useToday } from "@/components/hooks";
import { useData } from "@/lib/storage";
import { buildSummary } from "@/lib/summary";

export default function SharePage() {
  const data = useData();
  const ready = useRequireProfile(data);
  const today = useToday();
  const { levels, reflection } = useReflection(data);
  const [copied, setCopied] = useState<"idle" | "copied" | "failed">("idle");
  const [page, setPage] = useState(0);

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

  const pages = pagesOf(text);
  const shown = Math.min(page, pages.length - 1);

  return (
    <Screen
      lead={
        <>
          <h1 className="item-title">This is exactly what would be shared</h1>
          <p className="muted">
            Nothing is sent from here. Copy it or download it, then decide yourself whether to give it to your clinic.
            Your typed notes are not part of it.
          </p>
        </>
      }
      actions={
        <>
          {pages.length > 1 && <Pager index={shown} total={pages.length} onChange={setPage} secondary />}
          <button type="button" className="btn btn-primary" onClick={copy}>
            Copy the whole text
          </button>
          <div className="links">
            <button type="button" className="btn btn-quiet" onClick={download}>
              Download as a file
            </button>
            <Link href="/" className="btn btn-quiet">
              Back to home
            </Link>
          </div>
          <p className="small muted center" aria-live="polite">
            {copied === "copied"
              ? "Copied. Nothing has been sent."
              : copied === "failed"
                ? "Copying didn't work in this browser. You can download it as a file instead."
                : ""}
          </p>
        </>
      }
    >
      <div className="card">
        <pre className="summary">{pages[shown]}</pre>
      </div>
    </Screen>
  );
}

/** The summary in pieces that fit on a phone screen, split at blank lines and then by length. */
function pagesOf(text: string, budget = 420): string[] {
  const pages: string[] = [];
  for (const block of text.split(/\n\s*\n/)) {
    let cur: string[] = [];
    let size = 0;
    for (const line of block.split("\n")) {
      if (cur.length && size + line.length > budget) {
        pages.push(cur.join("\n"));
        cur = [];
        size = 0;
      }
      cur.push(line);
      size += line.length + 40; // a short line still takes a row
    }
    if (cur.length) pages.push(cur.join("\n"));
  }
  return pages.filter((p) => p.trim());
}
