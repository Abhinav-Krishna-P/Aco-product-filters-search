import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import {
  ensureThemeCardMirror,
  probeThemeCardMirror,
  removeThemeCardMirror,
  readThemeCardsStatus,
} from "./themeCardMirror.server.ts";

const fx = (p) =>
  readFileSync(new URL(`./__fixtures__/themes/${p}`, import.meta.url), "utf8");

const STATUS = {
  ok: true,
  injected: true,
  collectionInjected: true,
  searchInjected: true,
  themeId: "gid://shopify/OnlineStoreTheme/1",
  themeName: "Dawn",
  collectionFile: "sections/main-collection-product-grid.liquid",
  searchFile: "sections/main-search.liquid",
  errors: [],
};

function dawnFiles() {
  return {
    "sections/main-collection-product-grid.liquid": fx(
      "dawn/main-collection-product-grid.liquid",
    ),
    "sections/main-search.liquid": fx("dawn/main-search.liquid"),
    "templates/collection.json": fx("dawn/collection.json"),
    "templates/search.json": fx("dawn/search.json"),
  };
}

function fakeAdmin(files, opts = {}) {
  const calls = [];
  const state = { metafield: opts.metafield ?? null, deleted: [] };
  const respond = (data) => ({ json: async () => ({ data }) });
  return {
    calls,
    state,
    graphql: async (query, options) => {
      const vars = (options && options.variables) || {};
      const name =
        /^\s*#graphql\s*(?:query|mutation)\s+(\w+)/.exec(query)?.[1] || "?";
      calls.push({ name, vars });
      switch (name) {
        case "PfThemeFiles":
          return respond({
            theme: {
              files: {
                nodes: (vars.filenames || [])
                  .filter((f) => files[f] != null)
                  .map((f) => ({ filename: f, body: { content: files[f] } })),
              },
            },
          });
        case "PfThemeFilesUpsert":
          for (const f of vars.files) files[f.filename] = f.body.value;
          return respond({
            themeFilesUpsert: {
              upsertedThemeFiles: vars.files.map((f) => ({
                filename: f.filename,
              })),
              userErrors: [],
            },
          });
        case "PfThemeFilesDelete":
          for (const f of vars.files) {
            delete files[f];
            state.deleted.push(f);
          }
          return respond({
            themeFilesDelete: { deletedThemeFiles: [], userErrors: [] },
          });
        case "PfShopId":
          return respond({ shop: { id: "gid://shopify/Shop/1" } });
        case "PfThemeCardsRead":
          return respond({
            shop: {
              metafield: state.metafield
                ? { id: "gid://shopify/Metafield/9", value: state.metafield }
                : null,
            },
          });
        case "SetPfThemeCards":
          state.metafield = vars.metafields[0].value;
          return respond({ metafieldsSet: { userErrors: [] } });
        case "PfThemeCardsDelete":
          state.metafield = null;
          return respond({
            metafieldDelete: { deletedId: vars.input.id, userErrors: [] },
          });
        case "PfFirstProduct":
          return respond({
            products: {
              nodes: [{ handle: "alpha-shirt" }, { handle: "beta-hat" }],
            },
          });
        default:
          throw new Error("unexpected query " + name);
      }
    },
  };
}

function fakeFetch(handler) {
  const urls = [];
  const impl = async (url, init) => {
    urls.push(String(url));
    const r = handler(String(url), init) || { status: 200, body: "" };
    return {
      status: r.status,
      ok: r.status >= 200 && r.status < 300,
      text: async () => r.body,
    };
  };
  impl.urls = urls;
  return impl;
}

const DISCOVERY_HTML =
  '<html><div id="shopify-section-template--17__aco-pf-collection" class="shopify-section"></div>' +
  '<div id="shopify-section-template--17__aco-pf-search" class="shopify-section"></div></html>';

test("ensureThemeCardMirror writes sections, template and metafield (json mode)", async () => {
  const files = dawnFiles();
  const admin = fakeAdmin(files);
  const fetchImpl = fakeFetch(() => ({ status: 200, body: DISCOVERY_HTML }));

  const res = await ensureThemeCardMirror(admin, "demo.myshopify.com", {
    status: STATUS,
    fetchImpl,
  });

  assert.equal(res.ok, true, JSON.stringify(res.errors));
  assert.equal(res.skipped, false);
  const upserts = admin.calls.filter((c) => c.name === "PfThemeFilesUpsert");
  assert.equal(upserts.length, 2);
  assert.deepEqual(
    upserts[0].vars.files.map((f) => f.filename),
    [
      "sections/aco-pf-theme-cards-collection.liquid",
      "sections/aco-pf-theme-cards-search.liquid",
    ],
  );
  assert.deepEqual(
    upserts[1].vars.files.map((f) => f.filename),
    ["templates/search.aco-pf.json"],
  );
  const template = JSON.parse(upserts[1].vars.files[0].body.value);
  assert.equal(
    template.sections["aco-pf-collection"].type,
    "aco-pf-theme-cards-collection",
  );
  assert.equal(
    template.sections["aco-pf-collection"].settings.products_per_page,
    16,
  );
  assert.equal(template.sections["aco-pf-search"].settings.columns_desktop, 4);
  assert.match(
    files["sections/aco-pf-theme-cards-collection.liquid"],
    /for pf_h in pf_handles/,
  );

  assert.match(
    fetchImpl.urls[0],
    /^https:\/\/demo\.myshopify\.com\/search\?view=aco-pf&q=/,
  );
  const status = res.status;
  assert.equal(status.version, 1);
  assert.equal(status.view, "aco-pf");
  assert.equal(status.mode, "json");
  assert.equal(status.collection.sectionId, "template--17__aco-pf-collection");
  assert.equal(
    status.collection.sourceFile,
    "sections/main-collection-product-grid.liquid",
  );
  assert.equal(status.collection.ok, true);
  assert.equal(status.search.sectionId, "template--17__aco-pf-search");
  assert.ok(status.generatedAt);
  assert.match(status.inputsHash, /^[0-9a-f]{40}$/);
  assert.equal(
    JSON.parse(admin.state.metafield).collection.sectionId,
    "template--17__aco-pf-collection",
  );
  const set = admin.calls.find((c) => c.name === "SetPfThemeCards").vars
    .metafields[0];
  assert.equal(set.namespace, "pf_config");
  assert.equal(set.key, "theme_cards");
  assert.equal(set.type, "json");
});

test("skips when inputsHash unchanged, regenerates with force", async () => {
  const files = dawnFiles();
  const admin = fakeAdmin(files);
  const fetchImpl = fakeFetch(() => ({ status: 200, body: DISCOVERY_HTML }));
  await ensureThemeCardMirror(admin, "demo.myshopify.com", {
    status: STATUS,
    fetchImpl,
  });
  const before = admin.calls.filter(
    (c) => c.name === "PfThemeFilesUpsert",
  ).length;

  const again = await ensureThemeCardMirror(admin, "demo.myshopify.com", {
    status: STATUS,
    fetchImpl,
  });
  assert.equal(again.ok, true);
  assert.equal(again.skipped, true);
  assert.equal(
    admin.calls.filter((c) => c.name === "PfThemeFilesUpsert").length,
    before,
  );

  const forced = await ensureThemeCardMirror(admin, "demo.myshopify.com", {
    status: STATUS,
    fetchImpl,
    force: true,
  });
  assert.equal(forced.skipped, false);
  assert.equal(
    admin.calls.filter((c) => c.name === "PfThemeFilesUpsert").length,
    before + 2,
  );
});

test("liquid mode on a vintage theme bakes defaults and writes a liquid template", async () => {
  const files = {
    "sections/collection-template.liquid": fx(
      "synthetic/vintage-collection-template.liquid",
    ),
    "config/settings_data.json": fx("synthetic/settings_data.json"),
  };
  const admin = fakeAdmin(files);
  const fetchImpl = fakeFetch(() => ({
    status: 200,
    body: '<div id="shopify-section-aco-pf-theme-cards-collection" class="shopify-section"></div>',
  }));
  const res = await ensureThemeCardMirror(admin, "demo.myshopify.com", {
    status: {
      ...STATUS,
      collectionFile: "sections/collection-template.liquid",
      searchFile: null,
      searchInjected: false,
    },
    fetchImpl,
  });
  assert.equal(res.ok, true, JSON.stringify(res.errors));
  assert.equal(res.status.mode, "liquid");
  assert.equal(res.status.search, null);
  assert.equal(
    res.status.collection.sectionId,
    "aco-pf-theme-cards-collection",
  );
  const upserts = admin.calls.filter((c) => c.name === "PfThemeFilesUpsert");
  assert.deepEqual(
    upserts[1].vars.files.map((f) => f.filename),
    ["templates/search.aco-pf.liquid"],
  );
  assert.equal(
    upserts[1].vars.files[0].body.value,
    "{% section 'aco-pf-theme-cards-collection' %}\n",
  );
  const section = files["sections/aco-pf-theme-cards-collection.liquid"];
  const schema = JSON.parse(
    /\{% schema %\}([\s\S]*?)\{% endschema %\}/.exec(section)[1],
  );
  assert.equal(schema.settings.find((s) => s.id === "grid").default, "3");
  assert.equal(
    schema.settings.find((s) => s.id === "show_vendor").default,
    true,
  );
});

test("discovery failure leaves sectionId empty with a warning", async () => {
  const admin = fakeAdmin(dawnFiles());
  const fetchImpl = fakeFetch(() => ({ status: 302, body: "" }));
  const res = await ensureThemeCardMirror(admin, "demo.myshopify.com", {
    status: STATUS,
    fetchImpl,
  });
  assert.equal(res.ok, true);
  assert.equal(res.status.collection.sectionId, "");
  assert.ok(
    res.status.warnings.some((w) =>
      w.startsWith("section-id-discovery-failed:302"),
    ),
    res.status.warnings.join(),
  );
});

test("unsupported source section is reported, not written", async () => {
  const files = {
    "sections/weird.liquid": fx("synthetic/loop-in-snippet.liquid"),
    "templates/search.json": "{}",
  };
  const admin = fakeAdmin(files);
  const res = await ensureThemeCardMirror(admin, "demo.myshopify.com", {
    status: {
      ...STATUS,
      collectionFile: "sections/weird.liquid",
      searchFile: null,
    },
    fetchImpl: fakeFetch(() => ({ status: 200, body: "" })),
  });
  assert.equal(res.ok, false);
  assert.equal(res.status.collection.ok, false);
  assert.equal(res.status.collection.reason, "loop-in-snippet");
  assert.equal(
    admin.calls.filter((c) => c.name === "PfThemeFilesUpsert").length,
    0,
  );
  assert.ok(
    admin.state.metafield,
    "status still published so the admin can show the reason",
  );
});

test("probe reports ok only when the card marker comes back", async () => {
  const stored = JSON.stringify({
    version: 1,
    view: "aco-pf",
    mode: "json",
    collection: {
      sectionId: "template--17__aco-pf-collection",
      sourceFile: "x",
      ok: true,
    },
    search: null,
    warnings: [],
    generatedAt: "2026-10-13T00:00:00.000Z",
    inputsHash: "abc",
  });
  const okFetch = fakeFetch((url) =>
    /section_id=template--17__aco-pf-collection/.test(url) &&
    /q=alpha-shirt/.test(url)
      ? {
          status: 200,
          body: "<ul><!--aco-pf-card:alpha-shirt--><li>x</li><!--/aco-pf-card--><!--aco-pf-card:beta-hat--><li>y</li><!--/aco-pf-card--></ul>",
        }
      : { status: 500, body: "" },
  );
  const ok = await probeThemeCardMirror(
    fakeAdmin({}, { metafield: stored }),
    "demo.myshopify.com",
    { fetchImpl: okFetch },
  );
  assert.equal(ok.ok, true);
  assert.equal(ok.message, "Theme card rendered OK");

  const notFound = await probeThemeCardMirror(
    fakeAdmin({}, { metafield: stored }),
    "demo.myshopify.com",
    {
      fetchImpl: fakeFetch(() => ({ status: 404, body: "" })),
    },
  );
  assert.equal(notFound.ok, false);
  assert.match(notFound.message, /404/);

  const noMarkers = await probeThemeCardMirror(
    fakeAdmin({}, { metafield: stored }),
    "demo.myshopify.com",
    {
      fetchImpl: fakeFetch(() => ({ status: 200, body: "<ul></ul>" })),
    },
  );
  assert.equal(noMarkers.ok, false);
  assert.match(noMarkers.message, /no card markers/);

  const password = await probeThemeCardMirror(
    fakeAdmin({}, { metafield: stored }),
    "demo.myshopify.com",
    {
      fetchImpl: fakeFetch(() => ({
        status: 200,
        body: '<form action="/password" method="post">',
      })),
    },
  );
  assert.equal(password.ok, false);
  assert.match(password.message, /password/i);

  const none = await probeThemeCardMirror(fakeAdmin({}), "demo.myshopify.com", {
    fetchImpl: okFetch,
  });
  assert.equal(none.ok, false);
  assert.match(none.message, /Regenerate/);
});

test("readThemeCardsStatus parses the metafield and removeThemeCardMirror cleans up", async () => {
  const files = dawnFiles();
  const admin = fakeAdmin(files);
  await ensureThemeCardMirror(admin, "demo.myshopify.com", {
    status: STATUS,
    fetchImpl: fakeFetch(() => ({ status: 200, body: DISCOVERY_HTML })),
  });
  const status = await readThemeCardsStatus(admin);
  assert.equal(status.collection.sectionId, "template--17__aco-pf-collection");

  const res = await removeThemeCardMirror(admin, STATUS.themeId);
  assert.deepEqual(res.errors, []);
  assert.deepEqual(admin.state.deleted.sort(), [
    "sections/aco-pf-theme-cards-collection.liquid",
    "sections/aco-pf-theme-cards-search.liquid",
    "templates/search.aco-pf.json",
    "templates/search.aco-pf.liquid",
  ]);
  assert.equal(admin.state.metafield, null);
  assert.equal(await readThemeCardsStatus(admin), null);
});

// ---- review fixes ----------------------------------------------------------
test("regenerates when a mirror file is missing or the stored section id is empty", async () => {
  const files = dawnFiles();
  const admin = fakeAdmin(files);
  const okFetch = fakeFetch(() => ({ status: 200, body: DISCOVERY_HTML }));
  await ensureThemeCardMirror(admin, "demo.myshopify.com", {
    status: STATUS,
    fetchImpl: okFetch,
  });
  delete files["sections/aco-pf-theme-cards-collection.liquid"];
  const again = await ensureThemeCardMirror(admin, "demo.myshopify.com", {
    status: STATUS,
    fetchImpl: okFetch,
  });
  assert.equal(again.skipped, false, "missing mirror file must regenerate");

  const admin2 = fakeAdmin(dawnFiles());
  const noDiscovery = fakeFetch(() => ({ status: 302, body: "" }));
  await ensureThemeCardMirror(admin2, "demo.myshopify.com", {
    status: STATUS,
    fetchImpl: noDiscovery,
  });
  const retry = await ensureThemeCardMirror(admin2, "demo.myshopify.com", {
    status: STATUS,
    fetchImpl: okFetch,
  });
  assert.equal(retry.skipped, false, "empty section id must retry discovery");
  assert.equal(
    retry.status.collection.sectionId,
    "template--17__aco-pf-collection",
  );
});

test("does nothing when the filters are not injected", async () => {
  const admin = fakeAdmin(dawnFiles());
  const res = await ensureThemeCardMirror(admin, "demo.myshopify.com", {
    status: { ...STATUS, injected: false },
    fetchImpl: fakeFetch(() => ({ status: 200, body: DISCOVERY_HTML })),
  });
  assert.equal(res.ok, false);
  assert.match(res.errors[0].message, /inject/i);
  assert.equal(
    admin.calls.filter((c) => c.name === "PfThemeFilesUpsert").length,
    0,
  );
});

test("probe renders two products and requires a marker for each", async () => {
  const stored = JSON.stringify({
    version: 1,
    view: "aco-pf",
    mode: "json",
    collection: {
      sectionId: "template--17__aco-pf-collection",
      sourceFile: "x",
      ok: true,
    },
    search: null,
    warnings: [],
    generatedAt: "2026-10-13T00:00:00.000Z",
    inputsHash: "abc",
  });
  const urls = [];
  const partial = fakeFetch((url) => {
    urls.push(url);
    return {
      status: 200,
      body: "<ul><!--aco-pf-card:alpha-shirt--><li>x</li><!--/aco-pf-card--></ul>",
    };
  });
  const res = await probeThemeCardMirror(
    fakeAdmin({}, { metafield: stored }),
    "demo.myshopify.com",
    { fetchImpl: partial },
  );
  assert.match(urls[0], /q=alpha-shirt(%20|\+)beta-hat/);
  assert.equal(res.ok, false);
  assert.match(res.message, /beta-hat/);
});

test("password page during discovery is reported as such", async () => {
  const admin = fakeAdmin(dawnFiles());
  const res = await ensureThemeCardMirror(admin, "demo.myshopify.com", {
    status: STATUS,
    fetchImpl: fakeFetch(() => ({
      status: 200,
      body: '<form action="/password" method="post"></form>',
    })),
  });
  assert.equal(res.ok, true);
  assert.equal(res.status.collection.sectionId, "");
  assert.ok(
    res.status.warnings.includes("section-id-discovery-failed:password"),
    res.status.warnings.join(),
  );
});

test("password-protected store: unchanged inputs are skipped instead of rewritten", async () => {
  const admin = fakeAdmin(dawnFiles());
  const passwordFetch = fakeFetch(() => ({
    status: 200,
    body: '<form action="/password" method="post"></form>',
  }));
  const first = await ensureThemeCardMirror(admin, "demo.myshopify.com", {
    status: STATUS,
    fetchImpl: passwordFetch,
  });
  assert.equal(first.ok, true);
  assert.equal(first.skipped, false);
  const upsertCount = () =>
    admin.calls.filter((c) => c.name === "PfThemeFilesUpsert").length;
  const writes = upsertCount();
  const again = await ensureThemeCardMirror(admin, "demo.myshopify.com", {
    status: STATUS,
    fetchImpl: passwordFetch,
  });
  assert.equal(
    again.skipped,
    true,
    "no rewrite loop on password-protected stores",
  );
  assert.equal(upsertCount(), writes);
});

// ---- render-chain snippet mirrors (ShopiLaunch "Starter") -------------------

function shopilaunchFiles() {
  return {
    "sections/main-collection.liquid": fx("shopilaunch/main-collection.liquid"),
    "sections/main-search.liquid": fx("shopilaunch/main-search.liquid"),
    "snippets/main-collection-style1.liquid": fx(
      "shopilaunch/main-collection-style1.liquid",
    ),
    "snippets/main-search-style1.liquid": fx(
      "shopilaunch/main-search-style1.liquid",
    ),
    "snippets/filters-content.liquid": fx("shopilaunch/filters-content.liquid"),
    "snippets/filters-search-content.liquid": fx(
      "shopilaunch/filters-search-content.liquid",
    ),
    "templates/collection.json": JSON.stringify({
      sections: {
        "main-collection": {
          type: "main-collection",
          settings: { columns_desktop: 4 },
        },
      },
      order: ["main-collection"],
    }),
    "templates/search.json": JSON.stringify({
      sections: { main: { type: "main-search", settings: {} } },
      order: ["main"],
    }),
  };
}
const SL_STATUS = {
  ...STATUS,
  collectionFile: "sections/main-collection.liquid",
  searchFile: "sections/main-search.liquid",
};

test("shopilaunch: loop in snippets is mirrored via snippet copies", async () => {
  const files = shopilaunchFiles();
  const admin = fakeAdmin(files);
  const res = await ensureThemeCardMirror(admin, "demo.myshopify.com", {
    status: SL_STATUS,
    fetchImpl: fakeFetch(() => ({ status: 200, body: DISCOVERY_HTML })),
  });
  assert.equal(res.ok, true, JSON.stringify(res.errors));
  assert.equal(res.status.collection.ok, true);
  assert.equal(res.status.search.ok, true);
  assert.deepEqual(res.status.mirrorFiles, [
    "snippets/aco-pf-mirror-filters-content.liquid",
    "snippets/aco-pf-mirror-filters-search-content.liquid",
    "snippets/aco-pf-mirror-main-collection-style1.liquid",
    "snippets/aco-pf-mirror-main-search-style1.liquid",
  ]);
  assert.match(
    files["sections/aco-pf-theme-cards-collection.liquid"],
    /render 'aco-pf-mirror-main-collection-style1'/,
  );
  assert.match(
    files["snippets/aco-pf-mirror-main-collection-style1.liquid"],
    /render 'aco-pf-mirror-filters-content'/,
  );
  assert.match(
    files["snippets/aco-pf-mirror-filters-content.liquid"],
    /for pf_h in pf_handles/,
  );
  assert.ok(
    !files["snippets/aco-pf-mirror-collection-sidebar.liquid"],
    "snippets off the loop path are not copied",
  );
});

test("shopilaunch: shared snippet written once and included in the inputs hash", async () => {
  const files = shopilaunchFiles();
  files["snippets/main-search-style1.liquid"] = files[
    "snippets/main-search-style1.liquid"
  ].replace("filters-search-content", "filters-content");
  const admin = fakeAdmin(files);
  const fetchImpl = fakeFetch(() => ({ status: 200, body: DISCOVERY_HTML }));
  const first = await ensureThemeCardMirror(admin, "demo.myshopify.com", {
    status: SL_STATUS,
    fetchImpl,
  });
  assert.equal(first.ok, true, JSON.stringify(first.errors));
  const written = admin.calls
    .filter((c) => c.name === "PfThemeFilesUpsert")
    .flatMap((c) => c.vars.files.map((f) => f.filename));
  assert.equal(
    written.filter((f) => f === "snippets/aco-pf-mirror-filters-content.liquid")
      .length,
    1,
  );
  files["snippets/filters-content.liquid"] += "\n<!-- changed -->";
  const second = await ensureThemeCardMirror(admin, "demo.myshopify.com", {
    status: SL_STATUS,
    fetchImpl,
  });
  assert.notEqual(
    second.status.inputsHash,
    first.status.inputsHash,
    "snippet change must invalidate the mirror",
  );
});

test("dawn: no snippet mirrors are written", async () => {
  const files = dawnFiles();
  const admin = fakeAdmin(files);
  const res = await ensureThemeCardMirror(admin, "demo.myshopify.com", {
    status: STATUS,
    fetchImpl: fakeFetch(() => ({ status: 200, body: DISCOVERY_HTML })),
  });
  assert.equal(res.ok, true);
  assert.deepEqual(res.status.mirrorFiles, []);
  assert.ok(
    !Object.keys(files).some((f) => f.startsWith("snippets/aco-pf-mirror-")),
  );
});

test("removeThemeCardMirror deletes snippet mirrors listed in the status", async () => {
  const files = shopilaunchFiles();
  const admin = fakeAdmin(files);
  await ensureThemeCardMirror(admin, "demo.myshopify.com", {
    status: SL_STATUS,
    fetchImpl: fakeFetch(() => ({ status: 200, body: DISCOVERY_HTML })),
  });
  await removeThemeCardMirror(admin, STATUS.themeId);
  assert.ok(
    admin.state.deleted.includes(
      "snippets/aco-pf-mirror-filters-content.liquid",
    ),
  );
  assert.ok(!files["snippets/aco-pf-mirror-filters-content.liquid"]);
});

test("missing snippet mirror file triggers regeneration", async () => {
  const files = shopilaunchFiles();
  const admin = fakeAdmin(files);
  const fetchImpl = fakeFetch(() => ({ status: 200, body: DISCOVERY_HTML }));
  await ensureThemeCardMirror(admin, "demo.myshopify.com", {
    status: SL_STATUS,
    fetchImpl,
  });
  delete files["snippets/aco-pf-mirror-filters-content.liquid"];
  const res = await ensureThemeCardMirror(admin, "demo.myshopify.com", {
    status: SL_STATUS,
    fetchImpl,
  });
  assert.equal(res.skipped, false);
  assert.ok(files["snippets/aco-pf-mirror-filters-content.liquid"]);
});

test("loop-file override mirrors that snippet instead of the section", async () => {
  const files = shopilaunchFiles();
  const admin = fakeAdmin(files);
  const res = await ensureThemeCardMirror(admin, "demo.myshopify.com", {
    status: SL_STATUS,
    fetchImpl: fakeFetch(() => ({ status: 200, body: DISCOVERY_HTML })),
    customFiles: {
      collectionLoopFile: "filters-content",
      searchLoopFile: "filters-search-content",
    },
  });
  assert.equal(res.ok, true, JSON.stringify(res.errors));
  assert.equal(
    res.status.collection.sourceFile,
    "snippets/filters-content.liquid",
  );
  const mirror = files["sections/aco-pf-theme-cards-collection.liquid"];
  assert.match(mirror, /for pf_h in pf_handles/);
  assert.ok(!/render 'aco-pf-mirror-main-collection-style1'/.test(mirror));
  assert.deepEqual(res.status.mirrorFiles, []);
  assert.match(mirror, /\{% schema %\}/);
});

test("loop-file override that does not exist is reported", async () => {
  const files = shopilaunchFiles();
  const admin = fakeAdmin(files);
  const res = await ensureThemeCardMirror(admin, "demo.myshopify.com", {
    status: SL_STATUS,
    fetchImpl: fakeFetch(() => ({ status: 200, body: DISCOVERY_HTML })),
    customFiles: { collectionLoopFile: "does-not-exist" },
  });
  assert.equal(res.status.collection.ok, false);
  assert.equal(res.status.collection.reason, "loop-file-missing");
  assert.equal(res.status.search.ok, true);
});
