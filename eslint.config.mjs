import { defineConfig, globalIgnores } from "eslint/config";
import nextCoreWebVitals from "eslint-config-next/core-web-vitals";
import nextTypescript from "eslint-config-next/typescript";

export default defineConfig([
  globalIgnores([
    ".next/**",
    ".remember/**",
    "out/**",
    "ios/**",
    "android/**",
    "public/**",
    "next-env.d.ts",
  ]),
  nextCoreWebVitals,
  nextTypescript,
  {
    rules: {
      // Retrofit posture: lint was dead from the Next 16 upgrade until 2026-07,
      // so the big backlogs run as warnings — visible, but not gate failures.
      // Promote back to "error" as each backlog reaches zero.
      "@typescript-eslint/no-explicit-any": "warn",
      // Restructuring setState-in-effect needs a per-site review; blind fixes
      // change render timing in working UI.
      "react-hooks/set-state-in-effect": "warn",
      // Advisory until React Compiler is enabled in next.config.mjs.
      "react-hooks/preserve-manual-memoization": "warn",
      "@typescript-eslint/no-unused-vars": [
        "warn",
        {
          argsIgnorePattern: "^_",
          varsIgnorePattern: "^_",
          caughtErrorsIgnorePattern: "^_",
          destructuredArrayIgnorePattern: "^_",
          ignoreRestSiblings: true,
        },
      ],
    },
  },
  {
    // Playwright fixtures receive a `use` continuation — not a React hook.
    files: ["e2e/**"],
    rules: { "react-hooks/rules-of-hooks": "off" },
  },
]);
