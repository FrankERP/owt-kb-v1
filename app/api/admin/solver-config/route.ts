import { NextRequest, NextResponse } from "next/server";

import { requireActiveManager } from "@/app/utils/authGuards";
import { sanityConflictKind } from "@/app/utils/roleWriteRequest";
import { serviceError } from "@/app/utils/serviceMutation";
import { operationalClient } from "@/sanity/lib/operationalClient";
import { writeClient } from "@/sanity/lib/serverClient";
import {
  SOLVER_CONFIG_DOC_ID,
  parseSolverConfigWrite,
  solverConfigFromDocument,
} from "@/app/utils/solverConfigWriteRequest";

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
 * ─── The two things this route deliberately CANNOT do ────────────────────────
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
 * 2. **It can never accept a stale `_rev`.** Multi-admin is the entire point of
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

function reject(res: { status: number; body: unknown }) {
  return NextResponse.json(res.body, { status: res.status });
}

/** Manager-gated, and content-editor excluded — matching `app/api/admin/roles/route.ts`. */
async function gate() {
  const session = await requireActiveManager();
  if (!session) return null;
  if (session.user.role === "content-editor") return null;
  return session;
}

interface StoredSolverConfigDoc {
  _id?: string;
  _rev?: string;
}

async function loadStored(): Promise<(StoredSolverConfigDoc & Record<string, unknown>) | null> {
  const doc = await operationalClient.fetch<Record<string, unknown> | null>(
    `*[_id == $id][0]`,
    { id: SOLVER_CONFIG_DOC_ID },
  );
  return doc ?? null;
}

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

  const doc = await loadStored();
  if (!doc) return NextResponse.json({ present: false, rev: null, config: null });
  return NextResponse.json({
    present: true,
    rev: typeof doc._rev === "string" ? doc._rev : null,
    config: solverConfigFromDocument(doc),
  });
}

/**
 * Replace the rule set. Body: `{ rev, config }` — `config` is a `SolverConfig`
 * as the panel holds it, carrying `id` on every rule and no `_key` anywhere.
 * `parseSolverConfigWrite` is what mints them; the seed script uses the same
 * module, so the two writers cannot drift.
 */
export async function POST(req: NextRequest) {
  const session = await gate();
  if (!session) return NextResponse.json({ error: "Forbidden" }, { status: 403 });

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return reject(serviceError("invalid_request", { details: { issues: ["json"] } }));
  }
  if (typeof body !== "object" || body === null || Array.isArray(body)) {
    return reject(serviceError("invalid_request", { details: { issues: ["body"] } }));
  }

  const rev = (body as Record<string, unknown>).rev;
  if (typeof rev !== "string" || !rev.length) {
    return reject(serviceError("invalid_request", { details: { issues: ["rev"] } }));
  }

  const parsed = parseSolverConfigWrite((body as Record<string, unknown>).config);
  if (!parsed.ok) {
    return reject(serviceError("invalid_request", { details: { issues: parsed.issues } }));
  }

  const stored = await loadStored();
  if (!stored) {
    // See the header: only the seed script may mint this document.
    return reject(
      serviceError("not_found", {
        message:
          "Las reglas compartidas aún no existen. Solo el script de siembra puede crearlas; esta ruta únicamente actualiza.",
        details: { id: SOLVER_CONFIG_DOC_ID, detail: "create_not_allowed_here" },
      }),
    );
  }
  if (stored._rev !== rev) {
    return reject(
      serviceError("stale_revision", {
        details: { id: SOLVER_CONFIG_DOC_ID, observed: rev, current: stored._rev ?? null },
      }),
    );
  }

  try {
    await writeClient
      .patch(SOLVER_CONFIG_DOC_ID)
      .ifRevisionId(rev)
      .set({
        ...parsed.value.fields,
        updatedAt: new Date().toISOString(),
        updatedBy: session.user.sanityId ?? "",
      })
      .commit();
  } catch (err) {
    // ONLY a genuine Content Lake 409 is a lost race. Everything else — an
    // expired or missing `SANITY_WRITE_TOKEN`, a network fault, a validation
    // complaint — must surface as itself.
    //
    // Reporting all of them as `stale_revision` is not a harmless
    // approximation: the message is "Alguien más lo cambió primero. Recarga y
    // reintenta.", so the admin reloads, gets the SAME `_rev` back (nothing
    // changed — nothing was written), retries, and fails identically, forever,
    // with the real cause swallowed by a `catch` that did not even log it. Same
    // classifier, same reason, as `app/api/admin/roles/[id]/route.ts:283`.
    if (!sanityConflictKind(err)) throw err;
    return reject(
      serviceError("stale_revision", {
        details: { id: SOLVER_CONFIG_DOC_ID, observed: rev, detail: "commit_conflict" },
      }),
    );
  }

  const after = await loadStored();
  return NextResponse.json({
    present: true,
    rev: after && typeof after._rev === "string" ? after._rev : null,
    config: parsed.value.config,
  });
}
