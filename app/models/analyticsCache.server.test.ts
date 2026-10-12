import { test } from "node:test";
import assert from "node:assert/strict";
import zlib from "node:zlib";

// Fake Redis holding one gzipped cache entry; installed before the cache
// module asks getRedis() for a client.
const store = new Map<string, Buffer>();
(globalThis as { redisGlobal?: unknown }).redisGlobal = {
  getBuffer: async (key: string) => store.get(key) ?? null,
  set: async () => "OK",
};

const { getRangeRaw } = await import("../analytics-cache.server.ts");
const { analyticsCacheKey } = await import("../analytics-query.shared.js");

const SHOP = "test-shop.myshopify.com";

function seed(start: Date, end: Date, fetchedAt: number) {
  const raw = { applies: [], clicks: [], fetchedAt, truncated: false };
  store.set(
    analyticsCacheKey(SHOP, start, end),
    zlib.gzipSync(Buffer.from(JSON.stringify(raw))),
  );
}

test("a stale open range is served from cache and flagged as refreshing", async () => {
  const end = new Date();
  const start = new Date(end.getTime() - 60 * 60 * 1000);
  seed(start, end, Date.now() - 10 * 60 * 1000); // 10 min old > 3 min fresh

  const raw = await getRangeRaw(SHOP, start, end);
  assert.equal(raw.refreshing, true);
});

test("a fresh cache hit is not flagged", async () => {
  const end = new Date(Date.now() + 1000);
  const start = new Date(end.getTime() - 60 * 60 * 1000);
  seed(start, end, Date.now());

  const raw = await getRangeRaw(SHOP, start, end);
  assert.equal(raw.refreshing, undefined);
});

test("while PostHog is rate-limited a stale range is served without a refresh", async () => {
  const { noteRateLimited } = await import("../analytics-cache.server.ts");
  const end = new Date();
  const start = new Date(end.getTime() - 2 * 60 * 60 * 1000);
  seed(start, end, Date.now() - 10 * 60 * 1000);
  noteRateLimited(analyticsCacheKey(SHOP, start, end), 60);
  const raw = await getRangeRaw(SHOP, start, end);
  assert.equal(raw.refreshing, undefined);
});
