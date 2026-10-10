/**
 * Analytics read cache.
 *
 * The analytics page used to run 8 HogQL queries against PostHog's Query API on
 * every date-range change, each with `refresh: blocking` — 5-7 seconds per
 * filter click when results were not cached.
 *
 * Instead we fetch only the selected date range (2 bounded queries), cache that
 * result in Redis for 3 minutes, and aggregate it in-memory (milliseconds).
 * After the TTL the next request re-fetches that range from PostHog.
 *
 * If Redis is unavailable the selected range is fetched fresh each time — still
 * correct, just without the speed-up.
 */
import zlib from "node:zlib";
import { promisify } from "node:util";
import { getRedis } from "./redis.server";
import {
  PostHogRateLimitError,
  assertShopDomain,
  hogql,
  sql,
} from "./posthog-query.server";
import {
  analyticsCacheKey,
  buildAnalyticsTimeFilter,
} from "./analytics-query.shared.js";

const gzip = promisify(zlib.gzip);
const gunzip = promisify(zlib.gunzip);

// Must match the event names the storefront captures (extensions/.../pf-filters.js).
const EV_APPLY = "storefront_filter_applied";
const EV_CLICK = "storefront_product_clicked";

const MAX_ROWS = 200_000; // safety cap per event type on the range pull

// Freshness policy (stale-while-revalidate).
//
// "Open" ranges (today / this month) keep changing, so they are considered
// fresh for 3 minutes. After that a request still returns the cached copy
// immediately and refreshes it in the background, up to the hard Redis expiry.
//
// "Closed" ranges (yesterday / last month / past custom) don't change once
// PostHog ingestion has settled, so they stay fresh for hours.
const OPEN_FRESH_MS = 3 * 60 * 1000; // 3 min
const OPEN_HARD_TTL_S = 60 * 60; // 1 h (stale copy kept this long)
const CLOSED_FRESH_MS = 6 * 60 * 60 * 1000; // 6 h
const CLOSED_HARD_TTL_S = 24 * 60 * 60; // 24 h
// A range is "closed" when it ended at least this long ago — leaves headroom
// for late-arriving storefront events.
const CLOSED_GRACE_MS = 60 * 60 * 1000; // 1 h

function isClosedRange(end: Date, now = Date.now()): boolean {
  return end.getTime() + CLOSED_GRACE_MS <= now;
}

function freshMsFor(end: Date): number {
  return isClosedRange(end) ? CLOSED_FRESH_MS : OPEN_FRESH_MS;
}

function hardTtlFor(end: Date): number {
  return isClosedRange(end) ? CLOSED_HARD_TTL_S : OPEN_HARD_TTL_S;
}

/**
 * Remove every cached analytics range for one shop.
 *
 * SCAN avoids blocking Redis the way KEYS can on a shared production
 * instance. UNLINK releases the values asynchronously because cached payloads
 * can be large compressed range dumps.
 */
export async function clearShopAnalyticsCache(shop: string): Promise<number> {
  assertShopDomain(shop);
  const redis = getRedis();
  if (!redis) return 0;

  const pattern = `pf:analytics:raw:v2:${shop}:*`;
  let cursor = "0";
  let deleted = 0;

  do {
    const [nextCursor, keys] = await redis.scan(
      cursor,
      "MATCH",
      pattern,
      "COUNT",
      100,
    );
    cursor = nextCursor;
    if (keys.length > 0) {
      deleted += await redis.unlink(...keys);
    }
  } while (cursor !== "0");

  return deleted;
}

// ── raw dump shape (what we cache) ───────────────────────────────────────────
type ApplyRow = { t: number; filters: string; fc: number };
type ClickRow = {
  t: number;
  productId: string;
  title: string;
  handle: string;
  image: string;
};
type RawData = {
  applies: ApplyRow[];
  clicks: ClickRow[];
  fetchedAt: number;
  truncated: boolean;
  /** Served from a stale cache copy while a background refresh runs. */
  refreshing?: boolean;
};

// ── aggregated shape (what the loader returns; mirrors the old query output) ──
export type FilterPair = {
  aKey: string;
  aLabel: string;
  bKey: string;
  bLabel: string;
  n: number;
};
export type Bucket = { t: number; n: number };
export type Aggregated = {
  buckets: Bucket[];
  totals: { applies: number; selections: number; clicks: number };
  perFilter: { key: string; label: string; n: number }[];
  perOption: { key: string; label: string; value: string; n: number }[];
  together: FilterPair[];
  priceRanges: { label: string; n: number }[];
  topCategory: { value: string; n: number }[];
  topProducts: {
    productId: string;
    title: string;
    handle: string;
    image: string;
    n: number;
  }[];
};

// HogQL truncates/returns timestamps in the project timezone; the chart is drawn
// on a UTC grid (assumes the PostHog project timezone is UTC). Parse a value like
// "2026-07-14T10:00:00Z" or "2026-07-14 10:00:00" to epoch ms.
function parseTs(v: unknown): number {
  const s = String(v).replace(" ", "T");
  const iso = /[zZ]|[+-]\d\d:?\d\d$/.test(s) ? s : s + "Z";
  return new Date(iso).getTime();
}

function startOfDayUtc(t: number): number {
  const d = new Date(t);
  d.setUTCHours(0, 0, 0, 0);
  return d.getTime();
}
function startOfHourUtc(t: number): number {
  const d = new Date(t);
  d.setUTCMinutes(0, 0, 0);
  return d.getTime();
}

function nf(n: number): string {
  return new Intl.NumberFormat().format(n);
}

// Build a continuous, zero-filled bucket series over [start, end) on a UTC grid.
export function buildBucketsUtc(
  start: Date,
  end: Date,
  gran: "hour" | "day",
  series: Bucket[],
): Bucket[] {
  const map = new Map(series.map((s) => [s.t, s.n]));
  const out: Bucket[] = [];
  const cur = new Date(start);
  if (gran === "hour") cur.setUTCMinutes(0, 0, 0);
  else cur.setUTCHours(0, 0, 0, 0);
  const endT = end.getTime();
  let guard = 0;
  while (cur.getTime() < endT && guard < 2000) {
    out.push({ t: cur.getTime(), n: map.get(cur.getTime()) ?? 0 });
    if (gran === "hour") cur.setUTCHours(cur.getUTCHours() + 1);
    else cur.setUTCDate(cur.getUTCDate() + 1);
    guard++;
  }
  return out;
}

// Cap the sample size for O(k^2) co-occurrence calculations to prevent event loop blocking.
// 50,000 events provides a statistically robust sample for top-10 pair rankings in ~10ms.
const MAX_AGGREGATION_SAMPLE = 50_000;

// Co-occurrence ("usually filtered together"): distinct keys per apply event →
// all unordered pairs (a<b), counted, deduped by key. Mirrors the old SQL join.
function coOccurrence(filtersJson: string[]): FilterPair[] {
  const counts = new Map<string, FilterPair>();
  const sample =
    filtersJson.length > MAX_AGGREGATION_SAMPLE
      ? filtersJson.slice(0, MAX_AGGREGATION_SAMPLE)
      : filtersJson;
  for (const raw of sample) {
    let arr: any;
    try {
      arr = JSON.parse(raw || "[]");
    } catch {
      continue;
    }
    if (!Array.isArray(arr)) continue;
    const byKey = new Map<string, string>();
    for (const it of arr) {
      if (it && typeof it.key === "string" && !byKey.has(it.key)) {
        byKey.set(
          it.key,
          typeof it.label === "string" && it.label ? it.label : it.key,
        );
      }
    }
    const keys = [...byKey.keys()].sort();
    for (let i = 0; i < keys.length; i++) {
      for (let j = i + 1; j < keys.length; j++) {
        const id = keys[i] + " " + keys[j];
        const cur = counts.get(id);
        if (cur) {
          cur.n += 1;
        } else {
          counts.set(id, {
            aKey: keys[i],
            aLabel: byKey.get(keys[i]) ?? keys[i],
            bKey: keys[j],
            bLabel: byKey.get(keys[j]) ?? keys[j],
            n: 1,
          });
        }
      }
    }
  }
  return [...counts.values()].sort((a, b) => b.n - a.n).slice(0, 10);
}

// Most-filtered price ranges: recombine each apply event's min:/max: price items
// into a single range label, then count the most common.
function priceRanges(filtersJson: string[]): { label: string; n: number }[] {
  const counts = new Map<string, number>();
  const sample =
    filtersJson.length > MAX_AGGREGATION_SAMPLE
      ? filtersJson.slice(0, MAX_AGGREGATION_SAMPLE)
      : filtersJson;
  for (const raw of sample) {
    let arr: any;
    try {
      arr = JSON.parse(raw || "[]");
    } catch {
      continue;
    }
    if (!Array.isArray(arr)) continue;
    let min: number | null = null;
    let max: number | null = null;
    for (const it of arr) {
      if (!it || it.type !== "price" || typeof it.value !== "string") continue;
      const [kind, rawNum] = it.value.split(":");
      const num = parseFloat(rawNum);
      if (isNaN(num)) continue;
      if (kind === "min") min = num;
      else if (kind === "max") max = num;
    }
    let label: string;
    if (min !== null && max !== null) label = `${nf(min)} – ${nf(max)}`;
    else if (max !== null) label = `Up to ${nf(max)}`;
    else if (min !== null) label = `${nf(min)}+`;
    else continue;
    counts.set(label, (counts.get(label) ?? 0) + 1);
  }
  return [...counts.entries()]
    .map(([label, n]) => ({ label, n }))
    .sort((a, b) => b.n - a.n)
    .slice(0, 8);
}

/**
 * Aggregate the cached lifetime dump for a single date range. Pure in-memory —
 * this is what makes date-range switching feel instant.
 */
export function aggregateAnalytics(
  raw: RawData,
  start: Date,
  end: Date,
  granularity: "hour" | "day",
): Aggregated {
  const t0 = start.getTime();
  const t1 = end.getTime();
  const applies = raw.applies.filter((a) => a.t >= t0 && a.t < t1);
  const clicks = raw.clicks.filter((c) => c.t >= t0 && c.t < t1);

  // Usage-over-time series.
  const trunc = granularity === "hour" ? startOfHourUtc : startOfDayUtc;
  const seriesMap = new Map<number, number>();
  for (const a of applies) {
    const b = trunc(a.t);
    seriesMap.set(b, (seriesMap.get(b) ?? 0) + 1);
  }
  const buckets = buildBucketsUtc(
    start,
    end,
    granularity,
    [...seriesMap.entries()].map(([t, n]) => ({ t, n })),
  );

  // Totals.
  let selections = 0;
  for (const a of applies) selections += a.fc;
  const totals = { applies: applies.length, selections, clicks: clicks.length };

  // Unnest each apply's filters array → per-filter, per-option, top category.
  const filterCounts = new Map<
    string,
    { key: string; label: string; n: number }
  >();
  const optionCounts = new Map<
    string,
    { key: string; label: string; value: string; n: number }
  >();
  const categoryCounts = new Map<string, number>();
  const filtersJson: string[] = [];
  for (const a of applies) {
    filtersJson.push(a.filters);
    let arr: any;
    try {
      arr = JSON.parse(a.filters || "[]");
    } catch {
      continue;
    }
    if (!Array.isArray(arr)) continue;
    for (const it of arr) {
      if (!it || typeof it !== "object") continue;
      const key = typeof it.key === "string" ? it.key : "";
      const label = typeof it.label === "string" ? it.label : "";
      const value = typeof it.value === "string" ? it.value : "";

      const fk = key + " " + label;
      const fEntry = filterCounts.get(fk);
      if (fEntry) fEntry.n += 1;
      else filterCounts.set(fk, { key, label, n: 1 });

      const ok = key + " " + label + " " + value;
      const oEntry = optionCounts.get(ok);
      if (oEntry) oEntry.n += 1;
      else optionCounts.set(ok, { key, label, value, n: 1 });

      if (it.type === "productType" && value) {
        categoryCounts.set(value, (categoryCounts.get(value) ?? 0) + 1);
      }
    }
  }

  const perFilter = [...filterCounts.values()].sort((a, b) => b.n - a.n);
  const perOption = [...optionCounts.values()]
    .sort((a, b) => b.n - a.n)
    .slice(0, 200);
  const topCategory = [...categoryCounts.entries()]
    .map(([value, n]) => ({ value, n }))
    .sort((a, b) => b.n - a.n)
    .slice(0, 8);

  // Most-clicked products.
  const productMap = new Map<
    string,
    {
      productId: string;
      title: string;
      handle: string;
      image: string;
      n: number;
    }
  >();
  for (const c of clicks) {
    const cur = productMap.get(c.productId);
    if (cur) cur.n += 1;
    else productMap.set(c.productId, { ...c, n: 1 });
  }
  const topProducts = [...productMap.values()]
    .sort((a, b) => b.n - a.n)
    .slice(0, 10);

  return {
    buckets,
    totals,
    perFilter,
    perOption,
    together: coOccurrence(filtersJson),
    priceRanges: priceRanges(filtersJson),
    topCategory,
    topProducts,
  };
}

// ── range fetch + Redis cache ────────────────────────────────────────────────

/** Pull the selected date range's filter/click history from PostHog (2 queries). */
async function fetchRangeRaw(
  shop: string,
  start: Date,
  end: Date,
): Promise<RawData> {
  assertShopDomain(shop);
  const S = sql(shop);
  const timeFilter = buildAnalyticsTimeFilter(start, end);
  const [applyRows, clickRows] = await Promise.all([
    hogql(
      `SELECT timestamp, properties.filters AS filters, properties.filter_count AS fc ` +
        `FROM events WHERE event = '${EV_APPLY}' AND properties.shop = '${S}' AND ${timeFilter} LIMIT ${MAX_ROWS}`,
    ),
    hogql(
      `SELECT timestamp, properties.product_id AS productId, properties.product_title AS title, ` +
        `properties.product_handle AS handle, properties.product_image AS image ` +
        `FROM events WHERE event = '${EV_CLICK}' AND properties.shop = '${S}' AND ${timeFilter} LIMIT ${MAX_ROWS}`,
    ),
  ]);

  const applies: ApplyRow[] = applyRows.map((row) => ({
    t: parseTs(row[0]),
    filters: row[1] == null ? "[]" : String(row[1]),
    fc: Number(row[2]) || 0,
  }));
  const clicks: ClickRow[] = clickRows.map((row) => ({
    t: parseTs(row[0]),
    productId: String(row[1] ?? ""),
    title: String(row[2] ?? ""),
    handle: String(row[3] ?? ""),
    image: String(row[4] ?? ""),
  }));

  const truncated =
    applyRows.length >= MAX_ROWS || clickRows.length >= MAX_ROWS;
  if (truncated) {
    console.warn(
      `[pf-analytics] range pull for ${shop} hit the ${MAX_ROWS}-row cap; older events omitted.`,
    );
  }
  return { applies, clicks, fetchedAt: Date.now(), truncated };
}

async function readCached(key: string): Promise<RawData | null> {
  const redis = getRedis();
  if (!redis) return null;
  try {
    const blob = await redis.getBuffer(key);
    if (!blob) return null;
    const json = (await gunzip(blob)).toString("utf8");
    return JSON.parse(json) as RawData;
  } catch (err) {
    console.error(
      "[pf-analytics] redis read failed, falling back to PostHog:",
      err,
    );
    return null;
  }
}

async function writeCached(
  key: string,
  data: RawData,
  ttlSeconds: number,
): Promise<void> {
  const redis = getRedis();
  if (!redis) return;
  try {
    const packed = await gzip(Buffer.from(JSON.stringify(data), "utf8"));
    await redis.set(key, packed, "EX", ttlSeconds);
  } catch (err) {
    console.error("[pf-analytics] redis write failed (non-fatal):", err);
  }
}

// One PostHog pull per cache key at a time. Rapid preset clicks, the
// background warmer, and a stale-while-revalidate refresh all share the same
// in-flight promise instead of each hitting PostHog.
const inflight = new Map<string, Promise<RawData>>();

// After a 429 the key is left alone until PostHog's retry-after has passed:
// the page keeps its stale copy and stops polling instead of burning the
// (account-wide) quota on retries that will fail.
const rateLimitedUntil = new Map<string, number>();
const MIN_BACKOFF_SECONDS = 30;

export function noteRateLimited(key: string, retryAfterSeconds: number): void {
  const secs = Math.max(MIN_BACKOFF_SECONDS, retryAfterSeconds || 0);
  rateLimitedUntil.set(key, Date.now() + secs * 1000);
}

function rateLimitedFor(key: string): number {
  const until = rateLimitedUntil.get(key);
  if (!until) return 0;
  const left = until - Date.now();
  if (left <= 0) {
    rateLimitedUntil.delete(key);
    return 0;
  }
  return left;
}

function fetchAndCache(
  key: string,
  shop: string,
  start: Date,
  end: Date,
): Promise<RawData> {
  const existing = inflight.get(key);
  if (existing) return existing;

  const p = (async () => {
    const data = await fetchRangeRaw(shop, start, end);
    await writeCached(key, data, hardTtlFor(end));
    return data;
  })()
    .catch((err) => {
      if (err instanceof PostHogRateLimitError)
        noteRateLimited(key, err.retryAfterSeconds);
      throw err;
    })
    .finally(() => {
      inflight.delete(key);
    });
  inflight.set(key, p);
  return p;
}

/**
 * Return the selected range's raw dump.
 *
 * - Fresh cache hit → returned immediately.
 * - Stale cache hit → returned immediately; PostHog refresh runs in the
 *   background so the *next* request is fresh (no blocking spinner).
 * - Miss → fetched from PostHog (deduped per key) and cached.
 *
 * Redis failures never break the page — they fall through to a direct fetch.
 */
export async function getRangeRaw(
  shop: string,
  start: Date,
  end: Date,
): Promise<RawData> {
  const key = analyticsCacheKey(shop, start, end);
  const cached = await readCached(key);

  if (cached) {
    const age = Date.now() - (cached.fetchedAt || 0);
    if (age > freshMsFor(end) && rateLimitedFor(key) === 0) {
      fetchAndCache(key, shop, start, end).catch((err) => {
        console.error(
          "[pf-analytics] background refresh failed (stale copy kept):",
          err,
        );
      });
      // Tell the page, so it can say "Updating…" and re-request shortly
      // instead of silently showing numbers up to an hour old.
      return { ...cached, refreshing: true };
    }
    return cached;
  }

  const wait = rateLimitedFor(key);
  if (wait > 0) throw new PostHogRateLimitError(Math.ceil(wait / 1000));
  return fetchAndCache(key, shop, start, end);
}

// Per-shop throttle so a burst of page loads doesn't fan out repeated warms.
const lastWarmAt = new Map<string, number>();
const WARM_INTERVAL_MS = 60 * 1000;

/**
 * Fire-and-forget: pre-populate the cache for other date presets so the first
 * click on "Last day" / "Last month" etc. doesn't wait on PostHog. Only fills
 * keys that are missing entirely; stale keys are handled by getRangeRaw's
 * stale-while-revalidate. No-op without Redis (nothing to warm into).
 */
export function warmAnalyticsRanges(
  shop: string,
  ranges: { start: Date; end: Date }[],
): void {
  if (!getRedis()) return;
  const now = Date.now();
  const last = lastWarmAt.get(shop) ?? 0;
  if (now - last < WARM_INTERVAL_MS) return;
  lastWarmAt.set(shop, now);

  // Sequential so warming never competes with the foreground query for
  // PostHog capacity (and stays well inside the Query API rate limit).
  void (async () => {
    for (const { start, end } of ranges) {
      const key = analyticsCacheKey(shop, start, end);
      try {
        if (await readCached(key)) continue;
        await fetchAndCache(key, shop, start, end);
      } catch (err) {
        console.warn("[pf-analytics] warm failed for", key, err);
      }
    }
  })();
}
