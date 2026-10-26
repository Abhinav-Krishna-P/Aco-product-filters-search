import type { DetectedCatalog } from "./filterSettings.server";

/**
 * Full catalog scan used by "Detect filter values" and by the background
 * re-check that product/collection webhooks schedule. Only ACTIVE products
 * count: tags or vendors that exist only on drafts or archived products must
 * not appear in the storefront filters.
 */

const MAX_PAGES = 20; // 20 x 250 = up to 5,000 products scanned per detect run.

// One detect per shop at a time, across the manual button and the webhook
// re-check (same process). Returns false when one is already running.
const activeDetectShops = new Set<string>();

export function beginDetect(shop: string): boolean {
  if (activeDetectShops.has(shop)) return false;
  activeDetectShops.add(shop);
  return true;
}

export function endDetect(shop: string): void {
  activeDetectShops.delete(shop);
}

// ── Catalog scan (Admin API) ─────────────────────────────────────────────────

export async function scanCatalog(admin: {
  graphql: Function;
}): Promise<DetectedCatalog> {
  const types = new Set<string>();
  const vendors = new Set<string>();
  const tags = new Set<string>();
  const options = new Map<string, Set<string>>();
  let priceMin = Number.POSITIVE_INFINITY;
  let priceMax = 0;
  let scanned = 0;
  let cursor: string | null = null;
  let capped = false;

  for (let page = 0; page < MAX_PAGES; page++) {
    if (page > 0) {
      await new Promise((r) => setTimeout(r, 80));
    }
    const res: any = await admin.graphql(
      `#graphql
      query ScanProducts($cursor: String) {
        products(first: 250, after: $cursor, query: "status:active") {
          pageInfo { hasNextPage endCursor }
          nodes {
            productType
            vendor
            tags
            options { name values }
            priceRangeV2 {
              minVariantPrice { amount }
              maxVariantPrice { amount }
            }
          }
        }
      }`,
      { variables: { cursor } },
    );
    const json = await res.json();
    const conn = json.data?.products;
    if (!conn) break;

    for (const p of conn.nodes) {
      scanned++;
      if (p.productType) types.add(p.productType);
      if (p.vendor) vendors.add(p.vendor);
      (p.tags ?? []).forEach((t: string) => tags.add(t));
      (p.options ?? []).forEach((o: { name: string; values: string[] }) => {
        if (!options.has(o.name)) options.set(o.name, new Set());
        (o.values ?? []).forEach((v) => options.get(o.name)!.add(v));
      });
      const lo = parseFloat(p.priceRangeV2?.minVariantPrice?.amount ?? "0");
      const hi = parseFloat(p.priceRangeV2?.maxVariantPrice?.amount ?? "0");
      if (!Number.isNaN(lo)) priceMin = Math.min(priceMin, lo);
      if (!Number.isNaN(hi)) priceMax = Math.max(priceMax, hi);
    }

    if (!conn.pageInfo?.hasNextPage) break;
    cursor = conn.pageInfo.endCursor;
    if (page === MAX_PAGES - 1) capped = true;
  }

  if (!Number.isFinite(priceMin)) priceMin = 0;

  return {
    types: [...types],
    vendors: [...vendors],
    tags: [...tags],
    options: [...options.entries()].map(([name, vals]) => ({
      name,
      values: [...vals],
    })),
    collections: await scanCollections(admin),
    priceMin,
    priceMax,
    scanned,
    capped,
  };
}

// All collections (custom + smart), for the collection tree filter. Capped at
// 1,000 — far beyond what a sidebar tree can sensibly show.
async function scanCollections(admin: {
  graphql: Function;
}): Promise<{ handle: string; title: string }[]> {
  const out: { handle: string; title: string }[] = [];
  let cursor: string | null = null;
  for (let page = 0; page < 4; page++) {
    if (page > 0) {
      await new Promise((r) => setTimeout(r, 80));
    }
    const res: any = await admin.graphql(
      `#graphql
      query ScanCollections($cursor: String) {
        collections(first: 250, after: $cursor) {
          pageInfo { hasNextPage endCursor }
          nodes { handle title }
        }
      }`,
      { variables: { cursor } },
    );
    const json = await res.json();
    const conn = json.data?.collections;
    if (!conn) break;
    for (const c of conn.nodes) {
      if (c.handle) out.push({ handle: c.handle, title: c.title ?? c.handle });
    }
    if (!conn.pageInfo?.hasNextPage) break;
    cursor = conn.pageInfo.endCursor;
  }
  return out;
}
