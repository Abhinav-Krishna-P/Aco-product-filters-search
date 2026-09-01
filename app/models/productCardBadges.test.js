import { test } from "node:test";
import assert from "node:assert/strict";
import { normalizeProductCard } from "./filterConfig.shared.ts";

test("Sale and Out of stock badges can both be on (a card only ever shows one)", () => {
  const pc = normalizeProductCard({ showSaleBadge: true, showSoldOutBadge: true });
  assert.equal(pc.showSaleBadge, true);
  assert.equal(pc.showSoldOutBadge, true);
});

test("each badge keeps its own text and colours", () => {
  const pc = normalizeProductCard({
    showSaleBadge: true,
    showSoldOutBadge: true,
    saleBadgeText: "Deal",
    saleBadgeColor: "#ff0000",
    soldOutBadgeText: "Gone",
    soldOutBadgeColor: "#000000",
  });
  assert.equal(pc.saleBadgeText, "Deal");
  assert.equal(pc.saleBadgeColor, "#ff0000");
  assert.equal(pc.soldOutBadgeText, "Gone");
  assert.equal(pc.soldOutBadgeColor, "#000000");
});
