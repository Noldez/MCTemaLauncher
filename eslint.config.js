const js = require("@eslint/js");

// Globals are listed explicitly rather than pulling in the `globals` package -
// the dependency list is deliberately small (see README).
const nodeGlobals = {
  require: "readonly",
  module: "writable",
  exports: "writable",
  process: "readonly",
  console: "readonly",
  Buffer: "readonly",
  __dirname: "readonly",
  __filename: "readonly",
  global: "readonly",
  setTimeout: "readonly",
  clearTimeout: "readonly",
  setInterval: "readonly",
  clearInterval: "readonly",
  setImmediate: "readonly",
  queueMicrotask: "readonly",
  URL: "readonly",
  URLSearchParams: "readonly",
  TextDecoder: "readonly",
  TextEncoder: "readonly",
  fetch: "readonly",
  Blob: "readonly",
  FormData: "readonly",
  AbortSignal: "readonly",
  AbortController: "readonly",
  structuredClone: "readonly",
};

const browserGlobals = {
  window: "readonly",
  document: "readonly",
  navigator: "readonly",
  location: "readonly",
  localStorage: "readonly",
  ResizeObserver: "readonly",
  btoa: "readonly",
  atob: "readonly",
  console: "readonly",
  setTimeout: "readonly",
  clearTimeout: "readonly",
  setInterval: "readonly",
  clearInterval: "readonly",
  requestAnimationFrame: "readonly",
  cancelAnimationFrame: "readonly",
  fetch: "readonly",
  Image: "readonly",
  ImageDecoder: "readonly",
  Blob: "readonly",
  File: "readonly",
  FileReader: "readonly",
  FormData: "readonly",
  URL: "readonly",
  AbortSignal: "readonly",
  CustomEvent: "readonly",
  Event: "readonly",
  KeyboardEvent: "readonly",
  MouseEvent: "readonly",
  HTMLElement: "readonly",
  getComputedStyle: "readonly",
  crypto: "readonly",
  performance: "readonly",
  // Vendored bundle, loaded via <script> before the view scripts.
  skinview3d: "readonly",
};

module.exports = [
  {
    ignores: [
      "node_modules/**",
      "build/**",
      "assets/jre/**",
      "assets/jre-linux/**",
      // Third-party bundles we do not author.
      "renderer/vendor/**",
      "renderer/fa/**",
      // Vendored upstream (MIT, attributed) - kept close to source so upstream
      // fixes stay easy to apply.
      "lib/mclc/**",
    ],
  },
  js.configs.recommended,
  {
    files: ["**/*.js"],
    languageOptions: {
      ecmaVersion: "latest",
      sourceType: "commonjs",
      globals: nodeGlobals,
    },
    rules: {
      eqeqeq: ["error", "smart"],
      "no-var": "error",
      "prefer-const": "error",
      "no-throw-literal": "error",
      "no-return-await": "error",
      // Deliberate: `catch {}` is used throughout for best-effort operations.
      "no-empty": ["error", { allowEmptyCatch: true }],
      "no-unused-vars": ["error", { argsIgnorePattern: "^_", caughtErrors: "none" }],
    },
  },
  {
    files: ["renderer/**/*.js"],
    languageOptions: { globals: browserGlobals },
  },
  {
    files: ["test/**/*.js"],
    languageOptions: {
      globals: { ...nodeGlobals, describe: "readonly", it: "readonly", before: "readonly", after: "readonly" },
    },
  },
];
