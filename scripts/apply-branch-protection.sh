#!/usr/bin/env bash
# Apply (or re-apply) branch protection on `main`.
#
# Idempotent: run it any time to enforce the settings below, or to see what is
# currently enforced. Needs `gh` authenticated as a repo admin.
#
# Why these settings — see docs/CI.md. The short version: `main` auto-deploys to
# production, so the `gates` check has to be able to STOP a merge, including one
# made by an admin or by an agent pushing with the owner's credentials.
set -euo pipefail

REPO="${REPO:-FrankERP/owt-kb-v1}"
BRANCH="${BRANCH:-main}"
CHECK="${CHECK:-gates}"

echo "Applying protection to ${REPO}@${BRANCH} (required check: ${CHECK})"

gh api -X PUT "repos/${REPO}/branches/${BRANCH}/protection" \
  -H "Accept: application/vnd.github+json" \
  --input - >/dev/null <<JSON
{
  "required_status_checks": {
    "strict": true,
    "contexts": ["${CHECK}"]
  },
  "enforce_admins": true,
  "required_pull_request_reviews": {
    "required_approving_review_count": 0,
    "dismiss_stale_reviews": false,
    "require_code_owner_reviews": false
  },
  "restrictions": null,
  "allow_force_pushes": false,
  "allow_deletions": false,
  "required_conversation_resolution": false
}
JSON

echo "Applied. Current settings:"
gh api "repos/${REPO}/branches/${BRANCH}/protection" \
  --jq '{
    required_checks: .required_status_checks.contexts,
    strict: .required_status_checks.strict,
    enforce_admins: .enforce_admins.enabled,
    required_approvals: .required_pull_request_reviews.required_approving_review_count,
    force_pushes: .allow_force_pushes.enabled,
    deletions: .allow_deletions.enabled
  }'
