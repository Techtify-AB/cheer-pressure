"use client";

// "Live", under For the demo: what Cheri notices right now, in the four categories, one panel
// each (Sleep, Energy, Social, Mood). The camera and the microphone start only when the person
// presses "Start camera" or "Start microphone", never by themselves, and "Pause everything"
// stops both. Everything is worked out on this computer through the same seams the rest of the
// app uses (lib/camera, lib/voice/index); nothing here changes their thresholds.
//
// Typing rhythm is one line under Energy. Its detailed numbers, the box to type in (in a
// browser) and how typing counts sit behind the screen's one disclosure.

import Link from "next/link";
import { useCallback, useEffect, useRef, useState } from "react";
import { Bar, movementWords, postureWords } from "@/components/camera/CameraPanels";
import { useCamera } from "@/components/camera/useCamera";
import { useDesktopTyping } from "@/components/desktop";
import { usePassive, useRequireProfile, useToday } from "@/components/hooks";
import { Disclosure, Pager, Screen } from "@/components/Screen";
import { pitchWords } from "@/components/voice/VoiceLive";
import { useVoice } from "@/components/voice/useVoice";
import { resetCamera, startCamera, stopCamera } from "@/lib/camera";
import { againstUsual } from "@/lib/categories";
import { answerLabel, ANSWER_VALUE } from "@/lib/daily";
import { daysBetween, todayKey } from "@/lib/dates";
import { dayMinutesToClock, clockToDayMinutes, type Evaluation, type PassiveMetric } from "@/lib/passive";
import {
  dayRhythm,
  openInputMonitoringSettings,
  retryTyping,
  setTypingPaused,
  type DayActivity,
} from "@/lib/platform";
import { sourcesOf } from "@/lib/settings";
import { saveSettings, saveTypingDays, useData } from "@/lib/storage";
import { useTrusted } from "@/lib/trusted";
import type { AppData, PassiveKey } from "@/lib/types";
import { resetVoice, startListening, stopListening } from "@/lib/voice/index";
import {
  BurstCollector,
  DayPool,
  MIN_DAY_PRESSES,
  burstNumbers,
  verdict,
  verdictWords,
  type Burst,
  type BurstNumbers,
  type Verdict,
} from "@/lib/typing";

const RECENT_MS = 2_000;
const CAMERA_FAILED = new Set(["denied", "no-camera", "in-use", "unsupported", "failed"]);
const MIC_FAILED = new Set(["denied", "no-mic", "in-use", "unsupported", "failed"]);

const ms = (v: number | null) => (v === null ? "Not yet" : `${Math.round(v)} ms`);

/** Whether the burst being typed counts as writing, in plain words. */
interface BurstState {
  words: string;
  counted: boolean;
  /** Short, for the one typing line: "counting", "not counted: held keys". */
  short: string;
}

function shortVerdict(v: Verdict): string {
  if (v.counted) return "counting";
  switch (v.why) {
    case "too-short":
      return "not counted yet: too short";
    case "held-keys":
      return "not counted: held keys";
    case "keys-at-once":
      return "not counted: several keys at once";
    case "too-slow":
      return "not counted: scattered presses";
    case "game":
      return "not counted: a game is in front";
  }
}

function Numbers({ stats, countedToday }: { stats: BurstNumbers | null; countedToday: number }) {
  const s = stats;
  const rows: { label: string; value: string; meaning: string }[] = [
    {
      label: "Counted today",
      value: String(countedToday),
      meaning: `key presses of real writing; a day needs ${MIN_DAY_PRESSES}`,
    },
    {
      label: "Rhythm evenness",
      value: ms(s?.spreadMs ?? null),
      meaning: "how uneven the gaps under a second are",
    },
    {
      label: "Hold time",
      value: ms(s?.holdMs ?? null),
      meaning: "how long a key is usually held down",
    },
    {
      label: "Thinking pauses",
      value: s?.thinkingPer100 == null ? "Not yet" : `${Math.round(s.thinkingPer100)} per 100`,
      meaning: "gaps of 1 to 2 seconds, only shown, never counted",
    },
  ];
  return (
    <dl className="live-numbers">
      {rows.map((r) => (
        <div key={r.label}>
          <dt>{r.label}</dt>
          <dd className="live-value">{r.value}</dd>
          <dd className="small muted live-meaning">{r.meaning}</dd>
        </div>
      ))}
    </dl>
  );
}

/**
 * The in-app text box: its key timings feed the same bursts and checks as the desktop app.
 * The text is never stored. Counted bursts make today's value for the box.
 */
function useBoxMeter(paused: boolean) {
  const collector = useRef(new BurstCollector(() => "writing"));
  const pool = useRef<{ date: string; pool: DayPool }>({ date: todayKey(), pool: new DayPool() });
  const [stats, setStats] = useState<BurstNumbers | null>(null);
  const [state, setState] = useState<BurstState | null>(null);
  const [typing, setTyping] = useState(false);
  const [countedToday, setCountedToday] = useState(0);

  const finish = useCallback((b: Burst | null) => {
    if (!b) return;
    const v = verdict(b);
    setState({ words: verdictWords(v, b.kind, b.presses), counted: v.counted, short: shortVerdict(v) });
    if (!v.counted) return;
    const today = todayKey();
    if (pool.current.date !== today) pool.current = { date: today, pool: new DayPool() };
    pool.current.pool.add(b);
    const sum = pool.current.pool.summary();
    setCountedToday(sum.presses);
    setStats(burstNumbers(b));
    saveTypingDays([{ date: today, kind: "all", measuredIn: "box", ...sum, source: "user", savedAt: new Date().toISOString() }]);
  }, []);

  useEffect(() => {
    const c = collector.current;
    const id = window.setInterval(() => {
      const now = performance.now();
      const last = c.lastPressAt();
      setTyping(last !== null && now - last <= RECENT_MS);
      finish(c.tick(now));
      const b = c.now();
      if (b) {
        const v = verdict(b);
        setState({ words: verdictWords(v, b.kind, b.presses), counted: v.counted, short: shortVerdict(v) });
        if (v.counted) setStats(burstNumbers(b));
      }
    }, 500);
    return () => {
      window.clearInterval(id);
      finish(c.close());
    };
  }, [finish]);

  useEffect(() => {
    if (paused) finish(collector.current.close());
  }, [paused, finish]);

  // Only the moment is used, and whether the keyboard is repeating a held key. Which key it was is never read.
  const onKeyDown = (e: React.KeyboardEvent) => {
    if (paused) return;
    finish(collector.current.keyDown(performance.now(), e.repeat));
  };
  const onKeyUp = () => {
    if (paused) return;
    collector.current.keyUp(performance.now());
  };

  return { stats, state, typing, countedToday, onKeyDown, onKeyUp };
}

export default function LivePage() {
  const data = useData();
  const ready = useRequireProfile(data);
  const evaluation = usePassive(data);
  if (!data || !ready || !evaluation) return null;
  return <LiveView data={data} e={evaluation} />;
}

const PANELS = ["sleep", "energy", "social", "mood"] as const;
const PANEL_NAMES = { sleep: "Sleep", energy: "Energy", social: "Social", mood: "Mood" };

function metricOf(e: Evaluation, key: PassiveKey): PassiveMetric | undefined {
  return e.metrics.find((m) => m.key === key);
}

/** One observation row: a name, what it is now, and how it compares with the person's own usual. */
function Row({ name, now, usual, children, data }: { name: string; now: string; usual?: string; children?: React.ReactNode; data?: string }) {
  return (
    <div className="live-row" data-row={data}>
      <p className="live-row-head">
        <span className="live-row-name">{name}</span>
        <span className="live-row-now">{now}</span>
      </p>
      {children}
      {usual && <p className="live-row-usual">{usual}</p>}
    </div>
  );
}

function LiveView({ data, e }: { data: AppData; e: Evaluation }) {
  const today = useToday();
  const { desktop, status, live, setStatus } = useDesktopTyping();
  const camera = useCamera();
  const voice = useVoice();
  const trusted = useTrusted();
  const video = useRef<HTMLVideoElement>(null);
  const [panel, setPanel] = useState(0);
  const [days, setDays] = useState<DayActivity[]>([]);
  const [checking, setChecking] = useState(false);

  const pausedAll = !!data.settings.pausedAll;
  const typingOff = !sourcesOf(data.settings).typing;
  const computer = desktop && status?.listener === "running";
  const box = useBoxMeter(computer || pausedAll || typingOff);
  const daysSaved = (data.typingDays ?? []).filter((t) => t.source === "user" && t.spreadMs !== null).length;

  // Leaving the screen turns the camera and the microphone off and forgets a refused start.
  useEffect(
    () => () => {
      resetCamera();
      resetVoice();
    },
    [],
  );

  useEffect(() => {
    if (!desktop) return;
    let alive = true;
    const load = () =>
      dayRhythm().then((d) => {
        if (alive) setDays(d);
      });
    void load();
    const id = window.setInterval(load, 30_000);
    return () => {
      alive = false;
      window.clearInterval(id);
    };
  }, [desktop]);

  const cameraRunning = camera.phase === "on" || camera.phase === "starting";
  const micRunning = voice.phase === "on" || voice.phase === "starting";
  const cameraActive = camera.phase === "on";
  const micActive = voice.phase === "on";

  const pauseEverything = () => {
    const next = !pausedAll;
    saveSettings({ pausedAll: next });
    void setTypingPaused(next);
    if (next) {
      stopCamera();
      stopListening();
    }
  };

  // Energy: movement first, typing as one line last.
  const mv = cameraActive ? camera.live.display : 0;
  let movementNow: string;
  if (cameraActive) movementNow = camera.live.present ? movementWords(mv) : "No one in frame";
  else if (camera.phase === "starting") movementNow = "Starting";
  else if (CAMERA_FAILED.has(camera.phase)) movementNow = "Camera not available";
  else movementNow = "Camera off";

  const burst: BurstState | null = computer
    ? live?.burst
      ? (() => {
          const v: Verdict = live.burst.counted ? { counted: true } : { counted: false, why: live.burst.why ?? "too-short" };
          return { words: verdictWords(v, live.burst.kind, live.burst.presses), counted: v.counted, short: shortVerdict(v) };
        })()
      : null
    : box.state;
  const typingNow = computer ? !!live?.typing : box.typing;
  const stats = computer ? (live?.stats ?? null) : box.stats;
  const countedToday = computer ? (live?.countedToday ?? 0) : box.countedToday;
  const typingMetrics = [metricOf(e, "spread"), metricOf(e, "hold")];
  let typingUsual: string;
  if (typingMetrics.some((m) => m?.status === "changed")) typingUsual = "changed compared with your usual";
  else if (typingMetrics.every((m) => m?.status === "steady")) typingUsual = "steady";
  else if (typingMetrics.some((m) => m?.status === "no-recent")) typingUsual = "too few days this week";
  else typingUsual = "still learning your usual";
  let typingLine: string;
  if (pausedAll) typingLine = "Typing: paused";
  else if (typingOff) typingLine = "Typing: off";
  else if (desktop && status?.listener === "permission-needed") typingLine = "Typing: waits for your permission";
  else if (burst && (typingNow || !burst.counted)) typingLine = burst.counted ? `Typing: counting, ${typingUsual}` : `Typing: ${burst.short}`;
  else if (computer) typingLine = `Typing: ${typingUsual}`;
  else typingLine = `Typing: ${typingUsual}. In a browser, only in the box under Typing in detail`;

  // Mood: the person's own answer first, then what the camera and microphone observe.
  const answerToday = (data.dailyAnswers ?? []).find((a) => a.date === today && a.answer);
  const faceShare = Math.round(camera.expression.smilingShare * 100);
  let faceNow: string;
  if (!cameraActive) faceNow = "Camera off";
  else if (!camera.faceAvailable) faceNow = "Not available here";
  else if (!camera.expression.present) faceNow = "No face in view";
  else faceNow = `Smiling ${faceShare}% of the time`;
  let toneNow: string;
  if (micActive) toneNow = voice.live.pitchVariability !== null ? pitchWords(voice.live.pitchVariability) : "Waiting for a voice";
  else if (voice.phase === "starting") toneNow = "Starting";
  else if (MIC_FAILED.has(voice.phase)) toneNow = "Microphone not available";
  else toneNow = "Microphone off";

  // Sleep: an estimate from when this computer is used.
  const todayDesktop = days.find((d) => d.date === today);
  const stored = data.activityDays.find((d) => d.date === today);
  const firstToday = todayDesktop?.first ?? stored?.first ?? null;
  const night = metricOf(e, "quietNight")?.points.find((p) => p.date === today);
  const yesterday = data.activityDays.find((d) => daysBetween(d.date, today) === 1);
  let nightText: string;
  if (night && yesterday && firstToday) {
    const h = Math.floor(night.value);
    const min = Math.round((night.value - h) * 60);
    nightText = `About ${h} h ${String(min).padStart(2, "0")} min, ${dayMinutesToClock(clockToDayMinutes(yesterday.last))} to ${firstToday}`;
  } else nightText = desktop ? "Not known yet" : "Measured in the desktop app";

  // Social: contact with the person they trust.
  const paired = !!trusted?.pairing && trusted.connection !== "ended";
  const weekMessages = (data.contactDays ?? [])
    .filter((c) => daysBetween(c.date, today) >= 0 && daysBetween(c.date, today) < 7)
    .reduce((a, c) => a + c.exchanged, 0);
  const hasContactDays = (data.contactDays ?? []).some((c) => daysBetween(c.date, today) < 7);

  let lead: string;
  if (pausedAll) lead = "Everything is paused. Nothing new is measured and I stay quiet.";
  else lead = "What I notice right now, compared with your own usual. Never what you feel.";

  const cameraButton = cameraRunning ? (
    <button type="button" className="btn btn-secondary" onClick={stopCamera}>
      Stop camera
    </button>
  ) : (
    <button
      type="button"
      className="btn btn-secondary"
      disabled={pausedAll || CAMERA_FAILED.has(camera.phase)}
      onClick={() => {
        if (video.current) void startCamera(video.current);
      }}
    >
      Start camera
    </button>
  );
  const micButton = micRunning ? (
    <button type="button" className="btn btn-secondary" onClick={stopListening}>
      Stop microphone
    </button>
  ) : (
    <button
      type="button"
      className="btn btn-secondary"
      disabled={pausedAll || MIC_FAILED.has(voice.phase)}
      onClick={() => void startListening()}
    >
      Start microphone
    </button>
  );

  const permissionNeeded = desktop && status?.listener === "permission-needed";

  return (
    <Screen
      lead={
        <>
          <h1 className="item-title">Live</h1>
          <p className="muted live-lead-line" aria-live="polite">
            {lead}
          </p>
        </>
      }
      actions={
        <>
          <div className="live-controls">
            {cameraButton}
            {micButton}
          </div>
          <p className="small muted live-privacy">The picture and the sound are worked out on this computer. Nothing is stored or sent.</p>
          <div className="links">
            <button type="button" className="btn btn-quiet" onClick={pauseEverything} aria-pressed={pausedAll}>
              {pausedAll ? "Resume measuring" : "Pause everything"}
            </button>
            <Disclosure label="Typing in detail" title="Typing in detail">
              {!computer && (
                <div className="field">
                  <label htmlFor="typing-box" className="typing-label">
                    Type anything here
                  </label>
                  <textarea
                    id="typing-box"
                    className="typing-box"
                    autoComplete="off"
                    autoCorrect="off"
                    autoCapitalize="off"
                    spellCheck={false}
                    placeholder="For example, what you did this morning. The text is never stored."
                    onKeyDown={box.onKeyDown}
                    onKeyUp={box.onKeyUp}
                  />
                </div>
              )}
              <p className={burst?.counted ? "small burst-state counting" : "small burst-state"} aria-live="polite" role="status">
                {pausedAll || typingOff
                  ? "Typing is not measured right now."
                  : burst && (typingNow || !burst.counted)
                    ? burst.words
                    : computer
                      ? "Start typing anywhere. Mash keys or hold one down, and see it ignored."
                      : "Type in the box. Mash keys or hold one down, and see it ignored."}
              </p>
              <Numbers stats={stats} countedToday={countedToday} />
              {permissionNeeded && (
                <>
                  <p>
                    To measure typing rhythm across the whole computer, macOS needs you to allow Cheer Pressure under{" "}
                    <strong>Privacy &amp; Security, Input Monitoring</strong>. It still only sees when a key goes down and
                    up, never which key. If it still says this after you allowed it, quit Cheer Pressure from the menu bar
                    and open it again.
                  </p>
                  <div className="live-controls">
                    <button type="button" className="btn btn-secondary" onClick={() => void openInputMonitoringSettings()}>
                      Open System Settings
                    </button>
                    <button
                      type="button"
                      className="btn btn-quiet"
                      disabled={checking}
                      onClick={async () => {
                        setChecking(true);
                        const next = await retryTyping();
                        if (next) setStatus(next);
                        setChecking(false);
                      }}
                    >
                      {checking ? "Checking" : "Check again"}
                    </button>
                  </div>
                </>
              )}
              <p>
                Only real writing counts: a stretch of at least 30 presses without a gap over 2 seconds. Stretches that
                look like held keys, several keys at once or scattered shortcuts are left out, and so is anything typed
                while a game is in front. Rhythm uses only the gaps under a second; gaps of 1 to 2 seconds are thinking
                pauses, shown but never counted. Only key timing is used, never which keys or what you write.
              </p>
              <p>
                {computer ? "Measuring across the whole computer. " : "In a browser, only in the box above. "}
                In the desktop app, the kind of app in front when a stretch starts is kept as one word (writing, code,
                browser, game or other), never the app&apos;s name or what is in it. A day gets a value once it has{" "}
                {MIN_DAY_PRESSES} counted presses. {daysSaved > 0 ? `${daysSaved} days so far. ` : ""}They show up under
                Energy in <Link href="/values/?c=energy">My values</Link>.
              </p>
            </Disclosure>
            <Link href="/demo/" className="btn btn-quiet">
              Back to the demo
            </Link>
          </div>
        </>
      }
    >
      {/* Rendered but out of sight: the picture is worked out on this computer and never shown here. */}
      <video ref={video} className="camera-feed" muted playsInline aria-hidden="true" tabIndex={-1} />
      <div className="live-board" data-panel={PANELS[panel]}>
        <section className="card live-panel" aria-labelledby="live-sleep" data-current={panel === 0 || undefined} data-category="sleep">
          <h2 id="live-sleep" className="live-panel-title">{PANEL_NAMES.sleep}</h2>
          <p className="live-panel-measure">Estimated from when this computer is used</p>
          <Row name="First activity today" now={firstToday ?? (desktop ? "Not yet today" : "In the desktop app")} data="first-activity" />
          <Row name="Last night" now={nightText} usual={againstUsual(metricOf(e, "quietNight"))} data="last-night" />
          <p className="live-quiet">A watch or phone would give real sleep. Not connected yet.</p>
        </section>

        <section className="card live-panel" aria-labelledby="live-energy" data-current={panel === 1 || undefined} data-category="energy">
          <h2 id="live-energy" className="live-panel-title">{PANEL_NAMES.energy}</h2>
          <p className="live-panel-measure">Movement from the camera</p>
          <Row name="Movement" now={movementNow} usual={againstUsual(metricOf(e, "movementLevel"))} data="movement">
            <Bar value={mv} label="Movement" words={cameraActive ? movementWords(mv) : "Off"} data="movement" />
          </Row>
          <Row
            name="Position changes"
            now={cameraActive ? String(camera.live.shifts) : "Camera off"}
            usual={againstUsual(metricOf(e, "positionChanges"))}
            data="position-changes"
          />
          <p className="live-typing" data-typing-line="" aria-live="polite">
            {typingLine}
          </p>
          <Link href="/demo/camera/" className="live-deeper">
            Camera, live: the picture and the points
          </Link>
        </section>

        <section className="card live-panel" aria-labelledby="live-social" data-current={panel === 2 || undefined} data-category="social">
          <h2 id="live-social" className="live-panel-title">{PANEL_NAMES.social}</h2>
          <p className="live-panel-measure">Contact with the person you trust</p>
          <Row
            name="The person you trust"
            now={paired ? (trusted?.trustedName ? `Connected with ${trusted.trustedName}` : "Invite sent, not opened yet") : "Not connected"}
            data="trusted"
          />
          <Row
            name="Messages this week"
            now={paired || hasContactDays ? String(weekMessages) : "None yet"}
            usual={againstUsual(metricOf(e, "contact"))}
            data="messages"
          />
          {!paired && (
            <Link href="/settings/#trust" className="live-deeper">
              Invite someone under Someone you trust
            </Link>
          )}
          <p className="live-quiet">Talking with someone, and at home or out: not connected yet.</p>
        </section>

        <section className="card live-panel" aria-labelledby="live-mood" data-current={panel === 3 || undefined} data-category="mood">
          <h2 id="live-mood" className="live-panel-title">{PANEL_NAMES.mood}</h2>
          <p className="live-panel-measure">Your own answer, then observations</p>
          <Row
            name="Your answer today"
            now={answerToday?.answer ? answerLabel(ANSWER_VALUE[answerToday.answer]) : "Not answered today"}
            usual={againstUsual(metricOf(e, "ownAnswer"))}
            data="answer"
          />
          <Row name="Face movement" now={faceNow} usual={againstUsual(metricOf(e, "faceMovement"))} data="face">
            <Bar value={cameraActive ? camera.expression.animationDisplay : 0} label="How much the face moves" words={cameraActive ? `${camera.expression.animationDisplay} of 100` : "Off"} data="face" />
          </Row>
          <Row name="Posture" now={cameraActive ? postureWords(camera.posture) : "Camera off"} usual={againstUsual(metricOf(e, "posture"))} data="posture" />
          <Row name="Tone of voice" now={toneNow} usual={againstUsual(metricOf(e, "pitchVariability"))} data="tone" />
          <Link href="/demo/voice/" className="live-deeper">
            Voice, live: pace, pitch and loudness
          </Link>
        </section>
      </div>
      <div className="live-pager">
        <Pager index={panel} total={PANELS.length} onChange={setPanel} secondary />
      </div>
    </Screen>
  );
}

