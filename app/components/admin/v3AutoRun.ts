// app/components/admin/v3AutoRun.ts
//
// Solver v3 C6 — one v3 Auto run, with its transports injected (the component passes `fetch`-based
// ones; tests pass fakes). The order is the spec's:
//   1. HZ-7, HZ-9, WN-2 (`preRead`) and ST-1 (`storedReady`) refuse BEFORE any read;
//   2. RQ-1: `GET /api/admin/fairness` read FRESH (never a display copy), aborted at 20 s; anything
//      but a 200 IF2-8 body for this horizon refuses, and nothing is sent with missing balances;
//      if the horizon changed during the read, nothing is solved;
//   3. the pure builder (its refusals are Auto's);
//   4. `POST /api/admin/solve`, aborted by the client at 58 s (the route answers first, at 55 s);
//   5. AD-3's classification and AD-4's handshake. The caller applies (AD-5) and fills uncounted
//      specials and instruments at every exit of the horizon Auto was pressed on (AD-7); a horizon
//      changed during the read («stale») or the solve gets nothing applied or filled (RQ-1).
// SP-5: a refusal before the pre-fill ran adds the counted-specials line when any were waiting (the
// builder adds it for its own refusals).

import type { FairnessLedgerResponse } from "@/app/utils/fairnessVocabulary";
import { V3_LINES, V3_ROUTE_COPY } from "./v3Copy";
import { classifyV3Answer, v3HandshakeHolds, type V3Answer, type V3Outcome } from "./v3SolveResponse";
import type { V3BuildResult } from "./v3SolveRequest";
import type { V3SolveRequest } from "./v3Wire";

export const V3_LEDGER_TIMEOUT_MS = 20_000;
export const V3_CLIENT_SOLVE_TIMEOUT_MS = 58_000;

export interface V3AutoDeps {
  months: string[];
  preRead: () => string[];
  storedReady: () => boolean;
  specialsWaiting: boolean;
  readLedger: (signal: AbortSignal) => Promise<{ status: number; body: unknown }>;
  isCurrent: () => boolean;
  build: (ledger: FairnessLedgerResponse) => V3BuildResult;
  postSolve: (request: V3SolveRequest, signal: AbortSignal) => Promise<{ status: number; text: string }>;
}

export type V3AutoResult =
  | { kind: "refused"; lines: string[] }
  | { kind: "stale" }
  | { kind: "solved"; build: Extract<V3BuildResult, { ok: true }>; outcome: V3Outcome };

/** An IF2-8 200 body for exactly these horizon months. */
export function isLedgerBody(body: unknown, months: readonly string[]): body is FairnessLedgerResponse {
  if (typeof body !== "object" || body === null) return false;
  const o = body as Partial<FairnessLedgerResponse>;
  return o.v === 1 && Array.isArray(o.people) && Array.isArray(o.horizon)
    && o.horizon.length === months.length && o.horizon.every((h, i) => h?.month === months[i]);
}

async function bounded<T>(ms: number, run: (signal: AbortSignal) => Promise<T>): Promise<{ ok: true; value: T } | { ok: false; aborted: boolean }> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), ms);
  try {
    return { ok: true, value: await run(controller.signal) };
  } catch {
    return { ok: false, aborted: controller.signal.aborted };
  } finally {
    clearTimeout(timer);
  }
}

export async function runV3Auto(deps: V3AutoDeps): Promise<V3AutoResult> {
  const refused = (lines: string[]): V3AutoResult =>
    ({ kind: "refused", lines: deps.specialsWaiting ? [...lines, V3_LINES.prefillNotRun] : lines });

  const pre = deps.preRead();
  if (pre.length > 0) return refused(pre);
  if (!deps.storedReady()) return refused([V3_LINES.storedReadFailed(deps.months)]);

  const read = await bounded(V3_LEDGER_TIMEOUT_MS, deps.readLedger);
  if (!deps.isCurrent()) return { kind: "stale" };
  if (!read.ok || read.value.status !== 200 || !isLedgerBody(read.value.body, deps.months)) {
    return refused([V3_ROUTE_COPY.ledgerFailed]);
  }

  const built = deps.build(read.value.body);
  if (!built.ok) return { kind: "refused", lines: built.lines };

  const solved = await bounded(V3_CLIENT_SOLVE_TIMEOUT_MS, (signal) => deps.postSolve(built.request, signal));
  const answer: V3Answer = solved.ok
    ? { kind: "http", status: solved.value.status, text: solved.value.text }
    : solved.aborted ? { kind: "aborted" } : { kind: "threw" };
  let outcome = classifyV3Answer(answer);
  if (outcome.kind === "success" && !v3HandshakeHolds(outcome.response, built.request.pins)) outcome = { kind: "handshake_failed" };
  return { kind: "solved", build: built, outcome };
}
