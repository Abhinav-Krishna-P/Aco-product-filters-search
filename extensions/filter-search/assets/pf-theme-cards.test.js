// Storefront theme-card mode: filtered pages are rendered by the theme card
// mirror (Section Rendering API) instead of the ACO card markup.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";
import vm from "node:vm";
import { parseHTML, DOMParser } from "linkedom";

await import("./pf-variant-picker.shared.js");
const variantPickerApi = globalThis.AcoPFVariantPicker;

const jsPath = fileURLToPath(new URL("./pf-filters.js", import.meta.url));
const js = readFileSync(path.resolve(jsPath), "utf8");
const dawnFixture = readFileSync(
  fileURLToPath(
    new URL("./__fixtures__/theme-cards-dawn.html", import.meta.url),
  ),
  "utf8",
);

class TestFormData {
  constructor(form) {
    this.pairs = [];
    if (!form) return;
    form.querySelectorAll("input, select, textarea").forEach((control) => {
      if (!control.name) return;
      const type = control.getAttribute("type");
      if ((type === "checkbox" || type === "radio") && !control.checked) return;
      this.pairs.push([control.name, control.value]);
    });
  }
  entries() {
    return this.pairs[Symbol.iterator]();
  }
  forEach(fn) {
    for (const [key, value] of this.pairs) fn(value, key);
  }
  get(name) {
    const hit = this.pairs.find(([key]) => key === name);
    return hit ? hit[1] : null;
  }
  getAll(name) {
    return this.pairs.filter(([key]) => key === name).map(([, value]) => value);
  }
}

async function flushDom() {
  await Promise.resolve();
  await Promise.resolve();
  await new Promise((resolve) => setTimeout(resolve, 0));
}

async function settle(state, timeoutMs = 5000, { allowDeferred = false } = {}) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (
      state &&
      !state.loading &&
      (allowDeferred || !state.deferredInit) &&
      !state.themeCardsPending
    ) {
      await flushDom();
      if (!state.loading && !state.themeCardsPending) return;
    }
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
  throw new Error("Timed out waiting for aco-pf-filters");
}

function handlesFromUrl(url) {
  const q = new URL("https://x" + url).searchParams.get("q") || "";
  return q.split(/\s+/).filter(Boolean);
}

/** Mirror response: one marker-wrapped <li> per requested handle, Dawn-shaped. */
function generatedSectionHtml(
  handles,
  { skip = [], liquidErrorIn = null, outsideError = false } = {},
) {
  const cards = handles
    .filter((h) => !skip.includes(h))
    .map(
      (h) =>
        `<!--aco-pf-card:${h}--><li class="grid__item" data-h="${h}"><a href="/products/${h}">${h}</a>` +
        (liquidErrorIn === h
          ? "Liquid error (snippets/card-product line 3): x"
          : "") +
        `</li><!--/aco-pf-card-->`,
    )
    .join("\n");
  return (
    '<div id="shopify-section-template--17__aco-pf-collection" class="shopify-section">' +
    '<link href="//cdn.example/component-card.css" rel="stylesheet">' +
    (outsideError
      ? "<div>Liquid error (sections/x line 1): collection is nil</div>"
      : "") +
    '<ul id="product-grid" class="grid product-grid" role="list">' +
    cards +
    "</ul></div>"
  );
}

const THEME_CARDS = {
  version: 1,
  view: "aco-pf",
  mode: "json",
  collection: {
    sectionId: "template--17__aco-pf-collection",
    sourceFile: "x",
    ok: true,
  },
  search: {
    sectionId: "template--17__aco-pf-search",
    sourceFile: "y",
    ok: true,
  },
  warnings: [],
  generatedAt: "2026-10-13T00:00:00.000Z",
  inputsHash: "abc",
};

async function createHarness({
  productCard = { cardSource: "theme" },
  themeCards = THEME_CARDS,
  handles = ["alpha-shirt", "beta-hat", "gamma-shoe"],
  perPage = 20,
  sectionResponse = (url) => ({
    status: 200,
    body: generatedSectionHtml(handlesFromUrl(url)),
  }),
  discoveryResponse = () => ({ status: 200, body: dawnFixture }),
  nativeGrid = false,
  themeId = 4242,
  prices = null, // per-handle prices (strings); default "1.00" each
  sortSelect = null, // { options: [keys], selected: key } — the SSR sort dropdown
  ssrGrid = false, // pre-render one SSR ACO card per handle (theme's native order)
  snapshotNodes = false, // facets/snapshot query returns the products too
  nodeOverrides = [], // per-handle partial product fields (e.g. availability)
  catalogVersion = null, // data-catalog-version on the root
  seedStorage = {}, // sessionStorage entries present before the script runs
} = {}) {
  const pc = JSON.stringify(productCard).replace(/'/g, "&#39;");
  const tc = themeCards
    ? JSON.stringify(themeCards).replace(/'/g, "&#39;")
    : "";
  const { window } = parseHTML(`
    <html><head></head><body>
      <div class="shopify-section">
      ${nativeGrid ? '<ul id="product-grid" class="grid"><li>native</li></ul>' : ""}
      <div data-aco-pf-root data-context="collection"
        data-shop="example.myshopify.com" data-api-version="2026-07" data-token="t"
        data-per-page="${perPage}" data-base-url="/collections/all"
        data-product-card='${pc}' ${tc ? `data-theme-cards='${tc}'` : ""}
        ${catalogVersion != null ? `data-catalog-version="${catalogVersion}"` : ""}>
        <form data-aco-pf-form></form>
        ${
          sortSelect
            ? `<select data-aco-pf-sort>${sortSelect.options
                .map(
                  (k) =>
                    `<option value="${k}"${k === sortSelect.selected ? " selected" : ""}>${k}</option>`,
                )
                .join("")}</select>`
            : ""
        }
        <section class="aco-pf-results" data-aco-pf-results>
          <span data-aco-pf-count></span>
          <ul class="aco-pf-grid" data-aco-pf-grid role="list">${
            ssrGrid
              ? handles
                  .map(
                    (h, i) =>
                      `<li><a class="aco-pf-card__link" data-aco-pf-card data-aco-pf-id="gid://shopify/Product/${i + 1}" href="/products/${h}"><span class="aco-pf-card__title">${h}</span></a></li>`,
                  )
                  .join("")
              : ""
          }</ul>
          <nav data-aco-pf-pager hidden>
            <button type="button" data-aco-pf-prev disabled>Prev</button>
            <span data-aco-pf-page>Page 1</span>
            <button type="button" data-aco-pf-next>Next</button>
          </nav>
        </section>
      </div>
      </div>
    </body></html>
  `);
  const { document } = window;
  // linkedom's <select>.value is read-only; give it the browser behaviour.
  const selectProto = Object.getPrototypeOf(document.createElement("select"));
  Object.defineProperty(selectProto, "value", {
    configurable: true,
    get() {
      const opts = Array.from(this.querySelectorAll("option"));
      const sel = opts.find((o) => o.hasAttribute("selected")) || opts[0];
      return sel ? sel.getAttribute("value") : "";
    },
    set(v) {
      for (const o of this.querySelectorAll("option")) {
        if (o.getAttribute("value") === String(v))
          o.setAttribute("selected", "");
        else o.removeAttribute("selected");
      }
    },
  });
  const calls = { graphql: [], mirror: [], discovery: [] };
  const stored = { ...seedStorage };
  const storage = {
    getItem: (k) => (k in stored ? stored[k] : null),
    setItem: (k, v) => {
      stored[k] = String(v);
    },
    removeItem: (k) => {
      delete stored[k];
    },
  };
  const events = [];
  document.addEventListener("shopify:section:load", (e) =>
    events.push(e.detail),
  );

  window.AcoPFVariantPicker = variantPickerApi;
  window.matchMedia = () => ({ matches: false });
  window.location = { search: "", pathname: "/collections/all", href: "" };
  window.Shopify = { routes: { root: "/" }, theme: { id: themeId } };
  window.DOMParser = DOMParser;

  const nodes = handles.map((h, i) => ({
    id: "gid://shopify/Product/" + (i + 1),
    handle: h,
    title: h,
    vendor: "V",
    availableForSale: true,
    featuredImage: null,
    variants: { nodes: [] },
    compareAtPriceRange: { minVariantPrice: null },
    priceRange: {
      minVariantPrice: {
        amount: prices ? prices[i] : "1.00",
        currencyCode: "USD",
      },
    },
    options: [],
    ...(nodeOverrides[i] || {}),
  }));

  const fetchMock = (url, options = {}) => {
    const u = String(url);
    if (u.includes("/graphql.json")) {
      const body = JSON.parse(options.body || "{}");
      calls.graphql.push(body);
      if (/query PFFacets/.test(body.query)) {
        return Promise.resolve({
          ok: true,
          json: async () => ({
            data: {
              products: {
                pageInfo: { hasNextPage: false, endCursor: null },
                nodes: snapshotNodes ? nodes : [],
              },
            },
          }),
        });
      }
      if (/query PF\(/.test(body.query)) {
        const start = body.variables.after
          ? parseInt(body.variables.after.slice(1), 10)
          : 0;
        // Honour sortKey PRICE like the real Storefront API.
        let ordered = nodes;
        if (body.variables.sortKey === "PRICE") {
          const price = (n) => parseFloat(n.priceRange.minVariantPrice.amount);
          ordered = [...nodes].sort(
            (a, b) => (price(a) - price(b)) * (body.variables.reverse ? -1 : 1),
          );
        }
        const page = ordered.slice(start, start + body.variables.first);
        const end = start + page.length;
        return Promise.resolve({
          ok: true,
          json: async () => ({
            data: {
              products: {
                pageInfo: {
                  hasNextPage: end < nodes.length,
                  endCursor: "c" + end,
                },
                nodes: page,
              },
            },
          }),
        });
      }
      return Promise.resolve({ ok: true, json: async () => ({ data: {} }) });
    }
    if (u.includes("view=aco-pf")) {
      const r = u.includes("section_id=")
        ? sectionResponse(u)
        : discoveryResponse(u);
      (u.includes("section_id=") ? calls.mirror : calls.discovery).push(u);
      return Promise.resolve({
        ok: r.status === 200,
        status: r.status,
        text: async () => r.body,
      });
    }
    return Promise.resolve({
      ok: true,
      status: 200,
      json: async () => ({}),
      text: async () => "",
    });
  };

  const warnings = [];
  const context = {
    window,
    document,
    console: {
      info() {},
      warn(...args) {
        warnings.push(args.map(String).join(" "));
      },
    },
    fetch: fetchMock,
    setTimeout,
    clearTimeout,
    setInterval,
    clearInterval,
    URL,
    URLSearchParams,
    FormData: TestFormData,
    AbortController,
    DOMParser,
    Intl,
    Number,
    String,
    Object,
    Array,
    Math,
    JSON,
    Promise,
    CustomEvent: window.CustomEvent,
    Event: window.Event,
    HTMLElement: window.HTMLElement,
    localStorage: storage,
    sessionStorage: storage,
    history: { pushState() {} },
    Shopify: window.Shopify,
  };
  vm.runInNewContext(js, context);
  const root = document.querySelector("[data-aco-pf-root]");
  const state = root.__pfState;
  // A clean first load may legitimately stay "deferred" (SSR grid kept).
  await settle(state, 5000, { allowDeferred: ssrGrid });
  const next = async () => {
    document
      .querySelector("[data-aco-pf-next]")
      .dispatchEvent(new window.Event("click", { bubbles: true }));
    await flushDom();
    await settle(state);
  };
  return {
    window,
    document,
    root,
    state,
    calls,
    stored,
    events,
    next,
    warnings,
  };
}

const themeGridItems = (document) =>
  Array.from(document.querySelectorAll("[data-aco-pf-theme-grid] li")).map(
    (li) => li.getAttribute("data-h"),
  );

test("theme mode fetches the mirror per 20 handles and inserts cards in order", async () => {
  const handles = Array.from({ length: 23 }, (_, i) => "p-" + (i + 1));
  const h = await createHarness({ handles, perPage: 30 });
  assert.equal(h.calls.mirror.length, 2);
  assert.equal(handlesFromUrl(h.calls.mirror[0]).length, 20);
  assert.match(h.calls.mirror[0], /^\/search\?view=aco-pf&type=product&q=/);
  assert.match(
    h.calls.mirror[0],
    /section_id=template--17__aco-pf-collection$/,
  );
  assert.deepEqual(themeGridItems(h.document), handles);
  const grid = h.document.querySelector("[data-aco-pf-theme-grid] ul");
  assert.ok(
    grid.classList.contains("product-grid"),
    "container classes preserved",
  );
  assert.equal(
    h.document.querySelector("[data-aco-pf-grid]").hasAttribute("hidden"),
    true,
  );
  assert.equal(
    h.document.querySelectorAll("[data-aco-pf-grid] .aco-pf-card").length,
    0,
  );
});

test("duplicate ids are stripped from the inserted container", async () => {
  const h = await createHarness({ nativeGrid: true });
  const inserted = h.document.querySelector("[data-aco-pf-theme-grid] ul");
  assert.equal(inserted.getAttribute("id"), null);
  assert.equal(h.document.querySelectorAll("#product-grid").length, 1);
});

test("stylesheet links are deduped and scripts execute once across pages", async () => {
  const handles = Array.from({ length: 25 }, (_, i) => "p-" + (i + 1));
  const h = await createHarness({
    handles,
    perPage: 20,
    sectionResponse: (url) => ({
      status: 200,
      body:
        '<div id="shopify-section-template--17__aco-pf-collection" class="shopify-section">' +
        '<link href="//cdn.example/component-card.css" rel="stylesheet">' +
        '<ul id="product-grid" class="grid">' +
        handlesFromUrl(url)
          .map(
            (x) =>
              `<!--aco-pf-card:${x}--><li data-h="${x}"><script src="//cdn.example/quick-add.js" defer="defer"></script></li><!--/aco-pf-card-->`,
          )
          .join("") +
        "</ul></div>",
    }),
  });
  assert.equal(themeGridItems(h.document).length, 20);
  await h.next();
  assert.equal(themeGridItems(h.document).length, 5);
  assert.equal(
    h.document.querySelectorAll('link[href="//cdn.example/component-card.css"]')
      .length,
    1,
  );
  assert.equal(
    h.document.querySelectorAll('script[src="//cdn.example/quick-add.js"]')
      .length,
    1,
  );
});

test("shopify:section:load is dispatched with the mirror section id", async () => {
  const h = await createHarness();
  assert.equal(h.events.length, 1);
  assert.equal(h.events[0].sectionId, "template--17__aco-pf-collection");
});

test("a handle missing from the response is skipped without failure", async () => {
  const h = await createHarness({
    sectionResponse: (url) => ({
      status: 200,
      body: generatedSectionHtml(handlesFromUrl(url), { skip: ["beta-hat"] }),
    }),
  });
  assert.deepEqual(themeGridItems(h.document), ["alpha-shirt", "gamma-shoe"]);
  assert.equal(h.state.themeCardFailures, 0);
});

test("liquid error outside the cards is ignored", async () => {
  const h = await createHarness({
    sectionResponse: (url) => ({
      status: 200,
      body: generatedSectionHtml(handlesFromUrl(url), { outsideError: true }),
    }),
  });
  assert.equal(themeGridItems(h.document).length, 3);
  assert.equal(h.state.themeCardFailures, 0);
});

test("liquid error inside a card falls back to ACO cards for the page", async () => {
  const h = await createHarness({
    sectionResponse: (url) => ({
      status: 200,
      body: generatedSectionHtml(handlesFromUrl(url), {
        liquidErrorIn: "beta-hat",
      }),
    }),
  });
  assert.equal(h.document.querySelector("[data-aco-pf-theme-grid]"), null);
  assert.equal(
    h.document.querySelectorAll("[data-aco-pf-grid] .aco-pf-card").length,
    3,
  );
  assert.equal(
    h.document.querySelector("[data-aco-pf-grid]").hasAttribute("hidden"),
    false,
  );
  assert.equal(h.state.themeCardFailures, 1);
});

test("two consecutive failures disable theme mode for the session", async () => {
  const handles = Array.from({ length: 45 }, (_, i) => "p-" + (i + 1));
  const h = await createHarness({
    handles,
    perPage: 20,
    sectionResponse: () => ({ status: 500, body: "" }),
  });
  assert.equal(h.state.themeCardFailures, 1);
  assert.equal(h.state.themeCardsDisabled, false);
  await h.next();
  assert.equal(h.state.themeCardFailures, 2);
  assert.equal(h.state.themeCardsDisabled, true);
  const before = h.calls.mirror.length;
  await h.next();
  assert.equal(h.calls.mirror.length, before, "no mirror fetch once disabled");
  assert.equal(
    h.document.querySelectorAll("[data-aco-pf-grid] .aco-pf-card").length,
    5,
  );
});

test("client discovers the section id when the metafield lacks it", async () => {
  const h = await createHarness({
    themeCards: {
      ...THEME_CARDS,
      collection: { ...THEME_CARDS.collection, sectionId: "" },
    },
  });
  assert.equal(h.calls.discovery.length, 1);
  assert.match(h.calls.discovery[0], /^\/search\?view=aco-pf&q=/);
  assert.equal(h.calls.mirror.length, 1);
  assert.match(
    h.calls.mirror[0],
    /section_id=template--17__aco-pf-collection$/,
  );
  assert.equal(
    h.stored["aco_pf_theme_sid:4242:collection"],
    "template--17__aco-pf-collection",
  );
  assert.equal(themeGridItems(h.document).length, 3);
});

test("aco mode never calls the mirror", async () => {
  const h = await createHarness({ productCard: { cardSource: "aco" } });
  assert.equal(h.calls.mirror.length, 0);
  assert.equal(h.calls.discovery.length, 0);
  assert.equal(
    h.document.querySelectorAll("[data-aco-pf-grid] .aco-pf-card").length,
    3,
  );
});

test("theme mode without mirror metadata falls back to ACO cards", async () => {
  const h = await createHarness({ themeCards: null });
  assert.equal(h.calls.mirror.length, 0);
  assert.equal(
    h.document.querySelectorAll("[data-aco-pf-grid] .aco-pf-card").length,
    3,
  );
});

// ---- Liquid entry point + CSS (Task 5) --------------------------------------
const themeInjectSnippet = readFileSync(
  fileURLToPath(
    new URL(
      "../../../app/theme-inject/aco-product-filters.liquid",
      import.meta.url,
    ),
  ),
  "utf8",
);
const css = readFileSync(
  fileURLToPath(new URL("./pf-filters.css", import.meta.url)),
  "utf8",
);

test("injected entry point publishes theme cards metadata and skips the ACO SSR grid in theme mode", () => {
  assert.match(
    themeInjectSnippet,
    /assign theme_cards = shop\.metafields\.pf_config\.theme_cards\.value/,
  );
  assert.match(
    themeInjectSnippet,
    /data-theme-cards='\{\{ theme_cards \| json \| escape \}\}'/,
  );
  assert.match(themeInjectSnippet, /cfg\.productCard\.cardSource == 'theme'/);
  assert.match(
    themeInjectSnippet,
    /<ul class="aco-pf-grid aco-pf-grid--skeletons" data-aco-pf-grid role="list"><\/ul>/,
  );
  assert.match(
    themeInjectSnippet,
    /render 'aco-pf-product-grid'/,
    "ACO SSR grid still rendered in aco mode",
  );
});

test("injected hide rules never hide the inserted theme grid", () => {
  const hideBlock = /<style>([\s\S]*?)<\/style>/
    .exec(themeInjectSnippet)[1]
    // Liquid braces would confuse the brace splitting below.
    .replace(/\{\{\s*section\.id\s*\}\}/g, "SID");
  const selectors = hideBlock
    .split("}")
    .filter((r) => r.includes("display: none !important"))
    .flatMap((r) =>
      r
        .split("{")[0]
        .replace(/{%-?[^%]*-?%}/g, "")
        .split(","),
    )
    .map((s) => s.trim())
    .filter((s) => s.startsWith("#shopify-section-"));
  assert.equal(selectors.length, 6);
  for (const sel of selectors) {
    assert.ok(sel.endsWith(":not([data-aco-pf-theme-grid] *)"), sel);
  }
});

test("css keeps a hidden ACO grid hidden and styles the theme grid wrapper", () => {
  assert.match(
    css,
    /\[data-aco-pf-grid\]\[hidden\]\s*\{\s*display:\s*none\s*!important;?\s*\}/,
  );
  assert.match(css, /\[data-aco-pf-theme-grid\]\s*\{/);
  const hiddenIdx = css.indexOf("[data-aco-pf-grid][hidden]");
  const gridIdx = css.indexOf("[data-aco-pf-grid].aco-pf-grid {");
  assert.ok(
    hiddenIdx > gridIdx,
    "hidden rule must come after the display:grid rule",
  );
  assert.match(
    css,
    /:not\(\[data-aco-pf-theme-grid\] \*\)/,
    "global fallback hide rule excludes the theme grid",
  );
});

// ---- review fixes ----------------------------------------------------------
test("theme mode is off when the context entry is not usable", async () => {
  const h = await createHarness({
    themeCards: {
      ...THEME_CARDS,
      collection: {
        sectionId: "",
        sourceFile: "x",
        ok: false,
        reason: "loop-in-snippet",
      },
    },
  });
  assert.equal(h.calls.mirror.length, 0);
  assert.equal(h.calls.discovery.length, 0);
  assert.equal(
    h.document.querySelectorAll("[data-aco-pf-grid] .aco-pf-card").length,
    3,
  );
});

test("both card modes hide the native grid from JS so no-JS visitors keep the SSR listing", async () => {
  // The injected CSS only hides simple siblings; wrappers that mix the page's
  // search box with the grid are pruned by the JS walk, in either mode.
  const h = await createHarness({ nativeGrid: true });
  const native = h.document.querySelector(".shopify-section > #product-grid");
  assert.ok(native.hasAttribute("data-aco-pf-hidden-theme-grid"));
  const aco = await createHarness({
    nativeGrid: true,
    productCard: { cardSource: "aco" },
  });
  assert.ok(
    aco.document
      .querySelector(".shopify-section > #product-grid")
      .hasAttribute("data-aco-pf-hidden-theme-grid"),
  );
});

test("injected entry point gates theme mode on a usable mirror and keeps the native grid for no-JS", () => {
  // Same pick as themeContext(): search mirror on the search page, else collection.
  assert.match(
    themeInjectSnippet,
    /if pf_context == 'search' and theme_cards\.search\.ok == true/,
  );
  assert.match(themeInjectSnippet, /elsif theme_cards\.collection\.ok == true/);
  assert.ok(
    !/collection\.ok == true or theme_cards\.search\.ok/.test(
      themeInjectSnippet,
    ),
  );
  assert.match(
    themeInjectSnippet,
    /\{%-? ?unless use_theme_cards -?%\}[\s\S]*#product-grid:not\(\[data-aco-pf-theme-grid\] \*\)[\s\S]*\{%-? ?endunless -?%\}/,
  );
});

test("every theme card failure logs its reason to the console", async () => {
  const notFound = await createHarness({
    sectionResponse: () => ({ status: 404, body: "" }),
  });
  assert.ok(
    notFound.warnings.some((w) => /\[aco-pf\] theme cards.*HTTP 404/.test(w)),
    notFound.warnings.join("\n"),
  );

  const noMarkers = await createHarness({
    sectionResponse: () => ({ status: 200, body: "<ul></ul>" }),
  });
  assert.ok(
    noMarkers.warnings.some((w) =>
      /\[aco-pf\] theme cards.*no card markers/.test(w),
    ),
    noMarkers.warnings.join("\n"),
  );

  const noSection = await createHarness({
    themeCards: {
      ...THEME_CARDS,
      collection: { ...THEME_CARDS.collection, sectionId: "" },
    },
    discoveryResponse: () => ({
      status: 200,
      body: "<html>no mirror here</html>",
    }),
  });
  assert.ok(
    noSection.warnings.some((w) =>
      /\[aco-pf\] theme cards.*section id/.test(w),
    ),
    noSection.warnings.join("\n"),
  );
});

test("wrapper elements between the section root and the grid are kept (grid gap/columns live there)", async () => {
  const h = await createHarness({
    sectionResponse: (url) => {
      const inner = generatedSectionHtml(handlesFromUrl(url));
      // Horizon: section > results-list > .collection-wrapper > #ResultsList > div[style vars] > ul.product-grid
      const body = inner
        .replace(
          '<ul id="product-grid"',
          '<results-list class="section product-grid-container"><div class="collection-wrapper grid">' +
            '<div id="ResultsList" class="main-collection-grid"><div style="--product-grid-gap-desktop: 16px 16px; container-type: inline-size">' +
            '<ul id="product-grid"',
        )
        .replace("</ul></div>", "</ul></div></div></div></results-list></div>");
      return { status: 200, body };
    },
  });
  const wrapper = h.document.querySelector("[data-aco-pf-theme-grid]");
  assert.ok(wrapper, "theme grid inserted: " + h.warnings.join(" | "));
  const ul = wrapper.querySelector("ul.product-grid");
  assert.ok(ul, "grid list present");
  assert.equal(ul.querySelectorAll("li").length, 3);
  const gapDiv = ul.parentElement;
  assert.match(
    gapDiv.getAttribute("style") || "",
    /--product-grid-gap-desktop: 16px 16px/,
  );
  assert.equal(
    gapDiv.parentElement.classList.contains("main-collection-grid"),
    true,
  );
  assert.equal(
    gapDiv.parentElement.parentElement.classList.contains("collection-wrapper"),
    true,
  );
  assert.equal(
    gapDiv.parentElement.parentElement.parentElement.tagName.toLowerCase(),
    "results-list",
  );
  assert.equal(
    gapDiv.parentElement.parentElement.parentElement.parentElement.classList.contains(
      "shopify-section",
    ),
    true,
  );
  // Wrappers are shallow: no sibling content (facets, scripts) is carried over.
  assert.equal(wrapper.querySelectorAll("results-list > *").length, 1);
});

const acoGridTitles = (document) =>
  Array.from(
    document.querySelectorAll("[data-aco-pf-grid] .aco-pf-card__title"),
  ).map((el) => el.textContent);

test("clean page load applies the merchant's default sort to page 1 (not the theme's SSR order)", async () => {
  const h = await createHarness({
    productCard: { cardSource: "aco" },
    themeCards: null,
    handles: ["alpha-shirt", "beta-hat", "gamma-shoe"],
    prices: ["30.00", "10.00", "20.00"],
    sortSelect: {
      options: ["default", "price-asc", "price-desc"],
      selected: "price-asc",
    },
    ssrGrid: true,
    snapshotNodes: true,
  });
  assert.equal(h.state.sort, "price-asc");
  assert.deepEqual(acoGridTitles(h.document), [
    "beta-hat",
    "gamma-shoe",
    "alpha-shirt",
  ]);
});

test("clean page load with the natural default sort keeps the SSR grid (no page-1 refetch)", async () => {
  const h = await createHarness({
    productCard: { cardSource: "aco" },
    themeCards: null,
    handles: ["alpha-shirt", "beta-hat", "gamma-shoe"],
    prices: ["30.00", "10.00", "20.00"],
    sortSelect: { options: ["default", "price-asc"], selected: "default" },
    ssrGrid: true,
    snapshotNodes: true,
  });
  assert.equal(h.state.sort, "default");
  assert.deepEqual(acoGridTitles(h.document), [
    "alpha-shirt",
    "beta-hat",
    "gamma-shoe",
  ]);
  assert.equal(
    h.calls.graphql.filter((b) => /query PF\(/.test(b.query)).length,
    0,
  );
});

test("with both badges on, sold-out products show Out of stock and sale products show Sale", async () => {
  const h = await createHarness({
    productCard: {
      cardSource: "aco",
      showSaleBadge: true,
      showSoldOutBadge: true,
      saleBadgeText: "Sale",
      soldOutBadgeText: "Sold out",
    },
    themeCards: null,
    handles: ["on-sale", "sold-out", "plain"],
    prices: ["10.00", "10.00", "10.00"],
    nodeOverrides: [
      {
        compareAtPriceRange: {
          minVariantPrice: { amount: "20.00", currencyCode: "USD" },
        },
      },
      {
        availableForSale: false,
        compareAtPriceRange: {
          minVariantPrice: { amount: "20.00", currencyCode: "USD" },
        },
      },
      {},
    ],
  });
  const flags = Array.from(
    h.document.querySelectorAll("[data-aco-pf-grid] li"),
  ).map((li) => {
    const f = li.querySelector(".aco-pf-card__flag");
    return f ? f.textContent.trim() : "";
  });
  assert.deepEqual(flags, ["Sale", "Sold out", ""]);
});

test("a new catalog version ignores the cached product snapshot (new products appear)", async () => {
  const oldSnapshot = JSON.stringify({
    t: Date.now(),
    capped: false,
    nodes: [{ id: "gid://shopify/Product/1", title: "alpha-shirt" }],
  });
  const facetCalls = (h) =>
    h.calls.graphql.filter((b) => /query PFFacets/.test(b.query)).length;

  // Same version as the cache: snapshot reused, no rescan.
  const same = await createHarness({
    productCard: { cardSource: "aco" },
    themeCards: null,
    catalogVersion: "100",
    seedStorage: { "pf_facets_v4:example.myshopify.com:100": oldSnapshot },
  });
  assert.equal(same.state.catalogVersion, "100");
  assert.equal(
    facetCalls(same),
    0,
    "fresh cache for the same version is reused",
  );

  // Catalog changed since (version bumped): the old snapshot is not used.
  const bumped = await createHarness({
    productCard: { cardSource: "aco" },
    themeCards: null,
    catalogVersion: "200",
    seedStorage: { "pf_facets_v4:example.myshopify.com:100": oldSnapshot },
  });
  assert.ok(facetCalls(bumped) > 0, "a bumped version rescans the catalog");
});

test("column switcher drives the theme card container, not just the parked ACO grid", async () => {
  const h = await createHarness({ nativeGrid: true });
  const container = h.document.querySelector("[data-aco-pf-theme-grid] ul");
  assert.ok(
    container.hasAttribute("data-aco-pf-cards"),
    "card container is marked",
  );
  assert.equal(String(container.style.getPropertyValue("--aco-pf-cols")), "3");
  // The harness markup has no switcher; clicks are delegated from the root,
  // so a button added at runtime behaves like the real one.
  let four = h.document.querySelector('[data-aco-pf-cols="4"]');
  if (!four) {
    four = h.document.createElement("button");
    four.setAttribute("data-aco-pf-cols", "4");
    h.document.querySelector("[data-aco-pf-root]").appendChild(four);
  }
  four.click();
  assert.equal(String(container.style.getPropertyValue("--aco-pf-cols")), "4");
});

test("cloned theme wrappers are marked so CSS can force them full-width", async () => {
  const h = await createHarness({
    nativeGrid: true,
    sectionResponse: (url) => ({
      status: 200,
      // One layout wrapper between section and grid, like real themes have.
      body: generatedSectionHtml(handlesFromUrl(url))
        .replace(
          '<ul id="product-grid"',
          '<div class="collection page-width"><ul id="product-grid"',
        )
        .replace("</ul></div>", "</ul></div></div>"),
    }),
  });
  const container = h.document.querySelector(
    "[data-aco-pf-theme-grid] [data-aco-pf-cards]",
  );
  const wraps = [
    ...h.document.querySelectorAll(
      "[data-aco-pf-theme-grid] [data-aco-pf-wrap]",
    ),
  ];
  assert.ok(wraps.length >= 1, "at least one wrapper level");
  for (const w of wraps)
    assert.ok(
      w.contains(container),
      "every marked wrapper is an ancestor of the cards",
    );
  assert.ok(!container.hasAttribute("data-aco-pf-wrap"));
});
