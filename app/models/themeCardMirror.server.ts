// Theme card mirror pipeline: read the merchant's grid sections, transform
// them (themeCardMirror.shared.js), write the mirror files + alternate search
// template into the theme, discover the rendered section ids and publish the
// pf_config.theme_cards metafield the storefront reads.
//
// Imports only `.js` siblings so the node:test suite can load this file
// directly; the inject status normally comes from themeInject.server via a
// lazy dynamic import, or is passed in by callers/tests.
import {
  CARD_MARK_OPEN,
  MIRROR_FILES,
  MIRROR_KEYS,
  MIRROR_SECTION_TYPES,
  MIRROR_VIEW,
  TRANSFORM_VERSION,
  bakeDefaults,
  buildSearchTemplateJson,
  buildSearchTemplateLiquid,
  inputsHash,
  loopSnippetClosure,
  mirrorSnippetFile,
  renderedSnippetNames,
  sectionEntryFromTemplate,
  sectionIdsFromHtml,
  settingsFromSettingsData,
  transformSectionSource,
  transformSnippetSource,
} from "./themeCardMirror.shared.js";
import { normalizeSnippetPath } from "./filterConfig.shared";

export type AdminClient = {
  graphql: (
    query: string,
    options?: { variables?: Record<string, unknown> },
  ) => Promise<Response>;
};

export type MirrorContext = "collection" | "search";

export type MirrorEntry = {
  sectionId: string;
  sourceFile: string;
  ok: boolean;
  reason?: string;
};

export type ThemeCardsStatus = {
  version: 1;
  view: "aco-pf";
  mode: "json" | "liquid";
  generatedAt: string;
  collection: MirrorEntry | null;
  search: MirrorEntry | null;
  warnings: string[];
  inputsHash: string;
  /** Snippet copies (`snippets/aco-pf-mirror-*.liquid`) written for the render chain. */
  mirrorFiles?: string[];
};

export type ThemeInjectStatusLike = {
  ok: boolean;
  injected?: boolean;
  themeId: string;
  collectionFile: string | null;
  searchFile: string | null;
  errors: { message: string }[];
};

export type CustomThemeFilesLike = {
  collectionFile?: string | null;
  searchFile?: string | null;
  /** Theme file that holds the product loop, when auto-discovery can't find it. */
  collectionLoopFile?: string | null;
  searchLoopFile?: string | null;
};

type FetchLike = (
  url: string,
  init?: Record<string, unknown>,
) => Promise<{ status: number; ok: boolean; text: () => Promise<string> }>;

export type EnsureOptions = {
  force?: boolean;
  status?: ThemeInjectStatusLike;
  customFiles?: CustomThemeFilesLike;
  themeId?: string;
  fetchImpl?: FetchLike;
};

export type EnsureResult = {
  ok: boolean;
  status: ThemeCardsStatus | null;
  errors: { message: string }[];
  skipped: boolean;
};

const METAFIELD_NAMESPACE = "pf_config";
const METAFIELD_KEY = "theme_cards";
const CONTEXTS: MirrorContext[] = ["collection", "search"];
const TEMPLATE_FILE: Record<MirrorContext, string> = {
  collection: "templates/collection.json",
  search: "templates/search.json",
};
const SETTINGS_DATA_FILE = "config/settings_data.json";
const SCHEMA_BLOCK_RE =
  /\{%-?\s*schema\s*-?%\}[\s\S]*?\{%-?\s*endschema\s*-?%\}/;
// Render-chain walk limits: the grid is rarely more than two renders deep.
const SNIPPET_CHAIN_MAX_DEPTH = 5;
const SNIPPET_CHAIN_MAX_FILES = 40;
const THEME_FILES_PAGE = 50;

// ── GraphQL ──────────────────────────────────────────────────────────────────

const THEME_FILES_QUERY = `#graphql
  query PfThemeFiles($id: ID!, $filenames: [String!]!) {
    theme(id: $id) {
      files(filenames: $filenames, first: 50) {
        nodes {
          filename
          body { ... on OnlineStoreThemeFileBodyText { content } }
        }
      }
    }
  }
`;

const UPSERT_MUTATION = `#graphql
  mutation PfThemeFilesUpsert($themeId: ID!, $files: [OnlineStoreThemeFilesUpsertFileInput!]!) {
    themeFilesUpsert(themeId: $themeId, files: $files) {
      upsertedThemeFiles { filename }
      userErrors { field message }
    }
  }
`;

const DELETE_MUTATION = `#graphql
  mutation PfThemeFilesDelete($themeId: ID!, $files: [String!]!) {
    themeFilesDelete(themeId: $themeId, files: $files) {
      deletedThemeFiles { filename }
      userErrors { field message }
    }
  }
`;

const SHOP_ID_QUERY = `#graphql
  query PfShopId { shop { id } }
`;

const READ_QUERY = `#graphql
  query PfThemeCardsRead {
    shop { metafield(namespace: "${METAFIELD_NAMESPACE}", key: "${METAFIELD_KEY}") { id value } }
  }
`;

const SET_MUTATION = `#graphql
  mutation SetPfThemeCards($metafields: [MetafieldsSetInput!]!) {
    metafieldsSet(metafields: $metafields) { userErrors { field message } }
  }
`;

const DELETE_METAFIELD_MUTATION = `#graphql
  mutation PfThemeCardsDelete($input: MetafieldDeleteInput!) {
    metafieldDelete(input: $input) { deletedId userErrors { field message } }
  }
`;

const FIRST_PRODUCT_QUERY = `#graphql
  query PfFirstProduct {
    products(first: 2, query: "status:active published_status:published") { nodes { handle } }
  }
`;

async function gql(
  admin: AdminClient,
  query: string,
  variables?: Record<string, unknown>,
): Promise<{ data: any; errors: { message: string }[] }> {
  let res;
  try {
    res = await admin.graphql(query, variables ? { variables } : undefined);
  } catch (err) {
    if (err instanceof Response) throw err; // auth redirects must propagate
    const message = err instanceof Error ? err.message : String(err);
    return {
      data: null,
      errors: [{ message: message || "Theme request failed." }],
    };
  }
  const json = (await res.json()) as {
    data?: any;
    errors?: { message: string }[];
  };
  return {
    data: json.data,
    errors: (json.errors || []).map((e) => ({ message: e.message })),
  };
}

async function readThemeFiles(
  admin: AdminClient,
  themeId: string,
  filenames: string[],
): Promise<{ files: Record<string, string>; errors: { message: string }[] }> {
  const { data, errors } = await gql(admin, THEME_FILES_QUERY, {
    id: themeId,
    filenames,
  });
  if (errors.length) return { files: {}, errors };
  const files: Record<string, string> = {};
  for (const n of data?.theme?.files?.nodes || []) {
    if (n?.filename && typeof n.body?.content === "string")
      files[n.filename] = n.body.content;
  }
  return { files, errors: [] };
}

/**
 * Snippets reachable from the section sources through `render`/`include`,
 * keyed by snippet name. Missing files are simply absent. Breadth-first so
 * the depth cap is honest.
 */
async function readSnippetChain(
  admin: AdminClient,
  themeId: string,
  sectionSources: string[],
): Promise<{
  snippets: Record<string, string>;
  errors: { message: string }[];
}> {
  const snippets: Record<string, string> = {};
  const seen = new Set<string>();
  let frontier: string[] = [];
  for (const src of sectionSources) {
    for (const name of renderedSnippetNames(src)) {
      if (!seen.has(name)) {
        seen.add(name);
        frontier.push(name);
      }
    }
  }
  for (
    let depth = 0;
    depth < SNIPPET_CHAIN_MAX_DEPTH && frontier.length;
    depth++
  ) {
    const batch = frontier.slice(
      0,
      SNIPPET_CHAIN_MAX_FILES - Object.keys(snippets).length,
    );
    if (!batch.length) break;
    for (let i = 0; i < batch.length; i += THEME_FILES_PAGE) {
      const names = batch.slice(i, i + THEME_FILES_PAGE);
      const { files, errors } = await readThemeFiles(
        admin,
        themeId,
        names.map((n) => "snippets/" + n + ".liquid"),
      );
      if (errors.length) return { snippets, errors };
      for (const n of names) {
        const body = files["snippets/" + n + ".liquid"];
        if (body != null) snippets[n] = body;
      }
    }
    const next: string[] = [];
    for (const n of batch) {
      if (snippets[n] == null) continue;
      for (const child of renderedSnippetNames(snippets[n])) {
        if (!seen.has(child)) {
          seen.add(child);
          next.push(child);
        }
      }
    }
    frontier = next;
  }
  return { snippets, errors: [] };
}

async function upsertThemeFiles(
  admin: AdminClient,
  themeId: string,
  files: { filename: string; body: string }[],
): Promise<{ message: string }[]> {
  const { data, errors } = await gql(admin, UPSERT_MUTATION, {
    themeId,
    files: files.map((f) => ({
      filename: f.filename,
      body: { type: "TEXT", value: f.body },
    })),
  });
  if (errors.length) return errors;
  return (data?.themeFilesUpsert?.userErrors || []).map((e: any) => ({
    message: String(e.message || "Theme file write failed"),
  }));
}

async function deleteThemeFiles(
  admin: AdminClient,
  themeId: string,
  files: string[],
): Promise<{ message: string }[]> {
  if (!files.length) return [];
  const { data, errors } = await gql(admin, DELETE_MUTATION, {
    themeId,
    files,
  });
  if (errors.length) return errors;
  return (
    (data?.themeFilesDelete?.userErrors || [])
      .map((e: any) => ({
        message: String(e.message || "Theme file delete failed"),
      }))
      // Already gone is fine: only one of the two search templates ever exists.
      .filter((e: { message: string }) => !/does not exist/i.test(e.message))
  );
}

// ── Metafield ────────────────────────────────────────────────────────────────

export async function readThemeCardsStatus(
  admin: AdminClient,
): Promise<ThemeCardsStatus | null> {
  const { data } = await gql(admin, READ_QUERY);
  const raw = data?.shop?.metafield?.value;
  if (!raw) return null;
  try {
    const parsed = JSON.parse(raw);
    return parsed && parsed.version === 1 ? (parsed as ThemeCardsStatus) : null;
  } catch {
    return null;
  }
}

async function writeThemeCardsStatus(
  admin: AdminClient,
  status: ThemeCardsStatus,
): Promise<{ message: string }[]> {
  const { data: shopData } = await gql(admin, SHOP_ID_QUERY);
  const shopId = shopData?.shop?.id;
  if (!shopId) return [{ message: "Could not resolve shop id" }];
  const { data, errors } = await gql(admin, SET_MUTATION, {
    metafields: [
      {
        ownerId: shopId,
        namespace: METAFIELD_NAMESPACE,
        key: METAFIELD_KEY,
        type: "json",
        value: JSON.stringify(status),
      },
    ],
  });
  if (errors.length) return errors;
  return data?.metafieldsSet?.userErrors || [];
}

async function deleteThemeCardsMetafield(admin: AdminClient): Promise<void> {
  const { data } = await gql(admin, READ_QUERY);
  const id = data?.shop?.metafield?.id;
  if (!id) return;
  await gql(admin, DELETE_METAFIELD_MUTATION, { input: { id } });
}

// ── Pipeline ─────────────────────────────────────────────────────────────────

function basename(file: string): string {
  return file.replace(/^.*\//, "").replace(/\.liquid$/, "");
}

function replaceSchema(liquid: string, schema: object): string {
  return liquid.replace(
    /\{% schema %\}[\s\S]*?\{% endschema %\}/,
    () =>
      "{% schema %}\n" + JSON.stringify(schema, null, 2) + "\n{% endschema %}",
  );
}

async function resolveInjectStatus(
  admin: AdminClient,
  opts: EnsureOptions,
): Promise<ThemeInjectStatusLike> {
  if (opts.status) return opts.status;
  const mod = await import("./themeInject.server.ts");
  return mod.getThemeInjectStatus(
    admin,
    opts.customFiles ?? undefined,
    opts.themeId,
  );
}

/**
 * An unchanged inputs hash is not enough to skip: the merchant may have
 * deleted the mirror files in the editor, or discovery may have failed last
 * time (empty sectionId) and deserves a retry.
 */
function mirrorIsCurrent(
  status: ThemeCardsStatus,
  files: Record<string, string>,
): boolean {
  const template =
    status.mode === "json"
      ? MIRROR_FILES.templateJson
      : MIRROR_FILES.templateLiquid;
  if (files[template] == null) return false;
  // Server-side discovery can never succeed on a password-protected
  // storefront: the storefront JS discovers the ids itself (it has the cookie).
  // Treat that as terminal so every settings load/save doesn't rewrite the
  // theme and re-trigger the themes/update webhook.
  const discoveryTerminal = (status.warnings || []).includes(
    "section-id-discovery-failed:password",
  );
  for (const ctx of CONTEXTS) {
    const entry = status[ctx];
    if (!entry || !entry.ok) continue;
    if (!entry.sectionId && !discoveryTerminal) return false;
    if (files[MIRROR_FILES[ctx]] == null) return false;
  }
  for (const f of status.mirrorFiles || []) {
    if (files[f] == null) return false;
  }
  return true;
}

function discoveryUrl(shopDomain: string): string {
  return (
    "https://" + shopDomain + "/search?view=" + MIRROR_VIEW + "&q=aco-pf-probe"
  );
}

export async function ensureThemeCardMirror(
  admin: AdminClient,
  shopDomain: string,
  opts: EnsureOptions = {},
): Promise<EnsureResult> {
  const fetchImpl: FetchLike =
    opts.fetchImpl || (globalThis.fetch as unknown as FetchLike);
  const inject = await resolveInjectStatus(admin, opts);
  if (!inject.ok)
    return { ok: false, status: null, errors: inject.errors, skipped: false };
  if (inject.injected === false) {
    return {
      ok: false,
      status: null,
      errors: [
        {
          message:
            "Inject the filters into the theme before using theme product cards.",
        },
      ],
      skipped: false,
    };
  }
  if (!inject.collectionFile && !inject.searchFile) {
    return {
      ok: false,
      status: null,
      errors: [
        { message: "Could not find a product-grid section in the theme." },
      ],
      skipped: false,
    };
  }

  const sources: Record<MirrorContext, string | null> = {
    collection: inject.collectionFile,
    search: inject.searchFile,
  };
  // Developer override: mirror this file's loop instead of walking the section.
  const overrides: Record<MirrorContext, string> = {
    collection: normalizeSnippetPath(opts.customFiles?.collectionLoopFile),
    search: normalizeSnippetPath(opts.customFiles?.searchLoopFile),
  };
  const wanted = [
    sources.collection,
    sources.search,
    overrides.collection,
    overrides.search,
    TEMPLATE_FILE.collection,
    TEMPLATE_FILE.search,
    SETTINGS_DATA_FILE,
    MIRROR_FILES.collection,
    MIRROR_FILES.search,
    MIRROR_FILES.templateJson,
    MIRROR_FILES.templateLiquid,
  ].filter((f): f is string => Boolean(f));
  const { files, errors: readErrors } = await readThemeFiles(
    admin,
    inject.themeId,
    wanted,
  );
  if (readErrors.length)
    return { ok: false, status: null, errors: readErrors, skipped: false };

  // Themes often keep the product loop a render or two below the section;
  // every snippet on a path to a loop gets its own mirror copy.
  const loopSource = (c: MirrorContext): string | undefined =>
    files[overrides[c] || sources[c] || ""];
  const chainRead = await readSnippetChain(
    admin,
    inject.themeId,
    CONTEXTS.map((c) => loopSource(c)).filter(
      (s): s is string => typeof s === "string",
    ),
  );
  if (chainRead.errors.length)
    return {
      ok: false,
      status: null,
      errors: chainRead.errors,
      skipped: false,
    };
  const snippets = chainRead.snippets;
  const closure: Record<MirrorContext, string[]> = {
    collection: [],
    search: [],
  };
  for (const ctx of CONTEXTS) {
    const src = loopSource(ctx);
    if (typeof src === "string")
      closure[ctx] = loopSnippetClosure(src, snippets);
  }
  const mirrored = [
    ...new Set([...closure.collection, ...closure.search]),
  ].sort();
  const mirrorFiles = mirrored.map(mirrorSnippetFile);
  if (mirrorFiles.length) {
    const extra = await readThemeFiles(admin, inject.themeId, mirrorFiles);
    if (extra.errors.length)
      return { ok: false, status: null, errors: extra.errors, skipped: false };
    Object.assign(files, extra.files);
  }

  const mode: ThemeCardsStatus["mode"] =
    files[TEMPLATE_FILE.search] != null ? "json" : "liquid";
  const hash = inputsHash([
    TRANSFORM_VERSION,
    // A duplicated theme carries identical files but renders different
    // section ids, so the mirror is only current for the theme it was built on.
    inject.themeId,
    mode,
    files[sources.collection || ""] || "",
    files[sources.search || ""] || "",
    files[TEMPLATE_FILE.collection] || "",
    files[TEMPLATE_FILE.search] || "",
    mode === "liquid" ? files[SETTINGS_DATA_FILE] || "" : "",
    mirrored.join(","),
    ...mirrored.map((n) => snippets[n] || ""),
    overrides.collection,
    overrides.search,
    files[overrides.collection] || "",
    files[overrides.search] || "",
  ]);

  const existing = await readThemeCardsStatus(admin);
  if (
    !opts.force &&
    existing &&
    existing.inputsHash === hash &&
    mirrorIsCurrent(existing, files)
  ) {
    return { ok: true, status: existing, errors: [], skipped: true };
  }

  const warnings: string[] = [];
  const entries: Record<MirrorContext, MirrorEntry | null> = {
    collection: null,
    search: null,
  };
  const sectionWrites: { filename: string; body: string }[] = [];
  const templateEntries: { key: string; type: string; entry: any }[] = [];

  for (const ctx of CONTEXTS) {
    const sourceFile = sources[ctx];
    if (!sourceFile) continue;
    const src = files[sourceFile];
    if (src == null) {
      entries[ctx] = {
        sectionId: "",
        sourceFile,
        ok: false,
        reason: "source-missing",
      };
      continue;
    }
    const sectionName = basename(sourceFile);
    let transformSrc = src;
    let recordedSource = sourceFile;
    if (overrides[ctx]) {
      const overrideSrc = files[overrides[ctx]];
      if (overrideSrc == null) {
        entries[ctx] = {
          sectionId: "",
          sourceFile: overrides[ctx],
          ok: false,
          reason: "loop-file-missing",
        };
        continue;
      }
      // The override supplies the loop; the real section's schema keeps the
      // template settings valid.
      const schema = SCHEMA_BLOCK_RE.exec(src);
      transformSrc = overrideSrc + "\n" + (schema ? schema[0] : "");
      recordedSource = overrides[ctx];
    }
    const out = transformSectionSource(transformSrc, {
      context: ctx,
      sectionName,
      chain: closure[ctx],
    });
    if (!out.ok) {
      entries[ctx] = {
        sectionId: "",
        sourceFile: recordedSource,
        ok: false,
        reason: String(out.reason || "unknown"),
      };
      continue;
    }
    for (const w of out.warnings || []) warnings.push(ctx + ":" + w);
    let liquid: string = out.liquid || "";
    if (mode === "json") {
      templateEntries.push({
        key: MIRROR_KEYS[ctx],
        type: MIRROR_SECTION_TYPES[ctx],
        entry: sectionEntryFromTemplate(
          files[TEMPLATE_FILE[ctx]] || "",
          sectionName,
        ),
      });
    } else {
      const saved = settingsFromSettingsData(
        files[SETTINGS_DATA_FILE] || "",
        sectionName,
      );
      if (saved) {
        liquid = replaceSchema(liquid, bakeDefaults(out.schema || {}, saved));
      } else warnings.push(ctx + ":settings-data-missing");
    }
    sectionWrites.push({ filename: MIRROR_FILES[ctx], body: liquid });
    entries[ctx] = { sectionId: "", sourceFile: recordedSource, ok: true };
  }

  for (const name of mirrored) {
    const ctx: MirrorContext = closure.collection.includes(name)
      ? "collection"
      : "search";
    const out = transformSnippetSource(snippets[name], {
      context: ctx,
      chain: mirrored,
    });
    for (const w of out.warnings || [])
      warnings.push("snippet:" + name + ":" + w);
    sectionWrites.unshift({
      filename: mirrorSnippetFile(name),
      body: out.liquid,
    });
  }

  const status: ThemeCardsStatus = {
    version: 1,
    view: "aco-pf",
    mode,
    generatedAt: new Date().toISOString(),
    collection: entries.collection,
    search: entries.search,
    warnings,
    inputsHash: hash,
    mirrorFiles,
  };

  const anyOk = CONTEXTS.some((c) => entries[c]?.ok);
  if (!anyOk) {
    await writeThemeCardsStatus(admin, status);
    const reasons = CONTEXTS.map((c) => entries[c]?.reason)
      .filter(Boolean)
      .join(", ");
    return {
      ok: false,
      status,
      errors: [
        {
          message:
            "The theme's product grid section can't be mirrored (" +
            reasons +
            ").",
        },
      ],
      skipped: false,
    };
  }

  const upsertErrors = await upsertThemeFiles(
    admin,
    inject.themeId,
    sectionWrites,
  );
  if (upsertErrors.length)
    return { ok: false, status: null, errors: upsertErrors, skipped: false };

  const templateWrite =
    mode === "json"
      ? {
          filename: MIRROR_FILES.templateJson,
          body: buildSearchTemplateJson(templateEntries),
        }
      : {
          filename: MIRROR_FILES.templateLiquid,
          body: buildSearchTemplateLiquid(
            CONTEXTS.filter((c) => entries[c]?.ok).map(
              (c) => MIRROR_SECTION_TYPES[c],
            ),
          ),
        };
  const templateErrors = await upsertThemeFiles(admin, inject.themeId, [
    templateWrite,
  ]);
  if (templateErrors.length)
    return { ok: false, status: null, errors: templateErrors, skipped: false };

  const stale =
    mode === "json" ? MIRROR_FILES.templateLiquid : MIRROR_FILES.templateJson;
  if (files[stale] != null) {
    const delErrors = await deleteThemeFiles(admin, inject.themeId, [stale]);
    if (delErrors.length) warnings.push("stale-template-delete-failed");
  }

  try {
    const res = await fetchImpl(discoveryUrl(shopDomain), {
      headers: { accept: "text/html" },
      redirect: "follow",
    });
    const html = res.status === 200 ? await res.text() : "";
    if (res.status === 200 && /action=["'][^"']*\/password["']/.test(html)) {
      // Password-protected storefront: the server only ever sees the password
      // page. The storefront JS discovers the ids itself (it has the cookie).
      warnings.push("section-id-discovery-failed:password");
    } else if (res.status === 200) {
      const ids = sectionIdsFromHtml(html) as Partial<
        Record<MirrorContext, string>
      >;
      for (const ctx of CONTEXTS) {
        const entry = entries[ctx];
        if (!entry || !entry.ok) continue;
        const found = ids[ctx];
        if (found) entry.sectionId = found;
        else warnings.push("section-id-not-found:" + ctx);
      }
    } else {
      warnings.push("section-id-discovery-failed:" + res.status);
    }
  } catch (err) {
    warnings.push("section-id-discovery-failed:error");
  }

  const mfErrors = await writeThemeCardsStatus(admin, status);
  if (mfErrors.length)
    return { ok: false, status, errors: mfErrors, skipped: false };
  return { ok: true, status, errors: [], skipped: false };
}

export async function probeThemeCardMirror(
  admin: AdminClient,
  shopDomain: string,
  opts: { fetchImpl?: FetchLike } = {},
): Promise<{ ok: boolean; message: string; excerpt?: string }> {
  const fetchImpl: FetchLike =
    opts.fetchImpl || (globalThis.fetch as unknown as FetchLike);
  const status = await readThemeCardsStatus(admin);
  const entry =
    status &&
    status.collection &&
    status.collection.ok &&
    status.collection.sectionId
      ? status.collection
      : status && status.search && status.search.ok && status.search.sectionId
        ? status.search
        : null;
  if (!entry) {
    return {
      ok: false,
      message: "No theme card mirror is ready yet — click Regenerate.",
    };
  }

  const { data } = await gql(admin, FIRST_PRODUCT_QUERY);
  const handles: string[] = (data?.products?.nodes || [])
    .map((n: any) => String(n?.handle || ""))
    .filter(Boolean);
  if (!handles.length)
    return { ok: false, message: "No published product found to test with." };

  // Two handles so a search that happens to match one product title can't
  // mask a mirror that ignores the handle list.
  const url =
    "https://" +
    shopDomain +
    "/search?view=" +
    MIRROR_VIEW +
    "&type=product&q=" +
    encodeURIComponent(handles.join(" ")) +
    "&section_id=" +
    encodeURIComponent(entry.sectionId);
  let res: { status: number; text: () => Promise<string> };
  try {
    res = await fetchImpl(url, {
      headers: { accept: "text/html" },
      redirect: "follow",
    });
  } catch (err) {
    return {
      ok: false,
      message: "Could not reach the storefront: " + (err as Error).message,
    };
  }
  if (res.status === 404) {
    return {
      ok: false,
      message: "Section not found (HTTP 404) — click Regenerate",
    };
  }
  const body = await res.text();
  if (/action=["'][^"']*\/password["']/.test(body)) {
    return {
      ok: false,
      message: "Store is password protected; verify on the storefront",
    };
  }
  if (res.status !== 200) {
    return {
      ok: false,
      message: "Theme card request failed (HTTP " + res.status + ")",
    };
  }
  const missing = handles.filter(
    (h) => body.indexOf(CARD_MARK_OPEN + h + "-->") === -1,
  );
  if (missing.length === handles.length) {
    return {
      ok: false,
      message:
        "Rendered but no card markers — theme section may be unsupported",
      excerpt: body
        .replace(/<[^>]+>/g, " ")
        .replace(/\s+/g, " ")
        .trim()
        .slice(0, 300),
    };
  }
  if (missing.length) {
    return {
      ok: false,
      message:
        "Rendered, but no card came back for: " +
        missing.join(", ") +
        " — the mirror may not be reading the handle list",
    };
  }
  return { ok: true, message: "Theme card rendered OK" };
}

export async function removeThemeCardMirror(
  admin: AdminClient,
  themeId: string,
): Promise<{ errors: { message: string }[] }> {
  // Snippet copies are only known from the status; without it the fixed
  // files still go.
  const status = await readThemeCardsStatus(admin).catch(() => null);
  const errors = await deleteThemeFiles(admin, themeId, [
    MIRROR_FILES.collection,
    MIRROR_FILES.search,
    MIRROR_FILES.templateJson,
    MIRROR_FILES.templateLiquid,
    ...(status?.mirrorFiles || []),
  ]);
  try {
    await deleteThemeCardsMetafield(admin);
  } catch (err) {
    errors.push({ message: "Could not delete theme_cards metafield" });
  }
  return { errors };
}
