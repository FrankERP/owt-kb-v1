import "server-only";

// Service Readiness A3 §3 — the REQUEST-SCOPED verification run context.
//
// WHY THIS EXISTS
// ---------------
// A3 §3 requires the deployed run to prove zero outbound delivery: run-id-scoped
// `delivery_blocked` evidence, and zero `delivery_attempt` events, in the
// deployment's complete recorded logs.
//
// The run id belongs to the HARNESS RUNNER, not to the deployment. `SR_VERIFY_RUN_ID`
// is never a deployment variable — it is generated per run on the machine that
// invokes Playwright. So a firewall record whose markers come from the deployment's
// own `process.env` can never carry THIS run's id, which made the teardown's
// `no_run_scoped_delivery_blocked` check structurally unsatisfiable.
//
// The run id does, however, already travel on the wire: every request the harness
// makes carries the non-secret `x-sr-verification-*` headers, whose contract,
// validation and ownership gate already live in `srVerificationLoginEvent.ts`. This
// module is the mechanism that carries the VALIDATED markers from that request into
// the delivery firewall, across `await`s and into `after()` post-commit callbacks,
// without threading a parameter through eight transport writers.
//
// WHY `run()` AND NOT `enterWith()`
// ---------------------------------
// `AsyncLocalStorage.enterWith()` looks convenient — a guard could call it and every
// later `await` in the handler would see the store. It is also unsafe here: the
// mutation escapes the callee's frame and lands on whatever async frame is current,
// so two requests started in the same tick end up sharing one store, and the value
// leaks all the way out to the process root. A leaked store would stamp one run's
// evidence with ANOTHER run's id — the exact failure mode this evidence exists to
// rule out. So the store is only ever established by wrapping a continuation with
// `run()`, at the request boundary, and `enterWith` is deliberately not exposed.
//
// WHAT IS AND IS NOT IN HERE
// --------------------------
// Non-secret run provenance ONLY: run id, candidate SHA, deployment id. Never a
// credential, never a header value that was not validated, never an identity. The
// module performs NO I/O and pulls in no client: it imports only `node:async_hooks`
// plus the pure header contract and gate from `srVerificationLoginEvent.ts` (whose
// one Sanity client is deliberately a lazy import), so `deliveryFirewall.ts` — on
// the hot path of every real notification — can import it without dragging the
// Content Lake clients onto that path.
//
// ABSENCE IS NORMAL. Delivery is frequently triggered from `after()` callbacks, from
// the reminder cron, and from scripts, where there is no in-flight request at all.
// `currentVerificationRun()` answers `null` there and the firewall still blocks and
// still emits its `delivery_blocked` record — only the markers are missing. Blocking
// is NEVER conditional on having a request context; that would turn a safety control
// into a test-only feature.

import { AsyncLocalStorage } from "node:async_hooks";

import type { EnvLike } from "./srVerificationIdentity";
import {
  evaluateTicketPreconditions,
  readVerificationHeaders,
  type HeadersLike,
} from "./srVerificationLoginEvent";

/**
 * The three non-secret markers `e2e/service-readiness/lib/deliveryEvidence.ts` scopes
 * its verdict by. Deliberately NOT the attempt id: an attempt id identifies one
 * sign-in, while delivery evidence is scoped to the whole run.
 */
export interface VerificationRunMarkers {
  runId: string;
  candidateSha: string;
  deploymentId: string;
}

const storage = new AsyncLocalStorage<VerificationRunMarkers>();

/**
 * The markers of the in-flight verification request, or `null`.
 *
 * `null` is the ordinary answer everywhere in production and on every unmarked
 * request. Callers must treat it as "no provenance to add", never as "do not act".
 */
export function currentVerificationRun(): VerificationRunMarkers | null {
  return storage.getStore() ?? null;
}

/**
 * Run `fn` with `markers` established for it and for everything it awaits —
 * including callbacks `next/server`'s `after()` binds while inside it.
 *
 * A `null`/absent markers argument calls `fn` directly, WITHOUT establishing (or
 * clearing) anything. That is what keeps an unmarked request byte-for-byte on the
 * path it has always taken, and it also means a nested call can never downgrade an
 * outer context to "no markers".
 */
export function runWithVerificationRun<T>(
  markers: VerificationRunMarkers | null | undefined,
  fn: () => T,
): T {
  return markers ? storage.run(markers, fn) : fn();
}

/* ------------------------------------------------------------------ *
 * A3 §3 — the same ticket, carried into the delivery firewall's evidence
 * ------------------------------------------------------------------ */
//
// The outbound-delivery firewall has to emit evidence scoped to the RUN, and the
// run id exists only on the harness runner (see the module header above). The wire
// contract that already carries it is `srVerificationLoginEvent.ts`'s §4 ticket, so
// the boundary below REUSES that contract and that gate rather than inventing a
// second header set or a second validation path.
//
// The gate is `evaluateTicketPreconditions` — marker exact, deployment environment
// is the isolated verification deployment, claimed candidate SHA and deployment id
// are THIS deployment's own, every id well-formed and complete. Deliberately NOT
// the dataset lease: reading a Sanity document on every request would put network
// I/O on the path of every mutation, and the lease's job is to serialize runs, not
// to authorize a log line that carries no authority. Everything the lease protects
// (writes, login-event ownership) still goes through
// `resolveVerificationOwnership`, which still reads it.
//
// FAILS CLOSED, WHOLE OR NOTHING. An unmarked request returns `null` before any
// environment is resolved, so production is byte-for-byte unchanged. A marked
// request that fails ANY condition also returns `null` — never a partially-trusted
// stamp built from the parts that happened to validate.

/**
 * The validated run markers a request establishes, or `null`.
 *
 * Pure: it decides and logs a reason CODE, it never performs I/O and it never
 * touches the async store. `withVerificationRunContext` is what establishes it.
 */
export function verificationRunMarkersFor({
  headers,
  env = process.env as EnvLike,
  logger = console,
}: {
  headers: HeadersLike;
  env?: EnvLike;
  logger?: Pick<Console, "warn">;
}): VerificationRunMarkers | null {
  const { present, ticket } = readVerificationHeaders(headers);
  // The ordinary path: no verification header at all. No env resolution, no log,
  // no store — exactly what an unmarked request has always done.
  if (!present) return null;

  const decision = evaluateTicketPreconditions({ present, ticket, env });
  if (!decision.ok || !decision.ownership) {
    // Reason CODE only — never a header value, never a secret.
    logger.warn(`[sr-verification] delivery run context refused: ${decision.reason}`);
    return null;
  }

  const { runId, candidateSha, deploymentId } = decision.ownership;
  return { runId, candidateSha, deploymentId };
}

/** Anything with a `headers` bag — `NextRequest` and `Request` both qualify. */
export type RequestLike = { headers: HeadersLike };

/**
 * Wrap a route handler so that everything it does — including the `after()`
 * callbacks it registers and every nested `await` — runs inside this request's
 * verification run context.
 *
 * Applied to the mutating handlers of every route module that can reach an
 * outbound transport. An unwrapped handler is not a safety hole: its blocks are
 * still refused and still recorded, they simply carry no run markers.
 *
 * The wrapper is transparent — same arguments, same return value, no `await`
 * added — so a handler's existing behaviour and its response are untouched.
 */
export function withVerificationRunContext<Req extends RequestLike, A extends unknown[], R>(
  handler: (req: Req, ...rest: A) => R,
): (req: Req, ...rest: A) => R {
  return (req: Req, ...rest: A): R =>
    runWithVerificationRun(verificationRunMarkersFor({ headers: req.headers }), () =>
      handler(req, ...rest),
    );
}
