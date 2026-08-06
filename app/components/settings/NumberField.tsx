import { useEffect, useRef } from "react";
import type React from "react";

/**
 * Shopify `s-number-field` with min/max clamping. Replaces the old range
 * sliders: the merchant types a value, it is clamped on blur, and `onChange`
 * always receives a number.
 *
 * React 18 doesn't wire custom-element events, so listeners are attached by
 * ref (same approach as the s-switch in AdvancedTab).
 */

type Props = {
  label: string;
  value: number;
  min: number;
  max: number;
  step?: number;
  /** Suffix shown inside the field (e.g. "px"). */
  unit?: string;
  helpText?: string;
  onChange: (value: number) => void;
};

function clamp(v: number, min: number, max: number) {
  return Math.min(max, Math.max(min, v));
}

export function NumberField({
  label,
  value,
  min,
  max,
  step = 1,
  unit,
  helpText,
  onChange,
}: Props) {
  const ref = useRef<React.ElementRef<"s-number-field">>(null);
  const latest = useRef({ value, min, max, onChange });
  latest.current = { value, min, max, onChange };

  // Push the committed value into the element whenever it changes upstream
  // (slider → number migration, reset, import).
  useEffect(() => {
    const el = ref.current;
    if (el && String(el.value ?? "") !== String(value))
      el.value = String(value);
  }, [value]);

  useEffect(() => {
    const el = ref.current;
    if (!el) return;

    const read = () => {
      const raw = String(el.value ?? "").trim();
      const n = Number(raw);
      return raw === "" || !Number.isFinite(n) ? null : n;
    };

    // Live updates while typing, only when already in range.
    const onInput = () => {
      const n = read();
      const { min, max, value, onChange } = latest.current;
      if (n !== null && n >= min && n <= max && n !== value) onChange(n);
    };

    // Commit: clamp out-of-range input, restore when emptied.
    const onCommit = () => {
      const n = read();
      const { min, max, value, onChange } = latest.current;
      if (n === null) {
        el.value = String(value);
        return;
      }
      const next = clamp(n, min, max);
      if (next !== value) onChange(next);
      el.value = String(next);
    };

    el.addEventListener("input", onInput);
    el.addEventListener("change", onCommit);
    el.addEventListener("blur", onCommit);
    return () => {
      el.removeEventListener("input", onInput);
      el.removeEventListener("change", onCommit);
      el.removeEventListener("blur", onCommit);
    };
  }, []);

  return (
    <s-number-field
      ref={ref}
      label={label}
      value={String(value)}
      min={min}
      max={max}
      step={step}
      suffix={unit}
      details={helpText ?? `${min}–${max}${unit ?? ""}`}
      inputMode="numeric"
    />
  );
}
