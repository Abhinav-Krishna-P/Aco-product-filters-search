import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

/**
 * Guard against stored XSS on the storefront: every merchant-controlled config
 * string that the Liquid files print must go through `| escape`. These are
 * file-content checks because the snippets run inside Shopify, not here.
 */

const files = {
  group: "extensions/filter-search/snippets/pf-config-group.liquid",
  sort: "extensions/filter-search/snippets/pf-sort.liquid",
  grid: "extensions/filter-search/snippets/pf-product-grid.liquid",
  inject: "app/theme-inject/aco-product-filters.liquid",
};

const read = (p) => readFileSync(p, "utf8");

/** `{{ name }}` or `{{ name | filter }}` without `escape` anywhere in the tag. */
function unescapedOutputs(src, names) {
  const hits = [];
  const re = /\{\{-?\s*([^}]*?)\s*-?\}\}/g;
  let m;
  while ((m = re.exec(src))) {
    const expr = m[1];
    const name = expr.split("|")[0].trim();
    if (!names.includes(name)) continue;
    if (/\|\s*escape\b/.test(expr) || /\|\s*json\b/.test(expr)) continue;
    hits.push(m[0]);
  }
  return hits;
}

test("filter group snippet escapes labels and raw values", () => {
  const src = read(files.group);
  assert.deepEqual(
    unescapedOutputs(src, ["f.label", "vm.label", "vm.raw", "v"]),
    [],
  );
});

test("sort snippet escapes option labels", () => {
  const src = read(files.sort);
  assert.deepEqual(unescapedOutputs(src, ["opt.label", "pf_sort.label"]), []);
});

test("product grid snippet escapes button text and config-derived attributes", () => {
  const src = read(files.grid);
  assert.deepEqual(
    unescapedOutputs(src, ["atc_text", "buy_text", "ss_mode", "badge_style"]),
    [],
  );
});

test("inject entry point escapes the heading and passes the search term", () => {
  const src = read(files.inject);
  // customCss is intentionally raw inside <style>; it is sanitized server-side
  // (sanitizeCustomCss) so it can never close the block.
  assert.deepEqual(unescapedOutputs(src, ["heading"]), []);
  assert.match(src, /data-terms="\{\{ search\.terms \| escape \}\}"/);
});
