# Dev verification runner (`scripts/dev-verify.ts`)

Read-only observation of `dev-owt-backstage.vercel.app` as the «Verificador (bot)» member,
so an agent can see what a change renders without anyone typing a credential.
Spec: `docs/superpowers/specs/2026-09-01-dev-verify-runner-design.md`. Decision record:
`docs/adr/0027-agent-dev-verification-is-a-local-read-only-runner.md`.

## Run

    npx tsx --env-file=.env.local scripts/dev-verify.ts --route /admin --screenshot admin.png --text --console

| Flag | Meaning |
|---|---|
| `--route <path>` | Required. |
| `--base-url <origin>` | Default `https://dev-owt-backstage.vercel.app`. Only dev and this project's preview hosts are accepted; production is refused by name. |
| `--screenshot <file>` / `--full-page` | PNG into `test-results/dev-verify/` (or `$DEV_VERIFY_OUT_DIR`, or an absolute path). |
| `--text` / `--a11y` | Page text / accessibility tree, written next to the screenshot. |
| `--console` | Include console errors and failed requests in the report. |
| `--viewport WxH` · `--theme light|dark` | Emulation. `--theme` never touches `/me`. |
| `--click "<accessible name>"` | Repeatable, in order, before capture. Still read-only (see locks). |
| `--wait "<text>"` | Wait for text before capture (30 s). |
| `--json` | Machine-readable report. |

Exit codes: `0` ok · `2` refused (host, env, sign-in) · `3` a mutation was attempted and blocked · `4` page error or HTTP ≥ 500.

An on-origin HTTP 401/403 on the *observed* route (e.g. a rotated bypass secret answering in
place, never redirecting to `/auth/signin`) is also a refusal — exit 2, not exit 4.

An exit 3 during sign-in usually means NextAuth's client logger tried to `POST /api/auth/_log`
after one of its own fetches failed — sign-in infrastructure, not app data. It is blocked on
purpose and never allow-listed.

`DEV_VERIFY_OUT_DIR` must never point inside a tracked path: `--text` on `/admin/members`
writes member names and emails. The default `test-results/dev-verify/` is gitignored.

Pair every run with the alias check: the report's `observedDeployment` is the `x-vercel-id`
of the response, not a commit. `get_deployment(dev-owt-backstage.vercel.app)` gives the SHA.

## Why it cannot write

1. Every request to the target that is not `GET`/`HEAD` is aborted in the browser and
   reported as `blocked_mutation` (exit 3). The single exception is `POST
   /api/auth/callback/credentials` during sign-in. This is wider than `/api/**` on purpose:
   Next.js server actions POST to the page URL.
2. Production hosts are refused before the allow-list is consulted (`hostPolicy.ts`).
3. The member is a worship member retired from worship, a kids *manager* but not a kids
   *member* (kids reads never filter on retirement, so membership would seat it), and opted
   out of every notification.

Lock 1 is origin-scoped: Studio's calls to `api.sanity.io` are not policed. That is safe
only because the runner holds no Sanity login and imports no Sanity client.

## Writes that DO happen, and why they are accepted

- **One `loginEvent` document per sign-in** (`auth.ts` `events.signIn`). Unavoidable without
  changing `auth.ts`, which is out of scope. Bounded: once per cached session (7 days) or per
  rotation. The bot appears in the admin login-activity view. Accepted by Frank, 2026-09-01.
- **`lastSeen` heartbeat — suppressed.** `ActivityPing` would POST `/api/activity/ping` on the
  first authenticated page of every fresh browser; the runner seeds its `sessionStorage` key so
  the request never fires. It is not allow-listed: if the seed ever stops working, the POST is
  blocked and the run exits 3, which is the correct failure.

## Session and secrets

Env (all in `.env.local`, never in Vercel): `DEV_VERIFY_EMAIL`, `DEV_VERIFY_PASSWORD`,
`SR_VERIFY_BYPASS_SECRET`. See `docs/SECRETS.md`. The session is cached at
`playwright/.dev-verify-storageState.json` (gitignored; a live session — delete it to force a
fresh sign-in). The bypass secret travels only as the `x-vercel-protection-bypass` header;
every artifact and the report are scanned with the A3 leak scanner before anything is printed.

## Seeding the member (once, Frank)

    node -e "console.log(require('bcryptjs').hashSync(process.argv[1], 10))" '<password>'
    # put the hash in .env.local as DEV_VERIFY_PASSWORD_HASH, the password as DEV_VERIFY_PASSWORD
    node --env-file=.env.local scripts/dev-verify-seed.mjs            # dry run
    node --env-file=.env.local scripts/dev-verify-seed.mjs --apply    # creates or patches member-dev-verify

Kill switch: set `disabled: true` on `member-dev-verify` in Studio; the seed script never
touches that field, so rotating afterwards keeps it disabled. Rotate: new hash, re-run
`--apply`, update `DEV_VERIFY_PASSWORD`, delete the storage state.

## Verified runs

(Filled in by Task 8.)
