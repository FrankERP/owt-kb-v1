import { defineType } from "sanity";

/**
 * Internal: one meeting of a leveled ministry (today Jóvenes) — the Saturday roster, a group's own
 * meeting, or a joint meeting of two or three groups (ADR-0081; plan
 * `docs/superpowers/plans/2026-10-30-jovenes-events-access.md`).
 *
 * `_id` is `ministryEvent.<uuid>` — dotted, so an untokened read of the public dataset never
 * serves it, and the groups stay closed to each other. Read only through
 * `app/utils/ministryEventReads.ts`; written only by `app/utils/ministryEventCommit.ts`.
 *
 * `audience` decides who reads it and is read CLOSED: `{ kind: "ministry" }` is every member of the
 * ministry, `{ kind: "groups", groups }` only those groups; anything else is no member's. `kind` is
 * display only and never decides access. Every person reference is stored WEAK, so removing a
 * pastor never fails because an old meeting names them.
 *
 * NOT editable content: hidden and read-only in the Studio, never authored by hand.
 */
const weakMember = {
  type: "reference" as const,
  to: [{ type: "teamMembers" }],
  weak: true,
};

export const ministryEvent = defineType({
  name: "ministryEvent",
  title: "Ministry events (internal)",
  type: "document",
  hidden: true,
  readOnly: true,
  description: "Interno: una reunión de Jóvenes. La escribe la app; nunca a mano.",
  fields: [
    { name: "ministry", title: "Ministerio", type: "string" },
    {
      name: "audience",
      title: "Quién la ve",
      type: "object",
      fields: [
        { name: "kind", title: "Tipo", type: "string" },
        { name: "groups", title: "Grupos", type: "array", of: [{ type: "string" }] },
      ],
    },
    { name: "kind", title: "Clase (solo para mostrar)", type: "string" },
    { name: "date", title: "Fecha", type: "date" },
    { name: "time", title: "Hora", type: "string" },
    { name: "arrival", title: "Llegada", type: "string" },
    { name: "title", title: "Título", type: "string" },
    { name: "place", title: "Ubicación", type: "string" },
    {
      name: "seats",
      title: "Asientos",
      type: "array",
      of: [
        {
          type: "object",
          name: "ministryEventSeat",
          fields: [
            { name: "role", title: "Asiento", type: "string" },
            { name: "member", title: "Persona", ...weakMember },
            // Someone without an account (or the hosting group), INSTEAD of `member`; never both.
            { name: "name", title: "Nombre (sin cuenta)", type: "string" },
          ],
        },
      ],
    },
    {
      name: "program",
      title: "Programa",
      type: "array",
      of: [
        {
          type: "object",
          name: "ministryEventProgramLine",
          fields: [
            { name: "label", title: "Qué", type: "string" },
            { name: "member", title: "Quién", ...weakMember },
            { name: "note", title: "Nota", type: "string" },
          ],
        },
      ],
    },
    {
      // A group's class (plan 2026-11-12 L0): only on a ONE-group meeting. `series` is the roster
      // (the book), `track` libro | corazon | sin_clase, `done` the sheet's «Hecho».
      name: "lesson",
      title: "Clase del grupo",
      type: "object",
      fields: [
        { name: "series", title: "Rol (libro)", type: "string" },
        { name: "track", title: "Tipo", type: "string" },
        { name: "done", title: "Hecho", type: "boolean" },
      ],
    },
    { name: "notes", title: "Notas", type: "text" },
    { name: "published", title: "Publicado", type: "boolean" },
    { name: "createdBy", title: "Creada por", ...weakMember },
  ],
});
