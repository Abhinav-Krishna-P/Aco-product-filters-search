import { test } from "node:test";
import assert from "node:assert/strict";
import { describeAdminError, guardAction } from "./adminErrors.server.ts";

test("describeAdminError: trial theme access denied gets a plain-language message", () => {
  assert.match(describeAdminError(new Error("Access denied")), /trial/i);
});

test("describeAdminError: throttling and unknown errors are readable", () => {
  assert.match(describeAdminError(new Error("Throttled")), /busy|try again/i);
  assert.equal(describeAdminError(new Error("boom")), "boom");
  assert.match(describeAdminError(undefined), /went wrong/i);
});

function req(intent) {
  const fd = new FormData();
  fd.set("intent", intent);
  return new Request("http://x/app/settings", { method: "POST", body: fd });
}

test("guardAction: a thrown error becomes a failed result carrying the intent", async () => {
  const out = await guardAction({ request: req("inject-theme-collection") }, async () => {
    throw new Error("Access denied");
  });
  assert.equal(out.ok, false);
  assert.equal(out.action, "inject-theme-collection");
  assert.match(out.errors[0].message, /trial/i);
  assert.equal(out.config, null);
});

test("guardAction: successful results pass through untouched", async () => {
  const out = await guardAction({ request: req("save") }, async () => ({ ok: true, value: 1 }));
  assert.deepEqual(out, { ok: true, value: 1 });
});

test("guardAction: thrown Responses (auth redirects) still propagate", async () => {
  await assert.rejects(
    guardAction({ request: req("save") }, async () => {
      throw new Response(null, { status: 302 });
    }),
    (e) => e instanceof Response,
  );
});

test("guardAction: intent is still known when the action already consumed the body", async () => {
  const request = req("republish");
  const out = await guardAction({ request }, async () => {
    await request.formData(); // what real actions do first
    throw new Error("boom");
  });
  assert.equal(out.ok, false);
  assert.equal(out.action, "republish");
});
