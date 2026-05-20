/**
 * ESLint config (flat-config form for ESLint 9+).
 *
 * v1: enforce one project-specific rule — inline numeric `zIndex` is banned
 * in any .tsx under `app/portal/` (P2-FE-26). z-index must go through the
 * tokens declared in `apps/web/styles/tokens.css`.
 *
 * The Next.js ESLint preset is intentionally NOT extended here — Next 16
 * deprecated `next lint` and the bundled preset, and using it via
 * FlatCompat tripped a circular-reference bug. Wiring a typed preset back
 * in is a follow-up; the project's typecheck is the heavy quality gate.
 */

import tsParser from "@typescript-eslint/parser";

const config = [
  {
    // Don't lint generated bundles or node_modules.
    ignores: [
      ".next/**",
      "node_modules/**",
      "dist/**",
      "test-results/**",
      "playwright-report/**",
      // The v8 coverage report ships an HTML drilldown under
      // coverage/lcov-report/*.{js,css} that's not source code.
      "coverage/**",
      "tsconfig.tsbuildinfo",
    ],
  },
  // Wire the TS parser globally so any .ts/.tsx parses cleanly. Without
  // this, ESLint's default Espree parser chokes on TS-only syntax (type
  // imports, interfaces, etc.). We also register no-op definitions for
  // the rules our codebase's inline disable directives reference (we're
  // not yet wiring eslint-plugin-react or @typescript-eslint), so those
  // directives don't error out as "rule not found".
  {
    files: ["**/*.{ts,tsx,mts,cts}"],
    languageOptions: {
      parser: tsParser,
      parserOptions: {
        ecmaVersion: "latest",
        sourceType: "module",
        ecmaFeatures: { jsx: true },
      },
    },
    plugins: {
      "@typescript-eslint": {
        rules: {
          "no-explicit-any": { create: () => ({}) },
          "no-unused-vars": { create: () => ({}) },
        },
      },
      "react-hooks": {
        rules: {
          "exhaustive-deps": { create: () => ({}) },
        },
      },
    },
    linterOptions: {
      reportUnusedDisableDirectives: false,
    },
    rules: {},
  },
  {
    files: ["app/portal/**/*.tsx", "app/portal/**/*.ts"],
    ignores: ["app/portal/components/tweaks/**"],
    rules: {
      "no-restricted-syntax": [
        "error",
        {
          // Matches `zIndex: 100`, `zIndex: 0`, etc. inside object literals.
          // Numeric literal values are `Literal` nodes with `raw` set to
          // a string of digits (`raw` is required because `value` is a
          // number, not a string).
          selector:
            "Property[key.name='zIndex'][value.type='Literal'][value.raw=/^[0-9]+$/]",
          message:
            "Use a --z-* token from styles/tokens.css (e.g. \"var(--z-modal)\") instead of an inline numeric zIndex (P2-FE-26).",
        },
        {
          // Negative literals are wrapped in a UnaryExpression.
          selector:
            "Property[key.name='zIndex'][value.type='UnaryExpression'][value.operator='-'][value.argument.type='Literal']",
          message:
            "Use a --z-* token from styles/tokens.css (e.g. \"var(--z-modal)\") instead of an inline numeric zIndex (P2-FE-26).",
        },
      ],
    },
  },
];

export default config;
