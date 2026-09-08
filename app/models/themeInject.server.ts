import { createHash } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import {
  COLLECTION_SECTION_FILES,
  SEARCH_SECTION_FILES,
  alreadyInjected,
  injectSearch,
  injectBefore,
  nativeElementCandidates,
  normalizeThemeFilePath,
  pickFirstExisting,
  prependInject,
  stripInject,
} from "./themeInject.shared.js";
import {
  ensureThemeCardMirror,
  removeThemeCardMirror,
} from "./themeCardMirror.server.ts";
import { MIRROR_FILES } from "./themeCardMirror.shared.js";
import { describeAdminError } from "./adminErrors.server.ts";

export type AdminClient = {
  graphql: (
    query: string,
    options?: { variables?: Record<string, unknown> },
  ) => Promise<Response>;
};

export type CustomThemeFiles = {
  collectionFile?: string | null;
  searchFile?: string | null;
  /** Plain text the ACO block is inserted before (both pages); "" = top. */
  injectBefore?: string | null;
  collectionLoopFile?: string | null;
  searchLoopFile?: string | null;
};

export type ThemeInjectStatus = {
  ok: boolean;
  injected: boolean;
  collectionInjected: boolean;
  searchInjected: boolean;
  themeId: string;
  themeName: string;
  collectionFile: string | null;
  searchFile: string | null;
  errors: { message: string }[];
  warnings?: { message: string }[];
};

export type ThemeInjectTarget = "collection" | "search" | "both";

export type ThemeOption = {
  id: string;
  name: string;
  role: string;
};

const COPY_FILES: { dest: string; src: string }[] = [
  {
    dest: "snippets/aco-product-filters.liquid",
    src: "app/theme-inject/aco-product-filters.liquid",
  },
  {
    dest: "snippets/aco-pf-config-group.liquid",
    src: "extensions/filter-search/snippets/pf-config-group.liquid",
  },
  {
    dest: "snippets/aco-pf-sort.liquid",
    src: "extensions/filter-search/snippets/pf-sort.liquid",
  },
  {
    dest: "snippets/aco-pf-product-grid.liquid",
    src: "extensions/filter-search/snippets/pf-product-grid.liquid",
  },
  {
    dest: "assets/aco-pf-filters.css",
    src: "extensions/filter-search/assets/pf-filters.css",
  },
  {
    dest: "assets/aco-pf-filters.js",
    src: "extensions/filter-search/assets/pf-filters.js",
  },
  {
    dest: "assets/aco-pf-variant-picker.shared.js",
    src: "extensions/filter-search/assets/pf-variant-picker.shared.js",
  },
];

export const INJECTED_THEME_FILES: string[] = COPY_FILES.map(
  (c) => c.dest,
).concat([
  MIRROR_FILES.collection,
  MIRROR_FILES.search,
  MIRROR_FILES.templateJson,
  MIRROR_FILES.templateLiquid,
]);

const THEME_FILES_QUERY = `#graphql
  query PfThemeFiles($id: ID!, $filenames: [String!]!) {
    theme(id: $id) {
      id
      name
      files(filenames: $filenames, first: 50) {
        nodes {
          filename
          body {
            ... on OnlineStoreThemeFileBodyText {
              content
            }
          }
        }
      }
    }
  }
`;

// Checksums only (no bodies): lets asset sync skip files that are already
// current instead of re-uploading ~250 KB on every Settings page load.
const THEME_FILE_CHECKSUMS_QUERY = `#graphql
  query PfThemeFileChecksums($id: ID!, $filenames: [String!]!) {
    theme(id: $id) {
      files(filenames: $filenames, first: 50) {
        nodes { filename checksumMd5 }
      }
    }
  }
`;

const MAIN_THEME_QUERY = `#graphql
  query PfMainTheme {
    themes(first: 5, roles: [MAIN]) {
      nodes { id name role }
    }
  }
`;

const THEMES_QUERY = `#graphql
  query PfThemes {
    themes(first: 20) {
      nodes { id name role }
    }
  }
`;

const THEME_QUERY = `#graphql
  query PfTheme($id: ID!) {
    theme(id: $id) { id name role }
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

function readProjectFile(rel: string): string {
  return fs.readFileSync(path.join(process.cwd(), rel), "utf8");
}

/**
 * Shopify refuses theme-file access on paid themes that are still on trial.
 * The API client throws ("Access denied") rather than returning a GraphQL
 * error, so it is normalised here into a message the admin can act on.
 */
export function describeThemeApiError(err: unknown): string {
  return describeAdminError(err);
}

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
    return { data: null, errors: [{ message: describeThemeApiError(err) }] };
  }
  const json = (await res.json()) as {
    data?: any;
    errors?: { message: string }[];
  };
  const errors = (json.errors || []).map((e) => ({ message: e.message }));
  return { data: json.data, errors };
}

async function mainTheme(
  admin: AdminClient,
  themeId?: string,
): Promise<{ id: string; name: string } | { errors: { message: string }[] }> {
  if (themeId) {
    const { data, errors } = await gql(admin, THEME_QUERY, { id: themeId });
    if (errors.length) return { errors };
    const theme = data?.theme;
    if (!theme?.id) {
      return { errors: [{ message: "The selected theme was not found." }] };
    }
    return { id: theme.id, name: theme.name || "Selected theme" };
  }

  const { data, errors } = await gql(admin, MAIN_THEME_QUERY);
  if (errors.length) return { errors };
  const node = data?.themes?.nodes?.[0];
  if (!node?.id)
    return { errors: [{ message: "No published (MAIN) theme found." }] };
  return { id: node.id, name: node.name || "Published theme" };
}

export async function listThemes(
  admin: AdminClient,
): Promise<{ themes: ThemeOption[]; errors: { message: string }[] }> {
  const { data, errors } = await gql(admin, THEMES_QUERY);
  if (errors.length) return { themes: [], errors };
  const themes = (data?.themes?.nodes || [])
    .filter((theme: any) => theme?.id)
    .map((theme: any) => ({
      id: String(theme.id),
      name: String(theme.name || "Untitled theme"),
      role: String(theme.role || "UNPUBLISHED"),
    }))
    .sort((a: ThemeOption, b: ThemeOption) => {
      if (a.role === "MAIN") return -1;
      if (b.role === "MAIN") return 1;
      return a.name.localeCompare(b.name);
    });
  return { themes, errors: [] };
}

function fileContent(node: any): string {
  const body = node?.body;
  if (!body) return "";
  if (typeof body.content === "string") return body.content;
  return "";
}

async function readThemeFiles(
  admin: AdminClient,
  themeId: string,
  filenames: string[],
): Promise<{
  nodes: { filename: string; content: string }[];
  errors: { message: string }[];
}> {
  const { data, errors } = await gql(admin, THEME_FILES_QUERY, {
    id: themeId,
    filenames,
  });
  if (errors.length) return { nodes: [], errors };
  const nodes = (data?.theme?.files?.nodes || []).map((n: any) => ({
    filename: String(n.filename || ""),
    content: fileContent(n),
  }));
  return { nodes, errors: [] };
}

/**
 * Copy-file writes whose content differs from the theme's. Shopify reports
 * checksumMd5 per file; both hex and base64 digests are accepted. If the
 * checksums can't be read, every file is written (the old behaviour).
 */
export async function changedThemeFiles(
  admin: AdminClient,
  themeId: string,
  files: { filename: string; body: string }[],
): Promise<{ filename: string; body: string }[]> {
  const { data, errors } = await gql(admin, THEME_FILE_CHECKSUMS_QUERY, {
    id: themeId,
    filenames: files.map((f) => f.filename),
  });
  if (errors.length) return files;
  const remote = new Map<string, string>(
    (data?.theme?.files?.nodes || []).map((n: any) => [
      String(n.filename || ""),
      String(n.checksumMd5 || ""),
    ]),
  );
  return files.filter((f) => {
    const theirs = remote.get(f.filename);
    if (!theirs) return true;
    const digest = createHash("md5").update(f.body, "utf8").digest();
    return (
      theirs !== digest.toString("hex") && theirs !== digest.toString("base64")
    );
  });
}

async function upsertThemeFiles(
  admin: AdminClient,
  themeId: string,
  files: { filename: string; body: string }[],
): Promise<{ errors: { message: string }[] }> {
  const { data, errors } = await gql(admin, UPSERT_MUTATION, {
    themeId,
    files: files.map((f) => ({
      filename: f.filename,
      body: { type: "TEXT", value: f.body },
    })),
  });
  if (errors.length) return { errors };
  const userErrors = (data?.themeFilesUpsert?.userErrors || []).map(
    (e: any) => ({
      message: String(e.message || "Theme file write failed"),
    }),
  );
  return { errors: userErrors };
}

export async function deleteThemeFiles(
  admin: AdminClient,
  themeId: string,
  files: string[],
): Promise<{ errors: { message: string }[] }> {
  if (!files.length) return { errors: [] };
  const { data, errors } = await gql(admin, DELETE_MUTATION, {
    themeId,
    files,
  });
  if (errors.length) return { errors };
  const userErrors = (data?.themeFilesDelete?.userErrors || [])
    .map((e: any) => ({
      message: String(e.message || "Theme file delete failed"),
    }))
    // Already gone is the outcome we wanted (e.g. only one of the json/liquid
    // search templates ever exists), so it is not an error.
    .filter((e: { message: string }) => !/does not exist/i.test(e.message));
  return { errors: userErrors };
}

export async function getThemeInjectStatus(
  admin: AdminClient,
  customFiles?: CustomThemeFiles,
  themeId?: string,
): Promise<ThemeInjectStatus> {
  const theme = await mainTheme(admin, themeId);
  if ("errors" in theme) {
    return {
      ok: false,
      injected: false,
      collectionInjected: false,
      searchInjected: false,
      themeId: "",
      themeName: "",
      collectionFile: null,
      searchFile: null,
      errors: theme.errors,
    };
  }

  const customCollection = customFiles?.collectionFile
    ? normalizeThemeFilePath(customFiles.collectionFile)
    : null;
  const customSearch = customFiles?.searchFile
    ? normalizeThemeFilePath(customFiles.searchFile)
    : null;

  const candidates = [
    ...(customCollection ? [customCollection] : []),
    ...(customSearch ? [customSearch] : []),
    ...COLLECTION_SECTION_FILES,
    ...SEARCH_SECTION_FILES,
  ];
  const { nodes, errors } = await readThemeFiles(admin, theme.id, candidates);
  if (errors.length) {
    return {
      ok: false,
      injected: false,
      collectionInjected: false,
      searchInjected: false,
      themeId: theme.id,
      themeName: theme.name,
      collectionFile: null,
      searchFile: null,
      errors,
    };
  }
  const existing = new Set(nodes.map((n) => n.filename));
  const fileErrors: { message: string }[] = [];

  let collectionFile: string | null = null;
  if (customCollection) {
    if (existing.has(customCollection)) {
      collectionFile = customCollection;
    } else {
      fileErrors.push({
        message: `Custom collection section file "${customCollection}" was not found in theme (${theme.name}).`,
      });
    }
  } else {
    collectionFile = pickFirstExisting(COLLECTION_SECTION_FILES, existing);
  }

  let searchFile: string | null = null;
  if (customSearch) {
    if (existing.has(customSearch)) {
      searchFile = customSearch;
    } else {
      fileErrors.push({
        message: `Custom search section file "${customSearch}" was not found in theme (${theme.name}).`,
      });
    }
  } else {
    searchFile = pickFirstExisting(SEARCH_SECTION_FILES, existing);
  }

  const byName = new Map(nodes.map((n) => [n.filename, n.content]));
  const collectionInjected = collectionFile
    ? alreadyInjected(byName.get(collectionFile) || "")
    : false;
  const searchInjected = searchFile
    ? alreadyInjected(byName.get(searchFile) || "")
    : false;
  return {
    ok: fileErrors.length === 0,
    injected: collectionInjected || searchInjected,
    collectionInjected,
    searchInjected,
    themeId: theme.id,
    themeName: theme.name,
    collectionFile,
    searchFile,
    errors: fileErrors,
  };
}

function customFilesForTarget(
  customFiles: CustomThemeFiles | undefined,
  target: ThemeInjectTarget,
): CustomThemeFiles | undefined {
  if (target === "collection") {
    return { collectionFile: customFiles?.collectionFile };
  }
  if (target === "search") {
    return { searchFile: customFiles?.searchFile };
  }
  return customFiles;
}

function sectionNamesForTarget(
  status: ThemeInjectStatus,
  target: ThemeInjectTarget,
): string[] {
  const names: string[] = [];
  if (target !== "search" && status.collectionFile) {
    names.push(status.collectionFile);
  }
  if (target !== "collection" && status.searchFile) {
    names.push(status.searchFile);
  }
  return names;
}

function targetDescription(target: ThemeInjectTarget): string {
  if (target === "collection") return "collection product-grid section";
  if (target === "search") return "search product-grid section";
  return "collection or search product-grid section";
}

function injectionStateAfter(
  status: ThemeInjectStatus,
  target: ThemeInjectTarget,
  injected: boolean,
) {
  const collectionInjected =
    target === "search"
      ? status.collectionInjected
      : injected && Boolean(status.collectionFile);
  const searchInjected =
    target === "collection"
      ? status.searchInjected
      : injected && Boolean(status.searchFile);
  return {
    injected: collectionInjected || searchInjected,
    collectionInjected,
    searchInjected,
  };
}

export type NativeElementCandidate = { selector: string; tag: string };

/**
 * "Detect theme elements": the HTML elements in the injected collection and
 * search sections that support may want to hide, read from the theme source
 * (works on password-protected stores; no storefront fetch).
 */
export async function detectNativeElements(
  admin: AdminClient,
  customFiles?: CustomThemeFiles,
  themeId?: string,
): Promise<{
  ok: boolean;
  errors: { message: string }[];
  candidates: Record<"collection" | "search", NativeElementCandidate[]>;
}> {
  const empty = { collection: [], search: [] };
  const status = await getThemeInjectStatus(admin, customFiles, themeId);
  if (!status.ok)
    return { ok: false, errors: status.errors, candidates: empty };
  const names = [status.collectionFile, status.searchFile].filter(
    (f): f is string => Boolean(f),
  );
  if (!names.length) {
    return {
      ok: false,
      errors: [
        { message: "Could not find a product-grid section in the theme." },
      ],
      candidates: empty,
    };
  }
  const { nodes, errors } = await readThemeFiles(admin, status.themeId, names);
  if (errors.length) return { ok: false, errors, candidates: empty };
  const byName = new Map(nodes.map((n) => [n.filename, n.content]));
  const pick = (file: string | null) =>
    file ? nativeElementCandidates(byName.get(file) || "") : [];
  return {
    ok: true,
    errors: [],
    candidates: {
      collection: pick(status.collectionFile),
      search: pick(status.searchFile),
    },
  };
}

export async function injectThemeFilters(
  admin: AdminClient,
  customFiles?: CustomThemeFiles,
  target: ThemeInjectTarget = "both",
  themeId?: string,
): Promise<ThemeInjectStatus> {
  const scopedCustomFiles = customFilesForTarget(customFiles, target);
  const status = await getThemeInjectStatus(admin, scopedCustomFiles, themeId);
  if (!status.ok) return status;
  const sectionNames = sectionNamesForTarget(status, target);
  if (sectionNames.length === 0) {
    return {
      ...status,
      ok: false,
      errors: [
        {
          message: `Could not find a ${targetDescription(target)} in the published theme.`,
        },
      ],
    };
  }

  const { nodes, errors: readErrors } = await readThemeFiles(
    admin,
    status.themeId,
    sectionNames,
  );
  if (readErrors.length) return { ...status, ok: false, errors: readErrors };

  const byName = new Map(nodes.map((n) => [n.filename, n.content]));
  const writes: { filename: string; body: string }[] = [];

  for (const copy of COPY_FILES) {
    writes.push({ filename: copy.dest, body: readProjectFile(copy.src) });
  }

  // Developer override: insert before a text marker on both pages instead of
  // the per-page defaults (top of file / before Dawn's search results).
  const marker = String(customFiles?.injectBefore || "").trim();
  const warnings: { message: string }[] = [...(status.warnings || [])];
  for (const name of sectionNames) {
    const src = byName.get(name) || "";
    let body: string;
    if (marker) {
      const placed = injectBefore(
        src,
        marker,
        name === status.searchFile ? injectSearch : prependInject,
      );
      body = placed.body;
      if (!placed.found) {
        warnings.push({
          message: `inject-before-not-found: "${marker}" is not in ${name}; the block was inserted at the top instead.`,
        });
      }
    } else {
      body =
        name === status.searchFile ? injectSearch(src) : prependInject(src);
    }
    writes.push({ filename: name, body });
  }

  const { errors } = await upsertThemeFiles(admin, status.themeId, writes);
  if (errors.length) return { ...status, ok: false, errors };

  const injectionState = injectionStateAfter(status, target, true);
  return {
    ...status,
    ok: true,
    ...injectionState,
    errors: [],
    warnings,
  };
}

/**
 * Push the latest filter CSS/JS/Liquid copies into the published theme without
 * touching section injection. Needed when card layouts (or other storefront
 * assets) ship in the app but the theme still has an older injected snapshot.
 */
export async function syncThemeAssets(
  admin: AdminClient,
  themeId?: string,
  opts?: {
    /** Also (re)generate the theme card mirror (cardSource === "theme"). */
    ensureThemeCards?: boolean;
    /** myshopify domain used to discover the mirror's rendered section ids. */
    shopDomain?: string;
    customFiles?: CustomThemeFiles;
    /** Status the caller already read (skips a second theme lookup). */
    status?: ThemeInjectStatus;
  },
): Promise<{
  ok: boolean;
  synced: boolean;
  /** Theme files actually rewritten (unchanged files are skipped). */
  written?: string[];
  errors: { message: string }[];
  themeCardErrors?: { message: string }[];
}> {
  const status =
    opts?.status ??
    (await getThemeInjectStatus(admin, opts?.customFiles, themeId));
  if (!status.ok) {
    return { ok: false, synced: false, errors: status.errors };
  }
  if (!status.injected) {
    return { ok: true, synced: false, errors: [] };
  }

  const writes = await changedThemeFiles(
    admin,
    status.themeId,
    COPY_FILES.map((copy) => ({
      filename: copy.dest,
      body: readProjectFile(copy.src),
    })),
  );
  if (writes.length) {
    const { errors } = await upsertThemeFiles(admin, status.themeId, writes);
    if (errors.length) return { ok: false, synced: false, errors };
  }
  const written = writes.map((w) => w.filename);

  // The theme card mirror rides along with asset sync so merchant edits to
  // their grid section (detected via the inputs hash) reach the storefront.
  let themeCardErrors: { message: string }[] = [];
  if (opts?.ensureThemeCards && opts.shopDomain) {
    try {
      const mirror = await ensureThemeCardMirror(admin, opts.shopDomain, {
        status,
        customFiles: opts.customFiles,
      });
      themeCardErrors = mirror.errors;
    } catch (err) {
      if (err instanceof Response) throw err;
      themeCardErrors = [
        {
          message:
            err instanceof Error ? err.message : "Theme card mirror failed",
        },
      ];
    }
  }
  return { ok: true, synced: true, written, errors: [], themeCardErrors };
}

export async function removeThemeFilters(
  admin: AdminClient,
  customFiles?: CustomThemeFiles,
  options?: {
    deleteCopiedFiles?: boolean;
    target?: ThemeInjectTarget;
    themeId?: string;
  },
): Promise<ThemeInjectStatus> {
  const target = options?.target ?? "both";
  const scopedCustomFiles = customFilesForTarget(customFiles, target);
  const status = await getThemeInjectStatus(
    admin,
    scopedCustomFiles,
    options?.themeId,
  );
  if (!status.ok) return status;

  const sectionNames = sectionNamesForTarget(status, target);
  const { nodes, errors: readErrors } = await readThemeFiles(
    admin,
    status.themeId,
    sectionNames,
  );
  if (readErrors.length) return { ...status, ok: false, errors: readErrors };

  const writes: { filename: string; body: string }[] = [];
  for (const n of nodes) {
    if (!alreadyInjected(n.content)) continue;
    writes.push({ filename: n.filename, body: stripInject(n.content) });
  }
  if (writes.length) {
    const { errors } = await upsertThemeFiles(admin, status.themeId, writes);
    if (errors.length) return { ...status, ok: false, errors };
  }

  const injectionState = injectionStateAfter(status, target, false);

  // Shared snippets/assets can only be removed once neither page uses them.
  if (
    options?.deleteCopiedFiles !== false &&
    !injectionState.collectionInjected &&
    !injectionState.searchInjected
  ) {
    // Snippets/assets we copied in. The theme card mirror files are removed
    // by removeThemeCardMirror below (once, not twice).
    const { errors: deleteErrors } = await deleteThemeFiles(
      admin,
      status.themeId,
      COPY_FILES.map((c) => c.dest),
    );
    if (deleteErrors.length) {
      console.warn("Theme files delete warnings/errors:", deleteErrors);
    }
    const mirror = await removeThemeCardMirror(admin, status.themeId);
    if (mirror.errors.length) {
      console.warn("Theme card mirror delete warnings/errors:", mirror.errors);
    }
  }

  return {
    ...status,
    ok: true,
    ...injectionState,
    errors: [],
  };
}
