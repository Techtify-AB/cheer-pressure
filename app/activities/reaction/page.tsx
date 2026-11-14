"use client";

// "A quick reaction check" on its own, from the end of the library. Experimental.

import Link from "next/link";
import { useState } from "react";
import { ReactionCheck } from "@/components/activities/ReactionCheck";
import { Screen } from "@/components/Screen";

export default function ReactionPage() {
  const [round, setRound] = useState(0);
  const [finished, setFinished] = useState(false);
  return (
    <Screen
      lead={<ReactionCheck key={round} context="own" onFinished={() => setFinished(true)} />}
      actions={
        <>
          {finished ? (
            <Link href="/activities/" className="btn btn-primary">
              Back to things to do
            </Link>
          ) : null}
          <div className="links">
            {finished ? (
              <button
                type="button"
                className="btn btn-quiet"
                onClick={() => {
                  setFinished(false);
                  setRound((r) => r + 1);
                }}
              >
                Once more
              </button>
            ) : (
              <Link href="/activities/" className="btn btn-quiet">
                Not now
              </Link>
            )}
          </div>
        </>
      }
    />
  );
}
