// Batch creation of month-preview drafts (Service Readiness A2 §2, client side).
//
// One `creationRequestId` per preview draft, minted when that draft is first
// constructed and preserved for the whole life of the draft: editing or swapping
// assignments, a partial-batch result, an `onCreated()` refresh, and a retry after
// an HTTP/network/lost-response failure all reuse the SAME id byte-for-byte, so a
// lost response replays as idempotent success instead of creating a second
// service. Only a genuinely new preview mints new ids.
//
// Pure and transport-agnostic: the POST is injected, so the batch rules (only
// confirmed successes become `exists`, everything else stays retryable with its
// original id) are unit-testable without a DOM or a network.

export interface DraftInstrumentSlot {
  instrument: string;
  personId: string;
}

export interface DraftFohSlot {
  role: string;
  personId: string;
}

export interface CreatableDraft {
  localId: string;
  /** Opaque, stable per logical draft. Never the short UI `localId`. */
  creationRequestId: string;
  _type: "sunday_role" | "saturday_role" | "special_role";
  date: string;
  /**
   * SPECIALS ONLY. `canonicalizeCreatePayload` raises issue `"service_name"`
   * for a nameless special (`roleCreationReceipt.ts`) → `400 invalid_request`,
   * so without this field on the body every special would fail to create. A
   * weekend role never stores it.
   */
  service_name?: string;
  leads: string[];
  bgvs: string[];
  chorus: string[];
  instruments: DraftInstrumentSlot[];
  foh: DraftFohSlot[];
}

/** A fresh opaque request id. `crypto.randomUUID()` when available. */
export function newCreationRequestId(): string {
  const c = typeof globalThis !== "undefined" ? globalThis.crypto : undefined;
  if (c && typeof c.randomUUID === "function") return c.randomUUID();
  // Deterministic-length fallback for environments without randomUUID; still
  // opaque and bounded, and only used when the platform lacks the API.
  let out = "";
  for (let i = 0; i < 4; i++) out += Math.random().toString(36).slice(2, 10);
  return out.slice(0, 32);
}

/** The exact POST body for one draft. Blank slots are dropped, order preserved. */
export function draftCreateBody(draft: CreatableDraft, published: boolean) {
  return {
    creationRequestId: draft.creationRequestId,
    _type: draft._type,
    date: draft.date,
    // Only ever emitted for a special. Sending it on a weekend body would be
    // harmless (the receipt ignores a stray `service_name` on a weekend type)
    // but would still be a lie about what gets stored — the key is omitted
    // entirely instead.
    ...(draft._type === "special_role" ? { service_name: draft.service_name ?? "" } : {}),
    leads: draft.leads,
    bgvs: draft.bgvs,
    chorus: draft.chorus,
    instruments: draft.instruments.filter((s) => s.instrument && s.personId),
    foh: draft.foh.filter((s) => s.role && s.personId),
    published,
  };
}

export interface DraftPostOutcome {
  ok: boolean;
  status?: number;
  /** Machine error code from the shared service error model, when present. */
  error?: string;
}

export interface DraftBatchResult {
  /** Confirmed server-side successes (HTTP ok), including idempotent replays. */
  createdLocalIds: string[];
  /** Failed or unknown outcomes; each remains retryable with the same request id. */
  failed: { localId: string; status?: number; error?: string }[];
}

/**
 * POST each draft in order. A thrown request (network/lost response) and a
 * non-ok response are both "unknown or failed": the draft is NOT marked created,
 * and a retry sends the identical body — the server's creation receipt decides
 * whether that retry is a replay or a genuine create.
 */
export async function runDraftCreateBatch(input: {
  drafts: readonly CreatableDraft[];
  published: boolean;
  post: (body: ReturnType<typeof draftCreateBody>) => Promise<DraftPostOutcome>;
}): Promise<DraftBatchResult> {
  const createdLocalIds: string[] = [];
  const failed: DraftBatchResult["failed"] = [];
  for (const draft of input.drafts) {
    let outcome: DraftPostOutcome;
    try {
      outcome = await input.post(draftCreateBody(draft, input.published));
    } catch {
      outcome = { ok: false };
    }
    if (outcome.ok) createdLocalIds.push(draft.localId);
    else failed.push({ localId: draft.localId, status: outcome.status, error: outcome.error });
  }
  return { createdLocalIds, failed };
}
