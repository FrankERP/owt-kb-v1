# Service Readiness redesign — implementation plan

Date: 2026-07-18

## Goal

Redesign `/admin -> Servicios` from a service-record list into the admin command center for answering:

> Is this service ready to publish?

The redesigned service surface should make readiness visible at card level: team assignment presence, setlist readiness, proposal status, availability conflicts, draft/published state, data-load confidence, and the single best next action.

## Scope

In scope:

- `/admin -> Servicios`
- minimal `AdminPanel` tab-targeting needed for service cards to send admins to the matching proposal review
- minimal `ProposalsPanel` targeting/highlight support needed by that handoff
- `app/components/admin/ServicesPanel.tsx`
- small extracted admin UI components if they reduce `ServicesPanel` complexity
- proposal status surfaced on service cards
- availability conflict status surfaced on service cards
- setlist readiness surfaced on service cards
- publish/draft state surfaced on service cards
- unknown/error readiness states surfaced when dependent data fails to load
- one primary next action per service
- visual polish for this workflow using the current Backstage identity
- prerequisite live setlist idempotency hardening for Sunday/Saturday writers touched by readiness/proposal approval

Out of scope:

- bottom mobile nav
- splitting `Canciones` out of home
- schedule mobile redesign
- member `/me` redesign
- Sanity Studio changes
- changing proposal business rules beyond stale/duplicate safety guards needed to prevent wrong-date approval
- changing availability data model
- changing service/setlist schemas

## Current problem

The admin app currently groups work by data category:

- `Servicios`: roles, teams, setlists, publish state
- `Propuestas`: lead-submitted setlist proposals
- `Disponibilidad`: availability and conflicts
- `Contenido`: songs

That is functional, but an admin's real task is service-centric: make sure each upcoming service has visible team assignments, setlist state, proposal state, availability state, data-load confidence, and publication state. The Service Readiness redesign keeps the existing tabs and workflows, but makes `Servicios` the primary place to understand and act on service readiness.

## Design direction

Use the existing Backstage visual identity as an operations console:

- dark, quiet card surfaces
- cyan for ready/action
- amber for draft/warning
- red for blocker/conflict
- green for published/approved
- purple only for special-service identity
- avoid hidden hover-only primary actions
- use a readiness strip as the signature element

The readiness strip is the memorable element: a compact row of status modules that instantly tells the admin what needs attention.

Example card:

```text
DOMINGO
19 JUL · Publicado

[Equipo asignado] [Setlist listo] [Propuesta aprobada] [Sin conflictos]

Lead: Marianne, Gaby
Setlist: 4 canciones · D, C, Db, Gb

Primary: Editar setlist
Secondary: Editar equipo · Despublicar · Eliminar
```

Problem-state example:

```text
SABADO
25 JUL · Draft

[Equipo sin asignaciones] [Sin setlist] [Sin propuesta] [1 conflicto]

Conflicto: Frank no disponible — "Trabajo"

Primary: Resolver conflicto
Secondary: Editar equipo · Completar setlist · Publicar
```

## Readiness model

Add a local, UI-facing readiness computation for each `ServiceRole`.

Each service should derive:

- `publishState`: `draft | published`
- `teamStatus`: `assigned | empty | conflict | unknown`
- `setlistStatus`: `none | ready | unknown`
- `proposalStatus`: `none | pending | changes_requested | approved | draft | stale | duplicate | unknown`
- `availabilityStatus`: `clear | conflict | unknown`
- `dataConfidence`: `complete | partial | error`
- `conflicts`: member/date/note summaries
- `teamSummary`: assigned-role summary, not expected-seat completeness
- `roleTargetStatus`: `single | duplicate | unknown`
- `primaryAction`: the best next action for the service

Publish state must preserve the existing legacy semantics: `publishState = role.published === false ? "draft" : "published"`. A missing `published` field is grandfathered as published and must not be mislabeled as draft or counted as ready-to-publish.

The readiness computation should be pure and testable where practical.

Important limitation: current live role docs store assigned people/slots, not required-but-empty seats. This slice must not claim that a service is missing `Keys`, `Drums`, `FOH`, or another expected seat unless an authoritative expected-seat source is introduced in a later slice. In this slice, `teamStatus` can only say whether there are visible assignments, whether loaded assignment data has availability conflicts, or whether assignment-dependent data is unknown.

### Primary-action priority

Use this priority order:

1. If availability conflicts exist: `Resolver conflicto`
2. Else if proposal is pending or changes requested: `Revisar propuesta`
3. Else if proposal data is stale or duplicated: `Revisar propuestas`
4. Else if setlist is missing: `Completar setlist`
5. Else if the service has no visible team assignments: `Editar equipo`
6. Else if service is draft and otherwise ready: `Publicar`
7. Else if service is published: `Editar setlist`
8. Else: `Editar servicio`

If any required data source for a status is unknown or failed, the card must not count as ready. Its primary action should be `Reintentar carga` or `Revisar datos`, depending on the failure.

This keeps the card focused on moving the service toward readiness.

## Data plan

`ServicesPanel` already fetches:

- `/api/admin/roles`
- `/api/admin/members`

Add proposal status to the readiness calculation through a separate proposal fetch. For this slice, do not embed proposal summaries into `/api/admin/roles`; proposal loading must remain independently trackable so cards can render roles while proposal state is `unknown` if proposal fetch fails.

Proposal data approach:

1. Fetch `/api/admin/proposals` inside `ServicesPanel`.
2. Ensure the proposal projection includes `_id`, `_createdAt`, `service_ref`, `service_date`, `service_type`, `status`, contributor display names, any notes/status fields needed by `ProposalsPanel`, and the current referenced role metadata needed to validate staleness:
   - referenced role id
   - referenced role `_type`
   - referenced role current `week` or `date`
3. Compute the shared proposal target key described below.
4. Build both proposal indexes described below:
   - by `service_ref`
   - by target key
5. Apply the proposal canonicalization and validation rules below.

Do not change proposal workflow semantics except for explicit stale/duplicate safety guards that prevent admins from approving proposal data into the wrong service date/type. Do not approve, delete, merge, or mutate duplicate/stale proposals automatically.

Add live setlist target status to readiness through an explicit read shape. Do not rely on existing `[0]` setlist joins to infer readiness because they hide duplicate live setlist docs.

Add role target collision status for Sunday/Saturday roles. Do not assume each weekend date/type has only one role doc unless the server has verified it.

Role target status data must include, per visible Sunday/Saturday target:

- role target key
- role `_type`
- date/week
- match count
- matching role ids
- whether the target is `single | duplicate | unknown`

Rules:

- Sunday role target key: `sunday_role:${week}`
- Saturday role target key: `saturday_role:${week}`
- Special roles are independent documents and are not grouped by date in this slice.
- If more than one Sunday/Saturday role doc exists for the same role target key, every affected card must show a duplicate-role blocker.
- Duplicate role targets must not count toward ready-to-publish counts.
- The primary action should be `Revisar roles duplicados` / `Revisar datos`, with copy that points admins to resolve the duplicate role docs before publishing.
- Do not auto-delete or merge duplicate role docs in this slice.
- Add server-side create/edit guards in `/api/admin/roles` and `/api/admin/roles/[id]` to prevent creating new duplicate Sunday/Saturday role targets.
- The create/edit guards must be concurrency-safe, not just query-before-write.
- Use an explicit deterministic role-target claim strategy for Sunday/Saturday targets:
  - role target lock id examples: `roleTarget.sunday_role.2026-07-19`, `roleTarget.saturday_role.2026-07-18`
  - the deterministic id belongs only to the lock document, not to the Sunday/Saturday role document
  - do not reuse Sunday/Saturday role document ids for recreated services; role document ids must remain unique role instances so old proposals whose `service_ref` points at a deleted role cannot attach to a new service on the same date
  - create routes must generate a fresh Sanity-valid unique Sunday/Saturday role document id before the transaction, for example `sunday_role.<date>.<randomKey>` or an equivalent non-reused id, so the same transaction can create the role and set the lock's `roleRef` to that exact id
  - do not rely on Sanity auto-generating the role id for Sunday/Saturday create transactions, because the lock must know the new role id before commit
  - add a hidden/internal Sanity schema for the lock document, for example `_type: "roleTargetLock"`, with `targetKey`, `roleRef`, `roleType`, `date`, and timestamps; register it in the schema so the data model is explicit
  - lock docs are operational metadata, not user-facing service records; if a lock exists without the matching role, the admin route may reclaim it only when ownership can be proven safe, otherwise reject and surface a data-cleanup error
  - create transactions must create the role and create the target lock together; if the lock already exists, reject with `409`
  - edit transactions must fetch the stored role first and derive the old protected target from the stored `_type` plus stored `week/date`, not from `body._type`
  - edit requests must either ignore `body._type` for existing docs or reject if it differs from the stored `_type`; this slice does not support changing a role document between Sunday/Saturday/special types
  - edit transactions that change a Sunday/Saturday role date must claim the new target lock, patch the role, and release the old owned target lock in one transaction; if that cannot be made atomic, implementation must stop and revise this plan before shipping
  - delete transactions for Sunday/Saturday roles must delete the role and release its owned target lock in one transaction
  - if the new target lock exists and is owned by another role id, reject with `409`
  - delete must only remove a target lock when the lock is owned by the role being deleted
  - legacy bootstrap is mandatory: if old existing data has a single role for a target but no lock yet, create/edit/delete routes must atomically create/backfill the lock for that existing role before proceeding with any target-sensitive mutation
  - creating a new Sunday/Saturday role for a target that already has one legacy role and no lock must backfill the lock for the existing role and reject the new create with `409`; it must not create a second role
  - if multiple existing roles match a target, reject and surface duplicate-role state instead of claiming a lock
- Add focused tests for role create/edit duplicate rejection, create transaction generating a fresh unique role id and a lock that points at that created id, create against an existing legacy single role with no lock rejecting without creating a duplicate, concurrent duplicate creates, concurrent duplicate-making edits, edit requests with mismatched `body._type`, delete-then-recreate for Sunday/Saturday roles without reusing the deleted role id or resurrecting old proposals, not deleting a lock owned by another role, orphaned-lock handling, and readiness blocking of pre-existing duplicate role docs.

Live setlist status data must include, per visible Sunday/Saturday target:

- target key
- `_type`
- `week`
- match count
- matching document ids
- whether the target is `none | single | duplicate | unknown`
- selected/canonical document id only when exactly one exists

This can be exposed through a dedicated admin summary endpoint, an extension to `/api/admin/setlists`, or an explicit field on the admin roles response, but the UI must be able to distinguish no setlist, one setlist, duplicate setlists, and failed setlist-status load.

## Proposal canonicalization and stale-data rules

Do not build a naive one-proposal `proposalByServiceRef` map. The existing app can contain duplicate/stale proposal docs for a service, and service roles can be edited after a proposal exists. Readiness must group and validate proposals before displaying a card status.

### Proposal target key

Use one shared target-key function everywhere proposals are grouped or guarded:

- `special`: target key is `special:${service_ref}`
- `sunday`: target key is `sunday:${service_date}`
- `saturday`: target key is `saturday:${service_date}`

Reason: special setlists are stored on the special role doc, but Sunday/Saturday approvals write to setlist docs keyed by `service_type + service_date`. Two different weekend role refs with the same date/type compete for the same live setlist target and must be treated as duplicates unless a separate unique-role-date invariant is introduced.

Build two indexes:

- `proposalsByServiceRef`: used to find stale proposals still attached to the current role after a Sunday/Saturday date move.
- `proposalsByTargetKey`: used to find live setlist-target collisions, especially Sunday/Saturday proposals competing for the same `service_type + service_date` setlist doc.

For each service card:

1. Use `proposalsByServiceRef[currentRole._id]` to detect proposals attached to this role.
2. Compare each attached proposal's `service_date` and `service_type` against the current role date/type.
3. Treat attached proposals whose referenced role is missing/dangling, or whose date/type do not match the current role, as stale/invalid for readiness, even if their old target key no longer matches the current card target key.
4. Exclude stale proposals from normal `pending` / `changes_requested` / `approved` readiness.
5. If stale proposals exist, surface a visible `Propuesta desactualizada` issue. The service must not count as ready until the admin reconciles it.
6. Use `proposalsByTargetKey[currentTargetKey]` to detect non-stale active proposals that compete for the same live setlist target.
7. If more than one non-stale active proposal exists for the same target key, surface a visible duplicate proposal issue. Active means status is not `approved`. Approved proposals are treated as historical/reviewed records for this slice; multiple legacy approved proposals may be surfaced as an informational warning, but they must not block readiness unless a separate cleanup feature is planned.
8. Select a canonical target proposal for handoff using a deterministic priority:
   - `pending`
   - `changes_requested`
   - `draft`
   - `approved`
   - then oldest `_createdAt` as tie-breaker
9. Use the same canonical-selection function in the readiness helper and in `ProposalsPanel` targeting.

The card may display an aggregate state such as `2 propuestas activas` or `Propuesta desactualizada`, but it must not pretend a duplicated/stale active set is a single clean proposal.

This redesign must not approve, delete, merge, or mutate duplicate/stale proposals automatically. Stale proposals are exposed for review and can use existing request-changes/reopen-style flows. Duplicate proposal groups are detected and blocked in-app, but manually reconciled out-of-band in Sanity Studio for this slice.

## Stale/duplicate proposal approval safety

A stale proposal is not just a visual warning. Current approval writes setlists using the proposal's stored `service_date` and `service_type`, so a proposal whose stored service date/type no longer matches its referenced role can publish to the wrong date/type if approved.

This slice must add stale/duplicate-safe review behavior:

- `ProposalsPanel` must disable or hide `Aprobar` for proposals marked stale by the shared readiness/canonicalization helper.
- `ProposalsPanel` must explain why approval is blocked, for example: `Esta propuesta pertenece a una fecha anterior del servicio. Revisa el servicio antes de aprobar.`
- Duplicate proposal groups should be surfaced as a review issue; do not present a single clean approve path as if there were no duplicates.
- Duplicate Sunday/Saturday role targets must also disable approval. If a proposal points at a date/type where more than one role doc exists, approving from `Propuestas` would write to an ambiguous shared live setlist target and must be blocked.
- The admin proposal approval route must add server-side stale and duplicate guards before any mutation, including before the proposal status is patched to `approved`.
- Stale guard: fetch the referenced role by `service_ref`, compare current role date/type to the proposal's stored `service_date`/`service_type`, and reject approval when they do not match.
- The stale guard must be concurrency-safe with role date edits. Approval must fetch the referenced role `_rev` together with stored `_type` and `week/date`, then include a same-revision role assertion in the same transaction that approves the proposal and writes the live setlist. If the role revision changes between guard fetch and commit, return `409` and leave the proposal and setlist unchanged.
- Do not rely on a pre-transaction role fetch alone for stale approval safety. If Sanity cannot express a same-revision role assertion in the approval transaction or an equivalent server-side atomic guard, implementation must stop and revise this plan before shipping.
- Duplicate role-target guard: for Sunday/Saturday proposals, fetch the referenced role and all role docs matching the proposal's current target date/type. Approval requires exactly one matching role, and that role id must equal the proposal's `service_ref`. If the role target is missing, duplicated, or points at a different role, reject approval before mutation.
- The duplicate role-target guard must align with the role-target lock strategy. Where a lock exists, approval should assert that the lock is owned by the referenced role inside the same approval transaction; if the lock is missing for a legacy singleton, approval may bootstrap/assert the lock only for that same referenced role. If the lock is missing and ownership cannot be proven, reject with `409`/cleanup copy.
- Duplicate guard: before normal approval, query sibling proposals for the same target key that are not already approved. If multiple non-stale active proposals exist, reject the clean approval path and ask the admin to resolve the duplicate group first.
- Remove or disable the existing automatic superseded-proposal cleanup from normal approval. Normal approval must not delete sibling proposal docs as a hidden side effect.
- The rejection path must leave both proposal status and setlist documents unchanged.
- Add focused tests for stale role date/type approval rejection.
- Add focused tests for a concurrent referenced-role date change during approval returning `409` with no proposal status mutation and no live setlist mutation.
- Add focused tests that proposal approval rejects duplicate Sunday/Saturday role targets, missing role targets, and mismatched target ownership before any proposal or live setlist mutation.
- Add focused tests for duplicate proposal approval rejection.

This is a safety guard, not a change to the happy-path approval semantics.

## Live setlist target idempotency

Because proposal approval and the setlist editor both write the live Sunday/Saturday setlist docs, this slice must define a single idempotent target strategy before relying on readiness/setlist state.

Current readers and writers pair weekend setlists by `_type + week`, but Sanity does not enforce uniqueness for `featuredSongs.week` or `saturdarSongs.week`. New writes with generated document IDs can race and create duplicate live setlist docs for the same weekend target.

Requirements:

- Define a shared live setlist target key:
  - Sunday: `featuredSongs:${week}`
  - Saturday: `saturdarSongs:${week}`
  - Special: the special role document id
- Define a separate deterministic Sanity document id helper for newly created Sunday/Saturday live setlist docs. Do not use the colon-containing in-memory target key as the Sanity `_id`.
  - Sunday example: `featuredSongs.2026-07-19`
  - Saturday example: `saturdarSongs.2026-07-18`
  - Use only Sanity-valid id characters: letters, numbers, `.`, `_`, and `-`.
- Apply the same idempotent write helper to every writer touched by this slice:
  - admin proposal approval
  - `/api/admin/setlists`
- Before writing, query for existing live setlist docs for the target `_type + week`.
- If exactly one exists, patch that document.
- If none exists, create the deterministic-id document.
- If more than one exists, reject the write with a clear duplicate-live-setlist error and leave existing docs unchanged.
- Service readiness must surface duplicate live setlists as `unknown`/blocked setlist state rather than pretending one arbitrary `[0]` doc is authoritative.
- Do not attempt automatic duplicate live-setlist cleanup in this slice; route admins to Studio/manual cleanup with the conflicting ids.
- Add focused idempotency/concurrency tests:
  - deterministic live setlist document ids are valid and stable
  - approval creates deterministic Sunday/Saturday setlist when none exists
  - approval patches the existing single setlist
  - approval rejects duplicate existing live setlists without proposal/status mutation
  - `/api/admin/setlists` follows the same behavior
  - concurrent create attempts for the same deterministic target do not produce duplicate live setlist docs

## Proposal approval atomicity and concurrency

Because this slice modifies the admin proposal approval route, it must also preserve and harden the existing approval safety properties.

Requirements:

- Preserve the existing `_rev` / `ifRevisionId` approval claim behavior that prevents publishing a stale song snapshot when a lead edits during admin review.
- Add a regression test where the proposal revision changes before approval and the route returns `409` without writing a setlist.
- Normal approval must be all-or-nothing: proposal status changes to `approved` and the live setlist write commit together, or neither does.
- Prefer a Sanity transaction that includes:
  - same-revision assertion for the referenced role used by the stale guard
  - revision-guarded proposal status patch
  - live setlist patch/create through the shared idempotent target helper above
  - no hidden sibling cleanup
- If a transaction cannot safely cover the referenced-role revision assertion or the chosen setlist patch/create path, implementation must stop and revise this plan before shipping; do not keep the existing “mark approved, then write setlist” partial-failure window.
- Add a focused route-level test or test double proving that a setlist-write failure after the approval attempt does not leave the proposal approved.
- Update API/docs that describe proposal approval side effects, especially any documentation that still says approval deletes competing proposals.

## Manual proposal exception resolution

The redesign must include a safe way out for proposal exceptions instead of creating permanently blocked services.

### Stale proposals

For stale proposals:

- `ProposalsPanel` must show the proposal as stale using current referenced role metadata from the proposal API or a role lookup.
- `Aprobar` must be disabled.
- Existing non-approval actions remain available where appropriate, especially `Solicitar cambios` with an admin note explaining that the service date/type changed, but this is only communication; it does not by itself reconcile stale target fields.
- Lead resubmit/save for an existing non-approved proposal must refresh `service_ref`, `service_date`, and `service_type` from the current role before saving/submitting, so a proposal sent back for changes can become non-stale when the lead updates it.
- Add a guarded admin action for non-approved stale proposals, for example `reconcile_target`, that retargets the proposal to the currently referenced role date/type without changing songs or notes.
- The admin reconcile action must require confirmation, reject approved proposals, fetch the current role by `service_ref`, and update only the proposal target fields needed to match that role.
- Add focused tests that lead resubmit refreshes stale target fields.
- Add focused tests that admin reconcile updates only non-approved stale proposal target fields and rejects approved proposals.
- The service card primary action may be `Revisar propuesta` / `Revisar datos`, but it must not route to an approval path.

No automatic stale proposal deletion is introduced in this slice.

### Duplicate proposals

For duplicate proposal groups:

- `ProposalsPanel` must reveal the full group for the same target key.
- Normal one-click approval is disabled while duplicate active proposals exist.
- Do not add in-app duplicate-resolution approval in this slice.
- Show explicit copy that resolution must happen in Sanity Studio, for example: `Hay propuestas duplicadas para este servicio. Resuelve o elimina las duplicadas en Studio antes de aprobar.`
- Provide enough context in the UI for the admin to identify the affected proposals: contributor/lead, status, service date/type, and proposal id if useful.
- Backend normal approval must reject duplicate active proposals before any mutation.
- Add focused tests that normal approval rejects duplicates without mutation.

Because the current proposal schema has no `rejected`/`archived` status, do not introduce those labels in copy or tests unless a separate schema migration is planned.

## Partial-load and unknown-state plan

Readiness depends on roles, members, proposal summaries, role target status, and live setlist target status. `ServicesPanel` must track these load states separately:

- roles: `loading | ready | error`
- members: `loading | ready | error`
- proposals: `loading | ready | error`
- roleTargets: `loading | ready | error`
- setlistTargets: `loading | ready | error`

Rules:

- If roles fail, the dashboard cannot render service cards and must show an explicit error state plus retry.
- If members fail, availability/team-conflict status is `unknown`, not `clear`.
- If proposals fail, proposal status is `unknown`, not `Sin propuesta`.
- If role target status fails, role target status is `unknown`.
- If live setlist target status fails, setlist status is `unknown`, not `none` or `ready`.
- Unknown statuses must not count toward ready-to-publish counts.
- Stale or duplicate proposal statuses must not count toward ready-to-publish counts.
- Duplicate live setlist targets must not count toward ready-to-publish counts.
- Duplicate role targets must not count toward ready-to-publish counts.
- Unknown statuses should render visibly in the readiness strip.
- Retry should refetch the failed data source or all data if simpler.

This avoids falsely telling admins that a service has no conflicts or no proposals when the data did not load.

Implement an explicit error UI for these states. Do not assume `ServicesPanel` already has a sufficient roles/members/proposals error state.

## Team assignment summary

Do not use `summarizeUnfilledSeats` for live role docs in this slice unless its input contract is explicitly verified and adapted safely. Current service role writes filter out empty instrument/FOH slots, so unassigned expected seats are not preserved as source data.

The service card may summarize assigned people:

- `Lead: Marianne, Gaby`
- `Instrumentos: Tony, Samo, Frank`
- `FOH: Vega`
- `Sin asignaciones visibles`

It may not claim missing expected roles unless that source exists.

## Components

Extract only components that clearly reduce complexity.

Proposed components under `app/components/admin/`:

- `ServiceReadinessCard`
- `ReadinessStrip`
- `ReadinessBadge`
- `ServicePrimaryAction`
- `ServiceIssueList`

Suggested helper file:

- `app/utils/proposalReadiness.ts` for shared proposal target/staleness/duplicate helpers that must be importable by both client components and route tests
- `app/components/admin/serviceReadiness.ts` only for UI-specific service-card readiness composition if still useful

Keep modal flows and mutation handlers in `ServicesPanel` unless extraction is obviously cleaner and low-risk.

## ServicesPanel layout plan

### 1. Command summary header

Replace the current simple service count header with a compact readiness summary:

- upcoming services count
- ready-to-publish count, excluding services with unknown/error status
- draft count
- conflict count
- pending proposal count
- unknown/error count when a dependent data source failed
- skipped/not-ready draft count for bulk publish, when applicable

Example:

```text
Servicios
6 próximos · 2 listos · 1 conflicto · 1 propuesta pendiente
```

Keep:

- `Intercambiar`
- `Publicar todo`
- `Generar mes`
- `Nuevo`
- month filters
- past month controls

These controls should read as tools around the readiness dashboard, not as the main content.

Bulk publish semantics must be explicit:

- The safe/default bulk action should only include visible drafts whose readiness is clean and whose required statuses are not unknown/error.
- If keeping the label `Publicar todo`, the UI must not silently include blocked/unknown drafts. It should either show skipped blockers before publishing only the clean drafts, or move true publish-all behavior behind an explicit override confirmation.
- An override confirmation, if implemented, must list not-ready services and their blockers before calling the existing publish route with those ids.
- This slice does not add server-side publish blockers to `/api/admin/roles/publish`; the readiness-aware behavior lives in the admin UI/helper layer unless a separate publish-policy migration is planned.
- Add focused tests for the bulk-publish selection helper, including blocked, unknown, conflict, stale/duplicate proposal, duplicate role target, and legacy `published: undefined` cases.

### 2. Service card hierarchy

Each service card should show:

1. Service identity:
   - day/service name
   - date
   - Sunday/Saturday/Special theme
   - draft/published badge
2. Readiness strip:
   - Equipo
   - Setlist
   - Propuesta
   - Disponibilidad
3. Issue summary:
   - conflict names and notes
   - pending proposal contributor hint
   - unknown data warnings
4. Compact preview:
   - lead names
   - key instrument assignments
   - setlist count and keys
5. Actions:
   - one primary action
   - secondary action menu for less common or destructive actions

### 3. Primary actions

Promote the main next action out of hidden menus.

Actions should reuse existing callbacks:

- `Resolver conflicto` -> open edit service modal with the existing service selected
- `Editar equipo` -> open edit service modal
- `Revisar propuesta` -> call an explicit `AdminPanel` handoff that switches to `Propuestas` and targets the matching proposal/service
- `Completar setlist` -> open existing setlist editor
- `Editar setlist` -> open existing setlist editor
- `Publicar` -> existing publish handler
- `Editar servicio` -> open edit service modal

Keep destructive actions like delete in a menu.

## Proposal review handoff

There is no standalone admin proposal route in this app, so the service-card `Revisar propuesta` action requires a small parent/child contract:

- `AdminPanel` owns the active tab and a transient `targetProposalServiceRef`.
- `ServicesPanel` receives `onReviewProposal(target: ProposalReviewTarget)`.
- `ProposalReviewTarget` includes:
  - `serviceRef`
  - current role date
  - current role type
  - optional canonical proposal id when already computed
- When a service card invokes `Revisar propuesta`, `AdminPanel` stores the target, switches the tab to `proposals`, and passes the target to `ProposalsPanel`.
- `ProposalsPanel` accepts `target?: ProposalReviewTarget`.
- On target change, `ProposalsPanel` must search all loaded proposals by service ref for stale attached proposals and by target key for live setlist-target collisions, not only the currently filtered visible list.
- `ProposalsPanel` must use the same canonical-selection and stale/duplicate detection rules as the service readiness helper, using current referenced-role metadata for all proposals and the target's current role date/type for handoff comparison.
- If the canonical matching proposal exists but is hidden by the current filter, `ProposalsPanel` must switch to that proposal's status filter or to an `all` filter before scrolling/highlighting.
- If duplicated or stale proposals exist for the target key, `ProposalsPanel` should reveal the full affected group, not only one item, so the admin can see why readiness is blocked.
- `pending` and `changes_requested` handoffs must both be manually verified.
- If the proposal is genuinely absent after searching all loaded proposals, or proposals failed to load, `ProposalsPanel` shows a clear status such as `No se encontró la propuesta para este servicio.`
- The UI must distinguish `no encontrada` from `no se pudieron cargar propuestas`.

This slice should not introduce a new admin route unless the tab-targeting contract proves inadequate during implementation.

## Proposal integration

Each service card should display one proposal state:

- `Sin propuesta`
- `Borrador`
- `Propuesta pendiente`
- `Cambios solicitados`
- `Aprobada`
- `Propuesta desactualizada`
- `Propuestas duplicadas`
- `Estado desconocido`

If a proposal is pending or changes requested, the card should surface that state in the readiness strip and issue summary.

The existing `Propuestas` tab remains as a queue. This slice only makes proposal status visible from `Servicios`.

## Availability integration

Keep the current conflict computation in `ServicesPanel`, but make it part of the card readiness model.

Each conflict shown on a card should include:

- member display name
- date/service context when useful
- note if available

Example:

```text
Frank no disponible — "Trabajo"
```

The separate `Disponibilidad` tab remains available as a report, but the service card becomes the place where the admin sees and acts on conflicts.

## Preserve existing behavior

Do not remove:

- create service
- edit service/team
- delete service
- edit setlist
- publish/unpublish
- publish all drafts in current filter
- generate month
- swap mode
- copy instruments
- month filters
- participation sidebar
- availability conflict summary
- setlist editor save/error safeguards

The redesign changes hierarchy and visibility, not core data behavior.

## Safety constraints

- Do not write to Sanity outside existing admin mutation routes.
- Existing member mutation routes already in scope, especially `/api/me/proposals`, may update proposal target fields as part of stale proposal reconciliation.
- Do not rename `saturdarSongs`.
- Do not alter happy-path proposal approval semantics beyond the stale/duplicate safety guards described above.
- Add stale/duplicate proposal approval guards as described above.
- Do not add new publish-blocking rules in this slice.
- Maintain existing cache/revalidation behavior through existing routes.
- Any new mutation handler must keep the established try/catch/finally and `res.ok` pattern.
- `SetlistEditor` must not render editable empty state on failed/malformed loads.
- Refresh after successful service or setlist mutation should keep honest status; if save succeeds but refresh fails, do not claim everything refreshed cleanly.
- Audit existing direct role-writing scripts before shipping, especially schedule import/generation scripts. Documentation-only retirement is not enough: every executable direct writer that can mutate Sunday/Saturday role docs must either use the same guarded role-target lock helper/invariant or fail before any production write path.
- Audit existing direct live-setlist writers before shipping, especially history/import scripts. Every executable writer that can mutate `featuredSongs` or `saturdarSongs` must either use the shared deterministic live-setlist target helper/invariant or fail before any production write path.

## Verification

Required before claiming done:

- `npx tsc --noEmit`
- `npm test`
- `npm run build`

Manual verification:

- `/admin -> Servicios` loads
- service readiness strip appears on all visible services
- draft/published state is correct
- legacy roles with `published` missing are treated as published, not draft
- bulk publish/default publish-all behavior does not silently publish blocked or unknown drafts; skipped or override behavior is visible before mutation
- duplicate Sunday/Saturday role docs for the same date/type are surfaced as blockers and do not count as ready
- setlist readiness is correct
- duplicate live setlist docs are surfaced as blocked/unknown setlist state and do not count as ready
- assigned-team summary is correct and does not claim missing expected seats without a source
- proposal status appears for services with proposals
- duplicate active proposals for one proposal target key are surfaced and do not count as ready
- proposals whose stored service date/type does not match the current role are surfaced as stale and do not count as ready
- availability conflicts appear on affected services
- primary action matches priority order
- primary action opens or triggers the correct existing flow
- `Revisar propuesta` switches to `Propuestas` and targets/highlights the matching proposal
- destructive actions remain secondary
- mobile/touch surfaces do not depend on hover for primary actions
- `Intercambiar` mode still works
- copy instruments mode still works
- month filters still work
- participation sidebar still renders
- existing service edit modal still saves
- deleting then recreating a Sunday/Saturday service for the same date works after target-lock release
- deleting then recreating a Sunday/Saturday service for the same date does not reuse the deleted role id and does not surface/approve old proposals from the deleted role
- editing a role with a mismatched request `_type` is rejected or ignored safely, and the lock claim/release is based on the stored role `_type`
- orphaned role-target locks are handled safely: reclaimed only when provably owned by the current role, otherwise rejected with a cleanup message
- existing setlist editor still saves
- publish/unpublish still works

## Rollout plan

1. Create a feature branch from `preview`.
2. Implement this slice only.
3. Run required local verification.
4. Merge feature branch into `preview`.
5. Push `preview`.
6. Before any Vercel command that may inspect, deploy, alias, or mutate remote state, verify `.vercel/project.json` matches `owt-backstage` and project id `prj_elS88VGezKpy18wizFN1ffoy8cJ5`.
7. Confirm Vercel deploys the `preview` branch to the existing `owt-backstage` project.
8. Verify the stable preview URL.
9. Do not merge to `main` until preview is approved.

## Recommended implementation order

1. Add shared proposal/readiness target helpers in `app/utils/proposalReadiness.ts`.
2. Add shared role/live-setlist target helpers and the hidden/internal `roleTargetLock` schema.
3. Add role target collision read/status shape.
4. Add explicit live setlist target status read shape.
5. Harden `/api/admin/roles` and `/api/admin/roles/[id]` with Sunday/Saturday duplicate role target rejection, fresh pre-generated unique role-instance ids for atomic create+lock transactions, mandatory legacy-lock bootstrap, stored-role-derived edit/delete lock ownership, and orphaned-lock handling.
6. Harden `/api/admin/setlists` with deterministic Sunday/Saturday target writes and duplicate-live-setlist rejection.
7. Harden admin proposal approval:
   - stale guard before any mutation
   - same-revision referenced-role assertion inside the approval transaction
   - duplicate/missing role-target guard before any mutation
   - duplicate active proposal guard before any mutation
   - preserve `_rev` / `ifRevisionId`
   - all-or-nothing proposal approval plus setlist write
   - remove hidden sibling cleanup from normal approval
8. Add stale proposal reconciliation paths:
   - lead save/resubmit refreshes target fields
   - guarded admin reconcile action for non-approved stale proposals
9. Audit/update direct role-writing scripts so they cannot bypass the new lock invariant; executable write paths must be guarded or disabled, not merely documented.
10. Audit/update direct live-setlist-writing scripts so they cannot bypass the deterministic live-setlist target invariant; executable write paths must be guarded or disabled, not merely documented.
11. Update affected API/docs references.
12. Add route/helper tests for the safety work above.
13. Only after the safety tests pass, implement proposal/role-target/setlist/member load states in `ServicesPanel`.
14. Add pure readiness helper and focused tests.
15. Extract minimal readiness UI components.
16. Replace the service card layout.
17. Promote primary action logic.
18. Wire issue summaries.
19. Preserve and test existing modals/actions.
20. Run full verification and preview deploy.
