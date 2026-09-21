#!/usr/bin/env bash
# SessionStart hook — prepares a Claude Code on the web container.
#
# The container is EPHEMERAL: anything installed by hand during a session is
# gone when it is reclaimed. This script is the only thing that survives, and
# only once it is on the default branch. See docs/CLOUD_CLI.md for the why.
#
# Local machines are deliberately excluded: Frank's own checkout already has
# node_modules, gh, gcloud and vercel, and a hook that reinstalled them would
# fight his setup for no gain.
set -euo pipefail

if [ "${CLAUDE_CODE_REMOTE:-}" != "true" ]; then
  exit 0
fi

ROOT="${CLAUDE_PROJECT_DIR:-$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)}"
ENV_FILE="${CLAUDE_ENV_FILE:-/dev/null}"
cd "$ROOT"

log() { printf '  [session-start] %s\n' "$*" >&2; }

# ---------------------------------------------------------------- npm deps ---
# `npm ci` rather than `npm install`: this session commits, and `npm install`
# is allowed to rewrite package-lock.json, which would silently dirty the tree
# and drift from what .github/workflows/ci.yml resolves. The lockfile-hash
# stamp buys back the speed `npm ci` costs on a resumed (cached) container.
LOCK_STAMP="node_modules/.owt-lock-sha"
WANT_LOCK="$(sha256sum package-lock.json | cut -d' ' -f1)"
if [ -f "$LOCK_STAMP" ] && [ "$(cat "$LOCK_STAMP")" = "$WANT_LOCK" ]; then
  log "node_modules al día — se omite npm ci"
else
  log "npm ci…"
  npm ci --no-audit --no-fund >/dev/null
  printf '%s\n' "$WANT_LOCK" > "$LOCK_STAMP"
fi

# ------------------------------------------------------------------- gh CLI ---
# Always installed: GitHub needs no secret here. The agent proxy REWRITES the
# Authorization header on api.github.com, so `gh` authenticates with whatever
# GH_TOKEN happens to hold. Note `gh auth status` reports the token invalid
# anyway — it is reading the placeholder, not the injected credential. That
# message is cosmetic; `gh api` works. Do not "fix" it with a real PAT.
GH_VERSION="2.63.2"
if ! command -v gh >/dev/null 2>&1; then
  log "instalando gh ${GH_VERSION}…"
  tmp="$(mktemp -d)"
  curl -sSL -o "$tmp/gh.tgz" \
    "https://github.com/cli/cli/releases/download/v${GH_VERSION}/gh_${GH_VERSION}_linux_amd64.tar.gz"
  tar -xzf "$tmp/gh.tgz" -C "$tmp"
  install -m755 "$tmp/gh_${GH_VERSION}_linux_amd64/bin/gh" /usr/local/bin/gh
  rm -rf "$tmp"
fi
log "gh $(gh --version | head -1 | awk '{print $3}')"

# ------------------------------------------------------------- Vercel CLI ---
# Installed only when a token exists, because without one the CLI cannot do a
# single useful thing, and the Vercel MCP server already covers every read the
# push-order rule needs (alias + githubCommitSha) with no secret at all.
if [ -n "${VERCEL_TOKEN:-}" ]; then
  # The org/project IDs come from the environment, never from this file: the
  # repository is PUBLIC, and infrastructure identifiers do not belong in it.
  # They are still REQUIRED, because CLAUDE.md forbids `vercel link --yes` and
  # these two variables are what stands between the CLI and auto-selecting a
  # different project. Missing them means no CLI at all — fail safe, not loud:
  # an absent binary cannot deploy to the wrong place.
  if [ -z "${VERCEL_ORG_ID:-}" ] || [ -z "${VERCEL_PROJECT_ID:-}" ]; then
    log "AVISO: VERCEL_TOKEN sin VERCEL_ORG_ID/VERCEL_PROJECT_ID — se OMITE el CLI."
    log "       Defínelos en el environment o el CLI podría elegir otro proyecto."
  else
    if ! command -v vercel >/dev/null 2>&1; then
      log "instalando vercel CLI…"
      npm i -g vercel@latest >/dev/null 2>&1
    fi
    log "vercel $(vercel --version 2>/dev/null | tail -1) — proyecto fijado por entorno"
  fi
else
  log "VERCEL_TOKEN ausente — se omite el CLI (usa el MCP de Vercel para leer)"
fi

# ------------------------------------------------------------ Google Cloud ---
# gcloud is 84 MB down / ~1 GB unpacked and takes ~2 min, so it is installed
# only when there is a credential to use it with. GCP is the one service the
# proxy injects NOTHING for: CLOUDSDK_AUTH_ACCESS_TOKEN is the literal string
# "proxy-injected" with no credential behind it, and it OVERRIDES an activated
# service account — so it has to be blanked, not merely ignored.
# A real, pasted `gcloud auth print-access-token` value (~1 h) is treated as a
# first-class credential: it needs no key on disk and nothing stored long-term.
GCP_EPHEMERAL=""
if [ -n "${CLOUDSDK_AUTH_ACCESS_TOKEN:-}" ] && [ "${CLOUDSDK_AUTH_ACCESS_TOKEN}" != "proxy-injected" ]; then
  GCP_EPHEMERAL="yes"
fi

if [ -n "${GCP_SA_KEY:-}" ] || [ -n "$GCP_EPHEMERAL" ]; then
  if ! command -v gcloud >/dev/null 2>&1; then
    log "instalando Google Cloud SDK…"
    curl -sSL -o /tmp/gcloud.tgz \
      "https://dl.google.com/dl/cloudsdk/channels/rapid/downloads/google-cloud-cli-linux-x86_64.tar.gz"
    tar -xzf /tmp/gcloud.tgz -C /opt
    rm -f /tmp/gcloud.tgz
    /opt/google-cloud-sdk/install.sh --quiet --usage-reporting=false \
      --command-completion=false --path-update=false >/dev/null 2>&1 || true
    ln -sf /opt/google-cloud-sdk/bin/gcloud /usr/local/bin/gcloud
    ln -sf /opt/google-cloud-sdk/bin/gsutil /usr/local/bin/gsutil
  fi

  if [ -n "$GCP_EPHEMERAL" ]; then
    log "gcloud usando el access token efímero del entorno (sin llave en disco)"
    log "listo"
    exit 0
  fi

  # The key never touches the repo: `.env*.local` is gitignored but a JSON key
  # dropped in the tree is not, and a service-account key is the highest-value
  # credential in this environment.
  key="$(mktemp)"; chmod 600 "$key"
  if printf '%s' "$GCP_SA_KEY" | base64 -d > "$key" 2>/dev/null && head -c1 "$key" | grep -q '{'; then
    : # came in base64-encoded
  else
    printf '%s' "$GCP_SA_KEY" > "$key"
  fi
  CLOUDSDK_AUTH_ACCESS_TOKEN="" gcloud auth activate-service-account --key-file="$key" --quiet
  rm -f "$key"

  echo 'export CLOUDSDK_AUTH_ACCESS_TOKEN=' >> "$ENV_FILE"
  if [ -n "${GCP_PROJECT:-}" ]; then
    CLOUDSDK_AUTH_ACCESS_TOKEN="" gcloud config set project "$GCP_PROJECT" --quiet 2>/dev/null || true
  fi
  log "gcloud activo como $(CLOUDSDK_AUTH_ACCESS_TOKEN= gcloud config get-value account 2>/dev/null)"
else
  log "sin credencial GCP — se omite gcloud"
fi

log "listo"
