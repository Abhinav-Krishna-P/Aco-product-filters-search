import { Checkbox, InlineGrid, Select, TextField } from "@shopify/polaris";
import type { LayoutConfig } from "../../models/filterConfig.shared";
import { LABEL_MAX_LENGTH } from "../../models/filterConfig.shared";
import { ColorField } from "./ColorField";
import { SettingsSection, SettingsSubgroup } from "./SettingsSection";
import { NumberField } from "./NumberField";

/** Layout tab — filter placement/structure, sidebar, grid and chrome toggles. */

type Props = {
  layout: LayoutConfig;
  onChange: (layout: LayoutConfig) => void;
  chipColors: { bg: string; text: string };
  onChipColorsChange: (colors: { bg: string; text: string }) => void;
};

/** Packed field grids: 3-up for inputs, 2-up for toggles. */
// Viewport breakpoints, but the content column is ~560px narrower than the
// viewport, so three columns only fit from xl up.
const FIELDS_3 = { xs: 1, sm: 2, xl: 3 } as const;
const FIELDS_2 = { xs: 1, sm: 2 } as const;

export function LayoutTab({
  layout,
  onChange,
  chipColors,
  onChipColorsChange,
}: Props) {
  const set = <K extends keyof LayoutConfig>(k: K, v: LayoutConfig[K]) =>
    onChange({ ...layout, [k]: v });

  const isSidebar =
    layout.structure === "sidebar-left" || layout.structure === "sidebar-right";

  return (
    <s-stack gap="base">
      <SettingsSection
        title="Filter placement"
        description="Where the filter panel sits relative to the product grid on desktop and mobile."
      >
        <s-stack gap="base">
          <InlineGrid columns={FIELDS_3} gap="300">
            <Select
              label="Structure"
              options={[
                { label: "Vertical sidebar — left", value: "sidebar-left" },
                { label: "Vertical sidebar — right", value: "sidebar-right" },
                {
                  label: "Horizontal bar above products",
                  value: "horizontal",
                },
                {
                  label: "Off-canvas drawer (Filter button)",
                  value: "drawer",
                },
              ]}
              value={layout.structure}
              onChange={(v) => set("structure", v as LayoutConfig["structure"])}
              helpText="Desktop layout."
            />
            <Select
              label="Mobile behavior"
              options={[
                { label: "Off-canvas drawer (recommended)", value: "drawer" },
                { label: "Inline above products", value: "inline" },
              ]}
              value={layout.mobileMode}
              onChange={(v) =>
                set("mobileMode", v as LayoutConfig["mobileMode"])
              }
              helpText="Mobile layout."
            />
            {layout.structure === "horizontal" && (
              <Select
                label="Filter bar style"
                options={[
                  { label: "Outlined — each filter boxed", value: "outlined" },
                  { label: "Borderless — spacing only", value: "borderless" },
                  { label: "Boxed bar — one container", value: "boxed" },
                ]}
                value={layout.horizontalStyle}
                onChange={(v) =>
                  set("horizontalStyle", v as LayoutConfig["horizontalStyle"])
                }
                helpText="Dropdown panels stay bordered in every option."
              />
            )}
            {isSidebar && (
              <NumberField
                label="Sidebar width"
                unit="px"
                min={200}
                max={360}
                step={10}
                value={layout.sidebarWidth}
                onChange={(v) => set("sidebarWidth", v)}
              />
            )}
          </InlineGrid>
          {isSidebar && (
            <Checkbox
              label="Sticky sidebar (stays visible while scrolling)"
              checked={layout.sidebarSticky}
              onChange={(v) => set("sidebarSticky", v)}
            />
          )}
        </s-stack>
      </SettingsSection>

      <SettingsSection
        title="Product grid"
        description="Columns, page size, spacing and pagination for the results."
      >
        <s-stack gap="base">
          <Checkbox
            label="Show column switcher (3/4)"
            checked={layout.showColumnSwitcher}
            onChange={(v) => set("showColumnSwitcher", v)}
            helpText="Shoppers choose 3 or 4 columns on desktop and the choice is remembered in their browser. While this is on, the desktop column setting below is not used."
          />
          <InlineGrid columns={FIELDS_3} gap="300">
            {!layout.showColumnSwitcher && (
              <Select
                label="Columns (desktop)"
                options={["2", "3", "4", "5"].map((n) => ({
                  label: `${n} columns`,
                  value: n,
                }))}
                value={String(layout.columnsDesktop)}
                onChange={(v) => set("columnsDesktop", parseInt(v, 10))}
              />
            )}
            <Select
              label="Columns (mobile)"
              options={[
                { label: "1 column", value: "1" },
                { label: "2 columns", value: "2" },
              ]}
              value={String(layout.columnsMobile)}
              onChange={(v) => set("columnsMobile", parseInt(v, 10))}
            />
            <Select
              label="Pagination style"
              options={[
                { label: "Basic — Previous / Page / Next", value: "basic" },
                { label: "Rounded pill", value: "pill" },
                { label: "Numbered", value: "numbered" },
                { label: "Segmented toolbar", value: "segmented" },
                { label: "Text links", value: "text" },
                { label: "Numbered with Go to page", value: "jump" },
              ]}
              value={layout.paginationStyle}
              onChange={(v) =>
                set("paginationStyle", v as LayoutConfig["paginationStyle"])
              }
            />
            <NumberField
              label="Products per page"
              min={10}
              max={30}
              step={1}
              value={layout.productsPerPage}
              onChange={(v) => set("productsPerPage", v)}
            />
            <NumberField
              label="Grid gap"
              min={5}
              max={30}
              step={1}
              value={layout.gap}
              helpText={`Tenths of a rem (now ${(layout.gap / 10).toFixed(1)}rem)`}
              onChange={(v) => set("gap", v)}
            />
          </InlineGrid>
        </s-stack>
      </SettingsSection>

      <SettingsSection
        title="Panel chrome"
        description="Heading, active-filter chips, results count and dividers around the filter panel."
      >
        <s-stack gap="base">
          <InlineGrid columns={FIELDS_2} gap="300">
            <Checkbox
              label="Show panel heading"
              checked={layout.showHeading}
              onChange={(v) => set("showHeading", v)}
            />
            <Checkbox
              label="Show active filter chips"
              checked={layout.showActiveChips}
              onChange={(v) => set("showActiveChips", v)}
              helpText="Applied filters as removable tags."
            />
            <Checkbox
              label="Show results count"
              checked={layout.showResultsCount}
              onChange={(v) => set("showResultsCount", v)}
            />
            <Checkbox
              label="Show “Clear all” link"
              checked={layout.showClearAll}
              onChange={(v) => set("showClearAll", v)}
            />
            <Checkbox
              label="Show dividers between filter groups"
              checked={layout.showGroupDividers}
              onChange={(v) => set("showGroupDividers", v)}
            />
          </InlineGrid>

          {layout.showHeading && (
            <SettingsSubgroup>
              <s-stack gap="small">
                <s-text type="strong">Panel heading</s-text>
                <InlineGrid columns={FIELDS_2} gap="300">
                  <TextField
                    label="Heading text"
                    value={layout.headingText}
                    onChange={(v) => set("headingText", v)}
                    placeholder="Filters"
                    autoComplete="off"
                    maxLength={LABEL_MAX_LENGTH}
                    showCharacterCount
                  />
                  <NumberField
                    label="Heading font size"
                    unit="px"
                    min={12}
                    max={32}
                    step={1}
                    value={layout.headingSize}
                    onChange={(v) => set("headingSize", v)}
                  />
                </InlineGrid>
              </s-stack>
            </SettingsSubgroup>
          )}

          {layout.showActiveChips && (
            <SettingsSubgroup>
              <s-stack gap="small">
                <s-text type="strong">Active filter chips</s-text>
                {/* Bottom-aligned: the select's label sits above its field,
                    the colour swatches carry their label beside them. */}
                <InlineGrid columns={FIELDS_3} gap="300" alignItems="end">
                  <Select
                    label="Chip design"
                    options={[
                      { label: "Pill (fully rounded)", value: "pill" },
                      { label: "Rounded corners", value: "rounded" },
                      { label: "Square", value: "square" },
                    ]}
                    value={layout.chipStyle}
                    onChange={(v) =>
                      set("chipStyle", v as LayoutConfig["chipStyle"])
                    }
                  />
                  <ColorField
                    label="Text color"
                    swatchSize={36}
                    value={chipColors.text}
                    onChange={(hex) =>
                      onChipColorsChange({ ...chipColors, text: hex })
                    }
                  />
                  <ColorField
                    label="Background color"
                    swatchSize={36}
                    value={chipColors.bg}
                    onChange={(hex) =>
                      onChipColorsChange({ ...chipColors, bg: hex })
                    }
                  />
                </InlineGrid>
              </s-stack>
            </SettingsSubgroup>
          )}
        </s-stack>
      </SettingsSection>
    </s-stack>
  );
}
