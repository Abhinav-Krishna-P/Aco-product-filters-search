import { useState } from "react";
import { Checkbox } from "@shopify/polaris";
import { SettingsSection } from "./SettingsSection";
import type {
  AdminFilter,
  BehaviorConfig,
} from "../../models/filterConfig.shared";
import {
  SNAPSHOT_BYTE_LIMIT,
  filterKindLabel,
  slugify,
} from "../../models/filterConfig.shared";
import { styleLabel } from "./filtersTabTypes";
import { NewCustomFilterModal } from "./NewCustomFilterModal";
import { FilterEditorModal } from "./FilterEditorModal";

/**
 * Filters tab — reorderable filter list (native HTML5 drag-and-drop, plus
 * keyboard-friendly up/down buttons), enable toggles, and a per-filter editor
 * modal with per-value settings (rename, swatch color, hide, pin, reorder).
 */

type Props = {
  filters: AdminFilter[];
  behavior: BehaviorConfig;
  snapshotBytes: number;
  onChange: (filters: AdminFilter[]) => void;
};

export function FiltersTab({
  filters,
  behavior,
  snapshotBytes,
  onChange,
}: Props) {
  const [dragIndex, setDragIndex] = useState<number | null>(null);
  const [overIndex, setOverIndex] = useState<number | null>(null);
  const [editingKey, setEditingKey] = useState<string | null>(null);
  const [creating, setCreating] = useState(false);

  const editing = filters.find((f) => f.key === editingKey) ?? null;

  /**
   * Custom filters are merchant-authored, so their key must be unique and
   * stable (it becomes the pf_custom_<key> storefront param). Detect never
   * touches these keys, so they survive a re-detect untouched.
   */
  const addCustom = (name: string) => {
    const base = slugify(name) || "custom";
    let key = `custom_${base}`;
    let n = 2;
    while (filters.some((f) => f.key === key)) key = `custom_${base}-${n++}`;
    onChange([
      ...filters,
      {
        key,
        type: "custom",
        name: null,
        label: name.trim() || "Custom filter",
        enabled: true,
        order: filters.length,
        displayStyle: "checkbox",
        defaultOpen: null,
        collapseAfter: null,
        sortValuesBy: "manual",
        selectionMode: "multi",
        searchable: false,
        styleOptions: {},
        values: [],
      },
    ]);
    setCreating(false);
    setEditingKey(key);
  };

  const move = (from: number, to: number) => {
    if (to < 0 || to >= filters.length || from === to) return;
    const next = filters.slice();
    const [item] = next.splice(from, 1);
    next.splice(to, 0, item);
    onChange(next);
  };

  const patch = (key: string, p: Partial<AdminFilter>) =>
    onChange(filters.map((f) => (f.key === key ? { ...f, ...p } : f)));

  const remove = (key: string) =>
    onChange(filters.filter((f) => f.key !== key));

  const duplicate = (key: string) => {
    const src = filters.find((f) => f.key === key);
    if (!src) return;
    let copyKey = `${src.key}_copy`;
    let n = 2;
    while (filters.some((f) => f.key === copyKey))
      copyKey = `${src.key}_copy${n++}`;
    const copy: AdminFilter = {
      ...src,
      key: copyKey,
      label: `${src.label} (copy)`,
      values: src.values.map((v) => ({ ...v })),
    };
    const i = filters.findIndex((f) => f.key === key);
    const next = filters.slice();
    next.splice(i + 1, 0, copy);
    onChange(next);
  };

  const pctUsed = Math.round((snapshotBytes / SNAPSHOT_BYTE_LIMIT) * 100);

  return (
    <SettingsSection
      title="Filters"
      description="Drag filters to set the order they appear in on the storefront. Use Edit for display style, open/closed default, and per-value settings (rename, swatch colors, hide, pin)."
      actions={
        <s-button icon="plus" onClick={() => setCreating(true)}>
          Add custom filter
        </s-button>
      }
    >
      <s-stack gap="base">
        {pctUsed >= 80 && (
          <s-banner tone={pctUsed >= 100 ? "critical" : "warning"}>
            <s-paragraph>
              Your published settings use{" "}
              <s-text type="strong">{pctUsed}%</s-text> of Shopify&apos;s{" "}
              {SNAPSHOT_BYTE_LIMIT / 1024} KB config limit
              {pctUsed >= 100
                ? " — saving will not publish to the storefront until you remove some products or options from your custom filters."
                : ". Custom filters are the main contributor; adding many more products may hit the limit."}
            </s-paragraph>
          </s-banner>
        )}

        <s-stack gap="none">
          {filters.map((f, i) => (
            <div
              key={f.key}
              draggable
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
                setDragIndex(null);
                setOverIndex(null);
              }}
              onDragEnd={() => {
                setDragIndex(null);
                setOverIndex(null);
              }}
              style={{
                cursor: "grab",
                opacity: dragIndex === i ? 0.4 : 1,
                borderTop:
                  overIndex === i && dragIndex !== null && dragIndex !== i
                    ? "2px solid #4a7dff"
                    : "2px solid transparent",
              }}
            >
              <s-box paddingBlock="small">
                <s-grid
                  gridTemplateColumns="auto auto minmax(0, 1fr) auto"
                  gap="small"
                  alignItems="center"
                >
                  <s-icon type="drag-handle" color="subdued" />
                  <Checkbox
                    label=""
                    labelHidden
                    checked={f.enabled}
                    onChange={(v) => patch(f.key, { enabled: v })}
                  />
                  <s-stack direction="inline" gap="small" alignItems="center">
                    <s-text type="strong">{f.label}</s-text>
                    <s-badge tone={f.type === "custom" ? "success" : "neutral"}>
                      {filterKindLabel(f.type)}
                    </s-badge>
                    <s-badge tone="info">{styleLabel(f.displayStyle)}</s-badge>
                    {f.type !== "price" && f.type !== "available" && (
                      <s-text color="subdued">
                        {`${f.values.filter((v) => !v.hidden && !v.stale).length} values`}
                      </s-text>
                    )}
                  </s-stack>
                  <s-stack
                    direction="inline"
                    gap="small-200"
                    alignItems="center"
                  >
                    <s-button
                      variant="secondary"
                      onClick={() => setEditingKey(f.key)}
                    >
                      Edit
                    </s-button>
                    <s-button
                      variant="secondary"
                      icon="duplicate"
                      onClick={() => duplicate(f.key)}
                      accessibilityLabel={`Duplicate ${f.label}`}
                    />
                    <s-button
                      variant="secondary"
                      tone="critical"
                      icon="delete"
                      onClick={() => remove(f.key)}
                      accessibilityLabel={`Delete ${f.label}`}
                    />
                  </s-stack>
                </s-grid>
              </s-box>
              {i < filters.length - 1 && <s-divider />}
            </div>
          ))}
          {filters.length === 0 && (
            <s-paragraph color="subdued">
              No filters yet — run{" "}
              <s-text type="strong">Detect filter values</s-text> in the
              Advanced tab.
            </s-paragraph>
          )}
        </s-stack>

        {creating && (
          <NewCustomFilterModal
            onClose={() => setCreating(false)}
            onCreate={addCustom}
          />
        )}

        {editing && (
          <FilterEditorModal
            filter={editing}
            behavior={behavior}
            onClose={() => setEditingKey(null)}
            onChange={(p) => patch(editing.key, p)}
          />
        )}
      </s-stack>
    </SettingsSection>
  );
}
