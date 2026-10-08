// app/utils/solverV3Upstream.ts
//
// The v3 half of `POST /api/admin/solve` (solver v3 C6 RT-3–RT-6, KH-2). Server-only: it reads
// `OWT_SOLVER_V3_URL`/`OWT_SOLVER_API_KEY` and may spawn the local entry point.
//
// ONE classification for every upstream answer (RT-5):
//   · `ok:false, contract:3, engine:"v3", code:string` — the solver's own coded failure, whatever
//     its HTTP status (C5 §8.3 uses 422, 400, 401, 405, 503, 500) → forwarded verbatim as 422;
//   · `ok:true, contract:3, engine:"v3"` → forwarded verbatim as 200 (RT-6: never rewritten);
//   · anything else → a route-made `{ ok:false, transport_error:true, transport }` as 422 — never a 500.
// The v3 call is aborted at 55 s on both paths (RT-4); `maxDuration` stays 60. v2 is untouched.

import "server-only";
import { spawn } from "child_process";
import path from "path";
import type { V3TransportError, V3TransportReason } from "@/app/components/admin/v3Wire";

export { isV3Body } from "@/app/components/admin/v3Wire";

export const V3_UPSTREAM_TIMEOUT_MS = 55_000;

export interface V3UpstreamResult {
  status: 200 | 422;
  /** The exact bytes to answer with. */
  text: string;
  /** For the route's one log line only: "ok", a transport reason, or the coded failure's code. */
  outcome: string;
}

type Env = Readonly<Record<string, string | undefined>>;
type FetchLike = (
  url: string,
  init: { method: string; headers: Record<string, string>; body: string; signal: AbortSignal },
) => Promise<{ ok: boolean; status: number; text: () => Promise<string> }>;

function transport(reason: V3TransportReason): V3UpstreamResult {
  const body: V3TransportError = { ok: false, transport_error: true, transport: reason };
  return { status: 422, text: JSON.stringify(body), outcome: reason };
}

function asRecord(json: unknown): Record<string, unknown> | null {
  return typeof json === "object" && json !== null && !Array.isArray(json) ? (json as Record<string, unknown>) : null;
}

/** RT-5 — the one point of classification. Exported for its unit test. */
export function classifyUpstream(status: number, text: string): V3UpstreamResult {
  let json: unknown;
  let parsed = true;
  try { json = JSON.parse(text); } catch { parsed = false; }
  const o = parsed ? asRecord(json) : null;
  if (o && o.ok === false && o.contract === 3 && o.engine === "v3" && typeof o.code === "string") {
    return { status: 422, text, outcome: o.code };
  }
  if (status < 200 || status >= 300) return transport("http_status");
  if (!parsed) return transport("not_json");
  if (o && o.ok === true && o.contract === 3 && o.engine === "v3") return { status: 200, text, outcome: "ok" };
  return transport("contract_echo");
}

async function callRemote(url: string, body: unknown, env: Env, fetchImpl: FetchLike, timeoutMs: number): Promise<V3UpstreamResult> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const apiKey = env.OWT_SOLVER_API_KEY ?? "";
    const res = await fetchImpl(url, {
      method: "POST",
      headers: { "Content-Type": "application/json", ...(apiKey ? { "X-Api-Key": apiKey } : {}) },
      body: JSON.stringify(body),
      signal: controller.signal,
    });
    return classifyUpstream(res.status, await res.text());
  } catch {
    return transport(controller.signal.aborted ? "timeout" : "unreachable");
  } finally {
    clearTimeout(timer);
  }
}

/** C5 §11.1: one request on stdin, one response on stdout, exit 0 even for `ok:false`. */
function callLocal(body: unknown, env: Env, timeoutMs: number): Promise<V3UpstreamResult> {
  return new Promise((resolve) => {
    const scriptPath = path.join(process.cwd(), "gcf_v3", "owt_solver_v3.py");
    const python = env.OWT_SOLVER_PYTHON
      ?? "/opt/homebrew/Caskroom/miniforge/base/envs/owt-roles/bin/python3";
    let settled = false;
    const done = (result: V3UpstreamResult) => {
      if (settled) return;
      settled = true;
      resolve(result);
    };
    const child = spawn(python, [scriptPath, "--json-mode"], { stdio: ["pipe", "pipe", "pipe"] });
    const timer = setTimeout(() => {
      child.kill("SIGKILL");
      done(transport("timeout"));
    }, timeoutMs);
    let stdout = "";
    child.stdout.on("data", (c: Buffer) => { stdout += c.toString(); });
    // Drained and discarded: the CLI's stderr is its own count-only log line (C5 §11.2); nothing
    // of it is read, logged or forwarded here (KH-2).
    child.stderr.on("data", () => {});
    child.on("error", () => {
      clearTimeout(timer);
      done(transport("unreachable"));
    });
    child.on("close", () => {
      clearTimeout(timer);
      const out = stdout.trim();
      done(out ? classifyUpstream(200, out) : transport("not_json"));
    });
    child.stdin.write(JSON.stringify(body));
    child.stdin.end();
  });
}

/**
 * RT-3: remote when `OWT_SOLVER_V3_URL` is set; otherwise the local entry point, but ONLY off Vercel
 * (`VERCEL_ENV` unset or empty); on a deployment without the URL, `not_configured` — never a spawn.
 */
export async function solveV3(
  body: unknown,
  env: Env = process.env,
  fetchImpl: FetchLike = fetch as unknown as FetchLike,
  timeoutMs: number = V3_UPSTREAM_TIMEOUT_MS,
): Promise<V3UpstreamResult> {
  const url = env.OWT_SOLVER_V3_URL;
  if (url) return callRemote(url, body, env, fetchImpl, timeoutMs);
  if (!env.VERCEL_ENV) return callLocal(body, env, timeoutMs);
  return transport("not_configured");
}
