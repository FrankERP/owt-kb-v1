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
| Runner | `ubuntu-latest`, Node from `.nvmrc` (22), npm cache on |
| Install | `npm ci` — fails on a lockfile that drifted from `package.json`, rather than silently resolving something new |
| Steps | `npx tsc --noEmit` → `npm test` (vitest) → `npx eslint .` |
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
platform. It installs from the lockfile and runs three local commands. Nothing
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

## Re-applying protection

`scripts/apply-branch-protection.sh` is idempotent and prints the resulting
settings. Run it after any emergency override, or to inspect what is currently
enforced:

```bash
bash scripts/apply-branch-protection.sh
```

It requires `gh` authenticated as a repo admin.
