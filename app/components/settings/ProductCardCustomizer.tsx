import { useCallback, useEffect, useRef, useState } from "react";
import { useFetcher } from "@remix-run/react";
import {
  Banner,
  BlockStack,
  Box,
  Button,
  InlineStack,
  List,
  Text,
} from "@shopify/polaris";
import { useAppBridge } from "@shopify/app-bridge-react";
import type { ProductCardConfig } from "../../models/filterConfig.shared";
import type { ThemeCardsStatus } from "../../models/themeCardMirror.server";
import {
  ProductCardSettingsContent,
  PRODUCT_CARD_SECTIONS,
  type ProductCardSection,
} from "./ProductCardSettingsContent";
import { ProductCardPreview } from "./ProductCardPreview";
import {
  isProductCardSyncMessage,
  postProductCardDirty,
  postProductCardRequestConfig,
  postProductCardSaved,
  postProductCardUpdate,
} from "./productCardSync";
import type { action } from "../../routes/app.product-card-customizer";

type Props = {
  initialProductCard: ProductCardConfig;
  initialCustomCss: string;
  /** When true, sync edits back to the parent settings page via postMessage. */
  embedded?: boolean;
  /** Filters are injected into the published theme (theme cards need this). */
  themeInjected?: boolean;
  /** Last published theme card mirror status (pf_config.theme_cards). */
  initialThemeCards?: ThemeCardsStatus | null;
};

/** Merchant-readable text for mirror warnings; null = informational, hide. */
function describeWarning(w: string): string | null {
  const [, code] = /^(?:collection|search):(.*)$/.exec(w) ?? [null, w];
  if (code === "section-id-discovery-failed:password") {
    return "Your store is password protected, so the app can't confirm the mirror from the server. The storefront discovers it itself on first use.";
  }
  if (code.startsWith("section-id-discovery-failed")) {
    return "The app couldn't read your storefront to confirm the mirror section ids (password-protected store?). The storefront discovers them itself on first use.";
  }
  if (code.startsWith("section-id-not-found")) {
    return "The mirror section wasn't found on the storefront yet. Click Regenerate once the theme has finished saving.";
  }
  if (code === "settings-data-missing") {
    return "Saved section settings weren't found for this vintage theme; the section's defaults are used.";
  }
  return null;
}

function ThemeCardsPanel({
  themeInjected,
  status,
  busy,
  onRegenerate,
}: {
  themeInjected: boolean;
  status: ThemeCardsStatus | null;
  busy: boolean;
  onRegenerate: () => void;
}) {
  if (!themeInjected) {
    return (
      <Banner tone="warning">
        <p>
          Theme product cards need the filters injected into your published
          theme. Go to Settings → Theme and click Inject, then save here.
        </p>
      </Banner>
    );
  }
  const entry = status?.collection ?? status?.search ?? null;
  const ready = Boolean(entry?.ok && entry?.sectionId);
  const reasons = [status?.collection, status?.search]
    .filter((e) => e && !e.ok)
    .map((e) => `${e!.sourceFile}: ${e!.reason}`);
  return (
    <Box background="bg-surface-secondary" padding="300" borderRadius="200">
      <BlockStack gap="200">
        <Text as="p" fontWeight="semibold">
          {status
            ? ready
              ? "Theme card mirror ready"
              : "Theme card mirror needs attention"
            : "Theme card mirror not generated yet"}
        </Text>
        {status ? (
          <Text as="p" tone="subdued">
            Generated {new Date(status.generatedAt).toLocaleString()} from{" "}
            {status.collection?.sourceFile ?? status.search?.sourceFile ?? "—"}
            {status.mode === "liquid" ? " (vintage theme mode)" : ""}
          </Text>
        ) : (
          <Text as="p" tone="subdued">
            Save with Theme product card selected, or click Regenerate.
          </Text>
        )}
        {reasons.length ? (
          <Banner tone="critical">
            <p>This theme's grid section can't be mirrored yet:</p>
            <List>
              {reasons.map((r) => (
                <List.Item key={r}>{r}</List.Item>
              ))}
            </List>
            <p>Filtered results use the ACO card until this is resolved.</p>
          </Banner>
        ) : null}
        {status?.warnings?.map(describeWarning).filter(Boolean).length ? (
          <List>
            {Array.from(
              new Set(status.warnings.map(describeWarning).filter(Boolean)),
            ).map((note) => (
              <List.Item key={note as string}>{note}</List.Item>
            ))}
          </List>
        ) : null}
        <InlineStack gap="200">
          <Button onClick={onRegenerate} loading={busy}>
            Regenerate
          </Button>
        </InlineStack>
      </BlockStack>
    </Box>
  );
}

// The Settings page that opened this app window. App Bridge hosts the window
// as its own iframe directly in the Shopify admin, so window.parent is the
// admin (a different origin: messages to it are dropped) and window.opener is
// the app's main window. window.parent stays as the fallback for any host that
// nests the frame instead.
function hostAppWindow(): Window | null {
  if (typeof window === "undefined") return null;
  if (window.opener && !window.opener.closed) return window.opener as Window;
  return window.parent !== window ? window.parent : null;
}

export function ProductCardCustomizer({
  initialProductCard,
  initialCustomCss,
  embedded = false,
  themeInjected = false,
  initialThemeCards = null,
}: Props) {
  const shopify = useAppBridge();
  const fetcher = useFetcher<typeof action>();
  const lastToastDataRef = useRef<typeof fetcher.data>(undefined);
  const [themeCards, setThemeCards] = useState<ThemeCardsStatus | null>(
    initialThemeCards,
  );
  const baselineRef = useRef(
    JSON.stringify({
      productCard: initialProductCard,
      customCss: initialCustomCss,
    }),
  );

  const [section, setSection] = useState<ProductCardSection>("source");
  const [productCard, setProductCard] =
    useState<ProductCardConfig>(initialProductCard);
  /** Textarea value — not applied to preview until Apply / Save. */
  const [customCssDraft, setCustomCssDraft] = useState(initialCustomCss);
  /** CSS currently shown on the preview card. */
  const [customCssPreview, setCustomCssPreview] = useState(initialCustomCss);

  const saving = fetcher.state !== "idle";

  const regenerateThemeCards = useCallback(() => {
    const fd = new FormData();
    fd.set("intent", "theme-cards-regenerate");
    fetcher.submit(fd, { method: "POST" });
  }, [fetcher]);

  const themeMode = productCard.cardSource === "theme";

  // Theme product card: only the Card source section applies, so the other
  // nav items are locked and the view snaps back to it.
  useEffect(() => {
    if (themeMode && section !== "source") setSection("source");
  }, [themeMode, section]);

  const notifyDirty = useCallback(
    (nextProductCard: ProductCardConfig, nextCss: string) => {
      if (!embedded || !hostAppWindow()) return;
      const dirty =
        JSON.stringify({ productCard: nextProductCard, customCss: nextCss }) !==
        baselineRef.current;
      postProductCardDirty(hostAppWindow()!, dirty);
    },
    [embedded],
  );

  const pushToParent = useCallback(
    (patch: { productCard?: ProductCardConfig; customCss?: string }) => {
      if (!embedded || !hostAppWindow()) return;
      postProductCardUpdate(hostAppWindow()!, patch);
    },
    [embedded],
  );

  const handleProductCardChange = useCallback(
    (next: ProductCardConfig) => {
      setProductCard(next);
      pushToParent({ productCard: next });
      notifyDirty(next, customCssDraft);
    },
    [pushToParent, notifyDirty, customCssDraft],
  );

  // Typing only updates the draft — preview stays until Apply.
  const handleCustomCssDraftChange = useCallback(
    (css: string) => {
      setCustomCssDraft(css);
      pushToParent({ customCss: css }); // kept by the Settings page across reloads
      notifyDirty(productCard, css);
    },
    [pushToParent, notifyDirty, productCard],
  );

  const handleApplyCustomCss = useCallback(() => {
    setCustomCssPreview(customCssDraft);
  }, [customCssDraft]);

  const handleSave = useCallback(() => {
    setCustomCssPreview(customCssDraft);
    const fd = new FormData();
    fd.set("intent", "save-product-card");
    fd.set("productCard", JSON.stringify(productCard));
    fd.set("customCss", customCssDraft);
    fetcher.submit(fd, { method: "POST" });
  }, [fetcher, productCard, customCssDraft]);

  // Wire Save click on the s-page title-bar button (web component).
  useEffect(() => {
    const btn = document.getElementById("pc-customizer-save");
    if (!btn) return;
    btn.addEventListener("click", handleSave);
    return () => btn.removeEventListener("click", handleSave);
  }, [handleSave]);

  // Toast + notify parent once per completed save.
  useEffect(() => {
    if (fetcher.state !== "idle" || !fetcher.data) return;
    if (fetcher.data === lastToastDataRef.current) return;
    lastToastDataRef.current = fetcher.data;

    if ("themeCards" in fetcher.data && fetcher.data.themeCards !== undefined) {
      setThemeCards(fetcher.data.themeCards ?? null);
    }
    if ("action" in fetcher.data && fetcher.data.action) {
      shopify.toast.show(
        fetcher.data.ok
          ? "Theme card mirror regenerated"
          : (fetcher.data.errors?.[0]?.message ?? "Could not regenerate"),
        { isError: !fetcher.data.ok },
      );
      return;
    }

    shopify.toast.show(
      fetcher.data.ok
        ? "themeAssetsSynced" in fetcher.data && fetcher.data.themeAssetsSynced
          ? "Saved — storefront card layouts updated"
          : "Saved and published to storefront"
        : (fetcher.data.errors?.[0]?.message ?? "Could not save settings"),
      { isError: !fetcher.data.ok },
    );

    if (
      fetcher.data.ok &&
      "productCard" in fetcher.data &&
      fetcher.data.productCard &&
      embedded &&
      hostAppWindow()
    ) {
      const savedCss = fetcher.data.customCss ?? customCssDraft;
      setCustomCssDraft(savedCss);
      setCustomCssPreview(savedCss);
      setProductCard(fetcher.data.productCard);
      baselineRef.current = JSON.stringify({
        productCard: fetcher.data.productCard,
        customCss: savedCss,
      });
      postProductCardDirty(hostAppWindow()!, false);
      postProductCardSaved(hostAppWindow()!, {
        productCard: fetcher.data.productCard,
        customCss: savedCss,
      });
    }
  }, [fetcher.state, fetcher.data, shopify, embedded, customCssDraft]);

  // Accept parent draft config when the app window opens.
  useEffect(() => {
    if (!embedded || !hostAppWindow()) return;

    const onMessage = (event: MessageEvent) => {
      if (event.origin !== window.location.origin) return;
      if (!isProductCardSyncMessage(event.data)) return;

      if (event.data.type === "pf-pc-config" && event.data.draft) {
        setProductCard(event.data.productCard);
        setCustomCssDraft(event.data.customCss);
        setCustomCssPreview(event.data.customCss);
        const shown = JSON.stringify({
          productCard: event.data.productCard,
          customCss: event.data.customCss,
        });
        // Restored unsaved edits come with the saved state as the baseline,
        // so they still count as unsaved here.
        const base = event.data.baseline;
        baselineRef.current = base
          ? JSON.stringify({
              productCard: base.productCard,
              customCss: base.customCss,
            })
          : shown;
        postProductCardDirty(hostAppWindow()!, shown !== baselineRef.current);
      }
    };

    window.addEventListener("message", onMessage);
    // Shopify reloads this window's iframe each time it is shown, so ask the
    // Settings page what to show (e.g. edits kept by "Continue editing").
    postProductCardRequestConfig(hostAppWindow()!);
    return () => window.removeEventListener("message", onMessage);
  }, [embedded]);

  // Keep in sync when not embedded (direct navigation).
  useEffect(() => {
    if (!embedded) {
      setProductCard(initialProductCard);
      setCustomCssDraft(initialCustomCss);
      setCustomCssPreview(initialCustomCss);
    }
  }, [embedded, initialProductCard, initialCustomCss]);

  return (
    <div className="customizer-shell">
      <s-page heading="Customize product card">
        <s-button
          id="pc-customizer-save"
          slot="primary-action"
          variant="primary"
          {...(saving ? { loading: true } : {})}
        >
          Save
        </s-button>
      </s-page>

      <div className="customizer-layout">
        <nav
          className="customizer-nav"
          aria-label="Product card settings sections"
        >
          <div className="customizer-nav__caption">
            <Box paddingBlockEnd="300">
              <Text as="p" variant="bodySm" tone="subdued">
                Sections
              </Text>
            </Box>
          </div>
          <div className="customizer-nav__list">
            {PRODUCT_CARD_SECTIONS.map((item) => {
              const locked = themeMode && item.id !== "source";
              return (
                <button
                  key={item.id}
                  type="button"
                  className={`customizer-nav__btn${
                    section === item.id ? " is-active" : ""
                  }${locked ? " is-locked" : ""}`}
                  disabled={locked}
                  aria-disabled={locked}
                  title={
                    locked
                      ? "Not available with the theme product card"
                      : undefined
                  }
                  onClick={() => setSection(item.id)}
                >
                  {item.label}
                </button>
              );
            })}
          </div>
        </nav>

        <div className="customizer-settings">
          <ProductCardSettingsContent
            key={section}
            section={section}
            productCard={productCard}
            onChange={handleProductCardChange}
            customCss={customCssDraft}
            onCustomCssChange={handleCustomCssDraftChange}
            onApplyCustomCss={handleApplyCustomCss}
            themeCardsPanel={
              <ThemeCardsPanel
                themeInjected={themeInjected}
                status={themeCards}
                busy={saving}
                onRegenerate={regenerateThemeCards}
              />
            }
          />
        </div>

        <aside className="customizer-preview">
          <Box paddingBlockEnd="300">
            <Text as="h3" variant="headingSm">
              Preview
            </Text>
            <Text as="p" variant="bodySm" tone="subdued">
              {themeMode
                ? "Showing your theme's own product card."
                : "Preview may differ slightly from your live theme."}
            </Text>
          </Box>
          {themeMode ? (
            <div className="customizer-preview__unavailable">
              <Text as="p" fontWeight="semibold">
                Preview isn't available for the theme product card
              </Text>
              <Text as="p" tone="subdued">
                Filtered results use the product card from your published theme,
                with its own design and settings. Apply a filter on a collection
                page of your store to see it.
              </Text>
            </div>
          ) : (
            <ProductCardPreview
              productCard={productCard}
              customCss={customCssPreview}
            />
          )}
        </aside>
      </div>
    </div>
  );
}
