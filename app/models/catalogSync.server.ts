import prisma from "../db.server";
import { getRedis } from "../redis.server";
import { unauthenticated } from "../shopify.server";
import {
  createCatalogWebhookHandler,
  createRecheckScheduler,
} from "./catalogSync.shared.js";
import { beginDetect, endDetect, scanCatalog } from "./catalogScan.server";
import {
  mergeDetected,
  republishSnapshot,
  updateDetection,
  type AdminClient,
} from "./filterSettings.server";

/**
 * Server wiring for catalog sync from product / collection webhooks.
 * Decisions live in catalogSync.shared.js (unit tested); this file does I/O.
 */

// Re-check runs this long after the LAST qualifying event for a shop.
const RECHECK_DELAY_MS = 3 * 60 * 1000;
// Cross-instance guard so two servers don't scan the same shop at once.
const RECHECK_LOCK_SECONDS = 10 * 60;

type Plan = {
  addValues: Record<string, string[]>;
  unstale: Record<string, string[]>;
  newOptionFilters: { name: string; values: string[] }[];
  price: { min: number; max: number } | null;
  changed: boolean;
};

async function adminFor(shop: string): Promise<AdminClient> {
  const { admin } = await unauthenticated.admin(shop);
  return admin as unknown as AdminClient;
}

/** Stored filter vocabulary in the shape planCatalogAdditions expects. */
async function loadExisting(shop: string) {
  const settings = await prisma.filterSettings.findUnique({
    where: { shop },
    select: {
      storefrontToken: true,
      filters: {
        select: {
          key: true,
          styleOptions: true,
          values: { select: { raw: true, stale: true } },
        },
      },
    },
  });
  // No token = Detect never ran; the storefront can't filter yet anyway.
  if (!settings?.storefrontToken) return { filters: [], price: null };

  const priceFilter = settings.filters.find((f) => f.key === "price");
  const opts = (priceFilter?.styleOptions ?? {}) as {
    min?: unknown;
    max?: unknown;
  };
  const min = Number(opts.min);
  const max = Number(opts.max);
  return {
    filters: settings.filters
      .filter(
        (f) =>
          f.key === "type" ||
          f.key === "vendor" ||
          f.key === "tag" ||
          f.key.startsWith("opt_"),
      )
      .map((f) => ({ key: f.key, values: f.values })),
    price: Number.isFinite(min) && Number.isFinite(max) ? { min, max } : null,
  };
}

async function applyPlan(shop: string, plan: Plan): Promise<void> {
  const settings = await prisma.filterSettings.findUnique({
    where: { shop },
    select: { id: true },
  });
  if (!settings) return;

  await prisma.$transaction(async (tx) => {
    const defs = await tx.filterDefinition.findMany({
      where: { settingsId: settings.id },
      select: {
        id: true,
        key: true,
        styleOptions: true,
        values: { select: { order: true } },
      },
    });
    const byKey = new Map(defs.map((d) => [d.key, d]));

    for (const [key, raws] of Object.entries(plan.addValues)) {
      const def = byKey.get(key);
      if (!def || !raws.length) continue;
      let order = def.values.reduce((m, v) => Math.max(m, v.order), -1);
      await tx.filterValue.createMany({
        data: raws.map((raw) => ({ filterId: def.id, raw, order: ++order })),
        skipDuplicates: true,
      });
    }

    for (const [key, raws] of Object.entries(plan.unstale)) {
      const def = byKey.get(key);
      if (!def || !raws.length) continue;
      await tx.filterValue.updateMany({
        where: { filterId: def.id, raw: { in: raws } },
        data: { stale: false },
      });
    }

    // New option names get a filter like Detect would create (appended).
    let nextOrder = defs.length;
    for (const o of plan.newOptionFilters) {
      const key = `opt_${o.name}`;
      if (byKey.has(key)) continue;
      const sorted = [...o.values].sort((a, b) => a.localeCompare(b));
      await tx.filterDefinition.create({
        data: {
          settingsId: settings.id,
          key,
          type: "variantOption",
          name: o.name,
          label: o.name,
          order: nextOrder++,
          displayStyle: /colou?r/i.test(o.name) ? "swatch" : "checkbox",
          styleOptions: {},
          values: {
            createMany: { data: sorted.map((raw, j) => ({ raw, order: j })) },
          },
        },
      });
    }

    if (plan.price) {
      const def = byKey.get("price");
      if (def) {
        const prev = (def.styleOptions ?? {}) as Record<string, unknown>;
        await tx.filterDefinition.update({
          where: { id: def.id },
          data: {
            styleOptions: {
              ...prev,
              min: plan.price.min,
              max: plan.price.max,
            } as object,
          },
        });
      }
    }
  });
}

async function republishNow(shop: string): Promise<void> {
  const { ok, errors } = await republishSnapshot(shop, await adminFor(shop));
  if (!ok) console.warn(`[catalog sync] republish failed for ${shop}:`, errors);
}

// A bulk import fires one webhook per product; the config is published once
// after the burst settles instead of once per product.
const REPUBLISH_DELAY_MS = 5 * 1000;
const scheduleRepublish = createRecheckScheduler({
  delayMs: REPUBLISH_DELAY_MS,
  run: republishNow,
  onError: (shop, err) =>
    console.warn(`[catalog sync] republish failed for ${shop}:`, err),
});

async function republish(shop: string): Promise<void> {
  scheduleRepublish(shop);
}

/** Full detect for one shop, like the manual button (token left as is). */
async function runRecheck(shop: string): Promise<void> {
  const settings = await prisma.filterSettings.findUnique({
    where: { shop },
    select: { storefrontToken: true },
  });
  if (!settings?.storefrontToken) return;

  const redis = getRedis();
  const lockKey = `aco_pf:catalog_recheck_lock:${shop}`;
  if (redis) {
    try {
      const got = await redis.set(
        lockKey,
        "1",
        "EX",
        RECHECK_LOCK_SECONDS,
        "NX",
      );
      if (got !== "OK") return;
    } catch (err) {
      console.warn(`[catalog sync] redis lock failed for ${shop}:`, err);
    }
  }
  // A manual detect is running: it covers this change; try again later.
  if (!beginDetect(shop)) {
    if (redis) await redis.del(lockKey).catch(() => {});
    scheduleRecheck(shop);
    return;
  }
  try {
    const admin = await adminFor(shop);
    const detected = await scanCatalog(admin as never);
    // Nobody is watching a background re-check, so it must never remove
    // values on its own: an empty scan (throttled first page) is ignored and a
    // capped one (5,000+ products) only adds, never marks stale or narrows
    // the price range. The manual Detect button still does the full merge.
    if (detected.scanned === 0) {
      console.warn(
        `[catalog sync] re-check for ${shop} scanned 0 products; skipped`,
      );
      return;
    }
    await updateDetection(shop, {
      scannedCount: detected.scanned,
      capped: detected.capped,
      catalogSyncedAt: new Date(),
    });
    await mergeDetected(shop, detected, {
      markStale: !detected.capped,
      updatePrice: !detected.capped,
    });
    const { ok, errors } = await republishSnapshot(shop, admin);
    if (!ok)
      console.warn(`[catalog sync] republish failed for ${shop}:`, errors);
    console.log(
      `[catalog sync] re-check done for ${shop} (${detected.scanned} products)`,
    );
  } finally {
    endDetect(shop);
    if (redis) await redis.del(lockKey).catch(() => {});
  }
}

export const scheduleRecheck = createRecheckScheduler({
  delayMs: RECHECK_DELAY_MS,
  run: runRecheck,
});

// ── Catalog version (storefront snapshot invalidation) ──────────────────────

// At most one metafield write per shop per window, however many products
// change (trailing: written after the last change settles).
const VERSION_DELAY_MS = 30 * 1000;
// Product fingerprints expire eventually; a missing one just means "changed".
const FINGERPRINT_TTL_SECONDS = 30 * 24 * 60 * 60;

/** True when the product's filter fields differ from the last webhook's. */
async function fingerprintChanged(
  shop: string,
  productId: string,
  fingerprint: string,
): Promise<boolean> {
  const redis = getRedis();
  if (!redis) return true;
  const key = `aco_pf:product_fp:${shop}`;
  try {
    const prev = await redis.hget(key, productId);
    if (prev === fingerprint) return false;
    await redis.hset(key, productId, fingerprint);
    await redis.expire(key, FINGERPRINT_TTL_SECONDS);
    return true;
  } catch (err) {
    console.warn(`[catalog sync] fingerprint check failed for ${shop}:`, err);
    return true;
  }
}

/** Write pf_config.catalog_version so storefront snapshots refresh. */
async function writeCatalogVersion(shop: string): Promise<void> {
  const admin = await adminFor(shop);
  const res = await admin.graphql(
    `#graphql
    mutation PfCatalogVersion($metafields: [MetafieldsSetInput!]!) {
      metafieldsSet(metafields: $metafields) {
        userErrors { field message }
      }
    }`,
    {
      variables: {
        metafields: [
          {
            ownerId: await shopGid(admin),
            namespace: "pf_config",
            key: "catalog_version",
            type: "single_line_text_field",
            value: String(Date.now()),
          },
        ],
      },
    },
  );
  const json = (await res.json()) as {
    data?: { metafieldsSet?: { userErrors?: { message: string }[] } };
  };
  const errors = json.data?.metafieldsSet?.userErrors ?? [];
  if (errors.length) {
    console.warn(
      `[catalog sync] catalog version not written for ${shop}:`,
      errors,
    );
  }
}

async function shopGid(admin: AdminClient): Promise<string> {
  const res = await admin.graphql(`#graphql
    query PfShopId { shop { id } }
  `);
  const json = (await res.json()) as { data?: { shop?: { id?: string } } };
  return json.data?.shop?.id ?? "";
}

const bumpCatalogVersion = createRecheckScheduler({
  delayMs: VERSION_DELAY_MS,
  run: writeCatalogVersion,
  onError: (shop, err) =>
    console.warn(`[catalog sync] catalog version failed for ${shop}:`, err),
});

const handle = createCatalogWebhookHandler({
  loadExisting,
  applyPlan,
  republish,
  scheduleRecheck,
  fingerprintChanged,
  bumpCatalogVersion,
});

// Webhooks for one shop are processed one at a time, so two near-simultaneous
// product edits can't race on the same filter rows.
const queues = new Map<string, Promise<void>>();

export function processCatalogWebhook(input: {
  shop: string;
  topic: string;
  payload: unknown;
}): Promise<void> {
  const prev = queues.get(input.shop) ?? Promise.resolve();
  const next = prev
    .then(() => handle(input))
    .catch((err) => {
      console.warn(
        `[catalog sync] ${input.topic} failed for ${input.shop}:`,
        err,
      );
    });
  queues.set(input.shop, next);
  void next.finally(() => {
    if (queues.get(input.shop) === next) queues.delete(input.shop);
  });
  return next;
}
