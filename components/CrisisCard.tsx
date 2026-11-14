// A fixed, pre-written handoff card. Shown instead of any generated reply when
// typed text contains crisis words (see lib/crisis.ts). Do not generate this text.

import Link from "next/link";
import { ClinicContactPlaceholder } from "./ClinicContactPlaceholder";

export function CrisisCard() {
  return (
    <section className="crisis-card stack" role="alert" aria-labelledby="crisis-title">
      <h2 id="crisis-title">You don&apos;t have to carry this alone</h2>
      <p>
        What you wrote sounds really hard. This app can&apos;t help with that, but people can, and you deserve that
        help now.
      </p>
      <p>
        <strong>If you are in danger or might hurt yourself, call 112 now.</strong>
      </p>
      <a className="emergency-number" href="tel:112">
        Call 112
      </a>
      <p>You can also reach your clinic, or tell someone you trust and ask them to stay with you.</p>
      <ClinicContactPlaceholder />
      <p className="small muted">
        <Link href="/help/">More about getting help</Link>
      </p>
    </section>
  );
}
