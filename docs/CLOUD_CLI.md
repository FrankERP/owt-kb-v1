# CLI access from a Claude Code on the web session

What a remote session can already reach, what it cannot, and the smallest set of
secrets that closes the gap. Measured on 2026-09-21 in a `claude/*` session
against `FrankERP/owt-kb-v1`.

The container is **ephemeral**. Anything installed by hand during a session dies
with it, so the durable answer is two things and only two: the SessionStart hook
in `.claude/hooks/session-start.sh`, and environment variables set on the
**environment**, not in a shell. Everything below is one or the other.

## The posture: nothing is stored

**Decided 2026-09-21. No long-lived credential is kept in this environment.**
That is a choice, not a limitation, and it is achievable because of a fact worth
stating plainly: the two things a session actually needs — GitHub, and reading
Vercel deployments — both work with **no stored secret at all**.

| Service | Reachable? | Credential in use | Stored anywhere? |
| --- | --- | --- | --- |
| GitHub | yes | rewritten by the agent proxy per request | **no** |
| Vercel | yes | the authenticated Vercel MCP server | **no** |
| Google Cloud | yes | a pasted access token, ~1 h, when needed | **no** |

`VERCEL_TOKEN` and `GCP_SA_KEY` are supported by the hook and documented in
`docs/SECRETS.md`, and **neither is set**. They exist as a recorded escape hatch
with its price written down, so that turning one on later is a decision someone
makes on purpose rather than a default nobody examined. Leave them unset.

---

## How the egress proxy changes the picture

Every outbound HTTPS request leaves through the agent proxy at `$HTTPS_PROXY`,
which re-terminates TLS (CA bundle at `/root/.ccr/ca-bundle.crt`) and enforces
an allowlist. Three consequences drive everything in this document:

1. **The proxy can rewrite an `Authorization` header.** It does this for
   `api.github.com`, which is why GitHub needs no secret here.
2. **It does not do that for Google or Vercel.** `CLOUDSDK_AUTH_ACCESS_TOKEN`
   and friends are set to the literal placeholder string `proxy-injected` with
   nothing behind them. Confirmed by substituting a junk token: GitHub still
   returns `200`, Google and Vercel return the same error as the placeholder.
3. **gRPC, HTTP/2-only APIs, WebSockets and non-443 ports are not supported.**
   The REST/JSON surfaces of all three services are, which is what the CLIs use.

`gcloud`'s proxy and CA settings (`CLOUDSDK_PROXY_*`,
`CLOUDSDK_CORE_CUSTOM_CA_CERTS_FILE`) are already exported by the environment —
the binary is simply absent. Installing it is enough; no proxy configuration is
needed.

---

## GitHub — already works, with one sharp edge

`git push`, `git fetch` and the `mcp__github__*` tools work with no setup. The
hook installs `gh` because `gh api` is genuinely useful, but two things must be
understood before relying on it.

**`gh auth status` reports the token as invalid. Ignore it.** It reads the
literal `GH_TOKEN` value (`proxy-injected`) rather than the credential the proxy
substitutes downstream. `gh api user` returns `FrankERP` on the same box, in the
same second. Do not "fix" this by adding a real PAT: a PAT would be a second,
long-lived credential with none of the proxy's scoping, solving a cosmetic
message.

**GraphQL is blocked outright.** Every request to `api.github.com/graphql`
returns `403 GitHub GraphQL is not available from Claude Code sessions`. That is
not a permission you can grant — it is the session type. It takes out most of
`gh`'s high-level surface:

| Blocked (GraphQL) | Use instead |
| --- | --- |
| `gh issue list` / `view` / `create` / `comment` / `edit` / `close` | `gh api repos/{owner}/{repo}/issues…` |
| `gh pr list` / `view` / `comment` / `edit` | `gh api repos/{owner}/{repo}/pulls…` |
| `gh repo view` | `gh api repos/{owner}/{repo}` |

REST-backed commands are fine — `gh run list`, `gh api` in all its forms.

**This makes `docs/agents/issue-tracker.md` inaccurate for web sessions.** Every
command it prescribes is a `gh issue`/`gh pr` subcommand, and every one of them
fails here. The REST equivalents exist for all of them, and the
`mcp__github__*` tools cover the same ground without the translation. That doc
has not been rewritten — treat its `gh issue`/`gh pr` recipes as local-machine
instructions until it is.

Review threads, auto-merge and draft/ready transitions have no REST equivalent
in the public API; the proxy exposes them as `ccr` routes on `api.github.com`
(`GET /repos/{owner}/{repo}/pulls/{n}/ccr/review_threads`, and the matching
`ccr/comments/{id}/resolve`, `ccr/auto_merge`, `ccr/ready_for_review`,
`ccr/convert_to_draft`).

---

## Vercel — prefer the MCP; the CLI is the fallback

**The Vercel MCP server in this session is already authenticated.** It answers
`list_projects` with the canonical `owt-backstage` project without a token. That matters because the
verification the push-order rule demands — the target domain in the deployment's
`alias` array, and `meta.githubCommitSha` equal to the commit you pushed — is a
`get_deployment` call. **It needs no CLI and no secret.** Reach for the MCP
first.

The CLI is worth having only for what the MCP does not cover: `vercel env pull`,
`vercel build`, `vercel dev`. **`VERCEL_TOKEN` is deliberately not set**, so the
hook does not install the CLI. If you hit one of those three commands, run it
from your own machine rather than turning on a standing credential for an
occasional need — and note that `vercel env pull` is the weakest case of the
three, since `docs/SECRETS.md` already records that `Sensitive` variables pull
back as an 11-character marker rather than their value.

**Why a token and not `vercel login`.** `vercel login` is an interactive OAuth
flow — it opens a browser and waits. There is no browser and no one to click. A
token is the only headless path Vercel offers.

**Why `VERCEL_ORG_ID` / `VERCEL_PROJECT_ID` instead of `vercel link`.** CLAUDE.md
forbids automatic `--yes` linking precisely because the CLI may select the wrong
project. Those two variables are the same two values `.vercel/project.json`
holds, so the CLI is pinned before it runs, with no link step that could pick
something else. **Set them in the environment next to the token** — they are not
credentials, but this repository is public and infrastructure identifiers do not
belong in it. If `VERCEL_TOKEN` is set without them, the hook skips installing
the CLI entirely: an absent binary cannot deploy to the wrong project, which is
a safer failure than a loud one.

Scope the token to the `frank-rochas-projects` team and give it the shortest
expiry you can live with. Read `docs/SECRETS.md` on retrievability first: the
token is shown once.

---

## Google Cloud — the only one that needs a real credential decision

Nothing is injected. `gcloud` is not installed. Both are fixable; the credential
is the part that needs a choice.

**The placeholder actively breaks things.** `CLOUDSDK_AUTH_ACCESS_TOKEN` is set
to `proxy-injected`, and `gcloud` gives an explicitly-set access token
**precedence over an activated service account**. Activating a service account
and then running `gcloud` in the same shell fails with
`ACCESS_TOKEN_TYPE_UNSUPPORTED` and a message naming the env var — which reads
like a bad key rather than a shadowed one. The hook writes
`export CLOUDSDK_AUTH_ACCESS_TOKEN=` (empty) into `$CLAUDE_ENV_FILE`; an empty
value falls through to the credential store cleanly, verified.

**The chosen path: a pasted access token, nothing stored.** From your own
machine, `gcloud auth print-access-token` prints a token good for about an hour.
Paste it into the environment as `CLOUDSDK_AUTH_ACCESS_TOKEN` (replacing the
`proxy-injected` placeholder) when a session genuinely needs `gcloud`, and clear
it after. The hook detects any value other than the placeholder and installs
`gcloud` without writing a key to disk. What leaks if it leaks is one hour of
your own access, not a standing grant — and the window closes by itself, which
no revocation procedure can promise.

**Credential options, and why the long-lived key was rejected.**

- **Workload Identity Federation** — the right answer anywhere it fits, because
  it trades the long-lived key for a short-lived exchange. It needs an OIDC
  token from an issuer you can register as a trusted pool. This environment
  publishes no such token. Not available, not a preference.
- **`gcloud auth login` (user credentials)** — interactive by construction, even
  with `--no-browser`, which still requires a second authenticated machine to
  paste from. Not available headless.
- **Service-account key JSON** — works headless and unattended, which is its
  whole appeal. It is also a long-lived bearer credential, readable by every
  session in the environment, that grants its roles to anyone holding it until
  someone remembers to delete it. **Rejected as the default** for exactly that:
  it trades a permanent exposure for the convenience of not pasting a token.
  The unattended case this would buy — a scheduled session doing GCP work with
  nobody present — does not exist today.

**If you ever do turn the key on, scope it down.** The existing deploy path does
not need this credential: `cloudbuild.yaml` deploys `owt-solver` from a Cloud Build
trigger on pushes to `main` touching `gcf/**`, using the build service account.
A session credential is therefore for *looking* — `gcloud functions describe`,
`gcloud logging read`, `gcloud scheduler jobs describe` — and a viewer-level
role covers all of it:

```bash
# in GCP project eloquent-figure-421401
gcloud iam service-accounts create owt-agent-readonly \
  --display-name="OWT Claude Code session (read-only)"

gcloud projects add-iam-policy-binding eloquent-figure-421401 \
  --member="serviceAccount:owt-agent-readonly@eloquent-figure-421401.iam.gserviceaccount.com" \
  --role="roles/viewer"

gcloud iam service-accounts keys create /tmp/owt-agent.json \
  --iam-account=owt-agent-readonly@eloquent-figure-421401.iam.gserviceaccount.com

base64 -w0 /tmp/owt-agent.json   # paste into GCP_SA_KEY, then shred the file
```

`roles/viewer` does **not** grant Secret Manager payload access, which is
deliberate: `owt-solver-api-key` stays unreadable from a session. Grant
`roles/cloudfunctions.developer` and `roles/iam.serviceAccountUser` on top only
if you decide you want agent-driven manual deploys, and know that doing so puts
a credential that can replace production function code into an environment
variable.

**Cost of installing it.** 84 MB down, ~1 GB unpacked, ~2 minutes. The hook
installs `gcloud` only when `GCP_SA_KEY` is set, so sessions that are just
writing code and running gates do not pay for it.

---

## Setting the variables

Nothing needs to be set for the posture above. **`VERCEL_TOKEN` and `GCP_SA_KEY`
are intentionally absent.** The only variable you may ever set is
`CLOUDSDK_AUTH_ACCESS_TOKEN`, temporarily, when a session needs `gcloud` — plus
`GCP_PROJECT`, which is a project name, not a credential.

Anything you do set goes on the **Claude Code environment**, not in a shell and
not in `.env.local`: a session gets a fresh container, so only the environment's
own variables survive. Bear in mind that an environment variable is readable by
every session in that environment and by every agent running in one, which is
the whole argument for keeping the list empty. Set them at
<https://claude.ai/code> → the environment used for this repo → Environment
variables. See <https://code.claude.com/docs/en/claude-code-on-the-web>.

Each one is documented in `docs/SECRETS.md` with its source, rotation and blast
radius, as every credential in this project must be.

---

## The hook

`.claude/hooks/session-start.sh`, registered as a `SessionStart` hook in
`.claude/settings.json`. It runs **only** when `CLAUDE_CODE_REMOTE=true`, so a
local checkout is untouched.

The registration, if `.claude/settings.json` does not exist yet:

```json
{
  "hooks": {
    "SessionStart": [
      {
        "hooks": [
          {
            "type": "command",
            "command": "$CLAUDE_PROJECT_DIR/.claude/hooks/session-start.sh",
            "timeout": 600
          }
        ]
      }
    ]
  }
}
```

An agent session cannot write that file: Claude Code classifies edits to its own
settings as self-modification and refuses them, by design. It is a human's
commit.

What it does, in order:

1. `npm ci` when `package-lock.json` has changed since the last run (a hash
   stamp at `node_modules/.owt-lock-sha` makes a resumed container skip it —
   31 s cold, 0.1 s warm). **`npm ci`, not `npm install`**, because a session
   that commits must not have its lockfile silently rewritten underneath it.
2. Installs `gh` unconditionally.
3. Installs the Vercel CLI and pins the project IDs — only if `VERCEL_TOKEN` is
   set.
4. Installs `gcloud`, activates the service account and blanks
   `CLOUDSDK_AUTH_ACCESS_TOKEN` — only if `GCP_SA_KEY` is set. The key is
   written to a `600` temp file outside the repo and deleted after activation;
   it never lands in the working tree, which is not covered by `.gitignore` the
   way `.env*.local` is.

It is idempotent, and it takes effect for future sessions only once it is on
`main`.
