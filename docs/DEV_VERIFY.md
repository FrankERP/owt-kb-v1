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
| `--console` | Include console errors and warnings, plus failed requests, in the report. |
| `--viewport WxH` · `--theme light|dark` | Emulation. `--theme` defaults to `light` when omitted (Playwright's own default) — pass `--theme dark` explicitly for a dark-theme check. Never touches `/me`. |
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
3. The member is a worship member with an EMPTY «Tipo» — in no solver pool and matching no
   seat (ADR-0029) — a kids *manager* but not a kids *member* (kids rotation seats from the
   pair register, so membership would seat it), and opted
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
fresh sign-in). The bypass secret travels as the `x-vercel-protection-bypass` header, but only
on the first navigation of a context; afterwards the bypass cookie Vercel set carries
authorisation, so no later request — redirects included — carries the header. Every artifact
and the report are scanned with the A3 leak scanner before anything is printed.

Choose a long random `DEV_VERIFY_PASSWORD`: redaction replaces the literal value wherever it
appears in the report, so a short or common password would mangle unrelated text.

## Where the credentials live — and how they were lost once

`DEV_VERIFY_EMAIL`, `DEV_VERIFY_PASSWORD` and `DEV_VERIFY_PASSWORD_HASH` live in the
**primary checkout's** `.env.local` and nowhere else. A worktree must reach them through a
symlink:

    ln -s ../../../.env.local .env.local    # from a worktree root under .claude/worktrees/

Never write a real `.env.local` inside a worktree. `.env*.local` is gitignored, so git
neither tracks it nor warns about it, and `git worktree remove` deletes the directory
outright — not to the Papelera. On 2026-09-01 the runner was built in a worktree and its
credentials were written there; the worktree was removed and the values went with it. The
member survived in Sanity, hash and all, but bcrypt is one-way, so the only way back was to
rotate. Rotating is cheap (below); losing an hour working out *why* the runner refuses is
not.

## Rotating the password (one command)

    node scripts/dev-verify-rotate.mjs                    # dry run: shows the plan
    node scripts/dev-verify-rotate.mjs --apply --show    # rotates, verifies, prints the password once

Nothing has to be typed. `scripts/dev-verify-rotate.mjs` mints a 43-character password,
hashes it, patches `member-dev-verify`, rewrites `DEV_VERIFY_EMAIL`, `DEV_VERIFY_PASSWORD`
and `DEV_VERIFY_PASSWORD_HASH` in the primary checkout's `.env.local` (backing it up at mode
600 first), clears the stale storage state, and then **signs in to dev and loads `/`** to
prove the rotation worked — a password that signs in nowhere is indistinguishable from one
that was never written. `--no-verify` skips that last step; `--show` prints the password once
for a password manager.

The address defaults to `verificador-bot@owt-backstage.invalid` when `.env.local` has none.
`.invalid` is reserved by RFC 2606 and can never resolve, so Google can never issue an
account on it — which matters more here than deliverability, because the address is a lookup
key for the credentials sign-in and is never mailed, while a real address carries the risk
`docs/SECRETS.md` names. Pass `--email <address>` to override.

**The order is Sanity first, `.env.local` second, and that is deliberate.** The reverse
leaves the file holding a password whose hash never reached the dataset, and the runner's
refusal then reads as a bug in the runner. A failed seed writes nothing locally and the old
password keeps working. In the narrow window where Sanity succeeds and the local write does
not, the script prints the password to stderr — at that point it is the only copy of a value
the dataset already trusts.

The password is minted inside the script, never typed and never passed as an argument, so it
does not reach shell history.

## Seeding the member (once, Frank)

    node -e "import('bcryptjs').then(b=>console.log(b.default.hashSync(process.argv[1],10)))" '<password>'
    # put the hash in .env.local as DEV_VERIFY_PASSWORD_HASH, the password as DEV_VERIFY_PASSWORD
    node --env-file=.env.local scripts/dev-verify-seed.mjs            # dry run
    node --env-file=.env.local scripts/dev-verify-seed.mjs --apply    # creates or patches member-dev-verify

Kill switch: set `disabled: true` on `member-dev-verify` in Studio; the seed script never
touches that field, so rotating afterwards keeps it disabled. Rotate: new hash, re-run
`--apply`, update `DEV_VERIFY_PASSWORD`, delete the storage state.

`--click` matches an element by accessible name across the `button`, `link`, and `menuitem`
roles — admin destructive actions live behind a kebab whose items are `menuitem` — and
prefers an exact name match over a substring one, so a modal's confirm (`Eliminar`) is not
shadowed by its close control (`Cerrar Eliminar servicio`).

## Verified runs

Run 2026-09-01 against `dev-owt-backstage.vercel.app` serving `feat/dev-verify` (preview
`57203766`), signed in as `member-dev-verify`. The `observedDeployment` values are the
`x-vercel-id` of each run; pair them with `get_deployment(dev-owt-backstage.vercel.app)` for
the commit SHA.

- **(a) Signed-in render — exit 0.** `--route /admin --screenshot admin.png --text --console
  --theme dark`. HTTP 200, `landedUrl` `/admin`, `blockedMutations` empty. The text artifact
  contains the Control Room / Servicios panel (`ACCESO AUTORIZADO`, `SERVICIOS`, `GENERAR MES`,
  `EDITAR MES`), with no sign-in markers — proof the session reached a manager-only surface.
- **(b) Read-only lock, real destructive control — exit 3.** `--route /admin --click "Más
  acciones" --click "Eliminar servicio" --click "Eliminar"`. One `blocked_mutation`:
  `DELETE /api/admin/roles/c71b0a78-7e17-4e18-8397-0271e19ac6e8`. A follow-up `--text` run
  confirmed the 5 September service still exists — the delete was aborted in the browser and
  never reached the server.
- **(c) Production refused before any network — exit 2.** `--route /admin --base-url
  https://owt-backstage.vercel.app --console`. `refusal: host:forbidden_production`, `origin`
  empty, `status` null, zero requests, zero console output — the refusal precedes
  `chromium.launch`.
