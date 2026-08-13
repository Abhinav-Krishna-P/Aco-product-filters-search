/**
 * Shared types, constants, and utility functions used across the Filters tab
 * sub-components. Extracted from FiltersTab.tsx to avoid circular imports.
 */

import type { AdminValue } from "../../models/filterConfig.shared";

/** Paginate values in the editor modal — show N at a time. */
export const VALUES_PAGE = 50;

/**
 * A Shopify collection as the settings action reports it. Mirrors
 * CollectionSummary in collections.server.ts — redeclared here so the client
 * bundle never reaches into a .server module.
 */
export type CollectionSummary = {
  id: string;
  handle: string;
  title: string;
  smart: boolean;
  productIds: string[];
  truncated: boolean;
  published: boolean | null;
};

export type CollectionActionData = {
  ok: boolean;
  errors: { message: string }[];
  collection: CollectionSummary | null;
};

export function styleLabel(style: string): string {
  switch (style) {
    case "swatch":
      return "Swatches";
    case "image":
      return "Images";
    case "pill":
      return "Pills";
    case "radio":
      return "Radio";
    case "range":
      return "Range";
    default:
      return "Checkbox";
  }
}

// Collection tree: DFS-ordered rows with depth, mirroring the storefront
// serialization. Includes hidden values (so they can be un-hidden); a value
// with a missing/self/cyclic parent renders at root.
export function treeRows(
  values: AdminValue[],
): { value: AdminValue; depth: number }[] {
  const byRaw = new Map(values.map((v) => [v.raw, v]));
  const children = new Map<string | null, AdminValue[]>();
  for (const v of values) {
    const p =
      v.parentRaw && v.parentRaw !== v.raw && byRaw.has(v.parentRaw)
        ? v.parentRaw
        : null;
    if (!children.has(p)) children.set(p, []);
    children.get(p)!.push(v);
  }
  const out: { value: AdminValue; depth: number }[] = [];
  const walk = (parent: string | null, depth: number, trail: Set<string>) => {
    for (const v of children.get(parent) ?? []) {
      if (trail.has(v.raw)) continue;
      trail.add(v.raw);
      out.push({ value: v, depth });
      walk(v.raw, depth + 1, trail);
    }
  };
  walk(null, 0, new Set());
  return out;
}
