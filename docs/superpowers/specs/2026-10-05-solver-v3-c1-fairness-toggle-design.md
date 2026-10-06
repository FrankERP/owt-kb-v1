# Solver v3 · C1 — «Cuenta para equidad»: the `countsForFairness` toggle end to end — design spec

**Date:** 2026-10-05 · **Status:** `DRAFT` · **Child of:**
[`2026-10-05-solver-v3-fairness-design.md`](2026-10-05-solver-v3-fairness-design.md) (parent, `APPROVED`),
which owns the policy; this child owns parent **L1** and the toggle half of **U7**, and is the primary
child for parent requirement **R7**.

**Risk tier: critical.** It changes the request payload, the stored document and the idempotency
fingerprint of the production service writers (`POST /api/admin/roles`, `PATCH /api/admin/roles/[id]`),
and the notification behaviour of the edit writer. CLAUDE.md's critical list names «a production/server
writer or mutation trust boundary»; the parent's §11 table marks C1 critical for the same reason.
Requirement: two sequential fresh `APPROVED` verdicts on byte-identical text before implementation; the
churn cap applies.

**Contracts, not prescriptions.** This spec states what must be true and what must never happen. File and
function names below are cited as evidence of today's code (verified at `3dbc189b`; `2d90e4b3` and
`ee91d0e0` differ from it only under `docs/superpowers/`, so every code citation still holds); helper names, loop shapes and
test file layout belong to the plan, except the names in §9 «Interfaces», which other children import.

**Revision.** Aligned on 2026-10-05 with the parent's amendments A1–A39 (parent §3), which win over the
parent's older clause wording. The ones that touch this child: **A1** (C1 creates the engine module),
**A25** (L1's toggle-only wording; lookback services not toggleable), **A13** (rules see every weekend
service; lines count counted ones), **A5/A6** (a counted special gates the month's record), **A15**
(`prior` is built from the GET this child extends), **A27** (a counted special gates the record's
replacement and binding only, never its creation — §9) and **A31** (amendments to existing ADRs are
C7's — C1-D6, §11). A28–A30 and A32–A39 were read against this child and change nothing in its scope
(flip and rollback steps, display rounding, floor seats, the cadence invariant, rule-name matching, CI,
reconstruction dates, exact-count refusal, response seat counts).

**Names.** This repository is public. Every example and fixture uses fictitious people («Ana», «Beto»).

## Original request

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
> — and, approving the parent, 2026-10-05: «Aprobado, sigue con los specs de las entregas»

The decision this child implements is Frank's **D6** («Every service gets a toggle «Cuenta para
equidad», visible when creating a service and when editing the month, specials included») with the
defaults of **D14** («weekend services count, specials do not»).

## 1. Outcome

- **Primary outcome.** Every `sunday_role`, `saturday_role` and `special_role` document can say whether
  it counts toward fairness. The admin sets it when creating a service (month create flow, the special
  composer, «+ Nuevo servicio») and changes it when editing the month (stored-mode header). The value is
  stored, read through one rule, and **inert**: until the v3 engine serves Auto, nothing computes with
  it, and every control says so.
- **Operator.** The worship admin (today Frank) in `/admin` → Servicios → the month planner.
- **Current behaviour and gap.** No such field exists. Whether a service counts is implied by its type:
  ADR-0010 decision 1 keeps specials out of the solver, and v2's history counts weekend roles only
  (`serviceReadQueries.ts:383-397`, «the two types the solver's history counts»). The v3 ledger (C2) needs
  a per-service answer, with no migration of the existing documents.
- **Success measure.** A service created or edited with the switch stores the boolean the admin chose; a
  document without the field reads as its type's default; no existing fingerprint, receipt replay,
  notification, readiness verdict, MCP output or v2 solve request changes; the four gates pass.

## 2. Evidence

| Fact | Source | Implication |
|---|---|---|
| The create fingerprint canonicalizes the payload under `FINGERPRINT_VERSION = 1`; `time` and `format` enter it **only when present**, «so the fingerprint of every time-less payload is byte-identical to what it was before the field existed (an in-flight retry across the deploy still matches its receipt)» | `app/utils/roleCreationReceipt.ts:33-34`, `:62-73`, `:186-192` | The toggle follows the same discipline, keyed on the type default (L1): no version bump, no hash change for any payload that leaves the default |
| An equal request id with a different fingerprint is `409 idempotency_mismatch`; equal is a replay with no writes | `roleWriteRequest.ts:706-743` (`decideReceipt`); `app/api/admin/roles/route.ts:131-135`, `:376-401` | Including a non-default toggle in the fingerprint means a retry with a flipped toggle can never silently replay the old value |
| No test pins a literal fingerprint today | `app/utils/__tests__/roleCreationReceipt.test.ts` (no 64-hex literal) | The "hashes unchanged" claim needs frozen literals captured before the change (§7, step zero) |
| A second copy of the canonical rule exists for the verification harness, parity-tested over a payload table with no `time`/`format` rows — it already models only what the harness sends | `scripts/lib/sr-verification.mjs:477-510`; `scripts/lib/__tests__/sr-verification.test.mjs:508-537` | The table gains default-valued toggle rows; they prove the omit-at-default rule in both copies |
| `buildRoleDocument` writes `time`/`format` only for specials; `buildRoleEditPatch` **unsets** `time` when the request omits it | `roleWriteRequest.ts:203-230`, `:236-256` (`:254`) | The toggle must NOT copy the `time` precedent on edit: absent means unchanged (L1), never cleared |
| Every PATCH rewrites all five seat arrays with fresh `_key`s | `roleWriteRequest.ts:156-174`, `:236-251` | A toggle-only PATCH is not a minimal patch; `_key`s do not survive it (unchanged behaviour, stated) |
| `parseCreateRequest` / `parseEditRequest` ignore unknown body keys | `roleWriteRequest.ts:283-318`, `:335-362` | An old server ignores the field (rollback skew, §8); a new server must validate it explicitly |
| Every PATCH of a published role queues one outbox upsert per member in the union of before/after assignees, whether or not anything changed; an upsert on a pending notice pushes `notifyAfter` out and clears `servedRecipients` | `[id]/route.ts:413-433`; `serviceMutationSideEffects.ts:478-529`; `outboxNotice.ts:148-184` | A toggle-only save today would re-debounce a pending notice about a real change and write outbox documents, though flush would send nothing (`outboxClassify.ts:72`, `sameSet` → no line). This is the harm L1's «queues no notification» prevents |
| The flush compares each member's role labels as a set; the immediate push goes only to added assignees | `outboxClassify.ts:44`, `:72`; `assignmentEmail.ts:65-73`; `serviceMutationSideEffects.ts:329-352` | «No member-visible change» has an existing, exact definition to reuse |
| `ROLE_PROJECTION` is read by the readiness loader, the MCP snapshot, the three service-integrity routes, `roleSwapCommit`, `proposalNotify`, v2's `solverHistory*` and the role writers' own loads | `serviceReadQueries.ts:17-26`; consumers: `publishReadyBundle.ts`, `app/mcp/reads/serviceSnapshot.ts`, `participationPresenter.ts`, `app/api/admin/service-integrity/*/route.ts`, `roleSwapCommit.ts`, `proposalNotify.ts`, `solverHistory.ts`, `solverHistoryEvidence.ts`, `solverHistoryRead.ts`, `roleWriteOps.ts` | Parent L1 keeps the readiness/MCP loaders unchanged and gives the ledger its own query: the toggle is read elsewhere and `ROLE_PROJECTION` stays byte-identical |
| `loadServiceSnapshot()` is text-pinned to `loadServiceReadinessSources()` | `app/mcp/reads/__tests__/serviceSnapshotMirror.test.ts:1-35`; `publishReadyBundle.ts:140` (ADR-0040) | Neither loader is touched |
| R11's evidence rebuilds a create payload from a `ROLE_PROJECTION` row and compares it with the creation fingerprint | `solverHistoryEvidence.ts:120-150`; `:153-169` (`isEmptySeatCreate`); consumer `scripts/lib/solverHistoryDiff.ts:848`, `:1113` | With the projection unchanged, the rebuild is toggle-blind — a known limit (§10) |
| The four commit modules and the other role writers patch named fields only: `published`, seat paths, `instruments`, setlist `songs`, lock heartbeats | `roleUnpublishCommit.ts:197`; `publishReadyCommit.ts:127`; `roleSwapCommit.ts:321-329`; `setlistSaveCommit.ts:226-237`; `app/api/admin/roles/copy-instruments/route.ts:143-150`; `app/api/admin/roles/publish/route.ts:175` | None reads or writes the toggle; all preserve it. `serviceCommitCallers.test.ts:39-45` does not move |
| MCP has no role create or edit tool | `app/mcp/tools/` (editSetlist, publishService, swapAssignment, unpublishService and read tools) | MCP needs no change; `app/mcp/**` is outside C1's diff |
| `GET /api/admin/roles` builds its own inline projection (`"published": coalesce(published, true)`), admin/super-admin only; it feeds the planner's stored source, `ServicesPanel` and `AvailabilityPanel` | `app/api/admin/roles/route.ts:47-84`; `serviceSourceState.ts:140`; `AvailabilityPanel.tsx:92`; test pin `roleWriteRoutes.test.ts:465` | The one place the planner learns the stored value |
| Stored-mode dirtiness and save reconciliation compare a semantic snapshot derived from the PATCH body | `plannerSaveModel.ts:6-30`, `:122-156`, `:229-250`; `MonthGenerator.tsx:2266-2279`, `:2440-2470` | The toggle must be in the body and the snapshot, or a toggle-only change is not dirty and an unknown-outcome save reads «applied» while it did not land |
| Header edits overlay stored columns through `storedHeaderEdits`; swaps are refused while any column is dirty | `MonthGenerator.tsx:2069`, `:2266-2272`, `:2986-2998`; `:3217-3220` | The toggle edit rides the existing header-edit path; a swap's expected snapshot always carries the stored value |
| «+ Nuevo servicio» keys its creation request id on `JSON.stringify({type, date, name, time, format})`; its controls are disabled while `storedMutationLocked`, which includes an unresolved attempt; a created role is «verified» only when the reload shows it as requested | `MonthGenerator.tsx:3067-3110` (`:3086`); `:2290-2299`; `:2518-2541` | The toggle joins the attempt identity and the verification |
| Month-create drafts keep one `creationRequestId` for the draft's whole life, across seat edits and retries | `app/utils/monthDraftCreate.ts:1-12`, `:26-50`, `:65-84`; `plannerModel.ts:1739-1820` | Flipping a toggle after an attempt whose outcome is unknown behaves like editing a seat today (§10) |
| `buildSolveRequest` takes config, members, dates and history — no columns; `historyEntryFromDrafts` takes drafts | `plannerModel.ts:1273-1288`, `:1909` | v2's request cannot see the toggle; the local history entry must be pinned unchanged |
| The planner's month pills start at the current month | `app/components/admin/monthPills.ts:14-18` | No surface can toggle a service of the three lookback months — accepted by the parent (A25) |
| `ServicesPanel`'s only modal is delete; it never PATCHes a role's fields | `ServicesPanel.tsx:210`, `:472-500` | The planner grid is the only edit surface |
| Role documents are `readOnly: true` in Studio, with no create or mutating action; `published` is a visible boolean field on them | `sanity/schemas/sunRole.ts:11`, `:31-37`; `studioProtection.ts:189-192` | The field is operator-visible and read-only in Studio, like `published`; not an internal field |
| The engine-switch module does not exist yet; its sibling constant module is neutral with an explicit type annotation (TS2367) | `app/components/admin/solverHistorySource.ts:20-54` | C1 creates `solverEngine.ts` in that shape (parent A1; §6.6) |
| `groq-js` is a dependency and already evaluates GROQ in tests | `package.json:86`; e.g. `app/utils/__tests__/outboxSweep.test.ts` | The read-rule sync test evaluates the real fragment |
| The design reports' composer help text («en sábado cuenta como sábado; otro día, como domingo») is reversed relative to D14/F1 | private `evidence/d_persistence-ux.md` §4 vs parent D14, F1 | Parent wins: Sunday-dated → Dom Lead, any other day → Sáb Lead |

## 3. Decisions

### Inherited (parent, binding)

- **L1** — field name, the three types, the legacy read rule `coalesce(countsForFairness, _type != "special_role")`
  with no migration, PATCH-absent = unchanged, fingerprint includes the field only when it differs from
  the type default with no `FINGERPRINT_VERSION` bump, readiness/MCP loaders, `computeParticipation` and
  «Incluir especiales» unchanged, the ledger reads through its own query.
- **A25** (wins over L1's «a toggle-only PATCH queues no notification») — «A PATCH that carries the field
  and changes nothing a notice could report queues no notification» (§5.4, C1-D2); services in lookback
  months cannot be toggled from any surface, accepted and revisited at C7's look (§14 Q1).
- **A1** — C1 creates `app/components/admin/solverEngine.ts` with the constant `SOLVER_ENGINE` only. The
  effective-engine resolver, the Preview-only `OWT_SOLVER_ENGINE` override, its `docs/SECRETS.md` entry
  and the fairness PUT's `engine_not_v3` are C2's; the solve route's `409 solver_version_mismatch` and the
  server-resolved engine passed to the planner are C6's (§6.6).
- **A13** — lines and protections count counted services only; rules see every weekend service, counted
  or not (§5.1).
- **D6/D14** — the switch on every create and month-edit surface, specials included; weekends default
  on, specials off.
- **U7** — the switch is editable from C1 on and says «aplica con el nuevo solver» while the engine is v2.
- **§9** — the v2 path stays byte-identical while it is the engine.

### This child's decisions

| ID | Decision | Why | Rejected alternative |
|---|---|---|---|
| C1-D1 | `ROLE_PROJECTION` stays byte-identical; the toggle is read by the `GET /api/admin/roles` projection and by C2's own query, never through the shared projection | It reaches the readiness loader, the MCP snapshot and v2's history (Evidence); L1 keeps those unchanged | Adding the raw field to `ROLE_PROJECTION`: would make R11's evidence toggle-aware, at the price of changing what eight readers receive, two of which L1 names as unchanged |
| C1-D2 | «Toggle-only PATCH» is defined semantically: the request **carries** `countsForFairness` **and** changes nothing a notice could report (§5.4). A request without the field keeps today's behaviour exactly, including a no-op save's queueing | Every PATCH carries the full roster, so «toggle-only» is not a request shape. Restricting suppression to requests carrying the field leaves every pre-C1 client byte-for-byte unchanged. The parent adopted this wording as A25 | Suppressing every no-op PATCH: also sound, but changes an existing path outside C1's scope |
| C1-D3 | The field is `true`, `false` or absent. `null` and any other value is refused (`400 invalid_request`, issue `countsForFairness`) on create and edit | A boolean has no «empty» value; reading `null` as «default» on PATCH would be a silent reset; «describe what gets written» (`roleCreationReceipt.ts:155-171`) | Treating `null` as absent, like `time` |
| C1-D4 | Every document the create writer makes after C1 stores the explicit effective boolean; the edit writer sets it whenever the request carries it | New documents stop depending on the default rule; the rule then only covers legacy documents | Storing only non-default values |
| C1-D5 | The stored-mode PATCH body always carries the column's effective value | The dirty check and the reconciliation derive from the body (`plannerSaveModel.ts:135-138`); the `_rev` assertion makes a stale value a `409`, never an overwrite | Sending only when changed |
| C1-D6 | No new ADR, and no amendment of an existing one (A31: those are C7's). ADR-0010 gets a dated forward note only — no status-line change, no change to any decision's text — which C7 turns into the in-force date when it amends decision 3 (C7 Step 5, ADR table row 0010); CLAUDE.md gets the invariant (§11) | The fingerprint and PATCH rules follow existing precedents documented in code; the policy decision is the parent's, and its ADR amendments land at cutover (C7, A31) | A C1 ADR; C1 amending ADR-0010's decision 3 now, while v2 still serves Auto |

## 4. Requirements

| ID | Requirement | Acceptance criterion |
|---|---|---|
| C1-R1 | The three role schemas declare `countsForFairness` (boolean), visible and read-only in Studio | Studio shows «Cuenta para equidad» on each type; the documents stay read-only; `studioProtection` tests green |
| C1-R2 | One read rule: one GROQ fragment, one TS twin, one default function | A `groq-js` sync test: fragment = twin on {absent, `null`, `true`, `false`} × three types |
| C1-R3 | Create accepts the field, validates it, stores the effective boolean | Route tests: absent → type default stored; `true`/`false` stored; `null`/`"true"`/`1` → 400, nothing written |
| C1-R4 | The fingerprint changes only for non-default values; `v` stays 1 | Frozen pre-change literals stay green; default-explicit = absent; non-default differs; flipped toggle on the same request id → `409 idempotency_mismatch` |
| C1-R5 | Edit: absent leaves the stored value untouched; a boolean sets it; anything else is refused before any read | Route tests on all three types; the patch for an absent field has the key in neither `set` nor `unset` |
| C1-R6 | A toggle-only PATCH queues no outbox notice and sends no push | Route test on a published role: zero outbox upserts, zero pushes, revalidation still called; toggle + seat change queues exactly as today |
| C1-R7 | Every other writer and reader is unchanged | C1's diff touches no `*Commit.ts`, `publishVerdict.ts`, `publishReadyBundle.ts`, `app/mcp/**`, `computeParticipation.ts`, `ParticipationSidebar.tsx`, `solverHistory*.ts`, `gcf/**`; `ROLE_PROJECTION` equals its frozen literal; mirror, parity and caller-pin tests green unchanged |
| C1-R8 | `GET /api/admin/roles` returns each role's effective `countsForFairness` | Route test: query contains the fragment; a legacy weekend row reads `true`, a legacy special `false` |
| C1-R9 | The planner carries the value through every create and edit body, dirty check and reconciliation | Model tests (§7) |
| C1-R10 | The Switch appears on the four surfaces with the defaults, states and copy of §6 | Component tests (§7) |
| C1-R11 | C1 creates `solverEngine.ts` with the constant only (A1); «aplica con el nuevo solver» shows exactly while the engine is v2 | A test pins `SOLVER_ENGINE === "v2"` and its `"v2" \| "v3"` annotation; the module has no `"use client"` and no imports; `clientBoundary` green; component tests with the engine constant mocked both ways |
| C1-R12 | v2 is inert to the toggle | `buildSolveRequest` output and `historyEntryFromDrafts` output identical with every toggle on and every toggle off; v2's Python suite untouched |
| C1-R13 | Documentation in the same delivery | §11 items present in the PR |

## 5. Server contracts

### 5.1 The stored field

- `countsForFairness`: a boolean on `sunday_role`, `saturday_role` and `special_role`. **Absent** on every
  document created before C1, and on documents any other path writes (retired scripts fail closed;
  verification fixtures create synthetic documents without it). **Never `null`** through any writer.
- **Meaning** (consumed by C2, not computed here): a service that does not count creates neither share
  nor received seats; a counted special maps its Lead to Dom Lead on a Sunday and to Sáb Lead on any
  other day, its BGV to BGV, its Chorus to Coro (parent D14, F1). «Does not count» is not «invisible»:
  lines and protections count counted services only, but rules see every weekend service, counted or
  not (A13), and an uncounted weekend service still reaches the v3 solver and is staffed (C5 §5 request table, service field
  `counts: false`; only uncounted specials are never sent, U3). Under v2 nothing reads it.
- **Studio.** A visible boolean titled «Cuenta para equidad», with a Spanish description stating the
  absent rule («Vacío = valor del tipo: domingo y sábado sí, especial no. Solo lo usa el nuevo solver.»).
  It is not in `INTERNAL_STUDIO_FIELDS`; the documents stay `readOnly: true` with every mutating action
  removed. If an `initialValue` is declared it equals the type default; it has no runtime effect because
  the Studio cannot create these documents.

### 5.2 The read rule (one definition)

- **GROQ fragment:** exactly `coalesce(countsForFairness, _type != "special_role")`.
- **TS twin:** for a document `{ _type, countsForFairness }`, the stored value when it is a boolean, the
  type default when it is absent or `null`.
- **Type default:** `sunday_role` → `true`, `saturday_role` → `true`, `special_role` → `false`.
- **Domain.** The fragment and the twin are required to agree on {absent, `null`, `true`, `false`} for
  each of the three types. No writer produces any other value (§5.3, §5.4) and the Studio cannot write
  these documents, so out-of-domain input is not part of the contract.
- **One place.** The fragment, the twin and the default live in **one neutral module** (no
  `"use client"`, no server-only import — ADR-0028), importable by route handlers, the server-only
  receipt module, C2's ledger and client components. No other file spells the default or the
  fragment; a client that needs the default calls the default function.
- **Audit scope.** The module runs no query and imports no Sanity client, so the protected-read audit
  yields no site for it (`protectedReadAudit.ts:782-786`: a file with no client identifier is not
  scanned) and it needs no registry entry, although its fragment and default name `special_role`. The
  `GET /api/admin/roles` query that embeds the fragment stays what it is today: a protected-literal read
  through the canonical operational client. No file under `app/mcp/` imports or spells the field
  (`mcpProtectedTypeLiterals.test.ts` unaffected).

### 5.3 Create — `POST /api/admin/roles`

1. **Validation.** The body may carry `countsForFairness` on any of the three types. Absent → the
   effective value is the type default. `true`/`false` → that value. Any other value, `null` included,
   is an issue `countsForFairness`, and the request is refused `400 invalid_request` before any read or
   write, like an invalid `time` (`roleCreationReceipt.ts:158-162`). `canonicalizeCreatePayload` still
   never throws and stays deterministic for an invalid value.
2. **Fingerprint.** The canonical payload gains a `countsForFairness` key **only when** the effective
   value differs from the type default (a weekend `false`, a special `true`). `FINGERPRINT_VERSION`
   stays `1`. Consequences, each a test:
   - every payload without the field, and every payload carrying its type's default explicitly, hashes
     byte-identically to today — so a receipt written before C1 replays a retry sent by an old tab, and
     a new tab sending the default explicitly hashes the same as an old one sending nothing;
   - a non-default value changes the hash; the same request id with the toggle flipped is
     `409 idempotency_mismatch`, never a replay that silently keeps the first value;
   - an invalid role type or date leaves the key out (the payload is refused anyway).
3. **Stored document.** Always carries the explicit effective boolean (C1-D4), in the same single
   transaction as today (receipt + role + lock or special coordinator). The receipt document's shape is
   unchanged; `creationFingerprint` on the role is the fingerprint above.
4. **Side effects.** Unchanged: revalidation, the immediate push and the queued outbox notice depend on
   seats and `published` only. No notice ever mentions the toggle.
5. **Response.** Not a contract for the toggle: a first create echoes the document (explicit field), a
   replay returns the `ROLE_PROJECTION` row (no field). Clients learn the stored value from
   `GET /api/admin/roles` only.

### 5.4 Edit — `PATCH /api/admin/roles/[id]`

1. **Validation.** As §5.3.1, in the edit parser, before any read: absent, `true`, `false`, or refused.
   Accepted on all three stored types.
2. **Absent means unchanged.** When the request does not carry the field, the patch contains no
   `countsForFairness` key in `set` **and none in `unset`**. This is deliberately **not** the `time`
   precedent, where an absent value clears the field (`roleWriteRequest.ts:252-254`). A tab loaded
   before C1 shipped therefore never resets the toggle.
3. **Present means set.** A boolean is set in the same revision-asserted transaction as the rest of the
   edit (`[id]/route.ts:291-347`). Everything else is unchanged: the `_rev` assertion, the owned lock and
   its heartbeat, date moves, the special identity coordinator, the dependency refusal on moves, the
   legacy-lock bootstrap that stops before the business write, and the rewrite of all five seat arrays
   with fresh `_key`s.
4. **Toggle-only PATCH queues nothing.** When the request **carries** `countsForFairness` **and** all of
   the following hold against the stored role the route already loaded (`loadRoleForWrite`), the route
   queues **no** outbox notice and sends **no** push:
   - the date does not move;
   - for a special: the normalized service name and the time are unchanged (the email names a special by
     both, `emailServiceLabel.ts`);
   - for every member in the union of stored and requested assignees, the set of role labels they hold
     is unchanged — the same per-member comparison the flush makes (`rolesForMember`,
     `outboxClassify.ts:72`).

   In every other case — including any request without the field — notices are queued and pushed
   exactly as today. Revalidation runs in every case. Whether the stored toggle actually differs is
   irrelevant to this decision, so the route needs no read of the stored toggle and `ROLE_PROJECTION`
   does not change. A draft (`published: false`) stays silent as today.
5. **Response.** Unchanged shape (the refreshed read comes from `ROLE_PROJECTION`, so it does not carry
   the field). Not a contract for the toggle.

### 5.5 Every other writer — unchanged

- `publishReadyCommit`, `roleUnpublishCommit`, `roleSwapCommit`, `setlistSaveCommit`, the publish and
  copy-instruments routes and the delete handler neither read nor write the field; they patch named
  fields (Evidence), so the toggle survives every one of them. **A swap — seat, section or team — never
  moves or changes the toggle**: it belongs to the service, not to the team.
- No file named `*Commit.ts` is added or changed; `serviceCommitCallers.test.ts`'s table does not move.
- MCP writers (`publish_service`, `unpublish_service`, `swap_assignment`, `edit_setlist`) go through those
  modules and are untouched. A future MCP create path (P4, unbuilt and re-baselined onto v3 by the
  parent) inherits §5.3: absent means the type default.

### 5.6 Readers

- **`GET /api/admin/roles`** adds `"countsForFairness": <fragment>` to each row; every other field and
  the admin/super-admin gate are unchanged.
- **Unchanged, byte for byte:** `ROLE_PROJECTION` and every query built from it; `loadServiceReadinessSources`
  and `loadServiceSnapshot` (ADR-0040) and their mirror/parity tests; every MCP presenter and tool output
  (the toggle is not exposed over MCP); `computeParticipation` and the sidebar's «Incluir especiales»
  switch, which keeps counting specials for display whatever their toggle says; v2's history derivation
  (`solverHistory.ts`, `solverHistoryRead.ts`, `solverHistoryEvidence.ts`); `validateRole` and the
  service-integrity routes.
- **The ledger** (C2) reads the field through its own query using the fragment (§9).

## 6. Client and UI contracts

### 6.1 The model

- Every grid column carries its **effective** boolean, in create and stored mode alike. No client code
  decides a default except through the default function.
- **Create mode.** A column enters the selection at its type default (a special: the composer's choice,
  §6.3). The admin's changes are held per column for as long as the column stays in the selection —
  across the config and grid steps, an «Omitir», and any number of Auto runs; **Auto never changes a
  column's value**. Removing the special or deselecting the weekend date discards the value; re-adding
  starts again from the default (or the composer's choice). Each draft carries its column's value and the
  create body sends it.
- **Stored mode.** A column's value is the `GET /api/admin/roles` row's value; a row without the field (an
  old server during a rollback) reads as the type default. The header edit overlays it like a date, name
  or time edit (`storedHeaderEdits`). The PATCH body always carries the column's effective value
  (C1-D5) and the semantic snapshot includes it, so:
  - a toggle-only change makes the column dirty and counts in «Guardar N servicios» and «N con cambios»;
  - a save whose reload shows the intended value reconciles `applied`; a save with an unknown outcome
    whose reload shows the old value reconciles `unknownConflict`, never `applied`; a committed save
    superseded by another writer reconciles `committedThenSuperseded`, as today;
  - a swap's expected snapshot carries each service's stored value, and a swap is still refused while any
    column is dirty, so a swap verifies exactly as today.

### 6.2 Create-mode column header (grid)

- A `Switch` (the house control; `size="sm"`) labelled «Cuenta para equidad» on every column that will be
  created. Its accessible name identifies the column the way «Omitir» does (`PlannerGrid.tsx:2514-2521`).
- **Not shown** on a column blocked from creation («Ya existe…», «Ya lo creaste en esta sesión») — that
  service's value is stored and is edited in stored mode; showing the default there would misstate it.
- Enabled on a skipped column (skipping is reversible and keeps the value); disabled while a create batch
  is in flight.

### 6.3 The special composer (month calendar)

- A `Switch` «Cuenta para equidad», **off** by default each time the composer opens, with the help line:
  «Si cuenta, su Lead suma como Dom Lead en domingo y como Sáb Lead en otro día; BGV y Coro suman igual.»
- The value chosen when the special is added becomes its column's initial value (§6.1).

### 6.4 Stored-mode column header (grid)

- A `Switch` «Cuenta para equidad» on every stored column, beside Fecha / Nombre / Hora. Disabled exactly
  when those are (`readOnly`, or the stored mutation lock); it is **not** gated by the date-move block,
  which concerns the date only. Saved only by «Guardar», through the PATCH.

### 6.5 «+ Nuevo servicio»

- A `Switch` «Cuenta para equidad» that shows the selected Tipo's default (Domingo, Sábado: on; Especial,
  Noche de alabanza: off) and **follows the Tipo until the admin touches it**; after that it keeps the
  admin's value until the composer resets (Cancelar, or a verified create). For a special it shows the
  help line of §6.3.
- Disabled whenever the other composer controls are (`storedMutationLocked`, which includes an unresolved
  attempt), so it cannot change under a pending request.
- The value is part of the attempt identity: a different value is a different creation request. A create
  is «verified» only when the reload shows the role with the requested value as well as the requested
  type, date, name, `published: false` and empty seats.

### 6.6 «aplica con el nuevo solver»

- While the engine is v2, every surface that shows the switch also shows, once, visible without
  interaction and next to the switch(es): «Cuenta para equidad: aplica con el nuevo solver. Hoy Auto no lo
  usa.» Once per surface: the grid (both modes) shows it once, not per column; each composer shows it once.
- **The engine module (A1).** C1 creates `app/components/admin/solverEngine.ts` containing only the
  constant — `SOLVER_ENGINE`, explicitly typed `"v2" | "v3"`, value `"v2"` — neutral (no `"use client"`,
  no imports) and annotated like `solverHistorySource.ts:20-54`. C3 never creates or imports it (C3
  §Non-goals); C2 and C6 add to it or beside it and never change the constant's value or annotation
  (C6 ENG-1). C1 reads no environment variable and adds no `docs/SECRETS.md` entry.
- **Reading the engine.** The note's condition reads `SOLVER_ENGINE`. The resolver of the effective
  engine and the Preview-only `OWT_SOLVER_ENGINE` override are C2's (A1); C6 rewires this note to the
  server-resolved engine prop and hides it when that prop says v3 (C6 CTL-1, ENG-4). Until C6, reading
  the constant is accurate on every deployment, a Preview with the override set included: the override
  changes C2's surfaces only, and Auto runs v2 until C6 lands (§9).

### 6.7 Preserved UI invariants

House `Switch` only (never a bare checkbox input); no `CueDialog` or toast changes; no page-level
horizontal scroll on `/admin` (ADR-0035 — the header switch lives inside the grid's own scroller);
`Button`/`Menu` usage unchanged; client mutation handlers keep try/catch/finally, `res.ok` and their
loading flags (they gain a field, not a flow).

## 7. Inertness under v2 and the tests that prove it

**Step zero — freeze before changing.** The delivery's first commit, on the unchanged code, adds:
- literal fingerprints for a payload table — weekend and special, with and without `time`/`format`,
  `published` true and false, empty and filled seats, a datetime-prefixed date — asserted against
  `payloadFingerprint`;
- a literal of `ROLE_PROJECTION`, asserted for equality.

Both stay green through the whole delivery. A red literal is a finding, never a re-capture.

**Required tests** (vitest; Python is untouched):

| Area | Must prove |
|---|---|
| Read rule | `groq-js` evaluates the fragment over 12 documents ({absent, `null`, `true`, `false`} × 3 types) and matches the twin and the default |
| Fingerprint | step-zero literals green; default-explicit ≡ absent for each type; non-default ≠ absent; `v` = 1; invalid value yields an issue and a deterministic canonical value |
| Harness mirror | `sr-verification`'s parity table gains default-valued rows (weekend `true`, special `false`) that hash identically in both copies; whether the mirror also models non-default values is the plan's choice, as it does not model `time`/`format` today |
| R11 positive control | the existing round trip through the real create path (`solverHistoryEvidence.test.ts`) still reads `unchangedAs` with a body that carries the default explicitly |
| Create route | absent → default stored; `true`/`false` stored; `null`, `"true"`, `1` → 400 with no receipt, role or lock written; replay with the same value → 200 replay with no writes; same id, flipped non-default value → 409 `idempotency_mismatch`; notices identical to a toggle-less create |
| Edit route | absent → key in neither `set` nor `unset`; `true`/`false` → `set` on each type; invalid → 400 before any read; toggle-only on a published role → zero outbox upserts, zero pushes, revalidation called; toggle + seat change → union queued as today; toggle-only on a special with a renamed or retimed set → queued as today; a request without the field and no change → queued exactly as today |
| GET roles | the query contains the fragment; legacy rows read their defaults |
| Untouched paths | `serviceSnapshotMirror`/`serviceSnapshotParity`, `serviceCommitCallers`, `draftGatingCoverage`, `mcpProtectedTypeLiterals`, `clientBoundary` green with no edit to their tables; `protectedReadAudit` green with no entry added or removed (only the two `reason` strings of §11 change); `ROLE_PROJECTION` literal green |
| Save model | body and snapshot carry the value; toggle-only is dirty; reconciliation cases of §6.1 |
| Read model | a stored column carries the row's value; a row without the field reads the type default |
| Draft create | `draftCreateBody` sends the draft's value; batch behaviour otherwise unchanged |
| Planner model | columns enter at the type default; drafts carry the per-column value; `historyEntryFromDrafts` identical with all toggles on and all off; `buildSolveRequest` identical (it takes no columns) |
| UI | the four surfaces (§6.2–6.5): default, disabled and hidden states, accessible names, copy; the composer's value reaches its column; «+ Nuevo servicio» follows the Tipo until touched and keys the attempt on the value; the note shows under `"v2"` and not under `"v3"` (constant mocked) |
| Studio | the field exists on the three types, is not hidden, the documents stay read-only |
| Engine module | `SOLVER_ENGINE === "v2"` with its `"v2" \| "v3"` annotation; no `"use client"`, no imports; `clientBoundary` green. The test asserts nothing about other exports, so C2's resolver may join the module without C1's test being edited |

The four gates: `npx tsc --noEmit`, `npm test`, `npx eslint .` with 0 errors; the Python gate does not
apply (no `gcf/**` change).

## 8. Rollout, rollback, failure

- **Release.** One PR, the standard order: preview first (verify the dev alias and SHA), then the PR to
  `main`. No data migration and no production write by the delivery itself: the first stored values come
  from the admin's own creates and edits. **Preview writes the production dataset** — a toggle flipped on
  dev is a real value on a real service (inert under v2, but real for C2's ledger later).
- **Studio.** Embedded; the field ships with the app. A hosted-schema deploy, if made, follows existing
  practice (`docs/DATA_MODEL.md:687`) and is not part of the acceptance.
- **Deploy skew.** An old tab against the new server sends no field: create stores the default, edit
  leaves it unchanged. A new tab can meet an old server only after a rollback: the old server ignores the
  field, so a create stores no value (reads as default) and a toggle-only save reconciles
  `committedThenSuperseded`, which the planner reports — not silent. Reload open tabs after a rollback.
- **Rollback.** Revert the PR. Documents that carry the field keep it; v2 never reads it; the Studio
  shows it as an unknown field until it is restored. A create retried across the revert with a
  non-default value gets `409 idempotency_mismatch` (its hash changes back) — visible, no data lost.
  Nothing to clean up (parent: «field is ignorable»). Once C2 or C6 has merged, they import
  `solverEngine.ts` (A1), so a revert of C1 keeps that module and reverts only the toggle; the
  `"v2"` constant changes no behaviour either way.
- **Partial failure.** None new: every write is the existing single transaction.

## 9. Interfaces

**C1 consumes** nothing from C2–C7. It reads `SOLVER_ENGINE` from the module it creates (A1); it never
reads `OWT_SOLVER_ENGINE` or the effective-engine resolver.

**C1 provides:**

| Item | Exact shape | Consumers |
|---|---|---|
| Stored field | `countsForFairness?: boolean` on `sunday_role`, `saturday_role`, `special_role`. Explicit on every document created after C1; set by a PATCH only when the request carries it; absent on legacy documents; never `null` | C2 (ledger), C4 (reconstruction prints it), C6 |
| Read-rule module | neutral `app/utils/countsForFairness.ts` exporting `COUNTS_FOR_FAIRNESS_GROQ` (the string `coalesce(countsForFairness, _type != "special_role")`), `countsForFairnessDefault(roleType: "sunday_role" \| "saturday_role" \| "special_role"): boolean`, and `countsForFairness(doc: { _type: string; countsForFairness?: boolean \| null }): boolean` | C2's query and fixture builder; the GET route; the receipt module; the planner |
| Not provided | `ROLE_PROJECTION` does not carry the field; readers built on it never see it | C2 must use its own projection |
| GET row | `GET /api/admin/roles` → each row has `countsForFairness: boolean` (effective) | C6: U3 (which stored specials count), the stored «Guardado» columns, and `prior` (A15, C6 RQ-7), whose `counts` reaches C5 as the service field `counts` |
| POST/PATCH body | `countsForFairness?: boolean`; semantics §5.3, §5.4 | any future create/edit caller (C6's 2-month confirm creates drafts through this POST) |
| Client types | `GridColumn.countsForFairness: boolean` (effective, both modes; `StoredGridColumn` inherits), `CreatableDraft`/`DraftCard.countsForFairness: boolean`, `StoredRolePatchBody.countsForFairness: boolean`, `RoleSemanticSnapshot.countsForFairness: boolean` | C6 (counted specials filled first, sent as pins; uncounted filled after the solve) |
| Engine constant | `app/components/admin/solverEngine.ts`: `export const SOLVER_ENGINE: "v2" \| "v3" = "v2"` — created by C1 (A1), containing nothing else | C2 (adds the effective-engine resolver, the Preview-only `OWT_SOLVER_ENGINE` override and its SECRETS entry, the PUT's `engine_not_v3` — A1), C6 (the solve route's `409 solver_version_mismatch`; wires the server-resolved engine into C1's note, CTL-1), C7 (flips the value). Not C3 (it never imports the constant) |
| Copy | «Cuenta para equidad»; «Cuenta para equidad: aplica con el nuevo solver. Hoy Auto no lo usa.»; «Si cuenta, su Lead suma como Dom Lead en domingo y como Sáb Lead en otro día; BGV y Coro suman igual.» | C6 may retire the note at cutover by the engine condition alone |

**Facts the consumers must hold:**

- A stored value can change after the fact (stored-mode edit), so a month's ledger is not frozen by its
  eligibility record. The toggle is an input the consumers read live, never a snapshot.
- A stored **special's** toggle takes part in the record gate: a month with a counted special cannot have
  its record replaced (A5) and its record binds the solve (A6); flipping that special to uncounted (with
  no stored weekend service in the month) lifts both, and flipping one to counted imposes both. C2's
  writer re-checks the gate at write time, so it must read the toggle through the fragment at that moment;
  C6's binding decision reads it from the GET rows at solve time. The gate governs **replacement and
  binding only**: a recordless month gets its record created by Auto's confirm whatever its counted
  specials (A27), so no toggle value ever blocks a create. The PATCH does not coordinate with the record
  writer (§5.4 is unchanged by A5): an edit racing a record write is the residual race C2 states for its
  freezing-services gate (C2 §4.2, «Residual race, stated»).
- Only a **counted** Sunday-dated service is a «counted Sunday» for the cadence state (X1, A14): a toggle
  edit on a current-month Sunday-dated service (weekend or special) can change the next run's derived
  state.
- Services of months before the current one cannot be toggled from any surface, so the lookback months
  read whatever was stored or their defaults (accepted, A25).
- A team swap never moves the value.

## 10. Known limits, stated

- **R11's evidence becomes toggle-blind** (C1-D1). `storedRoleCreatePayload` rebuilds from a projection
  without the field: a weekend role created with the toggle **off** reads `changed_since_creation` from
  birth and an off empty create is not recognised as `emptySeatCreate`; a toggle flipped after a default
  create still reads «unchanged». Bounded to weekend documents created off after C1 lands, in the
  history-diff tool whose cutover gate closed on 2026-09-28. Fixing it means `ROLE_PROJECTION` carries
  the field — rejected above.
- **Retrying a month-create draft after flipping its toggle** reuses the draft's request id
  (`monthDraftCreate.ts:1-12`): if the first attempt had in fact committed, the retry is
  `409 idempotency_mismatch` and the stored service keeps the first value — the same outcome as editing a
  seat between attempts today. The admin corrects it in stored mode.
- **Studio cannot tell** an absent value from a stored one at a glance; the description states the rule.

## 11. Documentation in the same delivery

- `docs/DATA_MODEL.md`: the field on both role sections (type, default rule, who writes it, PATCH
  semantics, «not in `ROLE_PROJECTION`»).
- `docs/API_REFERENCE.md`: POST/PATCH body field and refusal; the GET row field; the toggle-only notice rule.
- `CLAUDE.md` invariants: «`countsForFairness`: one read rule (`app/utils/countsForFairness.ts` — GROQ
  fragment + twin + default); PATCH absent = unchanged (never the `time` precedent); a PATCH that carries
  it and changes nothing a notice could report queues no notice; `ROLE_PROJECTION` does not carry it;
  inert until v3 serves Auto.» Reusable-utils entries for the module and for `solverEngine.ts` (the
  constant only; the resolver is C2's, A1).
- ADR-0010: a dated forward note — role documents carry `countsForFairness` (default off for specials);
  inert under v2; decision 3 is amended when v3 serves Auto, by C7 (parent §9, A31). The note changes
  neither the status line nor any decision's text; C7 writes the amendment and turns the note's date
  into the in-force date (C7 Step 5).
- `protectedReadAudit.ts`: the POST and PATCH entries' `reason` mentions the field.
- `docs/MONTH_GRID_EDITING.md` (and `UTILITIES_AND_COMPONENTS.md`): the header switch and the note.
- No `docs/SECRETS.md` entry: C1 introduces no environment variable.

## 12. Non-goals

- Anything that computes with the toggle: the ledger, shares, the panel (C2), the solver (C5), filling
  counted specials first (C6).
- Changing how a PATCH without the field queues notices, including a no-op save.
- Exposing the toggle over MCP, on the Servicios board cards, or as a config-step summary.
- A surface for toggling services of past months.
- Backfilling the field onto legacy documents (the read rule makes it unnecessary).
- `«Mes por medio»` and its label (C3).

## 13. Assumptions

| Assumption | Impact if false | Validation | Response |
|---|---|---|---|
| No path other than the two routes writes role documents' top-level fields in production | A third writer could store a non-boolean or drop the field | Grep of `app/**`, `scripts/**` at implementation (retired writers fail closed; the commit modules patch named fields) | Extend §5.3's validation to that writer |
| The history-diff tool is not used to adjudicate months containing weekend services created with the toggle off | Misclassified `changed_since_creation` | Ask before any future run over such months | Read those documents' classification with §10 in hand |
| Sanity stores the boolean as written and never synthesizes `null` | Twin and fragment still agree (`null` is in the domain) | Sync test covers `null` | None needed |

## 14. Open questions (non-blocking, with defaults)

| Q | Question | Default | Owner | Resolution |
|---|---|---|---|---|
| Q1 | Should past-month services be toggleable? | No surface — accepted by the parent (A25); past services keep their stored value or default; C2's panel shows which services counted | Frank | C7 look (A25) |
| Q2 | Should the Servicios board show an uncounted badge? | No (non-goal) | Frank | C7 look |

## 15. Acceptance and verification

| Requirement | Acceptance evidence | Verification |
|---|---|---|
| C1-R1 | Schema field on three types; Studio read-only | Studio protection tests; manual look in `/studio` on dev |
| C1-R2 | One fragment, one twin, one default | `groq-js` sync test; grep shows no other spelling of the default |
| C1-R3, R4 | Create validation, storage, fingerprint | Step-zero literals; receipt and route tests; harness parity rows |
| C1-R5, R6 | Edit semantics and notice suppression | Route tests (outbox upserts and pushes counted) |
| C1-R7 | Untouched writers/readers | The PR's file list; mirror, parity, caller-pin and `ROLE_PROJECTION` literal tests |
| C1-R8 | GET row field | Route test |
| C1-R9 | Model carries the value | Save, read, draft and planner model tests |
| C1-R10, R11 | Four surfaces, copy, engine module, engine note | Component tests; engine-module pin test; on dev, Frank's look at each surface with the note visible |
| C1-R12 | v2 inert | Solve-request and history-entry identity tests; no `gcf/**` change |
| C1-R13 | Docs | §11 checklist in the code review |

## Parent issues

None open. The three this spec raised are settled by the parent's amendments: who creates
`solverEngine.ts` and who owns the override (**A1**: C1 the constant, C2 the resolver, override, SECRETS
entry and PUT refusal, C6 the solve route's 409 and the engine prop — followed in §6.6 and §9); the
semantic wording of «toggle-only PATCH» (**A25**, adopting C1-D2 — followed in §5.4); and lookback
services that no surface can toggle (**A25**, accepted — §14 Q1). A27–A39 raise none for C1: A27 is
followed in §9 and A31 in C1-D6 and §11.

## Sibling notes

None open. The two earlier notes are applied by their owners (re-read 2026-10-05): SN-1 — C2's EN-1
consumes C1's constant unchanged and C2 §12 lists its P3 as resolved by A1; SN-2 — C6 §5.1 no longer
says «if absent» (C6 §13 records it). Their IDs are not reused.

## Review handoff

- Review order per the parent: C0, **C1**, C3, C2, C4, C5, C6, C7. This child at critical tier: two
  sequential fresh `APPROVED` verdicts on byte-identical text; the churn cap is binding.
- Evidence: this repository at `3dbc189b`, unchanged in code at `2d90e4b3` and `ee91d0e0` (file:line above); private
  `owt-agent-logs/sdd/2026-10-05-solver-v3-fairness/evidence/` (`d_persistence-ux.md` §1.3/§4/§5,
  `d_skeptic-delivery.md` M6/M10, `d_ledger.md` (d)) — superseded wherever the parent decides otherwise.
- Prior planning dialogue excluded from reviewers: yes.
- A material change here that alters L1 or U7 propagates to the parent and restarts review from the
  earliest affected artifact.
- Implementation authorization: **not granted by this document.**

## Terminal state

`READY_FOR_ADVERSARIAL_REVIEW`
