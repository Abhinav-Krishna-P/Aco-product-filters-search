export const INJECT_START =
  "{% comment %} ACO_PF_INJECT_START {% endcomment %}";
export const INJECT_RENDER = "{% render 'aco-product-filters' %}";
export const INJECT_END = "{% comment %} ACO_PF_INJECT_END {% endcomment %}";

export const COLLECTION_SECTION_FILES = [
  "sections/main-collection-product-grid.liquid",
  "sections/main-collection.liquid",
  "sections/collection.liquid",
  "sections/collection-template.liquid",
  "sections/main-collection-template.liquid",
  "sections/template-collection.liquid",
  "templates/collection.liquid",
];

export const SEARCH_SECTION_FILES = [
  "sections/main-search.liquid",
  "sections/search-results.liquid",
  "sections/main-search-results.liquid",
  "sections/search.liquid",
  "sections/search-template.liquid",
  "sections/template-search.liquid",
  "templates/search.liquid",
];

export function injectBlock() {
  return INJECT_START + "\n" + INJECT_RENDER + "\n" + INJECT_END + "\n";
}

export function alreadyInjected(body) {
  return String(body || "").includes("ACO_PF_INJECT_START");
}

export function prependInject(body) {
  const src = String(body || "");
  if (alreadyInjected(src)) return src;
  return injectBlock() + src;
}

function insertAt(src, index) {
  return src.slice(0, index) + injectBlock() + src.slice(index);
}

function searchHeaderEnd(src) {
  const header =
    /<div\b[^>]*class=["'][^"']*\btemplate-search__header\b[^"']*["'][^>]*>/i.exec(
      src,
    );
  if (header?.index == null) return -1;

  const tags = /<\/?div\b[^>]*>/gi;
  tags.lastIndex = header.index + header[0].length;
  let depth = 1;
  let tag;
  while ((tag = tags.exec(src))) {
    if (tag[0].startsWith("</")) depth -= 1;
    else depth += 1;
    if (depth === 0) return tags.lastIndex;
  }
  return -1;
}

export function injectSearch(body) {
  let src = String(body || "");
  if (alreadyInjected(src)) src = stripInject(src);

  // Keep native search headers and sort controls above the app.
  // Supports Dawn (ProductGridContainer / product-grid) and Horizon/Dwell (search-results, etc.)
  const results =
    /<(?:div|ul|section)\b[^>]*\b(?:id=["'](?:ProductGridContainer|product-grid|SearchResults|search-results)["']|class=["'][^"']*\b(?:ProductGridContainer|product-grid|search-results__grid|search-results)\b[^"']*["'])[^>]*>/i.exec(
      src,
    );
  if (results?.index != null) {
    return insertAt(src, results.index);
  }

  // Older Dawn-like sections may not expose a stable results-container id.
  const headerEnd = searchHeaderEnd(src);
  if (headerEnd !== -1) return insertAt(src, headerEnd);

  // Preserve injection for custom sections that do not expose either marker.
  return prependInject(src);
}

export function stripInject(body) {
  return String(body || "").replace(
    /\{%\s*comment\s*%\}\s*ACO_PF_INJECT_START\s*\{%\s*endcomment\s*%\}[\s\S]*?\{%\s*comment\s*%\}\s*ACO_PF_INJECT_END\s*\{%\s*endcomment\s*%\}\r?\n?/g,
    "",
  );
}

/** Same-length copy with comment/raw blocks blanked out (indices stay valid). */
function maskInert(src) {
  return String(src || "").replace(
    /\{%-?\s*(comment|raw)\s*-?%\}[\s\S]*?\{%-?\s*end\1\s*-?%\}/g,
    (m) => " ".repeat(m.length),
  );
}

/**
 * Insert the block before the first real (non-commented) occurrence of a
 * plain-text marker; falls back to the top when the marker is absent.
 */
export function injectBefore(body, marker, fallback = prependInject) {
  let src = String(body || "");
  if (alreadyInjected(src)) src = stripInject(src);
  const m = String(marker || "").trim();
  const idx = m ? maskInert(src).indexOf(m) : -1;
  if (idx === -1) return { body: fallback(src), found: false };
  return { body: insertAt(src, idx), found: true };
}

// Tags that never are the theme's filter/grid wrapper.
const CANDIDATE_NOISE = new Set([
  "script",
  "style",
  "link",
  "meta",
  "noscript",
  "br",
  "img",
  "svg",
  "path",
  "input",
  "label",
  "span",
  "li",
  "option",
  "select",
  "textarea",
  "button",
  "a",
  "p",
  "h1",
  "h2",
  "h3",
  "h4",
  "h5",
  "h6",
  "small",
  "strong",
  "em",
  "i",
  "b",
  "template",
  "slot",
]);

/**
 * Elements in a section's source that support could hide: `#id` when static,
 * the bare tag for custom elements, `tag.class` for plain containers with a
 * static class. Liquid output/tags are blanked so templated attributes never
 * produce a selector. Source order, deduped, at most 30.
 */
export function nativeElementCandidates(sectionSrc) {
  // Liquid is blanked with a sentinel (not spaces) so a class token cut by
  // output like `grid-{{ x }}` is not read as the static class `grid-`.
  const html = maskInert(stripInject(String(sectionSrc || ""))).replace(
    /\{%[\s\S]*?%\}|\{\{[\s\S]*?\}\}/g,
    (m) => "\u0000".repeat(m.length),
  );
  const re = /<([a-zA-Z][\w-]*)([^<>]*)>/g;
  const out = [];
  const seen = new Set();
  let m;
  while ((m = re.exec(html)) && out.length < 30) {
    const tag = m[1].toLowerCase();
    if (CANDIDATE_NOISE.has(tag)) continue;
    const attrs = m[2];
    const id = /\bid=["']([A-Za-z_][\w-]*)["']/.exec(attrs);
    const cls = /\bclass=["']\s*([A-Za-z_][\w-]*)(?=[\s"'])/.exec(attrs);
    let selector = null;
    if (id) selector = "#" + id[1];
    else if (tag.includes("-")) selector = tag;
    else if (cls) selector = tag + "." + cls[1];
    if (!selector || seen.has(selector)) continue;
    seen.add(selector);
    out.push({ selector, tag });
  }
  return out;
}

export function pickFirstExisting(candidates, existing) {
  const set = existing instanceof Set ? existing : new Set(existing || []);
  for (const candidate of candidates) {
    if (set.has(candidate)) return candidate;
  }
  return null;
}

export function normalizeThemeFilePath(raw) {
  if (!raw || typeof raw !== "string") return "";
  let clean = raw.trim().replace(/\\/g, "/").replace(/^\/+/, "");
  if (!clean) return "";
  if (!clean.endsWith(".liquid")) {
    clean += ".liquid";
  }
  if (!clean.includes("/")) {
    clean = "sections/" + clean;
  }
  return clean;
}
