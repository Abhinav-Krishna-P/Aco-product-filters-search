/**
 * Shopify collection authoring for the collection-tree filter.
 *
 * The tree's values ARE Shopify collections (keyed by handle — the storefront
 * filters by handle), so building a tree in the admin can't mean inventing
 * app-local nodes: every node must exist in Shopify. This module lets the
 * settings page create real collections and manage their membership, so a
 * merchant can build the whole hierarchy from the app instead of leaving to
 * create collections in Shopify admin first.
 *
 * Nesting itself stays app-side (FilterValue.parentRaw) — Shopify has no
 * parent/child relationship between collections.
 */

import type { CollectionRule } from "./collectionRules.shared";
import { sanitizeRules } from "./collectionRules.shared";
import { bareProductId, gidProductId } from "./filterConfig.shared";
import type { AdminClient } from "./filterSettings.server";

export type CollectionSummary = {
  id: string; // gid://shopify/Collection/…
  handle: string;
  title: string;
  /** Rule-based ("smart") collection — membership is owned by Shopify's rules. */
  smart: boolean;
  /** Bare numeric product ids currently in the collection (first page only). */
  productIds: string[];
  /** True when the collection holds more products than one page returned. */
  truncated: boolean;
  /**
   * Published to the Online Store channel — i.e. whether the storefront can see
   * it at all. `null` means we couldn't tell (the app lacks read_publications).
   *
   * This matters more than it looks: the Storefront API only returns published
   * collections, so an unpublished node counts zero products in the storefront's
   * facet pass and the whole collection filter disappears a few seconds after
   * the page loads.
   */
  published: boolean | null;
};

export type CollectionResult = {
  ok: boolean;
  collection: CollectionSummary | null;
  errors: { message: string }[];
};

const PRODUCTS_PAGE = 250;

function userErrors(list: unknown): { message: string }[] {
  if (!Array.isArray(list)) return [];
  return list
    .map((e: { message?: string }) => ({ message: String(e?.message ?? "") }))
    .filter((e) => e.message);
}

/** Top-level GraphQL errors (bad field, missing scope) surfaced like userErrors. */
function topLevelErrors(json: { errors?: unknown }): { message: string }[] {
  if (!Array.isArray(json.errors)) return [];
  return json.errors
    .map((e: { message?: string }) => ({ message: String(e?.message ?? "") }))
    .filter((e) => e.message);
}

/**
 * Look a collection up by handle. Uses the `collections(query:)` search rather
 * than `collectionByHandle` so it keeps working across API versions.
 */
export async function findCollectionByHandle(
  admin: AdminClient,
  handle: string,
): Promise<CollectionSummary | null> {
  // Asking whether it's published needs the Online Store publication id, and
  // the field can't be selected without one — so a shop where we can't read
  // publications simply reports `published: null`.
  const pubId = await onlineStorePublicationId(admin);
  const publishedField = pubId
    ? "publishedOnPublication(publicationId: $pubId)"
    : "";

  const res = await admin.graphql(
    `#graphql
    query PfCollectionByHandle($query: String!, $products: Int!${pubId ? ", $pubId: ID!" : ""}) {
      collections(first: 1, query: $query) {
        nodes {
          id
          handle
          title
          ${publishedField}
          ruleSet { appliedDisjunctively }
          products(first: $products) {
            pageInfo { hasNextPage }
            nodes { id }
          }
        }
      }
    }`,
    {
      variables: {
        query: `handle:${handle}`,
        products: PRODUCTS_PAGE,
        ...(pubId ? { pubId } : {}),
      },
    },
  );
  const json: any = await res.json();
  const node = json.data?.collections?.nodes?.find(
    (c: { handle: string }) => c.handle === handle,
  );
  if (!node) return null;
  return {
    id: node.id,
    handle: node.handle,
    title: node.title ?? node.handle,
    smart: !!node.ruleSet,
    productIds: (node.products?.nodes ?? []).map((p: { id: string }) =>
      bareProductId(p.id),
    ),
    truncated: !!node.products?.pageInfo?.hasNextPage,
    published: pubId ? !!node.publishedOnPublication : null,
  };
}

/**
 * Create a collection for a tree node, either way Shopify supports it:
 *
 *   • hand-picked — a manual collection seeded with the chosen products;
 *   • by conditions — an automated collection whose ruleSet decides membership,
 *     so products added to the catalog later join it on their own.
 *
 * The two are mutually exclusive in Shopify: a collection with a ruleSet owns
 * its own membership and rejects hand-added products, so rules win when both
 * arrive.
 *
 * Shopify derives (and de-duplicates) the handle from the title, so the
 * returned handle — not the one we guessed — is what the tree node is keyed by.
 */
export async function createCollection(
  admin: AdminClient,
  input: {
    title: string;
    productIds: string[];
    rules?: CollectionRule[];
    /** true = a product matching ANY condition joins; false = it must match all. */
    matchAny?: boolean;
  },
): Promise<CollectionResult> {
  const title = input.title.trim();
  if (!title) {
    return {
      ok: false,
      collection: null,
      errors: [{ message: "Collection name is required" }],
    };
  }

  const rules = sanitizeRules(input.rules);
  const collectionInput: Record<string, unknown> = { title };
  if (rules.length > 0) {
    collectionInput.ruleSet = {
      appliedDisjunctively: !!input.matchAny,
      rules,
    };
  }

  const res = await admin.graphql(
    `#graphql
    mutation PfCollectionCreate($input: CollectionInput!) {
      collectionCreate(input: $input) {
        collection { id handle title }
        userErrors { field message }
      }
    }`,
    { variables: { input: collectionInput } },
  );
  const json: any = await res.json();
  const payload = json.data?.collectionCreate;
  const errors = [...topLevelErrors(json), ...userErrors(payload?.userErrors)];
  if (!payload?.collection) {
    return {
      ok: false,
      collection: null,
      errors: errors.length
        ? errors
        : [{ message: "Shopify did not create the collection" }],
    };
  }

  const created = payload.collection;
  const smart = rules.length > 0;
  const addErrors = smart
    ? []
    : await addProducts(admin, created.id, input.productIds);
  // A collection the Online Store can't see is invisible to the storefront
  // filter, so a failure here is reported rather than swallowed.
  const publishErrors = await publishToOnlineStore(admin, created.id);

  return {
    ok: addErrors.length === 0,
    collection: {
      id: created.id,
      handle: created.handle,
      title: created.title ?? title,
      smart,
      // An automated collection's membership is Shopify's to compute; we don't
      // know it until the rules run, and the tree never needs it.
      productIds: smart ? [] : input.productIds.map(bareProductId),
      truncated: false,
      published: publishErrors.length === 0,
    },
    errors: [...errors, ...addErrors, ...publishErrors],
  };
}

/**
 * Publish an existing collection to the Online Store — the repair for a node
 * that exists in Shopify but never became visible to the storefront.
 */
export async function publishCollection(
  admin: AdminClient,
  handle: string,
): Promise<CollectionResult> {
  const current = await findCollectionByHandle(admin, handle);
  if (!current) {
    return {
      ok: false,
      collection: null,
      errors: [{ message: `No collection "${handle}" in Shopify` }],
    };
  }
  const errors = await publishToOnlineStore(admin, current.id);
  return {
    ok: errors.length === 0,
    collection: { ...current, published: errors.length === 0 },
    errors,
  };
}

/**
 * Make the collection's membership match `productIds` exactly, as an add/remove
 * diff against what it holds today. Rule-based collections are refused — their
 * membership belongs to the rules, and Shopify rejects the mutation anyway.
 */
export async function setCollectionProducts(
  admin: AdminClient,
  handle: string,
  productIds: string[],
): Promise<CollectionResult> {
  const current = await findCollectionByHandle(admin, handle);
  if (!current) {
    return {
      ok: false,
      collection: null,
      errors: [{ message: `No collection "${handle}" in Shopify` }],
    };
  }
  if (current.smart) {
    return {
      ok: false,
      collection: current,
      errors: [
        {
          message: `"${current.title}" is an automated collection — its products come from its conditions in Shopify.`,
        },
      ],
    };
  }

  const want = new Set(productIds.map(bareProductId));
  const have = new Set(current.productIds);
  const toAdd = [...want].filter((id) => !have.has(id));
  const toRemove = [...have].filter((id) => !want.has(id));

  const errors = [
    ...(await addProducts(admin, current.id, toAdd)),
    ...(await removeProducts(admin, current.id, toRemove)),
  ];

  return {
    ok: errors.length === 0,
    collection: { ...current, productIds: [...want] },
    errors,
  };
}

/**
 * Delete the collection behind a tree node from Shopify itself.
 *
 * This destroys merchant data outside our app, so the caller is expected to
 * have confirmed it. Deleting a collection does NOT delete its products; the
 * tree node is dropped client-side once this succeeds.
 *
 * A collection that's already gone from Shopify counts as success — the node is
 * stale and removing it is exactly what the merchant asked for.
 */
export async function deleteCollection(
  admin: AdminClient,
  handle: string,
): Promise<CollectionResult> {
  const current = await findCollectionByHandle(admin, handle);
  if (!current) return { ok: true, collection: null, errors: [] };

  const res = await admin.graphql(
    `#graphql
    mutation PfCollectionDelete($input: CollectionDeleteInput!) {
      collectionDelete(input: $input) {
        deletedCollectionId
        userErrors { field message }
      }
    }`,
    { variables: { input: { id: current.id } } },
  );
  const json: any = await res.json();
  const payload = json.data?.collectionDelete;
  const errors = [...topLevelErrors(json), ...userErrors(payload?.userErrors)];

  if (!payload?.deletedCollectionId) {
    return {
      ok: false,
      collection: current,
      errors: errors.length
        ? errors
        : [{ message: `Shopify did not delete "${current.title}"` }],
    };
  }
  return { ok: true, collection: current, errors };
}

async function addProducts(
  admin: AdminClient,
  collectionId: string,
  productIds: string[],
): Promise<{ message: string }[]> {
  if (productIds.length === 0) return [];
  const res = await admin.graphql(
    `#graphql
    mutation PfCollectionAddProducts($id: ID!, $productIds: [ID!]!) {
      collectionAddProductsV2(id: $id, productIds: $productIds) {
        job { id }
        userErrors { field message }
      }
    }`,
    {
      variables: { id: collectionId, productIds: productIds.map(gidProductId) },
    },
  );
  const json: any = await res.json();
  return [
    ...topLevelErrors(json),
    ...userErrors(json.data?.collectionAddProductsV2?.userErrors),
  ];
}

async function removeProducts(
  admin: AdminClient,
  collectionId: string,
  productIds: string[],
): Promise<{ message: string }[]> {
  if (productIds.length === 0) return [];
  const res = await admin.graphql(
    `#graphql
    mutation PfCollectionRemoveProducts($id: ID!, $productIds: [ID!]!) {
      collectionRemoveProducts(id: $id, productIds: $productIds) {
        job { id }
        userErrors { field message }
      }
    }`,
    {
      variables: { id: collectionId, productIds: productIds.map(gidProductId) },
    },
  );
  const json: any = await res.json();
  return [
    ...topLevelErrors(json),
    ...userErrors(json.data?.collectionRemoveProducts?.userErrors),
  ];
}

/**
 * The Online Store publication's id, or null when we can't read publications
 * (the app is missing read_publications, or the shop has no Online Store).
 *
 * Cached per-request via a WeakMap keyed by the request's `admin` client instance.
 * Because `admin` is created fresh per session/request, this eliminates duplicate
 * queries in the same action while preventing any cross-shop cache leakage.
 */
const pubIdCache = new WeakMap<object, Promise<string | null>>();

async function onlineStorePublicationId(
  admin: AdminClient,
): Promise<string | null> {
  const cached = pubIdCache.get(admin);
  if (cached !== undefined) return cached;

  const promise = (async () => {
    try {
      const res = await admin.graphql(`#graphql
        query PfPublications {
          publications(first: 25) { nodes { id name } }
        }`);
      const json: any = await res.json();
      const nodes = json.data?.publications?.nodes ?? [];
      return (
        nodes.find((p: { name: string }) => /online store/i.test(p.name ?? ""))
          ?.id ?? null
      );
    } catch {
      return null;
    }
  })();

  pubIdCache.set(admin, promise);
  return promise;
}

/**
 * Publish a collection to the Online Store, so the storefront can resolve it.
 *
 * This is not cosmetic: the Storefront API only returns published collections,
 * so an unpublished one contributes nothing to the storefront's facet counts
 * and its node vanishes from the filter seconds after the page loads. Errors
 * are returned rather than swallowed for exactly that reason.
 */
async function publishToOnlineStore(
  admin: AdminClient,
  collectionId: string,
): Promise<{ message: string }[]> {
  const pubId = await onlineStorePublicationId(admin);
  if (!pubId) {
    return [
      {
        message:
          "Couldn't publish this collection to the Online Store — the app can't read your sales channels. " +
          "Open the collection in Shopify admin and add the Online Store channel, or it won't appear in the storefront filter.",
      },
    ];
  }

  const res = await admin.graphql(
    `#graphql
    mutation PfPublish($id: ID!, $input: [PublicationInput!]!) {
      publishablePublish(id: $id, input: $input) {
        userErrors { field message }
      }
    }`,
    { variables: { id: collectionId, input: [{ publicationId: pubId }] } },
  );
  const json: any = await res.json();
  return [
    ...topLevelErrors(json),
    ...userErrors(json.data?.publishablePublish?.userErrors),
  ];
}
