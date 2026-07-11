/**
 * Filter config types + defaults shared between the server data layer
 * (filterSettings.server.ts) and the admin UI components. Pure — no server
 * imports, safe to bundle client-side.
 */

// ── Global config shapes (stored as JSON columns on FilterSettings) ─────────

export type LayoutConfig = {
  structure: "sidebar-left" | "sidebar-right" | "horizontal" | "drawer";
  // Border treatment of the horizontal bar (structure = "horizontal" only).
  // outlined = each trigger is its own bordered pill; borderless = no boxes;
  // boxed = one container wraps the row, triggers inside are plain.
  horizontalStyle: "outlined" | "borderless" | "boxed";
  sidebarWidth: number; // px, desktop sidebar
  sidebarSticky: boolean;
  mobileMode: "drawer" | "inline";
  columnsDesktop: number; // 2–5
  columnsMobile: number; // 1–2
  productsPerPage: number; // 10–30
  gap: number; // rem * 10 (e.g. 15 = 1.5rem)
  showHeading: boolean;
  headingText: string; // panel heading label (when showHeading)
  headingSize: number; // px, panel heading font size
  showActiveChips: boolean;
  chipStyle: "pill" | "rounded" | "square"; // active-chip corner design

  showResultsCount: boolean;
  showClearAll: boolean;
  showColumnSwitcher: boolean;
  showGroupDividers: boolean;
  paginationStyle:
    "basic" | "pill" | "numbered" | "segmented" | "text" | "jump";
};

export type AppearanceConfig = {
  inheritTheme: boolean; // true = no color overrides (current behavior)
  preset: string; // last applied preset name, "" = custom
  colors: {
    accent: string;
    text: string;
    muted: string;
    border: string;
    background: string;
    hoverBg: string;
    selectedBg: string;
    chipBg: string;
    chipText: string;
  };
  radius: number; // px corner radius for pills/swatches/inputs
  density: "comfortable" | "cozy" | "compact";
  swatch: {
    shape: "circle" | "square" | "rounded";
    size: number; // px
    showLabel: boolean;
    selectedIndicator: "ring" | "check" | "border";
    hoverEnabled: boolean; // master on/off for the swatch/image hover effect
    hoverEffect: "none" | "grow" | "lift" | "border"; // effect on swatch/image hover
  };
  typography: {
    inherit: boolean;
    labelSize: number; // px
    labelWeight: number;
    uppercase: boolean;
  };
  groupIcon: "chevron" | "plus" | "caret"; // filter-group open/close toggle icon
  groupIconAnimate: boolean; // animate the icon between open/closed states
  customCss: string;
};

/** Corner of the product image where the Sale / Out of stock badge sits. */
export const BADGE_POSITIONS = [
  "top-left",
  "top-right",
  "bottom-left",
  "bottom-right",
] as const;
export type BadgePosition = (typeof BADGE_POSITIONS)[number];

/** Font / padding scale for the Sale / Out of stock image badge. */
export const BADGE_SIZES = ["small", "medium", "large"] as const;
export type BadgeSize = (typeof BADGE_SIZES)[number];

export const CARD_SHADOWS = ["none", "soft", "medium"] as const;
export type CardShadow = (typeof CARD_SHADOWS)[number];

export const TITLE_WEIGHTS = [400, 500, 600, 700] as const;
export type TitleWeight = (typeof TITLE_WEIGHTS)[number];

/**
 * Structural card layouts (DOM arrangement), not appearance presets.
 * - classic: image on top, info below (original)
 * - split: image left, info + CTA right (catalog style)
 */
export const CARD_LAYOUTS = ["classic", "split"] as const;

/**
 * Which renderer draws the filtered product cards on the storefront.
 * - aco:   the app's own card (every other ProductCardConfig field applies)
 * - theme: the merchant's theme card, rendered by Shopify Liquid through the
 *          theme card mirror (see themeCardMirror.server.ts). Requires inject.
 */
export const CARD_SOURCES = ["aco", "theme"] as const;
export type CardSource = (typeof CARD_SOURCES)[number];
export type CardLayout = (typeof CARD_LAYOUTS)[number];

export const CARD_LAYOUT_META: Record<
  CardLayout,
  { label: string; description: string }
> = {
  classic: {
    label: "Classic",
    description: "Image on top, details below",
  },
  split: {
    label: "Split",
    description: "Image beside details and button",
  },
};

/**
 * Product-card design + quick-buy buttons. Applies to every card the app
 * renders — both the SSR grid (pf-product-grid.liquid) and the cards
 * pf-filters.js re-renders after a filter change. Published in the snapshot
 * and mirrored onto [data-aco-pf-root] as `data-product-card` so the storefront
 * JS can read it without a second network trip.
 */
export type ProductCardConfig = {
  // Renderer: ACO custom card or the theme's own product card.
  cardSource: CardSource;
  // ── Design ──
  // Structural template for how the card is laid out.
  cardLayout: CardLayout;
  imageRatio: "natural" | "square" | "portrait"; // media aspect ratio
  imageFit: "cover" | "contain"; // how the image sits inside the ratio box
  hoverZoom: boolean; // scale the image up on hover
  cardBorder: boolean; // draw a bordered, padded, subtly-shadowed card
  textAlign: "left" | "center"; // title/price alignment
  showVendor: boolean; // print the product vendor above the title
  titleSize: number; // px, card title font size
  // Corner radius of the card chrome + image (px).
  cardRadius: number;
  // Card surface + type colors.
  cardBackground: string; // hex
  cardTextColor: string; // hex
  cardBorderColor: string; // hex, used when cardBorder is on
  cardShadow: CardShadow;
  titleWeight: TitleWeight;
  priceSize: number; // px, price line font size

  // ── Image slideshow / gallery ──
  // Turn the card image into a multi-image gallery built from the product's
  // additional images. Off = single featured image (original behaviour).
  imageSlideshow: boolean;
  // "hover"  = auto-cycle through the images while the shopper hovers the card.
  // "arrows" = show prev/next arrows the shopper clicks to change the image.
  slideshowMode: "hover" | "arrows";
  // hover mode: seconds each image shows before advancing to the next.
  slideshowSpeed: number;
  // arrows mode: show the arrows all the time, or only while hovering the card.
  slideshowArrowsAlways: boolean;
  // Show small dot indicators over the image reflecting the current slide.
  slideshowDots: boolean;
  // Cap how many images load per card (first N of the product's images) so a
  // product with many photos doesn't bloat the grid payload.
  slideshowMaxImages: number;

  // ── Sale / discount ──
  // Show the compare-at price struck through next to the (lower) sale price.
  // Off = only the current price shows, even when the product is discounted.
  showComparePrice: boolean;
  // Show a discount badge near the price on discounted products.
  showDiscountBadge: boolean;
  // Show a simple "Sale" badge on in-stock products whose compare-at price
  // exceeds the current price.
  showSaleBadge: boolean;
  // Show an "Out of stock" badge when the product is unavailable for sale.
  // Both may be on: a card shows at most one badge, and a sold-out product
  // gets this one (never "Sale").
  showSoldOutBadge: boolean;
  // Which corner of the product image the Sale / Out of stock badge sits in.
  badgePosition: BadgePosition;
  // Shared size for whichever image badge is on (small | medium | large).
  badgeSize: BadgeSize;
  // Sale badge label + colors. Text capped at IMAGE_BADGE_TEXT_MAX chars.
  saleBadgeText: string;
  saleBadgeColor: string; // hex, pill background
  saleBadgeTextColor: string; // hex, label color
  // Out of stock badge label + colors. Text capped at IMAGE_BADGE_TEXT_MAX.
  soldOutBadgeText: string;
  soldOutBadgeColor: string; // hex
  soldOutBadgeTextColor: string; // hex
  // Merchant-entered label shown before the auto-calculated percent off, e.g.
  // "Save" renders as "Save 20%". The percent is computed from price vs
  // compare-at and can't be edited. Capped at DISCOUNT_BADGE_TEXT_MAX chars.
  discountBadgeText: string;
  // Badge look: "solid" = filled pill, "outline" = bordered pill, "text" =
  // plain colored text (no pill).
  discountBadgeStyle: "solid" | "outline" | "text";

  // ── Quick-buy buttons ──
  showAddToCart: boolean;
  addToCartText: string;
  showBuyNow: boolean;
  buyNowText: string;
  buttonStyle: "solid" | "outline";
  buttonColor: string; // hex, primary/accent for solid & outline
  buttonTextColor: string; // hex, label color on a solid button
  buttonRadius: number; // px corner radius
  // After a successful Add to cart: keep the shopper on the page with an
  // "Added" confirmation, or send them to the cart. (Buy now always goes to
  // checkout regardless of this.)
  afterAddToCart: "stay" | "cart";
  // Products with more than one variant: add the first available variant, or
  // send the shopper to the product page to choose options.
  variantMode: "firstAvailable" | "chooseVariant" | "productPage";
  chooseVariantText: string;
};

export const APPLY_BUTTON_SIZES = ["small", "medium", "large"] as const;
export type ApplyButtonSize = (typeof APPLY_BUTTON_SIZES)[number];
export const APPLY_BUTTON_CORNERS = ["edged", "rounded"] as const;
export type ApplyButtonCorners = (typeof APPLY_BUTTON_CORNERS)[number];
export const APPLY_BUTTON_TEXT_MAX = 30;

export type ApplyButtonConfig = {
  text: string;
  bgColor: string; // #rrggbb
  textColor: string; // #rrggbb
  size: ApplyButtonSize;
  corners: ApplyButtonCorners;
};

export type BehaviorConfig = {
  defaultOpen: boolean; // groups open by default (per-filter override wins)
  collapsible: boolean;
  accordion: boolean; // only one group open at a time
  showCounts: boolean;
  hideEmpty: boolean; // hide zero-result values (disjunctive faceting)
  disableEmpty: boolean; // grey out instead of hide
  applyMode: "instant" | "button";
  /** Styling for the Apply button (only shown when applyMode is "button"). */
  applyButton: ApplyButtonConfig;
  collapseAfter: number; // default "show more" threshold, 0 = never
  searchThreshold: number; // show search box inside groups with >= N values, 0 = never
  scrollTop: boolean;
  animation: "none" | "slide";
  /** Show the Smart Filters natural-language query bar above the product grid. */
  smartFilters: boolean;
  developer?: {
    enabled: boolean;
    collectionFile: string;
    searchFile: string;
    /** CSS selectors for the theme's own filters/grid to hide in the injected section. */
    hideSelectors: string;
    /** Elements after the ACO block that must stay visible (besides the search box / h1). */
    keepSelectors: string;
    /** Plain text in the section file the ACO block is inserted before ("" = top). */
    injectBefore: string;
    /** Theme file holding the collection product loop, when auto-discovery can't find it. */
    collectionLoopFile: string;
    searchLoopFile: string;
  };
};

/** The developer block as the injector / mirror consume it; undefined when the switch is off. */
export type DeveloperThemeFiles = {
  collectionFile?: string;
  searchFile?: string;
  injectBefore?: string;
  collectionLoopFile?: string;
  searchLoopFile?: string;
};

export function developerThemeFiles(
  behavior: Pick<BehaviorConfig, "developer"> | null | undefined,
): DeveloperThemeFiles | undefined {
  const d = behavior?.developer;
  if (!d?.enabled) return undefined;
  return {
    collectionFile: d.collectionFile ?? "",
    searchFile: d.searchFile ?? "",
    injectBefore: d.injectBefore ?? "",
    collectionLoopFile: d.collectionLoopFile ?? "",
    searchLoopFile: d.searchLoopFile ?? "",
  };
}

/** Theme path for a loop-file override; bare names are snippets. */
export function normalizeSnippetPath(raw: unknown): string {
  if (!raw || typeof raw !== "string") return "";
  let clean = raw.trim().replace(/\\/g, "/").replace(/^\/+/, "");
  if (!clean) return "";
  if (!clean.endsWith(".liquid")) clean += ".liquid";
  if (!clean.includes("/")) clean = "snippets/" + clean;
  return clean;
}

/**
 * Sort keys the storefront can actually deliver. The grid queries the root
 * `products(query:)` connection, so only ProductSortKeys apply — a collection's
 * manual "featured" order isn't reachable. "default" therefore means "send no
 * sortKey", i.e. the API's natural order (today's behavior).
 */
export type SortKey =
  | "default"
  | "best-selling"
  | "price-asc"
  | "price-desc"
  | "title-asc"
  | "title-desc"
  | "created-desc"
  | "created-asc";

export type SortOption = {
  key: SortKey;
  label: string; // merchant-editable shopper-facing text
  enabled: boolean;
};

export type SortConfig = {
  enabled: boolean; // show the sort dropdown at all
  // Above the grid next to the count, top of the filter panel, or top right
  // of the results header (just left of the 3 / 4 column switcher).
  position: "toolbar" | "panel" | "top-right";
  label: string; // "Sort by"
  showLabel: boolean;
  // Merchant order — this IS the dropdown order. With no pf_sort in the URL
  // the storefront starts on the first enabled option.
  options: SortOption[];
};

// Canonical key list + default shopper-facing labels. SORT_KEYS is also the
// fallback order for a config that predates a newly added key.
export const SORT_KEY_LABELS: Record<SortKey, string> = {
  default: "Featured",
  "best-selling": "Best selling",
  "price-asc": "Price: low to high",
  "price-desc": "Price: high to low",
  "title-asc": "Alphabetically: A–Z",
  "title-desc": "Alphabetically: Z–A",
  "created-desc": "Newest first",
  "created-asc": "Oldest first",
};

export const SORT_KEYS = Object.keys(SORT_KEY_LABELS) as SortKey[];

export const DEFAULT_SORT: SortConfig = {
  enabled: false,
  position: "toolbar",
  label: "Sort by",
  showLabel: true,
  options: SORT_KEYS.map((key) => ({
    key,
    label: SORT_KEY_LABELS[key],
    // Off by default for the two least-used directions; merchants opt in.
    enabled: key !== "title-desc" && key !== "created-asc",
  })),
};

export const DEFAULT_LAYOUT: LayoutConfig = {
  structure: "sidebar-left",
  horizontalStyle: "outlined",
  sidebarWidth: 260,
  sidebarSticky: false,
  mobileMode: "drawer",
  columnsDesktop: 3,
  columnsMobile: 2,
  productsPerPage: 15,
  gap: 15,
  showHeading: true,
  headingText: "Filters",
  headingSize: 18,
  showActiveChips: true,
  chipStyle: "pill",
  showResultsCount: true,
  showClearAll: true,
  showColumnSwitcher: true,
  showGroupDividers: true,
  paginationStyle: "basic",
};

export const DEFAULT_APPEARANCE: AppearanceConfig = {
  inheritTheme: true,
  preset: "",
  colors: {
    accent: "#111111",
    text: "#111111",
    muted: "#6b6b6b",
    border: "#e0e0e0",
    background: "#ffffff",
    hoverBg: "#f5f5f5",
    selectedBg: "#f0f0f0",
    chipBg: "#f5f5f5",
    chipText: "#111111",
  },
  radius: 6,
  density: "comfortable",
  swatch: {
    shape: "circle",
    size: 18,
    showLabel: true,
    selectedIndicator: "ring",
    hoverEnabled: true,
    hoverEffect: "grow",
  },
  typography: {
    inherit: true,
    labelSize: 14,
    labelWeight: 400,
    uppercase: false,
  },
  groupIcon: "chevron",
  groupIconAnimate: true,
  customCss: "",
};

export const DEFAULT_PRODUCT_CARD: ProductCardConfig = {
  cardSource: "aco",
  cardLayout: "classic",
  imageRatio: "square",
  imageFit: "cover",
  hoverZoom: true,
  cardBorder: true,
  textAlign: "left",
  showVendor: false,
  titleSize: 14,
  cardRadius: 8,
  cardBackground: "#ffffff",
  cardTextColor: "#111111",
  cardBorderColor: "#e5e5e5",
  cardShadow: "none",
  titleWeight: 400,
  priceSize: 14,
  imageSlideshow: false,
  slideshowMode: "hover",
  slideshowSpeed: 1,
  slideshowArrowsAlways: false,
  slideshowDots: true,
  slideshowMaxImages: 5,
  showComparePrice: true,
  showDiscountBadge: false,
  showSaleBadge: false,
  showSoldOutBadge: false,
  badgePosition: "top-left",
  badgeSize: "medium",
  saleBadgeText: "Sale",
  saleBadgeColor: "#d7263d",
  saleBadgeTextColor: "#ffffff",
  soldOutBadgeText: "Out of stock",
  soldOutBadgeColor: "#6b6b6b",
  soldOutBadgeTextColor: "#ffffff",
  discountBadgeText: "Save",
  discountBadgeStyle: "solid",
  showAddToCart: true,
  addToCartText: "Add to cart",
  showBuyNow: false,
  buyNowText: "Buy it now",
  buttonStyle: "solid",
  buttonColor: "#111111",
  buttonTextColor: "#ffffff",
  buttonRadius: 6,
  afterAddToCart: "stay",
  variantMode: "firstAvailable",
  chooseVariantText: "Choose variant",
};

export const DEFAULT_BEHAVIOR: BehaviorConfig = {
  defaultOpen: true,
  collapsible: true,
  accordion: false,
  showCounts: true,
  hideEmpty: true,
  disableEmpty: false,
  applyMode: "instant",
  applyButton: {
    text: "Apply filters",
    bgColor: "#111111",
    textColor: "#ffffff",
    size: "small",
    corners: "rounded",
  },
  collapseAfter: 0,
  searchThreshold: 0,
  scrollTop: true,
  animation: "slide",
  smartFilters: false,
  developer: {
    enabled: false,
    collectionFile: "",
    searchFile: "",
    hideSelectors: "",
    keepSelectors: "",
    injectBefore: "",
    collectionLoopFile: "",
    searchLoopFile: "",
  },
};

// ── Admin-facing DTOs (loader returns / client posts these) ─────────────────

export type AdminValue = {
  raw: string;
  // Collection tree: raw (handle) of the parent value, null = root level.
  parentRaw?: string | null;
  label: string | null;
  color: string | null;
  image: string | null;
  hidden: boolean;
  pinned: "top" | "bottom" | null;
  order: number;
  stale: boolean;
  // Custom filters: hand-picked products this option matches, as bare numeric
  // ids (no "gid://shopify/Product/" prefix — see PRODUCT_ID_PREFIX).
  productIds?: string[];
  // Custom filters: products where only some variants were picked, as
  // "productId:variantId" pairs (bare ids). See variantEntry().
  variantIds?: string[];
};

export type FilterType =
  | "available"
  | "price"
  | "productType"
  | "productVendor"
  | "tag"
  | "variantOption"
  | "collection"
  // Merchant-authored: options and their product membership are hand-picked in
  // the admin rather than detected from the catalog.
  | "custom";

export const PRODUCT_ID_PREFIX = "gid://shopify/Product/";

/** "gid://shopify/Product/123" -> "123" (already-bare ids pass through). */
export function bareProductId(id: string): string {
  return id.startsWith(PRODUCT_ID_PREFIX)
    ? id.slice(PRODUCT_ID_PREFIX.length)
    : id;
}

/** "123" -> "gid://shopify/Product/123" (for seeding the resource picker). */
export function gidProductId(id: string): string {
  return id.startsWith(PRODUCT_ID_PREFIX) ? id : PRODUCT_ID_PREFIX + id;
}

export const VARIANT_ID_PREFIX = "gid://shopify/ProductVariant/";

/** "gid://shopify/ProductVariant/9" -> "9" (already-bare ids pass through). */
export function bareVariantId(id: string): string {
  return id.startsWith(VARIANT_ID_PREFIX)
    ? id.slice(VARIANT_ID_PREFIX.length)
    : id;
}

/** "9" -> "gid://shopify/ProductVariant/9". */
export function gidVariantId(id: string): string {
  return id.startsWith(VARIANT_ID_PREFIX) ? id : VARIANT_ID_PREFIX + id;
}

/** Stored custom-filter variant entry: "productId:variantId" (bare ids). */
export function variantEntry(productId: string, variantId: string): string {
  return `${bareProductId(productId)}:${bareVariantId(variantId)}`;
}

/** Parse a "productId:variantId" entry; null when malformed. */
export function parseVariantEntry(
  entry: string,
): { productId: string; variantId: string } | null {
  const [productId, variantId] = String(entry).split(":");
  return productId && variantId ? { productId, variantId } : null;
}

/**
 * Turn a resource-picker product selection into stored membership: products
 * picked in full go to productIds only; products with just some variants
 * picked go to productIds (so product-level matching still works) plus one
 * variantIds entry per picked variant.
 */
export function selectionToMembership(
  selected: {
    id: string;
    totalVariants?: number;
    variants?: { id?: string }[];
  }[],
): { productIds: string[]; variantIds: string[] } {
  const productIds = new Set<string>();
  const variantIds = new Set<string>();
  for (const p of selected) {
    const productId = bareProductId(p.id);
    productIds.add(productId);
    const picked = (p.variants ?? []).filter(
      (v): v is { id: string } => typeof v.id === "string",
    );
    const total = Number(p.totalVariants) || 0;
    if (picked.length > 0 && total > 0 && picked.length < total) {
      for (const v of picked) variantIds.add(variantEntry(productId, v.id));
    }
  }
  return { productIds: [...productIds], variantIds: [...variantIds] };
}

/** Seed the resource picker with the stored selection (exact variants). */
export function membershipToSelectionIds(
  productIds: string[],
  variantIds: string[],
): { id: string; variants?: { id: string }[] }[] {
  const byProduct = new Map<string, string[]>();
  for (const entry of variantIds) {
    const parsed = parseVariantEntry(entry);
    if (!parsed) continue;
    const list = byProduct.get(parsed.productId) ?? [];
    list.push(parsed.variantId);
    byProduct.set(parsed.productId, list);
  }
  return productIds.map((id) => {
    const bare = bareProductId(id);
    const variants = byProduct.get(bare);
    return variants?.length
      ? {
          id: gidProductId(bare),
          variants: variants.map((v) => ({ id: gidVariantId(v) })),
        }
      : { id: gidProductId(bare) };
  });
}

/**
 * Shopify caps `json` metafield values at 128 KB. The whole storefront snapshot
 * lives in one such metafield, so custom filters (the only unbounded thing in
 * it) are budgeted against this. Apps writing json metafields before
 * 2026-04-01 were grandfathered at 2 MB, but we assume the stricter cap.
 */
export const SNAPSHOT_BYTE_LIMIT = 128 * 1024;

/**
 * Max length for any shopper-facing label (filter names, value names, sort
 * option labels, panel heading). The storefront renders these in a narrow
 * sidebar or a drawer, where unbounded text overflows the panel. Applied as a
 * hard `maxLength` on the admin inputs; the storefront additionally wraps long
 * labels defensively, since values saved before this cap still exist.
 */
export const LABEL_MAX_LENGTH = 20;

/**
 * Max length for the discount badge's editable label (e.g. "Save"), which is
 * shown before the auto-calculated percent. Kept short so "Save 20%" fits the
 * small pill next to the price without wrapping.
 */
export const DISCOUNT_BADGE_TEXT_MAX = 13;

/**
 * Cap for the Sale / Out of stock badge label. These sit in a corner of the
 * product image, so anything longer starts covering the photo.
 */
export const IMAGE_BADGE_TEXT_MAX = 15;

const HEX_COLOR_RE = /^#[0-9a-f]{6}$/i;

/** Return `hex` if it's a valid #rrggbb, else `fallback`. */
function safeHex(hex: unknown, fallback: string): string {
  return typeof hex === "string" && HEX_COLOR_RE.test(hex.trim())
    ? hex.trim().toLowerCase()
    : fallback;
}

/** Trim + clamp badge text; empty falls back so the badge never renders blank. */
function clampBadgeText(text: unknown, fallback: string): string {
  const t = typeof text === "string" ? text.trim() : "";
  return (t || fallback).slice(0, IMAGE_BADGE_TEXT_MAX);
}

/** Slugify a merchant-entered name into a stable key/raw token. */
export function slugify(input: string): string {
  return input
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+/, "")
    .replace(/-+$/, "");
}

export type DisplayStyle =
  "checkbox" | "radio" | "swatch" | "image" | "pill" | "range";

export const DISPLAY_STYLES: readonly DisplayStyle[] = [
  "checkbox",
  "radio",
  "swatch",
  "image",
  "pill",
  "range",
];

export const FILTER_TYPES: readonly FilterType[] = [
  "available",
  "price",
  "productType",
  "productVendor",
  "tag",
  "variantOption",
  "collection",
  "custom",
];

export type AdminFilter = {
  key: string;
  type: FilterType;
  name: string | null;
  label: string;
  enabled: boolean;
  order: number;
  displayStyle: DisplayStyle | string;
  defaultOpen: boolean | null; // null = inherit behavior.defaultOpen
  collapseAfter: number | null;
  sortValuesBy: "manual" | "alpha";
  selectionMode: "multi" | "single";
  searchable: boolean;
  styleOptions: {
    min?: number; // price
    max?: number; // price
    pillFill?: "transparent" | "colored"; // pill style background
    pillColor?: string; // pill background color when pillFill = colored
    // Collection tree: "filter" narrows the current grid in place;
    // "navigate" links each node to its collection page.
    treeMode?: "filter" | "navigate";
    // Collection tree: ticking a parent also ticks its sub-collections.
    treeAutoSelect?: boolean;
    // Collection tree: false = render collapsed to top-level nodes, so the
    // shopper expands a parent to reveal its children. Default true (the
    // original behaviour — the whole tree visible at once).
    treeExpanded?: boolean;
    // Shopify collection handles explicitly removed from this filter. Kept as
    // tombstones so later catalog detection doesn't add them back.
    excludedValues?: string[];
  } & Record<string, unknown>;
  values: AdminValue[];
};

export type AdminConfig = {
  layout: LayoutConfig;
  appearance: AppearanceConfig;
  behavior: BehaviorConfig;
  sort: SortConfig;
  productCard: ProductCardConfig;
  filters: AdminFilter[];
  // read-only bookkeeping surfaced to the UI
  storefrontToken: string;
  // Published-snapshot size vs Shopify's metafield cap, so the Filters tab can
  // warn before a save is rejected.
  snapshotBytes: number;
  scannedCount: number;
  capped: boolean;
  snapshotStale: boolean;
  metafieldSyncedAt: string | null;
  // Last full catalog detect (manual button or automatic webhook re-check).
  catalogSyncedAt: string | null;
};

// Display styles applicable per filter type.
export function displayStylesFor(
  type: FilterType,
): { label: string; value: DisplayStyle }[] {
  if (type === "price")
    return [{ label: "Range inputs (min / max boxes)", value: "range" }];
  if (type === "available") return [{ label: "Checkbox", value: "checkbox" }];
  if (type === "collection")
    return [{ label: "Tree (nested list)", value: "checkbox" }];
  return [
    { label: "Checkbox list", value: "checkbox" },
    { label: "Radio list (single-select)", value: "radio" },
    { label: "Color swatches", value: "swatch" },
    { label: "Image swatches", value: "image" },
    { label: "Buttons / pills", value: "pill" },
  ];
}

export function filterKindLabel(type: FilterType): string {
  switch (type) {
    case "available":
      return "Availability";
    case "price":
      return "Price";
    case "productType":
      return "Product type";
    case "productVendor":
      return "Vendor";
    case "tag":
      return "Tag";
    case "variantOption":
      return "Option";
    case "collection":
      return "Collections";
    case "custom":
      return "Custom";
    default:
      return "Filter";
  }
}

// ── Normalization (fill defaults for missing keys) ──────────────────────────

/**
 * Schema-bound merge: only keys that exist in `defaults` are taken from the
 * patch, and a primitive is accepted only when its type matches the default's.
 * Everything else is dropped so a crafted admin payload can't publish unknown
 * keys or mistyped values (e.g. a string where a number is expected) to the
 * storefront metafield.
 */
function mergeDeep<T>(defaults: T, patch: unknown): T {
  if (patch == null || typeof patch !== "object" || Array.isArray(patch))
    return defaults;
  const out: Record<string, unknown> = {
    ...(defaults as Record<string, unknown>),
  };
  const src = patch as Record<string, unknown>;
  for (const k of Object.keys(defaults as Record<string, unknown>)) {
    if (!Object.prototype.hasOwnProperty.call(src, k)) continue;
    const d = (defaults as Record<string, unknown>)[k];
    const v = src[k];
    if (v === undefined) continue;
    if (d != null && typeof d === "object" && !Array.isArray(d)) {
      out[k] = mergeDeep(d, v);
    } else if (Array.isArray(d)) {
      if (Array.isArray(v)) out[k] = v;
    } else if (d === null || d === undefined || typeof v === typeof d) {
      out[k] = v;
    }
  }
  return out as T;
}

/** Hard cap for merchant custom CSS published to the storefront. */
export const CUSTOM_CSS_MAX_LENGTH = 20_000;

/**
 * Custom CSS is emitted raw inside a `<style>` block on the storefront, so
 * anything that could close that block (or open another tag) is neutralised:
 * `<` becomes the CSS escape `\3c ` which is harmless in CSS and inert in
 * HTML. Also strips HTML comment openers and caps the length.
 */
export function sanitizeCustomCss(raw: unknown): string {
  if (typeof raw !== "string") return "";
  return raw
    .slice(0, CUSTOM_CSS_MAX_LENGTH)
    .replace(/<!--/g, "")
    .replace(/-->/g, "")
    .replace(/</g, "\\3c ");
}

export const HIDE_SELECTORS_MAX_LENGTH = 500;

/**
 * Merchant-supplied selector list, reduced to characters a CSS selector can
 * contain so it can't close the storefront <style> block or inject markup.
 */
export function sanitizeHideSelectors(raw: unknown): string {
  if (typeof raw !== "string") return "";
  const clean = raw
    .replace(/[^A-Za-z0-9 _\-#.,:[\]="'>+~*()]/g, "")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, HIDE_SELECTORS_MAX_LENGTH);
  // An unbalanced ")" would close the storefront's :is(…) wrapper and let the
  // rest of the list escape the section scope; drop such input entirely.
  let paren = 0;
  let bracket = 0;
  for (const ch of clean) {
    if (ch === "(") paren++;
    else if (ch === ")") paren--;
    else if (ch === "[") bracket++;
    else if (ch === "]") bracket--;
    if (paren < 0 || bracket < 0) return "";
  }
  if (paren !== 0 || bracket !== 0) return "";
  const evenQuotes = (q: string) => (clean.split(q).length - 1) % 2 === 0;
  if (!evenQuotes("'") || !evenQuotes('"')) return "";
  return clean;
}

/**
 * Raw values per filter key as the admin page loaded them. Sent back with a
 * Save so the server can tell "the merchant removed this" (in the baseline,
 * not in the payload) from "the catalog sync added this while the page was
 * open" (in the DB, in neither).
 */
export type FilterBaseline = Record<string, string[]>;

export function baselineOf(
  filters: { key: string; values: { raw: string }[] }[],
): FilterBaseline {
  const out: FilterBaseline = {};
  for (const f of filters) out[f.key] = f.values.map((v) => v.raw);
  return out;
}

/**
 * Three-way merge for Save: the payload wins, DB additions that are not in
 * the baseline survive (appended), baseline entries missing from the payload
 * are merchant deletions. Without a baseline the payload replaces everything.
 */
export function mergeSyncAdditions<
  V extends { raw: string },
  F extends { key: string; values: V[] },
>(payload: F[], db: F[], baseline: FilterBaseline | null | undefined): F[] {
  if (!baseline) return payload;
  const byKey = new Map(payload.map((f) => [f.key, f]));
  const out: F[] = payload.map((f) => ({ ...f, values: [...f.values] }));
  for (const dbFilter of db) {
    const mine = out.find((f) => f.key === dbFilter.key);
    const loaded = baseline[dbFilter.key];
    if (!mine) {
      // Filter the merchant never saw → sync created it → keep whole.
      if (!loaded && !byKey.has(dbFilter.key)) out.push(dbFilter);
      continue;
    }
    const have = new Set(mine.values.map((v) => v.raw));
    const seen = new Set(loaded ?? []);
    for (const v of dbFilter.values) {
      if (!have.has(v.raw) && !seen.has(v.raw)) mine.values.push(v);
    }
  }
  return out;
}

/** Trim + clamp a merchant label; empty falls back. */
export function clampLabel(text: unknown, fallback: string, max: number) {
  const t = typeof text === "string" ? text.trim() : "";
  return (t || fallback).slice(0, max);
}

function oneOf<T extends string>(
  value: unknown,
  allowed: readonly T[],
  fallback: T,
): T {
  return allowed.includes(value as T) ? (value as T) : fallback;
}

function clampNum(value: unknown, min: number, max: number, fallback: number) {
  const n = Number(value);
  if (!Number.isFinite(n)) return fallback;
  return Math.min(max, Math.max(min, n));
}

export function normalizeLayout(raw: unknown): LayoutConfig {
  const merged = mergeDeep(DEFAULT_LAYOUT, raw);
  const value = Number(merged.productsPerPage);
  const paginationStyles = [
    "basic",
    "pill",
    "numbered",
    "segmented",
    "text",
    "jump",
  ] as const;
  const paginationStyle = paginationStyles.includes(
    merged.paginationStyle as (typeof paginationStyles)[number],
  )
    ? merged.paginationStyle
    : DEFAULT_LAYOUT.paginationStyle;
  const d = DEFAULT_LAYOUT;
  return {
    ...merged,
    structure: oneOf(
      merged.structure,
      ["sidebar-left", "sidebar-right", "horizontal", "drawer"] as const,
      d.structure,
    ),
    horizontalStyle: oneOf(
      merged.horizontalStyle,
      ["outlined", "borderless", "boxed"] as const,
      d.horizontalStyle,
    ),
    mobileMode: oneOf(
      merged.mobileMode,
      ["drawer", "inline"] as const,
      d.mobileMode,
    ),
    chipStyle: oneOf(
      merged.chipStyle,
      ["pill", "rounded", "square"] as const,
      d.chipStyle,
    ),
    sidebarWidth: Math.round(
      clampNum(merged.sidebarWidth, 200, 360, d.sidebarWidth),
    ),
    columnsDesktop: Math.round(
      clampNum(merged.columnsDesktop, 2, 5, d.columnsDesktop),
    ),
    columnsMobile: Math.round(
      clampNum(merged.columnsMobile, 1, 2, d.columnsMobile),
    ),
    gap: Math.round(clampNum(merged.gap, 5, 30, d.gap)),
    headingSize: Math.round(
      clampNum(merged.headingSize, 12, 32, d.headingSize),
    ),
    headingText: clampLabel(
      merged.headingText,
      d.headingText,
      LABEL_MAX_LENGTH,
    ),
    productsPerPage: Number.isFinite(value)
      ? Math.min(30, Math.max(10, Math.round(value)))
      : DEFAULT_LAYOUT.productsPerPage,
    paginationStyle,
  };
}
export function normalizeAppearance(raw: unknown): AppearanceConfig {
  const a = mergeDeep(DEFAULT_APPEARANCE, raw);
  const d = DEFAULT_APPEARANCE;
  const colors = { ...a.colors };
  for (const k of Object.keys(d.colors) as (keyof typeof d.colors)[]) {
    colors[k] = safeHex(colors[k], d.colors[k]);
  }
  return {
    ...a,
    preset: typeof a.preset === "string" ? a.preset.slice(0, 40) : "",
    colors,
    radius: Math.round(clampNum(a.radius, 0, 20, d.radius)),
    density: oneOf(
      a.density,
      ["comfortable", "cozy", "compact"] as const,
      d.density,
    ),
    swatch: {
      ...a.swatch,
      shape: oneOf(
        a.swatch.shape,
        ["circle", "square", "rounded"] as const,
        d.swatch.shape,
      ),
      size: Math.round(clampNum(a.swatch.size, 14, 36, d.swatch.size)),
      selectedIndicator: oneOf(
        a.swatch.selectedIndicator,
        ["ring", "check", "border"] as const,
        d.swatch.selectedIndicator,
      ),
      hoverEffect: oneOf(
        a.swatch.hoverEffect,
        ["grow", "lift", "border", "none"] as const,
        d.swatch.hoverEffect,
      ),
    },
    typography: {
      ...a.typography,
      labelSize: Math.round(
        clampNum(a.typography.labelSize, 10, 24, d.typography.labelSize),
      ),
      labelWeight: [400, 500, 600].includes(Number(a.typography.labelWeight))
        ? Number(a.typography.labelWeight)
        : d.typography.labelWeight,
    },
    groupIcon: oneOf(
      a.groupIcon,
      ["chevron", "plus", "caret"] as const,
      d.groupIcon,
    ),
    customCss: sanitizeCustomCss(a.customCss),
  };
}
export function normalizeBehavior(raw: unknown): BehaviorConfig {
  const b = mergeDeep(DEFAULT_BEHAVIOR, raw);
  const d = DEFAULT_BEHAVIOR.applyButton;
  const ab = b.applyButton;
  const text = typeof ab.text === "string" ? ab.text.trim() : "";
  b.applyButton = {
    text: (text || d.text).slice(0, APPLY_BUTTON_TEXT_MAX),
    bgColor: safeHex(ab.bgColor, d.bgColor),
    textColor: safeHex(ab.textColor, d.textColor),
    size: APPLY_BUTTON_SIZES.includes(ab.size) ? ab.size : d.size,
    corners: APPLY_BUTTON_CORNERS.includes(ab.corners) ? ab.corners : d.corners,
  };
  const dev = b.developer ?? DEFAULT_BEHAVIOR.developer!;
  b.developer = {
    ...DEFAULT_BEHAVIOR.developer!,
    ...dev,
    hideSelectors: sanitizeHideSelectors(dev.hideSelectors),
    keepSelectors: sanitizeHideSelectors(dev.keepSelectors),
    injectBefore:
      typeof dev.injectBefore === "string"
        ? dev.injectBefore.trim().slice(0, 200)
        : "",
    collectionLoopFile: normalizeSnippetPath(dev.collectionLoopFile),
    searchLoopFile: normalizeSnippetPath(dev.searchLoopFile),
  };
  return b;
}
export function normalizeProductCard(raw: unknown): ProductCardConfig {
  const pc = mergeDeep(DEFAULT_PRODUCT_CARD, raw);
  if (!BADGE_POSITIONS.includes(pc.badgePosition)) {
    pc.badgePosition = DEFAULT_PRODUCT_CARD.badgePosition;
  }
  if (!BADGE_SIZES.includes(pc.badgeSize)) {
    pc.badgeSize = DEFAULT_PRODUCT_CARD.badgeSize;
  }
  if (!CARD_LAYOUTS.includes(pc.cardLayout as CardLayout)) {
    pc.cardLayout = DEFAULT_PRODUCT_CARD.cardLayout;
  }
  if (!CARD_SOURCES.includes(pc.cardSource as CardSource)) {
    pc.cardSource = DEFAULT_PRODUCT_CARD.cardSource;
  }
  if (!CARD_SHADOWS.includes(pc.cardShadow)) {
    pc.cardShadow = DEFAULT_PRODUCT_CARD.cardShadow;
  }
  if (!(TITLE_WEIGHTS as readonly number[]).includes(pc.titleWeight)) {
    pc.titleWeight = DEFAULT_PRODUCT_CARD.titleWeight;
  }
  pc.cardRadius = Math.min(
    24,
    Math.max(0, Math.round(Number(pc.cardRadius) || 0)),
  );
  pc.priceSize = Math.min(
    24,
    Math.max(11, Math.round(Number(pc.priceSize) || 14)),
  );
  pc.titleSize = Math.min(
    30,
    Math.max(11, Math.round(Number(pc.titleSize) || 14)),
  );
  const d = DEFAULT_PRODUCT_CARD;
  pc.cardBackground = safeHex(pc.cardBackground, d.cardBackground);
  pc.cardTextColor = safeHex(pc.cardTextColor, d.cardTextColor);
  pc.cardBorderColor = safeHex(pc.cardBorderColor, d.cardBorderColor);
  pc.saleBadgeText = clampBadgeText(pc.saleBadgeText, d.saleBadgeText);
  pc.saleBadgeColor = safeHex(pc.saleBadgeColor, d.saleBadgeColor);
  pc.saleBadgeTextColor = safeHex(pc.saleBadgeTextColor, d.saleBadgeTextColor);
  pc.soldOutBadgeText = clampBadgeText(pc.soldOutBadgeText, d.soldOutBadgeText);
  pc.soldOutBadgeColor = safeHex(pc.soldOutBadgeColor, d.soldOutBadgeColor);
  pc.soldOutBadgeTextColor = safeHex(
    pc.soldOutBadgeTextColor,
    d.soldOutBadgeTextColor,
  );
  // Enum fields that end up in class names / data attributes on the storefront.
  pc.imageRatio = oneOf(
    pc.imageRatio,
    ["natural", "square", "portrait"] as const,
    d.imageRatio,
  );
  pc.imageFit = oneOf(pc.imageFit, ["cover", "contain"] as const, d.imageFit);
  pc.textAlign = oneOf(pc.textAlign, ["left", "center"] as const, d.textAlign);
  pc.slideshowMode = oneOf(
    pc.slideshowMode,
    ["hover", "arrows"] as const,
    d.slideshowMode,
  );
  pc.discountBadgeStyle = oneOf(
    pc.discountBadgeStyle,
    ["solid", "outline", "text"] as const,
    d.discountBadgeStyle,
  );
  pc.buttonStyle = oneOf(
    pc.buttonStyle,
    ["solid", "outline"] as const,
    d.buttonStyle,
  );
  pc.afterAddToCart = oneOf(
    pc.afterAddToCart,
    ["stay", "cart"] as const,
    d.afterAddToCart,
  );
  pc.variantMode = oneOf(
    pc.variantMode,
    ["firstAvailable", "chooseVariant", "productPage"] as const,
    d.variantMode,
  );
  // Merchant text that is rendered on every card.
  pc.addToCartText = clampLabel(
    pc.addToCartText,
    d.addToCartText,
    APPLY_BUTTON_TEXT_MAX,
  );
  pc.buyNowText = clampLabel(
    pc.buyNowText,
    d.buyNowText,
    APPLY_BUTTON_TEXT_MAX,
  );
  pc.chooseVariantText = clampLabel(
    pc.chooseVariantText,
    d.chooseVariantText,
    APPLY_BUTTON_TEXT_MAX,
  );
  pc.discountBadgeText = clampLabel(
    pc.discountBadgeText,
    d.discountBadgeText,
    DISCOUNT_BADGE_TEXT_MAX,
  );
  // Numbers that drive timers / loops / CSS.
  pc.slideshowSpeed = clampNum(pc.slideshowSpeed, 0.5, 10, d.slideshowSpeed);
  pc.slideshowMaxImages = Math.round(
    clampNum(pc.slideshowMaxImages, 2, 10, d.slideshowMaxImages),
  );
  pc.buttonRadius = Math.round(
    clampNum(pc.buttonRadius, 0, 30, d.buttonRadius),
  );
  pc.buttonColor = safeHex(pc.buttonColor, d.buttonColor);
  pc.buttonTextColor = safeHex(pc.buttonTextColor, d.buttonTextColor);
  return pc;
}

/**
 * Sort needs more than mergeDeep: `options` is an array whose membership is
 * fixed (one entry per SortKey) but whose ORDER is merchant data. So keep the
 * stored order, drop unknown/duplicate keys, and append any key the stored
 * config never knew about (i.e. added in a later release).
 */
export function normalizeSort(raw: unknown): SortConfig {
  const base = mergeDeep(DEFAULT_SORT, raw);
  const stored = Array.isArray((raw as SortConfig | undefined)?.options)
    ? (raw as SortConfig).options
    : [];

  const seen = new Set<SortKey>();
  const options: SortOption[] = [];
  for (const o of stored) {
    const key = o?.key as SortKey;
    if (!SORT_KEY_LABELS[key] || seen.has(key)) continue;
    seen.add(key);
    options.push({
      key,
      label:
        typeof o.label === "string" && o.label.trim()
          ? o.label
          : SORT_KEY_LABELS[key],
      enabled: o.enabled !== false,
    });
  }
  for (const key of SORT_KEYS) {
    if (seen.has(key)) continue;
    options.push(DEFAULT_SORT.options.find((o) => o.key === key)!);
  }

  // Older configs carried a `defaultKey`; it is no longer a setting.
  const { defaultKey: _legacyDefaultKey, ...rest } = base as SortConfig & {
    defaultKey?: unknown;
  };

  return {
    ...rest,
    position:
      base.position === "panel" || base.position === "top-right"
        ? base.position
        : "toolbar",
    label: base.label || DEFAULT_SORT.label,
    options,
  };
}

// ── Appearance presets (one-click palettes) ─────────────────────────────────

export const APPEARANCE_PRESETS: {
  name: string;
  colors: AppearanceConfig["colors"];
}[] = [
  {
    name: "Minimal",
    colors: {
      accent: "#111111",
      text: "#111111",
      muted: "#6b6b6b",
      border: "#e5e5e5",
      background: "#ffffff",
      hoverBg: "#f7f7f7",
      selectedBg: "#f0f0f0",
      chipBg: "#f5f5f5",
      chipText: "#111111",
    },
  },
  {
    name: "Bold",
    colors: {
      accent: "#d7263d",
      text: "#1b1b1b",
      muted: "#5c5c5c",
      border: "#d9d9d9",
      background: "#ffffff",
      hoverBg: "#fbeef0",
      selectedBg: "#fbe0e4",
      chipBg: "#d7263d",
      chipText: "#ffffff",
    },
  },
  {
    name: "Ocean",
    colors: {
      accent: "#0b6e99",
      text: "#12222b",
      muted: "#5b7482",
      border: "#d3e2ea",
      background: "#ffffff",
      hoverBg: "#eef6fa",
      selectedBg: "#dcedf5",
      chipBg: "#0b6e99",
      chipText: "#ffffff",
    },
  },
  {
    name: "Dark",
    colors: {
      accent: "#9db6ff",
      text: "#f0f0f0",
      muted: "#a5a5a5",
      border: "#3a3a3a",
      background: "#161616",
      hoverBg: "#242424",
      selectedBg: "#2c2c2c",
      chipBg: "#2c2c2c",
      chipText: "#f0f0f0",
    },
  },
];
