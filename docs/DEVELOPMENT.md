# Development Guide

Everything you need to run, verify, and contribute to `owt-kb-v1`.

---

## Prerequisites

- **Node 22** (the repo pins it via `.nvmrc` and `engines.node: "22.x"`). Capacitor 8
  needs ≥22; the pin is *exact* for a different reason — see
  [ADR-0002](adr/0002-node-pinned-to-exact-22x.md). Don't loosen it to a range.
  Run `nvm use`.
- **`.env.local`** at the repo root with the required variables (see below). It is git-ignored
  and claude-ignored — never commit it.
- For the **native apps**: Xcode + CocoaPods (iOS), Android Studio + JDK 17 (Android). See
  [MOBILE.md](MOBILE.md).
- For the **solver locally** (optional): a Python env with `ortools==9.15.6755` (else set
  `OWT_SOLVER_URL` to use the deployed function).

### Required env vars (local dev minimum)
From `.env.local`: `NEXT_PUBLIC_SANITY_PROJECT_ID`, `NEXT_PUBLIC_SANITY_DATASET`,
`NEXT_PUBLIC_SANITY_API_VERSION`, `SANITY_WRITE_TOKEN`, `SANITY_API_READ_TOKEN`, `NEXTAUTH_URL`,
`NEXTAUTH_SECRET`, `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET`. Optional: `OWT_SOLVER_URL` +
`OWT_SOLVER_API_KEY` (else the solver runs as a local Python subprocess). Full catalog in
[AUTH_AND_SECURITY.md](AUTH_AND_SECURITY.md#environment-variables).

---

## Commands

| Command | What |
|---------|------|
| `npm run dev` | Dev server (http://localhost:3000). |
| `npm run build` / `npm start` | Production build / serve. |
| `npm test` | Vitest (`vitest run`). |
| `npm run test:watch` | Vitest watch. |
| `npx tsc --noEmit` | Typecheck. |
| `npm run lint` | ESLint (`next/core-web-vitals`). |

> **Prefer the app's browser-preview tooling over `npm run dev` in an agent session.** Launch via
> the preview tools (a dev-server config), then verify in-browser — never ask a human to check
> manually.

### Deployed verification (not part of the normal gate)

There is deliberately **no npm script** for the Playwright suite — it signs in as a real admin and
mutates a live deployment, so it is not something to run by reflex. It requires a fully configured
isolated environment and refuses to start otherwise.

```bash
npx playwright test
```

Read [`VERIFICATION_HARNESS.md`](VERIFICATION_HARNESS.md) **before** running it. Every operator
script under `scripts/service-readiness-*.mjs` is dry-run by default and needs `--apply` to write.

---

## The "done" gate (non-negotiable)

Before claiming any change is complete, **all three must pass**:

```bash
npx tsc --noEmit      # must exit 0
npm test              # must be all-green
npx eslint .          # must report 0 ERRORS; warnings are a deliberate backlog
```

These are the same three the CI `gates` job runs, which is what `main`'s branch protection
requires — so a change that skips them locally is caught at the PR, not merged.

Add or update a unit test whenever you touch testable pure logic (extract a helper if needed).
For anything the browser can exercise, also verify the change end-to-end in the preview, not just
via tests/typecheck. Report failures honestly with the actual output; never assert "done" without
the command output in hand.

---

## Branching & commits (project-specific — follow exactly)

- **Work on a branch; merge to `main` periodically.** Don't commit routine work straight to
  `main`. The continuous-improvement loop uses branch `improve/continuous`.
- **`main` is PROTECTED and takes no direct pushes.** It is reached through a PR whose
  `gates` check is green (`tsc`, `vitest`, `eslint` at 0 errors). Protection applies to admins
  too, so there is no silent bypass. `preview` still takes direct pushes.
- **Push order is `preview` FIRST, then `main`** — always. `main` auto-deploys to production,
  so merging the PR *is* the release. Merge into `preview`, push, VERIFY the dev alias moved
  (the target domain in the deployment's `alias` array and `meta.githubCommitSha` equal to the
  pushed commit — a green build is not this check), then open the PR.
- **A merge to `main` is a release, so it needs a FRESH CODE REVIEW of the diff first** — not
  the plan review. Fix what it finds, then re-verify the fix; the last step before a merge must
  be a verification, not a fix. See [CI.md](CI.md) and the root `CLAUDE.md`.
- **Conventional commits:** `fix(scope): …`, `feat(scope): …`, `chore(scope): …`,
  `refactor(scope): …`, `test(scope): …`. The body explains the **why** and the failure it
  prevents.
- **Never add AI/Claude attribution or a `Co-Authored-By` trailer.** (This is a hard rule.)

---

## Data scripts (Sanity writes)

One-off scripts live in [`scripts/`](../scripts/) and follow a strict safety pattern:

```bash
# Dry-run (default) — computes and logs a plan, writes nothing:
node --env-file=.env.local scripts/<name>.mjs

# Apply — only after showing the plan and getting explicit user consent:
node --env-file=.env.local scripts/<name>.mjs --apply
```

- **Production writes require explicit user consent.** Diagnosing ("what happened?") is **not**
  consent to write. Dry-run, show the plan, get a clear go-ahead, then `--apply`.
- **Never re-run a completed one-shot import with `--apply`** (they're on prod already — see the
  memory notes for which imports are done).
- To verify data against prod without a script file:
  ```bash
  node --env-file=.env.local -e "import('next-sanity').then(async ({createClient}) => { /* … */ })"
  ```

See [SOLVER_AND_INFRA.md §3](SOLVER_AND_INFRA.md#3-scripts--one-off-migrations-imports--ops) for
the full script inventory.

---

## Common tasks — where to look

| Task | Start here |
|------|-----------|
| Add/change a song field | [`sanity/schemas/post.ts`](../sanity/schemas/post.ts) + `SongFormModal` + `/api/content/posts*`. Update GROQ projections + `revalidateSongViews()`. Redeploy Studio schema. |
| Add a service/setlist feature | [`DATA_MODEL.md`](DATA_MODEL.md) (role/setlist split) + `ServicesPanel`/`SetlistEditor` + `/api/admin/{roles,setlists}`. Cover all **five seats**; call `revalidateServiceViews()`. |
| A new "who serves?" query | Reuse `assignedMemberRefsQuery()` in [`notifyTargets.ts`](../app/utils/notifyTargets.ts). |
| A new notification path | `sendPush` / `sendAssignmentEmails` / `notifyProposalSubmitted`. Gate by `notifPrefs`; keep it best-effort. |
| A new API mutation | Guard with `requireActiveManager`/`requireActiveSession`; validate input; `_key` every array-of-object write; revalidate affected ISR pages; client handler checks `res.ok`. |
| A date computation | Local-noon rendering, Mexico_City. See [ARCHITECTURE §10](ARCHITECTURE.md#11-timezone--dates). |
| The auto-scheduler | [`SOLVER_AND_INFRA.md`](SOLVER_AND_INFRA.md) + `MonthGenerator` + `/api/admin/solve`. |
| Auth/roles/impersonation | [`AUTH_AND_SECURITY.md`](AUTH_AND_SECURITY.md) + `auth.ts`. |

---

## Definition of a valuable change

A real user (member / lead / admin) is measurably better off, **or** a real defect can no longer
occur, **or** future maintainers are safer (a test, a guard, a single-source util). If a change
doesn't clear that bar, don't ship it. An empty run — nothing worth changing — is a success, not
a failure. Never manufacture churn.

---

## Continuous improvement

Run `/loop /improve` (self-paced) or `/loop 30m /improve`. The
[`/improve`](../.claude/commands/improve.md) command does one verified improvement per run with a
priority ladder, a hard verify gate, and an honesty gate. Its bottom section is a distilled
project cheat-sheet worth reading on its own.
