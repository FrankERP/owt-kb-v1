// A debounce record, not a delivery ledger (spec §1). It buffers "this subject
// changed" until the subject goes quiet, is classified against live state, and
// is consumed. Written only by the server write token through the guarded
// writers — `hidden: true` keeps it off the authoring surface entirely.

export const notificationOutbox = {
  name: "notificationOutbox",
  title: "Notification outbox",
  type: "document",
  hidden: true,
  readOnly: true,
  fields: [
    { name: "kind", type: "string", options: { list: ["role", "setlist", "leadNotes"] } },
    { name: "subjectKey", type: "string" },

    // Stored rather than re-parsed out of subjectKey.
    { name: "memberId", type: "string" },
    { name: "roleId", type: "string" },
    { name: "proposalId", type: "string" },

    // Identity snapshot: the fallback for rendering a subject line when the
    // subject document is gone at flush (a deleted role still owes its
    // assignees an email whose subject carries a date).
    { name: "serviceDate", type: "string" },
    { name: "roleType", type: "string" },

    {
      name: "before",
      type: "object",
      fields: [
        { name: "beforeRoles", type: "array", of: [{ type: "string" }] },
        {
          name: "beforeSongs",
          type: "array",
          of: [{
            type: "object",
            name: "outboxSongRow",
            fields: [
              { name: "ref", type: "string" },
              { name: "key", type: "string" },
              // Index of the contiguous medley run, or absent for a standalone
              // song. Never a raw medley_tag — those are regenerated on every
              // editor write and would make every edit compare as changed.
              { name: "group", type: "number" },
            ],
          }],
        },
        { name: "beforeNotes", type: "text" },
      ],
    },

    // Recipients known when the notice was queued. Anyone absent is new to the
    // subject and gets an introduction rather than a diff.
    { name: "knownRecipients", type: "array", of: [{ type: "string" }] },

    { name: "firstQueuedAt", type: "datetime" },
    { name: "notifyAfter", type: "datetime" },
    { name: "deadline", type: "datetime" },
    { name: "status", type: "string", options: { list: ["pending", "sending"] } },
    { name: "claimedAt", type: "datetime" },
  ],
};
