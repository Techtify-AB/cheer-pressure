"use client";

// Today's hello, recorded for the demo: a written-down conversation between Cheri and a made-up
// person, played back line by line. Nothing is listened to and nothing is measured here. The
// lines follow the rules for what Cheri may say: observations against the person's own usual,
// no advice of her own, no score, and the one offer comes from the person's own list.

import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import { Companion } from "@/components/companion/Companion";
import { Screen } from "@/components/Screen";

type Line = { who: "cheri" | "person"; text: string };

const LINES: Line[] = [
  { who: "cheri", text: "Hello. Your nights have been shorter than your usual this week, and you have walked less. How are you today?" },
  { who: "person", text: "Not great. I am sleeping badly again, like before the treatment." },
  { who: "cheri", text: "Thank you for telling me. That sounds heavy." },
  { who: "cheri", text: "A short walk before lunch has been followed by better days for you before. Would you like to try one today?" },
  { who: "person", text: "Okay. I can do that." },
  { who: "cheri", text: "Good. I will ask tomorrow whether it helped. That was today’s hello." },
];

const WORD_MS = 190;
const PAUSE_MS = 900;

export default function RecordedHelloPage() {
  const [line, setLine] = useState(-1);
  const [words, setWords] = useState(0);
  const [sound, setSound] = useState(false);
  const soundRef = useRef(false);
  const playing = line >= 0 && line < LINES.length;
  const done = line >= LINES.length;

  useEffect(() => {
    soundRef.current = sound;
    if (!sound && typeof window !== "undefined") window.speechSynthesis?.cancel();
  }, [sound]);

  // One word at a time, then a short pause, then the next line.
  useEffect(() => {
    if (!playing) return;
    const total = LINES[line].text.split(" ").length;
    if (words === 0 && LINES[line].who === "cheri" && soundRef.current && window.speechSynthesis) {
      const u = new SpeechSynthesisUtterance(LINES[line].text);
      u.lang = "en-GB";
      u.rate = 0.95;
      window.speechSynthesis.speak(u);
    }
    const t = window.setTimeout(
      () => {
        if (words < total) setWords(words + 1);
        else {
          setLine(line + 1);
          setWords(0);
        }
      },
      words < total ? WORD_MS : PAUSE_MS,
    );
    return () => window.clearTimeout(t);
  }, [playing, line, words]);

  useEffect(() => () => window.speechSynthesis?.cancel(), []);

  const start = () => {
    window.speechSynthesis?.cancel();
    setWords(0);
    setLine(0);
  };

  const shown = LINES.slice(0, Math.min(line + 1, LINES.length));
  const speaker = playing ? LINES[line].who : null;

  return (
    <Screen
      lead={
        <div className="home-hero">
          <Companion state={speaker === "cheri" ? "speaking" : speaker === "person" ? "listening" : "idle"} size={150} />
          <span className="placeholder-tag">Recorded for the demo</span>
        </div>
      }
      actions={
        <>
          {!playing && (
            <button type="button" className="btn btn-primary" onClick={start}>
              {done ? "Play it again" : "Play today’s hello"}
            </button>
          )}
          <div className="links">
            <button type="button" className="btn btn-quiet" aria-pressed={sound} onClick={() => setSound(!sound)}>
              {sound ? "Sound is on" : "Turn sound on"}
            </button>
            <Link href="/" className="btn btn-quiet">
              Home
            </Link>
          </div>
        </>
      }
    >
      <div className="hello-script" aria-live="polite">
        {line < 0 && (
          <p className="muted">
            Once a day Cheri says hello, for about half a minute. This one is written down and played back, so you can
            see it without talking to a phone.
          </p>
        )}
        {shown.map((l, i) => {
          const text = i === line ? l.text.split(" ").slice(0, words).join(" ") : l.text;
          return (
            <p key={i} className="hello-line" data-who={l.who}>
              <span className="hello-who">{l.who === "cheri" ? "Cheri" : "They said"}</span>
              {text}
            </p>
          );
        })}
      </div>
    </Screen>
  );
}
