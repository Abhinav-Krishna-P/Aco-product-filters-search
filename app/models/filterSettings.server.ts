/**
 * Filter settings data layer — dual store.
 *
 * Postgres (Prisma) is the source of truth for the admin UI: the settings page
 * loads from and saves to these tables. On every save the config is serialized
 * into the `pf_config.settings` shop metafield (JSON), which is the ONLY thing
 * the storefront theme extension reads. If the metafield write fails the DB
 * still holds the truth and `snapshotStale` is set so the UI can offer a
 * "Republish" action.
 *
 *   Admin UI ──load──► Postgres ──save──► Postgres ──serialize──► metafield ──► storefront
 */

import { randomUUID } from "node:crypto";
import prisma from "../db.server";
import type {
  AdminConfig,
  AdminFilter,
  AdminValue,
  AppearanceConfig,
  BehaviorConfig,
  LayoutConfig,
  ProductCardConfig,
  SortConfig,
  FilterBaseline,
} from "./filterConfig.shared";
import {
  DISPLAY_STYLES,
  FILTER_TYPES,
  LABEL_MAX_LENGTH,
  clampLabel,
  SNAPSHOT_BYTE_LIMIT,
  bareProductId,
  bareVariantId,
  normalizeAppearance,
  parseVariantEntry,
  normalizeBehavior,
  normalizeLayout,
  normalizeProductCard,
  normalizeSort,
  mergeSyncAdditions,
} from "./filterConfig.shared";
import { detectSwatchColor } from "./swatchColors";

// ── DB access ────────────────────────────────────────────────────────────────

type DbSettings = NonNullable<Awaited<ReturnType<typeof findSettings>>>;

// Swatch values with no colour set fall back to the colour their name
// suggests ("beige", "navy"). Applied when the admin config is read, so the
// editor's baseline already carries it: opening the Color editor is no longer
// an unsaved change, and the next Save persists the colours.
function swatchColor(
  displayStyle: string,
  v: { color: string | null; label: string | null; raw: string },
): string | null {
  if (v.color || displayStyle !== "swatch") return v.color;
  return detectSwatchColor(v.label ?? v.raw);
}

// Map removed display styles ("dropdown", "slider") to their replacements.
function coerceDisplayStyle(style: string): string {
  if (style === "dropdown") return "checkbox";
  if (style === "slider") return "range";
  return style;
}

function findSettings(shop: string) {
  return prisma.filterSettings.findUnique({
    where: { shop },
    include: {
      filters: {
        orderBy: { order: "asc" },
        include: { values: { orderBy: { order: "asc" } } },
      },
    },
  });
}

function toAdminConfig(row: DbSettings): AdminConfig {
  return {
    layout: normalizeLayout(row.layout),
    appearance: normalizeAppearance(row.appearance),
    behavior: normalizeBehavior(row.behavior),
    sort: normalizeSort(row.sort),
    productCard: normalizeProductCard(row.productCard),
    storefrontToken: row.storefrontToken ?? "",
    snapshotBytes: snapshotBytes(serializeConfig(row)),
    scannedCount: row.scannedCount,
    capped: row.capped,
    snapshotStale: row.snapshotStale,
    metafieldSyncedAt: row.metafieldSyncedAt?.toISOString() ?? null,
    catalogSyncedAt: row.catalogSyncedAt?.toISOString() ?? null,
    filters: row.filters.map((f) => ({
      key: f.key,
      type: f.type as AdminFilter["type"],
      name: f.name,
      label: f.label,
      enabled: f.enabled,
      order: f.order,
      displayStyle: coerceDisplayStyle(f.displayStyle),
      defaultOpen: f.defaultOpen,
      collapseAfter: f.collapseAfter,
      sortValuesBy: (f.sortValuesBy === "manual" ? "manual" : "alpha") as
        "manual" | "alpha",
      selectionMode: (f.selectionMode === "single" ? "single" : "multi") as
        "multi" | "single",
      searchable: f.searchable,
      styleOptions: (f.styleOptions ?? {}) as AdminFilter["styleOptions"],
      values: f.values.map((v) => ({
        raw: v.raw,
        parentRaw: v.parentRaw,
        label: v.label,
        color: swatchColor(coerceDisplayStyle(f.displayStyle), v),
        image: v.image,
        hidden: v.hidden,
        pinned: (v.pinned === "top" || v.pinned === "bottom"
          ? v.pinned
          : null) as AdminValue["pinned"],
        order: v.order,
        stale: v.stale,
        productIds: v.productIds ?? [],
        variantIds: v.variantIds ?? [],
      })),
    })),
  };
}

/**
 * Load the shop's config from the DB. If no row exists yet (first run after
 * this feature shipped), seed it from the legacy pf_config metafield so
 * existing merchants keep their filters, labels and enabled toggles.
 */
export async function getConfig(
  shop: string,
  admin: AdminClient,
): Promise<AdminConfig> {
  let row = await findSettings(shop);
  if (!row) {
    // Truly fresh install or reinstall after uninstall: start with clean defaults (step 1)
    await prisma.filterSettings.upsert({
      where: { shop },
      create: { shop },
      update: {},
    });
    // Remove any stale leftover metafield from a previous install on Shopify
    try {
      await deleteShopMetafield(admin);
    } catch (err) {
      if (err instanceof Response) throw err;
      // Non-blocking for real API failures
    }
    row = await findSettings(shop);
  }
  if (!row) {
    // Safe fallback guarding against null assertion crashes
    return {
      layout: normalizeLayout({}),
      appearance: normalizeAppearance({}),
      behavior: normalizeBehavior({}),
      sort: normalizeSort({}),
      productCard: normalizeProductCard({}),
      storefrontToken: "",
      snapshotBytes: 0,
      scannedCount: 0,
      capped: false,
      snapshotStale: false,
      metafieldSyncedAt: null,
      catalogSyncedAt: null,
      filters: [],
    };
  }
  return toAdminConfig(row);
}

/**
 * Persist the full admin config to the DB (transactional), then republish the
 * metafield snapshot. Returns metafield userErrors (empty array = fully ok).
 */
export async function saveConfig(
  shop: string,
  admin: AdminClient,
  input: {
    layout: LayoutConfig;
    appearance: AppearanceConfig;
    behavior: BehaviorConfig;
    sort: SortConfig;
    productCard: ProductCardConfig;
    filters: AdminFilter[];
  },
  opts?: {
    /** Values per filter as the page loaded them (see mergeSyncAdditions). */
    baseline?: FilterBaseline | null;
  },
): Promise<{ ok: boolean; errors: { message: string }[] }> {
  const layout = normalizeLayout(input.layout);
  const appearance = normalizeAppearance(input.appearance);
  const behavior = normalizeBehavior(input.behavior);
  const sort = normalizeSort(input.sort);
  const productCard = normalizeProductCard(input.productCard);

  await prisma.$transaction(async (tx) => {
    const settings = await tx.filterSettings.upsert({
      where: { shop },
      create: { shop, layout, appearance, behavior, sort, productCard },
      update: {
        layout,
        appearance,
        behavior,
        sort,
        productCard,
        snapshotStale: true,
      },
    });
    // The admin posts the full set; anything the catalog sync added while the
    // page was open (not in the baseline) is kept rather than wiped.
    const dbFilters = opts?.baseline
      ? (
          await tx.filterDefinition.findMany({
            where: { settingsId: settings.id },
            include: { values: { orderBy: { order: "asc" } } },
            orderBy: { order: "asc" },
          })
        ).map((f): AdminFilter => ({
          key: f.key,
          type: f.type as AdminFilter["type"],
          name: f.name,
          label: f.label,
          enabled: f.enabled,
          order: f.order,
          displayStyle: f.displayStyle,
          defaultOpen: f.defaultOpen,
          collapseAfter: f.collapseAfter,
          sortValuesBy: f.sortValuesBy === "manual" ? "manual" : "alpha",
          selectionMode: f.selectionMode === "single" ? "single" : "multi",
          searchable: f.searchable,
          styleOptions: (f.styleOptions ?? {}) as AdminFilter["styleOptions"],
          values: f.values.map((v) => ({
            raw: v.raw,
            parentRaw: v.parentRaw,
            label: v.label,
            color: v.color,
            image: v.image,
            hidden: v.hidden,
            pinned: (v.pinned === "top" || v.pinned === "bottom"
              ? v.pinned
              : null) as AdminValue["pinned"],
            order: v.order,
            stale: v.stale,
            productIds: v.productIds ?? [],
            variantIds: v.variantIds ?? [],
          })),
        }))
      : [];
    const filters = mergeSyncAdditions(
      input.filters,
      dbFilters,
      opts?.baseline,
    );

    await tx.filterDefinition.deleteMany({
      where: { settingsId: settings.id },
    });

    const filterDefsWithRaw = filters.map((f, i) => {
      const id = randomUUID();
      return {
        id,
        settingsId: settings.id,
        key: String(f.key).slice(0, 120),
        type: FILTER_TYPES.includes(f.type) ? f.type : "custom",
        name: f.name == null ? null : String(f.name).slice(0, 255),
        label: clampLabel(f.label, f.key, LABEL_MAX_LENGTH),
        enabled: !!f.enabled,
        order: i,
        displayStyle: DISPLAY_STYLES.includes(
          f.displayStyle as (typeof DISPLAY_STYLES)[number],
        )
          ? f.displayStyle
          : "checkbox",
        defaultOpen: f.defaultOpen ?? null,
        collapseAfter: f.collapseAfter ?? null,
        sortValuesBy: f.sortValuesBy === "manual" ? "manual" : "alpha",
        selectionMode: f.selectionMode === "single" ? "single" : "multi",
        searchable: !!f.searchable,
        styleOptions: (f.styleOptions ?? {}) as object,
        _values: f.values,
      };
    });

    const allValues = filterDefsWithRaw.flatMap((fDef) =>
      fDef._values.map((v, j) => ({
        id: randomUUID(),
        filterId: fDef.id,
        raw: String(v.raw).slice(0, 255),
        parentRaw: v.parentRaw ? String(v.parentRaw).slice(0, 255) : null,
        label: v.label
          ? clampLabel(v.label, "", LABEL_MAX_LENGTH) || null
          : null,
        color: v.color ? String(v.color).slice(0, 64) : null,
        image: v.image ? String(v.image).slice(0, 2048) : null,
        hidden: !!v.hidden,
        pinned: v.pinned ?? null,
        order: j,
        stale: !!v.stale,
        // Custom filters only; bare numeric ids, deduped.
        productIds: [
          ...new Set((v.productIds ?? []).map((id) => bareProductId(id))),
        ],
        variantIds: cleanVariantIds(v.productIds ?? [], v.variantIds ?? []),
      })),
    );

    if (filterDefsWithRaw.length > 0) {
      await tx.filterDefinition.createMany({
        data: filterDefsWithRaw.map(({ _values, ...def }) => def),
      });
    }

    if (allValues.length > 0) {
      await tx.filterValue.createMany({
        data: allValues,
      });
    }
  });

  return republishSnapshot(shop, admin);
}

/**
 * Normalize custom-filter variant entries to bare "productId:variantId",
 * dedupe, and drop entries whose product is no longer picked.
 */
function cleanVariantIds(productIds: string[], variantIds: string[]): string[] {
  const products = new Set(productIds.map((id) => bareProductId(id)));
  const out = new Set<string>();
  for (const entry of variantIds) {
    const parsed = parseVariantEntry(entry);
    if (!parsed) continue;
    const productId = bareProductId(parsed.productId);
    if (!products.has(productId)) continue;
    out.add(`${productId}:${bareVariantId(parsed.variantId)}`);
  }
  return [...out];
}

/** Serialize the DB config and push it to the pf_config.settings metafield. */
export async function republishSnapshot(
  shop: string,
  admin: AdminClient,
): Promise<{ ok: boolean; errors: { message: string }[] }> {
  const row = await findSettings(shop);
  if (!row) return { ok: false, errors: [{ message: "No settings found" }] };

  const snapshot = serializeConfig(row);

  // Shopify rejects json metafields over 128 KB. Custom filters are the only
  // part of the snapshot that grows without bound, so fail loudly here with an
  // actionable message rather than letting the API return an opaque error and
  // silently leaving the storefront on a stale config.
  const bytes = snapshotBytes(snapshot);
  if (bytes > SNAPSHOT_BYTE_LIMIT) {
    await prisma.filterSettings.update({
      where: { shop },
      data: { snapshotStale: true },
    });
    const assigned = countCustomAssignments(snapshot);
    return {
      ok: false,
      errors: [
        {
          message:
            `Your settings are ${Math.round(bytes / 1024)} KB, over Shopify's ` +
            `${SNAPSHOT_BYTE_LIMIT / 1024} KB limit for a published config` +
            (assigned > 0
              ? `. Custom filters account for ${assigned} product assignments — remove some products or options and save again.`
              : `. Reduce the number of filter values and save again.`) +
            " Your settings are saved; only the storefront publish was skipped.",
        },
      ],
    };
  }

  // A network failure talking to Shopify ("GraphQL Client: fetch failed") must
  // not escape the route action — that renders a full-page Application Error
  // even though the DB save above already succeeded. Report it as a normal
  // error and leave the snapshot flagged stale so the merchant can republish.
  let errors: { message: string }[];
  try {
    const shopId = await withNetworkRetry(() => getShopId(admin));
    errors = shopId
      ? await writeMetafield(admin, shopId, snapshot)
      : [{ message: "Could not resolve the shop ID from Shopify" }];
  } catch (err) {
    // Auth redirects from authenticate.admin are thrown as Responses.
    if (err instanceof Response) throw err;
    errors = [
      {
        message:
          "Your settings are saved, but publishing them to the storefront " +
          "failed because Shopify could not be reached. Please save again.",
      },
    ];
  }

  await prisma.filterSettings.update({
    where: { shop },
    data:
      errors.length === 0
        ? { snapshotStale: false, metafieldSyncedAt: new Date() }
        : { snapshotStale: true },
  });
  return { ok: errors.length === 0, errors };
}

export async function deleteSettings(shop: string) {
  await prisma.filterSettings.deleteMany({ where: { shop } });
}

export async function updateDetection(
  shop: string,
  data: {
    storefrontToken?: string;
    scannedCount?: number;
    capped?: boolean;
    phKey?: string;
    phHost?: string;
    catalogSyncedAt?: Date;
  },
) {
  await prisma.filterSettings.upsert({
    where: { shop },
    create: { shop, ...data },
    update: data,
  });
}

// ── Catalog detect → merge into DB ──────────────────────────────────────────

export type DetectedCatalog = {
  types: string[];
  vendors: string[];
  tags: string[];
  options: { name: string; values: string[] }[];
  collections: { handle: string; title: string }[];
  priceMin: number;
  priceMax: number;
  scanned: number;
  capped: boolean;
};

/**
 * Merge freshly detected catalog vocabularies into the DB, preserving every
 * customization (labels, order, display styles, swatch colors, hidden flags).
 * New values are appended; values no longer in the catalog are marked stale.
 */
export async function mergeDetected(
  shop: string,
  detected: DetectedCatalog,
  opts?: {
    /** False for a capped/partial scan: unseen values are not marked stale. */
    markStale?: boolean;
    /** False for a capped scan: the price range is not narrowed. */
    updatePrice?: boolean;
  },
): Promise<void> {
  const settings = await prisma.filterSettings.upsert({
    where: { shop },
    create: { shop },
    update: {},
  });

  const existing = await prisma.filterDefinition.findMany({
    where: { settingsId: settings.id },
    include: { values: true },
    orderBy: { order: "asc" },
  });
  const byKey = new Map(existing.map((f) => [f.key, f]));
  let nextOrder = existing.length;

  type Spec = {
    key: string;
    type: string;
    name: string | null;
    label: string;
    values: string[];
    styleOptions?: Record<string, unknown>;
    displayStyle?: string;
    // Per-value seed data (collection tree: title + auto-nested parent).
    valueMeta?: Map<string, { label: string | null; parentRaw: string | null }>;
  };

  const guessSwatch = (name: string) => /colou?r/i.test(name);
  const collectionMeta = buildCollectionMeta(detected.collections);

  const specs: Spec[] = [
    {
      key: "available",
      type: "available",
      name: null,
      label: "Availability",
      values: [],
    },
    {
      key: "price",
      type: "price",
      name: null,
      label: "Price",
      values: [],
      styleOptions: {
        min: Math.floor(detected.priceMin),
        max: Math.ceil(detected.priceMax),
      },
      displayStyle: "range",
    },
    {
      key: "type",
      type: "productType",
      name: null,
      label: "Product type",
      values: detected.types,
    },
    {
      key: "vendor",
      type: "productVendor",
      name: null,
      label: "Vendor",
      values: detected.vendors,
    },
    {
      key: "tag",
      type: "tag",
      name: null,
      label: "Tag",
      values: detected.tags,
    },
    {
      key: "collection",
      type: "collection",
      name: null,
      label: "Collections",
      values: detected.collections.map((c) => c.handle),
      valueMeta: collectionMeta,
      styleOptions: { treeMode: "filter" },
    },
    ...detected.options.map((o) => ({
      key: `opt_${o.name}`,
      type: "variantOption",
      name: o.name,
      label: o.name,
      values: o.values,
      displayStyle: guessSwatch(o.name) ? "swatch" : "checkbox",
    })),
  ];

  await prisma.$transaction(async (tx) => {
    for (const spec of specs) {
      const sortedVals = [...spec.values].sort((a, b) => a.localeCompare(b));
      const prev = byKey.get(spec.key);
      if (!prev) {
        // Brand-new filter: create with defaults, appended at the end.
        await tx.filterDefinition.create({
          data: {
            settingsId: settings.id,
            key: spec.key,
            type: spec.type,
            name: spec.name,
            label: spec.label,
            order: nextOrder++,
            displayStyle: spec.displayStyle ?? "checkbox",
            styleOptions: (spec.styleOptions ?? {}) as object,
            values: {
              createMany: {
                data: sortedVals.map((raw, j) => ({
                  raw,
                  order: j,
                  label: spec.valueMeta?.get(raw)?.label ?? null,
                  parentRaw: spec.valueMeta?.get(raw)?.parentRaw ?? null,
                })),
              },
            },
          },
        });
        continue;
      }

      // Existing filter: keep all customizations; refresh price bounds only.
      if (
        spec.key === "price" &&
        spec.styleOptions &&
        opts?.updatePrice !== false
      ) {
        const prevOpts = (prev.styleOptions ?? {}) as Record<string, unknown>;
        await tx.filterDefinition.update({
          where: { id: prev.id },
          data: {
            styleOptions: { ...prevOpts, ...spec.styleOptions } as object,
          },
        });
      }

      const prevByRaw = new Map(prev.values.map((v) => [v.raw, v]));
      const detectedSet = new Set(sortedVals);
      let maxOrder = prev.values.reduce((m, v) => Math.max(m, v.order), -1);

      // Append newly detected values.
      const fresh = sortedVals.filter((raw) => !prevByRaw.has(raw));
      if (fresh.length) {
        await tx.filterValue.createMany({
          data: fresh.map((raw) => ({
            filterId: prev.id,
            raw,
            order: ++maxOrder,
            label: spec.valueMeta?.get(raw)?.label ?? null,
            parentRaw: spec.valueMeta?.get(raw)?.parentRaw ?? null,
          })),
        });
      }
      // Flag values that disappeared from the catalog (and un-flag returned ones).
      const goneIds = prev.values
        .filter(
          (v) =>
            opts?.markStale !== false && !detectedSet.has(v.raw) && !v.stale,
        )
        .map((v) => v.id);
      const backIds = prev.values
        .filter((v) => detectedSet.has(v.raw) && v.stale)
        .map((v) => v.id);
      if (goneIds.length) {
        await tx.filterValue.updateMany({
          where: { id: { in: goneIds } },
          data: { stale: true },
        });
      }
      if (backIds.length) {
        await tx.filterValue.updateMany({
          where: { id: { in: backIds } },
          data: { stale: false },
        });
      }
    }
  });
}

/**
 * Seed data for the collection tree: display label = collection title, parent
 * guessed from handle prefixes ("sneakers-high" nests under "sneakers" when
 * that handle exists — longest matching prefix wins). The merchant can
 * rearrange the tree in the admin afterwards; this only seeds new values.
 */
function buildCollectionMeta(
  collections: { handle: string; title: string }[],
): Map<string, { label: string | null; parentRaw: string | null }> {
  const handles = new Set(collections.map((c) => c.handle));
  const meta = new Map<
    string,
    { label: string | null; parentRaw: string | null }
  >();
  for (const c of collections) {
    let parent: string | null = null;
    let cut = c.handle.lastIndexOf("-");
    while (cut > 0) {
      const prefix = c.handle.slice(0, cut);
      if (handles.has(prefix)) {
        parent = prefix;
        break;
      }
      cut = c.handle.lastIndexOf("-", cut - 1);
    }
    meta.set(c.handle, { label: c.title || null, parentRaw: parent });
  }
  return meta;
}

// ── Serialization: DB → PfConfig snapshot (metafield JSON, version 3) ───────
// The storefront (Liquid + pf-filters.js) reads ONLY this. Shape stays
// backward-compatible with v2: `filters[].values` remains string[].

export type PfSnapshotFilter = {
  key: string;
  type: string;
  name?: string;
  label: string;
  enabled: boolean;
  displayStyle: string;
  defaultOpen: boolean;
  collapseAfter: number;
  selectionMode: string;
  searchable: boolean;
  min?: number;
  max?: number;
  pillFill?: string;
  pillColor?: string;
  treeMode?: string; // collection: "filter" | "navigate"
  treeAutoSelect?: boolean; // collection: parent selection cascades to children
  treeExpanded?: boolean; // collection: false = render collapsed to top level
  values?: string[];
  valuesMeta?: {
    raw: string;
    label: string;
    color?: string;
    image?: string;
    // Custom filters: bare numeric product ids this option matches.
    ids?: string[];
    // Custom filters: "productId:variantId" for products where only some
    // variants match. Products in `ids` without an entry match all variants.
    vids?: string[];
    // Collection tree only — flat DFS order so Liquid needs no recursion.
    parent?: string;
    depth?: number;
    hasChildren?: boolean;
  }[];
};

export type PfSnapshot = {
  version: 3;
  token: string;
  filters: PfSnapshotFilter[];
  scannedCount: number;
  capped: boolean;
  phKey: string;
  phHost: string;
  layout: LayoutConfig;
  behavior: BehaviorConfig;
  // Product-card design + quick-buy buttons. Read by the SSR grid snippet and
  // mirrored onto [data-aco-pf-root] for the client re-render.
  productCard: ProductCardConfig;
  // Storefront sort dropdown. Omitted entirely when disabled (or when no option
  // is enabled) so the theme block simply renders nothing.
  sort?: {
    position: SortConfig["position"];
    label: string;
    showLabel: boolean;
    options: { key: string; label: string }[]; // enabled only, merchant order
  };
  swatch: AppearanceConfig["swatch"];
  groupIcon: AppearanceConfig["groupIcon"];
  groupIconAnimate: boolean;
  cssVars: string; // precomputed inline CSS custom properties for [data-aco-pf-root]
  customCss: string;
};

/** Byte length of the published snapshot (UTF-8, which is what Shopify counts). */
export function snapshotBytes(snapshot: PfSnapshot): number {
  return Buffer.byteLength(JSON.stringify(snapshot), "utf8");
}

/** Total hand-picked product assignments across all custom filters. */
export function countCustomAssignments(snapshot: PfSnapshot): number {
  return snapshot.filters.reduce(
    (n, f) =>
      n +
      (f.valuesMeta ?? []).reduce(
        (m, v) => m + (v.ids?.length ?? 0) + (v.vids?.length ?? 0),
        0,
      ),
    0,
  );
}

export function serializeConfig(row: DbSettings): PfSnapshot {
  const layout = normalizeLayout(row.layout);
  const appearance = normalizeAppearance(row.appearance);
  const behavior = normalizeBehavior(row.behavior);
  const sort = normalizeSort(row.sort);
  const productCard = normalizeProductCard(row.productCard);

  const filters: PfSnapshotFilter[] = row.filters
    .slice()
    .sort((a, b) => a.order - b.order)
    .map((f) => {
      const base: PfSnapshotFilter = {
        key: f.key,
        type: f.type,
        label: f.label,
        enabled: f.enabled,
        displayStyle: coerceDisplayStyle(f.displayStyle),
        defaultOpen: f.defaultOpen ?? behavior.defaultOpen,
        collapseAfter: f.collapseAfter ?? behavior.collapseAfter,
        selectionMode: f.selectionMode,
        searchable: f.searchable,
      };
      if (f.name) base.name = f.name;

      if (f.type === "price") {
        const opts = (f.styleOptions ?? {}) as { min?: number; max?: number };
        base.min = opts.min ?? 0;
        base.max = opts.max ?? 0;
        return base;
      }
      if (f.type === "available") return base;

      // Pill style: selected-state appearance. "colored" fills with pillColor;
      // "transparent" (Outlined) shows a neutral bold outline only — no color.
      if (base.displayStyle === "pill") {
        const opts = (f.styleOptions ?? {}) as {
          pillFill?: string;
          pillColor?: string;
        };
        base.pillFill =
          opts.pillFill === "transparent" ? "transparent" : "colored";
        if (base.pillFill === "colored" && opts.pillColor)
          base.pillColor = opts.pillColor;
      }

      // List filters: visible values, ordered (pinned top → order → pinned bottom).
      const visible = f.values.filter((v) => !v.hidden && !v.stale);
      const rank = (v: (typeof visible)[number]) =>
        v.pinned === "top" ? 0 : v.pinned === "bottom" ? 2 : 1;
      const sorted = visible.slice().sort((a, b) => {
        const r = rank(a) - rank(b);
        if (r !== 0) return r;
        // A collection tree is a manual arrangement by definition — its stored
        // order IS the merchant's tree, so alpha sorting never applies.
        if (f.sortValuesBy === "manual" || f.type === "collection")
          return a.order - b.order;
        return (a.label ?? a.raw).localeCompare(b.label ?? b.raw);
      });

      if (f.type === "collection") {
        const opts = (f.styleOptions ?? {}) as {
          treeMode?: string;
          treeAutoSelect?: boolean;
          treeExpanded?: boolean;
        };
        base.treeMode = opts.treeMode === "navigate" ? "navigate" : "filter";
        base.treeAutoSelect = opts.treeAutoSelect === true;
        // Unset stays expanded, matching how existing trees already render.
        base.treeExpanded = opts.treeExpanded !== false;
        const tree = flattenTree(sorted, f.values);
        base.values = tree.map((n) => n.raw);
        base.valuesMeta = tree;
        return base;
      }

      base.values = sorted.map((v) => v.raw);
      base.valuesMeta = sorted.map((v) => {
        const m: NonNullable<PfSnapshotFilter["valuesMeta"]>[number] = {
          raw: v.raw,
          label: v.label ?? v.raw,
        };
        if (v.color) m.color = v.color;
        if (v.image) m.image = v.image;
        // Custom filters carry their hand-picked membership to the storefront.
        // Options with no products are still published so the merchant can see
        // (and the shopper can't select) an empty group.
        if (f.type === "custom") {
          m.ids = v.productIds ?? [];
          // Only emitted when non-empty to keep the 128 KB snapshot lean.
          if (v.variantIds?.length) m.vids = v.variantIds;
        }
        return m;
      });
      return base;
    });

  const sortOptions = sort.options.filter((o) => o.enabled);

  return {
    version: 3,
    token: row.storefrontToken ?? "",
    filters,
    ...(sort.enabled && sortOptions.length
      ? {
          sort: {
            position: sort.position,
            label: sort.label,
            showLabel: sort.showLabel,
            options: sortOptions.map((o) => ({ key: o.key, label: o.label })),
          },
        }
      : {}),
    scannedCount: row.scannedCount,
    capped: row.capped,
    phKey: row.phKey ?? "",
    phHost: row.phHost ?? "",
    layout,
    behavior,
    productCard,
    swatch: appearance.swatch,
    groupIcon: appearance.groupIcon,
    groupIconAnimate: appearance.groupIconAnimate,
    cssVars: buildCssVars(layout, appearance, productCard, behavior),
    customCss: appearance.customCss ?? "",
  };
}

/**
 * Flatten the collection tree into DFS order with depth/parent/hasChildren so
 * the Liquid snippet renders it with a single loop (no recursion needed).
 * A value whose parent is hidden/stale climbs to the nearest visible ancestor;
 * cycles and unknown parents fall back to root.
 */
function flattenTree(
  sorted: { raw: string; parentRaw: string | null; label: string | null }[],
  all: { raw: string; parentRaw: string | null }[],
): NonNullable<PfSnapshotFilter["valuesMeta"]> {
  const byRaw = new Map(sorted.map((v) => [v.raw, v]));
  const allByRaw = new Map(all.map((v) => [v.raw, v]));

  // Resolve each value's effective parent: nearest visible ancestor, climbing
  // through hidden/stale intermediates.
  const parentOf = (v: (typeof sorted)[number]): string | null => {
    let p = v.parentRaw;
    const seen = new Set<string>([v.raw]);
    while (p && !seen.has(p)) {
      if (byRaw.has(p)) return p;
      seen.add(p);
      p = allByRaw.get(p)?.parentRaw ?? null;
    }
    return null;
  };

  const children = new Map<string | null, typeof sorted>();
  for (const v of sorted) {
    const p = parentOf(v);
    if (!children.has(p)) children.set(p, []);
    children.get(p)!.push(v);
  }

  const out: NonNullable<PfSnapshotFilter["valuesMeta"]> = [];
  const walk = (parent: string | null, depth: number, trail: Set<string>) => {
    for (const v of children.get(parent) ?? []) {
      if (trail.has(v.raw)) continue; // cycle guard
      trail.add(v.raw);
      const kids = children.get(v.raw) ?? [];
      const m: (typeof out)[number] = {
        raw: v.raw,
        label: v.label ?? v.raw,
        depth,
      };
      if (parent) m.parent = parent;
      if (kids.length) m.hasChildren = true;
      out.push(m);
      walk(v.raw, Math.min(depth + 1, 5), trail);
    }
  };
  walk(null, 0, new Set());
  return out;
}

/** Build the inline `--aco-pf-*` declarations applied to [data-aco-pf-root]. */
export function buildCssVars(
  layout: LayoutConfig,
  a: AppearanceConfig,
  pc: ProductCardConfig,
  behavior: BehaviorConfig,
): string {
  const vars: Record<string, string> = {};

  // Apply button (consumed by .aco-pf-apply in pf-filters.css). Concrete
  // colours rather than --aco-pf-accent, which is often `currentColor` and
  // made the label unreadable on its own background.
  const ab = behavior.applyButton;
  vars["--aco-pf-apply-bg"] = ab.bgColor;
  vars["--aco-pf-apply-fg"] = ab.textColor;
  vars["--aco-pf-apply-radius"] = ab.corners === "edged" ? "0px" : "6px";
  // px, not rem: many themes (Dawn) set html { font-size: 62.5% }, which
  // shrinks rem-based sizes to ~60%.
  vars["--aco-pf-apply-pad"] =
    ab.size === "large"
      ? "14px 32px"
      : ab.size === "medium"
        ? "11px 24px"
        : "8px 18px";
  vars["--aco-pf-apply-font-size"] =
    ab.size === "large" ? "17px" : ab.size === "medium" ? "15px" : "14px";

  // Product-card design + quick-buy button styling. Always emitted (independent
  // of the theme-colour override) so the card design applies on any theme.
  vars["--aco-pf-card-title-size"] = `${pc.titleSize}px`;
  vars["--aco-pf-card-title-weight"] = `${pc.titleWeight}`;
  vars["--aco-pf-card-price-size"] = `${pc.priceSize}px`;
  vars["--aco-pf-card-align"] = pc.textAlign === "center" ? "center" : "left";
  vars["--aco-pf-card-ratio"] =
    pc.imageRatio === "square"
      ? "1 / 1"
      : pc.imageRatio === "portrait"
        ? "3 / 4"
        : "auto";
  vars["--aco-pf-card-fit"] = pc.imageFit === "contain" ? "contain" : "cover";
  vars["--aco-pf-card-radius"] = `${pc.cardRadius}px`;
  vars["--aco-pf-card-media-radius"] =
    `${Math.max(0, pc.cardRadius - (pc.cardBorder ? 2 : 0))}px`;
  vars["--aco-pf-card-bg"] = pc.cardBackground;
  vars["--aco-pf-card-fg"] = pc.cardTextColor;
  vars["--aco-pf-card-border"] = pc.cardBorderColor;
  vars["--aco-pf-card-shadow"] =
    pc.cardShadow === "medium"
      ? "0 6px 18px rgba(0,0,0,0.14)"
      : pc.cardShadow === "soft"
        ? "0 2px 8px rgba(0,0,0,0.08)"
        : "none";
  vars["--aco-pf-btn-bg"] = pc.buttonColor;
  vars["--aco-pf-btn-fg"] = pc.buttonTextColor;
  vars["--aco-pf-btn-radius"] = `${pc.buttonRadius}px`;
  // Sale / Out of stock image badges (consumed by .aco-pf-card__badge--sale
  // and .aco-pf-card__soldout in pf-filters.css).
  vars["--aco-pf-sale-badge-bg"] = pc.saleBadgeColor;
  vars["--aco-pf-sale-badge-fg"] = pc.saleBadgeTextColor;
  vars["--aco-pf-soldout-badge-bg"] = pc.soldOutBadgeColor;
  vars["--aco-pf-soldout-badge-fg"] = pc.soldOutBadgeTextColor;

  vars["--aco-pf-gap"] = `${(layout.gap / 10).toFixed(2)}rem`;
  vars["--aco-pf-sidebar-w"] = `${layout.sidebarWidth}px`;
  vars["--aco-pf-heading-size"] = `${layout.headingSize}px`;
  vars["--aco-pf-radius"] = `${a.radius}px`;
  vars["--aco-pf-swatch-size"] = `${a.swatch.size}px`;
  vars["--aco-pf-swatch-radius"] =
    a.swatch.shape === "circle"
      ? "999px"
      : a.swatch.shape === "rounded"
        ? "6px"
        : "0px";

  const density =
    a.density === "compact"
      ? "0.15rem"
      : a.density === "cozy"
        ? "0.28rem"
        : "0.4rem";
  vars["--aco-pf-row-gap"] = density;

  if (!a.inheritTheme) {
    const c = a.colors;
    vars["--aco-pf-accent"] = c.accent;
    vars["--aco-pf-text"] = c.text;
    vars["--aco-pf-muted"] = c.muted;
    vars["--aco-pf-border"] = c.border;
    vars["--aco-pf-bg"] = c.background;
    vars["--aco-pf-hover-bg"] = c.hoverBg;
    vars["--aco-pf-selected-bg"] = c.selectedBg;
  }

  // Active-chip styling is customised alongside the "Show active filter chips"
  // toggle, so it always applies (independent of the theme-colour override).
  vars["--aco-pf-chip-bg"] = a.colors.chipBg;
  vars["--aco-pf-chip-fg"] = a.colors.chipText;
  vars["--aco-pf-chip-radius"] =
    layout.chipStyle === "square"
      ? "0px"
      : layout.chipStyle === "rounded"
        ? "6px"
        : "999px";

  if (!a.typography.inherit) {
    vars["--aco-pf-label-size"] = `${a.typography.labelSize}px`;
    vars["--aco-pf-label-weight"] = `${a.typography.labelWeight}`;
    vars["--aco-pf-label-transform"] = a.typography.uppercase
      ? "uppercase"
      : "none";
  }

  return Object.entries(vars)
    .map(([k, v]) => `${k}:${v}`)
    .join(";");
}

// ── Legacy metafield seed (one-time migration path) ─────────────────────────

type LegacyFilter = {
  key: string;
  type: string;
  name?: string;
  label: string;
  enabled: boolean;
  min?: number;
  max?: number;
  values?: string[];
};

// Kept for the next migration step; not wired up yet.
// eslint-disable-next-line @typescript-eslint/no-unused-vars
async function seedFromMetafield(
  shop: string,
  admin: AdminClient,
): Promise<void> {
  const raw = await readMetafieldRaw(admin);
  if (!raw) return;
  let parsed: {
    token?: string;
    scannedCount?: number;
    capped?: boolean;
    phKey?: string;
    phHost?: string;
    filters?: LegacyFilter[];
  };
  try {
    parsed = JSON.parse(raw);
  } catch {
    return;
  }
  const filters = Array.isArray(parsed.filters) ? parsed.filters : [];

  try {
    await prisma.filterSettings.create({
      data: {
        shop,
        storefrontToken: parsed.token ?? null,
        scannedCount: parsed.scannedCount ?? 0,
        capped: !!parsed.capped,
        phKey: parsed.phKey ?? null,
        phHost: parsed.phHost ?? null,
        filters: {
          create: filters.map((f, i) => ({
            key: f.key,
            type: f.type,
            name: f.name ?? null,
            label: f.label ?? f.key,
            enabled: f.enabled !== false,
            order: i,
            displayStyle: f.type === "price" ? "range" : "checkbox",
            styleOptions:
              f.type === "price" ? { min: f.min ?? 0, max: f.max ?? 0 } : {},
            values: {
              createMany: {
                data: (f.values ?? []).map((value, j) => ({
                  raw: value,
                  order: j,
                })),
              },
            },
          })),
        },
      },
    });
  } catch (err: any) {
    // If another concurrent request created the record first (P2002), safely ignore
    if (err?.code !== "P2002") throw err;
  }
}

// ── Shopify Admin GraphQL helpers ────────────────────────────────────────────

// Minimal structural type for the authenticated admin client we get from
// authenticate.admin(request) — enough for the calls this module makes.
export type AdminClient = {
  graphql: (
    query: string,
    options?: { variables?: Record<string, unknown> },
  ) => Promise<Response>;
};

/**
 * Retry once after a short pause when the Admin API request never got a
 * response (transient network failure). GraphQL/user errors are not retried.
 */
async function withNetworkRetry<T>(fn: () => Promise<T>): Promise<T> {
  try {
    return await fn();
  } catch (err) {
    if (err instanceof Response || !isNetworkError(err)) throw err;
    await new Promise((resolve) => setTimeout(resolve, 500));
    return fn();
  }
}

function isNetworkError(err: unknown): boolean {
  const message = err instanceof Error ? err.message : String(err);
  return /fetch failed|no response available|ECONNRESET|ETIMEDOUT|socket hang up/i.test(
    message,
  );
}

async function getShopId(admin: AdminClient): Promise<string> {
  const res = await admin.graphql(`#graphql
    query PfShopId { shop { id } }
  `);
  const json = await res.json();
  return json.data?.shop?.id as string;
}

async function readMetafieldRaw(admin: AdminClient): Promise<string | null> {
  const res = await admin.graphql(`#graphql
    query PfConfigRead {
      shop { metafield(namespace: "pf_config", key: "settings") { value } }
    }
  `);
  const json = await res.json();
  return json.data?.shop?.metafield?.value ?? null;
}

async function writeMetafield(
  admin: AdminClient,
  shopId: string,
  snapshot: PfSnapshot,
): Promise<{ message: string }[]> {
  try {
    const res = await withNetworkRetry(() =>
      admin.graphql(
        `#graphql
      mutation SetPfConfig($metafields: [MetafieldsSetInput!]!) {
        metafieldsSet(metafields: $metafields) {
          userErrors { field message }
        }
      }`,
        {
          variables: {
            metafields: [
              {
                ownerId: shopId,
                namespace: "pf_config",
                key: "settings",
                type: "json",
                value: JSON.stringify(snapshot),
              },
            ],
          },
        },
      ),
    );
    const json = await res.json();
    return json.data?.metafieldsSet?.userErrors ?? [];
  } catch (err) {
    return [
      {
        message: err instanceof Error ? err.message : "Metafield write failed",
      },
    ];
  }
}

export async function deleteShopMetafield(admin: AdminClient): Promise<void> {
  try {
    const res = await admin.graphql(`#graphql
      query PfMetafieldId {
        shop {
          metafield(namespace: "pf_config", key: "settings") { id }
        }
      }
    `);
    const json = await res.json();
    const id = json.data?.shop?.metafield?.id;
    if (id) {
      await admin.graphql(
        `#graphql
        mutation DeletePfMetafield($input: MetafieldDeleteInput!) {
          metafieldDelete(input: $input) {
            deletedId
            userErrors { field message }
          }
        }`,
        { variables: { input: { id } } },
      );
      console.log(
        "Deleted stale pf_config shop metafield on fresh install/reinstall",
      );
    }
  } catch (err) {
    // Remix/Shopify auth redirects are Response throws — never swallow them
    // or the app continues without an access token and crashes on GraphQL.
    if (err instanceof Response) throw err;
    console.warn("Could not delete stale shop metafield:", err);
  }
}
