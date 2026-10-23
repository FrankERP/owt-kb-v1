# ADR-0068: Vercel creates deployments only for `main`, `preview` and the verification branch

**Date:** 2026-10-23 · **Status:** Accepted

## Context

On 2026-10-22 four cloud threads shipped about ten PRs in one afternoon. Each
PR pushes its `claude/*` branch several times (the work, the fixes, the merge of
`main`), merges into `preview` and then into `main`. Vercel's count for the day,
read from `list_deployments` at 20:00 UTC: 44 `CANCELED` deployments of
`claude/*` branches, 24 `preview` builds, 18 `main` builds — 86 since midnight,
100 inside the rolling 24 h window. The Hobby plan allows **100 deployments per
day, and a canceled deployment counts** (`api-deployments-free-per-day`,
`remaining: 0`, answered to a manual `POST /v13/deployments`). From 19:50 UTC
the push of block 5 to `preview` produced no build, with no error anywhere in
GitHub, and a merge to `main` would have left production on the previous
release just as silently. Half of the slots had gone to deployments nobody
reads: the Ignored Build Step (2026-09-17, `docs/CI.md`) cancels a
feature-branch build but the deployment is created first, and creation is what
the quota counts.

## Decision

`vercel.json` carries the deploying refs twice:

```json
"git": { "deploymentEnabled": { "**": false, "main": true, "preview": true, "verify/service-readiness": true } }
```

Vercel matches with minimatch and deploys a branch that matches at least one
`true` rule, so this is a whitelist built from a blacklist: every ref off, the
three refs that own a target on. Vercel evaluates it before creating the
deployment, so a push to any other branch costs nothing — no row, no comment,
no quota. The `ignoreCommand` → `scripts/vercel-ignore-build.mjs` stays as the
fail-open belt, and `deployBranchPolicy.test.ts` asserts that
`DEPLOYING_REFS` and the `deploymentEnabled` map name the same refs.

## Rejected

- **Blacklisting `claude/**` only.** Cheaper to read, but `docs/*`, `fix/*` and
  the next naming scheme would deploy again by default, and the quota incident
  needs the rule to be "nothing but these", which the whitelist says in one
  line and the guard can assert.
- **Keeping only the Ignored Build Step.** It was chosen in 2026-09 because
  `git.deploymentEnabled` then took exact branch names and `false` disabled
  production too; Vercel has since added minimatch matching. The step solves
  the storage quota, not the per-day one, because it runs after creation.
- **Moving to the Pro plan** (6 000 deployments a day). Frank's call, and
  unnecessary once the waste is gone: a normal day is about ten deployments.
- **Removing the Ignored Build Step now that the map exists.** A deploy hook,
  a CLI `vercel deploy` or a typo in the map would then build whatever reaches
  Vercel; the step still refuses those unless they are production, and it
  fails open, so it costs nothing to keep.

## Consequences

- A `claude/*` push creates no deployment at all, so the Git integration's PR
  comment no longer shows an «Ignored» row; verification stays on
  `dev-owt-backstage` through `preview`.
- Vercel reads `vercel.json` from the commit being pushed: a branch that
  predates this change deploys (canceled) once more until it merges `main`.
- Dropping `"**": false` turns every push back into a counted deployment with
  a green suite — the guard in `deployBranchPolicy.test.ts` is what fails.
  Dropping one of the three `true` entries silently stops that target from
  deploying; the same guard fails, and the fail-open belt no longer helps
  because the deployment is never created.
- Renaming the production branch now needs two edits (`DEPLOYING_REFS` and the
  map), and the guard says so.
