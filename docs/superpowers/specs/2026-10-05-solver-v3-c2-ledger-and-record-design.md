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
(`APPROVED`, `3dbc189b`), child **C2** of its §11: L2, L3, L5, F2–F7, F14, X1 and U5's read-only
preview. Where this spec and the parent disagree, the parent wins; every gap found is listed in
§12 «Parent issues» with a recommended fix, and this spec follows the parent meanwhile.

**Contracts, not prescriptions.** This document states what must be true and what must never
happen. Helper names, file splits and loop shapes belong to the C2 implementation plan. Existing
files are cited as evidence, with lines verified on this branch.

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
| Studio governance: protected, internal (hidden), internal fields, read-only titles; `solverConfig` is the precedent for a hidden machine document | `app/utils/studioProtection.ts:45-77`, `:160-168`, `:189-228`, `:484-500` | `fairnessMonth` joins all four lists |
| The dataset answers unauthenticated published reads (the read token is optional there). Sanity's own documentation: «Any document ID containing a dot is considered private» — only root-path ids are served without a token. The repo's docs do not rely on this: they call the dotted OAuth documents «safe to be world-readable» on their own merits | `sanity/lib/operationalClient.ts:13-23`; Sanity docs «IDs and paths» (`/docs/content-lake/ids`, checked 2026-10-05); `docs/DATA_MODEL.md:336`, `:653-654`; `app/utils/roleCreationReceipt.ts:235` | A `fairnessMonth-YYYY-MM` id is world-readable; a dotted id would not be, but would vanish silently from any read made without the token — P1 |
| A pure write-request module without `server-only` is imported by both the admin route and an `--apply` script | `app/utils/solverConfigWriteRequest.ts:1-6` | The record's validation, keys, hash and write decision live in one such module, shared with C4 |
| Every `*Commit.ts` module is `server-only` and imports the server write client, so a `tsx` script cannot import one; the caller pin scans `app/` only and also pins named non-`*Commit` modules (`PINNED_BEYOND_COMMIT`) | `app/utils/roleSwapCommit.ts:39-41`; `app/utils/__tests__/serviceCommitCallers.test.ts:44-56`, `:65-69` | The one mutation path both the route and C4's script use is a neutral executor with the client injected, pinned by a scan that also covers `scripts/` (WR-16) |
| `rolesOfPattern` is the ONE five-key pattern map (`Sat.*` → `Sat.Lead`, `Sat.BGV`; no `Sat.Choir`), guarded against the solver by `patternRolesSync.test.ts`; `resolvedCapValue` is the one relative-cap resolution (`max(0, weeks − offset)`); `resolveToMemberName` takes the first match | `app/components/admin/plannerModel.ts:611-655`, `:666-669`, `:572-578`; `app/components/admin/__tests__/patternRolesSync.test.ts`; CLAUDE.md «Reusable utils» | v3's six-key expansion is defined against `rolesOfPattern` and synced to it (RES-2); counts reuse `resolvedCapValue` (RES-3); names resolve through C3's exactly-one resolver, never first-match (RES-7) |
| Config shape: name-keyed restrictions (`excludedPatterns`, `fairness`, `weekExclusions`, `caps` with `op "=="` and relative offsets), `conflicts`, `presence`, id-keyed pools | `app/components/admin/plannerModel.ts:248-294` | The eligibility resolver's inputs |
| Pool fit is `voz` + subtype; the planner re-filters pools by live Tipo and refuses rule persons with no Tipo | `plannerModel.ts:805-811`, `:858-938` | Tipo is the only eligibility axis (ADR-0029); the record snapshots it |
| v2's pool → role map: Sun.Lead = Sunday pool; Sat.Lead = Sunday ∪ Saturday pools; BGV and Choir = everyone in a pool; `Sat.*` covers no chorus | `gcf/owt_solver_v2.py:642-648`, `:210-225` | v3's record mirrors the map, adds `Sat.Choir` for counted non-Sunday specials |
| On the grid, a special is bound only by `*.X` patterns, and week exclusions do not apply to specials | `app/components/admin/ruleEnforcement.ts:143-147`, `:183-193`; `app/components/admin/serviceRuleContext.ts:56` | Rule-based date exclusions apply to weekend services only |
| The «sin Lead» panel is mounted at the config step and in the stored editor | `app/components/admin/MonthGenerator.tsx:1737-1747`, `:4489-4501`; `LeadPoolHistoryPanel.tsx:59-97` | The preview mounts beside it at both, never replacing it |
| Validated policy: balances sum to exactly 0 per service and role on real data; nobody served on a date they had marked unavailable; floor-forced seats under a share of 1 grow an unbounded debt unless set aside; presence members held by a never-together rule must leave the normal population; strict parity left a cadence member 3 months without a Sunday | private `owt-agent-logs/sdd/2026-10-05-solver-v3-fairness/evidence/d_ledger.md` (data facts), `f_final-proto.md` §2a, §8.2, §8.4, `f_final-stress.md` §5 | LG-8, LG-11 and the X1 function encode the amendments the parent adopted |
| Planned vs post-solve shares differ by up to 0.23 seat without pins | `f_final-proto.md` §8.8 | Any TS-vs-Python comparison in C5/C6 needs C5's tolerance; this spec's fixture compares exact stored-seat values, which need none |

## 4. Requirements

Vocabulary used throughout:

- **Role keys** (six): `Sun.Lead`, `Sat.Lead`, `Sun.BGV`, `Sat.BGV`, `Sun.Choir`, `Sat.Choir`.
- **Lines:** `DL` = `Sun.Lead`; `SL` = `Sat.Lead`; `BGV` = `Sun.BGV` + `Sat.BGV`; `CORO` = `Sun.Choir` +
  `Sat.Choir`; one presence sub-line `P:<ruleKey>` per presence rule. **Total** = the sum of a
  person's lines, display only.
- **Units:** hundredths of a seat, integers, on every wire; **positive = owed** («le deben»).
- **Current month:** the `America/Mexico_City` calendar month of the server's "now"
  (`toLocaleDateString("sv", { timeZone: "America/Mexico_City" })`, CLAUDE.md). **Past** = before it.
- **Stored date / month of a service:** the stored `YYYY-MM-DD` string (`week` on weekend roles,
  `date` on specials) and its first seven characters. Never a UTC `Date`.

### 4.1 The record (`fairnessMonth`) — REC

| ID | Requirement | Acceptance |
|---|---|---|
| REC-1 | **Identity.** One document per calendar month: `_type: "fairnessMonth"`, `_id: "fairnessMonth-YYYY-MM"` (the program's canonical name, not the parent's — the parent names no id; see P1), `month: "YYYY-MM"` equal to the id's month. Nothing else may share the id | Schema + write-request tests |
| REC-2 | **Stamps (server-derived, never from a body).** `schemaVersion: 1`; `source: "auto" \| "manual" \| "reconstructed"`; `engine: "v2" \| "v3"`; `environment: "production" \| "preview" \| "local"` from `VERCEL_ENV` (`production`/`preview`; anything else `local`); `recordedAt` (ISO-8601, server clock); `recordedBy` (the session's effective member `_id`, or the script's own marker for C4); `contentHash` (REC-6) | Route test: a body carrying any stamp is refused (WR-3) |
| REC-3 | **People.** `people[]`, at most one item per member. Each item: `_key` = `"p"` + the first 24 hex characters of SHA-256 of the member `_id` (never a raw id: ids may contain dots); `_type: "fairnessPerson"`; `member: { _type: "reference", _ref, _weak: true }` (a deleted member keeps its history); `name` = the member's display name (alias, else `member_name`) read by the server at write time — display only, never an identity; `roles` = an object with exactly the six fields `sunLead`, `satLead`, `sunBgv`, `satBgv`, `sunChoir`, `satChoir` (dotted field names are invalid in Sanity), each `"in" \| "out" \| "exact"`; `exactRules[]` = `{ _key: "x" + 24 hex of SHA-256 of its canonical role list, _type: "fairnessExactRule", roles: RoleKey[], count }` — a role is `"exact"` iff exactly one rule covers it, `count` is the rule's value **resolved for this month** (relative caps against the month's Sundays, ADR-0048's D2), an integer 1–31; `sundayCadence: "alternate"` or absent (the C3 setting, never the on/off state — F7); `exempt: boolean`; `blocks[]` = `{ _key: "d" + YYYYMMDD, _type: "fairnessBlock", date, unavailable: boolean, excludedRoles: RoleKey[] }`, one per date, every date inside the month, at least one of the two non-empty | Schema + write-request tests |
| REC-4 | **Presence snapshot.** `presence[]` = `{ _key: "r" + 24 hex of SHA-256(ruleKey), _type: "fairnessPresence", ruleKey, roles: RoleKey[], members: string[] (member ids, each listed in `people`), exclusive: boolean }`. `ruleKey` is the `solverConfig` presence rule's `id`, matching `^[A-Za-z0-9_-]{1,64}$`. `exclusive` is true iff every pair of members has a conflict rule whose pattern covers every role key of the presence rule (RES-6) | Write-request tests |
| REC-5 | **What it never stores.** Seats served, balances, shares, the cadence state, rule strings, names inside `presence`, a `published` field. Seats stay derived from role documents (ADR-0042) | Schema field list pinned in `INTERNAL_STUDIO_FIELDS` |
| REC-6 | **`contentHash`.** `"sha256:" + hex` over a canonical serialization of `{ schemaVersion, month, people (sorted by member id; roles in the fixed six-key order; exactRules and every role-key list in canonical role order; blocks by date), presence (sorted by ruleKey; members sorted) }` — codepoint order, never `localeCompare`. It excludes `name`, every `_key`, every stamp of REC-2, `_rev` and timestamps. Identical content gives the identical hash in any input order; one changed eligibility, block, rule or flag changes it. The write-request module exports **two** entry points over the one serialization: the hash of a write body, and the hash **recomputed from a stored document** (as read: `_key`s, `name`, `member._ref` and stamps ignored). A stored record is **intact** iff the recomputed hash equals its stored `contentHash` | Unit test pins a known digest, order-independence, and that a body and the document written from it hash identically; a stored document with one field edited is not intact |
| REC-7 | **Absent means out.** A member not listed in a month's record is `"out"` for every role that month, and so is any role field missing from a stored item read by the ledger | LG-5 tests |
| REC-8 | **Studio.** Schema `hidden: true` and `readOnly: true`; the type is in `PROTECTED_STUDIO_TYPES`, `INTERNAL_STUDIO_TYPES`, `INTERNAL_STUDIO_FIELDS` (every field of REC-1–REC-4) and `PROTECTED_STUDIO_TITLES` as «Registros de equidad (solo lectura)»; `studioCapability` denies create, update, delete, publish, unpublish, duplicate, restore and every other mutating capability | `studioProtection.test.ts` passes with the type governed |
| REC-9 | **Audit.** `fairnessMonth` joins `PROTECTED_TYPES` (the exact-list pin changes in the same commit), so every read goes through `operationalClient` and every writer is registered: `app/utils/fairnessMonthCommit.ts#module` in `PROTECTED_RUNTIME_WRITERS`; C4 registers its own script | `protectedReadAudit.test.ts` passes; a new unregistered read or write of the type fails it |

### 4.2 The writer (`PUT /api/admin/fairness/months` → `fairnessMonthCommit.ts`) — WR

| ID | Requirement | Acceptance |
|---|---|---|
| WR-1 | **ADR-0043 shape.** The route authorizes, parses JSON and returns whatever the commit module returns; everything after authorization lives in `app/utils/fairnessMonthCommit.ts` (`import "server-only"`), which returns a `CommitOutcome`. Its only caller is the route (pin row); it imports the server write client itself (never as a parameter) and hands it to the **write executor** (WR-16) with actor `route` — it issues no mutation of its own | `serviceCommitCallers.test.ts`, audit test |
| WR-2 | **Auth.** `requireActiveManager()`, then `content-editor` → 403 — the same gate as `solver-config` and `solver-history`. Only `admin` and `super-admin` write | Route tests for the four roles and no session |
| WR-3 | **Body.** `{ months: FairnessMonthWrite[] }` (§7). 1–2 entries; two must be consecutive and ascending. Unknown fields at any level are refused, as is any server stamp (REC-2), `_key`, `name` or `contentHash` | 400 `invalid_request` with `details.issues` naming each path |
| WR-4 | **Validation limits.** `month` matches `^\d{4}-(0[1-9]\|1[0-2])$` and is at most the current month + 12; `source ∈ {"auto","manual"}`; `expectedRev` is `null` or a non-empty string of at most 64 characters; `people` 1–100 items (C5's request limit, §5.1 — one number for both), unique `memberId`s; `roles` has exactly the six role keys; `exactRules` consistent with `roles` (REC-3), each 1–6 distinct role keys, `count` 1–31; `blocks` at most 31, unique dates inside the month, valid role keys, never both empty; `presence` at most 20, unique `ruleKey`s matching REC-4, 1–6 roles, 2–12 distinct members each listed in `people` | 400 per violated path |
| WR-5 | **Members are canonical and worship.** Every `memberId` resolves, in the published perspective, to a `teamMembers` document whose normalized ministries include worship (`normalizeMinistries`); a role marked `"in"` or `"exact"` fits that member's **current** Tipo (Sun.Lead: `voz` + `sunday_lead`; Sat.Lead: `voz` + `sunday_lead` or `saturday_lead`; BGV and Choir keys: `voz` + any of `sunday_lead`, `saturday_lead`, `support` — `memberFitsPoolSubtype`, `plannerModel.ts:805-811`) | 409 `integrity_conflict` with `details.detail: "member_unknown" \| "member_not_worship" \| "tipo_mismatch"` and the ids |
| WR-6 | **Engine gate.** If the deployment's effective engine (EN-2) is not `v3`, the whole request is refused and nothing is read or written beyond auth | 409, `details.detail: "engine_not_v3"` |
| WR-7 | **Fresh state inside the commit.** For each month the executor (WR-16) reads, through the read client its caller injects — `operationalClient` (published, no CDN) when the caller is `fairnessMonthCommit.ts` — the existing record (`_rev`, `source`, `contentHash`) and whether the month has **stored services**: any canonical `sunday_role`, `saturday_role` or `special_role` document whose stored date falls in the month, published or not, counted or not (parent L3, literal; see P7). Nothing from the client substitutes for these reads | Route tests with mocked reads |
| WR-8 | **Decision, per month, in this order (actor `route`):** (1) a stored record that is **intact** (REC-6) and whose `contentHash` equals the request's → `unchanged` (a non-intact record is never `unchanged`; it falls through to the rows below); (2) month before the current month → refuse `past_month`; (3) no record and `expectedRev === null` → `create`; (4) no record and `expectedRev !== null` → refuse `stale_revision` (`record_missing`); (5) record exists and `expectedRev === null` → refuse `record_exists` (details carry the current `rev`, `source`, `recordedAt`); (6) `expectedRev !== record._rev` → refuse `stale_revision`; (7) the month has stored services → refuse `month_has_services`; (8) otherwise → `replace`. The decision is one pure function in the write-request module — not `server-only` so C4's script can import it, and **never imported by a client module** (it hashes with `node:crypto`; the eligibility resolver is the only client-callable half) — shared with C4 (WR-14) | Table-driven unit test over every row |
| WR-9 | **All or nothing.** If any month is refused, the request is refused as a whole (409, `details.months` lists every month's verdict) and nothing is written. Otherwise every `create` and `replace` is committed in **one** transaction; `unchanged` months add nothing; a request with no writes returns 200 without a transaction | Route tests: mixed verdicts write nothing |
| WR-10 | **Create is a plain create.** The id collision is the cross-request mutex (`roles/route.ts:258-261`); a Content Lake `already_exists` becomes 409 `record_exists`, never an overwrite | Mocked-conflict test |
| WR-11 | **Replace is whole and revision-asserted.** The stored content is replaced entirely under `ifRevisionId(expectedRev)`: no field of the old content survives except `_id`, `_type` and `_createdAt`; `source`, `engine`, `environment`, `recordedAt`, `recordedBy` and `contentHash` are rewritten. A Content Lake `revision_mismatch` becomes 409 `stale_revision`; any error `sanityConflictKind` does not classify is thrown (500), as in `solver-config` | Mocked-conflict and field-survival tests |
| WR-12 | **Response.** 200 `{ months: [{ month, outcome: "created" \| "replaced" \| "unchanged", rev, contentHash, recordedAt }] }`, where `rev` is the stored revision after the write (the existing one for `unchanged`). Refusals use the `serviceError` body; every conflict is 409 with `conflict: true`; `details.detail` is one of `record_exists`, `record_missing`, `stale_revision`, `month_has_services`, `past_month`, `engine_not_v3`, `member_unknown`, `member_not_worship`, `tipo_mismatch`. Whether these become new codes in `SERVICE_CONFLICT_CODES` or details of existing ones is the plan's choice; the client branches on `details.detail` either way | Route tests |
| WR-13 | **No side effects.** No notification, no outbox, no `after()`, no `revalidate*` (no ISR page reads the type — stated in the module header as `solver-config` does). **The only deletion path that exists** is the reconstruction actor's guarded delete (WR-14 rows D1–D4), reached only from C4's consented script; the route, the panel, C6 and every other `app/` surface never delete a record | Grep-level test of the module's imports; a test that the route's actor offers no delete |
| WR-14 | **Reconstruction actor (C4's writer).** The same write-request module exposes the actor `reconstruction`, used only by C4's script. **Write, per month, in this order:** (1) the month is not before the current month → refuse `not_past_month` (parent L3: the reconstruction writes past months; C4 R1 holds the same rule, this is the writer's own check); (2) a stored record that is intact (REC-6) and whose `contentHash` equals the body's → `unchanged`; (3) no record and `expectedRev === null` → `create`; (4) no record and `expectedRev !== null` → refuse `stale_revision` (`record_missing`); (5) record exists with `source !== "reconstructed"` → refuse `not_reconstruction_owned` (never overwrites a record an admin or a v3 writer wrote — L6); (6) the record is **not intact** → refuse `record_edited` (edited after reconstruction — L6 «never overwrites a record Frank edited»); (7) `expectedRev !== record._rev` (including `null`) → refuse `stale_revision`; (8) otherwise `replace`. **Delete, per month:** (D1) no record → refuse `record_missing`; (D2) `source !== "reconstructed"` → refuse `not_reconstruction_owned`; (D3) not intact → refuse `record_edited`; (D4) `expectedRev !== record._rev` → refuse `stale_revision`; otherwise `delete` under `ifRevisionId(expectedRev)`. No stored-services, Tipo or engine restriction applies to this actor, and only it may write `source: "reconstructed"`, write a past month, or delete. Its stamps: `source: "reconstructed"`, `engine: "v2"` (the months it reconstructs were planned under v2 — C4 PI-6), `environment` per REC-2, `recordedBy` a fixed non-member marker naming the script (never a member id). The route can never select it | Table-driven unit test over every write and delete row; the route hard-codes actor `route` |
| WR-15 | **Asserted revision.** A client asserts the revision it **read when it loaded the eligibility it built the request from** (the GET's horizon record, RD-4), never a revision re-read just before the PUT. «Registrar» (UI-6) obeys this; C6's confirm must | UI test: «Registrar» asserts the horizon record `rev` from the GET that populated the panel; on any 409 it re-reads the GET (content and `rev` together) before offering a retry |
| WR-16 | **One write executor, client injected, callers pinned.** Every mutation of a `fairnessMonth` document — create, replace, delete — is issued by **one** executor in the neutral write-request module: no `server-only`, no module-level client, the Sanity client passed in by the caller, so C4's `tsx` script can import it (a `server-only` module cannot be). It takes the actor, the month entries and the client; it re-reads the fresh state of WR-7 itself (for actor `reconstruction`, the record only) through the injected **read** client (published perspective, no CDN) and mutates only through the injected **write** client; runs the actor's decision (WR-8 or WR-14); and commits under WR-9–WR-11's discipline (route: one transaction for all writes; reconstruction: one guarded mutation per month, C4 R16). `create` is a plain create; replace and delete carry `ifRevisionId`; `already_exists` / `revision_mismatch` map as WR-10/WR-11; anything else is thrown. No other module under `app/` or `scripts/` issues a mutation on the type. **Pin:** the write-request module joins the caller pin (`PINNED_BEYOND_COMMIT`), and the scan for it covers `scripts/` as well as `app/`; its exact importer list is `app/utils/fairnessMonthCommit.ts`, whatever other `app/` module the plan proves needs the validator or hash, and — added by C4 in its own change — C4's script core. The audit registers every file its scan flags as writing the type (WR-1's module and the executor's) by exact `file#module` | `serviceCommitCallers.test.ts` (extended scan) fails on a new importer in `app/` or `scripts/`; `protectedReadAudit.test.ts`; executor tests with a fake client asserting the mutation log per decision row |
| WR-17 | **The body validator is exported.** The write-request module exports the validation of a `FairnessMonthWrite` (WR-3's strictness, WR-4's limits, REC-3/REC-4's consistency) as one neutral function, run by the executor on every entry whatever the actor. A caller that **transforms** a body before writing it (C4 narrows the resolver's body by its join bounds and Frank's overrides — C4 Interfaces 2, R5–R8) must pass the result through this function before planning it; the executor re-runs it regardless | Unit tests; the executor refuses an invalid body with 400-shaped issues for actor `route` and a typed refusal for actor `reconstruction` |

**Residual race, stated.** WR-7's stored-services read and WR-11's commit are not atomic: Sanity
cannot assert another document's absence inside a transaction. A service created in the month
between the two lets a `replace` land on a month that just gained a service. Accepted, because the
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
| LG-2 | **Counted.** A service counts iff its effective flag `coalesce(countsForFairness, _type != "special_role")` is true (C1's rule, consumed — §7). An uncounted service contributes to nothing: no share, no received seat, no set-aside, no floor, no «cantó», no X1 input |
| LG-3 | **Recorded months only.** A month contributes shares, received seats and set-asides only if it has a record. A month without one contributes nothing and is reported `recorded: false` (F3). Drafts (`published: false` or absent) in earlier months count; the target month and later months never count |
| LG-4 | **Seat → role key → line.** `sunday_role`: `Lead` → `Sun.Lead`, `BGVs` → `Sun.BGV`, `Chorus` → `Sun.Choir`. `saturday_role`: `Lead` → `Sat.Lead`, `BGVs` → `Sat.BGV`, `Chorus` → `Sat.Choir`. A counted special maps by **day class** (D14): dated on a Sunday → the `Sun.*` keys, any other day → the `Sat.*` keys; the weekday comes from the stored date string by calendar arithmetic. A seat is an array item with a non-empty `_ref`; the holder is that id whether or not a member document still exists. Instruments and FOH never count |
| LG-5 | **Listing.** For a recorded month with record R, `status(p, k)` is R's value for p and role key k; a person absent from R is `"out"` everywhere (REC-7) |
| LG-6 | **Availability and rule exclusion.** p is unavailable on date d of month m iff d is a block date with `unavailable: true` in R for p, **or** d is in p's live `unavailableDates` (union, F4: a member deleting a past date cannot create debt). p is rule-excluded for k at a **weekend** service on d iff k is in R's `excludedRoles` for p on d. Rule exclusions never apply to specials (grid parity, `serviceRuleContext.ts:56`) |
| LG-7 | **Presence.** A presence rule ρ of R applies only at counted **weekend** services s, for the role keys A(ρ,s) = ρ.roles ∩ keys of s. Its **sub-line population** Q(ρ,s) = members of ρ that are `"in"` for some k ∈ A(ρ,s), available on date(s) and not rule-excluded for that k. Its **presence seat** π(ρ,s) = the first seat at s whose role key is in A(ρ,s) and whose holder is a member of ρ, ordered Lead > BGV > Choir, then by the holder's member `_id` in codepoint order — **never** stored array order, which C5's request does not carry (C5 §6.3 uses the same order, so the two pick the same seat); rules are taken in `ruleKey` codepoint order and a seat serves at most one rule. If π's holder is not in Q(ρ,s), π is set aside (`outside_population`) and the sub-line's pool at s is 0 |
| LG-8 | **Normal population** P(s,k) for counted service s in recorded month m and role key k: every p with (i) `status(p,k) === "in"`; (ii) available on date(s); (iii) not rule-excluded for k at s; (iv) if k maps to DL, no `sundayCadence` in R (F7: no DL line); (v) not a member of a presence rule ρ applying at s with k ∈ A(ρ,s) when ρ is `exclusive` (F5 parenthesis); (vi) not the **only** member of Q(ρ,s) for any rule ρ applying at s — that member is out of every normal population at s (F6, forced presence); (vii) not holding, at s, a seat of another role key k′ for which `status(p,k′) === "exact"` (F6, a seat decided before the solve). Pins are not distinguishable from hand placement in stored data, so a stored pin moves no population (parent X1 treats them alike) |
| LG-9 | **Set-asides** (removed from the pool; credit nobody, owe nobody — F5). At (s,k), a seat other than a presence seat is set aside when its holder h: (a) has `status(h,k) === "exact"` → `exact`; (b) holds a DL-mapped seat and has `sundayCadence` → `cadence`; (c) is absent from R → `not_in_record`; (d) is otherwise not in P(s,k) → `outside_population`; (e) is chosen by LG-11 → `floor`. The first matching reason is reported |
| LG-10 | **Shares.** Pool(s,k) = seats at (s,k) − set-asides at (s,k) − presence seats at (s,k). For p ∈ P(s,k): share = Pool / \|P(s,k)\|; received = p's seats at (s,k) that are neither set aside nor a presence seat. A sub-line ρ at s has pool 1 when π(ρ,s) exists and its holder ∈ Q(ρ,s), else 0; share = pool / \|Q(ρ,s)\| for each member of Q; received = 1 for π's holder. Every remaining seat's holder is in its population, so a positive pool never meets an empty population. **Balance = share − received**, summed per line. On exact values, balances sum to 0 per (service, role key) and per (rule, service) |
| LG-11 | **Floor seat, past months** (F5, F9). Evaluated per recorded month m on the values of LG-10 **without** floor set-asides. A person p gets one floor set-aside in m iff all hold: p is listed in R and not `exempt`; p is in some P(s,k) or Q(ρ,s) at a counted service of m; p's combined share over every line and sub-line of m is **below 1**; p has at least one received seat in m; and p holds **no** seat in m set aside under LG-9 (a)–(d) (a fixed seat already met the floor — P4). The floor seat is p's first received seat in m ordered by stored date, then Lead > BGV > Choir, then service `time` (absent first, then lexical), then service `_id` (codepoint); two seats still tied are the same holder in the same role key at the same service (a repeated array entry), so either choice gives identical figures and no array order is consulted; a presence seat qualifies. All floor seats of m are applied together; populations do not change; the affected pools shrink by one (a sub-line's to 0) |
| LG-12 | **Windows.** The **window** is exactly the 3 calendar months before the target month, by integer arithmetic (`historyWindow`'s rule, `solverHistory.ts:249-262`). The **cumulative** span (X4) is every recorded month from the earliest record before the target to the month before the target. Both are sums of per-month exact values |
| LG-13 | **Arithmetic.** Exact rational arithmetic throughout (no floating point accumulates). Each output figure is rounded **once**: hundredths = sign(x) · ⌊\|x\| · 100 + ½⌋ (half away from zero). `received` is an integer seat count, so `balance` = `share` − `received` in hundredths with no second rounding. Rounded figures are outputs only and never feed a computation. Rounded balances may fail to sum to exactly 0 by a few hundredths; exact ones never do |
| LG-14 | **Total, «cantó», exempt.** Total = DL + SL + BGV + CORO + every `P:*`, summed exactly. The **BGV display figure** = BGV + every `P:*`, summed exactly (sub-lines folded for display, parent F1). «Cantó» = every voice seat p held at counted services of the window's recorded months, set-asides and presence seats included. `exempt` changes no line (D13); it excludes p from Total's display and from LG-11 |
| LG-15 | **Notes.** For each person, month and line, the ledger emits notes from a closed set: `unrecorded_month`, `not_listed`, `role_out`, `unavailable { dates }`, `rule_excluded { dates }`, `exact { roles, count }`, `exact_clamped { count, available }`, `cadence_set_aside { dates }`, `cadence_no_sunday_saturday { dates }` (a cadence person who led no counted Sunday in m and led at least one counted non-Sunday Lead seat: that seat counts in SL, D11), `floor_seat { date, roleKey }`, `presence { ruleKey, members }`, `outside_population { dates }`, `exempt`. Diagnostics: `duplicateTargets`, `notInRecordSeats`, `unknownMembers` (a seat holder with no member document and no record listing) |
| LG-16 | **Neutral and deterministic.** No `"use client"`, no `server-only`, no Sanity client, no `node:crypto`, no `Date` arithmetic on service dates, no import from a client module (`clientBoundary.test.ts`). Output is independent of input order: every list is sorted by codepoint. Keyed by member `_id`; names are display only |
| LG-17 | **Exact clamp, reported.** In a recorded month, if an exact rule's `count` exceeds the person's available matching counted services (available, not rule-excluded, a covered role key present), the ledger reports `exact_clamped { count, available }`. Set-asides remain the seats actually held; nobody accrues debt for a seat that was never filled (F5) |

### 4.4 The cadence state (X1) — CAD

| ID | Requirement |
|---|---|
| CAD-1 | **One function**, pure and neutral, in `fairnessLedger.ts` (F7): given, for one member, `ledCountedSundayPreviousMonth` and 1–2 consecutive months each with `eligible` and `availableCountedSundays`, it returns each month's `state: "on" \| "off"` and a `reason`. Month 1: `not_eligible` if not eligible; else `led_previous_month` if she led; else `no_available_sunday` if 0 available; else `on`. Month 2 runs the same rule with "led previous" = (month 1 is `on`), reported as `assumed_led_previous_month` when that is the reason (X1: month 2 assumes month 1 follows its own state) |
| CAD-2 | **Inputs, defined.** "Led a counted Sunday" = held a `Lead` seat at a counted service dated on a Sunday (weekend Sunday or counted Sunday special), in stored data, published or not, pinned or hand-placed alike; it does not depend on the month having a record. "Eligible" = `Sun.Lead` is `"in"` for her in that month's record when one exists, else in the on-screen eligibility (RES-1) — the caller supplies it. "Available counted Sunday" = a counted Sunday-dated service of that month on which she is available (LG-6) and not rule-excluded for `Sun.Lead` (P8) |
| CAD-3 | **Never stored.** Records keep the setting; the state is recomputed whenever needed. The GET supplies the stored inputs (RD-3: `countedSundayLeads`); C6 supplies the horizon inputs |

### 4.5 The reader and `GET /api/admin/fairness` — RD

| ID | Requirement |
|---|---|
| RD-1 | **Reader.** `app/utils/fairnessLedgerRead.ts`: `import "server-only"`, `operationalClient` imported directly, every query a new additive builder in `serviceReadQueries.ts` (no `published` filter: prior-month drafts count; no new draft-gating exemption). It reads: every `fairnessMonth` with `month` ≤ the last horizon month; every role document of the three types whose stored date is in [min(earliest record month, target − 3), target) plus a count of those in the horizon months; the members those records and seats reference (`_id`, `member_name`, `alias`, `unavailableDates`). It performs no authorization (the route gates) |
| RD-2 | **Fail closed.** A rejected read, a non-list answer, or a record that fails the record schema (unknown `schemaVersion`, a missing field, an invalid enum) throws `FairnessLedgerUnavailableError`, whose message is fixed — «No se pudo leer el saldo de equidad.» — carrying no Sanity text; the cause is logged on the server once. It never returns an empty or partial ledger in place of a failed read. A month without a record is **not** a failure (F3, L5) |
| RD-3 | **Payload.** The route returns `FairnessLedgerResponse` (§7): the effective engine, the current month, the target, the 3 window months with record summaries, the earliest recorded month, the horizon months with their full logical record (or `null`) and stored-service counts, and per person: window, cumulative and per-month figures per line (`share`, `received`, `balance` in hundredths), the five display tabs, «cantó», notes, set-asides, `countedSundayLeads` (dates in the window), and `firstRecordedIn` per role key |
| RD-4 | **Route.** `GET /api/admin/fairness?month=YYYY-MM[&horizon=1\|2]` (default 1): the solver-history gate (manager; content-editor refused — it exposes availability, L5); 400 `invalid_request` on a malformed parameter; 200 with `Cache-Control: no-store` and `dynamic = "force-dynamic"`; on any throw, 500 `{ error: "fairness_unavailable", message }` with **no** `people` key, logging anything not already logged (`solver-history/route.ts:82-95` precedent) |
| RD-5 | **Scope.** No ministry filter on seat holders (seats are worship roles); the payload names only people listed in a read record or seated in a read service |

### 4.6 The eligibility resolver — RES

One neutral, client-callable function turns the **on-screen** planner state into one month's write
body. It is the only definition of "what eligibility a month was solved with": «Registrar» (UI-6)
uses it, and C6 must build both its confirm body and S1's per-role eligibility from its output, never
from a second resolution (Interfaces).

| ID | Requirement |
|---|---|
| RES-1 | **Pools → roles** (v2's map, `owt_solver_v2.py:642-648`, plus `Sat.Choir`): `Sun.Lead` in iff in the Sunday pool; `Sat.Lead` in iff in the Sunday or Saturday pool; `Sun.BGV`, `Sat.BGV`, `Sun.Choir`, `Sat.Choir` in iff in any pool; each only when the member's current Tipo fits the role (WR-5's rule). No cross-pool de-duplication. A rule never grants eligibility: v2's `extraSupport` injection (`plannerModel.ts:886-938`) is a v2 request artifact and is not carried over (Q1) |
| RES-2 | **Exclusions, and the one v3 pattern expansion.** A restriction's `excludedPatterns` set the covered role keys to `"out"`. Patterns resolve over the six keys by **one exported, neutral, client-callable expansion** (working name `rolesOfPatternV3`, beside `rolesOfPattern` in `plannerModel.ts`; the plan may rename it only together with C5 and C6): `Sun.*` → the three `Sun.*` keys; `Sat.*` → the three `Sat.*` keys; `*.X` → both days; `*.*` → all six; `*.LeadBGV` → Lead and BGV on both days; a single key → itself (`Sat.Choir` included); legacy aliases as `LEGACY_PATTERN_ALIASES` (`plannerModel.ts:619-624`, mirroring `owt_solver_v2.py:68-73`); `[]` for anything else. **Relation to `rolesOfPattern`** (the ONE v2 map, `plannerModel.ts:637-650`): for every pattern, the expansion restricted to the five v2 keys equals `rolesOfPattern`'s answer, and `Sat.Choir` is added exactly when the pattern covers chorus on Saturday (`Sat.*`, `*.Choir`, `*.*`, `Sat.Choir`, and their aliases). `rolesOfPattern` and its solver sync are untouched — v2 keeps its five keys. A sync test (an extension of `patternRolesSync.test.ts` or a sibling) asserts that relation over every pattern the rule form can save plus the legacy aliases, so the two maps cannot drift. This expansion is the only one used for the record's exclusions, exact rules and presence roles, and C6 builds every v3 rule's `roles` (count, pair, presence) from it (C5-4) |
| RES-3 | **Exact rules, and the one per-month count resolution.** A cap with `op "=="` makes each covered role that is otherwise `"in"` `"exact"`, with `count` resolved for the month; a resolved count of 0 makes those roles `"out"`. `<=` and `>=` caps change nothing in the record. The count resolution is **one exported neutral function** over `resolvedCapValue` (`plannerModel.ts:667-669`) with `weeks` = the month's full count of Sundays (ADR-0048's D2) — never a restatement of `max(0, weeks − offset)`; C6 resolves every v3 count rule (`==`, `<=`, `>=`) per month with it (C5-4, C6 RQ-5) |
| RES-4 | **Dates.** `weekExclusions` become `blocks[].excludedRoles` on the weekend dates of week N by the planner's existing week numbering (`ruleContextForTarget`; week `weeks + 1` is the trailing Saturday, ADR-0048), restricted to the role keys of that date's day class. Each member's `unavailableDates` inside the month become `blocks[].unavailable` |
| RES-5 | **People.** The resolver's `members` input is the **unfiltered worship roster** (every member whose normalized ministries include worship — no `voz`, pool or Tipo filter; C3 §6.5). From it the resolver derives, separately, the record's `people`: every member whose Tipo includes `voz`, each once, plus `exempt` from `fairness === "exempt"` (`"slack"` records nothing — Q2 of the parent) and `sundayCadence` for the ids `cadenceMembers` returns (RES-7). Names are always resolved against the unfiltered roster, never against `people` |
| RES-6 | **Presence.** Each presence rule → `{ ruleKey: rule.id, roles (resolved per RES-2), members (ids), exclusive }`; `exclusive` per REC-4 from `conflicts[]` |
| RES-7 | **Names — exactly one, through C3's resolver.** Every name the build reads — each restriction's `person` (exclusions, caps, «Exenta», week exclusions), both persons of each conflict, every person of each presence rule — resolves through C3's `resolveRulePersonId(person, roster)` (`app/utils/sundayCadence.ts`, C3 §7 item 4), and the cadence setting through C3's `cadenceMembers(config, roster)`, both over the unfiltered roster of RES-5. `resolveToMemberName`'s first-match resolution (`plannerModel.ts:572-578`) is never used here: it cannot see an ambiguous name. Any `unresolved` or `ambiguous` result, or a non-empty `refusals`, refuses the whole build with `{ ok: false }` naming **each** refused `person` and its reason (L4; C3's obligation on C2). A rule naming a member with no Tipo refuses as `solverPools` does |

### 4.7 The golden fixture (`fixtures/fairness/golden.json`) — FX

| ID | Requirement |
|---|---|
| FX-1 | **Location and ownership.** One JSON file at the repository root, created by C2, read by vitest now and by C5's Python suite (`gcf_v3/`, package `owt_v3`) later. Expected values are **hand-computed and reviewed**, frozen in the file; neither suite regenerates them from its own output, and neither compares against the other at runtime |
| FX-2 | **Schema.** `{ schemaVersion: 1, units: "hundredths", sign: "positive_owed", cases: Case[] }`. Each case: `id` (unique kebab-case), `kind: "ledger" \| "cadence" \| "plan"`, `description` (English), `covers: string[]` (LG/CAD rule ids and coverage tags), `input`, `expected`. A `ledger` input is `{ target, records: LogicalRecord[], services: FixtureService[], members: { id, name, unavailableDates }[] }` (§7 shapes); its expected is `{ window: { month, recorded }[], months: { [month]: { [memberId]: { [lineKey]: { share, received, balance } } } }, window totals per member and line, setAsides: { serviceId, roleKey, memberId, reason }[], notes }`. A `cadence` input is CAD-1's argument; its expected is CAD-1's result. `plan` cases are reserved for C5 |
| FX-3 | **Who asserts what.** vitest asserts every `ledger` and `cadence` case and schema-checks `plan` cases. Python asserts every `ledger` case **per month** — evaluating its own share formula over the case's services as stored services (filled seats, actual placement), with populations resolved from the case's records exactly as LG-5–LG-8 state — and every `plan` case it adds. `cadence` cases are TypeScript-only: X1 has one implementation (F7) and C5 consumes its output. An unknown `kind` fails both suites. Both suites also assert, for every `ledger` case, that exact balances sum to 0 per (service, role key) and per (rule, service) |
| FX-4 | **Required coverage** (each a separate case or a named part of one): sum-to-zero with an uneven division (2 seats among 3 people); unavailable by record snapshot and by live date only (the union); a window month with no record (seats ignored, `recorded: false`); a person absent from a recorded month (seat set aside `not_in_record`); a person listed but `"out"` for `Sun.Lead` in one recorded month (no DL share there while the others accrue, back in the population the next month — R8, D7); a hand-placed seat in an `"out"` role (`outside_population`); exact rule with its seats set aside and an `exact_clamped` month; F6 exact-seat holder removed from another role's population at that service; cadence member's Sundays set aside and no DL line, plus a no-Sunday month whose Saturday counts in SL; presence with both members available, with only one available (out of every normal population there), exclusive vs non-exclusive, and a broken exclusive rule (second member's seat set aside); a non-exclusive presence service where two members hold matching seats of the same role key and their **stored array order is the reverse of their id order** (the presence seat goes to the lower id — LG-7); floor seat chosen by date, a same-date tie resolved by role order, and a person whose fixed seat already met the floor (no floor set-aside); counted special on a Sunday (Lead → DL) and on a Friday (Lead → SL, BGV via `Sat.BGV`, Chorus via `Sat.Choir`), an uncounted special, and the legacy default (field absent: weekend counts, special does not); drafts in a past month counted; a duplicate weekend target dropped; the target month and a later month ignored; a cumulative span longer than the window; an exempt person whose lines are unchanged. Cadence: `on`; `led_previous_month`; `not_eligible` (an untick) followed by `on` the next month; `no_available_sunday`; a two-month run `on → assumed_led_previous_month` and `off → on`; and a pinned Sunday in an «off» month counted as led, making the next month `off` |
| FX-5 | **Names.** Fictitious people and ids only (this repository is public). No test can compare the file against the production roster without reading production data, so the fixture's header states the rule and code review enforces it |

### 4.8 The read-only «Equidad» preview and «Registrar» — UI

| ID | Requirement |
|---|---|
| UI-1 | **Mount.** One read-only panel mounted **beside** `LeadPoolHistoryPanel` at the config step and in the stored editor (`MonthGenerator.tsx:1737-1747`, `:4489-4501`), for the month being viewed; `LeadPoolHistoryPanel`, `ParticipationSidebar` (`computeParticipation`, its «Incluir especiales» switch) and the solver-history surfaces are unchanged (L1) |
| UI-2 | **Inert.** It reads only `GET /api/admin/fairness?month=<viewed>&horizon=1`; it changes nothing Auto reads, sends, solves or writes; a failure of its read never blocks Auto or any save |
| UI-3 | **Shape.** A `Collapse` disclosure, closed by default, that loads on first open (`Skeleton` while loading; the fixed error copy with «Reintentar» on failure — never an empty table). Inside: the banner «Vista previa: Auto todavía no usa este saldo» (always visible while open), the window chips, a `SegmentedControl` for the five tabs, the table (desktop) or one card per person (phone), and a collapsed «Fuera de esta línea» group |
| UI-4 | **Columns** (U5 minus «en este plan» and «queda»): «Persona», «Le tocaba», «Tuvo», «Saldo (3 meses)», «Desde {mes año}» (cumulative, X4), «Motivo»; the Total tab adds «Cantó». Figures are the GET's hundredths shown with two decimals in `es-MX` (no second rounding — LG-13); the saldo is always in words (§8). Rows: people in that line's population at least once in the window, sorted by saldo descending (most owed first), ties by display name with `es` collation |
| UI-5 | **Motivo.** One line per person from LG-15's notes, in a fixed order, with the copy of §8; for a cadence person on the DL tab it adds the viewed month's X1 state, computed with CAD-1 from the GET's `countedSundayLeads`, the viewed month's record (if any) else the on-screen Sunday pool, and the month's counted Sunday services (stored ones if any exist, else every Sunday of the month, the weekend default), labelled «previsto» |
| UI-6 | **«Registrar elegibilidad de {mes}».** Rendered only when the GET's `engine` is `"v3"` and the viewed month is not before `currentMonth`. It builds the body with RES from the on-screen state, asserts the horizon record's `rev` it read (or `null`) per WR-15, and confirms through a `CueDialog` (`open` prop, never a literal) that names the replacement when a record exists. It stays open on every refusal with the matching copy; success shows «Registrado ✓» through `useTransientValue` and re-reads the GET. The handler wraps `fetch` in try/catch/finally, checks `res.ok`, resets its loading flag and never closes as success on failure |
| UI-7 | **House rules.** `Button` only, `SegmentedControl` for the tabs, no `motion` import outside `app/components/ui/**`, no fixed-bottom element, no colour concatenation, light and dark themes |

### 4.9 The engine module — EN

| ID | Requirement |
|---|---|
| EN-1 | `app/components/admin/solverEngine.ts` exports `SOLVER_ENGINE: "v2" \| "v3"`, value `"v2"`; neutral, no imports (the `solverHistorySource.ts` precedent). C2 creates it because «Registrar» is gated on it and C2 precedes C6 (P3) |
| EN-2 | The **effective engine** is resolved on the server only: `OWT_SOLVER_ENGINE` is honoured when `VERCEL_ENV === "preview"` and its value is exactly `"v2"` or `"v3"`; in every other environment, and for any other value, the constant wins. No client bundle reads the variable; clients learn the engine from the GET (`engine`) |
| EN-3 | `docs/SECRETS.md` gains the `OWT_SOLVER_ENGINE` entry in this change: Vercel **Preview only, scoped to the `preview` branch** — `VERCEL_ENV` is also `preview` on the `verify/service-readiness` deployment, which must not receive it (the branch-scoped pattern of `SECRETS.md:312-313`); not Production (ignored there by code); not GitHub Actions; not local `.env.local`; purpose; source (Vercel → Settings → Environment Variables, a literal); rotation (edit, redeploy Preview, verify the dev alias); blast radius (while `v3` on Preview, «Registrar» appears on dev and writes **production** records stamped `preview`; after C6, dev's Auto runs v3). It stays unset until Frank decides a Preview rehearsal |

### 4.10 Guards, registries and documentation — GU

| ID | Requirement |
|---|---|
| GU-1 | ADR-0043's three owed items for `fairnessMonthCommit`: `PROTECTED_RUNTIME_WRITERS` entry (reason text: create-only-by-collision, revision-asserted replace, stored-services gate, no side effects), `DELIVERY_CAPABLE_IMPORTS` entry, caller-pin row naming only the PUT route. As a consequence the PUT handler is wrapped in `withVerificationRunContext` (harmless: it delivers nothing — P9). The write-request module (the executor, WR-16) joins `PINNED_BEYOND_COMMIT` with its exact importer list, and the pin's scan is extended to `git ls-files app scripts` for that module (the other pinned modules keep their `app/`-only meaning or gain the wider scan — either way no existing row loosens). Every file the audit flags as writing `fairnessMonth` is registered by exact `file#module`. No guard is loosened |
| GU-2 | `PROTECTED_TYPES` pin and Studio lists per REC-8/REC-9; `draftGatingCoverage` unchanged in its lists; `clientBoundary` passes with the neutral modules |
| GU-3 | A new ADR («El saldo de equidad se mide contra la elegibilidad registrada»), numbered at merge: the record and why eligibility is stored while seats stay derived, the hyphen id's public readability (P1), the stored-services gate and its residual race, the past-month and reconstruction-actor rules, exact arithmetic and single rounding. ADR-0042 gains «amended by ADR-NNNN under v3» in the same change. The other amendments of parent §9 land when v3 serves Auto (C7) |
| GU-4 | `docs/DATA_MODEL.md` (the new type; the governed-type count), `CONTEXT.md` (registro de elegibilidad, saldo, línea, sub-línea de presencia), `docs/SECRETS.md` (EN-3), and `CLAUDE.md`: a «Don't-break-these» line («`fairnessLedger.ts` is the only TypeScript definition of F2–F7 and X1; records are written only through `fairnessMonthCommit` or the reconstruction actor; `fixtures/fairness/golden.json` is asserted by both suites») and the reusable-utils entries — including `rolesOfPatternV3` («the ONE v3 six-key pattern map; equals `rolesOfPattern` on the five v2 keys and adds `Sat.Choir`; synced by test») and `capValueForMonth` («the ONE per-month count resolution, over `resolvedCapValue`»), and a line that the write executor is the only mutation path for `fairnessMonth` |

## 5. Scope

### In scope

The record type and its Studio/audit governance; the write-request module (validation, keys, hash,
both actors' decision tables); `fairnessMonthCommit.ts` and the PUT route; the ledger and the X1
function; the eligibility resolver; the reader and the GET; the golden fixture; the read-only panel
and «Registrar»; `solverEngine.ts` with the Preview-only override; the ADR and doc updates above.

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
  The record holds member ids, display names, eligibility and a month's unavailable dates. Because
  the dataset answers unauthenticated published reads and the canonical id has no dot, a stored
  record is world-readable (P1). Everything in it except the availability snapshot is already
  readable in `teamMembers` and `solverConfig`; the snapshot can preserve a date a member later
  deletes. The ledger's GET adds nothing a public reader could not derive, but stays manager-only.
- **Failure.** GET: fail closed (RD-2). PUT: all-or-nothing (WR-9); every refusal is typed; a
  refused «Registrar» leaves its dialog open. A malformed stored record blocks the ledger rather than
  silently changing balances; repairing it is a consented script (C4's tooling), never the route.
- **Concurrency.** Create by collision; replace by `ifRevisionId`; a concurrent writer is refused,
  never discarded (L3); the stored-services residual race is stated in §4.2.
- **Determinism.** Same records, services and members → byte-identical GET payload.

## 7. Interfaces

**Consumed**

| From | What C2 relies on | Exact shape |
|---|---|---|
| C1 | The per-service toggle and its legacy read rule | `countsForFairness?: boolean` on `sunday_role`, `saturday_role`, `special_role`; effective value `coalesce(countsForFairness, _type != "special_role")`. If C1 exports that rule as a GROQ fragment and/or a TypeScript twin, the ledger's query and code use them (no third copy); otherwise C2's query states it once and a sync test pins it to C1's |
| C3 | The cadence setting and the exactly-one name resolver | `sundayCadence?: "alternate"` on a `solverConfig` restriction (`PersonRestriction`), keyed by `person` (name or alias). From `app/utils/sundayCadence.ts` (neutral): `resolveRulePersonId(person, roster) → { ok: true; id } \| { ok: false; reason: "unresolved" \| "ambiguous"; matches: string[] }` and `cadenceMembers(config, roster) → { ids: string[]; refusals: NameRefusal[] }`, with `roster` the unfiltered worship roster (`RosterMember = { _id, member_name, alias?, memberType? }`). C2 uses them for every name (RES-7) and refuses on any refusal |
| Existing | Rules and pools | `SolverConfig` (`plannerModel.ts:248-294`): `sundayLeads`, `saturdayLeads`, `support` (ids); `restrictions[]` (`excludedPatterns`, `fairness`, `weekExclusions`, `caps[] { pattern, op, value, relative, relOffset }`); `conflicts[] { personA, personB, pattern }`; `presence[] { id, persons, pattern }` |

**Provided**

```ts
type RoleKey = "Sun.Lead" | "Sat.Lead" | "Sun.BGV" | "Sat.BGV" | "Sun.Choir" | "Sat.Choir";
type LineKey = "DL" | "SL" | "BGV" | "CORO" | `P:${string}`;          // P:<ruleKey>
type Status = "in" | "out" | "exact";

// PUT /api/admin/fairness/months — body (WR-3/WR-4). Never carries names, keys, hashes or stamps.
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
// 200: { months: Array<{ month; outcome: "created" | "replaced" | "unchanged"; rev; contentHash; recordedAt }> }
// 409: serviceError body; details.detail ∈ record_exists | record_missing | stale_revision |
//      month_has_services | past_month | engine_not_v3 | member_unknown | member_not_worship |
//      tipo_mismatch; details.months lists every month's verdict.

// The logical record (GET, fixture). The stored document is REC-1..REC-4.
interface LogicalRecord {
  month: string; rev: string; contentHash: string;
  source: "auto" | "manual" | "reconstructed"; engine: "v2" | "v3";
  environment: "production" | "preview" | "local"; recordedAt: string;
  people: Array<FairnessMonthWrite["people"][number] & { name: string }>;
  presence: FairnessMonthWrite["presence"];
}

// GET /api/admin/fairness?month=YYYY-MM[&horizon=1|2] — 200 body (RD-3).
interface FairnessLedgerResponse {
  v: 1;
  engine: "v2" | "v3";                         // effective engine of this deployment (EN-2)
  currentMonth: string;                        // CDMX
  target: string;
  window: Array<{ month: string; record: RecordSummary | null }>;          // 3, oldest first
  recordsSince: string | null;                 // earliest recorded month before target
  horizon: Array<{ month: string; record: LogicalRecord | null; storedServices: number }>;
  people: Array<{
    memberId: string; name: string; exists: boolean;
    window: Partial<Record<LineKey, Figures>>;
    cumulative: Partial<Record<LineKey, Figures>>;
    tabs: { window: Partial<Record<"DL" | "SL" | "BGV" | "CORO" | "TOTAL", Figures>>;
            cumulative: Partial<Record<"DL" | "SL" | "BGV" | "CORO" | "TOTAL", Figures>> };
    sang: number;                              // «cantó», window
    exempt: boolean;                           // in the latest recorded window month
    months: Array<{ month: string; recorded: boolean; listed: boolean;
                    lines: Partial<Record<LineKey, Figures>>;
                    held: Partial<Record<RoleKey, number>>;               // all counted voice seats
                    setAsides: Array<{ date: string; serviceId: string; roleKey: RoleKey;
                                       reason: "exact" | "cadence" | "not_in_record" | "outside_population" | "floor" }>;
                    notes: Note[] }>;
    countedSundayLeads: string[];              // dates in window months, recorded or not (CAD-2)
    firstRecordedIn: Partial<Record<RoleKey, string>>;                  // first month marked "in" (F10)
  }>;
  diagnostics: { duplicateTargets: Array<{ type: string; date: string; roleIds: string[] }>;
                 notInRecordSeats: number; unknownMembers: string[] };
}
interface Figures { share: number; received: number; balance: number }  // hundredths, seats, hundredths
interface RecordSummary { rev: string; source: LogicalRecord["source"]; engine: "v2" | "v3";
                          environment: LogicalRecord["environment"]; recordedAt: string }
// Note: LG-15's closed set, each { code, ...params }.
// 500: { error: "fairness_unavailable", message: "No se pudo leer el saldo de equidad." } — no `people`.

// X1 (CAD-1), neutral, per member (callers key results by member _id).
type CadenceReason = "on" | "not_eligible" | "led_previous_month" | "assumed_led_previous_month" | "no_available_sunday";
declare function cadenceStates(input: {
  ledCountedSundayPreviousMonth: boolean;
  months: Array<{ month: string; eligible: boolean; availableCountedSundays: number }>;  // 1–2
}): Array<{ month: string; state: "on" | "off"; reason: CadenceReason }>;

// The eligibility resolver (RES), neutral, client-callable.
declare function resolveMonthEligibility(input: {
  month: string; config: SolverConfig /* on screen, incl. sundayCadence */;
  members: Array<{ _id: string; member_name: string; alias?: string; memberType?: string[];
                   ministries?: unknown; unavailableDates?: string[] }>;   // UNFILTERED worship roster (RES-5)
}): { ok: true; body: Omit<FairnessMonthWrite, "source" | "expectedRev"> }
  | { ok: false; issues: string[]; refusals: Array<{ person: string; reason: "unresolved" | "ambiguous" | "no_tipo" }> };

// The one v3 pattern expansion and per-month count resolution (RES-2, RES-3), neutral, client-callable.
declare function rolesOfPatternV3(pattern: string): RoleKey[];          // [] when unknown; canonical role order
declare function capValueForMonth(cap: RestrictionCap, month: string): number;  // resolvedCapValue(cap, sundaysIn(month))

// Write-request module (neutral, NOT client-importable: node:crypto). Working names; the plan may
// rename them only together with C4.
declare function validateFairnessMonthWrite(body: unknown):
  { ok: true; value: FairnessMonthWrite } | { ok: false; issues: Array<{ path: string; message: string }> };  // WR-17
declare function contentHashOfWrite(month: string, body: Omit<FairnessMonthWrite, "source" | "expectedRev">): string;
declare function contentHashOfStored(doc: unknown): string;             // REC-6; intact iff === doc.contentHash
type Actor = "route" | "reconstruction";
declare function executeFairnessMonthWrites(input: {                    // WR-16; the ONLY mutation path
  clients: { read: SanityClient; write: SanityClient };                 // injected; read = published perspective, no CDN
  actor: Actor;
  op: "write" | "delete";                                                // "delete" only with actor "reconstruction"
  months: Array<FairnessMonthWrite | { month: string; expectedRev: string }>;   // write bodies, or delete targets
  stamps: { recordedBy: string; now: string; currentMonth: string; environment: "production" | "preview" | "local";
            engine?: "v2" | "v3" };                                      // server/script-derived, never from a body
}): Promise<Array<{ month: string;
  verdict: "created" | "replaced" | "unchanged" | "deleted"
         | { refused: "record_exists" | "record_missing" | "stale_revision" | "month_has_services" | "past_month"
                    | "not_past_month" | "not_reconstruction_owned" | "record_edited" | "engine_not_v3"
                    | "member_unknown" | "member_not_worship" | "tipo_mismatch" | "invalid_body" };
  rev: string | null; contentHash: string | null }>>;                    // actor "route": all-or-nothing (WR-9)

// Fixture service (FX-2).
interface FixtureService { _id: string; _type: "sunday_role" | "saturday_role" | "special_role";
  date: string; time?: string; published?: boolean; countsForFairness?: boolean;
  Lead: string[]; BGVs: string[]; Chorus: string[] }                     // member ids, stored order
```

| To | Provides | Contract |
|---|---|---|
| C4 | `resolveMonthEligibility`; `validateFairnessMonthWrite`; `contentHashOfWrite` / `contentHashOfStored`; `executeFairnessMonthWrites` with actor `reconstruction` for create, replace and delete (WR-14, WR-16, WR-17); the record shape; the read builders of RD-1, including the stored-services-in-month count | C4 imports the write-request module (never `fairnessMonthCommit.ts`) from its `tsx` script with its own injected client; may **transform** the resolver's body (join bounds, overrides) and passes the result through `validateFairnessMonthWrite` before planning it (WR-17); never builds a record, key or hash itself. Stamps: `source: "reconstructed"`, `engine: "v2"`, `environment` per REC-2, a fixed script marker as `recordedBy` (WR-14). C4 adds its script core to the executor's caller pin and registers its own audit entry; dry-run first, consent for `--apply` |
| C5 | `fixtures/fairness/golden.json` (FX); `rolesOfPatternV3` and `capValueForMonth` semantics (via C6) | Python asserts every `ledger` case per month (FX-3) and may add `plan` cases; units, sign, line keys and rounding are LG-13's; the presence seat is chosen by holder id order on both sides (LG-7); a request's `people` and a record's `people` share the limit 100 (WR-4, C5 §5.1); carried balances arrive through C6 as `window` figures |
| C6 | The GET, the PUT, `cadenceStates`, `resolveMonthEligibility`, `rolesOfPatternV3`, `capValueForMonth`, the panel | C6 sends `window[line].balance` as carried balances; derives X1 inputs from `countedSundayLeads` and the horizon; builds S1's per-role eligibility **and** the confirm body from one `resolveMonthEligibility` output (or the horizon record when one exists, U2), calling it with the unfiltered worship roster; builds every count, pair and presence rule's `roles` with `rolesOfPatternV3` and every count `value` with `capValueForMonth` — no other expansion or cap resolution (RQ-5); refuses before the fetch a request whose `people` exceed 100; asserts the `rev` it read (WR-15); extends the panel into U5. C2 provides the writer; C6 provides the Auto-confirm call |

## 8. Spanish copy

| Where | Copy |
|---|---|
| Disclosure | «Equidad · vista previa» |
| Banner | «Vista previa: Auto todavía no usa este saldo» |
| Subheader | «Saldo de {ago–oct 2026} (3 meses). "Le deben" = le tocaba más de lo que tuvo.» |
| Window chips | «{ago}: registrado» · «{sep}: reconstruido» · «{oct}: sin registro, no cuenta»; suffix « · desde dev» (`preview`) or « · local» |
| Tabs | «Dom Lead» · «Sáb Lead» · «BGV» · «Coro» · «Total» |
| Columns | «Persona» · «Le tocaba» · «Tuvo» · «Saldo (3 meses)» · «Desde {ago 2026}» · «Motivo» · (Total) «Cantó» |
| Saldo | «le deben {0.67}» · «{0.33} de más» · «al día» (0.00) |
| Out group | «Fuera de esta línea ({n})» |
| Notes | `unrecorded_month` «{mes}: sin registro, no cuenta.» · `not_listed` «No aparece en el registro de {mes}.» · `role_out` «No estaba en la lista de {línea} en {mes}.» · `unavailable` «No disponible {8 y 15 nov}: esas fechas no le cuentan.» · `rule_excluded` «Excluido por regla el {8 nov}.» · `exact` «Regla fija: {Dom Lead} = {2} por mes; esos lugares no se reparten.» · `exact_clamped` «Regla fija de {2}, pero solo estuvo disponible {1} vez en {nov}.» · `cadence_set_aside` «Mes por medio: sus domingos no cuentan en Dom Lead.» · `cadence_no_sunday_saturday` «En {sep} no dirigió domingo; su sábado cuenta en Sáb Lead.» · `floor_seat` «Un lugar de {sep} fue por el mínimo de voz y no cuenta.» · `presence` «Regla de presencia con {Bruno}: ese lugar se reparte entre ellos.» · `outside_population` «{2} lugares fuera de su lista no cuentan.» · `exempt` «Exenta: no cuenta en Total.» |
| X1 (DL tab, cadence) | «En {nov} le toca domingo (previsto).» · «En {nov} descansa: dirigió domingo el {25 oct}.» · «En {nov} descansa: no está en la lista de Dom Lead.» · «En {nov} descansa: ningún domingo disponible.» |
| Footer | «Le tocaba = su parte de los lugares de cada servicio que cuenta para equidad, repartida entre quienes estaban en la lista y disponibles ese día. Los lugares fijos (reglas fijas, mes por medio, mínimo de voz) no se reparten. Lo que a unos se les debe, otros lo tienen de más: la suma siempre da cero.» |
| Total footer | «Total = Dom Lead + Sáb Lead + BGV + Coro. Cantó = todos sus lugares de voz, incluidos los fijos. Instrumentos y FOH no cuentan.» |
| States | «Cargando el saldo de equidad…» · «No se pudo leer el saldo de equidad.» + «Reintentar» · «Todavía no hay meses registrados: el saldo empieza con el primer registro.» |
| «Registrar» | Button «Registrar elegibilidad de {noviembre}». Dialog title the same. Body «Se guarda quién está en cada lista de {noviembre}, sus reglas y sus fechas no disponibles, tal como están en pantalla. El saldo de los próximos meses se calcula con este registro.» Unsaved rules «Las reglas tienen cambios sin guardar; se registran tal como están en pantalla.» Replace «Reemplaza el registro guardado el {3 oct}.» Buttons «Registrar» · «Cancelar». Success «Registrado ✓» |
| «Registrar» refusals | `record_exists` «Otro administrador registró {noviembre} mientras tanto. Recarga para ver su registro.» · `stale_revision`/`record_missing` «El registro de {noviembre} cambió mientras tanto. Recarga y vuelve a intentar.» · `month_has_services` «{Noviembre} ya tiene servicios guardados: su registro ya no se puede reemplazar.» · `past_month` «{Noviembre} ya pasó: los meses pasados solo se registran con la reconstrucción.» · `engine_not_v3` «Registrar aplica con el nuevo solver. Recarga la página.» · `member_*`/`tipo_mismatch` «Cambió el equipo mientras tanto (un miembro o su Tipo). Recarga y vuelve a intentar.» · resolver «Hay reglas con nombres que no corresponden a una sola persona: {nombres}. Corrígelas antes de registrar.» · anything else «No se pudo registrar. No se guardó nada; vuelve a intentar.» |

## 9. Decisions

| Decision | Choice | Why | Tradeoffs | Owner |
|---|---|---|---|---|
| Record content beyond L2's list | Also snapshot presence rules, date-scoped rule exclusions and each exact rule's value | F4/F5 cannot be computed for a past month otherwise; reading live config would judge the past against today's rules (the ADR-0046 failure). L2's own «snapshots what the month was solved with» covers them | Larger record; the resolver owns more | this spec (P2) |
| Six role keys, `Sat.Choir` included; specials by day class | A counted special's seats use the role keys of its day class for both line and population | One rule for line (D14) and population; no special-only status | A `Sun.Lead` exclusion now also keeps a person out of a Sunday special's DL population, while the grid lets them be hand-placed there (their seat is then set aside) | this spec (P5) |
| Presence and rule exclusions on weekends only | Specials are never bound by them | Grid parity (`serviceRuleContext.ts:56`, `ruleEnforcement.ts:143-147`); presence is a weekly solver rule | C5 must match | this spec (P5) |
| Floor seat in past months | Criterion on the stored-seat share; skipped when a fixed seat met the floor | The parent defines the criterion on a plan figure past months lack; a fixed seat already satisfies F9, so setting aside a fair-share seat would invent debt | C5 must mirror the skip in plan mode | this spec (P4) |
| Exact arithmetic, one rounding, two decimals on screen | Rationals; hundredths once; displayed as is | F14's «rounding happens once»; one decimal would round twice | Two decimals are denser to read | this spec |
| Malformed stored record | The ledger fails closed | A guessed balance would steer the solver silently | One bad record blocks the panel and (later) Auto until repaired by script | this spec |
| 1–2 months per PUT, one transaction | All or nothing | A two-month confirm must not leave month 1 recorded and month 2 not | One refused month refuses both | this spec |
| No-op first | Identical content is 200 `unchanged` before the past-month, revision and services checks | A lost-response retry must succeed even across a month boundary; it writes nothing | An identical replay keeps the original stamps | this spec |
| Strict body | Unknown fields and stamps refused | A client must never believe it set something the server ignored | A stale tab must reload after a body change | this spec |
| `fairnessMonth` in `PROTECTED_TYPES` | Yes | Every read and write of a critical production document becomes visible to the audit | C4 owes an audit entry | this spec |
| Engine module created here | `solverEngine.ts` + Preview-only override + SECRETS entry | «Registrar» and the PUT need the effective engine before C6 exists | Moves part of E2 earlier | this spec (P3) |
| Panel as a closed disclosure, loaded on open | Yes | No load or clutter for admins who do not open it | One click to see it | this spec |

## 10. Assumptions

| Assumption | Impact if false | Validation | Failure response |
|---|---|---|---|
| C1 and C3 are merged before C2's implementation (parent §13) | The ledger cannot read the toggle; the resolver cannot read the cadence | C2 plan entry gate | Wait; never reimplement their rules |
| Records stay small (≤ 12 a year, ≤ 100 people — WR-4, shared with C5's request limit) | GET payload grows | RD payload test at the limits | Paginate the cumulative read in a later change |
| Every stored service date string is its CDMX calendar date | Months misassigned | Existing invariant (CLAUDE.md, `solverHistory.ts:17-19`) | — |
| The stored revision after a transaction is available to the module (transaction id or re-read) | WR-12's `rev` missing | Plan pins the mechanism | Re-read the document after commit, as `solver-config` does |
| Frank leaves `OWT_SOLVER_ENGINE` unset on Preview until he wants a rehearsal | «Registrar» writes production records from dev earlier than intended | EN-3 entry; release notes | Unset it; records stamped `preview` are identifiable |

## 11. Open questions

| Question | Why it matters | Recommendation and why | Tradeoffs | Owner | Blocking? | Resolution point | Bounded default |
|---|---|---|---|---|---|---|---|
| Q1. Should a person named in a rule but ticked in no pool stay BGV/Choir-eligible under v3, as v2's `extraSupport` makes them? | Who accrues BGV/Coro shares | No: under v3 only pools and Tipo grant eligibility (ADR-0029); v2 injected them only because its solver demanded every rule name be in a pool | A rule-only person stops being schedulable for BGV/Coro under v3 unless ticked in a pool | Frank | No (inert until C6/C7) | C6 spec | RES-1 as written |
| Q2. Should the stored-services gate ignore uncounted specials? | A pre-created camp special would freeze a month's record | Yes, see P7 | Slightly weaker protection of uncounted services, which no record affects | Parent owner | No | Parent amendment before C2 implementation | Literal parent (any service) |

## 12. Parent issues

| ID | Issue | Recommended fix | Followed meanwhile |
|---|---|---|---|
| P1 | `fairnessMonth-YYYY-MM` has no dot, so the dataset serves the record — including availability a member later deletes — to unauthenticated readers, while L5 gates the ledger because «it exposes availability». Verified 2026-10-05 against Sanity's «IDs and paths» docs: «Any document ID containing a dot is considered private»; only root-path ids are public. (The earlier citation of `DATA_MODEL.md:653-654` did not support this: it calls the dotted OAuth documents safe to be world-readable on their own merits.) The id is **not** the parent's (the parent names none); it is the program's canonical name, which this spec keeps | Adopt `fairnessMonth.YYYY-MM` at the program level. If adopted, three more things must hold, or records vanish silently instead of leaking: (a) every reader of the type (C2's reader, C4's dry run, C6) uses a client with the read token, and the reader **fails closed** when `SANITY_API_READ_TOKEN` is absent rather than reading zero records as «sin registro» (F3 would otherwise turn a missing token into an empty past); (b) `docs/SECRETS.md`'s `SANITY_API_READ_TOKEN` entry gains «needed to read `fairnessMonth`», on every platform that reads the ledger (Production, Preview, local); (c) REC-1, C4 Interfaces item 1 and C6 §4 change in the same review cycle | Canonical hyphen id; privacy consequence stated in §6 and the ADR |
| P2 | L2's enumerated contents omit presence rules, date-scoped rule exclusions and the exact rule's value, without which F4/F5 cannot be computed for a past month | Amend L2: «…including the presence rules, date-scoped rule exclusions and exact counts in force» | Included (REC-3, REC-4) under L2's «snapshots what the month was solved with» |
| P3 | §11 gives E2 to C6, but C2 must gate «Registrar» and the PUT on the engine and lands first | Note in §11 that C2 creates `solverEngine.ts` and the Preview-only `OWT_SOLVER_ENGINE` resolution (with its SECRETS entry); C6 adds the solve route's contract check | EN-1–EN-3 |
| P4 | F5's floor seat (a) defines its criterion on a «planned» share that past months do not have; (b) as written, sets aside a fair-share seat even when a fixed seat (exact, cadence Sunday) already met the floor, inventing debt | (a) For stored months, use the stored-seat share before floor set-asides; (b) no floor set-aside when the person holds a fixed seat that month — in both modes, so C5 mirrors it | LG-11 |
| P5 | D14 maps a special's seats to lines but not to populations; the parent is silent on whether presence rules and week exclusions bind specials | Populations by day class (Sunday → `Sun.*`, else `Sat.*`, adding `Sat.Choir`); presence and rule exclusions bind weekend services only (grid parity); C5 and C6's local fill use the same | LG-4, LG-6, LG-7 |
| P6 | U2 («a horizon month that already has a record is solved with that record's eligibility») means Auto's confirm never replaces a record; only «Registrar» can, which L3 leaves implicit | Say so in U2/L3, or narrow U2 to records whose month has stored services | The writer offers replace; C6 decides when to call it |
| P7 | L3's «no stored services» includes uncounted specials, so a pre-created camp special freezes an early record | «…no stored weekend services and no counted specials» | Literal (WR-7) |
| P8 | X1(c) «available counted Sunday» does not say whether a rule exclusion of `Sun.Lead` on that Sunday makes it unavailable | Yes: an excluded Sunday cannot be led, so it cannot make the month «on» | CAD-2 |
| P9 | The canonical name `fairnessMonthCommit.ts` triggers ADR-0043's `DELIVERY_CAPABLE_IMPORTS` pin, forcing `withVerificationRunContext` on a route that delivers nothing | Accept (harmless, consistent); or rename outside `*Commit` with a parent amendment | GU-1 |
| P10 | No child owns the v3 resolution of on-screen pools and rules into per-role eligibility, yet the record and S1 must agree | C2 owns it (the record defines what «in» means); C6 consumes it for S1 | RES, Interfaces |
| P11 | F14 says both suites assert the fixture, while F7 gives X1 one implementation | Ledger cases: both suites; cadence cases: TypeScript only; C5 consumes the states | FX-3 |
| P12 | L3 defines create and replace only; §11 gives C4 «delete reconstructed records» as rollback, and «never a parallel writer» (L6) covers deletes too (also C4 PI-3) | L3 adds: «the reconstruction may delete a record it wrote itself, intact and under a revision check, through the same writer» | WR-13, WR-14 D1–D4 |
| P13 | L3 says past months are «written only by the reconstruction» but not that the reconstruction writes only past months; C4 R1 restricts itself | L3 adds «and the reconstruction writes only past months» | WR-14 row 1 (`not_past_month`) |

### Sibling changes this spec depends on (not made here)

| Sibling | Change | Why |
|---|---|---|
| C5 | Remove the Known-limits bullet «C2 attributes the forced seat by stored array order…» | LG-7 now orders holders by member id, as C5 §6.3 does |
| C6 | RQ-5: build count, pair and presence `roles` only with `rolesOfPatternV3` and count values only with `capValueForMonth`; add a pre-flight refusal when a request's `people` exceed 100 | RES-2/RES-3 own the one expansion and resolution; WR-4 and C5 §5.1 share the limit |
| C4 | R20(b): the pin is the write-request module's row in `PINNED_BEYOND_COMMIT`, scanned over `app/` and `scripts/` (WR-16); C4 adds its script core to that row. Interfaces 2: the executor, delete rows and stored-document hash now exist (WR-14, WR-16, REC-6) | Closes C4's A1 |
| C4, C6 | Only if P1 is adopted: the dotted id in C4 Interfaces item 1 and C6 §4 | P1 |

## 13. Acceptance and verification

| Requirement | Acceptance evidence | Verification method |
|---|---|---|
| REC-1–REC-7 | Stored shape, keys, hash order-independence, a pinned digest | Unit tests of the write-request module; schema test |
| REC-8, REC-9, GU-1, GU-2 | Governed type; audit, caller pin, SR scan, draft gating, client boundary green | The existing guard suites, edited only by the additions named |
| WR-1–WR-13, WR-15 | Every decision row; all-or-nothing; create collision; revision mismatch; unknown errors thrown; no side effects | Route tests with mocked Sanity (conflict fixtures shaped as `sanityConflictKind` expects); table-driven decision tests |
| WR-14 | Reconstruction write and delete rows, including `not_past_month`, `not_reconstruction_owned` and `record_edited` | Table-driven unit test; route cannot select the actor or `delete` |
| WR-16, WR-17 | One executor issues every mutation; caller pin covers `app/` and `scripts/`; body validator exported and re-run by the executor | Executor tests with a fake client's mutation log; extended `serviceCommitCallers.test.ts`; audit test |
| LG-1–LG-17, FX-1–FX-5 | Every required fixture case passes; sums to zero on exact values | vitest over `fixtures/fairness/golden.json`; Python from C5 on |
| CAD-1–CAD-3 | Every cadence case | vitest |
| RD-1–RD-5 | Fail-closed on each read; never empty; gate; payload at the limits | Reader and route tests |
| RES-1–RES-7 | Pools, exclusions, exact (incl. relative and zero), week exclusions incl. the trailing Saturday, presence exclusivity; names: an ambiguous name (one member's `member_name` equal to another's alias) and an unresolved name both refuse, each named; a namesake outside `voz` still makes a name ambiguous; `rolesOfPatternV3` restricted to five keys equals `rolesOfPattern` for every saveable pattern and alias; `capValueForMonth` on a 4- and a 5-Sunday month | Unit tests; pattern sync test |
| UI-1–UI-7 | Mounted beside, closed by default, banner, tabs, phone cards, «Registrar» absent under v2 and present under v3, dialog stays open on each refusal | Component tests; `cueDialogMount.test.ts`; Preview look via `scripts/dev-verify.ts` (read-only) and Frank's own look |
| EN-1–EN-3 | Constant `v2`; override honoured only on Preview with an exact value; SECRETS entry | Unit tests of the resolution; doc review |
| GU-3, GU-4 | ADR merged with the change; docs current | Code review (docs-audit checklist) |
| All | `npx tsc --noEmit`, `npm test`, `npx eslint .` with 0 errors | CI `gates` |

## 14. Safe end state, release and rollback

- **Safe end state.** The type, writer, ledger, GET, fixture and preview are live; the effective
  engine is `v2` everywhere, so the PUT answers `engine_not_v3` and «Registrar» is not rendered;
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
- Parent issues P1–P13 go to the parent's owner; a material change to the parent restarts review from
  the parent.
- Prior planning dialogue excluded from reviewers: yes. Implementation authorization: **not granted
  by this document.**

## Terminal state

`READY_FOR_ADVERSARIAL_REVIEW`
