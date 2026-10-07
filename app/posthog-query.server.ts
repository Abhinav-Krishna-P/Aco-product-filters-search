/**
 * PostHog read-side helper.
 *
 * The storefront now captures filter-usage events *directly* to PostHog Cloud
 * (see extensions/.../pf-filters.js). The admin analytics page reads them back
 * out with HogQL via PostHog's Query API — no Postgres involved.
 *
 * This uses a *personal* API key (phx_...) which is private and must never reach
 * the browser. It only runs inside Remix loaders/actions (server-side).
 */

const API_HOST = (
  process.env.POSTHOG_API_HOST || "https://us.posthog.com"
).replace(/\/$/, "");
const PROJECT_ID = process.env.POSTHOG_PROJECT_ID;
const PERSONAL_KEY = process.env.POSTHOG_PERSONAL_API_KEY;

export function posthogQueryConfigured(): boolean {
  return Boolean(PROJECT_ID && PERSONAL_KEY);
}

/**
 * Escape a value for safe inline use inside a single-quoted HogQL string.
 * Handles both backslashes and single quotes — the two characters that can
 * break out of a ClickHouse/HogQL string literal.
 */
export function sql(value: string): string {
  return String(value).replace(/\\/g, "\\\\").replace(/'/g, "''");
}

/**
 * Validate that `shop` is a legitimate Shopify domain before it's interpolated
 * into any query string. Rejects anything that isn't `<subdomain>.myshopify.com`.
 * This is a defence-in-depth check — session.shop is trusted from Shopify auth,
 * but guarding it here means a bug elsewhere can't open an injection path.
 */
const SHOPIFY_DOMAIN_RE = /^[a-z0-9][a-z0-9-]*\.myshopify\.com$/;

export function assertShopDomain(shop: string): string {
  const s = String(shop).toLowerCase().trim();
  if (!SHOPIFY_DOMAIN_RE.test(s)) {
    throw new Error(
      `Invalid shop domain for analytics query: "${s.slice(0, 80)}"`,
    );
  }
  return s;
}

/** Format a Date as a UTC 'YYYY-MM-DD HH:MM:SS' literal for HogQL comparisons. */
export function tsUtc(d: Date): string {
  return d.toISOString().slice(0, 19).replace("T", " ");
}

/**
 * Run a HogQL query and return the raw result rows (each row is an array of
 * column values, in SELECT order). Throws on misconfiguration or API error so
 * callers can degrade gracefully.
 */
// Hard ceiling on a single Query API call. Without it a hung PostHog request
// leaves the analytics skeleton spinning indefinitely.
const QUERY_TIMEOUT_MS = 60_000;

/** PostHog returned 429: the per-project Query API quota is exhausted. */
export class PostHogRateLimitError extends Error {
  retryAfterSeconds: number;
  constructor(retryAfterSeconds: number) {
    super(`PostHog query rate limit reached; retry in ${retryAfterSeconds}s`);
    this.name = "PostHogRateLimitError";
    this.retryAfterSeconds = retryAfterSeconds;
  }
}

export async function hogql(query: string): Promise<any[][]> {
  if (!posthogQueryConfigured()) {
    throw new Error(
      "PostHog Query API is not configured — set POSTHOG_PROJECT_ID and POSTHOG_PERSONAL_API_KEY.",
    );
  }

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), QUERY_TIMEOUT_MS);
  let res: Response;
  try {
    res = await fetch(`${API_HOST}/api/projects/${PROJECT_ID}/query/`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${PERSONAL_KEY}`,
      },
      // Reuse PostHog's query-result cache when possible, and only recompute
      // synchronously when the bounded query is stale or missing from cache.
      body: JSON.stringify({
        query: { kind: "HogQLQuery", query },
        refresh: "blocking",
      }),
      signal: controller.signal,
    });
  } catch (err) {
    if (controller.signal.aborted) {
      throw new Error(
        `PostHog query timed out after ${QUERY_TIMEOUT_MS / 1000}s`,
      );
    }
    throw err;
  } finally {
    clearTimeout(timer);
  }

  if (res.status === 429) {
    const retry = Number(res.headers.get("retry-after")) || 60;
    throw new PostHogRateLimitError(retry);
  }
  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw new Error(
      `PostHog query failed (${res.status}): ${text.slice(0, 400)}`,
    );
  }

  const json: any = await res.json();
  return (json?.results ?? []) as any[][];
}
