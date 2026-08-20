import { useState } from "react";
import {
  BlockStack,
  Box,
  Checkbox,
  InlineGrid,
  InlineStack,
  Select,
  TextField,
} from "@shopify/polaris";
import type { SortConfig, SortKey } from "../../models/filterConfig.shared";
import {
  LABEL_MAX_LENGTH,
  SORT_KEY_LABELS,
} from "../../models/filterConfig.shared";
import { SettingsSection } from "./SettingsSection";

/**
 * Sort tab — the storefront sort dropdown: whether to show it, where it sits,
 * which options it offers (renamed, and reordered by dragging), and which one
 * is the default.
 */

type Props = {
  sort: SortConfig;
  onChange: (sort: SortConfig) => void;
};

export function SortTab({ sort, onChange }: Readonly<Props>) {
  const [dragIndex, setDragIndex] = useState<number | null>(null);
  const [overIndex, setOverIndex] = useState<number | null>(null);
  // Rows hold a text input, so the row is only draggable while the grip is
  // held — otherwise selecting label text would start a drag.
  const [grabbed, setGrabbed] = useState<number | null>(null);

  const set = <K extends keyof SortConfig>(k: K, v: SortConfig[K]) =>
    onChange({ ...sort, [k]: v });

  const patchOption = (
    key: SortKey,
    patch: Partial<SortConfig["options"][number]>,
  ) =>
    set(
      "options",
      sort.options.map((o) => (o.key === key ? { ...o, ...patch } : o)),
    );

  // Reorder (remove + reinsert), so a drag across several rows lands where the
  // shopper-facing dropdown will actually show it.
  const move = (from: number, to: number) => {
    if (to < 0 || to >= sort.options.length || from === to) return;
    const next = sort.options.slice();
    const [item] = next.splice(from, 1);
    next.splice(to, 0, item);
    set("options", next);
  };

  const endDrag = () => {
    setDragIndex(null);
    setOverIndex(null);
    setGrabbed(null);
  };

  return (
    <BlockStack gap="400">
      <SettingsSection
        title="Sort dropdown"
        description="Whether shoppers get a sort control, and where it sits."
      >
        <BlockStack gap="300">
          <Checkbox
            label="Show a sort dropdown"
            checked={sort.enabled}
            onChange={(v) => set("enabled", v)}
            helpText="Lets shoppers reorder the results. The choice is kept in the URL, so sorted pages are shareable."
          />
          {sort.enabled && (
            <>
              <InlineGrid columns={{ xs: 1, sm: 2 }} gap="400">
                <Select
                  label="Position"
                  options={[
                    {
                      label: "Above the grid (next to the product count)",
                      value: "toolbar",
                    },
                    { label: "Top of the filter panel", value: "panel" },
                    {
                      label: "Top right (next to the column switcher)",
                      value: "top-right",
                    },
                  ]}
                  value={sort.position}
                  onChange={(v) => set("position", v as SortConfig["position"])}
                />
                <TextField
                  label="Dropdown label"
                  value={sort.label}
                  onChange={(v) => set("label", v)}
                  autoComplete="off"
                  maxLength={LABEL_MAX_LENGTH}
                  showCharacterCount
                />
              </InlineGrid>
              <Checkbox
                label="Show the label next to the dropdown"
                checked={sort.showLabel}
                onChange={(v) => set("showLabel", v)}
                helpText="When hidden, the label is still read out to screen readers."
              />
            </>
          )}
        </BlockStack>
      </SettingsSection>

      {sort.enabled && (
        <SettingsSection
          title="Options"
          description="Tick the sorts to offer and rename them for your shoppers. Drag the rows by their handle to set the order they appear in the dropdown."
        >
          <BlockStack gap="300">
            {sort.options.map((o, i) => (
              <div
                key={o.key}
                draggable={grabbed === i}
                onDragStart={(e) => {
                  setDragIndex(i);
                  e.dataTransfer.effectAllowed = "move";
                }}
                onDragOver={(e) => {
                  e.preventDefault();
                  if (overIndex !== i) setOverIndex(i);
                }}
                onDrop={(e) => {
                  e.preventDefault();
                  if (dragIndex !== null) move(dragIndex, i);
                  endDrag();
                }}
                onDragEnd={endDrag}
                style={{
                  opacity: dragIndex === i ? 0.4 : 1,
                  borderTop:
                    overIndex === i && dragIndex !== null && dragIndex !== i
                      ? "2px solid #4a7dff"
                      : "2px solid transparent",
                }}
              >
                <Box
                  padding="200"
                  borderColor="border"
                  borderWidth="025"
                  borderRadius="200"
                >
                  <InlineStack gap="300" blockAlign="center">
                    <span
                      aria-hidden="true"
                      onMouseDown={() => setGrabbed(i)}
                      onMouseUp={() => setGrabbed(null)}
                      style={{
                        cursor: "grab",
                        color: "#999",
                        fontSize: 16,
                        userSelect: "none",
                      }}
                    >
                      ⠿
                    </span>
                    <div style={{ flex: "0 1 200px", minWidth: 0 }}>
                      <Checkbox
                        label={SORT_KEY_LABELS[o.key]}
                        checked={o.enabled}
                        onChange={(v) => patchOption(o.key, { enabled: v })}
                      />
                    </div>
                    <div style={{ flex: "1 1 180px", minWidth: 0 }}>
                      <TextField
                        label="Shopper-facing label"
                        labelHidden
                        value={o.label}
                        placeholder={SORT_KEY_LABELS[o.key]}
                        onChange={(v) => patchOption(o.key, { label: v })}
                        disabled={!o.enabled}
                        autoComplete="off"
                        maxLength={LABEL_MAX_LENGTH}
                      />
                    </div>
                  </InlineStack>
                </Box>
              </div>
            ))}
          </BlockStack>
        </SettingsSection>
      )}
    </BlockStack>
  );
}
