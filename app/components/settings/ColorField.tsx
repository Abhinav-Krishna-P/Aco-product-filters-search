import { useEffect, useMemo, useState } from "react";
import {
  BlockStack,
  ColorPicker,
  InlineStack,
  Popover,
  Text,
  TextField,
  hexToRgb,
  hsbToHex,
  rgbToHsb,
} from "@shopify/polaris";

/**
 * Swatch + Polaris colour picker with a hex field.
 *
 * The settings pages used the browser's native `<input type="color">`, which
 * renders a different dialog per OS and — on Windows — offers no way to type a
 * hex code, so merchants matching a brand colour had no way to enter it. This
 * wraps Polaris's ColorPicker in a popover and pairs it with a hex input, so
 * dragging and typing both work everywhere.
 *
 * `value` is always a `#rrggbb` string; the parent never sees anything else.
 */

const HEX_RE = /^#?([0-9a-f]{3}|[0-9a-f]{6})$/i;

/** "#abc" -> "#aabbcc"; invalid input returns null so the caller can ignore it. */
function normalizeHex(input: string): string | null {
  const m = HEX_RE.exec(input.trim());
  if (!m) return null;
  const body = m[1];
  const full =
    body.length === 3
      ? body
          .split("")
          .map((c) => c + c)
          .join("")
      : body;
  return `#${full.toLowerCase()}`;
}

export function ColorField({
  label,
  value,
  onChange,
  helpText,
  labelHidden = false,
  swatchSize = 32,
}: Readonly<{
  label: string;
  value: string;
  onChange: (hex: string) => void;
  helpText?: string;
  /** Swatch only — for dense rows where the label lives elsewhere. */
  labelHidden?: boolean;
  swatchSize?: number;
}>) {
  const [open, setOpen] = useState(false);
  // The hex box is free text while being typed — a half-finished "#ff" must not
  // be pushed upstream — so it keeps its own state until it parses.
  const [draft, setDraft] = useState(value);

  useEffect(() => {
    setDraft(value);
  }, [value]);

  const safe = normalizeHex(value) ?? "#000000";
  const hsb = useMemo(() => rgbToHsb(hexToRgb(safe)), [safe]);

  const commitDraft = (next: string) => {
    setDraft(next);
    const hex = normalizeHex(next);
    if (hex) onChange(hex);
  };

  return (
    <Popover
      active={open}
      onClose={() => setOpen(false)}
      preferredAlignment="left"
      activator={
        <button
          type="button"
          onClick={() => setOpen((o) => !o)}
          aria-label={`${label}: ${safe}`}
          style={{
            display: "flex",
            alignItems: "center",
            gap: 8,
            background: "none",
            border: "none",
            padding: 0,
            cursor: "pointer",
            font: "inherit",
            textAlign: "left",
          }}
        >
          <span
            aria-hidden="true"
            style={{
              width: swatchSize,
              height: swatchSize,
              flex: "0 0 auto",
              borderRadius: 6,
              border: "1px solid #ccc",
              background: safe,
            }}
          />
          {!labelHidden && <span style={{ fontSize: 13 }}>{label}</span>}
        </button>
      }
    >
      <Popover.Pane>
        <div style={{ padding: 12 }}>
          <BlockStack gap="300">
            <ColorPicker
              color={hsb}
              onChange={(c) => {
                const hex = hsbToHex(c);
                setDraft(hex);
                onChange(hex);
              }}
            />
            <InlineStack gap="200" blockAlign="center" wrap={false}>
              <div style={{ width: 130 }}>
                <TextField
                  label="Hex"
                  labelHidden
                  prefix="#"
                  value={draft.replace(/^#/, "")}
                  onChange={(v) => commitDraft(v)}
                  autoComplete="off"
                  maxLength={6}
                  error={normalizeHex(draft) === null}
                />
              </div>
              <Text as="span" variant="bodySm" tone="subdued">
                {label}
              </Text>
            </InlineStack>
            {helpText && (
              <Text as="p" variant="bodySm" tone="subdued">
                {helpText}
              </Text>
            )}
          </BlockStack>
        </div>
      </Popover.Pane>
    </Popover>
  );
}
