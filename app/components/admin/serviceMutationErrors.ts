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

