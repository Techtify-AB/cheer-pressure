"use client";

// One setting as a row: the label, an optional hint, and an on/off switch. The whole
// row is the button. A source that is not connected yet shows that instead.

export function SwitchRow({
  label,
  hint,
  on,
  onChange,
  disabledText,
}: {
  label: string;
  hint?: string;
  on: boolean;
  onChange?: (on: boolean) => void;
  /** Shown instead of a working switch, e.g. "Not connected yet". */
  disabledText?: string;
}) {
  const disabled = !!disabledText;
  return (
    <button
      type="button"
      role="switch"
      aria-checked={disabled ? false : on}
      disabled={disabled}
      className="switch-row"
      onClick={() => onChange?.(!on)}
    >
      <span className="switch-text">
        <span className="switch-label">{label}</span>
        {(disabledText || hint) && <span className="switch-hint">{disabledText ?? hint}</span>}
      </span>
      <span className="switch" data-on={!disabled && on ? "" : undefined} aria-hidden="true">
        <span />
      </span>
    </button>
  );
}
