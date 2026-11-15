"use client";

// "Cheri asks", recorded for the demo: the conversation Cheri starts when the measured values
// stand out from the person's own usual in at least two categories. She says what she has
// noticed as an observation, asks, and offers one thing from the person's own list. No advice
// of her own, no score, no diagnosis. Afterwards the same steps continue in the app.

import Link from "next/link";
import { RecordedTalk, type TalkLine } from "@/components/demo/RecordedTalk";

const LINES: TalkLine[] = [
  { who: "cheri", text: "Your nights have been shorter than your usual this week, and you have taken fewer steps. How are you doing?", seconds: 5.36 },
  { who: "person", text: "Not great. I am sleeping badly again, like before the treatment." },
  { who: "cheri", text: "Thank you for telling me. That sounds heavy.", seconds: 2.32 },
  { who: "cheri", text: "A short walk before lunch has been followed by better days for you before. Would you like to try one today?", seconds: 5.2 },
  { who: "person", text: "Okay. I can do that." },
  { who: "cheri", text: "Good. I will ask tomorrow whether it helped.", seconds: 2.88 },
];

export default function RecordedAsksPage() {
  return (
    <RecordedTalk
      lines={LINES}
      folder="asks"
      playLabel="Play the conversation"
      intro="Sleep and Energy have changed against this person’s own usual, so Cheri starts a conversation. It is written down and played back, so you can see it without talking to a phone."
      after={
        <Link href="/prompt/" className="btn btn-primary">
          See the same steps on screen
        </Link>
      }
    />
  );
}
