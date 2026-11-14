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
import { CheriLook } from "@/components/CheriLook";
import { COLOURS, FURS, lookOf } from "@/lib/look";
import { useCamera } from "@/components/camera/useCamera";
import { useVoice } from "@/components/voice/useVoice";
import { isLocalOnly, messagesUrlOf, quietHoursOf, sourcesOf } from "@/lib/settings";
import { addOwn, CAME_BACK_WITHIN_DAYS, countLine, helpsOf, MAX_OWN_HELPS, statsFor } from "@/lib/helps";
import { newId } from "@/lib/dates";
import { saveHelps } from "@/lib/storage";
import { CrisisCard } from "@/components/CrisisCard";
import { OwnWords } from "@/components/OwnWords";
import { notConnectedInputs, SOURCES, type CategoryId } from "@/lib/passive";
import { addPerson, PERSON_STATE_WORDS, personName, personState, removeEveryone, removePerson, usePeople } from "@/lib/trusted";
import type { PersonView } from "@/lib/messages";
import { useCrisisCheck } from "@/components/hooks";
import { deleteEverything, saveSettings, useData } from "@/lib/storage";
import { stopSpeaking } from "@/lib/voice";
import { dailyQuestionOf, FREQUENCIES, questionTime, TIMES } from "@/lib/daily";
import type { AppData, HelpItem } from "@/lib/types";

type View = "list" | "measure" | "helps" | "voice" | "daily" | "look" | "trust" | "clinic" | "data" | "delete";
const VIEWS: View[] = ["measure", "helps", "voice", "daily", "look", "trust", "clinic", "data", "delete"];

function readHash(): View {
  const h = typeof window === "undefined" ? "" : window.location.hash.slice(1);
  // "#measure-energy" opens What I measure on that category (My values links to a switch).
  if (h.startsWith("measure-")) return "measure";
  if (h === "routines") return "helps"; // the earlier name
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
  if (view === "helps") return <Helps data={data} back={back} />;
  if (view === "voice") return <Voice data={data} back={back} />;
  if (view === "daily") return <DailyQuestionSettings data={data} back={back} />;
  if (view === "look") return <CheriLookSettings data={data} back={back} />;
  if (view === "trust") return <Trust data={data} back={back} />;
  if (view === "data") return <YourData data={data} back={back} onDelete={() => go("delete")} />;
  if (view === "delete") return <ConfirmDelete onKeep={() => go("data")} />;
  return <List data={data} go={go} />;
}

function trustedSummary(vs: PersonView[]): string {
  if (!vs.length) return "Nobody yet";
  const connected = vs.filter((v) => personState(v) === "connected" || personState(v) === "offline").length;
  const waiting = vs.filter((v) => personState(v) === "invited").length;
  const parts = [connected ? `${connected} connected` : "", waiting ? `${waiting} invited` : ""].filter(Boolean);
  return parts.length ? parts.join(", ") : "No one connected right now";
}

function List({ data, go }: { data: AppData; go: (v: View) => void }) {
  const everyone = usePeople();
  const s = data.settings;
  const src = sourcesOf(s);
  const helpsCount = helpsOf(data).filter((h) => h.on).length;
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
  const trusted = trustedSummary(everyone);
  const rows: { key: string; label: string; value: string; onClick?: () => void; href?: string; demo?: boolean }[] = [
    {
      key: "measure",
      label: "What I measure",
      value: s.pausedAll ? "Paused" : measuringText || "Nothing",
      onClick: () => go("measure"),
    },
    {
      key: "helps",
      label: "What helps me",
      value: helpsCount ? `${helpsCount} on your list` : "Nothing on your list yet",
      onClick: () => go("helps"),
    },
    { key: "voice", label: "Voice", value: s.muted ? "Off" : "On", onClick: () => go("voice") },
    { key: "daily", label: "Daily hello and quiet hours", value: dailySummary(s), onClick: () => go("daily") },
    { key: "look", label: "Cheri's look", value: lookSummary(s), onClick: () => go("look") },
    { key: "trust", label: "People you trust", value: trusted, onClick: () => go("trust") },
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
  const paired = usePeople().some((v) => !!v.snapshot.pairing && v.snapshot.connection !== "ended");
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

/** What helps me: the person's own list. Step one of the ladder suggests one of these, never one that is off. */
function Helps({ data, back }: { data: AppData; back: React.ReactNode }) {
  const list = helpsOf(data);
  const [crisis, setCrisis] = useState(false);
  const stats = statsFor(list, data.suggestions ?? []);
  const counted = list.map((h, i) => ({ h, line: countLine(stats[i]) })).filter((x) => x.line);
  const ownCount = list.filter((h) => h.own).length;
  const set = (next: HelpItem[]) => saveHelps(next);
  return (
    <Screen
      lead={
        <>
          <h1 className="item-title">What helps me</h1>
          <p className="muted">When things look different, I suggest one of these. Tap to switch one on or off.</p>
        </>
      }
      actions={
        <>
          {!crisis && (
            <Disclosure label="How I choose" title="How I choose">
              <p>
                I start with the things that were followed by better days. For each one I count how often you tried it, and
                how often your values came back within {CAME_BACK_WITHIN_DAYS} days after. Things you have not tried yet come
                before things that did not seem to help.
              </p>
              {counted.length ? (
                <ul className="worked-out">
                  {counted.map(({ h, line }) => (
                    <li key={h.id}>
                      <strong>{h.label}</strong>: {line}
                    </li>
                  ))}
                </ul>
              ) : (
                <p>Nothing tried yet, so I go by the order of your list.</p>
              )}
            </Disclosure>
          )}
          {back}
        </>
      }
    >
      {crisis ? (
        <CrisisCard />
      ) : (
        <>
          <div className="chips" role="group" aria-label="What helps me">
            {list.map((h) => (
              <span key={h.id} className="chip-pair">
                <button type="button" className="chip" aria-pressed={h.on} onClick={() => set(list.map((x) => (x.id === h.id ? { ...x, on: !x.on } : x)))}>
                  {h.label}
                </button>
                {h.own && (
                  <button type="button" className="chip chip-remove" aria-label={`Remove ${h.label}`} onClick={() => set(list.filter((x) => x.id !== h.id))}>
                    Remove
                  </button>
                )}
              </span>
            ))}
          </div>
          <OwnWords
            id="own-help-settings"
            label="Add your own"
            placeholder={ownCount >= MAX_OWN_HELPS ? "That's plenty for now" : "For example: baking bread"}
            disabled={ownCount >= MAX_OWN_HELPS}
            onAdd={(t) => set(addOwn(list, t, newId()))}
            onCrisis={() => setCrisis(true)}
          />
        </>
      )}
    </Screen>
  );
}

/** Quiet hours: Cheri never speaks up in between. Part of the daily hello's screen. */
function QuietHours({ data }: { data: AppData }) {
  const q = quietHoursOf(data.settings);
  return (
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
          <h1 className="item-title">Daily hello</h1>
          <p className="muted">
            &quot;How are you today?&quot; Talk, or one tap. {d.firstTwoWeeksDaily ? "Every day for the first two weeks, then as set here. " : ""}
            Never in quiet hours, never twice a day.
          </p>
        </>
      }
      actions={back}
    >
      <section className="card stack-sm daily-settings" aria-label="Daily hello">
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
            : `Around ${questionTime(data.settings)}. If I miss you then, it comes once when you are next here that day.`}
        </p>
        <QuietHours data={data} />
      </section>
    </Screen>
  );
}

function lookSummary(s: AppData["settings"]): string {
  const l = lookOf(s);
  return `${FURS.find((f) => f.value === l.fur)!.label}, ${COLOURS.find((c) => c.value === l.color)!.label.toLowerCase()}`;
}

/** Cheri's look: fur and colour, shown live at once and kept with the other settings. */
function CheriLookSettings({ data, back }: { data: AppData; back: React.ReactNode }) {
  return <CheriLook data={data} actions={back} />;
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

/**
 * People you trust: a list, each with one honest state, and Add. Each person is their own pair on
 * the messages service. Tapping one shows their invite link (until they open it), the link for
 * the person's own phone, and Remove, which asks once and then deletes only that pair.
 */
function Trust({ data, back }: { data: AppData; back: React.ReactNode }) {
  const everyone = usePeople();
  const [open, setOpen] = useState<string | null>(null);
  const [adding, setAdding] = useState(false);
  const url = messagesUrlOf(data.settings);
  const person = open ? everyone.find((v) => v.id === open) ?? null : null;
  if (adding) return <AddPerson url={url} onDone={(id) => { setAdding(false); setOpen(id); }} onCancel={() => setAdding(false)} />;
  if (person) return <Person v={person} url={url} onBack={() => setOpen(null)} />;
  const shown = everyone.slice(0, 4);
  return (
    <Screen
      lead={
        <>
          <h1 className="item-title">People you trust</h1>
          <p className="muted">
            When you say yes, I can ask one or more of them to talk or meet up. They answer from their own phone, no app
            needed. The messages service never receives your measurements, answers or reports.
          </p>
        </>
      }
      actions={
        <>
          <button type="button" className="btn btn-primary" disabled={everyone.length >= 6} onClick={() => setAdding(true)}>
            {everyone.length ? "Add someone else" : "Add someone"}
          </button>
          {back}
        </>
      }
    >
      {everyone.length ? (
        <nav className="card menu people-list" aria-label="People you trust">
          {shown.map((v) => {
            const st = personState(v);
            return (
              <button key={v.id} type="button" className="menu-row" onClick={() => setOpen(v.id)}>
                <span className="menu-label">
                  <span className={`source-dot ${st === "connected" ? "on" : st === "invited" || st === "offline" ? "waiting" : ""}`} aria-hidden="true" />{" "}
                  {personName(v)}
                </span>
                <span className="menu-value">{PERSON_STATE_WORDS[st]}</span>
              </button>
            );
          })}
          {everyone.length > shown.length && <p className="small muted switch-note">And {everyone.length - shown.length} more.</p>}
        </nav>
      ) : (
        <p className="card trust-status" role="status" style={{ margin: 0 }}>
          <span className="source-dot" aria-hidden="true" /> Nobody yet. A sister, a friend: anyone you would like to hear from.
        </p>
      )}
    </Screen>
  );
}

function AddPerson({ url, onDone, onCancel }: { url: string; onDone: (id: string) => void; onCancel: () => void }) {
  const [label, setLabel] = useState("");
  const [busy, setBusy] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);
  const [crisis, setCrisis] = useState(false);
  const crisisCheck = useCrisisCheck(() => setCrisis(true), () => label);
  const add = async () => {
    if (crisisCheck.full(label)) return;
    setBusy(true);
    setProblem(null);
    try {
      onDone(await addPerson(url, label));
    } catch {
      setProblem(`I couldn't reach the messages service at ${url}. Check that it is running, or change the address under For the demo.`);
    } finally {
      setBusy(false);
    }
  };
  return (
    <Screen
      lead={
        <>
          <h1 className="item-title">Add someone</h1>
          <p className="muted">They get a link to open on their phone. It works for two days.</p>
        </>
      }
      actions={
        <>
          {!crisis && (
            <button type="button" className="btn btn-primary" disabled={busy} onClick={add}>
              {busy ? "One moment" : "Make an invite link"}
            </button>
          )}
          <div className="links">
            <button type="button" className="btn btn-quiet" onClick={onCancel}>
              Back
            </button>
          </div>
        </>
      }
    >
      {crisis ? (
        <CrisisCard />
      ) : (
        <div className="field">
          <label htmlFor="person-label">Who is it for? (only on this device, optional)</label>
          <input
            id="person-label"
            type="text"
            maxLength={40}
            value={label}
            placeholder="For example: Anna"
            onChange={(e) => {
              setLabel(e.target.value);
              crisisCheck.typed(e.target.value);
            }}
            onBlur={(e) => crisisCheck.full(e.target.value)}
          />
        </div>
      )}
      {problem && (
        <p className="small problem-text" role="alert">
          {problem}
        </p>
      )}
    </Screen>
  );
}

type PersonStep = "main" | "own-phone" | "confirm";

function Person({ v, url, onBack }: { v: PersonView; url: string; onBack: () => void }) {
  const [step, setStep] = useState<PersonStep>("main");
  const [busy, setBusy] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);
  const [unreachable, setUnreachable] = useState(false);
  const st = personState(v);
  const name = personName(v);
  const pairing = v.snapshot.pairing;
  const backLink = (
    <button type="button" className="btn btn-quiet" onClick={onBack}>
      Back to people you trust
    </button>
  );

  const remove = async (evenOffline: boolean) => {
    setBusy(true);
    setProblem(null);
    try {
      await removePerson(v.id, { evenOffline });
      onBack();
    } catch {
      setUnreachable(true);
      setProblem("I couldn't reach the messages service, so nothing was removed yet.");
    } finally {
      setBusy(false);
    }
  };

  if (step === "confirm") {
    return (
      <Screen
        lead={
          <div role="alertdialog" aria-labelledby="remove-text" aria-describedby="remove-detail">
            <h1 id="remove-text" className="item-title">
              Remove {name}?
            </h1>
            <p id="remove-detail" className="muted">
              This ends the link on the messages service and removes your messages with {name} from this device. Everyone
              else stays, and so do your measurements and answers.
            </p>
          </div>
        }
        actions={
          <>
            <button type="button" className="btn btn-primary btn-danger" autoFocus disabled={busy} onClick={() => remove(false)}>
              {busy ? "One moment" : "Yes, remove"}
            </button>
            <div className="links">
              {unreachable && (
                <button type="button" className="btn btn-quiet" disabled={busy} onClick={() => remove(true)}>
                  Remove from this device anyway
                </button>
              )}
              <button type="button" className="btn btn-quiet" onClick={() => { setProblem(null); setUnreachable(false); setStep("main"); }}>
                Keep {name}
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
            <p className="muted">If you like, scan this with your own phone to answer {name} from there too. Only for you: don&apos;t share it.</p>
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
  return (
    <Screen
      lead={
        <>
          <h1 className="item-title">{name}</h1>
          <p className="trust-status" role="status">
            <span className={`source-dot ${st === "connected" ? "on" : st === "invited" || st === "offline" ? "waiting" : ""}`} aria-hidden="true" />{" "}
            {PERSON_STATE_WORDS[st]}
          </p>
        </>
      }
      actions={
        <>
          <div className="links">
            {pairing?.userUrl && st !== "ended" && (
              <button type="button" className="btn btn-quiet" onClick={() => setStep("own-phone")}>
                Your own phone
              </button>
            )}
            <button type="button" className="btn btn-quiet" onClick={() => setStep("confirm")}>
              Remove
            </button>
          </div>
          <div className="links">{backLink}</div>
        </>
      }
    >
      {st === "invited" && pairing?.inviteUrl ? (
        <section className="card stack-sm" aria-label="Invite link">
          <p className="small muted" style={{ margin: 0 }}>Let them scan this with their phone&apos;s camera, or send them the link.</p>
          <LinkCode url={pairing.inviteUrl} label={`Invite link for ${name}`} />
          {localOnly && (
            <p className="small muted field-note">
              This link uses {new URL(url).host}, so it only opens on this computer. For a phone, set this computer&apos;s
              network address under For the demo first.
            </p>
          )}
        </section>
      ) : (
        <p className="muted" style={{ margin: 0 }}>
          {st === "connected" || st === "offline"
            ? `${name} can send you a few words, and when you say yes I can ask them to talk or meet up. The messages service deletes messages after two days.`
            : st === "expired"
              ? "The invite was not opened within two days. Remove this one and add them again for a new link."
              : "This connection has ended. Remove it, and add them again if you like."}
        </p>
      )}
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
              await removeEveryone().catch(() => {});
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
