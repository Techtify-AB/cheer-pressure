// Which component draws which activity.

import type { ActivityId } from "@/lib/activities";
import type { ActivityView } from "./ActivityHost";
import { Evening } from "./Evening";
import { Song } from "./Song";

export const ACTIVITY_VIEWS: Record<ActivityId, ActivityView> = {
  song: Song,
  evening: Evening,
} as Record<ActivityId, ActivityView>;
