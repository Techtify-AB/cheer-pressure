"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { useRequireProfile } from "@/components/hooks";
import { deleteEverything, saveSettings, useData } from "@/lib/storage";
import { stopSpeaking } from "@/lib/voice";

export default function SettingsPage() {
  const data = useData();
  const ready = useRequireProfile(data);
  const router = useRouter();
  const [confirming, setConfirming] = useState(false);

  if (!data || !ready) return null;
  const muted = data.settings.muted;
  const counts = `${data.daily.length} daily check-ins, ${data.weekly.length} weekly answers and ${data.reaction.length} reaction tests`;

  return (
    <div className="stack-lg">
      <h1>Your data and settings</h1>

      <section className="card stack" aria-labelledby="where-title">
        <h2 id="where-title" style={{ fontSize: "var(--font-size-lg)", margin: 0 }}>
          Where your answers are
        </h2>
        <p style={{ margin: 0 }}>
          Only in this browser, on this device. There is no account and no login, and nothing is sent anywhere.
          Right now that is {counts}.
        </p>
        {data.profile?.earlySigns.length ? (
          <p className="small muted" style={{ margin: 0 }}>
            Your early signs: {data.profile.earlySigns.join(", ")}.
          </p>
        ) : null}
      </section>

      <section className="card stack" aria-labelledby="voice-title">
        <h2 id="voice-title" style={{ fontSize: "var(--font-size-lg)", margin: 0 }}>
          Voice
        </h2>
        <div>
          <p style={{ margin: 0 }}>
            <strong>Reading aloud: {muted ? "off" : "on"}.</strong> The companion can read its questions aloud using
            the voices built into your device. Only on-device voices are used, so the text is not sent anywhere.
          </p>
          <button
            type="button"
            className="btn btn-secondary"
            style={{ marginTop: "var(--space-3)" }}
            onClick={() => {
              if (!muted) stopSpeaking();
              saveSettings({ muted: !muted });
            }}
          >
            {muted ? "Turn reading aloud on" : "Mute reading aloud"}
          </button>
        </div>
        <p style={{ margin: 0 }}>
          <strong>Answering by voice: off.</strong> This version has no voice answers, so you always tap or type.
          When you read the sentence in the check-in, the microphone is used only to time how fast you read. That
          happens on this device; no sound is recorded, kept or sent.
        </p>
      </section>

      <section className="card stack" aria-labelledby="delete-title">
        <h2 id="delete-title" style={{ fontSize: "var(--font-size-lg)", margin: 0 }}>
          Delete everything
        </h2>
        <p style={{ margin: 0 }}>Removes all your answers and settings from this browser and starts over.</p>
        {!confirming ? (
          <div>
            <button type="button" className="btn btn-secondary" onClick={() => setConfirming(true)}>
              Delete everything
            </button>
          </div>
        ) : (
          <div className="stack" role="alertdialog" aria-labelledby="confirm-text">
            <p id="confirm-text" style={{ margin: 0 }}>
              <strong>Are you sure? This can&apos;t be undone.</strong>
            </p>
            <div className="btn-row">
              <button
                type="button"
                className="btn btn-danger"
                autoFocus
                onClick={() => {
                  stopSpeaking();
                  deleteEverything();
                  router.replace("/setup/");
                }}
              >
                Yes, delete everything
              </button>
              <button type="button" className="btn btn-secondary" onClick={() => setConfirming(false)}>
                Keep my data
              </button>
            </div>
          </div>
        )}
      </section>
    </div>
  );
}
