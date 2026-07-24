# Service Readiness A3 — isolated verification and release

Date: 2026-07-18

## Goal

Provide an auditable environment and release procedure that proves protected mutations through deployed authenticated routes without touching production Sanity data, then promotes the exact approved tree through `preview` and `main` in the canonical Vercel project.

## Boundary

A3 owns:

- non-production Sanity verification dataset provisioning, seed/reset/teardown guards, and credentials
- a dedicated verification Git branch with branch-scoped Vercel Preview variables
- deployed authenticated mutation checks against the isolated dataset
- exact commit/tree/project/deployment/domain evidence
- synchronization and promotion from feature work to `preview` and then `main`
- rollback and evidence retention

A3 does not implement A1 reads, A2 writers, or Plan B UI. It never authorizes production Sanity writes, production cleanup, a new Vercel project, or direct deployment of a feature branch to `dev-owt-backstage.vercel.app`.

## Hard identities and invariants

- Canonical Vercel project: `frank-rochas-projects/owt-backstage`
- Canonical project id: `prj_elS88VGezKpy18wizFN1ffoy8cJ5`
- Stable dev ownership: `preview` branch exclusively -> `https://dev-owt-backstage.vercel.app`
- Production branch: `main`
- Verification branch: `verify/service-readiness`
- Production Sanity boundary: project `ebb8vcnk`, dataset `production`; A3 credentials and writes must never target either.
- Verification Sanity project: `scbxomq9`, containing only the private `service-readiness-verification` dataset and no copied production content.
- Verification deployments use the canonical project's automatic unique/branch Preview URL and never receive the stable dev alias.
- `.vercel/project.json` must match project name/id before any Vercel command that can mutate/link/deploy/alias.
- Never rely on automatic `--yes` project selection. If the link is missing/wrong, stop and use only the repository-prescribed explicit link command, then re-read the file.
- The working tree and index must be clean before branch switches, merges, verification, or pushes. Stop on unrelated/untracked files rather than deleting them.

## 1. Explicit authorization gate

Planning and read-only inspection require no remote mutation. Before executing A3 Phase 1, obtain separate explicit user consent for each external change:

- create/use the named non-production Sanity dataset
- create a dedicated verification principal/token in isolated project `scbxomq9`
- add the exact verification deployment origin to Sanity CORS with credentials enabled
- create a synthetic test administrator/member fixture
- add/update Vercel Preview environment variables scoped to `verify/service-readiness`
- if and only if the read-only Deployment Protection preflight below proves the recorded verification URL is protected, create and use one dedicated A3 Protection Bypass for Automation secret
- push the verification branch
- seed/reset/delete test-only documents

Consent for this plan or for isolated test writes is not consent for writes to Sanity dataset `production`.

If consent is absent, A3 stops after dry-run inventories and configuration previews.

## 2. Isolated Sanity project and dataset

Use the clearly named non-production dataset `service-readiness-verification`. Never clone production content or member PII.

Project `ebb8vcnk` could not enforce a dataset-scoped ACL on its current plan. On 2026-07-23, the user explicitly authorized the sole approved fallback: separate Sanity project `scbxomq9`. Its private `service-readiness-verification` dataset has been created without cloning production content, member PII, or any other production data.

The verification principal/token must be dedicated and least-privilege within `scbxomq9`, with no membership, token, or grant in production project `ebb8vcnk`. Never reuse a production token or a human's ordinary Studio session. The separate project is the hard provider boundary: A3 accepts only `scbxomq9/service-readiness-verification` and explicitly refuses project `ebb8vcnk` or dataset `production`. There is no broader-credential-risk waiver.

Before seeding, record non-secret principal/role/grant identifiers and prove isolation safely:

1. Inspect the dedicated principal/token and require verification-dataset write permission in `scbxomq9`, with no membership, token, or grant in `ebb8vcnk`.
2. Prove the credential is issued by `scbxomq9` and that all A3 configuration targets exactly `scbxomq9/service-readiness-verification`.
3. Use documented non-committing permission checks: require verification-dataset read/write dry-run success and production-project write dry-run denial against one deterministic nonexistent sentinel. Query only that sentinel id before/after and require `exists=false`; never commit a production mutation or print production documents.
4. Keep provider membership/token inventories as a separate boundary check; the negative dry-run does not replace proof that the dedicated verification principals exist only in `scbxomq9`.

Completed 2026-07-23 proof: dedicated viewer token `siWOxHKgvcuqKI` read the verification dataset and was denied verification writes; dedicated editor token `si1jcvcPPcgYAR` passed a verification write dry-run and was denied the same dry-run against `ebb8vcnk/production`. The deterministic production sentinel was absent before and after. Both tokens were issued by `scbxomq9`, and no membership was added to the production project. This evidence authorizes no committed production mutation.

Add guarded operator scripts under `scripts/`:

- `service-readiness-verification-seed.mjs`
- `service-readiness-verification-reset.mjs`
- optional `service-readiness-verification-destroy.mjs`

Guards:

- dry-run default; `--apply` plus separate explicit consent for remote writes
- require exact dataset name and refuse `production` or an absent/mismatched environment marker
- require a verification marker document whose id/value identifies the dataset purpose
- print project/dataset/document ids before apply
- use deterministic fixture ids and `_key` values so reset is repeatable
- back up any existing same-id test documents before mutation
- reset/delete only deterministic verification fixture ids, never discovery-based broad deletion
- post-apply re-query and fail if expected fixture state is not exact
- require ownership of the unexpired dataset lease below before any fixture create/reset/delete

Synthetic fixtures cover:

- one credentials-provider test admin with a secret password hash supplied outside Git
- members representing all five assignment paths, plus unavailable/dangling cases
- Sunday, Saturday, and special roles in draft/published/legacy-missing-published states
- empty/incomplete/ready setlists
- pending/changes-requested/approved/legacy-approved proposals
- duplicate/draft-conflict/malformed fixtures created only for the specific test that resets them afterward
- no real email addresses, device tokens, or notification destinations

The dataset contains no production tokens or copied user records. Test email values use non-deliverable domains and branch-scoped allowlists exclude them; fixture members have no device tokens.

### Exclusive dataset lease

Only one run may mutate `service-readiness-verification`. Use a deterministic lease document such as `_id=serviceReadiness.verificationLease` with `owner`, `runId`, `candidateSha`, `deploymentId`, `acquiredAt`, `expiresAt`, and `_rev`.

- Owner is the exact `runId:candidateSha:deploymentId` generated by the orchestrator.
- Acquire atomically with create-if-absent, or replace an expired lease only under an `_rev` precondition; re-read exact owner before touching fixtures. A live foreign lease fails immediately.
- Renew/release only as current owner under `_rev`. Use a short bounded expiry; never steal/delete a live lease.
- Every seed/reset/scenario re-checks ownership. Deterministic fixtures may be changed or cleaned only under that lease.
- Cleanup runs in `finally`, resets only owned deterministic fixtures, and releases the lease. Failed cleanup blocks later runs until expiry and an explicitly authorized targeted reset.

Also configure the CI/Vercel verification job as single-flight with fixed concurrency group `owt-backstage-service-readiness-verification` and `cancel-in-progress: false`. Tests start only after the recorded Vercel deployment is `Ready`; a replacement deployment invalidates the run. The dataset lease remains mandatory for local/retried runners.

## 3. Branch-scoped Vercel environment

Within the canonical Vercel project, scope Preview variables specifically to Git branch `verify/service-readiness`:

- `NEXT_PUBLIC_SANITY_PROJECT_ID`
- `NEXT_PUBLIC_SANITY_DATASET=service-readiness-verification`
- `NEXT_PUBLIC_SANITY_API_VERSION`
- `SANITY_API_READ_TOKEN`
- `SANITY_WRITE_TOKEN`
- `NEXTAUTH_SECRET`
- `SERVICE_READINESS_VERIFICATION_MARKER=owt-service-readiness-verification-v1`
- `ALLOW_SERVICE_READINESS_E2E_WRITES=true`
- any credentials-provider/test-only secret required by the seeded administrator
- new A3 guard `SERVICE_READINESS_DELIVERY_MODE=disabled`
- inert branch overrides for every inherited delivery setting:
  `EMAIL_ALLOWLIST`, `EMAIL_REDIRECT_TO`, `EMAIL_FROM`, `SMTP_HOST`,
  `SMTP_PORT`, `SMTP_SECURE`, `SMTP_USER`, `SMTP_PASS`, `RESEND_API_KEY`,
  and `FIREBASE_SERVICE_ACCOUNT`

Use Vercel's branch-scoped Preview environment support; do not change Production variables or general Preview variables used by `preview`/phone testing. Secrets remain in Vercel/Sanity secret stores and never enter tracked files or tool output.

The embedded Studio uses `NEXT_PUBLIC_SANITY_PROJECT_ID`, `NEXT_PUBLIC_SANITY_DATASET`, and `NEXT_PUBLIC_SANITY_API_VERSION` through `sanity/env.ts`. After the unique deployment URL is known, add only that exact origin (scheme plus host) to Sanity CORS with credentials enabled. No wildcard, suffix pattern, stable-dev origin, or general `*.vercel.app` entry is allowed. Sign in with a dedicated Sanity identity whose role is scoped only to the verification dataset. Keep its login secret/session outside Git and logs; never publish Playwright `storageState`. Remove the exact CORS origin and revoke the identity only under the cleanup approvals below.

Before deploying:

- list/inspect variable names and scopes without printing secret values
- prove every required variable is scoped to the verification branch
- prove dataset value is not `production`
- prove ordinary `preview` deployments retain their existing production-backed configuration
- ensure the app has a server-side environment guard that refuses verification fixture/reset endpoints unless the exact verification dataset marker and non-production dataset are present
- prove the dedicated Studio identity authenticates only to project `scbxomq9` and has no membership, token, or grant in production project `ebb8vcnk`

Bootstrap evidence recorded 2026-07-23: read-only Vercel project API inspection
returned `autoExposeSystemEnvs=true` for canonical project
`prj_elS88VGezKpy18wizFN1ffoy8cJ5`. Therefore
`VERCEL_GIT_COMMIT_REF=verify/service-readiness` is available to the
`next.config.mjs` build guard on the first Git-triggered branch deployment. If
that provider setting changes, the bootstrap proof is invalid and the branch
must not be pushed without a new fail-closed mechanism.

### Read-only Deployment Protection preflight

Before creating, selecting, or sending any bypass credential, inspect the canonical project's Deployment Protection method/scope through a read-only Vercel project-settings/API call and make an unauthenticated, no-redirect request to the exact recorded verification deployment URL. Verify `.vercel/project.json` first. Record the non-secret protection method/scope, project id, deployment id/URL, status/redirect target, timestamp, and the exact Node and Vercel CLI versions used. The provider setting is authoritative; an HTTP response alone must not be interpreted as proof that protection is disabled. Automation pins the Vercel CLI invocation to the reviewed exact version (or records the equivalent read-only API revision); version provenance is non-blocking and must not weaken any identity or protection assertion.

- If the provider setting and probe prove the deployment is unprotected, record `deploymentProtection=none`, do not create or use a bypass, and continue with the ordinary Playwright configuration.
- If the deployment is protected, stop before the deployed suite until the user explicitly approves creation and use of one newly named A3-only Protection Bypass for Automation secret. Do not reuse a general, production, human, or another tool's secret, and do not make the branch/domain a Deployment Protection Exception.
- The approval prompt must state the project-wide blast radius: Vercel automation bypass secrets apply to every deployment in `owt-backstage` until revoked and bypass Deployment Protection plus certain firewall/system mitigations and bot challenges. Branch-scoped test intent does not reduce that provider-enforced scope.
- Keep the secret runner-side only in an approved CI/local secret store. Do not add it to tracked files, Playwright storage state, branch environment configuration, URLs/query strings, screenshots, traces, videos, console output, or app logs; the deployed application must never read it. If Vercel exposes its managed `VERCEL_AUTOMATION_BYPASS_SECRET` system variable to deployments, treat that as unavoidable provider behavior, never consume or print it, and still supply the runner from its runner-side secret store.
- Configure the Playwright browser context with `x-vercel-protection-bypass: <runner secret>` and `x-vercel-set-bypass-cookie: true` on the initial navigation. Follow the redirect on the same exact deployment host, retain the returned bypass cookie in the in-memory context so browser navigations, assets, NextAuth redirects, and client `fetch` follow-up requests are authorized, and give any separate Playwright `APIRequestContext` the bypass header explicitly. Use `samesitenone` only for a separately justified cross-site/iframe case. Never put the secret in the base URL.
- Evidence records only the secret's non-secret provider id/name, creation time, project id, configured header names, protected-without-bypass result, successful exact-host smoke with the bypass, and subsequent cookie-backed follow-up success. Add a redaction assertion that retained reports/traces/logs contain neither the secret nor a bypass query parameter; never print or hash the secret as evidence.
- Revocation is a separate destructive cleanup action requiring fresh explicit user approval after the run. With that approval, revoke only the recorded A3 secret, confirm the same protected probe is rejected using the previously held value without outputting it, then discard the runner copy. Without cleanup approval, retain it only with a named owner and short expiry/review date; release/promotion approval is not revocation approval.

The verification branch receives an automatic Vercel Preview URL. Authenticated tests use the isolated credentials-provider administrator; they do not require modifying Google OAuth callback lists or using a production account.

### Outbound-delivery firewall

The complete email/push inventory is: SMTP/Resend in `app/utils/email.ts` (`SMTP_HOST`, `SMTP_PORT`, `SMTP_SECURE`, `SMTP_USER`, `SMTP_PASS`, `RESEND_API_KEY`, `EMAIL_FROM`); recipient controls in `app/utils/assignmentEmail.ts` and `app/utils/proposalNotify.ts` (`EMAIL_ALLOWLIST`, which currently defaults to `"*"`, and `EMAIL_REDIRECT_TO`); and Firebase Admin/FCM plus dead-token pruning in `app/utils/firebaseAdmin.ts` and `app/utils/push.ts` (`FIREBASE_SERVICE_ACCOUNT`, `SANITY_WRITE_TOKEN`). Cover their role create/publish, proposal, setlist, and reminder-cron call sites.

On `verify/service-readiness`, `SERVICE_READINESS_DELIVERY_MODE=disabled` is a server-enforced transport firewall checked before SMTP transport/Resend client creation, Firebase initialization, FCM send, or dead-token pruning. The branch must not inherit/define production-capable `SMTP_*`, `RESEND_API_KEY`, `EMAIL_FROM`, `EMAIL_REDIRECT_TO`, or `FIREBASE_SERVICE_ACCOUNT`; `EMAIL_ALLOWLIST` is explicitly empty/nonmatching, never absent or `*`. If inherited Preview secrets cannot be safely masked, stop and use separately approved provider sandbox credentials/endpoints that cannot deliver externally; do not alter general Preview/Production variables.

Preflight lists names/scopes only and fails closed unless delivery mode is exactly `disabled`, all production-capable transports are unreachable, fixtures have no device tokens, and no email is deliverable/redirected. Contract tests invoke every trigger with provider SDKs spied and require zero SMTP `sendMail`, Resend `emails.send`, Firebase initialization/`sendEachForMulticast`, and pruning calls. The deployed run emits run-id-scoped `delivery_blocked` evidence and must contain zero `delivery_attempt` events in its complete recorded logs. Fixture absence alone is not proof.

## 4. Deployed-route verification harness

Use the repository's installed Playwright dependency and add a verification configuration/suite that requires:

- explicit base URL of the recorded verification deployment
- explicit `ALLOW_SERVICE_READINESS_E2E_WRITES=true`
- server-exposed test-only dataset marker check proving the deployment targets the verification dataset
- test credentials supplied through untracked/local or CI/Vercel secrets
- refusal to run when base URL is production or `dev-owt-backstage.vercel.app`

The suite signs in through the real credentials flow and exercises deployed application/API routes, not imported handlers:

- role create plus lost-response/idempotency behavior
- edit, dependency-blocked date move, delete/vacate, and recreate
- single/bulk publish with atomic rejection
- individual/team swap and copy-instruments stale source/target
- setlist observed-singleton and observed-none conflicts
- proposal first create/save/resubmit/request/reopen/approve/receipt retry
- integrity-summary visibility for duplicate/draft/malformed fixtures
- failed transaction leaves no partial business state
- successful mutation returns expected refreshed read shape
- authentication/authorization rejects member/non-member callers
- Studio protected documents deny mutation even through a direct document URL, using the dedicated verification-only Studio identity in isolated project `scbxomq9` and exact-origin credentialed CORS
- guarded writer scripts dry-run safely; any isolated-dataset `--apply` scenario runs only when that named action was separately authorized

Reset deterministic fixtures before each scenario and re-query Sanity after each success/conflict, always under the live dataset lease. Run the Studio browser check only with the dedicated identity/CORS/session controls above. If protection is a code-owned Studio document-action policy, prefer an exported non-browser contract test against that same policy and keep the browser smoke read-only; do not weaken identity/CORS isolation or claim browser mutation-denial proof. A2 tests verify selection; A3's transport firewall and evidence prove zero provider delivery attempts.

### Run-owned credentials login events

The real credentials sign-in invokes `auth.ts`'s `events.signIn`, which currently creates a random-id `loginEvent`. Those writes are verification side effects and must not be left to fixture reset or broad type/time/email deletion. Implement an isolated-verification-only ownership path before running deployed authentication:

- The harness generates a collision-resistant `runId` and per-sign-in `attemptId`, and sends non-secret run/deployment/candidate markers as dedicated headers on the same-origin credentials request. `auth.ts` carries them through credentials authorization to the sign-in event only when the exact non-production dataset marker, `SERVICE_READINESS_DELIVERY_MODE=disabled`, candidate SHA, and unexpired dataset lease owner all match `runId:candidateSha:deploymentId`. A request that supplies verification headers outside those conditions fails closed; an ordinary credentials sign-in with no headers keeps current behavior.
- Extend the `loginEvent` schema with optional verification ownership fields for `runId`, `attemptId`, `candidateSha`, and `deploymentId`. Do not infer ownership from email, member id, provider, timestamp, branch, or fixture ids. The combination of a cryptographically random run id, recorded deployment id, and unique attempt id is the collision boundary.
- Before the first sign-in, query the exact run/deployment ownership predicate and require zero matches. Any pre-existing match is a collision: abort, generate a new run id, and do not delete the pre-existing document.
- Capture the `_id` returned by every `writeClient.create` and emit a redacted structured `verification_login_event_created` record containing only run/deployment/attempt/event ids. After each awaited sign-in, query the exact run/deployment predicate, reconcile the returned ids with the created-event records/expected attempt ids, and add them to the run's exact cleanup set. A missing, duplicate, foreign, or late event fails the scenario.
- In the outermost `finally`, while the same dataset lease is still live, repeat that exact ownership query to capture any late run-owned ids, validate every document's full ownership tuple, and delete only the resulting explicit `_id` set (prefer revision preconditions). Re-query the same exact predicate and require zero remaining documents before fixtures are reset and the lease is released. Never delete `*[_type == "loginEvent"]`, an email/member/time range, or any id that was not returned by the run-owned predicate.

Required app/test work is explicit: factor the verification-header/lease validation and login-event creation into server-only testable helpers; update `auth.ts` and `sanity/schemas/loginEvent.ts`; add the exact-id cleanup to the guarded A3 reset/orchestrator path; and add tests proving ordinary unmarked sign-in compatibility, valid marker propagation and returned-id evidence, rejection for production/missing-marker/mismatched-or-expired-lease/foreign-deployment cases, collision refusal, exact-id-only cleanup in `finally`, late-event capture, and zero remaining run-owned events after success and forced failure. No general login-event deletion endpoint is added.

## 5. Verification-branch proof chain

1. Begin with clean worktree/index and current fetched `origin/main`/`origin/preview`.
2. Create/update `verify/service-readiness` from the exact feature candidate tree; commit conventionally.
3. Prove the verification branch tree hash equals the candidate feature tree hash.
4. Run `npx tsc --noEmit`, `npm test`, `npm run build`, and `git diff --check`; require the tree remains clean.
5. Record candidate commit and tree SHA.
6. Verify `.vercel/project.json` name/id, branch-scoped variables, and non-production dataset marker.
7. Push only the verification branch and wait for its Git-triggered deployment.
8. Record deployment id/URL and metadata proving canonical project id/name, Git ref `verify/service-readiness`, Git SHA equal to candidate, and state `Ready`.
9. Acquire the lease for the exact run/commit/deployment and run the authenticated suite only against that recorded URL.
10. In `finally`, reset owned fixtures, release the lease, and retain non-secret output plus zero-delivery-attempt evidence tied to run/commit/tree/deployment ids.

Any changed commit/tree/environment/deployment invalidates the result and restarts the chain.

## 6. Promotion to stable `preview`

Before creating the preview candidate:

1. Fetch current `origin/main` and `origin/preview`.
2. Merge current `origin/main` into the feature candidate first, then merge current `origin/preview`; resolve and commit on the feature branch.
3. If either merge changes the tree, rerun local and verification-branch gates.
4. Fast-forward local `preview` from `origin/preview`, merge the verified feature branch, and create the final preview candidate commit.
5. Prove the final preview tree equals the verified feature tree; if not, rerun verification deployment/tests on the final preview tree before push.
6. Require empty `git status --porcelain`; record final preview commit/tree SHA.
7. Run `npx tsc --noEmit`, `npm test`, `npm run build`, and `git diff --check` on that exact commit; re-check clean state afterward.
8. Verify canonical `.vercel/project.json`, then push only `preview`.
9. Prove `origin/preview` equals the recorded commit.
10. Record Vercel metadata proving canonical project, Git ref `preview`, exact SHA, and `Ready`.
11. Prove `dev-owt-backstage.vercel.app` aliases that exact deployment; HTTP 200 or a deployment from another branch/commit is insufficient.

Because stable preview remains production-backed, manual desktop/mobile QA there is read-only/open-and-cancel unless the user separately authorizes production Sanity writes. Mutating behavior was already proven on the isolated verification deployment.

## 7. Approval and promotion to `main`

Approval attaches to the recorded preview commit, tree, deployment, and stable-domain mapping.

Immediately before promotion:

1. Before any `main` push, record the current known-good production deployment id, URL/domain mapping, Git SHA, canonical project id/name, and `Ready` state as the immutable rollback target; HTTP 200 alone is insufficient.
2. Fetch `origin/main` and `origin/preview` again.
3. Require `origin/preview` still equals the approved commit.
4. Require current `origin/main` is an ancestor of the approved preview commit. If it is not, merge current main into preview, rerun the complete verification/preview/deployment/approval chain, and obtain approval again.
5. Fast-forward `main` to the approved preview commit; do not merge the sibling feature branch and do not create a different production tree.
6. Prove local/main/origin-preview commit and tree equality before pushing.
7. Run the local gates on the exact main candidate and require clean state.
8. Push `main`, then prove `origin/main` equals the approved commit.
9. Record production deployment metadata proving canonical project, Git ref `main`, exact approved SHA, and `Ready`.
10. Verify the production domain resolves to that deployment and scan deployment logs for new errors.

If main cannot fast-forward to the approved preview commit, stop; do not manufacture a merge commit after approval.

## 8. Failure and rollback

- Verification-branch failure has no stable-domain impact: fix on feature work, reset synthetic fixtures, and restart with a new commit/tree/deployment.
- Preview failure: do not promote. Revert through a new commit or restore the prior verified preview tree without destructive reset, push `preview`, and verify its deployment/domain metadata.
- Never use `git reset --hard`, force-push, broad dataset deletion, or a feature-branch alias to recover.

### Production incident contract

Production rollback and the subsequent `main` push are separate remote mutations and require explicit user authorization unless the user's current incident instruction already authorizes each exact action. Instant Rollback is an emergency traffic-restoration step, not Git reconciliation: it pins the production domains to an existing deployment and disables automatic production-domain assignment until the rollback is explicitly undone.

1. Stop the release and record the incident deployment id/URL, Git ref/SHA, canonical project id/name, affected production-domain mapping, `Ready` state, timestamps, and relevant non-secret error evidence. Re-read `.vercel/project.json` before every Vercel mutation in this sequence.
2. Re-inspect the immutable pre-push rollback record. The only permitted Instant Rollback target is that exact known-good deployment id/URL. Prove it still belongs to `frank-rochas-projects/owt-backstage` (`prj_elS88VGezKpy18wizFN1ffoy8cJ5`), has the recorded `main` SHA and `Ready` state, and was previously eligible for the recorded production domains. If any identity differs or the target is unavailable, stop; do not choose an implicit previous or alternate deployment.
3. With the required approval, invoke Instant Rollback against the exact recorded deployment id/URL. Wait for the provider rollback status to complete, re-inspect the deployment, and prove every recorded production domain now maps to that exact known-good deployment. Confirm service health and logs. HTTP success without exact deployment/domain mapping is insufficient. If rollback status, mapping, or health is inconclusive, stop with the known evidence and do not begin Git reconciliation.
4. Fetch `origin/main`, require a clean worktree/index, and prove the incident commit is still the recorded `origin/main` tip. Create a dedicated rollback branch from that exact tip and use Git revert semantics to produce one conventional recovery commit, with a message such as `revert(release): restore known-good production behavior` and a body identifying the reverted incident SHA/change set and reason. Do not add unrelated fixes, rewrite history, or assume that reverting one commit recreates the known-good tree: prove the revert tree is the intended recovery tree. If `origin/main` advanced or the revert is non-clean/ambiguous, stop for a newly reviewed recovery plan and approval.
5. Run `npx tsc --noEmit`, `npm test`, `npm run build`, and `git diff --check` on the exact revert commit; require a clean worktree/index afterward. With the required push authorization, fast-forward local `main` to the rollback branch and push `main` through the normal non-force workflow, then prove `origin/main` equals the revert SHA.
6. Wait for the Git-triggered revert deployment without undoing the Instant Rollback. Record its deployment id/URL and prove canonical project id/name, Git ref `main`, Git SHA equal to the revert commit, production environment, and state `Ready`. Verify its unique deployment URL and logs while the domains remain safely pinned to the known-good deployment. A deployment for another ref/SHA/project, a failed/canceled deployment, or absence of an exact deployment is a hard stop: retain the rollback pin and do not promote or reassign domains.
7. Re-read `.vercel/project.json`, then explicitly undo Instant Rollback through Vercel's supported flow by promoting the exact verified revert deployment id/URL (for example, `vercel promote <deployment-id-or-url>`) or by using the dashboard's **Undo Rollback** action and selecting that exact deployment. Wait for promotion status to complete. Do not use a manual alias alone as a substitute, because it does not prove that rollback state or automatic assignment was restored.
8. Prove every production domain now maps to the exact revert deployment, the deployment remains `Ready`, and production health/logs are acceptable. Through Vercel's rollback/promotion status and project Production Branch Tracking settings (or equivalent provider API evidence), prove the project is no longer in rolled-back state and automatic production-domain assignment is enabled again for future `main` pushes; do not create a throwaway production push to test it.

If Git revert creation, gates, push, deployment, or final promotion fails after traffic rollback, leave production pinned to the recorded known-good deployment, stop further production mutations, and report the exact Git/Vercel divergence. If final domain mapping or automatic-assignment restoration cannot be proven, the incident remains open and Git/deployment alignment must not be claimed. Any alternate rollback target, replacement recovery commit, manual domain assignment, or retry against changed remote state requires renewed inspection and explicit user approval.

Retain non-secret evidence for the approval/instruction authorizing each mutation; actor and timestamp; Vercel CLI/API version; canonical link check; incident and known-good deployment ids/URLs/refs/SHAs/states; rollback target/status and before/after domain mappings; revert commit/parent/tree/message and gate results; `origin/main` SHA; revert deployment id/URL/ref/SHA/environment/state; promotion/Undo Rollback target and status; final domain mapping; production health/log review; and provider proof that automatic production-domain assignment is restored. Never record tokens, protection bypass values, or other secrets.

## 9. Verification-resource cleanup

After the full Service Readiness program is accepted:

- inventory exact verification Vercel variables, Sanity credential/role/user, CORS origin, remote branch, deployments, and dataset without printing secrets
- obtain explicit user approval separately before each destructive cleanup category: remove remote variables, revoke/delete credentials or memberships, remove origins, delete the remote branch, delete deployments, or delete the dataset. Release acceptance or a generic cleanup request is not blanket approval.
- remove only recorded verification-branch Vercel values and the exact verification CORS origin, without pattern matching, after their approvals
- revoke/delete only the dedicated verification credential/role/user after its approval
- delete the non-production dataset only after dataset deletion is explicitly approved
- if dataset retention is intentional, revoke write access and record owner, purpose, and expiry/review date
- delete the remote verification branch/deployment only after their approvals and after retaining non-secret commit/tree/deployment/test evidence
- re-list/re-query each resource to prove cleanup and verify production/ordinary Preview variables were untouched

During A1/A2/Plan B implementation the environment may remain intentionally active, but its credential and branch scope must be recorded and it must never become a general Preview or Production secret.

## Implementation order

1. Add guarded seed/reset scripts and verification marker contract.
2. Obtain explicit authorization and provision the isolated dataset/test identity.
3. Add branch-scoped Vercel Preview variables in the canonical project.
4. Add the Playwright deployed-route harness and environment refusal guards.
5. Prove the verification branch flow with a harmless read/auth smoke test before A2 replaces writers.
6. Use the environment for A2 and Plan B deployed mutating verification.
7. Execute exact preview promotion/read-only QA.
8. Execute the synchronized fast-forward main promotion and production verification.
9. Revoke or explicitly retain the verification resources under the cleanup contract.

## Completion gate

A3 is complete when:

- an explicitly authorized isolated dataset and synthetic identity can be deterministically seeded/reset without production access
- a dedicated Sanity principal/token in isolated project `scbxomq9` has positive verification access proof and no membership, token, or grant in production project `ebb8vcnk`; no broader-risk waiver exists
- branch-scoped Vercel variables isolate `verify/service-readiness` inside the canonical project
- exact-origin credentialed Studio CORS/identity makes the protection check executable, or the same code-owned policy passes its declared contract fallback
- CI/Vercel single-flight plus the owner/expiry lease prevents overlapping fixture mutation and enforces owned cleanup
- SMTP, Resend, and FCM are disabled/sandboxed, fail closed on production-capable credentials, and prove zero delivery attempts
- deployed authenticated mutation checks pass at a recorded unique verification URL
- the final preview commit/tree passes local gates and maps to the stable dev domain in the canonical project
- current main is synchronized into preview before approval
- the known-good production deployment id/mapping is recorded before the `main` push
- main fast-forwards to the exact approved preview commit and production deploys that SHA
- evidence ties every gate to commit, tree, project, deployment, and domain
- verification credentials/environment/dataset are removed or explicitly retained with write access revoked and an owner/expiry

A3 never authorizes production Sanity mutation, changes stable dev ownership, creates another Vercel project, or substitutes HTTP success for exact artifact verification.
