// A short memory game: cards face down, turn two; a pair stays open, two that do not match
// turn back after a short pause, during which no card can be turned. Pure rules, unit tested
// in scripts/test-activities.mts; the component only draws them and runs the pause.

export const SYMBOLS = [
  { id: "sun", label: "Sun" },
  { id: "leaf", label: "Leaf" },
  { id: "wave", label: "Wave" },
] as const;

export type SymbolId = (typeof SYMBOLS)[number]["id"];

/** How long two cards that do not match stay open, in ms. */
export const MISMATCH_PAUSE_MS = 900;

export interface GameState {
  /** The symbol on each card, in the order they lie. */
  cards: SymbolId[];
  /** Cards turned up that are not yet a pair: zero, one or two indices. */
  open: number[];
  /** Cards that found their pair and stay open. */
  matched: number[];
  /** True while two cards that do not match are shown: nothing can be turned. */
  locked: boolean;
  /** Turns taken (two cards each). */
  turns: number;
}

/** Fisher-Yates with the given random source (0 <= r < 1). */
export function shuffle<T>(list: readonly T[], random: () => number = Math.random): T[] {
  const a = [...list];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

/** A new, shuffled round with this many pairs (two or three). */
export function newRound(pairs: number, random: () => number = Math.random): GameState {
  const n = Math.max(1, Math.min(SYMBOLS.length, Math.round(pairs)));
  const symbols = SYMBOLS.slice(0, n).map((s) => s.id);
  return { cards: shuffle([...symbols, ...symbols], random), open: [], matched: [], locked: false, turns: 0 };
}

/** Turns one card. Does nothing while locked, or for a card that is already open. */
export function flip(state: GameState, index: number): GameState {
  if (state.locked) return state;
  if (index < 0 || index >= state.cards.length) return state;
  if (state.matched.includes(index) || state.open.includes(index)) return state;
  if (state.open.length === 0) return { ...state, open: [index] };
  const first = state.open[0];
  const turns = state.turns + 1;
  if (state.cards[first] === state.cards[index]) {
    return { ...state, open: [], matched: [...state.matched, first, index], turns };
  }
  return { ...state, open: [first, index], locked: true, turns };
}

/** After the pause: the two that did not match turn back, and cards can be turned again. */
export function settle(state: GameState): GameState {
  if (!state.locked) return state;
  return { ...state, open: [], locked: false };
}

export function isWon(state: GameState): boolean {
  return state.matched.length === state.cards.length;
}

export function isFaceUp(state: GameState, index: number): boolean {
  return state.open.includes(index) || state.matched.includes(index);
}

export function symbolLabel(id: SymbolId): string {
  return SYMBOLS.find((s) => s.id === id)?.label ?? id;
}
