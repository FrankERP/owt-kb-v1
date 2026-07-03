import { defineType } from "sanity";

export const setlistProposal = defineType({
  name: "setlistProposal",
  title: "Setlist Proposal",
  type: "document",
  fields: [
    {
      name: "service_type",
      title: "Service Type",
      type: "string",
      options: {
        list: [
          { title: "Domingo", value: "sunday" },
          { title: "Sábado", value: "saturday" },
          { title: "Especial", value: "special" },
        ],
        layout: "radio",
      },
    },
    {
      name: "service_ref",
      title: "Service Document",
      type: "reference",
      to: [
        { type: "sunday_role" },
        { type: "saturday_role" },
        { type: "special_role" },
      ],
    },
    {
      name: "service_date",
      title: "Service Date",
      type: "date",
    },
    {
      name: "lead",
      title: "Lead (creator)",
      description: "Who created this shared proposal. Every Lead on the service co-edits the same doc; see contributors.",
      type: "reference",
      to: [{ type: "teamMembers" }],
    },
    {
      name: "contributors",
      title: "Contributors",
      description: "Every Lead who has saved an edit to this shared proposal.",
      type: "array",
      of: [
        {
          type: "object",
          name: "contributor",
          fields: [
            { name: "person", title: "Person", type: "reference", to: [{ type: "teamMembers" }] },
          ],
          preview: {
            select: { alias: "person.alias", name: "person.member_name" },
            prepare(sel: { alias?: string; name?: string }) {
              return { title: sel.alias || sel.name || "—" };
            },
          },
        },
      ],
    },
    {
      name: "submitted_by",
      title: "Submitted by",
      description: "Who last moved this proposal to “pending” for review.",
      type: "reference",
      to: [{ type: "teamMembers" }],
      readOnly: true,
    },
    {
      name: "last_edited_by",
      title: "Last edited by",
      type: "reference",
      to: [{ type: "teamMembers" }],
      readOnly: true,
    },
    {
      name: "last_edited_at",
      title: "Last edited",
      type: "datetime",
      readOnly: true,
    },
    {
      name: "songs",
      title: "Songs",
      type: "array",
      of: [
        {
          type: "object",
          name: "proposal_song",
          fields: [
            {
              name: "song",
              title: "Song",
              type: "reference",
              to: [{ type: "post" }],
            },
            {
              name: "play_key",
              title: "Key to play",
              type: "string",
            },
            {
              name: "medley_tag",
              title: "Medley / Mashup",
              type: "string",
              hidden: true,
              description: "Songs sharing the same tag are shown as a grouped medley. Managed by the proposal editor.",
            },
          ],
          preview: {
            select: {
              title: "song.title",
              author: "song.author",
              play_key: "play_key",
            },
            prepare(sel: { title?: string; author?: string; play_key?: string }) {
              return {
                title: sel.title ?? "Sin canción",
                subtitle: `${sel.author ?? ""} · ${sel.play_key ?? "—"}`,
              };
            },
          },
        },
      ],
    },
    {
      name: "status",
      title: "Status",
      type: "string",
      options: {
        list: [
          { title: "Borrador", value: "draft" },
          { title: "Pendiente de revisión", value: "pending" },
          { title: "Aprobada", value: "approved" },
          { title: "Cambios solicitados", value: "changes_requested" },
        ],
        layout: "radio",
      },
      initialValue: "draft",
    },
    {
      name: "lead_notes",
      title: "Notas del líder",
      type: "text",
      rows: 3,
    },
    {
      name: "admin_notes",
      title: "Notas del admin",
      type: "text",
      rows: 3,
    },
    {
      name: "submitted_at",
      title: "Enviada",
      type: "datetime",
      readOnly: true,
    },
    {
      name: "reviewed_at",
      title: "Revisada",
      type: "datetime",
      readOnly: true,
    },
  ],
  preview: {
    select: {
      date: "service_date",
      type: "service_type",
      lead: "lead.alias",
      leadFull: "lead.member_name",
      status: "status",
    },
    prepare(sel: { date?: string; type?: string; lead?: string; leadFull?: string; status?: string }) {
      const name = sel.lead || sel.leadFull || "—";
      const typeLabel = sel.type === "sunday" ? "Dom" : sel.type === "saturday" ? "Sáb" : "Esp";
      return {
        title: `${sel.date ?? "Sin fecha"} · ${typeLabel} · ${name}`,
        subtitle: sel.status ?? "draft",
      };
    },
  },
});
