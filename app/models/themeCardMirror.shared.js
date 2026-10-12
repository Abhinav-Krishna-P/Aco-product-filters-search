// Pure helpers for the "theme card mirror": a transformed copy of the
// merchant's own collection/search grid section whose product loop is fed a
// list of handles (via search.terms) instead of collection.products. No I/O.
// Spec: docs/superpowers/specs/2026-10-13-theme-card-mirror-design.md
import { createHash } from "node:crypto";
import { stripInject } from "./themeInject.shared.js";

export const TRANSFORM_VERSION = "3";

export const MIRROR_FILES = {
  collection: "sections/aco-pf-theme-cards-collection.liquid",
  search: "sections/aco-pf-theme-cards-search.liquid",
  templateJson: "templates/search.aco-pf.json",
  templateLiquid: "templates/search.aco-pf.liquid",
};

export const MIRROR_SECTION_TYPES = {
  collection: "aco-pf-theme-cards-collection",
  search: "aco-pf-theme-cards-search",
};

export const MIRROR_KEYS = {
  collection: "aco-pf-collection",
  search: "aco-pf-search",
};

export const MIRROR_VIEW = "aco-pf";
// Snippets on the section's render chain are copied under this prefix so the
// mirror keeps the theme's own `render` scoping instead of inlining them.
export const MIRROR_SNIPPET_PREFIX = "aco-pf-mirror-";

export function mirrorSnippetName(name) {
  return MIRROR_SNIPPET_PREFIX + name;
}

export function mirrorSnippetFile(name) {
  return "snippets/" + mirrorSnippetName(name) + ".liquid";
}
// Shopify caps section schema names at 25 characters.
export const MIRROR_SCHEMA_NAME = "ACO theme cards (keep)";
export const CARD_MARK_OPEN = "<!--aco-pf-card:";
export const CARD_MARK_CLOSE = "<!--/aco-pf-card-->";

const PRODUCT_SOURCES = ["collection.products", "search.results"];
const TAG_RE = /\{%-?\s*(\w+)\b([\s\S]*?)-?%\}/g;
const OPENERS = { for: 1, if: 1, unless: 1, case: 1 };
const CLOSERS = {
  endfor: "for",
  endif: "if",
  endunless: "unless",
  endcase: "case",
};

/**
 * Same-length copy of `src` with `{% comment %}…{% endcomment %}` and
 * `{% raw %}…{% endraw %}` blocks blanked out, so scanners never pick up a
 * commented-out loop while indices stay valid for the original text.
 */
function maskInertBlocks(src) {
  return String(src || "").replace(
    /\{%-?\s*(comment|raw)\s*-?%\}[\s\S]*?\{%-?\s*end\1\s*-?%\}/g,
    (m) => " ".repeat(m.length),
  );
}

/** `str.replace(re, repl)` applied only where `masked` is not blanked out. */
function replaceOutsideInert(original, re, repl) {
  const masked = maskInertBlocks(original);
  let out = "";
  let last = 0;
  masked.replace(re, (...args) => {
    const offset = args[args.length - 2];
    const match = args[0];
    out += original.slice(last, offset);
    out += typeof repl === "function" ? repl(...args) : match.replace(re, repl);
    last = offset + match.length;
    return match;
  });
  return out + original.slice(last);
}

/** Names of variables assigned (anywhere) from a product source. */
function assignedSources(src) {
  const names = new Set(PRODUCT_SOURCES);
  const re = /\bassign\s+(\w+)\s*=\s*([\w.]+)/g;
  let m;
  let changed = true;
  // Two passes catch `assign a = collection.products` then `assign b = a`.
  for (let pass = 0; pass < 2 && changed; pass++) {
    changed = false;
    re.lastIndex = 0;
    while ((m = re.exec(src))) {
      if (names.has(m[2]) && !names.has(m[1])) {
        names.add(m[1]);
        changed = true;
      }
    }
  }
  return names;
}

const RENDER_RE = /\{%-?\s*(render|include)\s+(['"])([\w.-]+)\2/g;

/** Snippet names rendered/included by `src` (outside comment/raw), in order. */
export function renderedSnippetNames(src) {
  const text = maskInertBlocks(src);
  const out = [];
  let m;
  RENDER_RE.lastIndex = 0;
  while ((m = RENDER_RE.exec(text))) {
    if (!out.includes(m[3])) out.push(m[3]);
  }
  return out;
}

/**
 * Snippets (keys of `snippets`) reachable from the section that contain a
 * product loop or render one further down. Every branch that reaches a loop
 * is kept so the section can keep choosing between them at render time.
 */
export function loopSnippetClosure(sectionSrc, snippets) {
  const memo = new Map();
  const visiting = new Set();
  const reaches = (name) => {
    if (memo.has(name)) return memo.get(name);
    const body = snippets[name];
    if (body == null || visiting.has(name)) return false;
    visiting.add(name);
    let hit = findProductLoops(body).length > 0;
    for (const child of renderedSnippetNames(body)) {
      if (reaches(child)) hit = true;
    }
    visiting.delete(name);
    memo.set(name, hit);
    return hit;
  };
  for (const name of renderedSnippetNames(sectionSrc)) reaches(name);
  return [...memo.entries()].filter(([, hit]) => hit).map(([name]) => name);
}

/**
 * Locate every `{% for X in <product source> %}` … `{% endfor %}` block.
 * Indices are into `src`. `elseStart` is the `{% else %}` belonging to the
 * loop itself (for/else), if any.
 */
export function findProductLoops(src) {
  const text = maskInertBlocks(src);
  const sources = assignedSources(text);
  const tags = [];
  let m;
  TAG_RE.lastIndex = 0;
  while ((m = TAG_RE.exec(text))) {
    tags.push({
      name: m[1],
      args: m[2],
      start: m.index,
      end: m.index + m[0].length,
    });
  }

  const loops = [];
  for (let i = 0; i < tags.length; i++) {
    const t = tags[i];
    if (t.name !== "for") continue;
    const head = /^\s+(\w+)\s+in\s+([\w.]+)/.exec(t.args);
    if (!head || !sources.has(head[2])) continue;
    if (loops.length && t.start < loops[loops.length - 1].end) continue; // nested in a product loop

    const stack = ["for"];
    let elseStart = -1;
    let endforStart = -1;
    let end = -1;
    for (let j = i + 1; j < tags.length; j++) {
      const u = tags[j];
      if (OPENERS[u.name]) {
        stack.push(u.name);
      } else if (CLOSERS[u.name]) {
        stack.pop();
        if (stack.length === 0) {
          endforStart = u.start;
          end = u.end;
          break;
        }
      } else if (u.name === "else" && stack.length === 1) {
        elseStart = u.start;
      }
    }
    if (end === -1) continue; // unbalanced; skip
    loops.push({
      start: t.start,
      headerEnd: t.end,
      elseStart,
      endforStart,
      end,
      loopVar: head[1],
      source: head[2],
    });
  }
  return loops;
}

function splitSchema(src) {
  const re = /\{%-?\s*schema\s*-?%\}([\s\S]*?)\{%-?\s*endschema\s*-?%\}/;
  const m = re.exec(src);
  if (!m) return { body: src, schemaText: null };
  return {
    body: src.slice(0, m.index) + src.slice(m.index + m[0].length),
    schemaText: m[1],
  };
}

function parseJsonLoose(text) {
  const cleaned = String(text || "").replace(/^\s*\/\*[\s\S]*?\*\/\s*/, "");
  try {
    return JSON.parse(cleaned);
  } catch {
    return null;
  }
}

function unsupportedReason(body) {
  const liquidBlocks = body.match(/\{%-?\s*liquid\b[\s\S]*?-?%\}/g) || [];
  for (const block of liquidBlocks) {
    if (
      /^\s*for\s+\w+\s+in\s+(collection\.products|search\.results)\b/m.test(
        block,
      )
    ) {
      return "loop-in-liquid-block";
    }
  }
  // The grid usually lives a render or two away; the server follows that
  // chain, so reaching here means no snippet on it had a loop either.
  if (/\{%-?\s*(?:render|include)\b/.test(maskInertBlocks(body))) {
    return "loop-in-snippet";
  }
  return "no-product-loop";
}

export function cleanSchema(schema, name) {
  const out = {};
  for (const key of Object.keys(schema || {})) {
    if (
      key === "presets" ||
      key === "enabled_on" ||
      key === "disabled_on" ||
      key === "templates" ||
      key === "limit" ||
      key === "name"
    ) {
      continue;
    }
    out[key] = schema[key];
  }
  return { name, ...out };
}

/**
 * Transform a section source into the mirror section body + cleaned schema.
 * Returns { ok:false, reason } when the file has no retargetable product loop.
 */
export function transformSectionSource(src, opts) {
  const context = (opts && opts.context) || "collection";
  const stripped = stripInject(String(src || ""));
  const { body: rawBody, schemaText } = splitSchema(stripped);
  let schema = { name: "" };
  if (schemaText != null) {
    const parsed = parseJsonLoose(schemaText);
    if (!parsed) return { ok: false, reason: "schema-parse" };
    schema = parsed;
  }

  const chain = (opts && opts.chain) || [];
  if (!findProductLoops(rawBody).length && !chain.length) {
    return { ok: false, reason: unsupportedReason(rawBody) };
  }
  const { body, warnings } = transformBody(rawBody, context, chain);

  const cleaned = cleanSchema(schema, MIRROR_SCHEMA_NAME);
  const liquid =
    HANDLES_ASSIGN +
    "\n" +
    body.replace(/\s+$/, "") +
    "\n{% schema %}\n" +
    JSON.stringify(cleaned, null, 2) +
    "\n{% endschema %}\n";
  return { ok: true, liquid, schema: cleaned, warnings };
}

/**
 * Mirror copy of a snippet on the render chain: same loop/guard rewrites as
 * the section, render targets in `chain` pointed at their mirror copies, and
 * its own pf_handles assign (render scope is isolated; search.terms is global).
 */
export function transformSnippetSource(src, opts) {
  const context = (opts && opts.context) || "collection";
  const chain = (opts && opts.chain) || [];
  const { body, warnings } = transformBody(
    stripInject(String(src || "")),
    context,
    chain,
  );
  return {
    ok: true,
    liquid: HANDLES_ASSIGN + "\n" + body.replace(/\s+$/, "") + "\n",
    warnings,
  };
}

const HANDLES_ASSIGN =
  "{%- assign pf_handles = search.terms | strip | split: ' ' -%}";

/** Body rewrites shared by section and snippet mirrors. */
function transformBody(rawBody, context, chain) {
  const loops = findProductLoops(rawBody);
  const warnings = [];
  let body = rawBody;
  // Rewrite from the last loop backwards so earlier indices stay valid.
  for (let i = loops.length - 1; i >= 0; i--) {
    const L = loops[i];
    const v = L.loopVar;
    const bodyEnd = L.elseStart !== -1 ? L.elseStart : L.endforStart;
    const inner = body
      .slice(L.headerEnd, bodyEnd)
      .replace(new RegExp("\\b" + v + "\\.object_type\\b", "g"), "'product'");
    const header =
      "{%- for pf_h in pf_handles -%}" +
      "{%- assign " +
      v +
      " = all_products[pf_h] -%}" +
      "{%- if " +
      v +
      " == blank -%}{%- continue -%}{%- endif -%}" +
      CARD_MARK_OPEN +
      "{{ pf_h | escape }}-->";
    body =
      body.slice(0, L.start) +
      header +
      inner +
      CARD_MARK_CLOSE +
      body.slice(bodyEnd);
  }

  if (/\bpaginate\s+collection\.products\b/.test(maskInertBlocks(body))) {
    warnings.push("paginate-rewritten");
  }
  // Empty-state / count guards must follow the handle list: on the search page
  // `search.results` is whatever Shopify found for the handle terms (often
  // nothing), which would render the theme's "no products" branch instead.
  body = replaceOutsideInert(
    body,
    /(?<![\w.])(?:collection\.products|search\.results)(?:\.size|_count)\b/g,
    "pf_handles.size",
  );
  // Snippets handed the already-rendered cards (`render 'product-grid',
  // children: children, products: collection.products`) typically only check
  // the list for emptiness; on the search page that list is usually empty and
  // the snippet would show "No products found" instead of the cards. Give them
  // the handle list: right size, never empty.
  body = replaceOutsideInert(body, /\{%-?\s*render\b[\s\S]*?-?%\}/g, (tag) =>
    tag.replace(
      /(?<![\w.])(?:collection\.products|search\.results)\b/g,
      "pf_handles",
    ),
  );
  // Remaining references (e.g. `paginate collection.products`) need an array
  // that exists on the search page. Settings-scoped ones (`section.settings.
  // collection.products`) are a different collection and are left alone.
  body = replaceOutsideInert(
    body,
    /(?<![\w.])collection\.products\b/g,
    "search.results",
  );
  if (/\bcontent_for\b/.test(body)) warnings.push("content_for");
  if (context === "collection" && /\bcollection\./.test(body)) {
    warnings.push("collection-context-missing");
  }
  if (chain.length) {
    const set = new Set(chain);
    body = replaceOutsideInert(body, RENDER_RE, (m, tag, q, name) =>
      set.has(name) ? "{% " + tag + " " + q + mirrorSnippetName(name) + q : m,
    );
  }
  return { body, warnings };
}

/** The template JSON entry (settings/blocks) for the first section of `type`. */
export function sectionEntryFromTemplate(templateJsonText, sectionType) {
  const data = parseJsonLoose(templateJsonText);
  const sections = data && data.sections;
  if (!sections || typeof sections !== "object") return null;
  const keys = Array.isArray(data.order) ? data.order : Object.keys(sections);
  for (const key of keys) {
    const entry = sections[key];
    if (!entry || entry.type !== sectionType) continue;
    const out = {
      settings:
        entry.settings && typeof entry.settings === "object"
          ? entry.settings
          : {},
    };
    if (entry.blocks && typeof entry.blocks === "object")
      out.blocks = entry.blocks;
    if (Array.isArray(entry.block_order)) out.block_order = entry.block_order;
    return out;
  }
  return null;
}

/** Vintage themes: static section settings live in config/settings_data.json. */
export function settingsFromSettingsData(settingsDataText, sectionName) {
  const data = parseJsonLoose(settingsDataText);
  const current = data && data.current;
  if (!current || typeof current !== "object") return null;
  const entry = current.sections && current.sections[sectionName];
  if (!entry || !entry.settings || typeof entry.settings !== "object")
    return null;
  return entry.settings;
}

/** Copy of `schema` whose setting defaults are the merchant's saved values. */
export function bakeDefaults(schema, settings) {
  const out = JSON.parse(JSON.stringify(schema || {}));
  if (!Array.isArray(out.settings) || !settings) return out;
  out.settings = out.settings.map((s) => {
    if (!s || !s.id || !Object.prototype.hasOwnProperty.call(settings, s.id))
      return s;
    return { ...s, default: settings[s.id] };
  });
  return out;
}

export function buildSearchTemplateJson(entries) {
  const sections = {};
  const order = [];
  for (const e of entries) {
    const section = {
      type: e.type,
      settings: (e.entry && e.entry.settings) || {},
    };
    if (e.entry && e.entry.blocks) section.blocks = e.entry.blocks;
    if (e.entry && e.entry.block_order)
      section.block_order = e.entry.block_order;
    sections[e.key] = section;
    order.push(e.key);
  }
  return JSON.stringify({ sections, order }, null, 2);
}

export function buildSearchTemplateLiquid(sectionNames) {
  return sectionNames.map((n) => "{% section '" + n + "' %}\n").join("");
}

/** Rendered section ids of our mirrors, parsed from a storefront page. */
export function sectionIdsFromHtml(html) {
  const out = {};
  const re =
    /id=["']shopify-section-((?:template--\d+__aco-pf-(collection|search))|aco-pf-theme-cards-(collection|search))["']/g;
  let m;
  while ((m = re.exec(String(html || "")))) {
    const ctx = m[2] || m[3];
    if (!out[ctx]) out[ctx] = m[1];
  }
  return out;
}

export function inputsHash(parts) {
  return createHash("sha1")
    .update((parts || []).join("\u0000"))
    .digest("hex");
}
