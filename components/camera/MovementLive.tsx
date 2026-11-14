"use client";

// "Camera, live": the camera view. The camera never starts by itself. When it runs, the
// picture is shown mirrored with three points on top, and three panels: movement, how the face
// moves, and posture against the person's own first minutes. Behaviour only: the screen never
// names a feeling or gives a verdict about the person.

import Link from "next/link";
import { useEffect, useRef } from "react";
import { Screen } from "@/components/Screen";
import { playExample, resetCamera, startCamera, stopCamera, stopExample, type CameraView } from "@/lib/camera";
import { CameraPanels } from "./CameraPanels";
import { PoseOverlay } from "./PoseOverlay";
import { useCamera } from "./useCamera";
import s from "./camera.module.css";

const FAILED = new Set(["denied", "no-camera", "in-use", "unsupported", "failed"]);

function minutesWords(m: number): string {
  if (m < 1) return "less than a minute";
  const r = Math.round(m);
  return r === 1 ? "1 minute" : `${r} minutes`;
}

function leadLine(v: CameraView): string {
  switch (v.phase) {
    case "starting":
      return "Starting the camera.";
    case "on":
      return v.live.present
        ? "I can see you. I follow your nose, your shoulders and how your face moves."
        : "No one in frame right now.";
    case "example":
      return v.exampleDone
        ? "That was the whole example: two smiles, some talking, a quick lean that did not count and two new positions that did."
        : "A made-up person at a computer, about 40 seconds. Nothing here comes from a camera.";
    case "denied":
      return "The camera was not allowed, so nothing is measured here.";
    case "no-camera":
      return "There is no camera on this computer, so nothing is measured here.";
    case "in-use":
      return "The camera is busy in another app, so nothing is measured here.";
    case "unsupported":
    case "failed":
      return "The movement view could not start on this computer, so nothing is measured here.";
    default:
      if (v.lastStopMinutes !== null && v.lastStopMinutes > 0)
        return `The camera is off. You were in frame for ${minutesWords(v.lastStopMinutes)}.`;
      return "I can notice how you move, how your face moves and how you sit, compared with your own usual. Never what you feel.";
  }
}

export function MovementLive() {
  const v = useCamera();
  const videoRef = useRef<HTMLVideoElement>(null);
  const failed = FAILED.has(v.phase);
  const running = v.phase === "on" || v.phase === "starting";
  const example = v.phase === "example";

  // Leaving the screen turns the camera off and forgets a refused start.
  useEffect(() => () => resetCamera(), []);

  const start = () => {
    if (videoRef.current) void startCamera(videoRef.current);
  };

  return (
    <Screen
      lead={
        <>
          <div className={s.leadRow}>
            <h1 className={s.title}>Camera, live</h1>
            {running && (
              <span className={s.onPill} role="status" data-camera-on="">
                <span className={s.onDot} aria-hidden="true" />
                Camera on
              </span>
            )}
            {example && (
              <span className={s.examplePill} role="status">
                Example, not live
              </span>
            )}
          </div>
          <p className={s.line} aria-live="polite" data-phase={v.phase}>
            {leadLine(v)}
          </p>
        </>
      }
      actions={
        <>
          {!failed && (
            <>
              {running ? (
                <button type="button" className="btn btn-primary" onClick={stopCamera}>
                  Stop the camera
                </button>
              ) : (
                <button type="button" className="btn btn-primary" onClick={start}>
                  Start the camera
                </button>
              )}
              <p className={s.privacy}>The picture is worked out on this computer. Nothing is stored or sent.</p>
            </>
          )}
          <div className="links">
            {!failed &&
              !running &&
              (example ? (
                <button type="button" className={`btn btn-quiet ${s.exampleLink}`} onClick={stopExample}>
                  {v.exampleDone ? "Close the example" : "Stop the example"}
                </button>
              ) : (
                <button type="button" className={`btn btn-quiet ${s.exampleLink}`} onClick={playExample}>
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
          <div className={`card ${s.stage}`} data-phase={v.phase} data-delegate={v.delegate ?? undefined} data-frames={v.frames}>
            {/* Always in the page so the camera can be attached to it; shown only while it runs. */}
            <video ref={videoRef} data-camera-video="" className={s.video} hidden={v.phase !== "on"} muted playsInline aria-label="Your camera, mirrored" />
            {(v.phase === "on" || example) && (
              <PoseOverlay points={v.points} aspect={v.aspect} present={v.live.present} figure={example} />
            )}
            {v.phase === "on" && !v.live.present && <span className={s.stageNote}>No one in frame</span>}
            {v.phase === "starting" && <span className={s.stageNote}>Getting ready</span>}
            {v.phase === "off" && <span className={s.stageNote}>The camera is off</span>}
          </div>
          <CameraPanels
            movement={v.live}
            expression={v.expression}
            posture={v.posture}
            active={v.phase === "on" || example}
            faceAvailable={v.faceAvailable}
            usualWords={example ? "how this made-up person sat in the first 8 seconds" : "how you sat in your first two minutes"}
          />
        </>
      )}
    </Screen>
  );
}
