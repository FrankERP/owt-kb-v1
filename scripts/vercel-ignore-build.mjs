#!/usr/bin/env node
// Vercel Ignored Build Step — wired from `vercel.json`'s `ignoreCommand`.
//
// Vercel's contract is inverted from the usual one: exit 0 IGNORES the build,
// exit 1 CONTINUES it. An uncaught throw exits non-zero, so a broken policy
// module builds rather than blocking a release — the same fail-open direction
// `evaluateDeployPolicy` takes deliberately.
//
// Runs BEFORE `npm install`, so: Node builtins only.

import { evaluateDeployPolicy, DEPLOYING_REFS } from "./lib/deploy-branch-policy.mjs";

const { build, reason } = evaluateDeployPolicy(process.env);
const ref = process.env.VERCEL_GIT_COMMIT_REF || "(none)";

if (build) {
  console.log(`[deploy-policy] building "${ref}" (${reason})`);
  process.exit(1);
}

console.log(
  `[deploy-policy] skipping "${ref}" (${reason}). Only ${DEPLOYING_REFS.join(", ")} deploy — ` +
    `verify this change on dev-owt-backstage by merging it into preview.`,
);
process.exit(0);
