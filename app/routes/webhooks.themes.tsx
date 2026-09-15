import type { ActionFunctionArgs } from "@remix-run/node";
import { developerThemeFiles } from "../models/filterConfig.shared";
import { authenticate } from "../shopify.server";
import db from "../db.server";
import { getRedis } from "../redis.server";
import { ensureThemeCardMirror } from "../models/themeCardMirror.server";

// themes/publish + themes/update: keep the theme card mirror in step with the
// merchant's grid section (editor edits, theme switches).
//
// Shopify expects a 2xx within ~5 s and redelivers on timeout, so the handler
// acknowledges first and does the Admin API work after responding. Work is
// gated by:
//  - an idempotency key on the webhook id (redeliveries are no-ops), and
//  - a per-shop debounce for themes/update (fires on every editor file save).
// themes/publish is never debounced: a published theme is a different theme,
// and skipping it would leave the mirror pointing at the old section ids.
const DEBOUNCE_SECONDS = 90;
const IDEMPOTENCY_SECONDS = 48 * 60 * 60;

async function claimOnce(key: string, ttl: number): Promise<boolean> {
  const redis = getRedis();
  if (!redis) return true;
  try {
    return (await redis.set(key, "1", "EX", ttl, "NX")) === "OK";
  } catch (err) {
    console.warn(`[themes webhook] redis claim failed for ${key}:`, err);
    return true;
  }
}

export const action = async ({ request }: ActionFunctionArgs) => {
  const webhookId = request.headers.get("x-shopify-webhook-id") || "";
  const { topic, shop, admin } = await authenticate.webhook(request);
  console.log(`Received ${topic} webhook for ${shop}`);

  if (!admin) return new Response();

  if (
    webhookId &&
    !(await claimOnce(`aco_pf:webhook:${webhookId}`, IDEMPOTENCY_SECONDS))
  ) {
    return new Response();
  }

  const isPublish = topic === "THEMES_PUBLISH";
  if (
    !isPublish &&
    !(await claimOnce(`aco_pf:theme_cards_debounce:${shop}`, DEBOUNCE_SECONDS))
  ) {
    return new Response();
  }

  // Acknowledge now; refresh the mirror after the response is sent.
  setImmediate(() => {
    void (async () => {
      try {
        const settings = await db.filterSettings.findUnique({
          where: { shop },
          select: { productCard: true, behavior: true },
        });
        const cardSource = (
          settings?.productCard as { cardSource?: string } | null
        )?.cardSource;
        if (cardSource !== "theme") return;

        const customFiles = developerThemeFiles(settings?.behavior as any);

        const res = await ensureThemeCardMirror(admin as any, shop, {
          force: isPublish,
          customFiles,
        });
        if (!res.ok) {
          console.warn(
            `[themes webhook] theme card mirror not refreshed for ${shop}:`,
            res.errors,
          );
        }
      } catch (err) {
        console.warn(`[themes webhook] failed for ${shop}:`, err);
      }
    })();
  });

  return new Response();
};
