import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import {
  findProductLoops,
  transformSectionSource,
  transformSnippetSource,
  renderedSnippetNames,
  loopSnippetClosure,
  cleanSchema,
  sectionEntryFromTemplate,
  settingsFromSettingsData,
  bakeDefaults,
  buildSearchTemplateJson,
  buildSearchTemplateLiquid,
  sectionIdsFromHtml,
  inputsHash,
  MIRROR_FILES,
  MIRROR_KEYS,
  MIRROR_VIEW,
  CARD_MARK_OPEN,
  CARD_MARK_CLOSE,
} from "./themeCardMirror.shared.js";

const fx = (p) =>
  readFileSync(new URL(`./__fixtures__/themes/${p}`, import.meta.url), "utf8");

function countTag(src, name) {
  return (src.match(new RegExp("\\{%-?\\s*" + name + "\\b", "g")) || []).length;
}

test("constants are the agreed theme file names", () => {
  assert.equal(
    MIRROR_FILES.collection,
    "sections/aco-pf-theme-cards-collection.liquid",
  );
  assert.equal(
    MIRROR_FILES.search,
    "sections/aco-pf-theme-cards-search.liquid",
  );
  assert.equal(MIRROR_FILES.templateJson, "templates/search.aco-pf.json");
  assert.equal(MIRROR_FILES.templateLiquid, "templates/search.aco-pf.liquid");
  assert.deepEqual(MIRROR_KEYS, {
    collection: "aco-pf-collection",
    search: "aco-pf-search",
  });
  assert.equal(MIRROR_VIEW, "aco-pf");
  assert.equal(CARD_MARK_OPEN, "<!--aco-pf-card:");
  assert.equal(CARD_MARK_CLOSE, "<!--/aco-pf-card-->");
});

test("dawn collection: finds the product loop and retargets it", () => {
  const src = fx("dawn/main-collection-product-grid.liquid");
  const loops = findProductLoops(src);
  assert.equal(loops.length, 1);
  assert.equal(loops[0].loopVar, "product");
  assert.equal(loops[0].source, "collection.products");
  assert.ok(
    loops[0].end > loops[0].headerEnd && loops[0].headerEnd > loops[0].start,
  );

  const out = transformSectionSource(src, {
    context: "collection",
    sectionName: "main-collection-product-grid",
  });
  assert.equal(out.ok, true);
  assert.match(
    out.liquid,
    /^\{%- assign pf_handles = search\.terms \| strip \| split: ' ' -%\}/,
  );
  assert.match(out.liquid, /for pf_h in pf_handles/);
  assert.match(out.liquid, /assign product = all_products\[pf_h\]/);
  assert.match(out.liquid, /<!--aco-pf-card:\{\{ pf_h \| escape \}\}-->/);
  assert.match(out.liquid, /<!--\/aco-pf-card-->\s*\{%-?\s*endfor/);
  assert.ok(
    !/collection\.products\b/.test(out.liquid),
    "no collection.products left",
  );
  assert.match(out.liquid, /paginate search\.results by/);
  assert.match(out.liquid, /render 'card-product'/);
  assert.equal(out.schema.presets, undefined);
  assert.equal(out.schema.name, "ACO theme cards (keep)");
  assert.ok(
    out.schema.name.length <= 25,
    "Shopify caps schema names at 25 chars",
  );
  assert.ok(Array.isArray(out.schema.settings));
  assert.match(
    out.liquid,
    /\{% schema %\}[\s\S]*"settings"[\s\S]*\{% endschema %\}/,
  );
  assert.equal(countTag(out.liquid, "for"), countTag(out.liquid, "endfor"));
  assert.ok(!out.liquid.includes("ACO_PF_INJECT_START"));
});

test("dawn search: object_type switch becomes literal product", () => {
  const out = transformSectionSource(fx("dawn/main-search.liquid"), {
    context: "search",
    sectionName: "main-search",
  });
  assert.equal(out.ok, true);
  assert.match(out.liquid, /case 'product'/);
  assert.ok(!/item\.object_type/.test(out.liquid));
  assert.match(out.liquid, /assign item = all_products\[pf_h\]/);
});

test("horizon collection: loop inside capture, content_for kept, enabled_on dropped", () => {
  const out = transformSectionSource(fx("horizon/main-collection.liquid"), {
    context: "collection",
    sectionName: "main-collection",
  });
  assert.equal(out.ok, true);
  assert.match(out.liquid, /content_for 'block',\s*type: '_product-card'/);
  assert.equal(out.schema.enabled_on, undefined);
  assert.equal(out.schema.presets, undefined);
  assert.ok(out.warnings.includes("content_for"));
  assert.match(out.liquid, /products: pf_handles,/);
});

test("horizon search: loop over variable assigned from search.results", () => {
  const out = transformSectionSource(fx("horizon/search-results.liquid"), {
    context: "search",
    sectionName: "search-results",
  });
  assert.equal(out.ok, true);
  assert.match(out.liquid, /for pf_h in pf_handles/);
  assert.match(out.liquid, /assign product = all_products\[pf_h\]/);
});

test("unsupported: loop in snippet", () => {
  const out = transformSectionSource(fx("synthetic/loop-in-snippet.liquid"), {
    context: "collection",
    sectionName: "x",
  });
  assert.deepEqual(out, { ok: false, reason: "loop-in-snippet" });
});

test("unsupported: no product loop at all", () => {
  const out = transformSectionSource(
    '<p>hi</p>{% schema %}{"name":"x"}{% endschema %}',
    {
      context: "collection",
      sectionName: "x",
    },
  );
  assert.deepEqual(out, { ok: false, reason: "no-product-loop" });
});

test("balanced tags after transform (nested for + for/else inside card loop)", () => {
  const src =
    "{% for product in collection.products %}{% for v in product.variants %}{{ v.id }}{% endfor %}{% else %}<p>none</p>{% endfor %}";
  const out = transformSectionSource(src, {
    context: "collection",
    sectionName: "x",
  });
  assert.equal(out.ok, true);
  assert.equal(countTag(out.liquid, "for"), countTag(out.liquid, "endfor"));
  const close = out.liquid.indexOf(CARD_MARK_CLOSE);
  const innerEnd = out.liquid.indexOf("{% endfor %}");
  const elseIdx = out.liquid.indexOf("{% else %}");
  assert.ok(close > innerEnd, "close marker after inner endfor");
  assert.ok(close < elseIdx, "close marker before the loop's else");
});

test("vintage: for/else loop retargeted and no schema presets", () => {
  const out = transformSectionSource(
    fx("synthetic/vintage-collection-template.liquid"),
    {
      context: "collection",
      sectionName: "collection-template",
    },
  );
  assert.equal(out.ok, true);
  assert.match(out.liquid, /include 'product-grid-item'/);
  assert.equal(countTag(out.liquid, "for"), countTag(out.liquid, "endfor"));
});

test("cleanSchema drops presets/enabled_on/disabled_on/templates/limit and renames", () => {
  const out = cleanSchema(
    {
      name: "x",
      presets: [{}],
      enabled_on: { templates: ["collection"] },
      disabled_on: { groups: ["header"] },
      templates: ["collection"],
      limit: 1,
      class: "section",
      settings: [{ id: "a" }],
      blocks: [{ type: "b" }],
      max_blocks: 3,
    },
    "ACO",
  );
  assert.deepEqual(out, {
    name: "ACO",
    class: "section",
    settings: [{ id: "a" }],
    blocks: [{ type: "b" }],
    max_blocks: 3,
  });
});

test("sectionEntryFromTemplate copies settings and blocks", () => {
  const e = sectionEntryFromTemplate(
    fx("horizon/collection.json"),
    "main-collection",
  );
  assert.ok(e.settings);
  assert.ok(e.blocks);
  assert.ok(Array.isArray(e.block_order) || e.block_order === undefined);
  const dawn = sectionEntryFromTemplate(
    fx("dawn/collection.json"),
    "main-collection-product-grid",
  );
  assert.equal(dawn.settings.products_per_page, 16);
  assert.equal(dawn.blocks, undefined);
  assert.equal(
    sectionEntryFromTemplate(fx("dawn/collection.json"), "nope"),
    null,
  );
  assert.equal(sectionEntryFromTemplate("not json", "x"), null);
});

test("settingsFromSettingsData reads current.sections.<name>.settings", () => {
  const s = settingsFromSettingsData(
    fx("synthetic/settings_data.json"),
    "collection-template",
  );
  assert.deepEqual(s, { grid: "3", show_vendor: true });
  assert.equal(
    settingsFromSettingsData(fx("synthetic/settings_data.json"), "nope"),
    null,
  );
});

test("bakeDefaults writes merchant values as schema defaults", () => {
  const schema = {
    settings: [
      { type: "range", id: "columns", default: 4 },
      { type: "checkbox", id: "vendor" },
      { type: "header", content: "x" },
    ],
  };
  const out = bakeDefaults(schema, { columns: 3, vendor: true, unknown: 1 });
  assert.equal(out.settings[0].default, 3);
  assert.equal(out.settings[1].default, true);
  assert.equal(out.settings[2].default, undefined);
  assert.equal(schema.settings[0].default, 4, "input not mutated");
});

test("buildSearchTemplateJson emits our two keys in order", () => {
  const json = JSON.parse(
    buildSearchTemplateJson([
      {
        key: "aco-pf-collection",
        type: "aco-pf-theme-cards-collection",
        entry: {
          settings: { a: 1 },
          blocks: { b: { type: "x" } },
          block_order: ["b"],
        },
      },
      { key: "aco-pf-search", type: "aco-pf-theme-cards-search", entry: null },
    ]),
  );
  assert.deepEqual(json.order, ["aco-pf-collection", "aco-pf-search"]);
  assert.equal(
    json.sections["aco-pf-collection"].type,
    "aco-pf-theme-cards-collection",
  );
  assert.equal(json.sections["aco-pf-collection"].settings.a, 1);
  assert.deepEqual(json.sections["aco-pf-collection"].block_order, ["b"]);
  assert.deepEqual(json.sections["aco-pf-search"], {
    type: "aco-pf-theme-cards-search",
    settings: {},
  });
});

test("buildSearchTemplateLiquid renders static sections", () => {
  assert.equal(
    buildSearchTemplateLiquid([
      "aco-pf-theme-cards-collection",
      "aco-pf-theme-cards-search",
    ]),
    "{% section 'aco-pf-theme-cards-collection' %}\n{% section 'aco-pf-theme-cards-search' %}\n",
  );
});

test("sectionIdsFromHtml", () => {
  const html =
    '<div id="shopify-section-template--17__aco-pf-collection" class="shopify-section"></div>' +
    '<div id="shopify-section-template--17__aco-pf-search"></div>';
  assert.deepEqual(sectionIdsFromHtml(html), {
    collection: "template--17__aco-pf-collection",
    search: "template--17__aco-pf-search",
  });
  assert.deepEqual(
    sectionIdsFromHtml(
      '<div id="shopify-section-aco-pf-theme-cards-collection">',
    ),
    {
      collection: "aco-pf-theme-cards-collection",
    },
  );
  assert.deepEqual(sectionIdsFromHtml("<html></html>"), {});
});

test("inputsHash is stable and order-sensitive", () => {
  assert.equal(inputsHash(["a", "b"]), inputsHash(["a", "b"]));
  assert.notEqual(inputsHash(["a", "b"]), inputsHash(["b", "a"]));
  assert.match(inputsHash(["a"]), /^[0-9a-f]{40}$/);
});

// ---- review fixes ----------------------------------------------------------
test("dawn collection: empty-state and count guards use the handle list, not search results", () => {
  const out = transformSectionSource(
    fx("dawn/main-collection-product-grid.liquid"),
    {
      context: "collection",
      sectionName: "main-collection-product-grid",
    },
  );
  assert.ok(
    !/search\.results\.size\s*==\s*0/.test(out.liquid),
    "empty-state must not depend on search results",
  );
  assert.match(out.liquid, /pf_handles\.size\s*==\s*0/);
  assert.ok(!/search\.results_count/.test(out.liquid));
  assert.match(out.liquid, /count: pf_handles\.size/);
});

test("commented-out product loops are ignored", () => {
  const src =
    "{% comment %}{% for product in collection.products %}old{% endfor %}{% endcomment %}" +
    "{% raw %}{% for product in collection.products %}{% endfor %}{% endraw %}" +
    "<ul>{% for product in collection.products %}<li>{{ product.title }}</li>{% endfor %}</ul>";
  const loops = findProductLoops(src);
  assert.equal(loops.length, 1);
  assert.ok(loops[0].start > src.indexOf("<ul>"));
  const out = transformSectionSource(src, {
    context: "collection",
    sectionName: "x",
  });
  assert.equal(out.ok, true);
  assert.equal((out.liquid.match(/for pf_h in pf_handles/g) || []).length, 1);
  assert.match(
    out.liquid,
    /\{% comment %\}\{% for product in collection\.products %\}old/,
  );
});

test("settings-scoped collection.products references are left alone", () => {
  const src =
    "{% for product in collection.products %}x{% endfor %}" +
    "{% for p in section.settings.collection.products limit: 4 %}{{ p.title }}{% endfor %}";
  const out = transformSectionSource(src, {
    context: "collection",
    sectionName: "x",
  });
  assert.match(out.liquid, /section\.settings\.collection\.products limit: 4/);
});

test("horizon collection: snippets that receive the rendered cards get the handle list as `products`", () => {
  // Horizon's product-grid snippet shows "No products found" when the list it
  // is handed is empty; on the search page search.results usually is.
  const out = transformSectionSource(fx("horizon/main-collection.liquid"), {
    context: "collection",
  });
  assert.equal(out.ok, true);
  assert.match(
    out.liquid,
    /render 'product-grid',[\s\S]*?products: pf_handles,/,
  );
  assert.doesNotMatch(out.liquid, /products: search\.results/);
  assert.doesNotMatch(out.liquid, /products: collection\.products/);
  // The loop itself is untouched: cards still come from all_products.
  assert.match(
    out.liquid,
    /for pf_h in pf_handles[\s\S]*?all_products\[pf_h\]/,
  );
});

test("renderedSnippetNames: render + include, deduped, comments ignored", () => {
  const names = renderedSnippetNames(
    fx("shopilaunch/main-collection-style1.liquid"),
  );
  assert.ok(names.includes("filters-content"));
  assert.ok(names.includes("collection-sidebar"));
  assert.ok(
    !names.includes("main-collection-style1"),
    "usage comment must not count",
  );
  assert.equal(new Set(names).size, names.length);
});

test("loopSnippetClosure: shopilaunch collection chain", () => {
  const snippets = {
    "main-collection-style1": fx("shopilaunch/main-collection-style1.liquid"),
    "filters-content": fx("shopilaunch/filters-content.liquid"),
    "collection-sidebar": "<aside></aside>",
  };
  const closure = loopSnippetClosure(
    fx("shopilaunch/main-collection.liquid"),
    snippets,
  );
  assert.deepEqual(closure.sort(), [
    "filters-content",
    "main-collection-style1",
  ]);
});

test("loopSnippetClosure: closure includes every branch that reaches the loop", () => {
  const section = "{% render 'a' %}{% render 'b' %}";
  const snippets = {
    a: "{% render 'grid' %}",
    b: "{% render 'grid' %}",
    grid: "{% for p in collection.products %}{% endfor %}",
  };
  assert.deepEqual(loopSnippetClosure(section, snippets).sort(), [
    "a",
    "b",
    "grid",
  ]);
});

test("loopSnippetClosure: comments are ignored when following renders", () => {
  const snippets = {
    self: "{% comment %}{% render 'self' %}{% endcomment %}<p></p>",
  };
  assert.deepEqual(loopSnippetClosure("{% render 'self' %}", snippets), []);
});

test("transformSectionSource with chain: no own loop is ok, render targets rewritten", () => {
  const out = transformSectionSource(fx("shopilaunch/main-collection.liquid"), {
    context: "collection",
    sectionName: "main-collection",
    chain: ["main-collection-style1", "filters-content"],
  });
  assert.equal(out.ok, true, JSON.stringify(out));
  assert.match(out.liquid, /render 'aco-pf-mirror-main-collection-style1'/);
  assert.match(out.liquid, /render 'main-collection-style2'/); // not in chain: unchanged
  assert.match(out.liquid, /render 'filters-refine'/);
});

test("transformSnippetSource: loop snippet is retargeted and prefixed with pf_handles", () => {
  const out = transformSnippetSource(fx("shopilaunch/filters-content.liquid"), {
    context: "collection",
    chain: [],
  });
  assert.equal(out.ok, true);
  assert.ok(
    out.liquid.startsWith(
      "{%- assign pf_handles = search.terms | strip | split: ' ' -%}",
    ),
  );
  assert.equal(countTag(out.liquid, "for"), countTag(out.liquid, "endfor"));
  assert.match(out.liquid, /for pf_h in pf_handles/);
  assert.ok(!/collection\.products\.size/.test(out.liquid));
  assert.ok(!/\{% schema %\}/.test(out.liquid));
});

test("transformSnippetSource: intermediate snippet rewrites render targets in chain", () => {
  const out = transformSnippetSource(
    fx("shopilaunch/main-collection-style1.liquid"),
    {
      context: "collection",
      chain: ["filters-content"],
    },
  );
  assert.match(out.liquid, /render 'aco-pf-mirror-filters-content'/);
  assert.match(out.liquid, /render 'collection-sidebar'/);
});

test("transformSnippetSource: search loop over search.results with object_type", () => {
  const out = transformSnippetSource(
    fx("shopilaunch/filters-search-content.liquid"),
    {
      context: "search",
      chain: [],
    },
  );
  assert.match(out.liquid, /for pf_h in pf_handles/);
  assert.ok(!/item\.object_type/.test(out.liquid));
});

test("unsupported reason: section that only renders snippets reports loop-in-snippet", () => {
  const out = transformSectionSource(fx("shopilaunch/main-collection.liquid"), {
    context: "collection",
    sectionName: "main-collection",
  });
  assert.deepEqual(out, { ok: false, reason: "loop-in-snippet" });
});
