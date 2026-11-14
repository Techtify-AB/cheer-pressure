// What the activity screens need from the learning in lib/helps.ts, re-exported so the screens
// import from lib/activities only. Two signals, shown apart: whether the person's days moved
// back towards their usual in the three days after (the main one, Cheri learns it by herself),
// and what the person said when asked "Did that help?" (lib/activities/feedback.ts).

export {
  activityStats,
  followedLines,
  learnFromValues,
  orderActivities,
  type FollowedStats,
  type HelpStats,
  type Occasion,
} from "../helps";
