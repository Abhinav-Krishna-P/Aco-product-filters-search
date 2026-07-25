# Filter & Search — Theme App Extension

App-defined product filtering and search for collection and search pages.
**No Search & Discovery dependency. No product database. No search index.**

Filters are resolved live by the **Storefront API**, called directly from the
shopper's browser. The app only persists the filter *options* (strings) and a
public Storefront token in a single Shop metafield — never the product catalog.

## Architecture

**Config time (admin app → `app/routes/app.settings.tsx`)**
1. "Detect filter values" scans products via the Admin API and collects the
   distinct **product types, vendors, tags, option values, and price range**.
2. It ensures a **public Storefront access token** exists
   (`storefrontAccessTokenCreate`).
3. Both are saved to the Shop metafield `pf_config.settings` (type `json`).

**Runtime (this extension)**
1. The block reads `shop.metafields.pf_config.settings` in Liquid and renders the
   filter sidebar from it — no `collection.filters`, no Search & Discovery.
2. The initial product grid is the native listing (`collection.products` /
   `search.results`), server-rendered (works with no dependency).
3. On filter change, `pf-filters.js` queries
   `POST https://{shop}/api/{version}/graphql.json` **directly from the browser**
   (public token), then re-renders the grid. Type, vendor, tag, availability and
   price are pushed into the `products(query:)` search string (filtered by
   Shopify). Variant options aren't supported by that query syntax — and the
   `products(filters:)` argument requires the Search & Discovery app — so option
   selections are matched client-side by scanning the pre-filtered catalog in
   batches of 250 (capped at 5,000 products) and paginating the matches locally.
   Without option filters, Prev/Next paginate via cursors, one request per page.

Nowhere is product data stored, synced, or indexed by us.

## Theme product card mode (Settings → Product card → Card source)

By default filtered results use the **ACO custom card**. Merchants can switch to
their **theme's own product card**. Nothing about the theme's card is guessed:

1. On save / asset sync (and on `themes/publish` + `themes/update` webhooks) the
   server copies the merchant's real collection and search grid sections and
   rewrites only the product loop so it iterates a handle list taken from
   `search.terms` (`app/models/themeCardMirror.shared.js`). The copies are written
   to `sections/aco-pf-theme-cards-{collection,search}.liquid` together with an
   alternate search template `templates/search.aco-pf.json` that carries the
   merchant's section **settings and blocks** (so Horizon-style static blocks
   keep their customisation). Vintage themes get `templates/search.aco-pf.liquid`
   with the saved settings baked into the schema defaults.
2. The rendered section ids are discovered once and published to the
   `pf_config.theme_cards` metafield, which `aco-product-filters.liquid` exposes
   as `data-theme-cards`.
3. For every filtered page `pf-filters.js` asks Shopify to render the mirror for
   that page's handles (`/search?view=aco-pf&type=product&q=<handles>&section_id=…`,
   20 handles per request), splits the response on `<!--aco-pf-card:handle-->`
   markers, inserts the merchant's grid container with the cards, dedupes
   stylesheets, re-activates `<script>` tags and fires `shopify:section:load`.
4. Any failure (missing section, Liquid error inside a card, no markers) falls
   back to the ACO card for that page; two failures in a row disable theme mode
   for the session. The admin **Test render** button renders one real product
   through the mirror and reports the exact failure.

Theme-card mode needs the filters **injected** into the published theme; theme
app extension blocks cannot render host theme snippets.

## Files

```
extensions/filter-search/
├─ shopify.extension.toml
├─ .theme-check.yml
├─ snippets/
│  ├─ pf-config-group.liquid      # one filter group, rendered from config
│  ├─ pf-product-grid.liquid      # ACO product grid (SSR initial + JS re-render shape)
│  └─ pf-sort.liquid
└─ assets/
   ├─ pf-filters.js               # params -> Storefront API -> ACO cards or theme card mirror
   ├─ pf-filters.css
   ├─ pf-variant-picker.shared.js
   └─ __fixtures__/theme-cards-dawn.html  # theme-card test fixture

The storefront entry point is app/theme-inject/aco-product-filters.liquid, copied
into the merchant theme by app/models/themeInject.server.ts (see Theme product
card mode below for the generated mirror files).
```

## URL param scheme (app-defined, not Shopify's native params)

| Filter | Param | Combine |
|---|---|---|
| Availability | `pf_available=1` | — |
| Price | `pf_price_min`, `pf_price_max` | single range |
| Product type | `pf_type` (repeatable) | OR |
| Vendor | `pf_vendor` (repeatable) | OR |
| Tag | `pf_tag` (repeatable) | OR |
| Variant option | `pf_opt_<OptionName>` (repeatable) | OR |

Different kinds combine with AND; repeated values of the same kind combine
with OR. Type/vendor/tag/availability/price become `products(query:)` clauses;
`pf_opt_*` selections are matched against each product's `options{name values}`.

## Merchant setup

1. Open the app → **Filter settings** → **Detect filter values**.
2. Choose which filters to show, edit labels, **Save**.
3. In the **Theme Editor**, add **Collection Filters** to a collection template and
   **Search Filters** to the search template (**Add section → Apps**).
4. Publish products to the **Online Store** (the Storefront API only returns
   published products).

## Known trade-offs (app-defined model)

- **Filtering requires JavaScript.** The SSR grid shows the unfiltered listing; the
  Storefront API applies filters client-side. A `<noscript>` notice is shown.
- **Filter vocabularies are a snapshot.** Re-run "Detect filter values" after
  catalog changes. The scan is capped at 5,000 products per run (surfaced in the UI).
- **Variant-option filters scan the catalog client-side.** Selecting an option
  filter fetches the (query-pre-filtered) catalog in batches of 250 until the
  current page fills, resuming on Next. Scanning is capped at 5,000 products
  per filter change; beyond that, results may be incomplete (a console warning
  is logged).
- **Per-value facet counts** are not shown (computing them live per value is
  expensive without an index). The total result count updates as you filter.
- Filter options are **store-wide** in v1; a value that no product in the current
  collection has will simply return no results.
