"use client";

// Settings: the few things the person can choose. One list, and each choice opens
// on its own screen (the address keeps it, e.g. /settings/#routines, so Back works).
// Everything for the jury sits in one marked place: "For the demo".

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { useRequireProfile, useVoiceAvailability } from "@/components/hooks";
import { Disclosure, Screen } from "@/components/Screen";
import { SwitchRow } from "@/components/Switch";
import { forgetDesktopData, setTypingPaused } from "@/lib/platform";
import { NOT_CONNECTED, quietHoursOf, ROUTINES, routinesOf, sourcesOf } from "@/lib/settings";
import { deleteEverything, saveSettings, useData } from "@/lib/storage";
import { stopSpeaking } from "@/lib/voice";
import type { AppData } from "@/lib/types";

type View = "list" | "measure" | "routines" | "voice" | "trust" | "data" | "delete";
const VIEWS: View[] = ["measure", "routines", "voice", "trust", "data", "delete"];

function readHash(): View {
  const h = typeof window === "undefined" ? "" : window.location.hash.slice(1);
  return (VIEWS as string[]).includes(h) ? (h as View) : "list";
}

/** The view lives in the address, so Back and reload keep it. */
function useView(): [View, (v: View) => void] {
  const [view, setView] = useState<View>("list");
  useEffect(() => {
    const sync = () => setView(readHash());
    sync();
    window.addEventListener("hashchange", sync);
    return () => window.removeEventListener("hashchange", sync);
  }, []);
  const go = (v: View) => {
    if (v === "list") history.pushState(null, "", window.location.pathname);
    else history.pushState(null, "", `#${v}`);
    setView(v);
  };
  return [view, go];
}

export default function SettingsPage() {
  const data = useData();
  const ready = useRequireProfile(data);
  const [view, go] = useView();
  if (!data || !ready) return null;
  const back = (
    <div className="links">
      <button type="button" className="btn btn-quiet" onClick={() => go("list")}>
        Back to settings
      </button>
    </div>
  );
  if (view === "measure") return <Measure data={data} back={back} />;
  if (view === "routines") return <Routines data={data} back={back} />;
  if (view === "voice") return <Voice data={data} back={back} />;
  if (view === "trust") return <Trust back={back} />;
  if (view === "data") return <YourData data={data} back={back} onDelete={() => go("delete")} />;
  if (view === "delete") return <ConfirmDelete onKeep={() => go("data")} />;
  return <List data={data} go={go} />;
}

function List({ data, go }: { data: AppData; go: (v: View) => void }) {
  const s = data.settings;
  const src = sourcesOf(s);
  const on = routinesOf(s);
  const q = quietHoursOf(s);
  const measuring = [src.typing && "Typing rhythm", src.dayRhythm && "day rhythm"].filter(Boolean).join(", ");
  const rows: { key: string; label: string; value: string; onClick?: () => void; href?: string; demo?: boolean }[] = [
    {
      key: "measure",
      label: "What I measure",
      value: s.pausedAll ? "Paused" : measuring ? measuring.replace(/^./, (c) => c.toUpperCase()) : "Nothing",
      onClick: () => go("measure"),
    },
    {
      key: "routines",
      label: "Small things and quiet hours",
      value: `${ROUTINES.filter((r) => on[r.id]).length} of ${ROUTINES.length} on, quiet ${q.from} to ${q.to}`,
      onClick: () => go("routines"),
    },
    { key: "voice", label: "Voice", value: s.muted ? "Off" : "On", onClick: () => go("voice") },
    { key: "trust", label: "Someone you trust", value: "Not connected yet", onClick: () => go("trust") },
    { key: "data", label: "Your data", value: "Only on this device", onClick: () => go("data") },
    { key: "help", label: "Need help now", value: "112 and your clinic", href: "/help/" },
    { key: "demo", label: "For the demo", value: "Made-up data, replay, live view", href: "/demo/", demo: true },
  ];
  return (
    <Screen
      lead={
        <>
          <h1 className="item-title">Settings</h1>
          <p className="muted">A few choices. Everything stays on this device.</p>
        </>
      }
      actions={
        <div className="links">
          <Link href="/" className="btn btn-quiet">
            Back to home
          </Link>
        </div>
      }
    >
      <nav aria-label="Settings" className="card menu">
        {rows.map((r) => {
          const inner = (
            <>
              <span className="menu-label">
                {r.label}
                {r.demo && <span className="placeholder-tag menu-tag">Demo</span>}
              </span>
              <span className="menu-value">{r.value}</span>
            </>
          );
          return r.href ? (
            <Link key={r.key} href={r.href} className="menu-row">
              {inner}
            </Link>
          ) : (
            <button key={r.key} type="button" className="menu-row" onClick={r.onClick}>
              {inner}
            </button>
          );
        })}
      </nav>
    </Screen>
  );
}

function Measure({ data, back }: { data: AppData; back: React.ReactNode }) {
  const src = sourcesOf(data.settings);
  const paused = !!data.settings.pausedAll;
  const set = (next: Partial<typeof src>) => saveSettings({ sources: { ...src, ...next } });
  return (
    <Screen
      lead={
        <>
          <h1 className="item-title">What I measure</h1>
          <p className="muted">Only timing and times of day, never what you type. Off means I don&apos;t keep or use it.</p>
        </>
      }
      actions={
        <>
          <button
            type="button"
            className="btn btn-primary"
            onClick={() => {
              saveSettings({ pausedAll: !paused });
              void setTypingPaused(!paused);
            }}
          >
            {paused ? "Resume measuring" : "Pause everything"}
          </button>
          {back}
        </>
      }
    >
      <section className="card switches" aria-label="Sources">
        {paused && <p className="small switch-note">Everything is paused. Nothing new is measured and I stay quiet.</p>}
        <SwitchRow
          label="Typing rhythm"
          hint="The timing between key presses"
          on={src.typing}
          onChange={(v) => set({ typing: v })}
        />
        <SwitchRow
          label="Day rhythm"
          hint="Your first and last key press each day"
          on={src.dayRhythm}
          onChange={(v) => set({ dayRhythm: v })}
        />
        {NOT_CONNECTED.map((n) => (
          <SwitchRow key={n} label={n} on={false} disabledText="Not connected yet" />
        ))}
      </section>
    </Screen>
  );
}

function Routines({ data, back }: { data: AppData; back: React.ReactNode }) {
  const on = routinesOf(data.settings);
  const q = quietHoursOf(data.settings);
  return (
    <Screen
      lead={
        <>
          <h1 className="item-title">Small things I may suggest</h1>
          <p className="muted">Only ever one, and only after you tell me it isn&apos;t your best.</p>
        </>
      }
      actions={back}
    >
      <section className="card switches" aria-label="Small things and quiet hours">
        {ROUTINES.map((r) => (
          <SwitchRow
            key={r.id}
            label={r.label}
            on={on[r.id]}
            onChange={(v) => saveSettings({ routines: { ...on, [r.id]: v } })}
          />
        ))}
        <div className="quiet-hours">
          <span className="switch-text">
            <span className="switch-label" id="quiet-label">
              Quiet hours
            </span>
            <span className="switch-hint">I never speak up in between</span>
          </span>
          <span className="quiet-times" role="group" aria-labelledby="quiet-label">
            <input
              type="time"
              aria-label="Quiet from"
              value={q.from}
              onChange={(e) => e.target.value && saveSettings({ quietHours: { ...q, from: e.target.value } })}
            />
            <span aria-hidden="true">to</span>
            <input
              type="time"
              aria-label="Quiet until"
              value={q.to}
              onChange={(e) => e.target.value && saveSettings({ quietHours: { ...q, to: e.target.value } })}
            />
          </span>
        </div>
      </section>
    </Screen>
  );
}

function Voice({ data, back }: { data: AppData; back: React.ReactNode }) {
  const voice = useVoiceAvailability();
  const muted = data.settings.muted;
  return (
    <Screen
      lead={
        <>
          <h1 className="item-title">Voice</h1>
          <p className="muted">The companion can read its questions aloud with the voices built into this device.</p>
        </>
      }
      actions={back}
    >
      <section className="card switches" aria-label="Voice">
        {voice === "no" ? (
          <SwitchRow label="Read aloud" on={false} disabledText="Not available on this device, so I show my text" />
        ) : (
          <SwitchRow
            label="Read aloud"
            hint="The text is not sent anywhere"
            on={!muted}
            onChange={(v) => {
              if (!v) stopSpeaking();
              saveSettings({ muted: !v });
            }}
          />
        )}
        <SwitchRow label="Answer by voice" on={false} disabledText="Off. You always tap. No sound leaves this device" />
      </section>
    </Screen>
  );
}

function Trust({ back }: { back: React.ReactNode }) {
  return (
    <Screen
      lead={
        <>
          <h1 className="item-title">Someone you trust</h1>
          <p className="muted">
            Later, you can choose one person I may ask to check in on you. I would only ever ask when you say yes.
          </p>
        </>
      }
      actions={back}
    >
      <section className="card stack-sm" aria-label="Someone you trust">
        <p className="trust-status">
          <span className="source-dot" aria-hidden="true" /> Not connected yet
        </p>
        <button type="button" className="btn btn-secondary" disabled>
          Invite someone
        </button>
      </section>
    </Screen>
  );
}

function YourData({ data, back, onDelete }: { data: AppData; back: React.ReactNode; onDelete: () => void }) {
  const counts = `${data.typingSessions.length} typing sessions, ${data.activityDays.length} days of activity times, ${data.checkIns.length} answers to the companion and ${data.weekly.length} weekly answers`;
  return (
    <Screen
      lead={
        <>
          <h1 className="item-title">Your data</h1>
          <p className="muted">
            Only on this device, with no account and no login. Nothing is sent anywhere. Right now that is {counts}.
          </p>
        </>
      }
      actions={
        <>
          <button type="button" className="btn btn-secondary" onClick={onDelete}>
            Delete everything
          </button>
          <div className="links">
            <Disclosure label="What is stored, in detail" title="What is stored, in detail">
              <p>
                Typing sessions and first and last activity are timing numbers and times of day only, never which keys
                or what you typed. Your answers to the companion keep which answer you picked and which measures had
                changed. Weekly answers keep the numbers you picked.
              </p>
              {data.profile?.earlySigns.length ? <p>Your early signs: {data.profile.earlySigns.join(", ")}.</p> : null}
              {data.daily.length || data.reaction.length ? (
                <p>
                  From earlier versions of the app: {data.daily.length} daily check-ins and {data.reaction.length}{" "}
                  reaction tests. They are kept until you delete everything.
                </p>
              ) : null}
            </Disclosure>
          </div>
          {back}
        </>
      }
    />
  );
}

function ConfirmDelete({ onKeep }: { onKeep: () => void }) {
  const router = useRouter();
  return (
    <Screen
      lead={
        <div role="alertdialog" aria-labelledby="confirm-text" aria-describedby="confirm-detail">
          <h1 id="confirm-text" className="item-title">
            Delete everything? This can&apos;t be undone.
          </h1>
          <p id="confirm-detail" className="muted">
            Removes all your answers, measurements and settings from this device, and you start over with setup.
          </p>
        </div>
      }
      actions={
        <>
          <button
            type="button"
            className="btn btn-primary btn-danger"
            autoFocus
            onClick={async () => {
              stopSpeaking();
              await forgetDesktopData();
              deleteEverything();
              router.replace("/setup/");
            }}
          >
            Yes, delete everything
          </button>
          <div className="links">
            <button type="button" className="btn btn-quiet" onClick={onKeep}>
              Keep my data
            </button>
          </div>
        </>
      }
    />
  );
}
