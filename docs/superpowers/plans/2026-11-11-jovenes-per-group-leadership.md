# Jóvenes: leadership per group

Status: plan, 2026-11-11. **Review: APPROVED** (critical tier; two fresh approvals on digest
`d8c739c8…5f42`; log `2026-11-11-jovenes-per-group-leadership-review-log.md`). §11 and this line
were added AFTER approval and are un-reviewed. Extends ADR-0075 (levels and groups) and ADR-0081 (a group is a security
boundary; plan `2026-10-30-jovenes-events-access.md`, R1–R3 and W1–W3a). Branch
`claude/project-thread-uqw2lr`, on top of `e11dafc49` (the Adrenalin and Guerreras groups).

**Release state (2026-11-11):** PR 1 (T1–T5, T-mig, T-docs 1, the §11 notes that apply) is
implemented on the branch, gates green, NOT yet reviewed or merged; the backfill has NOT run. The ADR
is `docs/adr/0085-a-jovenes-leader-leads-named-groups.md` (Proposed). `preview` already holds a
different unmerged ADR-0085 (the solver redeploy): the merge into `preview` renumbers whichever
reaches it second to 0086, with its links.

**Critical contract** (CLAUDE.md §Review policy): this changes an auth/ACL boundary (who leads which
group decides who reads a group's drafts and who writes its meetings), the payload of a production
writer (`memberCommit.ts`), and migrates stored data. It goes through
`.agents/skills/adversarial-plan-review/SKILL.md` (two fresh approvals on identical bytes, a
committed `…-review-log.md`) before any code. Approval is not authorization to implement.

## 1. The requirement (Frank, 2026-11-11)

Leadership in Jóvenes must be PER GROUP. Today `teamMembers.ministryRoles` holds one item per
ministry, `{ _key, _type, ministry, level: "member" | "leader" | "admin", groups: string[] }`: one
level for the whole ministry, so a `leader` leads EVERY group they belong to. A person must be able
to lead some groups and only belong to others. His roster:

| Person | Leads | Member only | Level |
|---|---|---|---|
| Jacob | Otro Nivel, Adrenalin | Invencibles | leader |
| Andy | Invencibles | Otro Nivel, Guerreras | leader |
| Fer | Adrenalin | — | leader |
| Noemí | (everything, as admin) | in Emprendedores and Guerreras | **admin** |
| Goma, Gaby | (everything, as admin) | their groups | admin |

Noemí is a ministry-wide ADMIN (she organizes the all-pastors meeting every 2–3 months), not a
per-group leader. `admin` stays as it is: ministry-wide.

## 2. Non-goals

- No change to `admin`, to the member read arm (R2), to the seat holder's program right (W3a), to
  the create token, revision or 404/403 order (W2, W2a, W6, W9), or to who fits a seat (`peopleFit`
  judges MEMBERSHIP of a group, never leadership).
- No change to the joint-meeting rule's shape (§5.3) and none to the three-group cap of an audience.
- No widening of the `jovenesEvents` rollout stage (it stays `superAdmin`; see P0).
- No MCP writer for meetings; no notification.

## 3. What exists today (verified at `e11dafc49`)

"Is a leader" is open-coded as `levelIn(...) === "leader"` in five places, each pairing it with
`groupsIn(...)` to mean "the groups they lead":

| # | Where | Use |
|---|---|---|
| 1 | `app/utils/ministryEventCommit.ts` `led()` | W3: `canWriteStored`, `canSetAudience` |
| 2 | `app/utils/ministryEventReads.ts` `armFor()` | R3: the leader arm, `led: groups` (drafts) |
| 3 | `app/(client)/jovenes/admin/page.tsx` (two lines) | the page gate, and `viewer.led` |
| 4 | `app/(client)/jovenes/page.tsx` | `plans` (shows «Planear») |
| 5 | `app/components/admin/MembersPanel.tsx` submit | «Un líder necesita al menos un grupo.» |

Other readers of the item: `normalizeMinistryRoles`, `validateMinistryRolesWrite`,
`ministryRolesForStorage`, `droppedMinistryRolePaths` (`app/ministries.ts`); `accessFromDoc`
(`memberAccess.ts`); `memberView`, `applyMemberEdits`, `jovenesText`, `plainJovenes`
(`memberEdits.ts`); `validatePatchBody`, `buildCreateDoc` (`memberCommit.ts`); `personSummary`, the
`EDIT` and `NEW_MEMBER` schemas, `newMemberBody` (`app/mcp/tools/members.ts`); the Studio object
(`sanity/schemas/worshipTeam.ts`); the `$all => { ministryRoles }` projection
(`serviceReadQueries.ts`, carries the item whole); `jovenesPlannerModel.ts` (`PlannerViewer.led`,
`canEditGroupEvent`, `canCreateGroupEvent`, `groupEventForm`, `groupEventProblem`,
`editLosesAccess`), which only consumes `viewer.led`. `rollout.ts` and `solverConfigCommit.ts` name
the field but read no level-vs-group meaning. `/me`'s PATCH never writes `ministryRoles`.

Writers of the item: `patchMember`, `createMember(s)` and the chat's `saveMemberEdits`, all through
`memberCommit.ts`, all setting the array WHOLE via `ministryRolesForStorage` (which rebuilds each
item from `ministry`, `level`, `groups` and so drops any other field). The Studio field is read-only.

Blast radius today: `ROLLOUT.jovenesEvents.stage` is `superAdmin`, so no leader reaches `/jovenes`,
Planear Jóvenes or the four event routes yet. Every over-grant discussed below is therefore latent
until the stage widens. The plan does not rely on that (§7), but P0 pins it.

## 4. The data model

### 4.1 Decision: `leaderOf`, a subset of `groups`, beside `level`

```
{ _key: "jovenes", _type: "ministryRole", ministry: "jovenes",
  level: "leader", groups: ["otro-nivel", "invencibles", "adrenalin"],
  leaderOf: ["otro-nivel", "adrenalin"] }
```

- `groups` keeps its meaning: the groups the person BELONGS to (what they read as a member, which
  seats they fit).
- `leaderOf` (new): the groups they LEAD. Always a subset of `groups`.
- `level` keeps its three values. `leader` now means "leads the groups in `leaderOf`".

The name is `leaderOf`, not `leads`: `leads` already means a song's leaders (`songs[].leads`,
`songLeads.ts`, the MCP setlist tools), and this repo's guards and reviews work by grep.

**An admin's groups.** An admin's item is `{ level: "admin", groups: [...], no leaderOf }`. `groups`
is plain membership, exactly as for a member: Noemí is stored `admin` with
`groups: ["emprendedores", "guerreras"]`. It decides what she reads in MEMBER mode (`/jovenes`, the
Calendario: published meetings of her groups and of the whole ministry) and that she fits a seat of
those groups' meetings. Her reach over every group comes from the level alone, in EDITOR mode
(Planear Jóvenes: every meeting, drafts included; every write). Management never implies
membership: an admin with `groups: []` manages everything and belongs to no group. `leaderOf` on an
admin is refused at the write and ignored at the read; it would say nothing the level does not.

### 4.2 Invariants (the reviewer checks these)

- **I1.** `leaderOf ⊆ groups`; every id is a group of that ministry; no repeats.
- **I2.** Stored: `level === "leader"` ⇔ `leaderOf` is present and non-empty. A `member` or `admin`
  item stores no `leaderOf` key.
- **I3.** ONE function answers "which groups does this person lead": `ledGroupsIn(access, ministry)`
  in `ministryAccess.ts`. No other file compares a level with `"leader"` to decide access
  (guard: `ledGroupsCoverage.test.ts`, P1).
- **I4.** The read fails closed: anything about `leaderOf` it cannot use leaves the person leading
  nothing (still a member of their `groups`). One dated exception during the rollout, §4.4 L1.
- **I5.** Leading grants nothing outside `groups`; `admin` and `super-admin` are untouched;
  `isMinistryManager` does not read `leaderOf`.
- **I6.** No writer stores a `leaderOf` that the production reader of that moment would read as
  MORE than it says (§7).

### 4.3 Why this shape over the others

**B. Per-group objects, `groups: [{ id, leads }]`.** The most "correct" on paper, and the one that
breaks: every reader today does `groups.filter(isGroupId)` on strings, the reads pass `groups` as a
GROQ parameter (`@ in $groups`), and code already in production would read an array of objects as
NO groups. While old and new code coexist (`preview` writes the production dataset), every pastor
saved in the new shape would lose their group's calendar on production. It also needs a rewrite of
every stored item, not an addition.

**C. No stored `level: "leader"`; leadership derived from `leaderOf` alone** (store
`level: "member"` + `leaderOf`). Fails closed under old code, which sounds safer, but old code is
what production runs during the rollout: today's leaders would lose the planner there the moment
their record is saved in the new shape. And `level` would keep a value (`leader`) that old records
use and new ones never do, with two readings to maintain forever.

**D. One item per (ministry, group), or a second field outside `ministryRoles`.** Two items naming
one ministry are dropped by the current reader on purpose (`normalizeMinistryRoles` step 4), and
`_key` = ministry is what lets a patch address `ministryRoles[_key=="jovenes"]`. A sibling field
(`teamMembers.jovenesLeaderOf`) splits one person's standing in one ministry across two places that
can disagree, and escapes `droppedMinistryRolePaths` (leaving Jóvenes would leave a stale grant).

**A (chosen). `leaderOf` beside `groups`.**
- *Stored documents:* additive. No stored item becomes unreadable; the migration only ADDS a field
  whose value states today's meaning (§6).
- *Old code reading a new item:* it ignores `leaderOf` and reads `level` + `groups` as today. For
  an item where `leaderOf` equals `groups` that is the same meaning. For a true subset old code
  over-reads (leads all their groups), which is exactly today's behaviour, never worse; and §7
  orders the release so production can read a subset before anything stores one.
- *Old code writing over a new item:* it drops `leaderOf` (set-whole). §7 K1 and L2 make that fail
  closed once the rollout ends.
- *Studio:* the object gains one read-only array field with the same options list as `groups`.
- *MCP:* one optional array beside `groups` in two schemas.
- *Simplicity:* one new pure function; the five open-coded checks collapse into it.

Cost accepted: `level` and `leaderOf` are redundant for a leader (I2 holds them together at the
write; the read trusts neither alone: it needs BOTH `level === "leader"` and a usable `leaderOf`).

### 4.4 The reading, exactly

`MinistryRole` (normalized) becomes `{ ministry, level, groups, leaderOf: string[] }`; `leaderOf`
is always an array there. `normalizeMinistryRoles` steps 1–4 stand; a fifth is added:

5. `leaderOf`: for `level !== "leader"` → `[]` whatever is stored. For a leader: an array → its
   entries that are in the item's kept `groups`, de-duplicated; present but not an array → `[]`;
   **absent** → L1 below. "Absent" means one thing everywhere (this read, K1, the backfill): the
   key is not on the item, or its value is `null`/`undefined`. Any other value is "present".

- **L1 (PR 1 only, transitional).** Absent on a leader ⇒ every kept group. This is today's meaning
  of every stored leader, so PR 1 changes nobody's access.
- **L2 (PR 2, final).** Absent on a leader ⇒ `[]`. Shipped only after the backfill's check reports
  zero leaders without `leaderOf` (§6). From then on I4 has no exception.

`ledGroupsIn(a, ministry)`: `[]` unless `a.ministries` includes the ministry and the item's level is
`leader`; then the item's normalized `leaderOf`. No super-admin or admin arm (callers test
`isMinistryManager` first, as today). `levelIn` and `groupsIn` are unchanged.

## 5. Access rules

### 5.1 The five checks, after

| # | Today | After |
|---|---|---|
| 1 | `led()` = level leader ? all groups : [] | `led()` = `ledGroupsIn(actor.access, ministry)` |
| 2 | `armFor`: leader arm if level leader, `led: groups` | leader arm iff `ledGroupsIn(...).length > 0`; `groups` = all their groups, `led` = `ledGroupsIn(...)` |
| 3 | page gate and `viewer.led` by level | gate: manager or `ledGroupsIn(...).length > 0`; `viewer.led = ledGroupsIn(...)` |
| 4 | `plans` by level | manager or `ledGroupsIn(...).length > 0` |
| 5 | form: leader needs a group | form: a leader needs at least one group they lead (§8) |

`canWriteStored`, `canSetAudience`, `mayRead`, the GROQ arms and `jovenesPlannerModel.ts` keep
their text: they already speak in terms of "the groups the actor leads" (`mine`, `$led`, `v.led`).
Only what feeds them narrows. A `leader` whose `leaderOf` is empty or unusable is, for every check,
a member.

### 5.2 Truth table

Actor is active and a Jóvenes member (otherwise: nothing, as today). "Leads X" = X in
`ledGroupsIn`. "In X" = X in `groups` but not led. Events: `M` whole ministry; `G(x)` one group;
`J(x,y)` joint. Columns: create with that audience · edit/publish/delete a stored one · read its
DRAFT in the planner · read it PUBLISHED as a member.

| Actor | Event | Create | Edit / publish / delete | Read draft | Read published |
|---|---|---|---|---|---|
| super-admin, admin (any `groups`) | any | yes | yes | yes | editor: yes; member mode: `M`, and groups they are IN (super-admin: as their own `groups`) |
| leads A | `G(A)` | yes | yes | yes | yes |
| leads A, in B | `G(B)` | **no (403)** | **no (403; 404 while a draft)** | **no** | yes |
| leads A | `G(C)`, C not theirs | no (403) | no (404, cannot read it) | no | no |
| leads A | `J(A,B)` created by them | yes | yes, while they still lead A or B | yes | yes |
| leads A | `J(A,B)` created by someone else | — | no (403) | yes (it includes A) | yes |
| leads A, in B | `J(B,C)` | **no (403)** | **no** (creator or not: leads none of its groups) | **no** | yes (in B) |
| leads A | edit `G(A)` → `G(B)` or `J(B,C)` | — | no (403: the result holds no group they lead) | — | — |
| leads A | edit `G(A)` → `J(A,B)`, not its creator | — | allowed once; afterwards it is its creator's and the admins' (`editLosesAccess` already warns) | — | — |
| leads A | `M` | no (403) | no (403); program only if seated as encargado/apoyo (W3a, unchanged) | no | yes |
| member (leads nothing), incl. `level: "leader"` with empty `leaderOf` | any | no | no; W3a as above | no; `/jovenes/admin` redirects to `/jovenes` | their groups and `M` |

The bold rows are the change: today "leads A, in B" behaves as "leads A and B". Jacob today can
write Invencibles' meetings and read its drafts; after the roster is set he reads Invencibles'
PUBLISHED meetings only.

### 5.3 A joint meeting when the actor leads only some of its groups

Kept as decided on 2026-11-04 (W3), now read per group: to CREATE or to give an event a `groups`
audience, at least ONE of its groups must be led by the actor (`canSetAudience`: `some`); a stored
joint meeting is written only by its CREATOR, while they still lead at least one of its groups, and
by admins. So Jacob (leads Otro Nivel, in Invencibles) may create «Otro Nivel + Invencibles»: he
invites a group he does not lead, and its leaders read the draft (R3) but cannot edit it. Being
merely IN a group never counts: he cannot create «Invencibles + Emprendedores». Requiring the actor
to lead ALL the groups was weighed and not taken: it would stop every joint meeting two leaders
agree on unless an admin types it, and it changes a rule the owner set (open question Q2).

Demotion per group follows from W1's fresh read: a creator who stops leading every group of their
joint meeting loses it on the next request; one who still leads one keeps it.

## 6. Migration of stored records

Production (to be confirmed by the dry run, never assumed): Jacob `leader` of Otro Nivel +
Invencibles; Milo `member` of Emprendedores; Frank, Gaby/Goma `admin`. Only stored LEADERS change.

**Two different things, kept apart:**

1. **Backfill (a script, consented).** States today's meaning explicitly; changes nobody's access.
2. **The roster (§1's table).** A change of who leads what. NOT a script: Frank sets it in
   «Personas» (or through the chat's check → save) after PR 2 is on production. Each save is his
   own consented write through `memberCommit.ts`, with its before/after lines.

**`scripts/backfill-jovenes-leader-of.mjs`** — dry run by default, `--apply` to write, run with
`node --env-file=.env.local scripts/backfill-jovenes-leader-of.mjs` where the write token lives
(`docs/SECRETS.md`; no new secret). Pure planning in `scripts/lib/leaderOfBackfill.mjs`
(`planLeaderOfBackfill(docs)`), tested in `scripts/__tests__/leaderOfBackfill.test.ts`.

- Reads every `teamMembers` with `defined(ministryRoles)`, published AND `drafts.*`:
  `{ _id, _rev, member_name, alias, ministries, ministryRoles }`.
- For each item with `ministry == "jovenes"`, `level == "leader"` and `leaderOf` ABSENT (§4.4's
  one meaning; a present non-array value is NOT planned, it already reads as leading nothing under
  L1 and L2 alike, and is reported in the skip list): plans
  `set ministryRoles[_key=="<the item's own _key>"].leaderOf = <its groups that are group ids,
  de-duplicated, in registry order>`.
- Writes nothing for, and REPORTS: a leader whose kept groups are empty (leads nothing today
  either); two items naming one ministry (dropped by the read; a person fixes it); an item with no
  `_key`; a person not in Jóvenes by `ministries` (the level is inert); any `leaderOf` already
  present, array or not (left exactly as it is, subset or not).
- Reads with `perspective: "raw"` (explicitly, whatever the client's API-version default), or the
  `drafts.*` documents silently leave the count.
- Normalizes by IMPORTING `app/ministries.ts` (it has no imports by design, so Node 22 loads it
  directly) with an L1/L2 switch exported for the script; `ledGroupsIn` is a few lines over that
  normalized item and is computed in the lib from it. The normalizer is never re-implemented in
  `.mjs`.
- Dry run prints, per person, name · level · groups · `leaderOf` before → after, the skip list, and
  totals. `--apply` commits one patch per document under `ifRevisionId(_rev)`; a 409 is reported
  and that person skipped (re-run). Idempotent: a second run plans nothing.
- Ends with the CHECK both modes print, computed on NORMALIZED reads, not raw items: the number of
  documents (published and drafts) whose `ledGroupsIn(…, "jovenes")` under L1 differs from under L2.
  PR 2 may not merge to `preview` until this is 0 on production data, checked by a fresh dry run
  RIGHT BEFORE that merge (step 4), not only at step 3. Of the skip-list cases only
  ONE can keep it above 0: a leader item with no `_key` and ≥1 kept group (L1 leads all, L2
  nothing; the script cannot address it). Each such person needs a consented hand fix before PR 2: a
  re-save in «Personas» (the Studio array is read-only, `worshipTeam.ts`), which rewrites the item
  with a `_key`, and K1's legacy branch gives it `leaderOf` = `groups`. The others read the same under L1 and L2 (empty kept groups:
  nothing both ways; duplicate items: dropped by the read; not in Jóvenes: inert; a present
  `leaderOf`, array or not: L1 and L2 read it identically).
- **Where it runs.** Cloud sessions have no `.env.local` and no readable keys (CLAUDE.md), so step 3
  runs on Frank's Mac in the primary checkout through a Remote Control session, which has
  `.env.local`. If `docs/SECRETS.md` by then lists a proxy-injected Sanity write token for cloud
  sessions, it may run there instead; check before step 3, never assume.
- Never touches `level`, `groups`, `ministries`, or any other field or type.

Frank's consent is asked on the dry run's exact output, and recorded in the PR.

## 7. Release ordering (old and new code coexist; `preview` writes production data)

**P0. Precondition, held through every step:** `ROLLOUT.jovenesEvents.stage` stays `superAdmin`
until §7 step 6 is done. Widening it is its own later PR.

**K1. PR 1's keep rule (in `memberCommit.ts`, deleted by PR 2).** PR 1's requests still carry
`{ ministry, level, groups }` with no `leaderOf`. What PR 1 stores for a leader:
- the stored item of that person and ministry is a leader whose `leaderOf` KEY IS PRESENT (any
  value, array or not) and does NOT name exactly the item's kept stored `groups` (as a set) → a
  stored narrowing: `leaderOf` := its normalized value ∩ the request's `groups` (a non-array
  normalizes to `[]`); if the result is empty → **409** «Esta persona lidera grupos que ya no
  tendría. Quítale el nivel de líder o edítala desde la versión nueva.», nothing written;
- otherwise (no stored item, not a leader before, a legacy item with no `leaderOf`, or a stored
  `leaderOf` equal to the stored `groups`, which says "leads all" exactly as a legacy item does)
  → `leaderOf` := the request's `groups` (PR 1's meaning of "leader").
- a create (no stored person) → `leaderOf` := `groups`.

A `ministryRoles` write is already pinned to the read's revision (`touchesRoleOrMinistries` is true
whenever `ministries` travels, and a level always travels with `ministries`); the implementer
asserts this with a test rather than assuming it. K1 exists so that PR 1 code (production while
PR 2 is on `preview`, or production after a rollback of PR 2) never WIDENS a subset that PR 2 code
stored: it keeps it, narrows it, or refuses.

| Step | What ships | Why it is safe against the other deployment |
|---|---|---|
| 1 | **PR 1 → preview → main**: read side (L1), `ledGroupsIn` everywhere, writers store `leaderOf` by K1, Studio field, the two review fixes (§9) | Access is identical to today for every stored record. Pre-PR-1 production reads PR 1's items as today (`leaderOf` = `groups`, ignored). Pre-PR-1 production re-saving a person drops `leaderOf` → a legacy item → L1 reads it as today. No request can yet express a subset. |
| 2 | Verify the production alias (alias + SHA) | From here production READS a subset correctly. |
| 3 | **Backfill**: dry run → Frank's consent → `--apply` → check = 0 | Adds `leaderOf` = `groups`. Same meaning under PR 1 and under any older code. |
| 4 | **PR 2 → preview**: requests carry `leaderOf`, strict read (L2), form, MCP, Jóvenes copy, docs. Frank's look on dev. | A subset saved from dev is read correctly by production (PR 1). Production re-saving that person: K1 keeps or refuses, never widens. L2 on dev finds no legacy leader (step 3; PR 1 never writes one). |
| 5 | **PR 2 → main**, verify the alias | — |
| 6 | Frank sets the roster (§1), then one read-only pass: every Jóvenes leader with groups and `leaderOf`, checked against his table | The verification is a `list_members`/dry-run read; nothing is written by an agent. |

`e11dafc49` (the two new group ids) rides PR 1, so production knows `adrenalin` and `guerreras`
before step 6 stores them (its own comment's rule). Until step 2 is verified, nobody assigns
`adrenalin` or `guerreras` on dev: production's next full save of that person would drop the
unknown group.

**Rollback, said aloud.** PR 2 → PR 1: safe (K1; subsets are read correctly; the old form cannot
show or set them and refuses the one edit that would empty them). PR 1 → today's code, after
subsets exist: that code reads a subset leader as leading all their groups and drops `leaderOf` on
a re-save; under P0 nobody but a super-admin reaches anything a leader's reach decides, and after
the roll-forward a dropped `leaderOf` reads as leading NOTHING (L2), visibly, never as everything.
A stale browser tab of PR 1's form against PR 2's server gets a 400 (the key set no longer
matches): refused, not reinterpreted.

## 8. Tasks

Each task: write the failing tests first, then the code; gates on the final tree
(`npx tsc --noEmit`, `npm test`, `npx eslint .` with 0 errors). No per-task reviewer; one
merge-range code review per PR (§Review policy). PR 1's tasks 1–3 and PR 2's tasks 6–7 own the
contract.

### PR 1 — read side, same meaning

**T1. The reading.** `app/ministries.ts`: `MinistryRole.leaderOf`; `normalizeMinistryRoles` step 5
with L1; `ministryRolesForStorage` writes `leaderOf` only for a leader (from the item it is given).
`app/utils/ministryAccess.ts`: `ledGroupsIn`.
Tests — `ministries.test.ts` / `ministryAccess.test.ts` / `memberAccess.test.ts`: a legacy leader
leads all kept groups (L1); explicit subset; `leaderOf` naming a group outside `groups`, an unknown
id, a repeat, a non-array, on a member, on an admin → dropped / `[]`; non-member of the ministry →
`[]`; duplicate-ministry items still drop both; `ministryAccess.equivalence.test.ts` unchanged and
green (worship and kids untouched).

**T2. Every leader check through `ledGroupsIn` (I3).** `ministryEventCommit.ts` (`led`),
`ministryEventReads.ts` (`armFor`), `app/(client)/jovenes/admin/page.tsx`,
`app/(client)/jovenes/page.tsx`. New `app/utils/__tests__/ledGroupsCoverage.test.ts`: a source scan
of `app/**` (tests excluded) that fails on `"leader"` compared with a level outside
`app/ministries.ts`, `ministryAccess.ts` and the display maps it allow-lists by file
(`MembersPanel.tsx`, `memberEdits.ts`, `mcp/tools/members.ts`, the Studio schema).
Tests — `ministryEventReads.test.ts`: the groq-js matrix gains "leads A, in B" and "leader, empty
`leaderOf`"; `mayRead` stays equal to the GROQ on every pair; a draft of B is not read, a published
one is. `ministryEventCommit.test.ts`: every bold row of §5.2 and both joint rows of §5.3, plus the
per-group demotion of a joint creator. `jovenesPlannerPage.test.tsx`, `jovenesPage.test.tsx`:
`viewer.led` is the led subset; a leader of nothing is redirected and sees no «Planear».

**T3. Writers store `leaderOf` (K1).** `memberCommit.ts`: `validatePatchBody` stays pure and
unchanged in what it accepts; the `leaderOf` each item is stored with is decided in `planPatch`
from the stored person (K1) and in `buildCreateDoc` (= `groups`); `resultingDoc`/`memberView`
see the result. In PR 1 `memberView`/`jovenesText` do not show `leaderOf` yet (T7 adds it), so a
K1 narrowing does not appear in the chat's before/after lines; that is fail closed (K1 only keeps,
narrows or refuses), and the PR says so. **Types:** `MinistryRole` gains `leaderOf`, so PR 1 splits
a write-item type, `MinistryRoleWrite = Omit<MinistryRole, "leaderOf">`, for the two request bodies
typed `MinistryRole[]` today (`memberEdits.ts` ~295, `MembersPanel.tsx` ~512). PR 1's form and chat
bodies keep sending `{ ministry, level, groups }`; adding `leaderOf` to a PR 1 body would be
answered 400 on every Jóvenes edit (unchanged key set) and is the wrong fix.
Tests — `memberCommit.test.ts`, `membersMinistries.test.ts`, `ministryRolesWrite.test.ts`: each K1
arm (legacy → all; stored `leaderOf` equal to stored `groups` → the request's groups, so a group
added from the PR 1 form is led; stored subset kept; non-array present → ∩ of `[]` → 409; narrowed
by a removed group; emptied → 409 and no write;
level leader → member removes the key; create); the write is revision-pinned; a request that sends
`leaderOf` is still refused in PR 1 (key set unchanged).

**T4. Studio.** `sanity/schemas/worshipTeam.ts`: the `ministryRole` object gains
`{ name: "leaderOf", title: "Grupos que lidera", type: "array", of: [{ type: "string" }], options: { list: <same as groups> } }`;
the array stays `readOnly`; preview subtitle unchanged. `ministrySchemaSync.test.ts`: the item
lists `leaderOf` with the groups' options. Check `studioProtection.ts` needs no entry (the field
lives on `teamMembers`, not a protected type) and say so in the PR.

**T5. The two review findings on `e11dafc49`.**
(a) `jovenesPlannerModel.ts` `groupEventProblem`: after the empty check,
`if (form.groups.length > 3) return "Elige hasta tres grupos; para todos, usa una reunión de todo Jóvenes.";`
`eventWrite.ts` `CODE_WORDS.invalid_audience` = the same sentence (the writer's `parseAudience`
keeps its 1–3 bound). Tests: `jovenesPlannerModel.test.ts` (four groups → the words; three → null;
the empty and own-group messages keep their order), the eventWrite words test.
(b) `app/mcp/tools/members.ts`: both `groups: z.array(SHORT).max(3)` →
`.max(MINISTRIES.jovenes.groups.length)`. `TOOL_LIST_VERSIONS` is a computed digest
(`toolListDigest` over `registerAllTools`, input schemas included), so it moves by itself, but
`app/api/__tests__/mcpRoute.test.ts` PINS the full digest (`toBe("663bdcc0")`) and fails on
purpose: update that pin deliberately, with a dated line in its comment, in PR 1 (this change) and
again in PR 2 (T7). Each of those releases sends every Claude connector the refresh note
(ADR-0069); say so in the PR. Test in
`memberTools.test.ts`/`members.test.ts`: five groups accepted, six refused.

**T-docs 1.** ADR (see T10) drafted with PR 1's half; `docs/DATA_MODEL.md` (`leaderOf`),
`docs/UTILITIES_AND_COMPONENTS.md` (`ledGroupsIn`, the normalizer), CLAUDE.md §Auth +
`docs/agents/project-rules.md` (one line: "who leads a group is `ledGroupsIn`, never a level
comparison"), `AGENTS.md` if it mirrors that section.

### Between: the backfill

**T-mig.** §6's script, lib and test, in PR 1's branch (so it is reviewed with the reader it
feeds); run only at §7 step 3.

### PR 2 — write side and screens

**T6. The request contract.** `validateMinistryRolesWrite`: an item carries EXACTLY
`groups, leaderOf, level, ministry`; `leaderOf` is an array of that ministry's group ids, no
repeats («Grupo repetido.»), each in `groups` («Solo puede liderar un grupo al que pertenece.»);
`leader` with none → «Un líder necesita liderar al menos un grupo.» (replaces «Un líder necesita
al menos un grupo.», now implied); `member`/`admin` with a non-empty `leaderOf` → «Solo un líder
lidera grupos; un admin ya administra todos.». `ministryRolesForStorage` stores what was validated
(I2). K1 is deleted. `normalizeMinistryRoles` flips to L2.
Tests — `ministryRolesWrite.test.ts`: every refusal above, the exact key set (a PR 1 body → 400),
storage shape per level; `ministries.test.ts`: L2 (a legacy leader leads nothing and is still in
their groups); `memberCommit.test.ts`: K1's tests are replaced by "what is sent is what is stored".

**T7. The chat (MCP people tools).** `memberEdits.ts`: `MemberView.jovenes` gains `leaderOf`;
the `jovenes` op gains optional `leaderOf` (names or ids, resolved by `resolveJovenesGroup`);
rules, in words the model can relay: a leader with no `leaderOf` given → refused «Di qué grupos
lidera (leaderOf); los demás quedan como miembro.» (no default: the chat never guesses a grant); a
`leaderOf` not in `groups` → «Para liderar «X» tiene que pertenecer a «X»: agrégalo a groups.»;
`leaderOf` with `member`/`admin` → refused as in T6. `jovenesChange` compares `leaderOf` too.
`jovenesText`: «líder de Otro Nivel y Adrenalin; miembro de Invencibles», «admin (Emprendedores,
Guerreras)», «miembro (Emprendedores)». `mcp/tools/members.ts`: `leaderOf` in `EDIT` and
`NEW_MEMBER` (`.max(MINISTRIES.jovenes.groups.length)`), `personSummary` through the same text,
the two descriptions («jovenes {level, groups, leaderOf}: leaderOf son los grupos que lidera, parte
de groups; solo con level leader»). The digest moves; update the `mcpRoute.test.ts` pin on purpose
(see T5(b)). ADR-0082's rule stands untouched: `chatAccessRefusal` protects `admin` (the level), `managesMinistries`
and the roles; it does not protect `leader` today (verified), so the chat may add or remove one
group's leadership exactly as it may give or take the `leader` level, always through check → save
with the before/after line. A test pins that a `leaderOf` change alone is never a `chat_access`
refusal and that dropping `admin` still is.
Tests — `memberEdits.test.ts`, `memberTools.test.ts`, `members.test.ts`: each rule, the lines, a
change of `leaderOf` alone produces a line and a write, no change produces none.

**T8. «Personas» (`MembersPanel.tsx`).** The form's level state gains `leaderOf`, seeded from
`normalizeMinistryRoles`. With «Líder» selected, a second row of pills under «Grupos», labelled
«Lidera», offers only the ticked groups; unticking a group removes it from `leaderOf`; choosing
«Líder» pre-ticks nothing (an explicit choice, fail closed); leaving «Líder» clears it. Submit
refuses a leader with none («Un líder necesita liderar al menos un grupo.»). Hint: «Admin
administra todo Jóvenes. Un líder planea solo los grupos que lidera; en los demás es miembro. No da
acceso a Alabanza.» The row line of a person, if it shows the level, uses T7's wording. House
primitives only (`Button variant="pill"`, `SegmentedControl`).
Tests — `memberFormMinistries.test.tsx`: the seed, the pills follow the groups, the refusal, the
body carries `leaderOf` (and `[]` for member/admin), an untouched form sends neither key.

**T9. Jóvenes screens.** No new rule: they consume `viewer.led`. Confirm by test
(`groupCalendar.test.tsx`, `jovenesPlannerModel.test.ts`) that for "leads A, in B": the new-meeting
form starts on A, B's published meeting shows no «Editar», a form with only B says «Incluye uno de
tus grupos.», and `editLosesAccess` still warns. Copy: where the planner says «tus grupos» for what
a leader may plan, say «los grupos que lideras».

**T10. Docs.** A new ADR, `docs/adr/0085-a-jovenes-leader-leads-named-groups.md` (the choice
rejects real alternatives, §4.3, and the L1 → L2 flip and K1 are exactly what a later reader would
"fix"; it records K1's one asymmetry: from the old form, a group added to a leader whose stored
`leaderOf` is a strict subset joins as member, while one added to a leader whose `leaderOf` equals
their groups is led), linked from ADR-0075 (addendum line) and ADR-0081; `CONTEXT.md` «Nivel» and «Grupo»
(leading is per group; an admin's groups are membership); `docs/MCP.md` (the `jovenes` op and
`NEW_MEMBER`), `docs/API_REFERENCE.md` (the members body), `docs/DATA_MODEL.md`,
`docs/ROUTES.md` (`/jovenes/admin`: "leads at least one group"), CLAUDE.md §Auth and
`project-rules.md`; this plan's status and the release state as each step lands.

### Files touched (complete)

PR 1: `app/ministries.ts`, `app/utils/ministryAccess.ts`, `app/utils/ministryEventCommit.ts`,
`app/utils/ministryEventReads.ts`, `app/utils/memberCommit.ts`, `app/utils/jovenesPlannerModel.ts`,
`app/utils/memberEdits.ts` and `app/components/admin/MembersPanel.tsx` (type only:
`MinistryRoleWrite`, T3),
`app/(client)/jovenes/page.tsx`, `app/(client)/jovenes/admin/page.tsx`,
`app/components/jovenes/eventWrite.ts`, `app/mcp/tools/members.ts`,
`sanity/schemas/worshipTeam.ts`, `scripts/backfill-jovenes-leader-of.mjs`,
`scripts/lib/leaderOfBackfill.mjs`, their tests (named per task, plus new
`ledGroupsCoverage.test.ts` and `scripts/__tests__/leaderOfBackfill.test.ts`), docs.
PR 2: `app/ministries.ts`, `app/utils/memberCommit.ts`, `app/utils/memberEdits.ts`,
`app/mcp/tools/members.ts`, `app/components/admin/MembersPanel.tsx`,
`app/components/jovenes/GroupCalendar.tsx` (copy only, if any), tests, docs, the ADR.
Read and confirmed to need NO change: `memberAccess.ts` (carries the normalized item),
`authGuards.ts`, `rollout.ts`, `serviceReadQueries.ts`, `solverConfigCommit.ts`, `/me`'s PATCH,
`app/api/ministries/[ministry]/eventRoute.ts`, `jovenesPeople.ts`.

## 9. Compatibility accepted, said aloud

- In PR 1 a leader given a NEW group from the old form, when their stored `leaderOf` is a strict
  subset of their stored groups, joins it as a member (K1 intersects). Fail closed; visible in PR
  2's form. After the backfill (step 3) every leader stores `leaderOf` = `groups`, which K1 reads
  as legacy, so between steps 3 and 5 the production form keeps its own meaning of «Líder» for
  everyone whose leadership PR 2 has not narrowed (and nobody's is narrowed before step 6).
- A Studio draft of a person that predates a later save, if published, restores the draft's older
  `ministryRoles` (a widening if the save narrowed `leaderOf`). This hazard already exists for
  every `teamMembers` field (`memberCommit.ts` writes the published document); the backfill covers
  drafts so none is left legacy, and the chat's check already warns about it (`STUDIO_DRAFT`,
  `app/mcp/tools/members.ts`: «si alguien lo publica, sobrescribe este cambio»). No change.
- Between steps 1 and 3 a legacy leader still leads all their groups (L1). That is today.
- `level` and `leaderOf` can disagree only through a hand edit of the document; the read then
  grants the lesser (I4).

## 10. Open questions for Frank

- **Q1.** The full roster: for every pastor, level, groups, and which they lead (the table in §1
  has four people). Step 6 needs it; nothing before does.
- **Q2.** A joint meeting: keep "includes at least one group you lead" (recommended; §5.3), or
  require leading every group in it?
- **Q3.** Jacob loses the DRAFTS and the editing of Invencibles the moment his record is set. Any
  Invencibles draft he created stays readable to Andy (who leads it) and the admins. OK?
- **Q4.** Widening `jovenesEvents` past `superAdmin` is deliberately not in this plan. Confirm it
  waits for step 6.

## 11. Post-approval changes (UN-REVIEWED)

Added after the approving rounds, from their non-blocking notes. Approval covers digest
`d8c739c8…5f42` only; where this section and §1–§10 differ, this section wins and the merge-range
code review checks it.

- **N1. Never revert PR 1's read side while a narrowed leader exists.** Once the rollout stage
  widens, a revert of PR 1 reads every leader whose `leaderOf` is narrower than their `groups` as
  leading all of them. ADR-0085 and `project-rules.md` §Ministries carry the rule, in the words of
  «Readable ≠ writable»: count those leaders first; never revert while any exists. Same before
  moving the stage after any rollback of PR 2 (K1's equal-set arm widens from the old form).
- **N2. PR 2's chat bodies.** With T6's exact key set, `applyMemberEdits` (`memberEdits.ts` ~295)
  and `newMemberBody` (`mcp/tools/members.ts` ~278–286) ALWAYS send `leaderOf`, `[]` for member and
  admin. T7's leader rule (no `leaderOf` given → refused) applies to `NEW_MEMBER` as well as the
  edit op. Tests: a member-level chat create and edit of a Jóvenes person succeed.
- **N3. The hand fix for a leader item with no `_key`.** An untouched «Personas» form sends no
  `ministryRoles` (`MembersPanel.tsx` ~510): the runbook says to change and restore the Jóvenes
  level (or a group) so the row is sent. A `drafts.*` or `versions.*` document with the defect
  cannot be fixed there; it is discarded, with Frank's consent, before PR 2.
- **N4. The L1/L2 switch and the script's lifetime.** The switch exported from `app/ministries.ts`
  exists only in PR 1's tree. The step-4 dry run runs from PR 1's tree (production's code). PR 2
  deletes the switch, the backfill script, its lib and its test. PR 1 adds a vitest pinning the
  lib's led-groups result to `ledGroupsIn` on the same fixtures.
- **N5. Planner copy (T9).** «Incluye uno de tus grupos.» becomes «Incluye uno de los grupos que
  lideras.» in PR 2; `app/utils/jovenesPlannerModel.ts` joins PR 2's file list and T9's test asserts
  the new sentence.
- **N6. Coverage guard scope (T2).** `ledGroupsCoverage.test.ts` scans LEVEL comparisons only
  (`levelIn(`… `"leader"`, `.level` … `"leader"`), not `arm.kind === "leader"`
  (`ministryEventReads.ts` 47/112/152). Its allow-list names exact display lines, not whole files,
  so a future access decision in `MembersPanel.tsx`, `memberEdits.ts` or `members.ts` is caught.
- **N7. K1 details.** A `null` stored `leaderOf` takes the legacy arm (§4.4's one meaning of
  absent; "any value" in K1 means any non-null value). The 409 text becomes «Los grupos que lidera
  esta persona no se pueden cambiar desde aquí. Quítale el nivel de líder, guarda, y vuelve a
  dárselo.», true after a rollback and for a stored non-array value too.
- **N8. Said aloud.** A stored leader with zero kept groups reaches `/jovenes/admin` today and is
  redirected after PR 1: a harmless narrowing, so "PR 1 changes nobody's access" excepts it.
  `invalid_audience` also answers an unknown or repeated group and a ministry audience with groups;
  the form prevents those, so «Elige hasta tres grupos…» is accepted for all of them.
- **N9. Backfill.** Reports `versions.*` (Content Releases) documents beside `drafts.*`. Rollback:
  unset exactly the `leaderOf` paths in the `--apply` run's list (changes nothing under L1).
- **N10. Fixtures.** Under L2, every existing fixture storing `level: "leader"` without `leaderOf`
  leads nothing (the `ministryEventReads` groq-js matrix, `ministryEventCommit`, the page tests,
  `rollout`). PR 2 adds `leaderOf` to them, keeping each test's intent, rather than flipping
  expectations.
- **N11. Cross-reference.** §7 step 1's "the two review fixes (§9)" means T5 (§8).
