"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import Link from "next/link";
import { useRequireProfile, useVoiceAvailability } from "@/components/hooks";
import { Disclosure, Screen } from "@/components/Screen";
import { forgetDesktopData } from "@/lib/platform";
import { deleteEverything, saveSettings, useData } from "@/lib/storage";
import { stopSpeaking } from "@/lib/voice";

export default function SettingsPage() {
  const data = useData();
  const ready = useRequireProfile(data);
  const router = useRouter();
  const [confirming, setConfirming] = useState(false);
  const voice = useVoiceAvailability();

  if (!data || !ready) return null;
  const muted = data.settings.muted;
  const counts = `${data.typingSessions.length} typing sessions, ${data.activityDays.length} days of activity times, ${data.daily.length} check-ins, ${data.weekly.length} weekly answers and ${data.reaction.length} reaction tests`;

  if (confirming) {
    return (
      <Screen
        lead={
          <div role="alertdialog" aria-labelledby="confirm-text" aria-describedby="confirm-detail">
            <h1 id="confirm-text" className="item-title">
              Delete everything? This can&apos;t be undone.
            </h1>
            <p id="confirm-detail" className="muted">
              Removes all your answers, measurements and settings from this device, and you start over with setup.
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
                await forgetDesktopData();
                deleteEverything();
                router.replace("/setup/");
              }}
            >
              Yes, delete everything
            </button>
            <div className="links">
              <button type="button" className="btn btn-quiet" onClick={() => setConfirming(false)}>
                Keep my data
              </button>
            </div>
          </>
        }
      />
    );
  }

  return (
    <Screen
      lead={
        <>
          <h1 className="item-title">Your answers are only on this device</h1>
          <p className="muted">
            In this browser, with no account and no login. Nothing is sent anywhere. Right now that is {counts}.
          </p>
        </>
      }
      actions={
        <>
          {voice !== "no" && (
            <button
              type="button"
              className="btn btn-primary"
              onClick={() => {
                if (!muted) stopSpeaking();
                saveSettings({ muted: !muted });
              }}
            >
              {muted ? "Turn reading aloud on" : "Mute reading aloud"}
            </button>
          )}
          <div className="links">
            <Disclosure label="What is stored, in detail" title="What is stored, in detail">
              <p>
                Typing sessions and first and last activity are timing numbers and times of day only, never which keys
                or what you typed. Daily check-ins keep your bedtime, wake time, form, reading pace and your note if you
                wrote one. Weekly answers keep the numbers you picked.
              </p>
              {data.profile?.earlySigns.length ? <p>Your early signs: {data.profile.earlySigns.join(", ")}.</p> : null}
              <p>
                When you read the sentence in a check-in, the microphone is used only to time how fast you read. That
                happens on this device; no sound is recorded, kept or sent.
              </p>
            </Disclosure>
            <button type="button" className="btn btn-quiet" onClick={() => setConfirming(true)}>
              Delete everything
            </button>
            <Link href="/" className="btn btn-quiet">
              Back to home
            </Link>
          </div>
        </>
      }
    >
      <section className="card stack-sm" aria-labelledby="voice-title">
        <h2 id="voice-title">Voice</h2>
        {voice === "no" ? (
          <p>
            <strong>Reading aloud: not available on this device.</strong> This browser has no voice built into the
            device, and the companion never sends text elsewhere to be spoken. So it shows its text instead.
          </p>
        ) : (
          <p>
            <strong>Reading aloud: {muted ? "off" : "on"}.</strong> The companion can read its questions aloud using the
            voices built into your device, so the text is not sent anywhere.
          </p>
        )}
        <p>
          <strong>Answering by voice: off.</strong> You always tap or type. The microphone is used only if you choose to
          read a sentence aloud, and no sound leaves this device.
        </p>
      </section>
    </Screen>
  );
}
