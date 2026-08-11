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
  {
    // ---- Child B, B-final: the colour clauses -------------------------------
    //
    // SCOPED to `app/**` deliberately. The rules block above has no `files` key, so an
    // unscoped clause here would fire on `tailwind.config.ts` (which legitimately holds
    // `rgb(var(--x) / <alpha-value>)`), on `scripts/`, `e2e/` and `sanity/`.
    //
    // AST-BASED, via `no-restricted-syntax` on `Literal` and `TemplateElement`. That is
    // not incidental: a source-text rule fires on colours named in PROSE, and the theme
    // gallery names `#010b17` in two comments. An AST selector never sees a comment.
    //
    // `__tests__` is excluded because the synthetic fixtures there deliberately contain
    // retired spellings — they exist to prove the scanner still detects them.
    files: ["app/**/*.{ts,tsx}"],
    ignores: [
      "app/**/__tests__/**",
      // The email palette is deliberately light and deliberately literal. CLAUDE.md
      // records five failed attempts to hold a dark palette against Outlook for Mac.
      "app/utils/emailShell.ts",
    ],
    rules: {
      "no-restricted-syntax": [
        "error",
        {
          // Bare and bracketed hex. Row-level exemptions (the Google brand mark in
          // signin/page.tsx, and layout.tsx's static viewport themeColor) carry an
          // inline eslint-disable with their reason — NOT a whole-file ignore, which
          // would switch this clause off across 36 and 4 of B's own rows respectively.
          selector: "Literal[value=/#[0-9a-fA-F]{6}\\b/]",
          message:
            "Colour literal: use a token from brand.css (see the A1 vocabulary). " +
            "If this is a third-party brand mark or a static viewport colour, add an " +
            "inline eslint-disable-next-line with the reason.",
        },
        {
          selector: "TemplateElement[value.raw=/#[0-9a-fA-F]{6}\\b/]",
          message: "Colour literal in a template: use themeColour() from app/utils/themeColour.ts.",
        },
        {
          // The retired keys. Zero remain; this is what keeps them from coming back.
          selector:
            "Literal[value=/\\b[a-z-]+-brand-(blackout|console|deck|beam|signal|frost|steel)\\b/]",
          message:
            "Retired brand.* colour key. These were removed at B-final — use the role " +
            "token (accent, ink, surface-base, …).",
        },
        {
          selector:
            "TemplateElement[value.raw=/\\b[a-z-]+-brand-(blackout|console|deck|beam|signal|frost|steel)\\b/]",
          message: "Retired brand.* colour key — use the role token.",
        },
        {
          // Composed tokens bake their own alpha, so an opacity modifier on one
          // double-applies it. `bg-surface-accent-solid/20` is 20% of an already-20%
          // colour, and it reads like it means 20%.
          selector:
            "Literal[value=/\\b(bg|text|border|ring|divide|from|via|to|fill|stroke|shadow|outline|decoration|caret|accent)-(surface-accent|surface-ink|edge-accent)[a-z0-9-]*\\/[0-9]/]",
          message:
            "Opacity modifier on a composed token. Layer-2 tokens already carry their " +
            "alpha — use a Layer-1 role with a modifier instead.",
        },
        // NOT HERE, and deliberately: the rgb()/rgba()/hsl() clause.
        //
        // Eight category-5 rows in app/** are dispositioned B but belong to Child C's
        // families — ServiceReadinessCard's rgba(239,68,68,·) x4 (red-500) and DayCard's
        // rgba(251,191,36,·) x4 (amber-400). B must not pre-empt C's families, and cannot
        // tokenise them onto existing roles either, since 239 68 68 is not --negative-fg
        // and 251 191 36 is not --warning-fg. Landing the clause now would mean this
        // config cannot reach 0 errors. It lands with Child C.
        //
        // Also not here: the palette-family clauses (gray-500 and kin). Same reason —
        // they land per family with C.
      ],
    },
  },
]);
