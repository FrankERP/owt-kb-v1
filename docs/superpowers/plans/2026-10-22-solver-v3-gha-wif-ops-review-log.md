# Review log — 2026-10-22-solver-v3-gha-wif-ops.md

Adversarial plan review (`.agents/skills/adversarial-plan-review/`), 2026-10-22. Each round was a
brand-new reviewer given only `reviewer-brief.md`, an immutable snapshot path and digest, evidence
pointers and the owner's requirement; no reviewer saw an earlier review, rebuttal or this log.

**Approval is not authorization to implement.** Implementation rests on Frank's OK for the
phase («Te doy mi OK. para las siguientes fases», 2026-10-22) and still goes through CLAUDE.md's
release order, including the merge-range code review.

## Tier

**Critical**, derived from the ladder (not raised or lowered): the artifact creates an
auth/secret boundary (who may deploy the production solver and who may read its API key from
Actions) and an irreversible remote release action (a production deploy). Two sequential fresh
approvals on byte-identical bytes were required.

## Rounds

| Round | Reviewed digest (SHA-256) | Verdict | Streak after |
|---|---|---|---|
| 1 | `552037ada15e4fcf60c82dd0604cc4e079f0642d484212d56c59f952e84b4eeb` | CHANGES_REQUIRED (substantive) | 0 |
| 2 | `d22d4fc1c1d1e6f0a8f20f61bbd71bf492c2af7bef8409ad12bc7100ae821547` | CHANGES_REQUIRED (substantive) | 0 |
| 3 | `a71dd0893ba602820e703aa1f781805115bed6210c41cd4eaabec133f097ae66` | APPROVED | 1 |
| 4 | `a71dd0893ba602820e703aa1f781805115bed6210c41cd4eaabec133f097ae66` (same snapshot) | APPROVED | 2 → done |

The digest of the canonical file and of the snapshot matched before and after rounds 3 and 4.
The plan's first commit on the branch (`82272fcd`) holds the round-3/4 bytes.

### Round 1 — blocker and disposition

1. *The `solver-deploy` required-reviewer gate is presented as a technical control against the
   agent, but it is not.* **Fixed.** Checked independently: from the cloud session, `gh api user`
   returns `FrankERP` and the repository's `permissions.admin` is `true`; `docs/CI.md:313` says
   `main` requires no approving review. So a session's approval would be recorded as Frank's, and
   «workflow code on protected main» is not a human gate. The plan now says (§2) that the deploy
   action adds no capability beyond merge → trigger, labels the approval a policy gate (§3.5, §4),
   adds «Allow administrators to bypass» off, and records the rejected Cloud Build approval
   alternative (§9). Frank chose the written-rule option on a decision card (2026-10-22 15:56Z).

Non-blocking items adopted from round 1 (each checked): `parseWorkflow` instead of a nonexistent
js-yaml dependency (`scripts/lib/ci-layout.mjs:14-18,133`); the CI-layout guard reads every
workflow (`ciLayout.test.ts:33-37`); amend the existing `OWT_SOLVER_API_KEY` entry
(`docs/SECRETS.md:626-629` said «Not needed in … GitHub Actions»); an explicit `verify` `if:` for
the skipped-`needs` fail-open edge; `workflow_ref` pinned in the provider condition; job-level
permissions; ancestry wording and the `.gcloudignore` note; trigger-SA forms; soft-deleted pools;
concurrency note; a push-path acceptance step.

### Round 2 — blocker and disposition

1. *The setup script's «create only when absent» never compares an existing provider's issuer,
   mapping or condition, so a corrected script would leave the old gate live.* **Fixed.** Verified
   against the round-2 text of §3. The script now compares on every run, stops with the
   difference and the `update-oidc` command, updates only under `--apply --update-provider`, and
   the rehearsal's second dry run is the full read-back.

Non-blocking items adopted from round 2: composite `attribute.repo_env` binding; environments
created before the merge; job timeouts; 40-hex build check; guard 6.4 spelled out; `ACTIVE`
checked on every path; `persist-credentials: false`; empty build id; stale-grant note; a
`docs/CI.md` line. Not adopted: a read-only `GET …/environments` check (the session's proxy
refuses that path; replaced by ordering the environment creation first).

### Rounds 3 and 4

Both APPROVED with no blocker. Their non-blocking items are dispositioned below.

## Process record (author's side)

- **Churn cap reached after round 2** (two substantive `CHANGES_REQUIRED`). The defect classes
  differed: round 1 an overstated auth gate (policy presented as technical), round 2 setup-script
  drift on the provider. Round 3 started only after Frank's explicit go-ahead, obtained in
  advance: «corre hasta 5 rondas más de revision antes de preguntarme de nuevo» (2026-10-22 16:00Z).
- No reviewer claim was accepted without the step-4 check; the checks are listed per blocker above.

## Post-approval changes (un-reviewed)

Made after round 4, to digest `79c9acbe…`; **outside the approval**, and covered only by the
merge-range code review:

- §4 agent rule extended: no change to the environments' protection or variables, or to the WIF
  pool, provider or grants, without Frank's explicit OK (round 4).
- §3.3: the `repo_env` keying claim softened; the script stops if the pool holds any provider other
  than `owt-kb-v1` (rounds 3 and 4).
- §3: the condition compare collapses whitespace first (round 4).
- §5: `action` is a `choice` input used only in `if:`; ping and smoke in one step, key never written
  to `$GITHUB_ENV`/`$GITHUB_OUTPUT`; the function host masked and curl kept `-s` without `-S`
  (rounds 3 and 4).
- §5.2: doc notes for the tip guard refusing after an unrelated merge, and for a mid-deploy
  `gcf_v3` merge turning the post-deploy verify red (round 4).
- §7: `docs/CI.md` also notes the Deployment records (round 3).
- §10 step 4: a red push verify between merge and variables is expected (round 3).
- §11: premises added — `triggers run` output shape; the session token may dispatch, with Frank's
  browser as the fallback (rounds 3 and 4).

Not adopted: a dry-run listing of each service account's effective bindings (round 3) — useful
but outside the gate this plan owns; noted for a later hardening pass.
