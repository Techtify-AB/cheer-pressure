// Cheri's look: fur and colour, chosen in Settings and used wherever Cheri appears. The names
// are dot.js's own (components/companion/dot.js); this file only keeps the choice.

import type { Settings } from "./types";

export type Fur = "soft" | "shaggy" | "smooth";
export const FURS: { value: Fur; label: string }[] = [
  { value: "soft", label: "Soft" },
  { value: "shaggy", label: "Shaggy" },
  { value: "smooth", label: "Smooth" },
];

/** The swatches show dot.js's own colours (COLORS there). */
export const COLOURS: { value: string; label: string; swatch: string }[] = [
  { value: "peach", label: "Peach", swatch: "#ffc2ad" },
  { value: "butter", label: "Butter", swatch: "#ffe3a1" },
  { value: "mint", label: "Mint", swatch: "#b5e6d3" },
  { value: "sky", label: "Sky", swatch: "#b9d9f7" },
  { value: "lilac", label: "Lilac", swatch: "#d6c6f5" },
  { value: "offwhite", label: "Off-white", swatch: "#f6f1e7" },
];

export const DEFAULT_LOOK = { fur: "soft" as Fur, color: "peach" };

export function lookOf(s: Settings | null | undefined): { fur: Fur; color: string } {
  const fur = FURS.some((f) => f.value === s?.look?.fur) ? (s!.look!.fur as Fur) : DEFAULT_LOOK.fur;
  const color = COLOURS.some((c) => c.value === s?.look?.color) ? s!.look!.color : DEFAULT_LOOK.color;
  return { fur, color };
}

/** The small mascot window runs all day, so it never uses the heavier shaggy fur. */
export const mascotFur = (fur: Fur): Fur => (fur === "shaggy" ? "soft" : fur);
