import type { ActionFunctionArgs, LoaderFunctionArgs } from "@remix-run/node";
import { useLoaderData } from "@remix-run/react";
import previewStyles from "../styles/product-card-preview.css?url";
import { authenticate } from "../shopify.server";
import { guardAction } from "../models/adminErrors.server";
import posthog from "../posthog.server";
import type { AdminClient } from "../models/filterSettings.server";
import { getConfig, saveConfig } from "../models/filterSettings.server";
import type { ProductCardConfig } from "../models/filterConfig.shared";
import { baselineOf, developerThemeFiles } from "../models/filterConfig.shared";
import { ProductCardCustomizer } from "../components/settings/ProductCardCustomizer";
import {
  getThemeInjectStatus,
  syncThemeAssets,
} from "../models/themeInject.server";
import {
  ensureThemeCardMirror,
  readThemeCardsStatus,
} from "../models/themeCardMirror.server";

export const links = () => [{ rel: "stylesheet", href: previewStyles }];

export const loader = async ({ request }: LoaderFunctionArgs) => {
  const { admin, session } = await authenticate.admin(request);
  const config = await getConfig(session.shop, admin as AdminClient);
  const [themeInject, themeCards] = await Promise.all([
    getThemeInjectStatus(admin as AdminClient).catch(() => null),
    readThemeCardsStatus(admin as AdminClient).catch(() => null),
  ]);
  return {
    productCard: config.productCard,
    customCss: config.appearance.customCss,
    themeInjected: Boolean(themeInject?.ok && themeInject.injected),
    themeCards,
  };
};

export const action = (args: ActionFunctionArgs) =>
  guardAction(args, () => customizerAction(args));

async function customizerAction({ request }: ActionFunctionArgs) {
  const { admin, session } = await authenticate.admin(request);
  const shop = session.shop;
  const formData = await request.formData();
  const intent = String(formData.get("intent"));

  if (intent === "theme-cards-regenerate") {
    try {
      const config = await getConfig(shop, admin as AdminClient);
      const res = await ensureThemeCardMirror(admin as AdminClient, shop, {
        force: true,
        customFiles: developerThemeFiles(config.behavior),
      });
      return {
        ok: res.ok,
        errors: res.errors,
        themeAssetsSynced: false,
        themeCards: res.status,
        action: intent,
      };
    } catch (err) {
      if (err instanceof Response) throw err;
      return {
        ok: false,
        errors: [
          {
            message:
              err instanceof Error ? err.message : "Theme card action failed",
          },
        ],
        themeAssetsSynced: false,
        themeCards: null,
        action: intent,
      };
    }
  }

  if (intent !== "save-product-card") {
    return {
      ok: false,
      errors: [{ message: "Unknown intent" }],
      themeAssetsSynced: false,
    };
  }

  let productCard: ProductCardConfig;
  try {
    productCard = JSON.parse(String(formData.get("productCard")));
  } catch {
    return {
      ok: false,
      errors: [{ message: "Invalid product card settings" }],
      themeAssetsSynced: false,
    };
  }

  const customCss = String(formData.get("customCss") ?? "");
  const current = await getConfig(shop, admin as AdminClient);

  const { ok, errors } = await saveConfig(
    shop,
    admin as AdminClient,
    {
      layout: current.layout,
      appearance: { ...current.appearance, customCss },
      behavior: current.behavior,
      sort: current.sort,
      productCard,
      filters: current.filters,
    },
    { baseline: baselineOf(current.filters) },
  );

  // Storefront cards load from theme copies of CSS/JS/Liquid. Refresh those
  // whenever card settings save so layout templates actually show on the shop.
  let themeAssetsSynced = false;
  const themeSyncErrors: { message: string }[] = [];
  let themeCards = null;
  if (ok) {
    const sync = await syncThemeAssets(admin as AdminClient, undefined, {
      ensureThemeCards: productCard.cardSource === "theme",
      shopDomain: shop,
      customFiles: developerThemeFiles(current.behavior),
    });
    themeAssetsSynced = sync.synced;
    if (!sync.ok) themeSyncErrors.push(...sync.errors);
    if (sync.themeCardErrors?.length) {
      themeSyncErrors.push(...sync.themeCardErrors);
    }
    if (productCard.cardSource === "theme") {
      themeCards = await readThemeCardsStatus(admin as AdminClient).catch(
        () => null,
      );
    }
  }

  posthog.capture({
    distinctId: shop,
    event: ok ? "product_card_saved" : "product_card_save_failed",
    properties: {
      shop,
      error_count: errors.length,
      theme_assets_synced: themeAssetsSynced,
      $process_person_profile: false,
    },
  });

  return {
    ok,
    errors: [...errors, ...themeSyncErrors],
    productCard,
    customCss,
    themeAssetsSynced,
    themeCards,
  };
}

export default function ProductCardCustomizerPage() {
  const { productCard, customCss, themeInjected, themeCards } =
    useLoaderData<typeof loader>();

  return (
    <ProductCardCustomizer
      initialProductCard={productCard}
      initialCustomCss={customCss}
      themeInjected={themeInjected}
      initialThemeCards={themeCards}
      embedded
    />
  );
}
