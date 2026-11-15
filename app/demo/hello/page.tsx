"use client";

// Today's hello, recorded for the demo. The hello only asks how the person is, to hear it in
// their own words. It says nothing about measurements and offers nothing: that is "Cheri asks".

import { RecordedTalk, type TalkLine } from "@/components/demo/RecordedTalk";

const LINES: TalkLine[] = [
  { who: "cheri", text: "Hello. How are you today?", seconds: 2.0 },
  { who: "person", text: "Okay, I think. A bit more tired than last week." },
  { who: "cheri", text: "Thank you for telling me. I have saved that as today’s answer, in your own words.", seconds: 4.24 },
  { who: "cheri", text: "That was today’s hello. I will ask again tomorrow.", seconds: 3.2 },
];

export default function RecordedHelloPage() {
  return (
    <RecordedTalk
      lines={LINES}
      folder="hello"
      playLabel="Play today’s hello"
      intro="Once a day Cheri asks how you are, to hear it in your own words. Nothing else. This one is written down and played back, so you can see it without talking to a phone."
    />
  );
}
