# Service Readiness — the admin UI layer

> **Scope.** The `/admin → Servicios` surface: how a service card decides it is ready,
> what the single primary action is, and how integrity problems reach an operator.
> This is "Plan B" of the service-readiness program.
>
> **Read first:** [`ARCHITECTURE.md` §8 Canonical operational reads](ARCHITECTURE.md#8-canonical-operational-reads)
> (the A1 read contract this layer consumes) and
> [`API_REFERENCE.md` — The protected mutation contract](API_REFERENCE.md#the-protected-mutation-contract)
> (the A2 write contract it submits to). For deployed verification see
> [`VERIFICATION_HARNESS.md`](VERIFICATION_HARNESS.md).

---

## 1. The one rule that explains the whole layer

**Pure modules decide. Components render.**

Every file in this layer is either a pure `.ts` module with no React, no `fetch` and no
Sanity import, or a `.tsx` component that renders what those modules return and decides
nothing itself. The split is not stylistic — it is what makes the readiness rules testable
without a DOM, and it is why the same predicates can run **client-side for display** and
**server-side for authorization** without drifting.

The second rule follows from the first:

**A failure is never a clean value.** Every derivation in this layer collapses to
`unknown` — never to `empty`, `assigned`, `clear` or `ready` — when its input is
unproven. A source that returns HTTP 200 with the wrong shape is a *failed* load, not an
empty one. A dangling member reference is an integrity issue, never a clean empty team.
The cost of that choice is occasional false caution; the cost of the opposite is
publishing a service computed over data nobody proved.

---

## 2. Files

| File | Kind | Role |
|---|---|---|
| `serviceReadiness.ts` | pure | The state machine: dimensions, the ladder, per-control gating, date math. |
| `serviceCardModel.ts` | pure | Card assembly + every presentational decision and Spanish copy table. |
| `serviceIntegrityQueue.ts` | pure | Turns A1 integrity records into owned-by-card or global queue entries. |
| `serviceSourceState.ts` | pure | The five-source loading reducer, control gating, stale-edit invalidation. |
| `publishSelection.ts` | pure | Which drafts bulk-publish may submit; the blocker vocabulary. |
| `proposalHandoff.ts` | pure | The card → tab → panel handoff contract. |
| `applyRefreshedRole.ts` | pure | Adopts the committed `_rev` a guarded edit returns. |
| `serviceHandoffContext.tsx` | context | The handoff API a card calls; no-ops outside a provider. |
| `ServiceReadinessCard.tsx` | component | One service card. |
| `ReadinessBadge.tsx` | component | One icon + text + tone chip. |
| `ServiceIssueList.tsx` | component | Blocking-issue lines, truncated with a count. |
| `ServicePrimaryAction.tsx` | component | The single primary-action button. |
| `IntegrityQueuePanel.tsx` | component | The standalone "Integridad de datos" panel. |

Mounting hierarchy:

```
AdminPanel.tsx  (services tab)
└─ ServiceHandoffProvider
   ├─ IntegrityQueuePanel        ← fetches the three service-integrity routes itself
   └─ ServicesPanel
      └─ ServiceReadinessCard    ← one per visible card
         ├─ ReadinessBadge       (publication badge)
         ├─ ServiceIssueList
         └─ ServicePrimaryAction
```

`AdminPanel`'s `proposals` tab is wrapped in the *same* provider, which is how a card's
"Revisar propuesta" can switch tabs and hand a target to a sibling panel.

---

## 3. The five sources

`SERVICE_SOURCE_KEYS = ["roles", "members", "proposals", "roleTargets", "setlistTargets"]`

Each loads independently and is `loading | ready | error`. `serviceSourceState.ts` holds the
reducer; a failure **keeps whatever was last loaded**, so unrelated cards stay rendered —
the `error` status is what disables the controls that need it, not a blank screen.

`deriveDataConfidence(sources)` collapses the five into `complete | partial | error`. It is
**presentational only** and must never gate a control — the source comment says so
explicitly. Gating always reads individual source states through
`CONTROL_REQUIRED_SOURCES`, which lists, per control, exactly which sources it needs.

The 13 controls: `monthFilters`, `createService`, `generateMonth`, `editTeam`,
`changeServiceDate`, `deleteService`, `swap`, `copyInstruments`, `editSetlist`,
`participationSidebar`, `proposalHandoff`, `publishReady`, `unpublish`.

`unpublish` deliberately requires only `["roles", "roleTargets"]`. Hiding a published
service is a safety valve, and it must stay available precisely when the setlist, proposal
or member data is unsafe or unavailable — the situation where you most want to pull a
service back.

---

## 4. The dimensions

| Dimension | Values | Fails closed to |
|---|---|---|
| `recordStatus` | `valid \| invalid` | — |
| `roleTargetStatus` | `single \| duplicate \| draft_conflict \| invalid \| unknown` | `invalid` on an observed `none` |
| `teamStatus` | `assigned \| empty \| unknown` | `unknown` |
| `setlistStatus` | `none \| incomplete \| ready \| duplicate \| draft_conflict \| invalid \| unknown` | `unknown` |
| `proposalPresentation` | `none \| draft \| pending \| changes_requested \| approved \| conflict \| invalid \| draft_conflict \| unknown` | `conflict` on contradictory input |
| `availabilityStatus` | `clear \| conflict \| unknown` | `unknown` |
| `publishState` | `draft \| published` | — |

Three of these encode a deliberate refusal to guess:

- **`roleTargetStatus`** — an observed `none` contradicts the card's own existence, so it
  fails closed to `invalid` rather than inventing a clean target.
- **`proposalPresentation`** — more than one validated record with no explicit conflict is
  contradictory input; it reports `conflict` rather than selecting a winner.
- **`teamStatus`** — a dangling assignment is blocking, and must never read as a clean
  empty *or* a clean assigned team.

### Readiness

`isOperationallyReady(d)` is true only when **all five sources are ready** and
`recordStatus === "valid"`, `roleTargetStatus === "single"`, `teamStatus === "assigned"`,
`danglingRefCount === 0`, `setlistStatus === "ready"`, `proposalPresentation ∈ {none, approved}`,
`availabilityStatus === "clear"`, and `blockingIssueCount === 0`.

Publication state is deliberately **excluded**, so a published service can use the same
predicate as an ongoing health signal.

`isReadyToPublish(d)` = `publishState === "draft" && isOperationallyReady(d)`.

---

## 5. The primary-action ladder

Every card shows exactly **one** primary action. `resolvePrimaryAction(d)` is a 15-rule
ladder over 13 action kinds; **first match wins**, and each result carries its rule number
(rendered as `data-action-rule`, which makes the ladder debuggable in the DOM).

| # | Kind | Fires when |
|---|---|---|
| 1 | `review_data` | invalid record, invalid/draft-conflicted proposal, draft-conflicted/invalid role target, any dangling ref, or a supplied blocking issue |
| 2 | `review_duplicate_roles` | duplicate role target |
| 3 | `review_setlist_data` | setlist duplicate / draft_conflict / invalid |
| 4 | `loading` *(disabled)* | any required source still loading |
| 5 | `retry_load` | any required source failed |
| 6 | `review_data` | sources ready, but a derived dimension is still `unknown` |
| 7 | `resolve_conflict` | availability conflict |
| 8 | `review_proposals` | proposal grouping conflict |
| 9 | `review_proposal` | proposal pending / changes_requested |
| 10 | `review_proposal` | proposal draft |
| 11 | `complete_setlist` | setlist none / incomplete |
| 12 | `edit_team` | empty team |
| 13 | `publish` | clean draft |
| 14 | `edit_setlist` | clean published |
| 15 | `edit_service` | unreachable fallback |

Three orderings are load-bearing:

- **Rule 4 outranks rule 5** so a card never invites a retry while a fetch is still in
  flight.
- **Rules 1–3 outrank everything** — an integrity problem is never presented as a
  workflow step. You cannot be told to "complete the setlist" of a service with two
  conflicting setlist documents.
- **Rule 15 is unreachable** by construction (every unclean dimension matches an earlier
  rule). It exists so an out-of-contract value degrades to a safe, non-destructive action
  instead of throwing.

`servicePrimaryActionProps` never inspects a dimension to pick an action — it copies the
ladder's output and adds routing and gating. That is what keeps the ladder the single
authority.

---

## 6. The integrity queue

`serviceIntegrityQueue.ts` answers one question per A1 integrity record: **does exactly one
validated card own this, or is it global?**

The association rule is strict: attach to a card only when a validated canonical role or
target id maps **unambiguously** to that card. Zero candidates is not a match; two or more
is not a match. Both land in the global queue instead, because a misattributed issue is
worse than an unattributed one.

Lock issues associate by the lock's own `targetKey`, never by `roleId` — a `wrong_owner`
lock's `roleId` is *precisely the wrong owner*, so attaching its issue to that role's card
would point the operator at the wrong service.

**Only `lock` and `legacy` kinds feed back into a card's readiness** (`cardIssues`). Every
other kind is already a readiness dimension; supplying it twice would inflate
`blockingIssueCount` and let rule 1 swallow rules 2–3, destroying the ladder's precision.

### Tone honesty

`integrityQueueTone` can only report `clean` from a **fully proven zero-entry inventory**.
A `ready` source with a `null` summary is treated as unproven, not empty — an HTTP 200 that
could not prove an inventory is still incomplete. A failed domain reports `unknown` or
`issues_incomplete`, never a reassuring zero.

Unknown reason tags render verbatim rather than being dropped, so a new A1 or A2 reason can
never silently disappear from the queue.

### Cleanup is never "go fix it in Studio"

A2 made all eight protected types read-only in Studio (see
[`AUTH_AND_SECURITY.md`](AUTH_AND_SECURITY.md#studio-write-protection)), so the queue's
action copy directs operators to the guarded operator command
(`scripts/service-readiness-cleanup.mjs`) with explicit ids — never to a Studio URL that
would present a read-only document and waste the trip. A test pins this
("never directs cleanup to Studio").

---

## 7. Bulk publish

`publishSelection.ts` keeps **two disjoint blocker vocabularies**:

- **`PUBLISH_WORKFLOW_BLOCKERS`** (4): `availability_conflict`, `active_proposal`,
  `incomplete_setlist`, `team_empty`. These are the *only* codes an explicit override may
  acknowledge — a human can knowingly publish a service with an empty setlist.
- **`PUBLISH_HARD_BLOCKERS`** (18): `source_unready`, `invalid_record`,
  `role_target_duplicate`, … `cleanup_required`. **Never override-eligible**, because no
  acknowledgement makes a publish computed over unproven state safe.

`selectPublishReady` submits a candidate only when it has a usable identity, is a first
occurrence, is a draft, has zero blockers of either kind, **and** `isReadyToPublish`
independently agrees. That last check is deliberate redundancy against a caller handing over
a self-contradictory readiness object.

### The two publish actions

The confirmation modal offers two commits, both server-recomputed:

| Action | Submits | Reaches |
|---|---|---|
| `Publicar N` | `mode: "ready"` | drafts with **zero** blockers |
| `Publicar todos (N)` | `mode: "override"` | the above **plus** drafts blocked only by `BULK_OVERRIDE_BLOCKERS` |

**`BULK_OVERRIDE_BLOCKERS`** is a strict subset of the workflow four:
`active_proposal` + `incomplete_setlist`. Roles are published *before* the setlist exists —
that is how a member learns which day they serve and that they need to plan for it — so a
missing setlist is the normal state of an announceable service and one acknowledgement can
cover the whole month.

The other two are deliberately **not** batchable and stay on the per-card override:
`availability_conflict` (someone assigned said they cannot serve that day; publishing emails
them that they are serving anyway — that is a conversation, not a batch) and `team_empty`
(nobody is assigned, so publishing announces nothing to anyone).

`Publicar todos` sends **one** `override` batch in which a ready draft carries an *empty*
acknowledgement, so the whole month commits in a single atomic transaction. The button is
hidden entirely when the override would add nothing beyond `Publicar N`.

The client's selection is a **hint, never an authorization**: `publishReadyBundle.ts`
reloads all five domains server-side and re-derives readiness with the same predicates
before writing anything. In `override` mode each entry is compared against its **own**
freshly recomputed workflow set, and one mismatch rejects the entire batch.

Counters are computed over the **visible** set only, so "listos para publicar" always equals
exactly what the button would submit.

---

## 8. Handoff

`proposalHandoff.ts` models the card → tab → panel jump as a pure contract. Resolution is an
**exact-id lookup**: it never rebuilds a target key, never re-groups records, and never picks
a canonical proposal out of an ambiguous group. Zero groups or several groups fail closed to
read-only integrity details with reason `ambiguous_group`.

`reduceReviewTarget` is the single owner of `{tab, target}`. That centralisation is what
guarantees a manual tab change cannot strand a stale target, and a successful focus consumes
it so a remount cannot resurrect an obsolete filter.

Outside a provider every handoff setter is a no-op, so a card renders standalone in tests.

---

## 9. Two client-side correctness rules worth knowing

**Adopt the committed revision.** A guarded edit returns the stored document at the revision
it just committed. `applyRefreshedRole` adopts it. Before this existed the panel discarded it
and relied on a follow-up reload — and when that reload failed, the card kept its pre-write
`_rev`, so the operator's very next save was refused with a 409 *we* caused, on data that was
perfectly healthy. It fails closed (anything unrecognisable is ignored, since a wrong local
revision is worse than a missing one) and **replaces rather than merges**, because a merge
would keep a seat the commit had removed.

**Latch the first invalidation.** An open edit/swap/copy session is invalidated when a
required source fails, a selected role disappears, or its revision changes. `latchInvalidation`
keeps the **first** detected invalidation: a source that fails and then recovers must not
silently re-arm a submit built on the pre-failure snapshot. The operator reloads explicitly.

---

## 10. Accessibility and layout invariants

- Colour is never the only carrier of meaning. Every `ReadinessBadge` renders an icon **and**
  Spanish text; the icon is `aria-hidden` so a screen reader reads the label once.
- Purple is reserved exclusively for special-service identity and is never a readiness tone.
- `CARD_SECTIONS` **is** the rendered order — the card maps over it, so a reorder breaks a
  test rather than drifting silently. The four-module readiness strip that Plan B put at
  position 2 was removed: it repeated the issue lines and the preview, and it crowded out
  the card content in the three-column month view. Readiness itself is unchanged — the
  issue lines and the primary action still render the same ladder.
- A service with no setlist yet emits **no** issue line. Roles are published before anyone
  plans a setlist, so "sin setlist" is the normal starting state, not a problem to flag.
- `ServiceIssueList` truncates to 4 lines plus "y N problema(s) más", so a broken record
  cannot fill the page.
- Narrow-viewport (320 px / 375 px) class invariants are pinned by tests.

---

## 11. Tests

| File | Pins |
|---|---|
| `serviceReadiness.test.ts` | the full 3⁵ source-state space, every ladder rule *and its precedence*, the control matrix, Mexico-City date math run under a non-Mexico ambient timezone |
| `serviceCardModel.test.ts` | section order, issue copy, publish confirmation copy, primary-action routing |
| `serviceIntegrityQueue.test.ts` | association ambiguity, the wrong-owner lock case, partial-source honesty, "never directs cleanup to Studio" |
| `serviceSourceState.test.ts` | reducer semantics, per-control gating, invalidation latching |
| `publishSelection.test.ts` | the two vocabularies stay disjoint, override refusal, fail-closed selection |
| `proposalHandoff.test.ts` | exact-id resolution, ambiguous-group fail-closed, the tab/target reducer |
| `applyRefreshedRole.test.ts` | rejects a body with no `_rev`, replaces wholesale, preserves array identity |

The components themselves have no separate test files — their decisions live in the pure
modules, which is the point of the split.
