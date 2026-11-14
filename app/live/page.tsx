"use client";

import Link from "next/link";
import { useCallback, useEffect, useRef, useState } from "react";
import { useDesktopTyping } from "@/components/desktop";
import { useRequireProfile } from "@/components/hooks";
import { Disclosure, Screen } from "@/components/Screen";
import { formatDay, todayKey } from "@/lib/dates";
import {
  dayRhythm,
  openInputMonitoringSettings,
  retryTyping,
  setTypingPaused,
  type DayActivity,
} from "@/lib/platform";
import { connectRobot, connectedRobot, robotSupport } from "@/lib/robot";
import { sourcesOf } from "@/lib/settings";
import { saveTypingDays, useData } from "@/lib/storage";
import {
  BurstCollector,
  DayPool,
  MIN_DAY_PRESSES,
  burstNumbers,
  verdict,
  verdictWords,
  type Burst,
  type BurstNumbers,
} from "@/lib/typing";

const RECENT_MS = 2_000;

const ms = (v: number | null) => (v === null ? "Not yet" : `${Math.round(v)} ms`);

/** Whether the burst being typed counts as writing, in plain words. */
interface BurstState {
  words: string;
  counted: boolean;
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
    setState({ words: verdictWords(v, b.kind, b.presses), counted: v.counted });
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
        setState({ words: verdictWords(v, b.kind, b.presses), counted: v.counted });
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
  if (!data || !ready) return null;
  // Typing rhythm switched off, or everything paused, in Settings: the box measures nothing.
  const blocked = !!data.settings.pausedAll || !sourcesOf(data.settings).typing;
  const daysSaved = (data.typingDays ?? []).filter((t) => t.source === "user" && t.spreadMs !== null).length;
  return <LiveView daysSaved={daysSaved} blocked={blocked} />;
}

function LiveView({ daysSaved, blocked }: { daysSaved: number; blocked: boolean }) {
  const { desktop, status, live, setStatus } = useDesktopTyping();
  const computer = desktop && status?.listener === "running";
  const [boxPaused, setBoxPaused] = useState(false);
  const paused = computer ? !!status?.paused : boxPaused || blocked;
  const box = useBoxMeter(computer || boxPaused || blocked);
  const [days, setDays] = useState<DayActivity[]>([]);
  const [checking, setChecking] = useState(false);

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

  const togglePause = async () => {
    if (computer) {
      const next = await setTypingPaused(!paused);
      if (next) setStatus(next);
    } else {
      setBoxPaused(!boxPaused);
    }
  };

  const stats = computer ? (live?.stats ?? null) : box.stats;
  const typingNow = computer ? !!live?.typing : box.typing;
  const countedToday = computer ? (live?.countedToday ?? 0) : box.countedToday;
  const burst: BurstState | null = computer
    ? live?.burst
      ? {
          words: verdictWords(
            live.burst.counted ? { counted: true } : { counted: false, why: live.burst.why ?? "too-short" },
            live.burst.kind,
            live.burst.presses,
          ),
          counted: live.burst.counted,
        }
      : null
    : box.state;
  const today = todayKey();

  let sourceText: string;
  if (paused) sourceText = "Paused. Nothing is being measured.";
  else if (computer) sourceText = "Measuring across the whole computer";
  else sourceText = "Measuring only in this box";

  const permissionNeeded = desktop && status?.listener === "permission-needed";
  const notice =
    desktop && status && (status.listener === "unsupported" || status.listener === "error")
      ? status.listener === "unsupported"
        ? "Measuring across the whole computer works on macOS only for now. The box below works everywhere."
        : "Measuring across the whole computer did not start. The box below still works."
      : null;

  const pauseButton = (
    <button
      type="button"
      className={permissionNeeded ? "btn btn-quiet" : "btn btn-primary"}
      onClick={togglePause}
      aria-pressed={paused}
    >
      {paused ? "Resume measuring" : "Pause measuring"}
    </button>
  );

  return (
    <Screen
      lead={
        <>
          <h1 className="live-status" role="status">
            <span className={paused ? "status-dot" : "status-dot on"} aria-hidden="true" />
            <span className="sr-only">Live view: </span>
            {permissionNeeded ? "Permission needed. Measuring only in this box for now" : sourceText}
          </h1>
          <p className="muted">
            {notice ??
              "Only key timing, never which keys or what you write, and the kind of app in front, never its name or what is in it."}
          </p>
        </>
      }
      actions={
        <>
          {permissionNeeded && (
            <button type="button" className="btn btn-primary" onClick={() => void openInputMonitoringSettings()}>
              Open System Settings
            </button>
          )}
          {!permissionNeeded && pauseButton}
          <div className="links">
            {permissionNeeded && pauseButton}
            {permissionNeeded && (
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
            )}
            <Disclosure label="Your day and how typing counts" title="Your day and how typing counts">
              {permissionNeeded && (
                <p>
                  To measure typing rhythm across the whole computer, macOS needs you to allow Cheer Pressure under{" "}
                  <strong>Privacy &amp; Security, Input Monitoring</strong>. It still only sees when a key goes down and
                  up, never which key. If it still says this after you allowed it, quit Cheer Pressure from the menu bar
                  and open it again.
                </p>
              )}
              <p>
                Only real writing counts: a stretch of at least 30 presses without a gap over 2 seconds. Stretches that
                look like held keys, several keys at once or scattered shortcuts are left out, and so is anything typed
                while a game is in front. Rhythm uses only the gaps under a second; gaps of 1 to 2 seconds are thinking
                pauses, shown but never counted.
              </p>
              <p>
                In the desktop app, the kind of app in front when a stretch starts is kept as one word (writing, code,
                browser, game or other), never the app&apos;s name or what is in it. A day gets a value once it has{" "}
                {MIN_DAY_PRESSES} counted presses. {daysSaved > 0 ? `${daysSaved} days so far. ` : ""}They show up in{" "}
                <Link href="/values/">My values</Link>.
              </p>
              {!desktop ? (
                <p>First and last activity of the day are measured in the desktop app.</p>
              ) : days.length === 0 ? (
                <p>Your day: nothing yet. After your first key press today, the time shows up here.</p>
              ) : (
                <table className="day-table">
                  <caption className="sr-only">First and last key press, recent days</caption>
                  <thead>
                    <tr>
                      <th scope="col">Day</th>
                      <th scope="col">First key press</th>
                      <th scope="col">Last key press</th>
                    </tr>
                  </thead>
                  <tbody>
                    {days.slice(0, 7).map((d) => (
                      <tr key={d.date}>
                        <th scope="row">{d.date === today ? "Today" : formatDay(d.date)}</th>
                        <td>{d.first}</td>
                        <td>{d.last}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              )}
              <RobotConnect />
            </Disclosure>
            <Link href="/demo/" className="btn btn-quiet">
              Back to the demo
            </Link>
          </div>
        </>
      }
    >
      <section className="card stack-sm" aria-labelledby="numbers-title">
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
        <h2 id="numbers-title">This stretch of typing</h2>
        <p className={burst?.counted ? "small burst-state counting" : "small burst-state"} aria-live="polite" role="status">
          {paused
            ? "Measuring is paused."
            : burst && (typingNow || !burst.counted)
              ? burst.words
              : computer
                ? "Start typing anywhere. Mash keys or hold one down, and see it ignored."
                : "Type in the box. Mash keys or hold one down, and see it ignored."}
        </p>
        <Numbers stats={stats} countedToday={countedToday} />
      </section>
    </Screen>
  );
}

function RobotConnect() {
  const [support] = useState(() => (typeof window === "undefined" ? null : robotSupport()));
  // The robot stays connected while the app is open, so a greeting can light it up on any screen.
  const [state, setState] = useState<"idle" | "connecting" | "connected" | "failed">(() =>
    typeof window !== "undefined" && connectedRobot() ? "connected" : "idle",
  );

  if (!support) return null;
  return (
    <section className="stack-sm" aria-labelledby="robot-title">
      <h3 id="robot-title" style={{ fontSize: "var(--font-size-md)", margin: 0 }}>
        Robot
      </h3>
      <div className="btn-row">
        <button
          type="button"
          className="btn btn-secondary"
          disabled={!support.ok || state === "connecting" || state === "connected"}
          onClick={async () => {
            setState("connecting");
            try {
              await connectRobot();
              setState("connected");
            } catch {
              setState("failed");
            }
          }}
        >
          {state === "connected" ? "Robot connected" : state === "connecting" ? "Connecting" : "Connect robot"}
        </button>
      </div>
      <p className="small muted" style={{ marginBottom: 0 }} aria-live="polite">
        {!support.ok
          ? support.reason
          : state === "failed"
            ? "It did not connect. Check the cable and try again."
            : "Plug the robot in with a USB cable, then pick it from the list."}
      </p>
    </section>
  );
}
