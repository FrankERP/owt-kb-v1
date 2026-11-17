# Review log — 2026-11-17-jovenes-away-in-planner.md

Skill: `.agents/skills/adversarial-plan-review`. **Approval is NOT authorization to implement**; the
owner's request is (Frank, 2026-11-17: «los pastores de jóvenes también deben poder registrar su
disponibilidad»), and production stays behind his explicit word AND his answer on the audience (see
«Post-approval changes», P1). A plan review replaces neither the code review of the merge range nor
the gates.

The committed plan is the approved bytes, unedited. Its «Status» line («plan under review; nothing
implemented») was true when it was reviewed; the slice is implemented in the same delivery as this
log. What the implementation does beyond or differently from the approved text is listed below,
marked un-reviewed, and recorded in `docs/adr/0090-…`.

## Tier

**Critical**, derived from the ladder (CLAUDE.md §Review policy: an auth/security/ACL boundary). The
slice defines a new audience for member data — who is sent which member's unavailable days — and its
leader arm is the first audience for anyone's availability that is not a ministry's manager. Scope
of the review: the audience contract (plan §3). The screen (§4) was in the packet as context.

## Rounds

Each round was one new reviewer, alone, with only the brief, the snapshot's path and SHA-256, the
repository at the stated HEAD, the evidence pointers and the owner's requirement. No reviewer saw
another's report or this log.

| Round | Reviewed digest (SHA-256) | Base | Verdict | Streak |
|---|---|---|---|---|
| A | `f6d09a1e12dc783e7e7e3c2cf58fdbcffa81798d5dedc0ad43bd10aad6c9ff8d` | branch HEAD 2d917c96 | APPROVED, 8 non-blocking | 1 |
| — | plan edited to adopt A's eight notes | | | 0 (reset: new bytes) |
| B | `cfa979c9035f5845ad4d79a7ee5c165fc9f6cfa911bdee0cffe7ba3a01715fc4` | branch HEAD cb606891 | APPROVED, 10 non-blocking | 1 |
| C | same | same | APPROVED, 6 non-blocking | 2 |

Two consecutive fresh APPROVED verdicts on identical bytes: the critical tier's requirement is met
for digest `cfa979c9…715fc4`, which is the committed plan file. No round returned
CHANGES_REQUIRED, so the churn cap was never in play.

## Round A's notes (all adopted before round B, each checked against the tree first)

1. The contract decides what the APP shows, not who can obtain the field: `teamMembers` is undotted
   in a public dataset (ADR-0057 line 10, ADR-0081 Context). → R0.
2. The leader arm is the first non-manager audience; a line on a Saturday card a leader cannot edit
   is exposure without use. → §1 says what a leader gets; card lines only where the reader can act.
3. Nobody tells the person who marks. → R5's line on `/me/disponibilidad`.
4. §7's «a pastor does not build the roster» contradicted §2 (an encargado assigns parts). →
   rationale corrected, and the limit stated in §4.
5. Compute the visible ids in TypeScript, then read only their days, instead of reading everyone's
   and filtering. → R3.
6. The guard was weaker than its model, and `awayFor` took a caller-built object. → guard (b);
   `awayVisibleTo` takes the access snapshot.
7. Tests for an absent field and for the same people list with and without the option. → §5.
8. «Marcó este día…» is false when a Kids manager recorded the day (`kidsCommit.ts`, verified). →
   «No disponible ese día».

Adopting them reset the streak (new bytes). They were non-blocking and could have waited for the
post-approval list; taking them first cost one round and bought two approvals of the contract as it
is actually built.

## Post-approval changes (un-reviewed by the plan reviewers; covered by the code review of the range)

Rounds B and C left notes after the approved digest. Adopted in the implementation, not in the plan:

- **P1 — the release is tied to the audience answer.** The plan's §6 says production needs Frank's
  word «as for the rest of PR #249». Both reviewers pointed out that a general go would then ship
  the leader arm by default. Rule adopted: the leader arm does not reach production until Frank has
  answered the audience question; if he says go without answering it, the slice ships as «Solo
  admins» (the leader arm removed from `awayVisibleTo`).
- **P2 — guard (b)'s scope is said in the test's header**: it covers the Jóvenes tree only and does
  not stop a new reader of members' days elsewhere.
- **P3 — the line on `/me/disponibilidad`** («Quien planea en Jóvenes ve estos días, sin tu nota.»)
  is shown to the ministry's MEMBERS (`levelIn(access, "jovenes") !== null`), not through
  `isMinistryMember`: a super-admin outside Jóvenes is not in the roster read, so no planner is
  shown their days.
- **P4 — `awayVisibleTo` refuses an inactive snapshot** itself, instead of leaning on the page's gate.
- **P5 — a failed days read throws**, as the people read does; it is never swallowed into «no mark».
- **P6 — the days are bounded to a year** (`@ >= $today && @ <= $limit`, today + 365 days), the
  window the member's own calendar offers.
- **P7 — a Saturday card's line counts every member on the meeting**: its seats and the people of
  its program lines (the plan said «assigned member» without choosing).
- **P8 — docs**: ADR-0090, a line in CLAUDE.md/AGENTS.md §Auth and its long form, the reworded
  header of `jovenesPeople.ts`.
- **P9 — smaller differences from the plan's text**, found by the code review of the range: the
  days query also excludes drafts (`!(_id in path("drafts.**"))`); a person's days are
  de-duplicated and sorted; two or more people on a card read «Ana y Beto: no disponibles ese
  día»; the line on `/me/disponibilidad` says «Quien planea en Jóvenes…» where the plan's R5 said
  «Quien arma el rol de Jóvenes…» (the app calls that screen «Planear»); the picker's line is a
  `role="status"` and the card's line carries the calendar-off icon; `isAway`, `awayNames` and
  `awayLine` live beside `awayVisibleTo`, so that pure function is also in the client bundle (it
  decides nothing there: the client only ever holds what the server sent).

Stated, not built (limits both reviewers asked to have written down):

- «Cambiar con…», «Recorrer» and «Nuevo libro» move or assign responsables with no mark in their
  previews; the card's line is their only signal, after saving, for future dates.
- «Copiar para WhatsApp» never carries a mark (a test pins it): that text leaves the audience.
- An admin gets marks in Planear and none in the same program editor on `/jovenes`,
  `/jovenes/calendario` and `/jovenes/reunion/[token]`. There «no mark» does not mean «available».
- One calendar per person: a pastor who blocks a day for Alabanza reads «no disponible» in Planear
  Jóvenes too. There is no «out for one ministry only».
- The days read is one more sequential round trip on the planner page (it needs the people first).
- The line on `/me/disponibilidad` follows the marker's rollout stage; the planner read does not.
  With the stage at «all» they agree. Narrowing the stage again would leave planners seeing the
  days of pastors who are no longer told (a comment at the page says so).
- P1 is held by people, not by a test: the PR carries it as an open blocker and no auto-merge is
  armed. The «admins only» fallback is a one-line change to the function plus its two test
  matrices and the sentences that name the leader.
  **Closed 2026-11-17 22:25Z:** Frank answered the audience question on its decision card with
  «Admins y líderes de su grupo», the option this branch carries. P1's condition is met; the
  release still needs his explicit word for production, which that answer is not.

## What the reviewers measured (round C, one read-only aggregate query, no names or ids)

23 active Jóvenes people, all in at least one group; 16 also in Alabanza; 4 with future marked
days, all 4 in both ministries (so the days this slice shows first were marked when only worship's
admins saw them); 7 leaders, two of whom lead four and five groups; 4 admins.

## Process notes on the author's side

- For a few seconds after round C started, this log's private draft sat in the same scratch folder
  as the snapshot. The packet told the reviewer to read only the snapshot, and the report shows no
  sign it read anything else, but the folder should have held the snapshot alone from the start.
- The plan was written and reviewed before Frank answered the audience question; its §1 says so and
  P1 keeps that from deciding the question by default.
