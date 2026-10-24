import { defineType } from "sanity";

/**
 * What admins write about a service from its card (ADR-0065).
 *
 * `_id` is `serviceThread.<roleId>` (dotted: an untokened read never serves it).
 * `messages[]` is the admins' side of the conversation with the leads, read
 * together with the proposal's own thread; `pastor_message` is the service's one
 * «Mensaje del pastor», shown to the whole team. Written only by the routes under
 * `/api/admin/service-threads/[roleId]/` (`messages`, `messages/[key]`,
 * `pastor-message`).
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
  title: "Mensajes del servicio",
  type: "document",
  readOnly: true,
  fields: [
    {
      name: "role_id",
      title: "Servicio (id del rol)",
      type: "string",
    },
    {
      name: "pastor_message",
      title: "Mensaje del pastor",
      type: "object",
      fields: [
        { name: "body", title: "Mensaje", type: "text", rows: 6 },
        { name: "author", title: "Lo puso", type: "reference", to: [{ type: "teamMembers" }] },
        { name: "at", title: "Puesto", type: "datetime" },
        { name: "edited_at", title: "Editado", type: "datetime" },
      ],
    },
    {
      name: "messages",
      title: "Mensajes",
      description: "Su autor puede editarlos o borrarlos desde la página.",
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
            { name: "edited_at", title: "Editado", type: "datetime" },
          ],
          preview: { select: { title: "body", subtitle: "at" } },
        },
      ],
    },
  ],
  preview: {
    select: { id: "_id" },
    prepare(sel: { id?: string }) {
      return { title: sel.id ?? "—", subtitle: "Mensajes del servicio" };
    },
  },
});
