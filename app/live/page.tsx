"use client";

import Link from "next/link";
import { useCallback, useEffect, useRef, useState } from "react";
import { useDesktopTyping } from "@/components/desktop";
import { useRequireProfile } from "@/components/hooks";
import { Disclosure, Screen } from "@/components/Screen";
import { dayKey, formatDay, newId, todayKey } from "@/lib/dates";
import {
  dayRhythm,
  openInputMonitoringSettings,
  retryTyping,
  setTypingPaused,
  type DayActivity,
} from "@/lib/platform";
import { getRobot, robotSupport, type Robot } from "@/lib/robot";
import { saveTypingSessions, useData } from "@/lib/storage";
import { LIVE_WINDOW_MS, TypingCollector, type TypingSessionEnd, type TypingStats } from "@/lib/typing";

const RECENT_MS = 2_000;

const ms = (v: number | null) => (v === null ? "Not yet" : `${Math.round(v)} ms`);

function Numbers({ stats }: { stats: TypingStats | null }) {
  const s = stats;
  const rows: { label: string; value: string; meaning: string }[] = [
    {
      label: "Key presses",
      value: s ? String(s.presses) : "0",
      meaning: "in the last minute",
    },
    {
      label: "Time between presses",
      value: ms(s?.medianIntervalMs ?? null),
      meaning: "the usual gap between two presses",
    },
    {
      label: "Spread",
      value: ms(s?.spreadMs ?? null),
      meaning: "how uneven those gaps are",
    },
    {
      label: "Longer pauses",
      value: ms(s?.p95PauseMs ?? null),
      meaning: "1 in 20 gaps is this long or longer",
    },
    {
      label: "Hold time",
      value: ms(s?.medianHoldMs ?? null),
      meaning: "how long a key is usually held down",
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

function sessionFromBox(end: TypingSessionEnd, startedAt: Date) {
  const s = end.stats;
  return {
    id: `box-${startedAt.getTime()}-${newId().slice(0, 8)}`,
    date: dayKey(startedAt),
    measuredIn: "box" as const,
    windowSec: Math.max(0, (end.lastMs - end.firstMs) / 1000),
    presses: s.presses,
    medianIntervalMs: s.medianIntervalMs,
    spreadMs: s.spreadMs,
    p95PauseMs: s.p95PauseMs,
    medianHoldMs: s.medianHoldMs,
    source: "user" as const,
    savedAt: new Date().toISOString(),
  };
}

/** The in-app text box: its key timings feed the same calculation. The text is never stored. */
function useBoxMeter(paused: boolean) {
  const collector = useRef(new TypingCollector());
  const startedAt = useRef<Date | null>(null);
  const [stats, setStats] = useState<TypingStats | null>(null);
  const [typing, setTyping] = useState(false);

  const endSession = useCallback(() => {
    const end = collector.current.endNow();
    if (end && startedAt.current) saveTypingSessions([sessionFromBox(end, startedAt.current)]);
    startedAt.current = null;
  }, []);

  useEffect(() => {
    const id = window.setInterval(() => {
      const now = performance.now();
      const c = collector.current;
      const last = c.lastPress();
      const isTyping = last !== null && now - last <= RECENT_MS;
      setTyping(isTyping);
      if (last !== null) setStats(c.live(now, LIVE_WINDOW_MS));
      const end = c.endIfIdle(now);
      if (end && startedAt.current) {
        saveTypingSessions([sessionFromBox(end, startedAt.current)]);
        startedAt.current = null;
      }
    }, 1000);
    return () => {
      window.clearInterval(id);
      endSession();
    };
  }, [endSession]);

  useEffect(() => {
    if (paused) endSession();
  }, [paused, endSession]);

  // Only the moment is used. Which key it was is never read.
  const onKeyDown = (e: React.KeyboardEvent) => {
    if (paused || e.repeat) return;
    if (!startedAt.current) startedAt.current = new Date();
    collector.current.keyDown(performance.now());
  };
  const onKeyUp = () => {
    if (paused) return;
    collector.current.keyUp(performance.now());
  };

  return { stats, typing, onKeyDown, onKeyUp };
}

export default function LivePage() {
  const data = useData();
  const ready = useRequireProfile(data);
  if (!data || !ready) return null;
  return <LiveView sessionsSaved={data.typingSessions.filter((t) => t.source === "user").length} />;
}

function LiveView({ sessionsSaved }: { sessionsSaved: number }) {
  const { desktop, status, live, setStatus } = useDesktopTyping();
  const computer = desktop && status?.listener === "running";
  const [boxPaused, setBoxPaused] = useState(false);
  const paused = computer ? !!status?.paused : boxPaused;
  const box = useBoxMeter(computer || boxPaused);
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
            {notice ?? "Only the timing of key presses is used, never which keys or what you write."}
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
            <Disclosure label="Your day, saved sessions and more" title="Your day, saved sessions and more">
              {permissionNeeded && (
                <p>
                  To measure typing rhythm across the whole computer, macOS needs you to allow Cheer Pressure under{" "}
                  <strong>Privacy &amp; Security, Input Monitoring</strong>. It still only sees when a key goes down and
                  up, never which key. If it still says this after you allowed it, quit Cheer Pressure from the menu bar
                  and open it again.
                </p>
              )}
              <p>Gaps between key presses longer than 5 seconds are left out of the numbers.</p>
              <p>
                When typing stops for 5 minutes, the numbers for that stretch are saved as one session (only the
                numbers). {sessionsSaved > 0 ? `${sessionsSaved} saved so far. ` : ""}Their spread shows up in{" "}
                <Link href="/trends/">Your own level</Link>.
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
            <Link href="/" className="btn btn-quiet">
              Back to home
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
        <h2 id="numbers-title">The last minute</h2>
        <p className="small muted" aria-live="polite">
          {paused
            ? "Measuring is paused."
            : typingNow
              ? "Typing now. The numbers update every second."
              : stats && stats.presses > 0
                ? "Not typing right now. The numbers show the last minute."
                : computer
                  ? "Start typing anywhere and the numbers appear here."
                  : "Type in the box and the numbers appear."}
        </p>
        <Numbers stats={stats} />
      </section>
    </Screen>
  );
}

function RobotConnect() {
  const [support] = useState(() => (typeof window === "undefined" ? null : robotSupport()));
  const robot = useRef<Robot | null>(null);
  const [state, setState] = useState<"idle" | "connecting" | "connected" | "failed">("idle");

  useEffect(() => () => void robot.current?.disconnect(), []);

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
              robot.current = getRobot();
              await robot.current.connect();
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
