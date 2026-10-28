import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { parseWorkflow } from "../lib/ci-layout.mjs";

// `.github/workflows/solver-v3-ops.yml` holds a keyless Google credential for the production
// solver: `verify` reads the solver's API key, `deploy` runs the production trigger (ADR-0078).
// The Workload Identity provider federates only THIS file on `main`, so its shape is pinned here:
// which events can start it, which jobs can mint a token, that the deploy path is the existing
// trigger and nothing else, and that a public log never sees the key. The setup script must
// create no key and must name this file in its provider condition.

const repoRoot = resolve(__dirname, "../..");
const WORKFLOW_FILE = ".github/workflows/solver-v3-ops.yml";
const SETUP_FILE = "scripts/gcp/setup-solver-v3-gha-wif.sh";
const workflowText = readFileSync(resolve(repoRoot, WORKFLOW_FILE), "utf8");
const setupText = readFileSync(resolve(repoRoot, SETUP_FILE), "utf8");

type Step = { uses?: string; run?: string; with?: Record<string, unknown>; env?: Record<string, unknown> };
type Job = {
  name?: string;
  if?: string;
  needs?: unknown;
  environment?: unknown;
  permissions?: unknown;
  "timeout-minutes"?: string;
  steps: Step[];
};
const doc = parseWorkflow(workflowText) as { on: Record<string, unknown>; permissions: unknown; jobs: Record<string, Job> };
const jobs = doc.jobs;
const allSteps = Object.values(jobs).flatMap((j) => j.steps);
const runs = allSteps.flatMap((s) => (typeof s.run === "string" ? [s.run] : []));

const VERIFY_IF =
  "${{ !cancelled() && (needs.deploy.result == 'success' || (needs.deploy.result == 'skipped' && (github.event_name == 'push' || inputs.action == 'verify'))) }}";

describe("solver-v3-ops workflow", () => {
  it("starts only on a gcf_v3 push to main or a manual dispatch with a choice input", () => {
    expect(Object.keys(doc.on).sort()).toEqual(["push", "workflow_dispatch"]);
    expect(doc.on.push).toEqual({ branches: ["main"], paths: ["gcf_v3/**"] });
    const action = (doc.on.workflow_dispatch as { inputs: Record<string, Record<string, unknown>> }).inputs.action;
    expect(action.type).toBe("choice");
    expect(action.options).toEqual(["verify", "deploy"]);
    expect(action.default).toBe("verify");
  });

  it("pins every action by full commit SHA", () => {
    const uses = allSteps.flatMap((s) => (s.uses ? [s.uses] : []));
    expect(uses.length).toBeGreaterThan(0);
    for (const u of uses) expect(u).toMatch(/^[\w.-]+\/[\w.-]+@[0-9a-f]{40}$/);
  });

  it("lets exactly the two environment jobs mint an OIDC token", () => {
    expect(doc.permissions).toEqual({ contents: "read" });
    expect(Object.keys(jobs).sort()).toEqual(["deploy", "verify"]);
    for (const job of Object.values(jobs)) {
      expect(job.permissions).toEqual({ contents: "read", "id-token": "write" });
      expect(Number(job["timeout-minutes"])).toBeGreaterThan(15);
    }
    expect(jobs.deploy.environment).toBe("solver-deploy");
    expect(jobs.deploy.if).toBe("${{ github.event_name == 'workflow_dispatch' && inputs.action == 'deploy' }}");
    expect(jobs.verify.environment).toBe("solver-verify");
    expect(jobs.verify.needs).toBe("deploy");
    // A skipped `needs` skips the job and a run of skipped jobs is green: the condition is exact.
    expect(jobs.verify.if).toBe(VERIFY_IF);
  });

  it("checks out without persisting the token and authenticates through federation only", () => {
    for (const job of Object.values(jobs)) {
      const checkout = job.steps.find((s) => s.uses?.startsWith("actions/checkout@"));
      expect(checkout?.with).toMatchObject({ "persist-credentials": "false", "fetch-depth": "0" });
      const auth = job.steps.find((s) => s.uses?.startsWith("google-github-actions/auth@"));
      expect(Object.keys(auth?.with ?? {}).sort()).toEqual(["service_account", "workload_identity_provider"]);
      expect(job.steps.indexOf(checkout!)).toBeLessThan(job.steps.indexOf(auth!));
    }
  });

  it("deploys only by running the existing trigger", () => {
    const all = runs.join("\n");
    expect(all).toContain("gcloud builds triggers run owt-solver-v3-deploy");
    for (const banned of ["functions deploy", "builds submit", "--allow-unauthenticated", "set -x", "keys create"]) {
      expect(all).not.toContain(banned);
    }
  });

  it("never interpolates an expression into a script", () => {
    for (const r of runs) expect(r).not.toContain("${{");
  });

  it("keeps the API key and the function URL out of the public log", () => {
    const keyRuns = runs.filter((r) => r.includes("owt-solver-api-key"));
    expect(keyRuns).toHaveLength(1);
    const lines = keyRuns[0].split("\n").filter((l) => /\$\{?key\b/.test(l) || /\bkey=/.test(l) || /\bunset key\b/.test(l));
    // One assignment, its mask, the two header pipes (ping and smoke), its unset — nothing else.
    expect(lines.map((l) => l.trim())).toEqual([
      'key="$(gcloud secrets versions access latest --secret=owt-solver-api-key --project="$GCP_PROJECT")"',
      'echo "::add-mask::$key"',
      "read -r p_ok p_contract p_build <<<\"$(printf 'X-Api-Key: %s\\n' \"$key\" \\",
      "read -r s_ok s_proven <<<\"$(printf 'X-Api-Key: %s\\n' \"$key\" \\",
      "unset key",
    ]);
    expect(keyRuns[0]).not.toMatch(/GITHUB_ENV|GITHUB_OUTPUT/);
    // The URL and its host are masked before the first request; curl stays silent on errors (-S
    // would print the host).
    const r = keyRuns[0];
    expect(r.indexOf('echo "::add-mask::$url"')).toBeGreaterThan(-1);
    expect(r.indexOf('echo "::add-mask::$host"')).toBeGreaterThan(-1);
    expect(r.indexOf('echo "::add-mask::$host"')).toBeLessThan(r.indexOf("curl "));
    const curlLines = r.split("\n").filter((l) => /\bcurl\b/.test(l));
    expect(curlLines).toHaveLength(2);
    for (const l of curlLines) {
      for (const flag of l.split(/\s+/).filter((t) => t.startsWith("-"))) {
        expect(flag, `curl flag ${flag} could print the host or the request`).not.toMatch(
          /^-[a-zA-Z]*[Sv]|^--(show-error|verbose|trace)/,
        );
      }
    }
  });

  it("prints only named fields of the solver's answers, never a body", () => {
    const programs = [...runs.join("\n").matchAll(/python3 -I -c '([^']*)'/g)].map((m) => m[1]);
    expect(programs).toEqual([
      'import json,sys; r=json.load(sys.stdin); print(r.get("ok"), r.get("contract"), r.get("build"))',
      'import json,sys; r=json.load(sys.stdin); s=r.get("stages") or []; print(r.get("ok"), bool(s) and all(x.get("status") == "proven" for x in s))',
    ]);
    expect(runs.join("\n")).not.toMatch(/python3 (?!-I -c ')/);
  });

  it("keeps push verifies and on-demand runs in separate concurrency groups", () => {
    const doc2 = doc as unknown as { concurrency: Record<string, string> };
    expect(doc2.concurrency).toEqual({
      group: "${{ github.event_name == 'push' && 'solver-v3-verify-push' || 'solver-v3-ops' }}",
      "cancel-in-progress": "${{ github.event_name == 'push' }}",
    });
    const verifyStep = jobs.verify.steps.find((s) => s.env && "MODE" in s.env);
    expect(verifyStep?.env?.MODE).toBe(
      "${{ github.event_name == 'push' && 'push' || (needs.deploy.result == 'success' && 'post-deploy' || 'dispatch') }}",
    );
  });
});

describe("solver-v3-ops setup script", () => {
  it("never creates a key and changes nothing without --apply", () => {
    expect(setupText).not.toMatch(/keys\s+create/);
    expect(setupText).toContain('if [ "$APPLY" = 1 ]; then "$@"; fi');
    expect(setupText).not.toMatch(/^\s*set\s+-x/m);
    // Every mutating gcloud call goes through run(); the printed update hint is the one exception.
    const mutating = setupText
      .split("\n")
      .filter((l) => /gcloud .*\b(create|create-oidc|add-iam-policy-binding|update-oidc|services enable|undelete)\b/.test(l))
      .filter((l) => !/^\s*(printf|die|echo) /.test(l));
    expect(mutating.length).toBeGreaterThan(0);
    for (const l of mutating) expect(l.trim(), l).toMatch(/^run gcloud /);
  });

  it("federates exactly this workflow file, this repository and the two environments", () => {
    expect(setupText).toContain(`WORKFLOW_REF='FrankERP/owt-kb-v1/${WORKFLOW_FILE}@refs/heads/main'`);
    expect(setupText).toContain("REPO_ID=837387462");
    expect(setupText).toContain("OWNER_ID=68241914");
    expect(setupText).toContain("assertion.workflow_ref == '${WORKFLOW_REF}'");
    expect(setupText).toContain("assertion.ref == 'refs/heads/main'");
    const envs = [jobs.verify.environment, jobs.deploy.environment];
    expect(setupText).toContain(`VERIFY_ENV=${envs[0]}`);
    expect(setupText).toContain(`DEPLOY_ENV=${envs[1]}`);
  });
});
