import { useCallback, useEffect, useRef, useState } from "react";
import type React from "react";
import type { ActionFunctionArgs, LoaderFunctionArgs } from "@remix-run/node";
import { useFetcher, useLoaderData } from "@remix-run/react";
import { useAppBridge } from "@shopify/app-bridge-react";
import { authenticate } from "../shopify.server";
import { guardAction } from "../models/adminErrors.server";
import {
  beginDetect,
  endDetect,
  scanCatalog,
} from "../models/catalogScan.server";
import posthog from "../posthog.server";
import type { AdminClient } from "../models/filterSettings.server";
import {
  getConfig,
  mergeDetected,
  republishSnapshot,
  saveConfig,
  updateDetection,
} from "../models/filterSettings.server";
import {
  createCollection,
  deleteCollection,
  findCollectionByHandle,
  publishCollection,
  setCollectionProducts,
} from "../models/collections.server";
import { sanitizeRules } from "../models/collectionRules.shared";
import {
  baselineOf,
  developerThemeFiles,
  type AdminConfig,
  type AdminFilter,
  type FilterBaseline,
} from "../models/filterConfig.shared";
import { FiltersTab } from "../components/settings/FiltersTab";
import { SortTab } from "../components/settings/SortTab";
import { LayoutTab } from "../components/settings/LayoutTab";
import { AppearanceTab } from "../components/settings/AppearanceTab";
import { BehaviorTab } from "../components/settings/BehaviorTab";
import { ProductCardTab } from "../components/settings/ProductCardTab";
import { useProductCardParentSync } from "../components/settings/productCardSync";
import { AdvancedTab } from "../components/settings/AdvancedTab";
import {
  detectNativeElements,
  getThemeInjectStatus,
  injectThemeFilters,
  listThemes,
  removeThemeFilters,
  syncThemeAssets,
} from "../models/themeInject.server";
import { ensureThemeCardMirror } from "../models/themeCardMirror.server";
import { recordShopInstall } from "../models/shop.server";

/**
 * Settings page — full filter UI/UX customization studio.
 *
 * Config lives in Postgres (source of truth, see filterSettings.server.ts) and
 * is published to the pf_config.settings shop metafield on save; the storefront
 * theme extension reads only the metafield.
 */

export const loader = async ({ request }: LoaderFunctionArgs) => {
  const { admin, session } = await authenticate.admin(request);
  // Ensure shop is recorded on initial install (runs once, skips if already exists)
  recordShopInstall(session.shop, admin).catch((err) =>
    console.warn(
      `[shop] Background install record failed for ${session.shop}:`,
      err,
    ),
  );
  const config = await getConfig(session.shop, admin as AdminClient);
  const customFiles = developerThemeFiles(config.behavior);
  const [themeInject, themeList] = await Promise.all([
    getThemeInjectStatus(admin as AdminClient, customFiles),
    listThemes(admin as AdminClient),
  ]);
  // Keep theme snippet/asset copies current when already injected (e.g. after
  // app code updates). Inject alone does not refresh those files.
  if (themeInject.ok && themeInject.injected) {
    await syncThemeAssets(admin as AdminClient, themeInject.themeId, {
      ensureThemeCards: config.productCard.cardSource === "theme",
      shopDomain: session.shop,
      customFiles,
      status: themeInject,
    }).catch((err) =>
      console.warn(
        `[theme-inject] Background asset sync failed for ${session.shop}:`,
        err,
      ),
    );
  }
  return { config, themeInject, themes: themeList.themes };
};

export const action = (args: ActionFunctionArgs) =>
  guardAction(args, () => settingsAction(args));

async function settingsAction({ request }: ActionFunctionArgs) {
  const { admin, session } = await authenticate.admin(request);
  const shop = session.shop;
  const formData = await request.formData();
  const intent = String(formData.get("intent"));

  // Public PostHog config, mirrored into the storefront snapshot on every
  // publish so the theme block always has an up-to-date key.
  const PH_KEY = process.env.POSTHOG_API_KEY ?? "";
  const PH_HOST = process.env.POSTHOG_HOST ?? "https://us.i.posthog.com";

  if (intent === "detect") {
    if (!beginDetect(shop)) {
      const config = await getConfig(shop, admin as AdminClient);
      return {
        ok: true,
        errors: [{ message: "Catalog detection is already in progress." }],
        config,
      };
    }

    try {
      const current = await getConfig(shop, admin as AdminClient);
      const token = await ensureToken(admin, current.storefrontToken);
      const detected = await scanCatalog(admin);

      await updateDetection(shop, {
        storefrontToken: token,
        scannedCount: detected.scanned,
        capped: detected.capped,
        catalogSyncedAt: new Date(),
        phKey: PH_KEY,
        phHost: PH_HOST,
      });
      await mergeDetected(shop, detected);
      const { ok, errors } = await republishSnapshot(
        shop,
        admin as AdminClient,
      );

      posthog.capture({
        distinctId: shop,
        event: ok ? "filter_config_detected" : "filter_config_detect_failed",
        properties: {
          shop,
          products_scanned: detected.scanned,
          capped: detected.capped,
          error_count: errors.length,
          $process_person_profile: false,
        },
      });

      const config = await getConfig(shop, admin as AdminClient);
      return { ok, errors, config };
    } finally {
      endDetect(shop);
    }
  }

  if (intent === "save") {
    let parsed: {
      layout: AdminConfig["layout"];
      appearance: AdminConfig["appearance"];
      behavior: AdminConfig["behavior"];
      sort: AdminConfig["sort"];
      productCard: AdminConfig["productCard"];
      filters: AdminFilter[];
    };
    try {
      parsed = JSON.parse(String(formData.get("config")));
    } catch {
      return {
        ok: false,
        errors: [{ message: "Invalid settings payload" }],
        config: null,
      };
    }

    // Product card is saved via the customizer route. When the client marks it
    // as synced, preserve the DB copy so a stale in-memory snapshot cannot revert
    // product card settings while saving other tabs.
    const productCardSynced = formData.get("productCardSynced") === "1";
    const current = await getConfig(shop, admin as AdminClient);
    const toSave = productCardSynced
      ? {
          ...parsed,
          productCard: current.productCard,
        }
      : parsed;

    let baseline: FilterBaseline | null = null;
    try {
      const rawBaseline = formData.get("baseline");
      if (rawBaseline) baseline = JSON.parse(String(rawBaseline));
    } catch {
      baseline = null; // old client: wholesale replace, as before
    }
    const { ok, errors } = await saveConfig(
      shop,
      admin as AdminClient,
      toSave,
      {
        baseline,
      },
    );

    // Keep injected theme CSS/JS/Liquid in sync with the app (card layouts, etc.).
    const themeSyncErrors: { message: string }[] = [];
    if (ok) {
      const { syncThemeAssets } = await import("../models/themeInject.server");
      try {
        const sync = await syncThemeAssets(admin as AdminClient, undefined, {
          ensureThemeCards: toSave.productCard?.cardSource === "theme",
          shopDomain: shop,
          customFiles: developerThemeFiles(toSave.behavior),
        });
        if (sync.themeCardErrors?.length) {
          themeSyncErrors.push(...sync.themeCardErrors);
        }
        if (!sync.ok) themeSyncErrors.push(...sync.errors);
      } catch (err) {
        // Auth redirects are thrown as Responses; network failures must not
        // turn a successful save into a full-page Application Error.
        if (err instanceof Response) throw err;
        themeSyncErrors.push({
          message:
            "Your settings are saved, but syncing theme files failed because " +
            "Shopify could not be reached. Please save again.",
        });
      }
    }

    posthog.capture({
      distinctId: shop,
      event: ok ? "filter_config_saved" : "filter_config_save_failed",
      properties: {
        shop,
        filters_enabled: parsed.filters.filter((f) => f.enabled).length,
        filters_total: parsed.filters.length,
        layout_structure: parsed.layout?.structure,
        sort_enabled: !!parsed.sort?.enabled,
        error_count: errors.length + themeSyncErrors.length,
        $process_person_profile: false,
      },
    });

    const config = await getConfig(shop, admin as AdminClient);
    return { ok, errors: [...errors, ...themeSyncErrors], config };
  }

  if (intent === "republish") {
    const { ok, errors } = await republishSnapshot(shop, admin as AdminClient);
    const config = await getConfig(shop, admin as AdminClient);
    return { ok, errors, config };
  }

  // ── Collection-tree authoring ────────────────────────────────────────────
  // These write to Shopify (not to our config) and deliberately return
  // `config: null`: the settings page has unsaved edits in memory, and the tree
  // node for a new collection is appended client-side, then persisted by Save.

  if (intent === "collection:load") {
    const handle = String(formData.get("handle") ?? "");
    const collection = await findCollectionByHandle(
      admin as AdminClient,
      handle,
    );
    return {
      ok: !!collection,
      errors: collection
        ? []
        : [{ message: `No collection "${handle}" in Shopify` }],
      collection,
      config: null,
    };
  }

  if (intent === "collection:create") {
    const title = String(formData.get("title") ?? "");
    const rules = sanitizeRules(parseJson(formData.get("rules")));
    const result = await createCollection(admin as AdminClient, {
      title,
      productIds: parseIdList(formData.get("productIds")),
      rules,
      matchAny: formData.get("matchAny") === "1",
    });

    posthog.capture({
      distinctId: shop,
      event: result.ok ? "collection_created" : "collection_create_failed",
      properties: {
        shop,
        product_count: parseIdList(formData.get("productIds")).length,
        rule_count: rules.length,
        automated: rules.length > 0,
        error_count: result.errors.length,
        $process_person_profile: false,
      },
    });

    return { ...result, config: null };
  }

  if (intent === "collection:setProducts") {
    const handle = String(formData.get("handle") ?? "");
    const result = await setCollectionProducts(
      admin as AdminClient,
      handle,
      parseIdList(formData.get("productIds")),
    );
    return { ...result, config: null };
  }

  if (intent === "collection:publish") {
    const handle = String(formData.get("handle") ?? "");
    const result = await publishCollection(admin as AdminClient, handle);
    return { ...result, config: null };
  }

  if (intent === "collection:delete") {
    const handle = String(formData.get("handle") ?? "");
    const result = await deleteCollection(admin as AdminClient, handle);

    posthog.capture({
      distinctId: shop,
      event: result.ok ? "collection_deleted" : "collection_delete_failed",
      properties: {
        shop,
        error_count: result.errors.length,
        $process_person_profile: false,
      },
    });

    return { ...result, config: null };
  }

  const themeActions = {
    "inject-theme-collection": { operation: "inject", target: "collection" },
    "remove-theme-collection": { operation: "remove", target: "collection" },
    "inject-theme-search": { operation: "inject", target: "search" },
    "remove-theme-search": { operation: "remove", target: "search" },
  } as const;
  const themeAction = themeActions[intent as keyof typeof themeActions];

  // Theme injection targets the theme picked in the UI; empty = published theme.
  const rawThemeId = formData.get("themeId");
  const themeId =
    typeof rawThemeId === "string" && rawThemeId ? rawThemeId : undefined;
  const themeRole = String(formData.get("themeRole") || "");

  if (intent === "theme-detect-elements") {
    const config = await getConfig(shop, admin as AdminClient);
    const res = await detectNativeElements(
      admin as AdminClient,
      developerThemeFiles(config.behavior),
      themeId,
    );
    return {
      ok: res.ok,
      errors: res.errors,
      warnings: [],
      config: null,
      candidates: res.candidates,
      action: intent,
    };
  }

  if (intent === "theme-status") {
    const config = await getConfig(shop, admin as AdminClient);
    const customFiles = developerThemeFiles(config.behavior);
    const themeInject = await getThemeInjectStatus(
      admin as AdminClient,
      customFiles,
      themeId,
    );
    return {
      ok: themeInject.ok,
      errors: themeInject.errors,
      warnings: themeInject.warnings || [],
      config: null,
      themeInject,
      action: intent,
    };
  }

  if (themeAction) {
    const config = await getConfig(shop, admin as AdminClient);
    const formCustomCollection = formData.get("customCollectionFile");
    const formCustomSearch = formData.get("customSearchFile");
    const customFiles =
      formCustomCollection != null || formCustomSearch != null
        ? {
            ...developerThemeFiles(config.behavior),
            collectionFile: String(formCustomCollection || ""),
            searchFile: String(formCustomSearch || ""),
          }
        : developerThemeFiles(config.behavior);

    const operationResult =
      themeAction.operation === "inject"
        ? await injectThemeFilters(
            admin as AdminClient,
            customFiles,
            themeAction.target,
            themeId,
          )
        : await removeThemeFilters(admin as AdminClient, customFiles, {
            target: themeAction.target,
            themeId,
          });
    // Theme product cards need the mirror files in the freshly injected theme.
    // The mirror status is shop-wide, so only the published theme gets one.
    if (
      themeAction.operation === "inject" &&
      operationResult.ok &&
      config.productCard.cardSource === "theme" &&
      (!themeId || themeRole === "MAIN")
    ) {
      await ensureThemeCardMirror(admin as AdminClient, shop, {
        customFiles,
        force: true,
      }).catch((err) => {
        if (err instanceof Response) throw err;
        console.warn(
          `[theme-cards] mirror after inject failed for ${shop}:`,
          err,
        );
      });
    }
    // Targeted operations intentionally ignore an invalid override for the
    // other page. Refresh the complete status afterward so both controls stay
    // accurate, including custom section paths.
    const themeInject = operationResult.ok
      ? await getThemeInjectStatus(admin as AdminClient, customFiles, themeId)
      : operationResult;

    return {
      ok: operationResult.ok,
      errors: operationResult.errors,
      warnings: [
        ...(("warnings" in operationResult && operationResult.warnings) || []),
        ...(("warnings" in themeInject && themeInject.warnings) || []),
      ],
      config,
      themeInject,
      action: intent,
    };
  }

  return { ok: false, errors: [{ message: "Unknown action" }], config: null };
}
/** Product ids arrive as a JSON array in the form body; anything else = none. */
function parseIdList(raw: FormDataEntryValue | null): string[] {
  const parsed = parseJson(raw);
  return Array.isArray(parsed) ? parsed.map(String) : [];
}

/** Structured form fields travel as JSON; a malformed one is treated as absent. */
function parseJson(raw: FormDataEntryValue | null): unknown {
  try {
    return JSON.parse(String(raw ?? "null"));
  } catch {
    return null;
  }
}

// ── Storefront token helpers (unchanged behavior) ────────────────────────────

async function ensureToken(admin: any, existing: string): Promise<string> {
  if (existing) {
    const valid = await validateStorefrontToken(admin, existing);
    if (valid) return existing;
  }

  try {
    const listRes = await admin.graphql(`#graphql
      query SfTokens {
        shop {
          storefrontAccessTokens(first: 20) {
            nodes { id title accessToken }
          }
        }
      }
    `);
    const listJson = await listRes.json();
    const tokens = listJson.data?.shop?.storefrontAccessTokens?.nodes ?? [];
    for (const t of tokens) {
      if (t.title === "Product Filter & Search (public)") {
        await admin.graphql(
          `#graphql
          mutation DeleteSfToken($id: ID!) {
            storefrontAccessTokenDelete(input: { id: $id }) {
              deletedStorefrontAccessTokenId
            }
          }`,
          { variables: { id: t.id } },
        );
      }
    }
  } catch {
    /* best-effort cleanup */
  }

  const res = await admin.graphql(
    `#graphql
    mutation CreateSfToken($input: StorefrontAccessTokenInput!) {
      storefrontAccessTokenCreate(input: $input) {
        storefrontAccessToken { accessToken }
        userErrors { field message }
      }
    }`,
    { variables: { input: { title: "Product Filter & Search (public)" } } },
  );
  const json = await res.json();
  return (
    json.data?.storefrontAccessTokenCreate?.storefrontAccessToken
      ?.accessToken ?? ""
  );
}

async function validateStorefrontToken(
  admin: any,
  token: string,
): Promise<boolean> {
  try {
    const shopRes = await admin.graphql(`#graphql
      query ShopDomain { shop { myshopifyDomain } }
    `);
    const shopJson = await shopRes.json();
    const domain = shopJson.data?.shop?.myshopifyDomain;
    if (!domain) return false;

    const testRes = await fetch(`https://${domain}/api/2026-07/graphql.json`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-Shopify-Storefront-Access-Token": token,
      },
      body: JSON.stringify({ query: "{ shop { name } }" }),
    });
    return testRes.ok;
  } catch {
    return false;
  }
}

// ── UI ───────────────────────────────────────────────────────────────────────

const TAB_IDS = [
  "filters",
  "sort",
  "layout",
  "appearance",
  "productCard",
  "behavior",
  "advanced",
] as const;

type NavItem = {
  id: (typeof TAB_IDS)[number];
  label: string;
  description: string;
  icon: NonNullable<React.ComponentProps<"s-icon">["type"]>;
};

/** Left nav entries — order matches TAB_IDS so `tab` indexes both. */
const SETTINGS_NAV: NavItem[] = [
  {
    id: "filters",
    label: "Filters",
    description: "Which filters appear, in what order, and how each one looks.",
    icon: "filter",
  },
  {
    id: "sort",
    label: "Sort",
    description: "The sort dropdown shoppers use to reorder results.",
    icon: "sort",
  },
  {
    id: "layout",
    label: "Layout",
    description: "Filter placement, product grid and panel chrome.",
    icon: "layout-columns-3",
  },
  {
    id: "appearance",
    label: "Appearance",
    description: "Colors, shape, swatches and typography of the filter UI.",
    icon: "color",
  },
  {
    id: "productCard",
    label: "Product card",
    description: "Design the card shown for each filtered product.",
    icon: "product",
  },
  {
    id: "behavior",
    label: "Behavior",
    description: "How groups open, how values show, and how filters apply.",
    icon: "cursor",
  },
  {
    id: "advanced",
    label: "Advanced",
    description: "Catalog detection, republish, backup and developer options.",
    icon: "wrench",
  },
];

/**
 * Settings page columns (by container width): nav | content | injection + setup.
 *  - wide (>= 1200px): three columns, as designed
 *  - tablet (760-1199px): nav + content; the right-hand cards drop below
 *  - phone (< 760px): one column; the nav buttons flow across the top
 */
const SETTINGS_LAYOUT_CSS = `
/* Queried as a container so the grid breaks at exactly the same width as the
   nav's @container (inline-size <= 759px) switch (the viewport is wider by
   the page padding, so @media drifted out of step). */
.pf-settings-shell { container-type: inline-size; }
.pf-settings-layout {
  display: grid;
  gap: var(--p-space-400, 16px);
  align-items: start;
  justify-content: center;
  grid-template-columns: 200px minmax(0, 860px) 320px;
}
.pf-settings-layout > * { min-width: 0; }
@container (max-width: 1199px) {
  .pf-settings-layout { grid-template-columns: 200px minmax(0, 1fr); }
  .pf-settings-layout > :nth-child(3) { grid-column: 1 / -1; }
}
@container (max-width: 759px) {
  .pf-settings-layout { grid-template-columns: minmax(0, 1fr); }
  .pf-settings-layout > :nth-child(3) { grid-column: auto; }
}
`;

export default function SettingsPage() {
  const {
    config: initialConfig,
    themeInject: initialThemeInject,
    themes,
  } = useLoaderData<typeof loader>();
  const fetcher = useFetcher<typeof action>();
  const shopify = useAppBridge();

  const [config, setConfig] = useState<AdminConfig>(initialConfig);
  const configRef = useRef(config);
  configRef.current = config;
  // What the filters looked like when this page (or the last save) loaded;
  // lets the server keep catalog-sync additions made in the meantime.
  const baselineRef = useRef(baselineOf(initialConfig.filters));
  /** True when product card + its custom CSS match what's in the DB (customizer saved). */
  const [productCardSynced, setProductCardSynced] = useState(true);
  const productCardSyncedRef = useRef(true);
  productCardSyncedRef.current = productCardSynced;
  const [themeInject, setThemeInject] = useState(initialThemeInject);
  // Theme the inject/remove buttons act on. Defaults to the published theme.
  const [selectedThemeId, setSelectedThemeId] = useState(
    initialThemeInject.themeId ||
      themes.find((t) => t.role === "MAIN")?.id ||
      themes[0]?.id ||
      "",
  );
  const selectedTheme = themes.find((t) => t.id === selectedThemeId);
  const selectedThemeRole = selectedTheme?.role || "";
  const themeOptions = themes.map((t) => ({
    value: t.id,
    label: t.role === "MAIN" ? `${t.name} (Live)` : t.name,
  }));
  const selectTheme = (id: string) => {
    setSelectedThemeId(id);
    fetcher.submit({ intent: "theme-status", themeId: id }, { method: "POST" });
  };
  const [showThemeInjectionBanner, setShowThemeInjectionBanner] =
    useState(true);
  const [dirty, setDirty] = useState(false);
  const dirtyRef = useRef(false);
  dirtyRef.current = dirty;
  const [tab, setTab] = useState(0);

  const SAVE_BAR_ID = "settings-save-bar";

  // Show/hide the App Bridge save bar whenever dirty changes.
  useEffect(() => {
    if (dirty) {
      shopify.saveBar.show(SAVE_BAR_ID);
    } else {
      shopify.saveBar.hide(SAVE_BAR_ID);
    }
  }, [dirty, shopify]);

  // Adopt the fresh config after a detect/save/republish round-trip.
  const returned = fetcher.data?.config;
  useEffect(() => {
    if (returned) {
      setConfig(returned);
      baselineRef.current = baselineOf(returned.filters);
      setDirty(false);
      setProductCardSynced(true);
    }
  }, [returned]);

  useEffect(() => {
    const next =
      fetcher.data && "themeInject" in fetcher.data
        ? fetcher.data.themeInject
        : null;
    if (next) setThemeInject(next);
  }, [fetcher.data]);

  // Track last shown action result so re-renders or AppBridge re-inits don't re-trigger toasts.
  const lastShownDataRef = useRef<typeof fetcher.data | null>(null);

  useEffect(() => {
    if (!fetcher.data || fetcher.data === lastShownDataRef.current) return;
    lastShownDataRef.current = fetcher.data;

    const act = "action" in fetcher.data ? fetcher.data.action : "";
    if (act === "theme-status") {
      if (!fetcher.data.ok) {
        shopify.toast.show(
          fetcher.data.errors?.[0]?.message || "Could not read that theme",
          { isError: true },
        );
      }
      return;
    }
    if (act.startsWith("inject-theme-")) {
      const page = act.endsWith("-collection") ? "collection" : "search";
      shopify.toast.show(
        fetcher.data.ok
          ? `Injected filters into the ${page} page`
          : `Could not inject filters into the ${page} page`,
        { isError: !fetcher.data.ok },
      );
      // e.g. the developer "insert before" marker was not in the file.
      const warning =
        "warnings" in fetcher.data
          ? fetcher.data.warnings?.[0]?.message
          : undefined;
      if (fetcher.data.ok && warning) {
        shopify.toast.show(warning, { isError: true, duration: 8000 });
      }
      return;
    }
    if (act.startsWith("remove-theme-")) {
      const page = act.endsWith("-collection") ? "collection" : "search";
      shopify.toast.show(
        fetcher.data.ok
          ? `Removed filters from the ${page} page`
          : `Could not remove filters from the ${page} page`,
        { isError: !fetcher.data.ok },
      );
      return;
    }
    if (act === "theme-detect-elements") {
      if (!fetcher.data.ok) {
        shopify.toast.show(
          fetcher.data.errors?.[0]?.message || "Could not read the theme",
          { isError: true },
        );
      }
      return;
    }
    if (fetcher.data.ok) {
      shopify.toast.show("Saved and published to storefront");
    } else if (!fetcher.data.ok) {
      shopify.toast.show(
        fetcher.data.errors?.[0]?.message || "Something went wrong",
        { isError: true },
      );
    }
  }, [fetcher.data, shopify]);

  const isBusy = fetcher.state !== "idle";
  const intent = fetcher.formData?.get("intent");
  const detecting = isBusy && intent === "detect";
  const saving = isBusy && intent === "save";
  const republishing = isBusy && intent === "republish";
  const loadingThemeStatus = isBusy && intent === "theme-status";
  const detectingElements = isBusy && intent === "theme-detect-elements";
  const detectedElements =
    fetcher.data &&
    "candidates" in fetcher.data &&
    fetcher.data.action === "theme-detect-elements"
      ? fetcher.data.candidates
      : null;
  const changingCollectionTheme =
    isBusy &&
    (intent === "inject-theme-collection" ||
      intent === "remove-theme-collection");
  const changingSearchTheme =
    isBusy &&
    (intent === "inject-theme-search" || intent === "remove-theme-search");
  const actionFailed = fetcher.data && fetcher.data.ok === false;
  const errors =
    actionFailed && fetcher.data && "errors" in fetcher.data
      ? (fetcher.data.errors ?? [])
      : [];

  const patch = useCallback((p: Partial<AdminConfig>) => {
    setConfig((prev) => ({ ...prev, ...p }));
    setDirty(true);
  }, []);

  // Keep product-card customizer in sync while any settings tab is active.
  const handleProductCardChange = useCallback(
    (productCard: AdminConfig["productCard"]) => {
      setProductCardSynced(false);
      setConfig((prev) => ({ ...prev, productCard }));
    },
    [],
  );

  const handleProductCardCssChange = useCallback((customCss: string) => {
    setProductCardSynced(false);
    setConfig((prev) => ({
      ...prev,
      appearance: { ...prev.appearance, customCss },
    }));
  }, []);

  // Last persisted product card. The customizer's unsaved edits live in
  // `config` (flagged by productCardSynced=false); discarding them resets
  // `config` to this, so a later Save on another tab can't persist them.
  const [productCardSaved, setProductCardSaved] = useState(() => ({
    productCard: initialConfig.productCard,
    customCss: initialConfig.appearance.customCss,
  }));
  useEffect(() => {
    if (returned) {
      setProductCardSaved({
        productCard: returned.productCard,
        customCss: returned.appearance.customCss,
      });
    }
  }, [returned]);

  const discardProductCard = useCallback(() => {
    setConfig((prev) => ({
      ...prev,
      productCard: productCardSaved.productCard,
      appearance: { ...prev.appearance, customCss: productCardSaved.customCss },
    }));
    setProductCardSynced(true);
  }, [productCardSaved]);

  const handleProductCardSaved = useCallback(
    (payload: {
      productCard: AdminConfig["productCard"];
      customCss: string;
    }) => {
      setProductCardSaved(payload);
      setProductCardSynced(true);
      setConfig((prev) => ({
        ...prev,
        productCard: payload.productCard,
        appearance: { ...prev.appearance, customCss: payload.customCss },
      }));
      // Don't clear dirty — other tabs may still have unsaved edits.
    },
    [],
  );

  useProductCardParentSync({
    productCard: config.productCard,
    customCss: config.appearance.customCss,
    onProductCardChange: handleProductCardChange,
    onCustomCssChange: handleProductCardCssChange,
    onSaved: handleProductCardSaved,
  });

  const save = useCallback(() => {
    const c = configRef.current;
    const fd = new FormData();
    fd.set("intent", "save");
    fd.set("productCardSynced", productCardSyncedRef.current ? "1" : "0");
    fd.set("baseline", JSON.stringify(baselineRef.current));
    fd.set(
      "config",
      JSON.stringify({
        layout: c.layout,
        appearance: c.appearance,
        behavior: c.behavior,
        sort: c.sort,
        productCard: c.productCard,
        filters: c.filters,
      }),
    );
    fetcher.submit(fd, { method: "POST" });
  }, [fetcher]);

  const discard = useCallback(() => {
    setConfig(returned ?? initialConfig);
    setDirty(false);
  }, [returned, initialConfig]);

  const detectElements = useCallback(() => {
    fetcher.submit(
      { intent: "theme-detect-elements", themeId: selectedThemeId },
      { method: "POST" },
    );
  }, [fetcher, selectedThemeId]);

  const detect = useCallback(() => {
    fetcher.submit({ intent: "detect" }, { method: "POST" });
  }, [fetcher]);

  const republish = useCallback(() => {
    fetcher.submit({ intent: "republish" }, { method: "POST" });
  }, [fetcher]);

  const hasFilters = config.filters.length > 0;
  const themeInjectionMissing =
    !themeInject.collectionInjected && !themeInject.searchInjected;

  return (
    <s-page heading="Settings" inlineSize="large">
      <ui-save-bar id={SAVE_BAR_ID}>
        <button variant="primary" onClick={save} disabled={saving || undefined}>
          Save
        </button>
        <button onClick={discard} disabled={isBusy || undefined}>
          Discard
        </button>
      </ui-save-bar>

      <style>{SETTINGS_LAYOUT_CSS}</style>
      <s-query-container>
        <div className="pf-settings-shell">
          <div className="pf-settings-layout">
            <s-section padding="base">
              <s-stack
                gap="small-200"
                accessibilityRole="navigation"
                direction="@container (inline-size <= 759px) inline, block"
              >
                <s-box
                  paddingInline="small"
                  paddingBlockEnd="small-200"
                  display="@container (inline-size <= 759px) none, auto"
                >
                  <s-text color="subdued" type="strong">
                    Sections
                  </s-text>
                </s-box>
                {SETTINGS_NAV.map((item, i) => (
                  <s-button
                    key={item.id}
                    variant={tab === i ? "primary" : "tertiary"}
                    icon={item.icon}
                    onClick={() => setTab(i)}
                    {...(tab === i
                      ? { accessibilityLabel: `${item.label} (current)` }
                      : {})}
                  >
                    {item.label}
                  </s-button>
                ))}
              </s-stack>
            </s-section>

            <s-stack gap="base">
              {errors.length > 0 && (
                <s-banner heading="Something went wrong" tone="critical">
                  <s-unordered-list>
                    {errors.map((e: { message: string }, i: number) => (
                      <s-list-item key={i}>{e.message}</s-list-item>
                    ))}
                  </s-unordered-list>
                </s-banner>
              )}
              {config.snapshotStale && !isBusy && (
                <s-banner
                  heading="Storefront may be out of date"
                  tone="warning"
                >
                  <s-stack gap="small">
                    <s-paragraph>
                      The last publish to the storefront didn&apos;t complete.
                      Your settings are safe — republish to update the
                      storefront.
                    </s-paragraph>
                    <s-box>
                      <s-button onClick={republish}>Republish</s-button>
                    </s-box>
                  </s-stack>
                </s-banner>
              )}
              {themeInjectionMissing && showThemeInjectionBanner && (
                <s-banner
                  heading="Filters are not injected into your storefront"
                  tone="warning"
                  dismissible
                  onDismiss={() => setShowThemeInjectionBanner(false)}
                >
                  <s-paragraph>
                    Inject filters into the collection or search page to make
                    them available on your storefront.
                  </s-paragraph>
                </s-banner>
              )}
              {!hasFilters && (
                <s-banner heading="Start by detecting your catalog" tone="info">
                  <s-paragraph>
                    Go to the <s-text type="strong">Advanced</s-text> tab and
                    click <s-text type="strong">Detect filter values</s-text> to
                    build your filters from your products.
                  </s-paragraph>
                </s-banner>
              )}

              <s-section padding="none">
                <s-box padding="base">
                  <s-grid
                    gridTemplateColumns="auto 1fr"
                    gap="base"
                    alignItems="center"
                  >
                    <s-box
                      padding="small"
                      background="strong"
                      borderRadius="base"
                    >
                      <s-icon type={SETTINGS_NAV[tab].icon} />
                    </s-box>
                    <s-stack gap="small-300">
                      <s-heading>{SETTINGS_NAV[tab].label}</s-heading>
                      <s-paragraph color="subdued">
                        {SETTINGS_NAV[tab].description}
                      </s-paragraph>
                    </s-stack>
                  </s-grid>
                </s-box>
                <s-divider />
                <s-box padding="base" background="subdued">
                  <s-stack gap="base">
                    {TAB_IDS[tab] === "filters" && (
                      <FiltersTab
                        filters={config.filters}
                        behavior={config.behavior}
                        snapshotBytes={config.snapshotBytes}
                        onChange={(filters) => patch({ filters })}
                      />
                    )}
                    {TAB_IDS[tab] === "sort" && (
                      <SortTab
                        sort={config.sort}
                        onChange={(sort) => patch({ sort })}
                      />
                    )}
                    {TAB_IDS[tab] === "layout" && (
                      <LayoutTab
                        layout={config.layout}
                        onChange={(layout) => patch({ layout })}
                        chipColors={{
                          bg: config.appearance.colors.chipBg,
                          text: config.appearance.colors.chipText,
                        }}
                        onChipColorsChange={(c) =>
                          patch({
                            appearance: {
                              ...config.appearance,
                              colors: {
                                ...config.appearance.colors,
                                chipBg: c.bg,
                                chipText: c.text,
                              },
                            },
                          })
                        }
                      />
                    )}
                    {TAB_IDS[tab] === "appearance" && (
                      <AppearanceTab
                        appearance={config.appearance}
                        onChange={(appearance) => patch({ appearance })}
                      />
                    )}
                    {TAB_IDS[tab] === "productCard" && (
                      <ProductCardTab
                        productCard={config.productCard}
                        customCss={config.appearance.customCss}
                        productCardDraft={!productCardSynced}
                        savedProductCard={productCardSaved.productCard}
                        savedCustomCss={productCardSaved.customCss}
                        onDiscard={discardProductCard}
                      />
                    )}
                    {TAB_IDS[tab] === "behavior" && (
                      <BehaviorTab
                        behavior={config.behavior}
                        onChange={(behavior) => patch({ behavior })}
                      />
                    )}
                    {TAB_IDS[tab] === "advanced" && (
                      <AdvancedTab
                        config={config}
                        detecting={detecting}
                        republishing={republishing}
                        detectingElements={detectingElements}
                        detectedElements={detectedElements}
                        onDetect={detect}
                        onDetectElements={detectElements}
                        onRepublish={republish}
                        onChange={patch}
                      />
                    )}
                  </s-stack>
                </s-box>
              </s-section>
            </s-stack>

            <s-stack gap="base">
              <s-section heading="Theme injection">
                <s-stack gap="base">
                  {loadingThemeStatus ? (
                    <s-box>
                      <s-badge>Checking…</s-badge>
                    </s-box>
                  ) : themeInject.themeName ? (
                    <s-box>
                      <s-badge>{`Theme: ${themeInject.themeName}`}</s-badge>
                    </s-box>
                  ) : null}
                  <s-paragraph color="subdued">
                    Install filter Liquid independently on the selected
                    theme&apos;s collection and search product-grid sections.
                  </s-paragraph>
                  {themeOptions.length > 0 ? (
                    <s-select
                      label="Theme"
                      value={selectedThemeId}
                      details="Up to 20 themes are listed. The live theme is marked."
                      {...(isBusy ? { disabled: true } : {})}
                      onInput={(event) =>
                        selectTheme(
                          (event.currentTarget as unknown as HTMLSelectElement)
                            .value,
                        )
                      }
                    >
                      {themeOptions.map((o) => (
                        <s-option key={o.value} value={o.value}>
                          {o.label}
                        </s-option>
                      ))}
                    </s-select>
                  ) : null}
                  {themeInject.errors.length > 0 ? (
                    <s-paragraph tone="critical">
                      {themeInject.errors.map((e) => e.message).join(" ")}
                    </s-paragraph>
                  ) : null}
                  {themeInject.injected ? (
                    <s-banner tone="warning">
                      <s-paragraph>
                        <s-text type="strong">Note:</s-text> Before{" "}
                        <s-text type="strong">uninstalling</s-text> the app,
                        please remove filters from every page marked as{" "}
                        <s-text type="strong">injected</s-text> to avoid bugs.
                      </s-paragraph>
                    </s-banner>
                  ) : null}

                  <s-box
                    padding="base"
                    background="subdued"
                    border="base"
                    borderRadius="base"
                  >
                    <s-stack gap="small">
                      <s-grid
                        gridTemplateColumns="1fr auto"
                        alignItems="center"
                      >
                        <s-text type="strong">Collection page</s-text>
                        <s-badge
                          tone={
                            themeInject.collectionInjected
                              ? "success"
                              : "neutral"
                          }
                        >
                          {themeInject.collectionInjected
                            ? "Injected"
                            : "Not injected"}
                        </s-badge>
                      </s-grid>
                      <s-box>
                        <s-button
                          onClick={() =>
                            fetcher.submit(
                              {
                                intent: themeInject.collectionInjected
                                  ? "remove-theme-collection"
                                  : "inject-theme-collection",
                                themeId: selectedThemeId,
                                themeRole: selectedThemeRole,
                                customCollectionFile: config.behavior.developer
                                  ?.enabled
                                  ? config.behavior.developer.collectionFile
                                  : "",
                                customSearchFile: config.behavior.developer
                                  ?.enabled
                                  ? config.behavior.developer.searchFile
                                  : "",
                              },
                              { method: "POST" },
                            )
                          }
                          {...(changingCollectionTheme
                            ? { loading: true }
                            : {})}
                          {...(isBusy || !themeInject.ok
                            ? { disabled: true }
                            : {})}
                          tone={
                            themeInject.collectionInjected ? "critical" : "auto"
                          }
                        >
                          {themeInject.collectionInjected
                            ? "Remove from collection page"
                            : "Inject into collection page"}
                        </s-button>
                      </s-box>
                    </s-stack>
                  </s-box>

                  <s-box
                    padding="base"
                    background="subdued"
                    border="base"
                    borderRadius="base"
                  >
                    <s-stack gap="small">
                      <s-grid
                        gridTemplateColumns="1fr auto"
                        alignItems="center"
                      >
                        <s-text type="strong">Search page</s-text>
                        <s-badge
                          tone={
                            themeInject.searchInjected ? "success" : "neutral"
                          }
                        >
                          {themeInject.searchInjected
                            ? "Injected"
                            : "Not injected"}
                        </s-badge>
                      </s-grid>
                      <s-box>
                        <s-button
                          onClick={() =>
                            fetcher.submit(
                              {
                                intent: themeInject.searchInjected
                                  ? "remove-theme-search"
                                  : "inject-theme-search",
                                themeId: selectedThemeId,
                                themeRole: selectedThemeRole,
                                customCollectionFile: config.behavior.developer
                                  ?.enabled
                                  ? config.behavior.developer.collectionFile
                                  : "",
                                customSearchFile: config.behavior.developer
                                  ?.enabled
                                  ? config.behavior.developer.searchFile
                                  : "",
                              },
                              { method: "POST" },
                            )
                          }
                          {...(changingSearchTheme ? { loading: true } : {})}
                          {...(isBusy || !themeInject.ok
                            ? { disabled: true }
                            : {})}
                          tone={
                            themeInject.searchInjected ? "critical" : "auto"
                          }
                        >
                          {themeInject.searchInjected
                            ? "Remove from search page"
                            : "Inject into search page"}
                        </s-button>
                      </s-box>
                    </s-stack>
                  </s-box>
                </s-stack>
              </s-section>
            </s-stack>
          </div>
        </div>
      </s-query-container>
    </s-page>
  );
}
