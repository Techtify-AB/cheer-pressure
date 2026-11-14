// The activities: step one of the ladder is "something for you", and these are the
// somethings. Small, concrete, doable in a minute or a few. Each has its own static page,
// /activities/<id>/, and a smaller version behind "Make it easier".
//
// activityForHelp maps a "What helps you?" item (lib/helps.ts) to the activity that fits it
// best, so taking a suggestion at step one can open it directly.

export const ACTIVITY_IDS = ["outside", "daylight", "song", "attention", "eat", "game", "hobby", "ask", "evening"] as const;
export type ActivityId = (typeof ACTIVITY_IDS)[number];

export interface Activity {
  id: ActivityId;
  title: string;
  /** One line for the library. */
  line: string;
  /** Roughly how long, said plainly. */
  takes: string;
  /** How it reads inside a sentence ("You've said a short walk helped..."). */
  phrase: string;
}

/** In library order: away from the screen first, then sound and light, then people. */
export const ACTIVITIES: Activity[] = [
  { id: "outside", title: "Five minutes outside", line: "Shoes on, out the door, whichever way is easiest.", takes: "5 minutes", phrase: "a short walk" },
  { id: "daylight", title: "Let the daylight in", line: "Open the curtains, then sit by the window for a while.", takes: "A few minutes", phrase: "letting the daylight in" },
  { id: "song", title: "One song, one first step", line: "Listen for a while, then do the first step you chose.", takes: "1 minute", phrase: "a song and a first step" },
  { id: "attention", title: "Move your attention for a moment", line: "A short, calm guide to what is around you.", takes: "Under a minute", phrase: "moving your attention" },
  { id: "eat", title: "Get something to eat ready", line: "Your simple meal, one step at a time.", takes: "A few minutes", phrase: "getting something to eat ready" },
  { id: "game", title: "Play a short round", line: "Find three pairs of cards.", takes: "1 minute", phrase: "a short round" },
  { id: "hobby", title: "Pick your hobby back up", line: "Just the first step of something you like doing.", takes: "2 minutes", phrase: "your hobby" },
  { id: "ask", title: "Ask someone to get in touch", line: "A short message to someone you like.", takes: "1 minute", phrase: "asking someone" },
  { id: "evening", title: "Wind down the evening", line: "A calm sound, then your first evening step.", takes: "1 minute", phrase: "winding down" },
];

export function activityById(id: string | null | undefined): Activity | undefined {
  return ACTIVITIES.find((a) => a.id === id);
}

export function activityHref(id: ActivityId): string {
  return `/activities/${id}/`;
}

/** The starting "What helps you?" items and the activity that fits each best. */
export const FOR_HELP: Record<string, ActivityId> = {
  outdoors: "outside",
  music: "song",
  game: "game",
  light: "daylight",
  moving: "outside",
  making: "hobby",
  watching: "attention",
  talking: "ask",
};

/** For the person's own items: a few plain words in their label. */
const BY_WORDS: { re: RegExp; id: ActivityId }[] = [
  { re: /\b(walk|walking|outside|outdoors|nature|park|forest|run|running|hike|fresh air)\b/i, id: "outside" },
  { re: /\b(music|song|songs|sing|singing|playlist|listen)\b/i, id: "song" },
  { re: /\b(call|calling|friend|friends|talk|talking|family|someone|text)\b/i, id: "ask" },
  { re: /\b(cook|cooking|bake|baking|eat|eating|food|meal|breakfast)\b/i, id: "eat" },
  { re: /\b(draw|drawing|sketch|sketching|paint|painting|knit|knitting|craft|guitar|piano|read|reading|write|writing)\b/i, id: "hobby" },
  { re: /\b(game|games|puzzle|puzzles)\b/i, id: "game" },
  { re: /\b(light|sun|sunlight|window|daylight|morning)\b/i, id: "daylight" },
  { re: /\b(sleep|evening|bed|bedtime|wind down|night)\b/i, id: "evening" },
  { re: /\b(breathe|breathing|calm|notice|meditate|meditation|watch|look)\b/i, id: "attention" },
];

/**
 * The activity that fits a "What helps you?" item best: by id for the starting items, by a few
 * words in the label for the person's own. Null when nothing fits.
 */
export function activityForHelp(helpId: string, label?: string): ActivityId | null {
  const byId = FOR_HELP[helpId];
  if (byId) return byId;
  const text = label ?? "";
  for (const w of BY_WORDS) if (w.re.test(text)) return w.id;
  return null;
}

/**
 * Up to `n` activities to offer next, from the person's own list: each item's activity in the
 * list's order, without repeats and without the one just done.
 */
export function nextActivities(
  helps: { id: string; label: string; on: boolean }[],
  exclude: ActivityId[],
  n = 2,
): ActivityId[] {
  const out: ActivityId[] = [];
  for (const h of helps) {
    if (!h.on) continue;
    const id = activityForHelp(h.id, h.label);
    if (id && !exclude.includes(id) && !out.includes(id)) out.push(id);
    if (out.length >= n) return out;
  }
  for (const a of ACTIVITIES) {
    if (out.length >= n) break;
    if (!exclude.includes(a.id) && !out.includes(a.id)) out.push(a.id);
  }
  return out;
}
