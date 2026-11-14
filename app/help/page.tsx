import Link from "next/link";
import { ClinicContactPlaceholder } from "@/components/ClinicContactPlaceholder";

export const metadata = { title: "Need help now? · Companion" };

export default function HelpPage() {
  return (
    <div className="stack-lg">
      <div>
        <h1>Need help now?</h1>
        <p style={{ margin: 0 }}>This app is a tool, not a therapist, and it can&apos;t help in an emergency.</p>
      </div>

      <section className="crisis-card stack" aria-labelledby="emergency-title">
        <h2 id="emergency-title" style={{ fontSize: "var(--font-size-lg)", margin: 0 }}>
          If you are in danger, or might hurt yourself
        </h2>
        <p style={{ margin: 0 }}>Call the emergency number now.</p>
        <a className="emergency-number" href="tel:112">
          112
        </a>
      </section>

      <section className="stack" aria-labelledby="clinic-title">
        <h2 id="clinic-title" style={{ fontSize: "var(--font-size-lg)", margin: 0 }}>
          Your clinic
        </h2>
        <p style={{ margin: 0 }}>If things are getting harder but it isn&apos;t an emergency, contact your clinic.</p>
        <ClinicContactPlaceholder />
      </section>

      <p className="muted" style={{ margin: 0 }}>
        It can also help to tell someone you trust how you are doing.
      </p>

      <div>
        <Link href="/" className="btn btn-secondary">
          Back to home
        </Link>
      </div>
    </div>
  );
}
