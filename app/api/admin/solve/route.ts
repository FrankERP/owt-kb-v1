import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/auth";
import { spawn } from "child_process";
import path from "path";

async function requireSuperAdmin() {
  const session = await getServerSession(authOptions);
  if (session?.user.role !== "super-admin") return null;
  return session;
}

export interface SolveRequest {
  weeks: number;
  weekends_with_saturday: number[];
  sunday_leads: string[];
  saturday_leads: string[];
  support: string[];
  dsl_rules: string[];
  history: Array<{
    total_counts: Record<string, number>;
    role_counts: Record<string, Record<string, number>>;
  }>;
  seed?: number | null;
  solver_max_time_seconds?: number;
  solver_num_search_workers?: number;
  discourage_consecutive?: boolean;
}

export interface SolveResponse {
  ok: boolean;
  error?: string;
  schedule?: Record<string, {
    Sunday: { Lead: string[]; BGV: string[]; Choir: string[] };
    Saturday?: { Lead: string[]; BGV: string[] };
  }>;
  fairness_relaxed?: boolean;
  sun_lead_fairness_relaxed?: boolean;
  sun_bgv_fairness_relaxed?: boolean;
  history_runs_used?: number;
  total_counts?: Record<string, number>;
  role_counts?: Record<string, Record<string, number>>;
}

// ── Production path: call remote solver (GCF or any HTTP endpoint) ────────────

async function callRemoteSolver(config: SolveRequest): Promise<SolveResponse> {
  const url = process.env.OWT_SOLVER_URL!;
  const apiKey = process.env.OWT_SOLVER_API_KEY ?? "";

  const res = await fetch(url, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      ...(apiKey ? { "X-Api-Key": apiKey } : {}),
    },
    body: JSON.stringify(config),
    // Vercel serverless functions have a 10s default; solver can take up to ~30s
    // so we rely on the GCF's own 120s timeout — no fetch timeout needed here.
  });

  if (!res.ok && res.status !== 422) {
    return { ok: false, error: `Solver service returned HTTP ${res.status}` };
  }
  return res.json() as Promise<SolveResponse>;
}

// ── Development path: spawn local Python subprocess ───────────────────────────

function callLocalSolver(config: SolveRequest): Promise<SolveResponse> {
  return new Promise((resolve) => {
    const scriptPath = path.join(process.cwd(), "scripts", "owt_solver_v2.py");
    const python = process.env.OWT_SOLVER_PYTHON
      ?? "/opt/homebrew/Caskroom/miniforge/base/envs/owt-roles/bin/python3";

    const child = spawn(python, [scriptPath, "--json-mode"], {
      stdio: ["pipe", "pipe", "pipe"],
    });

    // Hard kill after 120 s so the serverless function doesn't hang
    const killTimer = setTimeout(() => {
      child.kill("SIGKILL");
      resolve({ ok: false, error: "Local solver timed out after 120 s" });
    }, 120_000);

    let stdout = "";
    let stderr = "";
    child.stdout.on("data", (c: Buffer) => { stdout += c.toString(); });
    child.stderr.on("data", (c: Buffer) => { stderr += c.toString(); });
    child.on("error", (err) => {
      clearTimeout(killTimer);
      resolve({ ok: false, error: `Failed to start solver: ${err.message}` });
    });
    child.on("close", (code) => {
      clearTimeout(killTimer);
      if (!stdout.trim()) {
        resolve({ ok: false, error: `Solver produced no output. ${stderr.trim() || `Exit code ${code}`}` });
        return;
      }
      try {
        resolve(JSON.parse(stdout) as SolveResponse);
      } catch {
        resolve({ ok: false, error: `Solver output was not valid JSON: ${stdout.slice(0, 200)}` });
      }
    });
    child.stdin.write(JSON.stringify(config));
    child.stdin.end();
  });
}

// ── Route handler ─────────────────────────────────────────────────────────────

export async function POST(req: NextRequest) {
  if (!await requireSuperAdmin()) {
    return NextResponse.json({ ok: false, error: "Forbidden" }, { status: 403 });
  }

  let body: SolveRequest;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ ok: false, error: "Invalid JSON body" }, { status: 400 });
  }

  if (!body.sunday_leads?.length) {
    return NextResponse.json({ ok: false, error: "sunday_leads is required" }, { status: 400 });
  }

  // OWT_SOLVER_URL set → use remote (GCF); otherwise fall back to local subprocess.
  const result = process.env.OWT_SOLVER_URL
    ? await callRemoteSolver(body)
    : await callLocalSolver(body);

  return NextResponse.json(result, { status: result.ok ? 200 : 422 });
}
