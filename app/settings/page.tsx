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
import { LinkCode } from "@/components/LinkCode";
import { isLocalOnly, messagesUrlOf, NOT_CONNECTED, quietHoursOf, ROUTINES, routinesOf, sourcesOf } from "@/lib/settings";
import { disconnect, invite, useTrusted } from "@/lib/trusted";
import { deleteEverything, saveSettings, useData } from "@/lib/storage";
import { stopSpeaking } from "@/lib/voice";
import { dailyQuestionOf, FREQUENCIES, questionTime, TIMES } from "@/lib/daily";
import type { AppData } from "@/lib/types";

type View = "list" | "measure" | "routines" | "voice" | "daily" | "trust" | "data" | "delete";
const VIEWS: View[] = ["measure", "routines", "voice", "daily", "trust", "data", "delete"];

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
  if (view === "daily") return <DailyQuestionSettings data={data} back={back} />;
  if (view === "trust") return <Trust data={data} back={back} />;
  if (view === "data") return <YourData data={data} back={back} onDelete={() => go("delete")} />;
  if (view === "delete") return <ConfirmDelete onKeep={() => go("data")} />;
  return <List data={data} go={go} />;
}

function trustedSummary(snap: ReturnType<typeof useTrusted>): string {
  if (!snap?.pairing) return "Not connected";
  if (snap.connection === "ended") return "The connection ended";
  return snap.trustedName ? `Connected with ${snap.trustedName}` : "Invite created, waiting for them";
}

function List({ data, go }: { data: AppData; go: (v: View) => void }) {
  const snap = useTrusted();
  const s = data.settings;
  const src = sourcesOf(s);
  const on = routinesOf(s);
  const q = quietHoursOf(s);
  const measuring = [src.typing && "Typing rhythm", src.dayRhythm && "day and night rhythm"].filter(Boolean).join(", ");
  const trusted = trustedSummary(snap);
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
    { key: "daily", label: "Daily question", value: dailySummary(s), onClick: () => go("daily") },
    { key: "trust", label: "Someone you trust", value: trusted, onClick: () => go("trust") },
    { key: "values", label: "My values", value: "Each source, and a report for your clinic", href: "/values/" },
    { key: "data", label: "Your data", value: "On this device unless you share a report", onClick: () => go("data") },
    { key: "help", label: "Need help now", value: "112 and your clinic", href: "/help/" },
    { key: "demo", label: "For the demo", value: "Made-up data, replay, live view", href: "/demo/", demo: true },
  ];
  return (
    <Screen
      lead={
        <>
          <h1 className="item-title">Settings</h1>
          <p className="muted">A few choices. Your measurements stay on this device unless you save or print a report for your clinic.</p>
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
      <nav aria-label="Settings" className="card menu settings-menu">
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
          label="Day and night rhythm"
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

function dailySummary(s: AppData["settings"]): string {
  const d = dailyQuestionOf(s);
  if (d.every === "off") return "Off";
  const often = FREQUENCIES.find((f) => f.value === d.every)!.label;
  return `${often}, around ${questionTime(s)}`;
}

/** How often and roughly when "How are you today?" comes up. One screen. */
function DailyQuestionSettings({ data, back }: { data: AppData; back: React.ReactNode }) {
  const d = dailyQuestionOf(data.settings);
  const set = (next: Partial<typeof d>) => saveSettings({ dailyQuestion: { ...d, ...next } });
  return (
    <Screen
      lead={
        <>
          <h1 className="item-title">Daily question</h1>
          <p className="muted">
            Cheri asks &quot;How are you today?&quot; with three answers. One tap, or Not now with no reminder that day.
            Never in quiet hours.
          </p>
        </>
      }
      actions={back}
    >
      <section className="card stack-sm daily-settings" aria-label="Daily question">
        <fieldset className="bare-fieldset">
          <legend className="switch-label">How often</legend>
          <div className="chips">
            {FREQUENCIES.map((f) => (
              <button key={f.value} type="button" className="chip" aria-pressed={d.every === f.value} onClick={() => set({ every: f.value })}>
                {f.label}
              </button>
            ))}
          </div>
        </fieldset>
        <fieldset className="bare-fieldset" disabled={d.every === "off"}>
          <legend className="switch-label">Roughly when</legend>
          <div className="chips">
            {TIMES.map((t) => (
              <button key={t.value} type="button" className="chip" aria-pressed={d.when === t.value} onClick={() => set({ when: t.value })}>
                {t.label}
              </button>
            ))}
          </div>
        </fieldset>
        <p className="small muted">
          {d.every === "off"
            ? "Off. Cheri asks nothing day to day."
            : `Around ${questionTime(data.settings)}. If the computer is off then, it comes once when you are next here that day.`}
        </p>
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
          <p className="muted">Cheri can read questions aloud with the voices built into this device.</p>
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

type TrustStep = "main" | "own-phone" | "confirm";

/**
 * Someone you trust: one step per screen. Not connected, then "Invite someone" creates the
 * pair and shows its link; it says "waiting for them to open it" until the trusted person has
 * given their first name, then "Connected with Sara". A quieter step shows the link for the
 * person's own phone. Disconnect asks once, then deletes the pair on the service and the
 * messages on this device.
 */
function Trust({ data, back }: { data: AppData; back: React.ReactNode }) {
  const snap = useTrusted();
  const [step, setStep] = useState<TrustStep>("main");
  const [busy, setBusy] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);
  const [unreachable, setUnreachable] = useState(false);
  const url = messagesUrlOf(data.settings);
  const pairing = snap?.pairing ?? null;
  const ended = snap?.connection === "ended";
  const name = snap?.trustedName ?? null;
  const them = name ?? "them";

  const startInvite = async () => {
    setBusy(true);
    setProblem(null);
    try {
      if (pairing) await disconnect({ evenOffline: true });
      await invite(url);
    } catch {
      setProblem(`I couldn't reach the messages service at ${url}. Check that it is running, or change the address under For the demo.`);
    } finally {
      setBusy(false);
    }
  };

  const end = async (evenOffline: boolean) => {
    setBusy(true);
    setProblem(null);
    try {
      await disconnect({ evenOffline });
      setUnreachable(false);
      setStep("main");
    } catch {
      setUnreachable(true);
      setProblem("I couldn't reach the messages service, so nothing was removed yet.");
    } finally {
      setBusy(false);
    }
  };

  if (step === "confirm" && pairing) {
    return (
      <Screen
        lead={
          <div role="alertdialog" aria-labelledby="disconnect-text" aria-describedby="disconnect-detail">
            <h1 id="disconnect-text" className="item-title">
              Disconnect from {name ?? "this invite"}?
            </h1>
            <p id="disconnect-detail" className="muted">
              This ends the link on the messages service and removes your messages with {them} from this device. Your
              measurements and answers stay.
            </p>
          </div>
        }
        actions={
          <>
            <button type="button" className="btn btn-primary btn-danger" autoFocus disabled={busy} onClick={() => end(false)}>
              {busy ? "One moment" : "Yes, disconnect"}
            </button>
            <div className="links">
              {unreachable && (
                <button type="button" className="btn btn-quiet" disabled={busy} onClick={() => end(true)}>
                  Remove it from this device anyway
                </button>
              )}
              <button type="button" className="btn btn-quiet" onClick={() => { setProblem(null); setUnreachable(false); setStep("main"); }}>
                Keep the connection
              </button>
            </div>
          </>
        }
      >
        {problem && (
          <p className="small problem-text" role="alert">
            {problem} {unreachable ? "The service deletes it by itself within two days." : ""}
          </p>
        )}
      </Screen>
    );
  }

  if (step === "own-phone" && pairing?.userUrl) {
    return (
      <Screen
        lead={
          <>
            <h1 className="item-title">Your own phone</h1>
            <p className="muted">
              If you like, scan this with your own phone to answer {them} from there too. Only for you: don&apos;t share it.
            </p>
          </>
        }
        actions={
          <div className="links">
            <button type="button" className="btn btn-quiet" onClick={() => setStep("main")}>
              Back
            </button>
          </div>
        }
      >
        <section className="card" aria-label="Link for your own phone">
          <LinkCode url={pairing.userUrl} label="Link for your own phone" />
        </section>
      </Screen>
    );
  }

  const localOnly = isLocalOnly(url);

  if (pairing && !ended && !name) {
    return (
      <Screen
        lead={
          <>
            <h1 className="item-title">Invite someone</h1>
            <p className="muted">Let them scan this with their phone&apos;s camera, or send them the link. It works for two days.</p>
          </>
        }
        actions={
          <>
            <div className="links">
              <button type="button" className="btn btn-quiet" onClick={() => setStep("own-phone")}>
                Your own phone
              </button>
              <button type="button" className="btn btn-quiet" onClick={() => setStep("confirm")}>
                Disconnect
              </button>
            </div>
            {back}
          </>
        }
      >
        <section className="card stack-sm" aria-label="Invite link">
          <p className="trust-status" role="status">
            <span className="source-dot waiting" aria-hidden="true" /> Invite created, waiting for them to open it
          </p>
          {pairing.inviteUrl && <LinkCode url={pairing.inviteUrl} label="Invite link for someone you trust" />}
          {localOnly && (
            <p className="small muted field-note">
              This link uses {new URL(url).host}, so it only opens on this computer. For a phone, set this computer&apos;s
              network address under For the demo first.
            </p>
          )}
        </section>
      </Screen>
    );
  }

  if (pairing && !ended && name) {
    return (
      <Screen
        lead={
          <>
            <h1 className="item-title">Someone you trust</h1>
            <p className="muted">
              {name} can send you a few words, and when you say yes I can ask them to get in touch. Only those short
              messages pass through the messages service, and it deletes them after two days.
            </p>
          </>
        }
        actions={
          <>
            <div className="links">
              <button type="button" className="btn btn-quiet" onClick={() => setStep("own-phone")}>
                Your own phone
              </button>
              <button type="button" className="btn btn-quiet" onClick={() => setStep("confirm")}>
                Disconnect
              </button>
            </div>
            {back}
          </>
        }
      >
        <section className="card stack-sm" aria-label="Someone you trust">
          <p className="trust-status" role="status">
            <span className="source-dot on" aria-hidden="true" /> Connected with {name}
          </p>
        </section>
      </Screen>
    );
  }

  return (
    <Screen
      lead={
        <>
          <h1 className="item-title">Someone you trust</h1>
          <p className="muted">
            Choose one person, a sister or a friend, who may send you a few words. I only ever ask them to get in touch
            when you say yes.
          </p>
        </>
      }
      actions={
        <>
          <button type="button" className="btn btn-primary" disabled={busy} onClick={startInvite}>
            {busy ? "One moment" : ended ? "Invite again" : "Invite someone"}
          </button>
          {back}
        </>
      }
    >
      <section className="card stack-sm" aria-label="Someone you trust">
        <p className="trust-status" role="status">
          <span className="source-dot" aria-hidden="true" />{" "}
          {ended ? "The connection ended. Links last two days." : "Not connected"}
        </p>
        <p className="small muted">
          They get a link to open on their phone. The messages service never receives your measurements, answers or reports.
        </p>
        {problem && (
          <p className="small problem-text" role="alert">
            {problem}
          </p>
        )}
      </section>
    </Screen>
  );
}

function YourData({ data, back, onDelete }: { data: AppData; back: React.ReactNode; onDelete: () => void }) {
  const counts = `${data.typingSessions.length} typing sessions, ${data.activityDays.length} days of activity times, ${data.checkIns.length} answers to Cheri and ${data.weekly.length} weekly answers`;
  return (
    <Screen
      lead={
        <>
          <h1 className="item-title">Your data</h1>
          <p className="muted">
            On this device, with no account and no login: {counts}. It stays here unless you choose to save or print a report for your clinic.
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
                or what you typed. Your answers to Cheri keep which answer you picked and which measures had
                changed. Weekly answers keep the numbers you picked.
              </p>
              {data.profile?.earlySigns.length ? <p>Your early signs: {data.profile.earlySigns.join(", ")}.</p> : null}
              <p>
                Messages with someone you trust are the one thing the app itself sends: they pass through the
                messages service, which deletes them after two days and never receives anything about your health.
                On this device only the newest few are kept, and Disconnect removes them.
              </p>
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
            Removes all your answers, measurements and settings from this device, ends the connection with someone you
            trust and removes your messages with them, and you start over with setup.
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
              // Ends the pair on the service too; if it cannot be reached, the messages are still
              // removed from this device (the service deletes them by itself within 48 hours).
              await disconnect({ evenOffline: true }).catch(() => {});
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
