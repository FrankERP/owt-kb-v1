import { defineType } from "sanity";

/**
 * Internal: one admin's spend on the admin assistant in one CDMX month (ADR-0060).
 *
 * `_id` is `adminChatUsage.<memberId>.<YYYY-MM>` — dotted, so an untokened read never serves it.
 * Written only by `POST /api/admin/chat` (`recordSpend` in `app/utils/adminChatServer.ts`):
 * `createIfNotExists` + `inc` after each answer, from the API's own `usage`. The route refuses a
 * question once `spentMicroUsd` reaches the monthly cap. Absent document = nothing spent.
 *
 * NOT editable content: hidden and read-only in the Studio, never authored by hand.
 */
export const adminChatUsage = defineType({
  name: "adminChatUsage",
  title: "Admin assistant usage (internal)",
  type: "document",
  hidden: true,
  readOnly: true,
  description: "Interno: lo que un admin gastó en el asistente en un mes. No editar ni borrar a mano.",
  fields: [
    {
      name: "member",
      title: "Miembro",
      type: "reference",
      to: [{ type: "teamMembers" }],
      weak: true,
    },
    { name: "month", title: "Mes (YYYY-MM)", type: "string" },
    {
      name: "spentMicroUsd",
      title: "Gastado (millonésimas de USD)",
      type: "number",
      description: "1 000 000 = 1 USD. Suma el costo de cada respuesta.",
    },
    { name: "questions", title: "Preguntas", type: "number" },
    { name: "updatedAt", title: "Última pregunta", type: "datetime" },
  ],
  preview: {
    select: { name: "member.member_name", month: "month", spent: "spentMicroUsd" },
    prepare(sel: { name?: string; month?: string; spent?: number }) {
      const usd = ((sel.spent ?? 0) / 1_000_000).toFixed(2);
      return { title: sel.name ?? "(sin miembro)", subtitle: `${sel.month ?? "?"} · ${usd} USD` };
    },
  },
});
