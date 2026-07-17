# AGENTS.md — OWT Worship Team app (owt-kb-v1)

Internal app for the Oasis Worship Team: song library, weekly setlists, team
role assignments, member availability, and proposals. **Spanish-language UI.**

## Stack & commands
- Next.js 16 (App Router; `proxy.ts` = middleware), React 19, Sanity v5
  (`next-sanity`), Tailwind, NextAuth v4, Fuse.js. Node 22. Dark-mode only.
  Studio embedded at `/studio`. iOS app via Capacitor.
- **Before claiming done, both must pass:** `npx tsc --noEmit` and `npm test`
  (vitest). Add tests for testable pure logic.

## Conventions
- Work on a branch, **merge to `main` periodically** (don't commit routine work
  straight to `main`). **Direct push, no PRs.**
- Conventional commits (`fix(scope): …`), body explains the *why*.
- **Never** add AI/Claude attribution or `Co-Authored-By` trailers.
- Production Sanity writes need explicit user consent — dry-run first
  (one-off scripts in `scripts/`, guarded by `--apply`, run with
  `node --env-file=.env.local scripts/<name>.mjs`). Diagnosing ≠ consent to write.

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

## Reusable utils (don't reinvent)
`normalizeText` (accent-insensitive search), `assignedMemberRefsQuery`,
`revalidateSongViews`/`revalidateServiceViews`, `buildRuns`/`normalizeMedleyTags`
(medley grouping), `extractYouTubeId`, `computeParticipation`,
`summarizeUnfilledSeats`, `isMemberActive` (30s-TTL auth gate),
`requireActiveSession`/`requireActiveManager`.

## Auth
Roles: `super-admin` > `admin` > `content-editor` > `member`. Gate via
`requireActiveManager`; some actions are super-admin-only (checked in the route).
Impersonation is super-admin-only, enforced server-side in `auth.ts`.

## Continuous improvement
Invoke `$improve-owt` from `.agents/skills/improve-owt/SKILL.md`. It performs
one verified improvement per run with a priority ladder, verification gate, and
honesty gate (empty runs over churn). Use a Codex scheduled task for a recurring
cadence.

## Known landmines (don't rediscover as "bugs")
- `SongFormModal`/`EditSongButton` collapse a multi-chord-chart song to one
  chart on save (0 songs affected today; a real feature to fix, not a patch).
- ~15 songs have no lyrics source in the catalog PDF (expected).
- Android build pending; Apple Developer enrollment in progress.
