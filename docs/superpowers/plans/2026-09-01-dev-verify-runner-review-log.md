# Review log — dev verification runner plan

Artifact: `docs/superpowers/plans/2026-09-01-dev-verify-runner.md` (with its spec
`docs/superpowers/specs/2026-09-01-dev-verify-runner-design.md` as context).
Reviewed slice: the critical contract only — spec §3 (session and secrets) and §4
(read-only guarantee), i.e. plan Tasks 1, 2, 4, 5, 6 and the `docs/SECRETS.md` entries of
Task 7. Loop run 2026-09-01 by the coordinating agent; every round a fresh
`skeptical-reviewer` with the cold packet (snapshot path, digest, requirement, evidence
pointers) and nothing else.

**Approval is not authorization to implement.** Implementation still requires the fresh
code review of the diff and the documented gates before any merge.

## Risk tier

**Critical — derived from the ladder, not raised.** The slice places an `admin` credential
and a live session on disk (secret/credential boundary) and defines the lock that keeps a
signed-in admin browser from writing (a mutation trust boundary). Two sequential fresh
`APPROVED` verdicts on byte-identical bytes were required.

## Rounds

| Round | Plan digest (SHA-256 prefix) | Spec digest | Commit | Verdict | Streak |
|---|---|---|---|---|---|
| 1 | `dea879696af65ba6` | `6af0a45fc641d63b` | `12d0c927` | CHANGES_REQUIRED (5 blockers, all verified substantive) | reset → 0 |
| 2 | `66e42e9218199e4b` | `e182ba925ff3b8f6` | `35aff5c0` | APPROVED | 1 |
| 3 | `66e42e9218199e4b` | `e182ba925ff3b8f6` | `35aff5c0` | APPROVED | 2 — requirement met |

Substantive `CHANGES_REQUIRED` rounds: 1 (churn cap of 2 not reached).

## Round 1 — blockers and dispositions

All five were **independently verified** before any edit (commands run from the worktree).

1. **Every run would exit 3 — the app's own heartbeat.** `app/components/ActivityPing.tsx`
   POSTs `/api/activity/ping` (a production `lastSeen` patch, `app/api/activity/ping/route.ts:12-15`)
   on the first authenticated page, keyed in `sessionStorage`, which a Playwright storage
   state does not carry. Verified by reading both files and the mount in
   `app/(client)/layout.tsx:84`. **Fixed:** the runner seeds `sessionStorage.owt_last_ping`
   via `context.addInitScript` so the request never fires; a vitest pins the key to the
   component's source; the POST is never allow-listed.
2. **Fail-open on SSO.** `curl -s -o /dev/null -w "%{http_code} %{redirect_url}" https://dev-owt-backstage.vercel.app/`
   → `302 https://vercel.com/sso-api?…`. The runner continued non-target origins and had no
   landed-origin check, so a rotated or unhonoured bypass secret would have produced a green
   run whose screenshot is the SSO wall. **Fixed:** `assertOnOrigin` after every navigation
   and click, refusing with exit 2 (`host:landed_off_origin`), mirroring
   `e2e/service-readiness/fixtures.ts`.
3. **Undisclosed production write.** `auth.ts` `events.signIn` → `createLoginEvent` →
   `client.create` on every credentials sign-in (verified at `auth.ts:113-135`,
   `app/utils/srVerificationLoginEvent.ts:418`). Unavoidable without changing `auth.ts`
   (out of scope). **Fixed by disclosure:** spec §3.5, Global Constraints, `DEV_VERIFY.md`,
   SECRETS entry. **Frank explicitly accepted the write on 2026-09-01** (bounded to once per
   cached 7-day session or per rotation), via the coordinator's question in conversation.
4. **Lock 3 false for kids.** `app/api/kids/members/route.ts:18`, `app/api/kids/generate/route.ts:116`
   and `app/(client)/kids/admin/page.tsx` select `"kids" in ministries` with no retirement
   arm, and `app/utils/__tests__/retirementGatingCoverage.test.ts:33-37` pins them as
   resolution-only. A kids member with `retiredFrom` would still be a seatable pair member.
   **Fixed:** `ministries: ["worship"]`, `managesMinistries: ["kids"]`, `retiredFrom: ["worship"]`
   — `requireMinistryManager` needs management only (`app/utils/authGuards.ts:48-55`), so
   `/kids/admin` stays reachable; member-facing `/kids` is out of reach and the spec says so.
5. **Rotation disarmed the kill switch.** The seed used `createOrReplace` with a document
   that never carries `disabled`, so "set `disabled: true` in Studio, then rotate" would
   re-enable the member. Verified against the schema (`sanity/schemas/worshipTeam.ts:49-55`)
   and Sanity's replace semantics. **Fixed:** patch when the id exists (never touching
   `disabled`, printing its current state), create only when absent.

Refuted: none. Non-blocking items from round 1 adopted in the same edit: hyphenated id
`member-dev-verify` (a dotted id is a Sanity path hidden from untokened reads — the very
"hidden member" mechanism §3.1 rejects); refusals routed through redaction and the leak
scan; `context.route` awaited and context-wide plus `serviceWorkers: "block"`; twin check
with `lower(email)`; `worship` dropped from `managesMinistries` (no guard reads it); spec
"idempotent on email" aligned to `_id`; Google-identity exposure note; Studio/`api.sanity.io`
origin-scope note.

## Rounds 2 and 3 — approvals

Both reviewers verified, independently and citing lines: the NextAuth client's only non-GET
is `POST /api/auth/callback/credentials` (so the single exception is exact and sufficient);
no other on-mount write exists in any client component; GET handlers never write; the
member posture keeps the bot out of every worship selection point and every notification
audience (`wantsNotification` honours the seeded `false`s; no `deviceTokens`); `.gitignore`
already covers the storage state; the reused A3 helpers exist with the stated signatures;
Node 22 imports the `.ts` seed-doc module from `.mjs` without a loader (round 2 probed it).

Unverified by both (live-only): that Vercel honours `x-vercel-protection-bypass` on the stable
alias host, and the exact response shape for a wrong bypass value. Task 8 exercises both.

## Post-approval changes — un-reviewed

Adopted **after** the second approval, so they fall outside it. Plan digest after adoption:
`cd26d81ba0348c02`; spec digest: `8517a289df5e8d1a`. Each claim was checked before adoption
(Playwright types `types.d.ts:4741` for `extraHTTPHeaders` on every request; NextAuth's
`proxyLogger` for the `_log` POST; `fixtures.ts:150-157` for A3's header handling).

- Bypass header injected per request in the route handler, target origin only; `extraHTTPHeaders`
  dropped (it reached `cdn.sanity.io`, `lh3.googleusercontent.com`, and `vercel.com` on an SSO
  bounce — inherited from A3, now closed here). `x-vercel-set-bypass-cookie` on the first
  navigation only.
- Origin compare is exact (`new URL(...).origin ===`), not `startsWith`.
- Sign-in is triggered only by a redirect to `/auth/signin`, never by a 401 — a CRON-gated
  route's 401 would otherwise re-sign-in every run and exceed the accepted `loginEvent` bound.
- HTTP ≥ 400 on `/auth/signin` is a refusal (exit 2), not a page error.
- The storage state is included in the leak scan; spec §3.3 wording made true.
- `DEV_VERIFY.md`: `/api/auth/_log` as a known non-data exit-3 cause; `DEV_VERIFY_OUT_DIR`
  must not be a tracked path; long random password note. SECRETS entry links
  `docs/VERIFICATION_HARNESS.md`.
- Seed twin check excludes `drafts.member-dev-verify`; Task 6 test count corrected to 4;
  shadowed `target` renamed `el`.

Deliberately not adopted: none.

## Process notes on the author's side

- The first draft asserted "the runner never writes" while the app it drives writes a
  `loginEvent` on sign-in and a `lastSeen` patch on mount. Both were found by the reviewer,
  not the author; the spec now separates "the runner is read-only" from "the app writes on
  sign-in", which is the honest statement.
- The first draft made the bot a kids member on the assumption that `retiredFrom` is honoured
  everywhere; CLAUDE.md states the kids exception and the author had read it. Recorded so the
  next reader of that invariant does not repeat the slip.
- Every reviewer claim, blocking and non-blocking, was verified against the cited evidence
  before being acted on; no citation fix was accepted on trust.
