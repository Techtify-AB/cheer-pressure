// Which component draws which activity.

import type { ActivityId } from "@/lib/activities";
import type { ActivityView } from "./ActivityHost";
import { Ask } from "./Ask";
import { Daylight } from "./Daylight";
import { Eat } from "./Eat";
import { Game } from "./Game";
import { Hobby } from "./Hobby";
import { Evening } from "./Evening";
import { Outside } from "./Outside";
import { Song } from "./Song";

export const ACTIVITY_VIEWS: Record<ActivityId, ActivityView> = {
  outside: Outside,
  song: Song,
  daylight: Daylight,
  eat: Eat,
  game: Game,
  hobby: Hobby,
  ask: Ask,
  evening: Evening,
} as Record<ActivityId, ActivityView>;
