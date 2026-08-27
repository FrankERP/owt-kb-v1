import { defineType } from "sanity";

// A debounce record, not a delivery ledger (spec §1). It buffers "this subject
// changed" until the subject goes quiet, is classified against live state, and
// is consumed. Written only by the server write token through the guarded
// writers — `hidden: true` keeps it off the authoring surface entirely.

export const notificationOutbox = defineType({
  name: "notificationOutbox",
  title: "Notification Outbox (internal)",
  type: "document",
  hidden: true,
  readOnly: true,
  description:
    "Interno: cola de deduplicación para notificaciones por correo. No editar a mano.",
  fields: [
    {
      name: "kind",
      title: "Kind",
      type: "string",
      options: {
        list: [
          { title: "Role", value: "role" },
          { title: "Setlist", value: "setlist" },
          { title: "Lead notes", value: "leadNotes" },
        ],
      },
    },
    { name: "subjectKey", title: "Subject key", type: "string" },

    // Stored rather than re-parsed out of subjectKey.
    {
      name: "memberId",
      title: "Member id",
      type: "string",
      description: "Stored rather than re-parsed out of subjectKey.",
    },
    {
      name: "roleId",
      title: "Role id",
      type: "string",
      description: "Stored rather than re-parsed out of subjectKey.",
    },
    {
      name: "proposalId",
      title: "Proposal id",
      type: "string",
      description: "Stored rather than re-parsed out of subjectKey.",
    },

    // Identity snapshot: the fallback for rendering a subject line when the
    // subject document is gone at flush (a deleted role still owes its
    // assignees an email whose subject carries a date).
    {
      name: "serviceDate",
      title: "Service date",
      type: "string",
      description:
        "Identity snapshot: fallback for rendering a subject line when the subject document is gone at flush.",
    },
    {
      name: "roleType",
      title: "Role type",
      type: "string",
      options: {
        list: [
          { title: "Sunday", value: "sunday_role" },
          { title: "Saturday", value: "saturday_role" },
          { title: "Special", value: "special_role" },
        ],
      },
      description:
        "Identity snapshot: fallback for rendering a subject line when the subject document is gone at flush (a deleted role still owes its assignees an email whose subject carries a date). Absent for leadNotes notices.",
    },

    {
      name: "before",
      title: "Before snapshot",
      type: "object",
      fields: [
        {
          name: "beforeRoles",
          title: "Before roles",
          type: "array",
          of: [{ type: "string" }],
        },
        {
          name: "beforeSongs",
          title: "Before songs",
          type: "array",
          of: [{
            type: "object",
            name: "outboxSongRow",
            fields: [
              { name: "ref", title: "Ref", type: "string" },
              { name: "key", title: "Key", type: "string" },
              // Index of the contiguous medley run, or absent for a standalone
              // song. Never a raw medley_tag — those are regenerated on every
              // editor write and would make every edit compare as changed.
              {
                name: "group",
                title: "Group",
                type: "number",
                description:
                  "Index of the contiguous medley run, or absent for a standalone song. Never a raw medley_tag — those are regenerated on every editor write and would make every edit compare as changed.",
              },
            ],
          }],
        },
        { name: "beforeNotes", title: "Before notes", type: "text" },
        {
          name: "beforeMessageCount",
          title: "Before message count",
          type: "number",
          description:
            "leadNotes only: the number of lead_note messages the proposal held when this notice was queued. The flush slices the thread from this index. Absent on a notice minted before the thread became the source, which the sweep classifies against beforeNotes instead — so 0 and absent are different states and must not be conflated.",
        },
      ],
    },

    // Recipients known when the notice was queued. Anyone absent is new to the
    // subject and gets an introduction rather than a diff.
    {
      name: "knownRecipients",
      title: "Known recipients",
      type: "array",
      of: [{ type: "string" }],
      description:
        "Recipients known when the notice was queued. Anyone absent is new to the subject and gets an introduction rather than a diff.",
    },

    // Recipients this notice already attempted (success or fail). A later sweep
    // skips them so a setlist fan-out can finish across ticks. Cleared when a
    // writer re-queues the same subject — that is a new change.
    {
      name: "servedRecipients",
      title: "Served recipients",
      type: "array",
      of: [{ type: "string" }],
      description:
        "Recipients this notice already attempted. Later sweeps skip them. Cleared when a writer re-queues the same subject.",
    },

    { name: "firstQueuedAt", title: "First queued at", type: "datetime" },
    { name: "notifyAfter", title: "Notify after", type: "datetime" },
    { name: "deadline", title: "Deadline", type: "datetime" },
    {
      name: "status",
      title: "Status",
      type: "string",
      options: {
        list: [
          { title: "Pending", value: "pending" },
          { title: "Sending", value: "sending" },
        ],
      },
    },
    { name: "claimedAt", title: "Claimed at", type: "datetime" },
  ],
});
