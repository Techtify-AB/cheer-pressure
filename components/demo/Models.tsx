// The models behind Cheer Pressure, in numbers. Shown on the demo pages so nobody misses them.
// The figures are from the machine-learning track (services/README.md and Filip's results).

const FACTS: { figure: string; label: string; text: string }[] = [
  {
    figure: "8 MB",
    label: "Our own expression model",
    text: "A 400M-parameter SigLIP2 teacher distilled into it in about one hour of training on a Verda H100.",
  },
  { figure: "84.5%", label: "On FERPlus", text: "And 74.8% on ExpW, against 59% for the off-the-shelf model." },
  { figure: "4,500", label: "Labelled faces", text: "Used to check smile detection." },
  {
    figure: "1 second",
    label: "Voice, fully local",
    text: "Parakeet speech-to-text, Gemma 4 E4B and Pocket TTS, from releasing the button to Cheri's voice.",
  },
];

/** `compact`: the four figures in one row with their labels, for beside the phone. */
export function Models({ compact = false }: { compact?: boolean }) {
  return (
    <section className="models" data-compact={compact || undefined} aria-labelledby="models-title">
      <h2 id="models-title" className="models-title">
        The models behind it
      </h2>
      <ul className="models-grid">
        {FACTS.map((f) => (
          <li key={f.label} className="models-fact">
            <span className="models-figure">{f.figure}</span>
            <span className="models-label">{f.label}</span>
            {!compact && <span className="models-text">{f.text}</span>}
          </li>
        ))}
      </ul>
      {compact && (
        <p className="models-note">
          Our own expression model is distilled from a 400M-parameter SigLIP2 teacher in about an hour on a Verda
          H100, and scores 84.5% on FERPlus against 59% for the off-the-shelf model. Voice runs fully on the device.
        </p>
      )}
      <p className="models-note">
        The app uses these to notice changes against the person&apos;s own usual. It does not detect depression or
        relapse.
      </p>
    </section>
  );
}
