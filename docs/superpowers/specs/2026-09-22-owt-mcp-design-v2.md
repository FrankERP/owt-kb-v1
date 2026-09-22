# OWT Backstage MCP server — design spec v2

**Date:** 2026-09-22
**Status:** `DRAFT` — reconciled, not yet reviewed. **Authorizes nothing.**
**Supersedes:** [`2026-07-28-owt-mcp-design.md`](2026-07-28-owt-mcp-design.md),
which was approved on its own terms and is now factually stale in eleven places.
**Consumer:** Frank only (super-admin), via claude.ai custom connector — phone,
desktop, and web.

## Why there is a v2

The July spec was hardened through three adversarial review rounds and then never
implemented. Nothing about it was built: `app/api/mcp`, `app/api/oauth`,
`app/mcp`, `app/.well-known/**`, `mcp-handler`, `@modelcontextprotocol/sdk` and
`zod` are all absent from the tree and the lockfile. The `mcp-server` branch
exists and is an ancestor of `main` — docs only, zero code.

In the 56 days since, **1 265 commits and 28 ADRs** landed. Eleven of the July
spec's load-bearing statements are now false, and two of its preconditions are
unattainable on this project's plan. A reviewer reading the July document today
would approve a design that cannot be built as written.

This document is the reconciliation. Everything below that is unchanged from July
is unchanged on purpose and is restated so this file is self-contained.

---

## Part I — Reconciliation ledger

Each row is a July statement, the fact that replaced it, and what it costs.

### A. Claims that are now false

| # | July spec said | Today | Consequence |
|---|---|---|---|
| A1 | "the six protected types" (`:62`) | **Seven.** `specialIdentityCoordinator` joined `PROTECTED_TYPES` on 2026-08-05 (`app/utils/protectedReadAudit.ts:21-30`) | Any tool touching special services must know it. The static test pins the 7-item list verbatim (`protectedReadAudit.test.ts:599-608`) |
| A2 | "`run_solver` … a server-side rebuild, not an extraction" (`:180`) | **Half wrong.** `buildSolveRequest` (143 lines) and `applySolveResponse` (70 lines) were extracted to the neutral `app/components/admin/plannerModel.ts` on 2026-07-29 — one day after the spec — and are server-callable today. Their whole transitive import graph is neutral (ADR-0028-compliant) | Assembly is free. Only the Sanity-write half (`applySchedule`) is a build |
| A3 | "`MonthGenerator.tsx` (~1 700 lines)" (`:180`) | **3 924 lines.** It was 1 667 at the last commit before the extraction, so July was accurate then; it has grown 2.35× | The client surface to leave alone is much larger than budgeted |
| A4 | "the ecosystem is zod-v3-based; don't jump to v4 independently" (`:185-187`) | `zod` resolves **transitively at 4.3.6** today, on a production dependency path (via `sanity@5.31.1` → `@sanity/cli`), and is not a direct dependency | The pin must be re-derived from whatever the MCP SDK actually requires now. The July instruction would install a second, conflicting major |
| A5 | "Branch `mcp-server`, merged to `main` per stage (direct push, no PRs …)" (`:236`) | `main` has been **PR-only with `enforce_admins: true` since 2026-08-24** (`docs/CI.md:56-67`). `preview` still takes direct pushes | Every stage is a PR whose `gates` check must be green. The push order is `preview` first, verify the dev alias, then PR to `main` |
| A6 | Read tools return "the Servicios-sidebar numbers via `computeParticipation`" (`:171`) | `MemberParticipation` gained **`especial`**, and `total` now folds it in (2026-07-31) | A July-shaped `get_participation` payload is incomplete, not merely different |
| A7 | `list_proposals` returns "shared proposals with contributor state" (`:172`) | The live conversation moved to **`setlistProposal.messages[]`** (2026-08-24). `lead_notes`/`admin_notes` are a **frozen archive**, no longer written (ADR-0023, amended 2026-08-27) | Reading the July fields returns stale text that looks current — the worst failure mode for a conversational tool |
| A8 | `get_song` returns "lyrics presence" (`:169`) | **ADR-0018:** a filled `chords` chart *hides* `body` in every existing reader. And two divergent "full song" projections coexist — `app/(client)/posts/[slug]/page.tsx:56-87` (tags, authors, reference links, tutorials) vs `app/api/song/[id]/route.ts:16-29` (history, myInstruments, rehearsalMixes) — **neither is canonical** | "Lyrics presence" is not `body != null`. And `get_song` must be defined field by field, never by copying one of the two |
| A9 | The spec's whole tool surface is implicitly worship | The **ministries axis was created 2026-08-20**, three weeks after the spec — `app/ministries.ts`, `requireMinistryMember`/`requireMinistryManager`, `requireWorshipPage`. The session now carries `ministries` and `managesMinistries` | Worship-only is now a *decision* that must be stated, not a silent default. Kids (`kidsPair`, `kidsSchedule`) is a whole vertical the surface omits |
| A10 | "Every write tool … reads the target doc(s) through `operationalClient`, capture `_rev`" (`:79-82`) — framed as the tool's own work | Correct, and **understated**. `requireActiveManager()` takes no `req`: it calls `getServerSession(authOptions)` with no arguments and reads cookies from `next/headers` ambient context (`app/utils/authGuards.ts:13-14`) | An MCP tool authenticates by bearer token and **cannot reuse the admin guards at all**. Every extraction must separate authorization from write logic — a cost the July spec never named |
| A11 | Tests: the matcher "tests updated in the same change" (`:56`) | There are **two** hand-kept lists, not one. Beyond the byte-identical matcher sync guard (`routeMatcher.test.ts:155-166`), `PUBLIC_ROUTES` (`:34-50`) is a separate deliberate allowlist — "Adding to this list is a deliberate, reviewable act" | Two edits per opened route, in the same commit, or the gate fails |

### B. Preconditions that cannot be met

| # | July precondition | Why it fails | Resolution adopted below |
|---|---|---|---|
| B1 | "The MCP route needs `maxDuration` **strictly greater than** the solve route's 60 s" (`:180`) | This project is on **Vercel Hobby**. Every one of the 16 routes that declares `maxDuration` declares exactly `60`; `vercel.json` has no `functions` block; **ADR-0013 states the ceiling explicitly** — "Bounded by `maxDuration = 60`, which Vercel Hobby will not raise. There is no room behind it." ADR-0032 rejected Pro on cost | **Split the tool.** `solve_month` (assemble + solve, writes nothing) and `apply_schedule` (writes) become two calls, each inside 60 s. See D3 |
| B2 | `run_solver` "solves **and writes assignments onto draft services**" in one request (`:180`) | The solver's fairness history is `owt_solver_history_v2` in **`localStorage`**, per an explicit ADR-0010 consequence: *"Decision 2 shares the RULES, not the fairness history, so two admins still solve against different history."* A server-side solver has no access to it | **Derive the history from Sanity role documents** — its own delivery, with its own ADR amending ADR-0010. See D4 |

### C. Things that did not exist to reuse

| # | July spec assumed | Reality |
|---|---|---|
| C1 | "Basic rate limiting on this unauthenticated endpoint" (`/api/oauth/register`) | **No rate limiter exists anywhere in the repo.** The only `rateLimit` hits are nodemailer's outbound SMTP pacing. The one existing unauthenticated route (`api/service-readiness-verification/identity`) fails closed on env checks instead. This must be built |
| C2 | Discovery endpoints as `.well-known` route handlers | **No `.well-known` route exists.** The closest auth precedent is ADR-0017 (the theme gallery: a deliberately public, prerendered, data-free route) |
| C3 | "JWTs signed with a new dedicated secret" | **No repo-owned JWT-signing utility exists.** `jose@4.15.9` is present only transitively under `next-auth`; `jsonwebtoken@9.0.3` only under `firebase-admin`. `google-auth-library` verifies *Google's* tokens against Google's JWKS and issues nothing. A direct, pinned dependency is required (ADR-0001 is the repo's pattern for pinning) |
| C4 | `mcp-handler` × Next 16 as an "open question … none block the design" | Neither `mcp-handler` nor `@modelcontextprotocol/sdk` is in the lockfile, and `next` resolves to **16.2.12**. This is not an open question at the end of planning — it is the **first gate**. (Ambient risk worth recording: `next-sanity@12.4.5` self-reports as "not recommended for usage with Next.js v16") |

### D. New enforcement that did not exist in July

| # | Mechanism | Created | What it does to this work |
|---|---|---|---|
| D1 | **`draftGatingCoverage.test.ts`** | 2026-08-13, kids-extended 08-21/24 | The draft filters were a convention in July — "eight correct call sites and no mechanism". They are now **mechanically enforced**: any new read of `sunday_role`/`saturday_role`/`special_role` under `app/**` without `published != false`, or of `kidsSchedule` without `published == true`, fails `npm test`. Note the rules are **inverted** between worship and kids (ADR-0022) |
| D2 | **Audit registry mechanics, in detail** | continuous | Stricter than the July spec conveys. Entries are exact `file` + `operation` (an exported HTTP method name, or the literal `"module"`), **no globs**; the test pins each registry to an exact sorted list via `toEqual`, so a new entry fails until the assertion is updated; registries are pairwise disjoint; **an entry must be exercised by a real non-compliant site on the same commit** — pre-registering fails the "carries no dead entries" test. Precedent worth heeding: *"Child A Phase E added this read-only reconcile and listed it nowhere, so the audit failed on the commit that introduced it"* |
| D3 | **`PROTECTED_RUNTIME_WRITERS` licenses writes only** | — | *"A guarded runtime route is licensed to write, never to read off a non-canonical client."* Combined with the fact that a non-route module collapses to a single `"module"` operation, a tools module that both reads and writes gets **one registry key that does not excuse its reads**. Every protected read in `app/mcp/**` must go through `operationalClient` regardless of write registration |
| D4 | **The fail-closed dynamic-query trap** | — | A query expression the scanner cannot statically resolve, run on a non-canonical client inside an operation that names a protected type, is a hard violation **with no registry home**. This independently forecloses any "pass me a GROQ string" tool — which the July spec had already ruled out as a non-goal, for different reasons |
| D5 | `revalidateRolePublication` ≠ `revalidateServiceViews` | — | Publication deliberately omits `/posts/[slug]` ("publication state does not change any setlist"). A publish tool must call the bespoke one, not the generic one |

### E. Process debt to clear

The July spec went through three adversarial review rounds and **has no committed
review log**, which the repo convention requires beside the artifact. v2 carries
its own log when reviewed; the July rounds are recorded as unlogged and are not
reconstructed.

---

## Part II — The reconciled design

Unchanged from July except where a reconciliation row forces a change. Decisions
Frank settled on 2026-09-22 are marked **[D-2026-09-22]**.

### Goal

Let Frank manage the OWT app conversationally from the Claude apps: query
services, setlists, assignments, availability and songs; then edit setlists, swap
assignments, publish services, and run the month solver.

### Non-goals

- Team-member access (single-user, super-admin-only by design).
- A standalone service — the MCP lives inside this Next.js app.
- Raw Sanity document access. The hosted Sanity MCP already does that; this server
  exposes the *domain* layer. Now doubly foreclosed by D4.
- Local stdio transport. Remote-only (Streamable HTTP). **[D-2026-09-22]** —
  re-asked and reaffirmed; the phone is the point.
- **Kids ministry. [D-2026-09-22]** The surface is worship-only. Kids is a
  coherent later addition, and it is not free: its draft rule is the strict
  inverse (`published == true`, ADR-0022) and D1 fails the suite on a read that
  copies the worship pattern.

### Architecture

- **Route:** `app/api/mcp/[transport]/route.ts`, stateless Streamable HTTP — no
  Redis, no SSE resumability. Deploys with the app. No new infrastructure.
- **Handler:** `mcp-handler` **if and only if** it works with Next 16.2.12,
  proven by P0's gate. Fallback: hand-roll the Streamable HTTP POST handler.
  This is a gate, not an open question (C4).
- **House style:** plain `export async function POST()`, `NextResponse.json`,
  default Node runtime — no route in `app/**` declares `export const runtime`.
- **Tools:** `app/mcp/tools/*.ts`, one module per domain area, calling the same
  server-side code the admin routes use. **No duplicated domain logic.** Where an
  admin route's logic is inline, extract it — and extract **authorization
  separately from the write**, because the guards read ambient cookies (A10).
  Any extracted predicate shared with a Server Component stays out of a
  `"use client"` module (ADR-0028).
- **Audit compliance, restated against D2/D3/D4:** every protected read in
  `app/mcp/**` goes through a **named** import of `operationalClient` (a
  namespace import is not recognised; reassigning to a local is not tracked).
  Every protected write ships its exact `file`+`operation` registry entry *and*
  the updated exact-list assertion, in the same commit as the code.
- **Middleware:** exclude `/api/mcp`, `/api/oauth` and both `.well-known`
  discovery paths — which claude.ai fetches **unauthenticated**, before any login
  exists. Edit `MIDDLEWARE_MATCHER` (`app/utils/routeMatcher.ts:39-40`), copy the
  literal verbatim into `proxy.ts`, and update `PUBLIC_ROUTES` (A11). Exclusion
  is transport-level only; these routes enforce their own auth.
- **Server identity:** name `owt-backstage`, version tracks `package.json`.

### Auth — OAuth 2.1 over the existing NextAuth login

Unchanged in substance from July. The endpoint table, PKCE binding, exact
`redirect_uri` matching, the deterministic-`_id` + `create()` replay signal (the
409 *is* the signal — `createIfNotExists` cannot report one), refresh rotation
treating reuse as theft, the world-readable-dataset constraint on what
`mcpOauthClient`/`mcpOauthGrant` may store, per-request revocation through a ~30 s
cache, and `MCP_DISABLED=1` as the hard kill switch all stand as written.

Three corrections:

1. **Rate limiting must be built** (C1). It is not a line item; it is the only
   defence on an unauthenticated DCR endpoint, alongside the hard registration
   cap that is the real bound on document spam.
2. **The JWT library is a direct, pinned dependency** (C3), chosen in P0 and
   pinned per ADR-0001. Relying on next-auth's transitive `jose` is a silent
   breakage waiting for a minor bump.
3. `MCP_OAUTH_SECRET` and `MCP_DISABLED` each get a `docs/SECRETS.md` entry in
   the same change that introduces them — prose section per secret, matching the
   file's existing shape (**Needed in / Purpose / Where the value came from /
   How to rotate / Blast radius**). Needed on Vercel (all envs) and local
   `.env.local`; **not** in CI, the iOS build, or GCF. Never the value.

### Tool surface

Dates in and out are `YYYY-MM-DD` under the `America/Mexico_City` invariants.
Reads run as super-admin, so drafts are visible — every service payload carries an
explicit `published: boolean`.

#### Reads

| Tool | Reconciliation applied |
|---|---|
| `get_service` | Unchanged. All five member-referencing seats via `assignedMemberRefsQuery()` (signature unchanged since 2026-07-01) |
| `list_services` | Unchanged. `summarizeUnfilledSeats` signature unchanged |
| `search_songs` | **Corrected.** The Fuse index keys on `title`/`artist`/`key` only — `tags` is an exact-slug filter, never fuzzy. The tag vocabulary was replaced on 2026-09-06 with a ~43-entry theme taxonomy; artist tags are gone and must not return |
| `get_song` | **Rebuilt.** Defined field by field, not copied from either existing projection (A8). Reports `rehearsalMixes[]` (2026-09-20). "Lyrics presence" accounts for ADR-0018: a filled `chords` chart hides `body`. If it surfaces a mix URL it resolves tone → `_key` via `mixesForKey()` — the `key` segment of `/api/audio/[songId]/[key]` is the array item's `_key`, **not** a musical key |
| `get_member_availability` | **Corrected.** `retiredFrom` never shipped and is gone (ADR-0029): `memberType` is the only worship eligibility axis, and an empty Tipo is how a member stops being schedulable. `disabled` is access, not schedulability. Note `unavailableDates` gained a second writer (a kids manager proxy route) |
| `get_participation` | **Corrected.** Must carry `especial` and the folded `total` (A6) |
| `list_proposals` | **Rebuilt.** Reads `messages[]` through the `THREAD_MESSAGES` projection, not the frozen `lead_notes`/`admin_notes` (A7). Reports `isThreadOpen({serviceDate})`, which closes on the service date independently of `status`. **Can never report unread state** — ADR-0024 puts read-marks on neither document |

Every one of these is subject to D1: the draft filter is now enforced by a test,
not by care.

#### Writes

The July write-tool contract stands, with A10 folded in: **verify token at the
route (no per-tool bypass) → validate with zod, rejecting unknown fields → read
targets through `operationalClient` and capture `_rev`(s) → execute via the
shared function, extracted with authorization separated → revalidate → return
what actually changed, including what notifications fired. Errors are real
errors, never success-shaped.**

| Tool | Reconciliation applied |
|---|---|
| `edit_setlist` | `saturdarSongs` for Saturday (the typo is load-bearing), `featuredSongs` for Sunday; `_key` per item. Today's route asserts twice — `compareObservedTarget` pre-transaction, then `ifRevisionId` — and calls `revalidateSetlistSave()`, which wraps `revalidateServiceViews()`. Match both |
| `swap_assignment` | Still requires **both** observed revisions, plus every owned lock's revision, in one transaction. `_key`s travel with their items and are never regenerated |
| `publish_service` / `unpublish_service` | The pre-commit `before` capture is the invariant (`docs/NOTIFICATIONS.md:663`); reading live state inside `after()` silently sends nothing while passing its tests. The tool must pass the same pre-commit role documents into `notifyRolePublished` / `queuePublishedSetlistNotices`. Unpublish deliberately notifies nobody. Revalidation is `revalidateRolePublication`, **not** `revalidateServiceViews` (D5) |
| `solve_month` | **New, replaces half of `run_solver`.** Assembles via the already-neutral `buildSolveRequest`, relays to the GCF, returns the proposed schedule and the solver's honest diagnostic. **Writes nothing.** Fits inside 60 s (B1) |
| `apply_schedule` | **New, replaces the other half.** Writes the returned schedule onto draft role documents through guarded, revision-asserted writes. Refuses the whole run if any target service in the month is published; refuses with a clear message if the month has no draft role docs. Does not create month drafts |

The split is not a workaround. It preserves the July principle that **no tool both
solves and publishes**, extends it to "no tool both solves and writes", and puts a
natural review point between the proposal and the mutation — which is what a
conversational interface is good at.

### Error handling, testing, timezone

Unchanged from July. Auth failure → 401 with `WWW-Authenticate` before dispatch.
Tool errors → MCP tool-error results, no stack traces or Sanity internals. Solver
failures surface the solver's own diagnostic verbatim. Partial outcomes reported
honestly. Vitest for pure logic (JWT sign/verify/expiry, PKCE S256, auth-code
replay *asserting the 409 conflict path*, zod schemas, payload shaping, TZ
formatting); route-level tests import the handler directly and mock with
`vi.mock`/`vi.hoisted`, per house convention. All three gates green per stage.

### Rollout

Replaces the July "direct push per stage" line (A5). Per stage, without
exception:

    feature branch (tsc + vitest + eslint 0 errors, locally green)
    → merge into preview, push, VERIFY the dev alias moved
      (dev-owt-backstage.vercel.app in `alias`, `meta.githubCommitSha` == the pushed commit)
    → fresh CODE REVIEW of the merge range → fix → re-verify the fix
    → PR to main, wait for `gates`
    → merge = production release → verify the production alias the same way

---

## Decisions

| Decision | Choice | Why | Tradeoffs | Owner |
|---|---|---|---|---|
| Transport | Remote OAuth, Stage 0 first | The phone is the stated goal and a local stdio server cannot serve it. Stage 0 buys the compat answer (C4) and the three unknown callback URIs for days of work instead of weeks | If `mcp-handler` fights Next 16, P0 slips into a hand-rolled handler | Frank, 2026-09-22 |
| Write scope | Full, including the solver | Reaffirmed after both blockers (B1, B2) were stated | B2 makes the history derivation a prerequisite delivery with its own ADR | Frank, 2026-09-22 |
| Ministries | Worship only | Matches the surface the spec already defined; keeps one draft-gating model in the first releases | Kids stays unreachable from the connector | Frank, 2026-09-22 |
| `run_solver` shape | Split into `solve_month` + `apply_schedule` | B1 is a hard plan ceiling ADR-0013 says will not move | Two round trips instead of one | this spec |
| Fairness history | Derive server-side from role documents | Sanity role docs already *are* the record of who served; deriving also fixes the two-admins-disagree defect ADR-0010 named and left out of scope | Derived history may differ from any given browser's, changing solver output. Must be diffed before cutover | this spec |

## Assumptions

| Assumption | Impact if false | Validation point | Failure response |
|---|---|---|---|
| `mcp-handler` works with Next 16.2.12 | P0 grows by a hand-rolled Streamable HTTP handler | P0 gate, before any tool is written | Hand-roll it; the design is otherwise unchanged |
| Assemble + GCF solve fits in 60 s from a serverless function | `solve_month` cannot ship on Hobby at all | P4, measured — not assumed | Return the assembled request for the browser to solve, or re-open the plan question |
| Fairness history derived from role docs reproduces the localStorage history closely enough | Solver output changes in ways Frank did not ask for | P2, by a read-only diff against Frank's exported `owt_solver_history_v2` | Do not cut over; keep the solver browser-driven and drop `solve_month` |
| The claude.ai callback URIs can be pinned to a stable allowlist | The `redirect_uri` allowlist is either too narrow (handshake dies) or too wide (the check stops protecting) | P0, empirically | Widen to the observed set and record it as a constant with the date observed |

## Open questions

| Question | Why it matters | Recommendation | Blocking? | Resolution point |
|---|---|---|---|---|
| Which zod major does the chosen MCP SDK require? | A4 — the July instruction ("pin v3") would install a conflicting second major alongside the transitive 4.3.6 | Read it off the SDK's own peer range at install time; do not carry July's answer forward | No — bounded: match the SDK, pin per ADR-0001 | P0 |
| Does the consent screen reuse the app's layout shell? | Cosmetic only | Bare page; a themed one is polish | No | P0 |
| Does deriving fairness history warrant amending ADR-0010 or a new ADR? | ADR-0010 recorded the localStorage consequence deliberately | New ADR that amends 0010; 0010's Status becomes "Accepted, amended by ADR-NNNN" | No — mechanical | P2 |

## Terminal state

`READY_FOR_ADVERSARIAL_REVIEW`

**Risk tier: CRITICAL.** This spec owns an auth/security/ACL boundary, production
writers, and a multi-document concurrency protocol — three of the named critical
triggers. Per repo convention that means **two sequential fresh `APPROVED`
verdicts on byte-identical text**, reviewers run one at a time with no prior
findings exposed, and the churn cap is binding. Review the parent roadmap first,
then children in dependency order.

**This document authorizes no implementation.**
