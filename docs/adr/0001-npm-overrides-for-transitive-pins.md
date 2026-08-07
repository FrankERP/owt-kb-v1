# ADR-0001: Pin transitive dependencies with npm `overrides`

**Date:** 2026-07-29 (block accumulated 2026-05-19 → 2026-08-07) · **Status:** Accepted

## Context

Most security advisories in this tree land on transitive dependencies whose
parents have no patched release — or whose parent upgrade is a breaking major.
`npm audit fix` either can't reach them or wants to downgrade Next.js to do it.

## Decision

Pin them in the `overrides` block in `package.json`. Current entries and why
each exists:

| Override | Reason |
|---|---|
| `nodemailer: ^9.0.3` | **Load-bearing — see below.** Dedupes next-auth's copy onto 9. |
| `minimatch: ^10.2.2` + `brace-expansion: ^5.0.9` | Move **together**. brace-expansion 2.x has no patched release for the ReDoS advisory, and minimatch 9 crashes at runtime with brace-expansion 5 (`brace_expansion_1.default is not a function`). Raised 5.0.8 → 5.0.9 on 2026-08-07 for CVE-2026-69152 (DoS via unbounded intermediate arrays, bypassing the earlier CVE-2026-14257 mitigation); minimatch 10 already accepts it, so this half moved alone. |
| `postcss: ^8.5.10` | Next ships a bundled postcss; an override is the only way to pin it without downgrading Next. |
| `js-yaml@3: 3.14.2` and `@vercel/frameworks: { js-yaml: ^3.15.0 }` | Version-scoped on purpose. The 4.x copy under ESLint is unaffected, so a blanket pin would be wrong. |
| `sharp: ^0.35.0` | libvips CVEs; the vulnerable copy sits under Next. |
| `adm-zip: ^0.6.0` | Under the Sanity CLI chain. |
| `undici@6: ^6.28.0` and `undici@7: ^7.29.0` | Version-scoped on purpose, like `js-yaml@3` — the tree holds **two** undici majors and a blanket pin would force `@actions/http-client` (which declares `^6.23.0`) across a major. Both vulnerable copies sit under `@sanity/cli`: the 6.x line via `@sanity/template-validator → @actions/*`, the 7.x via `isomorphic-dompurify → jsdom@28`. Each replacement stays **inside** its consumer's declared range. Added 2026-08-07 for eight advisories (cookie-attribute injection, CRLF injection, retry-interceptor response desync, private-cache-directive disclosure). |
| `esbuild: ^0.28.1` | **Deliberately outside a declared range — do not "correct" it.** `vite@7.3.5` (Sanity CLI chain) declares `esbuild ^0.27.0`, which excludes the patched 0.28.1; `vite@8` (vitest) already accepts `^0.27.0 \|\| ^0.28.0` as an optional peer, and `tsx` shipped 0.28.1 before this. Verified functional rather than assumed: `vite@7.3.5`'s `transformWithEsbuild` runs correctly against 0.28.1, and `sanity schema validate` passes (traced to confirm it really loads the overridden esbuild through the CLI's vite). That exercises the config-load path — `schema validate`/`schema deploy` — **not** vite's full bundling pipeline. The durable reason that gap is safe: this app never bundles through the Sanity CLI. The Studio is embedded with `next-sanity`'s `<NextStudio>` and built by Next itself (`app/(admin)/studio/[[...tool]]/page.tsx`), so `sanity build` / `sanity dev` are not part of any workflow here. If someone does start running `sanity dev` locally, re-verify this pin. Drop the entry once the Sanity CLI's vite moves to 0.28. |

## Rejected

**Upgrading the parents instead.** `npm audit fix --force` proposes
`next@14.2.35` — a downgrade across two majors to resolve a `sharp` advisory.

**Making `nodemailer: ^9` a plain direct dependency with no override.** This was
tried and reverted once already (`a295e9e` → `a0e78b0`, 2026-07-10): next-auth 4
declares `peerOptional nodemailer@^7.0.7`, so without the override `npm ci` —
and therefore Vercel's install step — fails with `ERESOLVE`. **Deleting that one
line is a deploy-breaker, not a cleanup.** It is safe only because next-auth's
email provider is unused here (Google SSO + credentials only).

## Consequences

Overrides are invisible to `npm outdated` and silently keep applying after the
parent ships its own fix, so the block only grows unless someone prunes it.
Revisit when a parent's patched release lands; drop the entry and re-run
`npm audit` to confirm before removing.

`@types/nodemailer` deliberately stays on `^8` — there is no v9 release. The
mismatch is expected, not an oversight; typechecks pass.

**What an override cannot reach (state at 2026-08-07).** The entries above clear
the ten open Dependabot alerts of 2026-08-07 (eight `undici`, one
`brace-expansion`, one `esbuild`) — the installed tree no longer contains a
vulnerable version of any of them. `npm audit` still reports two root causes,
both under `@sanity/cli`, neither fixable by pinning:

- **js-yaml 3.x** (`@vercel/frameworks → @sanity/cli → sanity → next-sanity`).
  CVE-2026-59870's fix was **not backported to 3.x**, so *every* 3.x release is
  vulnerable and the existing `js-yaml@3` pin cannot resolve it. The four extra
  audit lines naming `@vercel/frameworks`, `@sanity/cli`, `sanity` and
  `next-sanity` are that one issue propagating up the chain, not four problems.
- **dompurify ≤3.4.12** (`isomorphic-dompurify → @sanity/cli`).

Both need a `sanity` major (5 → 6), which is the parent upgrade this ADR rejects
for security-patch work. Revisit with that upgrade, on its own plan.
