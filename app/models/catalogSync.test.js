import { test } from "node:test";
import assert from "node:assert/strict";
import {
  productWebhookValues,
  planCatalogAdditions,
  needsRecheck,
  createCatalogWebhookHandler,
  createRecheckScheduler,
  productFingerprint,
} from "./catalogSync.shared.js";

// REST-shaped products/update payload, trimmed by include_fields.
const product = (over = {}) => ({
  id: 1,
  status: "active",
  vendor: "Acme",
  product_type: "Shirts",
  tags: "cotton, summer",
  options: [{ name: "Color", values: ["Red", "Blue"] }],
  variants: [{ price: "19.99" }, { price: "24.50" }],
  updated_at: "2026-10-14T10:00:00Z",
  ...over,
});

const existing = (over = {}) => ({
  filters: [
    { key: "type", values: [{ raw: "Shirts", stale: false }] },
    { key: "vendor", values: [{ raw: "Acme", stale: false }] },
    {
      key: "tag",
      values: [
        { raw: "cotton", stale: false },
        { raw: "summer", stale: false },
      ],
    },
    {
      key: "opt_Color",
      values: [
        { raw: "Red", stale: false },
        { raw: "Blue", stale: false },
      ],
    },
  ],
  price: { min: 5, max: 100 },
  ...over,
});

test("productWebhookValues reads vendor, type, tags, options and price range", () => {
  const v = productWebhookValues(product());
  assert.equal(v.active, true);
  assert.deepEqual(v.vendors, ["Acme"]);
  assert.deepEqual(v.types, ["Shirts"]);
  assert.deepEqual(v.tags, ["cotton", "summer"]);
  assert.deepEqual(v.options, [{ name: "Color", values: ["Red", "Blue"] }]);
  assert.equal(v.priceMin, 19.99);
  assert.equal(v.priceMax, 24.5);
});

test("productWebhookValues: draft or archived products are not active", () => {
  assert.equal(
    productWebhookValues(product({ status: "draft" })).active,
    false,
  );
  assert.equal(
    productWebhookValues(product({ status: "archived" })).active,
    false,
  );
});

test("productWebhookValues tolerates empty tags, no options and missing prices", () => {
  const v = productWebhookValues(
    product({ tags: "", options: [], variants: [] }),
  );
  assert.deepEqual(v.tags, []);
  assert.deepEqual(v.options, []);
  assert.equal(v.priceMin, null);
  assert.equal(v.priceMax, null);
});

test("nothing new: an ordinary edit changes no filter value", () => {
  const plan = planCatalogAdditions(
    existing(),
    productWebhookValues(product()),
  );
  assert.equal(plan.changed, false);
});

test("a new tag, vendor and option value are added; the price range widens", () => {
  const plan = planCatalogAdditions(
    existing(),
    productWebhookValues(
      product({
        vendor: "Globex",
        tags: "cotton, winter",
        options: [{ name: "Color", values: ["Red", "Green"] }],
        variants: [{ price: "2.00" }, { price: "150.00" }],
      }),
    ),
  );
  assert.equal(plan.changed, true);
  assert.deepEqual(plan.addValues, {
    vendor: ["Globex"],
    tag: ["winter"],
    opt_Color: ["Green"],
  });
  assert.deepEqual(plan.price, { min: 2, max: 150 });
});

test("a value marked stale comes back when a product uses it again", () => {
  const ex = existing();
  ex.filters[2].values.push({ raw: "winter", stale: true });
  const plan = planCatalogAdditions(
    ex,
    productWebhookValues(product({ tags: "winter" })),
  );
  assert.equal(plan.changed, true);
  assert.deepEqual(plan.unstale, { tag: ["winter"] });
  assert.deepEqual(plan.addValues, {});
});

test("a brand-new option name becomes a new option filter", () => {
  const plan = planCatalogAdditions(
    existing(),
    productWebhookValues(
      product({ options: [{ name: "Size", values: ["S", "M"] }] }),
    ),
  );
  assert.deepEqual(plan.newOptionFilters, [
    { name: "Size", values: ["S", "M"] },
  ]);
  assert.equal(plan.changed, true);
});

test("prices inside the current range leave it alone", () => {
  const plan = planCatalogAdditions(
    existing(),
    productWebhookValues(product()),
  );
  assert.equal(plan.price, null);
});

test("a shop that never ran Detect gets no incremental changes", () => {
  const plan = planCatalogAdditions(
    { filters: [], price: null },
    productWebhookValues(product()),
  );
  assert.equal(plan.changed, false);
});

test("needsRecheck: deletes, products leaving active, and collection changes", () => {
  assert.equal(needsRecheck("PRODUCTS_DELETE", { id: 1 }), true);
  assert.equal(
    needsRecheck("PRODUCTS_UPDATE", product({ status: "draft" })),
    true,
  );
  assert.equal(needsRecheck("COLLECTIONS_CREATE", { id: 1 }), true);
  assert.equal(needsRecheck("COLLECTIONS_UPDATE", { id: 1 }), true);
  assert.equal(needsRecheck("COLLECTIONS_DELETE", { id: 1 }), true);
  assert.equal(needsRecheck("PRODUCTS_UPDATE", product()), false);
  assert.equal(needsRecheck("PRODUCTS_CREATE", product()), false);
});

function fakeDeps(ex = existing()) {
  const calls = { applied: [], republished: 0, rechecks: [], bumps: [] };
  const fingerprints = new Map();
  return {
    calls,
    deps: {
      loadExisting: async () => ex,
      applyPlan: async (_shop, plan) => {
        calls.applied.push(plan);
      },
      republish: async () => {
        calls.republished++;
      },
      scheduleRecheck: (shop) => {
        calls.rechecks.push(shop);
      },
      fingerprintChanged: async (_shop, id, fp) => {
        const prev = fingerprints.get(id);
        fingerprints.set(id, fp);
        return prev !== fp;
      },
      bumpCatalogVersion: (shop) => {
        calls.bumps.push(shop);
      },
    },
  };
}

test("webhook handler: a new value is applied and the storefront republished once", async () => {
  const { calls, deps } = fakeDeps();
  const handle = createCatalogWebhookHandler(deps);
  await handle({
    shop: "s.myshopify.com",
    topic: "PRODUCTS_UPDATE",
    payload: product({ tags: "new-tag" }),
  });
  assert.equal(calls.applied.length, 1);
  assert.equal(calls.republished, 1);
  assert.deepEqual(calls.rechecks, []);
});

test("webhook handler: an edit that changes no filter value writes nothing", async () => {
  const { calls, deps } = fakeDeps();
  const handle = createCatalogWebhookHandler(deps);
  await handle({
    shop: "s.myshopify.com",
    topic: "PRODUCTS_UPDATE",
    payload: product(),
  });
  assert.equal(calls.applied.length, 0);
  assert.equal(calls.republished, 0);
  assert.deepEqual(calls.rechecks, []);
});

test("webhook handler: a draft product schedules a re-check and adds nothing", async () => {
  const { calls, deps } = fakeDeps();
  const handle = createCatalogWebhookHandler(deps);
  await handle({
    shop: "s.myshopify.com",
    topic: "PRODUCTS_UPDATE",
    payload: product({ status: "draft", tags: "draft-only" }),
  });
  assert.equal(calls.applied.length, 0);
  assert.deepEqual(calls.rechecks, ["s.myshopify.com"]);
});

test("webhook handler: deletes and collection changes schedule a re-check", async () => {
  const { calls, deps } = fakeDeps();
  const handle = createCatalogWebhookHandler(deps);
  await handle({ shop: "a", topic: "PRODUCTS_DELETE", payload: { id: 1 } });
  await handle({ shop: "b", topic: "COLLECTIONS_UPDATE", payload: { id: 2 } });
  assert.deepEqual(calls.rechecks, ["a", "b"]);
});

test("webhook handler: a shop that never ran Detect is left alone", async () => {
  const { calls, deps } = fakeDeps({ filters: [], price: null });
  const handle = createCatalogWebhookHandler(deps);
  await handle({ shop: "s", topic: "PRODUCTS_DELETE", payload: { id: 1 } });
  await handle({ shop: "s", topic: "PRODUCTS_CREATE", payload: product() });
  assert.equal(calls.applied.length, 0);
  assert.deepEqual(calls.rechecks, []);
});

function fakeClock() {
  let now = 0;
  const timers = [];
  return {
    now: () => now,
    setTimer: (fn, ms) => {
      const t = { at: now + ms, fn, cancelled: false };
      timers.push(t);
      return t;
    },
    clearTimer: (t) => {
      if (t) t.cancelled = true;
    },
    advance: async (ms) => {
      const end = now + ms;
      for (;;) {
        const due = timers
          .filter((t) => !t.cancelled && !t.fired && t.at <= end)
          .sort((a, b) => a.at - b.at)[0];
        if (!due) break;
        now = due.at;
        due.fired = true;
        await due.fn();
      }
      now = end;
    },
  };
}

test("re-check scheduler: a burst of events runs one re-check after the last one", async () => {
  const clock = fakeClock();
  const runs = [];
  const schedule = createRecheckScheduler({
    delayMs: 1000,
    run: async (shop) => {
      runs.push([shop, clock.now()]);
    },
    ...clock,
  });
  schedule("s");
  await clock.advance(400);
  schedule("s");
  await clock.advance(400);
  schedule("s");
  await clock.advance(999);
  assert.deepEqual(runs, []);
  await clock.advance(1);
  assert.deepEqual(runs, [["s", 1800]]);
  await clock.advance(5000);
  assert.equal(runs.length, 1);
});

test("re-check scheduler: shops are debounced independently", async () => {
  const clock = fakeClock();
  const runs = [];
  const schedule = createRecheckScheduler({
    delayMs: 1000,
    run: async (shop) => {
      runs.push(shop);
    },
    ...clock,
  });
  schedule("a");
  schedule("b");
  await clock.advance(1000);
  assert.deepEqual(runs.sort(), ["a", "b"]);
});

test("re-check scheduler: a failing run is logged and does not block later runs", async () => {
  const clock = fakeClock();
  let calls = 0;
  const schedule = createRecheckScheduler({
    delayMs: 10,
    run: async () => {
      calls++;
      if (calls === 1) throw new Error("boom");
    },
    onError: () => {},
    ...clock,
  });
  schedule("s");
  await clock.advance(10);
  schedule("s");
  await clock.advance(10);
  assert.equal(calls, 2);
});

test("productFingerprint ignores updated_at and tag order, tracks filter fields", () => {
  const base = productFingerprint(product());
  assert.equal(base, productFingerprint(product({ updated_at: "2027-01-01T00:00:00Z" })));
  assert.equal(base, productFingerprint(product({ tags: "summer, cotton" })));
  assert.notEqual(base, productFingerprint(product({ tags: "cotton" })));
  assert.notEqual(base, productFingerprint(product({ variants: [{ price: "9.00" }] })));
  assert.notEqual(base, productFingerprint(product({ status: "draft" })));
  assert.notEqual(base, productFingerprint(product({ vendor: "Other" })));
});

test("catalog version: a new product bumps it so storefront snapshots refresh", async () => {
  const { calls, deps } = fakeDeps();
  const handle = createCatalogWebhookHandler(deps);
  await handle({ shop: "s", topic: "PRODUCTS_CREATE", payload: product({ id: 99 }) });
  assert.deepEqual(calls.bumps, ["s"]);
});

test("catalog version: an update that changes no filter field does not bump", async () => {
  const { calls, deps } = fakeDeps();
  const handle = createCatalogWebhookHandler(deps);
  await handle({ shop: "s", topic: "PRODUCTS_UPDATE", payload: product({ id: 5 }) });
  calls.bumps.length = 0;
  // e.g. stock or description changed: same filter fields, new updated_at
  await handle({
    shop: "s",
    topic: "PRODUCTS_UPDATE",
    payload: product({ id: 5, updated_at: "2026-10-14T11:00:00Z" }),
  });
  assert.deepEqual(calls.bumps, []);
});

test("catalog version: a price or tag change bumps it", async () => {
  const { calls, deps } = fakeDeps();
  const handle = createCatalogWebhookHandler(deps);
  await handle({ shop: "s", topic: "PRODUCTS_UPDATE", payload: product({ id: 5 }) });
  calls.bumps.length = 0;
  await handle({
    shop: "s",
    topic: "PRODUCTS_UPDATE",
    payload: product({ id: 5, variants: [{ price: "11.00" }] }),
  });
  assert.deepEqual(calls.bumps, ["s"]);
});

test("catalog version: deletes and collection changes bump it", async () => {
  const { calls, deps } = fakeDeps();
  const handle = createCatalogWebhookHandler(deps);
  await handle({ shop: "a", topic: "PRODUCTS_DELETE", payload: { id: 1 } });
  await handle({ shop: "b", topic: "COLLECTIONS_UPDATE", payload: { id: 2 } });
  assert.deepEqual(calls.bumps, ["a", "b"]);
});

test("catalog version: shops that never ran Detect are not bumped", async () => {
  const { calls, deps } = fakeDeps({ filters: [], price: null });
  const handle = createCatalogWebhookHandler(deps);
  await handle({ shop: "s", topic: "PRODUCTS_CREATE", payload: product() });
  assert.deepEqual(calls.bumps, []);
});
