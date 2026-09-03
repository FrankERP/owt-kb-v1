/**
 * Spanish wording for a rejected role mutation, shared by the card-level flows
 * in `ServicesPanel` (delete, copy, swap) and the per-service outcome lines of
 * «Limpiar mes» (`MonthGenerator.tsx`), so a new server code gets ONE
 * translation, not two. Codes are the `error` field of a `serviceError`
 * response (`app/utils/serviceMutation.ts`).
 */

export interface MutationErrorInput {
  /** `body.error` of the rejected response, when it parsed. */
  code?: string;
  status: number;
  /** `body.details.dependencies.length`, when present. */
  dependencyCount?: number;
  fallback: string;
}

/**
 * Spanish message for a rejected role mutation. A 409 always means "your view
 * is stale". Shared by the card-level delete/edit flows in `ServicesPanel` and
 * the per-role outcome lines of «Limpiar mes», so a new server code gets one
 * translation, not two.
 */
export function mutationErrorMessage(input: MutationErrorInput): string {
  switch (input.code) {
    case "idempotency_mismatch":
      return "Este intento ya se envió con otros datos. Cierra y crea el servicio de nuevo.";
    case "idempotency_key_retired":
      return "Este servicio fue eliminado. Cierra y créalo de nuevo.";
    case "bootstrap_completed_reload":
      return "Se repararon datos internos, pero tu cambio no se aplicó. Recarga e intenta de nuevo.";
    case "target_has_orphaned_dependencies":
    case "role_date_has_dependencies":
    case "role_has_dependencies":
      return `Hay ${input.dependencyCount ?? 0} registro(s) dependientes (setlist o propuestas) en esa fecha. No se modificó nada.`;
    case "stale_revision":
      return "Alguien más cambió este servicio. Recarga e intenta de nuevo.";
    case "ambiguous_target":
      return "Ya existe un servicio en esa fecha (o hay duplicados). Recarga y revisa.";
    case "integrity_conflict":
      return "Los datos guardados no pasaron una revisión de integridad. No se modificó nada.";
    case "invalid_request":
      return "La solicitud fue rechazada antes de guardar. Revisa los datos.";
    case "not_found":
      return "Este servicio ya no existe. Recarga la lista.";
    default:
      return input.status === 409
        ? "Alguien más cambió este servicio. Recarga e intenta de nuevo."
        : input.fallback;
  }
}


/**
 * How long a mutation may hold a dialog open before we stop waiting.
 *
 * `busy` blocks Escape, the backdrop AND the header ✕ — every dismissal route —
 * so a request stalled behind a dead mobile connection would otherwise leave a
 * modal that cannot be closed at all, with its Cancelar disabled, until the OS
 * TCP timeout. The abort turns that into an ordinary reported failure. It is
 * generous on purpose: publishing a month is one batched transaction, and a
 * false abort would put the panel into exactly the unknown-outcome state it
 * works hardest to avoid. It stays BELOW the admin routes' own
 * `maxDuration = 60`, so a genuinely slow publish becomes an honest unknown
 * outcome rather than a silent success. The content routes the setlist editor
 * also calls declare no `maxDuration` at all, so which side gives up first there
 * depends on the Vercel project's default duration — unpinned in this repo. The
 * consequence is bounded either way: those two creates report a plain error and
 * reset their own flag, and neither touches the unknown-outcome ledger.
 */
export const MUTATION_TIMEOUT_MS = 30_000;

/**
 * `AbortController` + `setTimeout`, deliberately NOT `AbortSignal.timeout`.
 *
 * The browser floor is recorded in ADR-0030.
 *
 * The latter is Safari 16+, and this app ships an iOS wrap whose deployment
 * target is 15.0. On such a runtime the call throws a `TypeError` INSIDE the
 * try, which `submitPublication` would record as an unknown outcome for a
 * request that was never sent — and that record can only be retired by a
 * verification that throws the same way. Every publish would then be refused
 * until a reload, and again after it. A dead end reachable by nothing worse
 * than an old iPhone is not worth the shorter spelling.
 */
export function mutationSignal(): { signal: AbortSignal; done: () => void } {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), MUTATION_TIMEOUT_MS);
  return { signal: controller.signal, done: () => clearTimeout(timer) };
}
