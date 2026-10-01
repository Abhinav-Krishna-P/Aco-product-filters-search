import { test } from "node:test";
import assert from "node:assert/strict";
import { classifyAdminError } from "./adminErrors.shared.ts";

test("browser reports offline: always 'offline', whatever the error", () => {
  assert.equal(classifyAdminError(new Error("anything"), false), "offline");
});

test("fetch failures from a dropped connection are 'offline'", () => {
  for (const msg of [
    "Failed to fetch", // Chrome / Edge
    "NetworkError when attempting to fetch resource.", // Firefox
    "Load failed", // Safari
    "Network request failed",
    "net::ERR_INTERNET_DISCONNECTED",
  ]) {
    assert.equal(classifyAdminError(new TypeError(msg), true), "offline", msg);
  }
});

test("5xx responses (server down, bad gateway, timeout) are 'server'", () => {
  for (const status of [500, 502, 503, 504]) {
    assert.equal(
      classifyAdminError({ status, statusText: "", data: "" }, true),
      "server",
      String(status),
    );
  }
  assert.equal(classifyAdminError(new Error("502 Bad Gateway"), true), "server");
  assert.equal(classifyAdminError(new Error("Service Unavailable"), true), "server");
});

test("other errors stay 'generic'", () => {
  assert.equal(classifyAdminError(new Error("Access denied"), true), "generic");
  assert.equal(classifyAdminError({ status: 404, data: "" }, true), "generic");
  assert.equal(classifyAdminError(undefined, true), "generic");
});
