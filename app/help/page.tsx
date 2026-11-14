import Link from "next/link";
import { ClinicContactPlaceholder } from "@/components/ClinicContactPlaceholder";
import { Screen } from "@/components/Screen";

export const metadata = { title: "Need help now? · Cheer Pressure" };

export default function HelpPage() {
  return (
    <Screen
      lead={
        <section className="crisis-card stack-sm" aria-labelledby="emergency-title">
          <h1 id="emergency-title" className="item-title">
            If you are in danger, or might hurt yourself, call 112 now
          </h1>
          <a className="emergency-number" href="tel:112">
            Call 112
          </a>
        </section>
      }
      actions={
        <div className="links">
          <Link href="/" className="btn btn-quiet">
            Back to home
          </Link>
        </div>
      }
    >
      <section className="card stack-sm" aria-labelledby="clinic-title">
        <h2 id="clinic-title">If it isn&apos;t an emergency</h2>
        <p>
          Contact your clinic, or tell someone you trust how you are doing. This app is a tool, not a therapist, and it
          can&apos;t help in an emergency.
        </p>
        <ClinicContactPlaceholder />
      </section>
    </Screen>
  );
}
