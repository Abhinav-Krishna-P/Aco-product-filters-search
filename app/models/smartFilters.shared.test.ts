import { test } from "node:test";
import assert from "node:assert/strict";
import {
  matchSmartFilters,
  type SmartFilterGroup,
} from "./smartFilters.shared";

const SAMPLE: SmartFilterGroup[] = [
  {
    key: "available",
    paramName: "pf_available",
    label: "Availability",
    values: [{ raw: "1", label: "In stock only" }],
  },
  {
    key: "price",
    paramName: "pf_price_min",
    label: "Price",
    values: [],
  },
  {
    key: "opt_Color",
    paramName: "pf_opt_Color",
    label: "Color",
    values: [
      { raw: "Red", label: "Red" },
      { raw: "Blue", label: "Blue" },
      { raw: "navy blue", label: "Navy Blue" },
    ],
  },
  {
    key: "opt_Size",
    paramName: "pf_opt_Size",
    label: "Size",
    values: [
      { raw: "S", label: "S" },
      { raw: "M", label: "M" },
      { raw: "L", label: "L" },
      { raw: "XL", label: "XL" },
    ],
  },
];

test("matchSmartFilters matches color and size tokens", () => {
  const result = matchSmartFilters({
    query: "red L",
    filters: SAMPLE,
  });
  assert.deepEqual(result.selections.pf_opt_Color, ["Red"]);
  assert.deepEqual(result.selections.pf_opt_Size, ["L"]);
  assert.ok(result.matched.includes("Red"));
  assert.ok(result.matched.includes("L"));
  assert.equal(result.unmatched.length, 0);
  assert.equal(result.message, "");
});

test("matchSmartFilters matches multi-word labels first", () => {
  const result = matchSmartFilters({
    query: "navy blue shoes",
    filters: SAMPLE,
  });
  assert.deepEqual(result.selections.pf_opt_Color, ["navy blue"]);
  assert.ok(result.unmatched.includes("shoes"));
  assert.match(result.message, /shoes/i);
});

test("matchSmartFilters handles under price", () => {
  const result = matchSmartFilters({
    query: "under 50",
    filters: SAMPLE,
  });
  assert.equal(result.price?.max, "50");
  assert.ok(result.matched.some((m) => /under/i.test(m)));
  assert.equal(result.unmatched.length, 0);
});

test("matchSmartFilters handles between price range", () => {
  const result = matchSmartFilters({
    query: "between 20 and 80",
    filters: SAMPLE,
  });
  assert.equal(result.price?.min, "20");
  assert.equal(result.price?.max, "80");
});

test("matchSmartFilters handles in stock", () => {
  const result = matchSmartFilters({
    query: "red in stock",
    filters: SAMPLE,
  });
  assert.deepEqual(result.selections.pf_available, ["1"]);
  assert.deepEqual(result.selections.pf_opt_Color, ["Red"]);
  assert.ok(result.matched.includes("In stock"));
});

test("matchSmartFilters reports unmatched leftovers", () => {
  const result = matchSmartFilters({
    query: "turquoise xyz",
    filters: SAMPLE,
  });
  assert.equal(Object.keys(result.selections).length, 0);
  assert.ok(result.unmatched.includes("turquoise"));
  assert.ok(result.unmatched.includes("xyz"));
  assert.equal(result.message, "No filters matched your search.");
});

test("matchSmartFilters empty query", () => {
  const result = matchSmartFilters({ query: "  ", filters: SAMPLE });
  assert.equal(result.message, "Enter a search to apply filters.");
  assert.equal(Object.keys(result.selections).length, 0);
});
