(function () {
  "use strict";

  var PF_BUILD = "v25.9-2026-09-smart-filters";
  try {
    console.info("[aco-pf] aco-pf-filters loaded", PF_BUILD);
  } catch (e) {}

  var SCAN_BATCH = 250; // Storefront API max page size
  var SCAN_MAX_BATCHES = 20; // 20 x 250 = 5,000 products, same cap as the detect scan
  var FACET_BATCH = 250;
  var FACET_MAX_BATCHES = 20;
  var FACET_CACHE_TTL = 10 * 60 * 1000; // sessionStorage snapshot reuse window

  // Behavior config defaults (from the app settings snapshot, embedded as
  // data-behavior). MUST be declared before ready() below Ã¢â‚¬â€ see the note above
  // about vars vs the synchronous initRoot call.
  var BEHAVIOR_DEFAULTS = {
    defaultOpen: true,
    collapsible: true,
    accordion: false,
    showCounts: true,
    hideEmpty: true,
    disableEmpty: false,
    applyMode: "instant",
    collapseAfter: 0,
    searchThreshold: 0,
    scrollTop: true,
    animation: "slide",
    smartFilters: false,
  };

  // Theme card mirror: Shopify renders at most 20 `all_products` handles per
  // section request, so a page is fetched in chunks of this size.
  var THEME_CARD_CHUNK = 20;
  var THEME_CARD_VIEW = "aco-pf";

  var PRODUCT_CARD_DEFAULTS = {
    cardSource: "aco",
    cardLayout: "classic",
    imageRatio: "square",
    imageFit: "cover",
    hoverZoom: true,
    cardBorder: true,
    textAlign: "left",
    showVendor: false,
    titleSize: 14,
    cardRadius: 8,
    cardBackground: "#ffffff",
    cardTextColor: "#111111",
    cardBorderColor: "#e5e5e5",
    cardShadow: "none",
    titleWeight: 400,
    priceSize: 14,
    imageSlideshow: false,
    slideshowMode: "hover",
    slideshowSpeed: 1,
    slideshowArrowsAlways: false,
    slideshowDots: true,
    slideshowMaxImages: 5,
    showComparePrice: true,
    showDiscountBadge: false,
    showSaleBadge: false,
    showSoldOutBadge: false,
    badgePosition: "top-left",
    badgeSize: "medium",
    saleBadgeText: "Sale",
    saleBadgeColor: "#d7263d",
    saleBadgeTextColor: "#ffffff",
    soldOutBadgeText: "Out of stock",
    soldOutBadgeColor: "#6b6b6b",
    soldOutBadgeTextColor: "#ffffff",
    discountBadgeText: "Save",
    discountBadgeStyle: "solid",
    showAddToCart: true,
    addToCartText: "Add to cart",
    showBuyNow: false,
    buyNowText: "Buy it now",
    buttonStyle: "solid",
    buttonColor: "#111111",
    buttonTextColor: "#ffffff",
    buttonRadius: 6,
    afterAddToCart: "stay",
    variantMode: "firstAvailable",
    chooseVariantText: "Choose variant",
  };

  // Sort definitions. `key`/`reverse` drive the Storefront products(sortKey:)
  // argument (server + scan modes); `cmp` sorts the snapshot in memory so the
  // snapshot fast path survives a sort change with zero extra requests.
  // "default" sends no sortKey (the API's natural order = today's behavior).
  // "best-selling" has no cmp Ã¢â‚¬â€ it can't be derived from snapshot fields, so
  // selecting it drops the grid back to the server/scan path (see gridSortable).
  // Declared before ready() for the same hoisting reason as the vars above.
  var SORT_DEFS = {
    default: { key: null, reverse: false, cmp: null },
    "best-selling": { key: "BEST_SELLING", reverse: false, cmp: null },
    "price-asc": { key: "PRICE", reverse: false, cmp: byPrice(1) },
    "price-desc": { key: "PRICE", reverse: true, cmp: byPrice(-1) },
    "title-asc": { key: "TITLE", reverse: false, cmp: byTitle(1) },
    "title-desc": { key: "TITLE", reverse: true, cmp: byTitle(-1) },
    "created-desc": { key: "CREATED_AT", reverse: true, cmp: byCreated(-1) },
    "created-asc": { key: "CREATED_AT", reverse: false, cmp: byCreated(1) },
  };

  function byPrice(dir) {
    return function (a, b) {
      var pa =
        parseFloat(
          (a.priceRange && a.priceRange.minVariantPrice.amount) || 0,
        ) || 0;
      var pb =
        parseFloat(
          (b.priceRange && b.priceRange.minVariantPrice.amount) || 0,
        ) || 0;
      return (pa - pb) * dir;
    };
  }

  function byTitle(dir) {
    return function (a, b) {
      return String(a.title || "").localeCompare(String(b.title || "")) * dir;
    };
  }

  function byCreated(dir) {
    return function (a, b) {
      // Lexicographic works: createdAt is always a same-shape ISO-8601 string.
      return (
        String(a.createdAt || "").localeCompare(String(b.createdAt || "")) * dir
      );
    };
  }

  function sortDef(key) {
    return SORT_DEFS[key] || SORT_DEFS.default;
  }

  function ready(fn) {
    if (document.readyState !== "loading") fn();
    else document.addEventListener("DOMContentLoaded", fn);
  }

  ready(function () {
    document.querySelectorAll("[data-aco-pf-root]").forEach(initRoot);
  });

  // ---- analytics (fire-and-forget, direct to PostHog Cloud) ----------------
  // Events go straight from the browser to PostHog's ingestion API using the
  // public project key (injected into the block config). No app server, no DB.
  // `shop` is set on every event as the primary key for per-store reporting.

  // Anonymous, non-PII visitor id so co-occurrence/sessions can be grouped.
  function pfSessionId() {
    try {
      var v = localStorage.getItem("pf_sid");
      if (!v) {
        v = Date.now().toString(36) + Math.random().toString(36).slice(2, 10);
        localStorage.setItem("pf_sid", v);
      }
      return v;
    } catch (e) {
      return null;
    }
  }

  // Capture an event directly to PostHog. Silently no-ops if the key/host aren't
  // configured yet (merchant hasn't run "Detect filter values" since the update).
  function phCapture(state, event, properties) {
    try {
      if (!state.phKey || !state.phHost) return;
      var props = {
        distinct_id: pfSessionId(),
        shop: state.shop,
        $process_person_profile: false,
      };
      for (var k in properties) {
        if (Object.prototype.hasOwnProperty.call(properties, k))
          props[k] = properties[k];
      }
      var body = { api_key: state.phKey, event: event, properties: props };
      fetch(state.phHost.replace(/\/+$/, "") + "/capture/", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
        keepalive: true,
        mode: "cors",
      }).catch(function () {});
    } catch (e) {
      /* analytics must never break filtering */
    }
  }

  // Walk the form and describe the currently-applied filters.
  function collectAppliedItems(state) {
    var items = [];
    state.root
      .querySelectorAll("[data-aco-pf-group]")
      .forEach(function (group) {
        var type = group.getAttribute("data-filter-type") || "";
        var labelEl = group.querySelector(".aco-pf-group__label");
        var label = labelEl ? labelEl.textContent.trim() : "";
        if (type === "price") {
          var min = group.querySelector('input[name="pf_price_min"]');
          var max = group.querySelector('input[name="pf_price_max"]');
          if (min && min.value)
            items.push({
              type: "price",
              key: "price",
              label: label,
              value: "min:" + min.value,
            });
          if (max && max.value)
            items.push({
              type: "price",
              key: "price",
              label: label,
              value: "max:" + max.value,
            });
        } else {
          group
            .querySelectorAll("input[data-aco-pf-input]:checked")
            .forEach(function (cb) {
              var key =
                cb.name.indexOf("pf_") === 0 ? cb.name.slice(3) : cb.name;
              items.push({
                type: type,
                key: key,
                label: label,
                value: cb.value,
              });
            });
        }
      });
    return items;
  }

  // Debounced so we report the settled selection, not every intermediate click.
  // Skipped for programmatic runs (initial hydration from the URL, back/forward)
  // so we only capture filter changes the shopper actually made.
  function reportApply(state) {
    if (state.suppressReport) return;
    clearTimeout(state.reportTimer);
    state.reportTimer = setTimeout(function () {
      var items = collectAppliedItems(state);
      if (!items.length) return;
      phCapture(state, "storefront_filter_applied", {
        context: state.context,
        filter_count: items.length,
        filters: items.map(function (it) {
          return {
            type: it.type,
            key: it.key,
            label: it.label,
            value: it.value,
          };
        }),
      });
    }, 900);
  }

  function parseBehavior(root) {
    var out = {};
    for (var k in BEHAVIOR_DEFAULTS) out[k] = BEHAVIOR_DEFAULTS[k];
    try {
      var raw = root.getAttribute("data-behavior");
      if (raw) {
        var parsed = JSON.parse(raw);
        for (var key in parsed) {
          if (Object.prototype.hasOwnProperty.call(out, key))
            out[key] = parsed[key];
        }
      }
    } catch (e) {
      /* malformed behavior config Ã¢â‚¬â€ fall back to defaults */
    }
    return out;
  }

  function parseProductCard(root) {
    var out = {};
    for (var k in PRODUCT_CARD_DEFAULTS) out[k] = PRODUCT_CARD_DEFAULTS[k];
    try {
      var raw = root.getAttribute("data-product-card");
      if (raw) {
        var parsed = JSON.parse(raw);
        for (var key in parsed) {
          if (
            Object.prototype.hasOwnProperty.call(out, key) &&
            parsed[key] != null
          ) {
            out[key] = parsed[key];
          }
        }
      }
    } catch (e) {
      /* malformed product-card config Ã¢â‚¬â€ fall back to defaults */
    }
    return out;
  }

  function initRoot(root) {
    if (root.__pfInit) return;
    root.__pfInit = true;

    var state = {
      root: root,
      context: root.getAttribute("data-context"),
      terms: root.getAttribute("data-terms") || "",
      shop: root.getAttribute("data-shop"),
      // Bumped by the app whenever products change in a way filters read
      // (new/deleted products, tags, prices...). Part of the snapshot cache
      // key, so shoppers never filter a stale product list.
      catalogVersion: root.getAttribute("data-catalog-version") || "",
      version: root.getAttribute("data-api-version") || "2025-01",
      token: root.getAttribute("data-token"),
      phKey: root.getAttribute("data-ph-key") || "",
      phHost: root.getAttribute("data-ph-host") || "",
      perPage: Math.max(
        10,
        Math.min(parseInt(root.getAttribute("data-per-page"), 10) || 15, 30),
      ),
      columns: parseInt(root.getAttribute("data-columns"), 10) || 3,
      showPrice: root.getAttribute("data-show-price") === "true",
      baseUrl: root.getAttribute("data-base-url"),
      behavior: parseBehavior(root),
      productCard: parseProductCard(root),
      // Theme card mirror metadata (pf_config.theme_cards) + render state.
      themeCards: parseThemeCards(root),
      themeSectionIds: {}, // context -> resolved section id
      themeCardCache: {}, // handle -> rendered card HTML
      themeCardShell: null, // { section, container } shallow clones
      themeCardFailures: 0,
      themeCardsDisabled: false,
      themeCardsPending: false,
      themeRenderToken: 0,
      colsMobile: parseInt(root.getAttribute("data-columns-mobile"), 10) || 2,
      sort: "default", // active sort key; hydrated from the select/URL below
      sortDefault: null, // merchant's default; captured from the SSR-selected option
      query: "",
      optSel: {},
      colSel: [], // selected collection handles (client-side matched)
      customIds: {}, // { filterKey: { valueRaw: Set(bare product ids) } }
      // { filterKey: { valueRaw: { bareProductId: [bare variant ids] } } } —
      // only products where just some variants were picked.
      customVariants: {},
      customVariantCache: {}, // variant gid -> card variant data (custom filters)
      customSel: {}, // { filterKey: [selected value raws] }
      optActive: false, // any variant-option filter selected -> scan mode
      mode: "server", // "snapshot" | "scan" | "server" Ã¢â‚¬â€ how the grid is driven
      matchedIds: [], // snapshot mode: ids of products matching the selection
      cardCache: {}, // product id -> card data, memoised for the session
      variantCache: {}, // product id -> complete variant request, memoised per session
      variantRequestGeneration: 0,
      variantSubmitGeneration: 0,
      activeVariantProductId: null,
      aborter: null, // AbortController for the in-flight grid fetch
      deferredInit: false, // initial load: SSR grid kept, page-1 fetch skipped
      currentAfter: null, // cursor for the page currently shown (server mode)
      nextAfter: null, // endCursor to fetch the next page (server mode)
      prevStack: [], // afters of previously shown pages (server mode Previous)
      matched: [], // scan mode: accumulated products matching the option filters
      snapshot: null, // faceting: catalog attribute snapshot (fetched on load)
      snapshotPromise: null, // faceting: in-flight/settled snapshot fetch
      snapshotCapped: false,
      snapshotPartial: false, // faceting: scan in progress, counts growing
      scanAfter: null, // scan mode: cursor to resume the catalog scan from
      scanDone: false,
      scanBatches: 0,
      scanCapped: false,
      pageNum: 1,
      hasNext: false,
      loading: false,
      rerunQueued: false,
      shownCount: 0,
    };
    root.__pfState = state;
    // Both card modes: the injected CSS only hides simple siblings; wrappers
    // that mix the page's search box with the grid need the JS walk.
    hideNativeThemeGrid(state);

    // Custom-filter membership maps are embedded per group; parse once.
    state.customIds = parseCustomIds(root);
    state.customVariants = parseCustomVariants(root);
    // Collection trees set to open collapsed start with every parent closed.
    initTreeCollapsed(root);

    var debounce = null;
    var cbDebounce = null;

    root.addEventListener("change", function (e) {
      // Sort select: applies immediately even in "Apply button" mode Ã¢â‚¬â€ it
      // reorders results rather than narrowing them, so there's nothing to
      // batch up with the filter selections.
      if (e.target.matches("[data-aco-pf-sort]")) {
        state.sort = e.target.value;
        run(state, true);
        return;
      }
      if (!e.target.closest("[data-aco-pf-input]")) return;
      if (e.target.matches(".aco-pf-price__input")) return;
      // Collection tree with cascade enabled: mirror the parent's new state
      // onto every descendant before anything reads the form.
      cascadeTreeSelection(e.target);
      // Single-select groups: uncheck siblings when a value is checked.
      var singleGroup = e.target.closest("[data-aco-pf-single]");
      if (singleGroup && e.target.checked) {
        singleGroup
          .querySelectorAll("input[data-aco-pf-input]:checked")
          .forEach(function (cb) {
            if (cb !== e.target) cb.checked = false;
          });
      }
      // "Apply button" mode: update chips/facets locally, fetch on submit only.
      if (state.behavior.applyMode === "button") {
        updateActiveChips(state);
        scheduleFacets(state);
        return;
      }
      // Short debounce so rapid multi-checking collapses into a single run.
      clearTimeout(cbDebounce);
      cbDebounce = setTimeout(function () {
        run(state, true);
      }, 200);
    });

    root.addEventListener("input", function (e) {
      if (e.target.matches("[data-aco-pf-value-search]")) {
        filterGroupValues(e.target);
        return;
      }
      if (!e.target.matches(".aco-pf-price__input")) return;
      if (state.behavior.applyMode === "button") return;
      clearTimeout(debounce);
      debounce = setTimeout(function () {
        run(state, true);
      }, 600);
    });

    root.addEventListener("submit", function (e) {
      if (e.target.closest("[data-aco-pf-jump-form]")) {
        e.preventDefault();
        var jump = e.target.querySelector("[data-aco-pf-jump-input]");
        var target = Number.parseInt(jump && jump.value, 10);
        var total = paginationTotal(state);
        if (
          !Number.isInteger(target) ||
          target < 1 ||
          (total && target > total)
        ) {
          showPagerMessage(state, "Enter a valid page number.");
          if (jump) jump.focus();
          return;
        }
        goToPage(state, target);
        return;
      }
      if (e.target.closest("[data-aco-pf-smart]")) {
        e.preventDefault();
        submitSmartFilters(state);
        return;
      }
      if (e.target.closest("[data-aco-pf-form]")) {
        e.preventDefault();
        run(state, true);
      }
    });

    // Auto-slideshow on hover. mouseenter/leave don't bubble, so delegate via
    // mouseover/mouseout and gate on actually crossing the gallery boundary.
    root.addEventListener("mouseover", function (e) {
      var gal = e.target.closest(
        '[data-aco-pf-gallery][data-aco-pf-mode="hover"]',
      );
      if (!gal || gal.__pfTimer) return;
      hydrateGallery(gal); // fetch the rest while the first slide shows
      var speed =
        (parseFloat(gal.getAttribute("data-aco-pf-speed")) || 1) * 1000;
      gal.__pfTimer = setInterval(function () {
        setGallerySlide(gal, galleryActiveIndex(gal) + 1);
      }, speed);
    });
    root.addEventListener("mouseout", function (e) {
      var gal = e.target.closest(
        '[data-aco-pf-gallery][data-aco-pf-mode="hover"]',
      );
      if (!gal) return;
      // Ignore moves between children of the same gallery.
      if (e.relatedTarget && gal.contains(e.relatedTarget)) return;
      stopGallery(gal);
      setGallerySlide(gal, 0); // rest on the featured image
    });

    root.addEventListener("click", function (e) {
      // Collection-tree caret: expand/collapse the node's descendants. Handled
      // (and defaulted-away) first so it never toggles the row's checkbox or
      // follows the row's link in navigate mode.
      var treeToggle = e.target.closest("[data-aco-pf-tree-toggle]");
      if (treeToggle) {
        e.preventDefault();
        e.stopPropagation();
        toggleTreeNode(treeToggle);
        return;
      }
      // Quick-buy buttons (rendered as siblings of the card link, so they never
      // navigate). Handled before the card-click tracker below.
      var atcBtn = e.target.closest("[data-aco-pf-atc]");
      if (atcBtn) {
        e.preventDefault();
        e.stopPropagation();
        addToCart(state, atcBtn);
        return;
      }
      var buyBtn = e.target.closest("[data-aco-pf-buynow]");
      if (buyBtn) {
        e.preventDefault();
        e.stopPropagation();
        buyNow(state, buyBtn);
        return;
      }
      // Slideshow prev/next arrows. They sit inside the card link, so stop the
      // click from navigating (and from the card-click tracker below).
      var gnav = e.target.closest("[data-aco-pf-gnav]");
      if (gnav) {
        e.preventDefault();
        e.stopPropagation();
        var gal = gnav.closest("[data-aco-pf-gallery]");
        if (gal) {
          setGallerySlide(
            gal,
            galleryActiveIndex(gal) +
              parseInt(gnav.getAttribute("data-aco-pf-gnav"), 10),
          );
        }
        return;
      }
      var chooseBtn = e.target.closest("[data-aco-pf-choose-variant]");
      if (chooseBtn) {
        e.preventDefault();
        e.stopPropagation();
        openVariantPicker(state, chooseBtn);
        return;
      }
      // Track product-card clicks (don't preventDefault — let navigation happen).
      var card = e.target.closest("[data-aco-pf-card]");
      if (card) {
        var cardImg = card.querySelector("img");
        phCapture(state, "storefront_product_clicked", {
          context: state.context,
          product_id: card.getAttribute("data-aco-pf-id"),
          product_handle: card.getAttribute("data-aco-pf-handle"),
          product_title: card.getAttribute("data-aco-pf-title"),
          product_image:
            card.getAttribute("data-aco-pf-image") ||
            (cardImg && cardImg.getAttribute("src")) ||
            "",
        });
      }

      var chip = e.target.closest("[data-aco-pf-remove]");
      if (chip) {
        e.preventDefault();
        removeSelection(
          state,
          chip.getAttribute("data-aco-pf-remove-name"),
          chip.getAttribute("data-aco-pf-remove-value"),
        );
        run(state, true);
        return;
      }
      if (e.target.closest("[data-aco-pf-clear]")) {
        e.preventDefault();
        clearAll(state);
        run(state, true);
        return;
      }
      var pageButton = e.target.closest("[data-aco-pf-page-number]");
      if (pageButton) {
        e.preventDefault();
        goToPage(
          state,
          Number.parseInt(
            pageButton.getAttribute("data-aco-pf-page-number"),
            10,
          ),
        );
        return;
      }
      if (e.target.closest("[data-aco-pf-next]")) {
        e.preventDefault();
        if (state.loading || !state.hasNext) return;
        if (state.mode === "server") {
          state.prevStack.push(state.currentAfter);
          state.currentAfter = state.nextAfter;
        }
        state.pageNum += 1;
        loadPage(state);
        return;
      }
      if (e.target.closest("[data-aco-pf-prev]")) {
        e.preventDefault();
        if (state.loading || !hasPrevPage(state)) return;
        if (state.mode === "server") state.currentAfter = state.prevStack.pop();
        state.pageNum -= 1;
        loadPage(state);
        return;
      }
      var colBtn = e.target.closest("[data-aco-pf-cols]");
      if (colBtn) {
        e.preventDefault();
        setColumns(
          state,
          parseInt(colBtn.getAttribute("data-aco-pf-cols"), 10),
          true,
        );
        return;
      }
      if (e.target.closest("[data-aco-pf-drawer-toggle]")) {
        e.preventDefault();
        setDrawerOpen(state, true);
        return;
      }
      if (
        e.target.closest("[data-aco-pf-drawer-close]") ||
        e.target.closest("[data-aco-pf-drawer-backdrop]")
      ) {
        e.preventDefault();
        setDrawerOpen(state, false);
        return;
      }
      var moreBtn = e.target.closest("[data-aco-pf-more]");
      if (moreBtn) {
        e.preventDefault();
        toggleShowMore(state, moreBtn.closest("[data-aco-pf-group]"));
      }
    });

    // Keyboard support for the tree carets (span[role=button]).
    root.addEventListener("keydown", function (e) {
      if (e.key !== "Enter" && e.key !== " ") return;
      if (!e.target.matches || !e.target.matches("[data-aco-pf-tree-toggle]"))
        return;
      e.preventDefault();
      toggleTreeNode(e.target);
    });

    // Accordion mode: opening one group closes the others.
    if (state.behavior.accordion && state.behavior.collapsible) {
      root.querySelectorAll("[data-aco-pf-group]").forEach(function (group) {
        group.addEventListener("toggle", function () {
          if (!group.open) return;
          root
            .querySelectorAll("[data-aco-pf-group][open]")
            .forEach(function (other) {
              if (other !== group) other.open = false;
            });
        });
      });
    }

    applyBehaviorSetup(state);

    // Restore the shopper's saved column choice, but only when the merchant
    // shows the switcher. With the switcher off, the merchant's "Columns
    // (desktop)" setting (data-columns) always wins.
    var hasSwitcher = !!state.root.querySelector("[data-aco-pf-cols-switch]");
    if (hasSwitcher) {
      try {
        var savedCols = parseInt(localStorage.getItem("pf_cols"), 10);
        if (savedCols === 3 || savedCols === 4) state.columns = savedCols;
      } catch (e) {}
    }
    setColumns(state, state.columns, false);

    // Hydrate the form from the URL, then JS-drive page 1 so pagination is
    // always available (even with no filters selected).
    applyParamsToForm(state, readParams());
    if (state.token) {
      // Initial page-1 load Ã¢â‚¬â€ hydrated from the URL, not a shopper action.
      // deferIfClean: with no filters the SSR grid already IS page 1, so the
      // redundant fetch is skipped (pagination unlocks once the snapshot lands).
      state.suppressReport = true;
      run(state, true, { deferIfClean: true, initial: true });
      state.suppressReport = false;
    } else {
      updateActiveChips(state);
    }
  }

  // ---- behavior / layout setup ---------------------------------------------

  function collectSmartFilterVocabulary(state) {
    var filters = [];
    state.root.querySelectorAll("[data-aco-pf-group]").forEach(function (group) {
      var key = group.getAttribute("data-filter-key") || "";
      var type = group.getAttribute("data-filter-type") || "";
      var labelEl = group.querySelector(".aco-pf-group__label");
      var label = labelEl ? String(labelEl.textContent || "").trim() : key;
      var paramName = "";
      var values = [];

      if (type === "available" || key === "available") {
        paramName = "pf_available";
        values.push({ raw: "1", label: "In stock" });
      } else if (type === "price" || key === "price") {
        paramName = "pf_price_min";
      } else {
        var inputs = group.querySelectorAll(
          'input[data-aco-pf-input]:not([type="number"])',
        );
        if (!inputs.length) return;
        paramName = inputs[0].name || "";
        if (!paramName) return;
        inputs.forEach(function (inp) {
          if (!inp.value) return;
          if (
            inp.name === "pf_price_min" ||
            inp.name === "pf_price_max"
          ) {
            return;
          }
          var lab = inp.closest("label");
          var text = "";
          if (lab) {
            var span = lab.querySelector(".aco-pf-value__label");
            text = span
              ? String(span.textContent || "").trim()
              : String(lab.textContent || "").trim();
          }
          values.push({ raw: String(inp.value), label: text || String(inp.value) });
        });
      }

      if (!paramName) return;
      filters.push({
        key: key,
        paramName: paramName,
        label: label,
        values: values,
      });
    });
    return filters;
  }

  function setSmartFilterStatus(state, message, isError) {
    var el = state.root.querySelector("[data-aco-pf-smart-status]");
    if (!el) return;
    if (!message) {
      el.hidden = true;
      el.textContent = "";
      el.classList.remove("is-error");
      return;
    }
    el.hidden = false;
    el.textContent = message;
    el.classList.toggle("is-error", !!isError);
  }

  function applySmartFilterResult(state, result) {
    var params = new URLSearchParams();
    var selections = (result && result.selections) || {};
    Object.keys(selections).forEach(function (name) {
      (selections[name] || []).forEach(function (val) {
        params.append(name, val);
      });
    });
    if (result && result.price) {
      if (result.price.min != null && result.price.min !== "") {
        params.set("pf_price_min", String(result.price.min));
      }
      if (result.price.max != null && result.price.max !== "") {
        params.set("pf_price_max", String(result.price.max));
      }
    }
    // Preserve current sort if any
    var sortSelect = state.root.querySelector("[data-aco-pf-sort]");
    if (sortSelect && sortSelect.value && sortSelect.value !== "default") {
      params.set("pf_sort", sortSelect.value);
    }
    applyParamsToForm(state, params);
    run(state, true);
  }

  function submitSmartFilters(state) {
    var form = state.root.querySelector("[data-aco-pf-smart]");
    var input = state.root.querySelector("[data-aco-pf-smart-input]");
    if (!form || !input) return;

    var query = String(input.value || "").trim();
    if (!query) {
      setSmartFilterStatus(state, "Enter a search to apply filters.", true);
      input.focus();
      return;
    }

    var url = form.getAttribute("action") || "/apps/pf-filter/smart-filters";
    var filters = collectSmartFilterVocabulary(state);

    form.classList.add("is-loading");
    input.disabled = true;
    setSmartFilterStatus(state, "Matching filters…", false);

    fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json", Accept: "application/json" },
      body: JSON.stringify({ query: query, filters: filters }),
      credentials: "same-origin",
    })
      .then(function (res) {
        return res.json().then(function (data) {
          return { okHttp: res.ok, data: data };
        });
      })
      .then(function (pack) {
        var data = pack.data || {};
        if (!pack.okHttp || data.ok === false) {
          setSmartFilterStatus(
            state,
            (data && data.message) || "Smart Filters request failed.",
            true,
          );
          return;
        }
        var hasSelections =
          data.selections && Object.keys(data.selections).length > 0;
        var hasPrice =
          data.price && (data.price.min != null || data.price.max != null);
        var applied = Array.isArray(data.matched) ? data.matched : [];
        if (hasSelections || hasPrice) {
          applySmartFilterResult(state, data);
          setSmartFilterStatus(
            state,
            applied.length
              ? "Applied: " + applied.join(", ")
              : "Filters applied.",
            false,
          );
          return;
        }
        setSmartFilterStatus(
          state,
          "No filters matched your search.",
          true,
        );
      })
      .catch(function () {
        setSmartFilterStatus(
          state,
          "Could not reach Smart Filters. Try again.",
          true,
        );
      })
      .then(function () {
        form.classList.remove("is-loading");
        input.disabled = false;
      });
  }

  function applyBehaviorSetup(state) {
    var b = state.behavior;
    var root = state.root;

    if (!b.collapsible) {
      root.classList.add("aco-pf-app--no-collapse");
      root.querySelectorAll("[data-aco-pf-group]").forEach(function (g) {
        g.open = true;
      });
    }
    if (b.animation === "slide") root.classList.add("aco-pf-app--anim-slide");
    if (!b.showCounts) root.classList.add("aco-pf-app--no-counts");

    // Apply-button mode: reveal the submit button (SSR renders it hidden).
    if (b.applyMode === "button") {
      root.querySelectorAll("[data-aco-pf-apply]").forEach(function (btn) {
        btn.hidden = false;
      });
    }

    // Collapse long value lists behind a "Show more" toggle.
    root.querySelectorAll("[data-aco-pf-group]").forEach(function (group) {
      var n =
        parseInt(group.getAttribute("data-collapse-after"), 10) ||
        b.collapseAfter;
      if (n > 0) setupShowMore(group, n);
      // Auto search box for very long lists (if not already SSR'd).
      var rows = group.querySelectorAll("label.aco-pf-value");
      if (
        b.searchThreshold > 0 &&
        rows.length >= b.searchThreshold &&
        !group.querySelector("[data-aco-pf-value-search]")
      ) {
        var input = document.createElement("input");
        input.type = "search";
        input.placeholder = "Search...";
        input.className = "aco-pf-group__search";
        input.setAttribute("data-aco-pf-value-search", "");
        var body = group.querySelector(".aco-pf-group__body");
        if (body) body.insertBefore(input, body.firstChild);
      }
    });

    // Drawer: activate on desktop when the layout is "drawer", and on small
    // screens when mobileMode is drawer (root has aco-pf-app--mobile-drawer).
    //
    // When active, promote the drawer to the browser top layer via the Popover
    // API so it renders above ANY theme stacking context (sticky headers,
    // isolated section wrappers). The element stays put in the DOM, so all the
    // group queries and root-level event delegation keep working. Browsers
    // without the Popover API fall back to the plain fixed-position drawer.
    var sidebar = root.querySelector("[data-aco-pf-sidebar]");
    var supportsPopover =
      !!sidebar &&
      typeof sidebar.showPopover === "function" &&
      Object.prototype.hasOwnProperty.call(HTMLElement.prototype, "popover");
    state.__sidebar = sidebar;
    state.__popover = supportsPopover;

    if (supportsPopover) {
      // Keep JS state in sync when the popover is light-dismissed (Esc /
      // outside tap) rather than closed through our own controls.
      sidebar.addEventListener("toggle", function (ev) {
        var open = ev.newState === "open";
        root.classList.toggle("aco-pf-app--drawer-open", open);
        try {
          document.body.style.overflow = open ? "hidden" : "";
        } catch (e) {}
      });
    }

    var updateDrawer = function () {
      var isDrawerLayout = !!root.querySelector(".aco-pf-layout--drawer");
      var isMobile = window.matchMedia("(max-width: 749px)").matches;
      var mobileDrawer =
        root.classList.contains("aco-pf-app--mobile-drawer") && isMobile;
      var active = isDrawerLayout || mobileDrawer;
      root.classList.toggle("aco-pf-app--drawer-active", active);
      var toggle = root.querySelector("[data-aco-pf-drawer-toggle]");
      var close = root.querySelector("[data-aco-pf-drawer-close]");
      if (toggle) toggle.hidden = !active;
      if (close) close.hidden = !active;
      if (supportsPopover) {
        if (active && !sidebar.hasAttribute("popover")) {
          sidebar.setAttribute("popover", "auto");
        } else if (!active && sidebar.hasAttribute("popover")) {
          try {
            sidebar.hidePopover();
          } catch (e) {}
          sidebar.removeAttribute("popover");
        }
      }
      if (!active) setDrawerOpen(state, false);
    };
    updateDrawer();
    window.addEventListener("resize", updateDrawer);

    markCurrentTreeNode(state);

    // Keep layout class in sync with metafield config (SSR liquid may lag).
    syncGridLayoutClass(state);

    // Styles + layout are applied Ã¢â‚¬â€ reveal the panel (see the FOUC guard in the
    // block: [data-aco-pf-root]:not(.aco-pf-ready) is hidden until this class lands).
    root.classList.add("aco-pf-ready");
  }

  function setDrawerOpen(state, open) {
    var sidebar = state.__sidebar;
    if (state.__popover && sidebar && sidebar.hasAttribute("popover")) {
      try {
        if (open && !sidebar.matches(":popover-open")) sidebar.showPopover();
        else if (!open && sidebar.matches(":popover-open"))
          sidebar.hidePopover();
      } catch (e) {}
      // The sidebar's `toggle` listener syncs the open class + body overflow.
      return;
    }
    state.root.classList.toggle("aco-pf-app--drawer-open", open);
    var backdrop = state.root.querySelector("[data-aco-pf-drawer-backdrop]");
    if (backdrop) backdrop.hidden = !open;
    try {
      document.body.style.overflow = open ? "hidden" : "";
    } catch (e) {}
  }

  function setupShowMore(group, n) {
    if (group.querySelector("[data-aco-pf-tree]")) return; // trees never collapse-after
    var rows = group.querySelectorAll("label.aco-pf-value");
    if (rows.length <= n) return;
    group.__pfCollapseAfter = n;
    group.__pfExpanded = false;
    applyCollapse(group);
  }

  function toggleShowMore(state, group) {
    if (!group || !group.__pfCollapseAfter) return;
    group.__pfExpanded = !group.__pfExpanded;
    applyCollapse(group);
  }

  // Apply the "Show more" collapse over the FACET-AVAILABLE rows only, so the
  // first N shown and the "Show N more" count follow dynamic faceting (rows
  // hidden by sibling selections don't count toward the limit or the total).
  function applyCollapse(group) {
    if (!group || !group.__pfCollapseAfter) return;
    var n = group.__pfCollapseAfter;
    var rows = [].slice.call(group.querySelectorAll("label.aco-pf-value"));
    var btn = group.querySelector("[data-aco-pf-more]");

    // While searching within the group, show every match and drop the collapse.
    var searchInput = group.querySelector("[data-aco-pf-value-search]");
    if (searchInput && searchInput.value.trim()) {
      rows.forEach(function (row) {
        setRowFlag(row, "pfOverflowHide", false);
      });
      if (btn) btn.hidden = true;
      return;
    }

    var expanded = group.__pfExpanded;
    var shown = 0; // facet-available rows kept visible so far
    var available = 0; // total facet-available rows
    rows.forEach(function (row) {
      if (row.dataset.pfFacetHide) {
        // Hidden by faceting Ã¢â‚¬â€ not counted; clear any stale overflow flag.
        setRowFlag(row, "pfOverflowHide", false);
        return;
      }
      available++;
      var overflow = !expanded && shown >= n;
      setRowFlag(row, "pfOverflowHide", overflow);
      if (!overflow) shown++;
    });

    if (btn) {
      var remaining = available - n;
      if (remaining <= 0) {
        btn.hidden = true;
      } else {
        btn.hidden = false;
        btn.textContent = expanded
          ? "Show less"
          : "Show " + remaining + " more";
      }
    }
  }

  function filterGroupValues(input) {
    var group = input.closest("[data-aco-pf-group]");
    if (!group) return;
    var q = input.value.trim().toLowerCase();
    group.querySelectorAll("label.aco-pf-value").forEach(function (row) {
      var label = row.querySelector(".aco-pf-value__label");
      var text = label ? label.textContent.toLowerCase() : "";
      setRowFlag(row, "pfSearchHide", !!q && text.indexOf(q) === -1);
    });
    // Re-apply the collapse so it re-collapses once the search clears.
    applyCollapse(group);
  }

  // Row visibility composes four independent hides: dynamic faceting,
  // collapse-after overflow, search-within-filter, and collapsed tree branches.
  function setRowFlag(row, flag, on) {
    if (on) row.dataset[flag] = "1";
    else delete row.dataset[flag];
    row.style.display =
      row.dataset.pfFacetHide ||
      row.dataset.pfOverflowHide ||
      row.dataset.pfSearchHide ||
      row.dataset.pfTreeHide
        ? "none"
        : "";
  }

  // ---- collection tree -------------------------------------------------------
  // The tree renders as a flat DFS list of rows carrying data-aco-pf-tree-node /
  // data-aco-pf-tree-parent. Collapsing a node hides every descendant row; the
  // collapsed set lives on the group element so faceting re-runs keep it.

  function toggleTreeNode(toggle) {
    var row = toggle.closest("[data-aco-pf-tree-node]");
    var group = toggle.closest("[data-aco-pf-group]");
    if (!row || !group) return;
    var handle = row.getAttribute("data-aco-pf-tree-node");
    var collapsed = (group.__pfTreeCollapsed = group.__pfTreeCollapsed || {});
    collapsed[handle] = !collapsed[handle];
    toggle.setAttribute("aria-expanded", collapsed[handle] ? "false" : "true");
    applyTreeCollapse(group);
  }

  // "Show top-level collections only": seed every parent node as collapsed, so
  // the tree opens showing roots alone and the shopper expands from there. The
  // collapsed set lives on the group element, so this is just a starting state
  // Ã¢â‚¬â€ the shopper's own expansions survive faceting re-runs like any other.
  function initTreeCollapsed(root) {
    root
      .querySelectorAll("[data-aco-pf-tree-collapsed]")
      .forEach(function (tree) {
        var group = tree.closest("[data-aco-pf-group]");
        if (!group) return;
        var collapsed = (group.__pfTreeCollapsed =
          group.__pfTreeCollapsed || {});
        tree
          .querySelectorAll("[data-aco-pf-tree-toggle]")
          .forEach(function (toggle) {
            var row = toggle.closest("[data-aco-pf-tree-node]");
            if (!row) return;
            collapsed[row.getAttribute("data-aco-pf-tree-node")] = true;
            toggle.setAttribute("aria-expanded", "false");
          });
        applyTreeCollapse(group);
      });
  }

  function applyTreeCollapse(group) {
    var collapsed = group.__pfTreeCollapsed || {};
    var rows = group.querySelectorAll("[data-aco-pf-tree-node]");
    var parentOf = {};
    rows.forEach(function (row) {
      parentOf[row.getAttribute("data-aco-pf-tree-node")] = row.getAttribute(
        "data-aco-pf-tree-parent",
      );
    });
    rows.forEach(function (row) {
      var p = row.getAttribute("data-aco-pf-tree-parent");
      var hide = false;
      var guard = 0;
      while (p && guard++ < 20) {
        if (collapsed[p]) {
          hide = true;
          break;
        }
        p = parentOf[p];
      }
      setRowFlag(row, "pfTreeHide", hide);
    });
  }

  // Ticking a parent collection ticks its whole subtree (and unticking clears
  // it), when the merchant enabled cascade selection. Opt-in because the two
  // behaviours suit different catalogs: cascade matches stores where a parent
  // collection doesn't itself contain the children's products.
  function cascadeTreeSelection(input) {
    var tree = input.closest
      ? input.closest("[data-aco-pf-tree-auto-select]")
      : null;
    if (!tree) return;
    var row = input.closest("[data-aco-pf-tree-node]");
    if (!row) return;

    var handle = row.getAttribute("data-aco-pf-tree-node");
    var checked = input.checked;
    var rows = tree.querySelectorAll("[data-aco-pf-tree-node]");
    var parentOf = {};
    rows.forEach(function (r) {
      parentOf[r.getAttribute("data-aco-pf-tree-node")] = r.getAttribute(
        "data-aco-pf-tree-parent",
      );
    });

    rows.forEach(function (r) {
      var p = r.getAttribute("data-aco-pf-tree-parent");
      var guard = 0;
      while (p && guard++ < 20) {
        if (p === handle) {
          var cb = r.querySelector("input[data-aco-pf-input]");
          if (cb) cb.checked = checked;
          return;
        }
        p = parentOf[p];
      }
    });
  }

  // Navigate-mode trees: bold the collection page we're on and make sure its
  // ancestors are expanded (they are by default; this survives re-renders).
  function markCurrentTreeNode(state) {
    var path = window.location.pathname.replace(/\/+$/, "");
    state.root
      .querySelectorAll("[data-aco-pf-tree] a[data-aco-pf-tree-node]")
      .forEach(function (a) {
        var href = (a.getAttribute("href") || "")
          .split("?")[0]
          .replace(/\/+$/, "");
        if (!href || href !== path) return;
        a.classList.add("aco-pf-value--current");
        revealTreeNode(a);
      });
  }

  // Expand a node's ancestors so it's actually on screen. Matters for trees set
  // to open collapsed: without this the "you are here" collection would be
  // marked but hidden inside a closed parent.
  function revealTreeNode(row) {
    var group = row.closest("[data-aco-pf-group]");
    var tree = row.closest("[data-aco-pf-tree]");
    if (!group || !tree) return;
    var collapsed = group.__pfTreeCollapsed;
    if (!collapsed) return;

    var parentOf = {};
    tree.querySelectorAll("[data-aco-pf-tree-node]").forEach(function (r) {
      parentOf[r.getAttribute("data-aco-pf-tree-node")] = r.getAttribute(
        "data-aco-pf-tree-parent",
      );
    });

    var p = row.getAttribute("data-aco-pf-tree-parent");
    var guard = 0;
    var changed = false;
    while (p && guard++ < 20) {
      if (collapsed[p]) {
        collapsed[p] = false;
        changed = true;
        var toggle = tree.querySelector(
          '[data-aco-pf-tree-node="' +
            cssEscape(p) +
            '"] [data-aco-pf-tree-toggle]',
        );
        if (toggle) toggle.setAttribute("aria-expanded", "true");
      }
      p = parentOf[p];
    }
    if (changed) applyTreeCollapse(group);
  }

  // `persist` is true for a switcher click (3 or 4, remembered per browser);
  // false when applying the merchant's configured value (2–5, never saved).
  function applyColumnVars(state, el) {
    el.style.setProperty("--aco-pf-cols", state.columns || 3);
    el.style.setProperty("--aco-pf-cols-mobile", state.colsMobile || 2);
  }

  function setColumns(state, n, persist) {
    if (persist && n !== 3 && n !== 4) n = state.columns || 3;
    if (!(n >= 1 && n <= 6)) n = state.columns || 3;
    state.columns = n;
    var grid = state.root.querySelector("[data-aco-pf-grid]");
    if (grid) applyColumnVars(state, grid);
    // Theme card mode: the visible grid is the theme's own container.
    state.root.querySelectorAll("[data-aco-pf-cards]").forEach(function (el) {
      applyColumnVars(state, el);
    });
    state.root.querySelectorAll("[data-aco-pf-cols]").forEach(function (b) {
      b.setAttribute(
        "aria-pressed",
        b.getAttribute("data-aco-pf-cols") === String(n) ? "true" : "false",
      );
    });
    if (persist) {
      try {
        localStorage.setItem("pf_cols", n);
      } catch (e) {}
    }
  }

  // ---- URL params <-> form -------------------------------------------------

  function isPfKey(key) {
    if (typeof key !== "string") return false;
    if (key.indexOf("pf_opt_") === 0) return true;
    if (key.indexOf("pf_custom_") === 0) return true;
    return (
      key === "pf_available" ||
      key === "pf_price_min" ||
      key === "pf_price_max" ||
      key === "pf_type" ||
      key === "pf_vendor" ||
      key === "pf_tag" ||
      key === "pf_collection" ||
      key === "pf_sort"
    );
  }

  // Copy only our pf_* keys from an iterable of [key, value] pairs.
  function collectPfPairs(iterable) {
    var out = new URLSearchParams();
    if (!iterable || typeof iterable.entries !== "function") return out;
    try {
      var it = iterable.entries();
      var step = it.next();
      while (!step.done) {
        var key = step.value && step.value[0];
        var value = step.value && step.value[1];
        if (isPfKey(key) && value !== "" && value != null)
          out.append(key, value);
        step = it.next();
      }
    } catch (e) {
      console.warn("[aco-pf] collectPfPairs failed:", e);
    }
    return out;
  }

  function readParams() {
    return collectPfPairs(new URLSearchParams(window.location.search));
  }

  function formParams(state) {
    var form = state.root.querySelector("[data-aco-pf-form]");
    return collectPfPairs(new FormData(form));
  }

  // The sort select lives outside the form (see pf-sort.liquid), so it's
  // hydrated here rather than by FormData. No pf_sort in the URL means "the
  // merchant's default" Ã¢â‚¬â€ which is exactly the SSR-selected option, captured
  // on init so back/forward can restore it.
  function applyParamsToSort(state, params) {
    var select = state.root.querySelector("[data-aco-pf-sort]");
    if (!select) {
      state.sort = state.sortDefault = "default";
      return;
    }
    if (state.sortDefault == null)
      state.sortDefault = select.value || "default";

    var wanted = params.get("pf_sort");
    var valid =
      wanted &&
      SORT_DEFS[wanted] &&
      [].some.call(select.options, function (o) {
        return o.value === wanted;
      });

    select.value = valid ? wanted : state.sortDefault;
    state.sort = select.value;
  }

  function applyParamsToForm(state, params) {
    applyParamsToSort(state, params);
    var form = state.root.querySelector("[data-aco-pf-form]");
    // checkboxes
    form
      .querySelectorAll('input[type="checkbox"][data-aco-pf-input]')
      .forEach(function (cb) {
        var vals = params.getAll(cb.name);
        cb.checked = vals.indexOf(cb.value) !== -1;
      });
    // price
    var min = form.querySelector('input[name="pf_price_min"]');
    var max = form.querySelector('input[name="pf_price_max"]');
    if (min) min.value = params.get("pf_price_min") || "";
    if (max) max.value = params.get("pf_price_max") || "";
  }

  function anyParams(params) {
    var any = false;
    params.forEach(function () {
      any = true;
    });
    return any;
  }

  function gridHasSsr(state) {
    var grid = state.root.querySelector("[data-aco-pf-grid]");
    if (!grid) return false;
    // Skeletons are not SSR product cards — don't treat them as a finished grid.
    if (grid.classList.contains("aco-pf-grid--skeletons")) return false;
    if (
      grid.querySelector(".aco-pf-card--skeleton") &&
      !grid.querySelector(
        "[data-aco-pf-card], [data-aco-pf-host-card], .aco-pf-card__link",
      )
    ) {
      return false;
    }
    return !!(
      grid.querySelector(
        "[data-aco-pf-host-card], [data-aco-pf-card], .aco-pf-card__link, a[href*='/products/']",
      ) ||
      (grid.children && grid.children.length)
    );
  }

  function removeSelection(state, name, value) {
    var form = state.root.querySelector("[data-aco-pf-form]");
    if (name === "pf_price_min" || name === "pf_price_max") {
      var el = form.querySelector('input[name="' + name + '"]');
      if (el) el.value = "";
      return;
    }
    form
      .querySelectorAll('input[name="' + cssEscape(name) + '"]')
      .forEach(function (cb) {
        if (cb.value === value) cb.checked = false;
      });
  }

  function clearAll(state) {
    var form = state.root.querySelector("[data-aco-pf-form]");
    form
      .querySelectorAll('input[type="checkbox"][data-aco-pf-input]')
      .forEach(function (cb) {
        cb.checked = false;
      });
    form.querySelectorAll(".aco-pf-price__input").forEach(function (el) {
      el.value = "";
    });
  }

  // ---- params -> Storefront search query string ---------------------------
  // No Search & Discovery needed: the root products(query:) connection filters
  // by real fields (product_type, vendor, tag, available_for_sale, variants.price).
  // Variant options aren't supported in the query syntax, so they're matched
  // client-side (from each product's options { name values }) by scanning the
  // pre-filtered catalog in batches Ã¢â‚¬â€ see loadOptionPage.

  function q(v) {
    return '"' + String(v).replace(/["\\]/g, "\\$&") + '"';
  }

  function orGroup(field, values) {
    return (
      "(" +
      values
        .map(function (v) {
          return field + ":" + q(v);
        })
        .join(" OR ") +
      ")"
    );
  }

  function buildProductQuery(state, params) {
    var parts = [];
    var types = params.getAll("pf_type");
    var vendors = params.getAll("pf_vendor");
    var tags = params.getAll("pf_tag");
    if (types.length) parts.push(orGroup("product_type", types));
    if (vendors.length) parts.push(orGroup("vendor", vendors));
    if (tags.length) parts.push(orGroup("tag", tags));
    if (params.get("pf_available") === "1")
      parts.push("available_for_sale:true");
    var min = parseFloat(params.get("pf_price_min"));
    var max = parseFloat(params.get("pf_price_max"));
    if (!isNaN(min)) parts.push("variants.price:>=" + min);
    if (!isNaN(max)) parts.push("variants.price:<=" + max);
    if (state.context === "search" && state.terms)
      parts.unshift(q(state.terms));
    return parts.join(" AND ");
  }

  // ---- custom filters ------------------------------------------------------
  // A custom filter's options are merchant-authored and match by hand-picked
  // product id, not by any product attribute. The membership map is embedded
  // per group by pf-config-group.liquid; parse it once into
  //   state.customIds = { filterKey: { valueRaw: Set(bare ids) } }
  // so matching and facet counts are both O(1) per product.

  function parseCustomIds(root) {
    var out = {};
    root
      .querySelectorAll('[data-aco-pf-group][data-filter-type="custom"]')
      .forEach(function (group) {
        var key = group.getAttribute("data-filter-key");
        var tag = group.querySelector("[data-aco-pf-custom-ids]");
        if (!key || !tag) return;
        try {
          var rows = JSON.parse(tag.textContent) || [];
          var byRaw = {};
          var total = 0;
          for (var i = 0; i < rows.length; i++) {
            var ids = rows[i].ids || [];
            byRaw[rows[i].raw] = new Set(ids);
            total += ids.length;
          }
          out[key] = byRaw;
          // A custom option matches by product id alone, so an option with no
          // products can never count above zero Ã¢â‚¬â€ dynamic faceting then hides it
          // (and hides the whole group if every option is empty). That looks like
          // "the filter vanished a second after load", so say so explicitly.
          if (total === 0) {
            console.warn(
              '[aco-pf] custom filter "' +
                key +
                '" has no products assigned to any option; ' +
                "it will be hidden once facets are computed. Assign products in the app " +
                "(Filters Ã¢â€ â€™ edit the filter Ã¢â€ â€™ Choose products), then Save.",
            );
          }
        } catch (e) {
          console.warn("[aco-pf] malformed custom filter ids for", key, e);
        }
      });
    return out;
  }

  // Variant-level custom membership from the same embedded JSON: each option's
  // "vids" are "productId:variantId" pairs for products where only some
  // variants were picked. Products without an entry match all variants.
  function parseCustomVariants(root) {
    var out = {};
    root
      .querySelectorAll('[data-aco-pf-group][data-filter-type="custom"]')
      .forEach(function (group) {
        var key = group.getAttribute("data-filter-key");
        var tag = group.querySelector("[data-aco-pf-custom-ids]");
        if (!key || !tag) return;
        try {
          var rows = JSON.parse(tag.textContent) || [];
          var byRaw = {};
          for (var i = 0; i < rows.length; i++) {
            var vids = rows[i].vids || [];
            if (!vids.length) continue;
            var byProduct = {};
            for (var j = 0; j < vids.length; j++) {
              var parts = String(vids[j]).split(":");
              if (!parts[0] || !parts[1]) continue;
              (byProduct[parts[0]] = byProduct[parts[0]] || []).push(parts[1]);
            }
            byRaw[rows[i].raw] = byProduct;
          }
          out[key] = byRaw;
        } catch (e) {
          // parseCustomIds already warned about this group.
        }
      });
    return out;
  }

  // Which variants of a product the active custom selections allow: an array
  // of bare variant ids, or null when every variant is allowed. OR within a
  // group (union; a whole-product pick allows everything), AND across groups
  // (intersection).
  function customVariantRestriction(state, productId) {
    var sel = state.customSel || {};
    var result = null;
    for (var key in sel) {
      if (!Object.prototype.hasOwnProperty.call(sel, key)) continue;
      var raws = sel[key];
      if (!raws || !raws.length) continue;
      var ids = state.customIds[key] || {};
      var variants = state.customVariants[key] || {};
      var groupAll = false;
      var groupSet = {};
      var groupHas = false;
      for (var i = 0; i < raws.length; i++) {
        var members = ids[raws[i]];
        if (!members || !members.has(productId)) continue;
        var picked = variants[raws[i]] && variants[raws[i]][productId];
        if (!picked) {
          groupAll = true;
          break;
        }
        for (var j = 0; j < picked.length; j++) {
          groupSet[picked[j]] = true;
          groupHas = true;
        }
      }
      if (groupAll || !groupHas) continue;
      if (result === null) {
        result = groupSet;
      } else {
        var both = {};
        for (var v in result) if (groupSet[v]) both[v] = true;
        result = both;
      }
    }
    if (result === null) return null;
    var list = Object.keys(result);
    // Disjoint picks across groups: fall back to the product as a whole.
    return list.length ? list : null;
  }

  // Snapshot/grid nodes carry full GIDs; the config stores bare numeric ids.
  function bareId(gid) {
    var s = String(gid || "");
    var cut = s.lastIndexOf("/");
    return cut === -1 ? s : s.slice(cut + 1);
  }

  function productHandleFromHref(href) {
    if (!href) return "";
    try {
      var path = new URL(href, window.location.origin).pathname;
      var m = path.match(/\/products\/([^/?#]+)/i);
      return m ? decodeURIComponent(m[1]) : "";
    } catch (e) {
      return "";
    }
  }

  function skeletonCardHtml(state) {
    var layout =
      (state && state.productCard && state.productCard.cardLayout) || "classic";
    if (layout !== "classic" && layout !== "split") layout = "classic";
    var showActions =
      state &&
      state.productCard &&
      (state.productCard.showAddToCart || state.productCard.showBuyNow);

    if (layout === "split") {
      return (
        '<li class="grid__item aco-pf-card aco-pf-card--skeleton aco-pf-card--skeleton-split" aria-hidden="true">' +
        '<div class="aco-pf-skeleton-media"></div>' +
        '<div class="aco-pf-skeleton-body">' +
        '<div class="aco-pf-skeleton-line aco-pf-skeleton-line--title"></div>' +
        '<div class="aco-pf-skeleton-line aco-pf-skeleton-line--price"></div>' +
        '<div class="aco-pf-skeleton-line aco-pf-skeleton-line--swatch"></div>' +
        (showActions
          ? '<div class="aco-pf-skeleton-line aco-pf-skeleton-line--btn"></div>'
          : "") +
        "</div></li>"
      );
    }

    return (
      '<li class="grid__item aco-pf-card aco-pf-card--skeleton aco-pf-card--skeleton-classic" aria-hidden="true">' +
      '<div class="aco-pf-skeleton-media"></div>' +
      '<div class="aco-pf-skeleton-line aco-pf-skeleton-line--title"></div>' +
      '<div class="aco-pf-skeleton-line aco-pf-skeleton-line--price"></div>' +
      (showActions
        ? '<div class="aco-pf-skeleton-line aco-pf-skeleton-line--btn"></div>'
        : "") +
      "</li>"
    );
  }

  function ensureSkeletonStyleTag() {
    if (document.getElementById("aco-pf-skeleton-style")) return;
    var style = document.createElement("style");
    style.id = "aco-pf-skeleton-style";
    style.textContent =
      "[data-aco-pf-root].aco-pf-app--skeletons [data-aco-pf-results]," +
      "[data-aco-pf-root].aco-pf-app--loading.aco-pf-app--skeletons [data-aco-pf-results]{opacity:1!important;}" +
      "[data-aco-pf-grid].aco-pf-grid--skeletons{" +
      "display:grid!important;visibility:visible!important;opacity:1!important;" +
      "min-height:400px!important;align-content:start!important;" +
      "grid-template-columns:repeat(var(--aco-pf-cols, 3), minmax(0, 1fr))!important;}" +
      "@media (max-width:989px){[data-aco-pf-grid].aco-pf-grid--skeletons{" +
      "grid-template-columns:repeat(var(--aco-pf-cols-mobile, 2), minmax(0, 1fr))!important;}}" +
      "[data-aco-pf-grid].aco-pf-grid--skeletons .aco-pf-card--skeleton," +
      "[data-aco-pf-grid].aco-pf-grid--skeletons .grid__item{" +
      "visibility:visible!important;opacity:1!important;" +
      "width:100%!important;max-width:100%!important;flex:none!important;" +
      "list-style:none!important;margin:0!important;box-sizing:border-box!important;}" +
      "@keyframes aco-pf-skel-shimmer{0%{background-position:100% 0}100%{background-position:-100% 0}}" +
      "[data-aco-pf-grid].aco-pf-grid--skeletons .aco-pf-skeleton-media," +
      "[data-aco-pf-grid].aco-pf-grid--skeletons .aco-pf-skeleton-line{" +
      "background-color:#d0d0d0!important;" +
      "background-image:linear-gradient(90deg,#d0d0d0 0%,#ececec 45%,#d0d0d0 90%)!important;" +
      "background-size:200% 100%!important;animation:aco-pf-skel-shimmer 1.1s ease-in-out infinite!important;}";
    document.head.appendChild(style);
  }

  function showGridSkeletons(state, count) {
    closeVariantPickerForRerender(state);
    clearThemeGrid(state);
    ensureSkeletonStyleTag();
    var grid = state.root.querySelector("[data-aco-pf-grid]");
    if (!grid) {
      try {
        console.warn("[aco-pf] skeletons skipped: no [data-aco-pf-grid]");
      } catch (e) {}
      return;
    }
    syncGridLayoutClass(state);
    var n = Math.max(1, Math.min(Number(count) || state.perPage || 12, 24));
    var cols = 3;
    try {
      var raw = window
        .getComputedStyle(grid)
        .getPropertyValue("--aco-pf-cols")
        .trim();
      var parsed = parseInt(raw, 10);
      if (parsed > 0) cols = parsed;
      else if (state.columns) cols = Number(state.columns) || 3;
    } catch (e0) {}
    var html = "";
    for (var i = 0; i < n; i++) html += skeletonCardHtml(state);
    grid.innerHTML = html;
    grid.classList.add("aco-pf-grid--skeletons");
    grid.setAttribute("aria-busy", "true");
    grid.style.display = "grid";
    grid.style.visibility = "visible";
    grid.style.minHeight = "400px";
    grid.style.gridTemplateColumns = "repeat(" + cols + ", minmax(0, 1fr))";
    state.root.classList.add("aco-pf-app--skeletons");
    var overlay = state.root.querySelector("[data-aco-pf-skeleton-overlay]");
    if (overlay && overlay.parentNode) overlay.parentNode.removeChild(overlay);
    try {
      console.info("[aco-pf] skeletons shown", n);
    } catch (e2) {}
  }

  function clearGridSkeletons(grid) {
    var root =
      (grid && grid.closest && grid.closest("[data-aco-pf-root]")) ||
      document.querySelector("[data-aco-pf-root]");
    if (grid) {
      grid.classList.remove("aco-pf-grid--skeletons");
      grid.removeAttribute("aria-busy");
      try {
        grid.style.minHeight = "";
        grid.style.gridTemplateColumns = "";
      } catch (e) {}
    }
    if (root) {
      root.classList.remove("aco-pf-app--skeletons");
      var overlay = root.querySelector("[data-aco-pf-skeleton-overlay]");
      if (overlay && overlay.parentNode)
        overlay.parentNode.removeChild(overlay);
    }
  }

  function customSelections(params) {
    var map = {};
    var it = params.entries();
    var step = it.next();
    while (!step.done) {
      var key = step.value[0];
      var value = step.value[1];
      if (typeof key === "string" && key.indexOf("pf_custom_") === 0) {
        var name = key.slice("pf_custom_".length);
        (map[name] = map[name] || []).push(String(value));
      }
      step = it.next();
    }
    return map;
  }

  function hasCustomSelections(sel) {
    for (var k in sel) {
      if (Object.prototype.hasOwnProperty.call(sel, k) && sel[k].length)
        return true;
    }
    return false;
  }

  // Does `node` belong to ANY of the selected options of one custom filter?
  // (OR within a group, matching every other filter group's semantics.)
  function customGroupMatches(state, node, filterKey, wantedRaws) {
    var byRaw = state.customIds[filterKey];
    if (!byRaw) return false; // config/DOM mismatch Ã¢â‚¬â€ match nothing, never everything
    var id = bareId(node.id);
    for (var i = 0; i < wantedRaws.length; i++) {
      var ids = byRaw[wantedRaws[i]];
      if (ids && ids.has(id)) return true;
    }
    return false;
  }

  // Variant option selections: { OptionName: [value, ...] } (lowercased).
  function optionSelections(params) {
    var map = {};
    var it = params.entries();
    var step = it.next();
    while (!step.done) {
      var key = step.value[0];
      var value = step.value[1];
      if (typeof key === "string" && key.indexOf("pf_opt_") === 0) {
        var name = key.slice("pf_opt_".length);
        (map[name] = map[name] || []).push(String(value).toLowerCase());
      }
      step = it.next();
    }
    return map;
  }

  function hasOptionSelections(optSel) {
    for (var k in optSel) {
      if (Object.prototype.hasOwnProperty.call(optSel, k)) return true;
    }
    return false;
  }

  // Keep a product only if, for every selected option name, it offers at least
  // one of the selected values (AND across names, OR within a name). Collection
  // and custom-filter selections (not expressible in the query syntax either)
  // post-filter the same way: the product must be in at least one selected
  // collection / hand-picked option of each active custom filter.
  function postFilter(state, nodes, optSel, colSel, customSel) {
    for (var ck in customSel) {
      if (!Object.prototype.hasOwnProperty.call(customSel, ck)) continue;
      var raws = customSel[ck];
      if (!raws.length) continue;
      nodes = nodes.filter(
        (function (key, wanted) {
          return function (node) {
            return customGroupMatches(state, node, key, wanted);
          };
        })(ck, raws),
      );
    }
    if (colSel && colSel.length) {
      nodes = nodes.filter(function (node) {
        var hs = colHandles(node);
        return colSel.some(function (c) {
          return hs.indexOf(c) !== -1;
        });
      });
    }
    var names = [];
    for (var n in optSel) {
      if (Object.prototype.hasOwnProperty.call(optSel, n)) names.push(n);
    }
    if (!names.length) return nodes;
    return nodes.filter(function (node) {
      return names.every(function (name) {
        var wanted = optSel[name];
        var opt = null;
        (node.options || []).forEach(function (o) {
          if (o.name && o.name.toLowerCase() === name.toLowerCase()) opt = o;
        });
        if (!opt) return false;
        var vals = (opt.values || []).map(function (v) {
          return String(v).toLowerCase();
        });
        return wanted.some(function (w) {
          return vals.indexOf(w) !== -1;
        });
      });
    });
  }

  // ---- dynamic faceting ------------------------------------------------------
  // Recompute which sidebar values are still valid whenever the selection
  // changes, so shoppers can never pick a combination that yields zero results
  // just because an unavailable option was shown.
  //
  // products(query:) has no facet aggregation, so we scan a catalog attribute
  // snapshot once per page load (lazily, on the first filter change) and count
  // client-side. Each group is counted against the products matching every
  // OTHER group's selections (disjunctive faceting): after picking Size=50 ml,
  // Size=100 ml must stay selectable, but Type only shows types that have one
  // of those sizes.

  function lc(v) {
    return String(v == null ? "" : v).toLowerCase();
  }

  // Lowercased collection handles a product belongs to (snapshot/scan nodes).
  function colHandles(node) {
    var conn = node.collections;
    var nodes = (conn && conn.nodes) || [];
    var out = [];
    for (var i = 0; i < nodes.length; i++) {
      if (nodes[i] && nodes[i].handle) out.push(lc(nodes[i].handle));
    }
    return out;
  }

  // Lean facets-only page fetch: no titles, handles or image URLs (the grid
  // query carries those) Ã¢â‚¬â€ just the attributes productMatches/facetCount read.
  // Much smaller payloads make the snapshot scan markedly faster.
  function fetchFacetPage(state, after, queryStr) {
    var body = {
      query:
        "query PFFacets($first:Int!,$after:String,$query:String){" +
        " products(first:$first, after:$after, query:$query){" +
        " pageInfo{hasNextPage endCursor}" +
        // title/createdAt are carried so the grid's client-side sort (snapshot
        // mode) can order matches without re-querying.
        " nodes{ id title createdAt productType vendor tags availableForSale" +
        " collections(first:20){nodes{handle}}" +
        " priceRange{minVariantPrice{amount} maxVariantPrice{amount}} options{name values} } } }",
      variables: { first: FACET_BATCH, after: after, query: queryStr },
    };
    return fetch(
      "https://" + state.shop + "/api/" + state.version + "/graphql.json",
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "X-Shopify-Storefront-Access-Token": state.token,
        },
        body: JSON.stringify(body),
      },
    )
      .then(function (r) {
        return r.json();
      })
      .then(function (json) {
        if (json.errors)
          throw new Error(json.errors[0] && json.errors[0].message);
        var conn = json.data && json.data.products;
        if (!conn) throw new Error("Empty response");
        return conn;
      });
  }

  // Snapshot cache in sessionStorage so navigating between pages doesn't
  // re-scan the catalog. Only the store-wide snapshot is cached (search
  // snapshots are per-term). Quota/parse failures just mean "no cache".
  function facetCacheKey(state) {
    // v4: nodes carry title/createdAt (client-side grid sorting). The catalog
    // version invalidates the snapshot as soon as the store's products change.
    return "pf_facets_v4:" + state.shop + ":" + (state.catalogVersion || "0");
  }

  function readFacetCache(state) {
    try {
      var obj = JSON.parse(sessionStorage.getItem(facetCacheKey(state)));
      return obj && obj.nodes && obj.nodes.length ? obj : null;
    } catch (e) {
      return null;
    }
  }

  function writeFacetCache(state, nodes, capped) {
    try {
      // Drop snapshots for older catalog versions (they're large).
      var prefix = "pf_facets_v4:" + state.shop + ":";
      var keep = facetCacheKey(state);
      for (var i = sessionStorage.length - 1; i >= 0; i--) {
        var k = sessionStorage.key(i);
        if (k && k !== keep && (k.indexOf(prefix) === 0 || k === "pf_facets_v4:" + state.shop))
          sessionStorage.removeItem(k);
      }
      sessionStorage.setItem(
        facetCacheKey(state),
        JSON.stringify({ t: Date.now(), capped: !!capped, nodes: nodes }),
      );
    } catch (e) {
      /* quota exceeded Ã¢â‚¬â€ skip caching */
    }
  }

  // Build (or reuse) the snapshot. Fast paths, in order:
  //   1. fresh sessionStorage cache  -> zero network, counts render instantly
  //   2. stale cache                 -> render instantly, refresh in background
  //   3. cold scan                   -> progressive: counts update per batch
  //      (state.snapshotPartial guards hiding until the scan is complete)
  // On failure the promise slot is cleared so the next change retries.
  function ensureSnapshot(state) {
    if (state.snapshotPromise) return state.snapshotPromise;
    // Search context: facets are computed within the search results, so keep
    // the terms. Collection context matches the grid, which queries store-wide.
    var baseQuery =
      state.context === "search" && state.terms ? q(state.terms) : "";
    var cacheable = baseQuery === "";
    var cached = cacheable ? readFacetCache(state) : null;
    state.snapshotStoreWide = false;

    if (cached) {
      state.snapshot = cached.nodes;
      state.snapshotCapped = !!cached.capped;
      console.info(
        "[aco-pf] facet snapshot from cache:",
        cached.nodes.length,
        "products",
      );
      if (Date.now() - cached.t < FACET_CACHE_TTL) {
        state.snapshotPromise = Promise.resolve(cached.nodes);
        return state.snapshotPromise;
      }
      // stale: keep rendering from it while a fresh scan runs below
    }

    var nodes = [];
    state.snapshotPromise = (function step(after, batches) {
      return fetchFacetPage(state, after, baseQuery).then(function (conn) {
        nodes = nodes.concat(conn.nodes);
        var capped =
          conn.pageInfo.hasNextPage && batches + 1 >= FACET_MAX_BATCHES;
        if (conn.pageInfo.hasNextPage && !capped) {
          if (!cached) {
            // Cold load: show running counts now rather than after the whole
            // scan. Partial mode never hides values (they may appear in a
            // later batch); hiding waits for the complete snapshot.
            state.snapshot = nodes;
            state.snapshotPartial = true;
            recomputeFacets(state);
          }
          return step(conn.pageInfo.endCursor, batches + 1);
        }
        if (baseQuery && nodes.length === 0 && !conn.pageInfo.hasNextPage) {
          // Search page: the Storefront API's free-text query matches title,
          // vendor, type and tags only, while Shopify's search also matches
          // descriptions. A term that only hits descriptions returns zero
          // products here even though the page shows results, which would
          // hide every filter group. Fall back to a store-wide snapshot so the
          // filters stay usable (counts are then store-wide, not search-wide).
          console.info(
            "[aco-pf] facet snapshot empty for search term; using store-wide facets",
          );
          baseQuery = "";
          cacheable = true;
          // Counts only: this list is the whole store, not the search results,
          // so it must never replace the server's result pages.
          state.snapshotStoreWide = true;
          // The first page usually rendered before this was known; re-judge it
          // now that we know the term is one the API can't match.
          setTimeout(function () {
            if (state.lastPageNodes && state.lastPageNodes.length === 0)
              nativeResultsFallback(state, state.lastPageNodes);
          }, 0);
          cached = readFacetCache(state);
          if (cached && Date.now() - cached.t < FACET_CACHE_TTL) {
            state.snapshotPartial = false;
            state.snapshotCapped = !!cached.capped;
            state.snapshot = cached.nodes;
            return cached.nodes;
          }
          nodes = [];
          return step(null, 0);
        }
        state.snapshotPartial = false;
        state.snapshotCapped = capped;
        state.snapshot = nodes;
        if (cacheable) writeFacetCache(state, nodes, capped);
        console.info(
          "[aco-pf] facet snapshot loaded:",
          nodes.length,
          "products",
        );
        if (capped) {
          console.warn(
            "[aco-pf] facet snapshot capped at",
            FACET_BATCH * FACET_MAX_BATCHES,
            "products; facet availability may be incomplete",
          );
        }
        return nodes;
      });
    })(null, 0).catch(function (err) {
      state.snapshotPromise = null;
      state.snapshotPartial = false;
      if (cached) return cached.nodes; // stale beats nothing
      throw err;
    });
    return state.snapshotPromise;
  }

  // The current form selection, normalised for client-side matching.
  function readSelections(params) {
    return {
      types: params.getAll("pf_type").map(lc),
      vendors: params.getAll("pf_vendor").map(lc),
      tags: params.getAll("pf_tag").map(lc),
      cols: params.getAll("pf_collection").map(lc),
      available: params.get("pf_available") === "1",
      min: parseFloat(params.get("pf_price_min")),
      max: parseFloat(params.get("pf_price_max")),
      opts: optionSelections(params), // { Name: [lowercased values] }
      custom: customSelections(params), // { filterKey: [value raws] }
    };
  }

  function optionHasValue(node, name, value) {
    var opts = node.options || [];
    for (var i = 0; i < opts.length; i++) {
      if (lc(opts[i].name) !== name) continue;
      var vals = opts[i].values || [];
      for (var j = 0; j < vals.length; j++) {
        if (lc(vals[j]) === value) return true;
      }
    }
    return false;
  }

  // Client-side mirror of the server query semantics (OR within a group, AND
  // across groups; price = any variant inside each bound). `skip` names the
  // group whose own selections are ignored Ã¢â‚¬â€ "productType" | "productVendor" |
  // "tag" | "available" | "price" | "opt:<name lowercased>" |
  // "custom:<filter key>".
  function productMatches(state, node, sel, skip) {
    if (
      skip !== "productType" &&
      sel.types.length &&
      sel.types.indexOf(lc(node.productType)) === -1
    )
      return false;
    if (
      skip !== "productVendor" &&
      sel.vendors.length &&
      sel.vendors.indexOf(lc(node.vendor)) === -1
    )
      return false;
    if (skip !== "tag" && sel.tags.length) {
      var tags = (node.tags || []).map(lc);
      var anyTag = sel.tags.some(function (t) {
        return tags.indexOf(t) !== -1;
      });
      if (!anyTag) return false;
    }
    if (skip !== "collection" && sel.cols.length) {
      var hs = colHandles(node);
      var anyCol = sel.cols.some(function (c) {
        return hs.indexOf(c) !== -1;
      });
      if (!anyCol) return false;
    }
    if (skip !== "available" && sel.available && !node.availableForSale)
      return false;
    if (skip !== "price" && (!isNaN(sel.min) || !isNaN(sel.max))) {
      var pr = node.priceRange || {};
      var lo = pr.minVariantPrice ? parseFloat(pr.minVariantPrice.amount) : NaN;
      var hi = pr.maxVariantPrice ? parseFloat(pr.maxVariantPrice.amount) : lo;
      // exists variant >= min  <=>  maxVariantPrice >= min (and symmetrically).
      if (!isNaN(sel.min) && !(hi >= sel.min)) return false;
      if (!isNaN(sel.max) && !(lo <= sel.max)) return false;
    }
    for (var name in sel.opts) {
      if (!Object.prototype.hasOwnProperty.call(sel.opts, name)) continue;
      var key = lc(name);
      if (skip === "opt:" + key) continue;
      var wanted = sel.opts[name];
      var anyOpt = false;
      for (var w = 0; w < wanted.length; w++) {
        if (optionHasValue(node, key, wanted[w])) {
          anyOpt = true;
          break;
        }
      }
      if (!anyOpt) return false;
    }
    for (var ck in sel.custom) {
      if (!Object.prototype.hasOwnProperty.call(sel.custom, ck)) continue;
      if (skip === "custom:" + ck) continue;
      var raws = sel.custom[ck];
      if (!raws.length) continue;
      if (!customGroupMatches(state, node, ck, raws)) return false;
    }
    return true;
  }

  // Count how many products in `base` carry a given value for a group.
  /**
   * handle -> Set(handle + every descendant handle), for one collection tree.
   * Used to roll a parent's count up over its sub-collections when cascade
   * selection is on. Cached on the group: the tree DOM is static.
   */
  function treeDescendantMap(group) {
    if (group.__pfTreeDesc) return group.__pfTreeDesc;
    var childrenOf = {};
    var handles = [];
    group.querySelectorAll("[data-aco-pf-tree-node]").forEach(function (row) {
      var h = lc(row.getAttribute("data-aco-pf-tree-node"));
      var p = row.getAttribute("data-aco-pf-tree-parent");
      handles.push(h);
      if (p) {
        p = lc(p);
        (childrenOf[p] = childrenOf[p] || []).push(h);
      }
    });

    var map = {};
    handles.forEach(function (h) {
      var set = new Set([h]);
      var stack = (childrenOf[h] || []).slice();
      var guard = 0;
      while (stack.length && guard++ < 5000) {
        var cur = stack.pop();
        if (set.has(cur)) continue; // also breaks any parent cycle
        set.add(cur);
        var kids = childrenOf[cur];
        if (kids) stack.push.apply(stack, kids);
      }
      map[h] = set;
    });
    group.__pfTreeDesc = map;
    return map;
  }

  // `descOf` (collection trees with cascade selection only) rolls a parent's
  // count up over its sub-collections. Products are counted once each, so a
  // product sitting in two sub-collections doesn't inflate the parent Ã¢â‚¬â€ which
  // a plain sum of the children's badges would.
  function facetCount(state, base, kind, optName, filterKey, value, descOf) {
    // Custom filters: membership is a precomputed id set, so count by lookup.
    var customIds = null;
    if (kind === "custom") {
      var byRaw = state.customIds[filterKey];
      customIds = byRaw ? byRaw[value] : null;
      if (!customIds) return 0;
    }
    var n = 0;
    for (var i = 0; i < base.length; i++) {
      var node = base[i];
      var hit = false;
      if (kind === "productType") hit = lc(node.productType) === value;
      else if (kind === "productVendor") hit = lc(node.vendor) === value;
      else if (kind === "tag")
        hit = (node.tags || []).map(lc).indexOf(value) !== -1;
      else if (kind === "collection") {
        var hs = colHandles(node);
        var want = descOf ? descOf[value] : null;
        if (want) {
          hit = false;
          for (var h = 0; h < hs.length; h++) {
            if (want.has(hs[h])) {
              hit = true;
              break;
            }
          }
        } else {
          hit = hs.indexOf(value) !== -1;
        }
      } else if (kind === "variantOption")
        hit = optionHasValue(node, optName, value);
      else if (kind === "custom") hit = customIds.has(bareId(node.id));
      if (hit) n++;
    }
    return n;
  }

  // Show/hide sidebar values and groups from the snapshot + current selection.
  // Selected values always stay visible (so they can be unchecked); a group
  // collapses entirely when none of its values survive.
  function recomputeFacets(state) {
    if (!state.snapshot) return;
    var sel = readSelections(formParams(state));

    state.root
      .querySelectorAll("[data-aco-pf-group]")
      .forEach(function (group) {
        var kind = group.getAttribute("data-filter-type") || "";
        var optName = lc(group.getAttribute("data-option-name") || "");
        var filterKey = group.getAttribute("data-filter-key") || "";
        var skip = kind;
        if (kind === "variantOption") skip = "opt:" + optName;
        else if (kind === "custom") skip = "custom:" + filterKey;

        // Collection tree with cascade selection: ticking a parent also ticks its
        // sub-collections, so the parent's badge must count that same union Ã¢â‚¬â€
        // otherwise it advertises a number the click doesn't deliver.
        var descOf =
          kind === "collection" &&
          group.querySelector("[data-aco-pf-tree-auto-select]")
            ? treeDescendantMap(group)
            : null;
        var base = state.snapshot.filter(function (node) {
          return productMatches(state, node, sel, skip);
        });

        if (kind === "price") {
          // Offer only the price span that actually exists in the matching set.
          var lo = Infinity;
          var hi = -Infinity;
          for (var i = 0; i < base.length; i++) {
            var pr = base[i].priceRange || {};
            var a = pr.minVariantPrice
              ? parseFloat(pr.minVariantPrice.amount)
              : NaN;
            var b = pr.maxVariantPrice
              ? parseFloat(pr.maxVariantPrice.amount)
              : a;
            if (!isNaN(a)) lo = Math.min(lo, a);
            if (!isNaN(b)) hi = Math.max(hi, b);
          }
          if (base.length && isFinite(lo) && isFinite(hi)) {
            var minEl = group.querySelector('input[name="pf_price_min"]');
            var maxEl = group.querySelector('input[name="pf_price_max"]');
            if (minEl) minEl.placeholder = String(Math.floor(lo));
            if (maxEl) maxEl.placeholder = String(Math.ceil(hi));
          }
          var priceTyped = !isNaN(sel.min) || !isNaN(sel.max);
          group.style.display =
            state.snapshotPartial || base.length || priceTyped ? "" : "none";
          return;
        }

        var anyVisible = false;
        group.querySelectorAll(".aco-pf-value").forEach(function (row) {
          var input = row.querySelector("input[data-aco-pf-input]");
          // Navigate-mode tree rows are links, not inputs Ã¢â‚¬â€ counted by their
          // collection handle, never hidden while marked current.
          var treeNode = row.getAttribute("data-aco-pf-tree-node");
          if (!input && !treeNode) return;
          var value = input ? input.value : treeNode;
          var count;
          if (kind === "available") {
            count = 0;
            for (var k = 0; k < base.length; k++) {
              if (base[k].availableForSale) count++;
            }
          } else {
            count = facetCount(
              state,
              base,
              kind,
              optName,
              filterKey,
              lc(value),
              descOf,
            );
          }
          // Partial snapshot (scan still running): update counts but never hide Ã¢â‚¬â€
          // a value missing so far may still appear in a later batch.
          var selected = input
            ? input.checked
            : row.classList.contains("aco-pf-value--current");
          var alive = state.snapshotPartial || count > 0 || selected;
          if (!state.behavior.hideEmpty) {
            // Hiding disabled: everything stays visible (counts still update).
            setRowFlag(row, "pfFacetHide", false);
            row.classList.remove("aco-pf-value--disabled");
            if (input) input.disabled = false;
            anyVisible = true;
          } else if (state.behavior.disableEmpty) {
            // Grey out instead of hiding.
            setRowFlag(row, "pfFacetHide", false);
            row.classList.toggle("aco-pf-value--disabled", !alive);
            if (input) input.disabled = !alive;
            anyVisible = true;
          } else {
            setRowFlag(row, "pfFacetHide", !alive);
            row.classList.remove("aco-pf-value--disabled");
            if (input) input.disabled = false;
            if (alive) anyVisible = true;
          }
          var badge = row.querySelector(".aco-pf-value__count");
          if (badge) badge.textContent = alive ? "(" + count + ")" : "";
        });
        group.style.display = anyVisible ? "" : "none";
        // Re-collapse over the now-visible (facet-available) rows so the
        // "Show N more" count reflects the current filter combination.
        applyCollapse(group);
      });
  }

  // Entry point, called on init and on every selection change. The snapshot is
  // fetched on the first call (page load) so product counts are visible from
  // the start; every later change recomputes from the cached snapshot with no
  // network. On fetch failure the sidebar stays fully visible (old behaviour)
  // and the next change retries.
  function scheduleFacets(state) {
    var p = ensureSnapshot(state);
    // A cached (or partially scanned) snapshot renders immediately; the
    // resolved promise re-renders with the final data if it differs.
    if (state.snapshot) recomputeFacets(state);
    p.then(function () {
      recomputeFacets(state);
    }).catch(function (err) {
      console.warn(
        "[aco-pf] facet snapshot failed; leaving all filter values visible:",
        err,
      );
    });
  }

  // ---- main run ------------------------------------------------------------

  function run(state, reset, opts) {
    if (state.loading) {
      // A fetch is in flight; abort it and re-run with the latest form state
      // (the abort rejects the in-flight work, whose finally() fires the queued
      // rerun immediately instead of waiting the request out).
      if (reset) {
        state.rerunQueued = true;
        showGridSkeletons(state, state.perPage);
        if (state.aborter) state.aborter.abort();
      }
      return;
    }
    if (!state.token) {
      console.warn("[aco-pf] no Storefront token configured");
      showError(
        state,
        "Filtering is unavailable: no Storefront token. Re-run Detect filter values in the app.",
      );
      return;
    }

    var params = formParams(state);
    // Sort rides along in the URL (shareable sorted links) but never in the
    // form, so it's merged in here Ã¢â‚¬â€ and only when it differs from the
    // merchant's default, to keep clean URLs clean.
    if (state.sort && state.sort !== state.sortDefault)
      params.set("pf_sort", state.sort);

    if (reset) {
      state.deferredInit = false;
      state.query = buildProductQuery(state, params);
      state.optSel = optionSelections(params);
      state.colSel = params.getAll("pf_collection").map(lc);
      state.customSel = customSelections(params);
      // Options, collections AND custom filters all need client-side matching
      // (scan mode) whenever the snapshot can't drive the grid Ã¢â‚¬â€ none of them
      // can be expressed in the products(query:) search string.
      state.optActive =
        hasOptionSelections(state.optSel) ||
        state.colSel.length > 0 ||
        hasCustomSelections(state.customSel);
      state.currentAfter = null;
      state.nextAfter = null;
      state.prevStack = [];
      state.matched = [];
      state.matchedIds = [];
      state.scanAfter = null;
      state.scanDone = false;
      state.scanBatches = 0;
      state.scanCapped = false;
      state.pageNum = 1;
      // History: never push on initial load or on back/forward (that would
      // trap the shopper on the page); only push when the URL really changes.
      if (!(opts && opts.fromHistory)) {
        pushUrl(state, params, { replace: !!(opts && opts.initial) });
      }
      updateActiveChips(state);
      scheduleFacets(state); // may hydrate state.snapshot synchronously from cache
      // Grid mode: prefer the snapshot (in-memory matching, one light card
      // fetch per page); fall back to the legacy query/scan modes while the
      // snapshot is cold, partial or capped.
      if (snapshotUsable(state)) enterSnapshotMode(state, params);
      else state.mode = state.optActive ? "scan" : "server";
      reportApply(state);

      // Initial load with no filters: the SSR grid already IS page 1, so skip
      // the redundant page-1 fetch. Pagination unlocks when the snapshot
      // resolves (or via a legacy fetch if the snapshot can't drive the grid).
      // IMPORTANT: do not paint skeletons before this check — that wiped SSR
      // cards and made gridHasSsr() true on skeleton nodes, stranding the UI.
      // The SSR grid is in the theme's native order, so it only stands in for
      // page 1 when the active sort is that natural order. A merchant default
      // such as "Price, low to high" must load page 1 sorted.
      if (
        opts &&
        opts.deferIfClean &&
        !anyParams(params) &&
        state.sort === "default" &&
        gridHasSsr(state)
      ) {
        state.deferredInit = true;
        ensureSnapshot(state)
          .then(function () {
            if (!state.deferredInit) return; // shopper already interacted
            if (snapshotUsable(state)) {
              enterSnapshotMode(state, formParams(state));
              updatePager(state);
              prefetchNext(state);
            } else {
              state.deferredInit = false;
              loadPage(state);
            }
          })
          .catch(function () {
            if (state.deferredInit) {
              state.deferredInit = false;
              loadPage(state);
            }
          });
        return;
      }
      // Real fetch incoming: loadPage() paints the skeletons.
    }

    loadPage(state);
  }

  function loadPage(state) {
    if (state.loading) return;
    state.loading = true;
    setBusy(state, true);
    // Universal: replace stale cards with skeletons until the new page is ready
    // (ACO, Dawn theme cards, and Horizon theme cards).
    showGridSkeletons(state, state.perPage);

    // Abortable so a newer selection can cancel this fetch mid-flight.
    var signal = null;
    if (typeof AbortController !== "undefined") {
      state.aborter = new AbortController();
      signal = state.aborter.signal;
    }

    var work =
      state.mode === "snapshot"
        ? loadSnapshotPage(state, signal)
        : state.optActive
          ? loadOptionPage(state, signal)
          : loadServerPage(state, signal);
    work
      .catch(function (err) {
        if (err && err.name === "AbortError") return; // superseded by a newer run
        console.warn("[aco-pf] query failed:", err);
        showError(
          state,
          "Couldn't load filtered products: " +
            (err && err.message ? err.message : "request failed") +
            ".",
        );
      })
      .finally(function () {
        state.loading = false;
        setBusy(state, false);
        if (state.rerunQueued) {
          state.rerunQueued = false;
          run(state, true);
        }
      });
  }

  // No option filters selected: the query string does all the filtering, so one
  // request = one page. Prev/Next drive pagination via cursors.
  function loadServerPage(state, signal) {
    return fetchProducts(state, state.perPage, state.currentAfter, signal).then(
      function (conn) {
        state.nextAfter = conn.pageInfo.endCursor;
        state.hasNext = conn.pageInfo.hasNextPage;
        syncCurrency(state, conn.nodes);
        nativeResultsFallback(state, conn.nodes);
        return renderPage(state, conn.nodes);
      },
    );
  }

  /** Any filter / price selection in the current URL (page and sort aside). */
  function hasActiveSelection() {
    var params = new URLSearchParams(window.location.search);
    var active = false;
    params.forEach(function (value, key) {
      if (key.indexOf("pf_") !== 0) return;
      if (key === "pf_page" || key === "pf_sort") return;
      if (value !== "") active = true;
    });
    return active;
  }

  // Shopify's own search matches product descriptions; the Storefront API's
  // free-text query does not. A term that only hits descriptions leaves us
  // with no products although the page has results, so the theme's native
  // results are shown instead of an empty grid — until a filter is applied,
  // when our (filterable) grid takes over again.
  function nativeResultsFallback(state, nodes) {
    if (state.context !== "search") return false;
    var show =
      !!state.snapshotStoreWide &&
      nodes.length === 0 &&
      state.pageNum === 1 &&
      !hasActiveSelection();
    if (show === !!state.nativeShown) return show;
    var section = state.root.closest(".shopify-section") || document;
    var results = state.root.querySelector("[data-aco-pf-results]");
    state.nativeShown = show;
    state.root.classList.toggle("aco-pf-native-results", show);
    if (show) {
      section
        .querySelectorAll("[data-aco-pf-hidden-theme-grid]")
        .forEach(function (el) {
          el.removeAttribute("data-aco-pf-hidden-theme-grid");
        });
      if (results) results.setAttribute("hidden", "");
    } else {
      if (results) results.removeAttribute("hidden");
      hideNativeThemeGrid(state);
    }
    return show;
  }

  // Option filters selected: scan the (query-pre-filtered) catalog in batches,
  // keep the products that match the selected options, and paginate that matched
  // list client-side. The scan is incremental Ã¢â‚¬â€ it stops as soon as the current
  // page can be filled Ã¢â‚¬â€ and resumes from the saved cursor on Next.
  function loadOptionPage(state, signal) {
    var target = state.pageNum * state.perPage + 1; // +1 so hasNext is known
    return ensureMatched(state, target, signal).then(function () {
      var start = (state.pageNum - 1) * state.perPage;
      state.hasNext = state.matched.length > state.pageNum * state.perPage;
      var nodes = state.matched.slice(start, start + state.perPage);
      nativeResultsFallback(state, nodes);
      return renderPage(state, nodes).then(function () {
        if (state.scanCapped) {
          console.warn(
            "[aco-pf] option scan capped at",
            SCAN_BATCH * SCAN_MAX_BATCHES,
            "products; results may be incomplete",
          );
        }
      });
    });
  }

  function ensureMatched(state, target, signal) {
    if (state.matched.length >= target || state.scanDone)
      return Promise.resolve();
    return fetchProducts(state, SCAN_BATCH, state.scanAfter, signal).then(
      function (conn) {
        state.scanBatches += 1;
        syncCurrency(state, conn.nodes);
        state.matched = state.matched.concat(
          postFilter(
            state,
            conn.nodes,
            state.optSel,
            state.colSel,
            state.customSel,
          ),
        );
        state.scanAfter = conn.pageInfo.endCursor;
        if (!conn.pageInfo.hasNextPage) {
          state.scanDone = true;
        } else if (state.scanBatches >= SCAN_MAX_BATCHES) {
          state.scanDone = true;
          state.scanCapped = true;
        }
        return ensureMatched(state, target, signal);
      },
    );
  }

  // ---- snapshot-driven grid --------------------------------------------------
  // With a complete, uncapped snapshot, matching runs entirely in-memory (the
  // same productMatches the facets use), pagination knows the true total, and
  // each page needs at most one light nodes(ids:) request for card data.

  // Can the active sort be reproduced in memory? "default" needs no work (the
  // snapshot is already in the API's natural order) and price/title/date sort
  // from fields the snapshot carries. Best selling can't Ã¢â‚¬â€ the grid falls back
  // to the server/scan path, which asks the API for that order.
  function gridSortable(state) {
    return state.sort === "default" || !!sortDef(state.sort).cmp;
  }

  function snapshotUsable(state) {
    return !!(
      state.snapshot &&
      !state.snapshotPartial &&
      !state.snapshotCapped &&
      !state.snapshotStoreWide &&
      gridSortable(state)
    );
  }

  function matchedIdsFor(state, sel) {
    var snapshot = state.snapshot;
    var matched = [];
    for (var i = 0; i < snapshot.length; i++) {
      if (productMatches(state, snapshot[i], sel, null))
        matched.push(snapshot[i]);
    }
    var cmp = sortDef(state.sort).cmp;
    if (cmp) matched.sort(cmp);
    return matched.map(function (n) {
      return n.id;
    });
  }

  function enterSnapshotMode(state, params) {
    state.mode = "snapshot";
    state.matchedIds = matchedIdsFor(state, readSelections(params));
    state.hasNext = state.matchedIds.length > state.pageNum * state.perPage;
  }

  // Card data (title/image/price) for specific product ids, memoised per
  // product for the session Ã¢â‚¬â€ revisited pages and toggled-off filters render
  // with zero network.
  function fetchCards(state, ids, signal) {
    var need = [];
    for (var i = 0; i < ids.length; i++) {
      if (!state.cardCache[ids[i]]) need.push(ids[i]);
    }
    if (!need.length) return Promise.resolve();
    var imagesFrag = state.productCard.imageSlideshow
      ? " images(first:10){nodes{url altText}}"
      : "";
    var layout = state.productCard.cardLayout || "classic";
    var extrasFrag =
      layout === "classic"
        ? ""
        : " productType options{name values}";
    var body = {
      query:
        "query PFCards($ids:[ID!]!){ nodes(ids:$ids){ ... on Product {" +
        " id title handle vendor availableForSale featuredImage{url altText}" +
        imagesFrag +
        extrasFrag +
        " variants(first:2){nodes{id availableForSale price{amount currencyCode} compareAtPrice{amount currencyCode}}}" +
        " compareAtPriceRange{minVariantPrice{amount currencyCode}}" +
        " priceRange{minVariantPrice{amount currencyCode}} } } }",
      variables: { ids: need },
    };
    return fetch(
      "https://" + state.shop + "/api/" + state.version + "/graphql.json",
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "X-Shopify-Storefront-Access-Token": state.token,
        },
        body: JSON.stringify(body),
        signal: signal,
      },
    )
      .then(function (r) {
        return r.json();
      })
      .then(function (json) {
        if (json.errors)
          throw new Error(json.errors[0] && json.errors[0].message);
        var nodes = (json.data && json.data.nodes) || [];
        for (var j = 0; j < nodes.length; j++) {
          if (nodes[j] && nodes[j].id) state.cardCache[nodes[j].id] = nodes[j];
        }
      });
  }

  // One modal per filter root; the counter keeps the dialog title ids unique so
  // aria-labelledby still resolves when a page hosts more than one root.
  var variantModalSeq = 0;

  // SSR Liquid emits bare numeric product ids (`{{ product.id }}`), while
  // re-rendered cards carry full GIDs. The Storefront `node(id:)` query only
  // accepts a GID, so normalize before querying (and before cache lookups, so
  // both spellings of the same product share one request).
  function productGid(id) {
    var raw = String(id == null ? "" : id).trim();
    if (!raw) return "";
    if (raw.indexOf("gid://") === 0) return raw;
    if (/^[0-9]+$/.test(raw)) return "gid://shopify/Product/" + raw;
    return raw;
  }

  function normalizeProductOptions(options) {
    var list = options || [];
    var normalized = [];
    for (var i = 0; i < list.length; i++) {
      var option = list[i] || {};
      if (Array.isArray(option.values)) {
        normalized.push({ name: option.name, values: option.values });
        continue;
      }
      var optionValues = option.optionValues || [];
      var values = [];
      for (var j = 0; j < optionValues.length; j++) {
        if (optionValues[j] && optionValues[j].name != null) {
          values.push(String(optionValues[j].name));
        }
      }
      normalized.push({ name: option.name, values: values });
    }
    return normalized;
  }

  function fetchVariantDetails(state, productId, signal) {
    if (state.variantCache[productId]) return state.variantCache[productId];

    var body = {
      query:
        "query AcoPFVariantPicker($id:ID!){node(id:$id){... on Product{" +
        "id title featuredImage{url altText} options{name optionValues{name}}" +
        " variants(first:250){nodes{id title availableForSale" +
        " price{amount currencyCode} compareAtPrice{amount currencyCode}" +
        " selectedOptions{name value} image{url altText}}}}}}",
      variables: { id: productId },
    };
    var request = fetch(
      "https://" + state.shop + "/api/" + state.version + "/graphql.json",
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "X-Shopify-Storefront-Access-Token": state.token,
        },
        body: JSON.stringify(body),
        signal: signal,
      },
    )
      .then(function (response) {
        if (!response.ok)
          throw new Error("Variant request failed (" + response.status + ")");
        return response.json();
      })
      .then(function (json) {
        if (json.errors && json.errors.length) {
          throw new Error(
            json.errors
              .map(function (error) {
                return error && error.message;
              })
              .filter(Boolean)
              .join("; ") || "Unable to load variants.",
          );
        }
        var product = json.data && json.data.node;
        if (!product) throw new Error("Unable to load variants.");
        product.options = normalizeProductOptions(product.options);
        product.variants = product.variants || { nodes: [] };
        product.variants.nodes = product.variants.nodes || [];
        return product;
      });

    state.variantCache[productId] = request;
    request.catch(function () {
      if (state.variantCache[productId] === request)
        delete state.variantCache[productId];
    });
    return request;
  }

  function variantSelection(variant) {
    var selection = Object.create(null);
    var options = (variant && variant.selectedOptions) || [];
    for (var i = 0; i < options.length; i++) {
      selection[String(options[i].name)] = String(options[i].value);
    }
    return selection;
  }

  function variantPickerImage(product, variant) {
    return (variant && variant.image) || product.featuredImage || null;
  }

  function variantPickerFocusable(modal) {
    return Array.prototype.slice.call(
      modal.querySelectorAll(
        'button:not([disabled]), input:not([disabled]), select:not([disabled]), [tabindex]:not([tabindex="-1"])',
      ),
    );
  }

  function variantPickerOptionControl(modal, option) {
    if (!option) return null;
    var controls = modal.querySelectorAll("[data-aco-pf-variant-option]");
    for (var i = 0; i < controls.length; i++) {
      if (
        controls[i].getAttribute("data-aco-pf-variant-option") ===
          option.name &&
        controls[i].getAttribute("data-aco-pf-variant-value") === option.value
      ) {
        return controls[i];
      }
    }
    return null;
  }

  function setVariantFormLocked(form, locked) {
    if (!form) return;
    form.setAttribute("aria-busy", locked ? "true" : "false");
    form
      .querySelectorAll("button, input, select, textarea")
      .forEach(function (control) {
        control.disabled =
          locked || control.hasAttribute("data-aco-pf-variant-disabled");
      });
  }

  function finishVariantSubmission(state, submissionId, form) {
    var picker = state.variantPicker;
    if (!picker || picker.submissionId !== submissionId) return false;
    picker.submitting = false;
    setVariantFormLocked(
      picker.element.querySelector("[data-aco-pf-variant-form]") || form,
      false,
    );
    return true;
  }

  function closeVariantPicker(state) {
    if (!state.variantPicker) return;
    if (state.variantPicker.submitting) return;
    state.variantRequestGeneration += 1;
    state.activeVariantProductId = null;
    var modal = state.variantPicker.element;
    if (modal) {
      if (typeof modal.close === "function" && modal.open) modal.close();
      modal.removeAttribute("open");
      modal.hidden = true;
    }
    try {
      state.variantPicker.trigger.focus();
    } catch (e) {}
  }

  // The grid is about to be replaced, which detaches the modal's trigger. An
  // idle modal is closed first so focus restoration can still reach it; an
  // in-flight submission keeps its lock and is left alone.
  function closeVariantPickerForRerender(state) {
    if (!state.variantPicker || !state.variantPicker.element) return;
    if (state.variantPicker.submitting) return;
    var modal = state.variantPicker.element;
    if (!modal.open && !modal.hasAttribute("open")) return;
    closeVariantPicker(state);
  }

  // The dialog markup is rebuilt on every state change, so the polite live
  // region has to live outside the replaced subtree (still inside the dialog,
  // where assistive tech reads it while the modal traps focus).
  function ensureVariantPickerShell(modal, titleId) {
    var shell = modal.querySelector("[data-aco-pf-variant-shell]");
    if (shell) return shell;
    modal.innerHTML =
      '<div class="aco-pf-variant-modal__dialog" data-aco-pf-variant-shell></div>' +
      '<p class="aco-pf-variant-modal__live" data-aco-pf-variant-live role="status"' +
      ' aria-live="polite" aria-atomic="true" data-aco-pf-variant-title-id="' +
      escapeHtml(titleId) +
      '"></p>';
    return modal.querySelector("[data-aco-pf-variant-shell]");
  }

  function announceVariantPicker(state, message) {
    var modal = state.variantPicker && state.variantPicker.element;
    if (!modal) return;
    var live = modal.querySelector("[data-aco-pf-variant-live]");
    if (!live) return;
    var text = message == null ? "" : String(message);
    if (live.textContent === text) return;
    live.textContent = text;
  }

  function ensureVariantPicker(state) {
    if (state.variantPicker && state.variantPicker.element)
      return state.variantPicker.element;

    var modal = document.createElement("dialog");
    modal.className = "aco-pf-variant-modal";
    if (state.productCard.buttonStyle === "outline")
      modal.className += " aco-pf-variant-modal--btn-outline";
    modal.setAttribute("data-aco-pf-variant-backdrop", "");
    // No explicit role: a native <dialog> already exposes the dialog role, and
    // duplicating it announces the same landmark twice.
    modal.setAttribute("aria-modal", "true");
    modal.addEventListener("cancel", function (event) {
      event.preventDefault();
      closeVariantPicker(state);
    });
    modal.addEventListener("keydown", function (event) {
      if (event.key === "Escape") {
        event.preventDefault();
        if (state.variantPicker && state.variantPicker.submitting) return;
        closeVariantPicker(state);
        return;
      }
      if (event.key !== "Tab") return;
      var focusable = variantPickerFocusable(modal);
      if (!focusable.length) return;
      var first = focusable[0];
      var last = focusable[focusable.length - 1];
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first.focus();
      }
    });
    modal.addEventListener("click", function (event) {
      if (state.variantPicker && state.variantPicker.submitting) {
        event.preventDefault();
        return;
      }
      if (
        event.target === modal ||
        event.target.closest("[data-aco-pf-variant-close]")
      ) {
        closeVariantPicker(state);
        return;
      }
      var retry = event.target.closest("[data-aco-pf-variant-retry]");
      if (retry) {
        openVariantPicker(state, state.variantPicker.trigger);
        return;
      }
      var quantityButton = event.target.closest(
        "[data-aco-pf-variant-quantity-step]",
      );
      if (quantityButton) {
        if (state.variantPicker.submitting) return;
        var quantityInput = modal.querySelector(
          "[data-aco-pf-variant-quantity]",
        );
        var current = parseInt(quantityInput.value, 10);
        if (!Number.isFinite(current) || current < 1) current = 1;
        var step = parseInt(
          quantityButton.getAttribute("data-aco-pf-variant-quantity-step"),
          10,
        );
        quantityInput.value = String(Math.max(1, current + step));
        return;
      }
      var optionButton = event.target.closest("[data-aco-pf-variant-value]");
      if (!optionButton || optionButton.disabled) return;
      var picker = state.variantPicker;
      if (picker.submitting) return;
      var currentQuantity = modal.querySelector(
        "[data-aco-pf-variant-quantity]",
      );
      var parsedQuantity = window.AcoPFVariantPicker.parseQuantity(
        currentQuantity && currentQuantity.value,
      );
      if (parsedQuantity != null) picker.quantity = parsedQuantity;
      var optionName = optionButton.getAttribute("data-aco-pf-variant-option");
      var optionValue = optionButton.getAttribute("data-aco-pf-variant-value");
      picker.selection[optionName] = optionValue;
      picker.selectedVariant = window.AcoPFVariantPicker.matchingVariant(
        picker.variants,
        picker.selection,
      );
      picker.focusOption = { name: optionName, value: optionValue };
      renderVariantPicker(state, picker);
    });
    modal.addEventListener("submit", function (event) {
      event.preventDefault();
      submitVariantPicker(
        state,
        event.target,
        event.submitter &&
          event.submitter.getAttribute("data-aco-pf-variant-submit"),
      );
    });
    // Appended under [data-aco-pf-root] (never document.body) so the merchant's
    // --aco-pf-* custom properties, set inline on the root, inherit into the modal.
    // A top-layer <dialog> still positions against the viewport.
    state.root.appendChild(modal);
    state.variantPicker = {
      element: modal,
      trigger: null,
      titleId: "aco-pf-variant-modal-title-" + ++variantModalSeq,
    };
    return modal;
  }

  function variantOptionHtml(group, selection, variants, optionNames, locked) {
    var values = group.values || [];
    var buttons = values
      .map(function (value) {
        var selected = selection[group.name] === value;
        var available = window.AcoPFVariantPicker.optionValueAvailable(
          variants,
          selection,
          group.name,
          value,
          optionNames,
        );
        var classes = "aco-pf-variant-modal__option";
        if (selected) classes += " is-selected";
        if (!available) classes += " is-unavailable";
        return (
          '<button type="button" class="' +
          classes +
          '" data-aco-pf-variant-option="' +
          escapeHtml(group.name) +
          '" data-aco-pf-variant-value="' +
          escapeHtml(value) +
          '" aria-pressed="' +
          (selected ? "true" : "false") +
          '"' +
          (available ? "" : ' data-aco-pf-variant-disabled="true"') +
          (available && !locked ? "" : " disabled") +
          ">" +
          escapeHtml(value) +
          "</button>"
        );
      })
      .join("");
    return (
      '<fieldset class="aco-pf-variant-modal__group">' +
      "<legend>" +
      escapeHtml(group.name) +
      "</legend>" +
      '<div class="aco-pf-variant-modal__options">' +
      buttons +
      "</div></fieldset>"
    );
  }

  function variantPickerReadyHtml(state, picker) {
    var product = picker.product;
    var variant = picker.selectedVariant;
    var image = variantPickerImage(product, variant);
    var imageHtml = image
      ? '<img class="aco-pf-variant-modal__image" src="' +
        escapeHtml(image.url) +
        '" alt="' +
        escapeHtml(image.altText || product.title || "") +
        '">'
      : "";
    var optionNames = (product.options || []).map(function (option) {
      return option.name;
    });
    var groups = window.AcoPFVariantPicker.optionGroups(
      picker.variants,
      optionNames,
    );
    var optionsHtml = groups
      .map(function (group) {
        return variantOptionHtml(
          group,
          picker.selection,
          picker.variants,
          optionNames,
          picker.submitting,
        );
      })
      .join("");
    var available = !!(variant && variant.availableForSale);
    var price = variant && variant.price ? formatMoney(variant.price) : "";
    var compare =
      variant && variant.compareAtPrice
        ? '<s class="aco-pf-variant-modal__compare">' +
          escapeHtml(formatMoney(variant.compareAtPrice)) +
          "</s>"
        : "";
    var variantId = variant ? bareId(variant.id) : "";
    var actionDisabled =
      available && !picker.submitting
        ? ""
        : (available ? "" : ' data-aco-pf-variant-disabled="true"') +
          " disabled";
    var lockDisabled = picker.submitting ? " disabled" : "";
    var addToCartText = state.productCard.addToCartText || "Add to cart";
    var buyNowText = state.productCard.buyNowText || "Buy it now";
    // Mirror the card actions: a merchant who turned Add to cart off must not
    // get it back inside the modal.
    var addToCart = state.productCard.showAddToCart
      ? '<button type="submit" class="aco-pf-variant-modal__action" data-aco-pf-variant-submit="cart"' +
        actionDisabled +
        ">" +
        escapeHtml(addToCartText) +
        "</button>"
      : "";
    var buyNow = state.productCard.showBuyNow
      ? '<button type="submit" class="aco-pf-variant-modal__action aco-pf-variant-modal__action--secondary" data-aco-pf-variant-submit="buy"' +
        actionDisabled +
        ">" +
        escapeHtml(buyNowText) +
        "</button>"
      : "";
    var actionsClass = "aco-pf-variant-modal__actions";
    if (!addToCart || !buyNow)
      actionsClass += " aco-pf-variant-modal__actions--single";
    return (
      '<div class="aco-pf-variant-modal__product">' +
      imageHtml +
      '<div class="aco-pf-variant-modal__content">' +
      '<h2 id="' +
      escapeHtml(picker.titleId) +
      '" class="aco-pf-variant-modal__title">' +
      escapeHtml(product.title || "Choose variant") +
      "</h2>" +
      '<form class="aco-pf-variant-modal__form" data-aco-pf-variant-form aria-busy="' +
      (picker.submitting ? "true" : "false") +
      '" data-aco-pf-variant-id="' +
      escapeHtml(variantId) +
      '">' +
      optionsHtml +
      '<div class="aco-pf-variant-modal__details">' +
      '<p class="aco-pf-variant-modal__variant-title">' +
      escapeHtml((variant && variant.title) || "Choose variant") +
      "</p>" +
      '<p class="aco-pf-variant-modal__price">' +
      escapeHtml(price) +
      compare +
      "</p>" +
      '<p class="aco-pf-variant-modal__availability" data-aco-pf-variant-availability>' +
      (available ? "In stock" : "Out of stock") +
      "</p></div>" +
      '<label class="aco-pf-variant-modal__quantity-label">Quantity' +
      '<span class="aco-pf-variant-modal__quantity">' +
      '<button type="button" aria-label="Decrease quantity" data-aco-pf-variant-quantity-step="-1"' +
      lockDisabled +
      ">-</button>" +
      '<input type="number" min="1" step="1" value="' +
      escapeHtml(picker.quantity || 1) +
      '" inputmode="numeric" data-aco-pf-variant-quantity' +
      lockDisabled +
      ">" +
      '<button type="button" aria-label="Increase quantity" data-aco-pf-variant-quantity-step="1"' +
      lockDisabled +
      ">+</button>" +
      "</span></label>" +
      '<div class="' +
      actionsClass +
      '">' +
      addToCart +
      buyNow +
      "</div>" +
      '<p class="aco-pf-variant-modal__error" data-aco-pf-variant-error></p>' +
      "</form></div></div>"
    );
  }

  function renderVariantPicker(state, model) {
    var modal = ensureVariantPicker(state);
    var previous = state.variantPicker || {};
    var picker = {};
    for (var oldKey in previous) picker[oldKey] = previous[oldKey];
    for (var key in model) picker[key] = model[key];
    picker.element = modal;
    state.variantPicker = picker;
    var focusOption = picker.focusOption;
    var initialFocus = picker.initialFocus;
    picker.focusOption = null;
    picker.initialFocus = false;

    var body;
    var announcement;
    if (picker.status === "ready") {
      picker.variants = (picker.product.variants || {}).nodes || [];
      if (!picker.selection) {
        picker.selectedVariant =
          window.AcoPFVariantPicker.firstAvailableVariant(picker.variants);
        picker.selection = variantSelection(picker.selectedVariant);
        picker.quantity = 1;
      }
      body = variantPickerReadyHtml(state, picker);
      var chosen = picker.selectedVariant;
      announcement =
        ((chosen && chosen.title) || "Choose variant") +
        ", " +
        (chosen && chosen.availableForSale ? "In stock" : "Out of stock");
    } else if (picker.status === "error") {
      body =
        '<div class="aco-pf-variant-modal__state aco-pf-variant-modal__state--error">' +
        "<p>" +
        escapeHtml(picker.message || "Unable to load variants.") +
        "</p>" +
        '<button type="button" data-aco-pf-variant-retry>Retry</button></div>';
      announcement = picker.message || "Unable to load variants.";
    } else {
      body =
        '<div class="aco-pf-variant-modal__state aco-pf-variant-modal__state--loading">Loading variants...</div>';
      announcement = "Loading variants...";
    }

    var shell = ensureVariantPickerShell(modal, picker.titleId);
    shell.innerHTML =
      '<button type="button" class="aco-pf-variant-modal__close" aria-label="Close" data-aco-pf-variant-close>&times;</button>' +
      body;
    // Prefer the rendered product title as the accessible name; the loading and
    // error states have no title to point at, so they keep a static fallback.
    var titleId = picker.titleId;
    if (titleId && shell.querySelector("#" + titleId)) {
      modal.setAttribute("aria-labelledby", titleId);
      modal.removeAttribute("aria-label");
    } else {
      modal.removeAttribute("aria-labelledby");
      modal.setAttribute("aria-label", "Choose variant");
    }
    announceVariantPicker(state, announcement);
    modal.hidden = false;
    if (typeof modal.showModal === "function") {
      try {
        modal.showModal();
      } catch (e) {}
    }
    modal.setAttribute("open", "");
    if (focusOption || initialFocus) {
      window.setTimeout(function () {
        var focusTarget = variantPickerOptionControl(modal, focusOption);
        if (!focusTarget && initialFocus) {
          focusTarget =
            modal.querySelector("[data-aco-pf-variant-retry]") ||
            modal.querySelector(
              '[data-aco-pf-variant-option][aria-pressed="true"]:not([disabled])',
            ) ||
            modal.querySelector("[data-aco-pf-variant-close]");
        }
        if (focusTarget) focusTarget.focus();
      }, 0);
    }
  }

  function submitVariantPicker(state, form, action) {
    var picker = state.variantPicker;
    if (picker.submitting) return;
    var variantId = form.getAttribute("data-aco-pf-variant-id");
    var quantityInput = form.querySelector("[data-aco-pf-variant-quantity]");
    var submit = form.querySelector(
      '[data-aco-pf-variant-submit="' +
        (action === "buy" ? "buy" : "cart") +
        '"]',
    );
    var error = form.querySelector("[data-aco-pf-variant-error]");
    if (error) error.textContent = "";
    var quantity = window.AcoPFVariantPicker.parseQuantity(
      quantityInput && quantityInput.value,
    );
    if (quantity == null) {
      if (error) error.textContent = "Enter a whole number greater than 0.";
      if (quantityInput) quantityInput.focus();
      return;
    }
    picker.quantity = quantity;
    if (!variantId || !picker.selectedVariant || !submit) return;

    picker.submitting = true;
    var submissionId = ++state.variantSubmitGeneration;
    picker.submissionId = submissionId;
    setVariantFormLocked(form, true);
    setBtnBusy(submit, true, action === "buy" ? "..." : "Adding...");
    (action === "buy"
      ? createCheckoutCart(state, variantId, quantity)
      : cartAdd(state, variantId, quantity)
    )
      .then(function (checkoutUrl) {
        if (!finishVariantSubmission(state, submissionId, form)) return;
        if (action === "buy") {
          phCapture(state, "storefront_buy_now", {
            context: state.context,
            variant_id: variantId,
          });
          window.location.href = checkoutUrl;
          return;
        }
        phCapture(state, "storefront_add_to_cart", {
          context: state.context,
          variant_id: variantId,
          product_url: picker.trigger.getAttribute("data-aco-pf-url") || "",
        });
        notifyThemeCartUpdated();
        if (state.productCard.afterAddToCart === "cart") {
          window.location.href = cartPath("cart");
          return;
        }
        var trigger = picker.trigger;
        closeVariantPicker(state);
        // The modal is closed, so its button is no longer visible: flash the
        // card trigger the shopper came from instead.
        setBtnBusy(submit, false, btnLabel(state, submit));
        if (trigger && trigger.isConnected !== false)
          flashBtn(state, trigger, "Added");
      })
      .catch(function (requestError) {
        if (!finishVariantSubmission(state, submissionId, form)) return;
        console.warn(
          "[aco-pf] variant add to cart failed:",
          requestError && requestError.message,
        );
        setBtnBusy(submit, false, btnLabel(state, submit));
        var message =
          (requestError && requestError.message) || "Unable to add item.";
        if (error) error.textContent = message;
        announceVariantPicker(state, message);
      });
  }

  function variantPickerRequestActive(state, requestGeneration, productId) {
    return (
      state.variantRequestGeneration === requestGeneration &&
      state.activeVariantProductId === productId
    );
  }

  function openVariantPicker(state, button) {
    if (state.variantPicker && state.variantPicker.submitting) return;
    var card = button.closest("[data-aco-pf-id]");
    var productId = productGid(
      button.getAttribute("data-aco-pf-product") ||
        button.getAttribute("data-aco-pf-id") ||
        (card && card.getAttribute("data-aco-pf-id")),
    );
    if (!productId) return;
    var requestGeneration = ++state.variantRequestGeneration;
    state.activeVariantProductId = productId;

    renderVariantPicker(state, {
      status: "loading",
      trigger: button,
      productId: productId,
      selection: null,
      selectedVariant: null,
      quantity: 1,
      submitting: false,
      initialFocus: true,
    });
    fetchVariantDetails(state, productId)
      .then(function (product) {
        if (!variantPickerRequestActive(state, requestGeneration, productId))
          return;
        renderVariantPicker(state, {
          status: "ready",
          trigger: button,
          product: product,
          selection: null,
          initialFocus: true,
        });
      })
      .catch(function (error) {
        if (!variantPickerRequestActive(state, requestGeneration, productId))
          return;
        renderVariantPicker(state, {
          status: "error",
          trigger: button,
          productId: productId,
          message: (error && error.message) || "Unable to load variants.",
          initialFocus: true,
        });
      });
  }

  function loadSnapshotPage(state, signal) {
    var start = (state.pageNum - 1) * state.perPage;
    var ids = state.matchedIds.slice(start, start + state.perPage);
    state.hasNext = state.matchedIds.length > state.pageNum * state.perPage;
    return fetchCards(state, ids, signal)
      .then(function () {
        var nodes = [];
        for (var i = 0; i < ids.length; i++) {
          if (state.cardCache[ids[i]]) nodes.push(state.cardCache[ids[i]]);
        }
        syncCurrency(state, nodes);
        return renderPage(state, nodes);
      })
      .then(function () {
        prefetchNext(state);
      });
  }

  function prefetchNext(state) {
    if (state.mode !== "snapshot" || !state.hasNext) return;
    var start = state.pageNum * state.perPage;
    var ids = state.matchedIds.slice(start, start + state.perPage);
    fetchCards(state, ids).catch(function () {});
  }

  function syncGridLayoutClass(state) {
    var grid = state.root.querySelector("[data-aco-pf-grid]");
    if (!grid) return;
    var layout = state.productCard.cardLayout || "classic";
    if (layout !== "classic" && layout !== "split") layout = "classic";
    var parts = String(grid.className || "")
      .split(/\s+/)
      .filter(function (c) {
        return c && c.indexOf("aco-pf-grid--layout-") !== 0;
      });
    parts.push("aco-pf-grid--layout-" + layout);
    grid.className = parts.join(" ");
  }

  // Custom filters can be limited to specific variants. When such a selection
  // is active, cards show the picked variant (image, price, link, cart id)
  // instead of the product defaults. Without one this renders synchronously.
  function renderPage(state, nodes) {
    state.lastPageNodes = nodes;
    var plan = [];
    var need = [];
    for (var i = 0; i < nodes.length; i++) {
      var allowed = customVariantRestriction(state, bareId(nodes[i].id));
      plan.push(allowed);
      if (!allowed) continue;
      for (var j = 0; j < allowed.length; j++) {
        var gid = "gid://shopify/ProductVariant/" + allowed[j];
        if (!state.customVariantCache[gid]) need.push(gid);
      }
    }
    if (!plan.some(Boolean)) return renderPageNow(state, nodes);

    var token = (state.variantRenderToken = (state.variantRenderToken || 0) + 1);
    return fetchCustomVariants(state, need)
      .then(
        function () {
          return nodes.map(function (n, k) {
            return plan[k] ? withPickedVariants(state, n, plan[k]) : n;
          });
        },
        function (e) {
          console.warn("[aco-pf] could not load custom filter variants", e);
          return nodes;
        },
      )
      .then(function (shown) {
        // A newer render started while variants were loading; let it win.
        if (token !== state.variantRenderToken) return;
        return renderPageNow(state, shown);
      });
  }

  function fetchCustomVariants(state, gids) {
    var unique = gids.filter(function (g, i) {
      return gids.indexOf(g) === i;
    });
    var batches = [];
    for (var i = 0; i < unique.length; i += 250) {
      batches.push(unique.slice(i, i + 250));
    }
    return Promise.all(
      batches.map(function (ids) {
        return fetch(
          "https://" + state.shop + "/api/" + state.version + "/graphql.json",
          {
            method: "POST",
            headers: {
              "Content-Type": "application/json",
              "X-Shopify-Storefront-Access-Token": state.token,
            },
            body: JSON.stringify({
              query:
                "query PFCustomVariants($ids:[ID!]!){ nodes(ids:$ids){ ... on ProductVariant {" +
                " id availableForSale price{amount currencyCode} compareAtPrice{amount currencyCode}" +
                " image{url altText} } } }",
              variables: { ids: ids },
            }),
          },
        )
          .then(function (r) {
            return r.json();
          })
          .then(function (json) {
            if (json.errors)
              throw new Error(json.errors[0] && json.errors[0].message);
            var found = (json.data && json.data.nodes) || [];
            for (var j = 0; j < found.length; j++) {
              if (found[j] && found[j].id)
                state.customVariantCache[found[j].id] = found[j];
            }
          });
      }),
    );
  }

  // Copy of a card node narrowed to the picked variants (never mutates the
  // shared card cache). Variants that no longer exist are skipped; if none
  // remain the product renders as usual.
  function withPickedVariants(state, n, allowed) {
    var vs = [];
    for (var i = 0; i < allowed.length; i++) {
      var v = state.customVariantCache["gid://shopify/ProductVariant/" + allowed[i]];
      if (v) vs.push(v);
    }
    if (!vs.length) return n;
    var primary = vs[0];
    for (var k = 0; k < vs.length; k++) {
      if (vs[k].availableForSale) {
        primary = vs[k];
        break;
      }
    }
    var out = {};
    for (var key in n) {
      if (Object.prototype.hasOwnProperty.call(n, key)) out[key] = n[key];
    }
    out.variants = { nodes: vs };
    out.availableForSale = vs.some(function (x) {
      return x.availableForSale;
    });
    out.priceRange = { minVariantPrice: primary.price };
    out.compareAtPriceRange = {
      minVariantPrice: primary.compareAtPrice || null,
    };
    if (primary.image && primary.image.url) {
      out.featuredImage = primary.image;
      if (n.images && n.images.nodes) {
        out.images = {
          nodes: [primary.image].concat(
            n.images.nodes.filter(function (img) {
              return img.url !== primary.image.url;
            }),
          ),
        };
      }
    }
    out.pfVariantId = bareId(primary.id);
    return out;
  }

  // Product link; opens the picked variant when the card was narrowed to one.
  function productUrl(n) {
    return (
      "/products/" + n.handle + (n.pfVariantId ? "?variant=" + n.pfVariantId : "")
    );
  }

  function renderPageNow(state, nodes) {
    if (isThemeCardMode(state) && nodes.length) {
      return renderThemePage(state, nodes);
    }
    return renderAcoPage(state, nodes);
  }

  // ---- theme card mode -----------------------------------------------------
  // The merchant's own grid section is mirrored into the theme (see
  // app/models/themeCardMirror.server.ts). Each filtered page asks Shopify to
  // render that mirror for the page's handles and inserts the real cards.

  function parseThemeCards(root) {
    try {
      var raw = root.getAttribute("data-theme-cards");
      if (!raw) return null;
      var parsed = JSON.parse(raw);
      if (!parsed || parsed.version !== 1) return null;
      return parsed;
    } catch (e) {
      return null;
    }
  }

  // Which mirror entry serves this page: the search mirror on search pages
  // (falling back to the collection mirror), the collection mirror elsewhere.
  // Null when the server reported the section as unsupported.
  function themeContext(state) {
    var tc = state.themeCards || {};
    if (state.context === "search" && tc.search && tc.search.ok) return "search";
    if (tc.collection && tc.collection.ok) return "collection";
    return null;
  }

  function isThemeCardMode(state) {
    return (
      state.productCard.cardSource === "theme" &&
      !state.themeCardsDisabled &&
      themeContext(state) !== null
    );
  }

  // The native grid stays in the server HTML (no-JS visitors and crawlers
  // still get product links); JS parks it as soon as the app takes over.
  // Known (Dawn) ids first, then the merchant's selectors; when neither
  // matches, everything after our block in the section is the theme's filters
  // and grid — except the page's search box / heading, which the walk keeps
  // by descending into any wrapper that holds one.
  var NATIVE_KEEP = 'input[name="q"], h1';
  // What makes a wrapper worth descending into: the native grid or facets.
  var NATIVE_GRID = 'a[href*="/products/"], [name^="filter."]';
  // Default keep set plus the merchant's "elements to keep"; an invalid
  // merchant selector falls back to the default rather than throwing.
  function keepSelector(state, section) {
    var custom = state.root.getAttribute("data-keep-selectors");
    if (!custom) return NATIVE_KEEP;
    var valid = [];
    custom.split(",").forEach(function (part) {
      part = part.trim();
      if (!part) return;
      try {
        section.querySelector(part);
        valid.push(part);
      } catch (e) {
        /* invalid merchant selector part — skip just that part */
      }
    });
    return valid.length ? NATIVE_KEEP + ", " + valid.join(", ") : NATIVE_KEEP;
  }
  function hideNativeThemeGrid(state) {
    // The theme's results are deliberately on show (see nativeResultsFallback).
    if (state.nativeShown) return;
    var section = state.root.closest(".shopify-section") || document;
    var keep = keepSelector(state, section);
    // Themes built on web components render their search box / heading after
    // our init, so the walk runs again once the page has loaded; each pass
    // starts from a clean slate.
    section.querySelectorAll("[data-aco-pf-hidden-theme-grid]").forEach(function (el) {
      el.removeAttribute("data-aco-pf-hidden-theme-grid");
    });
    if (!state.nativeHideRescheduled) {
      state.nativeHideRescheduled = true;
      var again = function () {
        hideNativeThemeGrid(state);
      };
      if (document.readyState !== "complete")
        window.addEventListener("load", again, { once: true });
      setTimeout(again, 1500);
    }
    var marked = 0;
    var mark = function (el) {
      if (state.root.contains(el) || el.contains(state.root)) return;
      el.setAttribute("data-aco-pf-hidden-theme-grid", "");
      marked++;
    };
    var selectors =
      "#ProductGridContainer, #product-grid, .product-grid-container, .product-grid";
    var custom = state.root.getAttribute("data-hide-selectors");
    if (custom) {
      try {
        section.querySelectorAll(custom).forEach(mark);
      } catch (e) {
        /* invalid merchant selector — ignore */
      }
    }
    section.querySelectorAll(selectors).forEach(mark);
    if (marked) return;
    var prune = function (el, depth) {
      if (el.contains(state.root) || el.matches(keep)) return;
      if (depth > 8 || !el.querySelector(keep)) {
        mark(el);
        return;
      }
      // Holds the search box / heading but none of the grid: keep it whole so
      // its own placeholder, icon and labels stay.
      if (!el.querySelector(NATIVE_GRID)) return;
      for (var c = el.firstElementChild; c; c = c.nextElementSibling)
        prune(c, depth + 1);
    };
    for (var el = state.root.nextElementSibling; el; el = el.nextElementSibling)
      prune(el, 0);
  }

  function themeStorageKey(ctx) {
    var themeId = "0";
    try {
      if (window.Shopify && window.Shopify.theme && window.Shopify.theme.id)
        themeId = String(window.Shopify.theme.id);
    } catch (e) {}
    return "aco_pf_theme_sid:" + themeId + ":" + ctx;
  }

  function sectionIdFromHtml(html, ctx) {
    var re = new RegExp(
      'id=["\']shopify-section-((?:template--\\d+__aco-pf-' +
        ctx +
        ")|aco-pf-theme-cards-" +
        ctx +
        ")[\"']",
    );
    var m = re.exec(String(html || ""));
    return m ? m[1] : "";
  }

  // Resolves the mirror section id for the current context: metafield value,
  // then sessionStorage, then a one-off discovery fetch of the alternate
  // search template (needed on password-protected/preview storefronts where
  // the server could not discover it).
  function ensureThemeSectionId(state) {
    var ctx = themeContext(state);
    if (state.themeSectionIds[ctx]) return Promise.resolve(state.themeSectionIds[ctx]);
    var entry = state.themeCards && state.themeCards[ctx];
    if (entry && entry.ok && entry.sectionId) {
      state.themeSectionIds[ctx] = entry.sectionId;
      return Promise.resolve(entry.sectionId);
    }
    var key = themeStorageKey(ctx);
    try {
      var stored = sessionStorage.getItem(key);
      if (stored) {
        state.themeSectionIds[ctx] = stored;
        return Promise.resolve(stored);
      }
    } catch (e) {}
    return fetch(cartPath("search") + "?view=" + THEME_CARD_VIEW + "&q=aco-pf-probe", {
      headers: { accept: "text/html" },
    })
      .then(function (r) {
        return r.status === 200 ? r.text() : "";
      })
      .then(function (html) {
        var id = sectionIdFromHtml(html, ctx);
        if (id) {
          state.themeSectionIds[ctx] = id;
          try {
            sessionStorage.setItem(key, id);
          } catch (e) {}
        }
        return id;
      });
  }

  function themeCardUrl(handles, sid) {
    return (
      cartPath("search") +
      "?view=" +
      THEME_CARD_VIEW +
      "&type=product&q=" +
      encodeURIComponent(handles.join(" ")) +
      "&section_id=" +
      encodeURIComponent(sid)
    );
  }

  function collectComments(node, out) {
    var kids = node.childNodes || [];
    for (var i = 0; i < kids.length; i++) {
      var k = kids[i];
      if (k.nodeType === 8) out.push(k);
      else if (k.nodeType === 1) collectComments(k, out);
    }
    return out;
  }

  function nodeHtml(n) {
    if (n.nodeType === 1) return n.outerHTML;
    if (n.nodeType === 3) return n.textContent;
    return "";
  }

  // Parses one mirror response into { cards: {handle: html}, section, container }.
  function parseThemeCardsHtml(html) {
    var doc = new DOMParser().parseFromString(String(html || ""), "text/html");
    var comments = collectComments(doc, []);
    var cards = {};
    var count = 0;
    var container = null;
    var liquidError = false;
    for (var i = 0; i < comments.length; i++) {
      var c = comments[i];
      var text = String(c.textContent || "");
      if (text.indexOf("aco-pf-card:") !== 0) continue;
      var handle = text.slice("aco-pf-card:".length).replace(/-->$/, "").trim();
      var parts = [];
      var n = c.nextSibling;
      while (n) {
        if (n.nodeType === 8 && String(n.textContent).indexOf("/aco-pf-card") === 0) break;
        parts.push(nodeHtml(n));
        n = n.nextSibling;
      }
      var fragment = parts.join("");
      if (/Liquid error/.test(fragment)) liquidError = true;
      if (!container) container = c.parentNode;
      cards[handle] = fragment;
      count++;
    }
    // Ancestors between the section root and the card container, outermost
    // first. Themes hang grid gap/column CSS variables on these (Horizon's
    // results-list > collection-wrapper > #ResultsList > div[style]), so the
    // cards need the same chain around them when re-inserted.
    var section = null;
    var wrappers = [];
    if (container) {
      var p = container.parentNode;
      while (p && p.nodeType === 1) {
        if (p.classList && p.classList.contains("shopify-section")) {
          section = p;
          break;
        }
        wrappers.unshift(p);
        p = p.parentNode;
      }
      if (!section) wrappers = [];
    }
    var assets = [];
    var scope = section || doc;
    scope.querySelectorAll("link[rel=stylesheet], style").forEach(function (el) {
      if (container && container.contains(el)) return;
      assets.push(el);
    });
    return {
      cards: cards,
      count: count,
      container: container,
      section: section,
      wrappers: wrappers,
      assets: assets,
      liquidError: liquidError,
    };
  }

  function fetchThemeCards(state, handles, sid, signal) {
    var need = [];
    for (var i = 0; i < handles.length; i++) {
      if (!state.themeCardCache[handles[i]]) need.push(handles[i]);
    }
    var chunks = [];
    for (var j = 0; j < need.length; j += THEME_CARD_CHUNK) {
      chunks.push(need.slice(j, j + THEME_CARD_CHUNK));
    }
    return Promise.all(
      chunks.map(function (chunk) {
        var opts = { headers: { accept: "text/html" } };
        if (signal) opts.signal = signal;
        return fetch(themeCardUrl(chunk, sid), opts).then(function (r) {
          if (r.status !== 200) return { failed: true, reason: "HTTP " + r.status };
          return r.text().then(function (html) {
            var parsed = parseThemeCardsHtml(html);
            if (parsed.liquidError) return { failed: true, reason: "Liquid error inside a card" };
            if (!parsed.count) return { failed: true, reason: "no card markers in the response" };
            return parsed;
          });
        });
      }),
    ).then(function (results) {
      var failed = false;
      var reason = "";
      for (var k = 0; k < results.length; k++) {
        var res = results[k];
        if (res.failed) {
          failed = true;
          reason = reason || res.reason;
          continue;
        }
        for (var h in res.cards) {
          if (Object.prototype.hasOwnProperty.call(res.cards, h))
            state.themeCardCache[h] = res.cards[h];
        }
        if (!state.themeCardShell && res.container) {
          state.themeCardShell = {
            section: res.section ? res.section.cloneNode(false) : null,
            wrappers: (res.wrappers || []).map(function (el) {
              return el.cloneNode(false);
            }),
            container: res.container.cloneNode(false),
            assets: res.assets.map(function (el) {
              return el.cloneNode(true);
            }),
          };
        }
      }
      return { failed: failed, reason: reason };
    });
  }

  function clearThemeGrid(state) {
    var wrapper = state.root.querySelector("[data-aco-pf-theme-grid]");
    if (wrapper && wrapper.parentNode) wrapper.parentNode.removeChild(wrapper);
    var grid = state.root.querySelector("[data-aco-pf-grid]");
    if (grid) grid.removeAttribute("hidden");
  }

  function stripDuplicateIds(el) {
    var all = [el].concat(Array.prototype.slice.call(el.querySelectorAll("[id]")));
    for (var i = 0; i < all.length; i++) {
      var id = all[i].getAttribute && all[i].getAttribute("id");
      if (id && document.getElementById(id)) all[i].removeAttribute("id");
    }
  }

  function ensureThemeAssets(state, wrapper) {
    var shell = state.themeCardShell;
    if (!shell || !shell.assets) return;
    for (var i = 0; i < shell.assets.length; i++) {
      var el = shell.assets[i];
      if (el.tagName === "LINK") {
        var href = el.getAttribute("href");
        if (!href || document.querySelector('link[href="' + href + '"]')) continue;
        document.head.appendChild(el.cloneNode(true));
      } else {
        // Section-scoped <style> rides along with the cards each render.
        wrapper.appendChild(el.cloneNode(true));
      }
    }
  }

  // innerHTML never runs scripts: re-create them so theme components (e.g.
  // Dawn's quick-add) load. External scripts already on the page are skipped.
  function activateScripts(wrapper) {
    var scripts = Array.prototype.slice.call(wrapper.querySelectorAll("script"));
    for (var i = 0; i < scripts.length; i++) {
      var inert = scripts[i];
      var src = inert.getAttribute("src");
      if (src) {
        if (!document.querySelector('script[src="' + src + '"]')) {
          var s = document.createElement("script");
          for (var a = 0; a < inert.attributes.length; a++) {
            s.setAttribute(inert.attributes[a].name, inert.attributes[a].value);
          }
          document.body.appendChild(s);
        }
      } else if (!inert.type || /javascript|module/.test(inert.type)) {
        var inl = document.createElement("script");
        if (inert.type) inl.type = inert.type;
        inl.textContent = inert.textContent;
        document.body.appendChild(inl);
      } else {
        continue; // JSON / template scripts stay in place
      }
      if (inert.parentNode) inert.parentNode.removeChild(inert);
    }
  }

  function insertThemeCards(state, handles, sid) {
    var grid = state.root.querySelector("[data-aco-pf-grid]");
    var shell = state.themeCardShell;
    if (!grid || !shell) return 0;
    clearThemeGrid(state);
    var wrapper = document.createElement("div");
    wrapper.setAttribute("data-aco-pf-theme-grid", "");
    var container = shell.container.cloneNode(false);
    // The column switcher / merchant column setting applies to this container
    // through the CSS vars (see [data-aco-pf-cards] in pf-filters.css).
    container.setAttribute("data-aco-pf-cards", "");
    applyColumnVars(state, container);
    var section = shell.section ? shell.section.cloneNode(false) : null;
    var shown = 0;
    for (var i = 0; i < handles.length; i++) {
      var html = state.themeCardCache[handles[i]];
      if (!html) continue;
      container.insertAdjacentHTML("beforeend", html);
      shown++;
    }
    // Rebuild section > wrappers… > container so theme CSS scoped to that
    // chain (gap, columns, container queries) applies to the inserted cards.
    var outer = section || wrapper;
    var parent = outer;
    var chain = shell.wrappers || [];
    for (var w = 0; w < chain.length; w++) {
      var level = chain[w].cloneNode(false);
      // Theme layout wrappers (e.g. the "products" column beside the theme's
      // own sidebar) are forced full-width by CSS; see [data-aco-pf-wrap].
      level.setAttribute("data-aco-pf-wrap", "");
      parent.appendChild(level);
      parent = level;
    }
    parent.appendChild(container);
    if (section) wrapper.appendChild(section);
    stripDuplicateIds(wrapper);
    ensureThemeAssets(state, wrapper);
    activateScripts(wrapper);
    clearGridSkeletons(grid);
    grid.innerHTML = "";
    grid.style.display = "";
    grid.setAttribute("hidden", "");
    grid.parentNode.insertBefore(wrapper, grid.nextSibling);
    try {
      wrapper.dispatchEvent(
        new CustomEvent("shopify:section:load", {
          bubbles: true,
          detail: { sectionId: sid },
        }),
      );
      state.root.dispatchEvent(
        new CustomEvent("aco-pf:theme-cards", {
          bubbles: true,
          detail: { handles: handles, sectionId: sid },
        }),
      );
    } catch (e) {}
    return shown;
  }

  function themeCardsFailed(state, nodes, reason) {
    state.themeCardFailures++;
    try {
      console.warn("[aco-pf] theme cards failed: " + (reason || "unknown") + " (using ACO cards for this page)");
    } catch (e) {}
    if (state.themeCardFailures >= 2 && !state.themeCardsDisabled) {
      state.themeCardsDisabled = true;
      try {
        console.warn("[aco-pf] theme cards unavailable, using ACO cards");
      } catch (e) {}
    }
    clearThemeGrid(state);
    return renderAcoPage(state, nodes);
  }

  function renderThemePage(state, nodes) {
    var handles = [];
    for (var i = 0; i < nodes.length; i++) {
      if (nodes[i] && nodes[i].handle) handles.push(nodes[i].handle);
    }
    if (!handles.length) return renderAcoPage(state, nodes);
    var token = (state.themeRenderToken = (state.themeRenderToken || 0) + 1);
    var signal = state.aborter ? state.aborter.signal : null;
    state.themeCardsPending = true;
    return ensureThemeSectionId(state)
      .then(function (sid) {
        if (!sid) return { failed: true, reason: "mirror section id not found (is the mirror in this theme? click Regenerate)" };
        return fetchThemeCards(state, handles, sid, signal).then(function (res) {
          res.sid = sid;
          return res;
        });
      })
      .then(
        function (res) {
          if (token !== state.themeRenderToken) return;
          if (res.failed) return themeCardsFailed(state, nodes, res.reason);
          state.themeCardFailures = 0;
          closeVariantPickerForRerender(state);
          state.shownCount = insertThemeCards(state, handles, res.sid);
          updateCount(state, state.shownCount);
          updatePager(state);
          scrollToResults(state);
          announce(state);
        },
        function (err) {
          if (err && err.name === "AbortError") throw err;
          if (token !== state.themeRenderToken) return;
          return themeCardsFailed(state, nodes, err && err.message);
        },
      )
      .finally(function () {
        state.themeCardsPending = false;
      });
  }

  function renderAcoPage(state, nodes) {
    closeVariantPickerForRerender(state);
    clearThemeGrid(state);
    var grid = state.root.querySelector("[data-aco-pf-grid]");
    if (grid) {
      // Stop hover timers on the outgoing cards before their nodes are dropped.
      grid.querySelectorAll("[data-aco-pf-gallery]").forEach(stopGallery);
      syncGridLayoutClass(state);
      grid.innerHTML = nodes.length
        ? nodes.map(cardHtml.bind(null, state)).join("")
        : '<li class="aco-pf-grid__empty"><p>No products match the selected filters.</p></li>';
      clearGridSkeletons(grid);
      state.shownCount = nodes.length;
    } else {
      state.shownCount = nodes.length;
    }
    updateCount(state, state.shownCount);
    updatePager(state);
    scrollToResults(state);
    announce(state);
    return Promise.resolve();
  }

  function hasPrevPage(state) {
    return state.mode === "server"
      ? state.prevStack.length > 0
      : state.pageNum > 1;
  }

  function fetchProducts(state, first, after, signal) {
    // sortKey is nullable in the schema, so "default" (null) simply asks for
    // the API's natural order Ã¢â‚¬â€ no separate query string needed.
    var def = sortDef(state.sort);
    var imagesFrag = state.productCard.imageSlideshow
      ? " images(first:10){nodes{url altText}}"
      : "";
    var layout = state.productCard.cardLayout || "classic";
    var extrasFrag =
      layout === "classic" ? "" : " productType";
    var body = {
      query:
        "query PF($first:Int!,$after:String,$query:String,$sortKey:ProductSortKeys,$reverse:Boolean){" +
        " products(first:$first, after:$after, query:$query, sortKey:$sortKey, reverse:$reverse){" +
        " pageInfo{hasNextPage endCursor}" +
        " nodes{ id title handle vendor availableForSale featuredImage{url altText}" +
        imagesFrag +
        extrasFrag +
        " variants(first:2){nodes{id availableForSale price{amount currencyCode} compareAtPrice{amount currencyCode}}}" +
        " collections(first:20){nodes{handle}}" +
        " compareAtPriceRange{minVariantPrice{amount currencyCode}}" +
        " priceRange{minVariantPrice{amount currencyCode}} options{name values} } } }",
      variables: {
        first: first,
        after: after,
        query: state.query || "",
        sortKey: def.key,
        reverse: def.reverse,
      },
    };
    return fetch(
      "https://" + state.shop + "/api/" + state.version + "/graphql.json",
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "X-Shopify-Storefront-Access-Token": state.token,
        },
        body: JSON.stringify(body),
        signal: signal,
      },
    )
      .then(function (r) {
        return r.json();
      })
      .then(function (json) {
        if (json.errors)
          throw new Error(json.errors[0] && json.errors[0].message);
        var conn = json.data && json.data.products;
        if (!conn) throw new Error("Empty response");
        return conn;
      });
  }

  function updateCount(state, shown) {
    var count = state.root.querySelector("[data-aco-pf-count]");
    if (!count) return;
    // Snapshot mode knows the full matched set, so show the true total.
    count.textContent =
      state.mode === "snapshot"
        ? state.matchedIds.length + " products"
        : shown + " products on this page";
  }

  function scrollToResults(state) {
    if (state.behavior && state.behavior.scrollTop === false) return;
    var results = state.root.querySelector("[data-aco-pf-results]");
    if (!results || !results.getBoundingClientRect) return;
    var rect = results.getBoundingClientRect();
    var viewH = window.innerHeight || document.documentElement.clientHeight;
    // The grid is already on screen. Moving the page would slide the
    // collection title ("Products") away from the filters.
    if (rect.top >= 0 && rect.top < viewH) return;
    var section = state.root.closest(".shopify-section");
    var prev = section && section.previousElementSibling;
    var target =
      rect.top < 0 &&
      prev &&
      prev.classList &&
      prev.classList.contains("shopify-section")
        ? prev
        : results;
    if (target.scrollIntoView) {
      target.scrollIntoView({ behavior: "smooth", block: "nearest" });
    }
  }

  function showError(state, message) {
    clearThemeGrid(state);
    var grid = state.root.querySelector("[data-aco-pf-grid]");
    if (grid) {
      grid.innerHTML =
        '<li class="aco-pf-grid__empty"><p>' +
        escapeHtml(message) +
        "</p></li>";
    }
  }

  // ---- quick-buy (Add to cart / Buy it now) --------------------------------
  // Add to cart runs against the theme's own Ajax Cart API on the storefront
  // origin. Buy it now creates a separate Storefront cart, so checkout contains
  // only the selected variant and quantity and the existing cart is untouched.

  // Storefront root path, honouring locale/market sub-paths (e.g. "/en-gb/").
  function shopRoot() {
    try {
      var root =
        window.Shopify && window.Shopify.routes && window.Shopify.routes.root;
      return root || "/";
    } catch (e) {
      return "/";
    }
  }

  function cartPath(p) {
    var root = shopRoot();
    if (root.charAt(root.length - 1) !== "/") root += "/";
    return root + String(p).replace(/^\//, "");
  }

  function btnLabel(state, btn) {
    if (btn.hasAttribute("data-aco-pf-choose-variant"))
      return state.productCard.chooseVariantText || "Choose variant";
    return btn.hasAttribute("data-aco-pf-atc")
      ? state.productCard.addToCartText || "Add to cart"
      : state.productCard.buyNowText || "Buy it now";
  }

  function setBtnBusy(btn, busy, text) {
    btn.disabled = busy;
    btn.classList.toggle("aco-pf-card__btn--busy", busy);
    if (text != null) btn.textContent = text;
  }

  // Show a transient label (e.g. "Added Ã¢Å“â€œ" / "Try again"), then restore the
  // button's configured text.
  function flashBtn(state, btn, text) {
    setBtnBusy(btn, false, text);
    btn.classList.add("aco-pf-card__btn--flash");
    clearTimeout(btn.__pfFlash);
    btn.__pfFlash = setTimeout(function () {
      btn.classList.remove("aco-pf-card__btn--flash");
      btn.textContent = btnLabel(state, btn);
    }, 1600);
  }

  function refreshThemeCartCount(cartData) {
    var count = Number(cartData && cartData.item_count);
    if (!Number.isFinite(count)) return;
    var labels = document.querySelectorAll(
      ".cart-count-bubble [aria-hidden='true'], [data-cart-count]",
    );
    for (var i = 0; i < labels.length; i++) {
      labels[i].textContent = String(count);
    }
    var cartLinks = document.querySelectorAll("#cart-icon-bubble");
    for (var j = 0; j < cartLinks.length; j++) {
      var bubble = cartLinks[j].querySelector(".cart-count-bubble");
      if (count === 0) {
        if (bubble) bubble.hidden = true;
        continue;
      }
      if (!bubble) {
        bubble = document.createElement("div");
        bubble.className = "cart-count-bubble";
        var visibleCount = document.createElement("span");
        visibleCount.setAttribute("aria-hidden", "true");
        var accessibleCount = document.createElement("span");
        accessibleCount.className = "visually-hidden";
        bubble.appendChild(visibleCount);
        bubble.appendChild(accessibleCount);
        cartLinks[j].appendChild(bubble);
      }
      bubble.hidden = false;
      var bubbleLabels = bubble.querySelectorAll(
        "[aria-hidden='true'], .visually-hidden",
      );
      for (var k = 0; k < bubbleLabels.length; k++) {
        bubbleLabels[k].textContent =
          k === 0
            ? String(count)
            : String(count) + (count === 1 ? " item" : " items");
      }
    }
  }

  // Best-effort refresh so a theme's cart count re-reads the cart immediately.
  // Themes do not share one cart event contract, so keep the compatibility
  // events and also publish the actual Ajax cart payload for integrations.
  function notifyThemeCartUpdated() {
    try {
      document.dispatchEvent(
        new CustomEvent("pf:cart:added", { bubbles: true }),
      );
      document.dispatchEvent(
        new CustomEvent("cart:refresh", { bubbles: true }),
      );
      document.dispatchEvent(new CustomEvent("cart:build", { bubbles: true }));
    } catch (e) {}
    return fetch(cartPath("cart.js"), {
      headers: { Accept: "application/json" },
    })
      .then(function (response) {
        if (!response.ok) throw new Error("Cart refresh failed");
        return response.json();
      })
      .then(function (cartData) {
        refreshThemeCartCount(cartData);
        try {
          document.dispatchEvent(
            new CustomEvent("pf:cart:updated", {
              bubbles: true,
              detail: { cartData: cartData },
            }),
          );
          document.dispatchEvent(
            new CustomEvent("cart:updated", {
              bubbles: true,
              detail: cartData,
            }),
          );
        } catch (e) {}
        return cartData;
      })
      .catch(function () {
        // The item was already added successfully; a refresh failure must not
        // change the button's success state or cause a second cart request.
        return null;
      });
  }

  function cartAdd(state, variantId, quantity) {
    return fetch(cartPath("cart/add.js"), {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Accept: "application/json",
      },
      body: JSON.stringify({
        items: [{ id: Number(variantId), quantity: quantity }],
      }),
    }).then(function (r) {
      if (r.ok) return r.json();
      return r.json().then(
        function (j) {
          throw new Error(
            (j && (j.description || j.message)) || "Add to cart failed",
          );
        },
        function () {
          throw new Error("Add to cart failed");
        },
      );
    });
  }

  // Buy it now must not mutate the shopper's existing Ajax cart. Creating a
  // Storefront cart gives checkout an isolated line item and leaves the cart
  // they were browsing intact.
  function createCheckoutCart(state, variantId, quantity) {
    var body = {
      query:
        "mutation PFBuynow($input:CartInput!){" +
        " cartCreate(input:$input){" +
        " cart{checkoutUrl}" +
        " userErrors{field message}" +
        " }" +
        "}",
      variables: {
        input: {
          lines: [
            {
              merchandiseId:
                "gid://shopify/ProductVariant/" + bareId(variantId),
              quantity: quantity,
            },
          ],
        },
      },
    };
    return fetch(
      "https://" + state.shop + "/api/" + state.version + "/graphql.json",
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "X-Shopify-Storefront-Access-Token": state.token,
        },
        body: JSON.stringify(body),
      },
    )
      .then(function (r) {
        return r.json().then(function (json) {
          if (!r.ok || json.errors) {
            throw new Error(
              (json.errors && json.errors[0] && json.errors[0].message) ||
                "Unable to start checkout",
            );
          }
          return json;
        });
      })
      .then(function (json) {
        var result = json.data && json.data.cartCreate;
        var userErrors = (result && result.userErrors) || [];
        if (userErrors.length) {
          throw new Error(
            userErrors
              .map(function (item) {
                return item.message;
              })
              .filter(Boolean)
              .join("; ") || "Unable to start checkout",
          );
        }
        var checkoutUrl = result && result.cart && result.cart.checkoutUrl;
        if (!checkoutUrl) throw new Error("Unable to start checkout");
        return checkoutUrl;
      });
  }

  function addToCart(state, btn) {
    var vid = btn.getAttribute("data-aco-pf-variant");
    var url = btn.getAttribute("data-aco-pf-url") || "/";
    // No purchasable variant / "choose options" mode: open the product page.
    if (!vid) {
      window.location.href = url;
      return;
    }
    if (btn.disabled) return;
    setBtnBusy(btn, true, "Adding...");
    cartAdd(state, vid, 1)
      .then(function () {
        phCapture(state, "storefront_add_to_cart", {
          context: state.context,
          variant_id: vid,
          product_url: url,
        });
        notifyThemeCartUpdated();
        if (state.productCard.afterAddToCart === "cart") {
          window.location.href = cartPath("cart");
          return;
        }
        flashBtn(state, btn, "Added");
      })
      .catch(function (err) {
        console.warn("[aco-pf] add to cart failed:", err && err.message);
        flashBtn(state, btn, "Try again");
      });
  }

  function buyNow(state, btn) {
    var vid = btn.getAttribute("data-aco-pf-variant");
    var url = btn.getAttribute("data-aco-pf-url") || "/";
    if (!vid) {
      window.location.href = url;
      return;
    }
    if (btn.disabled) return;
    setBtnBusy(btn, true, "...");
    createCheckoutCart(state, vid, 1)
      .then(function (checkoutUrl) {
        phCapture(state, "storefront_buy_now", {
          context: state.context,
          variant_id: vid,
        });
        window.location.href = checkoutUrl;
      })
      .catch(function (err) {
        console.warn("[aco-pf] buy now failed:", err && err.message);
        flashBtn(state, btn, "Try again");
      });
  }

  // ---- rendering -----------------------------------------------------------

  // Snapshot/grid nodes carry full variant GIDs; the cart Ajax API and buy-now
  // permalink both take the bare numeric id. Returns "" when there's nothing
  // purchasable (so the buttons fall back to opening the product page).
  function firstVariant(n) {
    var vs = (n.variants && n.variants.nodes) || [];
    if (!vs.length) return null;
    for (var i = 0; i < vs.length; i++) {
      if (vs[i].availableForSale) return vs[i];
    }
    return vs[0];
  }

  // Which variant id the quick-buy buttons submit for this product. Empty means
  // "open the product page" Ã¢â‚¬â€ either nothing purchasable, or the merchant chose
  // productPage mode for products that have more than one variant.
  function quickBuyVariantId(state, n) {
    var vs = (n.variants && n.variants.nodes) || [];
    if (state.productCard.variantMode === "productPage" && vs.length > 1)
      return "";
    var v = firstVariant(n);
    return v ? bareId(v.id) : "";
  }

  function cardActionsHtml(state, n) {
    var pc = state.productCard;
    if (!pc.showAddToCart && !pc.showBuyNow) return "";
    if (!n.availableForSale) return ""; // sold out Ã¢â‚¬â€ no quick-buy
    var url = productUrl(n);
    var isChooseVariant =
      pc.variantMode === "chooseVariant" &&
      ((n.variants && n.variants.nodes) || []).length > 1;
    if (isChooseVariant) {
      return (
        '<div class="aco-pf-card__actions">' +
        '<button type="button" class="aco-pf-card__btn aco-pf-card__btn--atc" data-aco-pf-choose-variant' +
        ' data-aco-pf-product="' +
        escapeHtml(n.id) +
        '" data-aco-pf-variant="" data-aco-pf-url="' +
        escapeHtml(url) +
        '">' +
        escapeHtml(pc.chooseVariantText || "Choose variant") +
        "</button></div>"
      );
    }
    var vid = quickBuyVariantId(state, n);
    var attrs =
      ' data-aco-pf-variant="' +
      escapeHtml(vid) +
      '" data-aco-pf-url="' +
      escapeHtml(url) +
      '"';
    var btns = "";
    if (pc.showAddToCart) {
      btns +=
        '<button type="button" class="aco-pf-card__btn aco-pf-card__btn--atc" data-aco-pf-atc' +
        attrs +
        ">" +
        escapeHtml(pc.addToCartText || "Add to cart") +
        "</button>";
    }
    if (pc.showBuyNow) {
      btns +=
        '<button type="button" class="aco-pf-card__btn aco-pf-card__btn--buy" data-aco-pf-buynow' +
        attrs +
        ">" +
        escapeHtml(pc.buyNowText || "Buy it now") +
        "</button>";
    }
    return '<div class="aco-pf-card__actions">' + btns + "</div>";
  }

  // Discount badge text for a re-rendered card, mirroring the SSR grid's
  // aco-pf-card__badge in pf-product-grid.liquid: "{label} {percent}%". The label
  // is merchant-entered; the percent is computed and can't be changed.
  function discountBadgeHtml(pc, price, cmp) {
    var pct = Math.round(((cmp - price) / cmp) * 100);
    var label = pc.discountBadgeText || "Save";
    var style = pc.discountBadgeStyle || "solid";
    return (
      '<span class="aco-pf-card__badge aco-pf-card__badge--' +
      escapeHtml(style) +
      '">' +
      escapeHtml(label + " " + pct + "%") +
      "</span>"
    );
  }

  var BADGE_POSITIONS = ["top-left", "top-right", "bottom-left", "bottom-right"];
  var BADGE_SIZES = ["small", "medium", "large"];

  // Sale / Out of stock badge overlaid on the product image at the corner the
  // merchant picked (productCard.badgePosition). Both may be on: a card shows
  // at most one, sold-out products get "Out of stock" (never "Sale"). Mirrors
  // the SSR markup in pf-product-grid.liquid.
  function cardFlagHtml(state, n) {
    var pc = state.productCard;
    var pos =
      BADGE_POSITIONS.indexOf(pc.badgePosition) === -1
        ? "top-left"
        : pc.badgePosition;
    var size =
      BADGE_SIZES.indexOf(pc.badgeSize) === -1 ? "medium" : pc.badgeSize;
    var cls =
      "aco-pf-card__flag aco-pf-card__flag--" +
      pos +
      " aco-pf-card__flag--" +
      size;
    var badge = productBadgeState(n);
    if (pc.showSaleBadge && badge === "sale") {
      return (
        '<span class="' +
        cls +
        ' aco-pf-card__badge aco-pf-card__badge--sale">' +
        escapeHtml(String(pc.saleBadgeText || "Sale").slice(0, 15)) +
        "</span>"
      );
    }
    if (pc.showSoldOutBadge && badge === "out-of-stock") {
      return (
        '<span class="' +
        cls +
        ' aco-pf-card__soldout">' +
        escapeHtml(String(pc.soldOutBadgeText || "Out of stock").slice(0, 15)) +
        "</span>"
      );
    }
    return "";
  }

  function productIsOnSale(n) {
    var price = n && n.priceRange && n.priceRange.minVariantPrice;
    var compareAt =
      n && n.compareAtPriceRange && n.compareAtPriceRange.minVariantPrice;
    var priceAmount = price ? parseFloat(price.amount) : NaN;
    var compareAtAmount = compareAt ? parseFloat(compareAt.amount) : NaN;
    return (
      !isNaN(priceAmount) &&
      !isNaN(compareAtAmount) &&
      compareAtAmount > priceAmount
    );
  }

  function productIsSoldOut(n) {
    return !!n && n.availableForSale === false;
  }

  function productBadgeState(n) {
    if (productIsSoldOut(n)) return "out-of-stock";
    if (productIsOnSale(n)) return "sale";
    return "";
  }

  // Full price line: current price, optional struck compare-at price, optional
  // discount badge. Kept in step with the SSR grid so filtered cards match.
  function cardPriceHtml(state, n) {
    var pc = state.productCard;
    var hasPrice = !!(
      state.showPrice &&
      n.priceRange &&
      n.priceRange.minVariantPrice
    );
    if (!hasPrice) {
      return "";
    }
    var inner = "";
    if (hasPrice) {
      var price = n.priceRange.minVariantPrice;
      inner = formatMoney(price);
      var cmp = n.compareAtPriceRange && n.compareAtPriceRange.minVariantPrice;
      var priceAmt = parseFloat(price.amount);
      var cmpAmt = cmp ? parseFloat(cmp.amount) : NaN;
      if (cmp && !isNaN(cmpAmt) && !isNaN(priceAmt) && cmpAmt > priceAmt) {
        if (pc.showComparePrice !== false) {
          inner += '<s class="aco-pf-card__was">' + formatMoney(cmp) + "</s>";
        }
        if (pc.showDiscountBadge) {
          inner += discountBadgeHtml(pc, priceAmt, cmpAmt);
        }
      }
    }
    return '<span class="aco-pf-card__price">' + inner + "</span>";
  }

  // Cards in the first row load eagerly at high priority: they are the page's
  // LCP candidates, and loading="lazy" holds them back until layout.
  var EAGER_CARD_COUNT = 4;

  // Shopify CDN resize: the Storefront API returns the original upload, which
  // can be thousands of pixels wide for a ~250px card.
  function cdnImageWidth(url, width) {
    var u = String(url || "");
    if (!u) return u;
    return u + (u.indexOf("?") === -1 ? "?" : "&") + "width=" + width;
  }

  // srcset `sizes`, matching pf-product-grid.liquid: one column's share of the
  // viewport, halved in the split layout (image beside the text). Lazy images
  // also get `auto` (only valid on lazy images) so supporting browsers use the
  // laid-out width.
  function cardImgSizes(state, eager) {
    var split = (state.productCard && state.productCard.cardLayout) === "split";
    var cols = state.columns || 3;
    var colsMobile = state.colsMobile || 2;
    var vw = Math.floor(100 / cols);
    var vwMobile = Math.floor(100 / colsMobile);
    if (split) {
      vw = Math.floor(vw / 2);
      vwMobile = Math.floor(vwMobile / 2);
    }
    var sizes = "(min-width: 750px) " + vw + "vw, " + vwMobile + "vw";
    return eager ? sizes : "auto, " + sizes;
  }

  // Image attributes matching the SSR markup (pf-product-grid.liquid). With
  // `deferred`, the URLs go into data-* attributes and hydrateSlide() swaps
  // them in when the slide is first shown, so hidden slides cost nothing.
  function cardImgAttrs(url, eager, deferred, sizes) {
    var src = cdnImageWidth(url, 400);
    var srcset =
      cdnImageWidth(url, 200) +
      " 200w, " +
      src +
      " 400w, " +
      cdnImageWidth(url, 600) +
      " 600w";
    var prefix = deferred ? "data-aco-pf-" : "";
    return (
      " " +
      prefix +
      'src="' +
      escapeHtml(src) +
      '" ' +
      prefix +
      'srcset="' +
      escapeHtml(srcset) +
      '" sizes="' +
      escapeHtml(sizes) +
      '"' +
      (eager ? ' loading="eager" fetchpriority="high"' : ' loading="lazy"')
    );
  }

  // Card media: a multi-image gallery when the slideshow is on and the product
  // has more than one image, otherwise the single featured image. Mirrors the
  // SSR markup in pf-product-grid.liquid so the shared CSS + gallery handlers
  // drive both render paths.
  function cardMediaHtml(state, n, index) {
    var pc = state.productCard;
    var eager = typeof index === "number" && index < EAGER_CARD_COUNT;
    var imgs =
      pc.imageSlideshow && n.images && n.images.nodes ? n.images.nodes : [];
    if (imgs.length > 1) {
      imgs = imgs.slice(0, pc.slideshowMaxImages || 5);
      var mode = pc.slideshowMode || "hover";
      var slides = "";
      for (var i = 0; i < imgs.length; i++) {
        slides +=
          '<img class="aco-pf-card__img aco-pf-card__slide' +
          (i === 0 ? " is-active" : "") +
          '"' +
          cardImgAttrs(
            imgs[i].url,
            eager && i === 0,
            i > 0,
            cardImgSizes(state, eager && i === 0),
          ) +
          ' alt="' +
          escapeHtml(imgs[i].altText || n.title) +
          '">';
      }
      var arrows =
        mode === "arrows"
          ? '<button type="button" class="aco-pf-card__nav aco-pf-card__nav--prev" data-aco-pf-gnav="-1" aria-label="Previous image">&lsaquo;</button>' +
            '<button type="button" class="aco-pf-card__nav aco-pf-card__nav--next" data-aco-pf-gnav="1" aria-label="Next image">&rsaquo;</button>'
          : "";
      var dots = "";
      if (pc.slideshowDots) {
        var d = "";
        for (var j = 0; j < imgs.length; j++) {
          d +=
            '<span class="aco-pf-card__dot' +
            (j === 0 ? " is-active" : "") +
            '"></span>';
        }
        dots =
          '<div class="aco-pf-card__dots" data-aco-pf-dots>' + d + "</div>";
      }
      return (
        '<div class="aco-pf-card__media aco-pf-card__media--gallery" data-aco-pf-gallery data-aco-pf-mode="' +
        escapeHtml(mode) +
        '" data-aco-pf-speed="' +
        escapeHtml(String(pc.slideshowSpeed || 1)) +
        '"><div class="aco-pf-card__slides">' +
        slides +
        "</div>" +
        arrows +
        dots +
        cardFlagHtml(state, n) +
        "</div>"
      );
    }
    var single = n.featuredImage
      ? '<img class="aco-pf-card__img"' +
        cardImgAttrs(
          n.featuredImage.url,
          eager,
          false,
          cardImgSizes(state, eager),
        ) +
        ' alt="' +
        escapeHtml(n.featuredImage.altText || n.title) +
        '">'
      : '<span class="aco-pf-card__img aco-pf-card__img--placeholder"></span>';
    return (
      '<div class="aco-pf-card__media">' +
      single +
      cardFlagHtml(state, n) +
      "</div>"
    );
  }

  // Ã¢â€â‚¬Ã¢â€â‚¬ Gallery slide state (shared by hover + arrow modes) Ã¢â€â‚¬Ã¢â€â‚¬
  function galleryActiveIndex(gallery) {
    var slides = gallery.querySelectorAll(".aco-pf-card__slide");
    for (var i = 0; i < slides.length; i++) {
      if (slides[i].classList.contains("is-active")) return i;
    }
    return 0;
  }
  // Swap a deferred slide's data-aco-pf-src/srcset into place (no-op once done).
  function hydrateSlide(img) {
    if (!img) return;
    var srcset = img.getAttribute("data-aco-pf-srcset");
    var src = img.getAttribute("data-aco-pf-src");
    if (srcset) {
      img.setAttribute("srcset", srcset);
      img.removeAttribute("data-aco-pf-srcset");
    }
    if (src) {
      img.setAttribute("src", src);
      img.removeAttribute("data-aco-pf-src");
    }
  }
  function hydrateGallery(gallery) {
    var slides = gallery.querySelectorAll(".aco-pf-card__slide");
    for (var i = 0; i < slides.length; i++) hydrateSlide(slides[i]);
  }
  function setGallerySlide(gallery, idx) {
    var slides = gallery.querySelectorAll(".aco-pf-card__slide");
    var dots = gallery.querySelectorAll(".aco-pf-card__dot");
    var n = slides.length;
    if (!n) return;
    idx = ((idx % n) + n) % n; // wrap around either end
    hydrateSlide(slides[idx]);
    hydrateSlide(slides[(idx + 1) % n]); // warm the next one
    for (var i = 0; i < n; i++)
      slides[i].classList.toggle("is-active", i === idx);
    for (var j = 0; j < dots.length; j++)
      dots[j].classList.toggle("is-active", j === idx);
  }
  function stopGallery(gallery) {
    if (gallery && gallery.__pfTimer) {
      clearInterval(gallery.__pfTimer);
      gallery.__pfTimer = null;
    }
  }

  // Resolve a colour option value to a CSS colour for card swatches.
  var CARD_SWATCH_COLORS = {
    black: "#111111",
    white: "#ffffff",
    red: "#e11d48",
    blue: "#2563eb",
    navy: "#1e3a8a",
    green: "#16a34a",
    yellow: "#eab308",
    orange: "#f97316",
    pink: "#ec4899",
    purple: "#7c3aed",
    brown: "#92400e",
    grey: "#9ca3af",
    gray: "#9ca3af",
    beige: "#d6c6a8",
    gold: "#ca8a04",
    silver: "#c0c0c0",
  };
  function swatchCssColor(name) {
    var raw = String(name || "").trim();
    if (!raw) return "#c4c4c4";
    if (/^#([0-9a-f]{3}|[0-9a-f]{6})$/i.test(raw)) return raw;
    var key = raw.toLowerCase().replace(/[^a-z0-9]/g, "");
    if (CARD_SWATCH_COLORS[key]) return CARD_SWATCH_COLORS[key];
    // Try last word ("Light Blue" → blue).
    var parts = raw.toLowerCase().split(/[^a-z0-9]+/).filter(Boolean);
    var last = parts[parts.length - 1];
    if (last && CARD_SWATCH_COLORS[last]) return CARD_SWATCH_COLORS[last];
    return "#c4c4c4";
  }

  function findProductOption(n, kind) {
    var options = n.options || [];
    for (var i = 0; i < options.length; i++) {
      var name = String((options[i] && options[i].name) || "").toLowerCase();
      if (kind === "color" && (name.indexOf("color") !== -1 || name.indexOf("colour") !== -1)) {
        return options[i];
      }
    }
    return null;
  }

  function cardSwatchesHtml(n, limit, markFirst) {
    var opt = findProductOption(n, "color");
    if (!opt || !opt.values || !opt.values.length) return "";
    var max = limit || 4;
    var html = '<div class="aco-pf-card__swatches" aria-hidden="true">';
    for (var i = 0; i < opt.values.length && i < max; i++) {
      var active = markFirst && i === 0 ? " is-active" : "";
      html +=
        '<span class="aco-pf-card__swatch' +
        active +
        '" title="' +
        escapeHtml(opt.values[i]) +
        '" style="background:' +
        escapeHtml(swatchCssColor(opt.values[i])) +
        '"></span>';
    }
    if (opt.values.length > max) {
      html +=
        '<span class="aco-pf-card__swatch-more">+' +
        (opt.values.length - max) +
        "</span>";
    }
    html += "</div>";
    return html;
  }

  function cardHtml(state, n, index) {
    var pc = state.productCard;
    var layout = pc.cardLayout || "classic";
    if (layout !== "classic" && layout !== "split") layout = "classic";
    var vendor =
      pc.showVendor && n.vendor
        ? '<span class="aco-pf-card__vendor">' +
          escapeHtml(n.vendor) +
          "</span>"
        : "";
    var price = cardPriceHtml(state, n);
    var media = cardMediaHtml(state, n, index);

    var linkInner =
      media +
      '<div class="aco-pf-card__info">' +
      vendor +
      '<span class="aco-pf-card__title">' +
      escapeHtml(n.title) +
      "</span>" +
      price +
      (layout === "split" ? cardSwatchesHtml(n, 4, false) : "") +
      "</div>";

    return (
      '<li class="aco-pf-card">' +
      '<a class="aco-pf-card__link" data-aco-pf-card data-aco-pf-id="' +
      escapeHtml(n.id) +
      '" data-aco-pf-handle="' +
      escapeHtml(n.handle) +
      '" data-aco-pf-title="' +
      escapeHtml(n.title) +
      '" data-aco-pf-image="' +
      escapeHtml(n.featuredImage ? n.featuredImage.url : "") +
      '" href="' +
      escapeHtml(productUrl(n)) +
      '">' +
      linkInner +
      "</a>" +
      cardActionsHtml(state, n) +
      "</li>"
    );
  }

  function updateActiveChips(state) {
    var wrap = state.root.querySelector("[data-aco-pf-active]");
    var list = state.root.querySelector("[data-aco-pf-active-list]");
    if (!wrap || !list) return;

    var params = formParams(state);
    var chips = [];
    params.forEach(function (value, key) {
      chips.push(chipHtml(state, key, value));
    });

    // group counts on each filter group summary
    state.root.querySelectorAll("[data-aco-pf-group]").forEach(function (g) {
      var checked = g.querySelectorAll(
        "input[data-aco-pf-input]:checked",
      ).length;
      var priceSet =
        g.querySelector('input[name^="pf_price"]') &&
        [].some.call(
          g.querySelectorAll('input[name^="pf_price"]'),
          function (i) {
            return i.value;
          },
        );
      var n = checked + (priceSet ? 1 : 0);
      var badge = g.querySelector("[data-aco-pf-group-active]");
      if (badge) {
        if (n > 0) {
          badge.textContent = n;
          badge.hidden = false;
        } else {
          badge.hidden = true;
        }
      }
    });

    if (chips.length) {
      list.innerHTML = chips.join("");
      wrap.hidden = false;
    } else {
      list.innerHTML = "";
      wrap.hidden = true;
    }

    // Checked-state class on rows (styling hook for swatches/pills without :has).
    state.root.querySelectorAll("label.aco-pf-value").forEach(function (row) {
      var input = row.querySelector("input[data-aco-pf-input]");
      if (input) row.classList.toggle("aco-pf-value--active", !!input.checked);
    });

    // Applied-count badge on the drawer toggle.
    var drawerCount = state.root.querySelector("[data-aco-pf-drawer-count]");
    if (drawerCount) {
      var total = 0;
      params.forEach(function () {
        total++;
      });
      drawerCount.textContent = total;
      drawerCount.hidden = total === 0;
    }
  }

  function chipHtml(state, key, value) {
    var label = chipLabel(state, key, value);
    return (
      '<li class="aco-pf-active__item"><a class="aco-pf-active__chip" href="#" ' +
      'data-aco-pf-remove data-aco-pf-remove-name="' +
      escapeHtml(key) +
      '" data-aco-pf-remove-value="' +
      escapeHtml(value) +
      '"><span class="aco-pf-active__text">' +
      escapeHtml(label) +
      '</span><span class="aco-pf-active__x" aria-hidden="true">&times;</span></a></li>'
    );
  }

  function chipLabel(state, key, value) {
    if (key === "pf_available") return "In stock";
    if (key === "pf_collection") {
      // Show the collection's display label, not its handle.
      var input = state.root.querySelector(
        'input[name="pf_collection"][value="' + cssEscape(value) + '"]',
      );
      var row = input ? input.closest("[data-aco-pf-tree-node]") : null;
      var lab = row ? row.querySelector(".aco-pf-value__label") : null;
      return lab ? lab.textContent.trim() : value;
    }
    if (key === "pf_price_min") return "Min " + value;
    if (key === "pf_price_max") return "Max " + value;
    if (key.indexOf("pf_opt_") === 0)
      return key.slice("pf_opt_".length) + ": " + value;
    if (key.indexOf("pf_custom_") === 0) {
      // Custom option values are slugs Ã¢â‚¬â€ show the merchant's display label.
      var el = state.root.querySelector(
        'input[name="' +
          cssEscape(key) +
          '"][value="' +
          cssEscape(value) +
          '"]',
      );
      var valueRow = el ? el.closest(".aco-pf-value") : null;
      var text = valueRow
        ? valueRow.querySelector(".aco-pf-value__label")
        : null;
      return text ? text.textContent.trim() : value;
    }
    return value;
  }

  // ---- helpers -------------------------------------------------------------

  function pushUrl(state, params, opts) {
    var base = state.baseUrl;
    var carry = new URLSearchParams();
    if (state.context === "search") {
      carry.set("q", state.terms);
      carry.set("type", "product");
    }
    params.forEach(function (v, k) {
      carry.append(k, v);
    });
    var qs = carry.toString();
    var next = base + (qs ? "?" + qs : "");
    var loc = typeof location !== "undefined" ? location : null;
    var current = loc ? (loc.pathname || "") + (loc.search || "") : "";
    if (loc && next === current) return;
    var hist = typeof history !== "undefined" ? history : null;
    if (!hist) return;
    if (opts && opts.replace) {
      if (hist.replaceState) hist.replaceState({ pf: true }, "", next);
    } else if (hist.pushState) {
      hist.pushState({ pf: true }, "", next);
    }
  }

  var PAGINATION_STYLES = [
    "basic",
    "pill",
    "numbered",
    "segmented",
    "text",
    "jump",
  ];

  function paginationStyle(state) {
    var style = state.root.getAttribute("data-pagination-style");
    return PAGINATION_STYLES.indexOf(style) === -1 ? "basic" : style;
  }

  function paginationTotal(state) {
    if (state.mode !== "snapshot" || !state.perPage) return null;
    return Math.max(1, Math.ceil(state.matchedIds.length / state.perPage));
  }

  function paginationTokens(current, total) {
    if (!total) return [current];
    if (total <= 7) {
      var all = [];
      for (var i = 1; i <= total; i++) all.push(i);
      return all;
    }
    var tokens = [1];
    var start = Math.max(2, current - 1);
    var end = Math.min(total - 1, current + 1);
    if (start > 2) tokens.push("ellipsis");
    for (var page = start; page <= end; page++) tokens.push(page);
    if (end < total - 1) tokens.push("ellipsis");
    tokens.push(total);
    return tokens;
  }

  function pagerButton(className, text, action) {
    var button = document.createElement("button");
    button.type = "button";
    button.className = className;
    button.textContent = text;
    if (action) button.setAttribute(action.name, action.value);
    return button;
  }

  function pagerPageButton(page, current) {
    var button = pagerButton("aco-pf-pager__page", String(page), {
      name: "data-aco-pf-page-number",
      value: String(page),
    });
    button.setAttribute("aria-label", "Page " + page);
    if (page === current) {
      button.setAttribute("aria-current", "page");
      button.disabled = true;
    }
    return button;
  }

  function renderPagerPages(pager, state, total) {
    var pages = document.createElement("span");
    pages.className = "aco-pf-pager__pages";
    pages.setAttribute("aria-label", "Pages");
    var tokens = paginationTokens(state.pageNum, total);
    for (var i = 0; i < tokens.length; i++) {
      if (tokens[i] === "ellipsis") {
        var ellipsis = document.createElement("span");
        ellipsis.className = "aco-pf-pager__ellipsis";
        ellipsis.textContent = "...";
        ellipsis.setAttribute("aria-hidden", "true");
        pages.appendChild(ellipsis);
      } else {
        pages.appendChild(pagerPageButton(tokens[i], state.pageNum));
      }
    }
    pager.appendChild(pages);
  }

  function renderPager(state) {
    var pager = state.root.querySelector("[data-aco-pf-pager]");
    if (!pager) return;
    var style = paginationStyle(state);
    var modifiers = PAGINATION_STYLES.map(function (value) {
      return "aco-pf-pager--" + value;
    });
    for (var i = 0; i < modifiers.length; i++)
      pager.classList.remove(modifiers[i]);
    pager.classList.add("aco-pf-pager--" + style);
    while (pager.firstChild) pager.removeChild(pager.firstChild);

    var previous = pagerButton(
      "aco-pf-pager__btn aco-pf-pager__btn--prev",
      "Previous",
      { name: "data-aco-pf-prev", value: "" },
    );
    previous.setAttribute("aria-label", "Previous page");
    pager.appendChild(previous);

    var total = paginationTotal(state);
    if (style === "basic") {
      var status = document.createElement("span");
      status.className = "aco-pf-pager__status";
      status.setAttribute("data-aco-pf-page", "");
      status.setAttribute("aria-live", "polite");
      pager.appendChild(status);
    } else {
      renderPagerPages(pager, state, total);
      var hiddenStatus = document.createElement("span");
      hiddenStatus.className = "aco-pf-pager__status visually-hidden";
      hiddenStatus.setAttribute("data-aco-pf-page", "");
      hiddenStatus.setAttribute("aria-live", "polite");
      pager.appendChild(hiddenStatus);
    }

    var next = pagerButton(
      "aco-pf-pager__btn aco-pf-pager__btn--next",
      "Next",
      { name: "data-aco-pf-next", value: "" },
    );
    next.setAttribute("aria-label", "Next page");
    pager.appendChild(next);

    if (style === "jump") {
      var form = document.createElement("form");
      form.className = "aco-pf-pager__jump";
      form.setAttribute("data-aco-pf-jump-form", "");
      var label = document.createElement("label");
      label.textContent = "Go to page";
      label.setAttribute("for", "aco-pf-page-jump-" + state.pageNum);
      var input = document.createElement("input");
      input.type = "number";
      input.min = "1";
      if (total) input.max = String(total);
      input.inputMode = "numeric";
      input.className = "aco-pf-pager__jump-input";
      input.setAttribute("data-aco-pf-jump-input", "");
      input.id = "aco-pf-page-jump-" + state.pageNum;
      input.value = String(state.pageNum);
      var submit = document.createElement("button");
      submit.type = "submit";
      submit.className = "aco-pf-pager__jump-submit";
      submit.setAttribute("data-aco-pf-jump-submit", "");
      submit.textContent = "Go";
      form.appendChild(label);
      form.appendChild(input);
      form.appendChild(submit);
      pager.appendChild(form);
    }
  }

  function showPagerMessage(state, message) {
    var pager = state.root.querySelector("[data-aco-pf-pager]");
    var status = pager && pager.querySelector("[data-aco-pf-page]");
    if (!status) return;
    status.textContent = message;
    status.classList.remove("visually-hidden");
    status.classList.add("aco-pf-pager__status--error");
  }

  function goToPage(state, target) {
    var total = paginationTotal(state);
    if (
      state.loading ||
      state.mode !== "snapshot" ||
      !total ||
      !Number.isInteger(target) ||
      target < 1 ||
      target > total ||
      target === state.pageNum
    )
      return;
    state.pageNum = target;
    loadPage(state);
  }

  function updatePager(state) {
    var pager = state.root.querySelector("[data-aco-pf-pager]");
    if (!pager) return;
    renderPager(state);
    var hasPrev = hasPrevPage(state);
    pager.hidden = !(hasPrev || state.hasNext);

    var prev = pager.querySelector("[data-aco-pf-prev]");
    var next = pager.querySelector("[data-aco-pf-next]");
    var status = pager.querySelector("[data-aco-pf-page]");
    if (prev) prev.disabled = !hasPrev;
    if (next) next.disabled = !state.hasNext;
    if (status) {
      status.textContent =
        state.mode === "snapshot"
          ? "Page " +
            state.pageNum +
            " of " +
            Math.max(1, Math.ceil(state.matchedIds.length / state.perPage))
          : "Page " + state.pageNum;
    }
  }

  function setBusy(state, busy) {
    state.root.classList.toggle("aco-pf-app--loading", busy);
    var results = state.root.querySelector("[data-aco-pf-results]");
    if (results) results.setAttribute("aria-busy", busy ? "true" : "false");
  }

  function announce(state) {
    var results = state.root.querySelector("[data-aco-pf-results]");
    var count = state.root.querySelector("[data-aco-pf-count]");
    if (results && count)
      results.setAttribute("data-aco-pf-announce", count.textContent.trim());
  }

  function escapeHtml(str) {
    return String(str)
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;");
  }

  function cssEscape(str) {
    return String(str).replace(/"/g, '\\"');
  }

  // Symbol for an ISO currency code (e.g. "INR" -> "Ã¢â€šÂ¹", "USD" -> "$").
  function currencySymbolFor(code) {
    try {
      var parts = new Intl.NumberFormat(undefined, {
        style: "currency",
        currency: code,
        currencyDisplay: "narrowSymbol",
      }).formatToParts(0);
      for (var i = 0; i < parts.length; i++) {
        if (parts[i].type === "currency") return parts[i].value;
      }
    } catch (e) {}
    return null;
  }

  // Make the price-filter prefix match the currency the products are actually
  // priced in (from the Storefront API) rather than the store's base currency,
  // so it never disagrees with the prices shown in the grid.
  function syncCurrency(state, nodes) {
    if (state.currencySynced) return;
    var code = null;
    for (var i = 0; i < nodes.length; i++) {
      var mv = nodes[i].priceRange && nodes[i].priceRange.minVariantPrice;
      if (mv && mv.currencyCode) {
        code = mv.currencyCode;
        break;
      }
    }
    if (!code) return;
    var sym = currencySymbolFor(code);
    if (!sym) return;
    state.root
      .querySelectorAll(".aco-pf-price__currency")
      .forEach(function (el) {
        el.textContent = sym;
      });
    state.currencySynced = true;
  }

  function formatMoney(m) {
    try {
      return new Intl.NumberFormat(undefined, {
        style: "currency",
        currency: m.currencyCode,
      }).format(parseFloat(m.amount));
    } catch (e) {
      return m.amount + " " + m.currencyCode;
    }
  }

  window.addEventListener("popstate", function () {
    document.querySelectorAll("[data-aco-pf-root]").forEach(function (root) {
      var state = root.__pfState;
      if (!state) return;
      applyParamsToForm(state, readParams());
      // Back/forward navigation Ã¢â‚¬â€ not a fresh shopper action.
      state.suppressReport = true;
      run(state, true, { fromHistory: true });
      state.suppressReport = false;
    });
  });
})();
