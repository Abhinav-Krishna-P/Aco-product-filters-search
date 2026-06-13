/** @type {import('@types/eslint').Linter.BaseConfig} */
module.exports = {
  root: true,
  extends: [
    "@remix-run/eslint-config",
    "@remix-run/eslint-config/node",
    "@remix-run/eslint-config/jest-testing-library",
    "prettier",
  ],
  globals: {
    shopify: "readonly",
    globalThis: "readonly",
  },
  // Tests run on node:test; the jest preset only needs a version to load.
  settings: {
    jest: { version: 29 },
  },
};
