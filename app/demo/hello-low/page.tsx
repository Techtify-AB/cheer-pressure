"use client";

// Today's hello when the person chooses to talk, recorded for the demo. After the answer the
// person can leave it there, or talk for a moment: one or two open questions, and then Cheri
// offers to get in touch with someone they trust for them. Cheri is the one who sends it, with
// the person's yes, and only that they would like to hear from them. Nothing about measurements,
// no advice of her own, and it does not start the three steps.

import { RecordedTalk, type TalkLine } from "@/components/demo/RecordedTalk";

const LINES: TalkLine[] = [
  { who: "cheri", text: "Hello. How are you today?", seconds: 1.84 },
  { who: "person", text: "Not so good, to be honest." },
  { who: "cheri", text: "Thank you for telling me. Would you like to talk about it for a moment?", seconds: 2.88 },
  { who: "person", text: "Yes, okay." },
  { who: "cheri", text: "What has been the hardest part of today?", seconds: 2.0 },
  { who: "person", text: "I have just been at home. I have not talked to anyone all day." },
  { who: "cheri", text: "That sounds like a long, quiet day. Is there someone you would have liked to hear from?", seconds: 4.48 },
  { who: "person", text: "My sister Sara, maybe. We used to talk on Sundays." },
  {
    who: "cheri",
    text: "Would you like me to let Sara know that you would like to hear from her? I only send that, and nothing about how you are.",
    seconds: 5.28,
  },
  { who: "person", text: "Yes, please." },
  { who: "cheri", text: "Done. I have sent it. I have saved today’s answer in your own words, and I will ask again tomorrow.", seconds: 5.76 },
];

export default function RecordedHarderHelloPage() {
  return (
    <RecordedTalk
      lines={LINES}
      folder="hello-low"
      playLabel="Play the conversation"
      note="During the hello the camera and the microphone are on. Our own expression model reads the face, and the voice is read for its tone, as numbers on the phone. No picture and no sound is kept."
      intro="After answering, the person can leave it there or talk for a moment. Here they choose to talk, and Cheri offers to get in touch with someone they trust for them. Written down and played back."
    />
  );
}
