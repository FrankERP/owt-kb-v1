# Solver v3 — C2: the fairness ledger and the monthly eligibility record — design spec

**Date:** 2026-10-05 · **Status:** `DRAFT` · **Risk tier: critical.** It adds a new production writer
(`fairnessMonthCommit.ts` behind `PUT /api/admin/fairness/months`), a new stored document type with
Studio governance and protected-read-audit registration, and a cross-language contract (the golden
fixture) that the v3 solver (C5) must reproduce. Requirement before implementation: two sequential
fresh `APPROVED` verdicts on byte-identical text; the churn cap applies (CLAUDE.md «Adversarial plan
review»). The ledger arithmetic and the read-only panel are standard-tier slices carried in the same
artifact because the record's content is defined by what the ledger needs; the plan may split review
slices.

**Parent:** [`2026-10-05-solver-v3-fairness-design.md`](2026-10-05-solver-v3-fairness-design.md)
(`APPROVED`, `3dbc189b`; amendments A1–A26 in its §3 at `2d90e4b3`, A27–A39 at `ee91d0e0` and A40
after it, which win over older clause wording), child **C2** of its §11: L2, L3, L5, F2–F7, F14, X1, U5's read-only preview, and — per A1
and A7 — the effective-engine resolver and the single v3 eligibility resolver. Where this spec and
the parent disagree, the parent wins; §12 «Parent issues» lists any gap still open (none after
A27–A40), and this spec follows the parent meanwhile. A40 (a confirm that crossed a month boundary
refuses before writing anything) is C6's refusal; this writer's backstop for the same case is WR-8
row 2 (`past_month`) under WR-9's all-or-nothing, so a crossed boundary writes no record here
either.

**Contracts, not prescriptions.** This document states what must be true and what must never
happen. Helper names, file splits and loop shapes belong to the C2 implementation plan. Existing
files are cited as evidence, with lines verified on this branch.

**Interfaces have one home.** §7 is the single source of every interface C2 provides; each item
carries a stable `IF2-` ID that siblings cite instead of restating it (consolidation approved by
Frank on 2026-10-05, after review rounds kept finding drift between C2 and the siblings' copies).

**Names.** This repository is public. Members are described by role in the policy; every example
and fixture uses fictitious people (Alma, Bruno, Carmen, Diego, Elena, Fausto, Greta, Iván, Julia).

## 1. Original request

> Necesitamos arreglar en solver.
> Tiene que tomar en cuenta el historial, pero debe de considerar a personas "especiales" como el caso
> que te platique de [REDACTED: three member names] que solo dirigen un mes sí y un mes no.
> Y mantener el fariness en ventanas más grandes, siempre siendo claro y transparente con el admin al
> respecto.
> Lo que pasa es que mientras el equipo crece más, no caben todos para dirigir en un solo mes, pero
> quiero que sus participaciones sigan siendo parejas.
> Si es necesario construir un nuevo solver desde cero, estoy abierto a la posibilidad.
> Recuerda que debe de poder respetar los espacios asignados y necesitamos también que pueda llenar 2
> meses de jalón
>
> — and, mid-session: «Y la participación total también»
>
> — and, on approving the parent (2026-10-05): «Aprobado, sigue con los specs de las entregas»

## 2. Outcome

- **Primary outcome.** The app records, once per calendar month, who was eligible for which voice
  role (the monthly eligibility record), and computes from those records and the stored services a
  per-person, per-line fairness balance over the 3 months before a run — the carried balance C5's
  solver will consume through C6. Admins can read that balance in a read-only «Equidad» preview
  before any solver uses it.
- **Operators.** The worship admin (today Frank) reading the preview in Servicios; later C6's Auto
  confirm and C4's reconstruction script, which write records through the contracts defined here.
- **Problem today.** No per-month eligibility exists anywhere: the pool checkboxes live in one
  overwritten singleton (`solverConfig`), so the derived history counts seats with no denominator and
  reads occasional leads as owed Sundays (ADR-0046). The «sin Lead en …» panel judges last month
  against today's pool (`leadPoolHistory.ts:31-34`, `:54-71`).
- **Success measure.** The golden fixture passes in vitest (and, from C5 on, in Python); the GET
  answers for real months on Preview; the preview panel explains every person's numbers; nothing Auto
  sends, solves or writes changes.

## 3. Evidence

| Fact | Source | Implication |
|---|---|---|
| The derived history is a pure neutral module plus a `server-only` builder on `operationalClient`; a failed read throws a fixed-message error and never returns empty entries; the route is manager-only with content-editor refused, and every failure is an opaque 500 with no data key | `app/utils/solverHistory.ts:1-36`; `app/utils/solverHistoryRead.ts:39-67`; `app/api/admin/solver-history/route.ts:55-60`, `:82-95` | The ledger reader and GET copy this shape exactly (L5) |
| The history drops both copies of a duplicate weekend target via `indexUniqueByKey`; it keys months by the stored date string, never a `Date` | `solverHistory.ts:289-311`; `app/utils/serviceReadSelect.ts:35`, `:47` | The ledger reuses the same rule and helper so the two cannot disagree |
| The only range read is weekend-only; specials are excluded by construction | `app/utils/serviceReadQueries.ts:383-397` | D14 needs a new additive builder over all three role types |
| Reads that see drafts must live in `api/admin/**` or `serviceReadQueries.ts`; that file is imported by production writers | `app/utils/__tests__/draftGatingCoverage.test.ts:96-104` | New queries are additive builders there; no new exemption |
| Create collisions are the mutex: `create`, never `createIfNotExists`; a genuine Content Lake 409 is classified by `sanityConflictKind`, anything else throws | `app/api/admin/roles/route.ts:258-261`, `:284-287`; `app/utils/roleWriteRequest.ts:848-861` | The record create uses the same discipline |
| Whole-document replacement is guarded by an observed `_rev`; only a real conflict becomes `stale_revision`; no revalidation because no ISR page reads the document | `app/api/admin/solver-config/route.ts:44-51`, `:146-181` | Same for a record replace; no `revalidate*` call |
| Shared error model: every conflict is a 409 with a stable code; `invalid_request` 400, `forbidden` 403 | `app/utils/serviceMutation.ts:17-40`, `:96-102` | Refusals reuse it |
| A `*Commit` module owes a `PROTECTED_RUNTIME_WRITERS` entry, a `DELIVERY_CAPABLE_IMPORTS` entry and a caller-pin row; the pin asserts every `*Commit` module is in that list | `docs/adr/0043-admin-writes-delegate-to-commit-modules.md` «Consequences»; `app/utils/__tests__/serviceCommitCallers.test.ts:42-48`, `:176-181`; `app/utils/__tests__/__fixtures__/deliveryCapableImports.ts:17-27` | The new writer pays all three; its route therefore wraps in `withVerificationRunContext` |
| `PROTECTED_TYPES` (audit: must be read through `operationalClient`, writes registered) is pinned exactly by a test; `solverConfig` is Studio-governed but not in it | `app/utils/protectedReadAudit.ts:21-29`, `:177`; `app/utils/__tests__/protectedReadAudit.test.ts:599-609` | Adding `fairnessMonth` is a reviewed edit of the pin |
| The audit sees only clients a file imports from `sanity/lib/*` / `next-sanity` / `@sanity/client`, creates with `createClient`, gets from a guarded factory, or a transaction handle off one; a file with none yields no site; a `protected-write` site needs a non-`fetch` method call on a recognised client, then a type literal or a `PROTECTED_LOADER_HELPERS` call in that operation. Every registry entry must be exercised by a real site | `protectedReadAudit.ts:94-103`, `:527-555`, `:782-886` (early return `:785`); `protectedReadAudit.test.ts:123-175` (loader fixtures), `:531-538` («carries no dead entries») | A writer whose only mutations run on an **injected** client, and a module that only hands its client to one, are invisible as written; C2 adds one detection rule (GU-5) so both are sites and their entries are not dead |
| Studio governance: protected, internal (hidden), internal fields, read-only titles; `solverConfig` is the precedent for a hidden machine document | `app/utils/studioProtection.ts:45-77`, `:160-168`, `:189-228`, `:484-500` | `fairnessMonth` joins all four lists |
| The dataset answers unauthenticated published reads; `operationalClient`'s read token is optional («public published reads work without it»). Sanity's own documentation: «Any document ID containing a dot is considered private» — only root-path ids are served without a token | `sanity/lib/operationalClient.ts:13-23`; Sanity docs «IDs and paths» (`/docs/content-lake/ids`, checked 2026-10-05) | The parent's dotted id `fairnessMonth.YYYY-MM` (A2) keeps the record (and its availability snapshot) private, but a read made **without** the token returns zero records with no error — so every reader checks the token first and fails closed (RD-2, WR-16) |
| `SANITY_API_READ_TOKEN` is documented for NextAuth, `operationalClient` and dry-run scripts, on the `Preview, Production` pair, the `verify/service-readiness` pair and `.env.local` | `docs/SECRETS.md:288-296`, `:310-322` | Its entry gains «needed to read `fairnessMonth`» and the mid-rotation consequence (GU-4) |
| Precedents for a pure, env-injected deployment classifier: `canonicalOrigin(env)` maps `VERCEL_ENV` (`production` / `preview` / unset-or-empty) and fails closed on anything else; the runtime already reads `VERCEL_GIT_COMMIT_REF` to tell the `verify/service-readiness` deployment apart | `app/mcp/oauth/origin.ts:22-33`; `app/utils/srVerificationIdentity.ts:96-106`; `docs/SECRETS.md:280-281`, `:312-313` | EN-2's resolver takes the env as an argument and checks the branch ref, not only `VERCEL_ENV` (A1) |
| A pure write-request module without `server-only` is imported by both the admin route and an `--apply` script | `app/utils/solverConfigWriteRequest.ts:1-6` | The record's validation, keys, hash and write decision live in one such module, shared with C4 |
| Every `*Commit.ts` module is `server-only` and imports the server write client, so a `tsx` script cannot import one; the caller pin scans `app/` only and also pins named non-`*Commit` modules (`PINNED_BEYOND_COMMIT`) | `app/utils/roleSwapCommit.ts:39-41`; `app/utils/__tests__/serviceCommitCallers.test.ts:44-56`, `:65-69` | The one mutation path both the route and C4's script use is a neutral executor with the client injected, pinned by a scan that also covers `scripts/` (WR-16) |
| The planner's `members` comes from `GET /api/admin/members`, filtered by `WORSHIP_MEMBER_GROQ_FILTER` with `$all` bound for `super-admin`: worship-only for a worship admin, every member (kids-only included) for a super-admin. `WORSHIP_AUDIENCE_GROQ_FILTER` is the predicate with no `$all` arm. No existing builder reads the whole worship roster with Tipo and ministries, or the `solverConfig` singleton | `app/api/admin/members/route.ts:21-32`; `app/ministries.ts:41-44`, `:60-77`; `app/utils/serviceReadQueries.ts:398-407` (`_id, member_name` only); `app/api/admin/solver-config/route.ts:71-77` (inline read) | The resolver filters by ministry itself (RES-5), so the body never depends on who is viewing; RD-6 adds the two builders server and script callers need |
| `rolesOfPattern` is the ONE five-key pattern map (`Sat.*` → `Sat.Lead`, `Sat.BGV`; no `Sat.Choir`), guarded against the solver by `patternRolesSync.test.ts`; `resolvedCapValue` is the one relative-cap resolution (`max(0, weeks − offset)`); `resolveToMemberName` takes the first match | `app/components/admin/plannerModel.ts:611-655`, `:666-669`, `:572-578`; `app/components/admin/__tests__/patternRolesSync.test.ts`; CLAUDE.md «Reusable utils» | v3's six-key expansion is defined against `rolesOfPattern` and synced to it (RES-2); counts reuse `resolvedCapValue` (RES-3); names resolve through C3's exactly-one resolver, never first-match (RES-7) |
| Config shape: name-keyed restrictions (`excludedPatterns`, `fairness`, `weekExclusions`, `caps` with `op "=="` and relative offsets), `conflicts`, `presence`, id-keyed pools | `app/components/admin/plannerModel.ts:248-294` | The eligibility resolver's inputs |
| Pool fit is `voz` + subtype; the planner re-filters pools by live Tipo and refuses rule persons with no Tipo | `plannerModel.ts:805-811`, `:858-938` | Tipo is the only eligibility axis (ADR-0029); the record snapshots it |
| v2's pool → role map: Sun.Lead = Sunday pool; Sat.Lead = Sunday ∪ Saturday pools; BGV and Choir = everyone in a pool; `Sat.*` covers no chorus | `gcf/owt_solver_v2.py:642-648`, `:210-225` | v3's record mirrors the map, adds `Sat.Choir` for counted non-Sunday specials |
| On the grid, a special is bound only by `*.X` patterns, and week exclusions do not apply to specials | `app/components/admin/ruleEnforcement.ts:143-147`, `:183-193`; `app/components/admin/serviceRuleContext.ts:56` | Rule-based date exclusions apply to weekend services only |
| The «sin Lead» panel is mounted at the config step and in the stored editor | `app/components/admin/MonthGenerator.tsx:1737-1747`, `:4489-4501`; `LeadPoolHistoryPanel.tsx:59-97` | The preview mounts beside it at both, never replacing it |
| Validated policy: balances sum to exactly 0 per service and role on real data; nobody served on a date they had marked unavailable; floor-forced seats under a share of 1 grow an unbounded debt unless set aside; presence members held by a never-together rule must leave the normal population; strict parity left a cadence member 3 months without a Sunday | private `owt-agent-logs/sdd/2026-10-05-solver-v3-fairness/evidence/d_ledger.md` (data facts), `f_final-proto.md` §2a, §8.2, §8.4, `f_final-stress.md` §5 | LG-8, LG-11 and the X1 function encode the amendments the parent adopted |
| `solverConfig` rule ids are **not** all opaque. The planner mints new ones with `uid()` (`plannerModel.ts:1658`, `MonthGenerator.tsx:388`: up to 7 `[a-z0-9]` characters), but the seed defaults carry hand-written ids of the form `d-<first-name>` and `d-<first-name>-<first-name>[-<suffix>]` for restrictions, conflicts and the presence rule (`app/components/admin/solverConfigDefaults.ts:53-96`). Production's one presence rule, all five conflicts, three of the eight restrictions and one of the five caps still carry those seed ids verbatim, each with `_key` equal to `id`; the other restrictions and caps carry `uid()` ids | private `owt-agent-logs/sdd/2026-10-05-solver-v3-fairness/prototype/config.json` (shapes only; checked 2026-10-05) | REC-4's grammar admits a name-bearing id, so a `ruleKey` and a conflict or restriction id are **private identifiers** (§6), never name-free handles. The strings are already public in the defaults file; the risk is new output that ties them to fairness facts |
| Planned vs post-solve shares differ by up to 0.23 seat without pins | `f_final-proto.md` §8.8 | Any TS-vs-Python comparison in C5/C6 needs C5's tolerance; this spec's fixture compares exact stored-seat values, which need none |

## 4. Requirements

Vocabulary used throughout:

- **Role keys** (six): `Sun.Lead`, `Sat.Lead`, `Sun.BGV`, `Sat.BGV`, `Sun.Choir`, `Sat.Choir`.
- **Lines:** `DL` = `Sun.Lead`; `SL` = `Sat.Lead`; `BGV` = `Sun.BGV` + `Sat.BGV`; `CORO` = `Sun.Choir` +
  `Sat.Choir`; one presence sub-line `P:<ruleKey>` per presence rule. **Total** = the sum of a
  person's lines, display only.
- **Units:** hundredths of a seat, integers, on every wire; **positive = owed** («le deben»). This
  holds for every fairness figure — `share`, `received` and `balance` alike: `received` is 100 × the
  seats counted (always a multiple of 100), the same unit as C5's `received` (C5 §8.2,
  `c5:684`) and as parent F14 («Integer units are hundredths of a seat on the wire»). The
  panel shows **one decimal** (A17), and that tenths figure is computed once from the exact value,
  never from the hundredths (LG-13, UI-4). Plain seat **counts** for display (`Figures.seats` for
  «Tuvo», `held`, `sang`) are integers of seats, named as counts in IF2-8, never fairness figures, never
  in the fixture's expected figures and never fed to a computation.
- **Freezing services** of a month (A5): its canonical stored `sunday_role` and `saturday_role`
  documents, plus its canonical stored `special_role` documents whose effective `countsForFairness`
  is true (C1's rule, §7.1), published or not. A record **binds** a horizon month (A6) iff it exists
  and the month has at least one freezing service.
- **Current month:** the `America/Mexico_City` calendar month of the server's "now"
  (`toLocaleDateString("sv", { timeZone: "America/Mexico_City" })`, CLAUDE.md). **Past** = before it.
- **Stored date / month of a service:** the stored `YYYY-MM-DD` string (`week` on weekend roles,
  `date` on specials) and its first seven characters. Never a UTC `Date`.

### 4.1 The record (`fairnessMonth`) — REC

| ID | Requirement | Acceptance |
|---|---|---|
| REC-1 | **Identity.** One document per calendar month: `_type: "fairnessMonth"`, `_id: "fairnessMonth.YYYY-MM"` (parent A2: a dotted id is private in Sanity, and the record holds availability), `month: "YYYY-MM"` equal to the id's month. Nothing else may share the id; only the write-request module constructs it | Schema + write-request tests |
| REC-2 | **Stamps and source.** Server-derived, never from a body: `schemaVersion: 1`; `engine: "v2" \| "v3"`; `environment: "production" \| "preview" \| "local"` from `VERCEL_ENV` (`production`/`preview`; anything else `local`) — one neutral pure function of an injected env (no `server-only`, no client caller), placed **outside** the write-request module (beside IF2-14; the plan picks the file): `fairnessMonthCommit.ts`, the GET (RD-3) and C4's script call it and hand the value to the executor as `stamps.environment`, which never derives it, so the GET and its reader gain no import of the write-request module beyond IF2-23's list; `recordedAt` (ISO-8601, server clock); `recordedBy` (the session's **effective** member `_id`, `session.user.sanityId` — the identity whose role authorized the write, as `solver-config` stamps `updatedBy`, `solver-config/route.ts:161`; under impersonation, which is super-admin-only, that is the impersonated manager, never the real super-admin — or the script's own marker for C4); `contentHash` (REC-6). **`source`** is the one exception: `"auto"` or `"manual"` is declared by the body for actor `route` (WR-4); `"reconstructed"` is stamped by the executor for actor `reconstruction`, whose body carries none; no other value is ever stored | Route test: a body carrying any server stamp, or `source: "reconstructed"`, is refused (WR-3, WR-4) |
| REC-3 | **People.** `people[]`, at most one item per member. Each item: `_key` = `"p"` + the first 24 hex characters of SHA-256 of the member `_id` (never a raw id: ids may contain dots); `_type: "fairnessPerson"`; `member: { _type: "reference", _ref, _weak: true }` (a deleted member keeps its history); `name` = the member's display name (alias, else `member_name`) read by the write executor at write time, for both actors (WR-16) — display only, never an identity; no item is ever written without one; `roles` = an object with exactly the six fields `sunLead`, `satLead`, `sunBgv`, `satBgv`, `sunChoir`, `satChoir` (dotted field names are invalid in Sanity), each `"in" \| "out" \| "exact"`; `exactRules[]` = `{ _key: "x" + 24 hex of SHA-256 of its canonical role list, _type: "fairnessExactRule", roles: RoleKey[], count }` — **consistency (parent A38: at most one exact count per person per role key):** the items' role lists are pairwise disjoint, every role an item lists has status `"exact"`, and every `"exact"` role is listed by exactly one item; `count` is the rule's value **resolved for this month** (relative caps against the month's Sundays, ADR-0047's D2), an integer 1–31; `sundayCadence: "alternate"` or absent (the C3 setting, never the on/off state — F7), and never present together with an `exactRules` item covering `Sun.Lead` (A11: the pair is contradictory); `exempt: boolean`; `blocks[]` = `{ _key: "d" + YYYYMMDD, _type: "fairnessBlock", date, unavailable: boolean, excludedRoles: RoleKey[] }`, one per date, every date inside the month, at least one of the two non-empty | Schema + write-request tests |
| REC-4 | **Presence snapshot.** `presence[]` = `{ _key: "r" + 24 hex of SHA-256(ruleKey), _type: "fairnessPresence", ruleKey, roles: RoleKey[], members: string[] (member ids, each listed in `people`), exclusive: boolean }`. `ruleKey` is the `solverConfig` presence rule's `id`, matching `^[A-Za-z0-9_-]{1,64}$`. `exclusive` is true iff every pair of members has a conflict rule whose pattern covers every role key of the presence rule (RES-6) | Write-request tests |
| REC-5 | **What it never stores.** Seats served, balances, shares, the cadence state, rule strings, names inside `presence`, a `published` field. Seats stay derived from role documents (ADR-0042) | Schema field list pinned in `INTERNAL_STUDIO_FIELDS` |
| REC-6 | **`contentHash`.** `"sha256:" + hex` over a canonical serialization of `{ schemaVersion, month, people (sorted by member id; roles in the fixed six-key order; exactRules and every role-key list in canonical role order; blocks by date), presence (sorted by ruleKey; members sorted) }` — codepoint order, never `localeCompare`. It excludes `name`, every `_key`, every stamp of REC-2, `_rev` and timestamps. Identical content gives the identical hash in any input order; one changed eligibility, block, rule or flag changes it. The write-request module exports **two** entry points over the one serialization (IF2-19): the hash of a write body, and the hash **recomputed from a stored document** (as read: the id in `member._ref` is hashed as that person's `memberId` — only the reference wrapper, `_type: "reference"` and `_weak`, is ignored — and `_key`s, `name` and stamps are ignored). A stored record is **intact** iff the recomputed hash equals its stored `contentHash` | Unit test pins a known digest, order-independence, and that a body and the document written from it hash identically; a stored document with one field edited is not intact |
| REC-7 | **Absent means out.** A member not listed in a month's record is `"out"` for every role that month. A **listed** item missing any of its six role fields (or any other required field) is not «out»: it fails the record schema and the ledger fails closed (RD-2, §9 «Malformed stored record») | LG-5 tests; an RD-2 test with one role field removed from a stored item throws |
| REC-8 | **Studio.** Schema `hidden: true` and `readOnly: true`; the type is in `PROTECTED_STUDIO_TYPES`, `INTERNAL_STUDIO_TYPES`, `INTERNAL_STUDIO_FIELDS` (every field of REC-1–REC-4) and `PROTECTED_STUDIO_TITLES` as «Registros de equidad (solo lectura)»; `studioCapability` denies create, update, delete, publish, unpublish, duplicate, restore and every other mutating capability | `studioProtection.test.ts` passes with the type governed |
| REC-9 | **Audit.** `fairnessMonth` joins the audit's `PROTECTED_TYPES` (`app/utils/protectedReadAudit.ts:21-29`; the exact-list pin, `protectedReadAudit.test.ts:599-609`, changes in the same commit) — **not** the unrelated `PROTECTED_TYPES` of `app/utils/serviceReadModel.ts:18` (role and setlist types, read by `mcpProtectedTypeLiterals.test.ts`), which C2 leaves unchanged, and the audit gains GU-5's executor rule, so: a read naming the type off a non-canonical client is a violation; a mutation naming the type on an imported or created client is an unregistered `protected-write`; and every file that calls or declares the write executor (WR-16) is a `protected-write` site. Registered by exact `file#module` in `PROTECTED_RUNTIME_WRITERS`: the write-request module (it declares the executor) and `app/utils/fairnessMonthCommit.ts` (it calls it) — both exercised by real sites, so neither is a dead entry. C4's CLI file `scripts/reconstruct-fairness-months.mjs`, the only executor caller outside `app/`, is always flagged by that rule and so **unconditionally** carries one exact `OPERATOR_TOOLING_ALLOWLIST` entry, registered by C4 (C4 R20; IF2-23). **What the audit still cannot see**, stated: a mutation on an injected client that names no protected literal and calls no registered executor — a gap of the static scan for every protected type, not only this one. For `fairnessMonth` it is covered by WR-16's single-executor rule, the executor's caller pin (`app/` and `scripts/`) and code review; and the executor's own reads, which run on its injected read client and so are invisible to the scan by import, are held to the canonical read contract at runtime (WR-16: token, published perspective, no CDN, asserted before any read) | `protectedReadAudit.test.ts` passes with GU-5's fixtures; a new unregistered caller of the executor, a second declaration of it, a literal-named write of the type on a recognised client, or a read of it off a non-canonical client each fails it |

### 4.2 The writer (`PUT /api/admin/fairness/months` → `fairnessMonthCommit.ts`) — WR

| ID | Requirement | Acceptance |
|---|---|---|
| WR-1 | **ADR-0043 shape.** The route authorizes, parses JSON and returns whatever the commit module returns; everything after authorization lives in `app/utils/fairnessMonthCommit.ts` (`import "server-only"`), which returns a `CommitOutcome`. Its only caller is the route (pin row); it imports the server write client itself (never as a parameter) and hands it to the **write executor** (WR-16) with actor `route` — it issues no mutation of its own. It is therefore a `protected-write` site only through GU-5's executor rule (it calls the executor), which is what exercises its `PROTECTED_RUNTIME_WRITERS` entry | `serviceCommitCallers.test.ts`, audit test (the module is a site, and its entry is not dead) |
| WR-2 | **Auth.** `requireActiveManager()`, then `content-editor` → 403 — the same gate as `solver-config` and `solver-history`. Only `admin` and `super-admin` write | Route tests for the four roles and no session |
| WR-3 | **Body.** `FairnessMonthsPut` (IF2-4). 1–2 entries; two must be consecutive and ascending. Unknown fields at any level are refused, as is any server-derived stamp of REC-2 (`source` is a body field, WR-4), `_key`, `name` or `contentHash` | 400 `invalid_request` with `details.issues` naming each path |
| WR-4 | **Validation limits.** `month` matches `^\d{4}-(0[1-9]\|1[0-2])$` and is at most the current month + 12 (CDMX; the validator's `currentMonth` argument, IF2-18); `source ∈ {"auto","manual"}` for actor `route`, and **absent** for actor `reconstruction` (the executor stamps `"reconstructed"` itself, WR-14 — a body never carries it); `expectedRev` is `null` or a non-empty string of at most 64 characters; `people` 1–100 items (C5's request limit, §5.1 — one number for both), unique `memberId`s; `roles` has exactly the six role keys; `exactRules` consistent with `roles` (REC-3), each 1–6 distinct role keys, `count` a whole number 1–31, and no two items of one person sharing a role key (parent A38; issue `overlapping_exact` at that person's path); no person with `sundayCadence` and an `exactRules` item covering `Sun.Lead` (A11); `blocks` at most 31, unique dates inside the month, valid role keys, never both empty; `presence` at most 20, unique `ruleKey`s matching REC-4, 1–6 roles, 2–12 distinct members each listed in `people` | 400 per violated path |
| WR-5 | **Members are canonical and worship.** Every `memberId` resolves, in the published perspective, to a `teamMembers` document whose normalized ministries include worship (`normalizeMinistries`); a role marked `"in"` or `"exact"` fits that member's **current** Tipo (Sun.Lead: `voz` + `sunday_lead`; Sat.Lead: `voz` + `sunday_lead` or `saturday_lead`; BGV and Choir keys: `voz` + any of `sunday_lead`, `saturday_lead`, `support` — `memberFitsPoolSubtype`, `plannerModel.ts:805-811`). **Order:** these live-data checks run **after** WR-8's decision and only on months decided `create` or `replace`; a month decided `unchanged` writes nothing and is never refused by them (so a record-bound month that lists a since-changed member can still be confirmed — C6 sibling issue S-1). The full order per request is: auth (WR-2) → engine gate (WR-6) → body validation (WR-3, WR-4, WR-17) → fresh reads (WR-7) → decision (WR-8) → these checks on written months → commit (WR-9) | 409 `integrity_conflict` with `details.detail: "member_unknown" \| "member_not_worship" \| "tipo_mismatch"` and the ids; a test with an `unchanged` month listing a deleted member answers 200 |
| WR-6 | **Engine gate** (parent A1). If the deployment's effective engine (EN-2) is not `v3`, the whole request is refused and nothing is read or written beyond auth | 409, `details.detail: "engine_not_v3"` |
| WR-7 | **Fresh state inside the commit.** For each month the executor (WR-16) reads, through the read client its caller injects — `operationalClient` (published, no CDN, carrying the read token, WR-16) when the caller is `fairnessMonthCommit.ts` — the existing record **in full** (its `_rev`, `source` and `contentHash`, and every field REC-6's intactness recomputation and WR-11's unset list need) and whether the month has **freezing services** (§4 vocabulary, parent A5: stored weekend services or counted specials, the special's counted flag read at this moment through C1's `COUNTS_FOR_FAIRNESS_GROQ`). An uncounted special never freezes a record. Nothing from the client substitutes for these reads | Route tests with mocked reads, including a month whose only service is an uncounted special (replace allowed), one with a counted special (replace refused), and an **unrecorded** month with stored weekend services and a counted special (create accepted — parent A27) |
| WR-8 | **Decision, per month, in this order (actor `route`):** (1) a stored record that is **intact** (REC-6) and whose `contentHash` equals the request's → `unchanged` (a non-intact record is never `unchanged`; it falls through to the rows below); (2) month before the current month → refuse `past_month`; (3) no record and `expectedRev === null` → `create`, **whether or not the month has freezing services** (parent A27: Auto's confirm creates a record for every horizon month that has none; creating overwrites nothing, and A5's gate governs replacement only, row 7); (4) no record and `expectedRev !== null` → refuse `record_missing` (IF2-6; its «Registrar» copy is shared with `stale_revision`, §8); (5) record exists and `expectedRev === null` → refuse `record_exists` (details carry the current `rev`, `source`, `recordedAt`); (6) `expectedRev !== record._rev` → refuse `stale_revision`; (7) the month has freezing services → refuse `month_has_services` (A5); (8) otherwise → `replace` — the case parent A6 gives C6's confirm for a recorded month that does not bind. The decision is one pure function in the write-request module (IF2-21) — not `server-only` so C4's script can import it, and **never imported by a client module** (it hashes with `node:crypto`; the eligibility resolver is the only client-callable half) — shared with C4 (WR-14) | Table-driven unit test over every row |
| WR-9 | **All or nothing.** If any month is refused, the request is refused as a whole (409, `details.months` lists every month's verdict) and nothing is written; when months are refused before the commit (at decision time, or by WR-5's checks), `details.detail` is the verdict of the **earliest** refused month (entries are ascending, WR-3), so two refusals with different verdicts still give one deterministic `detail` (the other stays readable in `details.months`). Otherwise every `create` and `replace` is committed in **one** transaction; `unchanged` months add nothing; a request with no writes returns 200 without a transaction. **A transaction-level conflict is not attributed to a month:** when the commit answers a 409 (WR-10, WR-11), Content Lake does not say reliably which mutation failed, so `details.months` lists **every** month that had a write in the transaction with that one mapped verdict (`record_exists` for `already_exists`, `stale_revision` otherwise), and each `unchanged` month as `unchanged`; `details.detail` is that verdict. The remedy is the same for every month — re-read the GET and retry (WR-15) — so no month-level attribution is needed | Route tests: mixed verdicts write nothing |
| WR-10 | **Create is a plain create.** The id collision is the cross-request mutex (`roles/route.ts:258-261`); a Content Lake `already_exists` becomes 409 `record_exists`, never an overwrite | Mocked-conflict test |
| WR-11 | **Replace is whole and revision-asserted.** The stored content is replaced entirely under `ifRevisionId(expectedRev)`: no field of the old content survives except `_id`, `_type` and `_createdAt`; `source`, `engine`, `environment`, `recordedAt`, `recordedBy` and `contentHash` are rewritten. **Mechanism.** `ifRevisionId` exists only on a patch (`@sanity/client`'s `Patch`; `delete` and `createOrReplace` take no revision precondition), so a replace is one patch `patch(id).ifRevisionId(expectedRev).set(every field of the new document).unset(every top-level field of the re-read document, WR-7, that the new document lacks)` — system fields (`_id`, `_type`, `_createdAt`, `_updatedAt`, `_rev`) excepted. `createOrReplace` is forbidden for this type in every actor: it cannot assert a revision and would discard a concurrent writer's record (L3). A Content Lake `revision_mismatch` becomes 409 `stale_revision`. `sanityConflictKind` has a third kind, `"conflict"` — a genuine 409 mutation error carrying no recognised item (`roleWriteRequest.ts:847-861`) — and it too becomes 409 `stale_revision`, with `details.cause: "commit_conflict"`, as `solver-config` maps every non-null kind (`solver-config/route.ts:175-180`): the client re-reads and retries (WR-15), and a write that lost a race it cannot name is never reported as a server fault. Only an error for which `sanityConflictKind` returns `null` (not a 409 mutation conflict) is thrown (500), as in `solver-config` | Mocked-conflict and field-survival tests (an old top-level field absent from the new body does not survive); a grep-level test that the write-request module never calls `createOrReplace` |
| WR-12 | **Response.** IF2-5: a 200 lists every month with its outcome and the stored revision after the write (the existing one for `unchanged`). Refusals use the `serviceError` body; every conflict is 409 with `conflict: true` and a `details.detail` from IF2-6's `FairnessPutRefusal`. Whether these become new codes in `SERVICE_CONFLICT_CODES` or details of existing ones is the plan's choice (WR-5's `integrity_conflict` aside); the client branches on `details.detail` either way | Route tests |
| WR-13 | **No side effects.** No notification, no outbox, no `after()`, no `revalidate*` (no ISR page reads the type — stated in the module header as `solver-config` does). **The only deletion path that exists** is the reconstruction actor's guarded delete (WR-14 rows D1–D4), reached only from C4's consented script; the route, the panel, C6 and every other `app/` surface never delete a record | Grep-level test of the module's imports; a test that the route's actor offers no delete |
| WR-14 | **Reconstruction actor (C4's writer).** The same write-request module exposes the actor `reconstruction`, used only by C4's script (its executor call lives in C4's CLI file, IF2-23). Its decision is IF2-21's and its refusal codes are IF2-6's. **Write, per month, in this order:** (1) the month is not before the current month → refuse `not_past_month` (parent A4: the reconstruction writes past months only; C4 R1 holds the same rule, this is the writer's own check); (2) a stored record that is intact (REC-6) and whose `contentHash` equals the body's → `unchanged`; (3) no record and `expectedRev === null` → `create`; (4) no record and `expectedRev !== null` → refuse `record_missing` (IF2-6); (5) record exists with `source !== "reconstructed"` → refuse `not_reconstruction_owned` (it touches only records it wrote — A4, L6); (6) the record is **not intact** → refuse `record_edited` (edited after reconstruction — L6 «never overwrites a record Frank edited»); (7) `expectedRev !== record._rev` (including `null`) → refuse `stale_revision`; (8) otherwise `replace`; then, on a month decided `create` or `replace`, (9) a body listing a `memberId` with no member document → refuse `member_unknown` (WR-16: the only live-member check this actor has, and the read its `name`s come from; the Tipo and worship checks of WR-5 do not apply). **Delete, per month:** (D1) no record → refuse `record_missing`; (D2) `source !== "reconstructed"` → refuse `not_reconstruction_owned`; (D3) not intact → refuse `record_edited`; (D4) `expectedRev !== record._rev` → refuse `stale_revision`; otherwise `delete`, revision-asserted the only way the client allows: **one transaction** holding a revision-asserting no-op patch of the record (`patch(id).ifRevisionId(expectedRev).set({ month })`, its own unchanged field) followed by `delete(id)`, so a moved revision rolls the delete back (precedent: the guarded role delete, `roles/[id]/route.ts:591-595`); a bare `delete` is never issued. No freezing-services, Tipo, worship or engine restriction applies to this actor (row 9's member-existence check is its only live-member check), and only it may write `source: "reconstructed"`, write a past month, or delete. Its stamps: `source: "reconstructed"`, `engine: "v2"` (parent A4: the months it reconstructs were planned under v2), `environment` per REC-2, `recordedBy` a fixed non-member marker naming the script (never a member id). The route can never select it | Table-driven unit test over every write and delete row; the route hard-codes actor `route` |
| WR-15 | **Asserted revision.** A client asserts the revision it **read when it loaded the eligibility it built the request from** (the GET's horizon record, RD-4), never a revision re-read just before the PUT. «Registrar» (UI-6) obeys this; C6's confirm must | UI test: «Registrar» asserts the horizon record `rev` from the GET that populated the panel; on any 409 it re-reads the GET (content and `rev` together) before offering a retry |
| WR-16 | **One write executor, client injected, callers pinned.** Every mutation of a `fairnessMonth` document — create, replace, delete — is issued by **one** executor (IF2-22) in the neutral write-request module: no `server-only`, no module-level client, the Sanity client passed in by the caller, so C4's `tsx` script can import it (a `server-only` module cannot be). It takes the actor, the month entries and the client; it re-reads the fresh state of WR-7 itself (for actor `reconstruction`, the record and no freezing-services read) and, for every month decided `create` or `replace`, the member documents its people list (`_id`, `member_name`, `alias`, `ministries`, `memberType`) through the injected **read** client, and mutates only through the injected **write** client. **Names, both actors.** Each item's `name` (REC-3) comes from that member read, for actor `route` and actor `reconstruction` alike; a `memberId` with no member document refuses the month `member_unknown` for either actor (for `route` this is WR-5's check; for `reconstruction` it is the only live-member check, and the Tipo and worship checks of WR-5 do not apply), so no item is ever written without a `name` and no record the executor writes can fail RD-2's schema check for a missing one. **Read-client contract, asserted before any read:** the executor **throws before any read** unless the injected read client's configuration carries a non-empty token, the `published` perspective and `useCdn: false`, each **set explicitly** when the client is created (a client built without `perspective` reports none from `config()` — `@sanity/client` 7.25.0 answers `undefined` — and fails the assertion although the API would default it; `operationalClient` sets all three, `sanity/lib/operationalClient.ts:16-23`) — the token because an untokened read of a dotted id answers «no record» with no error (A2) and would turn a replay into a refusal and a replace into a create; the perspective and CDN because these reads are invisible to the static audit by import (REC-9) and must still meet `operationalClient`'s contract (`sanity/lib/operationalClient.ts:13-23`). It then runs the actor's decision (WR-8 or WR-14) and commits under WR-9–WR-11's discipline (route: one transaction for all writes; reconstruction: one guarded transaction per month, C4 R16). `create` is a plain create; replace is WR-11's revision-asserted patch; delete is WR-14's revision-asserting patch plus `delete` in one transaction; `createOrReplace` is never used; `already_exists`, `revision_mismatch` and `conflict` map as WR-10/WR-11 (for actor `reconstruction`, to the refusals `record_exists` and `stale_revision`); an error `sanityConflictKind` answers `null` for is thrown. No other module under `app/` or `scripts/` issues a mutation on the type. **Pin:** the write-request module joins the caller pin (`PINNED_BEYOND_COMMIT`), and the scan for it covers `scripts/` as well as `app/`; its exact importer list is IF2-23's — `app/utils/fairnessMonthCommit.ts`, `app/utils/fairnessLedgerRead.ts` (it calls the stored-record parser, IF2-20), whatever other `app/` module the plan proves needs the validator, hash or parser, and — added by C4 in its own change — C4's CLI file `scripts/reconstruct-fairness-months.mjs` and its `scripts/lib` core (which imports the module's pure functions and never calls the executor). **Audit:** GU-5's executor rule makes the write-request module (declaration) and `fairnessMonthCommit.ts` (call) `protected-write` sites, each registered by exact `file#module` in `PROTECTED_RUNTIME_WRITERS` (GU-1); C4's CLI file — the only executor caller outside `app/` — is flagged by the same rule unconditionally and carries its exact `OPERATOR_TOOLING_ALLOWLIST` entry, registered by C4 (C4 R20) | `serviceCommitCallers.test.ts` (extended scan) fails on a new importer in `app/` or `scripts/`; `protectedReadAudit.test.ts` (GU-5 fixtures, both entries exercised); executor tests with a fake client asserting the mutation log per decision row, a `member_unknown` refusal for each actor, and a throw with no read issued for a read client lacking a token, configured with another perspective, or with `useCdn: true` |
| WR-17 | **The body validator is exported.** The write-request module exports the validation of a `FairnessMonthWrite` (IF2-18; WR-3's strictness, WR-4's limits, REC-3/REC-4's consistency, A11) as one neutral function taking the actor (it decides only the `source` rule of WR-4) and the current CDMX month (it decides only WR-4's «at most the current month + 12»; the executor passes its `stamps.currentMonth`), run by the executor on every **write** entry whatever the actor (a delete entry, `{ month, expectedRev }`, is not a body and is not passed to it; its `month` must still match WR-4's pattern). A caller that **transforms** a body before writing it (C4 transforms the resolver's body: its join bounds narrow it, and Frank's overrides may also widen a cell, or add a `people` item for a worship member the resolver did not list (C4 R8) — C4 Interfaces 2, R5–R8) must pass the result through this function before planning it; the executor re-runs it regardless | Unit tests; the executor refuses an invalid body with 400-shaped issues for actor `route` and a typed refusal for actor `reconstruction` |

**Residual race, stated.** WR-7's freezing-services read and WR-11's commit are not atomic: Sanity
cannot assert another document's absence inside a transaction. A weekend service or counted special
created in the month between the two — or a stored special toggled to counted (C1 lets a stored
service's toggle change after the fact) — lets a `replace` land on a month that just became frozen.
Accepted, because the
`ifRevisionId` still guarantees the replaced record is the one the writer read (no other admin's
record is discarded — L3), the window is milliseconds and needs a concurrent service create in a
month whose record is being replaced, and the ledger stays well-defined (it uses the record in
force). The plan does not claim atomicity anywhere.

### 4.3 The ledger (`app/utils/fairnessLedger.ts`) — LG

The ledger computes, for stored services, the policy's F2–F6 exactly. C5 computes the same formula
for its plan; the golden fixture (FX) is the guard (F14). Rules are numbered so the fixture can name
what each case covers.

| ID | Requirement |
|---|---|
| LG-1 | **Services.** Canonical (non-`drafts.`) `sunday_role`, `saturday_role` and `special_role` documents. Two or more documents of one **weekend** type on one stored date are an ambiguous target: all copies are dropped and reported, by the same `indexUniqueByKey` rule the history uses. Several specials on one date are separate services (ADR-0011 identity) |
| LG-2 | **Counted.** A service counts iff its effective flag `coalesce(countsForFairness, _type != "special_role")` is true (C1's rule, consumed through `COUNTS_FOR_FAIRNESS_GROQ` in queries and `countsForFairness(doc)` in code — §7.1). An uncounted service contributes to nothing: no share, no received seat, no set-aside, no floor, no «cantó», no X1 input |
| LG-3 | **Recorded months only.** A month contributes shares, received seats and set-asides only if it has a record. A month without one contributes nothing and is reported `recorded: false` (F3). Services of earlier months count in every published state — `published: false` (drafts), `true` and absent (legacy, which reads as published); the target month and later months never count |
| LG-4 | **Seat → role key → line.** `sunday_role`: `Lead` → `Sun.Lead`, `BGVs` → `Sun.BGV`, `Chorus` → `Sun.Choir`. `saturday_role`: `Lead` → `Sat.Lead`, `BGVs` → `Sat.BGV`, `Chorus` → `Sat.Choir`. A counted special maps by **day class** (D14, parent A13): dated on a Sunday → the `Sun.*` keys, any other day → the `Sat.*` keys; the weekday is computed from the stored date string's integer year, month and day by a pure civil-calendar day-of-week formula — never through a `Date` object (LG-16). A seat is an array item with a non-empty `_ref`; the holder is that id whether or not a member document still exists. Instruments and FOH never count. **One seat per person per service** (C5 §6.1's hard rule, stated identically for stored data): if one holder appears more than once among a service's voice seats — two role keys, or one role key twice (a repeated array entry) — her seat at that service is the first in the order Lead > BGV > Choir, and every further seat of hers there is a **second seat**, treated as decided: set aside with reason `second_seat` (LG-9) before LG-7–LG-11 run, so it shrinks its pool by one, credits and owes nobody, and is invisible to every rule that reads held seats — the presence seat (LG-7), LG-8 (vii), LG-9 (a)–(e), LG-11 (received seats, «no fixed seat», the floor seat), CAD-2's «led» and RD-3's `countedSundayLeads`. A second seat set aside as `second_seat` never cancels a floor or removes her from another population, whatever its role key's status. `held` and «cantó» count it (display only; «cantó» includes set-asides, LG-14). This reproduces the pools C5 computes on the request C6 builds, which carries the kept seat only (C6 ST-6, same order; C5 §5.5 refuses two pins for one person at one service). **Exported, record-free (IF2-11).** LG-1's drop, LG-2's filter and this row's role-key mapping and kept seat are one exported pure function over role documents that takes no record, member or availability input and returns each kept seat with its service `_id`, stored date and role key (plus the second seats and duplicate targets); the ledger runs it before LG-7, C4 runs the same one for its join months (C4 R5) — unrecorded months, which LG-3 keeps out of the ledger — and C6's ST-6 test compares the seat C6 sends against it, so no second seat rule exists |
| LG-5 | **Listing.** For a recorded month with record R, `status(p, k)` is R's value for p and role key k; a person absent from R is `"out"` everywhere (REC-7) |
| LG-6 | **Availability and rule exclusion.** p is unavailable on date d of month m iff d is a block date with `unavailable: true` in R for p, **or** d is in p's live `unavailableDates` (union, F4: a member deleting a past date cannot create debt). p is rule-excluded for k at a **weekend** service on d iff k is in R's `excludedRoles` for p on d. Rule exclusions never apply to specials (parent A13; grid parity, `serviceRuleContext.ts:56`) |
| LG-7 | **Presence.** A presence rule ρ of R applies only at counted **weekend** services s (parent A13), for the role keys A(ρ,s) = ρ.roles ∩ keys of s. Its **sub-line population** Q(ρ,s) = members of ρ that are `"in"` for some k ∈ A(ρ,s), available on date(s) and not rule-excluded for that k. Its **presence seat** π(ρ,s) = the first seat at s whose role key k is in A(ρ,s), whose holder h is a member of ρ, and which is **not a fixed seat** — a fixed seat is one LG-9 (a) or (b) sets aside: `status(h,k) === "exact"`, or k maps to DL and h has `sundayCadence`. A fixed seat is decided before the solve (F6) and is A12's «fixed seat», so it is never a presence seat: it is set aside `exact` or `cadence` and cancels the floor (LG-11) whether or not a presence rule covers it, and it never credits a sub-line. Candidates are ordered Lead > BGV > Choir, then by the holder's member `_id` in codepoint order — **never** stored array order, which C5's request does not carry (C5 §6.3 uses the same order and the same fixed-seat exclusion, c5:418-427, so the two pick the same seat); rules are taken in `ruleKey` codepoint order and a seat serves at most one rule. If π's holder is not in Q(ρ,s), π is set aside (`outside_population`) and the sub-line's pool at s is 0 |
| LG-8 | **Normal population** P(s,k) for counted service s in recorded month m and role key k: every p with (i) `status(p,k) === "in"`; (ii) available on date(s); (iii) not rule-excluded for k at s; (iv) if k maps to DL, no `sundayCadence` in R (F7: no DL line); (v) not a member of a presence rule ρ applying at s with k ∈ A(ρ,s) when ρ is `exclusive` (F5 parenthesis); (vi) not the **only** member of Q(ρ,s) for any rule ρ applying at s — that member is out of every normal population at s (F6, forced presence); (vii) not holding, at s, a seat of another role key k′ for which `status(p,k′) === "exact"` (F6, a seat decided before the solve). Pins are not distinguishable from hand placement in stored data, so a stored pin moves no population (parent X1 treats them alike) |
| LG-9 | **Set-asides** (removed from the pool; credit nobody, owe nobody — F5). At (s,k), a seat other than a presence seat is set aside when it is a second seat of its holder at s (LG-4) → `second_seat`, checked first; otherwise when its holder h: (a) has `status(h,k) === "exact"` → `exact`; (b) holds a DL-mapped seat and has `sundayCadence` → `cadence`; (c) is absent from R → `not_in_record`; (d) is otherwise not in P(s,k) → `outside_population`; (e) is chosen by LG-11 → `floor`. The first matching reason is reported |
| LG-10 | **Shares.** Every voice seat at a counted service is in exactly **one** of three classes, so none is subtracted twice: (1) **set aside** — LG-4's `second_seat`, LG-9's reasons, LG-7's `outside_population` presence seat, or LG-11's `floor` (a presence seat chosen as the floor seat is set aside and leaves its sub-line); (2) a **presence seat** not set aside, counted in its sub-line only; (3) a **normal** seat. Pool(s,k) = the class-3 seats at (s,k), i.e. seats at (s,k) − set-asides at (s,k) − presence seats at (s,k) that are not set aside. For p ∈ P(s,k): share = Pool / \|P(s,k)\|; received = p's seats at (s,k) that are neither set aside nor a presence seat (so at most one per service: a second seat is set aside, LG-4). A sub-line ρ at s has pool 1 when π(ρ,s) exists and its holder ∈ Q(ρ,s), else 0; share = pool / \|Q(ρ,s)\| for each member of Q; received = 1 for π's holder. Every remaining seat's holder is in its population, so a positive pool never meets an empty population. **Balance = share − received**, summed per line. On exact values, balances sum to 0 per (service, role key) and per (rule, service) |
| LG-11 | **Floor seat, past months** (F5, F9). Evaluated per recorded month m on the values of LG-10 **without** floor set-asides. A person p gets one floor set-aside in m iff all hold: p is listed in R and not `exempt`; p is in some P(s,k) or Q(ρ,s) at a counted service of m; p's combined share over every line and sub-line of m is **below 1**; p has at least one received seat in m; and p holds **no fixed seat** in m — no seat set aside under LG-9 (a) `exact` or (b) `cadence` (parent A12, A33: «only an exact or cadence seat that month cancels the floor seat; a pinned seat outside the population does not»; a seat set aside as `second_seat`, `not_in_record` or `outside_population` does not cancel the floor). The «below 1» threshold is A12's for past months: the stored-seat share before floor set-asides. The floor seat is p's first received seat in m ordered by stored date, then Lead > BGV > Choir, then service `time` by `compareServiceTime` (`app/utils/serviceTime.ts:25-32`: present times ascending, an absent time **after** every present one, and a string `isServiceTime` rejects read as absent — the repo's ONE time comparator under `app/**`, CLAUDE.md; the neutral module is imported, LG-16 allows it, and no second comparator is written), then service `_id` (codepoint); no two of her received seats can still tie, because she holds at most one seat per service (LG-4), so no array order is consulted; a presence seat qualifies. All floor seats of m are applied together; populations do not change; the affected pools shrink by one (a sub-line's to 0) |
| LG-12 | **Windows.** The **window** is exactly the 3 calendar months before the target month, by integer arithmetic (`historyWindow`'s rule, `solverHistory.ts:249-262`). The **cumulative** span (X4) is every recorded month from the earliest record before the target to the month before the target. Both are sums of per-month exact values |
| LG-13 | **Arithmetic.** Exact rational arithmetic throughout (no floating point accumulates). Each output figure is rounded **once** to hundredths for the wire (parent A17, F14): hundredths = sign(x) · ⌊\|x\| · 100 + ½⌋ (half away from zero). `received` is exact in hundredths (100 × an integer seat count, no rounding), so the wire `balance` **is defined as** `share` − `received`, both in hundredths, with no second rounding — not as the exact balance rounded on its own, which differs at a half (exact share 0.125 with one seat: 13 − 100 = −87, where rounding −0.875 alone gives −88). C5's `after = carried + share − received` (C5-7) uses the same identity, and the fixture's expected `balance` is this one. «Tuvo» shows `Figures.seats` = `received` ÷ 100, which the server emits so no client divides. **Display.** Every `share` and `balance` the panel shows (per line, per tab including Total and the folded BGV, window and cumulative) also gets its **tenths**, rounded once from the **same exact value** by the same rule (tenths = sign(x) · ⌊\|x\| · 10 + ½⌋) — never from the hundredths, which would round twice (exact 0.249 → 0.25 → 0.3, where the exact value gives 0.2). Rounded figures are outputs only and never feed a computation. Rounded balances may fail to sum to exactly 0 by a few hundredths (or tenths); exact ones never do |
| LG-14 | **Total, «cantó», exempt.** Total = DL + SL + BGV + CORO + every `P:*`, summed exactly. The **BGV display figure** = BGV + every `P:*`, summed exactly (sub-lines folded for display, parent F1). «Cantó» = every voice seat p held at counted services of the window's recorded months, set-asides and presence seats included. `exempt` changes no line (D13); it excludes p from Total's display and from LG-11 |
| LG-15 | **Notes.** For each person, month and line, the ledger emits notes from a closed set: `unrecorded_month`, `not_listed`, `role_out`, `unavailable { dates }`, `rule_excluded { dates }`, `exact { roles, count }`, `exact_clamped { count, available }`, `cadence_set_aside { dates }`, `cadence_no_sunday_saturday { dates }` (a cadence person who led no counted Sunday in m and led at least one counted non-Sunday Lead seat: that seat counts in SL, D11), `floor_seat { date, roleKey }`, `presence { ruleKey, members }`, `outside_population { dates }`, `second_seat { dates }` (LG-4), `exempt`. Diagnostics: `duplicateTargets`, `notInRecordSeats`, `unknownMembers` (a seat holder with no member document and no record listing) |
| LG-16 | **Neutral and deterministic.** No `"use client"`, no `server-only`, no Sanity client, no `node:crypto`, no `Date` arithmetic on service dates, no import from a client module (`clientBoundary.test.ts`). Output is independent of input order: every list is sorted by codepoint. Keyed by member `_id`; names are display only |
| LG-17 | **Exact clamp, reported.** In a recorded month, if an exact rule's `count` exceeds the person's available matching counted services (available, not rule-excluded, a covered role key present), the ledger reports `exact_clamped { count, available }`. Set-asides remain the seats actually held; nobody accrues debt for a seat that was never filled (F5) |

### 4.4 The cadence state (X1) — CAD

| ID | Requirement |
|---|---|
| CAD-1 | **One function** (IF2-12), pure and neutral, in `fairnessLedger.ts` (F7): given, for one member, `ledCountedSundayPreviousMonth` and 1–2 consecutive months each with `eligible` and `availableCountedSundays`, it returns each month's `state: "on" \| "off"` and a `reason`. Month 1: `not_eligible` if not eligible; else `led_previous_month` if she led; else `no_available_sunday` if 0 available; else `on`. Month 2 runs the same rule with "led previous" = (month 1 is `on`), reported as `assumed_led_previous_month` when that is the reason (X1: month 2 assumes month 1 follows its own state). **Wire states (parent A14).** The solver's wire has three states, `on`, `off` and `out`; `out` is exactly the reason `not_eligible` (no Sunday, no compensation Saturday), every other «off» is `off`. That mapping is the caller's (C5-5, C6 RQ-4) and is the only one; this function keeps `state: "on" \| "off"` plus `reason` so the panel can say why |
| CAD-2 | **Inputs, defined.** "Led a counted Sunday" = held a `Lead` seat at a counted service dated on a Sunday (weekend Sunday or counted Sunday special), in stored data, published or not, pinned or hand-placed alike; it does not depend on the month having a record. "Eligible" = `Sun.Lead` is `"in"` for her in that month's record when the record **binds** the month (parent A6, §4 vocabulary), else `Sun.Lead` is `"in"` for her in `resolveMonthEligibility`'s output for that month over the on-screen state (RES-1–RES-7: pools, current Tipo, exclusions and exact rules applied — never the raw pool tick) — the caller supplies it. "Available counted Sunday" = a counted Sunday-dated service of that month on which she is available (LG-6) and not rule-excluded for `Sun.Lead` (parent A14: an excluded Sunday cannot be led, so it cannot make the month «on») |
| CAD-3 | **Never stored.** Records keep the setting; the state is recomputed whenever needed. The GET supplies the stored inputs (RD-3: `countedSundayLeads`, `horizon[].recordBinds`); C6 supplies the horizon inputs |

### 4.5 The reader and `GET /api/admin/fairness` — RD

| ID | Requirement |
|---|---|
| RD-1 | **Reader.** `app/utils/fairnessLedgerRead.ts`: `import "server-only"`, `operationalClient` imported directly, every query a new additive builder in `serviceReadQueries.ts` (no `published` filter: prior-month drafts count; no new draft-gating exemption). It reads: every `fairnessMonth` with `month` ≤ the last horizon month (IF2-25), each passed through the stored-record parser (IF2-20, RD-2); every role document of the three types whose stored date is in [min(earliest record month, target − 3), target) (IF2-26, each row mapped to IF2-10's `LedgerService`) plus, for each horizon month, its stored weekend services, counted specials and uncounted specials counted separately (IF2-24: the freezing-services predicate of §4 is weekend + counted specials, one exported definition shared by WR-7, this read, C4 and C6); the members those records and seats reference (`_id`, `member_name`, `alias`, `unavailableDates` — a reader-internal builder). The GET's per-person figures, window, `recordsSince` and diagnostics are the ledger's entry point (IF2-10) over those records, services and members — the one implementation, which C4 calls too. It performs no authorization (the route gates) |
| RD-2 | **Fail closed.** An absent or empty `SANITY_API_READ_TOKEN` (checked before any read: without it the dotted record ids are invisible and the past would read as «sin registro» — parent A2), a rejected read, a non-list answer, or a record that fails the record schema (unknown `schemaVersion`, a missing field, an invalid enum) throws `FairnessLedgerUnavailableError`, whose message is fixed — «No se pudo leer el saldo de equidad.» — carrying no Sanity text; the cause is logged on the server once — for a refused record, the parser's refusal and its issues, whose paths are index-based and whose messages carry no stored value (IF2-18's issue format), so no member id, name, presence `_key` or `ruleKey` reaches a log (§6 «Key hygiene» (c)). It never returns an empty or partial ledger in place of a failed read. A month without a record is **not** a failure (F3, L5). **One record-schema check (IF2-20).** The check is not written in the reader: it is the stored-record parser the neutral write-request module exports (a stored document, `unknown`, → `LogicalRecord` or a typed refusal), which the reader calls on every record it reads, turning a refusal into `FairnessLedgerUnavailableError`, and which C4's `tsx` script calls too — so the reader and the script cannot disagree on what a valid record is. It applies exactly this row's check and nothing more; intactness (REC-6, `contentHashOfStored`) stays a separate test, so a record the parser refuses can still be hashed |
| RD-3 | **Payload.** The route returns `FairnessLedgerResponse` (IF2-8): the effective engine, the deployment's `environment` (REC-2's derivation, the one function that stamps records — so the panel can say where a «Registrar» would be stamped), the current month, the target, the 3 window months with record summaries, the earliest recorded month, the horizon months with their full logical record (or `null`), their service counts and `recordBinds` (parent A6: record present and at least one freezing service — the one definition C6's record-bound test reads, never re-derives), and per person: window, cumulative and per-month figures per line (`share`, `received`, `balance` all in hundredths — `received` = 100 × seats — plus the display tenths of LG-13 and the integer seat count `seats` for «Tuvo»), the five display tabs, «cantó», notes, set-asides, `countedSundayLeads` (**one entry per counted Sunday-dated service** in a window month at which her seat — LG-4's kept seat, so a repeated Lead entry at one service adds nothing — is a Lead seat; a date repeats when she led two such services that day, e.g. a Sunday service and a counted Sunday special; sorted — so C6's `prev_dl_leads` counts entries, C6 sibling issue S-4), and `firstRecordedIn` per role key (the first recorded month marking it `"in"` — C5's `dl_since`, parent A15) |
| RD-4 | **Route.** `GET /api/admin/fairness?month=YYYY-MM[&horizon=1\|2]` (default 1): the solver-history gate (manager; content-editor refused — it exposes availability, L5); 400 `invalid_request` on a malformed parameter; 200 with `Cache-Control: no-store` and `dynamic = "force-dynamic"`; on any throw, 500 `{ error: "fairness_unavailable", message }` with **no** `people` key, logging anything not already logged (`solver-history/route.ts:82-95` precedent) — the error only, never the request's rule or member content or a payload (§6 «Key hygiene» (c)) |
| RD-5 | **Scope.** No ministry filter on seat holders (seats are worship roles); the payload names only people listed in a read record or seated in a read service |
| RD-6 | **Two more read builders, for server and script callers of the resolver** (neutral, additive, in `serviceReadQueries.ts` beside `canonicalMemberNamesQuery`, returning the file's `BoundQuery`; the GET does not use them — RD-1 reads only referenced members). **(a) The worship roster** (IF2-27, working name `worshipRosterQuery()`): every canonical `teamMembers` document (`!(_id in path("drafts.**"))`) matching `WORSHIP_AUDIENCE_GROQ_FILTER` interpolated from `app/ministries.ts` (absent or empty `ministries` means worship; **no** `$all` arm, never a bare `"worship" in ministries`, never a hand-written copy), with no `voz`, Tipo, pool or `disabled` filter, projecting `_id`, `member_name`, `alias`, `memberType`, `ministries`, `unavailableDates`. It is the one server-side definition of RES-5's roster — exact, so RES-5's filter is a no-op on it — and of C3's `RosterMember` list for a script (C4 Interfaces 4 a, R3; C7's rehearsal). **(b) The rule set** (IF2-28, working name `solverConfigQuery()`): the singleton `*[_id == $id][0]` with `$id` bound from `SOLVER_CONFIG_DOC_ID` (`solverConfigWriteRequest.ts:51`, never a second literal), answering the stored document or `null`; the caller parses it with `solverConfigFromDocument` and treats `null` as **absent**, never as the defaults (the admin route's `present: false`, `solver-config/route.ts:71-90`; C4 R3). Both carry no `published` filter (neither type is draft-gated) and add no draft-gating exemption; a caller runs them only on a token-carrying, published-perspective, no-CDN client (A2). **Tested** by evaluating each builder with `groq-js` over an in-memory dataset (the `leadNoteProjection.test.ts` precedent): (a) returns a member with absent, one with empty and one with worship `ministries`, never a kids-only one nor a `drafts.` copy, and projects exactly the six fields; (b) binds the constant and answers `null` for an absent document |

### 4.6 The eligibility resolver — RES

One neutral, client-callable function (IF2-15) turns the **on-screen** planner state into one month's write
body. Parent A7 makes C2 its owner: it is the single v3 eligibility resolver and the only definition
of "what eligibility a month was solved with": «Registrar» (UI-6)
uses it, and C6 must build both its confirm body and S1's per-role eligibility from its output, never
from a second resolution (Interfaces).

| ID | Requirement |
|---|---|
| RES-1 | **Pools → roles** (v2's map, `owt_solver_v2.py:642-648`, plus `Sat.Choir`): `Sun.Lead` in iff in the Sunday pool; `Sat.Lead` in iff in the Sunday or Saturday pool; `Sun.BGV`, `Sat.BGV`, `Sun.Choir`, `Sat.Choir` in iff in any pool; each only when the member's current Tipo fits the role (WR-5's rule). No cross-pool de-duplication. A rule never grants eligibility: v2's `extraSupport` injection (`plannerModel.ts:886-938`) is a v2 request artifact and is not carried over (Q1) |
| RES-2 | **Exclusions, and the one v3 pattern expansion.** A restriction's `excludedPatterns` set the covered role keys to `"out"`. Patterns resolve over the six keys by **one exported, neutral, client-callable expansion** (IF2-16, working name `rolesOfPatternV3`, beside `rolesOfPattern` in `plannerModel.ts`; the plan may rename it only together with C5 and C6): `Sun.*` → the three `Sun.*` keys; `Sat.*` → the three `Sat.*` keys; `*.X` → both days; `*.*` → all six; `*.LeadBGV` → Lead and BGV on both days; a single key → itself (`Sat.Choir` included); legacy aliases as `LEGACY_PATTERN_ALIASES` (`plannerModel.ts:619-624`, mirroring `owt_solver_v2.py:68-73`); `[]` for anything else. **Relation to `rolesOfPattern`** (the ONE v2 map, `plannerModel.ts:637-650`): for every pattern, the expansion restricted to the five v2 keys equals `rolesOfPattern`'s answer, and `Sat.Choir` is added exactly when the pattern covers chorus on Saturday (`Sat.*`, `*.Choir`, `*.*`, `Sat.Choir`, and their aliases). `rolesOfPattern` and its solver sync are untouched — v2 keeps its five keys. A sync test (an extension of `patternRolesSync.test.ts` or a sibling) asserts that relation over every pattern the rule form can save plus the legacy aliases, so the two maps cannot drift. This expansion is the only one used for the record's exclusions, exact rules and presence roles, and C6 builds every v3 rule's `roles` (count, pair, presence) from it (C5-4) |
| RES-3 | **Exact rules, and the one per-month count resolution.** A cap with `op "=="` makes each covered role that is otherwise `"in"` `"exact"`, with `count` resolved for the month, and yields one `exactRules` item listing exactly those roles; a resolved count of 0 makes those roles `"out"` and yields no item; a cap whose covered roles are none `"in"` (or whose pattern expands to `[]`) yields no item. **At most one exact count per person per role key (parent A38):** two `==` caps that resolve to the same member (whatever their spellings) and whose expansions share a role key refuse the build as `overlapping_exact`, naming her — judged on the `rolesOfPatternV3` expansions, not on the resulting statuses (C3 refuses the same pair when saving, by rule person; this check also catches two spellings of one member, and C3 §6.2 leaves an overlap on `Sat.Choir` alone to C2). **Count range — every `==` count is a whole number from 0 to 31, or the build refuses.** A cap's value can arrive as anything finite: the rules card stores `Number(input)` and its `min`/`max` attributes do not stop a typed `1.5` or `-1` (`MonthGenerator.tsx:842-855`), the config writer accepts any finite `value` and `relOffset` (`solverConfigWriteRequest.ts:194-205`, `:384-393`), and the resolver reads the **on-screen** config, unsaved edits included (§8). So each `==` cap's count is IF2-17's typed result, judged — like `overlapping_exact` — on the cap itself, before, and regardless of, the covered roles' statuses: IF2-17 `ok: false` (`not_whole`: a fractional `value`, a fractional `relOffset` whose result is not clamped to 0, or a non-finite value; `negative`: a fixed whole `value` below 0) or an `ok: true` count above 31 refuses the build as `exact_count_range`, naming her. A count is never rounded, truncated, clamped or read as 0 here (§9); the only 0 is IF2-17's own, a relative cap whose month has no more Sundays than its offset (`resolvedCapValue`'s `max(0, ·)`), which is the «0 → `"out"`, no item» case above. So every `exactRules` count the resolver emits is a whole number 1–31 (WR-4). `<=` and `>=` caps change nothing in the record. The count resolution is **one exported neutral function** (IF2-17) over `resolvedCapValue` (`plannerModel.ts:667-669`) with `weeks` = the month's full count of Sundays (ADR-0047's D2) — never a restatement of `max(0, weeks − offset)`; C6 resolves every v3 count rule (`==`, `<=`, `>=`) per month with it and inherits its range (C5-4, C6 RQ-5; §12) |
| RES-4 | **Dates.** `weekExclusions` become `blocks[].excludedRoles` on the weekend dates of week N by the planner's existing week numbering (`ruleContextForTarget`; week `weeks + 1` is the trailing Saturday, ADR-0048), restricted to the role keys of that date's day class. Each member's `unavailableDates` inside the month become `blocks[].unavailable` |
| RES-5 | **People — the resolver applies the worship filter itself.** The resolver's `members` input may be **any superset of the worship roster** that carries each member's stored `ministries` as read, with no `voz`, pool or Tipo filter (C3 §6.5, §7 item 4, its A4): the planner's `members` is worship-only for a worship admin and **everyone, kids-only included, for a super-admin** (`app/api/admin/members/route.ts:21-32` binds `$all`; `app/ministries.ts` `WORSHIP_MEMBER_GROQ_FILTER`), and «Registrar» and C6 pass that on-screen list. **Before anything else** — `people`, RES-1's pools, RES-3's exact rules, RES-4's blocks, RES-6's presence and the roster handed to C3's functions — the resolver drops every member for whom `normalizeMinistries(m.ministries).includes("worship")` is false (`app/ministries.ts`, the one TypeScript reader of the storage contract; never a restatement of it). What remains is the **unfiltered worship roster** every later clause means. Filtering drops members, never a field: every member handed on — to C3's `resolveRulePersonId` and `cadenceMembers` included — keeps its `ministries` unstripped, so C3's functions apply the same predicate again (C3 §7 item 4), harmlessly: a no-op on this roster, and still effective if a caller ever passed the unfiltered superset. So one config and one worship team give one body for every viewer, and a kids-only member never reaches a `people` item, a pool, a block or a name match — the commit-time refusal `member_not_worship` (WR-5) stays as defence in depth and never fires on a body this resolver built from a roster read at the same time. **Scope of «one body for every viewer»:** it holds for every member whose stored `ministries` is absent, empty, or lists at least one known ministry id — the only shapes the app's member routes store (`validateMinistryWrite`, `app/ministries.ts:100-109`, refuses an unknown id and an empty list). A list holding **only** unknown ids can be written only outside the app (`/studio` is not ministry-scoped); `normalizeMinistries` reads it as worship (`app/ministries.ts:41-44`) while `WORSHIP_AUDIENCE_GROQ_FILTER` does not (`:74-75`), so a worship admin's on-screen roster omits that member and a super-admin's keeps her, and the two bodies differ. C2 does not reconcile the storage contract's two readers; the resolver stays correct for the roster it is given, and WR-5's commit-time check reads `normalizeMinistries` like the resolver. **Caller obligation** (C3's, restated): pass `ministries` as read — a list stripped of the field reads as all-worship (absent = worship) and turns the filter into a no-op; the planner's route projects it, and the server/script roster builder (RD-6) projects it. From the filtered roster the resolver derives, separately, the record's `people`: every member whose Tipo includes `voz`, each once, plus `exempt` from `fairness === "exempt"` (`"slack"` records nothing — parent Q2, A10) and `sundayCadence` on the `people` item of each id `cadenceMembers` returns (RES-7); a cadence member whose Tipo lacks `voz` has no item and records nothing (she holds no voice role to alternate). Names are always resolved against the unfiltered worship roster this clause keeps (worship members, no `voz` filter), never against `people` |
| RES-6 | **Presence.** Each presence rule → `{ ruleKey: rule.id, roles (resolved per RES-2), members (distinct resolved ids, codepoint-sorted), exclusive }`; `exclusive` per REC-4 from `conflicts[]`. A rule the validator would reject refuses the build (RES-8), never a silent drop: a person resolving to a member outside `people` (a Tipo without `voz`) → refusal `presence_member_not_listed` naming that person; fewer than 2 or more than 12 distinct members → issue `presence_members`; roles expanding to `[]` → issue `presence_roles`; a `rule.id` not matching REC-4's pattern, **or shared by two or more presence rules of the config** (WR-4 requires unique `ruleKey`s; the save path refuses a duplicate id, `solverConfigWriteRequest.ts:110-135`, but `solverConfigFromDocument` does not dedupe on load, `:351-430`, and the on-screen state is not re-validated) → issue `presence_rule_id`, one per offending id (both id sources comply: the planner's `uid()`, `plannerModel.ts:1658`, `MonthGenerator.tsx:388`, and the seed defaults' `d-…` ids, `solverConfigDefaults.ts:89-96`; a non-compliant one can only come from a hand-edited config); more than 20 rules → issue `too_many_presence`. **Ids are not planner-minted in production.** The planner mints a `uid()` only for a rule created in the form; editing a rule keeps its id (`MonthGenerator.tsx:994`, `initialValues?.id ?? uid()`), so production's one presence rule still carries its seed id, a string built from members' first names, as do every conflict and some restrictions and caps (§3). The `ruleKey` is the config id unchanged, so a rule keeps one `P:<ruleKey>` line across months. Compliance with the grammar does not make it name-free: a `ruleKey` (and every `P:<ruleKey>` line key, and an issue's `ruleKey`) is a **private identifier** under §6 «Key hygiene» — never logged or printed (a refusal or issue printed outside a manager surface is its kind, ordinal and code, (a)), and never re-keyed here ((d): re-keying would split a rule's line across months) |
| RES-7 | **Names — exactly one, through C3's resolver.** Every name the build reads — each restriction's `person` (exclusions, caps, «Exenta», week exclusions), both persons of each conflict, every person of each presence rule — resolves through C3's `resolveRulePersonId(person, roster)` (`app/utils/sundayCadence.ts`, C3 §7 item 4), and the cadence setting through C3's `cadenceMembers(config, roster)`, both over the unfiltered roster of RES-5. `resolveToMemberName`'s first-match resolution (`plannerModel.ts:572-578`) is never used here: it cannot see an ambiguous name. Any `unresolved` or `ambiguous` result, or a non-empty `refusals`, refuses the whole build with `{ ok: false }` naming **each** refused `person` and its reason (L4; C3's obligation on C2). A rule naming a member with no Tipo refuses as `solverPools` does (`no_tipo`) — the cadence setting included, since it is a restriction's field: a cadence member with an empty Tipo refuses the whole build, so she never reaches a month as «descansa». A person who resolves to both `sundayCadence` and an `==` rule covering `Sun.Lead` refuses the build as `cadence_and_exact`, naming her (parent A11; the validator refuses the same pair, WR-4), so the record and C6's request share the refusal. v2 keeps its current name matching (A7): nothing here changes `solverPools` or v2's request |
| RES-8 | **Output invariant (parent A38).** For every input whose `month` WR-4 accepts, an `ok: true` body, completed with `source: "auto"` and `expectedRev: null`, passes `validateFairnessMonthWrite(·, "route", currentMonth)` (WR-3, WR-4, WR-17) for every `currentMonth` under which WR-4 accepts that `month` — so a client that cannot import the validator (it hashes with `node:crypto`, WR-8) never sends a body that becomes a 400 after a solve. Every input that would produce a failing body returns `ok: false` instead, through RES-3 (including `exact_count_range` for an `==` count that is not a whole number from 0 to 31), RES-6, RES-7 or: no `people` (no worship member with `voz`) → issue `no_people`; more than 100 → issue `too_many_people` (WR-4's limit). Blocks are built only for dates inside the month and only when one of their two fields is non-empty (RES-4). WR-5's live-data checks are not part of this invariant (they read the published roster at commit time); RES-5's filter is what keeps a kids-only member out of the body, so WR-5's `member_not_worship` cannot be reached from a super-admin's on-screen roster. **Tested:** a generated-input test (the plan picks the generator) over configs and rosters (names, aliases, overlapping and relative `==` caps, **`==` caps whose count is out of range** — a fractional fixed `value`, a fractional `relOffset` (one whose result lands inside the month's Sundays and one that `resolvedCapValue` clamps to 0), a negative fixed `value`, a non-finite `value`, and counts of 0, 31 and 32 —, presence rules covering every refusal and issue (two presence rules sharing one `id` included), cadence settings, week exclusions incl. the trailing Saturday, and **kids-only members** — some with `voz` in their Tipo, some ticked in a pool, some namesakes of a worship member — beside members with absent, empty and worship `ministries`) asserts `ok: true ⇒ validator ok` and that no `people` item, presence member or block belongs to a member whose normalized ministries exclude worship; plus one example test per refusal and issue (`exact_count_range` once each for `1.5`, a `relOffset` of `0.5`, `-1` and `32`, each also with no covered role `"in"`); plus a **viewer-independence** test: the same config over a worship-only roster and over that roster plus a kids-only `voz` member (ticked in the Sunday pool, and sharing a worship member's alias) gives a deep-equal result |

### 4.7 The golden fixture (`fixtures/fairness/golden.json`) — FX

| ID | Requirement |
|---|---|
| FX-1 | **Location and ownership.** One JSON file at the repository root, created by C2, read by vitest now and by C5's Python suite (`gcf_v3/`, package `owt_v3`, scaffolded by C0 — parent A20) later. Expected values are **hand-computed and reviewed**, frozen in the file; neither suite regenerates them from its own output, and neither compares against the other at runtime |
| FX-2 | **Schema: IF2-29** (§7 holds the file's one shape). `units` applies to **every** expected figure with no exception: `share`, `received` (100 × the seats counted, so one seat is `100`) and `balance` (= `share` − `received`, LG-13); the display-only `seats` and `tenths` of IF2-8 are not in the fixture, so both suites compare the same integers with no rescaling. Each case has a unique kebab-case `id`, a `kind`, an English `description`, the LG/CAD rule ids and coverage tags it `covers`, an `input` and an `expected`. A `ledger` case's input is the ledger's own `LedgerInput` (IF2-10) and its expected holds the per-month and window figures per member and line, the set-asides and the notes; a `cadence` case's input is CAD-1's argument and its expected CAD-1's result (IF2-12). `plan` cases are reserved for C5 |
| FX-3 | **Who asserts what.** vitest asserts every `ledger` and `cadence` case and schema-checks `plan` cases. Python asserts every `ledger` case **per month** over **LG-1–LG-8, not LG-5–LG-8 alone** — evaluating its own share formula over the case's services as stored services (filled seats, actual placement), after IF2-11's step and LG-3's month selection, with populations as LG-5–LG-8 state: **LG-1** — every copy of a same-type weekend duplicate on one stored date dropped, none kept; **LG-2** — a service counted iff `coalesce(countsForFairness, _type != "special_role")` holds on the raw `LedgerService` field, so the counted flag takes its type default when the field is absent (a legacy weekend service counts, a legacy special does not) and an uncounted service — an explicit `false`, or a special without the field — contributes nothing; **LG-4** — seats mapped to role keys (day class by the civil-calendar formula, LG-16) with one kept seat per person per service; **LG-3** — only months with a record contribute, whatever their `published` state, a month without one contributes nothing, and the target month and later months are ignored; then populations resolved from the case's records exactly as **LG-5–LG-8** state — and every `plan` case it adds. FX-4's duplicate-target, legacy-default, uncounted-special, unrecorded-month and target/later-month cases fail in Python unless LG-1–LG-3 are part of its adapter. `cadence` cases are TypeScript-only (parent A18): X1 has one implementation (F7) and C5 consumes its output. An unknown `kind` fails both suites. Both suites also assert, for every `ledger` case, that exact balances sum to 0 per (service, role key) and per (rule, service) |
| FX-4 | **Required coverage** (each a separate case or a named part of one): sum-to-zero with an uneven division (2 seats among 3 people); unavailable by record snapshot and by live date only (the union); a window month with no record (seats ignored, `recorded: false`); a person absent from a recorded month (seat set aside `not_in_record`); a person listed but `"out"` for `Sun.Lead` in one recorded month (no DL share there while the others accrue, back in the population the next month — R8, D7); a hand-placed seat in an `"out"` role (`outside_population`); exact rule with its seats set aside and an `exact_clamped` month; F6 exact-seat holder removed from another role's population at that service; cadence member's Sundays set aside and no DL line, plus a no-Sunday month whose Saturday counts in SL; presence with both members available, with only one available (out of every normal population there), exclusive vs non-exclusive, and a broken exclusive rule (second member's seat set aside); a non-exclusive presence service where two members hold matching seats of the same role key and their **stored array order is the reverse of their id order** (the presence seat goes to the lower id — LG-7); floor seat chosen by date, a same-date tie resolved by role order, a same-date same-role-class tie resolved by time (an untimed weekend seat against a timed counted special's seat on that date: the **timed** seat is the floor seat, `compareServiceTime`'s absent-last order — LG-11; an invalid stored `time` read as absent is a vitest-only ledger test, not a fixture case, since the wire never carries one), a person whose `exact` or `cadence` seat cancels the floor (no floor set-aside), a person whose `exact` seat is at a weekend service covered by a presence rule she belongs to (the seat is set aside `exact`, never chosen as the presence seat — the next matching member's seat is, if any — and her floor is cancelled; LG-7), and a person whose only set-aside seat is `outside_population` who still gets the floor seat (A12); counted special on a Sunday (Lead → DL) and on a Friday (Lead → SL, BGV via `Sat.BGV`, Chorus via `Sat.Choir`), an uncounted special, and the legacy default (field absent: weekend counts, special does not); drafts in a past month counted; a duplicate weekend target dropped; the target month and a later month ignored; a cumulative span longer than the window; an exempt person whose lines are unchanged; a person holding two voice seats at one service (Lead and BGV), and one listed twice in one role key, each second seat set aside `second_seat` while the holder stays in the other role's population with nothing received there (LG-4); an **exact half** (parent A39): one seat among eight people, exact share 0.125 → every `share` 13 and the holder's `balance` 13 − 100 = −87, never the −88 of rounding −0.875 on its own (LG-13). Cadence: `on`; `led_previous_month`; `not_eligible` (an untick) followed by `on` the next month; `no_available_sunday`, including a month whose only available counted Sunday is rule-excluded from `Sun.Lead` (A14); a two-month run `on → assumed_led_previous_month` and `off → on`; and a pinned Sunday in an «off» month counted as led, making the next month `off` |
| FX-5 | **Names.** Fictitious people and ids only (this repository is public). No test can compare the file against the production roster without reading production data, so the fixture's header states the rule and code review enforces it |

### 4.8 The read-only «Equidad» preview and «Registrar» — UI

| ID | Requirement |
|---|---|
| UI-1 | **Mount.** One read-only panel mounted **beside** `LeadPoolHistoryPanel` at the config step and in the stored editor (`MonthGenerator.tsx:1737-1747`, `:4489-4501`), for the month being viewed; `LeadPoolHistoryPanel`, `ParticipationSidebar` (`computeParticipation`, its «Incluir especiales» switch) and the solver-history surfaces are unchanged (L1) |
| UI-2 | **Inert.** It reads only `GET /api/admin/fairness?month=<viewed>&horizon=1`; it changes nothing Auto reads, sends, solves or writes; a failure of its read never blocks Auto or any save |
| UI-3 | **Shape.** A `Collapse` disclosure, closed by default, that loads on first open (`Skeleton` while loading; the fixed error copy with «Reintentar» on failure — never an empty table). Inside: the banner «Vista previa: Auto todavía no usa este saldo» (always visible while open), the window chips, a `SegmentedControl` for the five tabs, the table (desktop) or one card per person (phone), and a collapsed «Fuera de esta línea» group. The desktop table never widens the page: if it can overflow, it scrolls inside its own `overflow-x-auto` box (ADR-0035 — `/admin` has no page-level horizontal scroll) |
| UI-4 | **Columns** (U5 minus «en este plan» and «queda»): «Persona», «Le tocaba», «Tuvo», «Saldo (3 meses)», «Desde {mes año}» (cumulative, X4), «Motivo»; the Total tab adds «Cantó». Figures show **one decimal** (parent A17): the GET's tenths (LG-13, computed once from the exact value), rendered by C2's **single formatter** (IF2-13) — a neutral function that takes a tenths integer, never hundredths, and writes it with a decimal point (es-MX, «le deben 0.8»); «Tuvo» is `Figures.seats`, a seat count shown as an integer (never `received`, which is hundredths, and never divided client-side). No code under `app/**` derives tenths from hundredths (grep guard). The saldo is always in words (§8); «al día» when its tenths figure is 0. Rows: people in that line's population at least once in the window, sorted by the exact-derived hundredths saldo descending (most owed first), ties by display name with `es` collation |
| UI-5 | **Motivo.** One line per person from LG-15's notes, in a fixed order, with the copy of §8; for a cadence person on the DL tab it adds the viewed month's X1 state, computed with CAD-1 from the GET's `countedSundayLeads`, the viewed month's record when it binds (GET `recordBinds`, parent A6) else `resolveMonthEligibility`'s `Sun.Lead` status for her over the on-screen state (CAD-2 — never the raw Sunday-pool tick; when the resolver answers `ok: false` the X1 line is omitted, since «Registrar» and C6 refuse that state anyway), and the month's counted Sunday services from the on-screen state: every stored counted Sunday-dated service (C1's flag), **plus** one weekend default service for each Sunday of the month that has no stored `sunday_role` — so a month with only some Sundays stored still counts its unstored Sundays (display only); labelled «previsto» |
| UI-6 | **«Registrar elegibilidad de {mes}».** Rendered only when the GET's `engine` is `"v3"` and the viewed month is not before `currentMonth`; when the month's record binds (`recordBinds`), the button is replaced by the `month_has_services` line of §8, since WR-8 row 7 would refuse it; an **unrecorded** month with stored services keeps the button, because a create is accepted (WR-8 row 3, parent A27). It builds the body with RES from the on-screen state, sends it with `source: "manual"` (no solve produced it; `"auto"` is C6's confirm after an Auto, C6 CF-3), asserts the horizon record's `rev` it read (or `null`) per WR-15, and confirms through a `CueDialog` (`open` prop, never a literal) that names the replacement when a record exists, and — when the month is **unrecorded but already has freezing services** (`record === null`, `storedServices > 0`; after the flip, typically the current month planned under v2) — warns that this registration becomes that month's record: while the month has freezing services a route-written record cannot be replaced (WR-8 row 7), and C4's reconstruction will not touch it when the month becomes past (WR-14 row 5, `not_reconstruction_owned`; parent A21's «reconstructed as each becomes past» then does not apply to that month). The create stays allowed (WR-8 row 3, A27). When the GET's `environment` is not `"production"`, the dialog also says that this deployment writes the **production** dataset and that the record, stamped `preview` or `local`, cannot be removed from the app (§8 «Desde dev»; EN-3's blast radius, WR-13). It stays open on every refusal with the matching copy; success shows «Registrado ✓» through `useTransientValue` and re-reads the GET. The handler wraps `fetch` in try/catch/finally, checks `res.ok`, resets its loading flag and never closes as success on failure |
| UI-7 | **House rules.** `Button` only, `SegmentedControl` for the tabs, no `motion` import outside `app/components/ui/**`, no fixed-bottom element, no colour concatenation, light and dark themes |

### 4.9 The effective engine — EN

| ID | Requirement |
|---|---|
| EN-1 | **Ownership (parent A1).** C1 creates `app/components/admin/solverEngine.ts` with the constant `SOLVER_ENGINE: "v2" \| "v3"` (value `"v2"`) and nothing else (C1 §6.6, §9); C2 consumes it unchanged and never edits its value. C2 adds the **effective-engine resolver** (EN-2), the `OWT_SOLVER_ENGINE` SECRETS entry (EN-3) and the PUT's refusal `engine_not_v3` (WR-6); C6 adds the solve route's `409 solver_version_mismatch` and the server-resolved prop. If C1 has not landed when C2 is implemented, C2 stops (§10: C1 precedes C2) rather than creating the module |
| EN-2 | **The resolver** (IF2-14) is a pure function of an injected env (the `canonicalOrigin(env)` precedent, `origin.ts:22-33`), placed where only server modules import it (C6 ENG-3: no client module calls it; the plan picks the file — the constant's module stays import-free). It returns the constant unless `OWT_SOLVER_ENGINE` is exactly `"v2"` or `"v3"` **and** the deployment is one A1 allows: (a) the `preview` branch deployment — `VERCEL_ENV === "preview"` **and** `VERCEL_GIT_COMMIT_REF === "preview"` (the ref the runtime already reads, `srVerificationIdentity.ts:102`), so `verify/service-readiness`, also `VERCEL_ENV=preview`, never honours it even if the variable were mis-scoped; or (b) local development — `VERCEL_ENV` unset or empty. Production, any other `VERCEL_ENV` value (`development` included — A1 names «unset» only) and any other ref → the constant. Exactly one function under `app/**` reads `OWT_SOLVER_ENGINE` (C6 ENG-1's grep guard); no client bundle reads it; clients learn the engine from the GET (`engine`) or C6's prop |
| EN-3 | `docs/SECRETS.md` gains the `OWT_SOLVER_ENGINE` entry in this change: Vercel **Preview only, scoped to the `preview` branch** — never the `verify/service-readiness` pair (the branch-scoped pattern of `SECRETS.md:312-313`; EN-2 refuses it there anyway); not Production (ignored by code); not GitHub Actions; **optional** in local `.env.local` (A1 honours it when `VERCEL_ENV` is unset — set it only for a local v3 rehearsal); purpose; source (a literal typed into Vercel → Settings → Environment Variables, or `.env.local`); rotation (edit, redeploy Preview, verify the dev alias; locally, restart the dev server); blast radius (while `v3` on Preview, «Registrar» appears on dev and writes **production** records stamped `preview`; locally it writes production records stamped `local`; after C6, Auto on that deployment runs v3). It stays unset on Vercel until Frank decides a Preview rehearsal |

### 4.10 Guards, registries and documentation — GU

| ID | Requirement |
|---|---|
| GU-1 | ADR-0043's three owed items for `fairnessMonthCommit`: `PROTECTED_RUNTIME_WRITERS` entry (reason text: it holds the route's domain body and **delegates** every mutation to the write executor with actor `route` — create-only-by-collision, revision-asserted replace, freezing-services gate (A5), all-or-nothing, no side effects; it commits no transaction itself, and it is a site through GU-5's executor rule), `DELIVERY_CAPABLE_IMPORTS` entry, caller-pin row naming only the PUT route. A second `PROTECTED_RUNTIME_WRITERS` entry registers the write-request module `#module` (reason text: it declares the one write executor of `fairnessMonth`, which mutates through an injected client for both actors; the reconstruction actor's guarded delete is the only delete). Both entries are exercised by real sites (GU-5), so the «no dead entries» test (`protectedReadAudit.test.ts:531-538`) holds. As a consequence the PUT handler is wrapped in `withVerificationRunContext` (harmless: it delivers nothing — §9 «Module name»). The write-request module (the executor, WR-16) joins `PINNED_BEYOND_COMMIT` with its exact importer list (IF2-23), and the pin's scan is extended to `git ls-files app scripts` for that module (the other pinned modules keep their `app/`-only meaning or gain the wider scan — either way no existing row loosens). Every file the audit flags as writing `fairnessMonth` — under the existing rules or GU-5's — is registered by exact `file#module`. No guard is loosened |
| GU-5 | **The audit's executor rule** (additive; it tightens the scan and removes nothing). `protectedReadAudit.ts` gains a registry of **protected write executors**, the `PROTECTED_LOADER_HELPERS` precedent (`:94-103`) applied to writing (working name `PROTECTED_WRITE_EXECUTORS`), holding exactly the WR-16 executor's name. In every audited file, a **call** to a registered executor, or its **declaration**, is a `protected-write` site of the operation it sits in (`compliant: false`, evidence naming the executor) — **independently** of the existing client recognition: it is detected even when the file imports or creates no Sanity client (so it sits before or beside the early return at `:785`, never behind it) and even when no region of the file otherwise mutates. It does not depend on the accident that a `import type { SanityClient }` is harvested as a client identifier. The rule adds no read classification: the executor's injected reads stay outside the static scan and are held by WR-16's runtime assertion (REC-9 states the residual). Comments never count (`stripComments`, as today). **Detector fixtures** (beside the loader fixtures, `protectedReadAudit.test.ts:123-175`): (a) a module calling the executor with **no** Sanity client import yields one `protected-write` site at `module`, a violation until registered; (b) a route-shaped source calling it inside `export const PUT = withVerificationRunContext(…)` yields the site at `PUT`; (c) the declaring module yields one site at `module`; (d) a similarly named unregistered function, and the executor's name only in a comment, yield none; (e) the existing «mention-only» negatives (`:582-597`) still yield none. An aliased import (`import { executeFairnessMonthWrites as run }`) is not chased by the scan; the executor's caller pin (WR-16), which pins importers by module, is the backstop for it. The real-repository scan then shows exactly two `fairnessMonth` executor sites in `app/` (the write-request module and `fairnessMonthCommit.ts`), plus C4's CLI file `scripts/reconstruct-fairness-months.mjs` once C4 lands, registered by C4 in `OPERATOR_TOOLING_ALLOWLIST` (C4 R20; IF2-23) |
| GU-2 | The audit's `PROTECTED_TYPES` pin (`protectedReadAudit.ts` only; `serviceReadModel.ts`'s list unchanged) and Studio lists per REC-8/REC-9; `draftGatingCoverage` unchanged in its lists; `clientBoundary` passes with the neutral modules |
| GU-3 | A new ADR («El saldo de equidad se mide contra la elegibilidad registrada»), numbered at merge: the record and why eligibility is stored while seats stay derived, the dotted id's privacy and the token-or-fail-closed rule for every reader (A2), the freezing-services gate (A5) and its residual race, record binding (A6), the past-month and reconstruction-actor rules, exact arithmetic, one rounding to hundredths for the wire and one to tenths for display, both from the exact value (A17), and the one-seat-per-person-per-service rule (LG-4). It amends no existing ADR: per parent A31, every amendment to an existing ADR (ADR-0042's «amended under v3» included) is written by C7, because it describes production behaviour that changes at the flip |
| GU-4 | `docs/DATA_MODEL.md` (the new type; the governed-type count), `CONTEXT.md` (registro de elegibilidad, saldo, línea, sub-línea de presencia), `docs/SECRETS.md` (EN-3, and the existing `SANITY_API_READ_TOKEN` entry, `SECRETS.md:288-296`, gains: «needed to read `fairnessMonth` (dotted, private ids); without it the ledger GET fails closed and, after C6, Auto refuses to solve» on every platform that reads the ledger — the `Preview, Production` pair and `.env.local` — and its rotation's blast radius gains the same line), and `CLAUDE.md`: a «Don't-break-these» line («`fairnessLedger.ts` is the only TypeScript definition of F2–F7 and X1; records are written only through `fairnessMonthCommit` or the reconstruction actor; `fixtures/fairness/golden.json` is asserted by both suites») and the reusable-utils entries — including `rolesOfPatternV3` («the ONE v3 six-key pattern map; equals `rolesOfPattern` on the five v2 keys and adds `Sat.Choir`; synced by test») and `capValueForMonth` («the ONE per-month count resolution, over `resolvedCapValue`»), the panel's formatter («the ONLY fairness-figure formatter: one decimal from a tenths figure computed from the exact value, never from hundredths»), the effective-engine resolver («the ONE reader of `OWT_SOLVER_ENGINE`; `SOLVER_ENGINE` is the constant beside `SOLVER_SENDS_HISTORY`» — one line, which C6 DOC-3 then does not repeat), the stored-record parser («the ONE record-schema check for `fairnessMonth`; the reader and C4's script both call it») and the seat-keeping step («the ONE seat rule: duplicate weekend targets dropped, uncounted services out, one kept seat per person per service»), and a line that the write executor is the only mutation path for `fairnessMonth` and that every reader of the type carries the read token or fails closed |

## 5. Scope

### In scope

The record type and its Studio/audit governance; the write-request module (validation, keys, hash,
the stored-record parser, both actors' decision tables); `fairnessMonthCommit.ts` and the PUT route; the ledger, its record-free seat-keeping step and the X1
function; the eligibility resolver; the reader and the GET; the golden fixture; the read-only panel
and «Registrar»; the effective-engine resolver over C1's `SOLVER_ENGINE` constant (A1); the ADR and doc updates above.

### Non-goals

- Anything Auto sends, solves or writes; C6's confirm; the solve route's engine check (C6, E2).
- Planned shares, clamping in the plan, placement of monthly set-asides over future services (C5).
- The reconstruction script and its consented runs (C4); the cutover and «sin Lead»'s retirement (C7).
- The `countsForFairness` field and its writers (C1); the `sundayCadence` setting and its serializer
  (C3).
- Deleting records from the app (the only delete is the reconstruction actor's, reached from C4's
  script — WR-13, WR-14); MCP access to records or the ledger.

## 6. Behaviour and invariants

- **Preserved.** v2's request, rules, history route and `LeadPoolHistoryPanel`; every existing
  writer, its fingerprints and its tests; CDMX dates; drafts-count semantics for prior months;
  `computeParticipation` and the sidebar; ADR-0029 (the record snapshots Tipo × pools × rules; it is
  not a second eligibility axis).
- **Security and privacy.** Writes: admin and super-admin only; reads of the ledger: the same gate.
  The record holds member ids, display names, eligibility and a month's unavailable dates — a
  snapshot that can preserve a date a member later deletes. Its dotted id (A2) keeps it out of
  unauthenticated reads of the dataset; the token-carrying readers (C2's reader, the executor, C4's
  script, Studio's own session) are the only way in, and each fails closed without its token
  (RD-2, WR-16) so a missing token can never pass for an empty past (F3).
  **Key hygiene — config rule ids are private identifiers.** This is C2's application of the
  program-wide key-hygiene rule every solver v3 child follows, clause for clause. Its premise is §3's
  evidence: production's presence rule, all five conflicts, three of the eight restrictions and one of
  the five caps carry seed strings spelling first names (`_key` = `id`), and editing a presence rule
  keeps its id (RES-6); only the planner's `uid()` ids, of any kind, are opaque. A `ruleKey`, a
  `P:<ruleKey>` line key, a presence note's `ruleKey`, an IF2-15 issue's `ruleKey`, and any
  `solverConfig` restriction, cap, conflict or presence `id`/`_key` are handled like a member name:
  (a) **output that can leave a private file** — stdout, stderr, server and Cloud logs, CI logs,
  tracked files, PR text, public aggregates — names a rule, or an IF2-15 refusal or issue, by its kind,
  its ordinal in the config array it comes from and its reason code, never by the raw key or `person`
  (an IF2-15 refusal's `person` is a name and falls under the same rule);
  (b) **where the raw key may appear** — only in the record, the manager-gated GET and its UI, a
  resolver or PUT answer returned to a manager, private reports and `--out` files outside the
  repository, and the golden fixture (fictitious ids, FX-5);
  (c) **logs carry no contents** — no C2 code writes a key, or any other record or request content
  (member ids, names, line keys), to a server log, stdout or stderr: RD-2's one server log line carries
  a parser refusal whose issue paths are index-based and whose messages carry no stored value (IF2-18's
  issue format), and RD-4 logs nothing of a request or a payload;
  (d) **no re-keying** — C2 never re-keys production config (RES-6: it would split a rule's line
  across months).
  **(a)'s program rule also admits a short SHA-256 hex prefix of the key; C2 does not use that arm and
  asks its consumers not to.** A seed key is a short, guessable string and the hash is unsalted —
  REC-4's `presence[]._key` is itself 24 hex of SHA-256(`ruleKey`) — so a dictionary of first names
  reverses any prefix. C4 (D5 and R12: no rule key «nor a SHA-256 hex prefix of one» on stdout) and C7
  (K10: «never a hash») exclude it for the same reason.
- **Failure.** GET: fail closed (RD-2). PUT: all-or-nothing (WR-9); every refusal is typed; a
  refused «Registrar» leaves its dialog open. A malformed stored record blocks the ledger rather than
  silently changing balances. **No code path in C2 or C4 repairs every such record:** the route
  cannot (the GET fails closed, so «Registrar» has no `rev` to assert, and WR-8 never replaces a
  past or frozen month); the reconstruction actor can replace or delete only a record it wrote
  that is still intact (WR-14 rows 5–6, D2–D3), so a route-written record, or any record edited
  after it was written, is out of its reach. Repairing one of those is a **separate consented
  script, reviewed on its own** (dry-run first, `--apply` with Frank's consent, its own audit entry
  and caller-pin row) — the same rule §14 states for a deletion after a revert. Since Studio denies
  every mutation of the type (REC-8) and the executor writes only validated, named bodies (WR-16,
  WR-17), a malformed record needs a write outside every app and script path.
- **Concurrency.** Create by collision; replace by `ifRevisionId`; a concurrent writer is refused,
  never discarded (L3); the freezing-services residual race is stated in §4.2.
- **Determinism.** Same records, services, members, query (`month`, `horizon`) and current month (CDMX)
  → byte-identical GET payload on one deployment; `currentMonth` is the only clock-derived input.

## 7. Interfaces

**This section is the single source of every interface C2 provides** — types, function signatures,
route request and response shapes, refusal and issue codes, read builders, the write executor's
contract and call sites, the golden fixture's schema and the display formatter. Each item carries a
stable ID, `IF2-1` … `IF2-29` (index in §7.2). **Siblings cite these IDs** («C2 IF2-22») **and never
restate** a shape, a signature, a code list or a schema — not even «verbatim»: review rounds kept
finding drift between C2's interfaces and the copies siblings kept of them, and this section exists
so that no copy is needed. A sibling that must point its reader at one field names the ID and the
field («IF2-8 `horizon[].recordBinds`»); its own obligations (what it sends, refuses, shows or
tests) stay in its own text. §4's rows state behaviour and cite these IDs for shapes; if a §4 row and
an item here ever disagree on a shape, the item wins and the row is a C2 defect. IDs are never
renumbered or reused (a withdrawn item keeps its ID, marked withdrawn). Names marked «working name»
may be renamed by C2's plan only together with every sibling that cites the item; the ID survives a
rename. The TypeScript is normative for names and shapes, and its comments are part of the contract.

### 7.1 Consumed

C2 keeps these copies of its suppliers' interfaces as read on 2026-10-05; the supplier's own section
wins on any difference.

| From | What C2 relies on | Exact shape |
|---|---|---|
| C1 | The per-service toggle, its read rule, and the engine constant (copied from C1 §9) | Stored field `countsForFairness?: boolean` on `sunday_role`, `saturday_role`, `special_role` (explicit on every document created after C1, absent on legacy ones until a post-C1 stored-mode save writes their effective value (C1-D5), never `null`; a stored value can change after the fact). Neutral `app/utils/countsForFairness.ts`: `COUNTS_FOR_FAIRNESS_GROQ` (the string `coalesce(countsForFairness, _type != "special_role")`), `countsForFairnessDefault(roleType: "sunday_role" \| "saturday_role" \| "special_role"): boolean`, `countsForFairness(doc: { _type: string; countsForFairness?: boolean \| null }): boolean`. The ledger's queries use the GROQ string and its code and fixture builder use `countsForFairness(doc)` — no third copy. `ROLE_PROJECTION` does not carry the field, so C2's reads use their own projection. `app/components/admin/solverEngine.ts`: `export const SOLVER_ENGINE: "v2" \| "v3" = "v2"`, nothing else (A1). Services of months before the current one cannot be toggled from any app surface (A25) (client-side, C1 §6.0/C1-D7; a hand-built admin request or a date move can still change a past month's counted set) — so the ledger reads every flag live (LG-2) and never treats a past month's counted set as frozen |
| C3 | The cadence setting and the exactly-one name resolver (copied from C3 §7 items 1, 2, 4) | `sundayCadence?: "alternate"` on a `solverConfig` restriction (`PersonRestriction.sundayCadence`), keyed by `person` (name or alias); absent = «Normal». From `app/utils/sundayCadence.ts` (neutral, no I/O): `type RosterMember = { _id: string; member_name: string; alias?: string; memberType?: string[]; ministries?: unknown }` (`ministries` is the stored value as read; absent or empty means worship); `type NameRefusal = { person: string; reason: "unresolved" \| "ambiguous"; matches: string[] }`; `resolveRulePersonId(person: string, roster: RosterMember[]) → { ok: true; id: string } \| { ok: false; reason: "unresolved" \| "ambiguous"; matches: string[] }` (matches: ids, sorted); `cadenceMembers(config: Pick<SolverConfig, "restrictions">, roster: RosterMember[]) → { ids: string[]; refusals: NameRefusal[] }` (ids unique and sorted; one refusal per distinct person text). C3 §7 item 4 has a third function, `cadenceOutsideSundayPool`, which C2 does not consume (it is C3's panel warning). All three first drop every roster member for whom `normalizeMinistries(m.ministries).includes("worship")` is false, so `roster` may be any superset of the worship roster that carries each member's stored `ministries` (C3's caller obligation: pass the field as read). C2 hands the two it consumes the roster RES-5 has already filtered — filtering drops members, never a field, so every member handed on keeps its `ministries` unstripped and C3's own filter stays effective, a no-op on that roster. C2 uses them for every name (RES-7), refuses on any refusal naming each `person`, and stores the setting by member id, never the state (C3's obligation on C2) |
| Existing | Rules and pools | `SolverConfig` (`plannerModel.ts:248-294`): `sundayLeads`, `saturdayLeads`, `support` (ids); `restrictions[]` (`excludedPatterns`, `fairness`, `weekExclusions`, `caps[] { pattern, op, value, relative, relOffset }` — `RestrictionCap`, `plannerModel.ts:255`); `conflicts[] { personA, personB, pattern }`; `presence[] { id, persons, pattern }` |

### 7.2 Provided — index

| ID | Item | Where | Behaviour rules | Consumers |
|---|---|---|---|---|
| IF2-1 | Vocabulary: `RoleKey` and the canonical role order, `LineKey`, `TabKey`, `Status`, `SetAsideReason`, the role → line map, units and sign | neutral types, client-importable (module: the plan's) | §4 vocabulary, LG-4, LG-13, LG-14 | C4, C5, C6 |
| IF2-2 | The stored document `fairnessMonth` | Content Lake; constructed only by the write-request module | REC-1–REC-8 | C4, C7 |
| IF2-3 | `LogicalRecord` | GET, fixture, parser output | RD-3, IF2-20 | C4, C6 |
| IF2-4 | `PUT /api/admin/fairness/months` — request | route | WR-2–WR-4, WR-15 | C6 |
| IF2-5 | PUT — responses | route | WR-5, WR-9, WR-11, WR-12 | C6 |
| IF2-6 | Write refusal codes (PUT `details.detail`, executor `refused`) | route, executor | WR-5, WR-6, WR-8, WR-10, WR-11, WR-14, WR-17 | C4, C6 |
| IF2-7 | `GET /api/admin/fairness` — request, gate, statuses, failure body | route | RD-2, RD-4 | C6, C7 |
| IF2-8 | `FairnessLedgerResponse`, `Figures`, `RecordSummary` | GET 200 | RD-3, RD-5, LG-13–LG-15 | C4 (through IF2-10), C5 (the shapes its figures mirror), C6, C7 |
| IF2-9 | `Note` — the closed set | GET, ledger | LG-15, §8 | C4, C6 |
| IF2-10 | The ledger's entry point, `LedgerInput`, `LedgerService` | `app/utils/fairnessLedger.ts` | LG-1–LG-17 | C4, C6 (`LedgerService` as IF2-11's input shape, ST-6's test only) |
| IF2-11 | The seat-keeping step (record-free) | `app/utils/fairnessLedger.ts` | LG-1, LG-2, LG-4 | C4, C6 (ST-6's test only) |
| IF2-12 | `cadenceStates` (X1) | `app/utils/fairnessLedger.ts` | CAD-1–CAD-3 | C5 (through C6), C6 |
| IF2-13 | The display formatter | neutral, client-callable | LG-13, UI-4 | C4, C6 |
| IF2-14 | The effective-engine resolver | server-imported only | EN-1–EN-3 | C6, C7 |
| IF2-15 | `resolveMonthEligibility` | neutral, client-callable — never the write-request module | RES-1–RES-8 | C4, C6, C7 |
| IF2-16 | `rolesOfPatternV3` | `app/components/admin/plannerModel.ts` | RES-2 | C5 (through C6), C6 |
| IF2-17 | `capValueForMonth` | beside IF2-16 | RES-3 | C5 (through C6), C6 |
| IF2-18 | `Actor`, `validateFairnessMonthWrite` | write-request module | WR-3, WR-4, WR-17, RES-8 | C4 |
| IF2-19 | `contentHashOfWrite`, `contentHashOfStored` | write-request module | REC-6 | C4, C6 (CF-3's round-trip test) |
| IF2-20 | The stored-record parser | write-request module | RD-2, REC-7 | C4 |
| IF2-21 | The write decision | write-request module | WR-8, WR-14 | C4 |
| IF2-22 | The write executor | write-request module | WR-7, WR-9–WR-11, WR-14, WR-16 | C4 |
| IF2-23 | The executor's call sites and guard registrations | guard registries | REC-9, WR-1, WR-16, GU-1, GU-5 | C4, C7 |
| IF2-24 | The freezing-services count builder | `app/utils/serviceReadQueries.ts` | §4 vocabulary, WR-7, RD-1 | C4, C6 (through IF2-8) |
| IF2-25 | The record read builder | `app/utils/serviceReadQueries.ts` | RD-1 | C4 |
| IF2-26 | The voice-role range builder | `app/utils/serviceReadQueries.ts` | RD-1, LG-1, LG-2 | C4 |
| IF2-27 | The worship roster builder | `app/utils/serviceReadQueries.ts` | RD-6 (a), RES-5 | C4, C7 |
| IF2-28 | The rule-set builder | `app/utils/serviceReadQueries.ts` | RD-6 (b) | C4, C7 |
| IF2-29 | The golden fixture's schema | `fixtures/fairness/golden.json` | FX-1–FX-5 | C0, C5 |

### 7.3 Provided — definitions

**Data shapes.**

```ts
// IF2-1 — Vocabulary. Neutral types, client-importable (no node:crypto); the module is the plan's.
type RoleKey = "Sun.Lead" | "Sat.Lead" | "Sun.BGV" | "Sat.BGV" | "Sun.Choir" | "Sat.Choir";
//   Canonical role order = the order above; restricted to v2's five keys it is rolesOfPattern's ROLE_ORDER
//   (plannerModel.ts:613). Every role-key list the record, the hash (REC-6), the expansion (IF2-16) and the
//   wire carry is in this order.
type LineKey = "DL" | "SL" | "BGV" | "CORO" | `P:${string}`;          // P:<ruleKey>
type TabKey = "DL" | "SL" | "BGV" | "CORO" | "TOTAL";                 // display tabs (LG-14)
type Status = "in" | "out" | "exact";
type SetAsideReason = "second_seat" | "exact" | "cadence" | "not_in_record" | "outside_population" | "floor";
// Role key → line (§4 vocabulary): Sun.Lead → DL; Sat.Lead → SL; Sun.BGV, Sat.BGV → BGV; Sun.Choir, Sat.Choir → CORO;
// one sub-line P:<ruleKey> per presence rule. Tabs (LG-14): DL, SL and CORO are their line; BGV = BGV + every P:*;
// TOTAL = every line. Seat → role key, a counted special's by day class: LG-4.
// Units and sign: every fairness figure (share, received, balance) is integer hundredths of a seat, positive = owed
// («le deben»); received = 100 × the seats counted; balance = share − received (LG-13). Display tenths and seat
// counts are separate fields (IF2-8), never fairness figures and never fed to a computation.

// IF2-2 — The stored document. REC-1–REC-5 state each field's derivation and constraint; this is its field list
// (pinned by INTERNAL_STUDIO_FIELDS, REC-8). Only the write-request module constructs one (IF2-22); C4 and every
// other sibling never build an id, key or hash.
interface StoredFairnessMonth {
  _id: string;                       // "fairnessMonth.YYYY-MM" (A2: dotted, so private)
  _type: "fairnessMonth";
  _rev: string; _createdAt: string; _updatedAt: string;                 // system fields
  schemaVersion: 1;
  month: string;                     // "YYYY-MM", equal to the id's month
  source: "auto" | "manual" | "reconstructed";
  engine: "v2" | "v3";
  environment: "production" | "preview" | "local";
  recordedAt: string;                // ISO-8601, server clock
  recordedBy: string;                // the session's effective member _id (route) or the script's fixed marker (reconstruction)
  contentHash: string;               // "sha256:" + hex (REC-6)
  people: Array<{                    // at most one per member
    _key: string;                    // "p" + the first 24 hex of SHA-256(member _id)
    _type: "fairnessPerson";
    member: { _type: "reference"; _ref: string; _weak: true };
    name: string;                    // display only, read by the executor at write time (WR-16)
    roles: { sunLead: Status; satLead: Status; sunBgv: Status; satBgv: Status; sunChoir: Status; satChoir: Status };
    exactRules: Array<{ _key: string;                // "x" + 24 hex of SHA-256 of its canonical role list
                        _type: "fairnessExactRule"; roles: RoleKey[]; count: number }>;
    sundayCadence?: "alternate";
    exempt: boolean;
    blocks: Array<{ _key: string;                    // "d" + YYYYMMDD
                    _type: "fairnessBlock"; date: string; unavailable: boolean; excludedRoles: RoleKey[] }>;
  }>;
  presence: Array<{ _key: string;                    // "r" + 24 hex of SHA-256(ruleKey)
                    _type: "fairnessPresence"; ruleKey: string; roles: RoleKey[]; members: string[]; exclusive: boolean }>;
}
// Never stored (REC-5): seats served, balances, shares, the cadence state, rule strings, names inside `presence`,
// a `published` field.

// IF2-3 — The logical record: GET horizon[].record (IF2-8), fixture records (IF2-29) and the parser's output (IF2-20).
// From a stored document: rev = _rev; each people item = { memberId: member._ref, roles: the six stored fields as
// Record<RoleKey, Status>, exactRules, sundayCadence?, exempt, blocks, name } without `_key`/`_type`; presence
// items without `_key`/`_type`. recordedBy, schemaVersion and the system fields are not carried.
interface LogicalRecord {
  month: string; rev: string; contentHash: string;
  source: "auto" | "manual" | "reconstructed"; engine: "v2" | "v3";
  environment: "production" | "preview" | "local"; recordedAt: string;
  people: Array<FairnessMonthWrite["people"][number] & { name: string }>;
  presence: FairnessMonthWrite["presence"];
}
```

**The writer's route.**

```ts
// IF2-4 — PUT /api/admin/fairness/months — request. admin and super-admin only (WR-2). Body rules: WR-3 (strict),
// WR-4 (limits), REC-3/REC-4 (consistency), A11, A38; WR-15 says which revision to assert. Never carries names,
// keys, hashes or stamps.
interface FairnessMonthsPut { months: FairnessMonthWrite[] }            // 1–2, consecutive, ascending
interface FairnessMonthWrite {
  month: string;                                                        // "YYYY-MM"
  source: "auto" | "manual";
  expectedRev: string | null;                                           // rev read with the eligibility (WR-15)
  people: Array<{
    memberId: string;
    roles: Record<RoleKey, Status>;                                     // all six
    exactRules: Array<{ roles: RoleKey[]; count: number }>;
    sundayCadence?: "alternate";
    exempt: boolean;
    blocks: Array<{ date: string; unavailable: boolean; excludedRoles: RoleKey[] }>;
  }>;
  presence: Array<{ ruleKey: string; roles: RoleKey[]; members: string[]; exclusive: boolean }>;
}

// IF2-5 — PUT — responses.
// 200 (WR-12):
interface FairnessMonthsPutOk {
  months: Array<{ month: string; outcome: "created" | "replaced" | "unchanged";
                  rev: string;                // the stored revision after the write; the existing one for "unchanged"
                  contentHash: string; recordedAt: string }>;
}
// Every refusal is a serviceError body (ServiceErrorBody, serviceMutation.ts:106-113: { error, message, conflict,
// details? }) — clients branch on `details.detail`, never on `message`.
// 400: error "invalid_request", details.issues naming each violated path (WR-3, WR-4, WR-17; IF2-18's issues).
// 403: error "forbidden" (content-editor, WR-2). No session or an inactive member: what requireActiveManager()
//      answers today, unchanged.
// 409: conflict: true. `error` is "integrity_conflict" for the member_unknown, member_not_worship and tipo_mismatch
//      details (WR-5); for every other detail, new SERVICE_CONFLICT_CODES entries or existing codes are the plan's
//      choice (WR-12).
interface FairnessMonthsPutConflictDetails {
  detail: FairnessPutRefusal;                                           // IF2-6
  months: Array<{ month: string; verdict: "create" | "replace" | "unchanged" | FairnessPutRefusal }>;
  //   Every month of the request, nothing written (WR-9). Refused at decision time or by WR-5: each month's own
//   verdict, and `detail` is the earliest refused month's verdict (entries are ascending).
  //   Refused by the commit (WR-9–WR-11): every month that had a write in the transaction carries the one mapped
  //   verdict (record_exists for already_exists, stale_revision otherwise), each unchanged month "unchanged", and
  //   `detail` is that verdict.
  cause?: "commit_conflict";                                            // sanityConflictKind "conflict" (WR-11)
  rev?: string; source?: LogicalRecord["source"]; recordedAt?: string;  // detail record_exists at decision time (WR-8 row 5)
  memberIds?: string[];                                                 // member_* and tipo_mismatch: the ids (WR-5) — working name
}
// 500: a thrown error (a failed read; an error sanityConflictKind answers null for — WR-11): opaque.

// IF2-6 — Write refusal codes: one registry for the PUT's details.detail and the executor's `refused` (table below).
type FairnessPutRefusal =
  | "record_exists" | "record_missing" | "stale_revision" | "month_has_services" | "past_month"
  | "engine_not_v3" | "member_unknown" | "member_not_worship" | "tipo_mismatch";
type FairnessWriteRefusal =
  | FairnessPutRefusal
  | "not_past_month" | "not_reconstruction_owned" | "record_edited"   // actor "reconstruction" only (WR-14)
  | "invalid_body";                                                    // either actor (WR-17); the route answers it as 400
```

| Code | Actor `route` (PUT) | Actor `reconstruction` | §8 copy |
|---|---|---|---|
| `record_exists` | WR-8 row 5; a commit's `already_exists` (WR-10) | a commit's `already_exists` | `record_exists` |
| `record_missing` | WR-8 row 4 | WR-14 row 4, D1 | `stale_revision`/`record_missing` |
| `stale_revision` | WR-8 row 6; a commit's `revision_mismatch` or `conflict` (WR-11; `cause: "commit_conflict"` for the latter) | WR-14 row 7, D4; a commit's `revision_mismatch` or `conflict` | `stale_revision`/`record_missing` |
| `month_has_services` | WR-8 row 7 (A5) | — | `month_has_services` |
| `past_month` | WR-8 row 2 | — | `past_month` |
| `engine_not_v3` | WR-6, before any read | — | `engine_not_v3` |
| `member_unknown` | WR-5 | WR-14 row 9 | `member_*`/`tipo_mismatch` |
| `member_not_worship`, `tipo_mismatch` | WR-5 | — | `member_*`/`tipo_mismatch` |
| `not_past_month` | — | WR-14 row 1 | (C4's) |
| `not_reconstruction_owned` | — | WR-14 row 5, D2 | (C4's) |
| `record_edited` | — | WR-14 row 6, D3 | (C4's) |
| `invalid_body` | 400 `invalid_request` with `details.issues` | the executor's refusal, carrying `issues` | «anything else» |

**The reader's route.**

```ts
// IF2-7 — GET /api/admin/fairness?month=YYYY-MM[&horizon=1|2]   (horizon defaults to 1; RD-4)
// Gate: requireActiveManager, content-editor → 403 (the solver-history gate; it exposes availability, L5).
// 400 invalid_request on a malformed parameter. 200: FairnessLedgerResponse (IF2-8), `Cache-Control: no-store`,
// `dynamic = "force-dynamic"`. 500 on any failure — an absent or empty read token, a rejected read, a non-list
// answer, a stored record IF2-20 refuses (RD-2):
//   { error: "fairness_unavailable", message: "No se pudo leer el saldo de equidad." }   — never a `people` key.
// A month without a record is not a failure (F3, L5). Inside the server, fairnessLedgerRead.ts throws
// FairnessLedgerUnavailableError with that fixed message; no sibling imports the reader.

// IF2-8 — The GET's 200 body (RD-3). Its window, recordsSince, people and diagnostics are IF2-10's output.
interface FairnessLedgerResponse {
  v: 1;
  engine: "v2" | "v3";                         // effective engine of this deployment (EN-2)
  environment: "production" | "preview" | "local";  // this deployment, REC-2's derivation (UI-6's dev warning)
  currentMonth: string;                        // CDMX
  target: string;
  window: Array<{ month: string; record: RecordSummary | null }>;          // 3, oldest first
  recordsSince: string | null;                 // earliest recorded month before target
  horizon: Array<{ month: string; record: LogicalRecord | null;
                   storedServices: number;     // freezing services (§4, A5): weekend + counted specials (IF2-24)
                   recordBinds: boolean }>;    // record !== null && storedServices > 0 (A6) — C6 reads this, never re-derives
  people: Array<{
    memberId: string; name: string; exists: boolean;
    // exists: memberId is the `id` of an item of IF2-10's `members` (an existing member document). name: that item's
    // name when exists; otherwise the `name` snapshot (REC-3) of the latest read record listing her, else "" — the
    // panel then shows §8's «Miembro eliminado». Identity is always memberId (LG-16).
    window: Partial<Record<LineKey, Figures>>;
    cumulative: Partial<Record<LineKey, Figures>>;
    tabs: { window: Partial<Record<TabKey, Figures>>;
            cumulative: Partial<Record<TabKey, Figures>> };
    sang: number;                              // «cantó», window — an integer seat count
    exempt: boolean;                           // in the latest recorded window month
    months: Array<{ month: string; recorded: boolean; listed: boolean;
                    lines: Partial<Record<LineKey, Figures>>;
                    held: Partial<Record<RoleKey, number>>;               // all counted voice seats, integer counts
                    setAsides: Array<{ date: string; serviceId: string; roleKey: RoleKey; reason: SetAsideReason }>;
                    notes: Note[] }>;                                     // IF2-9
    countedSundayLeads: string[];              // one entry per counted Sunday-dated service in a window month, recorded
                                               // or not, whose kept seat (LG-4) is Lead; a date may repeat; sorted (CAD-2, S-4)
    firstRecordedIn: Partial<Record<RoleKey, string>>;                  // first month marked "in" (F10; C5 dl_since, A15)
  }>;
  diagnostics: { duplicateTargets: Array<{ type: string; date: string; roleIds: string[] }>;
                 notInRecordSeats: number; unknownMembers: string[] };   // unknownMembers: the memberId of every
                                               // people item with exists false, codepoint-sorted — ids only, never names
}
interface Figures { share: number; received: number; balance: number;   // all hundredths (wire, F14); received = 100 × seats; balance = share − received
                   seats: number;                                       // display: received ÷ 100, an integer seat count («Tuvo»)
                   tenths: { share: number; balance: number } }         // display, rounded once from the exact value (LG-13, A17)
interface RecordSummary { rev: string; source: LogicalRecord["source"]; engine: "v2" | "v3";
                          environment: LogicalRecord["environment"]; recordedAt: string }

// IF2-9 — Notes: LG-15's closed set, one item per note LG-15 emits for a person, month and line; §8 has each copy.
// `line` is present on every note LG-15 emits for one line, absent on a note about the whole month.
type Note = { line?: LineKey } & (
  | { code: "unrecorded_month" } | { code: "not_listed" } | { code: "role_out" }
  | { code: "unavailable"; dates: string[] } | { code: "rule_excluded"; dates: string[] }
  | { code: "exact"; roles: RoleKey[]; count: number } | { code: "exact_clamped"; count: number; available: number }
  | { code: "cadence_set_aside"; dates: string[] } | { code: "cadence_no_sunday_saturday"; dates: string[] }
  | { code: "floor_seat"; date: string; roleKey: RoleKey } | { code: "presence"; ruleKey: string; members: string[] }
  | { code: "outside_population"; dates: string[] } | { code: "second_seat"; dates: string[] } | { code: "exempt" });
```

**The ledger.**

```ts
// IF2-10 — The ledger's entry point (app/utils/fairnessLedger.ts; neutral, LG-16). One pure function (working name):
// RD-1's reader calls it for the GET, C4 calls it for its table and preview, and the golden fixture's `ledger`
// cases (IF2-29) are its input and its expected output. No second implementation of LG-1–LG-17 exists.
interface LedgerService { _id: string; _type: "sunday_role" | "saturday_role" | "special_role";
  date: string;                                // the stored date: `week` on a weekend role, `date` on a special
  time?: string;                               // raw stored field, unvalidated; LG-11 orders it only through compareServiceTime
  published?: boolean; countsForFairness?: boolean;                   // raw field; the ledger applies countsForFairness(doc)
  Lead: string[]; BGVs: string[]; Chorus: string[] }                   // member ids (non-empty `_ref`s), stored order
interface LedgerInput {
  target: string;                              // "YYYY-MM"
  records: LogicalRecord[];                    // IF2-3; months at or after target are ignored (LG-3)
  services: LedgerService[];                   // canonical role documents of every published state (LG-1, LG-3)
  members: Array<{ id: string; name: string; unavailableDates: string[] }>;   // existing member documents; name = alias, else member_name
}
declare function computeFairnessLedger(input: LedgerInput):
  Pick<FairnessLedgerResponse, "window" | "recordsSince" | "people" | "diagnostics">;
// Same input → same output (LG-16); the GET adds v, engine, environment, currentMonth, target and horizon (RD-3).

// IF2-11 — The seat-keeping step (app/utils/fairnessLedger.ts; neutral, record-free; working name). IF2-10 runs
// exactly this before LG-7, C4 runs it for its join months (C4 R5), and C6's ST-6 test asserts that the seat C6
// sends for a counted stored service (mapped to an IF2-10 LedgerService) is the one this keeps: LG-1 (every copy of a weekend type duplicated
// on one stored date dropped and reported), LG-2 (an uncounted service contributes nothing), LG-4 (role key by seat
// array and, at a special, by day class; one kept seat per person per service, Lead > BGV > Choir; every further
// seat of hers there a second seat). It takes no record, member or availability input.
type VoiceSeat = { serviceId: string; date: string; roleKey: RoleKey; memberId: string };
declare function keepVoiceSeats(services: LedgerService[]): {
  kept: VoiceSeat[];                           // at most one per (serviceId, memberId)
  secondSeats: VoiceSeat[];                    // the ledger sets each aside as second_seat (LG-4, LG-9)
  duplicateTargets: Array<{ type: string; date: string; roleIds: string[] }>;   // = IF2-8 diagnostics.duplicateTargets
};                                             // every list sorted by codepoint (LG-16)

// IF2-12 — X1 (CAD-1), neutral, per member (callers key results by member _id).
type CadenceReason = "on" | "not_eligible" | "led_previous_month" | "assumed_led_previous_month" | "no_available_sunday";
declare function cadenceStates(input: {
  ledCountedSundayPreviousMonth: boolean;
  months: Array<{ month: string; eligible: boolean; availableCountedSundays: number }>;  // 1–2
}): Array<{ month: string; state: "on" | "off"; reason: CadenceReason }>;
// Wire (A14, mapped by the caller — C5-5, C6 RQ-4): reason "not_eligible" → "out"; otherwise `state`.
```

**Display and engine.**

```ts
// IF2-13 — The one display formatter (UI-4, A17), neutral. Input is TENTHS computed from the exact value; never hundredths.
declare function formatFairnessTenths(tenths: number): string;          // 8 → "0.8", -13 → "-1.3", es-MX decimal point
declare function saldoWords(balanceTenths: number): string;             // "le deben 0.8" | "0.3 de más" | "al día"

// IF2-14 — The effective-engine resolver (EN-2), pure, server-imported only (no client module calls it). Working name.
declare function resolveSolverEngine(env: Readonly<Record<string, string | undefined>>): "v2" | "v3";
// The ONE reader of OWT_SOLVER_ENGINE under app/** (EN-2); its SECRETS entry is EN-3's; clients learn the engine
// from IF2-8 `engine` or C6's server-resolved prop.
```

**Eligibility.**

```ts
// IF2-15 — The eligibility resolver (RES), neutral and client-callable: it never imports node:crypto and is never in
// the write-request module (the plan picks its file). Working name.
declare function resolveMonthEligibility(input: {
  month: string; config: SolverConfig /* on screen, incl. sundayCadence */;
  members: Array<{ _id: string; member_name: string; alias?: string; memberType?: string[];
                   ministries?: unknown; unavailableDates?: string[] }>;   // any superset of the worship roster, `ministries` as read;
                                                                         // the resolver drops non-worship members first (RES-5)
}): { ok: true; body: Omit<FairnessMonthWrite, "source" | "expectedRev"> }   // always passes the validator (RES-8, A38)
  | { ok: false;
      issues: Array<{ code: "no_people" | "too_many_people" | "too_many_presence"
                          | "presence_rule_id" | "presence_roles" | "presence_members"; ruleKey?: string }>;
      refusals: Array<{ person: string; reason: "unresolved" | "ambiguous" | "no_tipo" | "cadence_and_exact"
                          | "overlapping_exact" | "exact_count_range" | "presence_member_not_listed" }> };
// RES-8: for every month WR-4 accepts, an ok:true body completed with source "auto" and expectedRev null passes
// IF2-18 with actor "route"; every input whose body would not pass answers ok:false instead.

// IF2-16, IF2-17 — The one v3 pattern expansion and per-month count resolution (RES-2, RES-3), neutral, client-callable.
declare function rolesOfPatternV3(pattern: string): RoleKey[];          // [] when unknown; canonical role order (IF2-1)
declare function capValueForMonth(cap: RestrictionCap, month: string):
  | { ok: true; count: number }                 // resolvedCapValue(cap, completeSundaySpine(month).length) — every Sunday of the calendar month
                                                //   (serviceRuleContext.ts:28, neutral) — unchanged: a whole number >= 0
  | { ok: false; reason: "not_whole" | "negative" };
// Output range: ok:true carries a whole number >= 0 (Number.isInteger, so NaN and Infinity are "not_whole"), never
// rounded, truncated or clamped beyond resolvedCapValue's own max(0, ·) for a relative cap. "not_whole": the resolved
// value is fractional or non-finite (a fractional `value`, or a fractional `relOffset` whose result is not clamped to
// 0), checked first; "negative": a fixed cap whose whole `value` is below 0 (a relative cap never is). No upper bound here: RES-3 adds `==` counts above 31 to `exact_count_range`;
// C6 refuses a <=/>= cap whose result is ok:false (§12).
```

**The write-request module** — neutral (no `server-only`, no module-level client), `tsx`-importable,
and **not** client-importable (it hashes with `node:crypto`). Working names; the plan may rename
them only together with C4.

```ts
// IF2-18 — Actor and the body validator (WR-17).
type Actor = "route" | "reconstruction";
declare function validateFairnessMonthWrite(body: unknown, actor: Actor,   // actor decides only WR-4's `source` rule
  currentMonth: string):                                                 // "YYYY-MM", CDMX: WR-4's «at most current month + 12»
  { ok: true; value: FairnessMonthWrite | Omit<FairnessMonthWrite, "source"> } | { ok: false; issues: Array<{ path: string; message: string }> };
// Issue format, shared by IF2-18, IF2-20 and IF2-22's invalid_body (§6 «Key hygiene»): `path` is index-based only — field names and
// array indexes in input order, e.g. "months[1].presence[2].members[0]", "people[3].roles.sunLead" — never a `_key`,
// `ruleKey`, `memberId`, name or any other stored value; `message` is a fixed text per violated rule, carrying no
// stored value either. So an issue may be logged (RD-2) or returned without leaking a private identifier.

// IF2-19 — The content hash (REC-6): two entry points over one serialization.
declare function contentHashOfWrite(month: string, body: Omit<FairnessMonthWrite, "source" | "expectedRev">): string;
declare function contentHashOfStored(doc: unknown): string;             // a stored record is intact iff === doc.contentHash

// IF2-20 — The stored-record parser: RD-2's record-schema check, the one definition. RD-2's reader and C4 both call it.
declare function parseStoredFairnessMonth(doc: unknown):
  | { ok: true; record: LogicalRecord }                                 // mapped as IF2-3 states
  | { ok: false; refusal: "malformed_record"; issues: Array<{ path: string; message: string }> };
// It checks exactly RD-2's record schema against IF2-2 — an unknown schemaVersion, a missing field (REC-7: a listed
// item missing any of its six role fields included), an invalid enum — and nothing more. Intactness is NOT part of
// it: that stays contentHashOfStored(doc) === doc.contentHash (IF2-19), which a caller can compute on a record this
// parser refuses (C4's rollback, C4 R18).

// IF2-21 — The write decision (WR-8 for actor route, WR-14 for actor reconstruction): one pure function, shared by
// the executor and C4's planner so a planned action and the executor's verdict cannot differ (C4 R14).
type FairnessDecision = "create" | "replace" | "unchanged" | "delete" | { refused: FairnessWriteRefusal };
declare function decideFairnessMonth(input: {
  actor: Actor; op: "write" | "delete";                                  // "delete" only with actor "reconstruction"
  month: string; currentMonth: string;                                   // CDMX
  expectedRev: string | null;
  bodyHash: string | null;                                               // IF2-19 of the entry; null for a delete
  stored: { rev: string; source: LogicalRecord["source"]; contentHash: string; intact: boolean } | null;  // WR-7's re-read
  hasFreezingServices: boolean;                                          // WR-7 (IF2-24); read for actor "route" only
}): FairnessDecision;
// WR-8 rows 1–8 and WR-14 rows 1–8 and D1–D4. Not part of it: WR-6's engine gate and IF2-18's validation (before it),
// and the live-member checks on a month decided create or replace (after it, the executor's) — WR-5 for actor
// route, WR-14 row 9's member_unknown for actor reconstruction.

// IF2-22 — The write executor (WR-16): the ONLY mutation path of the type, for both actors.
declare function executeFairnessMonthWrites(input: {
  clients: { read: SanityClient; write: SanityClient };                 // injected; the read-client contract below
  actor: Actor;
  op: "write" | "delete";                                                // "delete" only with actor "reconstruction"
  months: Array<FairnessMonthWrite | Omit<FairnessMonthWrite, "source"> | { month: string; expectedRev: string }>;
                                                                         // route bodies, reconstruction bodies (no `source`), or delete targets
  stamps: { recordedBy: string; now: string; currentMonth: string; environment: "production" | "preview" | "local";
            engine?: "v2" | "v3" };                                      // server/script-derived, never from a body
  // stamps.engine (optional in the type only because actor reconstruction passes none): actor route — REQUIRED, the route passes EN-2's effective engine, which WR-6 has already made
  // "v3"; absent or any other value throws before any read (a programming error, never a refusal). Actor
  // reconstruction — the executor stamps "v2" itself (WR-14, A4), as it stamps source; the script passes nothing,
  // and a passed value other than "v2" throws before any read. op "delete" stores no stamp.
}): Promise<Array<{ month: string;
  verdict: "created" | "replaced" | "unchanged" | "deleted"
         | { refused: FairnessWriteRefusal; issues?: Array<{ path: string; message: string }> };   // issues: invalid_body only
  rev: string | null; contentHash: string | null }>>;                    // actor "route": all-or-nothing (WR-9)
// Read-client contract (WR-16, A2): it throws before any read unless the read client's configuration carries a
// non-empty token, perspective "published" and useCdn false — each set explicitly at creation (an omitted perspective
// reads as undefined from config() and fails).
// Then: IF2-18 on every write entry (with stamps.currentMonth; a delete entry { month, expectedRev } is not a body —
// its month is checked by WR-4's month pattern only); WR-7's fresh state through the read client (actor reconstruction: the record only, no
// freezing-services read); IF2-21; for every month decided create or replace, the listed members (_id, member_name,
// alias, ministries, memberType) through the read client, each item's `name` taken from that read and member_unknown
// for an id with no document (either actor); mutations only through the write client.
// Mutation forms: create = a plain create; replace = WR-11's patch(id).ifRevisionId(expectedRev).set(every field)
// .unset(every stale top-level field); delete = WR-14's one transaction of a revision-asserting no-op patch and
// delete(id); createOrReplace never. Actor route: one transaction for every write of the request; actor
// reconstruction: one guarded transaction per month (C4 R16). Commit errors: already_exists → record_exists;
// revision_mismatch and "conflict" → stale_revision (route: "conflict" adds cause "commit_conflict"); an error
// sanityConflictKind answers null for is thrown.
```

**IF2-23 — The executor's call sites and guard registrations** (REC-9, WR-1, WR-16, GU-1, GU-5).
Two files call or declare the executor in this change, and C4 adds the third; no other module under `app/` or
`scripts/` ever does.

| Site | File | Registration |
|---|---|---|
| Declaration | the write-request module | `PROTECTED_RUNTIME_WRITERS` by exact `file#module` (GU-1); a `protected-write` site by GU-5's executor rule |
| Route caller | `app/utils/fairnessMonthCommit.ts` (`server-only`; its only caller is the PUT route) | `PROTECTED_RUNTIME_WRITERS` by exact `file#module`; `DELIVERY_CAPABLE_IMPORTS`; caller-pin row naming the PUT route (GU-1) |
| Script caller | `scripts/reconstruct-fairness-months.mjs` — C4's CLI file, the only caller outside `app/` (C4 R20) | always a `protected-write` site (GU-5), so **unconditionally** one exact `OPERATOR_TOOLING_ALLOWLIST` entry (`app/utils/protectedReadAudit.ts:367`), added by C4 in its own change; at retirement it moves to `RETIRED_ONE_SHOT_WRITERS` (`:307`), whose test requires the gate in the registered file itself (`protectedReadAudit.test.ts:457-462`) — which is why the call stays in the CLI file (C4 R22) |

- **Importer pin.** The write-request module's row in `PINNED_BEYOND_COMMIT`
  (`serviceCommitCallers.test.ts:54`), whose scan for this module covers `git ls-files app scripts`
  (today `app` only, `:65-69`). Its exact importer list: `app/utils/fairnessMonthCommit.ts`;
  `app/utils/fairnessLedgerRead.ts` (it calls IF2-20); any other `app/` module the plan proves needs
  the validator, the hash or the parser; and — added by C4 in its own change — the CLI file and C4's
  `scripts/lib` core, which imports the module's pure functions (IF2-18–IF2-21) and never calls the
  executor. (IF2-15 is not in this module, so importing it is outside this pin.)
- **Detector registry.** GU-5's `PROTECTED_WRITE_EXECUTORS` (working name) in
  `protectedReadAudit.ts`, holding exactly the executor's name. A file registered for a site that no
  longer calls the executor is a dead entry the suite refuses (`protectedReadAudit.test.ts:531-538`).

**Read builders** — additive, neutral builders in `app/utils/serviceReadQueries.ts`, each returning
the file's `BoundQuery` (`{ query, params }`, `serviceReadQueries.ts:10-13`). No `published` filter
(prior-month drafts count; neither `fairnessMonth`, `teamMembers` nor `solverConfig` is draft-gated)
and no new draft-gating exemption. Canonical documents only. A caller runs them only on a client
carrying the read token, the `published` perspective and no CDN (A2) — the reader on
`operationalClient`, C4 on its own injected client. Working names.

```ts
// IF2-24 — Freezing-services counts per month: the ONE definition of §4's freezing services (A5), used by WR-7,
// RD-1, C4 R1 and, through IF2-8's storedServices, C6. Canonical role documents of every published state;
// specials split by C1's COUNTS_FOR_FAIRNESS_GROQ.
declare function serviceCountsInMonths(months: string[]): BoundQuery;
//   answers Array<{ month: string; weekend: number; countedSpecials: number; uncountedSpecials: number }>;
//   freezing = weekend + countedSpecials. C6 calls a month with freezing > 0 «anchored».

// IF2-25 — Records: every fairnessMonth document with month ≤ lastMonth, answered as stored (IF2-2); every caller
// parses each through IF2-20 before using it.
declare function fairnessMonthsThroughQuery(lastMonth: string): BoundQuery;

// IF2-26 — Voice role documents: sunday_role, saturday_role and special_role whose stored date is in
// [fromDay, toDayExclusive), every published state, each with _id, _type, its stored date (`week` or `date`), time,
// published, the effective counted flag as `countsForFairness` (COUNTS_FOR_FAIRNESS_GROQ — ROLE_PROJECTION does not
// carry it) and the Lead, BGVs and Chorus `_ref`s in stored order. The caller maps each row to LedgerService (IF2-10).
declare function voiceRolesInRangeQuery(fromDay: string, toDayExclusive: string): BoundQuery;

// IF2-27 — The worship roster (RD-6 a): the one server-side definition of RES-5's unfiltered worship roster and of
// C3's RosterMember list for a script. Every canonical teamMembers document matching WORSHIP_AUDIENCE_GROQ_FILTER
// (app/ministries.ts:74; absent or empty `ministries` means worship; no $all arm; never a bare "worship" in ministries),
// with no voz, Tipo, pool or disabled filter.
declare function worshipRosterQuery(): BoundQuery;
//   answers Array<{ _id: string; member_name: string; alias?: string; memberType?: string[]; ministries?: unknown;
//                   unavailableDates?: string[] }>   — exactly these six fields; one the document lacks reads as absent

// IF2-28 — The rule set (RD-6 b): the singleton *[_id == $id][0], $id bound from SOLVER_CONFIG_DOC_ID
// (solverConfigWriteRequest.ts:51, never a second literal).
declare function solverConfigQuery(): BoundQuery;
//   answers the stored document or null. The caller parses it with solverConfigFromDocument
//   (solverConfigWriteRequest.ts:351); null means ABSENT, never the defaults (solver-config/route.ts:79-90).
```

RD-1's read of the members its records and seats reference (`_id`, `member_name`, `alias`,
`unavailableDates`) is the reader's own builder and not a sibling interface.

**The golden fixture.**

```ts
// IF2-29 — fixtures/fairness/golden.json (FX-1–FX-5). `units` applies to every expected figure: share, received
// (100 × seats) and balance (= share − received, LG-13). Display-only seats and tenths are never in the file.
interface GoldenFixture { schemaVersion: 1; units: "hundredths"; sign: "positive_owed"; cases: GoldenCase[] }
type Triple = { share: number; received: number; balance: number };
type GoldenCase = { id: string;                // unique, kebab-case
                    description: string;       // English
                    covers: string[] }         // LG/CAD rule ids and coverage tags (FX-4)
  & ( | { kind: "ledger"; input: LedgerInput;  // IF2-10
          expected: {
            window: Array<{ month: string; recorded: boolean }>;
            months: { [month: string]: { [memberId: string]: Partial<Record<LineKey, Triple>> } };
            windowTotals: { [memberId: string]: Partial<Record<LineKey, Triple>> };
            setAsides: Array<{ serviceId: string; roleKey: RoleKey; memberId: string; reason: SetAsideReason }>;
            notes: Array<{ month: string; memberId: string; note: Note }> } }      // IF2-9
      | { kind: "cadence"; input: Parameters<typeof cadenceStates>[0];            // IF2-12
          expected: ReturnType<typeof cadenceStates> }
      | { kind: "plan"; input: unknown; expected: unknown } );                    // reserved for C5 (FX-3)
// An unknown `kind` fails both suites (FX-3).
```

### 7.4 What each consumer owes

These rows state each consumer's **obligations**; every shape they mention is the cited IF2 item.

| To | Items | Contract |
|---|---|---|
| C4 | IF2-1–IF2-3, IF2-6, IF2-8–IF2-11, IF2-13, IF2-15, IF2-18–IF2-28 | C4 hands IF2-15 the rows of IF2-27, unaltered, as `members`, and IF2-28's document parsed by `solverConfigFromDocument` as `config` (a `null` document refuses its run); it writes no roster, rule, record or role GROQ of its own (IF2-24–IF2-28). A resolver `ok: false` — every refusal and issue of IF2-15 — refuses the run before any plan. C4 imports the write-request module (never `fairnessMonthCommit.ts`) from its `tsx` script with its own injected clients; the read client **must carry the read token, the `published` perspective and `useCdn: false`** — the executor throws otherwise (IF2-22) — and C4's own reads of records check the token first, because an untokened read of dotted ids succeeds with zero rows (A2). Every stored record it reads passes IF2-20 before the ledger, a comparison or a backup uses it (a refusal is a malformed read); its rollback alone may read `_id`, `_rev`, `source` and IF2-19 without the parser. It may **transform** the resolver's body (join bounds narrow it; Frank's overrides may widen a cell or add a `people` item for a worship member the resolver did not list, C4 R8) and passes the result through IF2-18 (with the current CDMX month it already hands IF2-21) before planning it (WR-17); it plans each month with IF2-21; its join months read seats only through IF2-11 and its balances only through IF2-10; it never builds a record, id, key or hash itself. Stamps: `source: "reconstructed"`, `engine: "v2"`, `environment` per REC-2, a fixed script marker as `recordedBy` (WR-14, A4). Its table and preview show one decimal from the ledger's tenths through IF2-13 (A17), never from hundredths. The executor is called **only** from `scripts/reconstruct-fairness-months.mjs`; C4 adds that file's unconditional `OPERATOR_TOOLING_ALLOWLIST` entry and the CLI file and its `scripts/lib` core to the importer pin, in its own change (IF2-23, C4 R20). Dry-run first, consent for `--apply`. Its stdout carries no `ruleKey`, config rule id/`_key` (restriction, cap, conflict or presence — each can be a seed id, §3) or refusal `person` (§6) |
| C5 | IF2-1, IF2-8 (the `Figures`/`tabs` shapes its own figures mirror), IF2-29; IF2-12, IF2-16, IF2-17 through C6 | Python asserts every `ledger` case per month (FX-3) and may add `plan` cases; its test-side adapter selects services and months by LG-1–LG-3 (duplicate weekend targets dropped, the counted flag with its type default, recorded months only, target and later months ignored) and maps seats by LG-4 before resolving populations by LG-5–LG-8; a presence rule's id reaching its logs, stage ids or public aggregates is a private identifier (§6) and is printed by ordinal or not at all; units, sign, line keys and rounding are LG-13's, and the wire `balance` is `share − received` in hundredths in both languages, never the exact balance rounded on its own (LG-13, parent A39; FX-4's exact-half case); one seat per person per service (LG-4): a holder's second seat at one service is set aside `second_seat` before every other rule, so C5's shared formula (§6.3, §6.6) applies the same rule to a `ledger` case's stored arrays, while its requests never carry such a seat (C6 ST-6 sends the kept one, C5 §5.5 refuses two pins for one person at one service); the presence seat is chosen by holder id order on both sides and is never a fixed seat (LG-7, A18); the floor seat is cancelled only by an `exact` or `cadence` seat (LG-11, A12) in both the realised report and the plan; a request's `people` and a record's `people` share the limit 100 (WR-4, C5 §5.1); carried balances arrive through C6 as IF2-8 `window` figures; cadence states arrive through C6 as IF2-12's output mapped to `on`/`off`/`out` (A14). C2 provides no previous-month stored facts beyond `countedSundayLeads` and `firstRecordedIn`: `prior` is C6's (A15, C6 RQ-7) |
| C6 | IF2-1, IF2-3–IF2-9, IF2-12–IF2-17, IF2-19 (round-trip test only), IF2-10's `LedgerService` and IF2-11 (ST-6's test only) | C6 imports IF2-14 and writes no second resolver; its confirm **creates** a record for every recordless horizon month, anchored or not, with `expectedRev: null`, expecting `created` (WR-8 row 3, parent A27 — no «anchored, unrecorded» month is left without one); sends IF2-8 `window[line].balance` as carried balances; derives X1 inputs from `countedSundayLeads` (one entry per seat) and the horizon, mapping IF2-12 to the wire by A14; treats a horizon month as record-bound **iff** IF2-8 `horizon[].recordBinds` (A6), and otherwise builds both S1's per-role eligibility **and** the confirm body from one IF2-15 output — over the planner's on-screen `members` as-is (any superset carrying `ministries`; RES-5 filters by ministry inside the resolver) — so an unbound month that already has a record is sent with `expectedRev` = that record's `rev` as read (WR-15) and answers `replaced` (WR-8 row 8, A6), or `unchanged` if identical; a resolver `ok: false` refuses Auto before the fetch, with one line per refusal and per issue (§8 copy), so an `ok: true` body never becomes a 400 after the solve (RES-8); an `exactRules` item whose roles were trimmed by status (RES-3) may not match an on-screen cap's canonical role set and then takes C6's minted id (C6 RQ-5); builds every count, pair and presence rule's `roles` with IF2-16 and every count `value` with IF2-17 — no other expansion or cap resolution (RQ-5) — and refuses Auto before the fetch, with one line naming the rule, when IF2-17 answers `ok: false` for a `<=`/`>=` cap (an `==` cap reaches C6 only through the resolver's `exactRules`, already in range by RES-3), never rounding or clamping the value; refuses before the fetch a request whose `people` exceed 100; asserts the `rev` it read (WR-15) and branches on IF2-5's `details.detail` (IF2-6); extends the panel into U5, formatting every figure through IF2-13 from tenths (A17): «Queda» and the folded BGV and Total tabs from C5's per-tab `tenths` (A32), «En este plan» and the pins' count from C5's integer seat counts (A39), «Saldo» from IF2-8 `tabs.window`; ST-6's double-seat notice follows LG-4's rule (the kept seat is the first of Lead > BGV > Coro, the other is set aside here), and its test reads seats only through IF2-11: for a counted stored service mapped to an IF2-10 `LedgerService`, the seat C6 sends equals the one IF2-11 keeps — no C6 module reimplements LG-4, and no C6 runtime module calls IF2-10's ledger (its figures arrive through IF2-8). It may show IF2-8's additive `environment`. C2 provides the writer; C6 provides the Auto-confirm call. A rule id it sends C5 that comes from a `ruleKey` or a conflict id (RQ-5) stays a private identifier (§6) wherever C5 echoes it (`violations[].rule`, stage ids) |
| C7 | IF2-14, IF2-15, IF2-27, IF2-28 (rehearsal); IF2-4–IF2-6 and IF2-22/IF2-23 only through «Registrar», C6's confirm or C4's script | C7's rehearsal runs IF2-15 over IF2-27's rows (which project `ministries`) and IF2-28's parsed document, so every count it reports is over the roster after RES-5's worship filter (C3's functions apply the same predicate); records are written only by the PUT (IF2-4 — «Registrar», UI-6, or C6's confirm) or by C4's script through the executor (IF2-22); C7 has no write path of its own. Its stdout, the PR text and the public cutover record never carry a `ruleKey`, a config rule id or a refusal's `person` (§6: production's ids spell first names); a refusal is printed by its ordinal and code |

## 8. Spanish copy

| Where | Copy |
|---|---|
| Disclosure | «Equidad · vista previa» |
| Banner | «Vista previa: Auto todavía no usa este saldo» |
| Subheader | «Saldo de {ago–oct 2026} (3 meses). "Le deben" = le tocaba más de lo que tuvo.» |
| Window chips | «{ago}: registrado» · «{sep}: reconstruido» · «{oct}: sin registro, no cuenta» (a month nobody ran v3 Auto on — at cutover, the current month planned under v2 — until it is reconstructed; parent A21, A27, A37); suffix « · desde dev» (`preview`) or « · local» on a «registrado» chip only (`source` `auto`/`manual`, written through the PUT); a «reconstruido» chip never carries it, because every reconstructed record is stamped `local` by construction (C4 R10: the script runs locally against production, the sanctioned path), so the suffix would say nothing; the stored `environment` stays as stamped |
| Tabs | «Dom Lead» · «Sáb Lead» · «BGV» · «Coro» · «Total» |
| Columns | «Persona» · «Le tocaba» · «Tuvo» · «Saldo (3 meses)» · «Desde {ago 2026}» · «Motivo» · (Total) «Cantó» |
| Saldo | «le deben {0.7}» · «{0.3} de más» · «al día» (tenths 0) — one decimal, decimal point (A17) |
| Out group | «Fuera de esta línea ({n})» |
| Notes | `unrecorded_month` «{mes}: sin registro, no cuenta.» · `not_listed` «No aparece en el registro de {mes}.» · `role_out` «No estaba en la lista de {línea} en {mes}.» · `unavailable` «No disponible {8 y 15 nov}: esas fechas no le cuentan.» · `rule_excluded` «Excluido por regla el {8 nov}.» · `exact` «Regla fija: {Dom Lead} = {2} por mes; esos lugares no se reparten.» · `exact_clamped` «Regla fija de {2}, pero solo estuvo disponible {1} vez en {nov}.» · `cadence_set_aside` «Mes por medio: sus domingos no cuentan en Dom Lead.» · `cadence_no_sunday_saturday` «En {sep} no dirigió domingo; su sábado cuenta en Sáb Lead.» · `floor_seat` «Un lugar de {sep} fue por el mínimo de voz y no cuenta.» · `presence` «Regla de presencia con {Bruno}: ese lugar se reparte entre ellos.» · `outside_population` «{2} lugares fuera de su lista no cuentan.» · `second_seat` «Estaba dos veces en el servicio del {8 nov}: solo cuenta su primer lugar.» · `exempt` «Exenta: no cuenta en Total.» |
| X1 (DL tab, cadence) | «En {nov} le toca domingo (previsto).» · «En {nov} no dirige domingo: ya dirigió el {25 oct}.» · «En {nov} no dirige domingo: no está en la lista de Dom Lead.» · «En {nov} no dirige domingo: ningún domingo disponible.» Copy amended 2026-10-07 (Frank): the cadence state concerns Sunday lead only. Copy only — no contract changed. |
| Footer | «Le tocaba = su parte de los lugares de cada servicio que cuenta para equidad, repartida entre quienes estaban en la lista y disponibles ese día. Los lugares fijos (reglas fijas, mes por medio, mínimo de voz) no se reparten. Lo que a unos se les debe, otros lo tienen de más: la suma siempre da cero.» |
| Total footer | «Total = Dom Lead + Sáb Lead + BGV + Coro. Cantó = todos sus lugares de voz, incluidos los fijos. Instrumentos y FOH no cuentan.» |
| States | «Cargando el saldo de equidad…» · «No se pudo leer el saldo de equidad.» + «Reintentar» · «Todavía no hay meses registrados: el saldo empieza con el primer registro.» |
| Deleted member | A person whose `exists` is false (IF2-8): «{nombre} · ya no está en el equipo»; with an empty `name`, «Miembro eliminado» |
| «Registrar» | Button «Registrar elegibilidad de {noviembre}». Dialog title the same. Body «Se guarda quién está en cada lista de {noviembre}, sus reglas y sus fechas no disponibles, tal como están en pantalla. El saldo de los próximos meses se calcula con este registro.» Unsaved rules «Las reglas tienen cambios sin guardar; se registran tal como están en pantalla.» Replace «Reemplaza el registro guardado el {3 oct}.» Unrecorded month with services «{Noviembre} ya tiene servicios guardados: este será su registro. Mientras tenga servicios no se podrá reemplazar, y la reconstrucción no lo cambiará.» Desde dev (`environment` ≠ `production`) «Estás en {dev / local}: este registro se guarda en los datos reales del equipo y no se puede borrar desde la app.» Buttons «Registrar» · «Cancelar». Success «Registrado ✓» |
| «Registrar» refusals | `record_exists` «Otro administrador registró {noviembre} mientras tanto. Recarga para ver su registro.» · `stale_revision`/`record_missing` «El registro de {noviembre} cambió mientras tanto. Recarga y vuelve a intentar.» · `month_has_services` «{Noviembre} ya tiene servicios guardados: su registro ya no se puede reemplazar.» · `past_month` «{Noviembre} ya pasó: los meses pasados solo se registran con la reconstrucción.» · `engine_not_v3` «Registrar aplica con el nuevo solver. Recarga la página.» · `member_*`/`tipo_mismatch` «Cambió el equipo mientras tanto (un miembro o su Tipo). Recarga y vuelve a intentar.» · resolver «Hay reglas con nombres que no corresponden a una sola persona: {nombres}. Corrígelas antes de registrar.» · `cadence_and_exact` «{Nombre} tiene «Mes por medio» y una regla fija de Dom Lead; quita una de las dos antes de registrar.» · `overlapping_exact` «{Nombre} tiene dos reglas fijas que cubren el mismo rol; deja solo una antes de registrar.» · `exact_count_range` «La regla fija de {Nombre} no da un número entero de 0 a 31 lugares en {noviembre}; corrígela antes de registrar.» · `no_tipo` «{Nombre} está en las reglas pero no tiene Tipo; asígnale uno o corrige la regla.» · `presence_member_not_listed` «{Nombre} está en una regla de presencia pero no canta (su Tipo no incluye voz); corrige la regla o su Tipo.» · issues `presence_members` / `presence_roles` / `presence_rule_id` / `too_many_presence` «Una regla de presencia no se puede registrar (necesita de 2 a 12 personas de voz y al menos un rol; máximo 20 reglas). Revísala antes de registrar.» · `no_people` «No hay nadie con Tipo de voz en el equipo: no hay nada que registrar.» · `too_many_people` «Hay más de 100 personas de voz: el registro no las admite.» · anything else «No se pudo registrar. No se guardó nada; vuelve a intentar.» |

## 9. Decisions

| Decision | Choice | Why | Tradeoffs | Owner |
|---|---|---|---|---|
| Record content beyond L2's list | Also snapshot presence rules, date-scoped rule exclusions and each exact rule's value | F4/F5 cannot be computed for a past month otherwise; reading live config would judge the past against today's rules (the ADR-0046 failure). L2's own «snapshots what the month was solved with» covers them | Larger record; the resolver owns more | parent A3 |
| Six role keys, `Sat.Choir` included; specials by day class | A counted special's seats use the role keys of its day class for both line and population | One rule for line (D14) and population; no special-only status | A `Sun.Lead` exclusion now also keeps a person out of a Sunday special's DL population, while the grid lets them be hand-placed there (their seat is then set aside) | parent A13 |
| Presence and rule exclusions on weekends only | Specials are never bound by them | Grid parity (`serviceRuleContext.ts:56`, `ruleEnforcement.ts:143-147`); presence is a weekly solver rule | C5 must match | parent A13 |
| Floor seat in past months | Criterion on the stored-seat share before floor set-asides; skipped when an `exact` or `cadence` seat met the floor | A12, literally: a fixed seat already satisfies F9, so setting aside a fair-share seat would invent debt; an `outside_population` or `not_in_record` seat is not a fixed seat | A hand-placed seat in an «out» role does not cancel the floor; C5 mirrors the same two reasons (C5-15) | parent A12, A33 |
| Exact arithmetic; one decimal on screen | Rationals; hundredths once for the wire; the panel's tenths computed once from the same exact value and carried by the GET beside the hundredths | A17 asks for one decimal «computed once from the exact value»; the exact value exists only on the server, and tenths from hundredths would round twice | The GET carries two figures per value; C5 gives its plan figures the same treatment (C5-8), and «Queda» may differ from «Saldo» by 0.1 at a tie (A32) | parent A17; carrying tenths on the GET is this spec's |
| Malformed stored record | The ledger fails closed | A guessed balance would steer the solver silently | One bad record blocks the panel and (later) Auto until repaired by a separate consented script reviewed on its own (§6 «Failure»: no C2 or C4 path repairs a route-written or edited record) | this spec |
| 1–2 months per PUT, one transaction | All or nothing | A two-month confirm must not leave month 1 recorded and month 2 not | One refused month refuses both | this spec |
| No-op first | Identical content is 200 `unchanged` before the past-month, revision and services checks | A lost-response retry must succeed even across a month boundary; it writes nothing | An identical replay keeps the original stamps | this spec |
| Strict body | Unknown fields and stamps refused | A client must never believe it set something the server ignored | A stale tab must reload after a body change | this spec |
| `fairnessMonth` in `PROTECTED_TYPES`, plus the executor rule | Yes, and the audit gains GU-5's executor rule | A literal-named read or write of the type is visible to the existing scan; the one real writer mutates through an injected client, which that scan cannot see, so the executor's declaration and every call to it become `protected-write` sites — that is what keeps ADR-0043's `PROTECTED_RUNTIME_WRITERS` entry for `fairnessMonthCommit` from being a dead entry. Rejected: «the audit guards reads only, the caller pin guards writes» — it would leave a critical writer invisible to the audit and break ADR-0043's three-item rule | One more detection rule to maintain; the injected-client blind spot remains for a writer that calls no registered executor (REC-9 states it; WR-16, the caller pin and review cover it). C4 owes an audit entry when flagged | this spec |
| Engine resolver here, constant in C1 | The pure resolver, the `OWT_SOLVER_ENGINE` SECRETS entry and the PUT gate; C1's constant consumed unchanged | «Registrar» and the PUT need the effective engine before C6 exists | Moves part of E2 earlier | parent A1 |
| The resolver checks the branch ref in code | `VERCEL_ENV === "preview"` and `VERCEL_GIT_COMMIT_REF === "preview"`, or `VERCEL_ENV` unset/empty; `development` is not «unset» | A1 forbids `verify/service-readiness`, which is also `VERCEL_ENV=preview`; Vercel scoping alone fails open on a mis-scoped variable | `vercel dev` (`VERCEL_ENV=development`) cannot use the override | this spec |
| Panel as a closed disclosure, loaded on open | Yes | No load or clutter for admins who do not open it | One click to see it | this spec |
| A person in two voice seats of one stored service | One seat per person per service: the first in Lead > BGV > Choir is hers, every other is set aside `second_seat` before any other rule (LG-4) | C5 holds one seat per person per service as a hard rule and C6 sends only the kept seat (ST-6), so counting both would make «Queda» and the next ledger read differ; setting the second aside gives the same pool C5 sees | A double seat earns nothing; the panel names it | this spec, with C5 and C6 (cross-check seam) |
| Resolver input the validator would reject | Refuse (`ok: false`, named), never drop or repair silently | Parent A38: the `ok: true` body must pass the validator, and C6 cannot run it client-side; a silent drop would record eligibility the admin never chose | A legacy presence rule with a non-`voz` member or a non-compliant id blocks «Registrar» and v3 Auto until edited | parent A38; the refusal set is this spec's |
| Module name `fairnessMonthCommit.ts` | Kept; it triggers ADR-0043's `DELIVERY_CAPABLE_IMPORTS` pin, so the PUT handler is wrapped in `withVerificationRunContext` although it delivers nothing (GU-1) | Consistent with every other `*Commit` route; a rename outside `*Commit` would make ADR-0043's pin learn a second naming rule | One harmless wrapper | this spec (formerly Parent issue P9, which was never a clause conflict) |

## 10. Assumptions

| Assumption | Impact if false | Validation | Failure response |
|---|---|---|---|
| C1 and C3 are merged before C2's implementation (parent §13) | The ledger cannot read the toggle; the resolver cannot read the cadence | C2 plan entry gate | Wait; never reimplement their rules |
| Records stay small (≤ 12 a year, ≤ 100 people — WR-4, shared with C5's request limit) | GET payload grows | RD payload test at the limits | Paginate the cumulative read in a later change |
| Every stored service date string is its CDMX calendar date | Months misassigned | Existing invariant (CLAUDE.md, `solverHistory.ts:17-19`) | — |
| The stored revision after a transaction is available to the module (transaction id or re-read) | WR-12's `rev` missing | Plan pins the mechanism | Re-read the document after commit, as `solver-config` does |
| Every person named in today's presence rules has a Tipo including `voz`, and every presence rule id matches REC-4's grammar (production's one rule carries a seed id, `solverConfigDefaults.ts:96`'s shape, which does — §3) | «Registrar» and v3 Auto refuse until the rule or the Tipo is edited (RES-6) | C7's rehearsal runs `resolveMonthEligibility` on the real config and roster | Frank edits the rule or the Tipo; nothing is written meanwhile |
| Frank leaves `OWT_SOLVER_ENGINE` unset on Preview until he wants a rehearsal | «Registrar» writes production records from dev earlier than intended | EN-3 entry; release notes | Unset it; records stamped `preview` are identifiable |
| Vercel exposes `VERCEL_ENV` and `VERCEL_GIT_COMMIT_REF` to the runtime on every deployment (the MCP origin and the verification identity already depend on it, `origin.ts:22-33`, `srVerificationIdentity.ts:102`) | On a deployment missing `VERCEL_ENV`, EN-2 would read it as local and honour the override | Existing dependants fail visibly first (MCP refuses every host) | EN-3 keeps `OWT_SOLVER_ENGINE` off Production, so there is nothing to honour; the record's `environment` would read `local`, which is identifiable |

## 11. Open questions

| Question | Why it matters | Recommendation and why | Tradeoffs | Owner | Blocking? | Resolution point | Bounded default |
|---|---|---|---|---|---|---|---|
| Q1. Should a person named in a rule but ticked in no pool stay BGV/Choir-eligible under v3, as v2's `extraSupport` makes them? | Who accrues BGV/Coro shares | No: under v3 only pools and Tipo grant eligibility (ADR-0029); v2 injected them only because its solver demanded every rule name be in a pool | A rule-only person stops being schedulable for BGV/Coro under v3 unless ticked in a pool | Frank | No (inert until C6/C7) | C6 spec | RES-1 as written |

The earlier Q2 (should uncounted specials freeze a record?) is answered by parent A5: they do not.

## 12. Parent issues

None open. The earlier P1–P8 and P10–P13 were resolved by A1–A26 (P1 by A2, P2 by A3, P3 by A1, P4
by A12, P5 by A13, P6 by A6, P7 by A5, P8 by A14, P10 by A7, P11 by A18, P12 and P13 by A4). The
last three are settled too: P14 by C5-8 (C5 now emits per-line and per-tab tenths rounded once from
its exact values) with A32 (accepting a 0.1 gap between «Queda» and «Saldo» at a tie) and A39
(integer seat counts); P15 by A33 (only an exact or cadence seat cancels the floor — LG-11 already
said so); P9 was never a clause conflict and is now a decision in §9. Their IDs are not reused.

### Sibling changes this spec depends on (not made here)

Sibling lines as re-read on 2026-10-05, after the parent's A27–A40. **Applied by their owners and
removed from this table** (each checked in the sibling's current text): C6's `recordBinds`,
`Figures.tenths`, `Figures.seats` and `cadence_and_exact` (C6 IF-C2, EQ-3, RQ-2); C6's create for an
«anchored, unrecorded» month (CF-1 (iii) and PI-7 are gone), the resolver's typed `issues` and A38's
refusals (RQ-2) and ST-6's double-seat notice; C5's fixture `balance` identity with the exact-half
case (C5-8, §12.1) and the one-seat rule in the realised formula (C5-10, §6.6); C4's actor-taking
validator, its reconstruction body without `source`, its Interfaces 5 formatter parenthetical, and
C2's four asks of C4 (R20's unconditional audit entry, WR-14 row 9's `member_unknown` and the names
read, the read client's perspective and CDN, replace and delete as guarded patches — C4 Interfaces 2,
R14, R19, R20); C3's `no_sunday_lead_tipo` predicate, which now excludes an empty Tipo (C3 §6.7);
C5's third presence-seat condition — π(ρ, s) is not a fixed seat, and a fixed seat is set aside
`exact`/`cadence`, cancels the floor and credits no sub-line (c5:418-427, C5-10 at c5:182); C5's
test-side adapter over LG-1–LG-8 — IF2-11's step (LG-1, LG-2, LG-4), then LG-3's month selection,
then LG-5–LG-8 (c5:548-557, C5-10 at c5:182, the fixture line at c5:1430); C4's «miembro eliminado o
fuera de alabanza» anomaly from the ledger's `diagnostics.unknownMembers` (C4 R13 and its R13
acceptance row: listed by `_id` in the private report, never on stdout). **C5's asks of C2
applied in this revision** (c5:1548-1555): RES-6 now says production's presence id is a seed id that
an edit keeps, not a planner-minted one, and points at §6 «Key hygiene»; FX-3 now states Python's
coverage as LG-1–LG-8 in C5's order.
**Asks of C2 applied in this revision:** C4's «Sibling changes» rows 1–6 — rows 1–2 as RD-6
(IF2-27, IF2-28); row 3 in WR-17's wording; row 4 as RD-2's parser (IF2-20); row 5 as LG-4's
record-free export (IF2-11); row 6 in REC-9, WR-16, GU-5 and IF2-23 (the executor's one call site
outside `app/` is C4's CLI file, with an unconditional `OPERATOR_TOOLING_ALLOWLIST` entry and both
the CLI file and the `scripts/lib` core on the importer pin) — and C1's qualifier on the past-month
rule and on legacy documents (§7.1). C3's two round-2 asks (the `RosterMember` shape with
`ministries`; the resolver handing C3's functions a roster whose `ministries` is intact) were already
met by §7.1 and RES-5, and are now stated there in so many words.

| Sibling | Change | Why |
|---|---|---|
| C6 | **Config rule ids are private identifiers** (§3, §6): production's presence id, every conflict id, three of eight restriction ids and one cap id are seed strings spelling first names (`_key` = `id`); only the planner's `uid()` ids are opaque. C6's UI already renders a rule only through its label map (C6 :435, :492); RQ-5 (a)/(b) should also say that the `P:<ruleKey>`-derived and conflict-derived rule ids it sends, and whatever comes back in `violations[].rule` or a stage id, are never logged, printed or copied into a PR or doc. **Already applied by their owners in the current text, checked 2026-10-05:** C5-17 (c5:189, with §11.2's public stage labels), C4 R12/R13 (c4:434-435: ordinal and reason code on stdout, never a `_key` or `_id`), C7's K10 (c7:39, :122, :315) | Grammar compliance (REC-4) does not make a seed id name-free; the fictitious fixtures cannot show the leak, the real run would |
| C6 | **IF2-17 is now a typed result** (`{ ok: true; count } \| { ok: false; reason: "not_whole" \| "negative" }`, a whole number ≥ 0 when `ok`). RQ-5: a `<=`/`>=` cap whose IF2-17 answers `ok: false` refuses Auto before the fetch with one line naming the rule (by its card label, never its key), never rounded or clamped; RQ-5's «a value below 0 is sent as 0 and noticed» becomes unreachable through IF2-17 (a relative cap is already 0 by `resolvedCapValue`, a fixed negative value is refused), so its notice may key on a relative cap whose count is 0 instead. Its copy table's `exact_count_range` line (c6:574, «pide más de 31 lugares») follows §8's widened meaning: not a whole number from 0 to 31 | Without it, a fractional `<=`/`>=` value reaches C5, whose C5-4 takes an integer `value` — a 400 after the solve, the failure RES-8 rules out for the record |
| C5 | C5-4's «a result below 0 is sent as 0 and noticed by the caller (C6 RQ-5)» (c5:176) now reads against IF2-17's range: a caller never holds a negative or fractional count from IF2-17; C5's own refusal of a negative value stays as the wire's backstop | Wording only; C5's validation is unchanged |
| C5 | **The floor seat's time tie-break follows `compareServiceTime`** (LG-11): the field table's «An absent `time` sorts first» (c5:226) and §6.4's step 3 «service `time` (absent first, then lexical)» (c5:486) both become «present times ascending; an absent `time` after every present one». C5's Python cannot import the TypeScript comparator, so it mirrors its order. The wire types `time` as `"HH:mm"` (C6 RQ-3 omits an invalid one, row below) and no fixture case carries an invalid one (FX-4), so neither the solver nor §6.6's adapter needs an invalid-string branch | CLAUDE.md makes `compareServiceTime` the ONLY time comparator under `app/**` (absent last, invalid read as absent, `app/utils/serviceTime.ts:25-32`); `fairnessLedger.ts` lives under `app/utils/`, so the ledger cannot sort absent first, and a C5 that did would choose a different floor seat than the ledger at a same-date, same-role tie between an untimed weekend seat and a timed counted special — FX-4's new time-tie case catches the drift |
| C6 | RQ-3: a stored service's `time` is sent only when `isServiceTime` holds and is omitted otherwise, so the wire's «absent» equals the ledger's «invalid read as absent» (LG-11) and C5 never refuses a request over a malformed stored `time` | One reading of a stored `time` on both sides of the floor tie-break; today a malformed `time` can only come from outside the app's validated writers |
| C4 | When C4 adds its CLI file to `OPERATOR_TOOLING_ALLOWLIST` (`app/utils/protectedReadAudit.ts:367`, IF2-23), it also refreshes that list's header (`:360-366`), which today says its tools hard-refuse the production project and dataset: C4's script writes production (consented, `--apply`), as the two `requeue-*` entries already listed there do (`:397-412`) | The header would otherwise misdescribe the entry C4 adds; comment-only |
| C4 | IF2-18 now takes the current CDMX month (WR-4's «at most current month + 12»). C4 cites IF2-18 by ID only, so no text changes; its plan passes the same `currentMonth` it hands IF2-21 | Signature only; every month C4 writes is past, so the ceiling never refuses its bodies |
| C4, C5, C6, C7, C0 | **Interface consolidation** (approved by Frank, 2026-10-05). Each restated copy of a C2 interface becomes a citation of its IF2 ID (§7 lead-in); the sibling's own obligations stay. **C4:** «Consumes from C2» items 1–5 (record facts → IF2-2, IF2-3; the module's functions → IF2-18–IF2-22 — note that IF2-15, the resolver, is **not** in the write-request module, which no client may import, although item 2 lists it there; the ledger and the seat step → IF2-10, IF2-11; the builders → IF2-24–IF2-28; the formatter → IF2-13), its restated `RosterMember` (→ C3 §7 item 4, which carries `ministries`), and its header, Interfaces 4's «Owed by C2 — not in RD-1 or §7 today» and «Sibling changes» rows 1–6, now all in C2's text. **C5:** §12.1's restated FX-2 schema → IF2-29; its references to C2's `Figures`, `tabs` and `window` → IF2-8; the line and unit vocabulary → IF2-1. **C6:** IF-C2's type block → IF2-1, IF2-3–IF2-9, IF2-12–IF2-17 (and IF2-19 for CF-3's round-trip test, IF2-10's `LedgerService` and IF2-11 for ST-6's test); the PUT's decision order it paraphrases → WR-8 and IF2-6; the planner passes its on-screen `members` to IF2-15 as-is (any superset carrying `ministries`, RES-5); it may show IF2-8's additive `environment`. **C7:** its C2 consumes row → IF2-6, IF2-8, IF2-14, IF2-15, IF2-27, IF2-28; its rehearsal runs IF2-15 over IF2-27's rows (which project `ministries`) and IF2-28's parsed document. **C0:** its FX-1 citations may name IF2-29. C1 (approved) and C3 restate no C2 shape and need no change | Review rounds kept finding drift between C2's interfaces and the copies siblings keep of them; one definition removes that class of finding |

## 13. Acceptance and verification

| Requirement | Acceptance evidence | Verification method |
|---|---|---|
| REC-1–REC-7 | Stored shape, keys, hash order-independence, a pinned digest | Unit tests of the write-request module; schema test |
| REC-8, REC-9, GU-1, GU-2, GU-5 | Governed type; audit, caller pin, SR scan, draft gating, client boundary green; GU-5's detector fixtures (a)–(e); both `PROTECTED_RUNTIME_WRITERS` entries exercised by real sites (no dead entry) | The existing guard suites, edited only by the additions named |
| WR-1–WR-13, WR-15 | Every decision row; all-or-nothing; create collision; revision mismatch; unknown errors thrown; no side effects; freezing services per A5 (an uncounted special alone does not refuse a replace, a counted one does) and A27 (an unrecorded month with stored services is created); two `exactRules` items of one person sharing a role key refused (`overlapping_exact`, A38); WR-5 skipped on an `unchanged` month; a cadence + exact `Sun.Lead` body refused (A11); a commit 409 of each `sanityConflictKind` (`already_exists`, `revision_mismatch`, `conflict`) mapped, and a two-month transaction's 409 reported on both written months; two months refused with different verdicts give `details.detail` = the earlier month's verdict | Route tests with mocked Sanity (conflict fixtures shaped as `sanityConflictKind` expects); table-driven decision tests |
| WR-14 | Reconstruction write and delete rows, including `not_past_month`, `not_reconstruction_owned` and `record_edited` | Table-driven unit test; route cannot select the actor or `delete` |
| WR-16, WR-17 | One executor issues every mutation; caller pin covers `app/` and `scripts/`, with IF2-23's importer list (`fairnessMonthCommit.ts` and `fairnessLedgerRead.ts` in this change); body validator exported (with the actor's `source` rule and the `currentMonth` ceiling) and re-run by the executor on every write entry, never on a delete entry; the executor throws before any read when its read client has no token, another perspective than `published`, or `useCdn: true`; names read for both actors, `member_unknown` for an id with no member document; replace as WR-11's patch, delete as WR-14's patch-plus-delete transaction, never `createOrReplace` | Executor tests with a fake client's mutation log; extended `serviceCommitCallers.test.ts`; audit test |
| LG-1–LG-17, FX-1–FX-5 | The seat-keeping step (IF2-11) takes no record and, on every `ledger` case, yields exactly the seats the ledger keeps (the ledger calls it); every required fixture case passes, including the second-seat, exact-half and exact-seat-under-presence cases (LG-4, LG-7, A39, A12); sums to zero on exact values; tenths are rounded from the exact value (a figure of exact 0.249 shows «0.2», not «0.3») — a TypeScript unit test of the ledger and formatter, not a fixture case (FX-2's expected values stay hundredths, which Python asserts) | vitest over `fixtures/fairness/golden.json`; Python from C5 on |
| CAD-1–CAD-3 | Every cadence case | vitest |
| RD-1–RD-6 | Fail-closed on each read and on an absent read token (A2); never empty; gate; payload at the limits; `recordBinds` true only with a record and a freezing service; `countedSundayLeads` repeats a date for two Lead seats that day; `environment` per REC-2's derivation; RD-6's two builders evaluated with `groq-js` (worship roster: absent, empty and worship `ministries` in, kids-only and `drafts.` out, six fields; rule set: `null` when absent); the stored-record parser (IF2-20) refuses an unknown `schemaVersion`, each missing required field (one of the six role fields included) and an invalid enum, maps a valid document to `LogicalRecord` as IF2-3 states, and is the function the reader calls; a document it refuses can still be hashed by `contentHashOfStored` | Reader, route, builder and parser tests |
| RES-1–RES-8 | Pools, exclusions, exact (incl. relative and zero), week exclusions incl. the trailing Saturday, presence exclusivity; names: an ambiguous name (one member's `member_name` equal to another's alias) and an unresolved name both refuse, each named; cadence + an `==` rule covering `Sun.Lead` refuses as `cadence_and_exact`; two `==` caps of one member (two spellings) sharing a role key refuse as `overlapping_exact`; a cadence member with an empty Tipo refuses as `no_tipo`; each presence refusal and issue of RES-6; RES-8's generated-input test (`ok: true` ⇒ the validator accepts the completed body; kids-only members, with and without `voz`, never reach the body); RES-5's viewer-independence test (worship-only roster vs. the same plus a kids-only `voz` member ticked in a pool and sharing an alias → deep-equal result); a namesake outside `voz` still makes a name ambiguous; `rolesOfPatternV3` restricted to five keys equals `rolesOfPattern` for every saveable pattern and alias; `capValueForMonth` on a 4- and a 5-Sunday month, and its typed range: `not_whole` for a fractional `value`, a fractional `relOffset` whose result is not clamped, `NaN` and `Infinity`; `negative` for a fixed `-1`; `ok` with 0 for a relative cap clamped by `resolvedCapValue` (fractional `relOffset` included); never a rounded value; `exact_count_range` for an `==` cap of `1.5`, `relOffset` `0.5`, `-1` and `32`, each also when no covered role is `"in"`, and none for 0 (roles `"out"`, no item) or 31 | Unit tests; pattern sync test |
| UI-1–UI-7 | Mounted beside, closed by default, banner, tabs, phone cards, one decimal through the single formatter (grep guard: nothing derives tenths from hundredths), «Registrar» absent under v2, present under v3, replaced by the line when the record binds, the «Desde dev» line when `environment` ≠ `production`, dialog stays open on each refusal; a super-admin's roster with a kids-only `voz` member builds a body without her | Component tests; `cueDialogMount.test.ts`; Preview look via `scripts/dev-verify.ts` (read-only) and Frank's own look |
| EN-1–EN-3 | C1's constant consumed unchanged; the resolver's table: honoured only for an exact value on (`preview`, ref `preview`) or with `VERCEL_ENV` unset/empty; constant on production, on (`preview`, ref `verify/service-readiness`), on `development` and on any other value; one reader of the variable under `app/**`; SECRETS entries (`OWT_SOLVER_ENGINE`, `SANITY_API_READ_TOKEN`) | Unit tests of the resolution; grep guard; doc review |
| GU-3, GU-4 | ADR merged with the change; docs current | Code review (docs-audit checklist) |
| All | `npx tsc --noEmit`, `npm test`, `npx eslint .` with 0 errors | CI `gates` |

## 14. Safe end state, release and rollback

- **Safe end state.** The type, writer, ledger, GET, fixture and preview are live; the effective
  engine is `v2` on every deployment (C1's constant; `OWT_SOLVER_ENGINE` unset on Vercel), so the PUT
  answers `engine_not_v3` and «Registrar» is not rendered;
  records can exist only through C4's consented script. Auto, its request, v2 and every existing
  writer are unchanged.
- **Release.** CLAUDE.md order: branch, gates, fresh code review of the merge range, fix,
  re-verification, merge to `preview` and verify the dev alias, read-only look at the panel on dev,
  PR to `main` behind `gates`, verify the production alias. The plan states whether a Sanity schema
  deploy is needed for the new type.
- **Rollback.** Revert the PR. Nothing reads records except the panel and the GET, so existing
  records become inert data. Removing a reconstructed record is C4's consented script through the
  reconstruction actor's guarded delete (WR-14 D1–D4) — the only deletion path; a record written by
  the route is never deleted by any code path, and reverting C2 removes the executor, so any deletion
  wanted after a revert is a separate consented script reviewed on its own.

## Review handoff

- Review this spec at **critical** tier after the parent, in the parent's order (C0, C1, C3, C2, …).
- Evidence: `owt-agent-logs/sdd/2026-10-05-solver-v3-fairness/evidence/` (`d_ledger.md`,
  `d_persistence-ux.md`, `f_final-proto.md`, `f_final-stress.md`, `u_history-derivation.md`,
  `u_config-rules.md`) and `prototype/v3/final/` — private, contain member data.
- No parent issue is open (§12); the sibling changes of §12 go to their owners. A material change
  to the parent restarts review from the parent.
- Prior planning dialogue excluded from reviewers: yes. Implementation authorization: **not granted
  by this document.**

## Terminal state

`READY_FOR_ADVERSARIAL_REVIEW`
