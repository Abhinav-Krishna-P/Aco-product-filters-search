import { useEffect, useRef, useState } from "react";
import type React from "react";
import { Checkbox, InlineGrid, TextField } from "@shopify/polaris";
import type { AdminConfig } from "../../models/filterConfig.shared";
import { SettingsSection, SettingsSubgroup } from "./SettingsSection";
import {
  DEFAULT_APPEARANCE,
  DEFAULT_BEHAVIOR,
  DEFAULT_LAYOUT,
  normalizeAppearance,
  normalizeBehavior,
  normalizeLayout,
} from "../../models/filterConfig.shared";

/** Advanced tab — detect, republish, custom CSS, export/import, reset. */

export type ThemeElementCandidates = Record<
  "collection" | "search",
  { selector: string; tag: string }[]
>;

type Props = {
  config: AdminConfig;
  detecting: boolean;
  republishing: boolean;
  detectingElements: boolean;
  detectedElements: ThemeElementCandidates | null;
  onDetect: () => void;
  onDetectElements: () => void;
  onRepublish: () => void;
  onChange: (patch: Partial<AdminConfig>) => void;
};

export function AdvancedTab({
  config,
  detecting,
  republishing,
  detectingElements,
  detectedElements,
  onDetect,
  onDetectElements,
  onRepublish,
  onChange,
}: Props) {
  const fileRef = useRef<HTMLInputElement>(null);
  const switchRef = useRef<React.ElementRef<"s-switch">>(null);
  const dev = config.behavior.developer ?? {
    enabled: false,
    collectionFile: "",
    searchFile: "",
    hideSelectors: "",
    keepSelectors: "",
    injectBefore: "",
    collectionLoopFile: "",
    searchLoopFile: "",
  };

  const [devOptionsOpen, setDevOptionsOpen] = useState(Boolean(dev.enabled));
  const [collectionDir, setCollectionDir] = useState(dev.collectionFile ?? "");
  const [searchDir, setSearchDir] = useState(dev.searchFile ?? "");
  const [hideSelectors, setHideSelectors] = useState(dev.hideSelectors ?? "");
  const [keepSelectors, setKeepSelectors] = useState(dev.keepSelectors ?? "");
  const [injectBefore, setInjectBefore] = useState(dev.injectBefore ?? "");
  const [collectionLoopFile, setCollectionLoopFile] = useState(
    dev.collectionLoopFile ?? "",
  );
  const [searchLoopFile, setSearchLoopFile] = useState(
    dev.searchLoopFile ?? "",
  );
  const [selectedCandidates, setSelectedCandidates] = useState<Set<string>>(
    () => new Set(),
  );

  useEffect(() => {
    setDevOptionsOpen(Boolean(config.behavior.developer?.enabled));
    setCollectionDir(config.behavior.developer?.collectionFile ?? "");
    setSearchDir(config.behavior.developer?.searchFile ?? "");
    setHideSelectors(config.behavior.developer?.hideSelectors ?? "");
    setKeepSelectors(config.behavior.developer?.keepSelectors ?? "");
    setInjectBefore(config.behavior.developer?.injectBefore ?? "");
    setCollectionLoopFile(config.behavior.developer?.collectionLoopFile ?? "");
    setSearchLoopFile(config.behavior.developer?.searchLoopFile ?? "");
  }, [config.behavior.developer]);

  // Merge the ticked candidates into the hide list (comma-separated, deduped).
  const addSelectedToHide = () => {
    const current = hideSelectors
      .split(",")
      .map((s) => s.trim())
      .filter(Boolean);
    for (const sel of selectedCandidates) {
      if (!current.includes(sel)) current.push(sel);
    }
    const next = current.join(", ");
    setHideSelectors(next);
    updateDevConfig({ hideSelectors: next });
    setSelectedCandidates(new Set());
  };

  useEffect(() => {
    const el = switchRef.current;
    if (el) {
      if (devOptionsOpen) {
        el.setAttribute("checked", "");
        (el as any).checked = true;
      } else {
        el.removeAttribute("checked");
        (el as any).checked = false;
      }
    }
  }, [devOptionsOpen]);

  const updateDevConfig = (
    patch: Partial<NonNullable<typeof config.behavior.developer>>,
  ) => {
    onChange({
      behavior: {
        ...config.behavior,
        developer: {
          ...dev,
          ...patch,
        },
      },
    });
  };

  useEffect(() => {
    const el = switchRef.current;
    if (!el) return;
    const handleToggle = () => {
      setTimeout(() => {
        const isChecked = Boolean(
          (el as any).checked ?? el.hasAttribute("checked"),
        );
        setDevOptionsOpen(isChecked);
        updateDevConfig({ enabled: isChecked });
      }, 0);
    };
    el.addEventListener("change", handleToggle);
    el.addEventListener("input", handleToggle);
    el.addEventListener("click", handleToggle);
    return () => {
      el.removeEventListener("change", handleToggle);
      el.removeEventListener("input", handleToggle);
      el.removeEventListener("click", handleToggle);
    };
  }, [config.behavior]);

  const exportJson = () => {
    const payload = {
      layout: config.layout,
      appearance: config.appearance,
      behavior: config.behavior,
      filters: config.filters,
    };
    const blob = new Blob([JSON.stringify(payload, null, 2)], {
      type: "application/json",
    });
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = "product-filter-settings.json";
    a.click();
    URL.revokeObjectURL(a.href);
  };

  const importJson = (file: File) => {
    const reader = new FileReader();
    reader.onload = () => {
      try {
        const parsed = JSON.parse(String(reader.result));
        onChange({
          layout: normalizeLayout(parsed.layout),
          appearance: normalizeAppearance(parsed.appearance),
          behavior: normalizeBehavior(parsed.behavior),
          ...(Array.isArray(parsed.filters) ? { filters: parsed.filters } : {}),
        });
      } catch {
        // eslint-disable-next-line no-alert
        alert("Invalid settings file.");
      }
    };
    reader.readAsText(file);
  };

  return (
    <s-stack gap="base">
      <SettingsSection
        title="Backup & reset"
        description="Reset affects layout/appearance/behavior only — your filters, labels and ordering are kept. Nothing is saved until you click Save."
      >
        <s-stack direction="inline" gap="small">
          <s-button icon="export" onClick={exportJson}>
            Export settings JSON
          </s-button>
          <s-button icon="import" onClick={() => fileRef.current?.click()}>
            Import settings JSON
          </s-button>
          <s-button
            tone="critical"
            icon="reset"
            onClick={() =>
              onChange({
                layout: { ...DEFAULT_LAYOUT },
                appearance: { ...DEFAULT_APPEARANCE },
                behavior: { ...DEFAULT_BEHAVIOR },
              })
            }
          >
            Reset layout, appearance &amp; behavior
          </s-button>
        </s-stack>
        <input
          ref={fileRef}
          type="file"
          accept="application/json"
          hidden
          onChange={(e) => {
            const file = e.target.files?.[0];
            if (file) importJson(file);
            e.target.value = "";
          }}
        />
      </SettingsSection>

      <SettingsSection
        title="Developer options"
        description="Custom Liquid files for the injector (switch on to edit), catalog detection and storefront snapshot tools."
        actions={
          <s-switch
            ref={switchRef}
            checked={devOptionsOpen}
            onChange={(e: any) => {
              const checked = Boolean(e.target?.checked ?? !devOptionsOpen);
              setDevOptionsOpen(checked);
              updateDevConfig({ enabled: checked });
            }}
          ></s-switch>
        }
      >
        <s-stack gap="base">
          <s-banner tone="info">
            <s-paragraph>
              These are for developers. If you are facing any issue in injecting
              filter / filter not displaying on collection or search page,
              kindly contact the support team.
            </s-paragraph>
          </s-banner>

          {devOptionsOpen && (
            <s-box paddingBlockStart="small">
              <InlineGrid columns={{ xs: 1, sm: 2 }} gap="300">
                <TextField
                  label="Collection page directory"
                  value={collectionDir}
                  onChange={(val) => {
                    setCollectionDir(val);
                    updateDevConfig({ collectionFile: val });
                  }}
                  placeholder="*.liquid"
                  autoComplete="off"
                  helpText="Liquid file where collection filters should be injected"
                />
                <TextField
                  label="Search page directory"
                  value={searchDir}
                  onChange={(val) => {
                    setSearchDir(val);
                    updateDevConfig({ searchFile: val });
                  }}
                  placeholder="*.liquid"
                  autoComplete="off"
                  helpText="Liquid file where search filters should be injected"
                />
              </InlineGrid>
            </s-box>
          )}

          {devOptionsOpen && (
            <SettingsSubgroup>
              <s-stack gap="small">
                <s-text type="strong">Theme compatibility</s-text>
                <s-paragraph color="subdued">
                  Fixes for themes the automatic injection and card mirror
                  don&apos;t handle. Inject position and loop files take effect
                  on the next inject / regenerate; hide and keep apply on save.
                </s-paragraph>
                <TextField
                  label="Insert ACO block before"
                  value={injectBefore}
                  onChange={(val) => {
                    setInjectBefore(val);
                    updateDevConfig({ injectBefore: val });
                  }}
                  placeholder="e.g. <xo-filters"
                  autoComplete="off"
                  helpText="Text in the section file the ACO block is inserted before (both pages). Leave empty to insert at the top."
                />
                <InlineGrid columns={{ xs: 1, sm: 2 }} gap="300">
                  <TextField
                    label="Collection loop file"
                    value={collectionLoopFile}
                    onChange={(val) => {
                      setCollectionLoopFile(val);
                      updateDevConfig({ collectionLoopFile: val });
                    }}
                    placeholder="snippets/….liquid"
                    autoComplete="off"
                    helpText="Snippet that contains the product loop, when the automatic search can't find it."
                  />
                  <TextField
                    label="Search loop file"
                    value={searchLoopFile}
                    onChange={(val) => {
                      setSearchLoopFile(val);
                      updateDevConfig({ searchLoopFile: val });
                    }}
                    placeholder="snippets/….liquid"
                    autoComplete="off"
                    helpText="Same for the search page."
                  />
                </InlineGrid>
                <TextField
                  label="Theme elements to hide"
                  value={hideSelectors}
                  onChange={(val) => {
                    setHideSelectors(val);
                    updateDevConfig({ hideSelectors: val });
                  }}
                  multiline={2}
                  placeholder="e.g. xo-filters-top, xo-filters"
                  autoComplete="off"
                  helpText="CSS selectors (comma-separated) for the theme's own filters and product grid inside the injected section. When set, only these are hidden; leave empty to hide everything that follows the ACO block except the page's search box and heading."
                />
                <TextField
                  label="Elements to keep"
                  value={keepSelectors}
                  onChange={(val) => {
                    setKeepSelectors(val);
                    updateDevConfig({ keepSelectors: val });
                  }}
                  placeholder="e.g. .collection-banner"
                  autoComplete="off"
                  helpText="Elements after the ACO block that must stay visible (the search box and page heading always do)."
                />
                <s-stack
                  direction="inline"
                  gap="base"
                  alignItems="center"
                  justifyContent="space-between"
                >
                  <s-text color="subdued">
                    Detect lists the theme&apos;s own elements in the injected
                    sections so you can pick what to hide.
                  </s-text>
                  <s-button
                    onClick={onDetectElements}
                    {...(detectingElements ? { loading: true } : {})}
                  >
                    Detect theme elements
                  </s-button>
                </s-stack>
                {detectedElements && (
                  <s-stack gap="small">
                    {(["collection", "search"] as const).map((page) => (
                      <s-stack key={page} gap="small-200">
                        <s-text type="strong">
                          {page === "collection"
                            ? "Collection page"
                            : "Search page"}
                        </s-text>
                        {detectedElements[page].length ? (
                          detectedElements[page].map((c) => (
                            <Checkbox
                              key={page + c.selector}
                              label={c.selector}
                              checked={selectedCandidates.has(c.selector)}
                              onChange={(checked) => {
                                setSelectedCandidates((prev) => {
                                  const next = new Set(prev);
                                  if (checked) next.add(c.selector);
                                  else next.delete(c.selector);
                                  return next;
                                });
                              }}
                            />
                          ))
                        ) : (
                          <s-text color="subdued">No elements found.</s-text>
                        )}
                      </s-stack>
                    ))}
                    <s-stack direction="inline" gap="small">
                      <s-button
                        onClick={addSelectedToHide}
                        {...(selectedCandidates.size ? {} : { disabled: true })}
                      >
                        Add selected to hide list
                      </s-button>
                    </s-stack>
                  </s-stack>
                )}
              </s-stack>
            </SettingsSubgroup>
          )}

          {devOptionsOpen && (
            <>
              <SettingsSubgroup>
                <s-stack gap="small">
                  <s-stack
                    direction="inline"
                    gap="base"
                    alignItems="center"
                    justifyContent="space-between"
                  >
                    <s-text type="strong">Catalog detection</s-text>
                    <s-button
                      onClick={onDetect}
                      variant="primary"
                      {...(detecting ? { loading: true } : {})}
                    >
                      {config.filters.length
                        ? "Re-detect from store"
                        : "Detect filter values"}
                    </s-button>
                  </s-stack>
                  <s-paragraph color="subdued">
                    Scans your active products and merges new filter values into
                    your existing setup — labels, ordering, styles and swatch
                    colors are preserved. Values that disappeared from the
                    catalog are flagged, not deleted. This runs automatically
                    when products or collections change; use the button to sync
                    immediately.
                  </s-paragraph>
                  {config.scannedCount > 0 ? (
                    <s-stack direction="inline" gap="small">
                      <s-badge tone="info">{`${config.scannedCount} products scanned`}</s-badge>
                      <s-badge
                        tone={config.storefrontToken ? "success" : "warning"}
                      >
                        {config.storefrontToken
                          ? "Storefront token ready"
                          : "No storefront token"}
                      </s-badge>
                      {config.capped && (
                        <s-badge tone="warning">Scan capped at 5,000</s-badge>
                      )}
                      {config.catalogSyncedAt ? (
                        <s-badge>{`Last synced ${new Date(
                          config.catalogSyncedAt,
                        ).toLocaleString()}`}</s-badge>
                      ) : null}
                    </s-stack>
                  ) : (
                    <s-paragraph color="subdued">
                      No scan yet — run detection to build filters from your
                      catalog.
                    </s-paragraph>
                  )}
                </s-stack>
              </SettingsSubgroup>

              <SettingsSubgroup>
                <s-stack gap="small">
                  <s-stack
                    direction="inline"
                    gap="base"
                    alignItems="center"
                    justifyContent="space-between"
                  >
                    <s-text type="strong">Storefront snapshot</s-text>
                    <s-button
                      onClick={onRepublish}
                      {...(republishing ? { loading: true } : {})}
                    >
                      Republish to storefront
                    </s-button>
                  </s-stack>
                  <s-paragraph color="subdued">
                    Settings are stored in the app database and published to a
                    shop metafield the storefront reads. Saving publishes
                    automatically — use this only if a publish failed.
                  </s-paragraph>
                  <s-stack direction="inline" gap="small" alignItems="center">
                    {config.snapshotStale ? (
                      <s-badge tone="warning">
                        Storefront may be out of date
                      </s-badge>
                    ) : (
                      <s-badge tone="success">Storefront in sync</s-badge>
                    )}
                    {config.metafieldSyncedAt && (
                      <s-text color="subdued">
                        Last published{" "}
                        {new Date(config.metafieldSyncedAt).toLocaleString()}
                      </s-text>
                    )}
                  </s-stack>
                </s-stack>
              </SettingsSubgroup>
            </>
          )}
        </s-stack>
      </SettingsSection>
    </s-stack>
  );
}
