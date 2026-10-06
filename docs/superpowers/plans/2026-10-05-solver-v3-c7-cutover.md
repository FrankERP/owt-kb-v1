# Solver v3 — C7: the cutover from v2 to v3 (Implementation Plan)

## Original request

> Necesitamos arreglar en solver.
> Tiene que tomar en cuenta el historial, pero debe de considerar a personas "especiales" como el caso
> que te platique de [REDACTED: three member names] que solo dirigen un mes sí y un mes no.
> Y mantener el fariness en ventanas más grandes, siempre siendo claro y transparente con el admin al
> respecto.
> Lo que pasa es que mientras el equipo crece más, no caben todos para dirigir en un solo mes, pero
> quiero que sus participaciones sigan siendo parejas.
> Si es necesario construir un nuevo solver desde cero, estoy abierto a la posibilidad.
> Recuerda que debe de poder respetar los espacios asignados y necesitamos también que pueda llenar 2
> meses de jalón
>
> — and, mid-session: «Y la participación total también»
>
> — on the parent's approval: «Aprobado, sigue con los specs de las entregas»

The accepted requirement this plan delivers is the C7 row of the approved parent design,
[`2026-10-05-solver-v3-fairness-design.md`](../specs/2026-10-05-solver-v3-fairness-design.md) §11:

> C7 | Plan | Real-container timing; Preview rehearsal (solve without confirm, unsaved on-screen
> pool/rule edits); Frank's look; snapshot `solverConfig`, then in one step move the cadence members
> into the Sunday pool with «Mes por medio», empty the Saturday-only pool (D9) and flip; reconstruct
> v2-confirmed months (C4 script); retire «sin Lead»; MCP P4 planned on v3 or `solve_month` left
> unbuilt/disabled with a reason; ADRs, CLAUDE.md, SECRETS | all | v3 serves Auto | Flip back and
> restore `solverConfig` from the snapshot | standard (release); its `solverConfig` change and
> reconstruction re-runs are production writes — dry run first, Frank's consent each time

together with parent §8 E4, §13 («→ C7 | All merged | v3 serves Auto | Prod alias + function
verified | Flip back») and §16 (integration acceptance).

**Names.** This repository is public. Members are described by their role in the policy («the
cadence members», «the fixed-count lead», «the Saturday-only support singers»), never by name. Any
file that holds a name, an alias or a per-person figure lives in the private repository
`owt-agent-logs`, never here.

## Status and contract

- **Document status:** Draft, aligned to the parent's amendments A1–A26 (§3) on 2026-10-05.
- **Risk tier: standard (release), with critical production-write steps gated by consent** (parent
  §11 C7 row; `CLAUDE.md` «Adversarial plan review»). Rationale: C7 introduces no new writer, no new
  serializer, no schema and no new trust boundary — every writer it uses was specified and reviewed
  in its own child (C2's `fairnessMonthCommit.ts`, C4's reconstruction script, C3's version-guarded
  rules save, C6's confirm). What C7 adds is **operations**: the order of an irreversible-looking
  release and five kinds of production write. Those are controlled here by named consent gates
  (§«Production writes and their consent gates»), dry runs, read-only verification after every
  write, and a rehearsed rollback. The only code C7 writes is a one-line constant flip with its pin
  test, documentation, and — in a second, later PR — the deletion of three v2-only files. No
  adversarial plan review; the controls after implementation are a fresh code review of each PR's
  diff plus the verifications below.
- **Accepted sources:** parent §3 (D1, D9, D15; amendments A1, A2, A5, A6, A7, A8, A11, A14–A17,
  A19, A21–A26, which win over older clause wording), §8 E2–E4, §11 C7, §13, §14 (assumptions 1–2,
  4), §15 (Q1, Q3 resolution points), §16; the settled children C0–C6 (Interfaces). Where a child's
  current text predates an amendment, this plan follows the amendment.
- **Primary outcome:** Auto in production runs on solver v3 — the effective engine on
  `owt-backstage.vercel.app` is `v3`, `owt-solver-v3` answers within budget on the real container, the
  cadence members are in «Líderes Domingo» with «Mes por medio», «Líderes Sábado» is empty, every
  v2-confirmed month that has become past is recorded by C4's script with Frank's consent — and a
  flip back to v2 is rehearsed, documented and possible until Frank closes the rollback window.
- **Preconditions** (all checked in Step 0; each is a stop condition when false):
  1. C0–C6 merged to `main`, each with its own release verification recorded.
  2. `owt-solver-v3` created by Frank and verified per C5 §11.5 (`ACTIVE`, ping `ok: true`,
     `contract: 3`, `build` = the `main` commit that last touched `gcf_v3/**`, smoke solve all stages
     `proven`).
  3. C4's records for the lookback months that are already past applied with Frank's consent
     (Aug and Sep 2026; October 2026 only on or after 2026-11-01, parent A21).
  4. «Mes por medio» saved on the cadence members by Frank (C4 A2, C3 §11 step 7), and only once the
     production alias serves C3 (parent A26). It may precede C4's dry run (A22) because it is inert
     under v2: the whole v2 solve request and the grid's rule verdicts are identical with or without
     it (A8; C3 §6.4).
  5. `OWT_SOLVER_V3_URL` present on Vercel Preview (C6 DOC-1).
- **Safe ending state:** `SOLVER_ENGINE = "v3"` on `main`, production alias serving that commit;
  `solverConfig` holds the post-step pools and rules, and its pre-step snapshot sits in
  `owt-agent-logs/backups/`; the Preview override `OWT_SOLVER_ENGINE` is unset; the restore script
  exists, dry-run-proven, unapplied; v2's function, code and goldens untouched. After the second PR
  (Step 12) the v2-only «sin Lead» surfaces are gone and C4's script is a retired writer.

## Evidence and current behavior

All repository line numbers verified on this branch (`3dbc189b`) on 2026-10-05; `2d90e4b3` (the
amendments) differs from it only under `docs/superpowers/**`, so every code line cited holds there
too. Children's future code has no line numbers; it is cited by requirement ID.

| Evidence | Source | Planning implication |
|---|---|---|
| Pool checkboxes and rule edits change local state only; the whole document is written only by «Guardar reglas» | `app/components/admin/MonthGenerator.tsx:1659-1662` (toggle), `:1165-1169` and `:1196-1200` (the explicit-save copy), `:1755-1761` (the save bar writes pools and rules together) | The E4 rehearsal («unsaved on-screen pool and rule edits») is possible as written, provided nobody presses «Guardar reglas» on dev |
| Pools are arrays of member `_id`s; rules (`restrictions[]`) are keyed by the person's **name** | `MonthGenerator.tsx:1659-1662`; `sanity/schemas/solverConfig.ts:68-79`; private `evidence/u_config-rules.md` §1 | A pool diff and a pool restore need no names; a rule diff does — its output is private |
| The rules route writes with `ifRevisionId(rev)`; the seed script refuses when the document exists | `app/api/admin/solver-config/route.ts:156-157`; `scripts/seed-solver-config.ts:63` | No existing tool restores a snapshot; the seed cannot be reused for a rollback |
| Two consented, private, targeted `solverConfig` patch scripts exist (dry run by default, `--apply` under `ifRevisionId`, skip any path edited since) and full-document snapshots sit beside them | `owt-agent-logs/backups/restore-sat-caps-2026-09-29.mjs`, `add-sun-bgv-floors-2026-10-01.mjs`, `solverConfig-2026-09-29-sat-caps.json` (private) | The rollback restore follows this precedent (Decision K3) |
| Preview writes the production dataset and shares the one `solverConfig` | parent E4; `CLAUDE.md` «Vercel safety» | Every press of «Guardar reglas», «Crear borradores» or «Registrar elegibilidad» on dev is a production write |
| v2 builds in a «Saturday anchor»: a dedicated `saturday_leads` member on every Saturday | `gcf/owt_solver_v2.py:1096-1100` | Moving the cadence members into «Líderes Domingo» while v2 is still the engine changes v2's output silently (C3 §6.7) |
| Today «Líderes Sábado» holds two people and «Líderes Domingo» holds the third cadence member | private `evidence/u_real-data.md:36-39` | The step must account for each Saturday-pool entry; anyone who is not a cadence member is a stop-and-ask |
| v2-era rules shape the cadence members' months: Sunday-pattern exclusions, `Sun.* == 1`/`Sat.* == 1` caps, «Holgura» | private `owt-agent-logs/backups/solverConfig-2026-09-29-sat-caps.json`, `…-2026-10-01-before-sun-bgv-floors.json` (counts only read) | Under v3 an exclusion covering `Sun.Lead` makes a cadence member `out` every month (not eligible → wire `out`, parent A14; C2 CAD-1 `not_eligible`, C5-5); a Sunday on which she is rule-excluded from `Sun.Lead` is not an «available counted Sunday» (A14); an exact rule covering `Sun.Lead` on her is refused when the v3 request is built (A11, C6 WN-2). Every rule name must resolve to exactly one member or the v3 build refuses (A7, C2 RES-7). The rule set must be reviewed for v3 in the rehearsal (Step 3c) |
| The operational read client sends `SANITY_API_READ_TOKEN` when present and reads published documents without it; a record id is `fairnessMonth.YYYY-MM`, and a dotted id is private in Sanity, so a read without the token sees no record at all | `sanity/lib/operationalClient.ts:13-23`; parent A2 | Every read-only count of records C7 makes (Step 0.4, Step 8, Step 10) runs with the read token; a token-less read is a failure, never «no records» (A2: the reader fails closed) |
| `scripts/dev-verify.ts` aborts every non-`GET`/`HEAD` request and refuses production hosts; `--click` reaches buttons, links, menu items and radios only | `docs/DEV_VERIFY.md:41-48`, `:135`, `:15` | The bot can show the static surfaces on dev; it **cannot** run Auto (a `POST`), tick a pool or look at production. The solve is Frank's own hands |
| The Cloud Run timing gate needs the key from Secret Manager; Frank runs it; shapes A–E; 10 warm seeds and 3 cold runs ≥ 20 min idle; pass = all stages `proven` warm, `total_ms` p95 ≤ 8 s, `time_total` p95 ≤ 20 s, cold ≤ 45 s, memory < 75 % | C5 §13 | Step 1 is Frank's; it is scheduled, not folded into the rehearsal |
| `LeadPoolHistoryPanel` is mounted at the config step and the stored editor; under v2 it must render as today | `MonthGenerator.tsx:56`, `:1501-1531`, `:1736-1746`, `:4490-4499`; C6 EQ-1 | Deleting it in the flip PR would make «flip back» restore v2 without its panel (Parent issue 3) |
| `leadPoolHistory.ts` is imported only by `LeadPoolHistoryPanel.tsx:7` and its own test | `grep` over `app/` and `scripts/`, 2026-10-05; `app/components/admin/__tests__/leadPoolHistory.test.ts:6` | The deletion is self-contained apart from comments and docs: `useDerivedSolverHistory.ts:6`, `MonthGenerator.derivedHistory.test.tsx:236`, `CLAUDE.md:228`, `docs/SOLVER_AND_INFRA.md:162`, `docs/UTILITIES_AND_COMPONENTS.md:196` |
| ADR numbers must be unique and consecutive and each record needs a `**Date:** … **Status:**` line; a number is final only when the record reaches `main` | `app/utils/__tests__/adrIndex.test.ts:27-36`; `docs/adr/README.md` «Format» and index | New records take the next free number on `main` at merge; amendments change Status lines and index rows |
| Status lines today: 0004 and 0038 «amended by ADR-0046»; 0010 «amended by ADR-0042»; 0041, 0046, 0047 «Accepted»; 0042 «amended by ADR-0046» | `docs/adr/0004-…:3`, `0038-…:3`, `0010-…:3`, `0041-…:3`, `0042-…:3`, `0046-…:3`, `0047-…:3` | Seven amendments land in the flip PR (Step 5) |
| The four «new» records the parent lists are already owned: the ledger and record (C2 GU-3), the cadence (C3 §12), the second function (C5 §14), the engine switch and the horizon with stored services as fixed services (C6 DOC-2) | child specs | C7 writes none of them (Parent issue 1); it writes one record of its own (Decision K6) |
| MCP P4 (`solve_month`, `revise_proposal`, `apply_schedule`) is approved at critical tier on **parity with the browser's v2 request** and is not implemented | `docs/superpowers/plans/2026-09-28-owt-mcp-p4-solve-apply.md:3`, `:8-12`, `:59-66`; `docs/MCP.md:33-40`; no `solve_month` handler under `app/` | Under v3 its parity target and its apply order (drafts without a record, against parent L3/U4) are stale; C7 marks it blocked rather than re-baselining it (Decision K7) |
| `CLAUDE.md` describes Auto as sending «NO fairness history» and names `priorMonthLeadVisibility`; the reusable-utils list says P4's `solve_month` will call `loadSolverHistory` | `CLAUDE.md:217-232`, `:472-481` | Both go stale at the flip; rewritten in Step 5 and Step 12 |
| `OWT_SOLVER_API_KEY` has one Secret Manager value for both Vercel environments; `VERCEL_ENV` is also `preview` on the `verify/service-readiness` deployment, which carries branch-scoped pairs | `docs/SECRETS.md:485-575`, `:312-313` | `OWT_SOLVER_ENGINE` is set branch-scoped to `preview` only (C2 EN-3); every env change is recorded in its entry |
| Vercel bakes env vars at build time | `docs/SECRETS.md:316-318` | `OWT_SOLVER_V3_URL` must be on Production **before** the flip PR merges; the merge deploy picks it up |
| A function deploy is verified by `describe` (`ACTIVE`, fresh `updateTime`) plus a smoke request with the key piped, never printed | `docs/SOLVER_AND_INFRA.md:471-523` | The v3 re-verification after any `gcf_v3/**` change follows C5 §11.5, which extends this with the `build` echo |

## Scope

### In scope

- Running the real-container timing gate C5 §13 defines (Frank), recording its aggregates, and the
  minimum-instances decision (C5 OQ-4).
- Pointing Preview at v3, the Preview rehearsal of parent E4, its evidence and its independent check.
- Frank's look (dev-verify on dev's static surfaces; Frank's own browser for the solves), and the
  open questions the children deferred to it.
- The solverConfig snapshot, the one step (flip, pools, the rules Frank decided in the rehearsal), the
  read-only verification after it, and the rollback restore script (written, dry-run, unapplied).
- The flip PR: `SOLVER_ENGINE = "v3"` with its pin test, the seven ADR amendments and one new ADR,
  `CLAUDE.md`, `docs/SOLVER_AND_INFRA.md`, `docs/SECRETS.md`, `docs/CI.md` (verify; edit only a stale
  claim), `docs/MCP.md` and the P4 plan's status line.
- The reconstruction tail: C4's script re-run, with consent, for every v2-confirmed month as it
  becomes past.
- The retirement PR after the rollback window closes: delete `LeadPoolHistoryPanel.tsx`,
  `leadPoolHistory.ts`, `__tests__/leadPoolHistory.test.ts` and their mounts; retire C4's script
  (C4 R22); final doc edits.
- `finish-cycle` and the worklog for both cycles.

### Non-goals

- Any change to v2: `gcf/**`, `cloudbuild.yaml`, `scripts/deploy-solver-gcf.sh`, v2's goldens, its
  request builder, its parsers, `SOLVER_SENDS_HISTORY`, `SOLVER_HISTORY_SOURCE`, the solver-history
  route and the derived-history read (parent §10; they are the rollback).
- Retiring v2 itself (function, code, suite). A later decision with its own plan (Decision K6).
- Building or re-baselining MCP P4 (Decision K7).
- Any change to C1–C6's contracts. A defect found in the rehearsal is fixed in the owning child's code
  through its own PR and review, then the rehearsal resumes (stop condition S7).
- Publishing, notifications, instruments, FOH, kids.
- A warm-up ping (C6 §8): only if the cold start fails the gate and Frank declines minimum instances
  (Step 1, «On failure»), and then as a C6 change on its own PR.

### Preserved invariants

- **Push order and release discipline** (`CLAUDE.md` Conventions): feature branch → gates →
  fresh code review of the merge range → fix → re-verify the fix → `preview` and verify the dev alias
  (alias array and `githubCommitSha`) → PR to `main` behind `gates` → auto-merge armed last on the
  exact reviewed commit, disarmed before any further push → verify the production alias and SHA. The
  last worklog entry before each merge is a verification, not a fix.
- **v2 stays deployed, byte-identical and selectable** by flipping the constant back, until Frank
  decides otherwise in a separate plan.
- **No agent saves rules on production** (C3 §5): the one step's rules save is Frank's, in the UI.
  The rollback restore is a consented private patch script (Decision K3).
- **Production Sanity writes need explicit consent, after a dry run** (`CLAUDE.md`). Diagnosing is
  never consent. One consent covers one named write.
- **Names never enter this repository**: snapshots, diffs, captured requests and responses, the
  reconstruction tables and every rehearsal artifact live in `owt-agent-logs`.
- CDMX dates; `saturdarSongs`; the five member seats; `published` gating; `_key` on every array item;
  `fairnessMonth` written only through C2's executor; ADR-0029 (Tipo is the only eligibility axis).

## Interfaces

**Consumes**

| From | What C7 relies on | Exact shape |
|---|---|---|
| C0 | The required check and the v3 job | Check `gates` = «every CI job for this commit succeeded» (C0 «Provides to every later child and to C7»); jobs `node`, `solver-v2`, `solver-v3`; local gate `python -m unittest discover -s gcf_v3 -t gcf_v3` when `gcf_v3/**` changes |
| C1 | The engine constant; the toggle and its read rule | `app/components/admin/solverEngine.ts` exports the constant `SOLVER_ENGINE: "v2" \| "v3"` and nothing else (parent A1), value `"v2"` until Step 5; `countsForFairness?: boolean` on `sunday_role`, `saturday_role`, `special_role`; effective value `coalesce(countsForFairness, _type != "special_role")`; the note «Cuenta para equidad: aplica con el nuevo solver. Hoy Auto no lo usa.», gated by C6 to v2 (C6 CTL-1); lookback-month services cannot be toggled from any surface (A25) |
| C2 | Effective-engine resolver and override; eligibility resolver; ledger; record; panel; «Registrar» | Per parent A1: the pure resolver of the effective engine; `OWT_SOLVER_ENGINE` honoured only on the `preview` branch deployment, or locally when `VERCEL_ENV` is unset, and only for a value exactly `"v2"` or `"v3"` — never on `verify/service-readiness` or Production, where the constant wins; its `docs/SECRETS.md` entry (C2 EN-3); the PUT's refusal `engine_not_v3` (WR-6). The single v3 eligibility resolver `resolveMonthEligibility` (A7), whose every rule name must resolve to exactly one member (C2 RES-7, through C3's `resolveRulePersonId`). `GET /api/admin/fairness?month=YYYY-MM[&horizon=1\|2]` → `FairnessLedgerResponse` with `engine`, `currentMonth`, `window[]{ month, record }`, `horizon[]{ month, record, storedServices }`, `people[].window[<LineKey>].balance` (hundredths, positive = owed, rounded once half away from zero, A17); the reader fails closed, including when the read token is absent (A2, C2 RD-2); `PUT /api/admin/fairness/months` (never called by C7 directly); record `_type: "fairnessMonth"`, `_id: "fairnessMonth.YYYY-MM"` (A2), per-role statuses `in` / `out` / `exact` (A3), stamps `source: "auto" \| "manual" \| "reconstructed"`, `engine`, `environment: "production" \| "preview" \| "local"`; a record is replaceable only while its month has no stored weekend services and no counted specials (A5), and binds a horizon month only then (A6); «Registrar elegibilidad de {mes}» rendered only when the GET's `engine` is `"v3"` (UI-6); the panel's single formatter shows one decimal (A17); ledger `app/utils/fairnessLedger.ts`, reader `app/utils/fairnessLedgerRead.ts`; GU-3 ADR; GU-4 `CLAUDE.md` line |
| C3 | The cadence setting, the resolver, the save guard | `solverConfig.restrictions[].sundayCadence?: "alternate"` (absent = «Normal»); `app/utils/sundayCadence.ts`: `resolveRulePersonId(person, roster) → { ok: true, id } \| { ok: false, reason: "unresolved" \| "ambiguous", matches }`, `cadenceMembers(config, roster) → { ids, refusals }`, `cadenceOutsideSundayPool(config, roster) → [{ id, name, reason: "not_ticked" \| "no_sunday_lead_tipo" }]`; `SOLVER_CONFIG_VERSION = 2`; POST `/api/admin/solver-config` body `{ rev, config, configVersion }`; pools `sundayLeads`, `saturdayLeads`, `support` as member `_id` arrays; the «Mes por medio fuera de Líderes Domingo» warning, built by C3 and shown only under v3 (A9); v2 inertness (A8, C3 §6.4) |
| C4 | The reconstruction CLI | `npx tsx --env-file=.env.local scripts/reconstruct-fairness-months.mjs --months YYYY-MM[,…] --out <private dir> [--overrides <private file>] [--preview-run YYYY-MM]`; `--apply --plan <file>`; `--rollback` and `--rollback --apply --plan <file>`; exit `0` done, `2` refused before any write, `1` failed or partial; strictly past months only (R1); plan fingerprint consent (R15, R19); retirement by `assertRetiredWriter` and `RETIRED_ONE_SHOT_WRITERS` (R22, owned by this plan) |
| C5 | The function, its gate and its report | Function `owt-solver-v3`, trigger `owt-solver-v3-deploy` (`gcf_v3/**`); verification C5 §11.5 (describe `ACTIVE` + `updateTime`, ping `ok: true`, `contract: 3`, `build` = deployed SHA, smoke `gcf_v3/acceptance/smoke.json`); URL source `gcloud functions describe owt-solver-v3 --gen2 --region=us-central1 --format='value(serviceConfig.uri)'`; timing shapes from `python gcf_v3/acceptance/run.py … --emit-requests <dir>` (A–D) and the private converter (E); response fields `stages[]{ id, status: "proven" \| "unproven" \| "not_run", limit: "none" \| "deterministic" \| "wall", ms, det_milli }`, `total_ms`, `violations[]`, `violation_ceiling{ value, proven }`, `unfilled[]`, `cadence[]{ person, month, state: "on" \| "off" \| "out", sundays, saturdays, met, compensation: "given" \| "missed" \| "not_applicable" }` (A14), `missed[]{ code, person, month?, month1?, month2?, dates?, count?, cause }` with causes `not_proven`, `pins`, `rule`, `unavailable`, `capacity`, `higher_priority`, `notices[]{ code, params }` (incl. `dl_capacity`, computed once per run, A19), `fairness{ tolerance, people[]{ person, lines{ <line>: { carried, planned, share, received, after } } } }` — planned and realised share both reported, `after = carried + share − received` (A19), `tolerance` = `FAIRNESS_TOLERANCE`; request fields per person `cadence`, `dl_since`, `prev_dl_leads` and the envelope's `prior` (A15); exact-count leads excluded from both monthly caps (A16); the independent checker of C5 §12.3, callable on one captured request/response pair and printing counts and codes only (C5-R15); the private Run A aggregates C5 records (A23); `STAGE_DET_LIMIT` and OQ-4 (minimum instances) |
| C6 | The planner on v3 | Effective engine resolved on the server (C2's resolver) and passed as a render prop (ENG-3, A1); `POST /api/admin/solve` answers `409 { ok: false, error: "solver_version_mismatch", engine }` on a contract/engine mismatch (RT-1, A1) and JSON transport errors `{ ok: false, transport_error: true, transport }` (RT-5), a timeout and every other transport reason with distinct copy (A24); v3 abort 55 s route / 58 s client; a test pins `SOLVER_ENGINE === "v2"` (ENG-1); horizon control «Planear: 1 mes · 2 meses» (HZ-1); Auto refuses a horizon with a past month (HZ-7, A24); a record-bound horizon month (A6) is solved with its record's eligibility and shows its pool checkboxes read-only; the real v3 request builder, `prior` built from `GET /api/admin/roles` (A15); warnings WN-1 (C3's «Mes por medio fuera de Líderes Domingo», A9), WN-2 (cadence refusals, incl. A11), WN-3 (non-empty «Líderes Sábado»); confirm writes records then drafts (CF-1–CF-11), and — **pending C6 PI-7's parent ruling** — writes **no** record for an «anchored, unrecorded» month (stored weekend services or counted specials but no record, e.g. a month confirmed under v2) whose drafts it still creates (C6 §4, CF-1 (iii), `…-c6-planner-v3-design.md:250`). CF-1 (iii) departs from the parent's literal L3/U4/A6 (`…-fairness-design.md:294-295,326,127`) and is dropped if the parent keeps them (C6 PI-7, `:696`; §15, `:748`); C2's writer creates in that case regardless (WR-8 row 3, `…-c2-ledger-and-record-design.md:138`), so unless the ruling adds a server check, (iii) is the client's alone. Which branch is in force is Step 0 check 8; every C7 clause that relies on (iii) states both branches; v2 history surfaces unmounted under v3, deletion C7's (EQ-1); `OWT_SOLVER_V3_URL` SECRETS entry (DOC-1) |

**Provides**

- To production: `SOLVER_ENGINE = "v3"` on `main` (Step 5), with `OWT_SOLVER_V3_URL` on Vercel
  Production.
- To the ledger: `fairnessMonth` records with `source: "reconstructed"` for every v2-confirmed month,
  applied by C4's script as each becomes past (Step 10).
- To a rollback: the pre-step snapshot `owt-agent-logs/backups/solverConfig-<YYYY-MM-DD>-before-v3-flip.json`,
  the post-step snapshot `…-after-v3-flip.json`, and the private restore script (Step 6).
- To the repository: the seven ADR amendments, one new ADR, the cutover record in
  `docs/SOLVER_AND_INFRA.md`, the updated `CLAUDE.md` and `docs/SECRETS.md`; later the deletion of the
  «sin Lead» panel and the retirement of C4's script.
- To MCP: P4 marked blocked with its reason (Decision K7).

## Affected boundaries

| Component, file, or system | Current responsibility | Planned responsibility |
|---|---|---|
| `owt-solver-v3` (Cloud Run gen2) | Deployed, uncalled | Serves Auto in production; minimum instances per Step 1 |
| Vercel Preview env | `OWT_SOLVER_V3_URL` (C6) | + `OWT_SOLVER_ENGINE=v3` scoped to the `preview` branch for the rehearsal (Step 2) — honoured by code only on that branch's deployment (A1), the scoping is defence in depth; removed after the flip (Step 9) |
| Vercel Production env | `OWT_SOLVER_URL`, `OWT_SOLVER_API_KEY` | + `OWT_SOLVER_V3_URL` (Step 6) |
| `app/components/admin/solverEngine.ts` and its pin test | `"v2"` | `"v3"` (Step 5) |
| `solverConfig` (production document, shared with Preview) | v2 pools: cadence members split between Sunday and Saturday pools | Cadence members in «Líderes Domingo», «Líderes Sábado» empty, v3-reviewed rules (Step 7, Frank) |
| `fairnessMonth` documents (`fairnessMonth.YYYY-MM`, A2) | Aug/Sep (and Oct on or after 2026-11-01, A21) reconstructed by C4 | + every v2-confirmed month, reconstructed when past (Step 10); + v3 confirms (C6, ordinary operation) |
| `docs/adr/0004, 0010, 0038, 0041, 0042, 0046, 0047` and `README.md` | v2 decisions | Amended «under v3»; v2 keeps each original (Step 5) |
| `docs/adr/00NN-the-v2-solver-stays-as-the-rollback-engine.md` (new) | — | The cutover's own decisions (Decision K6) |
| `CLAUDE.md` | Auto described as v2 | Engine section rewritten (Step 5); `priorMonthLeadVisibility` clause removed (Step 12) |
| `docs/SOLVER_AND_INFRA.md` | §1 is «the» solver; v3 section (C5) says nothing calls it | v3 serves Auto; §1 is the rollback engine; cutover record |
| `docs/SECRETS.md` | Entries from C2, C5, C6 | Status of each variable after the flip; no values |
| `docs/MCP.md:33-40`, P4 plan `:3` | P4 «approved, not implemented» | P4 «blocked: re-baseline onto v3 before implementation» |
| `LeadPoolHistoryPanel.tsx`, `leadPoolHistory.ts`, `__tests__/leadPoolHistory.test.ts`; mounts in `MonthGenerator.tsx` | Rendered under v2 only (after C6) | Deleted after the rollback window (Step 12) |
| `scripts/reconstruct-fairness-months.mjs` | Live production writer | Retired writer (Step 12, C4 R22) |
| `owt-agent-logs/backups/` and `owt-agent-logs/sdd/<cycle>/` (private) | Earlier snapshots | Snapshots, diff output, restore script, rehearsal captures, timing raw data |

## Production writes and their consent gates

Every row is a write to something the team's production depends on. «Consent» means Frank's explicit
yes in chat to **that** row at **that** time, after the named dry run or preview; it never carries to
another row or a later repeat. Before any Vercel command that may mutate remote state,
`.vercel/project.json` is checked against `frank-rochas-projects/owt-backstage`
(`prj_elS88VGezKpy18wizFN1ffoy8cJ5`) (`CLAUDE.md` «Vercel safety»).

| ID | Write | Actor | Before it | Consent gate | Verification after | Undo |
|---|---|---|---|---|---|---|
| W1 | `--min-instances=1` on `owt-solver-v3` (only if Step 1's cold start fails) | Frank | Gate results shown with the monthly cost | Frank decides (cost, C5 OQ-4) | `describe` shows the setting; cold runs re-measured | Set back to 0 |
| W2 | Vercel Preview: `OWT_SOLVER_ENGINE=v3`, branch-scoped to `preview` (not `verify/service-readiness`, which ignores it by code anyway, A1) | Frank, or the agent on his yes | `vercel env ls preview` (names only) | Yes, once | Preview redeployed; dev alias + SHA; dev's `/admin` shows v3 controls; the fairness GET answers `engine: "v3"` | Remove the variable, redeploy Preview |
| W3 | Optional: keep one rehearsal month by confirming it on dev (parent E4 exception) — writes that month's `fairnessMonth` (stamped `environment: "preview"`, `engine: "v3"`; none if the month was «anchored, unrecorded» **and** Step 0 check 8 found C6 CF-1 (iii) in force — in the literal branch such a month gets the record too) and its drafts | Frank | The month's solve read and accepted in the look (Step 4) | Frank names the month | Record present with `source: "auto"`; drafts counted per month (CF-6 lines) | Drafts: deleted by Frank in the app if unwanted. The record, when one was written, stays (no code path deletes a route-written record, C2 WR-13). Because the month now has stored services, the record is frozen (A5) and **binds** that month in every later solve, the first production run included: its eligibility is the record's and its pool checkboxes are read-only (A6). Only if Frank deletes every draft and the month holds no counted special does the record stop binding, and the next confirm or «Registrar» replaces it under its revision (A5, A6) |
| W4 | Vercel Production: `OWT_SOLVER_V3_URL` | Frank, or the agent on his yes | Value read from C5's `describe` command, piped, never typed into a file | Yes, once | `vercel env ls production` lists the name; effective at the flip deploy | Remove; redeploy |
| W5 | The flip: merge of the flip PR to `main` (a production release) | Agent, auto-merge armed last | Rehearsal accepted, look accepted, W4 done, snapshot recorded, freeze agreed (Step 6) | **Frank's explicit go-ahead for the flip** (parent R9) | Production alias contains the merge commit, `githubCommitSha` equal; Frank's first look on production | Flip-back PR (Rollback) |
| W6 | `solverConfig`: the one step's pools, plus the rule edits the rehearsal found v3 needs that are not inert under v2 (Parent issue 4) | **Frank, in the production UI** («Guardar reglas») | Pre-step snapshot recorded; the intended change set written down from the rehearsal (Step 4) | Frank performs it | Read-only diff pre-step vs live: exactly the intended change set (Step 7) | Restore script W8 |
| W7 | `fairnessMonth`: C4 `--apply --plan <file>` for each v2-confirmed month when past | Agent or Frank | C4 dry run; Frank reads the private table, anomalies and balance preview | Frank's yes **to that plan file's fingerprint** (C4 R19) | Second dry run reports «sin cambios»; the panel shows the month «reconstruido» | C4 `--rollback` (dry run, then fingerprint consent) |
| W8 | Rollback only: revert the one step's paths in `solverConfig` | Agent, private script | Dry run printing exactly which paths revert and which are skipped as edited since | Frank's yes to that dry run | Read-only diff: the reverted paths equal the pre-step snapshot | Re-run Step 7's change in the UI |
| W9 | Rollback only: the flip-back PR merge | Agent, auto-merge armed last | Same release discipline as W5 | Frank's go-ahead for the rollback | Production alias + SHA | Flip forward again (W5) |
| W10 | Rollback only, optional: C4 `--rollback` of reconstructed records | Agent or Frank | C4 rollback dry run | Fingerprint consent | Months read «sin registro» | C4 re-apply |

What does **not** happen: no Cloud Build run for the flip or the retirement PR (neither touches
`gcf/**`, `cloudbuild.yaml` or `gcf_v3/**`); no notification (a v3 confirm creates drafts only, and
publishing is unchanged); no write to any role document by C7 itself.

## Ordered changes

Two cycles with code, one operational tail:

- **Cycle F (flip)** — Steps 0–9, one feature branch `claude/solver-v3-c7-flip`.
- **Tail** — Step 10, recurring at each month boundary until every v2-confirmed month is recorded.
- **Cycle R (retirement)** — Steps 11–12, branch `claude/solver-v3-c7-retire`, only after the rollback
  window closes.

### 0. Entry checks (read-only)

- **Purpose:** prove the preconditions before any action.
- **Checks:**
  1. Every child C0–C6 on `main` (merge commits listed in the worklog for this cycle).
  2. C5 §11.5 on `owt-solver-v3`: `ACTIVE`, `updateTime` after the last `gcf_v3/**` merge, ping
     `build` equal to that merge's SHA, smoke solve all `proven`. Frank runs the keyed parts.
  3. `vercel env ls preview` lists `OWT_SOLVER_V3_URL`; `vercel env ls production` lists
     `OWT_SOLVER_URL` and `OWT_SOLVER_API_KEY`. Names only, never `env pull`.
  4. Read-only count over production data, printed without names, **with `SANITY_API_READ_TOKEN`**
     (a `fairnessMonth.YYYY-MM` id is private, A2: a token-less read returns no record, so a missing
     token is a stop, never a «zero records» result): the number of `fairnessMonth` records per month
     for the last four months and their `source`; the months that hold stored weekend services but no
     record (the **v2-confirmed list**, seeded into the Step 10 table).
  5. **Every rule name resolves to exactly one member (A7; C3 A5 on the real roster):** a local,
     read-only run over the live `solverConfig` and the unfiltered worship roster prints only counts:
     `cadenceMembers` → `ids: <n>, refusals: <n>` (expected 3 and 0); and C3's `resolveRulePersonId`
     over every name C2's resolver reads (each restriction's person, both persons of each conflict,
     every presence member — C2 RES-7) → refusals by kind (`unresolved`, `ambiguous`), each listed by
     restriction, conflict or presence `_key`, never by name. Expected: 0. A refusal here would make
     every v3 Auto refuse.
  6. `cadenceOutsideSundayPool` over the same inputs, counts by reason only — establishes which
     cadence members the step must move.
  7. «Líderes Sábado» membership: every id in `saturdayLeads` is one of `cadenceMembers.ids`
     (printed as a count of matches and non-matches).
  8. **The «anchored, unrecorded» ruling (C6 PI-7) and what is merged.** Read from the parent and
     from the merged C2 and C6 code which branch is in force, and record it in the worklog and the
     cutover record:
     - **Amended, server-checked:** the parent's owner amended L3/U4/A6 as C6 PI-7 asks
       (`…-c6-planner-v3-design.md:696`) **and** C2's WR-8 as merged refuses a `source: "auto"`
       create on a month with freezing services (`month_has_services`, re-checked at write time
       like row 7). C6 CF-1 (iii) holds on the server; no residual window.
     - **Amended, client-only:** the parent amended L3/U4/A6 but C2's writer still creates on
       «no record and `expectedRev === null`» (WR-8 row 3, `…-c2-ledger-and-record-design.md:138`).
       (iii) holds in C6's client only, with the race C6 CF-1's last sentence names (`:250`): a
       confirm racing a stored-service save mints the record (iii) withholds. Step 8's read-back
       detects it.
     - **Literal:** the parent kept L3/U4/A6 as written and C6 dropped CF-1 (iii) (C6 PI-7's «If
       the owner rules the other way»). A v3 confirm that creates drafts in a v2-planned, not-yet-past
       month writes a permanent `source: "auto"` record for it (A5 forbids replacing it once the
       month holds stored services; C4 never touches a record it did not write, C2 WR-14 row 5).
       K4 and Step 10 then use their literal-branch text.
     Sub-check, in every branch: whether any path other than Auto's confirm (for example «Editar
     mes» in stored mode) writes a `fairnessMonth` record in the merged C6 — read from the code,
     never assumed (C6's «Manual plans under v3» row, `:662`, does not settle it). The literal
     branch's K4 control relies on the answer.
- **Failure:** any check false → stop (S1). Check 8 with no ruling yet (C6's CF-1 (iii) merged as
  a deviation the parent has neither amended nor rejected) → S1 until the parent's owner rules;
  C6's §15 (`:748`) should have prevented that merge. Check 5 with refusals → Frank fixes the rule's name
  (C3 A5; a rename is a «Guardar reglas» on production, inert under v2 only if v2's first-match still
  resolves the same member — he confirms that on screen before saving) and the check re-runs. Check 7 with a non-match → Frank decides whether that person stays
  in «Líderes Sábado» (under v3 she then leads Saturdays only, C6 WN-3) or leaves it; parent D9's
  «empty» assumes only cadence members are there.
- **State after:** nothing written.

### 1. Real-container timing gate (C5 §13) — Frank

- **Purpose:** parent §14 assumptions 1–2; §16 «every stage probado within the budget on the real
  container, cold start included».
- **Change:** the agent emits shapes A–D with C5's harness (`--emit-requests` into a private
  directory) and prepares shape E with C5's private converter from read-only dumps. Frank runs the
  10 warm seeds per shape and 3 cold runs, each after ≥ 20 minutes idle, against the deployed
  function with the key handled as `docs/SOLVER_AND_INFRA.md:477-490` does. Raw outputs go to
  `owt-agent-logs/sdd/<cycle>/timing/`; the agent computes the aggregates: per shape, `proven`
  counts, any `limit: "wall"`, `total_ms` p50/p95, `time_total` p50/p95, cold `time_total` max,
  peak memory, and the `ms`/`det_milli` ratio per stage (calibrates `STAGE_DET_LIMIT`).
- **On failure, in C5 §13's order, bounded:**
  1. Only the cold start fails → W1 (Frank decides; cost stated). Re-run the 3 cold runs.
  2. Stages fail warm → a `gcf_v3/**` PR raising `STAGE_DET_LIMIT` and/or the wall guard within the
     25 s budget, through C5's release path (review, `gates`, `owt-solver-v3-deploy`, C5 §11.5 with
     the new `build` echo), then the gate re-runs from the start. **At most two such rounds.**
  3. Still failing → S2: v2 stays the engine; Frank is offered a 1-month-only v3 as a C6 change on
     its own PR (parent §14); C7 pauses.
- **Verification:** the aggregates meet every C5 §13 pass line; they are recorded in the cutover
  record (Step 5) without per-person data.
- **State after:** nothing app-visible changed.

### 2. Point Preview at v3 (W2)

- **Change:** `OWT_SOLVER_ENGINE=v3` on Vercel Preview, scoped to the `preview` branch only (the
  `verify/service-readiness` deployment is also `VERCEL_ENV=preview`; the resolver ignores the
  variable there by code, A1, and the branch scoping keeps it from even being present, C2 EN-3);
  redeploy Preview from the dashboard (a redeploy of `preview`'s current deployment, which
  reads the new variable at build time).
- **Verification:** dev alias contains the new deployment and its `githubCommitSha` equals
  `preview`'s head; `scripts/dev-verify.ts --route /admin --text` (output in the gitignored
  directory) shows the v3-only surfaces (horizon control; no «Vista previa» banner on the «Equidad»
  panel; C1's and C3's «aplica con el nuevo solver» notes absent, C6 CTL-1; WN-1/WN-3 present while
  the pools are unchanged) — «Holgura … no aplica con el nuevo solver» is **not** a v3 signal, it
  shows under both engines (C6 CTL-1); a read of `GET /api/admin/fairness` through the same bot
  reports `engine: "v3"`.
- **Live-fire warning, stated to Frank before the variable is set:** from now until Step 9, dev's
  «Crear borradores» writes records and drafts to production (C6 CF-1), «Registrar elegibilidad»
  appears on dev and writes production records (C2 EN-3 blast radius), and «Guardar reglas» on dev
  overwrites production's rules. The rehearsal presses none of them; W3 is the only exception.
- **State after:** dev runs v3 Auto; production unchanged.

### 3. The Preview rehearsal (parent E4, §16) — Frank's hands, agent's check

- **3a. Rehearsal snapshot.** The agent takes a read-only snapshot of the whole `solverConfig`
  document, in Step 6's format, to `owt-agent-logs/backups/solverConfig-<YYYY-MM-DD>-rehearsal.json`
  (private), and records its `_rev`; any change of `_rev` during the rehearsal that Frank did not
  make is S6.
- **3b. On-screen edits, never saved.** On dev, in Auto's configuration: tick the cadence members
  in «Líderes Domingo»; untick everyone in «Líderes Sábado» (per check 0.7's outcome); WN-1 and WN-3
  must then show nothing for them. On-screen pools drive only horizon months that no record binds
  (A6); a bound month (a record plus stored services or counted specials — normally only a month
  kept by W3) shows its pools read-only with the reason and is solved with its record's
  eligibility.
- **3c. Rule review for v3, on screen.** Frank walks every restriction that names a cadence member
  or holds a Saturday or Sunday count rule, with the agent's checklist (private, with names):
  an exclusion covering `Sun.Lead` on a cadence member (makes her `out` every month); an exact rule
  covering `Sun.Lead` on a cadence member (refused when the v3 request is built, A11, WN-2); a
  week exclusion covering `Sun.Lead` on a cadence member (those Sundays stop being «available
  counted Sundays», A14, which can shift her on/off month); `Sat.*`/`Sun.*` exact counts (become
  set-asides and fixed seat counts under v3, C2 RES-3/LG-9; exact-count leads are outside both
  monthly caps, A16); «Holgura» (no effect on the solver under v3, A10); «Exenta» (D13); and anyone
  named in a rule but ticked in no pool — v2 injects them as BGV/Choir candidates, v3 makes them
  eligible for nothing (C2 RES-1, Q1), so Frank ticks or accepts each. Each decided change is made
  **on screen only** and written into the private change list that Step 7 applies in the **same**
  save as the pools: every kind above changes v2's request, so none may be saved before the flip
  (Parent issue 4).
- **3d. Solves, not confirms.** For the next two real months after the current CDMX month:
  1. one 2-month run («Planear: 2 meses»);
  2. each month alone («1 mes»), the second with the first planned on screen but not stored;
  3. the 2-month run again with «Solo llenar vacíos» over a few hand-placed seats (pins), and once
     with a hand-placed seat that breaks a rule, to see the named break (C6 NT-2);
  4. one run after ≥ 20 minutes idle (the end-to-end cold path through the route, 55 s abort).
  For each run Frank saves, from the browser's network panel, the request and response bodies of
  `POST /api/admin/solve` and the response of `GET /api/admin/fairness` to
  `owt-agent-logs/sdd/<cycle>/rehearsal/` (private), plus the end-to-end durations of both calls.
- **3e. The agent's independent check** of every captured pair, with C5's independent checker
  (§12.3) or a private wrapper around it; prints only counts and codes:
  The captured requests are the first ones built by C6's **real** request builder from real data,
  so this check is also the re-check of C5's private Run A that parent A23 assigns to C7: the same
  pass criteria, plus a comparison of stage statuses, timings and the maximum F13 gap with the
  aggregates C5 recorded.
  - every stage `proven`; no `limit: "wall"`; route duration < 55 s;
  - 0 hard violations (one seat per person per service; a seat only for someone eligible and
    available, or pinned); pin echo equals pins sent; every rule violation has cause `pins` (stored «Guardado» seats or 3d.3's
    hand-placed ones) — none `forced`;
  - `missed[]`: no `dl_floor_missed` unless its cause is `capacity` (and the run carries
    `dl_capacity`) or `unavailable`; no `sunday_cap_exceeded`, `saturday_cap_exceeded` or
    `consecutive_sundays` except with cause `pins` in 3d.3 — exact-count leads are excluded from both
    caps (A16), so cause `rule` is never expected; no `voice_floor_missed`, `cadence_on_missed` or
    `cadence_off_led` except with cause `pins` in 3d.3, or `unavailable` for a person whose only
    available slots were fixed services (Frank confirms each in Step 4); `compensation_missed` only
    with cause `unavailable` or `pins`;
  - each cadence member, per `cadence[]` (wire states `on`/`off`/`out`, A14): `met: true` in every
    month, except where a 3d.3 pin forces the miss (`cadence_off_led` with cause `pins`, C5 P.5); across the 2-month run one `on` and one `off`, or a shift that CAD-1's reason explains
    (as the panel's «Motivo» shows it); `compensation: "given"` in each `off` month with a Saturday
    she is available for; an `out` month has 0 Sundays and `compensation: "not_applicable"`;
  - `|planned − share|` ≤ `fairness.tolerance` for every person-line, and `after = carried + share −
    received` holds (A19);
  - every `carried` value equals the captured GET's `people[].window[line].balance`.
- **3f. Rollback rehearsal.** (1) Remove `OWT_SOLVER_ENGINE` on Preview and redeploy; Frank runs a
  v2 Auto on dev for the next month **without confirming** — v2's diagnostics strip («Sin
  optimizar»/«Equidad relajada»/«Historial» as applicable) appears and «sin Lead» renders as before;
  (2) the restore script of Step 6 is written now and dry-run against the live document, with the
  3a rehearsal snapshot given as both its «pre-step» and its «post-step» input: it must plan zero
  writes (the script runs, reads, and computes an empty change set);
  (3) re-set the variable (W2 again, Frank's yes) if more rehearsal is needed.
- **3g. Lookback reading.** The rehearsal's lookback is the three months before its first planned
  month. The current CDMX month is in it and is **expected** to read «sin registro, no cuenta» (it
  was confirmed under v2 and is not past, A21, C4 R1); so is October 2026 before 2026-11-01 (A21).
  Neither is a defect. Any other «sin registro» month in the window is S5.
- **Failure:** S3–S7.
- **State after:** nothing written (unless W3); the private change list for Step 7 exists.

### 4. Frank's look

- **dev-verify** (read-only, `docs/DEV_VERIFY.md`): `/admin` static surfaces at desktop and at a
  phone viewport, light and dark: the configuration step (horizon control, C1's toggle note absent
  under v3, C3's chips and help, warnings), the «Equidad» panel (tabs via `--click` on its
  `SegmentedControl` options, phone cards, no page-level horizontal scroll — ADR-0035). Artifacts in
  the gitignored output directory; the report pairs each run with the dev alias SHA.
- **Frank's own look** at each solved plan of 3d on dev: the month band (C6 HZ-5) at phone width,
  the run notices (a timeout reads «El solver tardó demasiado…», every other transport error its own
  copy, A24), and the «Equidad» panel's columns «Le tocaba», «Tuvo», «Saldo (3 meses)», «En este
  plan», «Queda» — every figure with **one decimal**, computed once from the exact value by C2's
  single formatter («le deben 0.8», A17) — §16: «the «Equidad» panel explains every person's
  numbers, and Frank reads it as correct». A number Frank reads as wrong is S7.
- **Decisions collected** (each has a default, so none blocks; recorded in the worklog and the
  cutover record): parent Q1 (Saturday-only support singers: default no monthly target, numbers shown)
  and Q3 («Exenta» stays in the DL line, D13); A25 / C1 Q1 (services in lookback months cannot be
  toggled from any surface: accepted, revisited here) and C1 Q2 (no uncounted badge); C3 Q-c (copy as
  written); C6's sidebar default («Ambos»); the Step 7 change list; W3 (keep a month or not, knowing a
  kept month's record binds it, W3 row); W1 if pending; the rollback-window criterion (Decision K5).
- **State after:** Frank's go-ahead for W5, or a list of changes that send the plan back to Step 3.

### 5. The flip PR (Cycle F code)

- **Branch:** `claude/solver-v3-c7-flip` from current `main`.
- **Code:**
  - `SOLVER_ENGINE` → `"v3"` in `app/components/admin/solverEngine.ts` (C1's module, parent A1),
    keeping its explicit `"v2" | "v3"` annotation (the TS2367 reason, C6 ENG-1); the pin test changes
    from `"v2"` to `"v3"` in the same commit. A server-side test that asserts C2's resolver's or the
    fairness GET's output against the constant (C2's resolver table, A1: «the constant wins» on
    Production, on `verify/service-readiness` and for an invalid override) may be updated to reference `SOLVER_ENGINE` rather than a literal. **No other
    test may change** — in particular a client render or request test that changes with the constant
    was reading the default engine, which C6 ENG-4 forbids (S8).
- **ADRs** (numbers: next free on `main` at merge; pointers by name until then; renumbered in the
  merge of `main` into the branch if another record lands first):

  | ADR | Status line becomes | «Under v3» section states | Points to |
  |---|---|---|---|
  | 0004 | «Accepted, amended by ADR-0046 and, under v3, by ADR-<second function>» | 1 search worker stands; v3 adds `linearization_level=2`, a deterministic limit per stage with a ≈2.5 s wall guard and a 25 s total budget (S3) | C5's ADR; C5 §7 |
  | 0010 | «Accepted, amended by ADR-0042 and, under v3, by ADR-<horizon>» | Decision 1: a counted special reaches the solver, only as fixed seats; decision 3: a special counts when its toggle says so (default no). C1's dated note becomes the in-force date | C6's horizon ADR; C1 |
  | 0038 | «Accepted, amended by ADR-0046 and, under v3, by ADR-<second function>» | v3 replaces the weighted ladder by sequential stages, each fixed before the next | C5's ADR |
  | 0041 | «Accepted, amended under v3 by ADR-<second function>» | Rules soft per instance in every v3 run; a pinned seat counts as received when its holder is in the line, otherwise it is set aside; pin slack replaced by balances | C5's ADR; C2's ADR |
  | 0042 | (C2 already adds «amended by ADR-<ledger> under v3») + «in force since <flip date>» | Ledger keyed by id; stored eligibility record; 3-month window | C2's ADR |
  | 0046 | «Accepted, amended under v3 by ADR-<ledger>» | Under v3 balances with a denominator replace `history: []`; exact counts generalise to set-asides; v2 keeps this record unchanged | C2's ADR |
  | 0047 | «Accepted, amended by ADR-<horizon> (superseded under v3; v2, the rollback engine, keeps it)» | No solver weeks under v3; the trailing Saturday is a dated service of its month (ADR-0048) | C6's horizon ADR |

  Each «Under v3» section is dated, says v2 (the rollback engine) keeps the original decision, and
  changes nothing above it. `docs/adr/README.md` index rows are updated to match each Status line.
  **One new record** (Decision K6): «The v2 solver stays deployed as the rollback engine» — the flip
  as executed (snapshot → flip → pools, and why that order), the targeted restore, what retires when
  (the «sin Lead» surfaces and C4's script after the rollback window; v2 itself only by a later
  plan), and P4 blocked on v3. Rejected alternatives: pools (or the v2-changing rule edits) before
  the flip; whole-document restore; deleting the v2 surfaces in the flip PR; building P4 on v2.
- **`CLAUDE.md`:**
  - Replace the bullet at `:217-232` with an «Auto runs solver v3» bullet: `SOLVER_ENGINE = "v3"`
    since <date> (ADR-<new>); every Auto reads `GET /api/admin/fairness` fresh for its own horizon and
    refuses on a failed read; carried balances come only from `fairnessLedger.ts` (C2's GU-4 line,
    kept, not duplicated); the record is written before any draft; the override is honoured only on
    the `preview` branch deployment or locally, never on Production or `verify/service-readiness`
    (A1); flipping back is a PR plus the targeted restore (ADR-<new>). The v2
    paragraph follows unchanged in substance, introduced as «v2 is the rollback engine; everything
    below applies only when `SOLVER_ENGINE` is flipped back to `"v2"`», still naming
    `priorMonthLeadVisibility` (removed in Step 12).
  - The `countsForFairness` read rule (C1's line), the `SOLVER_ENGINE` line (C6 DOC-3 or C2 GU-4 —
    one line, never two) and the two-parsers rule: verify present and accurate post-flip; edit only
    a claim the flip made stale.
  - Reusable utils `:472-481`: `loadSolverHistory`'s «P4's `solve_month` calls it» becomes «P4 is
    blocked on a v3 re-baseline (ADR-<new>)».
  - Vercel safety: the Preview override exists for rehearsals only and is normally unset.
- **`docs/SOLVER_AND_INFRA.md`:** the opening of §1 says v3 serves Auto since <date> and §1 describes
  the rollback engine; C5's «Solver v3» section loses «nothing calls the function» and gains the
  **cutover record**: date, flip PR and `main` SHA, function `build` SHA, Step 1's aggregates,
  `FAIRNESS_TOLERANCE`, Step 3e's aggregates (runs, stages proven, misses by code and cause,
  capacity notice yes/no), minimum instances, the private snapshot file names. No names, no
  per-person figures.
- **`docs/SECRETS.md`** (no values, ever): `OWT_SOLVER_V3_URL` — Production now set (W4), what
  breaks without it under v3 in production (`not_configured`), still not needed on
  `verify/service-readiness`, `.env.local`, CI or iOS; `OWT_SOLVER_ENGINE` (C2's entry) — set on
  Preview only for rehearsals, unset since Step 9; ignored by code on Production and
  `verify/service-readiness`, honoured locally when `VERCEL_ENV` is unset (A1) — the entry is
  corrected if it still says otherwise; `OWT_SOLVER_API_KEY` — confirm C5's
  amendment (both functions redeployed on rotation) and add that under v3 a rotation gap now breaks
  production Auto, not only v2.
- **`docs/CI.md`:** read `:14-31` and `:184-263` as left by C0 and C5. If it describes `solver-v3`
  as guarding an uncalled function, or `solver-v2` as guarding production, rewrite that sentence
  (production's engine is now v3's suite; v2's goldens guard the rollback engine); otherwise record
  «verified current, no change» in the PR description.
- **`docs/MCP.md:33-40`** and the P4 plan's Status line (`:3`): «Blocked since <date>: its parity
  target (the browser's v2 request) and its apply order (drafts without an eligibility record) do not
  hold under v3 (ADR-<new>). Re-baseline onto v3 as a new critical plan before any implementation.»
- **Dates in the docs:** every «since <date>» is the planned merge day. If W5 slips past it, a
  docs-only fix commit goes through scoped re-review and `preview` before auto-merge is armed.
- **Gates:** `npx tsc --noEmit`, `npm test`, `npx eslint .` (0 errors); no `gcf*/**` change, so no
  Python gate locally (CI runs both suites regardless, C0).
- **Release up to the PR, not the merge:** fresh code review of the merge range (carrying the
  docs-audit and worklog checklists) → fix → scoped re-review of the fix range and gates re-run on
  the final tree → merge into `preview`, push, verify the dev alias and SHA (dev was already v3 by
  override; now by constant too) → PR to `main`, wait for `gates`. **Auto-merge is not armed in this
  step.**
- **State after:** reviewed, green, unmerged PR; production unchanged.

### 6. Pre-flip preparation

- **W4:** `OWT_SOLVER_V3_URL` on Vercel Production (Frank's yes; value piped from C5's describe
  command). Takes effect at the next production deployment — the flip merge.
- **Restore script** (private, `owt-agent-logs/backups/restore-before-v3-flip-<date>.mjs`, precedent
  `restore-sat-caps-2026-09-29.mjs`): input = the pre-step and post-step snapshot files; it computes
  the step's change set as paths (`sundayLeads`, `saturdayLeads`, and each changed restriction,
  cap, conflict or presence item by `_key`); with `--apply`, reverts **only** paths whose live value
  still equals the post-step value, under `ifRevisionId` of a fresh read, and lists every skipped
  path; never writes `_rev`; never creates or replaces the document; dry run by default; stdout
  carries keys and counts only, names go to a private output file. Reviewed in Cycle F's code review
  (its path given to the reviewer).
- **Pre-step snapshot:** a read-only fetch of the whole `solverConfig` document (every field, `_rev`,
  `_updatedAt`) with `SANITY_API_READ_TOKEN`, written to
  `owt-agent-logs/backups/solverConfig-<YYYY-MM-DD>-before-v3-flip.json` with its SHA-256 printed;
  never into this repository. Taken immediately before W5; its `_rev` must equal Step 3a's unless
  Frank saved since (then he confirms the differences).
- **Freeze agreed with Frank:** from arming the flip until Step 7's verification, nobody runs Auto,
  confirms, «Registra» or saves rules on production or dev.
- **State after:** production unchanged; everything for W5–W8 in place.

### 7. The one step: flip, then pools and rules

Order is fixed (Decision K1): **flip first, pools after**.

1. Arm auto-merge on the flip PR — the exact commit reviewed, re-verified and carried by `preview`
   (W5, Frank's go-ahead). Disarm before any further push to that branch.
2. After the merge: production alias contains the merge commit and `githubCommitSha` equals it
   (one authoritative deployment query; retried ≥ 30 s apart; never a watcher loop, `CLAUDE.md`).
   Not verified → S9: no pools are saved.
3. Frank reloads `/admin` on production: the horizon control appears, «Vista previa: Auto todavía no
   usa este saldo» is gone, WN-1 lists the cadence members not yet in «Líderes Domingo» and WN-3
   flags «Líderes Sábado» — the expected state between 2 and 4.
4. **W6:** Frank applies the Step 4 change list on production — ticks, unticks and the rule edits
   3c decided (all of which change v2's request, so none was saved earlier) — and presses «Guardar
   reglas» once (one save writes pools and rules together, `MonthGenerator.tsx:1755-1761`). WN-1 and WN-3 then show nothing for the cadence members.
5. **Post-step snapshot** (read-only, same format) and the **read-only diff** pre vs post: the change
   set equals the written change list exactly — `sundayLeads` gained exactly the expected cadence
   ids, `saturdayLeads` is empty (or holds exactly what Frank decided at check 0.7), each listed rule
   change and nothing else; `cadenceMembers` → 3 ids, 0 refusals; `cadenceOutsideSundayPool` → empty;
   check 0.5's every-name resolution → 0 refusals (A7).
   Any other difference → Frank corrects it in the UI or W8 reverts the step (S10).
6. The restore script's dry run against the live document plans exactly the step's change set
   (rollback readiness proven); it is not applied.
7. Freeze ends.

- **Why this order:** between 2 and 4 production is v3 with the old pools — degraded but announced
  (WN-1, WN-3; a solve would treat the unticked cadence members as `out`). The reverse order leaves
  production on v2 with the cadence members in «Líderes Domingo» for the length of CI and the deploy,
  where v2 silently schedules them as regular Sunday leads (C3 §6.7). The freeze covers the window
  either way; the chosen order fails loudly if the freeze is broken.

### 8. First production v3 run

- Frank runs Auto on production for the next unplanned month(s), solve first. The agent asks Frank
  for the captured request/response (as in 3d) and repeats 3e's check. Frank confirms when
  satisfied — ordinary admin work, but the first v3 confirm in production: the per-month lines
  (C6 CF-6) show records then drafts; the agent verifies read-only, with the read token (A2), that
  `fairnessMonth.<YYYY-MM>` exists with `source: "auto"`, `engine: "v3"`, `environment:
  "production"` for each confirmed month that was not «anchored, unrecorded». For a confirmed month
  that **was** anchored and unrecorded, the read-back depends on Step 0 check 8's branch: **amended**
  (either form) — none was written (C6 CF-1 (iii); the dialog names it) and the month stays in Step
  10's table; a record found there anyway in the client-only form is the race C6 CF-1 names — it is
  permanent (A5; no route deletes it, C2 WR-13), reported to Frank, and its Step 10 row becomes «v3
  record (race)»; **literal** — the month now has a permanent `source: "auto"` record and leaves
  Step 10's table as «v3 record», which K4's literal branch says happens only when Frank chose to
  include that month. A month kept by W3 is solved with its preview-stamped record (A6) and its confirm
  leaves that record `unchanged` (C6 CF-3).
- A refusal, timeout or transport error (each with its own copy, A24) → no confirm; diagnose; S11.
- **State after:** v3 serves Auto in production (parent §13 «Exit»).

### 9. Remove the Preview override

- Remove `OWT_SOLVER_ENGINE` from Vercel Preview (Frank or the agent on his yes). The value equalled
  the constant, so nothing changes until the next Preview build, and from then on dev follows
  `SOLVER_ENGINE` — a flip back then reaches dev and production alike.
- `docs/SECRETS.md`'s entry already says «unset since» (Step 5); confirm the date in the cutover
  record.

### 10. The reconstruction tail (C4's script, W7)

- **The table** (in the worklog and the cutover record, months and states only):

  | Month | Confirmed under | Record now | Reconstructable from | Dry run | Consent | Applied | Second dry run |
  |---|---|---|---|---|---|---|---|

  Seeded at check 0.4 with every month that holds stored services and was planned under v2,
  including the current month and any later month confirmed under v2 before the flip. «Record now»
  is read with the read token (A2).
- **Rule (A21):** at each month boundary after the flip, before the next v3 Auto, every v2-confirmed
  month that has just become past is reconstructed (October 2026 on or after 2026-11-01): dry run (`--months <m> --out <private dir>
  --preview-run <next planned month>`) → Frank reads the private table, anomalies and balance
  preview → W7 with the plan's fingerprint → second dry run «sin cambios» → the panel shows the month
  «reconstruido». The overrides file (C4 R8) carries any correction Frank makes.
- **The current month at cutover** (Decision K4): default — it stays «sin registro» until it becomes
  past (A21), then is reconstructed like the rest; its seats still feed the DL floor, the spacing
  check and the cadence state through stored data (C2 CAD-2; C5 `prev_dl_leads` and `prior`, A15),
  so only its balances are missing from the first v3 run. Frank may instead record it with
  «Registrar elegibilidad» under v3 right after Step 7 — a `source: "manual"` record that is
  **permanent**: C2 WR-14 row 5 means the reconstruction will never touch it, and A5 allows no
  replacement once the month has stored weekend services or counted specials.
  **How the default holds** depends on Step 0 check 8. **Amended** (either form): by C6's confirm
  (CF-1 (iii)), and by C2's writer too in the server-checked form. **Literal:** only operationally —
  every v3 Auto horizon starts at the first month after the last v2-confirmed one (Step 8's «next
  unplanned month(s)»; HZ-7 refuses only past months, `…-c6-planner-v3-design.md:149`, so the
  current month stays reachable), and a gap in a v2-planned month is filled by hand in «Editar mes»
  (the path C6 ST-5 and CF-10 name, `:160,259`) — provided check 8's sub-check found that path writes
  no record; if it does, Frank accepts that record's permanence or leaves the gap. Including such a
  month in a v3 confirm is then Frank's explicit choice, as permanent as «Registrar» but stamped
  `source: "auto"`.
- A month confirmed under v3 (on dev by W3, or in production) already has a record and is not in
  the table — **unless** it was «anchored, unrecorded» at that confirm (it held v2-planned services).
  What happens then depends on Step 0 check 8: **amended** (either form) — a v3 confirm writes no
  record for such a month (C6 CF-1 (iii)), so it stays in the table and is reconstructed when past,
  like the current month (K4), except a record minted by the client-only race (Step 8), which is
  permanent and marked «v3 record (race)»; **literal** — the confirm wrote a permanent `source:
  "auto"` record from the on-screen config, so the month leaves the table as «v3 record» and is
  never reconstructed (C2 WR-14 row 5).
- **Done when:** every row is «applied», «v3 record» or «v3 record (race)». Then C4's script may retire (Step 12).

### 11. Rollback window

- **Closes** (Decision K5) when Frank declares it, and not before: the first month planned under v3 in
  production has been published, the next v3 Auto has run with that month in its lookback and Frank
  has read its «Equidad» panel as correct, and Step 10's table is complete. Until then the retirement
  PR waits — the safe direction.

### 12. The retirement PR (Cycle R)

- **Branch:** `claude/solver-v3-c7-retire`.
- **Code:** delete `app/components/admin/LeadPoolHistoryPanel.tsx`,
  `app/components/admin/leadPoolHistory.ts`, `app/components/admin/__tests__/leadPoolHistory.test.ts`;
  remove the import (`MonthGenerator.tsx:56`), the `DerivedLeadPoolHistory` wrapper (`:1501-1531`)
  and both v2-branch mounts (`:1736-1746`, `:4490-4499` — line numbers as of `3dbc189b`; C6 may have
  moved them); adjust `MonthGenerator.derivedHistory.test.tsx:236` and the comment at
  `useDerivedSolverHistory.ts:6`. The «Historial» block and the derived-history read stay (v2 code,
  non-goal). Under the v2 engine the planner then renders without «sin Lead» — stated in ADR-<new>.
- **C4 R22:** `assertRetiredWriter()` as the first statement of
  `scripts/reconstruct-fairness-months.mjs`, its entry moved to `RETIRED_ONE_SHOT_WRITERS`
  (`app/utils/protectedReadAudit.ts:307`), its name added to `RETIRED_WRITER_NAMES`
  (`scripts/lib/sr-retired-writer.mjs`), and `docs/SOLVER_AND_INFRA.md` «Retired writers» heading
  count and table updated (`:580-590` warns both drift).
- **Docs:** `CLAUDE.md:228` loses the `priorMonthLeadVisibility` clause; `docs/SOLVER_AND_INFRA.md:162`
  and `docs/UTILITIES_AND_COMPONENTS.md:196` lose the panel; ADR-<new> gains the retirement date.
- **Gates and release:** as Step 5, then auto-merge on the reviewed commit, production alias + SHA.

### 13. Close each cycle

- `finish-cycle` after Step 9 (Cycle F) and after Step 12 (Cycle R): gates with real results; the
  fresh code review carrying the docs-audit and worklog-completeness checklists; HR only if a week has
  passed since its last entry; deploy verification (dev and production alias + SHA); the report.
- Worklog: one entry per dispatch (reviewers, deploy checks), `coordinator-inline` for Steps 0, 3e,
  7.5 and 10's checks done inline, batched at close; the last entry before each merge is a
  verification. Frank's consents are cited by date in the entries, never paraphrased into approvals
  they were not.

## Data and failure safety

- **Identity and source of truth.** Engine: `SOLVER_ENGINE` on `main` (Production and
  `verify/service-readiness` ignore the override by code, A1). Rules: the one `solverConfig` document; the snapshots are evidence, never a
  source. Eligibility: `fairnessMonth` records (C2). Seats: role documents.
- **Migration and compatibility.** None; every field C7 relies on is optional or defaulted by its
  child. A tab opened before the flip deploy and used after it gets the 409 «El solver cambió de
  versión mientras planeabas…» (C6 RT-1/AD-8) or C2's `engine_not_v3` — never a mixed solve.
- **Partial failure.** Flip merged but alias not verified → no pools saved (S9); production is v3 with
  the old pools, announced by WN-1/WN-3; retry the deployment check, then decide flip-back (removing
  the Preview override first if Step 9 has not run, Rollback line 1). Pools
  saved wrong → correct in the UI or W8. A reconstruction apply that stops mid-run → C4 R16 (re-run
  the dry run before any repair).
- **Concurrency.** The freeze (Step 6) and `ifRevisionId` on every scripted write; the UI save is
  revision-asserted by the route. The rehearsal's `_rev` reference detects a concurrent save (S6).
- **Data preservation.** Nothing is deleted except, optionally and with consent, reconstructed
  records (W10) and drafts Frank chooses to delete after W3. Records written under v3 survive a
  rollback, inert under v2, and are valid again on a later flip forward.

## Verification

| Requirement | Test or check | Failure it detects |
|---|---|---|
| §16 «every stage probado within the budget on the real container, cold start included» | Step 1 aggregates; Step 3e on captured responses; 3d.4 cold end-to-end | Capped stages, wall-guard stops, route aborts |
| §16 DL floor or capacity notice | Step 3e `missed[]` rule | A regular silently two months without a Sunday |
| §16 cadence on/off, compensation | Step 3e `cadence[]` rule | A cadence member doubled or skipped; compensation lost |
| §16 caps, consecutive, voice floor, 0 hard violations, pins honoured | Step 3e; C5's independent checker | Protections missed or a seat for someone ineligible |
| §16 «Equidad» explains every number; Frank reads it as correct | Step 4 Frank's look (one decimal, A17); carried = GET balance check (3e) | A ledger/solver disagreement, a misleading reason line |
| A23: C5's Run A re-checked with C6's real request builder | Step 3e on the captured requests, compared with C5's recorded aggregates | A gap between C5's private converter and the real builder |
| A7: every rule name resolves to exactly one member | Check 0.5; 7.5 | Every v3 Auto refused, or a rule applied to the wrong person |
| §16 flipping back restores v2 | Step 3f on dev; restore dry run (3f, 7.6) | A rollback path that does not work when needed |
| Parent R9 (v2 until Frank approves) | W5 gated on Frank's go-ahead; constant pin test | An unapproved flip |
| E4 one step after a snapshot | Pre-step snapshot `_rev` vs 3a; post-step diff (7.5) | Unrecorded or extra changes to the shared rules |
| D9 Saturday-only pool empty; cadence in Sunday pool | Check 0.7; 7.5 `cadenceOutsideSundayPool` empty | A cadence member `out` every month; a forgotten anchor |
| L6 every v2-confirmed month reconstructed | Step 10 table complete; second dry runs «sin cambios» | A lookback month silently counting for nothing |
| Docs current in the same delivery | Code review's docs-audit checklist; `adrIndex.test.ts` | Stale «nothing calls v3», wrong ADR numbers, missing SECRETS status |
| Names stay out of the repo | Review of each diff; private paths only | Member data in a public file |

## Rollout, observability, and rollback

- **Release sequence:** Steps 0 → 1 → 2 → 3 → 4 → 5 → 6 → 7 → 8 → 9; Step 10 recurs; Steps 11 → 12
  later.
- **Signals proving success:** production alias + SHA of the flip; the first production v3 confirm's
  record stamped `engine: "v3"`, `environment: "production"`; Step 3e/8 checks clean; Frank's reading
  of the panel; Step 10's table complete.
- **Stop conditions** (stop, report, wait for Frank):
  - **S1** an entry check false;
  - **S2** the timing gate fails after its bounded remedies;
  - **S3** any rehearsal `ok: false` other than a `timeout` that a retry clears, any handshake
    failure, or an unexplained transport error;
  - **S4** any Step 3e check failing, or `|planned − share|` above `fairness.tolerance`;
  - **S5** a lookback month other than those of 3g reads «sin registro»;
  - **S6** `solverConfig._rev` changes during the rehearsal or the freeze without Frank's save; or any
    record or draft written on dev that was not W3;
  - **S7** a number Frank reads as wrong, or a defect traced to a child — fixed in that child's code by
    its own PR and review, then the rehearsal resumes from 3d;
  - **S8** the flip changes any test other than the constant's pin and the server-side resolver/GET
    assertions Step 5 allows;
  - **S9** the production alias does not serve the flip commit;
  - **S10** the post-step diff differs from the change list;
  - **S11** the first production v3 run cannot produce an acceptable plan for the next month before
    the team's planning date — Frank decides between a fix and the rollback;
  - **S12** any step would place a member name or per-person figure in this repository.
- **Rollback** (until Step 11 closes the window; each line its own consent):
  1. Flip-back PR: `SOLVER_ENGINE = "v2"` and its pin, release discipline as Step 5, `preview` first,
     W9. If Step 9 has not run yet (a rollback triggered by S9–S11), `OWT_SOLVER_ENGINE` is removed
     from Preview **before** the flip-back reaches `preview`, so its build follows the constant and
     dev never stays on v3 while production returns to v2.
  2. W8: the restore script reverts the one step's paths that nobody has edited since; anything
     skipped is shown to Frank, who decides it in the UI.
  3. Records and drafts written under v3 stay (inert under v2). Optionally W10 for reconstructed
     records — normally not, since they are harmless under v2 and needed on the next flip.
  4. ADR-<new> and the «Under v3» sections gain a dated «rolled back» note; `CLAUDE.md` and
     `docs/SOLVER_AND_INFRA.md` say v2 serves Auto again — in the flip-back PR itself.
- **Restoration verification:** production alias + SHA of the flip-back; a read-only diff of the live
  document against the pre-step snapshot shows only paths Frank chose to keep; Frank runs a v2 Auto on
  dev without confirming and sees v2's diagnostics and «sin Lead»; the fairness GET reports
  `engine: "v2"` and the «Vista previa» banner is back.
- **After Step 12** a rollback still flips the engine, but the planner under v2 has no «sin Lead»
  panel; restoring it would be a revert of the retirement PR (ADR-<new> says so).

## Decisions

| ID | Decision | Choice | Why | Tradeoffs | Owner |
|---|---|---|---|---|---|
| K1 | Order inside «the one step» | Flip merged and verified, then Frank saves pools and rules | v3 with old pools is announced by WN-1/WN-3 and solves nothing silently wrong; v2 with the cadence members in «Líderes Domingo» schedules them as regular Sunday leads with no warning (C3 §6.7, v2's anchor `owt_solver_v2.py:1096-1100`) | A short window of «v3 with old pools» under a freeze; Frank must be available right after the merge | Claude (Parent issue 5) |
| K2 | Who saves the rules in the step | Frank, in the production UI | C3 §5 («No agent saves rules on production»); the UI goes through the version guard and the one serializer | Manual; mitigated by the written change list and the read-only diff | C3 |
| K3 | How a rollback restores `solverConfig` | A private, targeted revert of the step's own paths, skipping any path edited since, under `ifRevisionId` | A whole-document restore discards every rule edit made after the flip, re-mints nothing it should and bypasses C3's serializer; the precedent scripts do exactly this kind of targeted, consented patch | One private script to review; not literally «restore the snapshot» (Parent issue 2) | Claude |
| K4 | The current month at cutover | Default «sin registro» until past, then reconstructed; «Registrar» only if Frank chooses, knowing it is permanent. Held by C6 CF-1 (iii) if the parent amends L3/U4/A6 (C6 PI-7), by C2's writer as well if the ruling adds WR-8's server check, and only operationally (horizons start after the last v2-confirmed month) if the parent keeps its literal text — Step 0 check 8, Step 10 | Keeps one reviewed inference method for every v2-planned month; the DL floor and cadence still see its seats | The first v3 run's balances miss one month; in the literal branch the default rests on Frank's horizon choice, not on code | Frank (non-blocking, default stated); the branch is the parent's owner's ruling |
| K5 | When v2-only surfaces and C4's script retire | After a rollback window Frank closes, criterion in Step 11 | Parent §16 makes «flip back restores v2» an acceptance line; C4 R22 ties retirement to the same window | The panel lives on unused for a few weeks | Claude (Parent issue 3) |
| K6 | ADRs | Seven amendments plus one new record («The v2 solver stays deployed as the rollback engine») | The four new records the parent lists are owned by C2, C3, C5, C6; C7's own rejected alternatives (order, restore, retirement timing, P4) meet the ADR bar — a competent person would otherwise delete v2 as dead code or build P4 as approved | One more record to number | Claude (Parent issue 1) |
| K7 | MCP P4 | Leave `solve_month` unbuilt; mark the plan and `docs/MCP.md` blocked with the reason | P4's approval rests on parity with the v2 browser request and an apply order that writes drafts with no record (against L3/U4); a re-baseline changes its critical contracts, so it is a new critical plan, not a cutover step | MCP planning stays unavailable until that plan exists | Claude (parent §10 allows either) |
| K8 | Where snapshots, diffs, captures and the restore script live | `owt-agent-logs` (private) | They contain names, availability and per-person figures; precedent `owt-agent-logs/backups/` | The restore script is reviewed by path, outside the repo diff | Claude |
| K9 | Cold start remedy | W1 before any code (a warm-up ping is a C6 change) | C5 §13 order; no code in the release path | A monthly cost if needed | Frank |

## Assumptions

Numbered `AS*` so they never read as the parent's amendments `A1–A26`.

| Assumption | Impact if false | Validation point | Failure response |
|---|---|---|---|
| AS1 The dev-verify bot can open `/admin`'s Servicios planner and read `GET /api/admin/fairness` | Step 2/4 visual checks need Frank's eyes instead | First Step 2 run | Frank's own look covers it; note it in the cutover record |
| AS2 Frank can save request/response bodies from the browser's network panel | 3e has no captured data | Step 3d first run | Frank reads the notices and panel only; 3e reduced to what the UI shows; the cutover record says so |
| AS3 C5's independent checker can be driven with a captured request/response pair (C5-R15 promises it) | 3e needs a private wrapper | Step 3e | A private wrapper in `owt-agent-logs` calls the checker's functions |
| AS4 Only cadence members are in «Líderes Sábado» at the flip | Emptying it would stop someone leading | Check 0.7 | Frank decides per person (WN-3 semantics) |
| AS5 No other admin runs Auto or saves rules during the freeze | A concurrent save between snapshot and step | `_rev` checks (3a, 6, 7.5) | Re-snapshot; Frank reconciles; S6 |
| AS6 The flip lands before the next month is confirmed under v2 | More months in the reconstruction tail; thinner lookback for the first v3 runs; each such month is «anchored, unrecorded» and not past, so in Step 0 check 8's literal branch more months rest on K4's operational control | Check 0.4 | Not a stop: the tail absorbs it; Frank may wait to flip |
| AS7 The team's planning date leaves room for the rehearsal and the flip | Pressure to skip steps | Step 0 calendar | Plan the next month under v2 and flip after it; the tail records it |

## Open questions

None blocking. Non-blocking, with bounded defaults:

| Question | Why it matters | Recommendation and why | Tradeoffs | Owner | Blocking? | Resolution point | Bounded default |
|---|---|---|---|---|---|---|---|
| Minimum instances for `owt-solver-v3` | Cold-start latency vs monthly cost | Decide from Step 1's cold runs | Cost | Frank | No | Step 1 | 0, as v2 |
| Keep a rehearsal month (W3)? | Saves re-planning; writes production from dev | Only if Frank reads the month as final | A preview-stamped record | Frank | No | Step 4 | No |
| Current month at cutover (K4) | One month's balances in the first v3 run | Default as K4 | Permanent manual record if «Registrar» | Frank | No | Step 7 | «sin registro» until past |
| Rollback-window criterion (K5) | When v2-only surfaces go | As Step 11 | Longer coexistence | Frank | No | Step 11 | Open until Frank declares |
| Parent Q1, Q3; A25 / C1 Q1, Q2; C3 Q-c; C6 sidebar default | Deferred to «C7's look» by their owners (C6 PI-5's transport copy is settled by A24) | Each owner's default | — | Frank | No | Step 4 | Each owner's default |

## Parent issues

1. **§9's «New» ADR row and the C7 row («ADRs») overlap the children.** The ledger and record (C2
   GU-3), the cadence (C3 §12), the second function (C5 §14), the engine switch and the horizon with
   stored services as fixed services (C6 DOC-2) are each written by their child. **Recommended fix:**
   the C7 row reads «the seven amendments of §9 and the cutover's own record»; §9's «New» row names the
   owning child of each. Followed meanwhile: K6.
2. **E4's rollback «restore `solverConfig` from that snapshot» would discard rule edits made after the
   flip** and bypass C3's one serializer if done as a whole-document write. **Recommended fix:** «revert
   the paths the one step changed, skipping any edited since, under a revision check; the snapshot is
   the evidence». Followed meanwhile: K3.
3. **The C7 row retires «sin Lead» in the cutover, but §16's last bullet requires a flip back to
   restore v2 behaviour.** Deleting the v2 surfaces in the flip makes that rollback incomplete.
   **Recommended fix:** «retire «sin Lead» after a rollback window Frank closes». Followed meanwhile:
   K5, Step 12.
4. **A22 says the single flip step covers «only moving the pools and flipping the constant», but the
   rule edits v3 needs are not inert under v2 either.** Removing an exact `Sun.Lead` count on a
   cadence member (A11 refuses it under v3) or a `Sun.Lead` exclusion that makes her `out` every
   month (A14) each changes v2's solve request, so neither can land before the flip without changing v2's output; and the UI writes pools and rules in
   one save (`MonthGenerator.tsx:1755-1761`). **Recommended fix:** A22 reads «…covers moving the
   pools, the rule edits the rehearsal found v3 needs that change v2's request, and flipping the
   constant; rule edits inert under v2, like «Mes por medio», may precede it». Followed meanwhile:
   3c, W6, Step 7.4.
5. **E4 calls the pool move and the flip «one step» without ordering them, and the C7 row lists them
   pools-first.** They are two writes that cannot be atomic (a merge and deploy; a Sanity save), and
   the order decides which wrong state the gap between them shows: v2 with the cadence members in
   «Líderes Domingo» and an empty «Líderes Sábado» silently schedules them as regular Sunday leads and
   loses its Saturday anchor (C3 §6.7; `gcf/owt_solver_v2.py:1096-1100`), while v3 with the old pools
   announces itself (WN-1, WN-3).
   **Recommended fix:** E4 adds «flip first; once production serves v3, save the pools» or leaves the
   order to C7 explicitly. Followed meanwhile: K1.
6. **The rollback does not say what happens to records and drafts written under v3.** **Recommended
   fix:** «they stay; records are inert under v2 and valid on a later flip». Followed meanwhile:
   Rollback line 3.
7. **L3, U4 and A6 conflict with A21 for a month that holds stored weekend services or counted
   specials and has no record** (the current month at cutover, and any month confirmed under v2
   before the flip). Read literally, L3 («Written by Auto's confirm under v3 only, before any
   draft», `…-fairness-design.md:294-295`), U4 (`:326`) and A6's «Otherwise … the confirm replaces
   the record» (`:127`) have a v3 confirm that drafts into such a month write a permanent
   `source: "auto"` record from today's on-screen pools, while A21 (`:142`) says that month reads
   «sin registro» until past and is then reconstructed. C6 raised it as PI-7
   (`…-c6-planner-v3-design.md:696`) and holds its CF-1 (iii) as a deviation pending it; C2's
   writer creates in that case today (WR-8 row 3, `…-c2-ledger-and-record-design.md:138`).
   **Recommended fix:** the amendment C6 PI-7 words, **with** C2 WR-8's server-side refusal of a
   `source: "auto"` create on a month with freezing services, so the rule does not rest on one
   client. The ruling is the parent's owner's; C7 only depends on it. Followed meanwhile: Step 0
   check 8 and the two branches of K4, Step 8 and Step 10.

Resolved by the amendments and removed from this list: «Mes por medio» inside the step (A22, A26);
L6's re-runs for months not yet past (A21); the rehearsal's «sin registro» lookback months (A21).

## Handoff

- **Prerequisites this plan needs before Step 0:** the parent's ruling on C6 PI-7 (Parent issue 7)
  and the matching state of C2 WR-8 and C6 CF-1 (iii) on `main` (Step 0 check 8).
- **Prerequisites supplied to later work:** a production running v3; the reconstruction table; the
  snapshots and the restore script; P4's blocked status with its reason (input to any future P4
  re-baseline); ADR-<new> as the starting point for any plan to retire v2.
- **Outputs promised:** the flip PR, the cutover record, the env changes recorded in
  `docs/SECRETS.md`, the retirement PR, two `finish-cycle` reports and their worklog entries.
- **Review order:** last of the program (parent «Review handoff»: C0, C1, C3, C2, C4, C5, C6, C7).
  Standard tier: self-review, then a fresh code review of each PR's diff; no adversarial plan review.
  A material change to a child's interface listed under «Consumes» after this plan is reviewed
  restarts this plan's review.
- **Implementation authorization: not granted by this plan.** Each production write additionally
  needs its own consent (W1–W10).

## Terminal state

`READY_FOR_REVIEW`
