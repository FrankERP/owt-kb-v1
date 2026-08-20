# Review log — Kids Scheduling P1: ministry auth foundation

**Artifact:** `docs/superpowers/plans/2026-08-19-kids-scheduling-p1-ministry-auth.md`
**Rounds:** 5, all `CHANGES_REQUIRED`. **No `APPROVED` verdict was ever obtained.**
**Outcome:** the loop was **ended by the user's decision to implement**, not by meeting the tier's approval bar.

## Risk tier — and the two deliberate deviations

**By the ladder: CRITICAL.** The artifact changes an auth/mutation trust boundary
(new guards, new privilege fields, server-side gating of every worship surface).

Two decisions departed from the ladder, both Frank's, both recorded here because a
reader cannot otherwise tell a judgment call from a rule:

1. **Re-tiered critical → standard after round 3** (one approval instead of two).
2. **Loop ended after round 5 with zero approvals.** Standard tier asks for one
   fresh cold `APPROVED`; none was obtained. Frank chose "implement now" on the
   reasoning that rounds 4–5 had moved off auth logic and onto doc consistency and
   plan-internal slips, and that the fresh code review of the real diff is the
   stronger remaining gate.

**What this means for the reader: this plan carries no reviewer's approval.** The
mitigation is the post-implementation code review of the diff, which is mandatory
and not optional here.

## Churn cap

The cap (two substantive rounds, then stop) was reached at round 2 and **honored**:
work stopped, the defect class was logged as a `coordinator-inline` entry, and
Frank's explicit go-ahead was obtained *in advance* of round 3. Round 4 proceeded
under the re-tier decision; round 5 under the standing bar. No round was started
without authorization.

## Rounds

| Round | Digest | Verdict | Blockers | What mattered |
|---|---|---|---|---|
| 1 | `e92a72c3` | CHANGES_REQUIRED | 3 | `/tag` + `/author` index pages ungated and linked from `/me`; `/kids` redirect loops for disabled members; admin UI wipes ministries on unrelated edits |
| 2 | `15589efe` | CHANGES_REQUIRED | 2 | `handleAdd` drops the fields, making the POST change dead code; `isMinistryId` used `in`, accepting prototype keys |
| 3 | `76cd7c3c` | CHANGES_REQUIRED | 1 | Form seeded checkboxes from the raw (absent) value, so adding Kids silently revoked worship |
| 4 | `86ec94aa` | CHANGES_REQUIRED | 1 | Explicitly-empty `ministries` failed open to worship; `[].every()` is vacuously true |
| 5 | `7cb61d8f` | CHANGES_REQUIRED | 2 | ADR-0007 forbids this change and was not superseded; Task 1's test asserted an export Task 1 never defined |

Final digest at loop close: `ced1eab6` (plus Frank's Step 6c filtering scope, added
after — see Post-approval changes).

## Blockers and dispositions

Every blocker below was **independently verified against the cited code before being
fixed** — none was accepted on the reviewer's word.

**Round 1** — all three `fixed`.
- *Ungated index pages.* Verified `app/(client)/tag/page.tsx` and `author/page.tsx`
  exist and list the catalog; verified `me/page.tsx:348` renders `<Navbar … tags />`
  and `NavMenu.tsx:154` emits the `/tag` link. Fix: seven pages behind a shared
  `requireWorshipPage`; coverage check changed from a grep to an enumeration of every
  `page.tsx` — a grep for `requireActiveSession` structurally cannot find a page that
  never had one, which is precisely how these two hid.
- *Redirect loop.* Verified `proxy.ts:26` is `authorized: ({ token }) => !!token`.
  Fix: both gates split no-session (→ sign-in) from wrong-ministry (→ other ministry).
- *Silent privilege wipe.* Verified `MemberForm.onSubmit` sends unconditionally
  (`AdminPanel.tsx:249-252`) and `GET` never projected the fields. Fix: `touchedPrefFields`
  pattern, which the same file already documents at `:242-247` for email prefs.

**Round 2** — both `fixed`.
- *Dead POST path.* Verified `handleAdd` destructures a fixed five-field list
  (`AdminPanel.tsx:533`). Fix: named `handleAdd`/`handleEdit` in the task.
- *Prototype-chain validator.* Verified by execution: `"constructor"`, `"toString"`,
  `"__proto__"` all pass `x in MINISTRIES`. Fix: membership-based check + a
  prototype-key test, **and** the redirect made loop-proof so it no longer depends on
  the invariant the hole could break.

**Round 3** — `fixed`.
- *Lying baseline.* Verified `initial` is `modal.member` (`AdminPanel.tsx:911`) from a
  GET that returns the field verbatim, absent on every existing member. Fix: seed
  through the shared normalizer.

**Round 4** — `fixed`.
- *Empty array fails open.* Verified `[].every(...)` is vacuously `true`; verified the
  ≥1 rule was create-only and client-side. Fix: the storage contract settled in one
  place — absent ⇒ worship, explicitly empty ⇒ rejected at every write boundary.

**Round 5** — both `fixed`; one non-blocking item `refuted`.
- *ADR-0007 reversed without supersession.* Verified the ADR is `Accepted`
  (`README.md:50`) and its Consequences forbid moving the gate server-side by name.
  Fix: Task 6 Step 7 amends it, flips the README status cell, and records what still
  holds. **Author-side process failure:** CLAUDE.md requires reading the relevant ADR
  before a plausible-looking change; five rounds were planned without opening
  `docs/adr/`. All 18 ADRs were then swept — only 0007 conflicts.
- *Unpassable Task 1 gate.* Verified Task 1's test imported `validateMinistryWrite`
  while Task 1's implementation omitted it — a defect the author introduced in the
  round-4 fix. Fix: all five exports moved into Task 1.
- **`refuted`:** the reviewer's claim that `handleAdd`/`handleEdit` line refs drifted
  by one. Grep shows `:533` and `:548` — the plan's originals were right and the
  proposed correction was wrong. It was applied before verification, then reverted;
  the skill's rule that independent verification covers non-blocking citation fixes
  earned itself here.

## The defect class, and the method change it forced

All eleven blockers were one class: **the plan stated an intent at one end of a data
path and never traced the path to its other end.** Gated `[slug]` but not the index;
assumed middleware proved an active member; assumed the form sent fields the GET never
fetched; assumed POST was reached when the caller dropped the fields; assumed `in`
tested membership; assumed the form's displayed baseline matched storage.

After round 3 the remedy stopped being per-instance patches: `normalizeMinistries`
became the single READ rule and `validateMinistryWrite` the single WRITE rule,
replacing the same logic open-coded in three places. Rounds 4 and 5 confirmed the
diagnosis — round 4's blocker was the last unpatched direction of that same question,
and round 5's was doc/task consistency rather than auth logic.

## Non-blocking items adopted

Session-carried ministries (closing spec §5.1's nav layer at zero fetch cost, since
`auth.ts:240` already calls `getMemberAccess`); `/api/me/songs` (the whole catalog),
`/api/notifications/count` and `/api/me/proposals` gated; fail-closed, type-defensive
normalization; the `next build` check reading the **route legend** for `ƒ (Dynamic)`
rather than the exit code, since a still-prerendered page would serve cached HTML past
the gate; `songRoute.test.ts`'s guard mock named as expected breakage; ADR-0020 created
for the per-page-vs-middleware decision, which had been assigned to an ADR that does
not cover it; `auth.ts:253`'s brace-less `if` flagged; the GET projection edit pinned to
line-level so the panels' fields survive.

## Non-blocking items NOT adopted

- Adding `teamMembers` to `PROTECTED_STUDIO_TYPES`. Studio can edit the new fields, but
  `role` already has exactly this property; closing it is a separate decision with its
  own blast radius. Recorded in the plan, not fixed here.
- Folding `requireWorshipPage`'s double `getServerSession` decode into one. Harmless.
- Worship setlist **push** audience (`serviceMutationSideEffects.ts:671` fetches every
  member; `notifyTargets.ts:40` defaults unset to `"all"`). Nil exposure today — native
  apps unshipped — and spec §2 forbids touching notification code in this delivery.
  Recorded as a **must-fix before the mobile app ships**.

## Post-approval changes — un-reviewed

No reviewer saw these. Both are author/user changes made after round 5:

1. **Step 6c — ministry-filtering worship admin reads** (`GET /api/admin/members`,
   `login-events`). Frank's decision on 2026-08-19 that member visibility *does* count
   as "kids stuff". Carries its own hazard, called out in the step: `super-admin` must
   stay unfiltered or a Kids-only member becomes uneditable, and the GROQ must treat
   absent `ministries` as worship or every legacy member vanishes from the admin list.
2. The round-5 citation revert described above.

## Standing statement

**Review approval is not authorization to implement — and here there was no approval
at all.** The loop ended on the user's decision. After implementation, a fresh code
review of the diff plus the documented test/browser gates are required, and given the
missing approval they are the primary gate rather than a secondary one.
