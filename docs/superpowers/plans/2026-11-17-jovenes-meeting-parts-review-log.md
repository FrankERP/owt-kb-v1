# Review log — 2026-11-17-jovenes-meeting-parts.md

Skill: `.agents/skills/adversarial-plan-review`. **Approval is NOT authorization to implement**; the
owner's request is (Frank, 2026-11-17: «Me gustaría que les lleguen correos de asignación a las
personas que se les asigna algún rol en la reunión. Me gustaría que también carguen información al
respecto de su participación […]»), and the plan's release steps keep production behind his
explicit word. A plan review replaces neither the code review of the merge range nor the gates.

The plan and this log say «ADR-0090» in places: the record is `docs/adr/0089-…` (see «Post-approval
changes»).

## Tier

**Critical**, derived from the ladder (CLAUDE.md §Review policy), for the writer slice (plan §4,
M0–M7): it changes the payload of a production writer (`ministryEventCommit.ts`, a full-array
program serializer), adds a write right (W10, «Mi parte») behind a group security boundary
(ADR-0081), and defines a notification audience. The reader (§5), the setlist read (§6) and the
screens (§7) were in the packet as context and are standard work.

## Rounds

Each round was one new reviewer, alone, with only the brief, the snapshot's path and SHA-256, a
baseline export of `main` 5804fb05, the evidence pointers and the owner's requirement. No reviewer
saw another's report or this log.

| Round | Reviewed digest (SHA-256) | Base | Verdict | Streak |
|---|---|---|---|---|
| A | `6339c084882fb144a0ec7bd9f264428726aa108aada249909a812ccf56a0b115` | `main` 5804fb05 | APPROVED, 11 non-blocking | 1 |
| B | same | same | CHANGES_REQUIRED, 2 verified blockers | 0 (reset: blockers) |
| — | plan edited for B's blockers and A's and B's notes | | | 0 (reset: new bytes) |
| C | `e1d9d488904af0ae1390aa8bac2854d92f91e347228609477d901db48094cf8f` | same | APPROVED, 9 non-blocking | 1 |
| D | same | same | APPROVED, 11 non-blocking | 2 |

Two consecutive fresh APPROVED verdicts on identical bytes: the critical tier's requirement is met
for digest `e1d9d488…94cf8f`, which is the committed plan file. Churn: one substantive
CHANGES_REQUIRED round of the two allowed.

## Blockers

### Round B

- **B1 — four answers to «which meeting has parts», the narrowest on the full-array save.**
  VERIFIED against the baseline: `meetingKind` (`jovenesPlannerModel.ts`) stores kind `ministry`
  when a Saturday meeting moves to another weekday, and the program editor's body carried only
  `_key, label, member, note`, so `lineDoc` would have dropped `part`, `member2`, `music` and
  `helpers` on the next save, and the notices would then have told Frank «Ya no piden música» when
  nobody withdrew. FIXED in the plan: one rule (D1: a part line is storable on any meeting; only
  the Saturday always shows five steps; another meeting shows the parts it holds), and M2a, the
  reviewer's safer option: the program PATCH and the meeting PATCH write a kept part line's stored
  `note`/`music`/`helpers` back by `_key` and refuse (400) a body that names that `_key` without
  the same `part`. Test pinned: a kind-`ministry` meeting holding part lines, saved with the
  editor's body, is byte-identical on those fields and owes no music notice.
- **B2 — in this PR alone, the pages pastors use neither led to «Mi parte» nor showed the songs.**
  VERIFIED from the plan's §9 (ownership handed to the navigation thread, `/schedule` named by
  nobody). FIXED in the plan: the entrance lives in `MeetingBody` (a file this plan owns), and this
  PR's `/jovenes` and `/schedule` call `readSaturdaySets` themselves; «not read» renders no setlist
  line instead of «por definir».

No blocker was refuted.

## Non-blocking items

### Adopted in the plan before round C (from A and B)

A responsable who left Jóvenes answers 404, the only member-read 403 is a draft read through the
leader arm (A1); a standing request on a re-dated meeting is said again (A2, B); W10's scope stated
and a groups-audience case in the matrix (A3, B); `STORED_QUERY` reads `arrival` and `title` (A4,
B); parallel bounded sends, `maxDuration = 60` on the four routes, `ministryEventNotify` in
`DELIVERY_CAPABLE_IMPORTS` (A5, B); the no-debounce cases accepted in the ADR (A6, B); rehearse on
a throwaway meeting (A7, B); the page's read has no upper bound (A8); one owner of the 300 limit
(A9); the two narrowings to tell Frank (A10); `week`, not `date` (A11); a `part` that is neither a
string nor `null` is a 400; the templates join `emailTemplateGallery.test.ts`; the «Asignaciones»
hint names Jóvenes meetings.

### From C and D (after approval; dispositions are in code and docs, never in the plan's bytes)

| Note | Disposition |
|---|---|
| C1 a withdrawal caused by removing the line named nobody | Adopted: the notice names who HAD asked (`ministryEventNotices.ts`), tested |
| C2 no in-app entrance to Plática off a Saturday | Adopted: whoever shares sees a Plática step on any meeting (`jovenesDayEntry` keeps a part that is the reader's own) |
| C3 `EMAIL_ALLOWLIST` on Production unchecked | Adopted as a release check (`vercel env ls production`) |
| C4, D-unverified: the setlist premise | Open: asked of Frank with the dev screenshots; the ADR names the premise |
| C5 the page could offer a form W10 refuses | Adopted: `writableParts` mirrors W10 (own part only on a published meeting) |
| C6, D11 no brake on repeated sends | Accepted; the ADR names the re-add case and the unthrottled toggle |
| C7, D7 rehearsal links may point at production | Release note: verify the page by navigating on dev |
| C8 46 sends behind an 8-wide pool | Adopted: sends go in waves of `SEND_CONCURRENCY` |
| C9 `ProgramEditor` cap, `callbackUrl`, local-noon dates | Already so in the implementation (the form counts part lines; the page builds its own `callbackUrl`; `dayWords` renders at local noon) |
| C9 one sentence for both `invalid_program` refusals | Partly: the words now say to reload an old tab; W10's 20-line refusal keeps the same code (a meeting with 20 lines) |
| D1 the email shell said «equipo de alabanza» | Already so: `shell()` takes an eyebrow and a reason; asserted in `ministryEventEmail.test.ts` |
| D2 a reassigned part keeps the previous person's content | Accepted and recorded in ADR-0089 with the reason (the assigning write never deletes text) |
| D3 the music email is the only delivery and it is lossy | Accepted and recorded in ADR-0089 |
| D4 nobody could fill the Plática of a typed-name «comparte» off a Saturday (production: 2026-11-20) | Adopted: `partViews` offers Plática when any `comparte` seat is held, so the program-right holder gets its form; cards are unchanged. A view-only widening: W10 already accepted that write |
| D5 `eventWrite.test.ts` did not exist; `MeetingBody`'s callers; where `JovenesDayEntry` lives | The test file is created; the other two are premise slips in the plan with no effect on the work |
| D6 the sign-in redirect lost the meeting | Already so: the page's own `callbackUrl`, only for a token the writer could have minted |
| D8 people already assigned at release are never mailed | Told to Frank; recorded in ADR-0089 |
| D9 silent `time`/`arrival`/`place` change; an audience change reports a withdrawal | Accepted and recorded in ADR-0089 |
| D10 the firewall contract test | Adopted: `sendMinistryEventNotices` is trigger 10 of `deliveryFirewallTransports.test.ts`, with its allowed-path twin |

## Process failures on the author's side

- **Round A's packet said no code existed; three draft modules did** (`ministryParts.ts`,
  `ministryEventNotices.ts`, `ministryEventEmail.ts`, untracked in the working tree). The reviewer
  found them and reviewed the plan only. Later packets pointed at a baseline EXPORT of `main`
  instead of the working tree and said that an in-progress tree existed and was out of scope.
- **Implementation started before the second approval.** The draft was written in the uncommitted
  working tree while rounds B–D ran. Nothing was committed, pushed or deployed before round D, and
  the tree was conformed to the approved digest afterwards, but the skill's order is review first.
- **The plan as first written had the defect B1 found**: its sections were edited one at a time and
  disagreed about scope. One rule stated once (D1) is what fixed it.
- No reviewer claim was accepted without checking it against the baseline or production.

## Post-approval changes (un-reviewed by the plan loop; covered by the code review of the merge range)

- **The decision record is ADR-0089, not ADR-0090.** `adrIndex.test.ts` wants records consecutive
  from `main` (0088). The plan's bytes still say 0090 and were left alone so the digest holds.
- Every «adopted» row of the C and D table above. Two of them move behaviour beyond the plan's
  text: the Plática step for whoever shares off a Saturday (C2) and the Plática form for the
  program-right holder of a meeting with a typed-name «comparte» (D4). Neither changes the writer:
  W10's rule is the approved one.
- The withdrawal's «who» (C1) and the waves of sends (C8) change M5/M6 details inside the approved
  audience: no recipient is added by either.
