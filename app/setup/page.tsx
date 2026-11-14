"use client";

// Onboarding: one question per screen (docs/MOBILE_SPEC.md). Where Cheri learns what to suggest
// and what to watch for.
//
//   1 Hello            what Cheri is, and what stays on this device
//   2 What helps you?  the person's own list: step one of the ladder suggests from it
//   3 What did you notice first last time?  up to three early signs
//   4 Who do you trust?  invite one now, or later in Settings
//   5 Your clinic      Always / Only when I say / Never, and the automatic step after 7 days
//   6 What may I look at?  one permission per screen, each skippable
//   7 A daily hello?   when, and how often after the first two weeks
//   8 Cheri's look     fur and colour
//
// Every step but the first can be skipped, and Back goes one step back. The step is in the
// address (#helps, #look-at-2), so reload and the browser's Back keep it. Each answer is stored
// when the person moves on; the profile, which sends Home here until it exists, is stored at the
// end. People who set up before this onboarding are never sent through it again: Home offers
// them the new questions once, quietly, and this page then shows only those (steps 2, 4 to 7).
// Every free-text field shows the fixed help card on crisis words.

import { useRouter } from "next/navigation";
import { useCallback, useEffect, useState } from "react";
import { CheriLook } from "@/components/CheriLook";
import { CrisisCard } from "@/components/CrisisCard";
import { LinkCode } from "@/components/LinkCode";
import { OwnWords } from "@/components/OwnWords";
import { Says, Screen, StepCount } from "@/components/Screen";
import { SwitchRow } from "@/components/Switch";
import { useCompanionVoice, useCrisisCheck } from "@/components/hooks";
import { containsCrisisWords } from "@/lib/crisis";
import { dailyQuestionOf, TIMES } from "@/lib/daily";
import { newId } from "@/lib/dates";
import { addOwn, helpsOf, MAX_OWN_HELPS, STARTING_HELPS } from "@/lib/helps";
import { askPhonePermission, isPhoneApp } from "@/lib/phoneBridge";
import { isDesktop } from "@/lib/platform";
import { CLINIC_CHOICES, clinicOf, messagesUrlOf } from "@/lib/settings";
import { readData, saveHelps, saveOnboarding, savePermission, saveProfile, saveSettings, useData } from "@/lib/storage";
import { addPerson, personName, usePeople } from "@/lib/trusted";
import type { AppData, DailyQuestionSettings, HelpItem, PermissionKind, PermissionState } from "@/lib/types";

const MAX_SIGNS = 3;
const ONBOARDING_VERSION = 2;

const COMMON_SIGNS = [
  "Going to bed later",
  "Waking up too early",
  "Pulling away from people",
  "Losing interest in things",
  "Feeling tired all the time",
  "Finding it hard to focus",
  "Eating more or less",
  "Feeling tense",
];

const INTRO =
  "Hi, I'm Cheri. I'm a tool, not a therapist: a small companion for the time after treatment that helps you notice changes compared with your own usual days.";
const SIGNS_QUESTION = "What did you notice first last time?";

type StepId = "hello" | "helps" | "signs" | "trust" | "clinic" | "look-at" | "daily" | "look";
const FIRST_RUN: StepId[] = ["hello", "helps", "signs", "trust", "clinic", "look-at", "daily", "look"];
const NEW_QUESTIONS: StepId[] = ["helps", "trust", "clinic", "look-at", "daily"];

const PERMISSIONS: { kind: PermissionKind; title: string; line: string }[] = [
  { kind: "health", title: "Sleep and steps", line: "From your watch, a sleep app or the phone's own health data. It stays on the phone." },
  { kind: "location", title: "At home or out", line: "Only whether you are at home or out, never where. It stays on the phone." },
  { kind: "notifications", title: "Notifications", line: "So I can say hello, or tell you when someone you trust writes. Never in quiet hours." },
  { kind: "camera-microphone", title: "Camera and microphone", line: "Only during the daily hello, and only after you tap. Nothing is recorded or sent." },
];

/** What a permission means where the phone app is not: the browser or desktop equivalent, or not available. */
function notHere(kind: PermissionKind, desktop: boolean): string | null {
  if (kind === "health") return desktop ? "Not available here. On this computer I estimate sleep from when it is used." : "Not available here. The phone app reads sleep and steps.";
  if (kind === "location") return "Not available here. The phone app can tell at home from out.";
  if (kind === "notifications") return desktop ? "Not needed here. On this computer I use a small bubble instead." : "Not needed here. I ask on Home instead.";
  return null; // camera and microphone: the browser asks the first time you hold to talk
}

const SIGNS_DRAFT = "cheerpressure.setup.signs";

function readDraft(): string[] {
  try {
    const v = JSON.parse(window.sessionStorage.getItem(SIGNS_DRAFT) ?? "[]");
    return Array.isArray(v) ? v.filter((x) => typeof x === "string").slice(0, MAX_SIGNS) : [];
  } catch {
    return [];
  }
}

function writeDraft(signs: string[]) {
  try {
    window.sessionStorage.setItem(SIGNS_DRAFT, JSON.stringify(signs));
  } catch {
    // a lost draft only means picking again
  }
}

/** The step lives in the address: "#helps", "#look-at-2". */
function readHash(steps: StepId[]): { index: number; sub: number } {
  const h = typeof window === "undefined" ? "" : window.location.hash.slice(1);
  const m = /^look-at-(\d)$/.exec(h);
  const id = (m ? "look-at" : h) as StepId;
  const index = Math.max(0, steps.indexOf(id));
  return { index, sub: m ? Math.min(PERMISSIONS.length - 1, Math.max(0, Number(m[1]) - 1)) : 0 };
}

export default function SetupPage() {
  const data = useData();
  const router = useRouter();
  const mode = !data ? null : !data.profile ? "first" : (data.onboarding?.version ?? 0) >= ONBOARDING_VERSION ? "done" : "new";

  useEffect(() => {
    if (mode === "done") router.replace("/");
  }, [mode, router]);

  if (!data || !mode || mode === "done") return null;
  return <Onboarding data={data} steps={mode === "first" ? FIRST_RUN : NEW_QUESTIONS} first={mode === "first"} />;
}

function Onboarding({ data, steps, first }: { data: AppData; steps: StepId[]; first: boolean }) {
  const router = useRouter();
  const voice = useCompanionVoice();
  const [{ index, sub }, setPos] = useState({ index: 0, sub: 0 });

  useEffect(() => {
    const sync = () => setPos(readHash(steps));
    sync();
    window.addEventListener("hashchange", sync);
    return () => window.removeEventListener("hashchange", sync);
  }, [steps]);

  const go = useCallback(
    (i: number, s = 0) => {
      voice.quiet();
      const id = steps[i];
      const hash = i === 0 ? "" : id === "look-at" ? `#look-at-${s + 1}` : `#${id}`;
      history.pushState(null, "", `${window.location.pathname}${hash}`);
      setPos({ index: i, sub: s });
    },
    [steps, voice],
  );

  const finish = () => {
    voice.quiet();
    if (first) {
      saveProfile({ createdAt: new Date().toISOString(), earlySigns: readDraft() });
      try {
        window.sessionStorage.removeItem(SIGNS_DRAFT);
      } catch {
        // nothing to clear
      }
    }
    saveOnboarding({ ...(readData().onboarding ?? {}), version: ONBOARDING_VERSION, doneAt: new Date().toISOString() });
    router.replace("/");
  };

  const step = steps[index];
  const next = () => (index >= steps.length - 1 ? finish() : go(index + 1));
  const back = () => {
    if (step === "look-at" && sub > 0) return go(index, sub - 1);
    if (index === 0) {
      // The new questions, offered quietly: Back on the first one goes home.
      if (!first) router.replace("/");
      return;
    }
    const prev = steps[index - 1];
    go(index - 1, prev === "look-at" ? PERMISSIONS.length - 1 : 0);
  };

  const progress = <StepCount index={index} total={steps.length} label={first ? undefined : "New questions"} />;
  const nav = (skipLabel = "Skip") => (
    <div className="links">
      {(index > 0 || !first) && (
        <button type="button" className="btn btn-quiet" onClick={back}>
          {index === 0 ? "Not now" : "Back"}
        </button>
      )}
      <button
        type="button"
        className="btn btn-quiet"
        onClick={() => {
          if (step !== "look-at") return next();
          savePermission(PERMISSIONS[sub].kind, "skipped");
          nextPermission();
        }}
      >
        {skipLabel}
      </button>
    </div>
  );

  const nextPermission = () => (sub < PERMISSIONS.length - 1 ? go(index, sub + 1) : next());

  if (step === "hello") return <HelloStep voice={voice} progress={progress} onStart={next} />;
  if (step === "helps") return <HelpsStep data={data} progress={progress} nav={nav} onDone={next} intro={!first} />;
  if (step === "signs") return <SignsStep voice={voice} progress={progress} nav={nav} onDone={next} />;
  if (step === "trust") return <TrustStep data={data} progress={progress} nav={nav} onDone={next} />;
  if (step === "clinic") return <ClinicStep data={data} progress={progress} nav={nav} onDone={next} />;
  if (step === "look-at") return <PermissionStep key={sub} sub={sub} progress={progress} nav={nav} onDone={nextPermission} />;
  if (step === "daily") return <DailyStep data={data} progress={progress} nav={nav} onDone={next} last={index === steps.length - 1} />;
  return (
    <CheriLook
      data={data}
      above={progress}
      actions={
        <>
          <button type="button" className="btn btn-primary" onClick={finish}>
            Done
          </button>
          <div className="links">
            <button type="button" className="btn btn-quiet" onClick={back}>
              Back
            </button>
          </div>
        </>
      }
    />
  );
}

type Voice = ReturnType<typeof useCompanionVoice>;
interface StepProps {
  progress: React.ReactNode;
  nav: (skipLabel?: string) => React.ReactNode;
  onDone: () => void;
}

function HelloStep({ voice, progress, onStart }: { voice: Voice; progress: React.ReactNode; onStart: () => void }) {
  return (
    <Screen
      lead={
        <>
          <Says state={voice.state} size={88}>
            <p>{INTRO}</p>
          </Says>
          {progress}
        </>
      }
      actions={
        <>
          <button type="button" className="btn btn-primary" onClick={onStart}>
            Get started
          </button>
          <div className="links">
            <button type="button" className="btn btn-quiet" onClick={() => voice.say(INTRO)}>
              Read this aloud
            </button>
          </div>
        </>
      }
    >
      <div className="card">
        <p style={{ marginBottom: 0 }}>
          What I measure stays on this device, and there is no account. Only short messages with people you trust, if you
          add any, pass through a messages service. A few questions follow, one at a time, and you can skip any of them.
        </p>
      </div>
    </Screen>
  );
}

function HelpsStep({ data, progress, nav, onDone, intro }: StepProps & { data: AppData; intro: boolean }) {
  // Before anything is picked, the list starts empty: the person's own picks, not a default.
  const [list, setList] = useState<HelpItem[]>(() =>
    data.helps ? helpsOf(data) : STARTING_HELPS.map((h) => ({ id: h.id, label: h.label, on: false, own: false })),
  );
  const [crisis, setCrisis] = useState(false);
  const picked = list.filter((h) => h.on).length;
  const ownCount = list.filter((h) => h.own).length;
  const toggle = (id: string) => setList((cur) => cur.map((h) => (h.id === id ? { ...h, on: !h.on } : h)));
  return (
    <Screen
      lead={
        <>
          <Says state="idle">
            {intro && <p className="small muted ask-note">A few new questions. Skip any of them.</p>}
            <h1>What helps you?</h1>
            <p className="small muted" hidden={crisis}>
              Pick any, and add your own. When things look different, I&apos;ll suggest one of these.
            </p>
          </Says>
          {progress}
        </>
      }
      actions={
        <>
          <button
            type="button"
            className="btn btn-primary"
            onClick={() => {
              if (picked) saveHelps(list);
              onDone();
            }}
          >
            {picked ? "Continue" : "Skip for now"}
          </button>
          {nav()}
        </>
      }
    >
      {crisis ? (
        <CrisisCard />
      ) : (
        <>
          <fieldset className="bare-fieldset">
            <legend className="sr-only">Things that help, to pick from</legend>
            <div className="chips">
              {list.map((h) => (
                <button key={h.id} type="button" className="chip" aria-pressed={h.on} onClick={() => toggle(h.id)}>
                  {h.label}
                </button>
              ))}
            </div>
          </fieldset>
          <OwnWords
            id="own-help"
            label="Something else? In your own words"
            placeholder={ownCount >= MAX_OWN_HELPS ? "That's plenty for now" : "For example: baking bread"}
            disabled={ownCount >= MAX_OWN_HELPS}
            onAdd={(t) => setList((cur) => addOwn(cur, t, newId()))}
            onCrisis={() => setCrisis(true)}
          />
        </>
      )}
    </Screen>
  );
}

function SignsStep({ voice, progress, nav, onDone }: StepProps & { voice: Voice }) {
  const [signs, setSigns] = useState<string[]>(() => (typeof window === "undefined" ? [] : readDraft()));
  const [custom, setCustom] = useState("");
  const [crisis, setCrisis] = useState(false);
  const crisisCheck = useCrisisCheck(() => {
    voice.quiet();
    setCrisis(true);
  });
  const set = (next: string[]) => {
    setSigns(next);
    writeDraft(next);
  };
  const toggle = (sign: string) => set(signs.includes(sign) ? signs.filter((s) => s !== sign) : signs.length < MAX_SIGNS ? [...signs, sign] : signs);
  const tidy = (raw: string) => raw.trim().replace(/\s+/g, " ").slice(0, 60);
  const withCustom = (text: string): string[] => {
    if (!text || signs.length >= MAX_SIGNS || signs.some((s) => s.toLowerCase() === text.toLowerCase())) return signs;
    return [...signs, text];
  };
  const addCustom = () => {
    const text = tidy(custom);
    if (!text || crisisCheck.full(text)) return;
    set(withCustom(text));
    setCustom("");
  };
  const save = () => {
    const text = tidy(custom);
    // Typed but not added: never dropped in silence. Crisis words show the card first and are
    // never saved as an early sign.
    if (containsCrisisWords(text) && !crisis) {
      voice.quiet();
      setCrisis(true);
      return;
    }
    if (!crisis && text) set(withCustom(text));
    onDone();
  };
  const full = signs.length >= MAX_SIGNS;
  const customOnly = signs.filter((s) => !COMMON_SIGNS.includes(s));

  return (
    <Screen
      lead={
        <>
          <Says state={voice.state}>
            <h1>{SIGNS_QUESTION}</h1>
            <p className="small muted" hidden={crisis}>
              Pick or type up to three. I&apos;ll keep them in mind and ask about them only when something seems to have
              changed.
            </p>
          </Says>
          {progress}
        </>
      }
      actions={
        <>
          <button type="button" className="btn btn-primary" onClick={save}>
            {signs.length || (!crisis && tidy(custom)) ? "Continue" : "Skip for now"}
          </button>
          {nav()}
        </>
      }
    >
      {crisis ? (
        <CrisisCard />
      ) : (
        <>
          <fieldset className="bare-fieldset">
            <legend className="sr-only">Early signs to pick from</legend>
            <div className="chips">
              {[...COMMON_SIGNS, ...customOnly].map((s) => {
                const on = signs.includes(s);
                return (
                  <button key={s} type="button" className="chip" aria-pressed={on} disabled={!on && full} onClick={() => toggle(s)}>
                    {s}
                  </button>
                );
              })}
            </div>
          </fieldset>
          <div className="field">
            <label htmlFor="custom-sign">Something else? Type it in your own words</label>
            <div style={{ display: "flex", gap: "var(--space-2)" }}>
              <input
                id="custom-sign"
                type="text"
                value={custom}
                maxLength={60}
                disabled={full}
                placeholder={full ? "You've picked three" : "For example: stopped cooking"}
                onFocus={() => voice.setListening(true)}
                onBlur={(e) => {
                  voice.setListening(false);
                  crisisCheck.full(e.target.value);
                }}
                onChange={(e) => {
                  setCustom(e.target.value);
                  crisisCheck.typed(e.target.value);
                }}
                onKeyDown={(e) => {
                  if (e.key === "Enter") {
                    e.preventDefault();
                    addCustom();
                  }
                }}
              />
              <button type="button" className="btn btn-secondary" onClick={addCustom} disabled={full || !custom.trim()}>
                Add
              </button>
            </div>
          </div>
          <p className="small muted" aria-live="polite" style={{ marginBottom: 0 }}>
            {signs.length === 0 ? "Nothing picked yet. You can also skip this." : `${signs.length} of ${MAX_SIGNS} picked${full ? ". Tap one to unpick it." : "."}`}
          </p>
        </>
      )}
    </Screen>
  );
}

function TrustStep({ data, progress, nav, onDone }: StepProps & { data: AppData }) {
  const everyone = usePeople();
  const [busy, setBusy] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);
  const [mine, setMine] = useState<string | null>(null);
  const [label, setLabel] = useState("");
  const [crisis, setCrisis] = useState(false);
  const crisisCheck = useCrisisCheck(() => setCrisis(true), () => label);
  const url = messagesUrlOf(data.settings);
  const invited = mine ? everyone.find((v) => v.id === mine) ?? null : null;
  const add = async () => {
    if (crisisCheck.full(label)) return;
    setBusy(true);
    setProblem(null);
    try {
      setMine(await addPerson(url, label));
      setLabel("");
    } catch {
      setProblem("I couldn't reach the messages service just now. You can add someone later in Settings.");
    } finally {
      setBusy(false);
    }
  };
  if (invited?.snapshot.pairing?.inviteUrl) {
    return (
      <Screen
        lead={
          <>
            <Says state="joy">
              <h1>Who do you trust?</h1>
              <p className="small muted">Let {personName(invited)} scan this, or send them the link. It works for two days.</p>
            </Says>
            {progress}
          </>
        }
        actions={
          <>
            <button type="button" className="btn btn-primary" onClick={onDone}>
              Continue
            </button>
            <div className="links">
              <button type="button" className="btn btn-quiet" onClick={() => setMine(null)}>
                Add someone else
              </button>
            </div>
          </>
        }
      >
        <section className="card" aria-label="Invite link">
          <LinkCode url={invited.snapshot.pairing.inviteUrl} label={`Invite link for ${personName(invited)}`} />
        </section>
      </Screen>
    );
  }
  const already = everyone.filter((v) => v.snapshot.pairing && v.snapshot.connection !== "ended").length;
  return (
    <Screen
      lead={
        <>
          <Says state="idle">
            <h1>Who do you trust?</h1>
            <p className="small muted" hidden={crisis}>
              A sister, a friend. They get a link to open on their phone, no app needed. I only ever ask them to talk or
              meet up when you say yes.
            </p>
          </Says>
          {progress}
        </>
      }
      actions={
        <>
          {!crisis && (
            <button type="button" className="btn btn-primary" disabled={busy} onClick={add}>
              {busy ? "One moment" : "Invite someone"}
            </button>
          )}
          {nav(already ? "Continue" : "Skip for now")}
        </>
      }
    >
      {crisis ? (
        <CrisisCard />
      ) : (
        <>
          <div className="field">
            <label htmlFor="trust-label">Their name (only on this device, optional)</label>
            <input
              id="trust-label"
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
          <p className="small muted" style={{ margin: 0 }}>
            {already
              ? `${already === 1 ? "One person is" : `${already} people are`} already on your list. You can add more later in Settings.`
              : "Add one now, more later in Settings. The messages service never receives your measurements or answers."}
          </p>
        </>
      )}
      {problem && (
        <p className="small problem-text" role="alert">
          {problem}
        </p>
      )}
    </Screen>
  );
}

function ClinicStep({ data, progress, nav, onDone }: StepProps & { data: AppData }) {
  const [c, setC] = useState(() => clinicOf(data.settings));
  return (
    <Screen
      lead={
        <>
          <Says state="idle">
            <h1>Your clinic</h1>
            <p className="small muted">What may your clinic be told? You can change this later in Settings.</p>
          </Says>
          {progress}
        </>
      }
      actions={
        <>
          <button
            type="button"
            className="btn btn-primary"
            onClick={() => {
              saveSettings({ clinic: c.share === "never" ? { ...c, tellAfterDays: false } : c });
              onDone();
            }}
          >
            Continue
          </button>
          {nav()}
        </>
      }
    >
      <div className="options clinic-options" role="group" aria-label="What your clinic is told">
        {CLINIC_CHOICES.map((o) => (
          <button key={o.value} type="button" className="option" aria-pressed={c.share === o.value} onClick={() => setC({ ...c, share: o.value })}>
            <span>{o.label}</span>
            <span className="small muted option-hint">{o.hint}</span>
          </button>
        ))}
      </div>
      <section className="card switches" aria-label="The automatic step">
        {c.share === "never" ? (
          <SwitchRow label="If my values have not come back after 7 days, tell my clinic for me" on={false} disabledText="Off while your clinic is told nothing" />
        ) : (
          <SwitchRow
            label="If my values have not come back after 7 days, tell my clinic for me"
            hint="In this version the clinic is a demo recipient: nothing is sent."
            keepHint
            on={c.tellAfterDays}
            onChange={(v) => setC({ ...c, tellAfterDays: v })}
          />
        )}
      </section>
    </Screen>
  );
}

function PermissionStep({ sub, progress, nav, onDone }: StepProps & { sub: number }) {
  const p = PERMISSIONS[sub];
  const phone = typeof window !== "undefined" && isPhoneApp();
  const desktop = typeof window !== "undefined" && isDesktop();
  const [asking, setAsking] = useState(false);
  const [answer, setAnswer] = useState<PermissionState | "unknown" | null>(null);
  const here = phone ? null : notHere(p.kind, desktop);

  const allow = async () => {
    if (!phone) {
      // Camera and microphone: said yes here; the browser or the computer asks the first time.
      savePermission(p.kind, "yes");
      if (p.kind === "camera-microphone") saveSettings({ helloSensors: true });
      onDone();
      return;
    }
    setAsking(true);
    // Through lib/phone.ts: the phone's own sheet. Sleep and steps are read at once when allowed.
    const state = await askPhonePermission(p.kind);
    setAsking(false);
    if (state) savePermission(p.kind, state);
    if (p.kind === "camera-microphone" && state === "granted") saveSettings({ helloSensors: true });
    setAnswer(state ?? "unknown");
  };

  const result =
    answer === "granted"
      ? "Allowed. Thank you."
      : answer === "yes"
        ? "Asked. If you allowed it, I'll start reading it from today."
        : answer === "denied"
          ? "Not allowed. That's fine: everything else works, and you can change it in the phone's settings."
          : answer === "unknown"
            ? "The phone did not answer. You can allow it later in the phone's settings."
            : answer === "not-here"
              ? "Not available on this phone yet."
              : null;

  return (
    <Screen
      lead={
        <>
          <Says state={answer === "granted" ? "joy" : "idle"}>
            <p className="small muted ask-note">What may I look at? {sub + 1} of {PERMISSIONS.length}</p>
            <h1>{p.title}</h1>
            <p className="small muted">{p.line}</p>
          </Says>
          {progress}
        </>
      }
      actions={
        <>
          {result || here ? (
            <button
              type="button"
              className="btn btn-primary"
              onClick={() => {
                if (here && !result) savePermission(p.kind, "not-here");
                onDone();
              }}
            >
              Continue
            </button>
          ) : (
            <button type="button" className="btn btn-primary" disabled={asking} onClick={allow}>
              {asking ? "Waiting for the phone" : p.kind === "camera-microphone" && !phone ? "Allow during the daily hello" : "Allow"}
            </button>
          )}
          {nav()}
        </>
      }
    >
      {(result || here) && (
        <p className="card permission-result" role="status" style={{ margin: 0 }}>
          {result ?? here}
        </p>
      )}
      {!result && !here && !phone && p.kind === "camera-microphone" && (
        <p className="small muted" style={{ margin: 0 }}>
          Your browser or computer asks you the first time you hold to talk.
        </p>
      )}
    </Screen>
  );
}

const AFTER_TWO_WEEKS: { value: DailyQuestionSettings["every"]; label: string }[] = [
  { value: "day", label: "Every day" },
  { value: "twice-week", label: "A few times a week" },
  { value: "off", label: "Off" },
];

function DailyStep({ data, progress, nav, onDone, last }: StepProps & { data: AppData; last: boolean }) {
  const cur = dailyQuestionOf(data.settings);
  const [when, setWhen] = useState(cur.when);
  const [every, setEvery] = useState<DailyQuestionSettings["every"]>(AFTER_TWO_WEEKS.some((a) => a.value === cur.every) ? cur.every : "day");
  const save = (next: Partial<DailyQuestionSettings>) => {
    saveSettings({ dailyQuestion: { ...cur, when, every, firstTwoWeeksDaily: true, ...next } });
    onDone();
  };
  return (
    <Screen
      lead={
        <>
          <Says state="idle">
            <h1>A daily hello?</h1>
            <p className="small muted">
              Twenty to forty seconds with me: talk, or one tap. Every day for the first two weeks while I learn your usual,
              then as often as you like. Never in quiet hours.
            </p>
          </Says>
          {progress}
        </>
      }
      actions={
        <>
          <button type="button" className="btn btn-primary" onClick={() => save({})}>
            {last ? "Done" : "Continue"}
          </button>
          <div className="links">
            <button type="button" className="btn btn-quiet" onClick={() => save({ every: "off", firstTwoWeeksDaily: false })}>
              No daily hello
            </button>
          </div>
          {nav()}
        </>
      }
    >
      <section className="card stack-sm daily-settings" aria-label="A daily hello">
        <fieldset className="bare-fieldset">
          <legend className="switch-label">Roughly when</legend>
          <div className="chips">
            {TIMES.map((t) => (
              <button key={t.value} type="button" className="chip" aria-pressed={when === t.value} onClick={() => setWhen(t.value)}>
                {t.label}
              </button>
            ))}
          </div>
        </fieldset>
        <fieldset className="bare-fieldset">
          <legend className="switch-label">After the first two weeks</legend>
          <div className="chips">
            {AFTER_TWO_WEEKS.map((a) => (
              <button key={a.value} type="button" className="chip" aria-pressed={every === a.value} onClick={() => setEvery(a.value)}>
                {a.label}
              </button>
            ))}
          </div>
        </fieldset>
      </section>
    </Screen>
  );
}
