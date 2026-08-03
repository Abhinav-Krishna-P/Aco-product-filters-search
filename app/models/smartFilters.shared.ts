/**
 * Deterministic Smart Filters matcher — maps plain-English queries onto the
 * storefront filter vocabulary (no LLM). Shared by the App Proxy route and tests.
 */

export type SmartFilterValue = {
  raw: string;
  label: string;
};

export type SmartFilterGroup = {
  key: string;
  /** Form param name, e.g. pf_opt_Color, pf_type, pf_available */
  paramName: string;
  label: string;
  values: SmartFilterValue[];
};

export type SmartFiltersMatchInput = {
  query: string;
  filters: SmartFilterGroup[];
};

export type SmartFiltersMatchResult = {
  ok: true;
  selections: Record<string, string[]>;
  price?: { min?: string; max?: string };
  matched: string[];
  unmatched: string[];
  message: string;
};

const STOPWORDS = new Set([
  "a",
  "an",
  "the",
  "and",
  "or",
  "with",
  "for",
  "in",
  "of",
  "to",
  "on",
  "at",
  "by",
  "from",
  "is",
  "are",
  "be",
  "me",
  "my",
  "show",
  "find",
  "get",
  "want",
  "please",
  "only",
  "all",
  "any",
  "products",
  "product",
  "items",
  "item",
]);

function normalizeText(s: string): string {
  return String(s || "")
    .toLowerCase()
    .replace(/[$€£¥]/g, "")
    .replace(/['’]/g, "")
    .trim();
}

/** Split into tokens; keep numbers as their own tokens. */
function tokenize(query: string): string[] {
  const norm = normalizeText(query);
  if (!norm) return [];
  return norm
    .split(/[^a-z0-9.]+/i)
    .map((t) => t.trim())
    .filter((t) => t.length > 0 && !STOPWORDS.has(t));
}

type PhraseCandidate = {
  phrase: string; // normalized multi-word or single
  tokens: string[];
  paramName: string;
  raw: string;
  display: string;
  kind: "value" | "available" | "price_min" | "price_max" | "price_between";
  priceMin?: string;
  priceMax?: string;
};

function addSelection(
  selections: Record<string, string[]>,
  paramName: string,
  raw: string,
) {
  if (!selections[paramName]) selections[paramName] = [];
  if (!selections[paramName].includes(raw)) selections[paramName].push(raw);
}

/**
 * Mark a contiguous span of tokens as consumed if the phrase tokens appear
 * in order as a contiguous subsequence. Returns true if consumed.
 */
function consumePhrase(
  tokens: string[],
  used: boolean[],
  phraseTokens: string[],
): boolean {
  if (!phraseTokens.length) return false;
  const n = tokens.length;
  const m = phraseTokens.length;
  outer: for (let i = 0; i <= n - m; i++) {
    for (let j = 0; j < m; j++) {
      if (used[i + j] || tokens[i + j] !== phraseTokens[j]) continue outer;
    }
    for (let j = 0; j < m; j++) used[i + j] = true;
    return true;
  }
  return false;
}

function buildPriceCandidates(query: string): PhraseCandidate[] {
  const out: PhraseCandidate[] = [];
  const q = normalizeText(query);

  // between A and B
  let m = q.match(
    /\bbetween\s+(\d+(?:\.\d+)?)\s+and\s+(\d+(?:\.\d+)?)\b/,
  );
  if (m) {
    out.push({
      phrase: m[0],
      tokens: tokenize(m[0]),
      paramName: "pf_price_min",
      raw: m[1],
      display: `Price ${m[1]}–${m[2]}`,
      kind: "price_between",
      priceMin: m[1],
      priceMax: m[2],
    });
  }

  // under|below|less than N
  const underRe =
    /\b(?:under|below|less\s+than|upto|up\s+to)\s+(\d+(?:\.\d+)?)\b/g;
  while ((m = underRe.exec(q))) {
    out.push({
      phrase: m[0],
      tokens: tokenize(m[0]),
      paramName: "pf_price_max",
      raw: m[1],
      display: `Under ${m[1]}`,
      kind: "price_max",
      priceMax: m[1],
    });
  }

  // over|above|more than N
  const overRe =
    /\b(?:over|above|more\s+than|at\s+least)\s+(\d+(?:\.\d+)?)\b/g;
  while ((m = overRe.exec(q))) {
    out.push({
      phrase: m[0],
      tokens: tokenize(m[0]),
      paramName: "pf_price_min",
      raw: m[1],
      display: `Over ${m[1]}`,
      kind: "price_min",
      priceMin: m[1],
    });
  }

  return out;
}

function hasPriceFilter(filters: SmartFilterGroup[]): boolean {
  return filters.some(
    (f) =>
      f.paramName === "pf_price_min" ||
      f.paramName === "pf_price_max" ||
      f.key === "price" ||
      /price/i.test(f.label),
  );
}

function hasAvailableFilter(filters: SmartFilterGroup[]): boolean {
  return filters.some(
    (f) => f.paramName === "pf_available" || f.key === "available",
  );
}

export function matchSmartFilters(
  input: SmartFiltersMatchInput,
): SmartFiltersMatchResult {
  const query = String(input.query || "").trim();
  const filters = Array.isArray(input.filters) ? input.filters : [];

  if (!query) {
    return {
      ok: true,
      selections: {},
      matched: [],
      unmatched: [],
      message: "Enter a search to apply filters.",
    };
  }

  const tokens = tokenize(query);
  const used = tokens.map(() => false);
  const selections: Record<string, string[]> = {};
  const matched: string[] = [];
  let price: { min?: string; max?: string } | undefined;

  const candidates: PhraseCandidate[] = [];

  // Availability — match on full query so stopwords like "in" don't break it.
  if (hasAvailableFilter(filters)) {
    const qNorm = normalizeText(query);
    if (
      /\bin\s+stock\b/.test(qNorm) ||
      /\binstock\b/.test(qNorm) ||
      /\bavailable\b/.test(qNorm)
    ) {
      for (let i = 0; i < tokens.length; i++) {
        if (
          tokens[i] === "stock" ||
          tokens[i] === "instock" ||
          tokens[i] === "available"
        ) {
          used[i] = true;
        }
      }
      addSelection(selections, "pf_available", "1");
      if (!matched.includes("In stock")) matched.push("In stock");
    }
  }

  // Price phrases
  if (hasPriceFilter(filters)) {
    candidates.push(...buildPriceCandidates(query));
  }

  // Filter values — longest labels first
  for (const group of filters) {
    if (!group?.paramName || group.paramName === "pf_price_min") continue;
    if (group.paramName === "pf_price_max") continue;
    for (const v of group.values || []) {
      const label = String(v.label || v.raw || "").trim();
      const raw = String(v.raw || "").trim();
      if (!raw) continue;
      const phrases = new Set<string>();
      if (label) phrases.add(normalizeText(label));
      phrases.add(normalizeText(raw));
      for (const phrase of phrases) {
        if (!phrase) continue;
        candidates.push({
          phrase,
          tokens: tokenize(phrase),
          paramName: group.paramName,
          raw,
          display: label || raw,
          kind: "value",
        });
      }
    }
  }

  // Longest phrase first for greedy matching
  candidates.sort((a, b) => {
    const lenDiff = b.tokens.length - a.tokens.length;
    if (lenDiff !== 0) return lenDiff;
    return b.phrase.length - a.phrase.length;
  });

  for (const c of candidates) {
    if (!c.tokens.length) continue;
    if (!consumePhrase(tokens, used, c.tokens)) continue;

    if (c.kind === "price_between" || c.kind === "price_min" || c.kind === "price_max") {
      price = price || {};
      if (c.priceMin != null) price.min = c.priceMin;
      if (c.priceMax != null) price.max = c.priceMax;
      if (!matched.includes(c.display)) matched.push(c.display);
      continue;
    }

    addSelection(selections, c.paramName, c.raw);
    if (!matched.includes(c.display)) matched.push(c.display);
  }

  const unmatched = tokens.filter((_, i) => !used[i]);

  const hasAny =
    matched.length > 0 ||
    (price && (price.min != null || price.max != null));

  let message = "";
  if (!hasAny) {
    message = "No filters matched your search.";
  } else if (unmatched.length) {
    message = `No match for: ${unmatched.join(", ")}`;
  }

  return {
    ok: true,
    selections,
    ...(price ? { price } : {}),
    matched,
    unmatched,
    message,
  };
}
