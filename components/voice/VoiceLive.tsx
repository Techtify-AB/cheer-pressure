"use client";

// "Voice, live": how the voice sounds, never what is said. The microphone never starts by
// itself; while it is on, "Microphone on" is always shown. Three panels: pace, how much the
// pitch moves, and loudness, each with one plain line saying what it means. Behaviour only:
// the screen never names a feeling or gives a verdict about the person.

import Link from "next/link";
import { useEffect } from "react";
import { Screen } from "@/components/Screen";
import { playVoiceExample, resetVoice, startListening, stopListening, stopVoiceExample, type VoiceView } from "@/lib/voice/index";
import cam from "@/components/camera/camera.module.css";
import { useVoice } from "./useVoice";
import s from "./voice.module.css";

const FAILED = new Set(["denied", "no-mic", "in-use", "unsupported", "failed"]);

function leadLine(v: VoiceView): string {
  switch (v.phase) {
    case "starting":
      return "Starting the microphone.";
    case "on":
      return v.live.voiceNow ? "I can hear a voice. Only how it sounds is worked out, never the words." : "No voice right now.";
    case "example":
      return v.exampleDone
        ? "That was the whole example: lively talking first, then slower, quieter and flatter."
        : "Made-up talking, about 30 seconds. Nothing is played and nothing comes from a microphone.";
    case "denied":
      return "The microphone was not allowed, so nothing is measured here.";
    case "no-mic":
      return "There is no microphone on this computer, so nothing is measured here.";
    case "in-use":
      return "The microphone is busy in another app, so nothing is measured here.";
    case "unsupported":
    case "failed":
      return "Listening could not start on this computer, so nothing is measured here.";
    default:
      if (v.lastStopMinutes !== null && v.lastStopMinutes > 0) return "The microphone is off.";
      return "I can notice how your voice sounds: its pace, how much the pitch moves and how loud it is, compared with your own usual. Never the words.";
  }
}

function pitchWords(st: number): string {
  if (st < 0.8) return "Moves little";
  if (st < 2) return "Moves some";
  return "Moves a lot";
}

export function VoiceLive() {
  const v = useVoice();
  const failed = FAILED.has(v.phase);
  const running = v.phase === "on" || v.phase === "starting";
  const example = v.phase === "example";
  const active = v.phase === "on" || example;
  const l = v.live;
  const waiting = active ? "Waiting for a voice" : "Off";

  useEffect(() => () => resetVoice(), []);

  return (
    <Screen
      lead={
        <>
          <div className={cam.leadRow}>
            <h1 className={cam.title}>Voice, live</h1>
            {running && (
              <span className={cam.onPill} role="status" data-mic-on="">
                <span className={cam.onDot} aria-hidden="true" />
                Microphone on
              </span>
            )}
            {example && (
              <span className={cam.examplePill} role="status">
                Example, not live
              </span>
            )}
          </div>
          <p className={cam.line} aria-live="polite" data-phase={v.phase}>
            {leadLine(v)}
          </p>
        </>
      }
      actions={
        <>
          {!failed && (
            <>
              {running ? (
                <button type="button" className="btn btn-primary" onClick={stopListening}>
                  Stop listening
                </button>
              ) : (
                <button type="button" className="btn btn-primary" onClick={() => void startListening()}>
                  Start listening
                </button>
              )}
              <p className={cam.privacy}>The sound is worked out on this computer. Nothing is stored or sent, and no words are picked out.</p>
            </>
          )}
          <div className="links">
            {!failed &&
              !running &&
              (example ? (
                <button type="button" className={`btn btn-quiet ${cam.exampleLink}`} onClick={stopVoiceExample}>
                  {v.exampleDone ? "Close the example" : "Stop the example"}
                </button>
              ) : (
                <button type="button" className={`btn btn-quiet ${cam.exampleLink}`} onClick={playVoiceExample}>
                  Play a recorded example
                </button>
              ))}
            <Link href="/demo/" className="btn btn-quiet">
              Back to the demo
            </Link>
          </div>
        </>
      }
    >
      {!failed && (
        <>
          <div className={`card ${s.levelCard}`} data-frames={v.frames} data-voice-now={active && l.voiceNow ? "yes" : "no"}>
            <div className={s.levelHead}>
              <span className={cam.panelLabel}>Sound right now</span>
              <span className={s.voiceTag} data-on={(active && l.voiceNow) || undefined}>
                {!active ? "Off" : l.voiceNow ? "Voice" : "No voice"}
              </span>
            </div>
            <div
              className={`${cam.meter} ${s.level}`}
              role="meter"
              aria-label="Sound level"
              aria-valuemin={0}
              aria-valuemax={100}
              aria-valuenow={active ? l.level : 0}
              data-meter="level"
              data-value={active ? l.level : 0}
            >
              <span className={cam.meterFill} style={{ width: `${active ? l.level : 0}%` }} />
            </div>
            <p className={cam.meaning}>How loud the room is to this microphone, voice or not.</p>
          </div>

          <div className={cam.panels} data-active={active || undefined}>
            <section className={`card ${cam.panel}`} aria-label="Pace">
              <h2 className={cam.panelLabel}>Pace</h2>
              <p className={cam.panelNumber} data-pace={active && l.segmentsPerMinute !== null ? Math.round(l.segmentsPerMinute) : undefined}>
                {active && l.segmentsPerMinute !== null ? Math.round(l.segmentsPerMinute) : " "}
              </p>
              <p className={cam.panelValue}>{active && l.segmentsPerMinute !== null ? "a minute" : waiting}</p>
              <p className={cam.meaning}>Stretches of voice per minute of talking, a rough measure of pace.</p>
            </section>
            <section className={`card ${cam.panel}`} aria-label="Pitch">
              <h2 className={cam.panelLabel}>Pitch</h2>
              <p className={cam.panelNumber} data-pitch={active && l.pitchVariability !== null ? l.pitchVariability.toFixed(1) : undefined}>
                {active && l.pitchVariability !== null ? l.pitchVariability.toFixed(1) : " "}
              </p>
              <p className={cam.panelValue}>
                {active && l.pitchVariability !== null ? `semitones, ${pitchWords(l.pitchVariability).toLowerCase()}` : waiting}
              </p>
              <p className={cam.meaning}>How much your pitch moves up and down. A flat voice moves little.</p>
            </section>
            <section className={`card ${cam.panel}`} aria-label="Loudness">
              <h2 className={cam.panelLabel}>Loudness</h2>
              <p className={cam.panelNumber} data-loudness={active && l.loudnessDb !== null ? Math.round(l.loudnessDb) : undefined}>
                {active && l.loudnessDb !== null ? Math.round(l.loudnessDb) : " "}
              </p>
              <p className={cam.panelValue}>{active && l.loudnessDb !== null ? "dB" : waiting}</p>
              <p className={cam.meaning}>How loud your voice is to this microphone. 0 is the loudest it can hear.</p>
            </section>
          </div>
        </>
      )}
    </Screen>
  );
}
