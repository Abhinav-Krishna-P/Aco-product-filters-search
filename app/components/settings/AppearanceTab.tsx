import { Checkbox, InlineGrid, Select, TextField } from "@shopify/polaris";
import type { AppearanceConfig } from "../../models/filterConfig.shared";
import { APPEARANCE_PRESETS } from "../../models/filterConfig.shared";
import { ColorField } from "./ColorField";
import { SettingsSection, SettingsSubgroup } from "./SettingsSection";
import { NumberField } from "./NumberField";

/** Appearance tab — colors, presets, radius, density, swatch style, typography. */

type Props = {
  appearance: AppearanceConfig;
  onChange: (appearance: AppearanceConfig) => void;
};

/** Packed field grids: 3-up for inputs, 2-up for toggles. */
// Viewport breakpoints, but the content column is ~560px narrower than the
// viewport, so three columns only fit from xl up.
const FIELDS_3 = { xs: 1, sm: 2, xl: 3 } as const;
const FIELDS_2 = { xs: 1, sm: 2 } as const;

const COLOR_FIELDS: { key: keyof AppearanceConfig["colors"]; label: string }[] =
  [
    { key: "accent", label: "Accent (selected states)" },
    { key: "text", label: "Text" },
    { key: "muted", label: "Muted text (counts)" },
    { key: "border", label: "Borders" },
    { key: "background", label: "Panel background" },
    { key: "hoverBg", label: "Hover background" },
    { key: "selectedBg", label: "Selected background" },
    // Active-chip colours are edited contextually in the Layout tab, under the
    // "Show active filter chips" toggle.
  ];

export function AppearanceTab({ appearance, onChange }: Props) {
  const set = <K extends keyof AppearanceConfig>(
    k: K,
    v: AppearanceConfig[K],
  ) => onChange({ ...appearance, [k]: v });

  return (
    <s-stack gap="base">
      <SettingsSection
        title="Colors"
        description="Pick a preset or set each color by hand. Turn off theme inheritance to customize."
      >
        <s-stack gap="base">
          <Checkbox
            label="Inherit colors from theme (no overrides)"
            checked={appearance.inheritTheme}
            onChange={(v) => set("inheritTheme", v)}
            helpText="When on, the filter UI blends into your theme. Turn off to pick custom colors."
          />
          {!appearance.inheritTheme && (
            <SettingsSubgroup>
              <s-stack gap="base">
                <s-stack gap="small-200">
                  <s-text color="subdued">Presets</s-text>
                  <s-stack direction="inline" gap="small-200">
                    {APPEARANCE_PRESETS.map((p) => (
                      <s-button
                        key={p.name}
                        variant={
                          appearance.preset === p.name ? "primary" : "secondary"
                        }
                        onClick={() =>
                          onChange({
                            ...appearance,
                            preset: p.name,
                            colors: { ...p.colors },
                          })
                        }
                      >
                        {p.name}
                      </s-button>
                    ))}
                  </s-stack>
                </s-stack>
                <InlineGrid columns={FIELDS_3} gap="300">
                  {COLOR_FIELDS.map(({ key, label }) => (
                    <ColorField
                      key={key}
                      label={label}
                      value={appearance.colors[key]}
                      onChange={(hex) =>
                        onChange({
                          ...appearance,
                          // Any manual edit means this is no longer a preset.
                          preset: "",
                          colors: { ...appearance.colors, [key]: hex },
                        })
                      }
                    />
                  ))}
                </InlineGrid>
              </s-stack>
            </SettingsSubgroup>
          )}
        </s-stack>
      </SettingsSection>

      <SettingsSection
        title="Shape, density & group icon"
        description="Corner rounding, row spacing and the open / close indicator on each filter group."
      >
        <s-stack gap="base">
          <InlineGrid columns={FIELDS_3} gap="300">
            <NumberField
              label="Corner radius"
              unit="px"
              min={0}
              max={20}
              step={1}
              value={appearance.radius}
              onChange={(v) => set("radius", v)}
            />
            <Select
              label="Row density"
              options={[
                { label: "Comfortable", value: "comfortable" },
                { label: "Cozy", value: "cozy" },
                { label: "Compact", value: "compact" },
              ]}
              value={appearance.density}
              onChange={(v) => set("density", v as AppearanceConfig["density"])}
            />
            <Select
              label="Open / close icon"
              options={[
                { label: "Chevron (arrow)", value: "chevron" },
                { label: "Plus / minus", value: "plus" },
                { label: "Triangle (caret)", value: "caret" },
              ]}
              value={appearance.groupIcon}
              onChange={(v) =>
                set("groupIcon", v as AppearanceConfig["groupIcon"])
              }
            />
          </InlineGrid>
          <Checkbox
            label="Animate the group icon when opening / closing"
            checked={appearance.groupIconAnimate}
            onChange={(v) => set("groupIconAnimate", v)}
          />
        </s-stack>
      </SettingsSection>

      <SettingsSection
        title="Color swatches"
        description="Shape, size and hover behavior of color and image swatches."
      >
        <s-stack gap="base">
          <InlineGrid columns={FIELDS_3} gap="300">
            <Select
              label="Shape"
              options={[
                { label: "Circle", value: "circle" },
                { label: "Square", value: "square" },
                { label: "Rounded square", value: "rounded" },
              ]}
              value={appearance.swatch.shape}
              onChange={(v) =>
                set("swatch", {
                  ...appearance.swatch,
                  shape: v as AppearanceConfig["swatch"]["shape"],
                })
              }
            />
            <Select
              label="Selected indicator"
              options={[
                { label: "Ring", value: "ring" },
                { label: "Checkmark", value: "check" },
                { label: "Bold border", value: "border" },
              ]}
              value={appearance.swatch.selectedIndicator}
              onChange={(v) =>
                set("swatch", {
                  ...appearance.swatch,
                  selectedIndicator:
                    v as AppearanceConfig["swatch"]["selectedIndicator"],
                })
              }
            />
            <NumberField
              label="Swatch size"
              unit="px"
              min={14}
              max={36}
              step={2}
              value={appearance.swatch.size}
              onChange={(v) => set("swatch", { ...appearance.swatch, size: v })}
            />
            <Select
              label="Hover effect"
              options={[
                { label: "Grow (zoom in)", value: "grow" },
                { label: "Lift (raise + shadow)", value: "lift" },
                { label: "Accent border", value: "border" },
              ]}
              value={
                appearance.swatch.hoverEffect === "none"
                  ? "grow"
                  : appearance.swatch.hoverEffect
              }
              onChange={(v) =>
                set("swatch", {
                  ...appearance.swatch,
                  hoverEffect: v as AppearanceConfig["swatch"]["hoverEffect"],
                })
              }
              disabled={!appearance.swatch.hoverEnabled}
            />
          </InlineGrid>
          <InlineGrid columns={FIELDS_2} gap="300">
            <Checkbox
              label="Enable hover effect on swatches"
              checked={appearance.swatch.hoverEnabled}
              onChange={(v) =>
                set("swatch", { ...appearance.swatch, hoverEnabled: v })
              }
            />
            <Checkbox
              label="Show value label next to swatch"
              checked={appearance.swatch.showLabel}
              onChange={(v) =>
                set("swatch", { ...appearance.swatch, showLabel: v })
              }
            />
          </InlineGrid>
        </s-stack>
      </SettingsSection>

      <SettingsSection
        title="Typography"
        description="Font size, weight and casing for filter labels."
      >
        <s-stack gap="base">
          <Checkbox
            label="Inherit typography from theme"
            checked={appearance.typography.inherit}
            onChange={(v) =>
              set("typography", { ...appearance.typography, inherit: v })
            }
          />
          {!appearance.typography.inherit && (
            <SettingsSubgroup>
              <InlineGrid columns={FIELDS_3} gap="300">
                <TextField
                  label="Label size"
                  type="number"
                  suffix="px"
                  value={String(appearance.typography.labelSize)}
                  onChange={(v) =>
                    set("typography", {
                      ...appearance.typography,
                      labelSize: parseInt(v, 10) || 14,
                    })
                  }
                  autoComplete="off"
                />
                <Select
                  label="Label weight"
                  options={[
                    { label: "Regular (400)", value: "400" },
                    { label: "Medium (500)", value: "500" },
                    { label: "Semibold (600)", value: "600" },
                  ]}
                  value={String(appearance.typography.labelWeight)}
                  onChange={(v) =>
                    set("typography", {
                      ...appearance.typography,
                      labelWeight: parseInt(v, 10),
                    })
                  }
                />
                <div style={{ paddingTop: 22 }}>
                  <Checkbox
                    label="Uppercase labels"
                    checked={appearance.typography.uppercase}
                    onChange={(v) =>
                      set("typography", {
                        ...appearance.typography,
                        uppercase: v,
                      })
                    }
                  />
                </div>
              </InlineGrid>
            </SettingsSubgroup>
          )}
        </s-stack>
      </SettingsSection>
    </s-stack>
  );
}
