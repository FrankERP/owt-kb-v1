# AGENTS.md — OWT Worship Team app (owt-kb-v1)

Internal app for the Oasis Worship Team: song library, weekly setlists, team
role assignments, member availability, and proposals. **Spanish-language UI.**

**This file is the index** — one or two lines per rule, because it is loaded into every
session and nearly every subagent. The long form (rationale, incident history, exact guard
behaviour) is [`docs/agents/project-rules.md`](docs/agents/project-rules.md) under the same
headings: **read the matching section there before changing code a rule governs.** When a
rule changes, change both; if they disagree, this file wins.

## Stack & commands
- Next.js 16 (App Router; `proxy.ts` = middleware), React 19, Sanity v5 (`next-sanity`),
  Tailwind, NextAuth v4, Fuse.js. Node 22. Dark and light themes (device by default, pinnable
  at `/me`). Studio embedded at `/studio`. iOS app via Capacitor.
- **Before claiming done, these must pass:** always `npx tsc --noEmit`, `npm test` (vitest)
  and `npx eslint .` with **0 errors** (warnings are a deliberate backlog — see
  `eslint.config.mjs`); plus the solver suite of each tree the change touches — `gcf/**`:
  `python -m unittest discover -s gcf -t gcf`; `gcf_v3/**`:
  `python -m unittest discover -s gcf_v3 -t gcf_v3`. All five are blocking CI gates (a PR
  that touches neither `gcf/` nor CI skips `solver-v2`; `gates` vouches — ADR-0064). Add
  tests for testable pure logic.

## Conventions
- Work on a branch. **`main` is protected and takes NO direct pushes** — only a PR whose
  `gates` check is green (`.github/workflows/ci.yml`; protection applies to admins too;
  `docs/CI.md`). `preview` takes direct pushes; CI runs there but does not block.
- **Release order — always, without being asked:**

      implement → gates green → code review (§Review policy) → fix → gates on the final tree
      → merge the branch into preview, push, VERIFY the dev alias moved
      → PR to main, wait for `gates` → merge (= the production release) → verify the prod alias

  `main` auto-deploys to **production** (`owt-backstage.vercel.app`, the app the team uses),
  so `preview` goes first: the PR gate proves the code passes, never that it looks right on dev.
- **Auto-merge** (`gh pr merge <n> --auto --merge`, allowed since 2026-09-29) approves a
  COMMIT: arm it LAST, on the exact commit that cleared §Review policy, verified and seen on dev.
  `gh pr merge <n> --disable-auto` BEFORE pushing anything else to that branch. No merge
  queue: a PR left out of date by `strict` waits until someone updates it.
- **Cloud sessions are the default place to work** (2026-10-22): each thread is its own
  container — no worktrees, no `.env.local`. Before the gates: `npm ci`; for a solver suite
  `python3.12 -m venv .venv && .venv/bin/pip install -r gcf_v3/requirements.txt` (and/or `gcf/`),
  then run the suite with `.venv/bin/python` (the system `python` is 3.13 and refuses global
  installs). Keys reach a session only as network secrets the proxy injects (`docs/SECRETS.md`),
  never as readable variables. The long form lists what still needs the Mac. The solver is
  verified/re-deployed via `solver-v3-ops.yml` (ADR-0079): ask Frank before dispatching `deploy`;
  **never approve, reject or bypass a pending deployment**, nor change its environments or the WIF
  setup without his OK — the session acts as `FrankERP`, so this rule is the only gate.
- **On the Mac — worktrees only when two things must be in flight at once** (`Agent` with
  `isolation: "worktree"`, or `EnterWorktree` — never a hand-rolled `git worktree add`; code
  review needs none). `node_modules` via APFS clone (`cp -Rc`) from the primary checkout — never a fresh install.
  **Symlink `.env.local`** (`ln -s ../../../.env.local .env.local`) — never write a real one in
  a worktree: `git worktree remove` destroys it silently (how `DEV_VERIFY_*` was lost).
  `git worktree remove` is part of the merge step; `git worktree prune` at cycle open.
- Conventional commits (`fix(scope): …`), body explains the *why*. **Never** add AI/Claude
  attribution or `Co-Authored-By` trailers.
- **Keep docs current in the same delivery** — behaviour, verification counts, branch/commit
  and deployment state; remove stale "not released"/"preview only" claims as a release advances.
- **Production Sanity writes need explicit user consent** — dry-run first (one-off scripts in
  `scripts/`, guarded by `--apply`, run with `node --env-file=.env.local scripts/<name>.mjs`).
  Diagnosing ≠ consent to write.
- **Any new secret or env var gets an entry in `docs/SECRETS.md`** in the same change: which
  platforms need it (and which don't), where the value came from, how to rotate it, what
  breaks mid-rotation. Never the value itself.

## Review policy (2026-10-07)
Reviews were 590 of the ~940 subagent dispatches between 2026-09-08 and 10-07 — 1.7 per
implementation dispatch. The diff review is the layer that catches implementation bugs, so
the budget goes there, once.
- **One fresh code review per merge range**, by ONE `code-reviewer`, before the merge to
  `main` — the same dispatch carries the docs-audit checklist (`finish-cycle`).
- **Fixes:** every fix re-runs the gates on the final tree. A **scoped re-review** (one agent,
  the fix range only) only when the fix closes a **HIGH** finding: a production writer's
  correctness, data loss, auth/security, a notification audience. Any other fix: gates plus
  the author's own re-read of the fix diff, said so in the PR. A third round needs Frank.
  The last step before a merge is still a verification (that gates re-run, or the HIGH
  re-review), never a fix.
- **No per-task reviewers** when executing a plan (`subagent-driven-development`'s spec and
  quality reviewers, any `task-reviewer`): the merge-range review covers the tasks. Exception:
  a task that itself owns a critical contract.
- **Plans: no adversarial plan review for standard work** — spec self-reviewed, then Frank.
  **Critical contracts only** — a production/server writer or mutation trust boundary, a
  destructive or full-array serializer, an auth/security/ACL/secret boundary, a schema/data
  migration, a multi-document transaction/concurrency/recovery protocol, an irreversible
  remote release action — use `.agents/skills/adversarial-plan-review/SKILL.md` on the slice
  that owns the contract: reviewers one at a time, binding churn cap (two rounds with verified
  blockers → stop; a third needs Frank's go-ahead in advance), a committed
  `<plan>-review-log.md`. Incidents are not exempt: a mid-fire change to a production writer's
  concurrency, batching or deletion needs ≥1 fresh `APPROVED` on a one-paragraph hypothesis.
- **No review fan-out:** a review, re-review, reconcile or "preflight" never runs as a
  multi-agent Workflow.

## Token economy
- **Workflows only for genuinely parallel, independent work.**
- Subagent briefs name the files and the question; reports return conclusions, not dumps.
  Pipe long command output to a file and read the part you need.

## Vercel safety
- Canonical project: `frank-rochas-projects/owt-backstage`
  (`prj_elS88VGezKpy18wizFN1ffoy8cJ5`). Never create or automatically select another. Before
  any Vercel command that may link, deploy, alias or mutate, verify `.vercel/project.json`
  matches; if not: `vercel link --yes --project owt-backstage --scope frank-rochas-projects`
  and verify the resulting ID. Never automatic `--yes` linking through `vercel`,
  `vercel deploy` or `vercel curl`.
- **Two branches deploy, both real:** `preview` → `dev-owt-backstage.vercel.app` (owned
  **exclusively** by `preview` — update dev only by merging into `preview`), `main` →
  production. No staging branch.
- **Only `main`, `preview` and `verify/service-readiness` get a deployment** — `vercel.json`
  `git.deploymentEnabled` (`"**": false` + those three, ADR-0068) creates nothing for any other
  ref, and `ignoreCommand` → `scripts/vercel-ignore-build.mjs` is the fail-open belt. A `claude/*`
  push proves nothing. Guard: `deployBranchPolicy.test.ts`; quotas and the deliberate-build hatch:
  `docs/CI.md`.
- **Verifying a deploy means checking the ALIAS:** the target domain is in the deployment's
  `alias` and `meta.githubCommitSha` is the pushed commit. A `● Ready` build proves only that
  it compiled; HTTP checks prove nothing (SSO answers `302`). Builds take ~90 s: one
  `get_deployment(domain)` query (Vercel MCP) or the `deploy-verifier` agent, retried a few
  times ≥30 s apart. **Never a hand-rolled bash watcher.** If something must block:
  `npx vercel inspect <deployment-url> --wait --timeout 5m` — never on the stable domain (it
  answers with the OLD deployment) — then still the alias+SHA check.
- **Agents may look at dev** with `scripts/dev-verify.ts` (read-only, as «Verificador (bot)»)
  once `docs/DEV_VERIFY.md`'s three verified runs are recorded — use it for the human-eyes
  step when the change is visual; it is not Frank's own look.
- **`preview` writes to the real Sanity dataset** — a rehearsal of the UI, never a dry run of data.
- **`OWT_SOLVER_ENGINE` on Preview is for rehearsals only and normally unset** (branch-scoped to
  `preview` while set; Production and `verify/service-readiness` ignore it). See `docs/SECRETS.md`.
- **Functions run on Fluid compute in `iad1`**, both pinned in `vercel.json` (ADR-0074): concurrent requests share
  one instance, so module-level state must be safe to share. Sanity lives in Europe; read the ADR
  before moving the region. A server module that spawns a process gates it on
  `NODE_ENV === "production"` or the tracer packs the whole repo (`functionTraceGuard.test.ts`).
- **Preview email reaches one address only because `EMAIL_REDIRECT_TO` is set** on Preview
  (since 2026-07-24): a publish on dev does not notify the team, and clearing that variable
  makes preview mail the whole team. Check `vercel env ls preview`. Production has no redirect.

## Decision records
A choice that rejects a real alternative for a reason the code won't show (a pin that looks
arbitrary, code that looks like a bug but isn't, something deliberately *not* done, an upgrade
tried and reverted) gets a short ADR in `docs/adr/` (README: bar and template), linked from
what it governs. Not for routine work. **Read the relevant ADR before "fixing" something that
looks wrong** — several exist to stop a plausible-looking change.

## Don't-break-these invariants
- **Timezone = America/Mexico_City.** Service dates are Sanity `date` (`YYYY-MM-DD`), rendered
  at local noon: `new Date(iso.slice(0,10)+"T12:00:00")` — never bare `new Date(iso)`. Server
  today: `new Date().toLocaleDateString("sv",{timeZone:"America/Mexico_City"})`. «Hoy/Ayer» and
  countdown labels: calendar-day diff at local noon, not elapsed hours.
- **`saturdarSongs`** (Saturday setlist) is a deliberate typo — **do not rename**, it would
  orphan data. Sunday setlist = `featuredSongs`.
- **Five member-referencing seats** on role docs (`sunday_role`/`saturday_role`/`special_role`):
  `Lead[]._ref`, `BGVs[]._ref`, `Chorus[]._ref`, `instruments[].person._ref`,
  `foh_team[].person._ref`. Every "who serves" query covers all five — reuse
  `assignedMemberRefsQuery()` (`app/utils/notifyTargets.ts`).
- **A special's `time` (`"HH:mm"`) is display and sort only — never identity** (identity =
  `date` + normalized `service_name`, ADR-0011; never combined into a `Date`).
  `isServiceTime`/`compareServiceTime` (`app/utils/serviceTime.ts`) are the only validator and
  comparator under `app/**`; the Studio mirror is guarded by `serviceTimeSchemaSync.test.ts`.
  Same-day sets are created in `/admin` stored mode; the month CREATE flow drafts one special
  per date on purpose (E19 in `plannerModel.ts`) — do not re-key it.
- **A «Noche de alabanza» is `special_role.format = "worship_night"`, set once at creation** —
  never a fourth role type, never set or unset by PATCH (ADR-0036). Song leaders
  (`songs[].leads`, one or two) must be in the set's Lead (the setlist PUT refuses others under
  the role `_rev` it asserts; approval carries them over by song reference); proposals and
  weekend setlists never carry them. `serviceFormat.ts` and `songLeads.ts` are the only definitions.
- **`countsForFairness`: one read rule** (`app/utils/countsForFairness.ts`); PATCH absent =
  unchanged; a PATCH that changes nothing reportable queues no notice; `ROLE_PROJECTION` does
  not carry it; the planner Switch is disabled for a past CDMX month (client-only, C1-D7).
- **Draft gating:** member-facing **worship** reads filter `published != false` (absent =
  visible). **Every `kidsSchedule` read under `app/**` uses `published == true`**, manager
  reads included (ADR-0022), except its two draft editors (`utils/kidsScheduleReads.ts`, the
  planner page's `"schedules"` projection). Guard: `draftGatingCoverage.test.ts`.
- **Sanity array-of-object writes need a `_key` per item.**
- **`solverConfig`:** saves carry `SOLVER_CONFIG_VERSION`; the rules POST refuses any other
  (`app/utils/solverConfigWriteRequest.ts`), and a field or allowed value an older client would
  drop bumps it (`solverConfigVersion.test.ts`). No writer sets a rule value around
  `solverConfigFromDocument` → `parseSolverConfigWrite` → `solverConfigFields` under
  `ifRevisionId` (the only targeted writers: the member DELETE's pool patch, the rule-name
  repair script). One `==` count per person per role key (`exactCapOverlaps`; C2). ADR-0049.
- **The fairness ledger has one definition, and its records one writer** (ADR-0050).
  `app/utils/fairnessLedger.ts` is the only TS definition of F2–F7 and X1;
  `fixtures/fairness/golden.json` is asserted by vitest and `gcf_v3/tests/test_golden.py` and
  is hand-computed — never regenerated from output. `fairnessMonth` is mutated only through
  `executeFairnessMonthWrites` (`fairnessMonthCommit` — the PUT and the MCP's `apply_schedule` —
  or C4's consented reconstruction script; never `createOrReplace`; the reconstruction actor's guarded delete is the only delete). Every reader carries `SANITY_API_READ_TOKEN` or fails
  closed — the dotted ids are private, and an untokened read answers «no record» with no error.
  Balances count from `FAIRNESS_BALANCE_START` (`2026-11`, ADR-0055), passed only by
  `assembleFairnessLedger` (the GET's and the editor's month check's one call); an
  earlier month still feeds who is listed and `firstRecordedIn` (its record) and «Mes por medio» (its seats).
- **Cache:** admin/API routes that mutate content call the matching `revalidate*`
  (`app/utils/revalidate.ts`) or `revalidatePath`, or the ISR page stays stale.
- **Auto runs solver v3** (`SOLVER_ENGINE = "v3"` since 2026-10-15, ADR-0056): every Auto reads
  `GET /api/admin/fairness` fresh for its own horizon and refuses on a failed read; carried
  balances come only from the ledger (above); the confirm writes the eligibility records before
  any draft. The override `OWT_SOLVER_ENGINE` is honoured only on the `preview` branch deployment
  or locally, never on Production or `verify/service-readiness`. Flipping back is a PR plus the
  targeted `solverConfig` restore (ADR-0056).
  **v2 is the rollback engine; everything below applies only when `SOLVER_ENGINE` is flipped back
  to `"v2"`:** Auto sends NO fairness history (`SOLVER_SENDS_HISTORY = false`, ADR-0046):
  `history: []`, no read at solve time. An exact rule (`Sun.Lead == 2`) takes that member out of
  that role's band; a `>=` floor stays in. Only if that switch flips back too: history is derived
  for the target month on every Auto (never `localStorage`, never cached — ADR-0042), a failed
  read refuses the solve, no panel (`priorMonthLeadVisibility`) is handed `[]` as a stand-in, and
  `owt_solver_history_v2` is written only on confirm. The Historial chips are read-only.
- **Two solver parsers, never crossed (solver v3 C6, U8):** client branches read the server-resolved
  `engine` prop, never `SOLVER_ENGINE`; a v3 answer goes only through `v3SolveResponse.ts`, a v2 one
  only through v2's parsers; v3 copy only in `v3Copy.ts`; no rule key on the wire, a line or a log.
- **Client mutation handlers** wrap `fetch` in try/catch/finally, check `res.ok`, reset their
  loading flag, and never close-as-success on failure.
- **`/api/cron/*` stays excluded from the `proxy.ts` matcher** (those routes check
  `CRON_SECRET`); the matcher is duplicated byte-identical in `app/utils/routeMatcher.ts`
  (`routeMatcher.test.ts`). So is **`/api/calendar/*`**, the member calendar feed: its handler
  verifies the HMAC with ZERO I/O before any Sanity read, and nothing in it may move a read ahead
  of that check (ADR-0057).
- **Notification emails: `before` is captured PRE-COMMIT** and threaded into `after()` (or
  awaited inline by the MCP saved-service save, `queueRoleNoticesNow`) — reading live state there
  sends nothing (`docs/NOTIFICATIONS.md`).
- **A Server Component may never CALL a value imported from a `"use client"` module**
  (rendering it as JSX or forwarding it as a prop is fine). It took `/` down for 56 minutes
  (ADR-0028); no gate sees it except `clientBoundary.test.ts`.
- **Impersonation banner ↔ navbar:** `ImpersonationBanner` publishes `impersonating` and its
  MEASURED `--impersonation-h` on `<html>`; `brand.css` offsets `.brand-navbar`; everything
  sticky or scroll-margined under the navbar adds `var(--impersonation-offset)` (never
  `--impersonation-h` itself, which is never 0). Guard:
  `impersonationOffsetSync.test.ts`.
- **The phone tab bar publishes its MEASURED `--bottom-nav-h`** plus `has-bottom-nav` on
  `<html>`. Fixed-bottom elements clear it: toasts use
  `max(env(safe-area-inset-bottom), var(--bottom-nav-h, 0px))`; elements flush on the bar (the
  audio transport, the song FAB) use `var(--bottom-nav-h, 0px)`. A new one joins
  `bottomNavOffsetSync.test.ts`.
- **NextAuth's `update()` never rejects and returns `null` on every failure** (`undefined`
  while loading) — check for nullish FIRST (see `ImpersonationBanner`).
- **A `CueDialog` effect that MOVES FOCUS depends on the presence edge only** — entry focus
  `[open, top]`, layer registration `[id, mounted, registerLayer]`; never `onDismiss` or a ref
  prop, or the caret jumps every render and iOS closes the keyboard (ADR-0034). Guards: the
  typing tests of `CueDialog`, `ProfilePanel`, `LibraryFilters`, `EditSongButton`, asserting
  `document.activeElement`.
- **`app/(client)/template.tsx` renders a fragment, never a wrapper** — a transformed ancestor
  traps every `position: fixed` descendant. Guard: `reveal.test.ts`.
- **`/admin` has no shell and no page-level horizontal scroll** — only the planner grid and
  the availability matrix scroll sideways, each in its own `overflow-x-auto` (ADR-0035,
  ADR-0044). A visually hidden native control keeps a positioned ancestor inside its control
  (`hiddenControlContainment.test.ts`). Measure with `scripts/dev-verify.ts --layout`.
- **A theme-gallery fixture hosts PRESENTATIONAL halves only** — nothing that reads a session,
  cookie, network or env (ADR-0017; `themeGallery.test.ts`). `TutorialPoster` is the one
  documented exception (stubbed in `e2e/theme-gallery/gallery.spec.ts`). Split the component;
  never loosen the guard.
- **Form controls are 16 px on a phone** (`text-[16px] sm:text-<size>`); never
  `maximum-scale=1`. Guard: `inputFontSize.test.ts`.
- **OAuth/MCP routes** serve only their deployment's canonical origin, fail closed without
  `MCP_OAUTH_SECRET`, and are excluded from `proxy.ts`; `/oauth/authorize` is not, and depends
  on NextAuth's DEFAULT `redirect` callback keeping its query — never add a custom `redirect`
  callback that drops it (`authRedirectCallback.test.ts`; `docs/MCP.md`).
- **MCP tools register only in `registerAllTools`** (`app/mcp/toolList.ts`): its digest is the
  `toolsVersion` every model-visible tool asks for, and a stale Claude copy gets a refresh note
  (ADR-0069). Guidance that depends on an answer goes in the answer, not the description.
- **The ten admin write paths** (setlists PUT, roles create, roles PATCH, roles DELETE,
  copy-instruments, swap, publish-ready, unpublish, the fairness PUT, the proposals PATCH) delegate everything after
  authorization to `app/utils/*Commit.ts`; MCP writes go only through them (`apply_schedule`: roles
  create + fairness PUT, ADR-0061; the saved-month editor: PATCH, copy, create, ADR-0066;
  `delete_services`: DELETE, only with the check's echoed list and token, never a past service,
  ADR-0072; the proposal tools: proposals PATCH, its planner in peek for the check, ADR-0076;
  `serviceCommitCallers.test.ts`). The service conversation's writers live in
  `serviceThreadCommit.ts` too, called by its four routes and the MCP conversation tools (ADR-0073);
  Oasis Kids' in `kidsCommit.ts`, called by the four `/api/kids/*` writes and the MCP Kids tools;
  the song library's in `songSaveCommit.ts`, called by the song and author routes and the MCP song
  tools (edits by parts, a lossless lyrics gate, `ifRevisionId`, a token-keyed create; ADR-0077);
  `/api/mcp` buffers SSE so a tool finishes in the handler.
- **The MCP proposal editor: the server judges, the card only shows** (ADR-0062). Every check and
  save replays the whole edit list through the planner's gate in `editorBoard.ts` only; a saved edit
  is a NEW `mcpProposal` (base `supersededBy` in the same transaction), never a mutated payload;
  `force` only on the app-only save, every force a waiver `apply_schedule` makes the call repeat;
  «Cargar» goes through the chat. Members on the wire are tokens, never ids. A SAVED month's edits
  (ADR-0066) are change sets judged as diffs by `storedJudge.ts`, written one service at a time
  through `roleEditCommit`; the save sorts first («ya estaba»/«cambió»/«por guardar»), derives move
  groups on the server, compares the prompt's `lines`, and only `check_service_edits_app` (app-only)
  mints waiver tokens; the card's «Guardar» saves through the app-only twin `save_service_edits_app`
  (the same function) after its own confirmation, and never replays its edit list once a save starts.
- **The admin assistant (`/api/admin/chat`, a bubble on every page) is READ-ONLY**: super-admin or
  worship admin, never impersonating; its tools call the MCP read handlers in process, never a write
  tool or the connector; spend is capped per admin per CDMX month in `adminChatUsage.*` (fail
  closed); page context is ids and labels on each user turn, never screen text or the system prompt. ADR-0060.

## Reusable utils (don't reinvent)
Before writing a helper, hook or UI primitive, check this list, the long form's section (what
each one owns, and its rules) and `docs/UTILITIES_AND_COMPONENTS.md`. Most are "the ONLY" one.
- **Data/logic:** `normalizeText`, `assignedMemberRefsQuery`, `revalidateSongViews`/
  `revalidateServiceViews`, `buildRuns`/`normalizeMedleyTags`, `extractYouTubeId`,
  `computeParticipation`, `summarizeUnfilledSeats`, `paintsDayCard`, `publishVerdict`,
  `isMemberActive`, `requireActiveSession`/`requireActiveManager`, `accessFromDoc`,
  `isMinistryMember`/`isMinistryManager`, `normalizeMinistryRoles`, `wantsNotification` (nothing
  reads `notifPrefs` directly), `sweepOutbox`, `shell`/`td`/`C` (email palette),
  `serviceLabel`/`serviceIdentity`, `findDuplicates`/`serviceConflicts`,
  `daysUntil`/`formatCountdown`, `MEMBER_TYPE_LABEL`, `isWorshipNight`, `songLeads.ts`
  (`sortedLeadIds` must agree byte for byte on the queue and flush sides), `transpose.ts`,
  `practice.ts`, `rehearsalMixes.ts`, `rehearsalQueue.ts` (the setlist run), `themeColour`.
- **Planner/solver:** `fillSpecialGroup`/`orderGroup`, `collectPins`/`pinRefusal`/
  `pinHandshakeHolds`, `planClear`, `upcomingMonthPills`/`addMonths`, `trailingSaturday`
  (ADR-0048), `rolesOfPattern`/`rolesOfPatternV3` (`patternRolesSync`/`patternRolesV3Sync`
  tests mirror the solver), `capValueForMonth`, `memberFitsRoleKey`,
  `resolveMonthEligibility`, `formatFairnessTenths`/`saldoWords`, `keepVoiceSeats`,
  `parseStoredFairnessMonth`, `executeFairnessMonthWrites`, `countsForFairness`/
  `countsForFairnessDefault`/`COUNTS_FOR_FAIRNESS_GROQ`, `FairnessSwitch`, `SOLVER_ENGINE` +
  `resolveSolverEngine` (server only), `SOLVER_HISTORY_SOURCE`, `SOLVER_SENDS_HISTORY`,
  `loadSolverHistory`, `deriveSolverHistory`/`historyWindow`, `fetchDerivedHistory`,
  `useIntegrityQueue`, `ruleCopy.ts` (the ONE Spanish wording of a rule — card, forms, MCP),
  `seatsClash` (the ONE «two seats one person may not hold on a service»: same category, or voz +
  instrumento unless the member is marked «Canta y toca a la vez» — ADR-0078).
- **UI — never hand-roll these:** `Button` (the only button; `tone`, never a `hover:` pair in
  `className`), `CueDialog` (every dialog; `<CueDialog open={x}>`, never a literal `open` —
  `cueDialogMount.test.ts`), `Menu`, `Select`, `DateField`, `Switch`, `Checkbox` (never a bare
  `<select>`/`<input type="checkbox|date|month">`), `SegmentedControl`, `FiltersPill` + `SearchLine` (a filter sheet's opener and the hairline search), `Collapse`,
  `Presence`, `Skeleton`/`SkeletonGroup`, `AnimatedList`, `SlidingIndicator`, `NumberRoll`,
  `SwipeStrip`, `useToast` (fixed stack) vs `useTransientValue` (inline flash) — not
  interchangeable, `useLongPress`, `useMediaQuery` (a media query a RENDER depends on; server/jsdom = false), `QuickActions`, `PullToRefresh` (mounted once),
  `blackout()`, `Equalizer`/`PlayPauseGlyph`, `revealProps`, `haptic()`, `CueStrip`,
  `NAVBAR_H_CLASS`, `AdminRail`, `PanelSkeleton`/`PanelBoundary`, `MembersPanel`,
  `BottomNavBar` (presentational half of `BottomNav`).
- **Song page:** `TransposeProvider`/`useTransposeOptional`, `SongHeroPills` (the one key
  picker), `TempoPill` + `createMetronome` (one metronome app-wide), `LyricsAutoscroll`,
  `lyricMarkers.tsx`, `TutorialPoster`, `RehearsalPlayer`/`Waveform` (URLs always
  `/api/audio/[song]/[key]`), `PracticeCluster`.
- **Availability:** `useAvailability` is the ONLY client-side writer — one hook call per page.
- **Solver v3 planner (C6, behind the engine prop):** `buildV3SolveRequest` (the ONE v3 request
  builder), `runV3Auto`, `freezeConfirmEntries`/`runV3ConfirmAttempt` (the ONE v3 confirm —
  critical), `v3Copy.ts`, `prefillCountedSpecials`.
- Motion tokens are `--motion-*`/`--ease-*`; `motion` is importable only under
  `app/components/ui/**` (`docs/MOTION.md`, ADR-0031).

## Colour tokens
**68 base roles + 32 composed tokens** (`app/brand.css` `:root`, `tailwind.config.ts`); the
retired `--brand-*` colour variables are gone. **Rose (`key-fg`) is the second brand colour and
means the musical KEY only** — never a state, button or link; ink inside a day card (ADR-0071). **Never build a colour by string
concatenation** — use `themeColour(rgbVar, alpha?)`. **`var()` is not substituted in SVG
presentation attributes** — set `color` on an ancestor and inherit `currentColor`. **Composed
tokens bake their own alpha** — no opacity modifier (a lint clause bans it). **Collapsing a
`dark:` variant changes specificity** — check what the base was masking first.

## Auth
Roles: `super-admin` > `admin` > `content-editor` > `member`. Gate via `requireActiveManager`;
some actions are super-admin-only (checked in the route). Impersonation is super-admin-only,
enforced server-side in `auth.ts`.

**Ministries** (`worship`, `kids`, `jovenes` — `app/ministries.ts`; ADR-0075) are a SECOND axis,
not a role tier: `requireMinistryMember(id)`/`requireMinistryManager(id)` (`app/utils/authGuards.ts`,
built on `ministryAccess.ts` over ONE snapshot, `accessFromDoc`); worship pages call
`requireWorshipPage` (dynamic — ADR-0020).
- **Isolation is two-way**; only `super-admin` spans every ministry; role never implies ministry,
  management never implies membership (in Jóvenes, management is a member's `admin` level in
  `ministryRoles`). `/studio` is not ministry-scoped.
- **Absent `ministries` ⇒ worship** (`normalizeMinistries`, `WORSHIP_MEMBER_GROQ_FILTER`);
  explicitly empty is rejected at every write (`validateMinistryWrite`) — a stored `[]` would
  read back as worship. A `ministryRoles` level counts only for a ministry named in `ministries`.
- **Readable ≠ writable:** `ASSIGNABLE_MINISTRY_IDS`, not `ALL_MINISTRY_IDS`, gates every write and
  offer; old code reads a new id as WORSHIP, so never undo its read side while anyone holds it.
- **A worship role needs worship:** `admin`/`content-editor` outside Alabanza is refused by the members
  API (on change, pinned with `ifRevisionId`, 409) and the Studio (`worshipRoleWithoutWorship`) —
  `requireActiveManager` reads `role` alone. A `ministryRoles` write carries `ministries` with it.
- **"Tipo" (`memberType`) is the ONLY worship eligibility axis** — an empty Tipo is in no seat
  and no pool. Do not reintroduce a second axis (ADR-0029 removed `retiredFrom`). `disabled`
  removes app ACCESS, not schedulability, and `handleEdit` never writes it.

## Continuous improvement
Invoke `$improve-owt` from `.agents/skills/improve-owt/SKILL.md`. It performs
one verified improvement per run with a priority ladder, verification gate, and
honesty gate (empty runs over churn). Use a Codex scheduled task for a recurring
cadence.

## Known landmines (don't rediscover as "bugs")
- Lyrics (`body`) and chord charts (`chords`) are independent fields — don't re-entangle them
  on save (ADR-0018). A filled chart hides `body` in both readers (expected).
- ~15 songs have no lyrics source in the catalog PDF (expected).
- Android build pending; Apple Developer enrollment waits on the DUNS number (2026-08-27).
- **Email templates are LIGHT on purpose**, not `brand.css` — five dark palettes lost to
  Outlook for Mac. Don't "restore the brand colours".
- `MEASURED_MS_PER_SEND` in `outboxSweep.test.ts` is 500 ms, deliberately not the real number,
  and now OPTIMISTIC: the guard charges per WAVE (~2 605 ms measured). Raising it to keep the
  guard green is the one forbidden move (`docs/NOTIFICATIONS.md`).

## Agent skills
- **Worklog: retired 2026-10-22** — nothing read it after `hr-officer` went (2026-10-07), and
  the PR and commit history already record the work. Do not append to it or ask agents for a
  `WORKLOG:` trailer; the file stays frozen in the private `FrankERP/owt-agent-logs`, which
  still holds private backups and solver runs. A churn cap hit in an adversarial plan review is
  recorded in the plan's committed review log instead. `docs/agents/worklog.md`.
- **Issues:** GitHub Issues (`FrankERP/owt-kb-v1`) via `gh` — `docs/agents/issue-tracker.md`.
  Labels: `needs-triage`, `needs-info`, `ready-for-agent`, `ready-for-human`, `wontfix`
  (`docs/agents/triage-labels.md`).
- **Adversarial plan review:** when, see §Review policy. `.agents/skills/adversarial-plan-review/`
  is a vendored copy of `~/.agents/skills/adversarial-plan-review/` (shared with Codex), kept
  byte-identical by `scripts/__tests__/vendoredSkillDigest.test.ts` — change both together.
- **Domain docs:** single-context, `CONTEXT.md` + `docs/adr/` — `docs/agents/domain.md`.
