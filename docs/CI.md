# CI and branch protection

## Why this exists

`main` auto-deploys to production — `owt-backstage.vercel.app`, the app the
worship team actually uses. Until 2026-08-24 the only thing standing between a
red test suite and that app was a person remembering to run three commands and
report the result honestly. "Gates green" was an assertion in a chat log.

This makes it a check. The distinction the repo already draws elsewhere applies
here: a control is something that can stop you; an intention is something you
meant to do.

## The workflow

`.github/workflows/ci.yml`, job name **`gates`**.

| | |
|---|---|
| Triggers | `push` to `main` and `preview`; `pull_request` targeting `main` or `preview`; manual `workflow_dispatch` |
| Runner | `ubuntu-latest`, Node from `.nvmrc` (22), npm cache on; Python 3.12 with pip cache, matching the solver function's own `--runtime=python312` |
| Install | `npm ci` — fails on a lockfile that drifted from `package.json`, rather than silently resolving something new |
| Steps | `npx tsc --noEmit` → `npm test` (vitest) → `npx eslint .` → `python -m unittest discover -s gcf -t gcf` |
| Timeout | 15 minutes |
| Concurrency | one run per branch (or per PR); a newer push cancels the in-flight run |
| Permissions | `contents: read` only |

**`eslint` runs without `--max-warnings`.** Warnings are a deliberate backlog
(see `eslint.config.mjs`); errors are not. This matches what `CLAUDE.md` asks of
a local run — 0 errors, warnings tolerated.

### Deliberately not in CI

- **Playwright e2e** (`e2e/service-readiness/`) — needs live Sanity credentials
  and writes to the real dataset. Running it on every push would either leak
  credentials into CI or be flaky against production data.
- **`next build`** — Vercel already builds every push to both deploying
  branches. Repeating it here would roughly double CI wall time to re-prove
  something a deploy already proves, and a Vercel build failure is already
  visible.

### Secrets

**This workflow needs no secrets and no environment variables**, on any
platform. It installs from the lockfile and runs four local commands. Nothing
to rotate, nothing to configure in GitHub → Settings → Secrets. If a future step
needs one, it gets an entry in `docs/SECRETS.md` in the same change.

## Branch protection

Applied to **`main` only**, via the GitHub API:

- Required status check: **`gates`**, with `strict: true` — the branch must be
  up to date with `main` before merging, so a check cannot pass against a stale
  base.
- Required pull request before merging: **1 approving review is NOT required**
  (there is one human on this project; a self-approval adds ceremony, not
  safety). What is required is that changes arrive *through* a PR, so the check
  has a commit to run against.
- **`enforce_admins: true`** — protection applies to repository admins too.
- Force pushes and branch deletion: blocked.
- Conversation resolution: not required.

**`preview` is deliberately NOT protected.** It is the rehearsal branch and
takes direct pushes; CI still runs there, so a failure is visible fast, but it
does not block. Slowing down the dev rehearsal is the opposite of the point.

### Why admins are not exempt

An admin bypass would make this advisory again — and the agents that do most of
the work here push with the owner's credentials, so they would inherit the
bypass. The control would exist on paper and not in fact.

The escape hatch is deliberate friction rather than a silent flag:

```bash
gh api -X DELETE repos/FrankERP/owt-kb-v1/branches/main/protection
```

…do the emergency push, then re-apply with `scripts/apply-branch-protection.sh`.
Turning protection off is an explicit act that leaves a trace in the audit log;
`--no-verify` on a local hook is not.

## The release flow, after this change

```
feature branch (local gates green)
  → merge the feature branch into preview, push preview
  → VERIFY the dev alias moved (alias array + githubCommitSha)
  → open a PR from the feature branch to main, WAIT for `gates`
  → merge the PR — that IS the production release
  → VERIFY the production alias the same way
```

`preview` still goes first. The PR gate proves the code compiles and its tests
pass; it says nothing about whether the change looks right to a human on dev.
Those are different questions and the gate only answers one of them.

## Which branches Vercel builds

Only three refs spend a Vercel build: **`main`** (production), **`preview`**
(the stable dev alias) and **`verify/service-readiness`** (the isolated
verification dataset that `scripts/lib/deployment-coherence.mjs` asserts at
build time). Everything else — every `claude/*`, `docs/*`, `fix/*` working
branch — is skipped.

`vercel.json`'s `ignoreCommand` runs `scripts/vercel-ignore-build.mjs`, a thin
runner over the pure `evaluateDeployPolicy` in
`scripts/lib/deploy-branch-policy.mjs`. Vercel inverts the usual exit contract:
**0 ignores the build, 1 continues it.** The step runs *before* `npm install`,
so that module may use Node builtins only.

**A skipped ref still gets a deployment**, in state `CANCELED`, with a URL that
serves nothing. So the Function Storage saving is complete — no build output
means no function bundle and no retained GB — but canceled builds still count
against the deployments-per-day quota and can still take a concurrent build
slot. "Feature branches are free now" is the wrong summary; "feature branches
stop accumulating storage" is the right one. `git.deploymentEnabled` would
prevent the deployment from being created at all, which is the one thing it
does better; it still loses on the point below.

**Why, and why not `git.deploymentEnabled`.** Vercel's Function Storage quota
counts the function bundle of every *retained* deployment, not just the current
one. On 2026-09-17 this project hit 100% of the 10 GB Hobby allowance with 136
retained deployments at roughly 75 MB each — the embedded Sanity Studio at
`/studio` is traced into the lambda, so each one is expensive. Half of them were
never read by anybody: every fix round pushes the feature branch *and* merges to
`preview`, so Vercel built twice, and 20 deployments landed in 4.5 hours that
day. The release flow above verifies on `dev-owt-backstage` and `main`'s only
required check is the `gates` job — Vercel contributes no status check, so a
feature-branch deployment gates nothing. `git.deploymentEnabled` cannot express
this rule: as an object it is a *blacklist* (unspecified branches default to
`true`), and as `false` it disables production too.

**It fails open where it can.** A deployment that reaches the step with no
`VERCEL_GIT_COMMIT_REF` builds, and so does anything with
`VERCEL_ENV=production` whatever ref it names — a belt so that renaming the
production branch cannot silently stop production from deploying. A broken
policy module exits non-zero, which also builds. Wasting one build is
recoverable; being unable to ship during a rollback is not.

**To build a skipped ref on purpose**, the hatch the mechanism itself
guarantees is that the deployment reads `vercel.json` *from the branch being
built*: merge into `preview`, or drop `ignoreCommand` on that branch and push.
That cannot fail, because nothing outside the branch decides it.

Vercel also documents a **«Use project's Ignore Build Step»** checkbox on the
Redeploy modal, and unchecking it runs the build. Treat it as a maybe, not a
plan: it is documented for an ignore step configured in *Project Settings*, and
this repo's comes from `vercel.json`, which overrides that setting — whether the
checkbox is even rendered, let alone whether it suppresses a `vercel.json`
command, is unverified against this project's dashboard. Do not expect the
remaining hatches at all: a *plain* redeploy re-runs this step and carries the
original deployment's git metadata, so it is skipped again, and a **deploy
hook** is bound to a project/repo/branch, so its deployment carries that ref
and is skipped too. Whether a CLI `vercel deploy` attaches git metadata is
likewise unverified — do not plan an incident around any of these.

`scripts/__tests__/deployBranchPolicy.test.ts` is the guard. It asserts the
wiring as well as the policy, and it *executes the runner as a process* rather
than grepping it, because the one mistake that matters — the two exit codes
swapped — cancels every build including `main` while leaving a text-matching
test green.

**Sweeping what has accumulated:**

```bash
npx vercel remove owt-backstage --safe --scope frank-rochas-projects
```

**`--safe` is not optional.** Given a project name without it, `vercel remove`
deletes **the entire project** — `owt-backstage`, the ID that the Vercel-safety
section of `CLAUDE.md` exists to protect — rather than its deployments. With
`--safe` it keeps everything holding an alias and removes the rest. Run it from
the primary checkout, which has the `.vercel/` link; a worktree does not, and
the CLI would try to link there. The sweep is irreversible and it also destroys
the previous production deployment, so one-step rollback goes with it.

## Re-applying protection

`scripts/apply-branch-protection.sh` is idempotent and prints the resulting
settings. Run it after any emergency override, or to inspect what is currently
enforced:

```bash
bash scripts/apply-branch-protection.sh
```

It requires `gh` authenticated as a repo admin.
