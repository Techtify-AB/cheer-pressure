"use client";

// One typed text field with its Add button, for the person's own words (what helps them, an
// early sign, a name). The crisis check runs while typing and on leaving the field: crisis
// words show the fixed help card (the caller's onCrisis) and are never added.

import { useState } from "react";
import { useCrisisCheck } from "@/components/hooks";

export function OwnWords({
  id,
  label,
  placeholder,
  disabled,
  onAdd,
  onCrisis,
  onListening,
}: {
  id: string;
  label: string;
  placeholder: string;
  disabled: boolean;
  onAdd: (text: string) => void;
  onCrisis: () => void;
  onListening?: (on: boolean) => void;
}) {
  const [text, setText] = useState("");
  const crisis = useCrisisCheck(onCrisis, () => text);
  const add = () => {
    const t = text.trim();
    if (!t || crisis.full(t)) return;
    onAdd(t);
    setText("");
  };
  return (
    <div className="field">
      <label htmlFor={id}>{label}</label>
      <div style={{ display: "flex", gap: "var(--space-2)" }}>
        <input
          id={id}
          type="text"
          value={text}
          maxLength={60}
          disabled={disabled}
          placeholder={placeholder}
          onFocus={() => onListening?.(true)}
          onBlur={(e) => {
            onListening?.(false);
            crisis.full(e.target.value);
          }}
          onChange={(e) => {
            setText(e.target.value);
            crisis.typed(e.target.value);
          }}
          onKeyDown={(e) => {
            if (e.key === "Enter") {
              e.preventDefault();
              add();
            }
          }}
        />
        <button type="button" className="btn btn-secondary" onClick={add} disabled={disabled || !text.trim()}>
          Add
        </button>
      </div>
    </div>
  );
}

