import js from "@eslint/js";
import prettier from "eslint-config-prettier";
import jsxA11y from "eslint-plugin-jsx-a11y";
import reactHooks from "eslint-plugin-react-hooks";
import globals from "globals";
import tseslint from "typescript-eslint";

export default tseslint.config(
  { ignores: ["dist", "coverage", "playwright-report", "test-results"] },
  js.configs.recommended,
  ...tseslint.configs.recommended,
  {
    files: ["**/*.{ts,tsx}"],
    languageOptions: { globals: { ...globals.browser, ...globals.node } },
    rules: {
      "@typescript-eslint/no-unused-vars": ["error", { argsIgnorePattern: "^_" }],
      eqeqeq: "error",
      "no-console": ["error", { allow: ["warn", "error"] }],
    },
  },
  {
    // Maintainability limits, enforced so functions stay small enough to read in
    // one go. Tests are exempt: a long, flat scenario is clearer than a split one.
    files: ["src/**/*.{ts,tsx}", "api/**/*.ts"],
    ignores: ["**/*.test.{ts,tsx}", "src/test/**"],
    rules: {
      complexity: ["error", 10],
      "max-depth": ["error", 3],
      "max-params": ["error", 4],
      "max-lines-per-function": ["error", { max: 80, skipBlankLines: true, skipComments: true }],
      "max-lines": ["error", { max: 500, skipBlankLines: true, skipComments: true }],
      "no-nested-ternary": "error",
      "@typescript-eslint/no-explicit-any": "error",
      "@typescript-eslint/no-non-null-assertion": "error",
    },
  },
  {
    files: ["src/client/**/*.tsx"],
    plugins: { "react-hooks": reactHooks, "jsx-a11y": jsxA11y },
    rules: {
      ...reactHooks.configs.recommended.rules,
      ...jsxA11y.flatConfigs.strict.rules,
      // A scrollable region must be keyboard-reachable, which needs a tabIndex.
      "jsx-a11y/no-noninteractive-tabindex": ["error", { roles: ["log", "group"] }],
    },
  },
  {
    // Architecture rule: shared code stays portable, and client code can never
    // import anything that reads server configuration or secrets.
    files: ["src/shared/**/*.ts"],
    rules: {
      "no-restricted-imports": [
        "error",
        { patterns: ["**/client/**", "**/server/**", "react", "hono", "node:*"] },
      ],
    },
  },
  {
    files: ["src/client/**/*.{ts,tsx}"],
    ignores: ["**/*.test.{ts,tsx}"],
    rules: {
      "no-restricted-imports": ["error", { patterns: ["**/server/**", "hono", "node:*"] }],
    },
  },
  {
    files: ["scripts/**/*.mjs"],
    languageOptions: { globals: globals.node },
    rules: { "no-console": "off" },
  },
  prettier,
);
