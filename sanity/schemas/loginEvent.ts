// Sign-in audit trail. Written only by `auth.ts`'s `events.signIn` through the
// server write token; never hand-authored.
//
// SANITY v5 CORRECTNESS: this type used to carry an `__experimental_actions` list
// of `["read", "delete"]`. That key was REMOVED in Sanity v5 and is inert there,
// so the type had silently lost its restriction. The intent
// ("read and delete only, never create or edit in the Studio") is now expressed
// with the supported v5 mechanisms and asserted in code:
//   · `readOnly: true` here makes the whole form non-editable;
//   · `loginEvent` is registered in `app/utils/studioProtection.ts` as a
//     delete-only governed type, so `document.actions` keeps ONLY `delete` and
//     `document.newDocumentOptions` drops its create template.
// `app/utils/__tests__/studioProtection.test.ts` asserts every capability.
//
// Delete stays available on purpose: an operator prunes the audit trail, and the
// Service Readiness A3 §4 verification reset deletes its own run-owned events by
// exact `_id`.
export const loginEvent = {
  name: "loginEvent",
  title: "Login Event",
  type: "document",
  readOnly: true,
  fields: [
    {
      name: "member",
      title: "Member",
      type: "reference",
      to: [{ type: "teamMembers" }],
    },
    { name: "email",     title: "Email",     type: "string" },
    { name: "provider",  title: "Provider",  type: "string" },
    { name: "timestamp", title: "Timestamp", type: "datetime" },

    // ── Service Readiness A3 §4: isolated-verification run ownership ──────────
    //
    // OPTIONAL, hidden and read-only. Set only on an isolated verification
    // deployment, only when the request carried the dedicated verification
    // headers AND the deployment's marker/project/dataset, delivery mode, commit
    // SHA, deployment id and live dataset-lease owner all matched
    // (`app/utils/srVerificationLoginEvent.ts`). They exist so a verification run
    // can delete exactly its own login events by explicit `_id` — never by a
    // broad type, email, member or time-range query. Ordinary sign-ins never
    // carry them.
    { name: "runId",        title: "Verification run id",        type: "string", hidden: true, readOnly: true },
    { name: "attemptId",    title: "Verification attempt id",    type: "string", hidden: true, readOnly: true },
    { name: "candidateSha", title: "Verification candidate SHA", type: "string", hidden: true, readOnly: true },
    { name: "deploymentId", title: "Verification deployment id", type: "string", hidden: true, readOnly: true },
  ],
};
