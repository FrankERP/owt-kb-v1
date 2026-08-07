# CLAUDE.md — OWT Worship Team app (owt-kb-v1)

Internal app for the Oasis Worship Team: song library, weekly setlists, team
role assignments, member availability, and proposals. **Spanish-language UI.**

## Stack & commands
- Next.js 16 (App Router; `proxy.ts` = middleware), React 19, Sanity v5
  (`next-sanity`), Tailwind, NextAuth v4, Fuse.js. Node 22. Dark-mode only.
  Studio embedded at `/studio`. iOS app via Capacitor.
- **Before claiming done, all three must pass:** `npx tsc --noEmit`, `npm test`
  (vitest), and `npx eslint .` with **0 errors** (warnings are a deliberate
  backlog — see `eslint.config.mjs`). Add tests for testable pure logic.

## Conventions
- Work on a branch, **merge to `main` periodically** (don't commit routine work
  straight to `main`). **Direct push, no PRs.**
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
- Preview branch/domain: `preview` → `dev-owt-backstage.vercel.app`.
- The stable dev domain is owned **exclusively** by the `preview` branch. Never
  point it at or deploy it directly from a feature/development branch. To update
  dev: merge the intended development branch into `preview`, push `preview`,
  then verify that Vercel deployed the `preview` commit to the stable dev domain.

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
- Member-facing reads must filter `published != false` (draft/publish gating).
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

## Reusable utils (don't reinvent)
`normalizeText` (accent-insensitive search), `assignedMemberRefsQuery`,
`revalidateSongViews`/`revalidateServiceViews`, `buildRuns`/`normalizeMedleyTags`
(medley grouping), `extractYouTubeId`, `computeParticipation`,
`summarizeUnfilledSeats`, `isMemberActive` (30s-TTL auth gate),
`requireActiveSession`/`requireActiveManager`, `wantsNotification` (the ONLY
per-type email-preference resolver — nothing reads `notifPrefs` directly),
`sweepOutbox`, `shell`/`td`/`C` (`emailShell.ts` — the shared email palette).

## Auth
Roles: `super-admin` > `admin` > `content-editor` > `member`. Gate via
`requireActiveManager`; some actions are super-admin-only (checked in the route).
Impersonation is super-admin-only, enforced server-side in `auth.ts`.

## Continuous improvement
Run `/loop /improve` — the `/improve` command (`.claude/commands/improve.md`)
does one verified improvement per run with a priority ladder, verify gate, and
honesty gate (empty runs over churn).

## Known landmines (don't rediscover as "bugs")
- `SongFormModal`/`EditSongButton` collapse a multi-chord-chart song to one
  chart on save (0 songs affected today; a real feature to fix, not a patch).
- ~15 songs have no lyrics source in the catalog PDF (expected).
- Android build pending; Apple Developer enrollment in progress.
- **Email templates are LIGHT, deliberately not `brand.css`.** Five attempts to
  hold a dark palette against Outlook for Mac failed (spec §6 has the table).
  Client dark-mode transforms assume email is light; there is no reliable hook to
  win from the sending side. Don't "restore the brand colours".
- `MEASURED_MS_PER_SEND` in `outboxSweep.test.ts` is a **placeholder** pending a
  real production `notify_sweep_done` reading — see `docs/NOTIFICATIONS.md`.

## Agent skills

### Issue tracker

Issues live in GitHub Issues (`FrankERP/owt-kb-v1`), managed with the `gh` CLI. See `docs/agents/issue-tracker.md`.

### Triage labels

Default canonical labels: `needs-triage`, `needs-info`, `ready-for-agent`, `ready-for-human`, `wontfix`. See `docs/agents/triage-labels.md`.

### Adversarial plan review

Before implementing a substantial plan, use
`.agents/skills/adversarial-plan-review/SKILL.md` and record its risk tier and rationale.

That directory is a **vendored copy** of the canonical skill at
`~/.agents/skills/adversarial-plan-review/` (shared with Codex). The two must stay
byte-identical; `scripts/__tests__/vendoredSkillDigest.test.ts` fails loudly if this
copy changes without its digest being updated. Change both in the same delivery.

**Every completed review gets a committed review log** beside the plan —
`<plan-basename>-review-log.md`, written after the loop and never shown to a
reviewer. See `docs/superpowers/plans/2026-08-06-grid-drag-and-drop-review-log.md`.

- **Standard risk (default):** one fresh cold `APPROVED`. Parent roadmaps and
  read/model/UI/cutover work stay standard unless they directly own a critical contract.
- **Critical risk:** two sequential fresh `APPROVED` verdicts on byte-identical
  text. Critical means changing a production/server writer or mutation trust
  boundary, destructive/full-array serializer, auth/security/ACL/secret boundary,
  schema/data migration, multi-document transaction/concurrency/recovery protocol,
  or irreversible remote release action. A client/UI consumer of an already-approved
  idempotent writer stays standard unless it changes one of those contracts.
- Run reviewers **one at a time** and never expose prior findings. After two
  substantive `CHANGES_REQUIRED` rounds for one artifact, stop and reassess with the user.
- After each implementation phase, run a fresh code review plus the documented
  test/browser gates. Plan approval never authorizes implementation.

### Domain docs

Single-context: `CONTEXT.md` + `docs/adr/` at the repo root. See `docs/agents/domain.md`.
