# ADR-0085: A Jóvenes leader leads the groups named in `leaderOf`, not every group they are in

**Date:** 2026-11-11 · **Status:** Accepted (2026-11-12) — PR 1 (the read side and K1, #239, in
production since 2026-11-11) and PR 2 (the request contract, L2, the form and the chat).

> **Numbering.** `preview` held a different, unmerged ADR-0085 (the solver redeploy from Actions).
> Records are numbered in the order they reach `main`, so that one became 0086 on `preview` when
> PR 1 merged there (`82f696b5`, 2026-11-11).

## Context

Frank, 2026-11-11: leadership in Jóvenes must be PER GROUP. `teamMembers.ministryRoles` held one
item per ministry, `{ ministry, level: member|leader|admin, groups }`, so a `leader` led EVERY group
they belonged to — five places open-coded `levelIn(...) === "leader"` paired with all their groups.
Jacob must lead Otro Nivel and Adrenalin and only belong to Invencibles. Who leads a group decides
who reads its DRAFT meetings and who writes its meetings (ADR-0081), so this is an ACL change, a
change to a production writer's payload (`memberCommit.ts`) and a data migration. Plan
`docs/superpowers/plans/2026-11-11-jovenes-per-group-leadership.md` (critical tier, two approvals,
review log beside it).

`preview` writes the production dataset, so for weeks old and new code read and write the same
documents: production must be able to READ a narrowed leader before anything can STORE one, and
code that cannot express a narrowing must never widen one it finds.

## Decision

- **Shape:** each item gains `leaderOf`, a subset of `groups`, beside `level`:
  `{ _key: "jovenes", ministry, level: "leader", groups: [...], leaderOf: [...] }`. `groups` keeps
  its meaning (membership: what they read as a member, which seats they fit). Stored, `level ===
  "leader"` ⇔ `leaderOf` present and non-empty; a member or admin item stores no `leaderOf`. An
  admin's `groups` are plain membership; the level alone gives them every group.
- **One reading:** `normalizeMinistryRoles` step 5 (`app/ministries.ts`) reads `leaderOf` fail
  closed — `[]` for any level but `leader`; for a leader, the entries in its kept groups, de-duplicated;
  a present non-array → `[]`. **One answer:** `ledGroupsIn(access, ministry)`
  (`app/utils/ministryAccess.ts`), used by the event writer's `led()`, the reader's leader arm, the
  `/jovenes/admin` gate and `viewer.led`, and `/jovenes`' «Planear». A `leader` who leads nothing is
  a member everywhere. `ledGroupsCoverage.test.ts` fails on any other level comparison with
  `"leader"` (exact lines allow-listed).
- **L1 → L2.** An ABSENT `leaderOf` (no key, `null`, `undefined`) on a leader reads as every kept
  group in PR 1 (L1, today's meaning, so PR 1 changes nobody's access) and as NOTHING from PR 2 (L2).
  PR 1's tree held the switch (`ABSENT_LEADER_OF` in `app/ministries.ts`) and a consented backfill
  (`scripts/backfill-jovenes-leader-of.mjs`, storing `leaderOf` = `groups` on every legacy leader and
  printing THE CHECK — documents whose led groups differ between L1 and L2). The backfill never ran:
  a read of production on 2026-11-12 (raw perspective, drafts included) found every stored Jóvenes
  leader (7) already carrying an explicit `leaderOf` — PR 1's writers had stored it through K1 on the
  pastors' load — so L1 and L2 read identically. PR 2 deleted the switch, the script, its lib and its
  test; the check is re-run by a read right before PR 2 reaches `preview`.
- **PR 2's contract: what is sent is what is stored.** A request item carries EXACTLY `groups`,
  `leaderOf`, `level`, `ministry` (a PR 1 body is 400, refused, never reinterpreted); `leaderOf` ⊆
  `groups`, no repeats, at least one for a leader, none for a member or admin. The «Personas» form
  shows «Lidera» pills (the ticked groups only, none pre-ticked) under «Grupos» while «Líder» is
  selected; the chat's `jovenes` op and a new person must name `leaderOf` for a leader (never
  defaulted: the chat does not guess a grant) and always send it (`[]` for a member or admin).
- **K1 (PR 1 only, `keepLeaderOf` in `memberCommit.ts`; deleted by PR 2, and back if PR 2 is ever
  rolled back to PR 1).** PR 1's requests still carry
  `{ ministry, level, groups }` (a request with `leaderOf` is 400). The writer decides the stored
  `leaderOf` from the person it read, under that read's `_rev`: a stored leader whose `leaderOf` is
  present and differs from its stored groups keeps it ∩ the request's groups, or the write is refused
  409 «Los grupos que lidera esta persona no se pueden cambiar desde aquí…» when that is empty;
  everything else (create, legacy, «leads all») stores the request's groups. So PR 1 code — production
  while PR 2 is on `preview`, or after a rollback of PR 2 — keeps, narrows or refuses, never widens.
  K1's one asymmetry: from PR 1's form, a group added to a leader whose stored `leaderOf` is a strict
  subset joins as MEMBER; one added to a leader whose `leaderOf` equals their groups is LED.
  A stored item the read DROPS (its ministry unticked in Studio, or two items naming it) still never
  widens: each present `leaderOf` on it that does not equal its own groups is intersected too.

## Rejected

- **`groups: [{ id, leads }]` (per-group objects).** Every reader does `groups.filter(isGroupId)` on
  strings and the reads pass `groups` as a GROQ parameter; code already in production would read an
  object array as NO groups, so every pastor saved in the new shape would lose their group's calendar
  on production during the rollout. It also rewrites every stored item.
- **No stored `level: "leader"`, leadership from `leaderOf` alone.** Fails closed under old code, but
  old code is production during the rollout: today's leaders would lose the planner there the moment
  their record is saved, and `leader` would keep two readings forever.
- **One item per (ministry, group), or a sibling field (`jovenesLeaderOf`).** Two items naming one
  ministry are dropped by the read on purpose, and `_key` = ministry is what addresses the item; a
  sibling field splits one person's standing in two places and escapes `droppedMinistryRolePaths`.
- **Requiring a leader to lead EVERY group of a joint meeting.** It would stop every joint meeting
  two leaders agree on unless an admin types it, and changes the rule Frank set on 2026-11-04 (W3).
  One led group still suffices to create or retarget; the creator keeps a joint meeting while they
  lead one of its groups.
- **Naming the field `leads`.** `leads` already means a song's leaders (`songs[].leads`,
  `songLeads.ts`); guards and reviews work by grep.

## Consequences

- `level` and `leaderOf` are redundant for a leader; the read needs BOTH (`level === "leader"` and a
  usable `leaderOf`), so a hand edit that makes them disagree grants the lesser.
- **Never revert PR 1's read side while a narrowed leader exists.** A revert reads every leader whose
  `leaderOf` is narrower than their `groups` as leading all of them. Before any revert (git, Vercel
  instant rollback, promoting an older deployment) once the `jovenesEvents` stage widens, count those
  leaders; never revert while any exists. The same count comes before moving the stage after any
  rollback of PR 2 (K1's «leads all» arm widens from the old form).
- In PR 1 the chat's before/after lines did not show `leaderOf`; from PR 2 they do («líder de Otro
  Nivel y Adrenalin; miembro de Invencibles»), and a change of `leaderOf` alone is a line and a
  write. Leading a group is not management: the chat may add or remove it (ADR-0082 untouched).
- A Studio draft of a person older than a later save, if published, restores the draft's older
  `ministryRoles` — a hazard every `teamMembers` field already has; the 2026-11-12 read covered
  drafts, and the chat's check warns about drafts.
- Do not reintroduce a default for an absent `leaderOf` (on the read, in the chat, or in the form's
  «Líder»): an absent one leads nothing, and every grant of a group is named. A rollback of PR 2 to
  PR 1 restores L1 and K1 together: a stored subset is kept, narrowed or refused, never widened (the
  count above still comes first, for K1's «leads all» arm).
