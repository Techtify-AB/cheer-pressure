"use client";

// Cheri's look: fur and colour, shown live at once and kept with the other settings. Used in
// Settings and as the last step of onboarding.

import { Companion } from "@/components/companion/Companion";
import { Screen } from "@/components/Screen";
import { COLOURS, FURS, lookOf } from "@/lib/look";
import { saveSettings } from "@/lib/storage";
import type { AppData } from "@/lib/types";

export function CheriLook({ data, actions, above }: { data: AppData; actions: React.ReactNode; above?: React.ReactNode }) {
  const look = lookOf(data.settings);
  const set = (next: Partial<typeof look>) => saveSettings({ look: { ...look, ...next } });
  return (
    <Screen
      lead={
        <div className="look-lead">
          {above}
          <Companion state="joy" size={200} fur={look.fur} color={look.color} />
          <h1 className="item-title">Cheri&apos;s look</h1>
        </div>
      }
      actions={actions}
    >
      <section className="card stack-sm look-card" aria-label="Cheri's look">
        <fieldset className="bare-fieldset">
          <legend className="switch-label">Fur</legend>
          <div className="chips">
            {FURS.map((f) => (
              <button key={f.value} type="button" className="chip" aria-pressed={look.fur === f.value} onClick={() => set({ fur: f.value })}>
                {f.label}
              </button>
            ))}
          </div>
          <p className="small muted look-note">The shaggy one uses more of the computer&apos;s graphics power. The small mascot window stays soft, since it runs all day.</p>
        </fieldset>
        <fieldset className="bare-fieldset">
          <legend className="switch-label">Colour</legend>
          <div className="swatches">
            {COLOURS.map((c) => (
              <button key={c.value} type="button" className="swatch" aria-pressed={look.color === c.value} onClick={() => set({ color: c.value })}>
                <span className="swatch-dot" style={{ background: c.swatch }} aria-hidden="true" />
                {c.label}
              </button>
            ))}
          </div>
        </fieldset>
      </section>
    </Screen>
  );
}
