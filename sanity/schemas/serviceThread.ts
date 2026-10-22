import { defineType } from "sanity";

/**
 * The conversation about a service before its setlist proposal exists (ADR-0065).
 *
 * `_id` is `serviceThread.<roleId>` (dotted: an untokened read never serves it).
 * Admins append here while the service has no `setlistProposal`; once the leads
 * create one, new messages go to the proposal's own `messages[]` and both lists
 * are shown together. Written only by `POST /api/admin/service-threads/[roleId]/messages`.
 *
 * `role_id` is a plain STRING on purpose, never a reference (not even a weak one):
 * GROQ's `references()` matches weak references, and `roleDependencies` turns every
 * document that references a role into a dependency — one message would block
 * «Limpiar mes», a role delete and a date move.
 *
 * The message item mirrors `setlistProposal.messages[]` field for field (same
 * `proposal_message` item type, minted by `buildProposalMessage`), so both
 * threads render through the same component.
 */
export const serviceThread = defineType({
  name: "serviceThread",
  title: "Conversación previa a la propuesta",
  type: "document",
  readOnly: true,
  fields: [
    {
      name: "role_id",
      title: "Servicio (id del rol)",
      type: "string",
    },
    {
      name: "messages",
      title: "Mensajes",
      description: "Se agrega, nunca se sobrescribe.",
      type: "array",
      of: [
        {
          type: "object",
          name: "proposal_message",
          fields: [
            { name: "author", title: "Autor", type: "reference", to: [{ type: "teamMembers" }] },
            {
              name: "author_role",
              title: "Rol del autor",
              type: "string",
              options: {
                list: [
                  { title: "Líder", value: "lead" },
                  { title: "Admin", value: "admin" },
                  { title: "Pastor", value: "pastor" },
                  { title: "Sistema", value: "system" },
                ],
              },
            },
            {
              name: "kind",
              title: "Tipo",
              type: "string",
              options: {
                list: [
                  { title: "Nota del líder", value: "lead_note" },
                  { title: "Cambios solicitados", value: "admin_change_request" },
                  { title: "Nota del pastor", value: "pastor_note" },
                  { title: "Sistema", value: "system" },
                ],
              },
            },
            { name: "body", title: "Mensaje", type: "text", rows: 3 },
            { name: "at", title: "Enviado", type: "datetime" },
          ],
          preview: { select: { title: "body", subtitle: "at" } },
        },
      ],
    },
  ],
  preview: {
    select: { id: "_id" },
    prepare(sel: { id?: string }) {
      return { title: sel.id ?? "—", subtitle: "Conversación previa a la propuesta" };
    },
  },
});
