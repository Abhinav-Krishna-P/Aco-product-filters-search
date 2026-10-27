import type { ActionFunctionArgs } from "@remix-run/node";
import { authenticate } from "../shopify.server";
import { getRedis } from "../redis.server";
import { processCatalogWebhook } from "../models/catalogSync.server";

// products/create|update|delete + collections/create|update|delete: keep the
// filter vocabulary in step with the catalog without a manual "Detect".
//
// Shopify expects a 2xx within ~5 s and redelivers on timeout, so the handler
// acknowledges first and works after responding. Redeliveries (same webhook
// id) are ignored.
const IDEMPOTENCY_SECONDS = 48 * 60 * 60;

async function firstDelivery(webhookId: string): Promise<boolean> {
  if (!webhookId) return true;
  const redis = getRedis();
  if (!redis) return true;
  try {
    const key = `aco_pf:webhook:${webhookId}`;
    return (
      (await redis.set(key, "1", "EX", IDEMPOTENCY_SECONDS, "NX")) === "OK"
    );
  } catch (err) {
    console.warn(`[catalog webhook] redis claim failed for ${webhookId}:`, err);
    return true;
  }
}

export const action = async ({ request }: ActionFunctionArgs) => {
  const webhookId = request.headers.get("x-shopify-webhook-id") || "";
  const { topic, shop, session, payload } = await authenticate.webhook(request);
  console.log(`Received ${topic} webhook for ${shop}`);

  // App already uninstalled for this shop: nothing to keep in sync.
  if (!session) return new Response();
  if (!(await firstDelivery(webhookId))) return new Response();

  setImmediate(() => {
    void processCatalogWebhook({ shop, topic, payload });
  });

  return new Response();
};
