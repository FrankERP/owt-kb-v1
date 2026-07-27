# Deployed verification harness (A3)

> **What this is.** A Playwright suite that signs in as a **real admin** on a **live
> deployment** and performs **real mutations** against an **isolated Sanity dataset**, to
> prove the guarded write contract holds on deployed infrastructure rather than in unit
> tests. It is the release gate for the service-readiness program.
>
> **What it must never do.** Touch production data, or email/push a single real person.
> Sections 2 and 3 are the mechanisms that make that assertable rather than aspirational.

---

## 1. Why it exists

Unit tests prove pure logic. The mutation-integrity work (A2) rests on Content Lake
behaviours that unit tests **cannot** prove — that a deterministic-id `create` really is a
mutex, that `ifRevisionId` really refuses a stale write, that a transaction is really atomic.
Those hold or fail in the real Content Lake, under real concurrency, behind real auth, on a
real deployment.

This harness exercises them there.

---

## 2. The isolation guarantees

Five hard-coded identifiers. All are mirrored in **three** independent places —
`e2e/service-readiness/lib/harnessGuards.ts` (runner),
`app/utils/srVerificationIdentity.ts` (server), and
`scripts/lib/sr-verification.mjs` (operator scripts) — with parity tests, so relaxing one
does not quietly relax the others.

| Constant | Value |
|---|---|
| Verification project | `scbxomq9` |
| Verification dataset | `service-readiness-verification` |
| **Forbidden** project | `ebb8vcnk` *(production)* |
| **Forbidden** dataset | `production` |
| Marker value | `owt-service-readiness-verification-v1` |

Production and stable-dev hosts (`owt-backstage.vercel.app`,
`dev-owt-backstage.vercel.app` — exact host or any subdomain) are refused as base URLs.
`dev-` is refused because it is *also* backed by the production dataset.

**Both axes are checked independently.** A correct project carrying the production dataset
still refuses, and vice versa. The "must never be production" check is separate from the
"must equal the verification value" check, so a future edit that relaxes the second cannot
silently relax the first.

### Where the refusals live

1. **Runner** (`harnessGuards.ts`) — refuses before Playwright starts, collecting *all*
   failures and printing them together under
   `Service Readiness A3 deployed-route harness — REFUSING TO RUN.` Codes include
   `forbidden_project`, `forbidden_dataset`, plus base-URL, credential, marker and
   run-identity checks.
2. **Server** (`srVerificationIdentity.ts`) — the deployment refuses to report a healthy
   identity unless its own environment is the isolated one.
3. **Scripts** (`sr-verification.mjs`) — production project/dataset are *hard* failures,
   refused even on a dry run.
4. **Build time** (`scripts/lib/deployment-coherence.mjs`, called from `next.config.mjs`) —
   the `verify/service-readiness` branch building against production is refused
   (`verification_ref_targets_production`), **and** any other branch building against the
   isolated dataset is refused (`non_verification_ref_targets_isolated`), because that would
   serve synthetic fixtures to real users.

### The delivery firewall

The suite mutates services, and every service mutation fans out into assignment emails and
FCM pushes. `EMAIL_ALLOWLIST` defaults to `"*"` — the whole team. A verification run would
otherwise email and push roughly 30 real people.

`app/utils/deliveryFirewall.ts` sits at the **transport boundary**, in front of SMTP/Resend/FCM
client construction — not in front of one caller — so a future route, cron or script that
reaches `sendEmail`/`sendPush` directly gets the same refusal. It **fails closed**: any
unrecognised mode blocks. And it leaves production untouched: an absent or explicitly
`normal` mode delivers exactly as before the module existed.

`SERVICE_READINESS_DELIVERY_MODE` must equal `disabled`, and the identity route reports it —
so the harness verifies the firewall is armed *before* it mutates anything.

### Secret hygiene

The Deployment Protection bypass is read only from `SR_VERIFY_BYPASS_SECRET` and sent only as
the header `x-vercel-protection-bypass`. Vercel's own `VERCEL_AUTOMATION_BYPASS_SECRET` is
named **only** on a deny-list, so the harness can prove it never falls back to it
(`provider_managed_bypass_consumed`).

Teardown scans retained `test-results/` and `playwright-report/` artifacts for the secret
value (literal and URL-encoded) **and** for the bypass *query-parameter shape*. The shape
fails even when the accompanying value is wrong or redacted — a URL that carries the secret
as a query parameter lands in logs and referrers, so the pattern is banned outright.

---

## 3. Running it

There is **no npm script**. This is deliberate — the suite is not something to run by
reflex. Invoke Playwright directly:

```bash
npx playwright test
```

`playwright.config.ts` hardcodes `testDir: "./e2e/service-readiness"` and calls
`requireHarnessConfig()` before anything starts, so a misconfigured run refuses rather than
half-executing.

### Environment

| Variable | Required | Purpose |
|---|---|---|
| `SR_VERIFY_BASE_URL` | yes | The exact recorded deployment origin. https, no credentials/query/fragment, not a production or stable-dev host. |
| `ALLOW_SERVICE_READINESS_E2E_WRITES` | yes | Must be exactly `"true"`. The mutation opt-in. |
| `SERVICE_READINESS_VERIFICATION_MARKER` | yes | Must equal `owt-service-readiness-verification-v1`. |
| `SR_VERIFY_ADMIN_EMAIL` / `_PASSWORD` | yes | Signs in as the seeded verification admin. |
| `SR_VERIFY_MEMBER_EMAIL` / `_PASSWORD` | yes | Seeded ordinary member, for authorization-rejection scenarios. |
| `SR_VERIFY_BYPASS_SECRET` | yes | Deployment Protection bypass. Header only. |
| `SR_VERIFY_SANITY_PROJECT_ID` / `_DATASET` | yes | Must resolve to `scbxomq9` / `service-readiness-verification`. Falls back to the `NEXT_PUBLIC_SANITY_*` pair. |
| `SR_VERIFY_SANITY_TOKEN` | yes | The only Sanity write token this tooling uses. |
| `SR_VERIFY_RUN_ID` / `_CANDIDATE_SHA` / `_DEPLOYMENT_ID` | yes | The run identity. None may contain `:`. |
| `SR_VERIFY_RUNTIME_LOG_FILE` | effectively yes | Path to the deployment's complete recorded log. Without it teardown fails `no_complete_log_source` (see §6). |
| `SR_VERIFY_RUNTIME_LOG_CAPTURE` | optional | Set to `vercel` to have the harness capture logs itself. |
| `SR_VERIFY_ADMIN_PASSWORD_HASH` | seed only | Injected into the admin fixture at apply time. Never committed. |
| `SR_VERIFY_MEMBER_PASSWORD_HASH` | optional | Without it the member-authorization scenario is unavailable. |

> The secret values live in the runner's local env file or a CI secret store — never a
> tracked file. This repo does not record where they are provisioned; ask whoever manages
> the Vercel and Sanity credentials.

### Operator scripts

All default to **dry run**; `--apply` is the only token that authorises a write.

```bash
node scripts/service-readiness-verification-seed.mjs        # add --apply to write
node scripts/service-readiness-verification-reset.mjs
node scripts/service-readiness-cleanup.mjs --action <a> --id <id> --rev <rev>
node scripts/service-readiness-restore.mjs --backup <file>
node scripts/service-readiness-feasibility.mjs
```

`willContactRemote = apply && !refused` is the single authority the scripts branch on — no
Sanity client module is even *imported* unless it is true.

Cleanup and restore additionally require a `--confirm` phrase naming the exact action, id and
revision (`"<action>[#mode]:<id>@<rev>"`), so a confirmation cannot be recycled from a
previous invocation.

Five historical one-shot writers (`import-schedule.ts`, `import-setlist-history.mjs`,
`cleanup-superseded-proposals.mjs`, `migrate-shared-proposals.mjs`,
`unpublish-july-2026.mjs`) call `assertRetiredWriter()` as their first statement and exit
non-zero unconditionally. Their code is kept as the historical record of what was applied to
production, and is inert.

---

## 4. The dataset lease

One run at a time. Document `serviceReadiness.verificationLease`, owner string
`` `${runId}:${candidateSha}:${deploymentId}` ``, default TTL **15 minutes**.

| Situation | Outcome |
|---|---|
| No lease | `create` — atomic; a concurrent loser throws |
| Ours, live | `renew` |
| Ours, expired | `replace` under `_rev` |
| **Foreign, live** | **refuse — a live lease is never stolen** |
| Foreign, expired | `replace` under `_rev` |
| Malformed | refuse; needs an explicitly authorised reset |

After acquiring, the lease is **re-read** and ownership re-confirmed before anything is
touched. Renewal runs every 4 minutes on an `unref()`'d interval, so it cannot keep the
process alive by itself.

Because Playwright workers are separate processes and cannot share the in-memory lease
object, **every fixture mutation re-reads the lease document and re-compares the owner
first**. Release is owner-only, under `_rev`, and pairs a revision-asserting patch with the
delete in one transaction — so a lease replaced since our read is never removed. A release
must never become a steal.

An expired lease is replaceable, which means a crashed run blocks others for at most the TTL.

---

## 5. Run identity — proving you tested the commit you meant to

Identity is the triple `runId` / `candidateSha` / `deploymentId`. It reaches the deployed
server as five non-secret headers, mirrored byte-for-byte between runner and server and
pinned by a parity test:

```
x-sr-verification-marker
x-sr-verification-run-id
x-sr-verification-attempt-id
x-sr-verification-candidate-sha
x-sr-verification-deployment-id
```

Two independent gates:

**Pre-flight.** Before any sign-in or mutation, `GET /api/service-readiness-verification/identity`
on the exact recorded host. It must return `ok: true` with a matching marker, dataset
`service-readiness-verification`, project `scbxomq9`, `deliveryMode: "disabled"`,
`e2eWritesEnabled: true`, **and** a `deployment.id` / `git.commitSha` equal to the run's
recorded values (`deployment_id_mismatch`, `candidate_sha_mismatch`). A 404 means the route
failed closed — it exists only on the isolated verification deployment. A 401/403 means
Deployment Protection rejected the bypass. Any failure aborts before sign-in.

**Server-side ownership.** On every marked credentials sign-in, the server independently
requires the claimed `candidateSha` to equal its own `VERCEL_GIT_COMMIT_SHA`, the claimed
`deploymentId` to equal its own `VERCEL_DEPLOYMENT_ID`, and the **live lease owner** to equal
the exact identity triple — else `candidate_sha_mismatch`, `foreign_deployment`,
`foreign_lease` / `lease_missing` / `lease_expired`.

A login-event collision check additionally requires the run+deployment predicate to return
**zero** pre-existing documents before proceeding. A collision aborts and instructs you to
generate a new `SR_VERIFY_RUN_ID` — it never deletes the colliding document.

---

## 6. Delivery evidence — the zero-delivery proof

The requirement: the run emits run-scoped `delivery_blocked` evidence and contains **zero**
`delivery_attempt` events in its **complete** recorded logs. *Fixture absence alone is not
proof* — "we saw no attempt in the browser" is exactly the non-proof this rejects. An empty
list of complete log sources is a hard failure (`no_complete_log_source`), not a pass.

This pipeline failed four distinct ways before it worked, each documented in the source
because each is easy to reintroduce:

| Failure | Fix now in place |
|---|---|
| Nothing produced the log at all | Capture starts in `globalSetup`, before the first scenario, truncating the file so a stale run cannot masquerade as this one |
| `vercel logs` **snapshots and exits** (~8 s) rather than following — one invocation covered seconds of a multi-minute run | A shell loop re-invokes it every 20 s |
| Successive polls re-report overlapping entries | `dedupeLogText()` collapses by provider entry id |
| Vercel wraps app stdout in an **envelope**, so naive parsing read the envelope's absent fields | The parser unwraps `outer.message` to reach the inner event JSON |

A fifth issue was a **race**, not an absence: at teardown, this run's own blocked lines might
not be flushed yet. `awaitRunScopedEvidence()` polls every 2 s for up to 90 s and stops early
**only** when a `delivery_blocked` line carrying this exact `runId` appears — the same
predicate the final evaluation uses, so waiting can never turn an absence into a pass.

**Known limitation, stated rather than papered over:** the Vercel CLI log stream is
time-bounded and disconnects on its own after a few minutes, so a long run can lose tail
coverage. This fails *closed* — it loses its own `delivery_blocked` lines too, producing
`no_run_scoped_delivery_blocked` rather than a false pass. The remedy is a longer-lived
capture (a log drain, or re-invoking the CLI). **Do not relax the check.**

The harness's own evidence file (`test-results/sr-verification-evidence.log`) is explicitly
**not** a complete log source; only the runtime log counts.

---

## 7. Teardown

Runs unconditionally, collecting failures rather than stopping at the first.

1. **Login events**, under the still-live lease. The *only* login-event query anywhere in the
   harness is the exact `runId` + `deploymentId` predicate — there is no
   `*[_type == "loginEvent"]` path, no email path, no timestamp-range path. Every returned
   document is re-validated against the **full** ownership tuple before deletion, and each
   delete is paired in the same transaction with an `ifRevisionId` patch, so a document
   mutated since our read is left alone. The identical predicate is then re-run and must
   return zero.
2. **Fixtures.** The deletion set is the union of the deterministic fixture id list (computed
   in pure code, never a dataset query) and an append-only run-local ledger of ids the
   deployed routes generated, **minus** the infrastructure ids (marker and lease, which are
   never deletable). One transaction deletes then recreates every fixture; a post-write
   re-read must match exactly — any missing document, wrong `_type`, or unexpected extra
   `srv.*` document fails.
3. **Lease release** — owner-only, under `_rev`.
4. **Redaction scan** — see §2.
5. **Zero-delivery evidence** — see §6.

Both deletion sources are **closed sets**. Nothing is discovered by querying the dataset for
things that look like fixtures, which is what makes "it can only delete its own documents" a
property rather than a hope.

---

## 8. What the specs prove

| Spec | Invariant |
|---|---|
| `authorization.spec.ts` | Non-members and ordinary members are rejected from every manager mutation and admin read — including a well-formed create body from an unauthenticated caller. Also proves the negative controls are real by showing a member *can* reach its own proposal surface. |
| `deployment-identity.spec.ts` | The identity route proves the isolated project/dataset on the deployed host, and no request URL ever carries a bypass query parameter. |
| `integrity-summary.spec.ts` | Integrity reads correctly report draft/legacy/published targets, a legacy role missing its lock, a dangling member ref, two special services on one date kept distinct, a planted duplicate weekend target, and a legacy approval with no verifiable receipt. |
| `proposal-lifecycle.spec.ts` | The full proposal state machine: first create, refusal on admin-only drafts, stale-state rejection writing nothing, changes-requested → resubmit → approve with idempotent receipt retry, reopen under the reviewed revision. |
| `role-create.spec.ts` | Role + receipt + lock in one transaction; a lost response replays idempotently; a reused key with a different payload is `idempotency_mismatch`; a retired key cannot recreate; a second role at an occupied target is refused. |
| `role-edit-delete.spec.ts` | Edits apply only under the observed revision; a date move is blocked by dependent history; delete vacates the lock and frees the target; delete with dependent history is refused. |
| `role-publish.spec.ts` | Publish/unpublish under the observed revision; batch publish is atomic; one stale revision or unresolvable id rejects the **whole** batch. |
| `role-swap-copy.spec.ts` | Swaps and instrument copies write both sides only under their observed revisions; a stale side rejects with nothing written. |
| `setlist-conflicts.spec.ts` | The observed-target contract: `revision_mismatch`, `identity_mismatch`, `concurrent_creation`, and the deterministic create on observed-none. |
| `transaction-atomicity.spec.ts` | A failed create writes no receipt/role/lock; a failed approval writes no setlist/receipt/status; a failed swap leaves both roles byte-identical; a successful edit returns the stored document at its new revision. |
| `zero-delivery.spec.ts` | Publishing, approval, change-request and the reminder cron all reach the *blocked* path, and no delivery attempt surfaces in the browser — the harness half of the proof teardown completes at the log level. |

---

## 9. Operational notes

- **No CI workflow exists in this repo.** The harness is run manually. A concurrency-group
  name appears in a `playwright.config.ts` comment, but nothing here wires it to a pipeline.
- The isolated dataset is a **fixture** dataset. Its contents are disposable and are recreated
  by the seed script; never treat it as a source of truth.
- Credential rotation for the bypass secrets and the Sanity verification token is a standing
  open item, deliberately deferred.
