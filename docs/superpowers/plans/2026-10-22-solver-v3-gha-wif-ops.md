# Solver v3 verify and deploy from GitHub Actions, keyless (Workload Identity Federation)

Phase 3 of the «Trabajar todo en la nube» plan. Status: **plan, under adversarial review**
(critical tier: it creates an auth/secret boundary — who may deploy the production solver and
who may read its API key — and an irreversible remote release action).

## 1. Requirement

Frank, 2026-10-21: «quiero poder trabajar completamente en la nube para no depender de si tengo mi
laptop abierta o no». 2026-10-22, after the plan doc (https://claude.ai/artifact/SBngK1tiRn3dnEdPCT9geP)
proposed this phase: «Te doy mi OK. para las siguientes fases».

Standing constraints from the project: no credential or infra change without Frank's OK (given for
this phase, but each production action below still asks him at the moment it happens); never ask
Frank to paste a credential into a chat; nothing secret is committed (the repository is public, and
so are its Actions logs); every new secret or credential-bearing setting gets a `docs/SECRETS.md`
entry; CLAUDE.md's release order applies.

What still needs the Mac today for the v3 solver function `owt-solver-v3` (gen2, us-central1,
project `eloquent-figure-421401`): **verifying a deploy** (the ping needs `owt-solver-api-key`,
`docs/SOLVER_AND_INFRA.md` «Verifying a v3 deploy») and the **manual fallback deploy**
(`scripts/deploy-solver-v3-gcf.sh`). The normal deploy is already in the cloud: Cloud Build trigger
`owt-solver-v3-deploy` (global, GitHub, `^main$`, `gcf_v3/**`, config `gcf_v3/cloudbuild.yaml`,
service account = the default compute account; `docs/SOLVER_AND_INFRA.md:583-597`).

**Goal:** a cloud session (or Frank from his phone) can (a) verify the deployed function and (b)
re-run the production deploy, without the Mac and without any long-lived Google credential
existing anywhere.

**What this does and does not change about who can deploy.** Cloud sessions already act on GitHub
*as Frank*: the session's GitHub identity is `FrankERP` with `admin` on the repository (checked
2026-10-22: `gh api user`, repo `permissions`), and `main` requires a green `gates` but no
approving review (`docs/CI.md:313`). So a session can already put solver code into production by
merging a `gcf_v3/**` change: the existing trigger deploys it. This plan adds **no new deploy
capability for an agent**: the `deploy` action re-runs that same trigger at `main`'s tip, i.e. it
deploys only what a merge could already have deployed. What it adds is (a) reading the API key
from Actions (`verify`), and (b) a way to re-run the deploy when the trigger missed or failed.
Consequently, no GitHub setting can make Frank's approval a *technical* barrier against an agent
(an approval the session submitted would be recorded as Frank's). The human gates here are
**policy**, written down and owned by the agent rules (§4), exactly like the existing rule that a
merge to `main` follows CLAUDE.md's release order. A technical gate that only Frank's own identity
can pass (e.g. a Cloud Build approval in the Google console) was considered and rejected (§9): it
would guard this path while the merge→trigger path, which deploys the same thing, stays ungated.

### Non-goals

- v2's function `owt-solver` (the rollback engine, ADR-0056): unchanged; its verification stays
  manual (Cloud Shell). A later phase may extend the same identities to it.
- Secret rotation (`owt-solver-api-key` and others): stays a manual Cloud Shell procedure
  (`docs/SECRETS.md`); Cloud Shell is a browser, not the Mac.
- Sanity credentials (phase 2) and dev-verify (phase 4).
- Giving cloud sessions general `gcloud` access (rejected, §9).

## 2. Design overview

```
GitHub Actions job (repo 837387462, ref refs/heads/main, environment solver-verify|solver-deploy)
   └─ OIDC token ──► GCP Workload Identity pool `github-actions`, provider `owt-kb-v1`
                      (attribute condition: repo id + owner id + main + one of the two environments)
                      └─ short-lived token for exactly one service account:
                           solver-verify ─► owt-gha-verify  (read the function, read the API key)
                           solver-deploy ─► owt-gha-deploy  (run the existing Cloud Build trigger)
```

No service-account key is created at any point. A credential exists only for the minutes a job
runs, and only for a job that GitHub let into a protected environment on `main`.

## 3. Google Cloud side (setup script, run once by Frank in Cloud Shell)

New file `scripts/gcp/setup-solver-v3-gha-wif.sh`. Bash, `set -euo pipefail`, never `set -x`.
**Dry run by default** (prints each `gcloud` command it would run and what it found);
`--apply` executes. **Idempotent and drift-checked:** every resource is `describe`d first and
created only when absent; every IAM grant is `add-iam-policy-binding` (a no-op when present).
**An existing provider is compared, not trusted:** its `oidc.issuerUri`, `attributeMapping` and
`attributeCondition` are read back and compared with the script's expected values (the condition
byte for byte). On any difference the script stops and prints the difference plus the exact
`gcloud iam workload-identity-pools providers update-oidc …` command; it applies that update only
under a second explicit flag (`--apply --update-provider`), so tightening or correcting the gate
after creation is a reviewed script change plus one deliberate re-run, never a silent no-op. The
same compare runs in dry-run mode, so a dry run is also the read-back check (§10). It never creates a key
(`gcloud iam service-accounts keys create` does not appear in the file; a guard test asserts it,
§6). It prints only resource names, never a token or a secret value.

Inputs: `GCP_PROJECT` (required). Derived: `PROJECT_NUMBER` (`gcloud projects describe`).
Workload Identity pools and providers are soft-deleted for 30 days: a `describe` answering
`state: DELETED` makes the script stop and print the `undelete` command for Frank to choose,
never create a lookalike or undelete on its own.

Resources:

1. **APIs:** `iam.googleapis.com`, `iamcredentials.googleapis.com`, `sts.googleapis.com`
   (enable is idempotent).
2. **Pool** `github-actions` (global), display name «GitHub Actions (owt-kb-v1)».
3. **Provider** `owt-kb-v1` in that pool: OIDC, issuer `https://token.actions.githubusercontent.com`.
   - Attribute mapping: `google.subject=assertion.sub`,
     `attribute.repository_id=assertion.repository_id`, `attribute.environment=assertion.environment`,
     `attribute.ref=assertion.ref`, and the composite
     `attribute.repo_env=assertion.repository_id + '/' + assertion.environment`, which the
     service-account bindings key on (below): a principalSet on an attribute spans every provider
     in the pool, so keying on the repository id as well means a provider added to this pool later
     cannot inherit either identity under a weaker condition.
   - **Attribute condition** (the gate Google evaluates before issuing anything):
     `assertion.repository_id == '837387462' && assertion.repository_owner_id == '68241914' &&
     assertion.ref == 'refs/heads/main' && assertion.environment in ['solver-verify', 'solver-deploy']
     && assertion.workflow_ref == 'FrankERP/owt-kb-v1/.github/workflows/solver-v3-ops.yml@refs/heads/main'`.
     The `workflow_ref` clause means only this one guarded file can federate — not some future
     workflow on `main` that happens to declare one of the two environments (`solver-verify` yields
     the shared v2/v3 API key with no approval step). It matches on the repository's name, so a
     rename makes federation fail closed until the condition is updated.
     Numeric ids, not names: a renamed or transferred repository, or a new repository reusing the
     name, cannot match (ids checked 2026-10-22: `GET /repos/FrankERP/owt-kb-v1` → `id` 837387462,
     `owner.id` 68241914). `ref == refs/heads/main` holds independently of GitHub's environment
     settings, so a mis-set environment branch policy still cannot federate a branch or PR run.
     A job with no `environment` has no `environment` claim and fails the condition (fail closed).
4. **Service account `owt-gha-verify`** — grants:
   - `roles/cloudfunctions.viewer` **on the function resource** `owt-solver-v3` (gen2,
     us-central1) — `gcloud functions add-iam-policy-binding owt-solver-v3 --gen2 --region=us-central1`.
     If the rehearsal shows a function-level grant does not authorize `functions describe`, the
     fallback is the same role at project level; the script's comment and the ADR say which one
     shipped. Re-runs only add grants, so a switch leaves the superseded grant in place; it is
     removed by hand (`remove-iam-policy-binding`) and the ADR says so.
   - `roles/secretmanager.secretAccessor` **on the secret** `owt-solver-api-key` only.
   - Federation: `roles/iam.workloadIdentityUser` on the SA for
     `principalSet://iam.googleapis.com/projects/$PROJECT_NUMBER/locations/global/workloadIdentityPools/github-actions/attribute.repo_env/837387462/solver-verify`.
5. **Service account `owt-gha-deploy`** — grants:
   - `roles/cloudbuild.builds.editor` at project level (Cloud Build has no per-trigger IAM; running
     a trigger needs `cloudbuild.builds.create`).
   - `roles/iam.serviceAccountUser` **on the trigger's service account only**: the script reads it
     (`gcloud builds triggers describe owt-solver-v3-deploy --region=global --format='value(serviceAccount)'`),
     accepts both a bare email and the `projects/<p>/serviceAccounts/<email>` form, and refuses to
     continue if it is empty (a trigger that uses the default account implicitly) or not in this
     project — Frank then decides with Claude, no guessing. Expected: the default compute account
     (`docs/SOLVER_AND_INFRA.md:584`).
   - Federation: `roles/iam.workloadIdentityUser` for `…/attribute.repo_env/837387462/solver-deploy`.
   - **Honest blast radius:** `builds.editor` + actAs on the default compute account is effectively
     project-editor-equivalent (a build can run any step as that account, which is how the trigger
     deploys today). What stands in front of it: **technically**, the provider condition (this
     repository, this workflow file, `main`, the `solver-deploy` environment) — so only code that
     reached `main` through a PR with green `gates` can use it; **by policy**, Frank's approval of
     each run and the agent rule of §4. The policy half is not a technical control against an
     agent acting as `FrankERP` (§2); it is the same footing as the merge→trigger path, which
     already runs `gcf_v3/cloudbuild.yaml` as this same compute account.
6. **Output** (non-secret, for Frank to paste into GitHub, §4): the provider resource name
   `projects/$PROJECT_NUMBER/locations/global/workloadIdentityPools/github-actions/providers/owt-kb-v1`
   and the two SA emails.

## 4. GitHub side (Frank, in the repository settings; Claude cannot do this)

Two **environments**:

| Environment | Deployment branches | Required reviewers | Variables |
|---|---|---|---|
| `solver-verify` | Selected: `main` only | none | `GCP_PROJECT`, `GCP_WIF_PROVIDER`, `GCP_SERVICE_ACCOUNT` = `owt-gha-verify@…` |
| `solver-deploy` | Selected: `main` only | FrankERP («Prevent self-review» off, so he can approve a run he started; «Allow administrators to bypass configured protection rules» off) | `GCP_PROJECT`, `GCP_WIF_PROVIDER`, `GCP_SERVICE_ACCOUNT` = `owt-gha-deploy@…` |

Environment **variables**, not secrets: none of these values grants anything (the provider and SA
names are useless without a token that only this repo's `main` can mint). One variable name per
environment means the same workflow step picks the right SA by the environment it runs in.

**Agent rule (policy, written into `docs/agents/project-rules.md` and the ADR):** an agent asks
Frank in the thread before dispatching `deploy`, and **never approves, rejects or bypasses a pending
deployment** — no `POST …/pending_deployments`, through any tool or `gh api`. The session acts as
`FrankERP`, so GitHub would accept such an approval and record it as Frank's (§2); the rule, not a
setting, is what keeps the approval click Frank's. What the required reviewer still buys: a
deliberate confirmation step on every deploy, a record in GitHub of who approved which run, and no
accidental deploy from a mis-chosen dispatch input. `verify` needs no approval (it changes nothing).

## 5. The workflow `.github/workflows/solver-v3-ops.yml`

- **Triggers — exactly two:**
  - `push` to `main` with `paths: ['gcf_v3/**']` (the trigger's own filter) → automatic `verify`.
  - `workflow_dispatch` with input `action` ∈ {`verify`, `deploy`} (default `verify`).
  - No `pull_request`, `pull_request_target`, `workflow_run`, `schedule` or `issue_comment`.
- **Coupling to the CI-layout guard:** `scripts/__tests__/ciLayout.test.ts` already reads every
  workflow file through `parseWorkflow` (`scripts/lib/ci-layout.mjs:133`), a fail-closed YAML-subset
  reader, and `checkRequiredCheck` runs over all of them. So the file stays inside that subset (no
  flow mappings, anchors or multi-line plain scalars; block scalars for `run:`), no job is named
  `gates`, and no job `name:` contains `${{`. The path-filter rule (`checkNoSilentSkips`) applies to
  `ci.yml` only, and `gates` does not and must not depend on this workflow.
- **Permissions:** workflow level `contents: read`. A job-level block replaces the workflow-level
  one, so each of the two jobs declares exactly `{contents: read, id-token: write}`, and both
  declare an `environment`.
- **Actions pinned by full commit SHA** (peeled tag commit, tag in a trailing comment), latest
  release at least two weeks old: `actions/checkout`, `google-github-actions/auth`,
  `google-github-actions/setup-gcloud`. `auth` runs after `checkout` (checkout would wipe its
  credentials file); `create_credentials_file` stays default (a federated config, not a key).
- **Shell discipline (the logs are public):** `bash` with `set -euo pipefail`, never `set -x`.
  Every secret-bearing value is registered with `::add-mask::` before any command could print it:
  the API key and the function URL. `CLOUDSDK_CORE_DISABLE_FILE_LOGGING=true` for every gcloud
  call. Any build value read from `describe` or the ping must match `^[0-9a-f]{40}$` before it
  reaches `git` (else red). `checkout` uses `persist-credentials: false`. Explicit
  `timeout-minutes: 25` on each job (above its 15-minute wait). The only things a run prints: function `state`, `updateTime`, the deployed build SHA,
  `ok`/`contract` of the ping, smoke `ok`/`all proven`, the Cloud Build build `status` and its
  start/finish times, and a final verdict line. Never the response body.
- **Concurrency:** dispatch runs share group `solver-v3-ops` (`cancel-in-progress: false`); push
  verifies use `solver-v3-verify-push` (`cancel-in-progress: true`: a newer `gcf_v3` merge's verify
  covers the older one, §5.1 «superseded»). A `deploy` waiting for approval holds `solver-v3-ops`,
  and GitHub keeps only one further pending run in a group (a newer one replaces it silently); the
  docs say so, and the remedy is to approve, reject or cancel the waiting run.

### 5.1 Job `verify` (environment `solver-verify`)

Runs on the push trigger, on `action == verify`, and after `deploy` (`needs: deploy`, same run).
`checkout` with `fetch-depth: 0` (it compares commits and trees). Because a job whose `needs` was
skipped is itself skipped, and a run of only skipped jobs concludes success (the fail-open edge
`scripts/lib/ci-layout.mjs:1-11` documents), its condition is explicit:
`if: ${{ !cancelled() && (needs.deploy.result == 'success' || (needs.deploy.result == 'skipped' && (github.event_name == 'push' || inputs.action == 'verify'))) }}`
— a failed `deploy` never lets `verify` run green, and a `deploy` dispatch never ends with `verify`
silently skipped. (`deploy` itself is skipped on push and on `verify` dispatches.)

1. **Expected build.**
   - After `deploy` in the same run: exactly `github.sha`.
   - On push: `github.sha` (the merge commit the trigger deploys as `$COMMIT_SHA`).
   - On a plain dispatch: none fixed — the criterion is source identity (step 4).
2. **Wait (push and post-deploy only):** poll every 30 s, at most 15 min, reading
   `gcloud functions describe … --format='value(state,serviceConfig.environmentVariables.OWT_SOLVER_V3_BUILD)'`
   until `state == ACTIVE` and the build is the expected SHA. On push only, a build that is a
   **descendant** of the expected SHA on `main` (`git merge-base --is-ancestor <expected> <build>`
   after `git fetch origin main`) ends the wait as «superseded by a newer deploy», which still
   proceeds to steps 3–4 against that build. Timeout → red, with the last state and build printed.
   (A red run emails Frank — today a failed trigger build is silent.)
3. **Ping and smoke** — first `state == ACTIVE` (checked here for every path, including a plain
   dispatch that skipped step 2); then the documented procedure (`docs/SOLVER_AND_INFRA.md:598-617`), key and URL
   masked: ping must give `ok == True`, `contract == 3`, `build ==` the describe's build (proves the
   serving revision is the described one, and that the public invoker binding still holds); smoke
   with `gcf_v3/acceptance/smoke.json` must give `ok == True` and every stage `proven`.
4. **Source identity:** the build SHA must be an ancestor of `origin/main`
   (`git merge-base --is-ancestor <build> origin/main`) and `git diff --quiet <build> origin/main --
   gcf_v3` must hold — i.e. production serves exactly `main`'s `gcf_v3/`. If not, red with
   «production is behind main's gcf_v3 — dispatch deploy». The diff counts files `.gcloudignore`
   keeps out of the artifact (`tests/`, `acceptance/`), so it can call production «behind» when the
   deployed artifact is identical; that errs toward a redundant redeploy, never toward a false
   green, and the message says so. (Today's state: the last first-parent
   `gcf_v3` change on `main` is `2e075190` (PR #160, acceptance/tests files only), after
   `d65871e2`; the rehearsal will show which build production reports.)

The ping goes to the public function URL with the `X-Api-Key` header: no invoker role is needed,
by design (`gcf_v3/cloudbuild.yaml:26-28`).

### 5.2 Job `deploy` (environment `solver-deploy`)

Runs only when `github.event_name == 'workflow_dispatch' && inputs.action == 'deploy'` (and the
provider condition forces `main`).

1. **Tip guard:** `git fetch origin main`; refuse unless `github.sha == origin/main` (a run queued
   behind a newer merge must not deploy an older tree). Same intent as the script's «fetched tip of
   main» rule.
2. **Run the existing trigger, not a new deploy definition:**
   `gcloud builds triggers run owt-solver-v3-deploy --region=global --sha="$GITHUB_SHA" --format='value(metadata.build.id)'`;
   an empty id fails the job at once, printing that a build may have started and must be checked
   in the console before any re-dispatch.
   The build is then byte-for-byte the normal production path: same `gcf_v3/cloudbuild.yaml`, same
   build account, `$COMMIT_SHA = github.sha`, and its logs (which print the function URL) stay in
   Cloud Logging, not in the public Actions log. No second copy of the deploy flags exists to drift.
3. **Wait for the build:** poll `gcloud builds describe <id> --region=global --format='value(status)'`
   every 20 s, at most 15 min; `SUCCESS` → job green; `FAILURE|INTERNAL_ERROR|TIMEOUT|CANCELLED|EXPIRED`
   → red with the status. Then `verify` runs (§5.1) with expected build `github.sha`.

If the push trigger and a dispatched deploy race on the same function, Cloud Functions refuses the
second operation; whichever build fails is reported red and the `verify` criterion (source identity)
still decides whether production is right.

## 6. Guards (vitest, `scripts/__tests__/solverOpsWorkflow.test.ts`)

Parsing with `parseWorkflow` from `scripts/lib/ci-layout.mjs` (the one workflow reader; no second
parser):

1. `on` has exactly `push` (branches `[main]`, paths `[gcf_v3/**]`) and `workflow_dispatch`.
2. Every `uses:` is `owner/repo@<40 hex>`.
3. Workflow `permissions` is exactly `{contents: read}`; the job map is exactly `{deploy, verify}`,
   each with `permissions` exactly `{contents: read, id-token: write}`; `deploy` uses
   `solver-deploy` and its `if` names `workflow_dispatch` and `deploy`; `verify` uses
   `solver-verify`, `needs: deploy`, and the exact `if:` of §5.1.
4. No `run:` contains `set -x`, `--allow-unauthenticated`, `functions deploy` or `builds submit`
   (the deploy path is the trigger only); the key variable appears only in its one assignment
   (from `gcloud secrets versions access`), its `::add-mask::`, the two header pipes (ping and
   smoke) and `unset`; checkout has `persist-credentials: false`; each job has `timeout-minutes`.
5. The setup script contains no `keys create`, has a `--apply` guard, and its provider condition
   string names the workflow file this test reads (so a renamed workflow fails here, not at a
   production token exchange).

## 7. Documentation (same delivery)

- **ADR-0067** (next free number at implementation): «The solver's cloud operations authenticate by
  Workload Identity Federation; no Google key exists», with the rejected alternatives of §9.
- **`docs/SECRETS.md`:** an entry «GitHub Actions → Google (Workload Identity, no secret)»: what
  exists (pool, provider, two SAs, environment variables), that nothing is rotated, how to revoke
  (§8), what breaks while revoked (only these two workflow actions). **And the existing
  `OWT_SOLVER_API_KEY` entry** (`docs/SECRETS.md:626-640`), which today says «Not needed in: … GitHub
  Actions»: the `verify` job now reads the value at run time through `owt-gha-verify` (never stored
  in GitHub); add it to the platform table; rotation step 5 may use a dispatched `verify`; a
  `verify` that runs mid-rotation can go red on a warm instance still holding the old key —
  expected, rerun after the redeploys.
- **`docs/SOLVER_AND_INFRA.md`** «Verifying a v3 deploy»: the Actions run is the primary path
  (automatic after every `gcf_v3` merge, or dispatch `verify`); the manual commands stay as the
  Cloud Shell fallback. «Deploy»: dispatch `deploy` (Frank approves) is the manual fallback; the
  script from Cloud Shell is the last resort if the trigger itself is broken.
- **`docs/CI.md`:** one line that `solver-v3-ops.yml` exists, is operations not a gate, and is
  not in `gates`.
- **`docs/agents/project-rules.md`** cloud-sessions section: remove solver verification and the
  fallback deploy from the «still needs the Mac» list; how a session dispatches (`actions_run_trigger`)
  and reads the result (`get_job_logs`); the agent rule of §4 (ask before `deploy`; never approve,
  reject or bypass a pending deployment). CLAUDE.md gets the one-line index form of that rule.

## 8. Rollback and revocation

- **Instant cut-off of both identities:** `gcloud iam workload-identity-pools providers disable
  owt-kb-v1 --workload-identity-pool=github-actions --location=global` (re-enable to restore). Or
  delete the provider / remove the `workloadIdentityUser` bindings.
- **Remove the feature:** a PR deleting the workflow, then the setup script's resources by hand
  (Frank's call). Nothing in the app reads any of it; the Cloud Build trigger and the Mac/Cloud
  Shell procedures are untouched throughout, so removal restores today's state exactly.
- **A bad deploy through this path** is the same as a bad trigger deploy: revert the PR on `main`
  (the trigger redeploys) or flip the engine (ADR-0056) — `docs/SOLVER_AND_INFRA.md:622-626`.

## 9. Alternatives rejected (for the ADR)

- **A service-account JSON key** as a GitHub secret or as a cloud-environment network secret
  («GCP access token (with Service Account Key)»): a long-lived bearer credential, valid from
  anywhere, until someone rotates it; it would have to be pasted somewhere by Frank; rotation is a
  chore that does not happen (two secrets already wait for rotation). WIF has nothing to leak.
- **A Cloud Build approval gate** (a dedicated manual trigger with `approvalConfig.approvalRequired`,
  approved by Frank's Google identity, with the deploy SA lacking `cloudbuild.builds.approve`): a
  real technical gate on this path, but this path deploys nothing a merge to `main` cannot already
  deploy ungated through the existing trigger (§2), so it would add a second trigger, a second
  approval surface and a console step on the phone without closing the agent's existing route. If
  Frank later wants a human-only technical gate on production solver deploys, it belongs on BOTH
  paths (e.g. approval on `owt-solver-v3-deploy` itself), as its own decision.
- **General gcloud in cloud sessions:** a session could then do anything the SA can, with no
  per-action human gate. The two canned operations are all the requirement needs.
- **Deploying with `gcloud functions deploy` from Actions** (the script's flags): a second copy of
  the deploy definition (drift), the function URL in public logs, and it needs actAs on the runtime
  account anyway. Running the existing trigger reuses the one definition.
- **`gcloud builds submit` with `gcf_v3/cloudbuild.yaml`:** same permission, but deploys whatever
  the job's workspace holds rather than the trigger's checkout of a `main` SHA.

## 10. Rehearsal and acceptance (in order; each production action asks Frank first)

1. **Before the merge,** Frank creates the two environments with their protection (§4; variables
   come in step 4). Order matters: GitHub creates a missing environment, unprotected, the moment a
   job names it, so the protected environments must exist before the workflow can run at all.
2. Release the PR (CLAUDE.md order; `preview` merge is a formality — nothing here touches Vercel,
   and `preview` cannot federate, by the provider condition).
3. Frank runs the setup script in Cloud Shell: dry run, then `--apply`, then a second dry run,
   which must report every resource present and the provider's issuer, mapping and condition equal
   to the script's (the full read-back). Claude reads the printed output (no secrets in it).
4. Frank adds the environment variables printed by the script (§4).
5. **Verify rehearsal:** Claude dispatches `verify` on `main`. Expected: green, `ACTIVE`, ping
   `True 3 <build>`, smoke `True True`, and the source-identity verdict. If production is behind
   `main`'s `gcf_v3/` (possible, §5.1 step 4), that is a finding to report, not a failure of the
   pipeline.
6. **Negative check** (no production effect): a `workflow_dispatch` of this workflow on a non-main
   branch must fail at GitHub's environment gate or at Google's token exchange — both acceptable,
   both logged. The other refusals (no environment, another workflow file, another repository)
   follow from the condition the step-3 read-back proved live.
7. **Deploy rehearsal** (a real production action: a new revision of the production solver from
   `main`'s tip, same source as today's or newer): only with Frank's go-ahead in the thread; Claude
   dispatches `deploy`, Frank approves in GitHub, the run must end green with `verify` reporting
   build = `main`'s tip.
8. **Push path:** the first `gcf_v3/**` merge after this release must show the automatic `verify`
   run green (build = that merge). Until it does, the push path is unproven and the docs say so.
9. Record the outcome in `docs/SOLVER_AND_INFRA.md` and the plan doc; update memory.

## 11. Premises to confirm at the rehearsal (fail closed if wrong)

- A function-level `roles/cloudfunctions.viewer` binding authorizes `functions describe` for gen2
  (fallback: project level, §3.4).
- `gcloud builds triggers run --sha` works for this GitHub-app trigger in region `global` and needs
  only `cloudbuild.builds.create` + actAs on the trigger account.
- The `environment` claim is present in GitHub's OIDC token for an environment job and absent
  otherwise, and `workflow_ref` has the form `FrankERP/owt-kb-v1/.github/workflows/solver-v3-ops.yml@refs/heads/main`
  (GitHub docs); the CEL `in` list operator is accepted in the attribute condition.
- The trigger's `serviceAccount` field is set (§3.5 refuses otherwise).
- `roles/cloudbuild.builds.editor` lets the deploy SA run the trigger and `describe` the build.
Each wrong premise makes the rehearsal fail with a permission error and changes nothing in
production; the fix is a reviewed change to the script or plan.
