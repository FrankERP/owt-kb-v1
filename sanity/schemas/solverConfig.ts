import { defineType } from "sanity";

/**
 * The solver/planner RULE SET — one shared document for the whole team (P6).
 *
 * ─── Why it exists ───────────────────────────────────────────────────────────
 *
 * The rules (`SolverConfig` in `app/components/admin/plannerModel.ts:234-241`)
 * decide who may be seated where, and since Task 3 they are HARD blocks on the
 * planner grid. Until Task 9 they lived only in one browser's `localStorage`
 * (`owt_solver_config_v3`), so a second admin enforced a different rule set —
 * or none. This document is where they become one thing for every admin and
 * both surfaces.
 *
 * ─── One document, at a FIXED id ─────────────────────────────────────────────
 *
 * `_id` is always `solverConfig` (`SOLVER_CONFIG_DOC_ID` in
 * `app/utils/solverConfigWriteRequest.ts`). A deterministic singleton id is what
 * makes two separate guarantees expressible at all:
 *
 *   · `app/api/admin/solver-config/route.ts` may only ever UPDATE it, never
 *     create it — so the first "Guardar" from a browser holding no rules cannot
 *     mint the shared document out of `DEFAULT_SOLVER_CONFIG`;
 *   · `scripts/seed-solver-config.ts` is the only writer that may create it, and
 *     it REFUSES if the document already exists.
 *
 * ─── Every array item carries a `_key` ───────────────────────────────────────
 *
 * CLAUDE.md invariant, and it applies at FIVE levels here: `restrictions[]`,
 * `restrictions[].weekExclusions[]`, `restrictions[].caps[]`, `conflicts[]` and
 * `presence[]`. The rule objects already carry an `id` from `uid()`
 * (`MonthGenerator.tsx:183`), so the `_key` IS that `id` — one identifier, stored
 * twice under the two names its two owners use. Minting happens in
 * `solverConfigWriteRequest.ts`, which both the route and the seed script go
 * through, so the two cannot drift.
 *
 * ─── Studio posture ──────────────────────────────────────────────────────────
 *
 * `hidden` + `readOnly`: the Studio is an alternate write path with no `_rev`
 * check and no validation, straight into the one document that governs hard
 * enforcement for every admin on both surfaces. Being reachable NOWHERE in the
 * Studio is the correct answer here — unlike `notificationOutbox`, there is no
 * legitimate "prune a stray entry by hand" operation to preserve, so this type
 * deliberately does NOT join `PROTECTED_STUDIO_TYPES` (whose only effect would
 * be to give it a read-only inspection pane it does not need).
 *
 * The Content Lake is schemaless, so this file governs STUDIO VISIBILITY ONLY
 * and gates nothing at runtime — see `docs/DATA_MODEL.md:499-501`. Reading and
 * writing the document works whether or not this schema has been deployed.
 */
export const solverConfig = defineType({
  name: "solverConfig",
  title: "Reglas del planificador (interno)",
  type: "document",
  hidden: true,
  readOnly: true,
  description:
    "Interno: el conjunto de reglas compartido del planificador. Se edita desde /admin, nunca a mano.",
  fields: [
    {
      name: "sundayLeads",
      title: "Pool de leads (domingo)",
      type: "array",
      of: [{ type: "string" }],
    },
    {
      name: "saturdayLeads",
      title: "Pool de leads (sábado)",
      type: "array",
      of: [{ type: "string" }],
    },
    { name: "support", title: "Pool de apoyo", type: "array", of: [{ type: "string" }] },
    {
      name: "restrictions",
      title: "Restricciones por persona",
      type: "array",
      of: [
        {
          type: "object",
          name: "solverRestriction",
          fields: [
            { name: "id", title: "Id", type: "string" },
            { name: "person", title: "Persona", type: "string" },
            {
              name: "excludedPatterns",
              title: "Patrones excluidos",
              type: "array",
              of: [{ type: "string" }],
            },
            { name: "fairness", title: "Equidad", type: "string" },
            { name: "fairnessSlack", title: "Holgura de equidad", type: "number" },
            {
              name: "weekExclusions",
              title: "Semanas excluidas",
              type: "array",
              of: [
                {
                  type: "object",
                  name: "solverWeekExclusion",
                  fields: [
                    { name: "id", title: "Id", type: "string" },
                    { name: "week", title: "Semana", type: "number" },
                    { name: "pattern", title: "Patrón", type: "string" },
                  ],
                },
              ],
            },
            {
              name: "caps",
              title: "Topes",
              type: "array",
              of: [
                {
                  type: "object",
                  name: "solverCap",
                  fields: [
                    { name: "id", title: "Id", type: "string" },
                    { name: "pattern", title: "Patrón", type: "string" },
                    { name: "op", title: "Operador", type: "string" },
                    { name: "value", title: "Valor", type: "number" },
                    { name: "relative", title: "Relativo", type: "boolean" },
                    { name: "relOffset", title: "Desplazamiento relativo", type: "number" },
                  ],
                },
              ],
            },
          ],
        },
      ],
    },
    {
      name: "conflicts",
      title: "Conflictos entre dos personas",
      type: "array",
      of: [
        {
          type: "object",
          name: "solverConflict",
          fields: [
            { name: "id", title: "Id", type: "string" },
            { name: "personA", title: "Persona A", type: "string" },
            { name: "personB", title: "Persona B", type: "string" },
            { name: "pattern", title: "Patrón", type: "string" },
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
          name: "solverPresence",
          fields: [
            { name: "id", title: "Id", type: "string" },
            { name: "persons", title: "Personas", type: "array", of: [{ type: "string" }] },
            { name: "pattern", title: "Patrón", type: "string" },
          ],
        },
      ],
    },
    {
      name: "updatedAt",
      title: "Actualizado",
      type: "datetime",
      description: "Escrito por la ruta de guardado; nunca a mano.",
    },
    {
      name: "updatedBy",
      title: "Actualizado por",
      type: "string",
      description: "Id de Sanity del administrador que guardó por última vez.",
    },
  ],
  preview: {
    select: { restrictions: "restrictions", conflicts: "conflicts", updatedAt: "updatedAt" },
    prepare(sel: { restrictions?: unknown[]; conflicts?: unknown[]; updatedAt?: string }) {
      return {
        title: "Reglas del planificador",
        subtitle: `${sel.restrictions?.length ?? 0} restricciones · ${sel.conflicts?.length ?? 0} conflictos · ${sel.updatedAt ?? "sin fecha"}`,
      };
    },
  },
});
