import { defineType } from "sanity";

/**
 * The monthly ELIGIBILITY RECORD of the fairness ledger (solver v3 C2 REC-1 … REC-8).
 *
 * One document per calendar month at `_id: "fairnessMonth.YYYY-MM"`. The id is DOTTED on
 * purpose (parent A2): Sanity treats any id containing a dot as private, so the record —
 * which snapshots members' unavailable dates — is never served to an unauthenticated
 * read. The flip side is that every reader must carry the read token or fail closed: an
 * untokened read answers «no record» with no error.
 *
 * What it holds: who was eligible for which of the six voice role keys that month, each
 * person's exact rules (resolved for the month), the «Mes por medio» SETTING, «Exenta»,
 * per-date blocks, and the presence rules — the snapshot the ledger judges that month's
 * seats against. What it never holds (REC-5): seats served, balances, shares, the cadence
 * STATE, rule strings, names inside `presence`, a `published` field. Seats stay derived
 * from the role documents (ADR-0042).
 *
 * Written ONLY by the write executor in `app/utils/fairnessMonthWriteRequest.ts` —
 * through `PUT /api/admin/fairness/months` (`fairnessMonthCommit.ts`) or C4's consented
 * reconstruction script — which mints every `_key`, the content hash and the stamps.
 * Studio posture is the `solverConfig` one: `hidden` + `readOnly`, and governed in
 * `app/utils/studioProtection.ts` so `document.actions` strips every mutating action
 * however the pane was reached. The Content Lake is schemaless; this file governs Studio
 * VISIBILITY only and gates nothing at runtime.
 */
export const fairnessMonth = defineType({
  name: "fairnessMonth",
  title: "Registro de equidad (interno)",
  type: "document",
  hidden: true,
  readOnly: true,
  description:
    "Interno: quién era elegible para cada rol de voz en un mes. Lo escribe la app o la reconstrucción; nunca a mano.",
  fields: [
    { name: "schemaVersion", title: "Versión del esquema", type: "number" },
    { name: "month", title: "Mes (YYYY-MM)", type: "string" },
    { name: "source", title: "Origen", type: "string" },
    { name: "engine", title: "Solver", type: "string" },
    { name: "environment", title: "Entorno", type: "string" },
    { name: "recordedAt", title: "Registrado", type: "datetime" },
    { name: "recordedBy", title: "Registrado por", type: "string" },
    { name: "contentHash", title: "Hash del contenido", type: "string" },
    {
      name: "people",
      title: "Personas",
      type: "array",
      of: [
        {
          type: "object",
          name: "fairnessPerson",
          fields: [
            { name: "member", title: "Miembro", type: "reference", to: [{ type: "teamMembers" }], weak: true },
            { name: "name", title: "Nombre (solo para mostrar)", type: "string" },
            {
              name: "roles",
              title: "Roles",
              type: "object",
              fields: [
                { name: "sunLead", title: "Dom Lead", type: "string" },
                { name: "satLead", title: "Sáb Lead", type: "string" },
                { name: "sunBgv", title: "Dom BGV", type: "string" },
                { name: "satBgv", title: "Sáb BGV", type: "string" },
                { name: "sunChoir", title: "Dom Coro", type: "string" },
                { name: "satChoir", title: "Sáb Coro", type: "string" },
              ],
            },
            {
              name: "exactRules",
              title: "Reglas fijas",
              type: "array",
              of: [
                {
                  type: "object",
                  name: "fairnessExactRule",
                  fields: [
                    { name: "roles", title: "Roles", type: "array", of: [{ type: "string" }] },
                    { name: "count", title: "Lugares", type: "number" },
                  ],
                },
              ],
            },
            { name: "sundayCadence", title: "Domingo", type: "string", description: "Interno: vacío = Normal" },
            { name: "exempt", title: "Exenta", type: "boolean" },
            {
              name: "blocks",
              title: "Fechas",
              type: "array",
              of: [
                {
                  type: "object",
                  name: "fairnessBlock",
                  fields: [
                    { name: "date", title: "Fecha", type: "date" },
                    { name: "unavailable", title: "No disponible", type: "boolean" },
                    { name: "excludedRoles", title: "Roles excluidos por regla", type: "array", of: [{ type: "string" }] },
                  ],
                },
              ],
            },
          ],
        },
      ],
    },
    {
      name: "presence",
      title: "Reglas de presencia",
      type: "array",
      of: [
        {
          type: "object",
          name: "fairnessPresence",
          fields: [
            { name: "ruleKey", title: "Regla", type: "string" },
            { name: "roles", title: "Roles", type: "array", of: [{ type: "string" }] },
            { name: "members", title: "Miembros (ids)", type: "array", of: [{ type: "string" }] },
            { name: "exclusive", title: "Exclusiva", type: "boolean" },
          ],
        },
      ],
    },
  ],
});
