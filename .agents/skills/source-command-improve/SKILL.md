---
name: "source-command-improve"
description: "One verified, high-value improvement to the OWT app (designed to be run continuously via /loop)"
---

# source-command-improve

Use this skill when the user asks to run the migrated source command `improve`.

## Command Template

You are continuously improving the **Oasis Worship Team** app (owt-kb-v1). This
command performs **exactly ONE** self-contained, verified improvement per run.
It is designed to be run on a loop: `/loop /improve` (self-paced) or
`/loop 30m /improve`. Everything you need to know about the project is at the
bottom of this file — read it before you touch code.

Your north star: **leave the app measurably better than you found it, and be
honest when it's already good.** A run that ships nothing because nothing was
worth changing is a success, not a failure. Never manufacture churn.

---

## The one-iteration procedure

1. **Orient.** Run `git status` and `git log --oneline -5`. If you are on
   `main`, create/switch to the working branch `improve/continuous` first
   (never commit improvements directly to `main`). Note the last ~5 improvement
   commits so you don't repeat a category more than twice in a row.

2. **Pick ONE item** using the Priority Ladder below. Prefer the highest rung
   that has a genuine, concrete instance — not a vague "could be nicer." Rotate
   the Focus Area (below) so the loop doesn't rut in one dimension.

3. **Verify it's real before you build.** Read the actual code (and, for data
   claims, query production — see cheat-sheet). Confirm the bug reproduces or
   the improvement clearly helps a real user (worship-team member, lead, or
   admin). If you can't confirm it's real, discard it and pick another — or, if
   nothing survives, ship nothing this run (see Honesty Gate).

4. **Make a surgical change.** Match the surrounding code's style, naming, and
   comment density. Smallest change that fully fixes the thing. Add or update a
   unit test when the logic is testable (extract a pure helper if needed).

5. **Verify it works — hard gate, no exceptions:**
   ```
   npx tsc --noEmit      # must exit 0
   npm test              # must be all-green (currently 141 tests)
   ```
   For data scripts, dry-run first, then verify against production. Only claim
   success with evidence in hand — never assert "done" without the command
   output confirming it.

6. **Commit + push.** Conventional-commit message, imperative mood, explains the
   *why*. **No AI/Codex attribution or Co-Authored-By trailer.** Then push.

7. **Report** in 2–4 lines: what shipped, why it matters, and that tsc+tests are
   green. If you shipped nothing, say so plainly and recommend the next move.

---

## Priority Ladder (pick the highest rung with a real instance)

1. **Correctness / data-integrity bugs** — wrong output, crashes, lost user
   input, silent failures, timezone/date errors, GROQ/query mistakes, missing
   `res.ok` checks that report false success.
2. **Security** — authz gaps, missing input validation, injection (GROQ/HTML),
   stranded auth state, over-broad writes.
3. **Broken / incomplete behavior** — a feature that half-works, a mutation that
   doesn't revalidate its cached page, a notification path that misses members.
4. **Accessibility** — keyboard operability, focus management, ARIA semantics,
   screen-reader names, `inert` on hidden interactive content, color-only signals.
5. **UX polish** — loading/empty/error states, mobile layout, sticky-nav scroll
   offsets, honest success/error toasts, consistent affordances.
6. **Performance** — N+1 GROQ, over-fetching, unnecessary client JS, image
   optimization, needless re-renders, bundle weight.
7. **Test coverage** — add tests for untested pure logic (utils, GROQ builders,
   date math). High leverage because it locks in every future loop's work.
8. **Small features that genuinely help the team** — a real convenience for
   leads/members/admins, scoped small enough to finish and verify in one run.
9. **Tech debt / DX** — only when it removes real risk or unblocks future work,
   never cosmetic refactoring for its own sake.

---

## Focus-Area rotation (for variety)

Cycle through these so consecutive runs don't cluster. Look at your last 2–3
commits; deliberately pick a *different* lens this run:

`correctness` → `a11y` → `security` → `performance` → `test-coverage` →
`ux-polish` → `feature` → `data-integrity` → `docs/DX` → (repeat)

You do not have to force a lens if a clear higher-priority bug exists elsewhere —
the Ladder wins ties — but never do >2 similar changes in a row.

---

## Honesty Gate (the most important rule)

- **An empty run is the correct outcome when nothing is genuinely worth
  changing.** Say so plainly, recommend merging/pausing, and stop. Do NOT invent
  a cosmetic edit to "produce something."
- **Do not declare an audit "done" without enumerating.** (Lesson learned: a
  fetch-resilience sweep looked finished, but enumerating every mutation
  component surfaced *silent false-success bugs* in ServicesPanel.) Before
  claiming a class of issue is exhausted, list every file/site and check each.
- **Verify against reality, not memory.** Grep the current code; query prod for
  data claims. Point-in-time notes go stale.
- **Never lose user work.** On any save handler: check `res.ok`, keep the editor
  open on failure, report honestly — don't close-as-success.

---

## Deep-Move escalation (roughly every 5th run, or when the shallow well runs dry)

When single-file scanning stops finding real bugs, go deeper instead of settling
for polish:

- **Dispatch an `Explore` or `general-purpose` agent** to hunt concrete bugs
  across a whole subsystem (API routes, date logic, a schema's read/write paths)
  and return a ranked, file:line list. Fix the top confirmed item.
- **Run a systematic audit of one dimension** end-to-end and enumerate every
  site (e.g. "every mutation handler," "every `date`/timezone computation,"
  "every array-of-objects write needs a `_key`," "every cached page's mutations
  call a revalidate util"). These structured sweeps are the richest vein.
- **Invoke `/code-review`** on the working diff, or a `skeptical-reviewer` agent
  on a proposed larger change.
- **Consider a real feature** from the team's perspective if bugs are truly
  exhausted — scope it to something finishable and testable in a couple of runs.
- **Periodically merge** `improve/continuous` → `main` (fast-forward-clean when
  possible; verify tsc+tests on the merged result before pushing).

---

## Commit / branch conventions (project-specific — follow exactly)

- Work on branch `improve/continuous`; **merge to `main` periodically**, don't
  commit improvements straight to `main`. (Direct pushes to `main` are fine for
  the *merge* and for urgent one-off fixes the user asks for — but not for
  routine loop work.)
- **Direct push, no PRs** — this repo merges straight to `main`, no pull requests.
- Conventional commits: `fix(scope): …`, `feat(scope): …`, `chore(scope): …`,
  `refactor(scope): …`, `test(scope): …`. Body explains the *why* and the failure
  it prevents.
- **Never** add "Generated with Codex", `Co-Authored-By: Codex`, or any
  AI attribution.

---

## Project cheat-sheet (read this — it's the distilled knowledge)

**Stack:** Next.js 16 (App Router, `proxy.ts` = middleware), React 19, Sanity v5
(`next-sanity`), Tailwind, NextAuth v4, Fuse.js. Node 22. Dark-mode-only. Studio
embedded at `/studio`. Spanish-language UI (`lang="es"`).

**Commands:** `npx tsc --noEmit` (typecheck), `npm test` (vitest, ~141 tests).
No `build` needed for the gate.

**Timezone & dates (critical):** all service dates are Sanity `date` type
(`YYYY-MM-DD`). Timezone is **America/Mexico_City**.
- Render a stored date pinned to local noon: `new Date(iso.slice(0,10)+"T12:00:00")`
  — never bare `new Date(iso)` (UTC day-flip).
- Server "today": `new Date().toLocaleDateString("sv",{timeZone:"America/Mexico_City"})`.
- For "days until / days ago" **labels** (Hoy/Ayer/countdowns), use a *calendar-day*
  diff (both anchors at local noon), not elapsed-hours — elapsed math is off by
  one near midnight. Elapsed math is fine for activity *buckets* (≤7d / ≤30d).

**Sanity schema quirks:**
- Sunday setlist = `featuredSongs`; Saturday setlist = `saturdarSongs`
  (**typo intentional — do not rename**, it would orphan data).
- Role docs: `sunday_role`, `saturday_role`, `special_role` (special uses `date`,
  others use `week`). **Five seat types** reference members:
  `Lead[]._ref`, `BGVs[]._ref`, `Chorus[]._ref`, `instruments[].person._ref`,
  `foh_team[].person._ref`. Any "who serves" query must cover **all five** — use
  `assignedMemberRefsQuery()` in `app/utils/notifyTargets.ts` (single source of truth).
- Member-facing reads must filter `published != false` (draft/publish gating).
- `medley_tag` (hidden field on setlist_song & proposal_song): consecutive songs
  sharing a tag render as one medley. Managed by `buildRuns` / `normalizeMedleyTags`
  in `app/utils/medley.ts`.
- **Array-of-objects writes need a `_key` per item** (Sanity requirement).

**Shared utils to reuse (don't reinvent):** `normalizeText` (accent-insensitive
search), `assignedMemberRefsQuery`, `revalidateSongViews` / `revalidateServiceViews`
(call after admin mutations or the ISR page stays stale), `buildRuns` /
`normalizeMedleyTags`, `extractYouTubeId`, `computeParticipation`,
`summarizeUnfilledSeats`, `isMemberActive` (30s-TTL auth gate),
`requireActiveSession` / `requireActiveManager`.

**Cache correctness:** static pages use ISR. Any admin/API route that mutates
content must call the matching `revalidate*` util (or `revalidatePath`) or edits
won't appear until the window expires. This is fully audited today — keep it so.

**Fetch resilience (audited — keep it intact):** every client mutation handler
wraps `fetch` in try/catch/finally, checks `res.ok`, resets its loading flag,
and reports failure honestly (never closes-as-success). If you add a new
mutation handler, follow this pattern.

**One-off data scripts:** live in `scripts/`, `.mjs`, `@sanity/client`, guard
with `--apply` (dry-run by default), run via
`node --env-file=.env.local scripts/<name>.mjs`. To verify data against prod:
`node --env-file=.env.local -e "import('next-sanity').then(async({createClient})=>{ … })"`.
Never re-run a completed one-shot import with `--apply`.

**Prod writes need consent.** Do not mutate production Sanity data on a hunch —
dry-run, show the plan, and get explicit go-ahead for `--apply`. Diagnosing
("what happened?") is not consent to write.

**Auth/roles:** `super-admin` > `admin` > `content-editor` > `member`. Route
gating via `requireActiveManager`; some actions are super-admin-only (checked in
the route). Impersonation is super-admin-only and enforced server-side in `auth.ts`.

**Known landmines / deferred (don't rediscover as "bugs"):**
- `SongFormModal`/`EditSongButton` collapse a multi-chord-chart song to a single
  chart on save. 0 songs affected today; fixing it properly is a real feature, not
  a quick patch — only tackle deliberately.
- ~15 songs have no lyrics source in the catalog PDF (expected, not a bug).
- The proposal `medley_tag` schema field works via API/GROQ; a Studio schema
  deploy makes it visible in Studio (optional).
- Android build pending; Apple Developer enrollment in progress (out of loop scope).

**Definition of "genuinely valuable":** a real user (member/lead/admin) is
measurably better off, OR a real defect can no longer occur, OR future
maintainers/loops are safer (a test, a guard, a single-source util). If a change
doesn't clear that bar, don't ship it.

---

## How to run this loop

- **Self-paced (recommended):** `/loop /improve` — Codex picks its own cadence,
  resets context between runs, and continues until you stop it.
- **Fixed cadence:** `/loop 30m /improve`.
- **Durable (survives closing the session):** ask for a cloud schedule via
  `/schedule` running `/improve`.
- **Wind down:** tell Codex to stop, or let it report an empty run and pause.
