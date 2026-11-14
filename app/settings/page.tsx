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
import { Companion } from "@/components/companion/Companion";
import { COLOURS, FURS, lookOf } from "@/lib/look";
import { useCamera } from "@/components/camera/useCamera";
import { useVoice } from "@/components/voice/useVoice";
import { isLocalOnly, messagesUrlOf, quietHoursOf, ROUTINES, routinesOf, sourcesOf } from "@/lib/settings";
import { notConnectedInputs, SOURCES, type CategoryId } from "@/lib/passive";
import { disconnect, invite, useTrusted } from "@/lib/trusted";
import { deleteEverything, saveSettings, useData } from "@/lib/storage";
import { stopSpeaking } from "@/lib/voice";
import { dailyQuestionOf, FREQUENCIES, questionTime, TIMES } from "@/lib/daily";
import type { AppData } from "@/lib/types";

type View = "list" | "measure" | "routines" | "voice" | "daily" | "look" | "trust" | "data" | "delete";
const VIEWS: View[] = ["measure", "routines", "voice", "daily", "look", "trust", "data", "delete"];

function readHash(): View {
  const h = typeof window === "undefined" ? "" : window.location.hash.slice(1);
  // "#measure-energy" opens What I measure on that category (My values links to a switch).
  if (h.startsWith("measure-")) return "measure";
  return (VIEWS as string[]).includes(h) ? (h as View) : "list";
}

/** The category in "#measure-energy", or null. */
function hashCategory(): CategoryId | null {
  const h = typeof window === "undefined" ? "" : window.location.hash.slice(1);
  const c = h.startsWith("measure-") ? h.slice("measure-".length) : "";
  return SOURCES.some((x) => x.id === c) ? (c as CategoryId) : null;
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
  if (view === "look") return <CheriLook data={data} back={back} />;
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
  // By category, in order: a category counts when at least one of its inputs is on.
  const dailyOn = dailyQuestionOf(s).every !== "off";
  const catOn: Record<CategoryId, boolean> = {
    sleep: src.dayRhythm,
    energy: src.camera || src.microphone || src.typing,
    social: src.contact,
    mood: dailyOn || src.camera || src.microphone,
  };
  const measuring = SOURCES.filter((c) => catOn[c.id]).map((c) => c.label);
  const measuringText = measuring.length === SOURCES.length ? "All four categories" : measuring.length ? measuring.join(", ") : "";
  const trusted = trustedSummary(snap);
  const rows: { key: string; label: string; value: string; onClick?: () => void; href?: string; demo?: boolean }[] = [
    {
      key: "measure",
      label: "What I measure",
      value: s.pausedAll ? "Paused" : measuringText || "Nothing",
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
    { key: "look", label: "Cheri's look", value: lookSummary(s), onClick: () => go("look") },
    { key: "trust", label: "Someone you trust", value: trusted, onClick: () => go("trust") },
    { key: "values", label: "My values", value: "Each category, and a report for your clinic", href: "/values/" },
    { key: "data", label: "Your data", value: "On this device unless you share a report", onClick: () => go("data") },
    { key: "help", label: "Need help now", value: "112 and your clinic", href: "/help/" },
    { key: "demo", label: "For the demo", value: "Replay, Live, made-up data", href: "/demo/", demo: true },
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

const MIC_PROBLEMS: Record<string, string> = {
  denied: "The microphone was not allowed. You can allow it in System Settings, Privacy & Security, Microphone.",
  "no-mic": "No microphone was found on this computer.",
  "in-use": "Another app is using the microphone right now.",
  unsupported: "This window cannot use the microphone.",
  failed: "The microphone did not start. Turn it off and on to try again.",
};

const CAMERA_PROBLEMS: Record<string, string> = {
  denied: "The camera was not allowed. You can allow it in System Settings, Privacy & Security, Camera.",
  "no-camera": "No camera was found on this computer.",
  "in-use": "Another app is using the camera right now.",
  unsupported: "This window cannot use the camera.",
  failed: "The camera did not start. Turn it off and on to try again.",
};

/** What I measure: the four categories; each opens its own screen with one switch per input. */
function Measure({ data, back }: { data: AppData; back: React.ReactNode }) {
  const src = sourcesOf(data.settings);
  const camera = useCamera();
  const cameraProblem = src.camera ? (CAMERA_PROBLEMS[camera.phase] ?? null) : null;
  const voice = useVoice();
  const micProblem = src.microphone ? (MIC_PROBLEMS[voice.phase] ?? null) : null;
  const paused = !!data.settings.pausedAll;
  const paired = !!useTrusted()?.pairing;
  const [category, setCategory] = useState<CategoryId | null>(null);
  useEffect(() => {
    const c = hashCategory();
    if (!c) return;
    const t = window.setTimeout(() => setCategory(c), 0);
    return () => window.clearTimeout(t);
  }, []);
  const set = (next: Partial<typeof src>) => saveSettings({ sources: { ...src, ...next } });
  const dailyOn = dailyQuestionOf(data.settings).every !== "off";

  if (category) {
    const cat = SOURCES.find((c) => c.id === category)!;
    const missing = notConnectedInputs(category);
    return (
      <Screen
        lead={
          <>
            <p className="small muted">What I measure</p>
            <h1 className="item-title">{cat.label}</h1>
          </>
        }
        actions={
          <div className="links">
            <button type="button" className="btn btn-quiet" onClick={() => setCategory(null)}>
              Back to What I measure
            </button>
          </div>
        }
      >
        <section className="card switches measure-switches" aria-label={cat.label}>
          {paused && <p className="small switch-note">Everything is paused. Nothing new is measured and I stay quiet.</p>}
          {category === "sleep" && (
            <SwitchRow
              label="Estimated from when this computer is used"
              hint="An estimate from your first and last key press each day. Connect a watch or phone for real sleep."
              keepHint
              on={src.dayRhythm}
              onChange={(v) => set({ dayRhythm: v })}
            />
          )}
          {category === "energy" && (
            <>
              <SwitchRow
                label="Camera"
                hint="Movement, face and posture, worked out on this computer. Nothing is stored or sent. Only while this window is open."
                keepHint
                on={src.camera}
                onChange={(v) => set({ camera: v })}
              />
              {cameraProblem && <p className="small switch-note problem-text">{cameraProblem}</p>}
              <SwitchRow
                label="Voice (microphone)"
                hint="Pace and tone, worked out on this computer. No words are recognised. Nothing is stored or sent. Only while this window is open."
                keepHint
                on={src.microphone}
                onChange={(v) => set({ microphone: v })}
              />
              {micProblem && <p className="small switch-note problem-text">{micProblem}</p>}
              <SwitchRow label="Typing rhythm" hint="The timing between key presses, never which keys" keepHint on={src.typing} onChange={(v) => set({ typing: v })} />
            </>
          )}
          {category === "social" && (
            <SwitchRow
              label="Messages with someone you trust"
              hint={paired ? "How many, never what they say" : "How many, never what they say. Invite someone under Someone you trust."}
              keepHint
              on={src.contact}
              onChange={(v) => set({ contact: v })}
            />
          )}
          {category === "mood" && (
            <>
              <SwitchRow
                label="Your daily answer"
                hint={'"How are you today?" Set how often under Daily question. It is how you say you feel.'}
                keepHint
                on={dailyOn}
                onChange={(v) => saveSettings({ dailyQuestion: { ...dailyQuestionOf(data.settings), every: v ? "day" : "off" } })}
              />
              <p className="small switch-note">
                Face movement and posture come with the camera ({src.camera ? "on" : "off"}), tone of voice with the
                microphone ({src.microphone ? "on" : "off"}), under Energy. They are observations only and never outweigh
                your own answer.
              </p>
            </>
          )}
          {missing.length > 0 && (
            <p className="small switch-note">Not connected yet: {missing.map((i) => i.label.toLowerCase()).join(", ")}.</p>
          )}
        </section>
      </Screen>
    );
  }

  const on = (c: CategoryId) => {
    const ids: string[] = [];
    if (c === "sleep" && src.dayRhythm) ids.push("estimated from this computer");
    if (c === "energy") {
      if (src.camera) ids.push("movement from the camera");
      if (src.microphone) ids.push("pace of the voice");
      if (src.typing) ids.push("typing");
    }
    if (c === "social" && src.contact) ids.push(paired ? "messages with someone you trust" : "needs someone you trust");
    if (c === "mood") {
      if (dailyOn) ids.push("your daily answer");
      if (src.camera) ids.push("face and posture");
      if (src.microphone) ids.push("tone");
    }
    return ids.length ? ids.join(", ").replace(/^./, (x) => x.toUpperCase()) : "Off";
  };

  return (
    <Screen
      lead={
        <>
          <h1 className="item-title">What I measure</h1>
          <p className="muted">In four categories. Never what you type, write or say, and never the picture. Off means I don&apos;t keep or use it.</p>
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
      <nav className="card menu category-menu" aria-label="Categories">
        {paused && <p className="small switch-note">Everything is paused. Nothing new is measured and I stay quiet.</p>}
        {SOURCES.map((c) => (
          <button key={c.id} type="button" className="menu-row" onClick={() => setCategory(c.id)}>
            <span className="menu-label">{c.label}</span>
            <span className="menu-value">{on(c.id)}</span>
          </button>
        ))}
      </nav>
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

function lookSummary(s: AppData["settings"]): string {
  const l = lookOf(s);
  return `${FURS.find((f) => f.value === l.fur)!.label}, ${COLOURS.find((c) => c.value === l.color)!.label.toLowerCase()}`;
}

/** Cheri's look: fur and colour, shown live at once and kept with the other settings. */
function CheriLook({ data, back }: { data: AppData; back: React.ReactNode }) {
  const look = lookOf(data.settings);
  const set = (next: Partial<typeof look>) => saveSettings({ look: { ...look, ...next } });
  return (
    <Screen
      lead={
        <div className="look-lead">
          <Companion state="joy" size={200} fur={look.fur} color={look.color} />
          <h1 className="item-title">Cheri&apos;s look</h1>
        </div>
      }
      actions={back}
    >
      <section className="card stack-sm look-card" aria-label="Cheri's look">
        <fieldset className="bare-fieldset">
          <legend className="switch-label">Fur</legend>
          <div className="chips">
            {FURS.map((f) => (
              <button key={f.value} type="button" className="chip" aria-pressed={look.fur === f.value} onClick={() => set({ fur: f.value })}>
                {f.label}
              </button>
            ))}
          </div>
          <p className="small muted look-note">The shaggy one uses more of the computer&apos;s graphics power. The small mascot window stays soft, since it runs all day.</p>
        </fieldset>
        <fieldset className="bare-fieldset">
          <legend className="switch-label">Colour</legend>
          <div className="swatches">
            {COLOURS.map((c) => (
              <button key={c.value} type="button" className="swatch" aria-pressed={look.color === c.value} onClick={() => set({ color: c.value })}>
                <span className="swatch-dot" style={{ background: c.swatch }} aria-hidden="true" />
                {c.label}
              </button>
            ))}
          </div>
        </fieldset>
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
  // By category, in order, as days.
  const days = (list: { date: string }[] | undefined) => new Set((list ?? []).map((x) => x.date)).size;
  const counts = [
    `Sleep, ${days(data.activityDays)} days of first and last activity`,
    `Energy, ${days(data.movementSessions)} days with the camera, ${days(data.toneSessions)} with the microphone and ${days((data.typingDays ?? []).filter((t) => t.kind === "all"))} with typing`,
    `Social, ${days(data.contactDays)} days of message counts`,
    `Mood, ${days((data.dailyAnswers ?? []).filter((a) => a.answer))} daily answers`,
  ].join("; ");
  const more = `${data.checkIns.length} answers to Cheri and ${data.weekly.length} weekly answers`;
  return (
    <Screen
      lead={
        <>
          <h1 className="item-title">Your data</h1>
          <p className="muted">
            On this device, with no account and no login: {counts}; {more}. It stays here unless you choose to save or print a report for your clinic.
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
                Sleep keeps the time of your first and last key press each day. Energy keeps numbers only: movement
                from the camera, pace of the voice from the microphone, and typing timing, never a picture, a sound,
                which keys or what you typed. Social keeps how many messages a day, never what they say. Mood keeps
                the answer you picked, and face, posture and tone only as numbers. Your answers to Cheri keep which
                answer you picked and which measures had changed. Weekly answers keep the numbers you picked.
              </p>
              {data.profile?.earlySigns.length ? <p>Your early signs: {data.profile.earlySigns.join(", ")}.</p> : null}
              <p>
                Messages with someone you trust are the one thing the app itself sends: they pass through the
                messages service, which deletes them after two days and never receives anything about your health.
                On this device only the newest few are kept, and Disconnect removes them.
              </p>
              {data.daily.length || data.reaction.length ? (
                <p>
                  From earlier versions of the app: {data.daily.length} older daily entries and {data.reaction.length}{" "}
                  older timing taps. They are kept until you delete everything.
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
