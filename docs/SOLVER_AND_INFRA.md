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
`discourage_consecutive`), and optionally `pinned` — seats already on the board that the solver
must keep, `[{week, role, person}]`, at most 100 (see *Pinned assignments* below).

Output: `{ ok, schedule: {"<week>": {Sunday:{Lead[],BGV[],Choir[]}, Saturday?:{...}}},
fairness_relaxed, sun_lead_fairness_relaxed, sun_bgv_fairness_relaxed,
objective_skipped, history_runs_used,
total_counts, role_counts, unfilled_seats[], pinned_honored, pin_violations[],
violation_ceiling_proven? }`. On error: `{ ok: false, error }`.

- **`pinned_honored`** — how many pins the returned schedule actually holds, derived from the
  solved assignment and never echoed. Emitted on **every** response, `0` without pins: its
  presence is how the client (and the deploy check below) tells this solver from one that
  silently ignores `pinned`. It can never come back short — a pin is a hard `== 1` — so the
  signal is the field's presence, not its value.
- **`pin_violations`** — the rules set aside to honour the pins, one entry per relaxed
  instance, in a normative grammar the client parses: `<person>: <source>` (count rule),
  `W<n>: <source>` (weekly presence), `W<n> <Sun|Sat>: <source>` (pair), `W<n>-<n+1> <person>:
  <source>` (consecutive), `builtin:mandatory_lead:W<n>:<Sun|Sat>`, `builtin:sat_anchor:W<n>`.
  `<person>` comes from the parsed rule, because `source` is the `&`-split clause and loses the
  name on every clause after the first. `[]` without pins.
- **`violation_ceiling_proven`** — `true` iff the violation-only solve proved its minimum, i.e.
  the relaxations are exactly as many as the pins force. **Absent** on a pinless request.

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
  (fill > lead fairness > per-role spread > sun-lead rotation > consecutive-repeat
  penalty > random tie-break). **Each tier's weight is computed against that tier's own
  maximum**, not against a single month-wide bound — the ladder is a product over eight
  tiers, so a uniform over-estimate is exponential in it and the objective's upper bound
  crossed CP-SAT's integer-objective ceiling (INT64_MAX / 2) on ordinary months. Months
  whose history still pushes it over run without the objective and say so with
  `objective_skipped: true` — see ADR-0038 for that trade-off. Lead rotation uses seeded random weights on Sun.Lead
  assignments (monthly and per-week terms). The planner UI surfaces, separately for
  Sunday and Saturday, which lead-pool members did not hold that lead role in the
  calendar month before the month being planned (`LeadPoolHistoryPanel`); that is
  visibility only and does not change the objective. The pool ids are filtered by
  live «Tipo» first, the same rule `buildSolveRequest` applies, so a stale tick
  cannot present an unschedulable member as an available lead (ADR-0029).
- **The history's source is moving, in stages (MCP P2, ADR-0041) — dormant today.** The
  browser is still the source: `MonthGenerator` reads and writes `owt_solver_history_v2` in
  `localStorage`, per browser profile, exactly as before. A server-side derivation over
  canonical `sunday_role`/`saturday_role` documents now exists in parallel
  (`app/utils/solverHistory.ts`'s `deriveSolverHistory`, loaded by
  `app/utils/solverHistoryRead.ts`'s `loadSolverHistory` and exposed at
  `GET /api/admin/solver-history` — see [API_REFERENCE.md](API_REFERENCE.md#solver)) and
  produces the same entry shape, but it is **not yet used**: the deployment-wide constant
  `SOLVER_HISTORY_SOURCE` (`app/components/admin/solverHistorySource.ts`) is `"local"`, so
  every planner path is unchanged. The cutover to `"derived"` is Frank's decision, made after
  reading the R11 diff report (below); until then, [DATA_MODEL.md](DATA_MODEL.md)'s
  per-browser note still holds. See
  [ADR-0041](adr/0041-the-fairness-history-is-derived-from-stored-services.md) and
  `docs/superpowers/specs/2026-09-23-solver-history-derivation-design.md`.

### Pinned assignments (`pinned`)
Spec `docs/superpowers/specs/2026-09-15-solver-pinned-assignments-design.md`, decision record
ADR-0041. The client that sends pins («Solo llenar vacíos») is a separate delivery.

- **A pin is a fixed variable, not a removed seat:** `sum(x[P, slots of (R, W)]) == 1`. Every
  mechanism that counts people or iterates slots — totals, role counts, DSL caps, the Saturday
  anchor, presence, `filled`, occupancy, the consecutive penalty, the response view — sees it
  with no restated offsets.
- **Four enabling changes.** Candidacy is granted only in the pin's own (role, week), appended
  after the shuffled eligibles, so a pinned person in no pool (or with a cleared Tipo) gains
  nothing else. Rows grow to `max(default, pins)` and never shrink, keeping the `Sun.BGV`/
  `Sun.Choir` interleave. Pinned-only names join `all_people` **after** `pools` is built and stay
  out of `strict`, `relaxed` and the collapse rebuild. Each person gets slack equal to their pin
  count on the three **hard** spreads — the global one, and for `Sun.Lead`/`Sun.BGV` their pins
  in the Sunday **service** (not the role, which collapsed the month for lead-pool members).
- **Rules go soft under pins, per instance.** With any pin, the six families a pin can
  contradict — mandatory lead, Saturday anchor, weekly presence, pair, consecutive, DSL count —
  each get one boolean per instance (per week, per service where the rule has one; one per rule
  for counts, which are month totals). A week exclusion is not relaxed but scoped: it is skipped
  on the pinned row only. `!in <pattern>` and pool membership need nothing — the pin grants
  candidacy.
- **Solve 0 fixes the count first.** Order: solve 0 minimises the violation count alone, with
  nothing inherited → Stage A minimises `(max_weighted_empty + 1)·n_viol + weighted_empty` →
  the Stage B ladder. **Every stage after solve 0 carries `n_viol <= violation_target` as a
  constraint**, the `stage_a` fall-through included, so no stage buys fill or fairness with one
  more broken rule — ADR-0010's requirement holds as "the number of rules set aside is never
  increased for fairness". Which instance gives among equal-size sets is still Stage B's choice.
  Stage A's own count also caps Stage B whenever it is lower — which covers solve 0 finding
  nothing in time (then Stage A runs uncapped, but no Stage B pass can exceed what Stage A
  found) and a slack `FEASIBLE` solve 0. `violation_ceiling_proven` reports solve 0 alone.
  Stage A starts from solve 0's month as a search hint, so a board with dozens of pinned people
  in one row returns a month where it used to time out into the mandatory-lead diagnostic. It is
  a hint, not a guarantee: Stage A still needs its presolve (~0.2 s on a MacBook for 64 such pins),
  so a slow enough container can still time out, and that path still reports "infeasible".
  Measured 2026-09-25 (MacBook, 1 worker, 5 s cap — a laptop number): solve 0 was `OPTIMAL` on
  every §7 case × 3 seeds, including a 52-pin full board and 30 pins on 12 people, in 4–6 ms.
- **The report is read from the assignment, never from the booleans**, which are
  one-directional and may sit at 1 on a constraint that holds. Measured: with the ceiling
  removed, Stage B drops the Saturday anchor in weeks nobody pinned — and the report names it.
- **Without pins none of this is built**, `n_viol` included, and no solve 0 runs. A pinless
  request builds a byte-identical Stage A model to the pre-pin solver, which
  `gcf/test_inertness.py` freezes (see `docs/CI.md`). Once any pin exists, the mandatory lead is
  soft for the whole month: a lead shortfall from absences alone comes back as the
  `builtin:mandatory_lead` marker and a «Sin cubrir» seat instead of `ok: false`.
- **Refusals** (all `ValueError` → `ok: false`): a malformed entry, more than 100 entries (never
  truncated), an unknown role, a week outside the month, a `Sat.*` pin on a week with no
  Saturday, two different pins for one person in one service, and a pinned-only name that differs
  from another name only in capitalisation or surrounding spaces (a misspelling: it would sit
  beside the real person and could take their DSL rules). A pin on a pool member's exact name is
  always accepted — Studio does not trim `member_name`, so that can include a trailing space.
  Exact duplicates collapse.
- **A consecutive-rule quirk for whoever writes the copy:** pinning someone into both services
  of one weekend under `!consecutive on *.Lead` reports the W(n-1)–W(n) and W(n)–W(n+1) pairs,
  because each pair sums both weeks' services and the rule already forbade a same-weekend double.
- **What it does not promise:** nothing bounds the pinned person's own total, and an un-pinned
  `fairness_exempt` member is outside every bound (a single pin can cost them a service). The
  three `*_fairness_relaxed` flags keep their literal meaning — "the ladder loosened a limit" —
  over slack-adjusted counts. A timed-out pinned month looks like a fairness-free month.

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

### Instrument seats are filled locally, not by the solver
`app/components/admin/instrumentFill.ts` runs inside «Generar mes» on every exit (like the
specials filler, `localFill.ts`). It seats only EMPTY `instrumento:` cells on weekend columns,
through `rankCandidates` per placement (Tipo, availability, same-category block), among
members who DECLARE the instrument (`teamMembers.instruments`). Ordering: fewest instrument
seats this month **per member, all instruments** → did not play the previous weekend
service → name. Guarantee: per-member total balance in the month; for instruments whose
players declare only that instrument this is the «difference ≤ 1» rule. A two-instrument
member is balanced as a person, not per instrument (confirmed 2026-09-09). Its own previous
`origin: "auto"` picks are vacated once, before counting; manual picks are never touched.
Rows nobody declares are skipped with no marker; custom planner rows are outside the
vocabulary and never filled. Rows whose stored label doesn't match the current seat vocabulary
(`instrumentSeatDef(label).id !== row.id` — legacy-spelled rows) are likewise never filled and
produce no marker. With `fillColumns` set (stored-mode group fill, `groupFill.ts`, spec
`2026-09-22-camp-group-fill-design.md`) it fills exactly the given columns — specials
included — in that order, and vacates nothing: the "vacate this run's own previous auto picks"
step above only runs in the default (no `fillColumns`) weekend path. Spec: `docs/superpowers/specs/2026-09-09-member-instruments-auto-fill-design.md`.

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

### Verifying a Cloud Function deploy
The Vercel rule (alias + `githubCommitSha`) has no analogue here, so the check is:

1. `gcloud functions describe owt-solver --gen2 --region=us-central1 --format='value(updateTime)'`
   — the active revision's `updateTime` must be after the merge. This is the analogue of reading
   the alias, not the build.
2. One **pinless** smoke request, asserting `ok: true` and the **presence** of `pinned_honored`.
   Presence is the discriminator: an old revision answers the same request successfully and
   without the field. It needs the API key, which is Frank's to supply — never paste its value
   into a doc, a chat or a command history. Shape (the key read from Secret Manager into the
   shell, with gcloud's file logging off so the value is not written to `~/.config/gcloud/logs`,
   and handed to curl on stdin with `-H @-` so it never appears in `ps`):

   ```bash
   URL=$(gcloud functions describe owt-solver --gen2 --region=us-central1 --format='value(serviceConfig.uri)')
   KEY=$(CLOUDSDK_CORE_DISABLE_FILE_LOGGING=true gcloud secrets versions access latest --secret=owt-solver-api-key)
   printf 'X-Api-Key: %s\n' "$KEY" | curl -s -X POST "$URL" -H @- -H "Content-Type: application/json" \
     -d '{"weeks":4,"weekends_with_saturday":[2,4],"sunday_leads":["A","B","C"],"saturday_leads":[],"support":["D","E","F","G"],"dsl_rules":[],"history":[],"seed":1}' \
     | python3 -c 'import json,sys; r=json.load(sys.stdin); print("ok", r["ok"], "pinned_honored" in r)'
   unset KEY
   ```

Never a bare HTTP reachability check, never a grep loop over build logs.

**The one revert trigger** is the smoke request failing or coming back without
`pinned_honored` — the deploy did not land; re-deploy the previous revision. A behavioural
problem found later is **not** a function revert: revert the app half (it stops sending
`pinned`, and a pinless request builds today's model). Reverting the function while a pinned
app is live makes every Auto fail the handshake. If a pinless regression ever reaches
production, revert **the app first**, then re-deploy the previous function revision.

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
- `retag-songs.mjs` — catalogue re-tag by theme (2026-09-05). Replaces each post's THEMATIC
  tags with a curated set derived from the stored lyrics (the assignment table lives in the
  script), keeps the tempo tags (`Up Beat`/`Down Beat`/`Transition`; five songs that had
  none received `Down Beat`), strips the 21 artist
  tags from `tags` (artists are `authors` since `migrate-authors`), folds 11 near-duplicate
  theme tags into their canonical name, creates 9 new theme tags, fixes two accent-mangled
  slugs, and deletes the 33 tag docs left unreferenced. Dry-run by default, `--apply` to
  write; refuses to run while any `post` draft exists; idempotent. **STATE: APPLIED
  2026-09-06** with Frank's consent — 9 tags created, 135 posts patched, 33 tag docs deleted,
  0 skips; a follow-up dry-run reported 0 changes that day. **A later `--apply` re-imposes
  the script's `THEMES` table over any tag edit made in Studio since** (full-array replace),
  so read the dry-run diff first — do not re-run it on the word "idempotent". In the same
  session two co-authors were
  added by hand (`Gracias Dios` +UPPERROOM, `Gracia Sublime Es` +En Espíritu y En Verdad),
  both in `authors[]` and the denormalised `author` string. Taxonomy after: 43 tags
  (3 tempo + 40 theme), no artist tags.
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
- `backfill-member-instruments.mjs` — one-shot, dry-run by default, `--apply` with consent:
  derives `teamMembers.instruments` from held `instruments[]` seats. `setIfMissing` +
  `ifRevisionId`, backup to `.backfill-backups/`, closed vocabulary only. **Status:** applied to production 2026-09-10 (10 written; Samy skipped «sin historial»; Francisco Gutierrez listed without Tipo — Frank had already un-typed him; Antonio Navarro then patched by hand to `[Drums, AG]` at Frank's request). Backup in `.backfill-backups/` (gitignored). Idempotent: a re-run writes nothing.

### Solver history diff (MCP P2, Gate B — Frank runs it, never an agent by default)
- `solver-history-diff.ts` (tsx entry point) + `lib/solverHistoryDiff.ts` / `solverHistoryDiffReport.ts`
  / `solverHistoryDiffRun.ts` — classifies every difference between Frank's exported
  `localStorage` history and the derived one (R11, ADR-0041) into `explained` / `unverified` /
  `bug`, and runs the local solver against both sides for one target month. **Reads only local
  files, no Sanity client, no network** — the classifier and report modules are pure, verified
  by a test that walks their import closure. **Refuses any input or output path inside the
  repository** — the checkout it runs from, the main checkout and every linked worktree (found
  through the `.git` file's `gitdir` and `commondir`), resolved through symlinks — before any
  read or write; a `.git` file it cannot follow refuses the run. Exports and derived bundles
  hold real member names, and this repository is public. Usage:

  ```
  npx tsx scripts/solver-history-diff.ts \
    --bundle ~/owt-private/p2-history/bundle-<date>.json [--bundle <another profile's bundle>]… \
    [--export ~/owt-private/p2-history/export-<browser>-<profile>-<date>.json]… \
    [--solve-request ~/owt-private/p2-history/solve-request-<NEXT>.json [--solve-month YYYY-MM]] \
    --out ~/owt-private/p2-history [--seed 42] [--runs 2]
  ```

  Run from the repository root; the first `--bundle` must be the one from the profile that
  captured `--solve-request` (the consistency check treats that bundle's export as the
  capture profile). **`--solve-request` is optional** — without it the CLI still classifies
  (R11's diff), it just cannot also run R11's solve comparison. `--solve-month YYYY-MM`
  overrides which month the solve section targets; left off, that month defaults to the first
  bundle's own `NEXT`. `--runs 0` records the exact request bodies for the production solve
  route instead of spawning the local solver. Without `--solve-request`, or with fewer than 2
  runs per side, the report and stdout say **"R11 incomplete"**: the gate line covers the
  classification only. Exit codes: `0` a report was written (read its gate line), `2` refused,
  `1` failed. The export, bundle and report files are never committed —
  see the P2 plan's Gates A–B
  (`docs/superpowers/plans/2026-09-25-owt-mcp-p2-solver-history.md`) for the full procedure and
  where `~/owt-private/p2-history/` comes from. No new environment variable: the runner spawns
  the local solver through the already-documented `OWT_SOLVER_PYTHON` (§1, "Invocation from
  Next.js"), and checks its `ortools` version against `gcf/requirements.txt`'s pin before
  running anything.

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
plan/refusal decisions), `sr-feasibility-checks.mjs`, `sr-retired-writer.mjs` (the retirement gate),
`memberInstruments.mjs` (pure grouping/normalization for the instruments backfill; mirrors
`seatModel.ts`'s vocabulary, pinned by test).
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

**This suite is a BLOCKING gate.** `gates` runs `python -m unittest discover -s gcf -t gcf`
on Python 3.12 (`.github/workflows/ci.yml`); before that a `gcf/**`-only PR went green on a
job that never opened the file, on code that deploys to the Cloud Function from `main` with
no `preview` rehearsal. Run it locally the same way from the repo root before claiming done —
the three Node gates are no longer the whole set.

---

## 7. Feature history (`docs/superpowers/`)

Every substantial subsystem has a dated **spec** (`specs/*-design.md`) and **plan**
(`plans/*.md`) — Google SSO, push, web-push, text-size a11y, dual reference links, multi-author
references, WhatsApp setlist history, draft/publish services, participation sidebar, preview
toggle + assignment emails, email notification preferences, shared setlist proposals, past-set
browsing. These are the authoritative "why" for each feature; consult them before reworking one.
