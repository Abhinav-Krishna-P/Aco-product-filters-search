/**
 * Condition vocabulary for automated ("smart") Shopify collections, shared by
 * the settings UI and the server that sends them to collectionCreate.
 *
 * Shopify only accepts certain relations per column — a tag can be equal or
 * not-equal, but never "greater than" — and rejects the whole mutation when the
 * pair is wrong. So the allowed pairs live here once: the UI offers only valid
 * relations, and the server drops anything that slipped through anyway.
 *
 * Pure — no server imports, safe to bundle client-side.
 */

export type RuleColumn =
  | "TAG"
  | "TITLE"
  | "TYPE"
  | "VENDOR"
  | "VARIANT_TITLE"
  | "VARIANT_PRICE"
  | "VARIANT_INVENTORY"
  | "VARIANT_WEIGHT";

export type RuleRelation =
  | "EQUALS"
  | "NOT_EQUALS"
  | "GREATER_THAN"
  | "LESS_THAN"
  | "STARTS_WITH"
  | "ENDS_WITH"
  | "CONTAINS"
  | "NOT_CONTAINS";

export type CollectionRule = {
  column: RuleColumn;
  relation: RuleRelation;
  condition: string;
};

const TEXT_RELATIONS: RuleRelation[] = [
  "EQUALS",
  "NOT_EQUALS",
  "STARTS_WITH",
  "ENDS_WITH",
  "CONTAINS",
  "NOT_CONTAINS",
];

const NUMBER_RELATIONS: RuleRelation[] = [
  "EQUALS",
  "NOT_EQUALS",
  "GREATER_THAN",
  "LESS_THAN",
];

/** Merchant-facing name + the relations Shopify accepts, per column. */
export const RULE_COLUMNS: {
  value: RuleColumn;
  label: string;
  relations: RuleRelation[];
  numeric: boolean;
}[] = [
  // Tags match whole values only — Shopify has no "tag contains" rule.
  {
    value: "TAG",
    label: "Product tag",
    relations: ["EQUALS", "NOT_EQUALS"],
    numeric: false,
  },
  {
    value: "TITLE",
    label: "Product title",
    relations: TEXT_RELATIONS,
    numeric: false,
  },
  {
    value: "TYPE",
    label: "Product type",
    relations: TEXT_RELATIONS,
    numeric: false,
  },
  {
    value: "VENDOR",
    label: "Product vendor",
    relations: TEXT_RELATIONS,
    numeric: false,
  },
  {
    value: "VARIANT_TITLE",
    label: "Variant title",
    relations: TEXT_RELATIONS,
    numeric: false,
  },
  {
    value: "VARIANT_PRICE",
    label: "Price",
    relations: NUMBER_RELATIONS,
    numeric: true,
  },
  {
    value: "VARIANT_INVENTORY",
    label: "Inventory stock",
    relations: NUMBER_RELATIONS,
    numeric: true,
  },
  {
    value: "VARIANT_WEIGHT",
    label: "Weight",
    relations: NUMBER_RELATIONS,
    numeric: true,
  },
];

export const RULE_RELATION_LABELS: Record<RuleRelation, string> = {
  EQUALS: "is equal to",
  NOT_EQUALS: "is not equal to",
  GREATER_THAN: "is greater than",
  LESS_THAN: "is less than",
  STARTS_WITH: "starts with",
  ENDS_WITH: "ends with",
  CONTAINS: "contains",
  NOT_CONTAINS: "does not contain",
};

export function ruleColumnSpec(column: string) {
  return RULE_COLUMNS.find((c) => c.value === column) ?? null;
}

/**
 * Keep only rules Shopify will accept: a known column, a relation that column
 * allows, and a non-empty condition (numeric where the column demands it).
 */
export function sanitizeRules(raw: unknown): CollectionRule[] {
  if (!Array.isArray(raw)) return [];
  const out: CollectionRule[] = [];
  for (const r of raw) {
    const spec = ruleColumnSpec(String(r?.column ?? ""));
    if (!spec) continue;
    const relation = String(r?.relation ?? "") as RuleRelation;
    if (!spec.relations.includes(relation)) continue;
    const condition = String(r?.condition ?? "").trim();
    if (!condition) continue;
    if (spec.numeric && !Number.isFinite(Number(condition))) continue;
    out.push({ column: spec.value, relation, condition });
  }
  return out;
}
