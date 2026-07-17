import { test } from "node:test";
import assert from "node:assert/strict";
import {
  membershipToSelectionIds,
  normalizeAppearance,
  normalizeBehavior,
  normalizeLayout,
  normalizeProductCard,
  sanitizeCustomCss,
  sanitizeHideSelectors,
  developerThemeFiles,
  normalizeSnippetPath,
  baselineOf,
  mergeSyncAdditions,
  selectionToMembership,
} from "./filterConfig.shared";

test("selectionToMembership keeps specific variants only when some were picked", () => {
  const membership = selectionToMembership([
    {
      // Two of nine variants picked (issue #4).
      id: "gid://shopify/Product/1",
      totalVariants: 9,
      variants: [
        { id: "gid://shopify/ProductVariant/11" },
        { id: "gid://shopify/ProductVariant/12" },
      ],
    },
    {
      // Every variant picked: stored as the whole product.
      id: "gid://shopify/Product/2",
      totalVariants: 2,
      variants: [
        { id: "gid://shopify/ProductVariant/21" },
        { id: "gid://shopify/ProductVariant/22" },
      ],
    },
    { id: "gid://shopify/Product/3", totalVariants: 1, variants: [] },
  ]);
  assert.deepEqual(membership, {
    productIds: ["1", "2", "3"],
    variantIds: ["1:11", "1:12"],
  });
});

test("membershipToSelectionIds seeds the picker with the exact variants", () => {
  assert.deepEqual(
    membershipToSelectionIds(["1", "2"], ["1:11", "1:12", "bad"]),
    [
      {
        id: "gid://shopify/Product/1",
        variants: [
          { id: "gid://shopify/ProductVariant/11" },
          { id: "gid://shopify/ProductVariant/12" },
        ],
      },
      { id: "gid://shopify/Product/2" },
    ],
  );
});

test("normalizeBehavior fills and validates apply button settings", () => {
  assert.deepEqual(normalizeBehavior({}).applyButton, {
    text: "Apply filters",
    bgColor: "#111111",
    textColor: "#ffffff",
    size: "small",
    corners: "rounded",
  });

  const ab = normalizeBehavior({
    applyButton: {
      text: "   ",
      bgColor: "red",
      textColor: "#ABCDEF",
      size: "huge",
      corners: "edged",
    },
  }).applyButton;
  assert.equal(ab.text, "Apply filters");
  assert.equal(ab.bgColor, "#111111");
  assert.equal(ab.textColor, "#abcdef");
  assert.equal(ab.size, "small");
  assert.equal(ab.corners, "edged");

  assert.equal(
    normalizeBehavior({ applyButton: { text: "x".repeat(50) } }).applyButton
      .text.length,
    30,
  );
});

test("normalizeLayout keeps products per page within the supported range", () => {
  assert.equal(normalizeLayout({ productsPerPage: 5 }).productsPerPage, 10);
  assert.equal(normalizeLayout({ productsPerPage: 24 }).productsPerPage, 24);
  assert.equal(normalizeLayout({ productsPerPage: 40 }).productsPerPage, 30);
});

test("normalizeLayout defaults and validates pagination style", () => {
  assert.equal(normalizeLayout({}).paginationStyle, "basic");
  assert.equal(
    normalizeLayout({ paginationStyle: "numbered" }).paginationStyle,
    "numbered",
  );
  assert.equal(
    normalizeLayout({ paginationStyle: "unsupported" }).paginationStyle,
    "basic",
  );
});

test("normalizeProductCard fills choose-variant defaults", () => {
  const config = normalizeProductCard({});

  assert.equal(config.variantMode, "firstAvailable");
  assert.equal(config.chooseVariantText, "Choose variant");
});

test("normalizeProductCard fills card appearance defaults", () => {
  const config = normalizeProductCard({});
  assert.equal(config.cardLayout, "classic");
  assert.equal(config.cardRadius, 8);
  assert.equal(config.cardBackground, "#ffffff");
  assert.equal(config.cardTextColor, "#111111");
  assert.equal(config.cardShadow, "none");
  assert.equal(config.titleWeight, 400);
  assert.equal(config.priceSize, 14);
});

test("normalizeProductCard falls back for unknown card layouts", () => {
  assert.equal(
    normalizeProductCard({ cardLayout: "horizontal" }).cardLayout,
    "classic",
  );
  assert.equal(
    normalizeProductCard({ cardLayout: "showcase" }).cardLayout,
    "classic",
  );
  assert.equal(
    normalizeProductCard({ cardLayout: "split" }).cardLayout,
    "split",
  );
});

test("normalizeProductCard falls back to top-left for unknown badge positions", () => {
  assert.equal(normalizeProductCard({}).badgePosition, "top-left");
  assert.equal(
    normalizeProductCard({ badgePosition: "middle" }).badgePosition,
    "top-left",
  );
  assert.equal(
    normalizeProductCard({ badgePosition: "bottom-right" }).badgePosition,
    "bottom-right",
  );
});

test("normalizeProductCard falls back to medium for unknown badge sizes", () => {
  assert.equal(normalizeProductCard({}).badgeSize, "medium");
  assert.equal(normalizeProductCard({ badgeSize: "huge" }).badgeSize, "medium");
  assert.equal(normalizeProductCard({ badgeSize: "large" }).badgeSize, "large");
});

test("normalizeProductCard clamps badge text to 15 chars and validates colors", () => {
  const config = normalizeProductCard({
    saleBadgeText: "  Limited time offer today  ",
    saleBadgeColor: "not-a-color",
    soldOutBadgeText: "",
    soldOutBadgeTextColor: "#ABCDEF",
  });

  assert.equal(config.saleBadgeText, "Limited time of");
  assert.equal(config.saleBadgeText.length, 15);
  assert.equal(config.saleBadgeColor, "#d7263d");
  assert.equal(config.soldOutBadgeText, "Out of stock");
  assert.equal(config.soldOutBadgeTextColor, "#abcdef");
});

test("normalizeProductCard preserves choose-variant settings", () => {
  const config = normalizeProductCard({
    variantMode: "chooseVariant",
    chooseVariantText: "Select options",
  });

  assert.equal(config.variantMode, "chooseVariant");
  assert.equal(config.chooseVariantText, "Select options");
});

test("normalizeProductCard keeps a valid cardSource and falls back to aco", () => {
  assert.equal(normalizeProductCard({}).cardSource, "aco");
  assert.equal(
    normalizeProductCard({ cardSource: "theme" }).cardSource,
    "theme",
  );
  assert.equal(normalizeProductCard({ cardSource: "bogus" }).cardSource, "aco");
});

// ---- hardening: schema-bound merge, custom CSS, enum fields -----------------

test("normalizers drop unknown keys and mistyped values", () => {
  const layout = normalizeLayout({
    sidebarWidth: "<script>",
    paginationStyle: "pill",
    injected: "nope",
  }) as Record<string, unknown>;
  assert.equal(layout.sidebarWidth, 260);
  assert.equal(layout.paginationStyle, "pill");
  assert.equal("injected" in layout, false);

  const appearance = normalizeAppearance({
    colors: { accent: "url(https://evil)", text: "#123456" },
    typography: { labelSize: "999px;", labelWeight: 900 },
    density: "huge",
  });
  assert.equal(appearance.colors.accent, "#111111");
  assert.equal(appearance.colors.text, "#123456");
  assert.equal(appearance.typography.labelSize, 14);
  assert.equal(appearance.typography.labelWeight, 400);
  assert.equal(appearance.density, "comfortable");
});

test("custom CSS cannot close the style block", () => {
  const css = sanitizeCustomCss(
    "</style><script>alert(1)</script><style>.a{color:red}",
  );
  assert.equal(css.includes("<"), false);
  // The CSS escape for "<" is a backslash, "3c", then a space.
  assert.ok(css.includes("\\3c script>"), css);
  assert.equal(normalizeAppearance({ customCss: 42 }).customCss, "");
  assert.equal(sanitizeCustomCss("x".repeat(30000)).length, 20000);
});

test("normalizeProductCard validates enum and text fields used in markup", () => {
  const pc = normalizeProductCard({
    discountBadgeStyle: 'x"><img src=x onerror=alert(1)>',
    slideshowMode: "javascript:",
    imageRatio: "wide",
    addToCartText: "<b>" + "a".repeat(80),
    slideshowSpeed: 9999,
    buttonColor: "red",
  });
  assert.equal(pc.discountBadgeStyle, "solid");
  assert.equal(pc.slideshowMode, "hover");
  assert.equal(pc.imageRatio, "square");
  assert.equal(pc.addToCartText.length, 30);
  assert.equal(pc.slideshowSpeed, 10);
  assert.equal(pc.buttonColor, "#111111");
});

test("sanitizeHideSelectors strips unsafe characters and caps length", () => {
  assert.equal(
    sanitizeHideSelectors("xo-filters-top, xo-filters"),
    "xo-filters-top, xo-filters",
  );
  assert.equal(
    sanitizeHideSelectors("a} body{display:none}</style><b"),
    "a bodydisplay:nonestyle>b",
  );
  assert.equal(sanitizeHideSelectors("x".repeat(600)).length, 500);
  assert.equal(sanitizeHideSelectors(42), "");
});

test("normalizeBehavior sanitizes developer.hideSelectors", () => {
  const b = normalizeBehavior({
    developer: { enabled: true, hideSelectors: " .grid { } " },
  });
  assert.equal(b.developer?.hideSelectors, ".grid");
  assert.equal(normalizeBehavior({}).developer?.hideSelectors, "");
});

test("sanitizeHideSelectors rejects unbalanced brackets and quotes", () => {
  assert.equal(sanitizeHideSelectors("x), body:not(y"), "");
  assert.equal(sanitizeHideSelectors("a[b"), "");
  assert.equal(sanitizeHideSelectors("'x"), "");
  assert.equal(
    sanitizeHideSelectors("a:not(.b), [data-x='1']"),
    "a:not(.b), [data-x='1']",
  );
});

test("developerThemeFiles is undefined unless developer options are on", () => {
  assert.equal(developerThemeFiles(normalizeBehavior({})), undefined);
  const on = normalizeBehavior({
    developer: {
      enabled: true,
      collectionFile: "sections/x.liquid",
      injectBefore: "<xo-filters",
      collectionLoopFile: "filters-content",
      keepSelectors: ".keep",
    },
  });
  assert.deepEqual(developerThemeFiles(on), {
    collectionFile: "sections/x.liquid",
    searchFile: "",
    injectBefore: "<xo-filters",
    collectionLoopFile: "snippets/filters-content.liquid",
    searchLoopFile: "",
  });
});

test("normalizeBehavior clamps the theme compatibility fields", () => {
  const b = normalizeBehavior({
    developer: {
      enabled: true,
      injectBefore: "  " + "x".repeat(300),
      keepSelectors: "a{b",
    },
  });
  assert.equal(b.developer?.injectBefore.length, 200);
  assert.equal(b.developer?.keepSelectors, "ab");
  assert.equal(normalizeBehavior({}).developer?.collectionLoopFile, "");
});

test("normalizeSnippetPath defaults bare names to snippets/", () => {
  assert.equal(
    normalizeSnippetPath("filters-content"),
    "snippets/filters-content.liquid",
  );
  assert.equal(
    normalizeSnippetPath("/sections/grid.liquid"),
    "sections/grid.liquid",
  );
  assert.equal(normalizeSnippetPath(""), "");
});

// ── Save merge: keep what the catalog sync added while the page was open ──
const mkFilter = (key: string, raws: string[]) =>
  ({ key, values: raws.map((raw, order) => ({ raw, order })) }) as any;

test("baselineOf records each filter's raw values at page load", () => {
  assert.deepEqual(
    baselineOf([mkFilter("vendor", ["a", "b"]), mkFilter("tag", [])]),
    {
      vendor: ["a", "b"],
      tag: [],
    },
  );
});

test("mergeSyncAdditions keeps values the sync added since load, drops what the merchant deleted", () => {
  const baseline = { vendor: ["a", "b"] };
  const payload = [mkFilter("vendor", ["a"])]; // merchant deleted "b"
  const db = [mkFilter("vendor", ["a", "b", "c"])]; // sync added "c" meanwhile
  const out = mergeSyncAdditions(payload, db, baseline);
  assert.deepEqual(
    out.map((f: any) => f.values.map((v: any) => v.raw)),
    [["a", "c"]],
  );
});

test("mergeSyncAdditions keeps a whole filter the sync created, drops one the merchant removed", () => {
  const baseline = { vendor: ["a"], tag: ["x"] };
  const payload = [mkFilter("vendor", ["a"])]; // merchant removed "tag"
  const db = [
    mkFilter("vendor", ["a"]),
    mkFilter("tag", ["x"]),
    mkFilter("opt_Size", ["M"]),
  ];
  const out = mergeSyncAdditions(payload, db, baseline);
  assert.deepEqual(
    out.map((f: any) => f.key),
    ["vendor", "opt_Size"],
  );
});

test("mergeSyncAdditions without a baseline is the old wholesale replace", () => {
  const payload = [mkFilter("vendor", ["a"])];
  const db = [mkFilter("vendor", ["a", "z"]), mkFilter("tag", ["x"])];
  assert.deepEqual(mergeSyncAdditions(payload, db, null), payload);
});
