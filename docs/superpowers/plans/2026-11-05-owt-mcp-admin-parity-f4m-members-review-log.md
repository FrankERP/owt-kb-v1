# Review log — slice M, people from the chat (admin parity, phase 4)

Artifact: `2026-11-05-owt-mcp-admin-parity-f4m-members.md`. Process:
`.agents/skills/adversarial-plan-review/`. Approval is NOT authorization to implement; the build follows
CLAUDE.md's release order and gets its own merge-range code review.

## Tier

**Critical**, derived from the ladder (not raised or lowered): an auth/ACL boundary (`role`,
`ministries`, `managesMinistries`, `ministryRoles`, `email`, `disabled` decide who signs in and what
they may do), a production server writer, and a two-document transaction (a member and the shared
rules, D6).

## Rounds

| Round | Reviewed SHA-256 | Commit | Verdict | Streak |
|---|---|---|---|---|
| R1 | `c3c27517…b3b7` | 4f90bc40 | CHANGES_REQUIRED (substantive) | 0 |
| R2 | `c6b0d65d…884e` | bf4077f4 | CHANGES_REQUIRED (substantive) — **churn cap reached** | 0 |
| R3 | `a62a2563…cb80` | 938e8557 | CHANGES_REQUIRED (substantive) | 0 |
| R4 | `300211dc…30fb` | 21bd4629 | CHANGES_REQUIRED (substantive) | 0 |
| R5 | `e7868eca…15e2bb` | 2d36570e | APPROVED | 1 |
| R6 | `e7868eca…15e2bb` (same snapshot) | 2d36570e | APPROVED | 2 — loop ended |

Every round was a fresh reviewer with only the brief, the read-only snapshot, the repository and the
requirement (Frank's words, and from R3 on his recorded choices). R5 and R6 reviewed the same snapshot;
its digest was checked before each dispatch and after each verdict and matched the canonical file.

**Frank's go-ahead past the cap** (each before the round started, on a decision card in the thread
«MCP de la página»): R3 — 2026-11-05 15:45Z («Sí, sin deshabilitar admins», which also decided that
the chat does not disable or re-email managers); R4 — 16:00Z («Sí, una cuarta»); R5 — 16:11Z («Sí, y
apruebo los dos detalles», which also approved that the chat may lower or disable a content-editor and
that `set_member_access` carries no token). R6 is the critical tier's confirming round on R5's
unchanged bytes; the R4 card told Frank that a clean round is followed by one confirming round.

## Blockers and dispositions

**R1**
- B1 — create had no rule against an email repeated within a batch, and the name/alias collision
  rule was written for renames only. **Fixed** (D5 batch repeat, D12 on create against roster and
  batch). Evidence: plan D5 «any other member document»; `auth.ts:22-30` first match.
- B2 — «never revokes management» protected only worship admins; a Kids manager or Jóvenes admin
  could be disabled or re-emailed. **Fixed** (one `holdsManagement` definition). Evidence:
  `ministryAccess.ts:27-42`.

**R2**
- B1 — `set_member_access {enabled: true}` could restore a disabled super-admin. **Fixed** (§3.1
  refuses enabling a stored super-admin). Evidence: `disable/route.ts:76-92` (enable has no role check).
- B2 — add/remove on `ministries` did not normalize an absent field (absent ⇒ worship), so adding
  Kids would silently drop worship. **Fixed** (D2 reads `normalizeMinistries` first). Evidence:
  `validateMinistryWrite` accepts `["kids"]` (`ministries.ts:153-166`).

**R3**
- B1 — D6's guard («raw count ≠ parsed count») could not see the lenient reader coercing values
  (`fairness` → `"none"`, unknown `sundayCadence` dropped, item fields dropped). **Fixed** by removing
  the rewrite: the rename is a targeted patch of the person paths only, as the rule-name repair script;
  the parse runs in memory only to validate. Evidence: `solverConfigWriteRequest.ts:470-507`,
  `scripts/fix-vale-sosa-rule.mjs:94-95`, `project-rules.md:284`.

**R4**
- B1 — `PATCH /api/me` lets every member set their own alias and email with no uniqueness check and
  no rule handling, so D5, D6 and D12 would not hold. **Fixed** (`patchOwnProfile` in the shared
  commit, generic member-facing refusals) and the complete list of writers recorded in §2. Evidence:
  `app/api/me/route.ts:28-50`; grep of `app/**` and `auth.ts`.

No blocker was refuted; every one was verified against the cited code before it was fixed.

## Author-side process notes

- **The churn cap was reached at R2 and the loop continued three more rounds**, each with Frank's
  explicit go-ahead obtained before it started (above).
- **Defect class.** R1–R2 kept finding access paths that a principle plus per-tool refusal lists
  missed; the remedy was consolidating them into ONE transition table (§3.1), after which no reviewer
  found an access gap. R3–R4 found completeness gaps in D6 (how the rules are written, and who
  renames people); the remedy was a targeted patch and routing every writer of a name through one
  function. Both remedies changed the method, not just the text.
- The R1 draft stated that `PATCH` writes «touched fields only» and that `/api/me/*` writes only
  theme, push token, availability and preferences; both were wrong and were found by reviewers, not
  by the author's own reading.

## Non-blocking items

Adopted before approval (folded into the reviewed bytes): change detection on normalized values
(D13); open month proposals warned on a rename; rules stamp `updatedAt`/`updatedBy`; distinct rules
409; own-draft-only email exclusion and a Studio draft warning; D9 marked as a refinement; batch
partial existence refused; Tipo limited to `MEMBER_TYPES`; content-editor outside `holdsManagement`;
orphaned rule text reported on rename; empty `set` refused; `/admin` toast names moved rules; Studio
bypass named in the ADR; 409 attribution by re-reading both revisions; absent role = member; Jóvenes
level through `levelIn`; disable retry re-judged; PATCH re-reads for its answer; D12 warnings bound in
the token; «ya estaba guardado» retry; keyless rule item refused; only NEW parse issues refuse;
replay risk accepted in the ADR; live proof with an `@example.invalid` address and no open proposal.

Adopted AFTER approval (plan §7, **un-reviewed**): see the plan.
