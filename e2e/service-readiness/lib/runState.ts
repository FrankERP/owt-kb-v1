// Non-secret run state, shared between the global setup, the workers, and the
// global teardown.
//
// Written into the gitignored `test-results/` directory. Everything in here is
// provenance an auditor may read: origin, project, dataset, run id, candidate SHA,
// deployment id, and the lease owner. There is deliberately NO field that could
// hold a token, a password, or the Deployment Protection bypass secret —
// `bypassConfigured` is a boolean, never a value.

/** Where the run records its non-secret state. Inside the gitignored output dir. */
export const RUN_STATE_FILE = "test-results/sr-verification-run.json";

/** Where the harness appends its own structured evidence lines during the run. */
export const RUN_EVIDENCE_FILE = "test-results/sr-verification-evidence.log";

/** `globalThis` key holding the lease-renewal interval between setup and teardown. */
export const LEASE_RENEWAL_KEY = "__srVerificationLeaseRenewal";

export interface RunState {
  startedAt: string;
  baseURL: string;
  host: string;
  projectId: string;
  dataset: string;
  runId: string;
  candidateSha: string;
  deploymentId: string;
  leaseOwner: string;
  /** Presence only. The secret VALUE is never recorded anywhere. */
  bypassConfigured: boolean;
  identity: {
    dataset: string | null;
    projectId: string | null;
    gitRef: string | null;
    commitSha: string | null;
    deploymentId: string | null;
    deploymentUrl: string | null;
  };
  runtimeLogFile: string | null;
}
