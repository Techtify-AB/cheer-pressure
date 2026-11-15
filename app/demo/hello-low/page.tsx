"use client";

// Today's hello on a harder day, recorded for the demo. When the person answers "Not so good",
// Cheri offers to talk for a moment: one or two open questions, then one thing from the person's
// own list, as a question. Nothing about measurements, no advice of her own, and it does not
// start the three steps: one hard day is not a change against the person's own usual.

import { RecordedTalk, type TalkLine } from "@/components/demo/RecordedTalk";

const LINES: TalkLine[] = [
  { who: "cheri", text: "Hello. How are you today?", seconds: 1.84 },
  { who: "person", text: "Not so good, to be honest." },
  { who: "cheri", text: "Thank you for telling me. Would you like to talk about it for a moment?", seconds: 2.88 },
  { who: "person", text: "Yes, okay." },
  { who: "cheri", text: "What has been the hardest part of today?", seconds: 2.0 },
  { who: "person", text: "I have just been at home. I have not talked to anyone all day." },
  { who: "cheri", text: "That sounds like a long, quiet day. Is there someone you would have liked to hear from?", seconds: 4.48 },
  { who: "person", text: "My sister, maybe. We used to talk on Sundays." },
  {
    who: "cheri",
    text: "Getting in touch with someone is on your own list of what helps. Would you like to send your sister a short message now?",
    seconds: 5.04,
  },
  { who: "person", text: "Yes. I can do that." },
  { who: "cheri", text: "Good. I have saved today’s answer in your own words. I will ask again tomorrow.", seconds: 5.04 },
];

export default function RecordedHarderHelloPage() {
  return (
    <RecordedTalk
      lines={LINES}
      folder="hello-low"
      playLabel="Play the hello"
      note="During the hello the camera and the microphone are on. Our own expression model reads the face, and the voice is read for its tone, as numbers on the phone. No picture and no sound is kept."
      intro="On a day the answer is “Not so good”, Cheri offers to talk for a moment. If the person says no, she suggests one thing and leaves it there. Written down and played back."
    />
  );
}
