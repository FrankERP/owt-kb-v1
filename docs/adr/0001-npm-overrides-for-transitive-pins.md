# ADR-0001: Pin transitive dependencies with npm `overrides`

**Date:** 2026-07-29 (block accumulated 2026-05-19 → 2026-08-14) · **Status:** Accepted

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
| `minimatch: ^10.2.6` + `brace-expansion: ^5.0.9` | Move **together**. brace-expansion 2.x has no patched release for the ReDoS advisory, and minimatch 9 crashes at runtime with brace-expansion 5 (`brace_expansion_1.default is not a function`). Raised 5.0.8 → 5.0.9 on 2026-08-07 for CVE-2026-69152; minimatch floor raised 10.2.2 → 10.2.6 on 2026-08-14 because GHSA-7r86 / GHSA-23c5 patch at 10.2.3 and a `^10.2.2` floor still intersects those ranges. |
| `glob: ^10.5.0` | Stays on glob 10 (glob 11+ is a different major). Floor raised 10.4.6 → 10.5.0 on 2026-08-14 for GHSA-5j98 (`>= 10.2.0, < 10.5.0`). |
| `postcss: ^8.5.26` | Next ships a bundled postcss; an override is the only way to pin it without downgrading Next. Floor raised 8.5.10 → 8.5.26 on 2026-08-14: GHSA-6g55 / GHSA-r28c / GHSA-fxqj patch at 8.5.12 / 8.5.18 / 8.5.23, and `^8.5.10` still includes every one of those vulnerable releases. |
| `js-yaml@3: ^3.15.1`, `js-yaml@4: ^4.3.1` and `@vercel/frameworks: { js-yaml: ^3.15.1 }` | Version-scoped on purpose — the tree holds a 3.x copy (under `@vercel/frameworks → @sanity/cli`) and a 4.x copy (under `@eslint/eslintrc`), and a blanket pin would drag one across a major. Both lines were raised on 2026-08-07 for CVE-2026-59870 (quadratic CPU in `!!omap` resolution). **The 4.x copy is no longer "unaffected"** — that earlier note was true only until this advisory, which patched both lines separately (3.15.1 and 4.3.1). |
| `dompurify: ^3.4.13` | XSS via an IN_PLACE hook leaving a detached subtree executable. Blanket is right here: both copies (`isomorphic-dompurify@2.26.0` under `sanity`, `@2.36.0` under `@sanity/cli`) declare `^3.x` ranges that accept it. Added 2026-08-07. |
| `sharp: ^0.35.0` | libvips CVEs; the vulnerable copy sits under Next. |
| `adm-zip: ^0.6.0` | Under the Sanity CLI chain. |
| `undici@6: ^6.28.0` and `undici@7: ^7.29.0` | Version-scoped on purpose, like `js-yaml@3` — the tree holds **two** undici majors and a blanket pin would force `@actions/http-client` (which declares `^6.23.0`) across a major. Both vulnerable copies sit under `@sanity/cli`: the 6.x line via `@sanity/template-validator → @actions/*`, the 7.x via `isomorphic-dompurify → jsdom@28`. Each replacement stays **inside** its consumer's declared range. Added 2026-08-07 for eight advisories (cookie-attribute injection, CRLF injection, retry-interceptor response desync, private-cache-directive disclosure). |
| `nanoid@3: ^3.3.18` and `nanoid@5: ^5.1.16` | Version-scoped like `js-yaml` and `undici` — the tree holds a 3.x copy (under `postcss`, `@sanity/client`, `sanity`) and a 5.x copy (under `@sanity/mutate`, `@sanity/cli`, `@sanity/bifur-client`), and the two advisories patch the lines separately. A blanket pin would drag the 3.x consumers across two majors. The 3.x floor moved 3.3.17 → 3.3.18 on 2026-08-14: GHSA-2v37's range is `< 3.3.18`, so the 2026-08-07 pin of `^3.3.17` still admitted the vulnerable release. No 4.x copy exists, which matters because the 5.x advisory's range starts at 4.0.0 and there is no 4.x patch. |
| `protobufjs: ^7.6.5` | Stays on protobufjs 7 (8.x is a different major). Floor raised 7.5.8 → 7.6.5 on 2026-08-14 for GHSA-j3f2 (`>= 7.5.0, <= 7.6.4`). |
| `ws: ^8.21.3` | Floor raised 8.20.1 → 8.21.3 on 2026-08-14 for GHSA-96hv (`>= 8.0.0, < 8.21.0`). |
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

**State at 2026-08-14: `npm audit` reports 0 vulnerabilities.** The lockfile
already sat on patched releases after the 2026-08-07 sweep; Dependabot was
still matching **declared ranges** in `package.json` (direct deps and this
overrides block) that intersected later GHSA floors. A `^8.5.10` postcss pin
resolves to 8.5.25 in the lockfile and still alerts, because 8.5.10–8.5.22
remain installable. Raise the floor to `first_patched_version`, not to a
version the lockfile happens to have resolved past. Direct floors moved the
same way: `next` `^16.2.6` → `^16.2.12` (nine App Router GHSAs patch at
16.2.11) and `next-auth` `^4.24.14` → `^4.24.15`.

**Read an advisory's `first_patched_version`, not its title.** The js-yaml
advisory is titled "CVE-2026-59870 fix **not backported**", which reads as "no
patched release exists on this line". It is not what it means: both lines were
patched separately (3.15.1 and 4.3.1), and this tree was sitting exactly one
patch below each. `npm audit`'s vulnerable-range output (`3.0.0 - 3.15.0 ||
4.0.0 - 4.3.0`) says so too, if read as an upper bound rather than a verdict.
The same mistake was nearly made for `dompurify` (`<= 3.4.12`, patched 3.4.13).
Before concluding that any advisory here is unreachable, check the patched
version — `gh api repos/OWNER/REPO/dependabot/alerts` prints it per alert.

**Do not raise a floor across a major to chase a withdrawn duplicate.**
GHSA-qmq6 (`uuid < 14`) is withdrawn; the live advisory (GHSA-w5hq) is already
satisfied by `uuid@11.1.1` / `13.0.1`. Jumping the override to 14 would drag
every `^9`/`^10`/`^11` consumer across three majors for a duplicate row.

Four audit lines naming `@vercel/frameworks`, `@sanity/cli`, `sanity` and
`next-sanity` were only the js-yaml issue propagating up the chain, not four
separate problems — worth remembering when the next chain lights up.
