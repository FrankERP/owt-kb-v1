# Dev verification runner — design

**Date:** 2026-09-01 · **Status:** approved in conversation, awaiting written-spec review
**Risk tier:** standard for the runner; **critical for §3 (session and secrets) and §4
(read-only guarantee)** — those two sections get one adversarial plan-review round before
implementation, because the design puts an `admin` credential and a live session on disk.

## 1. Problem

Every member-facing and admin surface of the app is session-gated, and dev
(`dev-owt-backstage.vercel.app`) additionally sits behind Vercel SSO protection
(`ssoProtection.deploymentType = prod_deployment_urls_and_all_previews`, checked
2026-09-01). An agent cannot enter credentials — that is a hard rule of the agent's charter
and of `visual-verifier`'s — so today a UI change reaches production having been looked at
by no one but Frank on dev. The «Limpiar mes» release on 2026-09-01 is the motivating
case: gates green, three review rounds, and still no agent had seen the button render.

Two existing pieces do not cover this:

- The **A3 harness** (`e2e/service-readiness`, `docs/VERIFICATION_HARNESS.md`) logs in with
  credentials read from the runner's env — the pattern this design reuses — but it
  **refuses dev as a base URL on purpose**, because dev is backed by the production dataset
  and the harness mutates.
- **ADR-0017** made the theme gallery public rather than provision a session for the agent,
  and explicitly rejected "a second read-only login path" as more auth surface than
  benefit. This design honours that: it adds **no server-side login path** and changes
  nothing in `auth.ts`, `proxy.ts`, or any route.

## 2. Scope

**In:** a local, on-demand, read-only browser runner that an agent invokes from Bash to
observe dev as a signed-in admin: screenshots, page text, accessibility tree, console
errors, failed requests. A seed script (dry-run by default) for the verification member.
Documentation and secret entries.

**Out:** any write to Sanity through the runner; any change to authentication or
middleware; CI integration; fixed regression suites (a possible later addition on top of
this runner); production (`owt-backstage.vercel.app`) as a target, ever.

Decisions already taken with Frank (2026-09-01): read-only only; a dedicated
«Verificador» member rather than Frank's own account; approach 1 (Playwright CLI) over fixed
smoke specs or a server-minted session.

## 3. Session and secrets

### 3.1 The verification member

One `teamMembers` document, created once in the **production dataset** (the only dataset
dev reads):

| Field | Value | Why |
|---|---|---|
| `member_name` | `Verificador (bot)` | Visibly not a person in every list it appears in. |
| `alias` | `Verificador` | |
| `email` | the value of `DEV_VERIFY_EMAIL` | Credentials provider looks members up by email. |
| `role` | `admin` | Reaches `/admin` (services, members, songs). Not `super-admin`: no impersonation, no super-admin-only actions. |
| `ministries` | `["worship"]` | Membership gates member-facing worship pages (`requireMinistryMember`). **Not kids:** kids rotation seats from the pair register, so kids membership would make the bot a seatable pair member. *(Amended 2026-09-03 by ADR-0029: this row cited `retirementGatingCoverage.test.ts`, deleted with the retirement mechanism.)* Member-facing `/kids` is therefore out of reach; `/kids/admin` is not (next row). |
| `managesMinistries` | `["kids"]` | `requireMinistryManager` needs management, not membership, so kids planner pages stay reachable without seating the bot. No guard reads a `worship` entry here. |
| `memberType` | `[]` | Excluded from every worship selection point: seats filter on `memberType`, and the solver pools are built from it. *(Amended 2026-09-03 by ADR-0029 — this row was `retiredFrom: ["worship"]` until soft retirement was removed.)* |
| `memberType` | absent | Never a candidate for any section. |
| `notifPrefs` | every boolean `false`, `setlist: "off"` | Never emailed, never pushed. |
| `passwordHash` | bcrypt of `DEV_VERIFY_PASSWORD`, computed by the seed script from `DEV_VERIFY_PASSWORD_HASH` | Same mechanism as the A3 admin fixture (`SR_VERIFY_ADMIN_PASSWORD_HASH`): the script injects a hash, never a password. |
| `disabled` | absent | `isMemberActive` is the login gate; an empty `memberType` does not block login. Setting `disabled: true` is the kill switch if the credential is ever suspected leaked. |

What is NOT filtered: the member appears in `/admin/members` and in participation
counts as a retired member with zero services. That is acceptable and honest; adding a
"hidden member" concept to member-facing reads is out of scope (YAGNI, and a filter that
hides a member is exactly the kind of read rule that later masks a real bug).

**Seed script** `scripts/dev-verify-seed.mjs`: dry-run by default, `--apply` is the only
token that writes, run as `node --env-file=.env.local scripts/dev-verify-seed.mjs`.
Idempotent on the deterministic `_id` `member-dev-verify` (hyphenated: a dotted id is a
Sanity path hidden from untokened reads, the hidden-member mechanism rejected above). An
existing document is **patched** and `disabled` is never touched, so the kill switch
survives a password rotation; the document is created only when absent. Refuses if another
member already uses the email (case-insensitive, matching `auth.ts`). Prints the document it
would write with `passwordHash` redacted. Frank runs
`--apply`; the agent never does (production write ⇒ explicit consent, per CLAUDE.md).

### 3.2 Secrets and where they live

| Name | Where | Not needed | Purpose |
|---|---|---|---|
| `DEV_VERIFY_EMAIL` | local `.env.local` only | Vercel (any env), CI, mobile | Which member the runner signs in as. Not secret by itself, documented for completeness. |
| `DEV_VERIFY_PASSWORD` | local `.env.local` only | Vercel, CI, mobile | Typed by Playwright into the credentials form. |
| `DEV_VERIFY_PASSWORD_HASH` | local `.env.local` only, seed time | Vercel, CI, mobile, the runner | bcrypt hash the seed script injects. Generated by Frank with `node -e` + `bcryptjs` (the repo's existing dependency), never committed. |
| `SR_VERIFY_BYPASS_SECRET` | local `.env.local` (already present for A3) | — | Vercel Protection Bypass for Automation, sent as `x-vercel-protection-bypass`. **Currently undocumented in `docs/SECRETS.md`**; this delivery adds its entry. |

Every entry follows the global convention: name, platforms, purpose, provenance, rotation
steps, blast radius. Rotation of the password: change it in Sanity via the seed script
(`--apply` with a new hash), update `.env.local`, delete the cached storage state. Blast
radius during rotation: the runner fails to sign in until both sides agree — nothing else
in the app is affected, because nothing else uses the member.

### 3.3 The cached session

Playwright `storageState` written to `playwright/.dev-verify-storageState.json`. Already
excluded by `.gitignore` (`*storageState*.json`, with the comment that a storage state is a
live session). Reused across runs; on a 401/redirect-to-signin the runner deletes it and
signs in again once. Never copied into the scratchpad, the report, or stdout. The bypass
secret is sent as a header only and never appears in a URL, the storage state, or any
artifact; the A3 leak scanner (`scanForSecretLeak` in `e2e/service-readiness/lib/bypass.ts`)
runs over every file the runner writes — artifacts and the storage state alike — and over
the report itself, on every exit path, refusals included. The header is attached per
request and only to target-origin requests; third-party hosts never receive it.

### 3.5 Writes the app itself performs on sign-in — disclosed

"Read-only" is a property of the runner, not of the app it drives. Two app-side writes exist:

- **`loginEvent`:** `auth.ts`'s `events.signIn` creates one `loginEvent` document on every
  credentials sign-in. Lock 4.1 cannot stop it (it is server-side, behind the one allow-listed
  POST), and avoiding it would mean changing `auth.ts`, which is out of scope. It is bounded to
  once per cached session (7-day JWT) or per rotation, and the bot shows up in the admin
  login-activity view under its own name. **Accepted by Frank, 2026-09-01.**
- **`lastSeen` heartbeat — suppressed, never allow-listed:** `ActivityPing` POSTs
  `/api/activity/ping` on the first authenticated page of every fresh browser, keyed in
  `sessionStorage`, which a Playwright storage state does not carry. The runner seeds that key
  through `addInitScript`, so the request never fires. If the seed ever stops matching the
  component's key, the POST is blocked by lock 4.1 and the run exits 3 — the correct failure. A
  vitest pins the key to the component's source.

### 3.4 Threat model, stated plainly

The credential is `admin` on the production dataset. If `.env.local` leaks, the holder can
sign in to production as an admin — the runner's host allow-list does not bind a human.
Mitigations, in order of strength: `disabled: true` on the member is an immediate kill
switch; the password is rotated by re-seeding; the member has no super-admin powers. This
is the same exposure the A3 admin fixture already carries, and it is why this section gets
an adversarial review round. Use an email with **no Google account**: Google SSO also signs
in by email lookup, so a Google identity on `DEV_VERIFY_EMAIL` would be a second door.

## 4. Read-only guarantee

Three independent locks. Each is sufficient on its own; they fail in different ways.

1. **Request interception.** A context-wide `route("**/*")` aborts every request to the
   target origin whose method is not `GET` or `HEAD` — wider than `/api/**`, because a
   Next.js server action POSTs to the page URL — and records `{ method, url, phase }` as a
   `blocked_mutation` event in the run report. Third-party origins are continued untouched,
   which makes the lock origin-scoped: Studio's calls to `api.sanity.io` are not policed, and
   that is safe only because the runner holds no Sanity login. Service workers are blocked at
   the context. NextAuth's own `POST /api/auth/callback/credentials` is the **one allow-listed
   exception**, matched by exact path, and only while the runner is in its sign-in step. Any
   `blocked_mutation` makes the run exit non-zero: a read-only check that tried to write is a
   finding in itself.
   **Landed-origin rule, part of the same lock:** dev answers `302 https://vercel.com/sso-api`
   without a valid bypass. After every navigation and every click the runner asserts
   `new URL(page.url()).origin` equals the target origin and refuses otherwise (exit 2). Without
   it a rotated or unhonoured secret would produce a green run whose screenshot is the SSO wall.
2. **Host allow-list.** Before opening a browser, the target origin must be exactly
   `https://dev-owt-backstage.vercel.app` or match
   `https://owt-backstage-*-frank-rochas-projects.vercel.app`. `owt-backstage.vercel.app`
   and its `-git-main-` alias are named explicitly as forbidden, checked before the
   allow-list, so a future loosening of the pattern cannot silently admit production
   (the same "two axes" shape as A3's `harnessGuards`).
3. **Member posture.** Even if 1 and 2 both failed, the member is retired from worship,
   is not a kids member (kids reads ignore retirement, so membership is the one thing that
   would seat it), and is opted out of every notification, so a stray write could not assign
   it, email through it, or place it in a pool.

Not a lock, but relevant: the runner never runs Sanity client code and imports no write
token. `SR_VERIFY_SANITY_TOKEN` is not read. The two app-side writes that sign-in itself
causes are in §3.5.

## 5. Interface

```bash
npx tsx --env-file=.env.local scripts/dev-verify.ts \
  --route /admin --screenshot admin.png --text --console \
  --viewport 1280x800 --theme dark
```

| Flag | Meaning |
|---|---|
| `--route <path>` | Required. Path on the allowed origin. |
| `--base-url <origin>` | Optional; defaults to the stable dev origin. Must pass the host check. |
| `--screenshot <file>` / `--full-page` | PNG into the scratchpad directory (or the given path). |
| `--text` | Page `innerText` of `main`, falling back to `body`. |
| `--a11y` | Accessibility tree snapshot (Playwright's `ariaSnapshot`). |
| `--console` | Console errors and warnings, plus failed network requests. |
| `--viewport WxH` | Default `1280x800`. |
| `--theme light\|dark` | Emulates `prefers-color-scheme`. Does not touch `/me` (that would be a write). |
| `--click "<accessible name>"` | Repeatable, in order. Clicks a button/link by role+name before capturing, e.g. to open «Editar mes». Still read-only by lock 4.1. |
| `--wait "<text>"` | Wait until the text is visible before capturing (max 30 s). |
| `--json` | Report as JSON on stdout; default is a short human summary. |

Every run reports, first, which deployment it looked at. The runner holds no Vercel token
and does not call the Vercel API; it records the `x-vercel-id` response header of the
first navigation. The coordinator pairs that with the alias SHA from the existing
`get_deployment` check. The two together are the evidence that the right commit was
observed; the runner alone proves only that *some* deployment answered.

Exit codes: `0` success; `2` refused (host, missing env, sign-in failed); `3` at least one
`blocked_mutation`; `4` page error (uncaught exception or HTTP ≥ 500 on the route).

## 6. Implementation shape

- `scripts/dev-verify.ts` — entry; argument parsing, host check, session bootstrap,
  capture, report. Imports Playwright from the existing dev dependency.
- `scripts/lib/dev-verify/` — pure modules, unit-tested with vitest:
  `hostPolicy.ts` (allow/forbid), `mutationPolicy.ts` (method/path → allow | block, with
  the sign-in exception window), `args.ts` (flag parsing and validation),
  `report.ts` (report shape and redaction). `*.test.ts` under `scripts/__tests__/`.
- `scripts/dev-verify-seed.mjs` — member seed, dry-run default, `--apply`, idempotent on
  email. Uses the repo's existing Sanity write-client pattern for one-off scripts.
- Reused, not copied: `e2e/service-readiness/lib/bypass.ts` (`bypassHeaders`,
  `scanForSecretLeak`). Because that helper is TypeScript, the runner is
  `scripts/dev-verify.ts`, run with the `tsx` the repo already depends on (as
  `scripts/set-password.ts` and `scripts/seed-solver-config.ts` are):
  `npx tsx --env-file=.env.local scripts/dev-verify.ts …`. The seed script stays `.mjs`
  like the other one-off Sanity writers. No new runtime.

## 7. Verification

- **Unit:** host policy (both axes, forbidden-before-allowed), mutation policy (every
  method × `/api/**` × sign-in window), args, report redaction (a storage-state path or
  bypass secret value in any field fails the test).
- **Manual, recorded in the delivery:** (a) `--route /admin --screenshot` renders the
  Servicios panel signed in as Verificador; (b) `--route /admin --click "Eliminar servicio"
  --click "Eliminar"` — a service card's delete action, then its modal confirm, reachable
  on any stored service without depending on drafts existing — ends with exit `3` and a
  `blocked_mutation` naming the `DELETE`, proving lock 4.1 with a real destructive control;
  (c) `--base-url https://owt-backstage.vercel.app`
  exits `2` before any network activity (verified with `--console`: zero requests).
- **Review:** one adversarial round on §3–§4 before implementation (critical tier, one
  fresh `APPROVED`; a second on unchanged bytes if the reviewer finds a substantive
  blocker, per the churn cap). Fresh code review of the diff before merge, as always.

## 8. Documentation

- `docs/DEV_VERIFY.md` — how to run it, what it can and cannot do, the read-only locks,
  exit codes, the seed procedure, and the kill switch.
- `docs/SECRETS.md` — entries for `DEV_VERIFY_EMAIL`, `DEV_VERIFY_PASSWORD`,
  `DEV_VERIFY_PASSWORD_HASH`, and the missing `SR_VERIFY_BYPASS_SECRET`.
- `CLAUDE.md` — one line under "Reusable utils" or "Vercel safety" pointing at
  `docs/DEV_VERIFY.md`, and a note in the push-order rule that the dev verify step can now
  be performed by the agent for read-only checks.
- `~/.claude/agents/visual-verifier.md` — the "session-gated routes are out of scope"
  paragraph gains: "unless the coordinator has run `scripts/dev-verify.ts`, whose
  artifacts you may read", keeping the never-enter-credentials rule intact.
- `docs/adr/` — a short ADR: "Agent verification on dev uses a local read-only runner, not
  a server login path", recording the rejected alternatives (server-minted session, Frank's
  account, fixed smoke suite) and linking ADR-0017.

## 9. Open questions

None blocking. One the implementer records rather than decides: whether Playwright's
bundled Chromium is already installed on this machine. If not, `npx playwright install
chromium` is a one-time step, and `docs/DEV_VERIFY.md` names it either way.
