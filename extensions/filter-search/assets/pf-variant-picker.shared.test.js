import { test } from "node:test";
import assert from "node:assert/strict";

await import("./pf-variant-picker.shared.js");

const api = globalThis.AcoPFVariantPicker;

test("groups selected option values in product option order", () => {
  const variants = [
    { selectedOptions: [{ name: "Color", value: "Red" }, { name: "Size", value: "S" }] },
    { selectedOptions: [{ name: "Color", value: "Blue" }, { name: "Size", value: "S" }] },
  ];

  assert.deepEqual(api.optionGroups(variants, ["Color", "Size"]), [
    { name: "Color", values: ["Red", "Blue"] },
    { name: "Size", values: ["S"] },
  ]);
});

test("groups prototype-key option names and values", () => {
  const variants = [
    {
      selectedOptions: [
        Object.assign(Object.create(null), { name: "__proto__", value: "constructor" }),
        Object.assign(Object.create(null), { name: "Color", value: "Red" }),
      ],
    },
    {
      selectedOptions: [
        Object.assign(Object.create(null), { name: "__proto__", value: "prototype" }),
        Object.assign(Object.create(null), { name: "Color", value: "Blue" }),
      ],
    },
  ];

  assert.deepEqual(api.optionGroups(variants, ["__proto__", "Color"]), [
    { name: "__proto__", values: ["constructor", "prototype"] },
    { name: "Color", values: ["Red", "Blue"] },
  ]);
});

test("chooses the available variant matching all selections", () => {
  const variants = [
    {
      id: "gid://shopify/ProductVariant/1",
      availableForSale: false,
      selectedOptions: [{ name: "Color", value: "Red" }],
    },
    {
      id: "gid://shopify/ProductVariant/2",
      availableForSale: true,
      selectedOptions: [{ name: "Color", value: "Blue" }],
    },
  ];

  assert.equal(api.matchingVariant(variants, { Color: "Blue" }).id, "gid://shopify/ProductVariant/2");
});

test("returns no variant for an unavailable combination", () => {
  const variants = [
    { id: "1", availableForSale: false, selectedOptions: [{ name: "Color", value: "Red" }] },
  ];

  assert.equal(api.matchingVariant(variants, { Color: "Red" }), null);
});

test("matches prototype-key selections against available variants", () => {
  const variants = [
    {
      id: "1",
      availableForSale: true,
      selectedOptions: [
        Object.assign(Object.create(null), { name: "__proto__", value: "constructor" }),
        Object.assign(Object.create(null), { name: "Color", value: "Red" }),
      ],
    },
  ];
  const selection = Object.create(null);
  selection.__proto__ = "constructor";
  selection.Color = "Red";

  assert.equal(api.matchingVariant(variants, selection).id, "1");
});

test("returns a stable variant key for prototype-key options", () => {
  const variantA = {
    selectedOptions: [
      Object.assign(Object.create(null), { name: "__proto__", value: "constructor" }),
      Object.assign(Object.create(null), { name: "Color", value: "Red" }),
    ],
  };
  const variantB = {
    selectedOptions: [
      Object.assign(Object.create(null), { name: "Color", value: "Red" }),
      Object.assign(Object.create(null), { name: "__proto__", value: "constructor" }),
    ],
  };

  assert.equal(api.variantKey(variantA), api.variantKey(variantB));
  assert.match(api.variantKey(variantA), /__proto__\u0000constructor/);
  assert.match(api.variantKey(variantA), /Color\u0000Red/);
});

test("does not mutate the input variants", () => {
  const variants = [
    {
      id: "1",
      availableForSale: true,
      selectedOptions: [
        Object.assign(Object.create(null), { name: "__proto__", value: "constructor" }),
        Object.assign(Object.create(null), { name: "Color", value: "Red" }),
      ],
    },
  ];
  const snapshot = JSON.stringify(variants);

  api.optionGroups(variants, ["__proto__", "Color"]);
  api.variantKey(variants[0]);
  api.matchingVariant(variants, { __proto__: "constructor", Color: "Red" });
  api.firstAvailableVariant(variants);

  assert.equal(JSON.stringify(variants), snapshot);
});

test("loads as a UMD global", async () => {
  const previous = globalThis.AcoPFVariantPicker;
  try {
    delete globalThis.AcoPFVariantPicker;
    const url = new URL("./pf-variant-picker.shared.js", import.meta.url);
    url.searchParams.set("reload", String(Date.now()));

    await import(url.href);

    assert.ok(globalThis.AcoPFVariantPicker);
    assert.equal(typeof globalThis.AcoPFVariantPicker.optionGroups, "function");
    assert.equal(typeof globalThis.AcoPFVariantPicker.variantKey, "function");
  } finally {
    if (previous) globalThis.AcoPFVariantPicker = previous;
    else delete globalThis.AcoPFVariantPicker;
  }
});

test("prefers the first available variant", () => {
  const variants = [
    { id: "1", availableForSale: false },
    { id: "2", availableForSale: true },
  ];

  assert.equal(api.firstAvailableVariant(variants).id, "2");
});

test("checks option availability against the tentative complete selection", () => {
  const variants = [
    {
      id: "red-small",
      availableForSale: true,
      selectedOptions: [
        { name: "Color", value: "Red" },
        { name: "Size", value: "S" },
      ],
    },
    {
      id: "blue-medium",
      availableForSale: true,
      selectedOptions: [
        { name: "Color", value: "Blue" },
        { name: "Size", value: "M" },
      ],
    },
  ];

  assert.equal(
    api.optionValueAvailable(variants, { Color: "Red", Size: "S" }, "Size", "M"),
    false,
  );
  assert.equal(
    api.optionValueAvailable(variants, { Color: "Red", Size: "S" }, "Size", "S"),
    true,
  );
});

test("accepts only complete positive integer quantity text", () => {
  assert.equal(api.parseQuantity("1"), 1);
  assert.equal(api.parseQuantity("200"), 200);

  for (const invalid of ["", "abc", "1.5", "0", "-1", "2e2", "2items"]) {
    assert.equal(api.parseQuantity(invalid), null, `${invalid} should be invalid`);
  }
});
