import "@shopify/shopify-app-remix/adapters/node";
import {
  ApiVersion,
  AppDistribution,
  shopifyApp,
} from "@shopify/shopify-app-remix/server";
import { PrismaSessionStorage } from "@shopify/shopify-app-session-storage-prisma";
import type { SessionStorage } from "@shopify/shopify-app-session-storage";
import prisma from "./db.server";
import { createRedisSessionStorage } from "./models/redisSessionStorage.server";
import { recordShopInstall } from "./models/shop.server";
import { deleteShopMetafield } from "./models/filterSettings.server";

/**
 * Prefer Redis for Shopify auth sessions when REDIS_URL is set.
 * Falls back to Postgres (Prisma) for local/dev without Redis.
 */
function createSessionStorage(): SessionStorage {
  const redisUrl = process.env.REDIS_URL?.trim();
  if (redisUrl) {
    console.info("[shopify] session storage: Redis via ioredis (REDIS_URL)");
    return createRedisSessionStorage();
  }

  console.warn(
    "[shopify] REDIS_URL not set — session storage: Prisma (Postgres)",
  );
  return new PrismaSessionStorage(prisma);
}

const shopify = shopifyApp({
  apiKey: process.env.SHOPIFY_API_KEY,
  apiSecretKey: process.env.SHOPIFY_API_SECRET || "",
  apiVersion: ApiVersion.January25,
  scopes: process.env.SCOPES?.split(","),
  appUrl: process.env.SHOPIFY_APP_URL || "",
  authPathPrefix: "/auth",
  sessionStorage: createSessionStorage(),
  distribution: AppDistribution.AppStore,
  future: {
    unstable_newEmbeddedAuthStrategy: true,
    expiringOfflineAccessTokens: true,
  },
  hooks: {
    afterAuth: async ({ session, admin }) => {
      await recordShopInstall(session.shop, admin);
      try {
        // Do NOT reset onboarding here — reauth/token exchange runs when
        // merchants leave and reopen the app. Onboarding is only cleared on
        // uninstall (webhooks.app.uninstalled).
        const existing = await prisma.filterSettings.findUnique({
          where: { shop: session.shop },
          select: { id: true },
        });
        if (!existing && admin) {
          await deleteShopMetafield(admin as any);
        }
      } catch (err) {
        console.warn("afterAuth metafield cleanup check failed:", err);
      }
    },
  },
  ...(process.env.SHOP_CUSTOM_DOMAIN
    ? { customShopDomains: [process.env.SHOP_CUSTOM_DOMAIN] }
    : {}),
});

export default shopify;
export const apiVersion = ApiVersion.January25;
export const addDocumentResponseHeaders = shopify.addDocumentResponseHeaders;
export const authenticate = shopify.authenticate;
export const unauthenticated = shopify.unauthenticated;
export const login = shopify.login;
export const registerWebhooks = shopify.registerWebhooks;
export const sessionStorage = shopify.sessionStorage;
