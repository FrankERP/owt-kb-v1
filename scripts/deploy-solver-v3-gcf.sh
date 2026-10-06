#!/usr/bin/env bash
# First creation (and manual fallback deploy) of the OWT solver v3 Cloud Function, `owt-solver-v3`.
# Spec: docs/superpowers/specs/2026-10-05-solver-v3-c5-solver-function-design.md §11.4.
#
# Run it from the fetched tip of main, never from a feature checkout — it deploys whatever
# gcf_v3/ holds on disk:
#   git fetch && git switch --detach origin/main
#   GCP_PROJECT=eloquent-figure-421401 bash scripts/deploy-solver-v3-gcf.sh
#
# It touches only owt-solver-v3: never v2's function (owt-solver), its source (gcf/) or its script.
# --allow-unauthenticated grants allUsers -> run.invoker with the caller's rights (the build
# account cannot, which is why gcf_v3/cloudbuild.yaml does not pass it). The API key is never on
# the command line: the function reads Secret Manager's owt-solver-api-key at instance start.
set -euo pipefail

: "${GCP_PROJECT:?Set GCP_PROJECT to the Google Cloud project id}"

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT"

if [ -n "$(git status --porcelain -- gcf_v3)" ]; then
  echo "✗ gcf_v3/ has uncommitted or untracked changes. Deploy a committed tree only:" >&2
  echo "  git fetch && git switch --detach origin/main" >&2
  exit 1
fi

BUILD="$(git rev-parse HEAD)"
export CLOUDSDK_CORE_DISABLE_FILE_LOGGING=true

echo "→ Deploying owt-solver-v3 (gen2, us-central1) at ${BUILD}…"
gcloud functions deploy owt-solver-v3 \
  --project="$GCP_PROJECT" \
  --gen2 \
  --region=us-central1 \
  --runtime=python312 \
  --source=gcf_v3 \
  --entry-point=solve \
  --trigger-http \
  --allow-unauthenticated \
  --memory=512MB \
  --cpu=1 \
  --timeout=120s \
  --set-secrets=OWT_SOLVER_API_KEY=owt-solver-api-key:latest \
  --set-env-vars="OWT_SOLVER_V3_BUILD=$BUILD"

echo "✓ Deployed. Function URL (OWT_SOLVER_V3_URL — C6/C7 set it, not this script):"
gcloud functions describe owt-solver-v3 \
  --project="$GCP_PROJECT" \
  --gen2 \
  --region=us-central1 \
  --format='value(serviceConfig.uri)'
