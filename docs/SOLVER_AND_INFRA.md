# Solver, Scripts & Infrastructure

Covers the OR-Tools scheduling solver, its CI/CD, the `scripts/` toolbox, mobile/Capacitor, and
the test setup.

---

## 1. The scheduling solver (`gcf/`)

A Python 3.12 + **OR-Tools CP-SAT** constraint solver deployed as a **Gen-2 Google Cloud
Function** named `owt-solver`. It builds a **fair monthly worship-team roster**.

Files: [`gcf/main.py`](../gcf/main.py) (HTTP handler), [`gcf/owt_solver_v2.py`](../gcf/owt_solver_v2.py)
(the solver, ~1300 lines, the single source of truth), `requirements.txt`, `.gcloudignore`,
`test_main.py`, `test_owt_solver_v2.py`.

### What it optimizes
Per month (3–6 weeks), it assigns people to service seats:
- **Sunday** every week: `Sun.Lead` ×2, `Sun.BGV` ×3, `Sun.Choir` ×3.
- **Saturday** on selected weeks only: `Sat.Lead` ×2, `Sat.BGV` ×3.

### Input / output (JSON)
Entry point `solve_from_dict(data)`. Input keys: `weeks`, `weekends_with_saturday`,
`sunday_leads`/`saturday_leads`/`support` (mutually-exclusive name pools), `dsl_rules` (see
below), `history` (prior months, oldest first), `seed`, and solver knobs
(`solver_max_time_seconds`, `solver_num_search_workers`, `solver_total_budget_seconds`,
`discourage_consecutive`).

Output: `{ ok, schedule: {"<week>": {Sunday:{Lead[],BGV[],Choir[]}, Saturday?:{...}}},
fairness_relaxed, sun_lead_fairness_relaxed, sun_bgv_fairness_relaxed, history_runs_used,
total_counts, role_counts, unfilled_seats[] }`. On error: `{ ok: false, error }`.

Also a **CLI mode**: `echo '<json>' | python3 owt_solver_v2.py --json-mode` (stdin→stdout);
no-args runs a built-in demo roster.

### The DSL (constraint language)
Parsed by `parse_dsl_rules()`; clauses `&`-chainable. Forms include:
- `<name> !in <pattern>` — forbid a person from a role class.
- `!in week <n> <pattern>` — week-specific absence.
- `<name> <pattern> ==|>=|<= <n>` — count rule.
- `<A> !with <B> on <pattern>` — pair-exclusion (not same week/service).
- `any_of(A,B,...) on <pattern> each_week` — weekly-presence requirement.
- `<name> !consecutive on <pattern>` — hard no-back-to-back.
- `<name> fairness_exempt` / `fairness_slack <n>` (+ `on <pattern>` role-scoped variants).

Patterns: exact roles, `Sun.*`, `Sat.*`, `*.*`, `*.LeadBGV`, `*.Lead/BGV/Choir`, plus legacy
aliases. Templates like `{weeks-2}` resolve against month length. Names match case-insensitively.

### Key behaviors (these are documented invariants — see the memory notes)
- **Graceful seat degradation:** BGV, Choir, and even the **2nd** Lead seat are optional; only
  **one Lead per service is mandatory**. Unfilled seats carry tiered penalties
  (`Choir=1 < BGV < Lead`) so under tight availability the solver empties **Choir → BGV → 2nd
  Lead**, never the last Lead. Empties surface in `unfilled_seats`.
- **Two-stage solve:** Stage A minimizes only empty seats (ignoring fairness) and records
  `empty_target`; if infeasible, `diagnose_infeasibility()` names the exact week/service with no
  available lead (an **honest** diagnostic, not an opaque failure). Stage B locks
  `weighted_empty <= empty_target` and loops over tightening fairness tiers, returning the first
  feasible result; a wall-clock budget bounds total time (returns the max-fill solution rather
  than timing out).
- **Absence-aware fairness:** `compute_absence_slack()` gives fairness slack proportional to how
  many full services a person is unavailable for, so legitimately-away people aren't flagged as
  under-served. History uses weighted decay (3 recent months weighted `[10, 6, 3]`).
- **Lexicographic objective:** exponentially-separated weights encode strict priority
  (fill > lead fairness > per-role spread > **lead history priority** > consecutive-repeat
  penalty > random tie-break). For **Sun.Lead** and **Sat.Lead** only, the solver penalizes
  assigning people with higher weighted lead history, so lead-eligible members who haven't
  led recently are preferred before frequent leads. **Sun.Lead** also adds that weighted history
  as slack on the current-month lead spread guard. BGV/Choir still use per-role spread only.

### Invocation from Next.js
`POST /api/admin/solve` (admin/super-admin, `maxDuration=60`):
- **Production:** `fetch(OWT_SOLVER_URL)` with header `X-Api-Key: OWT_SOLVER_API_KEY`; treats
  HTTP 422 as a valid business response.
- **Local dev:** if `OWT_SOLVER_URL` is unset, spawns `gcf/owt_solver_v2.py --json-mode`
  (python from `OWT_SOLVER_PYTHON`, default a local miniforge `owt-roles` env), SIGKILL after
  120s.

### HTTP handler ([`gcf/main.py`](../gcf/main.py))
`functions_framework.http`-decorated `solve(request)`. Handles CORS `OPTIONS`, rejects non-POST
(405). **Fails closed on auth:** `OWT_SOLVER_API_KEY` unset → 503; wrong/missing `X-Api-Key` →
401 (the function is publicly invokable, so the shared secret is the only barrier). Wraps
`solve_from_dict` — unexpected exception → 500; `ok:false` → 422; `ok:true` → 200.

### requirements
`ortools==9.15.6755` (**hard-pinned** for parity with the local conda env — bump deliberately and
re-pin locally), `functions-framework>=3.0,<4`. Entry point `solve`.

---

## 2. CI/CD ([`cloudbuild.yaml`](../cloudbuild.yaml))

A Cloud Build **trigger** (GitHub, branch `main`, file filter `gcf/**`) runs on every push
touching the solver. One step: `gcloud functions deploy owt-solver --gen2 --region=us-central1
--runtime=python312 --source=gcf --entry-point=solve --trigger-http --memory=512MB
--timeout=120s`, with `--remove-env-vars=OWT_SOLVER_API_KEY` then
`--set-secrets=OWT_SOLVER_API_KEY=owt-solver-api-key:latest` (key from **Secret Manager**;
Cloud Run rejects a name that's both a plain env var and a secret). It intentionally does **not**
pass `--allow-unauthenticated` (public `run.invoker` is already set and persists; the build SA
can't `setIamPolicy`; auth is enforced at the app layer via `X-Api-Key`).

Manual fallback: `bash scripts/deploy-solver-gcf.sh` (prints the function URL + the Vercel env
vars to set).

---

## 3. `scripts/` — one-off migrations, imports & ops

**Convention:** most `.mjs` scripts share a **dry-run guard** —
`const APPLY = process.argv.includes("--apply")`. They compute and log a plan by default and only
write to Sanity with `--apply`. Run as `node --env-file=.env.local scripts/<name>.mjs [--apply]`.
**Production writes need explicit user consent — dry-run first; never re-run a completed one-shot
import with `--apply`.**

> **Scripts may no longer write the protected service types on the honour system.** A script that
> touches `sunday_role` / `saturday_role` / `special_role` / `featuredSongs` / `saturdarSongs` /
> `setlistProposal` / `roleTargetLock` / `roleCreationReceipt` either uses the shared guarded
> invariant or **fails before any write** — and it must be listed by exact `file + operation` in the
> protected-read audit or `npm test` fails. See the two subsections below.

### Catalog import & processing
- `catalog/xlsx-to-json.py` — Python (openpyxl); `oasis-songs.xlsx` → `oasis-songs.json`. Reusable.
- `import-catalog.mjs` — main song importer; reconciles against existing posts via
  `lib/catalog-reconcile.mjs`; writes `import-plan.json`. Reusable.
- `backfill-song-fields.mjs` — fills empty `key`/`bpm`/`timeSig` only (never overwrites). Reusable.
- `fix-song-bodies.mjs`, `fix-section-colons.mjs` — one-off body/heading cleanups.

### Migrations (one-off)
- `migrate-authors.mjs` — free-text authors → canonical `author` references (`lib/author-canon.mjs`).
- `migrate-proposal-messages.mjs` — **RETIRED, see the table below.** It folded
  `setlistProposal.lead_notes` / `.admin_notes` into the append-only `messages[]` thread
  (Release 2, Child A). **STATE: APPLIED 2026-08-26** — 8 documents, 10 messages, 0 failed
  patches, at Child A Phase D step 4 with explicit consent.

  **It can no longer run at all, not even a dry run.** `assertRetiredWriter()` is its first
  statement, before any client is constructed. Earlier revisions of this entry described a
  re-run as "safe but pointless" and told an operator to "re-run the DRY-RUN before any
  repair" — that procedure is not executable and following it wastes the time of whoever is
  mid-incident. **The read-only check is `reconcile-proposal-messages.mjs`**, which reports a
  mismatch and exits 1; a repair is a consented top-up under a distinct `_key`, never a re-run.

  The pure mapping survives in `lib/proposalMessages.mjs` (unit-tested in
  `scripts/__tests__/migrateProposalMessages.test.ts`) as the record of what was applied.

### ⛔ Retired writers — seven one-shots that now **fail closed**

**Count kept honest by hand, and it has drifted twice:** it said "five" while the registry held
six, and then the TABLE held five while the heading correctly said seven — the heading was fixed
and the rows were not. No test pins prose, so check both when you touch either. `RETIRED_WRITER_NAMES` in
[`lib/sr-retired-writer.mjs`](../scripts/lib/sr-retired-writer.mjs) is the source of truth;
if this number disagrees with it, the registry is right.

These seven already ran against production and **cannot** adopt the guarded mutation invariant
(target lock + creation receipt + exact observed revision + dependency policy). Documentation-only
retirement would have been insufficient, so each one calls `assertRetiredWriter()` from
[`lib/sr-retired-writer.mjs`](../scripts/lib/sr-retired-writer.mjs) as its **first statement** —
before any client is constructed and before any mutation is assembled — and exits non-zero. There is
no flag, argument, or environment that lets one reach the Content Lake again: the gate reuses
`evaluateGuards()` (so the production project `ebb8vcnk` and dataset `production` are hard refusals
on either axis, in dry-run too) and *always* adds a `retired_writer` hard failure on top. The file
bodies are kept only as the historical record of what was applied.

| Retired script | What it used to do | Use instead |
|----------------|--------------------|-------------|
| `import-schedule.ts` | create-if-missing + patch Lead/BGVs/Chorus on role docs from a solver history JSON | `POST /api/admin/roles`, `PATCH /api/admin/roles/[id]` |
| `import-setlist-history.mjs` | create missing `featuredSongs`/`saturdarSongs` history from a WhatsApp export | `PUT /api/admin/setlists` |
| `cleanup-superseded-proposals.mjs` | delete non-approved proposals where an approved one exists | `service-readiness-cleanup.mjs --action resolve-proposal --mode remove` |
| `migrate-shared-proposals.mjs` | backfill `contributors` and delete collision losers | applied 2026-07-03; residual collisions → `--action resolve-proposal` |
| `unpublish-july-2026.mjs` | patch `published:false` on every July 2026 service | `POST /api/admin/roles/publish` |
| `migrate-proposal-messages.mjs` | fold `lead_notes`/`admin_notes` into `messages[]` under two deterministic `_key`s | applied 2026-08-26; the fold is done. Read-only check: `reconcile-proposal-messages.mjs` |
| `normalize-instrument-names.mjs` | rewrite free-text instrument names on role docs to the canonical set | `PATCH /api/admin/roles/[id]` |

Unit tests: `lib/__tests__/sr-retired-writer.test.mjs` proves the refusal is unconditional **and**
statically checks each real file — the gate call must precede every write marker (`createClient(`,
`api.sanity.io`, `.transaction(`, `.commit(`, `.patch(`, `.delete(`, `.create(`, `fetch(`).

> Gitignored local developer tooling (e.g. `sa-roster.mjs`) is outside this committed-writer scope —
> the operator guards or retires it by hand, and it is never a protected-read-audit entry.

### Guarded Service Readiness operator tooling

Unlike the retired one-shots, these are **meant** to be run by hand — but only against the isolated
verification dataset. Guards live in [`lib/sr-verification.mjs`](../scripts/lib/sr-verification.mjs)
and refuse **in dry-run too**, on either axis: `forbidden_project` (`ebb8vcnk`), `wrong_project`,
`forbidden_dataset` (`production`), `wrong_dataset`, `marker_mismatch`, `unknown_flag` are hard
failures; `missing_project_id` / `missing_dataset` / `missing_marker` / `missing_token` /
`missing_admin_password_hash` block `--apply`. No client is constructed at all unless
`willContactRemote` is true (i.e. `--apply` and nothing refused). Env: `SR_VERIFY_SANITY_PROJECT_ID`,
`SR_VERIFY_SANITY_DATASET`, `SERVICE_READINESS_VERIFICATION_MARKER`, `SR_VERIFY_SANITY_TOKEN`
(+ `SR_VERIFY_ADMIN_PASSWORD_HASH`, `SR_VERIFY_RUN_ID`, `SR_VERIFY_CANDIDATE_SHA`,
`SR_VERIFY_DEPLOYMENT_ID` for the seed). Secrets are never printed — presence booleans only.

- **`service-readiness-cleanup.mjs`** — one guarded, atomic cleanup per invocation. **Dry-run by
  default;** `--apply` needs an exact action-specific confirmation phrase
  (`<action>[#<mode>]:<id>@<rev>`), takes a timestamped backup outside tracked files
  (`.sr-verification-backups/<ISO>-cleanup-<kind>.json`, gitignored), commits one revision-asserted
  transaction, then **re-queries and verifies** the outcome. It gathers its own dataset evidence with
  its own GROQ — an `--evidence` intent file is never trusted as proof. Actions:
  `discard-raw-draft`, `select-canonical-duplicate` (never implicit merging),
  `repair-malformed-record` (closed field allowlist), `remove-malformed-role` (**only** after the same
  dependency inventory/refusal policy the routes use), `remove-orphan-setlist` (needs proof no
  canonical owner exists), `resolve-proposal` (`--mode retarget|normalize|remove`, non-approved only),
  `reconcile-approved-receipt` (never deletes approved history), `vacate-orphan-lock` (needs
  published/raw proof the owner is gone), `cleanup-creation-receipt` (`--mode inspect|remove`, by
  exact id+rev, only after proving no live role carries it — **committed and retired receipts are
  durable idempotency tombstones and are never deleted by ordinary cleanup**). Refusals are named
  codes, e.g. `revision_mismatch`, `lock_owner_alive`, `receipt_carried_by_live_role`,
  `approval_via_cleanup_forbidden`, `destination_proposal_exists`, `role_has_dependencies`.
  Multi-target cleanup is separate invocations, never one batch.
- **`service-readiness-restore.mjs`** — revision-aware restore from a backup file. Dry-run prints the
  confirmation phrase (`restore:<count>:<digest>`). It **refuses the whole restore** — never partially,
  never latest-wins — on `later_write_conflict` (the document was written after the backup),
  `restore_type_mismatch`, `restore_type_not_protected`, `empty_backup`, or a confirmation mismatch.
  It never force-overwrites.
- **`service-readiness-feasibility.mjs`** — the A3 isolated-dataset transaction-shape harness.
- **`service-readiness-verification-seed.mjs` / `-reset.mjs`** — fixture seed/teardown, dry-run by
  default. Reset deletes from a **closed allowlist** of `srv.`-prefixed fixture ids (infrastructure
  docs excluded) — never a discovery query, never `*[_type == …]`.

Both of the first two are listed by exact `file + operation` in the protected-read audit's
`OPERATOR_TOOLING_ALLOWLIST` so they are visible to it rather than invisible.
**Production `--apply` always requires separate explicit user consent.**

### History / backfill
- `import-setlist-history.mjs`, `import-schedule.ts` — **retired**, see above.

### Accounts / auth
- `set-password.ts` (tsx) — `MEMBER_ID=… PASSWORD=… npx tsx scripts/set-password.ts` — bcrypt a
  member's password (bootstrap first admin / reset).
- `create-service-account.mjs`, `sa-roster.mjs` — a credentials service account for UX-review
  automation.

### Diagnostics / UX screenshots (Playwright)
- `ux-shots*.mjs`, `ux-verify.mjs`, `maya-shots.mjs`, `skeptic-desktop.mjs` — drive the local app
  as the service account, capture screenshots to `.ux-shots/`. Creds in gitignored
  `scripts/.sa-creds.json`.

### Ops shell
- `deploy-solver-gcf.sh` (manual solver deploy), `serve-all.sh` (boots redesign variants on
  ports 3000–3006 from sibling worktrees).

### `scripts/lib/` (unit-tested shared modules)
`catalog-reconcile.mjs`, `author-canon.mjs`, `setlist-match.mjs`, `whatsapp-setlists.mjs`,
`proposalRank.mjs` (note: `advancementRank` ranks `approved` **highest** here — the inverse of the
`/me` surfacing rank; don't merge them). Service Readiness: `sr-verification.mjs` (pure guard
evaluation, backup naming, fixture verifiers), `sr-verification-runtime.mjs` (the only module that
constructs a client, acquires the dataset lease, and writes backups), `sr-cleanup.mjs` (pure cleanup
plan/refusal decisions), `sr-feasibility-checks.mjs`, `sr-retired-writer.mjs` (the retirement gate).
Tests in `scripts/lib/__tests__/`; CLI-level tests in `scripts/__tests__/`.

---

## 4. Mobile / native (Capacitor 8)

Strategy: **wrap the existing Next.js app** (not a React Native rewrite). Full runbook:
[MOBILE.md](MOBILE.md).

- **`capacitor.config.ts`** — `appId: "com.owtBackstage.app"` (permanent once published),
  `appName: "OWT Backstage"`, `webDir: "mobile/fallback"`. **Phase 1** (current): online-only
  wrap loading `server.url = "https://owt-backstage.vercel.app"`.
- **`mobile/fallback/index.html`** — minimal offline shell shown when the remote app is
  unreachable.
- **Plugins:** `@capacitor/core`, `@capacitor/text-zoom` (drives `textZoom.ts`),
  `@capgo/capacitor-social-login` (native Google SSO). `native.ts` bridges them.
- **`ios/` and `android/`** — generated by `npx cap add` and **committed** (reproducible signing).
  Build artifacts are gitignored; regenerate with `npx cap sync`. **Don't hand-edit generated
  native code** — change source + `npx cap sync`.
- **Phases:** 1 = online wrap (iOS verified on-device; Android pending, Apple Dev enrollment in
  progress). 2 = offline bundled SPA + bearer-token auth. 3 = push/camera/calendar.

---

## 5. PWA & assets (`public/`)

- **`manifest.webmanifest`** — "Backstage," Spanish, `display: standalone`, theme `#010b17`,
  icons 192/512 (any + maskable).
- **`icons/`** — 32/192/512 + maskable + apple-touch. Brand: `LogoOasis.png`,
  `backstage_*.png`.
- **No service worker yet** (offline is Phase 2).

---

## 6. Testing

- **JS/TS — Vitest** ([vitest.config.ts](../vitest.config.ts)): `environment: "node"`,
  includes `app/**/*.test.{ts,tsx,mjs}` + `scripts/**/*.test.{ts,mjs}`, `passWithNoTests: true`,
  `@` → repo root. Run `npm test` (`vitest run`) or `npm run test:watch`. A DOM-needing `.test.tsx`
  sets up jsdom itself.
- **Python — stdlib unittest** (in `gcf/`, no extra deps):
  - `test_owt_solver_v2.py` — degradation order, absence slack, honest diagnostics
    (`python3 -m unittest test_owt_solver_v2 -v`).
  - `test_main.py` — HTTP handler auth (fail-closed 503/401), 405, valid 200.

  These are excluded from the deployed function via `.gcloudignore`.

---

## 7. Feature history (`docs/superpowers/`)

Every substantial subsystem has a dated **spec** (`specs/*-design.md`) and **plan**
(`plans/*.md`) — Google SSO, push, web-push, text-size a11y, dual reference links, multi-author
references, WhatsApp setlist history, draft/publish services, participation sidebar, preview
toggle + assignment emails, email notification preferences, shared setlist proposals, past-set
browsing. These are the authoritative "why" for each feature; consult them before reworking one.
