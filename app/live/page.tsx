"use client";

import Link from "next/link";
import { useCallback, useEffect, useRef, useState } from "react";
import { useDesktopTyping } from "@/components/desktop";
import { useRequireProfile } from "@/components/hooks";
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
      meaning: "How many keys were pressed in the last minute.",
    },
    {
      label: "Time between presses",
      value: ms(s?.medianIntervalMs ?? null),
      meaning: "The usual time from one key press to the next.",
    },
    {
      label: "Spread",
      value: ms(s?.spreadMs ?? null),
      meaning: "How uneven that time is. Higher means more uneven.",
    },
    {
      label: "Longer pauses",
      value: ms(s?.p95PauseMs ?? null),
      meaning: "1 in 20 gaps is this long or longer. Breaks over 5 seconds are left out.",
    },
    {
      label: "Hold time",
      value: ms(s?.medianHoldMs ?? null),
      meaning: "How long a key is usually held down.",
    },
  ];
  return (
    <dl className="live-numbers">
      {rows.map((r) => (
        <div key={r.label}>
          <dt>{r.label}</dt>
          <dd className="live-value">{r.value}</dd>
          <dd className="small muted">{r.meaning}</dd>
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
  const todayRow = days.find((d) => d.date === today);

  let sourceText: string;
  if (paused) sourceText = "Paused. Nothing is being measured.";
  else if (computer) sourceText = "Measuring across the whole computer";
  else sourceText = "Measuring only in this box";

  return (
    <div className="stack-lg">
      <div>
        <h1>Live view</h1>
        <p className="muted" style={{ marginBottom: 0 }}>
          Your typing rhythm right now. Only the timing of key presses is used, never which keys or what you write.
        </p>
      </div>

      <div className="live-source">
        <span className={paused ? "status" : "status status-done"} role="status">
          <span className="status-dot" aria-hidden="true" />
          {sourceText}
        </span>
        <button type="button" className="btn btn-secondary" onClick={togglePause} aria-pressed={paused}>
          {paused ? "Resume measuring" : "Pause measuring"}
        </button>
      </div>

      {desktop && status?.listener === "permission-needed" && (
        <section className="card stack" aria-labelledby="perm-title">
          <h2 id="perm-title" style={{ fontSize: "var(--font-size-lg)", marginBottom: 0 }}>
            Permission needed
          </h2>
          <p style={{ marginBottom: 0 }}>
            To measure typing rhythm across the whole computer, macOS needs you to allow Cheer Pressure under{" "}
            <strong>Privacy &amp; Security, Input Monitoring</strong>. It still only sees when a key goes down and up,
            never which key. Until then, the box below measures only what you type in it.
          </p>
          <div className="btn-row">
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
          <p className="small muted" style={{ marginBottom: 0 }}>
            If it still says this after you allowed it, quit Cheer Pressure from the menu bar and open it again.
          </p>
        </section>
      )}

      {desktop && status && (status.listener === "unsupported" || status.listener === "error") && (
        <p className="notice">
          {status.listener === "unsupported"
            ? "Measuring across the whole computer works on macOS only for now. The box below works everywhere."
            : "Measuring across the whole computer did not start. The box below still works."}
        </p>
      )}

      {!computer && (
        <div className="field">
          <label htmlFor="typing-box">Type anything here</label>
          <textarea
            id="typing-box"
            autoComplete="off"
            autoCorrect="off"
            autoCapitalize="off"
            spellCheck={false}
            placeholder="For example, what you did this morning. Only the timing is used, and the text is never stored."
            onKeyDown={box.onKeyDown}
            onKeyUp={box.onKeyUp}
          />
        </div>
      )}

      <section className="card stack" aria-labelledby="numbers-title">
        <div>
          <h2 id="numbers-title" style={{ fontSize: "var(--font-size-lg)", marginBottom: 2 }}>
            The last minute
          </h2>
          <p className="small muted" style={{ marginBottom: 0 }} aria-live="polite">
            {paused
              ? "Measuring is paused."
              : typingNow
                ? "Typing now. The numbers update every second."
                : stats && stats.presses > 0
                  ? "Not typing right now. The numbers show the last minute."
                  : computer
                    ? "Start typing anywhere and the numbers appear here."
                    : "Start typing in the box and the numbers appear here."}
          </p>
        </div>
        <Numbers stats={stats} />
        <p className="small muted" style={{ marginBottom: 0 }}>
          When typing stops for 5 minutes, the numbers for that stretch are saved as one session (only the numbers).{" "}
          {sessionsSaved > 0 ? `${sessionsSaved} saved so far. ` : ""}
          Their spread shows up in <Link href="/trends/">Your own level</Link>.
        </p>
      </section>

      <section className="card stack" aria-labelledby="day-title">
        <h2 id="day-title" style={{ fontSize: "var(--font-size-lg)", marginBottom: 0 }}>
          Your day
        </h2>
        {!desktop ? (
          <p className="muted" style={{ marginBottom: 0 }}>
            First and last activity of the day are measured in the desktop app.
          </p>
        ) : days.length === 0 ? (
          <p className="muted" style={{ marginBottom: 0 }}>
            Nothing yet. After your first key press today, the time shows up here.
          </p>
        ) : (
          <>
            <dl className="numbers">
              <div>
                <dt>First activity today</dt>
                <dd>{todayRow?.first ?? "Not yet"}</dd>
                <dd className="small muted">your first key press</dd>
              </div>
              <div>
                <dt>Last activity today</dt>
                <dd>{todayRow?.last ?? "Not yet"}</dd>
                <dd className="small muted">your latest key press</dd>
              </div>
            </dl>
            <table className="day-table">
              <caption className="sr-only">First and last activity, recent days</caption>
              <thead>
                <tr>
                  <th scope="col">Day</th>
                  <th scope="col">First</th>
                  <th scope="col">Last</th>
                </tr>
              </thead>
              <tbody>
                {days.slice(0, 7).map((d) => (
                  <tr key={d.date}>
                    <th scope="row">{formatDay(d.date)}</th>
                    <td>{d.first}</td>
                    <td>{d.last}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </>
        )}
      </section>

      <RobotConnect />
    </div>
  );
}

function RobotConnect() {
  const [support] = useState(() => (typeof window === "undefined" ? null : robotSupport()));
  const robot = useRef<Robot | null>(null);
  const [state, setState] = useState<"idle" | "connecting" | "connected" | "failed">("idle");

  useEffect(() => () => void robot.current?.disconnect(), []);

  if (!support) return null;
  return (
    <section className="stack" aria-labelledby="robot-title">
      <h2 id="robot-title" style={{ fontSize: "var(--font-size-lg)", marginBottom: 0 }}>
        Robot
      </h2>
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
