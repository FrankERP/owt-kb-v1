#!/usr/bin/env bash
# Deploy the OWT solver as a Google Cloud Function.
#
# Prerequisites:
#   gcloud CLI installed and authenticated
#   gcloud config set project YOUR_PROJECT_ID
#
# Usage:
#   bash scripts/deploy-solver-gcf.sh
#
# Required env vars (set before running):
#   GCP_PROJECT — your Google Cloud project ID
#
# The API key is read from Secret Manager (secret: owt-solver-api-key), matching
# the CI deploy (cloudbuild.yaml). It is NEVER passed on the command line — that
# would leak it into `ps`/shell history/Cloud Build logs and reintroduce the
# plaintext-vs-secret env-var collision that CI has to clean up.
#
# After deploying, copy the printed URL into your Vercel environment:
#   OWT_SOLVER_URL = <printed URL>   (OWT_SOLVER_API_KEY = the Secret Manager value)

set -euo pipefail

: "${GCP_PROJECT:?Set GCP_PROJECT to your Google Cloud project ID}"

REGION="us-central1"
FUNCTION_NAME="owt-solver"
RUNTIME="python312"
MEMORY="512MB"
TIMEOUT="120s"
# The gcf/ directory is self-contained (main.py + owt_solver_v2.py + requirements.txt),
# so it deploys as-is. This is the same source GitHub continuous deployment builds.
SOURCE_DIR="$(cd "$(dirname "$0")/.." && pwd)/gcf"

echo "→ Deploying $FUNCTION_NAME to $REGION (manual fallback; CI deploys on push to main)..."
gcloud functions deploy "$FUNCTION_NAME" \
  --project="$GCP_PROJECT" \
  --region="$REGION" \
  --runtime="$RUNTIME" \
  --trigger-http \
  --allow-unauthenticated \
  --source="$SOURCE_DIR" \
  --entry-point=solve \
  --memory="$MEMORY" \
  --timeout="$TIMEOUT" \
  --set-secrets="OWT_SOLVER_API_KEY=owt-solver-api-key:latest"

echo ""
echo "✓ Deployed. Function URL:"
gcloud functions describe "$FUNCTION_NAME" \
  --project="$GCP_PROJECT" \
  --region="$REGION" \
  --format="value(serviceConfig.uri)" 2>/dev/null \
  || gcloud functions describe "$FUNCTION_NAME" \
       --project="$GCP_PROJECT" \
       --region="$REGION" \
       --format="value(httpsTrigger.url)"

echo ""
echo "Add to your Vercel environment variables:"
echo "  OWT_SOLVER_URL     = <URL above>"
echo "  OWT_SOLVER_API_KEY = <the owt-solver-api-key Secret Manager value>"
