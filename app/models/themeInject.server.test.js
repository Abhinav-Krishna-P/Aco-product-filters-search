import { test } from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import {
  getThemeInjectStatus,
  changedThemeFiles,
} from "./themeInject.server.ts";

function adminThrowingOnFiles(message) {
  return {
    graphql: async (query) => {
      const name =
        /^\s*#graphql\s*(?:query|mutation)\s+(\w+)/.exec(query)?.[1] || "?";
      if (name === "PfTheme") {
        return {
          json: async () => ({
            data: {
              theme: {
                id: "gid://shopify/OnlineStoreTheme/9",
                name: "Trial theme",
                role: "UNPUBLISHED",
              },
            },
          }),
        };
      }
      // Shopify rejects theme file access on paid themes still on trial; the
      // API client throws instead of returning a GraphQL errors array.
      throw new Error(message);
    },
  };
}

test("theme file access denied (paid theme on trial) is reported, not thrown", async () => {
  const status = await getThemeInjectStatus(
    adminThrowingOnFiles("Access denied"),
    undefined,
    "gid://shopify/OnlineStoreTheme/9",
  );
  assert.equal(status.ok, false);
  assert.equal(status.themeId, "gid://shopify/OnlineStoreTheme/9");
  assert.equal(status.themeName, "Trial theme");
  assert.match(status.errors[0].message, /trial|purchased/i);
});

test("other thrown API errors surface their message", async () => {
  const status = await getThemeInjectStatus(
    adminThrowingOnFiles("Network failure"),
    undefined,
    "gid://shopify/OnlineStoreTheme/9",
  );
  assert.equal(status.ok, false);
  assert.match(status.errors[0].message, /Network failure/);
});

function adminWithChecksums(checksums, { fail = false } = {}) {
  const calls = [];
  return {
    calls,
    graphql: async (query, opts) => {
      const name =
        /^\s*#graphql\s*(?:query|mutation)\s+(\w+)/.exec(query)?.[1] || "?";
      calls.push({ name, variables: opts?.variables });
      if (fail) throw new Error("Network failure");
      return {
        json: async () => ({
          data: {
            theme: {
              files: {
                nodes: Object.entries(checksums).map(
                  ([filename, checksumMd5]) => ({
                    filename,
                    checksumMd5,
                  }),
                ),
              },
            },
          },
        }),
      };
    },
  };
}

const md5 = (s) => createHash("md5").update(s, "utf8").digest();

test("asset sync writes only files whose checksum differs", async () => {
  const files = [
    { filename: "assets/a.js", body: "same" },
    { filename: "assets/b.css", body: "same-b64" },
    { filename: "assets/c.js", body: "new content" },
    { filename: "snippets/d.liquid", body: "missing in theme" },
  ];
  const admin = adminWithChecksums({
    "assets/a.js": md5("same").toString("hex"),
    "assets/b.css": md5("same-b64").toString("base64"),
    "assets/c.js": md5("old content").toString("hex"),
  });
  const writes = await changedThemeFiles(
    admin,
    "gid://shopify/OnlineStoreTheme/1",
    files,
  );
  assert.deepEqual(
    writes.map((w) => w.filename),
    ["assets/c.js", "snippets/d.liquid"],
  );
  assert.equal(admin.calls[0].name, "PfThemeFileChecksums");
  assert.deepEqual(
    admin.calls[0].variables.filenames,
    files.map((f) => f.filename),
  );
});

test("asset sync falls back to writing everything when checksums can't be read", async () => {
  const files = [{ filename: "assets/a.js", body: "x" }];
  const writes = await changedThemeFiles(
    adminWithChecksums({}, { fail: true }),
    "gid://shopify/OnlineStoreTheme/1",
    files,
  );
  assert.deepEqual(writes, files);
});
