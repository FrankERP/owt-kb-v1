# Secrets and environment variables

Where each credential comes from, which platforms need it, and how to rotate it.

**Never record a value here.** This file documents shape and source only.

Platforms in play:

- **Vercel** — the deployed Next.js app (`owt-backstage`, team `frank-rochas-projects`). Settings → Environment Variables.
- **GitHub Actions** — repo secrets for workflows. Settings → Secrets and variables → Actions.
- **`.env.local`** — local development only, gitignored, loaded via `node --env-file=.env.local` for `scripts/*.mjs`.

## Retrievability: the two stores are asymmetric

Worth knowing before you need it, not during:

- **GitHub Actions secrets are write-only.** Neither the UI nor the API will ever show a value again. There is no retrieve — only overwrite.
- **Vercel environment variables are readable**, in the dashboard and via `vercel env pull`.

So **Vercel is the source of truth** whenever a value has to exist in both places, and GitHub is always the copy. Set the value on Vercel first, then mirror it.

### Setting a shared secret without ever handling the value

Write both stores in one shell command, so the value lives only in a variable that is discarded at the end and never reaches your scrollback:

```bash
SECRET=$(openssl rand -hex 32) && \
  printf '%s' "$SECRET" | npx vercel env add CRON_SECRET production && \
  printf '%s' "$SECRET" | gh secret set CRON_SECRET && \
  unset SECRET
```

There is no step where you carry the value between platforms, which is the step that otherwise ends with a secret in a clipboard or a chat log.

### Re-syncing GitHub from Vercel, if they drift

Pull into a scratch file — **not** `.env.local`, which `vercel env pull` rewrites wholesale:

```bash
npx vercel env pull /tmp/vercel-env.txt --environment=production
grep '^CRON_SECRET=' /tmp/vercel-env.txt | cut -d= -f2- | tr -d '"' | gh secret set CRON_SECRET
rm /tmp/vercel-env.txt
```

Prefer rotating both over recovering the old value. Secrets are cheap to replace and awkward to retrieve; that asymmetry is deliberate, and a rotation leaves both stores provably in agreement, where a recovery only assumes it.

---

## `CRON_SECRET`

**Needed in: Vercel *and* GitHub Actions.** Both, for different halves of the same handshake — Vercel holds the verifier, GitHub holds the presenter. The two values must match byte-for-byte.

| Platform | Role |
|---|---|
| Vercel | The routes read `process.env.CRON_SECRET` and compare the presented bearer token against it |
| GitHub Actions | `.github/workflows/flush-notifications.yml` sends it as `Authorization: Bearer …` |
| `.env.local` | Not needed. Only required to exercise the cron routes locally |

**Purpose.** Authorizes the two cron routes. Without it:

- `app/api/cron/service-reminders/route.ts:20` — the daily Vercel cron (service reminders **and** the notification-outbox liveness alarm) returns 403.
- `app/api/cron/flush-notifications/route.ts:31` — the five-minute notification sweep **fails closed**: when `CRON_SECRET` is unset the route 401s every caller, including one presenting nothing. Layer 1 of the notification outbox stops entirely, and members' emails fall back to the daily cron — up to 24 hours late.

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

**Blast radius of rotation.** From the moment Vercel is updated until the redeploy completes, the deployed app still verifies against the *old* value while GitHub already presents the new one — so every five-minute flush run goes red and no debounced notification email is sent, and Vercel's own daily cron is 403ing in the same window. Nothing is lost: outbox notices accumulate and flush once the values agree. Keep the window to a single deploy by doing step 2 immediately.

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

## Not yet documented

Other variables in use — `SANITY_API_*`, `NEXTAUTH_*`, SMTP credentials for `contacto@oasis.mx`, `EMAIL_ALLOWLIST`, `EMAIL_REDIRECT_TO`, FCM push credentials, the solver's Secret Manager key — predate this file. Add each one here as it is next touched or rotated.

Notification-outbox tuning knobs (`NOTIFY_DEBOUNCE_MINUTES`, `NOTIFY_MAX_WINDOW_MINUTES`, `NOTIFY_CLAIM_TTL_MINUTES`, `NOTIFY_SEND_BUDGET_MS`, `NOTIFY_FLUSH_EMAIL_LIMIT`, `NOTIFY_STALE_ALERT_HOURS`) are configuration, not secrets, and all have code defaults. They are specified in `docs/superpowers/specs/2026-07-27-service-notification-emails-design.md` §9.
