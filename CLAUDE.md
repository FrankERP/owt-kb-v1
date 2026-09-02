# CLAUDE.md — OWT Worship Team app (owt-kb-v1)

Internal app for the Oasis Worship Team: song library, weekly setlists, team
role assignments, member availability, and proposals. **Spanish-language UI.**

## Stack & commands
- Next.js 16 (App Router; `proxy.ts` = middleware), React 19, Sanity v5
  (`next-sanity`), Tailwind, NextAuth v4, Fuse.js. Node 22. Dark and light themes — follows the device by default; members can pin either at `/me`.
  Studio embedded at `/studio`. iOS app via Capacitor.
- **Before claiming done, all three must pass:** `npx tsc --noEmit`, `npm test`
  (vitest), and `npx eslint .` with **0 errors** (warnings are a deliberate
  backlog — see `eslint.config.mjs`). Add tests for testable pure logic.

## Conventions
- Work on a branch, **merge to `main` periodically** (don't commit routine work
  straight to `main`). **`main` is protected and takes NO direct pushes** — it is
  reached through a PR whose `gates` check is green (`.github/workflows/ci.yml`:
  `tsc --noEmit`, `vitest`, `eslint` with 0 errors). `preview` still takes direct
  pushes; CI runs there too, but does not block. Protection applies to admins as
  well, so there is no silent bypass: an emergency override means deliberately
  turning protection off, doing the push, and turning it back on. See
  `docs/CI.md`.
- **A MERGE TO `main` IS A RELEASE, SO IT NEEDS A FRESH CODE REVIEW FIRST.** Not the
  plan review — a review of the *diff*. Children E and F were both adversarially reviewed
  as plans (19 rounds and 2), merged, and deployed; the code review ran afterwards and
  found three control-flow bugs already serving the team. Plan review cannot see them by
  construction: it reads plans. One round even blocked on `clearThemeMirror()`'s error
  handling while standing next to the `setTheme`-identity bug in the same function, because
  it was not looking at code. The order is:

      implement → gates green → FRESH CODE REVIEW on the merge range → fix
      → RE-VERIFY THE FIX (scoped review of the fix range + gates re-run on the final tree)
      → merge to main → preview → verify alias → main

  A fix for a review finding is written fast, under pressure, by the author the review just
  corrected — it is not lower-risk than the code that produced it. The cycle that earned this
  step ran three review rounds and two of them found the previous fix incomplete: a HIGH fix left
  a production notification audience half-gated, and the fix for that still fired when no role
  existed. Auditable from the worklog alone: the last entry before a merge must be a
  verification, not a fix. That property is what makes it a control rather than an intention.

- **PUSH ORDER IS `preview` FIRST, THEN `main`. Always, without being asked.**
  `main` auto-deploys to **production** — `owt-backstage.vercel.app`, the app the
  team uses. So `git push origin main` *is* a production release, not a checkpoint.
  Pushing it before dev has seen the change means the team gets it first and dev
  becomes the rehearsal you already skipped. The order is:

      feature branch (local gates green)
      → merge the feature branch into preview, push preview, VERIFY the dev alias moved
      → open a PR from the feature branch to main, WAIT for the `gates` check
      → merge the PR — that is the production release

  The verify step is not optional and a green build does not satisfy it — confirm
  `dev-owt-backstage.vercel.app` is in the deployment's `alias` array and that its
  `githubCommitSha` is the commit you pushed. **`preview` still goes first**: the
  PR gate proves the code compiles and passes, never that it looks right to a
  human on dev. Then verify the production alias the same way after the merge.
- **Worktrees only when two things must be in flight at once** — parallel agents
  writing overlapping files (`Agent` with `isolation: "worktree"`) or protecting the
  primary tree while gates/servers run elsewhere (`EnterWorktree`, never a hand-rolled
  `git worktree add`). Code review is read-only — no worktree. Populate
  `node_modules` with an APFS clone from the primary checkout (`cp -Rc`), never a
  fresh install. `git worktree remove` is part of the merge step; `git worktree prune`
  at cycle open.
- Conventional commits (`fix(scope): …`), body explains the *why*.
- **Never** add AI/Claude attribution or `Co-Authored-By` trailers.
- **Keep documentation current in the same delivery.** Implementation, behavior,
  verification counts, branch/commit state, and deployment status must be
  reflected in the canonical docs before reporting completion; remove stale
  "not released" or "preview only" statements when a release advances.
- Production Sanity writes need explicit user consent — dry-run first
  (one-off scripts in `scripts/`, guarded by `--apply`, run with
  `node --env-file=.env.local scripts/<name>.mjs`). Diagnosing ≠ consent to write.
- **Any new secret or env var gets an entry in `docs/SECRETS.md`** in the same
  change: which platforms need it (and which don't), where the value came from,
  how to rotate it, and what breaks mid-rotation. Never the value itself.

## Vercel safety
- Canonical project: `frank-rochas-projects/owt-backstage`
  (`prj_elS88VGezKpy18wizFN1ffoy8cJ5`). Never create or automatically select
  another Vercel project for this repository.
- Before any Vercel command that may link, deploy, alias, or mutate remote
  state, verify `.vercel/project.json` matches that name and ID.
- If the link is missing or incorrect, run:
  `vercel link --yes --project owt-backstage --scope frank-rochas-projects`
  and verify the resulting project ID before continuing.
- Never use automatic `--yes` linking through `vercel`, `vercel deploy`, or
  `vercel curl`.
- **Two branches deploy, and both are real:** `preview` → `dev-owt-backstage.vercel.app`,
  `main` → **production**, `owt-backstage.vercel.app`. There is no staging branch
  that deploys nowhere. **`preview` goes first** — see the push-order rule under
  Conventions.
- **Agents can look at dev once the one-time seed is done** (`docs/DEV_VERIFY.md` — the three
  verification runs in its «Verified runs» section must be recorded before relying on it).
  `scripts/dev-verify.ts` observes `dev-owt-backstage` read-only as the «Verificador (bot)»
  member — screenshots, text, a11y tree, console. Use it for the human-eyes step of the push
  order when the change is visual; it never writes, and it still is not a substitute for
  Frank's own look at a release.
- The stable dev domain is owned **exclusively** by the `preview` branch. Never
  point it at or deploy it directly from a feature/development branch. To update
  dev: merge the intended development branch into `preview`, push `preview`,
  then verify that Vercel deployed the `preview` commit to the stable dev domain.
- **Verifying a deploy means checking the ALIAS, not the build.** A `● Ready`
  build proves a commit compiled, not that any domain serves it. HTTP checks prove
  less than nothing — the app answers `302` to SSO. Query the deployment and
  confirm two fields: the target domain appears in `alias`, and `meta.githubCommitSha`
  equals the commit you pushed.
- **Never hand-roll a bash deploy watcher** (`until … vercel inspect … grep …`).
  Two in one day spun silently forever — one on a PATH miss (`vercel` is not
  installed; only `npx vercel` works), one on a grep heuristic that never matched —
  while the deploy had been READY in ~85 s. Builds here take ~90 s, so: push, then
  verify with a direct `get_deployment(domain)` query (Vercel MCP) or dispatch the
  `deploy-verifier` agent, retrying that same authoritative check a few times ≥30 s
  apart. If something must genuinely block on the build, use the vendor's waiter —
  `npx vercel inspect <deployment-url> --wait --timeout 5m` — never a grep loop, and
  never on the stable domain: an alias resolves to the OLD deployment until the new
  one is ready, so `--wait` on it returns instantly with stale success (observed
  2026-08-24). Then still do the alias+SHA check, which `--wait` does not replace.
- **`preview` writes to the real Sanity dataset.** It is a rehearsal of the UI,
  never a dry run of data. Every write lands in the same documents production
  reads.
- **Its email currently does NOT reach the team, and that is a variable, not a
  property.** `EMAIL_REDIRECT_TO` is set on the Preview environment (since
  2026-07-24), so notifications are generated and sent for real but every message
  is rerouted to one address. Two consequences worth holding together: a publish
  on dev will NOT tell the team, so it is not a way to notify them; and the
  moment that variable is removed or the value is cleared, preview mails the
  whole team with no other change. Check `vercel env ls preview` before assuming
  either. Production has no such redirect.

## Decision records
When a choice rejects a real alternative and the reason won't be obvious from
the code later — a pin that looks arbitrary, code that looks like a bug but
isn't, something deliberately *not* done, an upgrade tried and reverted — write
a short ADR in `docs/adr/` (see its README for the bar and the template) and
link it from the code or doc it governs. **Not for routine work:** most changes
need no ADR. Read the relevant ADR before "fixing" something that looks wrong —
several exist precisely to stop a plausible-looking change.

## Don't-break-these invariants
- **Timezone = America/Mexico_City.** Service dates are Sanity `date`
  (`YYYY-MM-DD`). Render pinned to local noon: `new Date(iso.slice(0,10)+"T12:00:00")`
  — never bare `new Date(iso)` (UTC day-flip). Server "today":
  `new Date().toLocaleDateString("sv",{timeZone:"America/Mexico_City"})`.
  For "Hoy/Ayer" / countdown *labels*, use a calendar-day diff at local noon,
  not elapsed hours.
- **`saturdarSongs`** (Saturday setlist type) is a deliberate typo — **do not
  rename**, it would orphan data. Sunday setlist = `featuredSongs`.
- **Five member-referencing seats** on role docs (`sunday_role`/`saturday_role`/
  `special_role`): `Lead[]._ref`, `BGVs[]._ref`, `Chorus[]._ref`,
  `instruments[].person._ref`, `foh_team[].person._ref`. Any "who serves" query
  must cover all five — reuse `assignedMemberRefsQuery()` in `app/utils/notifyTargets.ts`.
- Member-facing reads must filter `published != false` (draft/publish gating) for the
  **worship** types, whose documents predate the field — an absent `published` there
  must mean "visible". **Kids reads use the stricter `published == true`** instead
  (`kidsSchedule` is minted with the field by its write route, so a field-less doc is a
  bug, not a legacy row). Copy the rule that matches the type you are reading.
  **For `kidsSchedule` the rule is wider than "member-facing":** every read under
  `app/**` must carry `published == true`, manager-only ones included, because a
  fairness clock asking "did this pair serve?" needs the same answer the members got
  (ADR-0022). Two reads are exempt and both are editors of drafts —
  `api/kids/schedules/route.ts` and the planner page's `"schedules"` projection.
  `draftGatingCoverage.test.ts` enforces this, so a new manager-facing kids read that
  omits the filter fails the suite rather than shipping.
- **Sanity array-of-object writes need a `_key` per item.**
- **Cache:** admin/API routes that mutate content must call the matching
  `revalidate*` util in `app/utils/revalidate.ts` (or `revalidatePath`), or the
  ISR page stays stale.
- **Client mutation handlers** must wrap `fetch` in try/catch/finally, check
  `res.ok`, reset their loading flag, and never close-as-success on failure.
- **`/api/cron/*` stays excluded from the `proxy.ts` middleware matcher** — those
  routes authenticate with `CRON_SECRET` themselves. The matcher is duplicated in
  `app/utils/routeMatcher.ts` and the two must stay byte-identical (sync guard in
  `routeMatcher.test.ts`).
- **Notification emails: `before` is captured PRE-COMMIT** and threaded into
  `after()`. Reading live state inside `after()` gives post-write state and the
  system silently sends nothing. See `docs/NOTIFICATIONS.md`.
- **The impersonation banner and the navbar are both `sticky top-0` in
  different containers.** `ImpersonationBanner` publishes an `impersonating`
  class plus its MEASURED height as `--impersonation-h` on `<html>`; `brand.css`
  offsets `.brand-navbar` by that variable. Neither file names the other in
  code, so the two must move together — and the height is measured, not a
  constant, because the banner wraps to two lines on a phone.
- **NextAuth's `update()` never rejects and returns `null` on every failure**
  (`fetchData` swallows network, non-2xx and parse errors; `update` returns
  `undefined` while loading). A handler that only inspects the returned
  session's fields reads every real failure as success — check for nullish
  FIRST. Both impersonation handlers do; see `ImpersonationBanner`.

## Reusable utils (don't reinvent)
`normalizeText` (accent-insensitive search), `assignedMemberRefsQuery`,
`revalidateSongViews`/`revalidateServiceViews`, `buildRuns`/`normalizeMedleyTags`
(medley grouping), `extractYouTubeId`, `computeParticipation`,
`summarizeUnfilledSeats`, `paintsDayCard` (whether a `DayCard` will paint
anything rather than render `null` — the home page asks it instead of copying
the guard), `isMemberActive` (30s-TTL auth gate),
`requireActiveSession`/`requireActiveManager`, `wantsNotification` (the ONLY
per-type email-preference resolver — nothing reads `notifPrefs` directly),
`sweepOutbox`, `shell`/`td`/`C` (`emailShell.ts` — the shared email palette),
`themeColour` (`app/utils/themeColour.ts`), `useTransientValue` (`[value, show, reset,
hold]` — every auto-dismissing toast and "Guardado ✓" flash. A bare
`setTimeout(() => setToast(null))` leaks its timer, so a second toast inherits the
first one's clock and an error can vanish in 100ms. Use `hold` for a message that must
PERSIST until something replaces it — `MonthGenerator`'s swap toast, which reports
writes that landed in Sanity but could not be verified. Never hand-roll the timer).

## Colour tokens
Colour lives in **67 base roles + 26 composed tokens** (`app/brand.css` `:root`,
`tailwind.config.ts`). The seven retired `--brand-*` COLOUR variables and their `brand.*`
Tailwind keys are **gone**; the four non-colour ones (`--brand-radius-*`,
`--brand-duration-*`) survive.
- **Never build a colour by string concatenation.** `` `${hex}55` `` worked on a bare hex;
  a token cannot be appended to, and `rgb(var(--accent-rgb) / 0.2)55` is not a valid
  `<color>` — the browser drops the whole declaration with nothing in the console. Use
  `themeColour(rgbVar, alpha?)`, which always returns a complete colour.
- **`var()` is not substituted inside SVG presentation attributes** (`fill=`, `stroke=`).
  Set `color` on an ancestor and let the attribute inherit `currentColor`.
- **Composed tokens bake their own alpha** — an opacity modifier on one double-applies it.
  A lint clause bans it.
- **Collapsing a `dark:` variant changes specificity.** A `dark:` base at (0,2,0) masks a
  bare `hover:`/`focus:` utility; an unprefixed token at (0,1,0) does not. Check what a
  base was masking before removing it.

## Auth
Roles: `super-admin` > `admin` > `content-editor` > `member`. Gate via
`requireActiveManager`; some actions are super-admin-only (checked in the route).
Impersonation is super-admin-only, enforced server-side in `auth.ts`.

**Ministries** (`worship`, `kids` — `app/ministries.ts`) are a SECOND axis, not a
role tier. Gate with `requireMinistryMember(id)` / `requireMinistryManager(id)`
(`app/utils/authGuards.ts`); worship pages call `requireWorshipPage`
(`app/utils/worshipPageGate.ts`, which makes them dynamic — ADR-0020).
- **Isolation is two-way:** a kids-only member reaches no worship surface, and a
  worship `admin`/`content-editor` gets nothing in kids. Only `super-admin` spans
  both. Role never implies ministry; management never implies membership. That
  holds for the app's own surfaces — **`/studio` is not ministry-scoped** (`proxy.ts`
  opens it to `admin`), and `teamMembers`, `managesMinistries` included, is editable
  by anyone with Sanity project write access.
- **Storage contract:** **absent** `ministries` ⇒ worship (the legacy,
  migration-free rule — `normalizeMinistries` + `WORSHIP_MEMBER_GROQ_FILTER` are
  the only readers). **Explicitly empty** is rejected at every write boundary
  (`validateMinistryWrite`) and never stored — stored `[]` reads back as worship
  and would hand a kids volunteer the whole catalog.
- **Soft retirement (`retiredFrom`):** absent ⇒ serves in every ministry they
  belong to. **Selection** excludes retired members at the point of use
  (`rankCandidates`, Persona select, `MemberPool`); **resolution** (`_id in $ids`,
  id→name) never filters. `GET /api/admin/members` is deliberately unfiltered
  by retirement. `disabled` is a separate kill switch — never written by retiro nor
  by `handleEdit`. Kids rotation ignores `retiredFrom` (register-only in P1).

## Continuous improvement
Run `/loop /improve` — the `/improve` command (`.claude/commands/improve.md`)
does one verified improvement per run with a priority ladder, verify gate, and
honesty gate (empty runs over churn).

## Known landmines (don't rediscover as "bugs")
- Lyrics (`body`) and chord charts (`chords`) are independent fields — do not
  re-entangle them with `CHORD_MARKER_RE` on save. See ADR-0018. Adding a filled
  chart hides `body` in both readers until every chart is removed (existing
  reader behavior, not a bug).
- ~15 songs have no lyrics source in the catalog PDF (expected).
- Android build pending; Apple Developer Program enrollment is waiting on the DUNS
  number (confirmed 2026-08-27).
- **Email templates are LIGHT, deliberately not `brand.css`.** Five attempts to
  hold a dark palette against Outlook for Mac failed (spec §6 has the table).
  Client dark-mode transforms assume email is light; there is no reliable hook to
  win from the sending side. Don't "restore the brand colours".
- `MEASURED_MS_PER_SEND` in `outboxSweep.test.ts` is **500 ms and deliberately
  not the real number**, and **it is now OPTIMISTIC, not conservative** — check
  which way before reasoning from it. The guard charges **per WAVE**
  (`(waves - 1) * MEASURED_MS_PER_SEND`), and a wave measured **~2 605 ms** on
  Gmail at width 8. The often-quoted 372 ms is `sendMs / emailed` — per MESSAGE,
  not the figure the guard uses. The old 14 413 ms belonged to the retired cPanel
  sender (ADR-0025). Production runs `NOTIFY_FLUSH_EMAIL_LIMIT=40` with
  `SEND_CONCURRENCY=8`, and the inequality now holds on the REAL number —
  `(5-1) × 2 605 = 10 420 < 20 000` — which it never did before. Raising the
  constant to keep the guard green is still the one forbidden move — see
  `docs/NOTIFICATIONS.md`.

## Agent skills

### Agent worklog + HR review

**Log every subagent dispatch** to `.agents/log/worklog.jsonl` (append-only, one JSON
object per line; a gitignored symlink into the PRIVATE repo `FrankERP/owt-agent-logs`
— never commit it here, because this repo is public and the log is agent-written free
text covering incidents). Agents end their reports with
a `WORKLOG:` trailer; the **coordinator appends** the lines — **batched at cycle
close is fine** (amended 2026-08-19; per-dispatch appends remain welcome) — including
`no_result` for dispatches that crashed and `coordinator-inline` for specialist-shaped
work done inline rather than dispatched.
At cycle close, the code-review dispatch also carries the docs-audit and
worklog-completeness checklists — one agent, one context read, three checklists
(amended 2026-08-19; separate `docs-auditor` dispatches remain available for
doc-heavy cycles). `hr-officer` runs **weekly** (or on demand via `/hr-report`),
not per cycle. The gate is **advisory** — it never blocks a delivery, and HR
proposes roster changes rather than making them. See `docs/agents/worklog.md`.

### Issue tracker

Issues live in GitHub Issues (`FrankERP/owt-kb-v1`), managed with the `gh` CLI. See `docs/agents/issue-tracker.md`.

### Triage labels

Default canonical labels: `needs-triage`, `needs-info`, `ready-for-agent`, `ready-for-human`, `wontfix`. See `docs/agents/triage-labels.md`.

### Adversarial plan review

**Reserved for critical contracts only** (retiered 2026-08-19). The evidence for the
retier: Child E ran 19 plan-review rounds and the post-merge *code* review still found
three control-flow bugs serving the team — the diff review is the layer that catches
implementation bugs, so standard work spends its budget there instead.

- **Standard work (the default): no adversarial plan review.** The pipeline is
  spec (self-reviewed, then user-reviewed) → implement → gates → fresh code review
  of the diff. Parent roadmaps and read/model/UI/cutover work are standard unless
  they directly own a critical contract.
- **Critical contracts keep the loop.** Use
  `.agents/skills/adversarial-plan-review/SKILL.md` and record the risk tier and
  rationale. When only a slice of a spec owns the critical contract, review that
  slice's plan, not the whole spec.

That directory is a **vendored copy** of the canonical skill at
`~/.agents/skills/adversarial-plan-review/` (shared with Codex). The two must stay
byte-identical; `scripts/__tests__/vendoredSkillDigest.test.ts` fails loudly if this
copy changes without its digest being updated. Change both in the same delivery.

**Every completed review gets a committed review log** beside the plan —
`<plan-basename>-review-log.md`, written after the loop and never shown to a
reviewer. See `docs/superpowers/plans/2026-08-06-grid-drag-and-drop-review-log.md`.

- **Critical risk:** two sequential fresh `APPROVED` verdicts on byte-identical
  text. Critical means changing a production/server writer or mutation trust
  boundary, destructive/full-array serializer, auth/security/ACL/secret boundary,
  schema/data migration, multi-document transaction/concurrency/recovery protocol,
  or irreversible remote release action. A client/UI consumer of an already-approved
  idempotent writer stays standard unless it changes one of those contracts.
- **Incidents are not exempt.** A change to a production writer's concurrency,
  batching, or deletion behaviour is critical whether planned or discovered
  mid-fire. Under time pressure the bar drops to ONE fresh `APPROVED` on a
  one-paragraph hypothesis — no plan document — but never to zero. The 2026-08-07
  outbox incident shipped ten deploys with no round and paid for it twice.
- Run reviewers **one at a time** and never expose prior findings. **Non-blocking
  findings never trigger a fresh round** — fix or decline them and record the
  disposition. **The churn cap is binding:** after two rounds with *verified
  substantive* blockers, stop; round three needs Frank's explicit go-ahead,
  obtained in advance (the cap was passed silently on 2026-08-11/12 — 15- and
  19-round loops whose real remedy was a rewrite, not another round).
- After each implementation phase, run a fresh code review plus the documented
  test/browser gates. Plan approval never authorizes implementation.

### Domain docs

Single-context: `CONTEXT.md` + `docs/adr/` at the repo root. See `docs/agents/domain.md`.
