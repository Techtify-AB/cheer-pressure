// The development build's "Add eight made-up weeks to Health": what is written, as plain data.
// Pure code, no React Native imports, so scripts/test-phone.mts can check that the weeks reduce to
// 56 nights and that the rule notices the last week (Sleep and Energy both changed).
//
// Seven ordinary weeks (in bed about 23:10, about 7 h 20 asleep, about 8 000 steps), then a last
// week that slips: later to bed, about 5 h 30 asleep, about 3 500 steps. Every night has one short
// awake stretch in the middle. The numbers wobble a little from day to day, the same every time.

export const DEMO_DAYS = 56;
const RECENT_DAYS = 7;
const MIN = 60_000;

export interface DemoSleep {
  stage: "inBed" | "asleep" | "awake";
  start: number;
  end: number;
}

export interface DemoSteps {
  start: number;
  end: number;
  steps: number;
}

/** A small repeatable wobble in [-1, 1] for day i and a salt. */
function wobble(i: number, salt: number): number {
  const x = Math.sin(i * 12.9898 + salt * 78.233) * 43758.5453;
  return (x - Math.floor(x)) * 2 - 1;
}

function localMidnight(y: number, m: number, d: number) {
  return new Date(y, m, d, 0, 0, 0, 0).getTime();
}

/**
 * Samples for the 56 nights ending on the morning of `today` and the 56 full days before it.
 * `today` is the phone's local today; nothing is written for today itself.
 */
export function demoWeeks(today: Date): { sleep: DemoSleep[]; steps: DemoSteps[] } {
  const sleep: DemoSleep[] = [];
  const steps: DemoSteps[] = [];
  const y = today.getFullYear();
  const m = today.getMonth();
  const d = today.getDate();
  for (let back = DEMO_DAYS; back >= 1; back--) {
    const recent = back <= RECENT_DAYS;
    const i = DEMO_DAYS - back;
    // The night that ends on the morning of day (today - back + 1), starting the evening before.
    const evening = localMidnight(y, m, d - back);
    const bedMin = (recent ? 24 * 60 + 30 : 23 * 60 + 10) + Math.round(wobble(i, 1) * 20);
    const asleepMin = (recent ? 330 : 440) + Math.round(wobble(i, 2) * 25);
    const bed = evening + bedMin * MIN;
    const fallAsleep = bed + (15 + Math.round(wobble(i, 3) * 5)) * MIN;
    const awakeLen = (recent ? 25 : 12) * MIN;
    const half = Math.round(asleepMin / 2) * MIN;
    const firstEnd = fallAsleep + half;
    const secondStart = firstEnd + awakeLen;
    const wake = secondStart + (asleepMin * MIN - half);
    sleep.push({ stage: "inBed", start: bed, end: wake + 10 * MIN });
    sleep.push({ stage: "asleep", start: fallAsleep, end: firstEnd });
    sleep.push({ stage: "awake", start: firstEnd, end: secondStart });
    sleep.push({ stage: "asleep", start: secondStart, end: wake });

    // Steps on the full day (today - back), in four parts of the day.
    const day = localMidnight(y, m, d - back);
    const total = Math.round((recent ? 3500 : 8000) + wobble(i, 4) * (recent ? 600 : 1500));
    const parts: [number, number, number][] = [
      [8, 9, 0.2],
      [12, 13, 0.3],
      [16, 17, 0.3],
      [19, 20, 0.2],
    ];
    for (const [from, to, share] of parts) {
      steps.push({ start: day + from * 60 * MIN, end: day + to * 60 * MIN, steps: Math.round(total * share) });
    }
  }
  return { sleep, steps };
}
