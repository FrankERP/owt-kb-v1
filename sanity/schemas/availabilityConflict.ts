import { defineType } from "sanity";

/**
 * Internal: one availability conflict and its proposal (ADR-0079) — a person seated on a service
 * dated on a day they marked unavailable.
 *
 * `_id` is `availabilityConflict.<sha256(roleId|memberId|date), 32 hex>` — dotted, so an untokened
 * read never serves it. Written only by `app/utils/availabilityFixCommit.ts` (the sweep, «Aplicar»
 * and «Mantener»), every write guarded by `create` or the revision it read. It NEVER changes a
 * service: the role is changed only by «Aplicar», through `/admin`'s own edit writer.
 *
 * `role_id`-like fields are plain STRINGS on purpose, never references: a reference to a role would
 * make the record a dependency of that role (as `serviceThread` explains).
 *
 * NOT editable content: hidden and read-only in the Studio, never authored by hand.
 */
export const availabilityConflict = defineType({
  name: "availabilityConflict",
  title: "Availability conflicts (internal)",
  type: "document",
  hidden: true,
  readOnly: true,
  description: "Interno: un conflicto de disponibilidad y su propuesta. Lo escribe la app; nunca a mano.",
  fields: [
    { name: "roleId", title: "Servicio (id del rol)", type: "string" },
    { name: "memberId", title: "Miembro (id)", type: "string" },
    { name: "date", title: "Fecha", type: "string" },
    { name: "serviceKind", title: "Tipo de servicio", type: "string" },
    { name: "published", title: "Publicado (al revisar)", type: "boolean" },
    { name: "status", title: "Estado", type: "string" },
    {
      name: "seats",
      title: "Lugares",
      type: "array",
      of: [
        {
          type: "object",
          name: "availabilityConflictSeat",
          fields: [
            { name: "rowId", title: "Lugar", type: "string" },
            { name: "from", title: "Sale (id)", type: "string" },
            { name: "to", title: "Entra (id)", type: "string" },
            { name: "empty", title: "Queda vacío", type: "boolean" },
          ],
        },
      ],
    },
    { name: "reason", title: "Por qué no hay propuesta", type: "string" },
    { name: "eventSeq", title: "Eventos", type: "number" },
    { name: "notifiedSeq", title: "Eventos avisados", type: "number" },
    { name: "firstSeenAt", title: "Visto por primera vez", type: "datetime" },
    { name: "updatedAt", title: "Actualizado", type: "datetime" },
    { name: "checkedAt", title: "Revisado", type: "datetime" },
    { name: "appliedBy", title: "Aplicado por (id)", type: "string" },
    { name: "trigger", title: "Origen", type: "string" },
  ],
});
