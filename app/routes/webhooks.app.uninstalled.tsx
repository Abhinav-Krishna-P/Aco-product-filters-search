import type { ActionFunctionArgs } from "@remix-run/node";
import { authenticate, sessionStorage } from "../shopify.server";
import db from "../db.server";
import posthog from "../posthog.server";
import { getRedis } from "../redis.server";
import { removeThemeFilters } from "../models/themeInject.server";
import {
  developerThemeFiles,
  type DeveloperThemeFiles,
} from "../models/filterConfig.shared";

// app/uninstalled: Shopify has already revoked the access token by the time
// this fires, so Admin API cleanup (theme snippets, storefront tokens,
// metafields) is best-effort and runs AFTER the webhook is acknowledged.
// Shopify removes app-owned metafields and theme app extension assets itself;
// the injected theme snippets are the only thing worth attempting.
//
// What must happen synchronously is cheap and local: delete the shop's
// settings and sessions (Postgres and Redis) so a revoked token is never kept.
const IDEMPOTENCY_SECONDS = 48 * 60 * 60;

async function claimOnce(key: string): Promise<boolean> {
  const redis = getRedis();
  if (!redis) return true;
  try {
    return (
      (await redis.set(key, "1", "EX", IDEMPOTENCY_SECONDS, "NX")) === "OK"
    );
  } catch {
    return true;
  }
}

async function deleteSessionsEverywhere(shop: string) {
  try {
    const sessions = await sessionStorage.findSessionsByShop(shop);
    if (sessions.length) {
      await sessionStorage.deleteSessions(sessions.map((s) => s.id));
    }
  } catch (err) {
    console.warn(
      `[uninstall] session storage cleanup failed for ${shop}:`,
      err,
    );
  }
  try {
    await db.session.deleteMany({ where: { shop } });
  } catch (err) {
    console.warn(`[uninstall] prisma session cleanup failed for ${shop}:`, err);
  }
}

function is401(err: any): boolean {
  return err?.status === 401 || err?.statusCode === 401;
}

async function bestEffortShopifyCleanup(
  admin: any,
  shop: string,
  customFiles: { collectionFile?: string; searchFile?: string } | undefined,
) {
  try {
    const injectRes = await removeThemeFilters(admin, customFiles, {
      deleteCopiedFiles: true,
    });
    console.log(
      `[uninstall] theme injection reverted for ${shop}:`,
      injectRes.ok ? "ok" : injectRes.errors,
    );
  } catch (err: any) {
    if (!is401(err)) {
      console.warn(
        `[uninstall] theme cleanup failed for ${shop}:`,
        err?.message || err,
      );
    }
  }

  try {
    const listRes = await admin.graphql(`#graphql
      query SfTokens {
        shop {
          id
          storefrontAccessTokens(first: 20) {
            nodes { id title }
          }
        }
      }
    `);
    const listJson = await listRes.json();
    const shopId = listJson.data?.shop?.id;
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

    if (shopId) {
      for (const key of ["settings", "theme_cards"]) {
        const mfRes = await admin.graphql(
          `#graphql
          query PfMetafield($key: String!) {
            shop {
              metafield(namespace: "pf_config", key: $key) { id }
            }
          }`,
          { variables: { key } },
        );
        const mfJson = await mfRes.json();
        const mfId = mfJson.data?.shop?.metafield?.id;
        if (mfId) {
          await admin.graphql(
            `#graphql
            mutation DeletePfConfig($input: MetafieldDeleteInput!) {
              metafieldDelete(input: $input) {
                deletedId
                userErrors { field message }
              }
            }`,
            { variables: { input: { id: mfId } } },
          );
        }
      }
    }
  } catch (err: any) {
    if (!is401(err)) {
      console.warn(
        `[uninstall] shopify resource cleanup failed for ${shop}:`,
        err?.message || err,
      );
    }
  }
}

export const action = async ({ request }: ActionFunctionArgs) => {
  const webhookId = request.headers.get("x-shopify-webhook-id") || "";
  const { shop, topic, admin } = await authenticate.webhook(request);
  console.log(`[uninstall] verified ${topic} webhook for ${shop}`);

  if (webhookId && !(await claimOnce(`aco_pf:webhook:${webhookId}`))) {
    return new Response();
  }

  // Developer overrides decide which theme files the inject lives in.
  let customFiles: DeveloperThemeFiles | undefined;
  try {
    const existing = await db.filterSettings.findUnique({
      where: { shop },
      select: { behavior: true },
    });
    customFiles = developerThemeFiles(existing?.behavior as any);
  } catch (err) {
    console.warn(`[uninstall] could not read filterSettings for ${shop}:`, err);
  }

  // Synchronous, local, fast: wipe settings + sessions. The Shop row is kept
  // as install history; onboarding is reset for a clean reinstall.
  try {
    await db.filterSettings.deleteMany({ where: { shop } });
    await db.shop.updateMany({
      where: { shopDomain: shop },
      data: { onboardingCompletedAt: null },
    });
  } catch (err) {
    console.error(`[uninstall] DB cleanup failed for ${shop}:`, err);
  }
  await deleteSessionsEverywhere(shop);

  posthog.capture({
    distinctId: shop,
    event: "app_uninstalled",
    properties: { shop, $process_person_profile: false },
  });

  // Best-effort Shopify cleanup after the response (token is usually revoked).
  if (admin) {
    setImmediate(() => {
      void bestEffortShopifyCleanup(admin, shop, customFiles);
    });
  }

  return new Response();
};
