# ADR-0001: Pin transitive dependencies with npm `overrides`

**Date:** 2026-07-29 (block accumulated 2026-05-19 → 2026-07-29) · **Status:** Accepted

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
| `minimatch: ^10.2.2` + `brace-expansion: ^5.0.8` | Move **together**. brace-expansion 2.x has no patched release for the ReDoS advisory, and minimatch 9 crashes at runtime with brace-expansion 5 (`brace_expansion_1.default is not a function`). |
| `postcss: ^8.5.10` | Next ships a bundled postcss; an override is the only way to pin it without downgrading Next. |
| `js-yaml@3: 3.14.2` and `@vercel/frameworks: { js-yaml: ^3.15.0 }` | Version-scoped on purpose. The 4.x copy under ESLint is unaffected, so a blanket pin would be wrong. |
| `sharp: ^0.35.0` | libvips CVEs; the vulnerable copy sits under Next. |
| `adm-zip: ^0.6.0` | Under the Sanity CLI chain. |

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
