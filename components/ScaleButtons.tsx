"use client";

export interface ScaleOption<T extends number> {
  value: T;
  label: string;
}

/** A row of 1 to 5 style tap buttons. */
export function ScaleButtons<T extends number>({
  options,
  value,
  onChange,
  label,
}: {
  options: ScaleOption<T>[];
  value: T | null;
  onChange: (v: T) => void;
  label: string;
}) {
  return (
    <div className="scale" role="group" aria-label={label}>
      {options.map((o) => (
        <button
          key={o.value}
          type="button"
          className="scale-btn"
          aria-pressed={value === o.value}
          onClick={() => onChange(o.value)}
        >
          <strong>{o.value}</strong>
          <span>{o.label}</span>
        </button>
      ))}
    </div>
  );
}

/** A vertical list of answers, for the weekly questions. */
export function OptionList<T extends number>({
  options,
  value,
  onChange,
  label,
}: {
  options: ScaleOption<T>[];
  value: T | null;
  onChange: (v: T) => void;
  label: string;
}) {
  return (
    <div className="options" role="group" aria-label={label}>
      {options.map((o) => (
        <button
          key={o.value}
          type="button"
          className="option"
          aria-pressed={value === o.value}
          onClick={() => onChange(o.value)}
        >
          <span>{o.label}</span>
          <span className="num" aria-hidden="true">
            {o.value}
          </span>
        </button>
      ))}
    </div>
  );
}
