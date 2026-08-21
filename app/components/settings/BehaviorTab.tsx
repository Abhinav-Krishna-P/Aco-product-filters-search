import { Checkbox, InlineGrid, Select, TextField } from "@shopify/polaris";
import {
  APPLY_BUTTON_TEXT_MAX,
  type ApplyButtonConfig,
  type BehaviorConfig,
} from "../../models/filterConfig.shared";
import { ColorField } from "./ColorField";
import { SettingsSection, SettingsSubgroup } from "./SettingsSection";

/** Behavior tab — open/collapse defaults, counts, apply mode, animations. */

type Props = {
  behavior: BehaviorConfig;
  onChange: (behavior: BehaviorConfig) => void;
};

/** Packed field grids: 3-up for inputs, 2-up for toggles. */
// Viewport breakpoints, but the content column is ~560px narrower than the
// viewport, so three columns only fit from xl up.
const FIELDS_3 = { xs: 1, sm: 2, xl: 3 } as const;
const FIELDS_2 = { xs: 1, sm: 2 } as const;

export function BehaviorTab({ behavior, onChange }: Readonly<Props>) {
  const set = <K extends keyof BehaviorConfig>(k: K, v: BehaviorConfig[K]) =>
    onChange({ ...behavior, [k]: v });
  const setButton = <K extends keyof ApplyButtonConfig>(
    k: K,
    v: ApplyButtonConfig[K],
  ) => set("applyButton", { ...behavior.applyButton, [k]: v });

  return (
    <s-stack gap="base">
      <SettingsSection
        title="Groups"
        description="How filter groups open, collapse and animate."
      >
        <s-stack gap="base">
          <InlineGrid columns={FIELDS_2} gap="300">
            <Checkbox
              label="Open filter groups by default"
              checked={behavior.defaultOpen}
              onChange={(v) => set("defaultOpen", v)}
              helpText="Each filter can override this (Filters tab → Edit)."
            />
            <Checkbox
              label="Groups are collapsible"
              checked={behavior.collapsible}
              onChange={(v) => set("collapsible", v)}
            />
            <Checkbox
              label="Accordion mode"
              checked={behavior.accordion}
              onChange={(v) => set("accordion", v)}
              disabled={!behavior.collapsible}
              helpText="Opening a group closes the others."
            />
          </InlineGrid>
          <InlineGrid columns={FIELDS_3} gap="300">
            <Select
              label="Open/close animation"
              options={[
                { label: "Slide", value: "slide" },
                { label: "None", value: "none" },
              ]}
              value={behavior.animation}
              onChange={(v) =>
                set("animation", v as BehaviorConfig["animation"])
              }
            />
            <TextField
              label="Collapse values after"
              type="number"
              value={String(behavior.collapseAfter)}
              onChange={(v) =>
                set("collapseAfter", Math.max(0, parseInt(v, 10) || 0))
              }
              autoComplete="off"
              suffix="values"
              helpText="Hide the rest behind “Show more” (0 = show all)."
            />
          </InlineGrid>
        </s-stack>
      </SettingsSection>

      <SettingsSection
        title="Values"
        description="Counts, empty values and the in-filter search box."
      >
        <s-stack gap="base">
          <InlineGrid columns={FIELDS_2} gap="300">
            <Checkbox
              label="Show product counts next to values"
              checked={behavior.showCounts}
              onChange={(v) => set("showCounts", v)}
            />
            <Checkbox
              label="Hide values that would give zero results"
              checked={behavior.hideEmpty}
              onChange={(v) => set("hideEmpty", v)}
              helpText="Dynamic faceting — recomputed as the shopper filters."
            />
            {behavior.hideEmpty && (
              <Checkbox
                label="Grey out instead of hiding"
                checked={behavior.disableEmpty}
                onChange={(v) => set("disableEmpty", v)}
              />
            )}
          </InlineGrid>
          <InlineGrid columns={FIELDS_3} gap="300">
            <TextField
              label="Search box threshold"
              type="number"
              value={String(behavior.searchThreshold)}
              onChange={(v) =>
                set("searchThreshold", Math.max(0, parseInt(v, 10) || 0))
              }
              autoComplete="off"
              suffix="values"
              helpText="Show a search box in filters with at least N values (0 = never)."
            />
          </InlineGrid>
        </s-stack>
      </SettingsSection>

      <SettingsSection
        title="Applying filters"
        description="Apply instantly or with a button, scroll behavior and the Smart Filters bar."
      >
        <s-stack gap="base">
          <InlineGrid columns={FIELDS_3} gap="300">
            <Select
              label="Apply mode"
              options={[
                { label: "Instantly on every change", value: "instant" },
                {
                  label: "Only when the shopper clicks “Apply”",
                  value: "button",
                },
              ]}
              value={behavior.applyMode}
              onChange={(v) =>
                set("applyMode", v as BehaviorConfig["applyMode"])
              }
            />
          </InlineGrid>
          {behavior.applyMode === "button" && (
            <SettingsSubgroup>
              <s-stack gap="small">
                <s-text type="strong">Apply button</s-text>
                <InlineGrid columns={FIELDS_3} gap="300">
                  <TextField
                    label="Button text"
                    value={behavior.applyButton.text}
                    onChange={(v) => setButton("text", v)}
                    maxLength={APPLY_BUTTON_TEXT_MAX}
                    showCharacterCount
                    autoComplete="off"
                    placeholder="Apply filters"
                  />
                  <Select
                    label="Button size"
                    options={[
                      { label: "Small", value: "small" },
                      { label: "Medium", value: "medium" },
                      { label: "Large", value: "large" },
                    ]}
                    value={behavior.applyButton.size}
                    onChange={(v) =>
                      setButton("size", v as ApplyButtonConfig["size"])
                    }
                  />
                  <Select
                    label="Corners"
                    options={[
                      { label: "Edged", value: "edged" },
                      { label: "Rounded", value: "rounded" },
                    ]}
                    value={behavior.applyButton.corners}
                    onChange={(v) =>
                      setButton("corners", v as ApplyButtonConfig["corners"])
                    }
                  />
                  <ColorField
                    label="Button color"
                    value={behavior.applyButton.bgColor}
                    onChange={(v) => setButton("bgColor", v)}
                  />
                  <ColorField
                    label="Text color"
                    value={behavior.applyButton.textColor}
                    onChange={(v) => setButton("textColor", v)}
                  />
                </InlineGrid>
              </s-stack>
            </SettingsSubgroup>
          )}
          <InlineGrid columns={FIELDS_2} gap="300">
            <Checkbox
              label="Scroll to results after applying"
              checked={behavior.scrollTop}
              onChange={(v) => set("scrollTop", v)}
            />
            <Checkbox
              label="Show Smart Filters bar"
              checked={behavior.smartFilters}
              onChange={(v) => set("smartFilters", v)}
              helpText="Shoppers type plain English (e.g. “red under $50”) to apply matching filters."
            />
          </InlineGrid>
        </s-stack>
      </SettingsSection>
    </s-stack>
  );
}
