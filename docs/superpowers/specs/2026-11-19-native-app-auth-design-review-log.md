# Review log — native app sign-in design (Fase 0, slice A1)

Artifact: `docs/superpowers/specs/2026-11-19-native-app-auth-design.md`.
Process: `.agents/skills/adversarial-plan-review/SKILL.md`, reviewer contract `reviewer-brief.md`.
Each round: one fresh reviewer, cold packet (immutable snapshot + digest, repo, evidence pointers,
the owner's words), no review history. Every claimed blocker verified by the author against the
cited code or source before it was accepted.

**Approval is not authorization to implement.** Implementation waits for Frank's OK on the plan.

## Tier

**Critical** (CLAUDE.md §Review policy): an auth/security boundary and a new trust boundary for
mutations made with app tokens. Requirement: two sequential fresh `APPROVED` verdicts on the same
bytes. Churn cap: two substantive `CHANGES_REQUIRED` rounds, then the owner decides.

## Rounds

| Round | Reviewed SHA-256 | Commit | Verdict | Counted |
| --- | --- | --- | --- | --- |
| 1 | `5a332148991ebe6525b522e69d6d0d432dfda5881ac9b19fe0e88efb2a76c5c4` | f6f08fe | CHANGES_REQUIRED | substantive (1 of 2) |
| 2 | `977443cbfd04262d9385f70c862f884e9effa1a864a2b36e6531e1eb394e62f5` | 1a2ac67 | CHANGES_REQUIRED | substantive (2 of 2) → cap, escalated |
| 3 | `d64b09e8876c0f035d933ae4ea4f9f1d0412c28101e398adecfc355b4aec0683` | f9cee2c | CHANGES_REQUIRED | substantive (after owner's go-ahead) |
| 4 | `ae816faaf85b69360696e66b3ada0aaa4bdef0f3488f65f504d025445b4cadb3` | fd62e31 | CHANGES_REQUIRED | substantive (after owner's go-ahead) |
| 5 | `704124851b4e39fe7b98e6aaf4998a31a322ca199086b151dbfb3191a9cb6462` | 6eff82f | APPROVED | streak 1 |
| 6 | `704124851b4e39fe7b98e6aaf4998a31a322ca199086b151dbfb3191a9cb6462` | 6eff82f | APPROVED | streak 2 → approved |

**Approved digest:** `704124851b4e39fe7b98e6aaf4998a31a322ca199086b151dbfb3191a9cb6462` (the
artifact at commit 6eff82f). Post-verdict digests of the snapshot and the canonical file matched
the reviewed digest in rounds 5 and 6.

## Blockers and dispositions

**Round 1.**
- B1, identity takeover from a member-level private-scheme session: a member can change their own
  email (`/api/me` → `patchOwnProfile`) or set a password with no current one (`/api/me/password`),
  and sign-in resolves the member by email (`auth.ts` `getMemberByEmail`). Verified in those files.
  Fixed then with an `identity` level refused to the scheme channel; superseded by the redesign.
- B2, the `needs` lattice was ambiguous about ministries and had a ministry-agnostic default,
  against two-way ministry isolation (CLAUDE.md §Auth). Verified against the plan text. Fixed:
  `needs` is required, explicit lattice table, static test for a literal level.

**Round 2.**
- B1, the scheme channel's member-level cap was only an entry gate: writers re-read fresh access
  and widen by role (`ministryEventCommit.ts` `canWriteStored`, `actorFor` →
  `fetchMemberAccessFresh`, `updateMinistryEventPart`). Verified in that file.
- Defect class across rounds 1–2: a reduced-power session layered over code that derives power from
  the person. The defect was the method, so the loop stopped for the owner.

**Escalation (cap reached after round 2).** On 2026-11-19 Frank chose «Solo entrada verificada» on a
decision card: only the OS-verified `https` redirect on deployed origins, the private scheme only on
localhost, a physical iPhone waits for the Apple account, Android needs Chrome 137+. Recorded as the
go-ahead to continue. The artifact was rewritten (D3–D5): no channel, no cap, every session the
person's own live role.

**Round 3.**
- B1, the zero-click flow let another Android app obtain a full session: it opens our authorize URL
  in its own Custom Tab (shared cookies) with its own PKCE pair; on Android ≤ 11 without our app
  installed, or Android 12+ after a manual «open by default» approval, the 303 to our `https`
  redirect can be offered to it in the chooser. Verified against the plan's own D3 caveat and
  Android's App Links documentation. While fixing, the author found the attack works with ANY
  `https` redirect on our domain (the iOS callback path too), so it does not depend on shipping an
  Android app. Fixed: one visible tap on our page before any code is minted (D5); the guarantee
  restated per platform (D3 table); the residual named for Frank (ADR-0091).

**Round 4.**
- B1, the Jóvenes `leader` level (`ledGroupsIn` non-empty) refused Jóvenes admins and super-admins,
  while the web lets them in (`isManager || ledGroupsIn(…).length > 0`). Verified:
  `app/utils/ministryAccess.ts` (`ledGroupsIn` has no manager arm by design),
  `app/(client)/jovenes/admin/page.tsx`, and the three other Jóvenes pages. Fixed: level `planner`,
  one shared predicate `plansInMinistry`, enumerated equivalence snapshots.

## Non-blocking items

Adopted before approval (rounds 1–4): extraction test constraints; strict reuse detection with one
refresh owner per token store; no absolute grant lifetime, stated; cost estimate; local development
with `adb reverse`; device narrowing (iOS 17.4, Chrome 137+); CSP comment; push tokens die with
their grant; admin revoke-all; `PUBLIC_ROUTES`; isolated callback route group; origin-scoped `/me`
list and admin revoke; `temporarily_unavailable` on a lost rotation race; `Sec-Fetch-Site`-first
CSRF with `Origin: null` refused; the code-minting POST behind the middleware; platform logs carry
codes, stated; the `google-native` provider as a rejected alternative; import-free schema constants;
a separate `loadAppSecret`; `webcredentials` requirement; headers set in `next.config.mjs` after the
global entries; `autoVerify` requirement; embedded WebView out of scope; atomic revoke-all;
`account_disabled` error; grant-read failure → 503; `/me` section hidden while impersonating; a
minimal `(appauth)` layout; the Studio lists enumerated.

Declined: an idempotent replay of the immediately previous refresh token (left for a later,
separate decision if logs show real users hitting strict reuse detection); re-picking the scheme
name (local only now).

## Post-approval changes (UN-REVIEWED)

Everything in the artifact's §10 «Post-approval amendments» (A1–A14) was added after the approved
digest and is outside the approval: the reviewers' non-blocking suggestions from rounds 5 and 6
(iOS row restated with new premise P8 and the Mac; Android 12+ row made conditional; Apple
minimums; live-grant definition and store-owned list/revoke-all; missing read token → 503;
type pin on the `/me` revoke; rollout gate and the Jóvenes wording; static callback folders,
`force-dynamic` and an isolation test; the expired-session GET; native-slice requirements; release
smoke test; cost note; Android device testing and Play D-U-N-S; extra docs and per-environment
secrets). They are hardening and clarification; the implementation's merge-range code review
covers them.

## Process failures (author side)

- **Rounds beyond the churn cap.** The cap stopped the loop after round 2 and Frank's decision
  authorized continuing. Rounds 3 and 4 were again substantive, and the author continued to rounds
  4, 5 and 6 on that single go-ahead without asking again. Round 4's defect class (lattice versus
  the web's gates) differed from rounds 1–3 (a session or app obtaining power it should not), which
  is why the author judged it fixable rather than a method problem; that judgment was the author's,
  not Frank's, and is disclosed to him with the result.
- **Round 3's blocker existed since the redesign.** The rewrite after the escalation introduced the
  zero-click claim («harmless») while the same text admitted the Android ≤ 11 chooser. The author
  did not connect the two before dispatching round 3.
- **Round 4's blocker was in the text since round 1.** The `leader` level was written from
  `ledGroupsIn`'s name without reading its «no manager arm» comment or the pages that gate on it.
- **Review history nearly leaked into the cold packet.** An early draft of the spec and one commit
  message mentioned «review round 1»; both were corrected before the next round was dispatched.
