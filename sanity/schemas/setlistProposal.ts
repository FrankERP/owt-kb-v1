import { defineType } from "sanity";

export const setlistProposal = defineType({
  name: "setlistProposal",
  title: "Setlist Proposal",
  type: "document",
  // Service Readiness A2 §8 — Studio protection. This document is read-only in
  // the embedded Studio: every write goes through the guarded API routes, which
  // hold the target lock, assert the observed revision, and run the dependency
  // policy. `document.actions` in `sanity.config.ts` also removes every mutating
  // action (even by direct URL), and `newDocumentOptions` removes the create
  // affordance. `__experimental_actions` is NOT used — it is inert in Sanity v5.
  readOnly: true,
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
      name: "team_notes",
      title: "Mensaje para el equipo",
      description: "Se publica para todo el equipo cuando se aprueba la propuesta.",
      type: "text",
      rows: 3,
    },
    // ── Private lead <-> admin thread (Release 2) ──────────────────────────
    // Append-only conversation, replacing the single-value `lead_notes` /
    // `admin_notes` fields (which stay above as a frozen archive). Declared
    // here only: the document is `readOnly: true`, so Studio never writes it —
    // every message is appended by a guarded API route.
    {
      name: "messages",
      title: "Conversación (líder ↔ admins)",
      description:
        "Historial privado. Se agrega, nunca se sobrescribe. Distinto de «Mensaje para el equipo».",
      type: "array",
      of: [
        {
          type: "object",
          name: "proposal_message",
          fields: [
            {
              name: "author",
              title: "Autor",
              // OPTIONAL on purpose: migrated admin notes with no attributable
              // author are minted WITHOUT one and render as "Admin". A
              // fabricated attribution in an audit-adjacent history is worse
              // than an absent one.
              type: "reference",
              to: [{ type: "teamMembers" }],
            },
            {
              name: "author_role",
              title: "Rol del autor",
              // Denormalized on purpose: a fact about the message at the moment
              // it was posted. If an admin later becomes a member, their
              // historical change-request must not re-render as a lead note.
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
              // `author_role` is WHO spoke; `kind` is WHAT KIND of speech act.
              // `pastor_note` and `system` are reserved from day one so routing
              // pastor notes here later is a write-path change with no schema
              // migration; nothing mints them yet.
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
          preview: {
            select: { title: "body", subtitle: "at" },
          },
        },
      ],
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
    // ── Internal review integrity (Service Readiness A2 §6) ─────────────────
    // Written only by the guarded approval/transition route, never by hand: the
    // approval receipt is what proves a given setlist content was published by
    // this code (an approved proposal without one is a legacy record), and the
    // transition record is what makes a replayed review a no-write retry.
    {
      name: "approval_receipt",
      title: "Approval receipt (internal)",
      type: "object",
      hidden: true,
      readOnly: true,
      fields: [
        { name: "v", title: "Version", type: "number" },
        { name: "marker", title: "App marker", type: "string" },
        { name: "fingerprint", title: "Input fingerprint", type: "string" },
        { name: "serviceType", title: "Service type", type: "string" },
        { name: "serviceDate", title: "Service date", type: "string" },
        { name: "serviceRef", title: "Service role id", type: "string" },
        { name: "setlistTargetKey", title: "Setlist target key", type: "string" },
        { name: "setlistId", title: "Published setlist id", type: "string" },
        { name: "songCount", title: "Song count", type: "number" },
        { name: "approvedAt", title: "Approved at", type: "datetime" },
        { name: "approvedBy", title: "Approved by (member id)", type: "string" },
      ],
    },
    {
      name: "last_transition",
      title: "Last review transition (internal)",
      type: "object",
      hidden: true,
      readOnly: true,
      fields: [
        { name: "v", title: "Version", type: "number" },
        { name: "marker", title: "App marker", type: "string" },
        { name: "action", title: "Action", type: "string" },
        { name: "fingerprint", title: "Intent fingerprint", type: "string" },
        { name: "toStatus", title: "Resulting status", type: "string" },
        { name: "at", title: "At", type: "datetime" },
        { name: "by", title: "By (member id)", type: "string" },
      ],
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
