/**
 * Catalog sync decisions for product / collection webhooks (pure, no I/O).
 *
 * Two layers keep the filter vocabulary current without the merchant clicking
 * "Detect filter values":
 *  1. Additive, from the webhook payload itself (no Admin API call): new tags,
 *     vendors, product types, option values, and a wider price range.
 *  2. A debounced full re-check for what one event can't reveal (a value that
 *     no longer exists anywhere): product deletes, products leaving "active",
 *     and collection changes.
 *
 * The server module wires these to Prisma, the metafield publish and the scan.
 */

/** Values a products/create|update payload contributes to the filters. */
export function productWebhookValues(payload) {
  const p = payload || {};
  const split = (s) =>
    String(s || "")
      .split(",")
      .map((t) => t.trim())
      .filter(Boolean);
  const prices = (Array.isArray(p.variants) ? p.variants : [])
    .map((v) => parseFloat(v && v.price))
    .filter((n) => Number.isFinite(n));
  const options = (Array.isArray(p.options) ? p.options : [])
    .filter((o) => o && o.name)
    .map((o) => ({
      name: String(o.name),
      values: (Array.isArray(o.values) ? o.values : [])
        .map(String)
        .filter(Boolean),
    }));
  return {
    active: p.status === "active",
    types: p.product_type ? [String(p.product_type)] : [],
    vendors: p.vendor ? [String(p.vendor)] : [],
    tags: split(p.tags),
    options,
    priceMin: prices.length ? Math.min(...prices) : null,
    priceMax: prices.length ? Math.max(...prices) : null,
  };
}

/**
 * What to add to the stored filters for one product.
 * existing: { filters: [{ key, values: [{ raw, stale }] }], price: {min,max}|null }
 */
export function planCatalogAdditions(existing, incoming) {
  const plan = {
    addValues: {},
    unstale: {},
    newOptionFilters: [],
    price: null,
    changed: false,
  };
  const filters = (existing && existing.filters) || [];
  // Never run Detect: there is no vocabulary to extend yet.
  if (!filters.length || !incoming) return plan;

  const byKey = new Map(filters.map((f) => [f.key, f]));
  const consider = (key, raws) => {
    const f = byKey.get(key);
    if (!f) return false;
    const known = new Map((f.values || []).map((v) => [v.raw, v]));
    for (const raw of raws) {
      const hit = known.get(raw);
      if (!hit) {
        (plan.addValues[key] = plan.addValues[key] || []).push(raw);
        known.set(raw, { raw, stale: false });
      } else if (hit.stale) {
        (plan.unstale[key] = plan.unstale[key] || []).push(raw);
        hit.stale = false;
      }
    }
    return true;
  };

  consider("type", incoming.types);
  consider("vendor", incoming.vendors);
  consider("tag", incoming.tags);
  for (const o of incoming.options) {
    if (!consider(`opt_${o.name}`, o.values) && o.values.length) {
      plan.newOptionFilters.push({ name: o.name, values: [...o.values] });
    }
  }

  const cur = existing.price;
  if (cur && incoming.priceMin != null && incoming.priceMax != null) {
    const min = Math.min(cur.min, Math.floor(incoming.priceMin));
    const max = Math.max(cur.max, Math.ceil(incoming.priceMax));
    if (min !== cur.min || max !== cur.max) plan.price = { min, max };
  }

  plan.changed =
    Object.keys(plan.addValues).length > 0 ||
    Object.keys(plan.unstale).length > 0 ||
    plan.newOptionFilters.length > 0 ||
    plan.price !== null;
  return plan;
}

/** Events whose effect on the vocabulary needs a full catalog re-check. */
export function needsRecheck(topic, payload) {
  if (topic === "PRODUCTS_DELETE") return true;
  if (String(topic).startsWith("COLLECTIONS_")) return true;
  if (topic === "PRODUCTS_UPDATE")
    return !(payload && payload.status === "active");
  return false;
}

/**
 * deps: loadExisting(shop), applyPlan(shop, plan), republish(shop),
 *       scheduleRecheck(shop), fingerprintChanged(shop, id, fp) -> bool,
 *       bumpCatalogVersion(shop)
 */
export function createCatalogWebhookHandler(deps) {
  return async function handleCatalogWebhook({ shop, topic, payload }) {
    const existing = await deps.loadExisting(shop);
    // Shops that never ran Detect have nothing to keep in sync.
    if (!existing || !existing.filters || !existing.filters.length) return;

    // Storefront snapshots (the product list shoppers filter) must refresh
    // whenever a product's filter-relevant fields change, it's created or
    // deleted, or collections change. Plain stock/description edits don't.
    let snapshotStale =
      topic !== "PRODUCTS_UPDATE" && topic !== "PRODUCTS_CREATE";

    if (topic === "PRODUCTS_CREATE" || topic === "PRODUCTS_UPDATE") {
      const id = payload && payload.id != null ? String(payload.id) : "";
      snapshotStale =
        !id ||
        (await deps.fingerprintChanged(shop, id, productFingerprint(payload)));
      const incoming = productWebhookValues(payload);
      if (incoming.active) {
        const plan = planCatalogAdditions(existing, incoming);
        if (plan.changed) {
          await deps.applyPlan(shop, plan);
          await deps.republish(shop);
        }
      }
    }
    if (snapshotStale) deps.bumpCatalogVersion(shop);
    if (needsRecheck(topic, payload)) deps.scheduleRecheck(shop);
  };
}

/**
 * Stable digest of the fields storefront filtering reads from a product.
 * Same digest = nothing a shopper filters on changed (e.g. stock or text).
 */
export function productFingerprint(payload) {
  const v = productWebhookValues(payload);
  const prices = (
    Array.isArray(payload && payload.variants) ? payload.variants : []
  )
    .map((x) => String(x && x.price))
    .sort();
  return JSON.stringify([
    (payload && payload.status) || "",
    v.vendors,
    v.types,
    [...v.tags].sort(),
    v.options.map((o) => [o.name, [...o.values].sort()]),
    prices,
  ]);
}

/**
 * Trailing debounce per shop: the re-check runs `delayMs` after the LAST
 * event, so a bulk edit of 1,000 products causes one scan, not 1,000.
 */
export function createRecheckScheduler({
  delayMs,
  run,
  onError = (shop, err) =>
    console.warn(`[catalog sync] re-check failed for ${shop}:`, err),
  now = () => Date.now(),
  setTimer = (fn, ms) => setTimeout(fn, ms),
}) {
  const pending = new Map(); // shop -> { due, timer }

  const fire = async (shop) => {
    const entry = pending.get(shop);
    if (!entry) return;
    const wait = entry.due - now();
    if (wait > 0) {
      entry.timer = setTimer(() => fire(shop), wait);
      return;
    }
    pending.delete(shop);
    try {
      await run(shop);
    } catch (err) {
      onError(shop, err);
    }
  };

  return function schedule(shop) {
    const due = now() + delayMs;
    const entry = pending.get(shop);
    if (entry) {
      entry.due = due; // push the deadline; the pending timer re-arms itself
      return;
    }
    pending.set(shop, { due, timer: setTimer(() => fire(shop), delayMs) });
  };
}
