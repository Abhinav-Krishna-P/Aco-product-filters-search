import { test } from "node:test";
import assert from "node:assert/strict";
import {
  analyticsCacheKey,
  buildAnalyticsTimeFilter,
} from "./analytics-query.shared.js";

const START = new Date("2026-08-01T00:00:00.000Z");
const END = new Date("2026-09-01T00:00:00.000Z");

test("buildAnalyticsTimeFilter bounds events to the requested UTC range", () => {
  assert.equal(
    buildAnalyticsTimeFilter(START, END),
    "timestamp >= toDateTime('2026-08-01 00:00:00', 'UTC') AND timestamp < toDateTime('2026-09-01 00:00:00', 'UTC')",
  );
});

test("analyticsCacheKey separates date ranges for the same shop", () => {
  const current = analyticsCacheKey("example.myshopify.com", START, END);
  const previous = analyticsCacheKey(
    "example.myshopify.com",
    new Date("2026-07-01T00:00:00.000Z"),
    START,
  );

  assert.notEqual(current, previous);
  assert.match(current, /example\.myshopify\.com/);
  assert.match(current, /2026-08-01T00:00:00\.000Z/);
  assert.match(current, /2026-09-01T00:00:00\.000Z/);
});
