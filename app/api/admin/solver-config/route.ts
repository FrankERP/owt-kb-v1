import { NextRequest, NextResponse } from "next/server";

import { requireActiveManager } from "@/app/utils/authGuards";
import { serviceError } from "@/app/utils/serviceMutation";
import { saveSolverConfig } from "@/app/utils/solverConfigCommit";
import { withVerificationRunContext } from "@/app/utils/srVerificationRunContext";
import { loadStoredSolverConfig, solverConfigGetBody } from "@/app/utils/solverConfigRead";

/**
 * The shared planner rule set (P6) — read and update.
 *
 * ─── Why a GET here rather than a server-side prop thread ────────────────────
 *
 * The whole admin tree below `app/(client)/admin/page.tsx` is `"use client"`
 * (`AdminPanel.tsx:1`, `ServicesPanel.tsx:1`), so there is no server component
 * in the chain to fetch this and hand it down. A GET on this route is the read
 * path; extending the prop chain would have meant editing the page and
 * `AdminPanel` for no gain.
 *
 * ─── The three things this route deliberately CANNOT do ──────────────────────
 *
 * 1. **It can never CREATE the document.** Only `scripts/seed-solver-config.ts`
 *    may, and only while the document is absent. Without that asymmetry the
 *    deployable state is: document absent → the client falls back to
 *    `DEFAULT_SOLVER_CONFIG` in memory → the first "Guardar" mints the SHARED
 *    document out of those defaults → and the seed script, run afterwards,
 *    either refuses (the live rules never arrive) or clobbers a document an
 *    admin has already edited. The live rules exist in exactly one browser;
 *    that trade is not recoverable. A POST against an absent document is
 *    therefore a `404 not_found` with the reason stated in the message.
 *
 * 2. **It can never accept a body from a client that reads another document
 *    shape** (solver v3 C3 §6.2). This POST replaces the WHOLE document and the
 *    reader keeps only the fields it knows, so a tab whose bundle predates a
 *    field — «Mes por medio» was the first — reads it away and its next save,
 *    about any rule, erases it for everyone. Every body carries
 *    `configVersion`; anything but exactly `SOLVER_CONFIG_VERSION` is a 400
 *    `invalid_request` after auth and the body's JSON/shape check, before the
 *    stored document is read or `config` is parsed. `invalid_request`,
 *    not `stale_revision`: an old tab renders the latter as «Recargar reglas»,
 *    whose re-read goes through that tab's own field-dropping reader and can
 *    never produce a body this route accepts.
 *
 * 3. **It can never accept a stale `_rev`.** Multi-admin is the entire point of
 *    P6, so last-write-wins is the wrong default: two admins with the panel open
 *    would silently overwrite each other's whole rule set. This follows the
 *    codebase's own convention — an exact observed revision threaded from the
 *    client and rejected as `stale_revision` (`app/api/admin/roles/[id]/route.ts:235`,
 *    `:186`).
 *
 * ─── No `revalidate*` call applies here, and adding one would be cargo cult ──
 *
 * `app/utils/revalidate.ts` exports only `revalidateServiceViews` and
 * `revalidateSongViews`, and this document backs NO ISR surface: it is read
 * solely inside the dynamic, session-gated admin tree, through this route's own
 * GET. There is nothing cached to invalidate. The client refreshes by re-reading
 * the GET. Stated explicitly so the next reader does not "restore" a missing
 * revalidation that was never missing.
 */

function send(res: { status: number; body: unknown }) {
  return NextResponse.json(res.body, { status: res.status });
}

/** Manager-gated, and content-editor excluded — matching `app/api/admin/roles/route.ts`. */
async function gate() {
  const session = await requireActiveManager();
  if (!session) return null;
  if (session.user.role === "content-editor") return null;
  return session;
}

// The raw read, shared with the MCP month planner (`app/utils/solverConfigRead.ts`).
const loadStored = loadStoredSolverConfig;

/**
 * The rule set, or an explicit "absent".
 *
 * **`present` is not decoration.** The client must tell "the document does not
 * exist yet" (fall back to `DEFAULT_SOLVER_CONFIG` IN MEMORY ONLY, never written
 * back) apart from "the read failed" (surface the error and REFUSE to save).
 * Collapsing the two into one `config ?? DEFAULT_SOLVER_CONFIG` turns a
 * transient fetch failure into "the rules are the seeded defaults", and one edit
 * plus Guardar then replaces the shared document wholesale — with hard blocks
 * silently degraded to whatever the defaults say in the meantime. A failed read
 * is an HTTP error here and has no `config` at all, precisely so it cannot be
 * mistaken for an empty one.
 */
export async function GET() {
  const session = await gate();
  if (!session) return NextResponse.json({ error: "Forbidden" }, { status: 403 });

  // `configVersion` on every answer, absent included (`solverConfigGetBody`).
  return NextResponse.json(solverConfigGetBody(await loadStored()));
}

/**
 * Replace the rule set. Body: `{ rev, config, configVersion }` — `config` is a `SolverConfig`
 * as the panel holds it, carrying `id` on every rule and no `_key` anywhere.
 * `parseSolverConfigWrite` is what mints them; the seed script uses the same
 * module, so the two writers cannot drift.
 */
async function postHandler(req: NextRequest) {
  const session = await gate();
  if (!session) return NextResponse.json({ error: "Forbidden" }, { status: 403 });

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return send(serviceError("invalid_request", { details: { issues: ["json"] } }));
  }
  if (typeof body !== "object" || body === null || Array.isArray(body)) {
    return send(serviceError("invalid_request", { details: { issues: ["body"] } }));
  }

  // Everything after auth and the JSON/shape check is the shared writer's (`solverConfigCommit.ts`,
  // ADR-0084), which the chat's rule edits also write through.
  return send(await saveSolverConfig(body as Record<string, unknown>, session.user.sanityId ?? ""));
}

// Wrapped like every route that reaches a `*Commit` module (`srVerificationRunContext.test.ts`), though this
// writer sends nothing.
export const POST = withVerificationRunContext(postHandler);
