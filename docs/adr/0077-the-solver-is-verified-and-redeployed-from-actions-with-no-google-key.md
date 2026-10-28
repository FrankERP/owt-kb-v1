# ADR-0077: The solver is verified and re-deployed from GitHub Actions with no Google key

**Date:** 2026-10-22 · **Status:** Accepted

> **Numbering.** Renumbered 0072 → 0073 on `preview` 2026-10-24: admin parity phase 2's ADR-0072
> reaches `main` first (ADR numbers follow the order records reach `main`).
> Renumbered 0073 → 0074 on `preview` 2026-10-27: admin parity phase 3's ADR-0073 (a service's
> messages from the chat) reaches `main` first.
> Renumbered 0074 → 0076 on `preview` 2026-10-28: Fluid compute reached `main` as ADR-0074 and the
> multi-ministry decision as ADR-0075 first.

## Context

Frank wants no work to depend on his laptop being open (2026-10-21). For the production solver
function `owt-solver-v3`, the normal deploy was already in the cloud (Cloud Build trigger
`owt-solver-v3-deploy` on every `gcf_v3/**` merge), but two things were not:

- **verifying a deploy** needs the solver's API key (`owt-solver-api-key`) for the ping and the
  smoke solve;
- **the manual fallback deploy** was `scripts/deploy-solver-v3-gcf.sh` on the Mac.

Both need *some* Google identity outside the Mac. Cloud sessions act on GitHub as `FrankERP` with
admin rights, and `main` needs a green `gates` but no approving review (`docs/CI.md`), so an agent
can already put solver code into production by merging a `gcf_v3/**` change: the trigger deploys
it.

## Decision

`.github/workflows/solver-v3-ops.yml` does both jobs with **Workload Identity Federation** — a
short-lived token per job, and no service-account key anywhere:

- `verify` runs after every `gcf_v3/**` push to `main` and on demand. It checks that the function
  is `ACTIVE`, the ping answers `True 3 <build>`, the smoke solve proves every stage, and the
  deployed build's `gcf_v3/` equals `main`'s. It runs as `owt-gha-verify` (Cloud Functions Viewer
  on the function, Secret Accessor on the one secret).
- `deploy` runs on demand only, in the `solver-deploy` environment where Frank is the required
  reviewer. It **re-runs the existing trigger** at `main`'s tip (`gcloud builds triggers run
  --sha`), then `verify` runs. It runs as `owt-gha-deploy` (Cloud Build Editor, plus Service
  Account User on the trigger's account).
- The provider's attribute condition federates only repository id 837387462, owner id 68241914,
  `refs/heads/main`, the two environments, and this workflow file (`workflow_ref`). The bindings
  key on `repository_id/environment`, and the pool holds no other provider.
- Setup is `scripts/gcp/setup-solver-v3-gha-wif.sh`, run by Frank in Cloud Shell. It is a dry run
  by default and idempotent. It compares an existing provider with its own values and stops on a
  difference.
- **Frank's approval of a deploy is a written rule, not a technical lock** (his choice,
  2026-10-22). Agents ask before dispatching `deploy`. They never approve, reject or bypass a
  pending deployment, and never change the environments or the WIF setup without his OK
  (CLAUDE.md; `docs/agents/project-rules.md`).
- Plan and review: `docs/superpowers/plans/2026-10-22-solver-v3-gha-wif-ops.md` and its review log.
  Guard: `scripts/__tests__/solverOpsWorkflow.test.ts`.

## Rejected

- **A service-account JSON key**, whether as a GitHub secret or as a cloud-environment network
  secret («GCP access token (with Service Account Key)»):
  - it is a bearer credential valid from anywhere until someone rotates it;
  - Frank would have to paste it somewhere;
  - rotation does not happen in practice: two secrets were already waiting for theirs
    (`docs/SECRETS.md`).

  Federation leaves nothing to leak or rotate.
- **General `gcloud` in cloud sessions.** A session could then do anything the account can, at any
  time, with no human step. The two fixed operations are all the requirement needs.
- **`gcloud functions deploy` from Actions** (the script's flags):
  - it is a second copy of the deploy definition, which can drift from `gcf_v3/cloudbuild.yaml`;
  - its output prints the function URL into a public log;
  - it needs the same editor-equivalent rights anyway.

  Running the trigger reuses the one definition, and the build logs stay in Cloud Logging.
- **`gcloud builds submit` with `gcf_v3/cloudbuild.yaml`.** It needs the same permission, but
  deploys whatever the job's workspace holds rather than a `main` SHA checked out by the trigger.
- **A Cloud Build approval that only Frank's Google identity can pass**, on a dedicated manual
  trigger. That would be a real technical gate on this path, but this path deploys nothing a merge
  cannot already deploy without any gate through the existing trigger. So it would add a second
  trigger and a console step on the phone without closing the route agents already have. If Frank
  ever wants a human-only technical gate on solver deploys, it belongs on both paths (for example,
  approval on `owt-solver-v3-deploy` itself), as its own decision.

## Consequences

- **What the deploy identity can do.** `owt-gha-deploy` is effectively project-editor-equivalent:
  a build can run any step as the compute account, which is how the trigger deploys today. What
  limits it technically is the provider condition: only code on `main` that passed `gates`, in
  this file. Frank's approval click limits it by policy only.
- **The API key now reaches Actions** at run time. It is masked, held in one variable, and never
  stored in GitHub. The logs are public, so the guard pins the masking and bans `set -x` and
  writes to `$GITHUB_ENV`/`$GITHUB_OUTPUT`.
- **A red `verify` emails Frank.** Before this, a failed trigger build was silent.
- **Revoking access** is one command: disable the provider (`docs/SECRETS.md` «GitHub Actions →
  Google»). The trigger and the Cloud Shell procedures are untouched, so removing all of this
  restores the previous state exactly.
- **Renaming the repository, the workflow file or an environment** breaks federation, which fails
  closed, until the setup script is updated and re-run with `--apply --update-provider`.
- **Not covered:** v2's function (`owt-solver`) and secret rotations stay manual in Cloud Shell.
- **Shipped grant for the verify account:** function-level Cloud Functions Viewer. If the
  rehearsal shows a project-level grant is needed instead, this line records the switch, and the
  superseded grant is removed by hand.
