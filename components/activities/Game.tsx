"use client";

// 6. Play a short round: a memory game. Six cards, three pairs, three symbols that are easy to
// tell apart (shape and colour both differ) with spoken labels. Turn two; a pair stays open; two
// that do not match turn back after a short pause, during which no card can be turned. Shuffled
// every round. Rules in lib/activities/game.ts (unit tested). Easier: four cards, two pairs.

import { useEffect, useState } from "react";
import { flip, isFaceUp, isWon, MISMATCH_PAUSE_MS, newRound, settle, symbolLabel, type GameState, type SymbolId } from "@/lib/activities/game";
import type { Plan } from "@/lib/plan";
import { ActivityScreen } from "./ActivityScreen";
import { useStopOnEnd, type ActivityRun } from "./useActivity";

export function Game({ run }: { run: ActivityRun; plan: Plan }) {
  const pairs = run.easier ? 2 : 3;
  const [playing, setPlaying] = useState(false);
  const [state, setState] = useState<GameState>(() => newRound(pairs));
  const [rounds, setRounds] = useState(0);

  // The pause after two that do not match; End stops it with the rest.
  useEffect(() => {
    if (!state.locked) return;
    const id = window.setTimeout(() => setState((s) => settle(s)), MISMATCH_PAUSE_MS);
    return () => window.clearTimeout(id);
  }, [state.locked, state.turns]);
  useStopOnEnd(run, () => setPlaying(false));

  const won = isWon(state);
  const found = state.matched.length / 2;
  const title = "Play a short round";

  if (!playing) {
    return (
      <ActivityScreen
        run={run}
        title={title}
        text={<p>{pairs * 2} cards, {pairs} pairs. Turn two at a time and find the pairs.</p>}
        primary={
          <button
            type="button"
            className="btn btn-primary"
            data-act="start"
            onClick={() => {
              run.markStarted();
              setState(newRound(pairs));
              setPlaying(true);
            }}
          >
            Start
          </button>
        }
      >
        <Grid state={newRoundPreview(pairs)} onFlip={() => {}} preview />
      </ActivityScreen>
    );
  }

  return (
    <ActivityScreen
      run={run}
      title={title}
      hideEasier={won}
      text={<p>{won ? `All ${pairs} pairs found.` : "Turn two cards at a time."}</p>}
      primary={
        won ? (
          <button type="button" className="btn btn-primary" data-act="done" onClick={() => run.finish()}>
            Done
          </button>
        ) : null
      }
      secondary={
        won ? (
          <button
            type="button"
            className="btn btn-secondary"
            data-act="again"
            onClick={() => {
              setState(newRound(pairs));
              setRounds((r) => r + 1);
            }}
          >
            Play again
          </button>
        ) : null
      }
    >
      <Grid key={rounds} state={state} onFlip={(i) => setState((s) => flip(s, i))} />
      <p className="act-game-status" aria-live="polite">
        {won ? "" : state.locked ? "Not a pair. They turn back in a moment." : `${found} of ${pairs} pairs found`}
      </p>
    </ActivityScreen>
  );
}

function newRoundPreview(pairs: number): GameState {
  return { cards: Array.from({ length: pairs * 2 }, () => "sun" as SymbolId), open: [], matched: [], locked: true, turns: 0 };
}

function Grid({ state, onFlip, preview = false }: { state: GameState; onFlip: (i: number) => void; preview?: boolean }) {
  return (
    <div className="act-grid" data-cards={state.cards.length} role="group" aria-label="Cards">
      {state.cards.map((symbol, i) => {
        const up = !preview && isFaceUp(state, i);
        const matched = state.matched.includes(i);
        const blocked = preview || state.locked || up;
        return (
          <button
            key={i}
            type="button"
            className="act-card"
            data-up={up ? "" : undefined}
            data-matched={matched ? "" : undefined}
            data-card={i}
            aria-disabled={blocked}
            tabIndex={preview ? -1 : undefined}
            aria-label={`Card ${i + 1}, ${up ? symbolLabel(symbol) + (matched ? ", found" : "") : "face down"}`}
            onClick={() => {
              if (!blocked) onFlip(i);
            }}
          >
            <span className="act-card-inner" aria-hidden="true">
              <span className="act-card-face act-card-back" />
              <span className="act-card-face act-card-front">{up ? <SymbolIcon id={symbol} /> : null}</span>
            </span>
          </button>
        );
      })}
    </div>
  );
}

/** Three shapes in three colours, so they differ even without colour vision. */
function SymbolIcon({ id }: { id: SymbolId }) {
  if (id === "sun")
    return (
      <svg viewBox="0 0 48 48">
        <circle cx="24" cy="24" r="9" fill="#e9a03a" />
        {Array.from({ length: 8 }, (_, k) => {
          const a = (k * Math.PI) / 4;
          return (
            <line
              key={k}
              x1={24 + Math.cos(a) * 14}
              y1={24 + Math.sin(a) * 14}
              x2={24 + Math.cos(a) * 20}
              y2={24 + Math.sin(a) * 20}
              stroke="#e9a03a"
              strokeWidth="3.5"
              strokeLinecap="round"
            />
          );
        })}
      </svg>
    );
  if (id === "leaf")
    return (
      <svg viewBox="0 0 48 48">
        <path d="M10 38 C10 18 22 8 40 8 C40 26 30 38 10 38 Z" fill="#3e8a5f" />
        <path d="M12 36 L32 16" stroke="#fffdf9" strokeWidth="2.5" strokeLinecap="round" />
      </svg>
    );
  return (
    <svg viewBox="0 0 48 48">
      <path d="M4 20 q7 -8 14 0 t14 0 t14 0" fill="none" stroke="#2f6fb0" strokeWidth="4.5" strokeLinecap="round" />
      <path d="M4 32 q7 -8 14 0 t14 0 t14 0" fill="none" stroke="#2f6fb0" strokeWidth="4.5" strokeLinecap="round" />
    </svg>
  );
}
