import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";
import vm from "node:vm";
import { parseHTML } from "linkedom";

await import("./pf-variant-picker.shared.js");
const variantPickerApi = globalThis.AcoPFVariantPicker;

const cssPath = fileURLToPath(new URL("./pf-filters.css", import.meta.url));
const css = readFileSync(path.resolve(cssPath), "utf8");
const jsPath = fileURLToPath(new URL("./pf-filters.js", import.meta.url));
const js = readFileSync(path.resolve(jsPath), "utf8");
const productGrid = readFileSync(
  fileURLToPath(new URL("../snippets/pf-product-grid.liquid", import.meta.url)),
  "utf8",
);
const themeInjectServer = readFileSync(
  fileURLToPath(
    new URL("../../../app/models/themeInject.server.ts", import.meta.url),
  ),
  "utf8",
);
const themeInjectSnippet = readFileSync(
  fileURLToPath(
    new URL(
      "../../../app/theme-inject/aco-product-filters.liquid",
      import.meta.url,
    ),
  ),
  "utf8",
);
const productCardDefaults = js.slice(
  js.indexOf("var PRODUCT_CARD_DEFAULTS = {"),
  js.indexOf("};", js.indexOf("var PRODUCT_CARD_DEFAULTS = {")) + 2,
);
const cardActionsSource = js.slice(
  js.indexOf("function cardActionsHtml"),
  js.indexOf("function discountBadgeHtml"),
);

// linkedom has no FormData, and pf-filters.js reads the filter form through it.
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

function deferred() {
  let resolve;
  let reject;
  const promise = new Promise((resolvePromise, rejectPromise) => {
    resolve = resolvePromise;
    reject = rejectPromise;
  });
  return { promise, resolve, reject };
}

async function flushDom() {
  await Promise.resolve();
  await Promise.resolve();
  await new Promise((resolve) => setTimeout(resolve, 0));
}

async function waitForPfInit(state, timeoutMs = 5000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (
      state &&
      !state.loading &&
      !state.deferredInit &&
      !state.snapshotPromise
    ) {
      await flushDom();
      return;
    }
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
  throw new Error("Timed out waiting for aco-pf-filters init");
}

function defaultVariantProduct() {
  return {
    id: "gid://shopify/Product/10",
    title: "Test Product",
    featuredImage: {
      url: "https://cdn.example/product.jpg",
      altText: "Product",
    },
    options: [
      { name: "Color", values: ["Red", "Blue"] },
      { name: "Size", values: ["S", "M"] },
    ],
    variants: {
      nodes: [
        {
          id: "gid://shopify/ProductVariant/101",
          title: "Red / S",
          availableForSale: true,
          selectedOptions: [
            { name: "Color", value: "Red" },
            { name: "Size", value: "S" },
          ],
          price: { amount: "10.00", currencyCode: "USD" },
          compareAtPrice: null,
          image: null,
        },
        {
          id: "gid://shopify/ProductVariant/102",
          title: "Blue / M",
          availableForSale: true,
          selectedOptions: [
            { name: "Color", value: "Blue" },
            { name: "Size", value: "M" },
          ],
          price: { amount: "12.00", currencyCode: "USD" },
          compareAtPrice: null,
          image: null,
        },
      ],
    },
  };
}

async function createVariantModalHarness({
  product = defaultVariantProduct(),
  productCard = { showBuyNow: true, afterAddToCart: "stay" },
  cartResponse,
  cartStateResponse,
  checkoutResponse,
  variantResponse,
  triggerProductId = "gid://shopify/Product/10",
  // Adds a Storefront token plus an SSR grid so run() can repaint the grid.
  withGrid = false,
  withCartBubble = true,
  cssVars = "",
} = {}) {
  const productCardConfig = JSON.stringify(productCard).replace(/'/g, "&#39;");
  const { window } = parseHTML(`
    <html><body>
      <div data-aco-pf-root data-context="collection"
        data-shop="example.myshopify.com"
        data-base-url="/collections/all"
        ${withGrid ? 'data-token="test-token"' : ""}
        ${cssVars ? `style="${cssVars}"` : ""}
        data-product-card='${productCardConfig}'>
        <a id="cart-icon-bubble" href="/cart">${
          withCartBubble
            ? `<span class="cart-count-bubble">
                 <span aria-hidden="true">0</span>
               </span>`
            : ""
        }</a>
        <form data-aco-pf-form>
          <button type="button" data-aco-pf-choose-variant
            data-aco-pf-product="${triggerProductId}"
            data-aco-pf-url="/products/test-product">Choose variant</button>
        </form>
        ${
          withGrid
            ? `<section class="aco-pf-results" data-aco-pf-results>
                 <ul data-aco-pf-grid>
                   <li class="aco-pf-card"><a class="aco-pf-card__link" data-aco-pf-card
                     data-aco-pf-id="10" data-aco-pf-handle="test-product"
                     href="/products/test-product">Test Product</a></li>
                 </ul>
               </section>`
            : ""
        }
      </div>
    </body></html>
  `);
  const { document } = window;
  const cartCalls = [];
  const cartStateCalls = [];
  const checkoutCalls = [];
  const variantCalls = [];
  const storage = {
    getItem() {
      return null;
    },
    setItem() {},
  };
  window.AcoPFVariantPicker = variantPickerApi;
  window.matchMedia = () => ({ matches: false });
  window.location = { search: "", pathname: "/collections/all", href: "" };
  window.Shopify = { routes: { root: "/" } };
  window.HTMLElement.prototype.focus = function () {
    document.__focusedElement = this;
  };
  Object.defineProperty(document, "activeElement", {
    configurable: true,
    get() {
      return document.__focusedElement || null;
    },
  });

  const fetchMock = (url, options = {}) => {
    if (String(url).includes("/graphql.json")) {
      const requestBody = JSON.parse(options.body || "{}");
      if (String(requestBody.query || "").includes("cartCreate")) {
        checkoutCalls.push({ url, options });
        if (checkoutResponse) return checkoutResponse(checkoutCalls.length);
        return Promise.resolve({
          ok: true,
          json: async () => ({
            data: {
              cartCreate: {
                cart: { checkoutUrl: "/isolated-checkout" },
                userErrors: [],
              },
            },
          }),
        });
      }
      variantCalls.push({ url, options });
      if (variantResponse) return variantResponse(variantCalls.length);
      return Promise.resolve({
        ok: true,
        json: async () => ({ data: { node: product } }),
      });
    }
    if (String(url).includes("cart/add.js")) {
      cartCalls.push({ url, options });
      if (cartResponse) return cartResponse(cartCalls.length);
      return Promise.resolve({ ok: true, json: async () => ({}) });
    }
    if (String(url).includes("cart.js")) {
      cartStateCalls.push({ url, options });
      const cartState = cartStateResponse
        ? cartStateResponse(cartStateCalls.length)
        : { item_count: 0 };
      return Promise.resolve({
        ok: true,
        json: async () => cartState,
      });
    }
    return Promise.resolve({ ok: true, json: async () => ({}) });
  };

  const context = {
    window,
    document,
    console: { info() {}, warn() {} },
    fetch: fetchMock,
    setTimeout,
    clearTimeout,
    setInterval,
    clearInterval,
    URL,
    URLSearchParams,
    FormData: TestFormData,
    AbortController,
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
  if (withGrid) await waitForPfInit(root.__pfState);

  const trigger = document.querySelector("[data-aco-pf-choose-variant]");
  trigger.dispatchEvent(
    new window.Event("click", { bubbles: true, cancelable: true }),
  );
  await flushDom();
  return {
    window,
    document,
    trigger,
    cartCalls,
    cartStateCalls,
    checkoutCalls,
    variantCalls,
    root: document.querySelector("[data-aco-pf-root]"),
    state: document.querySelector("[data-aco-pf-root]").__pfState,
  };
}

function submitModal(window, form, button) {
  const event = new window.Event("submit", {
    bubbles: true,
    cancelable: true,
  });
  Object.defineProperty(event, "submitter", { value: button });
  form.dispatchEvent(event);
}

test("injected app owns responsive page spacing", () => {
  const appRule = css.match(/\.aco-pf-app\s*\{([\s\S]*?)\n\}/);

  assert.ok(appRule, "base .aco-pf-app rule should exist");
  assert.match(appRule[1], /box-sizing:\s*border-box/);
  assert.match(appRule[1], /max-width:\s*120rem/);
  assert.match(appRule[1], /padding-inline:\s*clamp\(/);
  assert.match(appRule[1], /margin-inline:\s*auto/);
});

test("products per page is configurable from 10 through 30", () => {
  assert.match(themeInjectSnippet, /lay\.productsPerPage/);
  assert.match(themeInjectSnippet, /data-per-page="\{\{ per_page \}\}"/);
  assert.match(js, /Math\.max\(\s*10[\s\S]*Math\.min\([\s\S]*,\s*30\)/);
});

test("pagination style is published by the injected storefront entry point", () => {
  assert.match(themeInjectSnippet, /data-pagination-style=/);
  assert.match(themeInjectSnippet, /aco-pf-pager--\{\{ pagination_style \}\}/);
});

test("pagination renderer supports all configured styles", () => {
  for (const style of [
    "basic",
    "pill",
    "numbered",
    "segmented",
    "text",
    "jump",
  ]) {
    assert.match(js, new RegExp(`"${style}"`));
  }
  assert.match(js, /function paginationTokens/);
  assert.match(js, /data-aco-pf-page-number/);
  assert.match(js, /data-aco-pf-jump-form/);
  assert.match(js, /setAttribute\("aria-current", "page"\)/);
});

test("pagination styles include readable text and all modifiers", () => {
  assert.match(
    css,
    /\.aco-pf-pager__btn[\s\S]*font-size:\s*var\(--aco-pf-pagination-text-size,\s*14px\)/,
  );
  for (const style of [
    "basic",
    "pill",
    "numbered",
    "segmented",
    "text",
    "jump",
  ]) {
    assert.match(css, new RegExp(`\\.aco-pf-pager--${style}`));
  }
});

test("active pagination page remains visible when disabled theme rules apply", () => {
  assert.match(
    css,
    /\[data-aco-pf-root\]\s+\.aco-pf-pager__page\[aria-current="page"\][\s\S]*background:\s*#1f2937\s*!important/,
  );
  assert.match(
    css,
    /\[data-aco-pf-root\]\s+\.aco-pf-pager__page\[aria-current="page"\][\s\S]*background:\s*color-mix\(/,
  );
  assert.match(
    css,
    /\[data-aco-pf-root\]\s+\.aco-pf-pager__page\[aria-current="page"\][\s\S]*color:\s*#fff\s*!important/,
  );
});

test("filter typography stays readable when the theme root uses a small rem", () => {
  assert.match(
    css,
    /\.aco-pf-group__summary\s*\{[\s\S]*font-size:\s*var\(--aco-pf-label-size,\s*14px\)/,
  );
  assert.match(
    css,
    /\.aco-pf-sort__label\s*\{[\s\S]*font-size:\s*var\(--aco-pf-label-size,\s*14px\)/,
  );
  assert.match(
    css,
    /\.aco-pf-sort__select\s*\{[\s\S]*font-size:\s*var\(--aco-pf-label-size,\s*14px\)/,
  );
  assert.match(
    css,
    /\.aco-pf-value\s*\{[\s\S]*font-size:\s*var\(--aco-pf-label-size,\s*14px\)/,
  );
  assert.match(css, /\.aco-pf-card__vendor\s*\{[\s\S]*font-size:\s*12px/);
});

test("product card prices stay readable when the theme root uses a small rem", () => {
  assert.match(
    css,
    /\.aco-pf-card__price\s*\{[\s\S]*font-size:\s*var\(--aco-pf-card-price-size,\s*14px\)/,
  );
});

test("purchase button labels stay readable when the theme root uses a small rem", () => {
  assert.match(
    css,
    /\.aco-pf-card__btn\s*\{[\s\S]*font-size:\s*var\(--aco-pf-btn-text-size,\s*14px\)/,
  );
  assert.match(
    css,
    /\.aco-pf-variant-modal__action,\s*\.aco-pf-variant-modal__state button\s*\{[\s\S]*font-size:\s*var\(--aco-pf-btn-text-size,\s*14px\)/,
  );
});

test("cart status labels use encoding-safe characters", () => {
  assert.match(js, /setBtnBusy\(btn, true, "Adding\.\.\."\)/);
  assert.match(js, /flashBtn\(state, btn, "Added"\)/);
  assert.match(js, /setBtnBusy\(btn, true, "\.\.\."\)/);
  assert.doesNotMatch(js, /setBtnBusy\(btn, true, "AddingÃ/);
  assert.doesNotMatch(js, /flashBtn\(state, btn, "Added Ã/);
});

test("cart count refreshes immediately after modal add to cart", async () => {
  const harness = await createVariantModalHarness({
    cartStateResponse: () => ({ item_count: 3 }),
  });
  const form = harness.document.querySelector("[data-aco-pf-variant-form]");
  submitModal(
    harness.window,
    form,
    form.querySelector('[data-aco-pf-variant-submit="cart"]'),
  );
  await flushDom();

  assert.equal(harness.cartStateCalls.length, 1);
  assert.equal(
    harness.document.querySelector(".cart-count-bubble [aria-hidden='true']")
      .textContent,
    "3",
  );
});

test("cart count bubble is created when the cart started empty", async () => {
  const harness = await createVariantModalHarness({
    withCartBubble: false,
    cartStateResponse: () => ({ item_count: 2 }),
  });
  const form = harness.document.querySelector("[data-aco-pf-variant-form]");
  submitModal(
    harness.window,
    form,
    form.querySelector('[data-aco-pf-variant-submit="cart"]'),
  );
  await flushDom();

  assert.equal(
    harness.document.querySelector(
      "#cart-icon-bubble .cart-count-bubble [aria-hidden='true']",
    ).textContent,
    "2",
  );
});

test("gallery arrows use HTML entities instead of Unicode glyphs", () => {
  assert.match(js, />&lsaquo;<\/button>/);
  assert.match(js, />&rsaquo;<\/button>/);
  assert.doesNotMatch(js, /data-aco-pf-gnav="-1"[^>]*>Ã/);
  assert.doesNotMatch(js, /data-aco-pf-gnav="1"[^>]*>Ã/);
});

test("user-visible dynamic messages contain no mojibake", () => {
  assert.match(js, /input\.placeholder = "Search\.\.\."/);
  assert.match(js, /Filtering is unavailable: no Storefront token\./);
  assert.match(js, /"Couldn't load filtered products: "/);
  assert.doesNotMatch(js, /input\.placeholder = "SearchÃ/);
  assert.doesNotMatch(js, /"CouldnÃ/);
});

test("lazy variant query requests option, price, availability, and image data", () => {
  assert.match(js, /variants\(first:250\)/);
  assert.match(js, /variants\(first:2\)/);
  assert.match(js, /selectedOptions\{name value\}/);
  assert.match(js, /compareAtPrice\{amount currencyCode\}/);
  assert.match(js, /availableForSale/);
  assert.match(js, /image\{url altText\}/);
  const variantQuery = js.slice(
    js.indexOf("query AcoPFVariantPicker"),
    js.indexOf("query AcoPFVariantPicker") + 400,
  );
  assert.match(variantQuery, /options\{name optionValues\{name\}\}/);
  assert.doesNotMatch(variantQuery, /options\{name values\}/);
});

test("variant fetch normalizes Storefront optionValues to modal option shape", async () => {
  const storefrontProduct = {
    ...defaultVariantProduct(),
    options: [
      { name: "Color", optionValues: [{ name: "Red" }, { name: "Blue" }] },
      { name: "Size", optionValues: [{ name: "S" }, { name: "M" }] },
    ],
  };
  const harness = await createVariantModalHarness({
    product: storefrontProduct,
  });

  assert.equal(
    JSON.stringify(harness.state.variantPicker.product.options),
    JSON.stringify([
      { name: "Color", values: ["Red", "Blue"] },
      { name: "Size", values: ["S", "M"] },
    ]),
  );
  assert.equal(
    harness.document.querySelectorAll("[data-aco-pf-variant-option]").length,
    4,
  );
});

test("choose variant clicks are handled before card navigation", () => {
  assert.match(js, /data-aco-pf-choose-variant/);
  assert.match(js, /openVariantPicker\(state,/);
  assert.ok(
    js.indexOf('e.target.closest("[data-aco-pf-choose-variant]")') <
      js.indexOf('e.target.closest("[data-aco-pf-card]")'),
  );
});

test("choose variant action is distinct from direct quick-buy actions", () => {
  assert.match(js, /variantMode === "chooseVariant"/);
  assert.match(js, /data-aco-pf-choose-variant/);
  assert.match(js, /chooseVariantText/);
});

test("browser product-card defaults preserve the choose variant label", () => {
  assert.match(productCardDefaults, /chooseVariantText:\s*"Choose variant"/);
});

test("choose variant action branches correctly before direct quick-buy", () => {
  assert.equal(
    (cardActionsSource.match(/data-aco-pf-choose-variant/g) || []).length,
    1,
    "choose mode should have exactly one action branch",
  );
  assert.ok(
    cardActionsSource.indexOf("if (isChooseVariant)") <
      cardActionsSource.indexOf("var vid = quickBuyVariantId"),
    "choose mode must return before direct quick-buy rendering",
  );
});

test("Liquid choose variant action requires an available multi-variant product", () => {
  assert.match(
    productGrid,
    /if product\.available[\s\S]*if pc\.variantMode == 'chooseVariant' and product\.variants\.size > 1[\s\S]*data-aco-pf-choose-variant/,
  );
  assert.match(productGrid, /data-aco-pf-variant=""/);
  assert.match(
    productGrid,
    /assign choose_variant_text = pc\.chooseVariantText \| default: 'Choose variant' \| escape/,
  );
});

test("stale variant requests cannot replace the active product", () => {
  assert.match(
    js,
    /var requestGeneration = \+\+state\.variantRequestGeneration/,
  );
  assert.match(js, /state\.activeVariantProductId = productId/);
  assert.equal(
    (
      js.match(
        /if \(!variantPickerRequestActive\(state, requestGeneration, productId\)\)\s*return;/g,
      ) || []
    ).length,
    2,
  );
});

test("variant modal exposes selectors, quantity, cart actions, and dialog semantics", () => {
  assert.match(js, /createElement\("dialog"\)/);
  assert.match(js, /modal\.setAttribute\("aria-modal", "true"\)/);
  assert.match(js, /setAttribute\("aria-labelledby", titleId\)/);
  assert.match(js, /data-aco-pf-variant-option/);
  assert.match(js, /data-aco-pf-variant-quantity/);
  assert.match(js, /data-aco-pf-variant-submit/);
});

test("variant cart submission uses selected variant and quantity", () => {
  assert.match(
    js,
    /items: \[\{ id: Number\(variantId\), quantity: quantity \}\]/,
  );
  assert.match(js, /cartAdd\(state, variantId, quantity\)/);
  assert.match(js, /createCheckoutCart\(state, variantId, quantity\)/);
  assert.match(js, /createCheckoutCart\(state, vid, 1\)/);
});

test("modal purchase buttons bypass direct card quick-buy delegation", async () => {
  const harness = await createVariantModalHarness();
  const button = harness.document.querySelector(
    '[data-aco-pf-variant-submit="cart"]',
  );

  button.dispatchEvent(
    new harness.window.Event("click", { bubbles: true, cancelable: true }),
  );

  assert.equal(harness.window.location.href, "");
  assert.equal(harness.cartCalls.length, 0);
});

test("Buy it now creates a new isolated Storefront cart", () => {
  const buyNowStart = js.indexOf("function buyNow");
  const renderingStart = js.indexOf("// ---- rendering", buyNowStart);
  const buyNowSource = js.slice(buyNowStart, renderingStart);
  const submitStart = js.indexOf("function submitVariantPicker");
  const submitSource = js.slice(submitStart, buyNowStart);

  assert.match(js, /mutation PFBuynow/);
  assert.match(js, /cartCreate/);
  assert.doesNotMatch(buyNowSource, /cartAdd\(state/);
  assert.match(submitSource, /action === "buy"\s*\?\s*createCheckoutCart/);
});

test("variant modal updates selections with the shared helper", () => {
  assert.match(js, /AcoPFVariantPicker\.optionGroups/);
  assert.match(js, /AcoPFVariantPicker\.matchingVariant/);
  assert.match(js, /AcoPFVariantPicker\.firstAvailableVariant/);
  assert.match(js, /data-aco-pf-variant-value/);
  assert.match(js, /data-aco-pf-variant-availability/);
});

test("variant modal closes accessibly and restores trigger focus", () => {
  assert.match(js, /event\.key === "Escape"/);
  assert.match(js, /data-aco-pf-variant-backdrop/);
  assert.match(js, /state\.variantPicker\.trigger\.focus\(\)/);
  assert.match(js, /data-aco-pf-variant-close/);
});

test("variant modal styles cover overlay, scrolling, selection, and mobile layout", () => {
  assert.match(css, /\.aco-pf-variant-modal\s*\{/);
  assert.match(
    css,
    /\.aco-pf-variant-modal__dialog\s*\{[\s\S]*overflow-y:\s*auto/,
  );
  assert.match(css, /\.aco-pf-variant-modal__option\.is-selected/);
  assert.match(css, /\.aco-pf-variant-modal__option\.is-unavailable/);
  assert.match(
    css,
    /@media \(max-width:\s*749px\)[\s\S]*\.aco-pf-variant-modal__dialog/,
  );
});

test("variant modal dialog keeps a stable width while options rerender", () => {
  const dialogRule = css.match(
    /\.aco-pf-variant-modal__dialog\s*\{([\s\S]*?)\n\}/,
  );

  assert.ok(dialogRule, "variant modal dialog rule should exist");
  assert.match(dialogRule[1], /width:\s*760px/);
  assert.match(dialogRule[1], /max-width:\s*100%/);
  assert.match(dialogRule[1], /min-width:\s*0/);
  assert.match(dialogRule[1], /flex:\s*0 1 760px/);
});

test("variant modal disables impossible cross-option combinations", async () => {
  const { document } = await createVariantModalHarness();
  const medium = Array.from(
    document.querySelectorAll("[data-aco-pf-variant-option]"),
  ).find(
    (button) =>
      button.getAttribute("data-aco-pf-variant-option") === "Size" &&
      button.getAttribute("data-aco-pf-variant-value") === "M",
  );

  assert.equal(medium.disabled, true);
  assert.equal(medium.classList.contains("is-unavailable"), true);
});

test("sparse variant combinations remain reachable in option order", async () => {
  const harness = await createVariantModalHarness();
  const findOption = (name, value) =>
    Array.from(
      harness.document.querySelectorAll("[data-aco-pf-variant-option]"),
    ).find(
      (button) =>
        button.getAttribute("data-aco-pf-variant-option") === name &&
        button.getAttribute("data-aco-pf-variant-value") === value,
    );

  const blue = findOption("Color", "Blue");
  assert.equal(blue.disabled, false);
  blue.dispatchEvent(
    new harness.window.Event("click", { bubbles: true, cancelable: true }),
  );
  await flushDom();

  const medium = findOption("Size", "M");
  assert.equal(medium.disabled, false);
  medium.dispatchEvent(
    new harness.window.Event("click", { bubbles: true, cancelable: true }),
  );
  await flushDom();

  assert.equal(
    harness.document
      .querySelector("[data-aco-pf-variant-form]")
      .getAttribute("data-aco-pf-variant-id"),
    "102",
  );
});

test("variant modal rejects invalid quantities without adding to cart", async () => {
  const harness = await createVariantModalHarness();
  const form = harness.document.querySelector("[data-aco-pf-variant-form]");
  const input = form.querySelector("[data-aco-pf-variant-quantity]");
  const add = form.querySelector('[data-aco-pf-variant-submit="cart"]');

  for (const value of ["", "abc", "1.5", "0", "-1", "2e2", "2items"]) {
    input.value = value;
    submitModal(harness.window, form, add);
    assert.match(
      form.querySelector("[data-aco-pf-variant-error]").textContent,
      /whole number/i,
    );
  }

  assert.equal(harness.cartCalls.length, 0);
});

test("variant modal submits the exact validated quantity", async () => {
  const harness = await createVariantModalHarness();
  const form = harness.document.querySelector("[data-aco-pf-variant-form]");
  form.querySelector("[data-aco-pf-variant-quantity]").value = "12";
  submitModal(
    harness.window,
    form,
    form.querySelector('[data-aco-pf-variant-submit="cart"]'),
  );
  await flushDom();

  assert.equal(harness.cartCalls.length, 1);
  assert.deepEqual(JSON.parse(harness.cartCalls[0].options.body), {
    items: [{ id: 101, quantity: 12 }],
  });
});

test("variant modal locks all form controls during a cart request", async () => {
  const pending = deferred();
  const harness = await createVariantModalHarness({
    product: {
      ...defaultVariantProduct(),
      variants: {
        nodes: [
          defaultVariantProduct().variants.nodes[0],
          {
            ...defaultVariantProduct().variants.nodes[1],
            title: "Blue / S",
            selectedOptions: [
              { name: "Color", value: "Blue" },
              { name: "Size", value: "S" },
            ],
          },
        ],
      },
    },
    cartResponse: () => pending.promise,
  });
  const form = harness.document.querySelector("[data-aco-pf-variant-form]");
  const add = form.querySelector('[data-aco-pf-variant-submit="cart"]');
  const buy = form.querySelector('[data-aco-pf-variant-submit="buy"]');

  submitModal(harness.window, form, add);
  submitModal(harness.window, form, buy);

  assert.equal(harness.cartCalls.length, 1);
  assert.equal(
    Array.from(form.querySelectorAll("button, input")).every(
      (control) => control.disabled,
    ),
    true,
  );

  pending.resolve({ ok: true, json: async () => ({}) });
  await flushDom();
  assert.equal(add.disabled, false);
  assert.equal(buy.disabled, false);
});

test("submitting modal ignores dismissal, mutation, retry, and reopen actions", async () => {
  async function verifyIgnored(interact) {
    const pending = deferred();
    const harness = await createVariantModalHarness({
      cartResponse: () => pending.promise,
    });
    const modal = harness.document.querySelector("dialog.aco-pf-variant-modal");
    const form = modal.querySelector("[data-aco-pf-variant-form]");
    submitModal(
      harness.window,
      form,
      form.querySelector('[data-aco-pf-variant-submit="cart"]'),
    );

    interact(harness, modal, form);
    await flushDom();

    assert.equal(modal.hasAttribute("open"), true);
    assert.equal(modal.querySelector("[data-aco-pf-variant-form]"), form);
    assert.equal(form.getAttribute("aria-busy"), "true");
    assert.equal(harness.variantCalls.length, 1);
    assert.equal(harness.cartCalls.length, 1);

    pending.resolve({
      ok: false,
      json: async () => ({ description: "Stop test request" }),
    });
    await flushDom();
  }

  await verifyIgnored((harness, modal) => {
    const escape = new harness.window.Event("keydown", {
      bubbles: true,
      cancelable: true,
    });
    Object.defineProperty(escape, "key", { value: "Escape" });
    modal.dispatchEvent(escape);
  });
  await verifyIgnored((harness, modal) => {
    modal.dispatchEvent(
      new harness.window.Event("click", { bubbles: true, cancelable: true }),
    );
  });
  await verifyIgnored((harness, modal) => {
    modal
      .querySelector("[data-aco-pf-variant-close]")
      .dispatchEvent(
        new harness.window.Event("click", { bubbles: true, cancelable: true }),
      );
  });
  await verifyIgnored((harness, _modal, form) => {
    const retry = harness.document.createElement("button");
    retry.setAttribute("data-aco-pf-variant-retry", "");
    form.appendChild(retry);
    retry.dispatchEvent(
      new harness.window.Event("click", { bubbles: true, cancelable: true }),
    );
  });
  await verifyIgnored((harness) => {
    harness.trigger.dispatchEvent(
      new harness.window.Event("click", { bubbles: true, cancelable: true }),
    );
  });
  await verifyIgnored((harness, _modal, form) => {
    form
      .querySelector("[data-aco-pf-variant-option]")
      .dispatchEvent(
        new harness.window.Event("click", { bubbles: true, cancelable: true }),
      );
  });
});

test("stale cart completion cannot affect a newer picker identity", async () => {
  const success = deferred();
  const successHarness = await createVariantModalHarness({
    checkoutResponse: () => success.promise,
  });
  const successForm = successHarness.document.querySelector(
    "[data-aco-pf-variant-form]",
  );
  submitModal(
    successHarness.window,
    successForm,
    successForm.querySelector('[data-aco-pf-variant-submit="buy"]'),
  );
  successHarness.document.querySelector(
    "[data-aco-pf-root]",
  ).__pfState.variantPicker.submissionId += 1;
  success.resolve({
    ok: true,
    json: async () => ({
      data: {
        cartCreate: {
          cart: { checkoutUrl: "/isolated-checkout" },
          userErrors: [],
        },
      },
    }),
  });
  await flushDom();

  assert.equal(successHarness.window.location.href, "");
  assert.equal(
    successForm.querySelector('[data-aco-pf-variant-submit="buy"]').disabled,
    true,
  );

  const failure = deferred();
  const failureHarness = await createVariantModalHarness({
    cartResponse: () => failure.promise,
  });
  const failureForm = failureHarness.document.querySelector(
    "[data-aco-pf-variant-form]",
  );
  submitModal(
    failureHarness.window,
    failureForm,
    failureForm.querySelector('[data-aco-pf-variant-submit="cart"]'),
  );
  failureHarness.document.querySelector(
    "[data-aco-pf-root]",
  ).__pfState.variantPicker.submissionId += 1;
  failure.reject(new Error("Old request failed"));
  await flushDom();

  assert.equal(
    failureForm.querySelector("[data-aco-pf-variant-error]").textContent,
    "",
  );
  assert.equal(
    failureForm.querySelector('[data-aco-pf-variant-submit="cart"]').disabled,
    true,
  );
});

test("variant selection rerender preserves focus on the chosen option", async () => {
  const product = defaultVariantProduct();
  product.variants.nodes[1] = {
    ...product.variants.nodes[1],
    title: "Red / M",
    selectedOptions: [
      { name: "Color", value: "Red" },
      { name: "Size", value: "M" },
    ],
  };
  const harness = await createVariantModalHarness({ product });
  const medium = Array.from(
    harness.document.querySelectorAll("[data-aco-pf-variant-option]"),
  ).find(
    (button) =>
      button.getAttribute("data-aco-pf-variant-option") === "Size" &&
      button.getAttribute("data-aco-pf-variant-value") === "M",
  );

  medium.dispatchEvent(
    new harness.window.Event("click", { bubbles: true, cancelable: true }),
  );
  await flushDom();

  assert.equal(
    harness.document.__focusedElement.getAttribute(
      "data-aco-pf-variant-option",
    ),
    "Size",
  );
  assert.equal(
    harness.document.__focusedElement.getAttribute("data-aco-pf-variant-value"),
    "M",
  );
});

test("outer dialog is the only dialog landmark", async () => {
  const { document } = await createVariantModalHarness();
  const modal = document.querySelector("dialog.aco-pf-variant-modal");

  // A native <dialog> already exposes the dialog role; a redundant role
  // attribute plus a nested landmark would announce two dialogs.
  assert.equal(modal.tagName, "DIALOG");
  assert.equal(modal.hasAttribute("role"), false);
  assert.equal(modal.getAttribute("aria-modal"), "true");
  assert.ok(modal.querySelector('[role="dialog"], dialog') === null);
});

test("Escape closes the modal and restores trigger focus", async () => {
  const harness = await createVariantModalHarness();
  const modal = harness.document.querySelector("dialog.aco-pf-variant-modal");
  const event = new harness.window.Event("keydown", {
    bubbles: true,
    cancelable: true,
  });
  Object.defineProperty(event, "key", { value: "Escape" });
  modal.dispatchEvent(event);

  assert.equal(modal.hasAttribute("open"), false);
  assert.equal(harness.document.__focusedElement, harness.trigger);
});

test("variant load errors keep focus in the modal and retry successfully", async () => {
  const product = defaultVariantProduct();
  const harness = await createVariantModalHarness({
    variantResponse(call) {
      if (call === 1) return Promise.reject(new Error("Network unavailable"));
      return Promise.resolve({
        ok: true,
        json: async () => ({ data: { node: product } }),
      });
    },
  });
  const retry = harness.document.querySelector("[data-aco-pf-variant-retry]");

  assert.ok(retry);
  assert.equal(
    harness.document.body.contains(harness.document.__focusedElement),
    true,
  );

  retry.dispatchEvent(
    new harness.window.Event("click", { bubbles: true, cancelable: true }),
  );
  await flushDom();

  assert.ok(harness.document.querySelector("[data-aco-pf-variant-form]"));
  assert.equal(harness.variantCalls.length, 2);
});

test("delayed variant error focuses a control from the new error state", async () => {
  const pending = deferred();
  const harness = await createVariantModalHarness({
    variantResponse: () => pending.promise,
  });
  const loadingClose = harness.document.querySelector(
    "[data-aco-pf-variant-close]",
  );

  assert.equal(harness.document.__focusedElement, loadingClose);
  pending.reject(new Error("Delayed network failure"));
  await flushDom();
  await flushDom();

  const retry = harness.document.querySelector("[data-aco-pf-variant-retry]");
  const errorClose = harness.document.querySelector(
    "[data-aco-pf-variant-close]",
  );
  assert.ok(retry);
  assert.notEqual(harness.document.__focusedElement, loadingClose);
  assert.ok(
    harness.document.__focusedElement === retry ||
      harness.document.__focusedElement === errorClose,
  );
});

test("Buy it now submits the selected variant and quantity then redirects", async () => {
  const harness = await createVariantModalHarness();
  const form = harness.document.querySelector("[data-aco-pf-variant-form]");
  form.querySelector("[data-aco-pf-variant-quantity]").value = "4";

  submitModal(
    harness.window,
    form,
    form.querySelector('[data-aco-pf-variant-submit="buy"]'),
  );
  await flushDom();

  assert.equal(harness.checkoutCalls.length, 1);
  assert.deepEqual(
    JSON.parse(harness.checkoutCalls[0].options.body).variables,
    {
      input: {
        lines: [
          {
            merchandiseId: "gid://shopify/ProductVariant/101",
            quantity: 4,
          },
        ],
      },
    },
  );
  assert.equal(harness.cartCalls.length, 0);
  assert.equal(harness.window.location.href, "/isolated-checkout");
});

test("variant modal uses merchant-configured purchase labels", async () => {
  const harness = await createVariantModalHarness({
    productCard: {
      showBuyNow: true,
      afterAddToCart: "stay",
      addToCartText: "Add this item",
      buyNowText: "Checkout now",
    },
  });
  const form = harness.document.querySelector("[data-aco-pf-variant-form]");

  assert.equal(
    form.querySelector('[data-aco-pf-variant-submit="cart"]').textContent,
    "Add this item",
  );
  assert.equal(
    form.querySelector('[data-aco-pf-variant-submit="buy"]').textContent,
    "Checkout now",
  );
});

test("stay-mode modal success flashes the card trigger, not the closed modal", async () => {
  const harness = await createVariantModalHarness();
  await flushDom();
  const modal = harness.document.querySelector("dialog.aco-pf-variant-modal");
  const form = modal.querySelector("[data-aco-pf-variant-form]");
  const add = form.querySelector('[data-aco-pf-variant-submit="cart"]');

  submitModal(harness.window, form, add);
  await flushDom();

  assert.equal(modal.hasAttribute("open"), false);
  assert.equal(
    harness.document.__focusedElement === harness.trigger,
    true,
    "focus should return to the modal trigger",
  );
  assert.equal(harness.trigger.textContent, "Added");
  assert.equal(
    harness.trigger.classList.contains("aco-pf-card__btn--flash"),
    true,
  );
  assert.equal(harness.window.location.href, "");
});

test("flashed choose variant trigger restores its merchant label", async () => {
  const harness = await createVariantModalHarness({
    productCard: {
      showBuyNow: true,
      afterAddToCart: "stay",
      chooseVariantText: "Select options",
    },
  });
  const form = harness.document.querySelector("[data-aco-pf-variant-form]");

  submitModal(
    harness.window,
    form,
    form.querySelector('[data-aco-pf-variant-submit="cart"]'),
  );
  await flushDom();

  assert.equal(harness.trigger.textContent, "Added");
  await new Promise((resolve) => setTimeout(resolve, 1700));
  assert.equal(harness.trigger.textContent, "Select options");
});

test("cart-mode modal success preserves cart redirect", async () => {
  const harness = await createVariantModalHarness({
    productCard: { showBuyNow: true, afterAddToCart: "cart" },
  });
  const modal = harness.document.querySelector("dialog.aco-pf-variant-modal");
  const form = modal.querySelector("[data-aco-pf-variant-form]");

  submitModal(
    harness.window,
    form,
    form.querySelector('[data-aco-pf-variant-submit="cart"]'),
  );
  await flushDom();

  assert.equal(harness.window.location.href, "/cart");
  assert.equal(modal.hasAttribute("open"), true);
});

test("cart request failure shows an error and permits another submission", async () => {
  const harness = await createVariantModalHarness({
    cartResponse(call) {
      if (call === 1) {
        return Promise.resolve({
          ok: false,
          json: async () => ({ description: "Variant is unavailable" }),
        });
      }
      return Promise.resolve({ ok: true, json: async () => ({}) });
    },
  });
  const form = harness.document.querySelector("[data-aco-pf-variant-form]");
  const add = form.querySelector('[data-aco-pf-variant-submit="cart"]');

  submitModal(harness.window, form, add);
  await flushDom();

  assert.match(
    form.querySelector("[data-aco-pf-variant-error]").textContent,
    /Variant is unavailable/,
  );
  assert.equal(add.disabled, false);

  submitModal(harness.window, form, add);
  await flushDom();

  assert.equal(harness.cartCalls.length, 2);
  assert.equal(harness.trigger.textContent, "Added");
});

test("backdrop click closes the modal and restores trigger focus", async () => {
  const harness = await createVariantModalHarness();
  const modal = harness.document.querySelector("dialog.aco-pf-variant-modal");

  modal.dispatchEvent(
    new harness.window.Event("click", { bubbles: true, cancelable: true }),
  );

  assert.equal(modal.hasAttribute("open"), false);
  assert.equal(harness.document.__focusedElement, harness.trigger);
});

test("Tab and Shift-Tab wrap focus inside the modal", async () => {
  const harness = await createVariantModalHarness();
  const modal = harness.document.querySelector("dialog.aco-pf-variant-modal");
  const focusable = Array.from(
    modal.querySelectorAll(
      'button:not([disabled]), input:not([disabled]), select:not([disabled]), [tabindex]:not([tabindex="-1"])',
    ),
  );
  const first = focusable[0];
  const last = focusable[focusable.length - 1];

  last.focus();
  const tab = new harness.window.Event("keydown", {
    bubbles: true,
    cancelable: true,
  });
  Object.defineProperties(tab, {
    key: { value: "Tab" },
    shiftKey: { value: false },
  });
  modal.dispatchEvent(tab);
  assert.equal(tab.defaultPrevented, true);
  assert.equal(harness.document.__focusedElement, first);

  const shiftTab = new harness.window.Event("keydown", {
    bubbles: true,
    cancelable: true,
  });
  Object.defineProperties(shiftTab, {
    key: { value: "Tab" },
    shiftKey: { value: true },
  });
  modal.dispatchEvent(shiftTab);
  assert.equal(shiftTab.defaultPrevented, true);
  assert.equal(harness.document.__focusedElement, last);
});

test("option selection updates variant details and submission ID", async () => {
  const product = defaultVariantProduct();
  product.variants.nodes[1] = {
    ...product.variants.nodes[1],
    title: "Red / M",
    selectedOptions: [
      { name: "Color", value: "Red" },
      { name: "Size", value: "M" },
    ],
    image: {
      url: "https://cdn.example/red-medium.jpg",
      altText: "Red medium",
    },
    compareAtPrice: { amount: "15.00", currencyCode: "USD" },
  };
  const harness = await createVariantModalHarness({ product });
  const medium = Array.from(
    harness.document.querySelectorAll("[data-aco-pf-variant-option]"),
  ).find(
    (button) =>
      button.getAttribute("data-aco-pf-variant-option") === "Size" &&
      button.getAttribute("data-aco-pf-variant-value") === "M",
  );

  medium.dispatchEvent(
    new harness.window.Event("click", { bubbles: true, cancelable: true }),
  );
  await flushDom();

  const form = harness.document.querySelector("[data-aco-pf-variant-form]");
  assert.equal(form.getAttribute("data-aco-pf-variant-id"), "102");
  assert.equal(
    harness.document
      .querySelector(".aco-pf-variant-modal__image")
      .getAttribute("src"),
    "https://cdn.example/red-medium.jpg",
  );
  assert.match(
    harness.document.querySelector(".aco-pf-variant-modal__price").textContent,
    /12\.00/,
  );
  assert.match(
    harness.document.querySelector("[data-aco-pf-variant-availability]")
      .textContent,
    /In stock/,
  );
  assert.equal(
    harness.document.querySelector(".aco-pf-variant-modal__variant-title")
      .textContent,
    "Red / M",
  );
});

test("variant availability can transition from available to unavailable", async () => {
  const harness = await createVariantModalHarness();
  const state =
    harness.document.querySelector("[data-aco-pf-root]").__pfState
      .variantPicker;
  state.variants.forEach((variant) => {
    variant.availableForSale = false;
  });
  const selected = harness.document.querySelector(
    '[data-aco-pf-variant-option][aria-pressed="true"]',
  );

  selected.dispatchEvent(
    new harness.window.Event("click", { bubbles: true, cancelable: true }),
  );
  await flushDom();

  const form = harness.document.querySelector("[data-aco-pf-variant-form]");
  assert.equal(form.getAttribute("data-aco-pf-variant-id"), "");
  assert.match(
    form.querySelector("[data-aco-pf-variant-availability]").textContent,
    /Out of stock/,
  );
  assert.equal(
    Array.from(form.querySelectorAll("[data-aco-pf-variant-submit]")).every(
      (button) => button.disabled,
    ),
    true,
  );
});

test("all-unavailable products render disabled purchase controls", async () => {
  const product = defaultVariantProduct();
  product.variants.nodes.forEach((variant) => {
    variant.availableForSale = false;
  });
  const harness = await createVariantModalHarness({ product });
  const form = harness.document.querySelector("[data-aco-pf-variant-form]");

  assert.equal(form.getAttribute("data-aco-pf-variant-id"), "");
  assert.match(
    form.querySelector("[data-aco-pf-variant-availability]").textContent,
    /Out of stock/,
  );
  assert.equal(
    Array.from(form.querySelectorAll("[data-aco-pf-variant-option]")).every(
      (button) => button.disabled,
    ),
    true,
  );
  assert.equal(
    Array.from(form.querySelectorAll("[data-aco-pf-variant-submit]")).every(
      (button) => button.disabled,
    ),
    true,
  );
});

test("numeric SSR product ids are normalized to a Storefront product GID", async () => {
  const harness = await createVariantModalHarness({
    triggerProductId: "8123456789012",
  });

  assert.equal(harness.variantCalls.length, 1);
  assert.equal(
    JSON.parse(harness.variantCalls[0].options.body).variables.id,
    "gid://shopify/Product/8123456789012",
  );
  assert.ok(harness.document.querySelector("[data-aco-pf-variant-form]"));
});

test("existing product GIDs reach the Storefront query unchanged", async () => {
  const harness = await createVariantModalHarness();

  assert.equal(
    JSON.parse(harness.variantCalls[0].options.body).variables.id,
    "gid://shopify/Product/10",
  );
});

test("numeric and GID triggers share one cached variant request", async () => {
  const harness = await createVariantModalHarness({
    triggerProductId: "10",
  });
  harness.trigger.setAttribute(
    "data-aco-pf-product",
    "gid://shopify/Product/10",
  );
  harness.document
    .querySelector("dialog.aco-pf-variant-modal")
    .querySelector("[data-aco-pf-variant-close]")
    .dispatchEvent(
      new harness.window.Event("click", { bubbles: true, cancelable: true }),
    );
  harness.trigger.dispatchEvent(
    new harness.window.Event("click", { bubbles: true, cancelable: true }),
  );
  await flushDom();

  assert.equal(harness.variantCalls.length, 1);
});

test("modal lives under the filter root so merchant CSS variables apply", async () => {
  const harness = await createVariantModalHarness({
    cssVars: "--aco-pf-btn-bg: #ff0000;",
  });
  const modal = harness.document.querySelector("dialog.aco-pf-variant-modal");

  assert.ok(modal.parentNode === harness.root);
  assert.match(js, /state\.root\.appendChild\(modal\)/);
  assert.doesNotMatch(js, /document\.body\.appendChild\(modal\)/);
});

test("modal mirrors the merchant outline button style", async () => {
  const solid = await createVariantModalHarness();
  const outline = await createVariantModalHarness({
    productCard: {
      showBuyNow: true,
      afterAddToCart: "stay",
      buttonStyle: "outline",
    },
  });

  assert.equal(
    solid.document
      .querySelector("dialog.aco-pf-variant-modal")
      .classList.contains("aco-pf-variant-modal--btn-outline"),
    false,
  );
  assert.equal(
    outline.document
      .querySelector("dialog.aco-pf-variant-modal")
      .classList.contains("aco-pf-variant-modal--btn-outline"),
    true,
  );
  assert.match(
    css,
    /\.aco-pf-variant-modal--btn-outline \.aco-pf-variant-modal__action\s*\{[\s\S]*background:\s*transparent/,
  );
  assert.match(
    css,
    /\.aco-pf-variant-modal--btn-outline \.aco-pf-variant-modal__action:hover\s*\{[\s\S]*background:\s*var\(--aco-pf-btn-bg/,
  );
});

test("modal omits Add to cart when the merchant disabled it", async () => {
  const harness = await createVariantModalHarness({
    productCard: {
      showAddToCart: false,
      showBuyNow: true,
      afterAddToCart: "stay",
    },
  });
  const form = harness.document.querySelector("[data-aco-pf-variant-form]");

  assert.ok(form.querySelector('[data-aco-pf-variant-submit="cart"]') === null);
  assert.ok(form.querySelector('[data-aco-pf-variant-submit="buy"]'));
  assert.equal(
    form
      .querySelector(".aco-pf-variant-modal__actions")
      .classList.contains("aco-pf-variant-modal__actions--single"),
    true,
  );

  submitModal(
    harness.window,
    form,
    form.querySelector('[data-aco-pf-variant-submit="buy"]'),
  );
  await flushDom();

  assert.equal(harness.cartCalls.length, 0);
  assert.equal(harness.checkoutCalls.length, 1);
  assert.equal(harness.window.location.href, "/isolated-checkout");
});

test("Add to cart stays available when only it is enabled", async () => {
  const harness = await createVariantModalHarness({
    productCard: {
      showAddToCart: true,
      showBuyNow: false,
      afterAddToCart: "stay",
    },
  });
  const form = harness.document.querySelector("[data-aco-pf-variant-form]");

  assert.ok(form.querySelector('[data-aco-pf-variant-submit="cart"]'));
  assert.ok(form.querySelector('[data-aco-pf-variant-submit="buy"]') === null);
});

test("grid rerender closes an idle modal before triggers detach", async () => {
  const harness = await createVariantModalHarness({ withGrid: true });
  const modal = harness.document.querySelector("dialog.aco-pf-variant-modal");

  assert.equal(modal.hasAttribute("open"), true);

  harness.window.dispatchEvent(new harness.window.Event("popstate"));
  await flushDom();

  assert.equal(modal.hasAttribute("open"), false);
  assert.equal(harness.state.activeVariantProductId, null);
});

test("grid rerender cannot close a submitting modal", async () => {
  const pending = deferred();
  const harness = await createVariantModalHarness({
    withGrid: true,
    cartResponse: () => pending.promise,
  });
  const modal = harness.document.querySelector("dialog.aco-pf-variant-modal");
  const form = modal.querySelector("[data-aco-pf-variant-form]");
  submitModal(
    harness.window,
    form,
    form.querySelector('[data-aco-pf-variant-submit="cart"]'),
  );

  harness.window.dispatchEvent(new harness.window.Event("popstate"));
  await flushDom();

  assert.equal(modal.hasAttribute("open"), true);
  assert.equal(form.getAttribute("aria-busy"), "true");

  pending.resolve({
    ok: false,
    json: async () => ({ description: "Stop test request" }),
  });
  await flushDom();
});

test("dialog uses the product title as its accessible name and is centered", async () => {
  const harness = await createVariantModalHarness();
  const modal = harness.document.querySelector("dialog.aco-pf-variant-modal");
  const titleId = modal.getAttribute("aria-labelledby");

  assert.ok(titleId);
  assert.equal(modal.hasAttribute("aria-label"), false);
  assert.equal(
    harness.document.getElementById(titleId).textContent,
    "Test Product",
  );
  assert.match(
    css,
    /\.aco-pf-variant-modal\[open\]\s*\{[\s\S]*align-items:\s*center[\s\S]*justify-content:\s*center/,
  );
  assert.match(
    css,
    /\.aco-pf-variant-modal::backdrop\s*\{[\s\S]*background:\s*transparent/,
  );
});

test("loading and error states keep a fallback accessible name", async () => {
  const pending = deferred();
  const harness = await createVariantModalHarness({
    variantResponse: () => pending.promise,
  });
  const modal = harness.document.querySelector("dialog.aco-pf-variant-modal");

  assert.equal(modal.getAttribute("aria-label"), "Choose variant");
  assert.equal(modal.hasAttribute("aria-labelledby"), false);

  pending.reject(new Error("Delayed network failure"));
  await flushDom();
  await flushDom();

  assert.equal(modal.getAttribute("aria-label"), "Choose variant");
  assert.equal(modal.hasAttribute("aria-labelledby"), false);
});

test("modal announces availability changes and errors in one live region", async () => {
  const harness = await createVariantModalHarness();
  const modal = harness.document.querySelector("dialog.aco-pf-variant-modal");
  const live = modal.querySelector("[data-aco-pf-variant-live]");

  assert.ok(live);
  assert.equal(live.getAttribute("role"), "status");
  assert.equal(live.getAttribute("aria-live"), "polite");
  assert.match(live.textContent, /In stock/);

  harness.state.variantPicker.variants.forEach((variant) => {
    variant.availableForSale = false;
  });
  modal
    .querySelector('[data-aco-pf-variant-option][aria-pressed="true"]')
    .dispatchEvent(
      new harness.window.Event("click", { bubbles: true, cancelable: true }),
    );
  await flushDom();

  assert.ok(modal.querySelector("[data-aco-pf-variant-live]") === live);
  assert.match(live.textContent, /Out of stock/);
});

test("cart failures are announced in the live region", async () => {
  const harness = await createVariantModalHarness({
    cartResponse: () =>
      Promise.resolve({
        ok: false,
        json: async () => ({ description: "Variant is unavailable" }),
      }),
  });
  const modal = harness.document.querySelector("dialog.aco-pf-variant-modal");
  const form = modal.querySelector("[data-aco-pf-variant-form]");

  submitModal(
    harness.window,
    form,
    form.querySelector('[data-aco-pf-variant-submit="cart"]'),
  );
  await flushDom();

  assert.match(
    modal.querySelector("[data-aco-pf-variant-live]").textContent,
    /Variant is unavailable/,
  );
});

test("theme injection copies and loads the variant helper asset", () => {
  const copyList = themeInjectServer.slice(
    themeInjectServer.indexOf("const COPY_FILES"),
    themeInjectServer.indexOf("const THEME_FILES_QUERY"),
  );

  assert.match(copyList, /dest: "assets\/aco-pf-variant-picker\.shared\.js"/);
  assert.match(
    copyList,
    /src: "extensions\/filter-search\/assets\/pf-variant-picker\.shared\.js"/,
  );

  const variantHelper = themeInjectSnippet.indexOf(
    `<script src="{{ 'aco-pf-variant-picker.shared.js' | asset_url }}"`,
  );
  const filters = themeInjectSnippet.indexOf(
    `<script src="{{ 'aco-pf-filters.js' | asset_url }}"`,
  );

  assert.ok(variantHelper >= 0);
  assert.ok(variantHelper < filters);
  assert.match(
    themeInjectSnippet,
    /aco-pf-variant-picker\.shared\.js' \| asset_url \}\}" defer="defer"/,
  );
});

// ---- Custom filters: variant-level membership (issue #4) ------------------

function fnSource(name) {
  const start = js.indexOf("  function " + name + "(");
  assert.ok(start !== -1, "missing function " + name);
  // The file may use CRLF line endings.
  const closing = /\r?\n  \}\r?\n/g;
  closing.lastIndex = start;
  const match = closing.exec(js);
  assert.ok(match, "unterminated function " + name);
  return js.slice(start, match.index + match[0].length);
}

function customVariantApi() {
  const context = { Set, Object, String, Boolean };
  vm.runInNewContext(
    ["bareId", "customVariantRestriction", "withPickedVariants", "productUrl"]
      .map(fnSource)
      .join("\n"),
    context,
  );
  return context;
}

test("customVariantRestriction narrows to picked variants (OR within, AND across groups)", () => {
  const api = customVariantApi();
  const state = {
    customIds: {
      custom_occasion: {
        formal: new Set(["1", "2"]),
        party: new Set(["1"]),
      },
      custom_season: { summer: new Set(["1"]) },
    },
    customVariants: {
      custom_occasion: {
        formal: { 1: ["11", "12"] },
        party: { 1: ["13"] },
      },
      custom_season: { summer: { 1: ["12", "13"] } },
    },
    customSel: { custom_occasion: ["formal"] },
  };

  assert.deepEqual(api.customVariantRestriction(state, "1"), ["11", "12"]);
  // Product 2 was picked as a whole product: no restriction.
  assert.equal(api.customVariantRestriction(state, "2"), null);

  state.customSel = { custom_occasion: ["formal", "party"] };
  assert.deepEqual(api.customVariantRestriction(state, "1").sort(), [
    "11",
    "12",
    "13",
  ]);

  state.customSel = {
    custom_occasion: ["formal"],
    custom_season: ["summer"],
  };
  assert.deepEqual(api.customVariantRestriction(state, "1"), ["12"]);

  state.customSel = {};
  assert.equal(api.customVariantRestriction(state, "1"), null);
});

test("withPickedVariants shows the picked variant without mutating the cached node", () => {
  const api = customVariantApi();
  const node = {
    id: "gid://shopify/Product/1",
    handle: "plush",
    availableForSale: true,
    featuredImage: { url: "default.jpg" },
    priceRange: { minVariantPrice: { amount: "10.0", currencyCode: "INR" } },
    variants: { nodes: [] },
  };
  const state = {
    customVariantCache: {
      "gid://shopify/ProductVariant/11": {
        id: "gid://shopify/ProductVariant/11",
        availableForSale: false,
        price: { amount: "20.0", currencyCode: "INR" },
        image: { url: "black.jpg" },
      },
      "gid://shopify/ProductVariant/12": {
        id: "gid://shopify/ProductVariant/12",
        availableForSale: true,
        price: { amount: "25.0", currencyCode: "INR" },
        compareAtPrice: { amount: "30.0", currencyCode: "INR" },
        image: { url: "blue.jpg" },
      },
    },
  };

  const out = api.withPickedVariants(state, node, ["11", "12"]);
  assert.equal(out.pfVariantId, "12"); // first available picked variant
  assert.equal(out.featuredImage.url, "blue.jpg");
  assert.equal(out.priceRange.minVariantPrice.amount, "25.0");
  assert.equal(out.compareAtPriceRange.minVariantPrice.amount, "30.0");
  assert.equal(out.variants.nodes.length, 2);
  assert.equal(api.productUrl(out), "/products/plush?variant=12");

  // Shared card cache entry is untouched.
  assert.equal(node.featuredImage.url, "default.jpg");
  assert.equal(api.productUrl(node), "/products/plush");

  // Unknown variants: render the product as usual.
  assert.equal(api.withPickedVariants(state, node, ["99"]), node);
});

test("custom filter liquid embeds variant membership", () => {
  const groupSnippet = readFileSync(
    fileURLToPath(
      new URL("../snippets/pf-config-group.liquid", import.meta.url),
    ),
    "utf8",
  );
  assert.match(groupSnippet, /"vids":\{\{ vm\.vids \| json \}\}/);
});

test("sort position 'top-right' renders the dropdown just left of the column switcher", () => {
  const headEnd = themeInjectSnippet.slice(
    themeInjectSnippet.indexOf('<div class="aco-pf-results__head-end">'),
  );
  const sortAt = headEnd.indexOf("cfg.sort.position == 'top-right'");
  const colsAt = headEnd.indexOf("data-aco-pf-cols-switch");
  assert.ok(sortAt > -1, "top-right sort rendered inside the head-end");
  assert.ok(sortAt < colsAt, "top-right sort comes before the column switcher");
  assert.match(
    themeInjectSnippet,
    /cfg\.sort\.position != 'panel' and cfg\.sort\.position != 'top-right'/,
    "the toolbar placement no longer also renders for top-right",
  );
});

test("top-right sort sits inline (label beside select, no bottom margin)", () => {
  assert.match(
    css,
    /\.aco-pf-sort--top-right\s*\{[^}]*flex-direction:\s*row[^}]*margin-bottom:\s*0/,
  );
  assert.match(
    css,
    /\.aco-pf-sort--top-right \.aco-pf-sort__select\s*\{[^}]*width:\s*auto/,
  );
});

// "Bordered card" is the single switch for card borders, on every layout,
// in the storefront and the admin preview alike.
const previewCss = readFileSync(
  fileURLToPath(
    new URL("../../../app/styles/product-card-preview.css", import.meta.url),
  ),
  "utf8",
);
const ruleBody = (src, selector) => {
  // Exact selector at the start of a line (not as a descendant of another).
  const esc = selector.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  // Every rule with exactly this selector, bodies joined.
  const re = new RegExp("(^|\\n)" + esc + "\\s*\\{([^}]*)\\}", "g");
  const bodies = [...src.matchAll(re)].map((m) => m[2]);
  return bodies.length ? bodies.join("\n") : null;
};

test("split cards only get a border when 'Bordered card' is on (storefront)", () => {
  const body = ruleBody(css, ".aco-pf-grid--layout-split .aco-pf-card");
  assert.ok(body, "split card rule exists");
  assert.doesNotMatch(
    body,
    /(^|;|\s)border:/,
    "split base rule draws no border",
  );
});

test("split cards only get a border when 'Bordered card' is on (admin preview)", () => {
  const body = ruleBody(
    previewCss,
    ".aco-pf-preview-root .aco-pf-grid--layout-split .aco-pf-card",
  );
  assert.ok(body, "preview split card rule exists");
  assert.doesNotMatch(
    body,
    /(^|;|\s)border:/,
    "preview split base rule draws no border",
  );
});

test("loading placeholders follow 'Bordered card' instead of always drawing a border", () => {
  for (const sel of [
    ".aco-pf-card--skeleton-classic",
    ".aco-pf-card--skeleton-split",
  ]) {
    const body = ruleBody(css, sel);
    assert.ok(body, sel + " rule exists");
    assert.doesNotMatch(
      body,
      /(^|;|\s)border:/,
      sel + " has no unconditional border",
    );
  }
  assert.match(
    css,
    /\.aco-pf-grid--card \.aco-pf-card--skeleton-classic,\s*\.aco-pf-grid--card \.aco-pf-card--skeleton-split\s*\{[^}]*border:\s*1px solid var\(--aco-pf-card-border/,
  );
});

function cardMediaApi() {
  const context = {
    String,
    Math,
    EAGER_CARD_COUNT: 4,
    escapeHtml: (s) => String(s).replace(/&/g, "&amp;").replace(/"/g, "&quot;"),
    cardFlagHtml: () => "",
  };
  vm.runInNewContext(
    [
      "cdnImageWidth",
      "cardImgSizes",
      "cardImgAttrs",
      "cardMediaHtml",
      "hydrateSlide",
      "hydrateGallery",
    ]
      .map(fnSource)
      .join("\n"),
    context,
  );
  return context;
}

const MEDIA_STATE = {
  productCard: {
    imageSlideshow: true,
    slideshowMaxImages: 3,
    slideshowMode: "hover",
  },
};
const CDN = "https://cdn.shopify.com/s/files/p.jpg?v=1";

test("JS card images request resized CDN widths, never the original upload", () => {
  const api = cardMediaApi();
  const html = api.cardMediaHtml(
    { productCard: {} },
    { title: "T", featuredImage: { url: CDN, altText: "" } },
    9,
  );
  assert.match(
    html,
    /src="https:\/\/cdn\.shopify\.com\/s\/files\/p\.jpg\?v=1&amp;width=400"/,
  );
  assert.match(html, /p\.jpg\?v=1&amp;width=200 200w/);
  assert.match(html, /p\.jpg\?v=1&amp;width=600 600w/);
  assert.doesNotMatch(html, /src="[^"]*p\.jpg\?v=1"/);
  assert.equal(
    api.cdnImageWidth("https://x/a.jpg", 400),
    "https://x/a.jpg?width=400",
  );
});

test("first-row JS cards load eagerly at high priority; the rest stay lazy", () => {
  const api = cardMediaApi();
  const n = { title: "T", featuredImage: { url: CDN } };
  const first = api.cardMediaHtml({ productCard: {} }, n, 0);
  assert.match(first, /loading="eager" fetchpriority="high"/);
  const fifth = api.cardMediaHtml({ productCard: {} }, n, 4);
  assert.match(fifth, /loading="lazy"/);
  assert.doesNotMatch(fifth, /fetchpriority/);
});

test("slideshow: only the first slide has a src; later slides defer until shown", () => {
  const api = cardMediaApi();
  const n = {
    title: "T",
    images: {
      nodes: [
        { url: CDN },
        { url: CDN + "b" },
        { url: CDN + "c" },
        { url: CDN + "d" },
      ],
    },
  };
  const html = api.cardMediaHtml(MEDIA_STATE, n, 0);
  const { document } = parseHTML("<div>" + html + "</div>");
  const slides = [...document.querySelectorAll(".aco-pf-card__slide")];
  assert.equal(slides.length, 3, "respects slideshowMaxImages");
  assert.ok(slides[0].getAttribute("src"));
  assert.equal(slides[0].getAttribute("fetchpriority"), "high");
  for (const s of slides.slice(1)) {
    assert.equal(s.getAttribute("src"), null);
    assert.equal(s.getAttribute("srcset"), null);
    assert.ok(s.getAttribute("data-aco-pf-src"));
  }

  api.hydrateGallery(document.querySelector("div"));
  for (const s of slides) {
    assert.ok(s.getAttribute("src"));
    assert.ok(s.getAttribute("srcset"));
    assert.equal(s.getAttribute("data-aco-pf-src"), null);
  }
});

test("SSR grid: first row eager, later slides deferred", () => {
  assert.match(productGrid, /if forloop\.index <= 4\s+assign pf_eager = true/);
  assert.match(productGrid, /\{\{ pf_img_attr \}\}src=/);
  assert.match(productGrid, /\{\{ pf_img_attr \}\}srcset=/);
  assert.match(productGrid, /assign pf_img_attr = 'data-aco-pf-'/);
  assert.match(
    productGrid,
    /\{% if pf_eager %\}loading="eager" fetchpriority="high"/,
  );
});

test("card image sizes follow the column count and the split layout", () => {
  const api = cardMediaApi();
  assert.equal(
    api.cardImgSizes({ columns: 3, productCard: {} }, true),
    "(min-width: 750px) 33vw, 50vw",
  );
  assert.equal(
    api.cardImgSizes(
      { columns: 4, productCard: { cardLayout: "split" } },
      true,
    ),
    "(min-width: 750px) 12vw, 25vw",
  );
  // Lazy images let the browser measure the real width.
  assert.equal(
    api.cardImgSizes(
      { columns: 3, productCard: { cardLayout: "split" } },
      false,
    ),
    "auto, (min-width: 750px) 16vw, 25vw",
  );
  const html = api.cardMediaHtml(
    { columns: 3, productCard: { cardLayout: "split" } },
    { title: "T", featuredImage: { url: CDN } },
    0,
  );
  assert.match(html, /sizes="\(min-width: 750px\) 16vw, 25vw"/);
});

test("SSR grid sizes: per-column share, halved for split, auto on lazy images", () => {
  // The 3/4 column switch is client-side, so SSR never assumes > 3 columns.
  assert.match(productGrid, /if size_cols > 3\s+assign size_cols = 3/);
  assert.match(productGrid, /assign img_vw = 100 \| divided_by: size_cols/);
  assert.match(
    productGrid,
    /if card_layout == 'split'\s+assign img_vw = img_vw \| divided_by: 2/,
  );
  assert.match(
    productGrid,
    /assign img_sizes_lazy = 'auto, ' \| append: img_sizes/,
  );
  assert.doesNotMatch(productGrid, /sizes="\(min-width: 750px\) 25vw, 50vw"/);
});

test("a filter change paints skeletons once (loadPage owns them)", () => {
  const runSrc = fnSource("run");
  assert.doesNotMatch(
    runSrc,
    /\n      showGridSkeletons\(state, state\.perPage\);\r?\n    \}\r?\n\r?\n    loadPage\(state\);/,
  );
  assert.match(
    fnSource("loadPage"),
    /showGridSkeletons\(state, state\.perPage\)/,
  );
});

test("hideNativeThemeGrid hides what follows the app but keeps the page's search box", () => {
  const { document } = parseHTML(
    '<div class="shopify-section">' +
      '<div id="aco-pf-inject" data-aco-pf-root></div>' +
      '<div class="wrap"><form action="/search"><span class="ph">Search</span><input name="q"><button>Go</button></form>' +
      '<xo-grid><a href="/products/a">A</a></xo-grid>' +
      '<div class="facets"><input name="filter.v.price.gte"></div></div>' +
      "<xo-filters-top></xo-filters-top></div>",
  );
  const root = document.getElementById("aco-pf-inject");
  const src = js.slice(
    js.indexOf("var NATIVE_KEEP"),
    js.indexOf("function themeStorageKey"),
  );
  new Function("state", src + "\nreturn hideNativeThemeGrid(state);")({
    root,
    nativeHideRescheduled: true,
  }); // node has no window/document
  const hidden = [
    ...document.querySelectorAll("[data-aco-pf-hidden-theme-grid]"),
  ].map(
    (e) => e.tagName.toLowerCase() + (e.className ? "." + e.className : ""),
  );
  assert.deepEqual(hidden.sort(), ["div.facets", "xo-filters-top", "xo-grid"]);
  assert.ok(
    !document
      .querySelector("form")
      .hasAttribute("data-aco-pf-hidden-theme-grid"),
  );
  for (const sel of ["span.ph", "button"]) {
    assert.ok(
      !document
        .querySelector(sel)
        .hasAttribute("data-aco-pf-hidden-theme-grid"),
      sel,
    );
  }
});

test("hideNativeThemeGrid honours data-keep-selectors and ignores an invalid one", () => {
  const html =
    '<div class="shopify-section"><div id="aco-pf-inject" data-aco-pf-root data-keep-selectors="KEEP"></div>' +
    '<div class="wrap"><p class="intro">Hi</p><xo-grid><a href="/products/a">A</a></xo-grid></div></div>';
  const src = js.slice(
    js.indexOf("var NATIVE_KEEP"),
    js.indexOf("function themeStorageKey"),
  );
  const run = (keep) => {
    const { document } = parseHTML(html.replace("KEEP", keep));
    const root = document.getElementById("aco-pf-inject");
    new Function("state", src + "\nreturn hideNativeThemeGrid(state);")({
      root,
      nativeHideRescheduled: true,
    });
    return [
      ...document.querySelectorAll("[data-aco-pf-hidden-theme-grid]"),
    ].map((e) => e.tagName.toLowerCase());
  };
  assert.deepEqual(run(".intro"), ["xo-grid"]);
  assert.deepEqual(run("[[bad"), ["div"]);
});

test("hideNativeThemeGrid keeps the valid parts of a keep list with one invalid part", () => {
  const html =
    '<div class="shopify-section"><div id="aco-pf-inject" data-aco-pf-root data-keep-selectors=".intro, div:foo"></div>' +
    '<div class="wrap"><p class="intro">Hi</p><xo-grid><a href="/products/a">A</a></xo-grid></div></div>';
  const src = js.slice(
    js.indexOf("var NATIVE_KEEP"),
    js.indexOf("function themeStorageKey"),
  );
  const { document } = parseHTML(html);
  const root = document.getElementById("aco-pf-inject");
  new Function("state", src + "\nreturn hideNativeThemeGrid(state);")({
    root,
    nativeHideRescheduled: true,
  });
  assert.deepEqual(
    [...document.querySelectorAll("[data-aco-pf-hidden-theme-grid]")].map((e) =>
      e.tagName.toLowerCase(),
    ),
    ["xo-grid"],
  );
});

test("a store-wide facet snapshot (search fallback) never drives the grid", () => {
  const src = js.slice(
    js.indexOf("function snapshotUsable"),
    js.indexOf("function matchedIdsFor"),
  );
  const usable = new Function(
    "state",
    "function gridSortable(){return true;}\n" +
      src +
      "\nreturn snapshotUsable(state);",
  );
  const base = {
    snapshot: [{}],
    snapshotPartial: false,
    snapshotCapped: false,
  };
  assert.equal(usable({ ...base }), true);
  assert.equal(usable({ ...base, snapshotStoreWide: true }), false);
});

test("description-only search: native results are shown until a filter is applied", () => {
  const src = js.slice(
    js.indexOf("function nativeResultsFallback"),
    js.indexOf("function ensureMatched"),
  );
  const { document } = parseHTML(
    '<div class="shopify-section"><div id="aco-pf-inject" data-aco-pf-root><div data-aco-pf-results></div></div>' +
      '<div class="native" data-aco-pf-hidden-theme-grid><a href="/products/a">A</a></div></div>',
  );
  const root = document.getElementById("aco-pf-inject");
  const calls = { hide: 0 };
  const run = (state, nodes, active) =>
    new Function(
      "state",
      "nodes",
      "hasActiveSelection",
      "hideNativeThemeGrid",
      src + "\nreturn nativeResultsFallback(state, nodes);",
    )(
      state,
      nodes,
      () => active,
      () => {
        calls.hide++;
      },
    );
  const state = {
    root,
    context: "search",
    snapshotStoreWide: true,
    pageNum: 1,
  };
  assert.equal(run(state, [], false), true);
  assert.equal(
    document
      .querySelector(".native")
      .hasAttribute("data-aco-pf-hidden-theme-grid"),
    false,
  );
  assert.equal(
    root.querySelector("[data-aco-pf-results]").hasAttribute("hidden"),
    true,
  );
  assert.ok(root.classList.contains("aco-pf-native-results"));
  // A filter is applied → our grid is back and the native one re-hidden.
  assert.equal(run(state, [], true), false);
  assert.equal(
    root.querySelector("[data-aco-pf-results]").hasAttribute("hidden"),
    false,
  );
  assert.equal(calls.hide, 1);
  // Collection pages never do this.
  assert.equal(run({ ...state, context: "collection" }, [], false), false);
});
