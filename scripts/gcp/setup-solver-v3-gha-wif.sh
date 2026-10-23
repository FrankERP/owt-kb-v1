#!/usr/bin/env bash
# One-time (and re-runnable) Google Cloud setup for .github/workflows/solver-v3-ops.yml: keyless
# access from GitHub Actions to the production solver function owt-solver-v3 (ADR-0070; plan
# docs/superpowers/plans/2026-10-22-solver-v3-gha-wif-ops.md §3).
#
# Run it in Google Cloud Shell (a browser, no laptop needed), from a checkout of main:
#   GCP_PROJECT=eloquent-figure-421401 bash scripts/gcp/setup-solver-v3-gha-wif.sh            # dry run
#   GCP_PROJECT=eloquent-figure-421401 bash scripts/gcp/setup-solver-v3-gha-wif.sh --apply    # create
#
# What it creates, only when absent (every grant is add-iam-policy-binding, a no-op when present):
#   - Workload Identity pool `github-actions` and its OIDC provider `owt-kb-v1`, whose condition
#     federates only repository id 837387462 (owner 68241914), refs/heads/main, the environments
#     solver-verify / solver-deploy, and the workflow file solver-v3-ops.yml;
#   - service account owt-gha-verify: Cloud Functions Viewer on owt-solver-v3, Secret Accessor on
#     owt-solver-api-key; service account owt-gha-deploy: Cloud Build Editor (project) and Service
#     Account User on the trigger's account only. Each federated by attribute.repo_env.
# It NEVER creates a service-account key, and it prints only resource names.
#
# An existing provider is compared, not trusted: issuer, attribute mapping and condition must equal
# the values below, and it must carry no uploaded JWKS and no custom audiences. On a difference it
# stops and prints the update command; only `--apply --update-provider` applies it. A dry run after
# --apply reads back the pool, the provider and the accounts; the IAM grants are trusted to the
# --apply run's exit status (each is an idempotent add-iam-policy-binding).
set -euo pipefail

: "${GCP_PROJECT:?Set GCP_PROJECT to the Google Cloud project id}"

APPLY=0
UPDATE_PROVIDER=0
for arg in "$@"; do
  case "$arg" in
    --apply) APPLY=1 ;;
    --update-provider) UPDATE_PROVIDER=1 ;;
    *) echo "usage: GCP_PROJECT=<id> $0 [--apply [--update-provider]]" >&2; exit 2 ;;
  esac
done
if [ "$UPDATE_PROVIDER" = 1 ] && [ "$APPLY" = 0 ]; then
  echo "✗ --update-provider only works together with --apply" >&2
  exit 2
fi
export CLOUDSDK_CORE_DISABLE_FILE_LOGGING=true

REPO_ID=837387462
OWNER_ID=68241914
WORKFLOW_REF='FrankERP/owt-kb-v1/.github/workflows/solver-v3-ops.yml@refs/heads/main'
POOL=github-actions
PROVIDER=owt-kb-v1
ISSUER=https://token.actions.githubusercontent.com
FUNCTION=owt-solver-v3
REGION=us-central1
SECRET=owt-solver-api-key
TRIGGER=owt-solver-v3-deploy
VERIFY_ENV=solver-verify
DEPLOY_ENV=solver-deploy
MAPPING="google.subject=assertion.sub,attribute.repository_id=assertion.repository_id,attribute.environment=assertion.environment,attribute.ref=assertion.ref,attribute.repo_env=assertion.repository_id + '/' + assertion.environment"
CONDITION="assertion.repository_id == '${REPO_ID}' && assertion.repository_owner_id == '${OWNER_ID}' && assertion.ref == 'refs/heads/main' && assertion.environment in ['${VERIFY_ENV}', '${DEPLOY_ENV}'] && assertion.workflow_ref == '${WORKFLOW_REF}'"

die() { echo "✗ $*" >&2; exit 1; }
say() { echo "→ $*"; }

# Print a command; run it only under --apply.
run() {
  printf '  $'
  printf ' %q' "$@"
  printf '\n'
  if [ "$APPLY" = 1 ]; then "$@"; fi
}

ERR="$(mktemp)"
trap 'rm -f "$ERR"' EXIT

# Prints the command's output, or ABSENT when the resource does not exist. Any other error stops
# the script: a permission error must never read as «absent, would create».
describe_or_absent() {
  local out
  if out="$("$@" 2>"$ERR")"; then
    printf '%s' "$out"
  elif grep -q -E 'NOT_FOUND|not found|does not exist' "$ERR"; then
    printf 'ABSENT'
  else
    cat "$ERR" >&2
    die "could not read: $*"
  fi
}

PROJECT_NUMBER="$(gcloud projects describe "$GCP_PROJECT" --format='value(projectNumber)')"
[ -n "$PROJECT_NUMBER" ] || die "no project number for $GCP_PROJECT"
POOL_NAME="projects/${PROJECT_NUMBER}/locations/global/workloadIdentityPools/${POOL}"
VERIFY_SA="owt-gha-verify@${GCP_PROJECT}.iam.gserviceaccount.com"
DEPLOY_SA="owt-gha-deploy@${GCP_PROJECT}.iam.gserviceaccount.com"

if [ "$APPLY" = 1 ]; then say "APPLY mode on $GCP_PROJECT ($PROJECT_NUMBER)"; else say "DRY RUN on $GCP_PROJECT ($PROJECT_NUMBER) — nothing changes"; fi

say "APIs"
run gcloud services enable iam.googleapis.com iamcredentials.googleapis.com sts.googleapis.com \
  --project="$GCP_PROJECT"

say "Workload Identity pool $POOL"
pool_state="$(describe_or_absent gcloud iam workload-identity-pools describe "$POOL" \
  --location=global --project="$GCP_PROJECT" --format='value(state)')"
case "$pool_state" in
  ABSENT)
    run gcloud iam workload-identity-pools create "$POOL" --location=global --project="$GCP_PROJECT" \
      --display-name="GitHub Actions (owt-kb-v1)"
    ;;
  ACTIVE)
    echo "  exists"
    # The service-account bindings key on attribute.repo_env, which a deliberately different
    # provider in the same pool could map too: this pool holds owt-kb-v1 and nothing else.
    providers="$(gcloud iam workload-identity-pools providers list --workload-identity-pool="$POOL" \
      --location=global --project="$GCP_PROJECT" --format='value(name.basename())')"
    others="$(printf '%s\n' "$providers" | grep -v -x -e "$PROVIDER" -e '' || true)"
    [ -z "$others" ] || die "pool $POOL holds other providers ($others); it must hold only $PROVIDER — decide with Claude, do not delete blindly"
    ;;
  DELETED)
    die "pool $POOL is soft-deleted (30 days). To restore it: gcloud iam workload-identity-pools undelete $POOL --location=global --project=$GCP_PROJECT — Frank's choice"
    ;;
  *) die "pool $POOL is in state «$pool_state»" ;;
esac

say "OIDC provider $PROVIDER"
provider_json="ABSENT"
if [ "$pool_state" != ABSENT ]; then
  provider_json="$(describe_or_absent gcloud iam workload-identity-pools providers describe "$PROVIDER" \
    --workload-identity-pool="$POOL" --location=global --project="$GCP_PROJECT" --format=json)"
fi
if [ "$provider_json" = ABSENT ]; then
  run gcloud iam workload-identity-pools providers create-oidc "$PROVIDER" \
    --workload-identity-pool="$POOL" --location=global --project="$GCP_PROJECT" \
    --display-name="owt-kb-v1 solver-v3-ops" --issuer-uri="$ISSUER" \
    --attribute-mapping="$MAPPING" --attribute-condition="$CONDITION"
else
  # Compare issuer, mapping (as a map) and condition (whitespace collapsed) with the expected ones.
  verdict="$(PROVIDER_JSON="$provider_json" EXP_ISSUER="$ISSUER" EXP_MAPPING="$MAPPING" EXP_CONDITION="$CONDITION" \
    python3 -I -c '
import json, os, re
p = json.loads(os.environ["PROVIDER_JSON"])
if p.get("state") == "DELETED":
    print("DELETED"); raise SystemExit
exp_map = dict(item.split("=", 1) for item in os.environ["EXP_MAPPING"].split(","))
ws = lambda s: re.sub(r"\s+", " ", (s or "").strip())
diffs = []
if (p.get("oidc") or {}).get("issuerUri") != os.environ["EXP_ISSUER"]:
    diffs.append("issuer: live %r, expected %r" % ((p.get("oidc") or {}).get("issuerUri"), os.environ["EXP_ISSUER"]))
if (p.get("attributeMapping") or {}) != exp_map:
    diffs.append("mapping: live %r, expected %r" % (p.get("attributeMapping"), exp_map))
if ws(p.get("attributeCondition")) != ws(os.environ["EXP_CONDITION"]):
    diffs.append("condition: live %r, expected %r" % (p.get("attributeCondition"), os.environ["EXP_CONDITION"]))
oidc = p.get("oidc") or {}
if oidc.get("jwksJson"):
    diffs.append("oidc.jwksJson is set (an uploaded key would let tokens it signs satisfy the condition); expected none")
if oidc.get("allowedAudiences"):
    diffs.append("oidc.allowedAudiences: live %r, expected none (the default audience)" % (oidc.get("allowedAudiences"),))
if p.get("disabled"):
    print("DISABLED"); raise SystemExit
print("MATCH" if not diffs else "\n".join(diffs))
')"
  if [ "$verdict" = DELETED ]; then
    die "provider $PROVIDER is soft-deleted. To restore it: gcloud iam workload-identity-pools providers undelete $PROVIDER --workload-identity-pool=$POOL --location=global --project=$GCP_PROJECT — Frank's choice"
  elif [ "$verdict" = DISABLED ]; then
    die "provider $PROVIDER is DISABLED — the revocation switch (docs/SECRETS.md). Re-enable only deliberately: gcloud iam workload-identity-pools providers update-oidc $PROVIDER --workload-identity-pool=$POOL --location=global --project=$GCP_PROJECT --no-disabled"
  elif [ "$verdict" = MATCH ]; then
    echo "  exists; issuer, mapping and condition match this script"
  else
    echo "  DIFFERS from this script:"
    printf '%s\n' "$verdict" | sed 's/^/    /'
    if [ "$UPDATE_PROVIDER" = 1 ]; then
      run gcloud iam workload-identity-pools providers update-oidc "$PROVIDER" \
        --workload-identity-pool="$POOL" --location=global --project="$GCP_PROJECT" \
        --issuer-uri="$ISSUER" --attribute-mapping="$MAPPING" --attribute-condition="$CONDITION"
    else
      echo "  To make the live provider equal this script, re-run with --apply --update-provider, which runs:"
      printf '    gcloud iam workload-identity-pools providers update-oidc %q --workload-identity-pool=%q --location=global --project=%q --issuer-uri=%q --attribute-mapping=%q --attribute-condition=%q\n' \
        "$PROVIDER" "$POOL" "$GCP_PROJECT" "$ISSUER" "$MAPPING" "$CONDITION"
      die "provider $PROVIDER differs; nothing further was done"
    fi
  fi
fi

CREATED_SA=0
ensure_sa() {
  local id="$1" email="$2" display="$3"
  local sa_state
  # A separate assignment, so a read error stops the script instead of reading as «exists».
  sa_state="$(describe_or_absent gcloud iam service-accounts describe "$email" --project="$GCP_PROJECT" --format='value(email)')"
  if [ "$sa_state" = ABSENT ]; then
    run gcloud iam service-accounts create "$id" --project="$GCP_PROJECT" --display-name="$display"
    CREATED_SA=1
  else
    echo "  $email exists"
  fi
}

say "Service accounts"
ensure_sa owt-gha-verify "$VERIFY_SA" "GitHub Actions: verify owt-solver-v3"
ensure_sa owt-gha-deploy "$DEPLOY_SA" "GitHub Actions: run the owt-solver-v3 deploy trigger"
# A just-created account can take a few seconds to be visible to IAM policy writes.
if [ "$APPLY" = 1 ] && [ "$CREATED_SA" = 1 ]; then sleep 15; fi

say "Grants for $VERIFY_SA"
# Function-level, not project-level: it reads this one function. If the rehearsal shows a gen2
# function-level grant does not authorize `functions describe`, the fallback is the same role on
# the project (ADR-0070 records which shipped; remove the superseded grant by hand).
run gcloud functions add-iam-policy-binding "$FUNCTION" --gen2 --region="$REGION" --project="$GCP_PROJECT" \
  --member="serviceAccount:${VERIFY_SA}" --role=roles/cloudfunctions.viewer --format=none
run gcloud secrets add-iam-policy-binding "$SECRET" --project="$GCP_PROJECT" \
  --member="serviceAccount:${VERIFY_SA}" --role=roles/secretmanager.secretAccessor --format=none

say "Grants for $DEPLOY_SA"
trigger_sa="$(gcloud builds triggers describe "$TRIGGER" --region=global --project="$GCP_PROJECT" \
  --format='value(serviceAccount)')"
trigger_sa="${trigger_sa##*/serviceAccounts/}"
[ -n "$trigger_sa" ] || die "trigger $TRIGGER has no serviceAccount set (it uses a default implicitly) — decide with Claude before granting anything"
case "$trigger_sa" in
  *"@${GCP_PROJECT}.iam.gserviceaccount.com"|"${PROJECT_NUMBER}-compute@developer.gserviceaccount.com") ;;
  *) die "trigger $TRIGGER runs as $trigger_sa, which is not an account of $GCP_PROJECT" ;;
esac
echo "  trigger $TRIGGER runs as $trigger_sa"
# Cloud Build has no per-trigger IAM: running a trigger needs cloudbuild.builds.create.
run gcloud projects add-iam-policy-binding "$GCP_PROJECT" --member="serviceAccount:${DEPLOY_SA}" \
  --role=roles/cloudbuild.builds.editor --condition=None --format=none
run gcloud iam service-accounts add-iam-policy-binding "$trigger_sa" --project="$GCP_PROJECT" \
  --member="serviceAccount:${DEPLOY_SA}" --role=roles/iam.serviceAccountUser --format=none

say "Federation (who may become each account)"
run gcloud iam service-accounts add-iam-policy-binding "$VERIFY_SA" --project="$GCP_PROJECT" \
  --role=roles/iam.workloadIdentityUser \
  --member="principalSet://iam.googleapis.com/${POOL_NAME}/attribute.repo_env/${REPO_ID}/${VERIFY_ENV}" --format=none
run gcloud iam service-accounts add-iam-policy-binding "$DEPLOY_SA" --project="$GCP_PROJECT" \
  --role=roles/iam.workloadIdentityUser \
  --member="principalSet://iam.googleapis.com/${POOL_NAME}/attribute.repo_env/${REPO_ID}/${DEPLOY_ENV}" --format=none

echo
say "GitHub environment variables (not secrets — none of them grants anything on its own):"
echo "  both environments:  GCP_PROJECT=$GCP_PROJECT"
echo "                      GCP_WIF_PROVIDER=${POOL_NAME}/providers/${PROVIDER}"
echo "  $VERIFY_ENV:       GCP_SERVICE_ACCOUNT=$VERIFY_SA"
echo "  $DEPLOY_ENV:       GCP_SERVICE_ACCOUNT=$DEPLOY_SA"
if [ "$APPLY" = 0 ]; then say "Dry run done. Nothing changed. Re-run with --apply to create what is listed."; fi
