// "Move your attention for a moment": a short guide, one line at a time, each line shown as
// text while it is spoken. There is no recorded voice yet, so the device's own on-device
// speech (lib/voice.ts) speaks each line; with no voice, or muted, the lines simply follow the
// time markers. A recorded file can be dropped in later: set `audioSrc`, and give each line
// the second it starts at in that recording (`at`). The player then follows the recording's
// clock instead of speech. See lib/activities/README.md.

export interface GuideLine {
  /** Seconds from the start where the line begins. */
  at: number;
  text: string;
}

export interface Guide {
  /** A recorded voice track with the same markers, or null to use on-device speech. */
  audioSrc: string | null;
  lines: GuideLine[];
  /** Seconds from the start where the guide ends. */
  endsAt: number;
}

export const ATTENTION_GUIDE: Guide = {
  audioSrc: null,
  lines: [
    { at: 0, text: "Notice what took your attention." },
    { at: 6, text: "Listen for a sound in the room, or feel how your feet rest on the floor." },
    { at: 17, text: "What is one small thing you want to do now?" },
  ],
  endsAt: 25,
};

/** The quiet after a spoken line before the next one may start, in ms. */
export const PAUSE_AFTER_LINE_MS = 1500;

/** Which line is showing at this second of a recording, or -1 before the first. */
export function lineAt(guide: Guide, seconds: number): number {
  let idx = -1;
  guide.lines.forEach((l, i) => {
    if (seconds >= l.at) idx = i;
  });
  return idx;
}

/**
 * How long line `i` stays before the next one (or the end), in ms, when it is spoken by the
 * device: the time to the next marker, but never cutting the speech short; speech that ran
 * long gets the short pause after it.
 */
export function holdFor(guide: Guide, i: number, spokenMs: number | null): number {
  const next = i + 1 < guide.lines.length ? guide.lines[i + 1].at : guide.endsAt;
  const byMarker = (next - guide.lines[i].at) * 1000;
  if (spokenMs === null) return byMarker;
  return Math.max(byMarker, spokenMs + PAUSE_AFTER_LINE_MS);
}
