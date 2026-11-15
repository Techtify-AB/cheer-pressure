"use client";

// The daily hello: a short conversation WITH the camera, 20 to 40 seconds, opened from the
// phone's notification, the desktop bubble or Home. Cheri asks one thing, "How are you today?".
//
// - Talk: hold the button. The microphone is on only while held ("Microphone on"). In the phone
//   app, when it can turn speech into text (lib/phoneBridge.ts listen.start / listen.stop), the
//   person's words are shown, checked for crisis words, and answered (converse, or a short
//   pre-written reply chosen through lib/brain.ts). Without that, a hold is followed by one tap.
// - Or one tap: Good / Okay / Not so good. Always there; the fallback for everything.
// - The camera: on only after a tap, with a small self-view the person can hide ("Camera on").
//   Face movement goes through lib/camera/faceModel.ts; tone of voice through lib/voice. Both are
//   optional and skipped cleanly when refused, missing or silent. Numbers only, stored per day as
//   this person's own values (lib/hello.ts): until two weeks of them exist it says it is still
//   learning. Never a picture, a sound or the words.
// - Cheri ends it herself within about 40 seconds, and everything is released.
// - Stored in the same place as the daily question on Home and the desktop bubble
//   (dailyAnswers), so a day answered anywhere is never asked again.
// - An optional reaction check (Experimental) may follow, at most twice a week (lib/hello.ts).

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useRef, useState } from "react";
import { Companion, type CompanionState } from "@/components/companion/Companion";
import { CrisisCard } from "@/components/CrisisCard";
import { ReactionCheck } from "@/components/activities/ReactionCheck";
import { Screen } from "@/components/Screen";
import { useCompanionVoice, useRequireProfile, useToday } from "@/components/hooks";
import { brain } from "@/lib/brain";
import { createFaceModel, type FaceModel, type FaceReadings } from "@/lib/camera/faceModel";
import { CameraStartError, startPose, type PoseHandle } from "@/lib/camera/pose";
import { containsCrisisWords } from "@/lib/crisis";
import { ANSWERS, QUESTION } from "@/lib/daily";
import { answeredOn, HELLO_MAX_MS, HOLD_MAX_MS, reactionOffered } from "@/lib/hello";
import { converse, listenStart, listenStop, onTranscript, speakOnPhone, voiceFeatures, type VoiceFeatures } from "@/lib/phoneBridge";
import { readData, saveDailyAnswer, saveHelloReading, saveSettings, useData } from "@/lib/storage";
import type { AppData, DailyAnswerValue, HelloReading } from "@/lib/types";
import { createToneTracker, type ToneTracker } from "@/lib/voice/tone";
import { startMic, type MicHandle } from "@/lib/voice/mic";

type Phase = "ask" | "holding" | "thinking" | "tap-after-talk" | "reply" | "reaction" | "ended" | "crisis" | "already";
type CamState = "off" | "starting" | "on" | "refused" | "unavailable";
type MicState = "off" | "on" | "refused" | "silent" | "heard";

/** A hold shorter than this is a tap on the button, not talking. */
const MIN_HOLD_MS = 600;
/** Talking shorter than this is "silent": tone is skipped. */
const MIN_SPEAKING_S = 1.5;
/** The reply stays this long before Cheri closes the hello. */
const REPLY_MS = 7000;

/** Milliseconds for timing a hold (only ever called from event handlers). */
function clock(): number {
  return performance.now();
}

export default function HelloPage() {
  const data = useData();
  const ready = useRequireProfile(data);
  if (!data || !ready) return null;
  return <Hello data={data} />;
}

function Hello({ data }: { data: AppData }) {
  const router = useRouter();
  const today = useToday();
  const voice = useCompanionVoice();
  const [phase, setPhase] = useState<Phase>(() => (answeredOn(data, today) ? "already" : "ask"));
  const [cam, setCam] = useState<CamState>("off");
  const [selfHidden, setSelfHidden] = useState(false);
  const [mic, setMic] = useState<MicState>("off");
  const [words, setWords] = useState("");
  const [reply, setReply] = useState("");
  const [features, setFeatures] = useState<VoiceFeatures>({ listen: false, converse: false, speak: false });
  const [offerReaction, setOfferReaction] = useState(false);

  const video = useRef<HTMLVideoElement>(null);
  const pose = useRef<PoseHandle | null>(null);
  const model = useRef<FaceModel | null>(null);
  const face = useRef<FaceReadings | null>(null);
  const micHandle = useRef<MicHandle | null>(null);
  const tone = useRef<ToneTracker | null>(null);
  const holdStart = useRef<number | null>(null);
  const holdTimer = useRef<number | null>(null);
  const heldMs = useRef(0);
  const camToken = useRef(0);
  const done = useRef(false);

  useEffect(() => {
    void voiceFeatures().then(setFeatures);
  }, []);
  useEffect(() => onTranscript((t) => setWords(t.text)), []);

  const stopCam = useCallback(() => {
    camToken.current++;
    pose.current?.stop();
    pose.current = null;
    model.current?.dispose();
    model.current = null;
    setCam((c) => (c === "on" || c === "starting" ? "off" : c));
  }, []);

  const stopMic = useCallback(() => {
    micHandle.current?.stop();
    micHandle.current = null;
    if (holdTimer.current) window.clearTimeout(holdTimer.current);
    holdTimer.current = null;
  }, []);

  /** Everything off: camera, microphone, the phone's listening, the voice. */
  const release = useCallback(() => {
    stopCam();
    stopMic();
    if (features.listen) void listenStop().catch(() => {});
  }, [features.listen, stopCam, stopMic]);

  useEffect(() => () => {
    camToken.current++;
    pose.current?.stop();
    model.current?.dispose();
    micHandle.current?.stop();
  }, []);

  const startCam = async () => {
    if (!video.current || cam === "starting" || cam === "on") return;
    const token = ++camToken.current;
    setCam("starting");
    saveSettings({ helloSensors: true });
    const m = createFaceModel();
    try {
      await m.init();
      const handle = await startPose(video.current, {
        onFrame: (_frame, f) => {
          if (!f) return;
          const r = m.read({ t: f.t, frame: video.current, landmarks: null, blendshapes: f.shapes });
          if (r) face.current = r;
        },
        onEnded: () => stopCam(),
        isCancelled: () => token !== camToken.current,
      });
      if (token !== camToken.current) {
        handle.stop();
        return;
      }
      pose.current = handle;
      model.current = m;
      setCam("on");
    } catch (e) {
      m.dispose();
      if (token !== camToken.current) return;
      setCam(e instanceof CameraStartError && e.reason === "denied" ? "refused" : "unavailable");
    }
  };

  /** The tone of voice from this hello, or null when refused or silent. */
  const toneReading = (): HelloReading["tone"] => {
    const t = tone.current;
    if (!t) return null;
    const live = t.live();
    const speakingS = live.speakingMinutes * 60;
    if (speakingS < MIN_SPEAKING_S) return null;
    const readings: Record<string, number> = {};
    if (live.pitchVariability !== null) readings.pitchVariability = Math.round(live.pitchVariability * 100) / 100;
    if (live.segmentsPerMinute !== null) readings.segmentsPerMinute = Math.round(live.segmentsPerMinute * 10) / 10;
    return Object.keys(readings).length ? { readings, confidence: Math.min(1, speakingS / 10) } : null;
  };

  const say = (text: string) => {
    if (features.speak) void speakOnPhone(text).catch(() => voice.say(text));
    else voice.say(text);
  };

  /** Ends the hello with the person's answer (a tap, or their words), stores it and replies. */
  const finish = async (answer: DailyAnswerValue | null, said: string | null) => {
    if (done.current) return;
    done.current = true;
    const readingFace = face.current && model.current ? { ...face.current, model: model.current.name } : face.current ? { ...face.current, model: "expression-v1" } : null;
    const readingTone = toneReading();
    release();
    const offer = reactionOffered(readData(), today);
    const reading: HelloReading = {
      date: today,
      at: new Date().toISOString(),
      seconds: Math.round(heldMs.current / 100) / 10,
      face: readingFace,
      tone: readingTone,
      reactionOffered: offer,
      source: "user",
    };
    saveDailyAnswer({ date: today, answer, dismissed: false, at: reading.at, source: "user" });
    saveHelloReading(reading);
    // The hello only asks how the person is. What the camera and the microphone read is saved
    // for "My values" and is never said back here; talking about measurements is Cheri asks.
    let text = "";
    if (said && features.converse) {
      text = (await converse(said, { answer, observation: null }).catch(() => null))?.text ?? "";
    }
    if (!text) text = await brain.helloReply({ today, answer, words: said, observation: null });
    setReply(text);
    setOfferReaction(offer);
    setPhase("reply");
    say(text);
  };

  // Cheri ends it herself within about 40 seconds: without an answer it counts as "not today".
  useEffect(() => {
    if (phase === "already") return;
    const t = window.setTimeout(() => {
      if (done.current) return;
      done.current = true;
      release();
      saveDailyAnswer({ date: today, answer: null, dismissed: true, at: new Date().toISOString(), source: "user" });
      setReply("That's all for now. I'll say hello another day.");
      setPhase("ended");
    }, HELLO_MAX_MS);
    return () => window.clearTimeout(t);
    // Once per visit: the timer starts when the screen opens.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // The reply stays a few seconds, then Cheri closes the hello (unless the reaction check is offered).
  useEffect(() => {
    if ((phase !== "reply" || offerReaction) && phase !== "ended") return;
    const t = window.setTimeout(() => router.push("/"), REPLY_MS);
    return () => window.clearTimeout(t);
  }, [phase, offerReaction, router]);

  const startHold = async () => {
    if (phase !== "ask" && phase !== "tap-after-talk") return;
    voice.quiet();
    setPhase("holding");
    setWords("");
    holdStart.current = clock();
    holdTimer.current = window.setTimeout(() => void endHold(), HOLD_MAX_MS);
    if (features.listen) void listenStart().catch(() => {});
    if (mic === "refused") return;
    try {
      tone.current ??= createToneTracker({ source: "computer", startedAt: Date.now() });
      const tracker = tone.current;
      micHandle.current = await startMic({ onFrame: (f) => tracker.push(f) });
      // Released while the microphone was still starting.
      if (holdStart.current === null) stopMic();
      else setMic("on");
    } catch {
      setMic("refused");
    }
  };

  const endHold = async () => {
    if (holdStart.current === null) return;
    const ms = clock() - holdStart.current;
    holdStart.current = null;
    heldMs.current += ms;
    stopMic();
    let said = words;
    if (features.listen) said = (await listenStop().catch(() => null))?.text ?? said;
    said = said.trim();
    const t = toneReading();
    setMic((m) => (m === "refused" ? m : t ? "heard" : "silent"));
    if (said && containsCrisisWords(said)) {
      done.current = true;
      release();
      setPhase("crisis");
      return;
    }
    if (said) {
      setWords(said);
      setPhase("thinking");
      await finish(null, said);
      return;
    }
    if (ms < MIN_HOLD_MS) {
      setPhase("ask");
      return;
    }
    setPhase("tap-after-talk");
  };

  // Enter anywhere on the page starts talking, and Enter again stops (a toggle, so nobody has to
  // hold a key). Space on the focused button still works as hold-to-talk.
  const keyTalk = useRef({ startHold, endHold, canTalk: true, phase });
  useEffect(() => {
    keyTalk.current = { startHold, endHold, canTalk: mic !== "refused" || features.listen, phase };
  });
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== "Enter" || e.repeat || e.metaKey || e.ctrlKey || e.altKey) return;
      const el = e.target as HTMLElement | null;
      const typing = el?.closest("input, textarea, select, [contenteditable='true']");
      const otherButton = el?.closest("button, a") && !el.closest(".hold-button");
      if (typing || otherButton) return;
      const k = keyTalk.current;
      if (!k.canTalk) return;
      if (k.phase === "holding") {
        e.preventDefault();
        void k.endHold();
      } else if (k.phase === "ask" || k.phase === "tap-after-talk") {
        e.preventDefault();
        void k.startHold();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  const notToday = () => {
    done.current = true;
    release();
    saveDailyAnswer({ date: today, answer: null, dismissed: true, at: new Date().toISOString(), source: "user" });
    router.push("/");
  };

  const companionState: CompanionState =
    phase === "holding" ? "listening" : voice.state === "speaking" ? "speaking" : phase === "reply" ? "joy" : phase === "thinking" ? "attention" : "idle";

  // The self-view and the video MediaPipe reads. Always in the page, so the camera has somewhere
  // to go; hidden by the person, it keeps running but shows nothing.
  const feed = (
    <video
      ref={video}
      className={cam === "on" && !selfHidden ? "hello-self" : "hello-feed"}
      muted
      playsInline
      aria-label={cam === "on" ? "You, seen by the camera. Nothing is recorded." : undefined}
      aria-hidden={cam !== "on" || selfHidden}
    />
  );

  if (phase === "already") {
    return (
      <Screen
        lead={
          <div className="hello-hero">
            <Companion state="joy" size={180} />
            <p className="calm-line">We&apos;ve already said hello today. See you next time.</p>
          </div>
        }
        actions={
          <Link href="/" className="btn btn-primary">
            Back to home
          </Link>
        }
      />
    );
  }

  if (phase === "crisis") {
    return (
      <Screen
        lead={<h1 className="item-title">You don&apos;t have to handle this alone</h1>}
        actions={
          <Link href="/" className="btn btn-primary">
            Back to home
          </Link>
        }
      >
        <CrisisCard />
      </Screen>
    );
  }

  if (phase === "reaction") {
    return (
      <Screen
        lead={<p className="small muted">One last thing, if you like</p>}
        actions={
          <div className="links">
            <Link href="/" className="btn btn-quiet">
              Done
            </Link>
          </div>
        }
      >
        <ReactionCheck context="hello" />
      </Screen>
    );
  }

  if (phase === "reply" || phase === "ended") {
    return (
      <Screen
        lead={
          <div className="hello-hero">
            <Companion state={companionState} size={180} />
            {words && phase === "reply" && <p className="small muted hello-words">You said: &ldquo;{words}&rdquo;</p>}
            <p className="calm-line" aria-live="polite">
              {reply}
            </p>
            <p className="small muted" role="status">
              Camera and microphone are off.
            </p>
          </div>
        }
        actions={
          offerReaction && phase === "reply" ? (
            <>
              <button type="button" className="btn btn-secondary" onClick={() => setPhase("reaction")}>
                A 15-second reaction check
              </button>
              <div className="links">
                <Link href="/" className="btn btn-quiet">
                  Skip, I&apos;m done
                </Link>
              </div>
            </>
          ) : (
            <Link href="/" className="btn btn-primary">
              Bye for now
            </Link>
          )
        }
      />
    );
  }

  const holding = phase === "holding";
  const line =
    phase === "tap-after-talk"
      ? "Thanks. And in one tap?"
      : phase === "thinking"
        ? "Let me think."
        : holding
          ? features.listen
            ? "I'm listening."
            : "I'm listening. Let go when you're done."
          : QUESTION;
  const canTalk = mic !== "refused" || features.listen;


  return (
    <Screen
      lead={
        <div className="hello-hero">
          <Companion state={companionState} size={170} />
          <h1 className="calm-line daily-question" aria-live="polite">
            {line}
          </h1>
          {holding && words && <p className="small hello-words">&ldquo;{words}&rdquo;</p>}
          <div className="hello-sensors" role="status">
            <span className="sensor-chip" data-on={cam === "on" || undefined}>
              {cam === "on" ? "Camera on" : cam === "starting" ? "Camera starting" : cam === "refused" ? "Camera not allowed" : cam === "unavailable" ? "No camera here" : "Camera off"}
            </span>
            <span className="sensor-chip" data-on={mic === "on" || undefined}>
              {mic === "on" ? "Microphone on" : mic === "refused" ? "Microphone not allowed" : "Microphone off"}
            </span>
          </div>
          {mic === "silent" && phase === "tap-after-talk" && <p className="small muted">I couldn&apos;t hear much, so I skipped your voice. That&apos;s fine.</p>}
        </div>
      }
      actions={
        <>
          {canTalk && phase !== "thinking" && (
            <button
              type="button"
              className="btn btn-primary hold-button"
              data-holding={holding || undefined}
              aria-pressed={holding}
              onPointerDown={(e) => {
                e.currentTarget.setPointerCapture?.(e.pointerId);
                void startHold();
              }}
              onPointerUp={() => void endHold()}
              onPointerCancel={() => void endHold()}
              onKeyDown={(e) => {
                if (e.key === " " && !e.repeat) {
                  e.preventDefault();
                  void startHold();
                }
              }}
              onKeyUp={(e) => {
                if (e.key === " ") void endHold();
              }}
              onContextMenu={(e) => e.preventDefault()}
            >
              {holding ? "Let go (or press Enter) when you're done" : "Hold to talk, or press Enter"}
            </button>
          )}
          <div className="options options-row" role="group" aria-label="Or in one tap">
            {ANSWERS.map((a) => (
              <button key={a.value} type="button" className="option" disabled={holding || phase === "thinking"} onClick={() => void finish(a.value, null)}>
                <span>{a.label}</span>
              </button>
            ))}
          </div>
          <div className="links">
            <button type="button" className="btn btn-quiet" onClick={notToday}>
              Not today
            </button>
            {cam === "on" ? (
              <>
                <button type="button" className="btn btn-quiet" onClick={() => setSelfHidden((h) => !h)}>
                  {selfHidden ? "Show me" : "Hide me"}
                </button>
                <button type="button" className="btn btn-quiet" onClick={stopCam}>
                  Camera off
                </button>
              </>
            ) : cam !== "unavailable" && cam !== "refused" ? (
              <button type="button" className="btn btn-quiet" onClick={() => void startCam()} disabled={cam === "starting"}>
                Use the camera
              </button>
            ) : null}
          </div>
        </>
      }
    >
      {feed}
    </Screen>
  );
}
