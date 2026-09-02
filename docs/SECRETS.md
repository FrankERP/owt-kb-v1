# Secrets and environment variables

Where each credential comes from, which platforms need it, and how to rotate it.

**Never record a value here.** This file documents shape and source only.

Platforms in play:

- **Vercel** — the deployed Next.js app (`owt-backstage`, team `frank-rochas-projects`). Settings → Environment Variables.
- **GitHub Actions** — repo secrets for workflows. Settings → Secrets and variables → Actions.
- **`.env.local`** — local development only, gitignored, loaded via `node --env-file=.env.local` for `scripts/*.mjs`.

## Retrievability: assume nothing is recoverable

Worth knowing before you need it, not during:

- **GitHub Actions secrets are write-only.** Neither the UI nor the API will ever show a value again. There is no retrieve — only overwrite.
- **Vercel environment variables are readable only sometimes**, and you cannot tell which from the dashboard listing. Variables marked **`Sensitive`** are write-only: `vercel env pull` writes an 11-character redaction marker in place of the value.

**`npx vercel env ls` will not tell you.** It prints `Encrypted` in the value column for *every* variable, sensitive or not — that column means "not shown here", not "recoverable". Verified on this project: `CRON_SECRET` and `SMTP_PASS` both pull the same 11-character marker, while `SMTP_USER`, `SMTP_HOST`, `SMTP_PORT` and `EMAIL_FROM` — three of them created in the same batch as `SMTP_PASS` — pull their real values.

**The only reliable check is to pull and compare lengths against what you expect.** A password that pulls as 11 characters is a marker, not a secret.

`npx vercel env add` creates `Sensitive` variables, and credential-shaped values added through the dashboard may be marked that way too, so assume any password or token is unrecoverable until proven otherwise.

**This bites in a specific and quiet way.** A pull-and-pipe re-sync against a `Sensitive` variable copies the *placeholder* into the destination. Nothing errors. The secret looks set, and every request authenticated against it fails with a 401 that appears to be a mismatch of correct-looking values. Before trusting any pulled value, check its length against what you expect — a 64-character hex token that pulls as 11 characters is a placeholder, not a secret.

**So: treat both stores as write-only, and rotate rather than recover.** There is no source of truth to copy from once a value is set; the value's only home is the moment it was generated.

### Setting a shared secret without ever handling the value

Write both stores in one shell command, so the value lives only in a variable that is discarded at the end and never reaches your scrollback:

```bash
SECRET=$(openssl rand -hex 32) && \
  printf '%s' "$SECRET" | npx vercel env add CRON_SECRET production && \
  printf '%s' "$SECRET" | gh secret set CRON_SECRET && \
  unset SECRET
```

There is no step where you carry the value between platforms, which is the step that otherwise ends with a secret in a clipboard or a chat log.

### If the two ever drift

**Rotate both. Do not try to recover the old value.** For a `Sensitive` Vercel variable there is nothing to recover, and the attempt fails silently in the way described above.

Rerun the one-shot command with a fresh value, removing the existing Vercel key first (`vercel env add` refuses to overwrite):

```bash
npx vercel env rm CRON_SECRET production
```

then the generate-and-write block above, then redeploy. A rotation leaves both stores provably in agreement; a recovery only assumes it, and for a `Sensitive` variable it cannot even do that.

`vercel env pull` remains useful for ordinary `Encrypted` variables — for populating a local `.env.local`, for instance. Point it at a scratch path when you only want to inspect, since it rewrites the target file wholesale.

---

## `CRON_SECRET`

**Needed in: Vercel *and* GitHub Actions.** Both, for different halves of the same handshake — Vercel holds the verifier, GitHub holds the presenter. The two values must match byte-for-byte.

| Platform | Role |
|---|---|
| Vercel | The routes read `process.env.CRON_SECRET` and compare the presented bearer token against it |
| GitHub Actions | `.github/workflows/flush-notifications.yml` sends it as `Authorization: Bearer …` |
| `.env.local` | Not needed. Only required to exercise the cron routes locally |

**Purpose.** Authorizes the two cron routes. Without it:

- `app/api/cron/service-reminders/route.ts:29` — the daily Vercel cron (service reminders **and** the notification-outbox liveness alarm) returns 403.
- `app/api/cron/flush-notifications/route.ts:103` — the notification sweep **fails closed**: when `CRON_SECRET` is unset the route 401s every caller, including one presenting nothing. Layer 1 of the notification outbox stops entirely, and members' emails fall back to the daily cron — up to 24 hours late.

**Where the value came from.** A random bearer token with no external issuer — any high-entropy string works. Generate one with `openssl rand -hex 32`.

**How to rotate.**

1. Write both stores in one command, per "Setting a shared secret without ever handling the value" above:
   ```bash
   SECRET=$(openssl rand -hex 32) && \
     printf '%s' "$SECRET" | npx vercel env add CRON_SECRET production && \
     printf '%s' "$SECRET" | gh secret set CRON_SECRET && \
     unset SECRET
   ```
   `vercel env add` refuses an existing key, so on a true rotation remove it first with `npx vercel env rm CRON_SECRET production`.
2. **Redeploy.** This is the step that is easy to skip and makes the whole thing look broken if you do — Vercel binds env vars at deploy time, so the running production deployment keeps the old value until it is rebuilt:
   ```bash
   npx vercel deploy --prod
   ```
   Or dashboard → Deployments → ⋯ → Redeploy.
3. Verify end to end:
   ```bash
   gh workflow run "Flush notification outbox"
   ```
   A green run means the new value matches on both sides. A 401 means it does not.

**Blast radius of rotation.** From the moment Vercel is updated until the redeploy completes, the deployed app still verifies against the *old* value while GitHub already presents the new one — so every flush run goes red and no debounced notification email is sent, and Vercel's own daily cron is 403ing in the same window. Nothing is lost: outbox notices accumulate and flush once the values agree. Keep the window to a single deploy by doing step 2 immediately.

---

## `APP_BASE_URL`

**Needed in: GitHub Actions only.** Not in Vercel, not in `.env.local`. Setting it in Vercel would have no effect — no application code reads it; the only references in the repo are in the workflow YAML.

**Purpose.** Tells the flush workflow which deployment to curl. The workflow appends `/api/cron/flush-notifications` directly, so the value carries **no trailing slash**.

**Where the value came from.** The project's canonical production domain, from the Vercel project's Domains list: `https://owt-backstage.vercel.app`.

Note this is a public URL, not a credential. It lives in the Actions secret store because that is where workflow configuration goes, not because the value is sensitive.

**How to rotate / change.** Only changes if the production domain changes (e.g. a custom domain is added and becomes canonical):

```bash
gh secret set APP_BASE_URL
```

Then confirm with a manual run as above.

**Blast radius.** A wrong value makes every flush run red — 404 for a wrong path, DNS failure for a wrong host. Notification emails stall until corrected but nothing is lost.

**Related, and easy to confuse with it:** the app's own idea of its base URL is *not* this variable. `appBaseUrl()` (`app/utils/assignmentEmail.ts:70`) resolves `NEXTAUTH_URL` first, falling back to `VERCEL_PROJECT_PRODUCTION_URL`. That is what builds links inside outgoing emails.

---

---

## `SMTP_PASS` (and the rest of the SMTP set)

**Needed in: Vercel.** Also needed locally by anything that actually sends mail — currently only `scripts/measure-send-budget.mjs`.

**THE SENDER MOVED TO GMAIL** ([ADR-0025](adr/0025-mail-sends-through-a-gmail-account.md) carries the measurement that justified it and the alternatives rejected on the way)**.** It was `contacto@oasis.mx` over `mail.oasis.mx` (cPanel/MailBaby) until DNS verification for `oasis.mx` in Resend could not be completed. Sending now goes through **Gmail SMTP as `dev.raccoon.labs@gmail.com`**, and `SMTP_PASS` is a Google **App Password**, not a mailbox password. Anything below that still says cPanel is describing the old sender.

**Not needed in GitHub Actions.** The flush workflow only curls the route; it never sends mail itself and reads none of these.

The set is `SMTP_HOST` (`smtp.gmail.com`), `SMTP_PORT` (465), `SMTP_USER` (`dev.raccoon.labs@gmail.com`), `SMTP_SECURE` (optional — defaults to `port === 465`, so it is normally unset), `SMTP_PASS` and `EMAIL_FROM`. All of them except `SMTP_PASS` pull cleanly from Vercel. **`SMTP_PASS` does not** — it is `Sensitive` and pulls as the 11-character marker described above, so `vercel env pull` alone will never give you a working local mail setup. Attempting it fails with `535 Incorrect authentication data`, which reads like wrong credentials rather than absent ones.

**Where the value came from.** Google Account → Security → 2-Step Verification → **App passwords**, for the `dev.raccoon.labs@gmail.com` account. An app password is shown ONCE at creation and is not recoverable afterwards from Google or from Vercel — a lost one is replaced, never retrieved. It also requires 2-Step Verification to be on for that account; turning 2SV off revokes every app password on it.

**How to rotate.** Create a NEW app password in that Google account first, update `SMTP_PASS` in Vercel for Production *and* Preview, redeploy, confirm a send works, and only then revoke the old one. Creating before revoking is what keeps the blast radius near zero — in the other order every outbound email is down in between: assignment notifications, the debounced notification sweep, proposal emails, and the outbox liveness alarm.

**Gmail's own limits apply now and did not before.** A free Gmail account is bounded at roughly 500 recipients/day and a Workspace account at 2000; the outbox's batches are far under that today, but a large fan-out is a limit that `mail.oasis.mx` did not impose. Gmail may also refuse a `From` that is not the authenticated account or a verified "Send mail as" alias — which is why `EMAIL_FROM` cannot be an arbitrary `noreply@` address on this sender. **Only the ADDRESS is constrained, not the label:** `EMAIL_FROM` currently carries a display name, `OWT Backstage <dev.raccoon.labs@gmail.com>`, which Gmail accepts because the address is still the authenticated account. A `noreply@` needs a domain this project can publish DNS for — and `oasis.mx` is not one: its zone is served by `ns1/ns2.softlayer.com`, not by the cPanel whose Zone Editor is reachable, which is why the Resend verification for it fails with "all required records are missing" no matter what is entered there.

---

## `EMAIL_REDIRECT_TO`

**Not a secret** — an email address, and a deliberate safety valve. Documented here because it is the single most consequential non-secret in the mail path.

**Needed in: Preview, deliberately and permanently. Absent in Production.** The two environments want opposite things and conflating them is the whole hazard:

- **Production must have it absent**, or the team never receives their own mail.
- **Preview has it SET on purpose** (present since ~2026-07-24, dated from the age `vercel env ls preview` reports — no commit records the change). That is what stops a rehearsal on `dev-owt-backstage` from mailing the whole team. **Do not remove it** to "clean up"; removing it is a decision to let dev mail the team, not a tidy-up.

On Production, setting it is a temporary, reversible act. On Preview it is the resting state.

**Purpose.** When set, *every* outgoing email is redirected to that one address instead of its real recipient, with the intended recipient prefixed into the subject as `[→ real@address] …` (`outboxSweep.ts` stage 7). Nothing else changes: classification, grouping, the send loop, and stage 8's unconditional consume all behave exactly as in a real run. That is what makes it the only honest way to rehearse a fan-out — a completely real batch that reaches nobody.

**Where the value came from — Production.** Whoever is running the rehearsal. On 2026-08-07 it was set to the maintainer's own address to measure `msPerSend` for a 17-recipient batch without mailing the team. Set again on 2026-08-27 for the concurrency-8 verification sweep (14 recipients) and removed after, its absence confirmed by pulling the environment.

**Where the value came from — Preview.** Set once, around 2026-07-24 (dated from the age `vercel env ls preview` reports; no commit records it). Read the current target with `npx vercel env pull` against the preview environment — it is a plain address, not a secret, but it is not written down here on purpose so there is one source of truth.

**How to rotate the Preview value.** `npx vercel env rm EMAIL_REDIRECT_TO preview --yes`, then `printf 'new@address' | npx vercel env add EMAIL_REDIRECT_TO preview`, then **redeploy `preview`** and verify the dev alias moved. Blast radius while rotating: between the `rm` and the redeploy that follows the `add`, a running preview function still holds the OLD value, so mail keeps going to the previous address — it does not leak to the team. But if a deploy happens in the window after `rm` and before `add`, preview mails the real team until the next deploy. Do the two commands back to back, then redeploy once.

**How to set and unset.**

```bash
printf 'you@example.com' | npx vercel env add EMAIL_REDIRECT_TO production
npx vercel env rm EMAIL_REDIRECT_TO production --yes
```

**A redeploy is required either way** — a running function keeps the value it booted with, so adding it without redeploying rehearses nothing and removing it without redeploying keeps mail redirected. Verify the alias moved before trusting either state.

**The commands above target `production`. Do not run the `rm` against `preview`** — that is where the variable belongs. Preview deploys against the **real Sanity dataset**, so its writes are real; the redirect is the only thing keeping its *mail* off the team. Substitute `preview` only when you intend to change that deliberately.

**Corrected 2026-08-29.** This section previously told the reader to "confirm it is absent" on `preview` as well, on the belief that preview emails the real team. It does not, and following that instruction would have caused exactly the fan-out this variable prevents. `CLAUDE.md` and `AGENTS.md` carried the same wrong claim and were corrected in the same delivery.

**Blast radius — on Production.** While it is set there, *nobody on the team receives any notification* — and because the outbox consumes unconditionally with no retry, notices flushed during that window are **spent**, not queued. Leaving it set by accident is silent, total notification loss that still reports green. Unset it the moment the rehearsal ends, and confirm with `vercel env ls production`.

**Blast radius — on Preview.** The reverse, and it is the likelier mistake now: removing it there means the next publish, role edit or setlist change made while testing on `dev-owt-backstage` mails the real team, with no other change and no warning.

---

## `NOTIFY_FLUSH_EMAIL_LIMIT` (when overridden in Vercel)

**Not a secret** — a tuning knob with a code default of 40. Listed here only because it is currently **set in Production**, and a knob set in a dashboard with no record is exactly what this file exists to prevent.

**Needed in: Vercel Production only.** Not in GitHub Actions — the flush workflow only curls the route and never reads this. Not in `.env.local`, and not on Preview unless you are deliberately rehearsing there.

**It is a tuning number, not a credential, and it is now stored as `Config` rather than `Secret`.** It was Sensitive until 2026-08-27, which meant `vercel env ls` showed `Hidden` and `vercel env pull` returned `[SENSITIVE]` — so the operative value could not be verified by anyone, only asserted in this file. A knob whose whole purpose is to be checked against a measurement should be readable. Re-add it with `--no-sensitive` if it is ever recreated.

**Why it is set.** It caps the DISTINCT RECIPIENTS one sweep may claim. That cap is what makes stage 8's unconditional delete safe: a sweep is supposed to fully discharge everything it claims, so anything it claims and cannot send is **destroyed**, not retried. When `ms_per_send` is unknown or bad, a low value turns that risk into a bounded experiment — selection claims only what it can serve and leaves the rest **pending and unclaimed** (`report.deferred`), which the next sweep picks up.

**Set to `40` since 2026-08-27**, after the concurrency-8 code was released and a production sweep verified it on the real path. The 2 was sized for the ~14 s per send of the retired `mail.oasis.mx`; the reasoning below explains why the cap was ever below the per-service seat count.

**THE TWO ARE COUPLED, and the order mattered.** 40 is only safe at
`SEND_CONCURRENCY = 8`: against serial code a sweep would claim 40, serve about
11, and **destroy the rest** — the "high loses mail" failure this section
describes. So the code shipped first, a production sweep verified it, and the cap
followed. **If `SEND_CONCURRENCY` is ever lowered, lower this first** — in that
order, or the window between them loses mail. It is the lesser of two bad options, and both are worth understanding before anyone changes it.

The cap governs what a sweep **claims**, and claiming is what commits a notice to being deleted whether or not it was sent. Above the serviceable count, the excess is destroyed. Below the month's distinct-recipient count, the fan-out fragments, because stage 6 can only group what stage 3 claimed — and a month of roles is published at once, so the requirement is ONE grouped email per member covering their whole month. So: high loses mail, low fragments it. **`2` chose fragmentation**, because losing it is worse — and it was the right call for a sender that took ~14 s per message. At Gmail's measured throughput the trade is gone: 40 is inside what the send path services, so the cap no longer has to pick a failure.

**This does not protect `setlist` notices.** One setlist notice carries ALL of a service's participants in a single document, so it cannot be split by any cap: it is taken alone, over budget, and everyone past the serviceable count is destroyed. **`ms_per_send` coming down is exactly what has happened:** on 2026-08-27 a 14-recipient setlist notice went out with `unserved: 0` on Gmail, where the old sender would have destroyed 12. The gap is not closed in the code — the sweep still consumes what it never attempted — but at the current latency it is no longer being hit.

**It WAS the binding constraint, by a factor of 36, and was the last knob still sized for the retired server.** `docs/NOTIFICATIONS.md` §"Send throughput on Gmail" carries the derivation, which depends on BOTH the per-send latency AND the concurrency — earlier versions of this line gave a single-number threshold ("raise it to 40 once a send costs under ~2 s") and an inferred ceiling of ~136 recipients, and both were wrong for that reason. The measured ceiling is **72**.

**The code default of 40 is MEASURED to hold** — probed 2026-08-27 against the live Gmail transport: 40 recipients is 5 waves at a per-wave p95 of 2 429 ms, so 9 716 ms of the spendable 20 000, leaving 10 284 ms of margin. The clock allows 72; the cap allows 40.

It was raised 2 → 40 on 2026-08-27, after a production sweep verified concurrency 8 on the real path. To re-probe, `scripts/measure-send-budget.mjs --to=you@example.com --concurrency=8 --apply` needs the app password, which `vercel env pull` will not give you (verified 2026-08-27: `SMTP_PASS` pulls as an 11-character `[SENSITIVE]` placeholder).

**How to set and unset:**

```bash
# `--no-sensitive` deliberately: this is a tuning number, not a credential, and it
# was stored as a Secret until 2026-08-27 — which meant the operative value could
# not be read back and checked against the measurement it is derived from.
npx vercel env add NOTIFY_FLUSH_EMAIL_LIMIT production --no-sensitive --value=40
npx vercel env rm NOTIFY_FLUSH_EMAIL_LIMIT production --yes
```

**A redeploy is required** for either direction to reach a running function.

**Blast radius.** Set BELOW a service's fan-out, that service is split across sweeps — some members hear now and the rest on a later flush. Slower, but nothing is deleted unsent, which is why it sat at 2 for three weeks. Set ABOVE what the send path can service in `NOTIFY_SEND_BUDGET_MS`, the excess is claimed and destroyed silently. At 40 with `SEND_CONCURRENCY = 8` the measured ceiling is 72, so there is margin on both sides — but that margin is a property of the CURRENT sender and width, not of the number 40.

## Sanity CLI session token (`~/.config/sanity/config.json`)

**Not an environment variable, and not a project token.** This is the credential
`npx sanity login` writes to your machine. It authenticates as *you*, so its
reach is every project and organization your Sanity account can see — wider than
any of the project API tokens below, which are scoped to `ebb8vcnk` alone.

- **Where it lives:** `~/.config/sanity/config.json` on each machine you have run
  `sanity login` from. Nowhere else. **It is not set on Vercel, not in GitHub
  Actions, not in `.env.local`, and no application code reads it** — only the
  `sanity` CLI does, for `schema deploy`, `schema list`, `deploy`, `dataset`, etc.
- **Where it came from:** `npx sanity login`, browser SSO.
- **How to rotate:** `npx sanity logout` (invalidates the session server-side),
  then `npx sanity login`. Repeat per machine. There is no dashboard entry for
  it — revoking project API tokens does *not* touch it.
- **Blast radius of rotation: none for the running app.** Production, preview,
  the cron workflows and every script keep working, because none of them use it.
  What breaks is only the `sanity` CLI on the machine you logged out of, until
  you log back in.
- **Never run `sanity debug --secrets`.** Plain `sanity debug` prints the same
  diagnostics without the token. The `--secrets` flag prints the value to stdout,
  which on 2026-08-25 put it into an agent session transcript and forced a
  rotation. That is the whole reason this section exists.

## Sanity project API tokens

Three separate tokens, created at **sanity.io/manage → project `ebb8vcnk` → API →
Tokens**. All are `Sensitive` in Vercel, so they read back as a placeholder and
cannot be recovered — see [Retrievability](#retrievability-assume-nothing-is-recoverable).

### `SANITY_WRITE_TOKEN`

- **Purpose:** every server-side mutation — proposal writes, role and setlist
  writes, the notification outbox sweep, and the `--apply` half of one-off
  scripts in `scripts/`. Without it, all writes fail and the app is read-only.
- **Role needed:** Editor.
- **Platforms:** Vercel **twice** — once for `Preview, Production`, and once
  branch-scoped to `Preview (verify/service-readiness)`. Also local `.env.local`.
  **Not** in GitHub Actions (the cron workflows authenticate with `CRON_SECRET`
  against the app, and never touch Sanity directly).
- **Observed by the delivery firewall:** `app/utils/deliveryFirewall.ts:148` lists
  it in `OBSERVED_ENVS` — it must stay SET on the verification deployment. Read
  the comment at `:126-148` before changing anything about it.

### `SANITY_API_READ_TOKEN`

- **Purpose:** authenticated reads that must bypass the CDN — NextAuth member
  lookups (`sanity/lib/serverClient.ts:10`), `operationalClient`, and the
  dry-run half of `scripts/` migrations.
- **Role needed:** Viewer.
- **Platforms:** same two Vercel scopes as above, plus local `.env.local`. **Not**
  in GitHub Actions.

### `SR_VERIFY_SANITY_TOKEN`

- **Purpose:** the service-readiness e2e harness only
  (`scripts/lib/sr-verification.mjs:40`, `e2e/service-readiness/lib/harnessGuards.ts:332`).
  The harness refuses to run without it and will not fall back to the other two.
- **Platforms:** **local `.env.local` only.** Deliberately **not** in Vercel and
  **not** in GitHub Actions — do not add it "to be safe"; the harness is run by
  hand against a seeded slice, and giving a deployment a token that can write the
  verification fixtures is exactly what its guards exist to prevent.

### Rotating a project API token

1. Create the **new** token first (same role) at sanity.io/manage → `ebb8vcnk` →
   API → Tokens. Do not revoke the old one yet.
2. Update every platform that holds it. For `SANITY_WRITE_TOKEN` and
   `SANITY_API_READ_TOKEN` that is **four Vercel entries** — the `Preview,
   Production` pair and the `Preview (verify/service-readiness)` pair — plus your
   local `.env.local`. Missing the branch-scoped pair is the easy mistake: the
   app keeps working and only the verification deployment breaks, later, in a
   way that looks unrelated.
3. **Redeploy.** Vercel bakes env vars at build time, so an updated variable does
   nothing until the next deployment. Push `preview`, verify the alias, then
   `main` through the PR gate.
4. Only after the new value is live everywhere, revoke the old token.

**Blast radius if you revoke first:** between the revoke and the last redeploy,
every authenticated read and every write fails — members cannot sign in
(NextAuth reads through `SANITY_API_READ_TOKEN`), proposals cannot be saved or
approved, and the outbox sweep cannot flush. Create-then-swap-then-revoke, in
that order, and the window is zero.

## `RESEND_API_KEY`

**Needed in: Vercel** — and only as the FALLBACK transport. `sendEmail` prefers SMTP whenever `SMTP_HOST` is set (`app/utils/email.ts`), so with the Gmail set configured this key is not on the live path. It becomes the live path the moment SMTP is unset or `SMTP_HOST` is removed.

**Purpose.** Sends through Resend's API instead of an SMTP mailbox. Unlike SMTP it requires a VERIFIED SENDING DOMAIN, which is the whole reason it is not primary: verification for `oasis.mx` was never completed — that zone is served by `ns1/ns2.softlayer.com`, not by the reachable cPanel, so records added there are never published. Until a domain is verified, Resend delivers only to the account owner's own address.

**Where the value came from.** The Resend dashboard → API Keys. Shown once at creation.

**How to rotate.** Create a new key in Resend, update `RESEND_API_KEY` in Vercel (Production and Preview), redeploy, then revoke the old one. **Blast radius is currently nil** because SMTP is preferred and this path is dormant — but that is a property of `SMTP_HOST` being set, not of the key. If SMTP is ever removed, this becomes the only transport and the same create-then-revoke order applies.

## Google OAuth — `GOOGLE_CLIENT_SECRET` and the three client IDs

**Needed in: Vercel.** `GOOGLE_CLIENT_SECRET` and `GOOGLE_CLIENT_ID` back the web `GoogleProvider`; `GOOGLE_IOS_CLIENT_ID` and `GOOGLE_ANDROID_CLIENT_ID` are accepted audiences for the native `google-native` credentials path (Capacitor). Not needed in GitHub Actions.

**Purpose.** Sign-in. Without them nobody can authenticate, on any surface.

**A FOURTH variable holds the same value as one of them.** `NEXT_PUBLIC_GOOGLE_IOS_CLIENT_ID` (`app/utils/native.ts`) is the client-side half of the iOS flow and **must equal the server's `GOOGLE_IOS_CLIENT_ID`** — the server validates the audience of a token the client obtained with it, so a mismatch fails sign-in on iOS only, silently on every other surface. Being `NEXT_PUBLIC_`, it is inlined into the bundle at build time, so changing it needs a rebuild rather than just a redeploy.

**Where the values came from.** Google Cloud console → APIs & Services → Credentials, in the project that owns the OAuth consent screen. The client IDs are **not secret** and appear in client bundles by design; only `GOOGLE_CLIENT_SECRET` is.

**How to rotate the secret.** Add a second secret to the same OAuth client in the Google console, update `GOOGLE_CLIENT_SECRET` in Vercel, redeploy, confirm a web sign-in works, then delete the old secret. **Blast radius:** between updating Vercel and the redeploy completing, web Google sign-in fails; existing sessions survive because they are JWT-backed. The native paths do not use the secret and are unaffected. Rotating a client **ID** is a different and much larger job — it invalidates the mobile builds that hard-code it.

## `DEV_VERIFY_EMAIL`, `DEV_VERIFY_PASSWORD`, `DEV_VERIFY_PASSWORD_HASH`

- **Needed on:** local `.env.local` only. **Not needed on:** Vercel (any environment), CI, the mobile build.
- **Purpose:** `scripts/dev-verify.ts` signs in to dev as the «Verificador (bot)» member
  (`member-dev-verify`, role `admin`, retired from worship, kids manager only). Without `EMAIL`/`PASSWORD`
  the runner refuses (exit 2). `PASSWORD_HASH` is read only by `scripts/dev-verify-seed.mjs`.
- **Where it came from:** the password is chosen by Frank; the hash is generated locally with
  `bcryptjs` (see `docs/DEV_VERIFY.md`). The email is any address Frank controls; it is never mailed.
  Choose a long random `DEV_VERIFY_PASSWORD`: redaction replaces the literal value wherever it
  appears in the report, so a short or common password would mangle unrelated text.
- **Rotate:** generate a new hash → run the seed with `--apply` → update `DEV_VERIFY_PASSWORD`
  in `.env.local` → delete `playwright/.dev-verify-storageState.json`.
- **Blast radius of rotation:** the runner fails to sign in between the seed and the env update.
  Nothing else uses the member. **Kill switch:** `disabled: true` on the member in Studio.
- **Exposure:** this is an `admin` credential on the production dataset. A leaked `.env.local`
  lets a human sign in to production as an admin; the runner's host check does not bind a human.
  Use an address with **no Google account**: Google SSO signs in by email lookup too, so a Google
  identity on `DEV_VERIFY_EMAIL` would be a second door to the same admin.
- **Writes the sign-in causes:** one `loginEvent` document per credentials sign-in (bounded by
  the cached session; accepted by Frank 2026-09-01). The `lastSeen` heartbeat is suppressed.

## `SR_VERIFY_BYPASS_SECRET`

- **Needed on:** local `.env.local` (A3 harness and `scripts/dev-verify.ts`). **Not needed on:**
  Vercel — Vercel holds its own copy as the project's Protection Bypass for Automation.
- **Purpose:** passes Vercel SSO protection on preview deployments, sent only as the
  `x-vercel-protection-bypass` header. Without it both tools refuse.
- **Where it came from:** Vercel → project `owt-backstage` → Settings → Deployment Protection →
  Protection Bypass for Automation. The A3 harness's use of it is described in
  `docs/VERIFICATION_HARNESS.md` §2 "Secret hygiene" and §3 "Environment"; this entry is the
  rotation record for both tools.
- **Rotate:** regenerate in that Vercel screen (the old value stops working immediately) → update
  `.env.local`.
- **Blast radius of rotation:** every local A3 and dev-verify run fails until `.env.local` is
  updated. Deployments themselves are unaffected.

## Not yet documented

Other variables in use — `NEXTAUTH_*`, `EMAIL_ALLOWLIST`, FCM push credentials, the solver's Secret Manager key — predate this file. Add each one here as it is next touched or rotated.

Notification-outbox tuning knobs (`NOTIFY_DEBOUNCE_MINUTES`, `NOTIFY_MAX_WINDOW_MINUTES`, `NOTIFY_CLAIM_TTL_MINUTES`, `NOTIFY_SEND_BUDGET_MS`, `NOTIFY_FLUSH_EMAIL_LIMIT`, `NOTIFY_STALE_ALERT_HOURS`) are configuration, not secrets, and all have code defaults. They are specified in `docs/superpowers/specs/2026-07-27-service-notification-emails-design.md` §9.
