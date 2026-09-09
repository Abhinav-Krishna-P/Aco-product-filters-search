import { test } from "node:test";
import { readFileSync } from "node:fs";
import assert from "node:assert/strict";
import {
  alreadyInjected,
  prependInject,
  injectSearch,
  stripInject,
  pickFirstExisting,
  COLLECTION_SECTION_FILES,
  SEARCH_SECTION_FILES,
  injectBlock,
  normalizeThemeFilePath,
  injectBefore,
  nativeElementCandidates,
} from "./themeInject.shared.js";

test("prependInject is idempotent and marked", () => {
  const original = "{% comment %} theme {% endcomment %}\n<div>grid</div>\n";
  const once = prependInject(original);
  assert.match(once, /ACO_PF_INJECT_START/);
  assert.match(once, /render 'aco-product-filters'/);
  assert.ok(once.endsWith(original) || once.includes("<div>grid</div>"));
  assert.equal(prependInject(once), once);
  assert.equal(alreadyInjected(once), true);
  assert.equal(alreadyInjected(original), false);
});

test("stripInject restores the original section", () => {
  const original =
    "{{ 'template-collection.css' | asset_url | stylesheet_tag }}\n";
  const injected = prependInject(original);
  assert.equal(stripInject(injected), original);
  assert.equal(stripInject(original), original);
});

test("pickFirstExisting prefers Dawn collection and search section files", () => {
  const files = new Set([
    "layout/theme.liquid",
    "sections/main-collection-product-grid.liquid",
    "sections/main-search.liquid",
    "snippets/card-product.liquid",
  ]);
  assert.equal(
    pickFirstExisting(COLLECTION_SECTION_FILES, files),
    "sections/main-collection-product-grid.liquid",
  );
  assert.equal(
    pickFirstExisting(SEARCH_SECTION_FILES, files),
    "sections/main-search.liquid",
  );
});

test("pickFirstExisting detects Horizon / Dwell collection and search sections", () => {
  const files = new Set([
    "sections/main-collection.liquid",
    "sections/search-header.liquid",
    "sections/search-results.liquid",
  ]);
  assert.equal(
    pickFirstExisting(COLLECTION_SECTION_FILES, files),
    "sections/main-collection.liquid",
  );
  assert.equal(
    pickFirstExisting(SEARCH_SECTION_FILES, files),
    "sections/search-results.liquid",
  );
});

test("pickFirstExisting falls back to vintage templates", () => {
  const files = new Set([
    "templates/collection.liquid",
    "templates/search.liquid",
  ]);
  assert.equal(
    pickFirstExisting(COLLECTION_SECTION_FILES, files),
    "templates/collection.liquid",
  );
  assert.equal(
    pickFirstExisting(SEARCH_SECTION_FILES, files),
    "templates/search.liquid",
  );
});

test("injectBlock is a closed comment pair", () => {
  const block = injectBlock();
  assert.match(block, /ACO_PF_INJECT_START/);
  assert.match(block, /ACO_PF_INJECT_END/);
});

test("injectSearch places filters below the native search header", () => {
  const original = `
<div class="template-search__header">
  <main-search><form role="search"></form></main-search>
</div>
<div id="ProductGridContainer"><ul id="product-grid"></ul></div>`;
  const injected = injectSearch(original);
  assert.ok(
    injected.indexOf("ACO_PF_INJECT_START") <
      injected.indexOf('id="ProductGridContainer"'),
  );
  assert.ok(
    injected.indexOf("ACO_PF_INJECT_START") > injected.indexOf("<main-search>"),
  );
});

test("injectSearch relocates an existing top-of-section injection", () => {
  const original = `
<div class="template-search__header">
  <main-search><form role="search"></form></main-search>
</div>
<div id="ProductGridContainer"><ul id="product-grid"></ul></div>`;
  const migrated = injectSearch(prependInject(original));
  assert.ok(
    migrated.indexOf("ACO_PF_INJECT_START") > migrated.indexOf("<main-search>"),
  );
  assert.equal(injectSearch(migrated), migrated);
});

test("normalizeThemeFilePath normalizes custom paths", () => {
  assert.equal(
    normalizeThemeFilePath("main-collection"),
    "sections/main-collection.liquid",
  );
  assert.equal(
    normalizeThemeFilePath("custom-collection.liquid"),
    "sections/custom-collection.liquid",
  );
  assert.equal(
    normalizeThemeFilePath("sections/custom-search.liquid"),
    "sections/custom-search.liquid",
  );
  assert.equal(
    normalizeThemeFilePath("/sections/custom-search.liquid"),
    "sections/custom-search.liquid",
  );
  assert.equal(
    normalizeThemeFilePath("templates/search.liquid"),
    "templates/search.liquid",
  );
  assert.equal(normalizeThemeFilePath(""), "");
  assert.equal(normalizeThemeFilePath(null), "");
});

const fx = (p) =>
  readFileSync(new URL(`./__fixtures__/themes/${p}`, import.meta.url), "utf8");

test("injectBefore inserts the block before the first real occurrence of the marker", () => {
  const src =
    "{% comment %}<xo-filters>{% endcomment %}\n<div>\n<xo-filters-top></xo-filters-top>\n<xo-filters>…</xo-filters></div>";
  const out = injectBefore(src, "<xo-filters>");
  assert.equal(out.found, true);
  const idx = out.body.indexOf("ACO_PF_INJECT_START");
  assert.ok(
    idx > out.body.indexOf("<xo-filters-top>"),
    "must not use the commented occurrence",
  );
  assert.ok(idx < out.body.lastIndexOf("<xo-filters>"));
  assert.equal(stripInject(out.body), src);
});

test("injectBefore falls back to prepend when the marker is missing or empty", () => {
  assert.deepEqual(injectBefore("<p>x</p>", "nope"), {
    body: prependInject("<p>x</p>"),
    found: false,
  });
  assert.equal(injectBefore("<p>x</p>", "").found, false);
});

test("injectBefore is idempotent", () => {
  const once = injectBefore("<a></a><b></b>", "<b>").body;
  assert.equal(injectBefore(once, "<b>").body, once);
});

test("nativeElementCandidates lists the theme's own elements after the inject block", () => {
  const src = fx("shopilaunch/main-collection.liquid");
  const sel = nativeElementCandidates(prependInject(src)).map(
    (c) => c.selector,
  );
  assert.ok(sel.includes("xo-filters-top"), sel.join(","));
  assert.ok(sel.includes("xo-filters"), sel.join(","));
  assert.ok(!sel.includes("div"));
});

test("nativeElementCandidates ignores templated classes and noise tags", () => {
  const sel = nativeElementCandidates(
    '<div class="{{ cls }}"><script></script><ul id="grid"><li class="x"></li></ul><span class="s"></span></div>',
  ).map((c) => c.selector);
  assert.deepEqual(sel, ["#grid"]);
});

test("injectBefore uses the given fallback when the marker is missing", () => {
  const src =
    '<div class="template-search__header"><h1>Search</h1></div><div id="ProductGridContainer"></div>';
  const out = injectBefore(src, "nope", injectSearch);
  assert.equal(out.found, false);
  assert.equal(out.body, injectSearch(src));
});

test("nativeElementCandidates skips class tokens cut by Liquid output", () => {
  assert.deepEqual(
    nativeElementCandidates('<div class="grid-{{ x }} foo"></div>'),
    [],
  );
  assert.deepEqual(
    nativeElementCandidates('<div class="foo grid-{{ x }}"></div>').map(
      (c) => c.selector,
    ),
    ["div.foo"],
  );
});
