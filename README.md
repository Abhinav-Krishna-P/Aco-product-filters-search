
# Product Filters & Search

A Shopify app that gives merchants fully customisable product filtering, faceted search and sorting on their collection and search pages — **without depending on Shopify's Search & Discovery app**, and without building or hosting a product index.

Merchants configure everything from an embedded admin UI; shoppers get a fast, themeable filter panel rendered by a theme app extension.

---

## How it works

The app deliberately never stores, syncs or indexes the merchant's product catalog.

```
Admin UI  →  Postgres (source of truth)  →  serialize  →  shop metafield  →  Storefront
                                                          pf_config.settings
```

1. **Configure** — the merchant edits filters in the embedded admin. Settings live in Postgres via Prisma.
2. **Publish** — on save, the whole configuration is serialised into a single shop metafield, `pf_config.settings` (namespace `pf_config`, type `json`). This snapshot is the *only* thing the storefront reads.
3. **Render** — the theme app extension reads that metafield in Liquid and renders the filter sidebar. The initial product grid is server-rendered from the native listing, so the page works before JavaScript loads.
4. **Filter** — on interaction, `pf-filters.js` queries the **Storefront API directly from the shopper's browser** using a public storefront access token, then re-renders the grid client-side.

Because only filter *options* (strings) and a public token are persisted, there is no catalog replication, no webhook-driven sync, and no search index to maintain.

### Filter resolution

Product type, vendor, tag, availability and price are pushed into the Storefront API's `products(query:)` string and filtered by Shopify. Variant options and custom filters can't be expressed in that query syntax, so those selections are matched client-side against a cached catalog attribute snapshot (batches of 250, capped at 5,000 products per filter change).

---

## Features

### Filter types

| Type | Source |
| --- | --- |
| Availability | in stock / out of stock |
| Price | range, with configurable min/max bounds |
| Product type | detected from catalog |
| Vendor | detected from catalog |
| Tag | detected from catalog |
| Variant option | any option name (Size, Colour, Material…) |
| Collection | nested collection tree |
| **Custom** | merchant-authored, with hand-picked products per option |

**Custom filters** let a merchant invent a facet that doesn't exist in the catalog data — define the options yourself and assign products to each one through the Shopify resource picker.

### Display styles

Checkbox, radio, colour swatch, image swatch, and pill/button — selectable per filter. Price renders as range inputs; collections render as an expandable tree.

Swatch colours are **auto-detected from the value name** against a table of ~130 named colours (including common misspellings), so a "Burgundy" option gets the right swatch without manual work. Any colour can be overridden with a picker, or replaced with an image swatch URL.

### Value-level control

Every filter value can be renamed, recoloured, given an image, pinned to the top, hidden, or manually reordered. Values that disappear from the catalog after a rescan are flagged **"Not in catalog"** rather than deleted, so customisations survive catalog changes.

### Collection tree

Collection filters render as a real hierarchy. In the admin, drag a collection by its handle to move it — it carries its sub-collections with it — or use `→` / `←` to nest and un-nest in place. Parentage is initially guessed from collection handle prefixes. Configurable behaviour: filter in place vs. navigate to the collection page, whether selecting a parent cascades to its children, and whether the tree starts expanded.

### Dynamic (disjunctive) faceting

Each filter group is recounted against every *other* group's active selections, so counts stay truthful as the shopper narrows down. Zero-result values can be hidden or greyed out, and groups that become empty collapse away.

### Sorting

Eight sort keys (Featured, best-selling, price ↑↓, title A–Z/Z–A, newest/oldest). Each option can be enabled, renamed and reordered; the control can sit in a toolbar above the grid or at the top of the filter panel. Sorting is derived client-side from the cached snapshot where possible.

### Layout

Sidebar (left or right), horizontal filter bar, or drawer. Sticky sidebar with adjustable width, separate desktop (2–5) and mobile (1–2) grid column counts, a shopper-facing column switcher, active-filter chips, results count and clear-all.

### Appearance

Inherit the theme's styling, or take over: four one-click palettes (Minimal, Bold, Ocean, Dark) plus individual pickers for accent, text, muted, border, background, hover and selected colours. Corner radius, density, swatch shape and size, selected-indicator style, hover effects, group icons and typography are all configurable. Settings compile down to `--pf-*` CSS custom properties baked into the snapshot, with a custom CSS escape hatch.

### Behaviour

Default-open state, collapsible and accordion modes, animations, collapse-after-N-values, per-group search boxes, instant-apply vs. an explicit Apply button, and scroll-to-results.

### URL state

Filters are reflected in shareable, back/forward-safe URLs via `history.pushState`:

| Filter | Param |
| --- | --- |
| Availability | `pf_available=1` |
| Price | `pf_price_min`, `pf_price_max` |
| Product type | `pf_type` (repeatable) |
| Vendor | `pf_vendor` (repeatable) |
| Tag | `pf_tag` (repeatable) |
| Collection | `pf_collection` |
| Variant option | `pf_opt_<OptionName>` (repeatable) |
| Custom filter | `pf_custom_<key>` (repeatable) |
| Sort | `pf_sort` |

Repeated values of the same kind combine with **OR**; different kinds combine with **AND**.

### Analytics

A built-in analytics page reports how shoppers actually use the filters: filter actions, filter selections, product clicks, the most-filtered category and price range, a time-series chart with selectable date ranges, a per-filter usage breakdown, filter pairs that are commonly used together, and the most-clicked products.

Storefront events (`storefront_filter_applied`, `storefront_product_clicked`) are captured to PostHog and read back with HogQL. Sessions are grouped by an anonymous local id — no person profiles are created. Redis is used as an optional 180-second cache over each selected date range so repeated views re-aggregate in memory instead of re-querying; without `REDIS_URL` it falls back to querying PostHog directly.

---

## Tech stack

- **[Remix](https://remix.run)** + Vite, TypeScript
- **[Polaris](https://polaris.shopify.com/)** and **App Bridge** for the embedded admin
- **Prisma** + **PostgreSQL** for settings and session storage
- **Shopify Storefront API** (`2026-07`) for runtime filtering; **Admin GraphQL API** for catalog detection
- **Theme app extension** — Liquid blocks/snippets with vanilla JS and CSS (no storefront framework)
- **PostHog** for analytics, **ioredis** for the analytics cache

---

## Getting started

### Prerequisites

- **Node.js** ≥ 20.19 (`<22 || >=22.12`)
- A **[Shopify Partner account](https://partners.shopify.com/signup)** and a development store
- **Shopify CLI** — `npm install -g @shopify/cli@latest`
- A **PostgreSQL** database

### Setup

```bash
npm install
```

Create a `.env` file:

```bash
SHOPIFY_API_KEY=
SHOPIFY_CLIENT_SECRET=
DATABASE_URL=postgresql://user:password@host:5432/dbname

# Analytics (optional)
POSTHOG_API_KEY=
POSTHOG_HOST=
POSTHOG_PERSONAL_API_KEY=
POSTHOG_API_HOST=
POSTHOG_PROJECT_ID=

# Analytics cache (optional)
REDIS_URL=
```

Run the migrations and start the dev server:

```bash
npm run setup
npm run dev
```

### Merchant setup

1. Open the app → **Settings** → **Advanced** → **Detect filter values** to scan the catalog.
2. On the **Filters** tab, choose which filters to show, set display styles, and edit labels and values.
3. **Save** — this publishes the snapshot to the storefront.
4. In the **Theme Editor**, add **Collection Filters** to a collection template and **Search Filters** to the search template (*Add section → Apps*).
5. Make sure products are published to the **Online Store** sales channel — the Storefront API only returns published products.

### Scripts

| Command | Purpose |
| --- | --- |
| `npm run dev` | Start the app with the Shopify CLI (tunnel, env, live reload) |
| `npm run build` | Production build |
| `npm run setup` | `prisma generate && prisma migrate deploy` |
| `npm run deploy` | Deploy app config and extensions to Shopify |
| `npm run lint` | ESLint |

---

## Design notes and trade-offs

These are deliberate consequences of the "no index, no catalog copy" architecture:

- **Filtering requires JavaScript.** The server-rendered grid shows the unfiltered listing; filters are applied client-side. A `<noscript>` notice is shown.
- **Filter vocabularies are a snapshot.** Re-run *Detect filter values* after significant catalog changes. Each scan is capped at 5,000 products, and the UI surfaces when the cap was hit.
- **Variant-option and custom filters scan client-side.** Results may be incomplete past 5,000 products for a single filter change; a console warning is logged.
- **The published snapshot must fit in 128 KB**, Shopify's json-metafield limit. The admin warns at 80% and blocks at 100%, pointing at the usual cause (custom-filter product assignments). If a publish fails the settings are still safe in Postgres and the UI offers **Republish**.
- **Filter options are store-wide.** A value no product in the current collection has will simply return no results.

---

## Status

The filtering, sorting, appearance, layout and analytics features described above are implemented.

**SEO is not implemented yet.** The app is named *ProductFilters-and-SEO* and reserves the metaobject access scopes, but the SEO work — canonical and robots handling for filtered URLs, `nofollow` on facet links, and control over which parameters are indexable — is still planned. See [docs/settings-page-plan.md](docs/settings-page-plan.md).

---

## Project layout

```
app/
├─ components/settings/     # Filters, Sort, Layout, Appearance, Behavior, Advanced tabs
├─ models/
│  ├─ filterSettings.server.ts   # Postgres ⇄ metafield snapshot pipeline
│  ├─ filterConfig.shared.ts     # shared config types and helpers
│  └─ swatchColors.ts            # colour-name → hex auto-detection
└─ routes/
   ├─ app.settings.tsx     # the admin settings page
   └─ app.analytics.tsx    # the analytics dashboard

extensions/filter-search/  # theme app extension
├─ blocks/                 # collection-filters, search-filters
├─ snippets/               # filter group, product grid, sort control
└─ assets/                 # pf-filters.js, pf-filters.css

prisma/schema.prisma       # FilterSettings → FilterDefinition → FilterValue, Session
```
