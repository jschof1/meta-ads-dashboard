import { defineConfig, globalIgnores } from "eslint/config";
import react from "eslint-plugin-react";
import hooks from "eslint-plugin-react-hooks";
import importPlugin from "eslint-plugin-import";
import a11y from "eslint-plugin-jsx-a11y";
import ts from "typescript-eslint";
import globals from "globals";
import locationRule from "./scripts/lint-rules/no-location-assign-relative-destination.cjs";

const eslintConfig = defineConfig([
  // Preserve Next 16.3.8's React, Hooks, accessibility and TypeScript policy.
  // The 21 portable Next rules run in Oxlint. Keep the remaining official rule
  // with its license, without the vulnerable glob dependency.
  {
    files: ["**/*.{js,jsx,mjs,ts,tsx,mts,cts}"],
    plugins: {
      react,
      "react-hooks": hooks,
      import: importPlugin,
      "jsx-a11y": a11y,
      "@next/next": { rules: { "no-location-assign-relative-destination": locationRule.default } },
    },
    languageOptions: {
      parserOptions: { ecmaFeatures: { jsx: true } },
      globals: { ...globals.browser, ...globals.node },
    },
    settings: { react: { version: "detect" } },
    rules: {
      ...react.configs.recommended.rules,
      ...hooks.configs.recommended.rules,
      "@next/next/no-location-assign-relative-destination": "warn",
      "import/no-anonymous-default-export": "warn",
      "react/no-unknown-property": "off",
      "react/react-in-jsx-scope": "off",
      "react/prop-types": "off",
      "react/jsx-no-target-blank": "off",
      "jsx-a11y/alt-text": ["warn", { elements: ["img"], img: ["Image"] }],
      "jsx-a11y/aria-props": "warn",
      "jsx-a11y/aria-proptypes": "warn",
      "jsx-a11y/aria-unsupported-elements": "warn",
      "jsx-a11y/role-has-required-aria-props": "warn",
      "jsx-a11y/role-supports-aria-props": "warn",
    },
  },
  ...ts.configs.recommended,
  { rules: {
    "@typescript-eslint/no-unused-vars": "warn",
    "@typescript-eslint/no-unused-expressions": "warn",
  } },
  globalIgnores([
    ".next/**",
    ".open-next/**",
    ".wrangler/**",
    "out/**",
    "build/**",
    "next-env.d.ts",
    "scripts/lint-rules/**",
  ]),
]);

export default eslintConfig;
