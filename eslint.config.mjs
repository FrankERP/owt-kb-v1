import { defineConfig, globalIgnores } from "eslint/config";
import nextCoreWebVitals from "eslint-config-next/core-web-vitals";
import nextTypescript from "eslint-config-next/typescript";

export default defineConfig([
  globalIgnores([
    ".next/**",
    ".remember/**",
    // Agent tooling and local session state, none of it app source — but the
    // reason it must be IGNORED rather than merely uninteresting is
    // `.claude/worktrees/`, where the repo's own worktree flow checks out full
    // copies of this repository. Those copies are real `.ts` files, so eslint
    // walks them, and every `files:` override below is matched against a path
    // relative to THIS config's directory. `e2e/**` therefore does not match
    // `.claude/worktrees/<name>/e2e/**`, and the Playwright-fixture exemption
    // silently stops applying: on 2026-08-21 the gate reported 4
    // `react-hooks/rules-of-hooks` errors in a worktree copy of
    // `e2e/service-readiness/fixtures.ts` while the canonical file linted clean.
    //
    // That is worse than noise. It reports errors in a file nobody edited, which
    // either blocks a good release or invites a "fix" to source that was never
    // broken. Linting a second checkout of the same tree can only ever produce a
    // duplicate verdict or a wrong one.
    //
    // ESLint is the ONLY gate that was exposed, which is worth writing down
    // because `tsconfig.json` looks like it should be — `include: ["**/*.ts"]`
    // with only `node_modules` excluded. It is not: TypeScript's wildcards skip
    // directories whose names begin with a dot, which is also why
    // `.next/types/**/*.ts` has to be listed there explicitly. Vitest and
    // Tailwind are safe for a different reason (root-anchored globs: `app/**`
    // cannot match `.claude/worktrees/<name>/app/**`), and the repo's
    // directory-walking guard tests all start from a named subtree, never the
    // repo root. All four verified by canary on 2026-08-21. Flat config reaches
    // dot-directories because its only default ignores are `node_modules` and
    // `.git` — so do NOT "fix" the sibling configs to match this one.
    ".claude/**",
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
            "Literal[value=/\\b(bg|text|border|ring|divide|from|via|to|fill|stroke|shadow|outline|decoration|caret|accent)-(surface-accent|surface-ink|edge-accent|edge-control|placeholder|warning-glow)[a-z0-9-]*\\/[0-9]/]",
          message:
            "Opacity modifier on a composed token. Layer-2 tokens already carry their " +
            "alpha — use a Layer-1 role with a modifier instead.",
        },
        // ---- Landed by Child C ------------------------------------------------
        //
        // Both clause families below were deferred by Child B, which recorded here that
        // it could not land them: eight category-5 rows were dispositioned B but belonged
        // to C's families, so the config could not have reached 0 errors. C3 and C4
        // migrated exactly those, and both clauses became satisfiable.
        {
          // rgb()/rgba()/hsl() LITERALS. The negative lookahead is what keeps this rule
          // from forbidding its own fix — `rgb(var(--accent-rgb) / 0.2)` is the correct
          // form and must pass.
          //
          // NO `\b` ANCHOR, and that is load-bearing rather than stylistic. Tailwind
          // writes spaces as underscores inside an arbitrary value, so a shadow reads
          // `shadow-[0_0_0_1px_rgb(…)]` — `_` is a word character, so `\b(rgba?)\(`
          // asserts a boundary that is not there and the rule silently misses it. The
          // inventory's own category 6 carried exactly that bug from A1 until Child C's
          // review found it.
          selector: "Literal[value=/(rgba?|hsla?)\\((?!\\s*var\\()/]",
          message:
            "Colour function literal: use themeColour() from app/utils/themeColour.ts, " +
            "or rgb(var(--role-rgb) / a) directly.",
        },
        {
          selector: "TemplateElement[value.raw=/(rgba?|hsla?)\\((?!\\s*var\\()/]",
          message:
            "Colour function literal in a template: use themeColour() from " +
            "app/utils/themeColour.ts.",
        },
        {
          // The raw palette families. All 901 rows migrated across C2-C8; this is what
          // stops them coming back.
          //
          // `mono` is deliberately NOT in this list and cannot be: it is C's own gray
          // scale. That is also why the scale is not called `neutral`, `slate`, `zinc`
          // or `stone` — each is a Tailwind family, and naming the scale after one would
          // make this clause ban the tokens it exists to enforce.
          selector:
            "Literal[value=/\\b(bg|text|border|ring-offset|ring|divide|from|via|to|fill|stroke|placeholder|shadow|outline|decoration|caret|accent)-(gray|red|yellow|green|amber|orange|purple|blue|slate|zinc|neutral|stone|emerald|teal|cyan|sky|indigo|violet|fuchsia|pink|rose|lime)-[0-9]{2,3}\\b/]",
          message:
            "Raw Tailwind palette class. Use a role token: mono-* for greys, and " +
            "negative/warning/recency/positive/availability/badge-* for the rest " +
            "(see brand.css).",
        },
        {
          selector:
            "TemplateElement[value.raw=/\\b(bg|text|border|ring-offset|ring|divide|from|via|to|fill|stroke|placeholder|shadow|outline|decoration|caret|accent)-(gray|red|yellow|green|amber|orange|purple|blue|slate|zinc|neutral|stone|emerald|teal|cyan|sky|indigo|violet|fuchsia|pink|rose|lime)-[0-9]{2,3}\\b/]",
          message: "Raw Tailwind palette class in a template — use a role token.",
        },
        // SCOPE, stated because the clauses above read broader than they are: this block
        // is `files: ["app/**/*.{ts,tsx}"]`, so it covers TS and TSX only. It does NOT
        // cover app/(admin)/globals.css, app/(client)/globals.css, app/brand.css,
        // scripts/, sanity/ or tailwind.config.ts — ESLint cannot lint CSS without a
        // plugin. Both globals.css files carry zero palette classes and zero rgba()/hsl()
        // literals today, so there is no live hole; but "stops them coming back" is true
        // of the TS/TSX surface, not of the whole repository.
        //
        // STILL NOT HERE: any clause for `white`/`black`. Child C left 45 such rows
        // literal on purpose — they are contrast anchors, not palette entries — and a
        // family clause keyed on `-\d{2,3}` cannot match a keyword anyway. Adding an
        // allowlist for them would guard against a rule that does not exist.
      ],
    },
  },
]);
