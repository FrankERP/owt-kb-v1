# Service Readiness redesign — admin journey and UI plan

Date: 2026-07-18

## Goal

Redesign `/admin -> Servicios` from a service-record list into a clean, premium command center that answers:

> Is this service ready to publish, and what should I do next?

The surface must expose one honest readiness result and one deterministic primary action per service without hiding existing admin functionality.

## Dependency and start gate

This is Plan B. Do not implement it until A1 canonical reads and A2 mutation integrity are implemented, A3 has verified A2's deployed mutation contracts in isolation, and the foundation is approved on `preview`.

Plan B consumes A1's independently loadable role/setlist/proposal/integrity read contracts and A2's guarded mutation/conflict contracts. It does not reimplement validation, target uniqueness, or concurrency rules in the client. A3 owns its deployed verification and promotion.

## Scope

In scope:

- `/admin -> Servicios`
- pure readiness predicate and total primary-action ordering
- independently tracked roles, members, proposals, role-target, and setlist-target loads
- command summary and readiness-aware bulk selection
- redesigned service cards and readiness strip
- proposal status and handoff to `Propuestas`
- availability conflicts and assigned-team summary
- setlist content readiness
- publish/draft state
- record-integrity and legacy-draft issues from A1/A2
- mobile/touch behavior at the stable preview URL
- minimal extracted components that reduce `ServicesPanel` complexity

Out of scope:

- A1/A2/A3 foundation implementation
- expected-but-empty seat inference
- changing availability data model
- bottom mobile navigation
- schedule, `/me`, or song-library redesign
- new standalone proposal route
- native Capacitor release configuration

## Design direction

Use the existing Backstage identity as an operations console:

- dark, quiet card surfaces
- cyan for ready/action
- green for published/approved
- amber for incomplete/warning
- red for conflicts and integrity blockers
- purple only for special-service identity
- visible touch-safe primary actions; no hover-only workflow
- a compact readiness strip as the signature element

The card hierarchy is:

1. service identity and publication state
2. readiness strip
3. blocking issue summary
4. assigned-team/setlist preview
5. one primary action
6. secondary/destructive menu

## Readiness input model

Each validated service card derives:

- `publishState: draft | published` where only `published === false` is draft; missing is grandfathered published
- `recordStatus: valid | invalid`
- `roleTargetStatus: single | duplicate | draft_conflict | invalid | unknown`
- `teamStatus: assigned | empty | unknown`
- `setlistStatus: none | incomplete | ready | duplicate | draft_conflict | invalid | unknown`
- `proposalPresentation: none | draft | pending | changes_requested | approved | conflict | invalid | draft_conflict | unknown`
- `availabilityStatus: clear | conflict | unknown`
- `dataConfidence: complete | partial | error`
- `conflicts`
- `teamSummary`
- `integrityIssues`
- `primaryAction`

The computation is pure and covered by table-driven tests.

`dataConfidence` is derived only from the five source states: `complete` when all are ready, `error` when roles fail, and `partial` for any other loading/error combination. It is never stored or updated independently.

`proposalPresentation` is a display/readiness mapping over A1's explicit server response, not a client proposal canonicalizer. Map a route load failure to `unknown`, associated A1 record issues to `invalid`, associated raw draft ids to `draft_conflict`, either A1 grouping-conflict result to `conflict`, an empty validated group to `none`, and exactly one conflict-free validated record to its stored `draft | pending | changes_requested | approved` state. The client never rebuilds proposal target keys, re-groups records, selects a winner, or invents `stale`; unassociated issues stay in the global integrity queue.

### A1 setlist collapse matrix

Plan B maps A1's target/content response exactly:

| A1 response | Plan B `setlistStatus` | Editor allowed? |
|---|---|---|
| target `none` | `none` | yes, creates new target |
| target `single` + content `empty` | `incomplete` | yes |
| target `single` + content `incomplete` | `incomplete` | yes |
| target `single` + content `ready` | `ready` | yes |
| target `single` + content `invalid` | `invalid` | no |
| target `duplicate` | `duplicate` | no |
| target `draft_conflict` | `draft_conflict` | no |
| target/source `invalid` | `invalid` | no |
| source not loaded/failed | `unknown` | no |

Malformed arrays/objects, missing or duplicate `_key`, and dangling/missing song references are `invalid`, not ordinary incomplete content. Tests prove they route to integrity details and never open editable empty state.

### Team status

Use A1 projections that preserve raw assignment ids and resolution across all five seat paths.

- `assigned`: members source is ready, at least one raw assignment exists, and every non-empty assigned reference resolves to a canonical member.
- `empty`: members source is ready and there are zero raw assignment references across all five paths.
- `unknown`: members source is loading/failed.
- Any dangling/non-resolving assigned reference is a blocking integrity issue and makes the record non-ready; it is never collapsed to `empty` or `assigned`.

Availability is computed over the same five resolved seat paths through the shared assignment-query semantics.

## Definitive readiness predicate

There are two related booleans:

- `isOperationallyReady`: the service data is complete and internally clean, regardless of publication state.
- `isReadyToPublish`: `publishState === "draft" && isOperationallyReady`.

`isOperationallyReady` is true only when every row below is clean:

| Dimension | Clean value | Blocking values |
|---|---|---|
| Required sources | all `ready` | any `loading` or `error` |
| Record | `valid` | `invalid` |
| Role target | `single` (special: valid role id) | `duplicate`, `draft_conflict`, `invalid`, `unknown` |
| Team | `assigned` with no dangling refs | `empty`, `unknown`, any dangling-ref integrity issue |
| Setlist | `ready` | `none`, `incomplete`, `duplicate`, `draft_conflict`, `invalid`, `unknown` |
| Proposal presentation | `none` or `approved` | `draft`, `pending`, `changes_requested`, `conflict`, `invalid`, `draft_conflict`, `unknown` |
| Availability | `clear` | `conflict`, `unknown` |
| Integrity issues | none | any blocking A1/A2 issue |

Proposal absence is clean when the live setlist is ready; a proposal is a workflow, not a mandatory artifact. An active proposal blocks readiness because publishing could ignore unfinished/review-pending work.

Published services use `isOperationallyReady` as a health signal but never enter the ready-to-publish count.

## Total primary-action priority

Use this single ordered list for every card; the first matching rule wins:

1. Invalid service/proposal record, proposal raw-draft conflict, role-target draft conflict/invalid, dangling assignment, or blocking legacy integrity issue -> `Revisar datos`
2. Role-target duplicate -> `Revisar roles duplicados`
3. Setlist duplicate/draft conflict/invalid -> `Revisar datos del setlist`
4. Any required source is `loading` -> disabled `Cargando datos`
5. Any required source is `error` -> `Reintentar carga`
6. Sources are ready but a required derived status is `unknown` -> `Revisar datos`
7. Availability conflict -> `Resolver conflicto`
8. Proposal grouping conflict -> `Revisar propuestas`
9. Proposal pending or changes requested -> `Revisar propuesta`
10. Proposal draft -> `Revisar propuesta`
11. Setlist none or incomplete -> `Completar setlist`
12. Team empty -> `Editar equipo`
13. Draft and `isOperationallyReady` -> `Publicar`
14. Published -> `Editar setlist`
15. Fallback -> `Editar servicio`

This ordering puts data-integrity blockers ahead of ordinary workflow actions. Tests cover every row and combinations where multiple problems coexist.

## Data loading and validation consumption

Track these sources separately:

- roles: `loading | ready | error`
- members: `loading | ready | error`
- proposals: `loading | ready | error`
- role targets/integrity: `loading | ready | error`
- setlist targets/integrity: `loading | ready | error`

The members source uses A1's explicit published-perspective canonical projection shared by client readiness and A2 server publish recomputation. It includes canonical `_id`/`_rev`, display fields, availability fields, and resolution of raw assignment ids across all five seat paths. Raw member drafts never overlay client availability or server guard revisions.

Rules:

- roles failure prevents card rendering and shows retry.
- members failure makes team/availability `unknown`; it never means clear.
- proposals failure means `unknown`; it never means no proposal.
- role-target/setlist-target failure means `unknown`; it never means single/none.
- record-level A1/A2 issues remain visible without failing unrelated cards.
- successful source data remains rendered when another source fails.
- retry may refetch only failed sources or all sources if simpler, but loading/error state remains honest.
- after a successful mutation followed by failed refresh, show `Guardado, pero no se pudo actualizar` (or equivalent) and keep retry available; do not claim a fully refreshed success.

Add component tests with injected failure and retry for each source.

Add client/server parity tests for canonical members, including a canonical member plus raw draft overlay and a dangling raw assignment reference.

### Per-control source gating during partial loads

Rendered data may remain visible during partial failure, but a mutation control is enabled only when every source needed to populate its choices and enforce its specific client preconditions is `ready`. The server remains authoritative and repeats all guards.

| Control/flow | Required ready sources | Partial-load behavior |
|---|---|---|
| Month/past filters | roles | Existing loaded roles remain filterable; no mutation |
| Create service | all five sources | Disable with source-specific retry copy. A selected target is not `creatable` until the role, lock, setlist, and proposal canonical/raw integrity observations required by A2's create preflight are all ready and clean; never open a roster/date picker from incomplete options |
| Generate month | all five sources | Preview may show per-target `checking`, `exists`, `blocked`, or `unknown`, but confirmation is disabled until the whole generated range has current role, lock, setlist, and proposal canonical/raw integrity observations. Post only targets proven `creatable` |
| Open/edit team or ordinary service fields | roles, members, role-target/integrity | Require a valid singleton selected role, no dangling/raw-draft assignment issue, and its observed revision. Proposal/setlist source failure alone does not block these non-date fields |
| Change a service date | all five sources | Disable the date field until setlist/proposal dependencies are known; when A2 reports dependencies, show that the date cannot move and link the explicit ids/details |
| Delete service | all five sources | Disable until dependency inventory is complete; known dependencies show A2's refusal reason rather than a destructive confirmation |
| Individual or whole-team `Intercambiar` | roles, members, role-target/integrity | Require both selected roles to be valid singletons with fully resolved assignments, observed revisions, stable seat keys, and coordination tokens; proposal/setlist failure alone does not block it |
| Copy instruments | roles, members, role-target/integrity | Require valid singleton source/target roles, resolved seat paths, both observed revisions, and both coordination tokens; proposal/setlist failure alone does not block it |
| Open/edit setlist | roles, role-target/integrity, setlist-target/integrity | Disable for unknown target state; proposals/members are not required merely to edit a known valid setlist |
| Participation sidebar | roles, members | Show retry/unknown state instead of computing from partial membership |
| Proposal handoff | roles, proposals | Disable canonical handoff on proposal failure; explicit integrity issues still open by id when their integrity source is ready |
| Publish ready / override | all five sources | Already hard-blocked by readiness; never publish from partial data |
| Unpublish | roles, role-target/integrity | Require a currently published canonical singleton id/revision plus the safe role/lock ownership and raw-draft integrity observation. Setlist, proposal, member, and publish-readiness failures do not prevent hiding that safely targeted service |

Implement a pure capability selector beside the readiness predicate in `app/components/admin/serviceReadiness.ts`; do not gate controls from aggregate `dataConfidence`. Enforce the result both when rendering and at every handler entry, including add/edit modal open and submit, month preview/confirm, swap selection/confirm, and copy source/destination/submit. Pass a current capability snapshot into `MonthGenerator` and re-check it at preview and confirmation.

For create/month presentation, derive a per-target preflight state without copying A2's mutation decisions:

- `checking`: any required A1/A2 integrity inventory is still loading; never render as vacant or creatable.
- `unknown`: any required domain failed or the response cannot prove a target observation; blocked with source-specific retry.
- `exists`: A1 reports an unambiguous canonical role target; visibly skipped, not creatable.
- `blocked`: any duplicate/invalid/draft-conflict role state, non-vacant/wrong-owner/orphan lock, canonical or raw setlist/proposal history, unassociated target issue, or other explicit A1/A2 preflight issue; show explicit ids/reasons when available.
- `creatable`: every required source is ready and A1/A2 explicitly report no canonical role, no conflicting raw role, an eligible weekend lock observation when applicable, no canonical/raw setlist or proposal history, and no associated integrity issue for that exact normalized target.

These labels are provisional UI capabilities over an observed bundle. The create endpoint still reruns A2's full orphan-history preflight and may return `409`; a changed source or observation invalidates the label before submit. Month preview preserves each target's state and reason independently, posts only still-current `creatable` targets, and never relabels unchecked/failed inventory as empty.

Loading/error copy identifies the missing source and offers its retry. A control never treats an unavailable source as an empty array, and one disabled flow does not disable unrelated controls whose dependencies are ready. Keep last-successful cards visible during a required-source refresh but disable confirmation until that source is ready again. If a required source fails/reloads, either selected role disappears, or either source/target revision changes, invalidate active edit/swap/copy state and require reload rather than submitting the stale snapshot. A `409` keeps the modal/mode open, identifies the conflict, and offers reload.

Component/handler tests cover every matrix row with each required source loading/error, successful retry, proposal-only and setlist-only failure blocking create/month while unrelated non-date controls remain independent, per-target `checking | unknown | exists | blocked | creatable` presentation, handler-level bypass attempts, active-mode invalidation, unresolved refs never being dropped by edit/copy, month generation never posting an unchecked/conflicted/history-bearing target, preservation of unrelated controls, and a server `409` after a post-render race.

## Command summary

Replace the simple count header with:

- upcoming services
- ready-to-publish drafts
- operationally ready published services if useful
- conflicts
- pending/changes-requested proposals
- integrity/unknown issues
- blocked draft count

Example:

```text
Servicios
6 próximos · 2 listos para publicar · 1 conflicto · 1 propuesta pendiente
```

### Global integrity queue

Not every A1/A2 issue can belong to a validated dated service card. Add a visible `Integridad de datos` summary entry and read-only queue keyed by explicit document/draft ids.

Association rules:

- attach to a service card only when a validated canonical role/target id maps unambiguously to that card
- otherwise place it in the global queue, including draft-only roles, invalid-date roles/setlists, dangling/malformed special proposals, orphan locks, and unassociated raw drafts
- source-partial/error state shows that the queue may be incomplete; it never displays zero/clean when integrity inventory failed
- queue details show type, id, reason, related ids when known, and the guarded A2 cleanup/support action; no free-form Studio mutation

Tests cover each unassociated issue type, card association, explicit-id navigation, and partial-source honesty.

Keep existing tools:

- `Intercambiar`
- generate month
- create service
- month filters and past controls
- copy instruments
- participation sidebar

`Intercambiar` must call A2's single atomic swap endpoint with both observed role revisions. Remove the current two independent PATCH requests; any conflict leaves both roles' assignment state unchanged, keeps the UI honest, and offers reload/retry. Copy instruments must call A2's guarded server endpoint with both source/target observed revisions; the server derives the source instruments and a stale source returns `409` instead of copying cached data.

## Readiness-aware bulk publishing

Rename the safe default action to `Publicar listos`.

- Selection includes only visible drafts with `isReadyToPublish === true`.
- Never include blocked, invalid, unknown, proposal grouping-conflict, duplicate role, draft-conflict, or incomplete-setlist cards silently.
- Before mutation, confirmation lists included services and skipped drafts with reasons.
- Submit selected ids to a server-authoritative `publish-ready` endpoint that reloads the current five A1 source domains, recomputes the same shared pure readiness predicate, builds the exact revision guard bundle, and commits through A2's guarded publish-ready transaction helper.
- The server revalidation covers role/lock, setlist, proposal, and every assigned member revision used for availability across all five seat paths. A2's service coordination token protects a proposal appearing after a previously clean `none` state.
- Setlist readiness is submitted as A1's observed singleton id/revision or explicit `none`. In override mode, `none` remains an eligible acknowledged workflow blocker because A2's guarded helper uses the service coordination token to reject a setlist created after that absence observation.
- The batch is atomic: if any selected service is no longer ready or any guard conflicts before commit, publish none and return `409` with per-service reasons.
- Existing individual **publish** remains available as a secondary explicit override for workflow blockers such as team empty, availability conflict, active proposal, or incomplete setlist. It uses the same server-authoritative endpoint in `override` mode, not the ordinary role-only route.
- Override confirmation sends the exact workflow-blocker codes/revisions the admin acknowledged. The server recomputes current readiness, rejects if that set changed, and commits through the same role/lock, setlist, proposal-absence, and member revision guard bundle.
- Hard integrity blockers—invalid/draft-conflict records, duplicate targets, dangling assignments, unknown/error sources, or A2 cleanup requirements—are never override-eligible and are rejected by server recomputation plus A1/A2 integrity guards.
- Handle `409` by refreshing/reviewing; never close as success on failure.

Ready and override publication reuse A2's shared transition notification/cache-revalidation path. Plan B makes no new idempotency or duplicate-notification guarantee for publish.

If a ready/override publish response is lost, times out, or is otherwise outcome-unknown, disable repeat submission and refetch the authoritative A1 readiness bundle plus current canonical publication states. If every submitted role is observed in the requested committed state, show recovered success without sending another mutation. Otherwise do not infer failure or replay automatically: keep the outcome explicit, obtain a wholly new observed guard/readiness bundle, rebuild selection/acknowledgements, and require an explicit retry. A failed/incomplete recovery refetch remains `unknown` with publish disabled. The UI does not claim whether notification delivery ran; A2's documented post-commit best-effort behavior is the only side-effect guarantee.

### Unpublish is a separate safety capability

Unpublishing does not use publish-readiness or override eligibility. A currently published service may be hidden even when its team, availability, setlist, or proposal is unsafe, incomplete, conflicted, invalid, or unavailable, provided the client has the canonical singleton role id/revision and the A1/A2 role-target observation proves the identity, raw-draft state, and weekend lock ownership (when applicable) are safe to target. Submit `published: false` through A2's guarded publication contract; do not send blocker acknowledgements or require member/setlist/proposal observations.

Keep unpublish in the secondary/destructive confirmation flow. Re-check its narrow capability at dialog open and confirmation. A `409` for stale revision, duplicate/invalid/draft-conflict role identity, or lock ownership keeps the dialog open, shows the exact reason, refetches roles plus role-target/integrity, and requires reconfirmation. Other non-OK responses never close as success. For a lost/unknown response, disable repeat, refetch authoritative role identity/publication state, treat an observed draft state as recovered success, and otherwise require a new observed role/lock bundle plus explicit retry. Failure to refetch remains unknown and disabled.

Add pure bulk-selection tests plus server ready/override race tests for proposal creation/change, setlist edit, member availability edit, role edit/delete, blocker-set change, hard-block rejection, A2 side effects, unknown-outcome recovery, and atomic multi-service rejection. Cover no automatic replay after a lost response, observed-commit recovery, changed/unchanged-state explicit retry with a new bundle, and failed recovery refetch. Add unpublish tests proving readiness/override blockers do not disable safe unpublish, unsafe role identity/revision/lock does, unrelated source failure does not, `409` is recoverable without closing, and lost-response recovery sends no automatic repeat. Include legacy `published: undefined`.

## Service card content

### Identity

- day/service name
- Mexico City/local-noon formatted date
- Sunday/Saturday/Special theme
- draft/published badge

### Readiness strip

- Equipo
- Setlist
- Propuesta
- Disponibilidad

Each module has text/icon/color, not color alone.

### Issues

Show concise actionable copy:

- conflict member and note
- pending proposal contributor
- proposal grouping conflict
- duplicate/draft-conflict target ids when useful
- invalid record reason
- failed/unknown source

### Preview

- assigned Lead names
- assigned instrument/FOH names
- setlist song count and keys when ready/incomplete data permits

Do not claim missing expected seats. Live role documents store assignments, not an authoritative required-seat template.

## Action wiring

Reuse existing flows:

- `Resolver conflicto` / `Editar equipo` / `Editar servicio` -> existing service modal
- `Completar setlist` / `Editar setlist` -> existing `SetlistEditor`
- `Publicar` -> guarded publish handler
- `Ocultar` / unpublish -> the separate narrow safe-targeting flow; never route through publish override
- `Revisar propuesta(s)` -> proposal handoff contract below
- `Revisar datos` -> integrity issue details with ids and guarded-support/cleanup instructions; do not open an editable malformed setlist

Delete and other destructive actions stay secondary.

All client mutations keep try/catch/finally, `res.ok` checks, loading reset, conflict copy, and no close-as-success on failure.

## Proposal handoff

`AdminPanel` owns:

- active tab
- transient `ProposalReviewTarget`

Target includes:

- service ref
- current role date/type
- the exact A1 validated proposal id(s) and explicit grouping-conflict metadata when present

Only A1 validated singleton proposals and explicit A1 grouping-conflict results use `ProposalReviewTarget`. Invalid, dangling, malformed, and raw-draft-conflict proposal states use an `IntegrityIssueTarget` carrying explicit document/draft ids and reasons and open read-only integrity details instead of proposal search.

Flow:

1. Service card sets target and switches to `Propuestas`.
2. `ProposalsPanel` resolves the target's exact ids in its loaded A1 validated/indexed response; it does not rebuild target keys, regroup records, or choose a canonical proposal.
3. It changes filter if needed, reveals the exact A1 conflict group when present, scrolls, and highlights.
4. Pending and changes-requested targets are both supported.
5. Load failure is distinct from not found.
6. After successful focus/highlight, or when the user manually leaves/changes tabs, clear the transient target so a remount does not resurrect an obsolete filter/highlight.

Tests cover draft, pending, changes requested, approved, explicit grouping-conflict, changed/not-found, and load-failure handoffs, plus invalid/dangling/raw-draft issues routing to integrity details by explicit id. Tests also prove handoff never reconstructs or canonicalizes a proposal group client-side.

No new route is added unless this contract proves inadequate during implementation.

## Minimal component extraction

Proposed components under `app/components/admin/`:

- `ServiceReadinessCard`
- `ReadinessStrip`
- `ReadinessBadge`
- `ServicePrimaryAction`
- `ServiceIssueList`

Suggested pure helper:

- `app/components/admin/serviceReadiness.ts`

Reuse A1 proposal helpers and A2 mutation errors; do not duplicate target/canonicalization logic in UI files.

Keep modal/mutation flows in `ServicesPanel` unless extraction is clearly smaller and safer.

## Date and responsive invariants

- Parse service dates at local noon: `new Date(iso.slice(0, 10) + "T12:00:00")`.
- Derive today in `America/Mexico_City`.
- Never use bare `new Date(iso)` for service dates.
- Primary actions are touch-visible and at least 44px effective target size.
- Cards, menus, dialogs, and handoff highlighting must not overflow narrow iPhone viewports.
- Preserve safe-area spacing provided by the existing shell.

## Implementation order

1. Confirm implemented A1/A2 contracts and A3 isolated fixtures.
2. Add readiness types, definitive predicate, action priority, and table-driven tests.
3. Add bulk-selection helper plus server-authoritative ready/override publication endpoints, side effects, unknown-outcome recovery, and race tests; keep unpublish on its separate narrow capability.
4. Replace client two-PATCH swap and cached-source instrument copy with A2's guarded server endpoints and stale-source/target tests.
5. Refactor source loading into independent states with component failure/retry tests.
6. Add global integrity queue, proposal/integrity handoff, and transient-target tests.
7. Extract minimal readiness components.
8. Replace service-card hierarchy and command summary.
9. Wire primary/secondary actions and conflict handling.
10. Preserve/test copy instruments, filters, participation, modals, setlist editor, publish, and independently gated unpublish.
11. Run automated local verification.
12. Execute A3's isolated deployed checks, exact `preview` promotion, and read-only desktop/mobile stable-dev verification.

## Verification

Required:

- `npx tsc --noEmit`
- `npm test`
- `npm run build`

Automated/component coverage:

- readiness truth table and every primary-action priority
- multiple simultaneous issues choose the highest-priority action
- bulk selection and skipped reasons
- server-authoritative publish-ready races and atomic batch rejection
- server-authoritative override blocker acknowledgement, hard-block rejection, side effects, and unknown-outcome recovery without automatic replay
- safe unpublish is independent of publish readiness/override, fails closed on unsafe role targeting, and recovers unknown outcomes without automatic replay
- legacy missing `published` treated as published
- empty/valid-missing-key setlist is incomplete and editable
- dangling/malformed/duplicate-key setlist is invalid and non-editable
- team assignment resolution across all five seat paths, including dangling/null refs
- each source failure, partial preservation, retry recovery, and unknown counts/actions
- create/month preflight never labels a target creatable until role/lock/setlist/proposal canonical-and-raw inventories are ready; orphan history and each provisional/blocked state are covered per target
- successful mutation plus failed refresh
- proposal handoff for explicit A1 states/groups, changed/not-found, and load failure without client regrouping
- invalid/dangling/raw-draft proposal issues route by explicit ids to integrity details
- draft-only/invalid-date/unassociated issues appear in the global integrity queue with partial-source honesty
- transient handoff target clearing
- atomic swap conflict leaves both roles' assignment state unchanged; copy-instruments rejects stale source or target without changing the target
- date display and upcoming/past filtering while tests run in a non-Mexico timezone
- automated 320px/375px viewport checks cover cards, long issue copy, menus, and dialogs without horizontal overflow
- keyboard tests cover visible focus, dialog initial focus/containment, Escape/cancel, focus return, and focus retention after validation or `409` errors
- `prefers-reduced-motion: reduce` tests prove nonessential card, dialog, and handoff-highlight motion is suppressed without hiding state changes

Manual/deployed desktop verification on A3's isolated verification deployment:

- all visible cards show correct readiness/action
- integrity blockers never open editable empty state
- existing service/setlist/publish flows still work; safe unpublish remains available independently of publish readiness
- swap, copy instruments, filters, participation, and destructive menus still work
- keyboard focus and screen-reader labels remain usable

Stable-dev desktop/mobile verification is read-only/open-and-cancel unless the user separately authorizes production Sanity writes:

- use authenticated mobile Safari at `https://dev-owt-backstage.vercel.app`
- verify summary, cards, strip, primary actions, menus/dialogs, proposal handoff, horizontal overflow, and safe areas
- do not confirm create/edit/delete/publish/swap/copy/proposal/setlist mutations on the production-backed stable dev domain
- the committed Capacitor origin remains production; native verification is a separate release decision

## Rollout

1. Start from the A1/A2-approved `preview` commit on a clean Plan B feature branch; commit conventionally.
2. Run `npx tsc --noEmit`, `npm test`, `npm run build`, and `git diff --check` on the clean feature commit.
3. Follow A3's proof chain without substitution: synchronize current `origin/main`/`origin/preview`, deploy the exact candidate tree on `verify/service-readiness`, run authenticated mutating checks against the isolated dataset, then promote the verified tree to `preview`.
4. Verify the stable dev domain read-only on desktop/mobile and obtain approval tied to A3's recorded commit/tree/deployment/domain evidence.
5. Promote only through A3's current-main synchronization and fast-forward rule. Do not merge the sibling feature/verification branch directly to `main`.
